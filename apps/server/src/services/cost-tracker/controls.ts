/**
 * Cost controls — provider kill-switches + per-scope daily caps.
 *
 * State lives in `costControls/platform` (singleton) and is read on every
 * paid-API preflight. To keep that cheap, we cache the doc for
 * COST_CONTROLS_CACHE_MS (default 30s) in-process.
 *
 *   providers.pausedProviders      — hard-stop list; any listed provider
 *                                    throws `ProviderPausedError` on preflight
 *   caps.platformDailyUsd          — hard cap; blocks when today's platform
 *                                    cost ≥ this value
 *   caps.userDailyUsd              — default cap per-user (null = unlimited)
 *   caps.apiKeyDailyUsd            — default cap per-api-key
 *   caps.universeDailyUsd          — default cap per-universe
 *   overrides.userDailyUsd[uid]    — per-user override (takes precedence)
 *   overrides.apiKeyDailyUsd[kid]  — per-api-key override
 *   overrides.universeDailyUsd[ua] — per-universe override
 *
 * Admin writes go through `setControls()`; mutations invalidate the cache.
 */

import { db, firebaseAvailable } from '../../lib/firebase';
import { getCostScope } from './scope';

export class ProviderPausedError extends Error {
  readonly kind = 'paused';
  constructor(readonly provider: string) {
    super(`Provider "${provider}" is paused by admin controls`);
  }
}

export class CostCapExceededError extends Error {
  readonly kind = 'cap';
  constructor(
    readonly scope: 'platform' | 'user' | 'apiKey' | 'universe',
    readonly capUsd: number,
    readonly spentUsd: number
  ) {
    super(
      `Cost cap exceeded for scope=${scope}: spent $${spentUsd.toFixed(4)} of $${capUsd.toFixed(2)} daily cap`
    );
  }
}

/**
 * Single-call cost ceiling — refuses a paid request whose modeled unit cost
 * exceeds the per-kind admin ceiling. Different from CostCapExceededError
 * (which is *daily* aggregate spend); this gate stops a single $20 video
 * before it leaves the building.
 */
export class CostCeilingExceededError extends Error {
  readonly kind = 'ceiling';
  constructor(
    readonly callKind: string,
    readonly ceilingUsd: number,
    readonly attemptedUsd: number
  ) {
    super(
      `Per-call cost ceiling exceeded for ${callKind}: $${attemptedUsd.toFixed(4)} exceeds $${ceilingUsd.toFixed(4)} ceiling`
    );
  }
}

/**
 * Per-call cost ceilings — read once at boot from env. Setting any of
 *   MAX_LLM_CALL_USD, MAX_VLM_CALL_USD, MAX_IMAGE_CALL_USD,
 *   MAX_VIDEO_CALL_USD, MAX_AUDIO_CALL_USD, MAX_THREED_CALL_USD
 * causes assertCostCeiling() to throw CostCeilingExceededError before the
 * provider call goes out. Use to catch fat-fingered tier bumps, runaway
 * duration loops, or accidental 4k requests on a budget tier.
 */
type CallKind = 'llm' | 'vlm' | 'image_gen' | 'video_gen' | 'audio_gen' | 'threed_gen';

function envCeiling(name: string): number | null {
  const v = Number(process.env[name] ?? '');
  return Number.isFinite(v) && v > 0 ? v : null;
}

const PER_CALL_CEILINGS: Readonly<Record<CallKind, number | null>> = Object.freeze({
  llm: envCeiling('MAX_LLM_CALL_USD'),
  vlm: envCeiling('MAX_VLM_CALL_USD'),
  image_gen: envCeiling('MAX_IMAGE_CALL_USD'),
  video_gen: envCeiling('MAX_VIDEO_CALL_USD'),
  audio_gen: envCeiling('MAX_AUDIO_CALL_USD'),
  threed_gen: envCeiling('MAX_THREED_CALL_USD'),
});

