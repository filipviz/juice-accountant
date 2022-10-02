const { execute, ProjectOverviewDocument, PaymentsDocument, RedemptionsDocument, v1PayoutsDocument, v2PayoutsDocument } = require('./.graphclient');
const { writeFile } = require('fs').promises;
const readline = require('readline');

async function main() {

  // Get user input
  let ProjectId = +(await question('Project ID? '));
  let Cv = `${(await  question('Protocol version? '))}`;
  let Fiat = `${(await question('Fiat currency? '))}`;

  // Grab main project information from Juicebox subgraph
  const overview = (await execute(ProjectOverviewDocument, { ProjectId: ProjectId, Cv: Cv }, {})).data.projects[0];
  const Id = overview.id;
  
  // Get project name and description from IPFS via Juicebox's Pinata gateway
  const metadata = await apifetch(`https://jbx.mypinata.cloud/ipfs/${overview.metadataUri}`);
  console.log("\nName: ", metadata.name);
  console.log("Description: ", metadata.description);

  // Print main project info
  console.log(`Handle: ${overview.handle}`);
  console.log(`Owner: ${overview.owner}`);
  console.log(`Created at: ${new Date(overview.createdAt * 1000)}`);
  console.log(`Current balance: ${overview.currentBalance / 1000000000000000000} ETH`);
  console.log(`Total paid: ${overview.totalPaid / 1000000000000000000} ETH`);
  console.log(`Total redeemed: ${overview.totalRedeemed / 1000000000000000000} ETH\n`);

  // Fetch ETH prices from project's creation to current time
  console.log("Retreiving historical price data . . .");
  const prices = (await apifetch(`https://api.coingecko.com/api/v3/coins/ethereum/market_chart?vs_currency=${Fiat}&days=max&interval=hourly`)).prices;

  // Participants
  console.log("Evaluating participants . . .");
  for(const i in overview.participants) {
    overview.participants[i].totalPaid /= 1000000000000000000;
    overview.participants[i].balance /= 1000000000000000000;
    overview.participants[i].totalPaidFiat = prices[prices.length-1][1]*overview.participants[i].totalPaid;
  }
  writecsv("./output/participants.csv", array2csv(overview.participants));

  // Payments
  console.log("Retreiving payments . . .");
  let payEvents = (await execute(PaymentsDocument, {Id: Id}, {})).data.projects[0].payEvents;
  for(const i in payEvents) {
    payEvents[i].amount /= 1000000000000000000;
    payEvents[i].timestamp *= 1000;
    payEvents[i].amountFiat = (await prices.find(el => el[0] > payEvents[i].timestamp)[1])*payEvents[i].amount;
    payEvents[i].date = new Date(payEvents[i].timestamp).toLocaleString();
  }
  writecsv("./output/payments.csv", array2csv(payEvents));

  // Redemptions
  console.log("Retreiving redemptions . . .");
  let redeemEvents = (await execute(RedemptionsDocument, {Id: Id}, {})).data.projects[0].redeemEvents;
  for(const i in redeemEvents) {
    redeemEvents[i].amount /= 1000000000000000000;
    redeemEvents[i].returnAmount /= 1000000000000000000;
    redeemEvents[i].timestamp *= 1000;
    redeemEvents[i].returnAmountFiat = (await prices.find(el => el[0] > redeemEvents[i].timestamp)[1])*redeemEvents[i].returnAmount;
    redeemEvents[i].date = new Date(redeemEvents[i].timestamp).toLocaleString();
  }
  writecsv("./output/redemptions.csv", array2csv(redeemEvents));

  // Payouts
  console.log("Retreiving payouts . . .");
  let payoutsEvents;
  if (Cv === "2") {
    // Use v2 subgraph schema
    payoutsEvents = (await execute(v2PayoutsDocument, {Id: Id}, {})).data.projects[0].distributePayoutsEvents;
    // Formatting outputs and fetching fiat prices
    for(const i in payoutsEvents) {
      payoutsEvents[i].timestamp *= 1000;
      let fiatPrice = await prices.find(el => el[0] > payoutsEvents[i].timestamp)[1];
      for(const j in payoutsEvents[i].splitDistributions) {
        payoutsEvents[i].splitDistributions[j].amount /= 1000000000000000000;
        payoutsEvents[i].splitDistributions[j].amountFiat = fiatPrice*payoutsEvents[i].splitDistributions[j].amount;
        payoutsEvents[i].splitDistributions[j].date = new Date(payoutsEvents[i].timestamp);
      }
      payoutsEvents[i].distributedAmount /= 1000000000000000000;
      payoutsEvents[i].distributedAmountFiat = fiatPrice*payoutsEvents[i].distributedAmount;
      payoutsEvents[i].fee /= 1000000000000000000;
      payoutsEvents[i].feeFiat = fiatPrice*payoutsEvents[i].fee;
      payoutsEvents[i].beneficiaryDistributionAmount /= 1000000000000000000;
      payoutsEvents[i].beneficiaryDistributionAmountFiat = fiatPrice*payoutsEvents[i].beneficiaryDistributionAmount;
      payoutsEvents[i].date = new Date(payoutsEvents[i].timestamp).toLocaleString();
    }
    // Write CSVs to disk
    writecsv("./output/splits.csv", array2csv(payoutsEvents.map(el => el.splitDistributions).flat())); 
    payoutsEvents.forEach(el => delete el.splitDistributions);
    writecsv("./output/distributions.csv", array2csv(payoutsEvents))
  } else {
    // Use v1/1.1 subgraph schema
    payoutsEvents = (await execute(v1PayoutsDocument, {Id: Id}, {})).data.projects[0].tapEvents;
    // Formatting outputs and fetching fiat prices
    for(const i in payoutsEvents) {
      payoutsEvents[i].timestamp *= 1000;
      let fiatPrice = await prices.find(el => el[0] > payoutsEvents[i].timestamp)[1];
      for(const j in payoutsEvents[i].distributions) {
        payoutsEvents[i].distributions[j].modCut /= 1000000000000000000;
        payoutsEvents[i].distributions[j].modCutFiat = fiatPrice*payoutsEvents[i].distributions[j].modCut;
        payoutsEvents[i].distributions[j].date = new Date(payoutsEvents[i].timestamp).toLocaleString();
      }
      payoutsEvents[i].netTransferAmount /= 1000000000000000000;
      payoutsEvents[i].netTransferAmountFiat = fiatPrice*payoutsEvents[i].netTransferAmount;
      payoutsEvents[i].govFeeAmount /= 1000000000000000000;
      payoutsEvents[i].govFeeAmountFiat = fiatPrice*payoutsEvents[i].govFeeAmount;
      payoutsEvents[i].beneficiaryTransferAmount /= 1000000000000000000;
      payoutsEvents[i].beneficiaryTransferAmountFiat = fiatPrice*payoutsEvents[i].beneficiaryTransferAmount;
      payoutsEvents[i].date = new Date(payoutsEvents[i].timestamp).toLocaleString();
    }
    // Write CSVs to disk
    writecsv("./output/splits.csv", array2csv(payoutsEvents.map(el => el.distributions).flat())); 
    payoutsEvents.forEach(el => delete el.distributions);
    writecsv("./output/distributions.csv", array2csv(payoutsEvents))
  }
  console.log("\nComplete ✅");
}

function apifetch (url) {
  return new Promise(resolve => {
    require('https').get(url, (resp)=>{
      let data = '';
  
      // A chunk of data has been received.
      resp.on('data', (chunk) => {
        data += chunk;
      });
    
      // The whole response has been received. Resolve the result.
      resp.on('end', () => {
        resolve(JSON.parse(data));
      });
      
    }).on("error", (err) => {
        console.log("Error: " + err.message);
    });
  });
}

function question(query) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, });

  return new Promise(resolve => rl.question(query, answer => {
    rl.close();
    resolve(answer);
  }));
}

function array2csv (data) {
  let csv = data.map(row => Object.values(row));
  csv.unshift(Object.keys(data[0]));
  return csv.join('\n');
}

async function writecsv (fileName, data) {
  try {
    await writeFile(fileName, data, 'utf8'); 
  } catch (e) {
    console.error(e);
  }
}

main().catch((e) => console.error(e));
