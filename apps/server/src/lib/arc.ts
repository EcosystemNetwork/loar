/**
 * Arc — Circle's USDC-native L1, used as LOAR's agent settlement layer.
 *
 * Arc is EVM-compatible and uses USDC as its native gas asset (system contract
 * at 0x3600…0000). We use it for agent-to-agent nanopayments: one agent pays
 * another in USDC for a service (an LLM call, a render, a data lookup). This
 * backs the x402 paid-call rail (see x402.ts).
 *
 * Payments are sent by the platform signer (PRIVATE_KEY / KMS) on behalf of the
 * paying agent's owner — consistent with LOAR's custodial model. USDC transfers
 * go through the canonical ERC-20 interface so the amount math is unambiguous
 * (6 decimals), with gas paid in native USDC.
 *
 * Env:
 *   ARC_RPC_URL   — optional, defaults to the public testnet RPC
 *   (signing reuses PRIVATE_KEY / KMS via lib/signer)
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  defineChain,
  encodeFunctionData,
  erc20Abi,
  parseUnits,
  formatUnits,
  type Hex,
} from 'viem';
import { getSignerAccount } from './signer';

// ── Chain + token config ─────────────────────────────────────────────────────

export const ARC_TESTNET_ID = 5042002;
/** USDC system contract on Arc (also the native gas asset). */
export const ARC_USDC = '0x3600000000000000000000000000000000000000' as const;
export const USDC_DECIMALS = 6;

function arcRpcUrl(): string {
  return process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network';
}

export const arcTestnet = defineChain({
  id: ARC_TESTNET_ID,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: USDC_DECIMALS },
  rpcUrls: { default: { http: ['https://rpc.testnet.arc.network'] } },
  blockExplorers: { default: { name: 'Arcscan', url: 'https://testnet.arcscan.app' } },
  testnet: true,
});

export function isArcConfigured(): boolean {
  // Signing requires a platform key; reads work without one.
  return !!(process.env.PRIVATE_KEY || process.env.KMS_KEY_ID);
}

let _publicClient: ReturnType<typeof createPublicClient> | null = null;
function publicClient() {
  if (!_publicClient) {
    _publicClient = createPublicClient({
      chain: arcTestnet,
      transport: http(arcRpcUrl()),
    });
  }
  return _publicClient;
}

async function walletClient() {
  const account = await getSignerAccount();
  return createWalletClient({ account, chain: arcTestnet, transport: http(arcRpcUrl()) });
}

// ── Reads ─────────────────────────────────────────────────────────────────────

/** USDC balance (human string, 6 decimals) for an address on Arc. */
export async function getUsdcBalance(address: string): Promise<string> {
  const raw = await publicClient().readContract({
    address: ARC_USDC,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [address as Hex],
  });
  return formatUnits(raw as bigint, USDC_DECIMALS);
}

// ── Payment ─────────────────────────────────────────────────────────────────

export interface ArcPaymentResult {
  txHash: Hex;
  to: string;
  amountUsdc: string;
  amountRaw: string;
}

/**
 * Send `amountUsdc` (human string, e.g. "0.01") of USDC to `to` on Arc.
 * Used for agent-to-agent settlement.
 */
export async function payUsdc(args: { to: string; amountUsdc: string }): Promise<ArcPaymentResult> {
  if (!isArcConfigured()) {
    throw new Error('Arc signing not configured (set PRIVATE_KEY or KMS_KEY_ID).');
  }
  const amountRaw = parseUnits(args.amountUsdc, USDC_DECIMALS);
  if (amountRaw <= 0n) throw new Error('amount must be positive');

  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: 'transfer',
    args: [args.to as Hex, amountRaw],
  });

  const client = await walletClient();
  const account = await getSignerAccount();
  const txHash = await client.sendTransaction({
    account,
    chain: arcTestnet,
    to: ARC_USDC,
    data,
  });

  return { txHash, to: args.to, amountUsdc: args.amountUsdc, amountRaw: amountRaw.toString() };
}

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

/**
 * Verify that `txHash` is a confirmed Arc USDC transfer of at least `minUsdc`
 * to `payTo`. Used by the x402 facilitator to settle a paid request. Returns
 * the transferred amount (raw) on success, or null if it doesn't qualify.
 */
export async function verifyUsdcPayment(args: {
  txHash: string;
  payTo: string;
  minUsdc: string;
}): Promise<{ amountRaw: bigint } | null> {
  const minRaw = parseUnits(args.minUsdc, USDC_DECIMALS);
  let receipt;
  try {
    receipt = await publicClient().getTransactionReceipt({ hash: args.txHash as Hex });
  } catch {
    return null;
  }
  if (!receipt || receipt.status !== 'success') return null;

  const payToTopic = `0x${args.payTo.toLowerCase().replace(/^0x/, '').padStart(64, '0')}`;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== ARC_USDC.toLowerCase()) continue;
    if (log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC) continue;
    if (log.topics[2]?.toLowerCase() !== payToTopic) continue; // indexed `to`
    const amount = BigInt(log.data);
    if (amount >= minRaw) return { amountRaw: amount };
  }
  return null;
}

/** Explorer URL for an Arc tx. */
export function arcTxUrl(txHash: string): string {
  return `https://testnet.arcscan.app/tx/${txHash}`;
}
