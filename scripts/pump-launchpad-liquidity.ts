/**
 * Pump random testnet liquidity into launchpad bonding-curve tokens.
 *
 * Queries the Ponder indexer for every active (not-graduated, not-halted)
 * bonding curve, then executes N random buys against them using a funded
 * testnet wallet. Each buy calls `BondingCurve.buy(minTokensOut=0, deadline)`
 * with a small, jittered ETH amount so the launchpad feels alive without
 * melting a lot of testnet ETH.
 *
 * SAFETY: defaults to DRY RUN. Set CONFIRM_SEND=1 to actually broadcast.
 *
 * Env:
 *   PRIVATE_KEY       — signer (required; treated like testnet key)
 *   CHAIN             — 'sepolia' | 'base-sepolia' (default: base-sepolia)
 *   RPC_URL           — override chain RPC
 *   PONDER_URL        — indexer GraphQL endpoint (default: http://localhost:42069)
 *   N_TRADES          — total buys to execute (default: 20)
 *   MIN_ETH           — lower bound per trade in ETH (default: 0.0005)
 *   MAX_ETH           — upper bound per trade in ETH (default: 0.003)
 *   JITTER_MS_MAX     — max random delay between trades (default: 4000)
 *   TOKEN_FILTER      — comma-separated token addresses to restrict to
 *   CONFIRM_SEND      — '1' to actually send transactions (default: dry-run)
 *
 * Usage:
 *   pnpm tsx scripts/pump-launchpad-liquidity.ts                # dry-run
 *   CONFIRM_SEND=1 pnpm tsx scripts/pump-launchpad-liquidity.ts # live
 */