export function assertCostCeiling(callKind: CallKind, attemptedUsd: number): void {
  const ceiling = PER_CALL_CEILINGS[callKind];
  if (!ceiling) return;
  if (!Number.isFinite(attemptedUsd) || attemptedUsd <= 0) return;
  if (attemptedUsd > ceiling) {
    throw new CostCeilingExceededError(callKind, ceiling, attemptedUsd);
  }
}

export function getPerCallCeilings(): Readonly<Record<CallKind, number | null>> {
  return PER_CALL_CEILINGS;
}

export interface CostControls {
  pausedProviders: string[];
  caps: {
    platformDailyUsd: number | null;
    userDailyUsd: number | null;
    apiKeyDailyUsd: number | null;
    universeDailyUsd: number | null;
  };
  overrides: {
    userDailyUsd: Record<string, number>;
    apiKeyDailyUsd: Record<string, number>;
    universeDailyUsd: Record<string, number>;
  };
  alert: {
    enabled: boolean;
    /** Trigger Slack when day margin drops below this ratio. Default = target. */
    marginThreshold: number | null;
    /** Minimum minutes between alerts for the same rule. */
    cooldownMinutes: number;
  };
  updatedAt?: Date;
  updatedBy?: string | null;
}

export const DEFAULT_CONTROLS: CostControls = {
  pausedProviders: [],
  caps: {
    platformDailyUsd: (() => {
      const v = Number(process.env.COST_DAILY_PLATFORM_CAP_USD ?? '');
      return Number.isFinite(v) && v > 0 ? v : null;
    })(),
    userDailyUsd: null,
    apiKeyDailyUsd: null,
    universeDailyUsd: null,
  },
  overrides: { userDailyUsd: {}, apiKeyDailyUsd: {}, universeDailyUsd: {} },
  alert: {
    enabled: process.env.COST_ALERT_ENABLED === 'true',
    marginThreshold: null,
    cooldownMinutes: Math.max(5, parseInt(process.env.COST_ALERT_COOLDOWN_MIN ?? '30', 10) || 30),
  },
};

const CACHE_MS = Math.max(
  1000,
  parseInt(process.env.COST_CONTROLS_CACHE_MS ?? '30000', 10) || 30_000
);

let cached: { at: number; controls: CostControls } | null = null;

export function invalidateControlsCache(): void {
  cached = null;
}

function merge(base: CostControls, patch: any): CostControls {
  if (!patch || typeof patch !== 'object') return base;
  return {
    pausedProviders: Array.isArray(patch.pausedProviders)
      ? patch.pausedProviders.map(String)
      : base.pausedProviders,
    caps: {
      platformDailyUsd:
        patch.caps?.platformDailyUsd === undefined
          ? base.caps.platformDailyUsd
          : patch.caps.platformDailyUsd,
      userDailyUsd:
        patch.caps?.userDailyUsd === undefined ? base.caps.userDailyUsd : patch.caps.userDailyUsd,
      apiKeyDailyUsd:
        patch.caps?.apiKeyDailyUsd === undefined
          ? base.caps.apiKeyDailyUsd
          : patch.caps.apiKeyDailyUsd,
      universeDailyUsd:
        patch.caps?.universeDailyUsd === undefined
          ? base.caps.universeDailyUsd
          : patch.caps.universeDailyUsd,
    },
    overrides: {
      userDailyUsd: patch.overrides?.userDailyUsd ?? base.overrides.userDailyUsd,
      apiKeyDailyUsd: patch.overrides?.apiKeyDailyUsd ?? base.overrides.apiKeyDailyUsd,
      universeDailyUsd: patch.overrides?.universeDailyUsd ?? base.overrides.universeDailyUsd,
    },
    alert: {
      enabled: patch.alert?.enabled ?? base.alert.enabled,
      marginThreshold:
        patch.alert?.marginThreshold === undefined
          ? base.alert.marginThreshold
          : patch.alert.marginThreshold,
      cooldownMinutes: patch.alert?.cooldownMinutes ?? base.alert.cooldownMinutes,
    },
    updatedAt: patch.updatedAt?.toDate?.() ?? patch.updatedAt ?? base.updatedAt,
    updatedBy: patch.updatedBy ?? base.updatedBy ?? null,
  };
}

