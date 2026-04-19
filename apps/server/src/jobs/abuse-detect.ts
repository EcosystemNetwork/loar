/**
 * Anomaly / abuse detection job.
 *
 * Periodic scan of recently-active wallets. Writes a Firestore `abuseFlags`
 * row when a wallet's 24-hour generation count exceeds the configured
 * threshold, and fires a Slack alert (when configured).
 *
 * In-process `setInterval` — follows the same pattern as
 * services/pricing/heartbeat.ts. Keep the work cheap: only one of the
 * server replicas should run it (guarded by ABUSE_DETECT_ENABLED env).
 *
 * Deliberately simple heuristic — a fixed daily threshold, not a z-score.
 * At early-beta scale we don't yet have enough history to compute stable
 * per-user baselines, and a threshold is easier for operators to reason
 * about. Swap in a z-score (mean + 3σ of the trailing 7-day daily count)
 * once there's >30 days of real-user data.
 */
import { db, firebaseAvailable } from '../lib/firebase';
import { sendSlackAlert } from '../lib/slack';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface AbuseDetectConfig {
  /** How often the scan runs. Default 30 minutes. */
  intervalMs: number;
  /** How many recently-active wallets to inspect each tick. */
  scanLimit: number;
  /** Flag a wallet when its 24h spend row count exceeds this. */
  dailyThreshold: number;
  /** Skip re-flagging within this window to avoid Slack spam. */
  cooldownMs: number;
}

const DEFAULT_CONFIG: AbuseDetectConfig = {
  intervalMs: parseInt(process.env.ABUSE_DETECT_INTERVAL_MS ?? String(30 * 60_000), 10),
  scanLimit: parseInt(process.env.ABUSE_DETECT_SCAN_LIMIT ?? '500', 10),
  dailyThreshold: parseInt(process.env.ABUSE_DETECT_DAILY_THRESHOLD ?? '100', 10),
  cooldownMs: parseInt(process.env.ABUSE_DETECT_COOLDOWN_MS ?? String(6 * 60 * 60_000), 10),
};

let timer: NodeJS.Timeout | null = null;
let running = false;

export interface AbuseFlag {
  subjectUid: string;
  kind: 'abuse';
  reason: 'high_daily_volume';
  count24h: number;
  threshold: number;
  status: 'open' | 'dismissed' | 'confirmed';
  detectedAt: string;
  lastDetectedAt: string;
}

/**
 * Scan once. Exported so ops can invoke ad-hoc from an admin endpoint or
 * the smoke harness. Returns the list of newly-written flag ids.
 */
export async function detectAbuseOnce(
  cfg: Partial<AbuseDetectConfig> = {}
): Promise<{ scanned: number; flagged: string[] }> {
  if (!firebaseAvailable || !db) {
    return { scanned: 0, flagged: [] };
  }

  const config: AbuseDetectConfig = { ...DEFAULT_CONFIG, ...cfg };
  const cutoff = new Date(Date.now() - DAY_MS).toISOString();
  const cooldownCutoff = new Date(Date.now() - config.cooldownMs).toISOString();

  // Recently-active wallets — userCredits is the cheapest list because
  // every successful spend updates it.
  const activeSnap = await db
    .collection('userCredits')
    .orderBy('updatedAt', 'desc')
    .limit(config.scanLimit)
    .get();

  const flagged: string[] = [];

  for (const userDoc of activeSnap.docs) {
    const uid = userDoc.id;

    // Count spend rows in the trailing 24h using the existing
    // (uid ASC, createdAt DESC) composite index. We can't easily avoid
    // scanning every row (we need credits, not just count) because spend
    // volume is the signal we care about — two users with 100 rows could
    // have very different credit totals.
    const rowsSnap = await db
      .collection('creditTransactions')
      .where('uid', '==', uid)
      .where('createdAt', '>=', cutoff)
      .get();

    let count = 0;
    let credits = 0;
    for (const tx of rowsSnap.docs) {
      const d = tx.data();
      if (d.type !== 'spend') continue;
      count++;
      const c = d.credits;
      if (typeof c === 'number') credits += Math.abs(c);
    }

    if (count < config.dailyThreshold) continue;

    // Cooldown check — did we already open a flag in the last N hours?
    const existingSnap = await db
      .collection('abuseFlags')
      .where('subjectUid', '==', uid)
      .where('lastDetectedAt', '>=', cooldownCutoff)
      .limit(1)
      .get();

    const now = new Date().toISOString();

    if (!existingSnap.empty) {
      // Refresh the lastDetectedAt + count so operators see fresh data.
      await existingSnap.docs[0].ref.update({
        lastDetectedAt: now,
        count24h: count,
      });
      continue;
    }

    const flag: AbuseFlag = {
      subjectUid: uid,
      kind: 'abuse',
      reason: 'high_daily_volume',
      count24h: count,
      threshold: config.dailyThreshold,
      status: 'open',
      detectedAt: now,
      lastDetectedAt: now,
    };
    const ref = await db.collection('abuseFlags').add(flag);
    flagged.push(ref.id);

    void sendSlackAlert({
      title: `Abuse detector: wallet flagged`,
      body:
        `\`${uid}\` ran ${count} generations in 24h ` +
        `(threshold ${config.dailyThreshold}, ${credits} credits burned).\n` +
        `Flag id: \`${ref.id}\``,
      fields: [
        { label: 'subjectUid', value: `\`${uid}\`` },
        { label: 'count24h', value: String(count) },
        { label: 'creditsBurned', value: String(credits) },
        { label: 'threshold', value: String(config.dailyThreshold) },
      ],
      severity: 'warn',
    });
  }

  return { scanned: activeSnap.size, flagged };
}

/**
 * Start the in-process scan loop. Idempotent — calling twice is a no-op.
 * Disabled by default; set ABUSE_DETECT_ENABLED=true in env to turn on.
 */
export function startAbuseDetectJob(): void {
  if (timer) return;
  if (process.env.ABUSE_DETECT_ENABLED !== 'true') {
    console.log('[abuse-detect] disabled (set ABUSE_DETECT_ENABLED=true to enable)');
    return;
  }

  const { intervalMs, dailyThreshold } = DEFAULT_CONFIG;
  console.log(
    `[abuse-detect] enabled — interval ${intervalMs}ms, threshold ${dailyThreshold} spends/24h`
  );

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await detectAbuseOnce();
      if (result.flagged.length > 0) {
        console.log(
          `[abuse-detect] scanned=${result.scanned} newly_flagged=${result.flagged.length}`
        );
      }
    } catch (err) {
      console.error('[abuse-detect] tick failed:', err);
    } finally {
      running = false;
    }
  };

  // Run once shortly after boot so operators see quick feedback.
  setTimeout(tick, 30_000);
  timer = setInterval(tick, intervalMs);
  if (timer.unref) timer.unref();
}

export function stopAbuseDetectJob(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
