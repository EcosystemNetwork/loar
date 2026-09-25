/**
 * Launchpad read model for clients that don't run their own indexer queries
 * (mobile). Pure: takes raw indexer rows, returns display rows. Prices use the
 * exact bonding-curve maths (see bondingSpotPrice) — the contract's own price
 * field truncates to 0 — and the Uniswap pool once graduated.
 */
import { bondingSpotPrice, priceFromSqrtX96 } from './token-price';

const SQRT_PRICE_X96_AT_TICK_0 = '79228162514264337593543950336';

export interface RawToken {
  id: string;
  name: string;
  symbol: string;
  imageURL?: string | null;
  metadata?: string | null;
  deployer: string;
  poolId: string;
  createdAt: number;
}
export interface RawCurve {
  id: string;
  tokenAddress: string;
  graduationEth: string;
  graduated: boolean;
  tradingStatus: string;
  tokensSold: string;
  ethRaised: string;
}
export interface RawHolder {
  tokenAddress: string;
  holderAddress: string;
  balance: string;
}
export interface RawPool {
  poolId: string;
  currency0: string;
  sqrtPriceX96: string | null;
}

export type LaunchStage = 'bonding' | 'graduating' | 'graduated' | 'halted';

export interface LaunchpadRow {
  id: string;
  name: string;
  symbol: string;
  imageUrl: string | null;
  description: string;
  socials: { website?: string; twitter?: string; telegram?: string };
  deployer: string;
  createdAt: number;
  stage: LaunchStage;
  /** ETH per token, or null before the first trade. */
  price: number | null;
  /** ETH; circulating supply × price. */
  marketCap: number | null;
  /** 0..100; 100 once graduated. */
  graduationPct: number;
  holderCount: number;
  isKing: boolean;
}

const lc = (s: string) => s.toLowerCase();

function safeHttps(raw: string | null | undefined, hosts?: string[]): string | undefined {
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.username || u.password) return undefined;
    const h = u.hostname.toLowerCase().replace(/^www\./, '');
    if (hosts && !hosts.includes(h)) return undefined;
    return u.toString();
  } catch {
    return undefined;
  }
}

export function safeImageUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (raw.startsWith('ipfs://')) {
    const p = raw.slice(7).replace(/^ipfs\//, '');
    return /^[A-Za-z0-9._/-]+$/.test(p) ? `https://ipfs.io/ipfs/${p}` : null;
  }
  return safeHttps(raw) ?? null;
}

/** Description + validated socials from on-chain metadata (JSON, or legacy plain text). */
export function parseMetadata(metadata: string | null | undefined): {
  description: string;
  socials: LaunchpadRow['socials'];
} {
  const raw = (metadata ?? '').trim();
  if (raw.startsWith('{')) {
    try {
      const o = JSON.parse(raw) as { description?: unknown; socials?: Record<string, unknown> };
      const s = o.socials ?? {};
      const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
      return {
        description: typeof o.description === 'string' ? o.description : '',
        socials: {
          website: safeHttps(str(s.website)),
          twitter: safeHttps(str(s.twitter), ['x.com', 'twitter.com']),
          telegram: safeHttps(str(s.telegram), ['t.me', 'telegram.me']),
        },
      };
    } catch {
      /* plain text */
    }
  }
  return { description: raw, socials: {} };
}

export function buildLaunchpadRows(input: {
  tokens: RawToken[];
  curves: RawCurve[];
  holders: RawHolder[];
  pools: RawPool[];
}): LaunchpadRow[] {
  const curveByToken = new Map(input.curves.map((c) => [lc(c.tokenAddress), c]));
  const curveAddrs = new Set(input.curves.map((c) => lc(c.id)));
  const poolById = new Map(input.pools.map((p) => [lc(p.poolId), p]));
  const holderCount = new Map<string, number>();
  for (const h of input.holders) {
    if (!h.balance || h.balance === '0') continue; // sold out
    if (curveAddrs.has(lc(h.holderAddress))) continue; // the curve escrows unsold supply
    const k = lc(h.tokenAddress);
    holderCount.set(k, (holderCount.get(k) ?? 0) + 1);
  }

  const rows = input.tokens.map((t): LaunchpadRow => {
    const c = curveByToken.get(lc(t.id));
    const graduated = !!c && (c.graduated || c.tradingStatus === 'graduated');
    const halted = !!c && !graduated && c.tradingStatus === 'halted';

    let graduationPct = 100;
    if (c && !graduated) {
      try {
        const target = BigInt(c.graduationEth);
        graduationPct =
          target > 0n ? Math.min(Number((BigInt(c.ethRaised) * 10000n) / target) / 100, 100) : 0;
      } catch {
        graduationPct = 0;
      }
    }
    const stage: LaunchStage = halted
      ? 'halted'
      : graduated || !c
        ? 'graduated'
        : graduationPct >= 75
          ? 'graduating'
          : 'bonding';

    let price: number | null = null;
    let circulating = 1_000_000_000; // whole tokens; fully distributed after graduation
    if (c && !graduated) {
      price = bondingSpotPrice(c.ethRaised, c.tokensSold);
      try {
        circulating = Number(BigInt(c.tokensSold) / 10n ** 12n) / 1e6;
      } catch {
        circulating = 0;
      }
    } else {
      const pool = poolById.get(lc(t.poolId));
      if (pool?.sqrtPriceX96 && pool.sqrtPriceX96 !== SQRT_PRICE_X96_AT_TICK_0) {
        const raw = priceFromSqrtX96(pool.sqrtPriceX96);
        if (raw != null) price = lc(pool.currency0) === lc(t.id) ? raw : 1 / raw;
      }
    }
    const meta = parseMetadata(t.metadata);
    return {
      id: t.id,
      name: t.name,
      symbol: t.symbol,
      imageUrl: safeImageUrl(t.imageURL),
      description: meta.description,
      socials: meta.socials,
      deployer: t.deployer,
      createdAt: t.createdAt,
      stage,
      price,
      marketCap: price != null && price > 0 ? price * circulating : null,
      graduationPct,
      holderCount: holderCount.get(lc(t.id)) ?? 0,
      isKing: false,
    };
  });

  // King of the Hill: top market cap still on the curve (mirrors the web launchpad).
  let king: LaunchpadRow | null = null;
  for (const r of rows) {
    if (r.stage !== 'bonding' && r.stage !== 'graduating') continue;
    if (!(r.marketCap != null && r.marketCap > 0)) continue;
    if (
      !king ||
      r.marketCap > (king.marketCap ?? 0) ||
      (r.marketCap === king.marketCap && r.graduationPct > king.graduationPct)
    )
      king = r;
  }
  if (king) king.isKing = true;
  return rows;
}
