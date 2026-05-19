/**
 * Virality Scoring — composite engagement score from raw watch-session data.
 *
 * Pure functions over an array of watch sessions. No DB access here; the
 * router fetches the sessions and calls in. That makes the math testable and
 * keeps Firestore quirks out of the scoring path.
 *
 * Five signals, blended into one 0–100 virality index:
 *
 *   hookScore       — % of sessions that crossed the 5-second mark.
 *                     "Did the opening hold them past the bounce-out window?"
 *   holdRate        — avg fraction of the episode watched per session, 0–100.
 *                     Uses durationSec when known; falls back to a 5s assumption.
 *   completionRate  — % of sessions flagged `completed`.
 *   replayRate      — % of unique users who came back for a second session.
 *   velocity        — sessions per hour since first session (or publishedAt).
 *                     Normalised to 0–100 with a soft cap at 50/hr = perfect.
 *
 * The composite uses the weights below — tunable from one place when we
 * learn how each signal correlates with actual virality on the platform.
 */

export interface WatchSessionLike {
  userId: string;
  episodeId: string;
  positionSec: number;
  secondsWatched: number;
  completed: boolean;
  startedAt: Date | null;
  endedAt: Date | null;
  lastTickAt: Date | null;
}

export interface ViralityScore {
  /** 0–100. % of sessions that watched at least 5 seconds. */
  hookScore: number;
  /** 0–100. Average fraction of the episode actually consumed. */
  holdRate: number;
  /** 0–100. % of sessions marked completed. */
  completionRate: number;
  /** 0–100. % of unique viewers who started 2+ sessions. */
  replayRate: number;
  /** 0–100. Normalised sessions/hour throughput. */
  velocity: number;
  /** 0–100. Weighted composite — see WEIGHTS below. */
  viralityIndex: number;
  /** Total sessions in the window. */
  sampleSize: number;
  /** Distinct users in the window. */
  uniqueViewers: number;
}

/** Sums to 1.0 — adjust if a signal proves unreliable in the wild. */
export const VIRALITY_WEIGHTS = {
  hook: 0.3,
  hold: 0.3,
  completion: 0.2,
  replay: 0.1,
  velocity: 0.1,
} as const;

/** ≥5 seconds = "they didn't bounce in the first beat." */
const HOOK_THRESHOLD_SEC = 5;

/** Default duration when episode metadata is missing. Maps to 5s default clips. */
const DEFAULT_EPISODE_DURATION_SEC = 5;

/** Sessions/hour that maxes the velocity component. ~1 session every 72s. */
const VELOCITY_SATURATION_PER_HOUR = 50;

function clamp(n: number, lo = 0, hi = 100): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

export function computeViralityScore(
  sessions: WatchSessionLike[],
  options: {
    /** Episode runtime in seconds. Improves holdRate accuracy when available. */
    durationSec?: number;
    /** When the episode published. Velocity starts ticking from this moment. */
    publishedAt?: Date | null;
  } = {}
): ViralityScore {
  const sampleSize = sessions.length;

  if (sampleSize === 0) {
    return {
      hookScore: 0,
      holdRate: 0,
      completionRate: 0,
      replayRate: 0,
      velocity: 0,
      viralityIndex: 0,
      sampleSize: 0,
      uniqueViewers: 0,
    };
  }

  // ── Hook ───────────────────────────────────────────────────────────
  const hooked = sessions.filter((s) => s.secondsWatched >= HOOK_THRESHOLD_SEC).length;
  const hookScore = clamp((hooked / sampleSize) * 100);

  // ── Hold ───────────────────────────────────────────────────────────
  const duration = options.durationSec ?? DEFAULT_EPISODE_DURATION_SEC;
  const fractions = sessions.map((s) => Math.min(1, s.secondsWatched / duration));
  const avgFraction = fractions.reduce((a, b) => a + b, 0) / sampleSize;
  const holdRate = clamp(avgFraction * 100);

  // ── Completion ────────────────────────────────────────────────────
  const completed = sessions.filter((s) => s.completed).length;
  const completionRate = clamp((completed / sampleSize) * 100);

  // ── Replay ────────────────────────────────────────────────────────
  // Distinct users who showed up in 2+ sessions on this episode.
  const perUserCounts = new Map<string, number>();
  for (const s of sessions) {
    perUserCounts.set(s.userId, (perUserCounts.get(s.userId) ?? 0) + 1);
  }
  const uniqueViewers = perUserCounts.size;
  const replayers = Array.from(perUserCounts.values()).filter((n) => n >= 2).length;
  const replayRate = uniqueViewers > 0 ? clamp((replayers / uniqueViewers) * 100) : 0;

  // ── Velocity ──────────────────────────────────────────────────────
  // Hours elapsed since the earlier of: publishedAt, the earliest session.
  // Pick whichever is older so velocity isn't artificially inflated when an
  // episode publishes hours before its first viewer.
  const firstSessionAt = sessions
    .map((s) => s.startedAt?.getTime() ?? s.lastTickAt?.getTime() ?? null)
    .filter((t): t is number => t !== null)
    .sort((a, b) => a - b)[0];

  const anchorTime =
    options.publishedAt && firstSessionAt
      ? Math.min(options.publishedAt.getTime(), firstSessionAt)
      : (options.publishedAt?.getTime() ?? firstSessionAt ?? Date.now());

  const hoursElapsed = Math.max(0.5, (Date.now() - anchorTime) / 3_600_000);
  const sessionsPerHour = sampleSize / hoursElapsed;
  const velocity = clamp((sessionsPerHour / VELOCITY_SATURATION_PER_HOUR) * 100);

  // ── Composite ─────────────────────────────────────────────────────
  const viralityIndex = clamp(
    hookScore * VIRALITY_WEIGHTS.hook +
      holdRate * VIRALITY_WEIGHTS.hold +
      completionRate * VIRALITY_WEIGHTS.completion +
      replayRate * VIRALITY_WEIGHTS.replay +
      velocity * VIRALITY_WEIGHTS.velocity
  );

  return {
    hookScore: Math.round(hookScore),
    holdRate: Math.round(holdRate),
    completionRate: Math.round(completionRate),
    replayRate: Math.round(replayRate),
    velocity: Math.round(velocity),
    viralityIndex: Math.round(viralityIndex),
    sampleSize,
    uniqueViewers,
  };
}

/**
 * Pithy one-line description of the score — handy for cards and tooltips.
 */
export function describeViralityScore(score: ViralityScore): string {
  if (score.sampleSize === 0) return 'No watch data yet';
  if (score.viralityIndex >= 80) return 'Hit potential — share aggressively';
  if (score.viralityIndex >= 60) return 'Strong engagement — push to more feeds';
  if (score.viralityIndex >= 40) return 'Mid-tier — tighten the hook';
  if (score.viralityIndex >= 20) return 'Underperforming — drop-off in opening seconds';
  return 'Low signal — re-cut or re-publish';
}
