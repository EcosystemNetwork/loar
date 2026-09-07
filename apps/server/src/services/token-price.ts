/**
 * Server-side token price lookup.
 *
 * Reads the Firestore indexer mirror (`indexer_pools` / `indexer_bondingCurves`)
 * written by `apps/event-listener` and returns the current ETH-per-token quote.
 * Mirrors the client math in `apps/web/src/hooks/useTokens.ts`.
 *
 * Returns `null` when the token has never traded (fresh pool at tick 0) or the
 * mirror has no record for it — callers should treat null as "no signal".
 */
import { db } from '../lib/firebase';

const SQRT_PRICE_X96_AT_TICK_0 = '79228162514264337593543950336';
const POOLS = 'indexer_pools';
const TOKENS = 'indexer_tokens';
const CURVES = 'indexer_bondingCurves';

const scopedId = (chainId: number, id: string) => `${chainId}:${id.toLowerCase()}`;

/** price = (sqrtPriceX96 / 2^96)^2, kept in bigint until the final ratio. */
function priceFromSqrtX96(sqrtPriceX96: string): number | null {
  try {
    const sqrtP = BigInt(sqrtPriceX96);
    if (sqrtP === 0n) return null;
    const SCALE = 10n ** 18n;
    const Q192 = 1n << 192n;
    const scaled = (sqrtP * sqrtP * SCALE) / Q192;
    const v = Number(scaled) / 1e18;
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

function weiToNumber(raw: string | bigint, decimals = 18): number {
  const wei = typeof raw === 'bigint' ? raw : BigInt(raw || '0');
  if (wei === 0n) return 0;
  const neg = wei < 0n;
  const abs = neg ? -wei : wei;
  const divisor = 10n ** BigInt(decimals);
  const whole = abs / divisor;
  const rem = abs - whole * divisor;
  const out = Number(whole) + Number(rem) / Number(divisor);
  return neg ? -out : out;
}

export interface TokenPriceResult {
  tokenAddress: string;
  priceEth: number;
  source: 'pool' | 'bondingCurve';
}

/**
 * Current ETH-per-token quote for one token, or null when unavailable.
 * `chainId` defaults to Sepolia (11155111) to match the rest of the server.
 */
export async function getTokenPriceEth(
  tokenAddress: string,
  chainId = 11155111
): Promise<number | null> {
  if (!db) return null;
  const addr = tokenAddress.toLowerCase();

  // Bonding-curve tokens: the curve's lastPrice is already ETH/token in wei.
  try {
    const curveSnap = await db.collection(CURVES).where('tokenAddress', '==', addr).limit(1).get();
    const curve = curveSnap.docs[0]?.data();
    if (curve && !curve.graduated && curve.lastPrice && curve.lastPrice !== '0') {
      const p = weiToNumber(curve.lastPrice as string, 18);
      if (p > 0) return p;
    }
  } catch {
    /* fall through to pool */
  }

  // Post-graduation (or curve had no price): derive from the pool sqrtPrice.
  try {
    const tokenDoc = await db.collection(TOKENS).doc(scopedId(chainId, addr)).get();
    const poolId = tokenDoc.data()?.poolId as string | undefined;
    if (!poolId) return null;
    const poolDoc = await db.collection(POOLS).doc(scopedId(chainId, poolId)).get();
    const pool = poolDoc.data();
    if (!pool?.sqrtPriceX96) return null;
    if (pool.sqrtPriceX96 === SQRT_PRICE_X96_AT_TICK_0) return null;
    const raw = priceFromSqrtX96(pool.sqrtPriceX96 as string);
    if (raw == null) return null;
    const tokenIsCurrency0 = String(pool.currency0).toLowerCase() === addr;
    const price = tokenIsCurrency0 ? raw : 1 / raw;
    return Number.isFinite(price) && price > 0 ? price : null;
  } catch {
    return null;
  }
}

/** Batch helper — resolves many tokens in parallel, skipping nulls. */
export async function getTokenPrices(
  tokenAddresses: string[],
  chainId = 11155111
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  await Promise.all(
    Array.from(new Set(tokenAddresses.map((a) => a.toLowerCase()))).map(async (addr) => {
      const p = await getTokenPriceEth(addr, chainId);
      if (p != null) out.set(addr, p);
    })
  );
  return out;
}
