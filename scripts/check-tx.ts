import { createPublicClient, http, decodeEventLog } from 'viem';
import { sepolia } from 'viem/chains';
import { readFileSync } from 'fs';
import path from 'path';

const artifact = JSON.parse(
  readFileSync(
    path.resolve(process.cwd(), 'apps/contracts/out/UniverseManager.sol/UniverseManager.json'),
    'utf-8'
  )
);
const abi = artifact.abi;

const client = createPublicClient({ chain: sepolia, transport: http('https://rpc.sepolia.org') });

async function main() {
  const receipt = await client.getTransactionReceipt({
    hash: '0xe983fd99b11fdb48d5bf5ee889aa9083d94d1867f23a9947e6dc7a3b93be2bd5',
  });
  console.log('Status:', receipt.status);
  console.log('Block:', receipt.blockNumber.toString());
  console.log('Gas used:', receipt.gasUsed.toString());

  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics });
      console.log(
        'Event:',
        decoded.eventName,
        JSON.stringify(decoded.args, (k, v) => (typeof v === 'bigint' ? v.toString() : v))
      );
    } catch {}
  }
}

main().catch(console.error);