import dotenv from 'dotenv';
import path from 'path';
import {
  createPublicClient,
  createWalletClient,
  http,
  formatEther,
  parseEther,
  parseAbi,
  getAddress,
  type Address,
} from 'viem';
import { sepolia, baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// ── Config ────────────────────────────────────────────────────────────────

const rawKey = process.env.PRIVATE_KEY ?? '';
if (!rawKey) {
  console.error('Missing PRIVATE_KEY in env');
  process.exit(1);
}
const PRIVATE_KEY = (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as `0x${string}`;

const CHAIN_NAME = (process.env.CHAIN ?? 'base-sepolia').toLowerCase();
const CHAIN_MAP = {
  sepolia: { chain: sepolia, defaultRpc: 'https://ethereum-sepolia-rpc.publicnode.com' },
  'base-sepolia': { chain: baseSepolia, defaultRpc: 'https://sepolia.base.org' },
} as const;
const chainCfg = CHAIN_MAP[CHAIN_NAME as keyof typeof CHAIN_MAP];
if (!chainCfg) {
  console.error(`Unsupported CHAIN=${CHAIN_NAME}. Use 'sepolia' or 'base-sepolia'.`);
  process.exit(1);
}
// RPC_URL env default is Sepolia (from .env). If running against Base Sepolia,
// fall back to chain default unless the user explicitly points RPC_URL at Base.
const envRpc = process.env.RPC_URL;
const RPC_URL =
  CHAIN_NAME === 'sepolia'
    ? (envRpc ?? chainCfg.defaultRpc)
    : (process.env.BASE_SEPOLIA_RPC_URL ?? chainCfg.defaultRpc);

// Indexer URL is chain-specific — .env exposes separate deployments.
const PONDER_URL =
  process.env.PONDER_URL ??
  (CHAIN_NAME === 'base-sepolia'
    ? process.env.VITE_PONDER_URL_BASE_SEPOLIA
    : process.env.VITE_PONDER_URL) ??
  'http://localhost:42069';
const N_TRADES = Number(process.env.N_TRADES ?? '20');
const MIN_ETH = Number(process.env.MIN_ETH ?? '0.0005');
const MAX_ETH = Number(process.env.MAX_ETH ?? '0.003');
const JITTER_MS_MAX = Number(process.env.JITTER_MS_MAX ?? '4000');
const CONFIRM_SEND = process.env.CONFIRM_SEND === '1';

const tokenFilter = (process.env.TOKEN_FILTER ?? '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

if (!Number.isFinite(N_TRADES) || N_TRADES <= 0) {
  console.error('N_TRADES must be a positive number');
  process.exit(1);
}
if (MIN_ETH <= 0 || MAX_ETH < MIN_ETH) {
  console.error('MIN_ETH and MAX_ETH must be positive with MAX_ETH >= MIN_ETH');
  process.exit(1);
}

// ── Clients ───────────────────────────────────────────────────────────────

const account = privateKeyToAccount(PRIVATE_KEY);
const publicClient = createPublicClient({ chain: chainCfg.chain, transport: http(RPC_URL) });
const walletClient = createWalletClient({
  account,
  chain: chainCfg.chain,
  transport: http(RPC_URL),
});

// Two signatures live in the wild:
//  - OLD (pre-audit, e.g. $EGG on Base Sepolia): buy(uint256 minTokensOut)
//  - NEW (post CURVE-01 fix): buy(uint256 minTokensOut, uint256 deadline)
// The pump script probes both and uses whichever the deployed selector supports.
const BONDING_CURVE_ABI_V1 = parseAbi(['function buy(uint256 minTokensOut) external payable']);
const BONDING_CURVE_ABI_V2 = parseAbi([
  'function buy(uint256 minTokensOut, uint256 deadline) external payable',
]);
const BONDING_CURVE_READ_ABI = parseAbi([
  'function tokensSold() view returns (uint256)',
  'function ethRaised() view returns (uint256)',
  'function graduated() view returns (bool)',
  'function tradingHalted() view returns (bool)',
]);

// ── Indexer ───────────────────────────────────────────────────────────────

type BuyAbiVersion = 'v1' | 'v2';

interface ActiveCurve {
  curveAddress: Address;
  tokenAddress: Address;
  tokenName: string;
  tokenSymbol: string;
  universeId: number;
  graduationEth: bigint;
  ethRaised: bigint;
  buyAbi: BuyAbiVersion;
}

async function fetchActiveCurves(): Promise<ActiveCurve[]> {
  // The deployed indexer schema doesn't always expose ethRaised/tradingStatus
  // (those fields exist locally but haven't been migrated). Pull the list of
  // curves + static fields from the indexer, then read live state from chain.
  const query = `
    query {
      bondingCurves(limit: 200) {
        items { id tokenAddress universeId graduationEth graduated }
      }
      tokens(limit: 200) {
        items { id name symbol }
      }
    }
  `;
  const res = await fetch(`${PONDER_URL}/graphql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    throw new Error(`Indexer fetch failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as {
    data?: {
      bondingCurves?: {
        items: {
          id: string;
          tokenAddress: string;
          universeId: number;
          graduationEth: string;
          graduated: boolean;
        }[];
      };
      tokens?: { items: { id: string; name: string; symbol: string }[] };
    };
    errors?: unknown;
  };
  if (json.errors) {
    throw new Error(`Indexer GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
  const tokenInfo = new Map<string, { name: string; symbol: string }>();
  for (const t of json.data?.tokens?.items ?? []) {
    tokenInfo.set(t.id.toLowerCase(), { name: t.name, symbol: t.symbol });
  }

  const candidates = (json.data?.bondingCurves?.items ?? [])
    .filter((c) => !c.graduated)
    .filter((c) => {
      if (!tokenFilter.length) return true;
      return tokenFilter.includes(c.tokenAddress.toLowerCase());
    });

  if (candidates.length === 0) return [];

  // Read live state per curve. Sequential is fine for ~tens of curves; if
  // this ever gets slow, swap in a multicall.
  const out: ActiveCurve[] = [];
  for (const c of candidates) {
    const curveAddress = getAddress(c.id) as Address;
    const tokenAddress = getAddress(c.tokenAddress) as Address;
    const info = tokenInfo.get(tokenAddress.toLowerCase()) ?? {
      name: 'Unknown',
      symbol: '???',
    };
    try {
      const [graduated, halted, ethRaised] = await Promise.all([
        publicClient.readContract({
          address: curveAddress,
          abi: BONDING_CURVE_READ_ABI,
          functionName: 'graduated',
        }) as Promise<boolean>,
        publicClient.readContract({
          address: curveAddress,
          abi: BONDING_CURVE_READ_ABI,
          functionName: 'tradingHalted',
        }) as Promise<boolean>,
        publicClient.readContract({
          address: curveAddress,
          abi: BONDING_CURVE_READ_ABI,
          functionName: 'ethRaised',
        }) as Promise<bigint>,
      ]);
      if (graduated || halted) continue;

      // Detect which buy() ABI is deployed by sniffing selectors in bytecode.
      //  - 0xd96a094a = buy(uint256)
      //  - 0xd6febde8 = buy(uint256,uint256)
      const code = (await publicClient.getCode({ address: curveAddress })) ?? '0x';
      const lower = code.toLowerCase();
      const buyAbi: BuyAbiVersion = lower.includes('d6febde8')
        ? 'v2'
        : lower.includes('d96a094a')
          ? 'v1'
          : 'v2'; // default to current source if unknown

      out.push({
        curveAddress,
        tokenAddress,
        tokenName: info.name,
        tokenSymbol: info.symbol,
        universeId: c.universeId,
        graduationEth: BigInt(c.graduationEth),
        ethRaised,
        buyAbi,
      });
    } catch (err: any) {
      console.warn(
        `  skipping ${truncate(curveAddress)} (${info.symbol}): ${err?.shortMessage ?? err?.message ?? err}`
      );
    }
  }
  return out;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function randomFloat(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randomInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function pick<T>(arr: T[]): T {
  return arr[randomInt(0, arr.length - 1)]!;
}

async function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

function truncate(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

// ── Plan ──────────────────────────────────────────────────────────────────

interface PlannedTrade {
  idx: number;
  curve: ActiveCurve;
  ethValue: bigint;
  ethFloat: number;
}

function planTrades(curves: ActiveCurve[]): PlannedTrade[] {
  const plan: PlannedTrade[] = [];
  for (let i = 0; i < N_TRADES; i++) {
    const curve = pick(curves);
    const ethFloat = randomFloat(MIN_ETH, MAX_ETH);
    // Round to 6 decimals to keep it legible; parse wei precisely.
    const rounded = Number(ethFloat.toFixed(6));
    const ethValue = parseEther(rounded.toString());

    // Don't push a single buy past the remaining-to-graduation amount — it'd
    // all either graduate or get refunded. Cap at 90% of remaining.
    const remaining = curve.graduationEth - curve.ethRaised;
    const cap = (remaining * 9n) / 10n;
    plan.push({
      idx: i,
      curve,
      ethValue: ethValue < cap ? ethValue : cap,
      ethFloat: Number(formatEther(ethValue < cap ? ethValue : cap)),
    });
  }
  return plan;
}

// ── Execute ───────────────────────────────────────────────────────────────

async function executeTrade(trade: PlannedTrade): Promise<void> {
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60); // 20 min
  try {
    const hash = await walletClient.writeContract({
      address: trade.curve.curveAddress,
      abi: BONDING_CURVE_READ_ABI,
      functionName: 'buy',
      args: [0n, deadline],
      value: trade.ethValue,
    });
    console.log(
      `  [${String(trade.idx + 1).padStart(3)}] BUY $${trade.curve.tokenSymbol.padEnd(6)} ` +
        `${trade.ethFloat.toFixed(6)} ETH  tx=${truncate(hash)}`
    );
  } catch (err: any) {
    const msg = err?.shortMessage ?? err?.message ?? String(err);
    console.error(
      `  [${String(trade.idx + 1).padStart(3)}] FAIL $${trade.curve.tokenSymbol.padEnd(6)} ` +
        `${trade.ethFloat.toFixed(6)} ETH — ${msg.slice(0, 120)}`
    );
  }
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('━━━ Launchpad Liquidity Pump ━━━');
  console.log(`Chain          : ${CHAIN_NAME} (id=${chainCfg.chain.id})`);
  console.log(`RPC            : ${RPC_URL}`);
  console.log(`Indexer        : ${PONDER_URL}`);
  console.log(`Signer         : ${account.address}`);
  console.log(`Trades         : ${N_TRADES}`);
  console.log(`Per-trade ETH  : ${MIN_ETH} – ${MAX_ETH}`);
  console.log(`Mode           : ${CONFIRM_SEND ? 'LIVE (CONFIRM_SEND=1)' : 'DRY RUN'}`);
  if (tokenFilter.length) {
    console.log(`Token filter   : ${tokenFilter.join(', ')}`);
  }
  console.log('');

  // Balance
  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`Wallet balance : ${formatEther(balance)} ETH`);
  if (balance === 0n) {
    console.error('Wallet has zero balance on this chain. Top it up first.');
    process.exit(1);
  }

  // Curves
  const curves = await fetchActiveCurves();
  console.log(`Active curves  : ${curves.length}`);
  if (curves.length === 0) {
    console.error('No active bonding curves to pump into. Exiting.');
    process.exit(1);
  }
  console.log('');
  console.log('Eligible tokens:');
  for (const c of curves) {
    const raised = Number(formatEther(c.ethRaised));
    const target = Number(formatEther(c.graduationEth));
    const pct = target > 0 ? ((raised / target) * 100).toFixed(1) : '0.0';
    console.log(
      `  - $${c.tokenSymbol.padEnd(6)} ${truncate(c.tokenAddress)} ` +
        `${raised.toFixed(4)}/${target.toFixed(2)} ETH (${pct}%)  universe=${c.universeId}`
    );
  }
  console.log('');

  // Plan
  const plan = planTrades(curves);
  let totalPlanned = 0n;
  for (const t of plan) totalPlanned += t.ethValue;
  const gasBuffer = (parseEther('0.005') * BigInt(N_TRADES)) / 10n; // rough
  const totalWithGas = totalPlanned + gasBuffer;

  console.log(`Planned spend  : ~${formatEther(totalPlanned)} ETH (+gas buffer)`);
  console.log(`Total w/ gas   : ~${formatEther(totalWithGas)} ETH`);
  if (balance < totalWithGas) {
    console.error(
      `Wallet balance ${formatEther(balance)} ETH < planned ${formatEther(totalWithGas)} ETH. Top up or lower N_TRADES/MAX_ETH.`
    );
    process.exit(1);
  }
  console.log('');

  if (!CONFIRM_SEND) {
    console.log('DRY RUN — re-run with CONFIRM_SEND=1 to broadcast these trades.');
    console.log('Plan preview (first 10):');
    for (const t of plan.slice(0, 10)) {
      console.log(
        `  [${String(t.idx + 1).padStart(3)}] BUY $${t.curve.tokenSymbol.padEnd(6)} ` +
          `${t.ethFloat.toFixed(6)} ETH → ${truncate(t.curve.curveAddress)}`
      );
    }
    return;
  }

  // Execute
  console.log('Broadcasting…');
  for (const trade of plan) {
    await executeTrade(trade);
    await sleep(randomInt(500, JITTER_MS_MAX));
  }
  console.log('');
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
