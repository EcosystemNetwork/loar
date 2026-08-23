import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  formatEther,
  decodeEventLog,
  getAddress,
} from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { readFileSync } from 'fs';

const SCR = process.argv[2];
const APPLY = process.argv.includes('--apply');
const v = JSON.parse(readFileSync(SCR + '/lv.json', 'utf8'));
const brand = JSON.parse(readFileSync(SCR + '/brand.json', 'utf8'));

let pk = (v.PRIVATE_KEY || '').trim();
if (!pk) throw new Error('PRIVATE_KEY missing');
if (!pk.startsWith('0x')) pk = '0x' + pk;
const account = privateKeyToAccount(pk);

const RPC = 'https://rpc.sepolia.ethpandaops.io';
const UM = '0x5441273a432821d20C949768d5940960dEaC6C35';
const OWNER = getAddress('0x80baf7fffc430cdaced4f1d673f4138d6d493077'); // original Dragon Egg creator

const abi = parseAbi([
  'function createUniverse(string name,string imageURL,string description,uint8 nodeCreationOptions,uint8 nodeVisibilityOptions,address initialOwner) payable returns (uint256,address)',
  'event UniverseCreated(uint256 indexed id, address indexed universe, address indexed creator)',
]);

const pub = createPublicClient({ chain: sepolia, transport: http(RPC) });
const wallet = createWalletClient({ account, chain: sepolia, transport: http(RPC) });

const args = [brand.name, brand.image_url, brand.description, 0, 0, OWNER];
console.log(`  signer : ${account.address}`);
console.log(`  balance: ${formatEther(await pub.getBalance({ address: account.address }))} ETH`);
console.log(`  name   : ${brand.name}`);
console.log(`  owner  : ${OWNER}`);

// 1) simulate — catches reverts before spending anything
const { request, result } = await pub.simulateContract({
  address: UM,
  abi,
  functionName: 'createUniverse',
  args,
  account,
  value: 0n,
});
console.log(
  `  SIMULATION OK -> returns ${JSON.stringify(result, (k, x) => (typeof x === 'bigint' ? x.toString() : x))}`
);

if (!APPLY) {
  console.log('\n  dry run — re-run with --apply to send');
  process.exit(0);
}

// 2) execute
const hash = await wallet.writeContract(request);
console.log(`  tx sent: ${hash}`);
const rcpt = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
console.log(`  status : ${rcpt.status}  block ${rcpt.blockNumber}  gasUsed ${rcpt.gasUsed}`);

// 3) parse the new universe address from logs
let newAddr = null,
  newId = null;
for (const log of rcpt.logs) {
  try {
    const d = decodeEventLog({ abi, data: log.data, topics: log.topics });
    if (d.eventName === 'UniverseCreated') {
      newAddr = d.args.universe;
      newId = d.args.id;
      break;
    }
  } catch {}
}
console.log(`  NEW UNIVERSE: ${newAddr}  (onChainId ${newId})`);
if (newAddr) {
  const { writeFileSync } = await import('fs');
  writeFileSync(SCR + '/new_universe.txt', newAddr);
}
