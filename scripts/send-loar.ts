// One-shot: send $LOAR from the deployer EOA (PRIVATE_KEY in root .env) to a recipient
// on both Ethereum Sepolia (11155111) and Base Sepolia (84532).
//
// Usage:
//   pnpm tsx scripts/send-loar.ts
//
// Env vars consumed (all from root .env):
//   PRIVATE_KEY             — deployer EOA private key (hex, 0x-prefixed or not)
//   RPC_URL                 — Ethereum Sepolia RPC
//   RPC_URL_BASE_SEPOLIA    — Base Sepolia RPC

import { config as loadEnv } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
loadEnv({ path: resolve(__dirname, '..', '.env') });

import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  formatUnits,
  getAddress,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia, baseSepolia } from 'viem/chains';

const RECIPIENT: Address = getAddress('0x7180560dF50c671b99F8B8d102F3439203a8F761');
const AMOUNT_WHOLE = 5000n;

const LOAR_SEPOLIA: Address = getAddress('0xAEC35cAAE68de337711E3bc06b51aaAa5551b63F');
const LOAR_BASE_SEPOLIA: Address = getAddress('0x1Ff9e293D6D4D564B99CFe57fe61f4DCdac4b5D5');

const erc20Abi = [
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint8' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'paused',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
] as const;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} not set in .env`);
  return v;
}

function normalizeKey(raw: string): Hex {
  const trimmed = raw.trim();
  return (trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`) as Hex;
}

async function sendOnChain(opts: {
  label: string;
  chain: typeof sepolia | typeof baseSepolia;
  rpcUrl: string;
  token: Address;
  pk: Hex;
}) {
  const { label, chain, rpcUrl, token, pk } = opts;
  console.log(`\n=== ${label} (chainId ${chain.id}) ===`);

  const account = privateKeyToAccount(pk);
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });

  console.log(`Sender:    ${account.address}`);
  console.log(`Token:     ${token}`);
  console.log(`Recipient: ${RECIPIENT}`);

  const [decimals, paused, senderBal, gasBal] = await Promise.all([
    publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'decimals' }),
    publicClient
      .readContract({ address: token, abi: erc20Abi, functionName: 'paused' })
      .catch(() => false as boolean),
    publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [account.address],
    }),
    publicClient.getBalance({ address: account.address }),
  ]);

  const amount = parseUnits(AMOUNT_WHOLE.toString(), decimals);
  console.log(`Decimals:  ${decimals}`);
  console.log(`Paused:    ${paused}`);
  console.log(`Sender $LOAR balance: ${formatUnits(senderBal, decimals)}`);
  console.log(`Sender native gas:    ${formatUnits(gasBal, 18)} ETH`);
  console.log(`Amount to send:       ${AMOUNT_WHOLE.toString()} $LOAR (${amount.toString()} wei)`);

  if (paused) throw new Error(`${label}: token is paused, aborting`);
  if (senderBal < amount) {
    throw new Error(
      `${label}: insufficient $LOAR. have=${formatUnits(senderBal, decimals)} need=${AMOUNT_WHOLE.toString()}`
    );
  }
  if (gasBal === 0n) throw new Error(`${label}: sender has 0 ETH for gas`);

  const { request } = await publicClient.simulateContract({
    account,
    address: token,
    abi: erc20Abi,
    functionName: 'transfer',
    args: [RECIPIENT, amount],
  });

  const hash = await walletClient.writeContract(request);
  console.log(`Tx sent:   ${hash}`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`Status:    ${receipt.status}`);
  console.log(`Block:     ${receipt.blockNumber}`);
  console.log(`Gas used:  ${receipt.gasUsed.toString()}`);

  if (receipt.status !== 'success') {
    throw new Error(`${label}: transfer failed, receipt status=${receipt.status}`);
  }

  const newBal = await publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [RECIPIENT],
  });
  console.log(`Recipient new balance: ${formatUnits(newBal, decimals)} $LOAR`);
}

async function main() {
  const pk = normalizeKey(requireEnv('PRIVATE_KEY'));
  const ethRpc = requireEnv('RPC_URL');
  const baseRpc = requireEnv('RPC_URL_BASE_SEPOLIA');

  await sendOnChain({
    label: 'Ethereum Sepolia',
    chain: sepolia,
    rpcUrl: ethRpc,
    token: LOAR_SEPOLIA,
    pk,
  });

  await sendOnChain({
    label: 'Base Sepolia',
    chain: baseSepolia,
    rpcUrl: baseRpc,
    token: LOAR_BASE_SEPOLIA,
    pk,
  });

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('\nFAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
