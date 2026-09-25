/**
 * Holder forensics — sniper / bundle detection and bubble-map layout. Pure.
 *
 * This is *detection*, not prevention: it can't stop anyone from buying, it tells
 * traders who did. Inputs come from indexed ERC-20 transfers.
 *
 *  • Launch block  = block of the earliest transfer (the mint/allocation).
 *    Recipients paid out in that block are launch allocations (creator, treasury…),
 *    never snipers.
 *  • Sniper        = wallet whose FIRST inbound transfer landed within
 *    `maxBlocks` blocks *after* the launch block.
 *  • Bundle        = 3+ distinct wallets whose first inbound transfer is in the
 *    same block after launch (one actor spreading buys over many wallets).
 */

export interface TransferLite {
  from: string;
  to: string;
  blockNumber: number;
  timestamp: number;
}

export type HolderRole = 'creator' | 'contract' | 'sniper' | 'bundle' | 'holder';

const ZERO = '0x0000000000000000000000000000000000000000';
const lc = (s: string) => s.toLowerCase();

export interface ForensicsResult {
  launchBlock: number | null;
  snipers: Set<string>;
  bundled: Set<string>;
}

export function detectSnipersAndBundles(
  transfers: TransferLite[],
  opts: { maxBlocks?: number; exclude?: string[]; minBundle?: number } = {}
): ForensicsResult {
  const maxBlocks = opts.maxBlocks ?? 5;
  const minBundle = opts.minBundle ?? 3;
  const exclude = new Set([ZERO, ...(opts.exclude ?? []).map(lc)]);
  const empty: ForensicsResult = { launchBlock: null, snipers: new Set(), bundled: new Set() };
  if (transfers.length === 0) return empty;

  const launchBlock = transfers.reduce((m, t) => Math.min(m, t.blockNumber), Infinity);
  if (!Number.isFinite(launchBlock)) return empty;

  // First block in which each wallet received tokens.
  const firstInbound = new Map<string, number>();
  for (const t of transfers) {
    const to = lc(t.to);
    if (exclude.has(to)) continue;
    const prev = firstInbound.get(to);
    if (prev === undefined || t.blockNumber < prev) firstInbound.set(to, t.blockNumber);
  }

  const snipers = new Set<string>();
  const byBlock = new Map<number, string[]>();
  for (const [addr, block] of firstInbound) {
    if (block <= launchBlock) continue; // launch allocation
    if (block - launchBlock <= maxBlocks) snipers.add(addr);
    const list = byBlock.get(block) ?? [];
    list.push(addr);
    byBlock.set(block, list);
  }
  const bundled = new Set<string>();
  for (const [block, addrs] of byBlock) {
    if (block - launchBlock <= maxBlocks && addrs.length >= minBundle) {
      for (const a of addrs) bundled.add(a);
    }
  }
  return { launchBlock, snipers, bundled };
}

/** Share of `total` held by the addresses in `set`, from a balance lookup. Returns 0..100. */
export function supplyShare(
  set: Set<string>,
  balances: { address: string; balance: bigint }[],
  total: bigint
): number {
  if (total <= 0n) return 0;
  let sum = 0n;
  for (const b of balances) if (set.has(lc(b.address))) sum += b.balance;
  return Number((sum * 10000n) / total) / 100;
}

export function classifyHolder(
  address: string,
  ctx: { creators: string[]; contracts: string[]; snipers: Set<string>; bundled: Set<string> }
): HolderRole {
  const a = lc(address);
  if (ctx.contracts.map(lc).includes(a)) return 'contract';
  if (ctx.creators.map(lc).includes(a)) return 'creator';
  if (ctx.bundled.has(a)) return 'bundle';
  if (ctx.snipers.has(a)) return 'sniper';
  return 'holder';
}

// ─── Bubble layout ────────────────────────────────────────────────────

export interface Bubble {
  id: string;
  value: number;
  x: number;
  y: number;
  r: number;
}

/**
 * Deterministic circle packing: biggest first, each placed on the outward spiral
 * at the first spot that doesn't overlap, then the whole cluster is scaled and
 * centred to fit `width`×`height`. Area is proportional to value.
 */
export function packBubbles(
  items: { id: string; value: number }[],
  width: number,
  height: number,
  gap = 1.5
): Bubble[] {
  const list = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  if (list.length === 0) return [];
  const maxV = list[0].value;
  const placed: Bubble[] = [];
  for (const it of list) {
    const r = Math.max(4, Math.sqrt(it.value / maxV) * 40); // biggest bubble = radius 40 (pre-fit)
    let angle = 0;
    let dist = 0;
    let spot = { x: 0, y: 0 };
    for (let guard = 0; guard < 20000; guard++) {
      spot = { x: Math.cos(angle) * dist, y: Math.sin(angle) * dist };
      const clear = placed.every((p) => Math.hypot(p.x - spot.x, p.y - spot.y) >= p.r + r + gap);
      if (clear) break;
      angle += 0.5;
      dist += 0.35;
    }
    placed.push({ id: it.id, value: it.value, x: spot.x, y: spot.y, r });
  }
  // Fit to the box.
  const minX = Math.min(...placed.map((p) => p.x - p.r));
  const maxX = Math.max(...placed.map((p) => p.x + p.r));
  const minY = Math.min(...placed.map((p) => p.y - p.r));
  const maxY = Math.max(...placed.map((p) => p.y + p.r));
  const scale = Math.min(width / (maxX - minX), height / (maxY - minY));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return placed.map((p) => ({
    ...p,
    x: (p.x - cx) * scale + width / 2,
    y: (p.y - cy) * scale + height / 2,
    r: p.r * scale,
  }));
}