export async function getControls(): Promise<CostControls> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_MS) return cached.controls;
  if (!firebaseAvailable) {
    cached = { at: now, controls: DEFAULT_CONTROLS };
    return DEFAULT_CONTROLS;
  }
  try {
    const snap = await db.collection('costControls').doc('platform').get();
    const next = merge(DEFAULT_CONTROLS, snap.exists ? snap.data() : null);
    cached = { at: now, controls: next };
    return next;
  } catch {
    cached = { at: now, controls: DEFAULT_CONTROLS };
    return DEFAULT_CONTROLS;
  }
}

export async function setControls(
  patch: Partial<CostControls>,
  adminUid: string
): Promise<CostControls> {
  if (!firebaseAvailable) throw new Error('Firestore unavailable');
  const current = await getControls();
  const next = merge(current, { ...patch, updatedAt: new Date(), updatedBy: adminUid });
  await db.collection('costControls').doc('platform').set(next, { merge: true });
  await db.collection('costControlsAudit').add({
    patch,
    adminUid,
    appliedAt: new Date(),
  });
  invalidateControlsCache();
  return next;
}

// ── Preflight check used by every provider wrapper ────────────────────

function periodKeys() {
  const day = new Date().toISOString().slice(0, 10);
  return { day };
}

async function readAggregate(scope: string, key: string): Promise<number> {
  if (!firebaseAvailable) return 0;
  try {
    const { day } = periodKeys();
    const doc = await db.collection('costAggregates').doc(`${day}__${scope}__${key}`).get();
    return Number(doc.data()?.costUsd ?? 0);
  } catch (err) {
    // Fail-open: caps are advisory — never block a paid call because the
    // aggregate read transiently failed. The kill-switch is the hard gate.
    console.warn('[cost-controls] readAggregate failed, allowing call:', (err as Error).message);
    return 0;
  }
}

export interface AssertArgs {
  provider: string;
}

/**
 * Gate a paid-API call on (a) the provider kill-switch and (b) every scope
 * cap that applies. Throws `ProviderPausedError` or `CostCapExceededError`
 * when a gate fails; returns silently otherwise.
 */
export async function assertProviderAllowed(args: AssertArgs): Promise<void> {
  const controls = await getControls();
  if (controls.pausedProviders.includes(args.provider)) {
    throw new ProviderPausedError(args.provider);
  }
  const scope = getCostScope();

  // Platform cap
  if (controls.caps.platformDailyUsd && controls.caps.platformDailyUsd > 0) {
    const spent = await readAggregate('platform', 'all');
    if (spent >= controls.caps.platformDailyUsd) {
      throw new CostCapExceededError('platform', controls.caps.platformDailyUsd, spent);
    }
  }

  // User cap
  const uid = scope.userId;
  if (uid) {
    const override = controls.overrides.userDailyUsd[uid];
    const cap = override ?? controls.caps.userDailyUsd;
    if (cap && cap > 0) {
      const spent = await readAggregate('user', uid);
      if (spent >= cap) throw new CostCapExceededError('user', cap, spent);
    }
  }

  // API key cap
  const keyId = scope.apiKeyId;
  if (keyId) {
    const override = controls.overrides.apiKeyDailyUsd[keyId];
    const cap = override ?? controls.caps.apiKeyDailyUsd;
    if (cap && cap > 0) {
      const spent = await readAggregate('apiKey', keyId);
      if (spent >= cap) throw new CostCapExceededError('apiKey', cap, spent);
    }
  }

  // Universe cap
  const uni = scope.universeAddress;
  if (uni) {
    const override = controls.overrides.universeDailyUsd[uni];
    const cap = override ?? controls.caps.universeDailyUsd;
    if (cap && cap > 0) {
      const spent = await readAggregate('universe', uni);
      if (spent >= cap) throw new CostCapExceededError('universe', cap, spent);
    }
  }
}
