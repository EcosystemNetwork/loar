/**
 * Parse `LoarLpLockerMultiple.tokenRewards(token)`.
 *
 * The contract returns a struct — {token, poolKey, positionId, numPositions,
 * rewardBps, rewardAdmins, rewardRecipients} — which viem decodes to a *named
 * object*. Older code indexed it like a tuple ([0]/[1]/[2]) with the wrong field
 * order, which threw on every read. Named access first, positional as a fallback
 * for tuple-shaped results, and null for an unregistered token (zero address).
 */
export interface RewardConfig {
  rewardAdmins: `0x${string}`[];
  rewardRecipients: `0x${string}`[];
  rewardBps: number[];
}

const ZERO = '0x0000000000000000000000000000000000000000';

const asAddrs = (v: unknown): `0x${string}`[] =>
  Array.isArray(v) ? (v.filter((x) => typeof x === 'string') as `0x${string}`[]) : [];
const asBps = (v: unknown): number[] =>
  Array.isArray(v) ? v.map((x) => Number(x)).filter((n) => Number.isFinite(n)) : [];

export function parseTokenRewardInfo(raw: unknown): RewardConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string | number, unknown>;
  const named = 'rewardBps' in r || 'rewardAdmins' in r || 'rewardRecipients' in r;
  // Struct field order: token, poolKey, positionId, numPositions, rewardBps, rewardAdmins, rewardRecipients
  const token = (named ? r.token : r[0]) as string | undefined;
  if (typeof token === 'string' && token.toLowerCase() === ZERO) return null;
  const cfg: RewardConfig = named
    ? {
        rewardBps: asBps(r.rewardBps),
        rewardAdmins: asAddrs(r.rewardAdmins),
        rewardRecipients: asAddrs(r.rewardRecipients),
      }
    : { rewardBps: asBps(r[4]), rewardAdmins: asAddrs(r[5]), rewardRecipients: asAddrs(r[6]) };
  return cfg.rewardRecipients.length === 0 && cfg.rewardAdmins.length === 0 ? null : cfg;
}
