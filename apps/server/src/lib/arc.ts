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
 * EIP-7708 system emitter for NATIVE USDC sends on Arc. A plain native transfer
 * (tx.value, like sending ETH) emits a Transfer log here — NOT on the 0x3600
 * ERC-20 contract — and its value uses 18 decimals (EVM precision), so it must
 * be divided by 10^12 to compare against the 6-decimal ERC-20 amount.
 */
const NATIVE_USDC_EMITTER = '0xfffffffffffffffffffffffffffffffffffffffe';
const NATIVE_TO_ERC20_SCALE = 10n ** 12n; // 18-dec native → 6-dec USDC

/**
 * Verify that `txHash` is a confirmed Arc USDC payment of at least `minUsdc`
 * to `payTo`, returning the transferred amount as 6-decimal raw USDC, or null.
 *
 * Handles BOTH ways USDC moves on Arc:
 *   - ERC-20 transfer() on 0x3600… → Transfer log there, 6 decimals.
 *   - native value send            → Transfer log on the EIP-7708 emitter
 *                                     (0xffff…fe), 18 decimals (÷10^12), plus a
 *                                     tx.to/tx.value fallback.
 */
export async function verifyUsdcPayment(args: {
  txHash: string;
  payTo: string;
  minUsdc: string;
}): Promise<{ amountRaw: bigint } | null> {
  const minRaw = parseUnits(args.minUsdc, USDC_DECIMALS); // 6-dec
  const pc = publicClient();
  let receipt;
  try {
    receipt = await pc.getTransactionReceipt({ hash: args.txHash as Hex });
  } catch {
    return null;
  }
  if (!receipt || receipt.status !== 'success') return null;

  const payToTopic = `0x${args.payTo.toLowerCase().replace(/^0x/, '').padStart(64, '0')}`;
  for (const log of receipt.logs) {
    if (log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC) continue;
    if (log.topics[2]?.toLowerCase() !== payToTopic) continue; // indexed `to`
    const addr = log.address.toLowerCase();
    let amount6: bigint;
    if (addr === ARC_USDC.toLowerCase()) {
      amount6 = BigInt(log.data); // already 6-dec
    } else if (addr === NATIVE_USDC_EMITTER) {
      amount6 = BigInt(log.data) / NATIVE_TO_ERC20_SCALE; // 18-dec → 6-dec
    } else {
      continue;
    }
    if (amount6 >= minRaw) return { amountRaw: amount6 };
  }

  // Native value-transfer fallback (no decodable log matched).
  try {
    const tx = await pc.getTransaction({ hash: args.txHash as Hex });
    if (tx?.to?.toLowerCase() === args.payTo.toLowerCase() && tx.value > 0n) {
      const amount6 = tx.value / NATIVE_TO_ERC20_SCALE;
      if (amount6 >= minRaw) return { amountRaw: amount6 };
    }
  } catch {
    /* ignore */
  }
  return null;
}

// ── EIP-3009 (transferWithAuthorization) — x402 canonical settlement ──────────

const EIP3009_ABI = [
  {
    name: 'transferWithAuthorization',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'authorizationState',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'authorizer', type: 'address' },
      { name: 'nonce', type: 'bytes32' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'name',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
  {
    name: 'version',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
] as const;

export interface Eip3009Authorization {
  from: string;
  to: string;
  value: string; // raw 6-dec USDC, decimal string
  validAfter: string; // unix seconds
  validBefore: string; // unix seconds
  nonce: string; // 0x + 64 hex
}

/** EIP-712 domain of the Arc USDC token (read on-chain once, then cached). */
let _domainCache: { name: string; version: string } | null = null;
export async function usdcDomain(): Promise<{
  name: string;
  version: string;
  chainId: number;
  verifyingContract: Hex;
}> {
  if (!_domainCache) {
    const pc = publicClient();
    const [name, version] = await Promise.all([
      pc.readContract({ address: ARC_USDC, abi: EIP3009_ABI, functionName: 'name' }),
      pc.readContract({ address: ARC_USDC, abi: EIP3009_ABI, functionName: 'version' }),
    ]);
    _domainCache = { name: name as string, version: version as string };
  }
  return {
    ...(_domainCache as { name: string; version: string }),
    chainId: ARC_TESTNET_ID,
    verifyingContract: ARC_USDC,
  };
}

/** Whether an EIP-3009 authorization nonce has already been used/cancelled. */
export async function isAuthorizationUsed(from: string, nonce: string): Promise<boolean> {
  const used = await publicClient().readContract({
    address: ARC_USDC,
    abi: EIP3009_ABI,
    functionName: 'authorizationState',
    args: [from as Hex, nonce as Hex],
  });
  return used as boolean;
}

/**
 * Settle an x402 payment: the facilitator (this server, paying gas) broadcasts
 * the client's signed EIP-3009 authorization. The client never sent a tx.
 */
export async function settleTransferWithAuthorization(
  auth: Eip3009Authorization,
  signature: string
): Promise<Hex> {
  if (!isArcConfigured()) {
    throw new Error('Arc signing not configured (set PRIVATE_KEY or KMS_KEY_ID).');
  }
  const client = await walletClient();
  const account = await getSignerAccount();
  const data = encodeFunctionData({
    abi: EIP3009_ABI,
    functionName: 'transferWithAuthorization',
    args: [
      auth.from as Hex,
      auth.to as Hex,
      BigInt(auth.value),
      BigInt(auth.validAfter),
      BigInt(auth.validBefore),
      auth.nonce as Hex,
      signature as Hex,
    ],
  });
  return client.sendTransaction({ account, chain: arcTestnet, to: ARC_USDC, data });
}

/** Explorer URL for an Arc tx. */
export function arcTxUrl(txHash: string): string {
  return `https://testnet.arcscan.app/tx/${txHash}`;
}
