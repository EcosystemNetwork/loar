/**
 * DMCA § 512(g) counter-notice auto-putback job.
 *
 * When a counter-notice is received on a taken-down piece of content, the DMCA
 * safe harbor clock starts: the original claimant has 10–14 business days to
 * file a court action. If no such action is filed, the service provider MUST
 * restore the content. This job is the second half of that loop.
 *
 * For each `counterNotices` row that is:
 *   - status == 'pending'
 *   - AND createdAt older than DMCA_PUTBACK_HOLD_DAYS (default 10 business
 *     days ≈ 14 calendar days)
 *   - AND the linked takedownRequest has NOT been marked 'court_action_filed'
 *
 * the job flips the associated content back to `active`, marks the
 * counter-notice `putback_complete`, and appends an immutable audit row to
 * `contentAuditLog`. The platform thereby completes the safe-harbor loop
 * without human intervention.
 *
 * Claimants who have filed a court action must use the admin endpoint
 * `moderation.markCourtAction` (admin-only, written separately) to freeze the
 * counter-notice before the timer fires.
 *
 * In-process setInterval — follows the same pattern as jobs/abuse-detect.ts
 * and services/pricing/heartbeat.ts. Only ONE server replica should run this
 * (gated by DMCA_PUTBACK_ENABLED env).
 */
import { db, firebaseAvailable } from '../lib/firebase';
import { sendSlackAlert } from '../lib/slack';
import { businessDaysBetween } from '../lib/business-days';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DmcaPutbackConfig {
  /** How often the scan runs. Default 1 hour. */
  intervalMs: number;
  /**
   * How many BUSINESS DAYS must elapse before auto-putback fires.
   *
   * 17 U.S.C. § 512(g)(2)(C) requires the floor to be ≥10 business days
   * and the ceiling to be ≤14 business days. We default to 12 — safely
   * inside both bounds, with margin for federal holidays that shift the
   * calendar-day → business-day mapping. Setting this <10 or >14 is a
   * statutory violation; the code clamps to [10, 14].
   */
  holdBusinessDays: number;
  /** Max rows processed per tick (bounds Firestore usage). */
  batchLimit: number;
}

function clampHoldDays(n: number): number {
  if (!Number.isFinite(n)) return 12;
  return Math.min(14, Math.max(10, Math.floor(n)));
}

const DEFAULT_CONFIG: DmcaPutbackConfig = {
  intervalMs: parseInt(process.env.DMCA_PUTBACK_INTERVAL_MS ?? String(60 * 60_000), 10),
  holdBusinessDays: clampHoldDays(
    parseInt(process.env.DMCA_PUTBACK_HOLD_BUSINESS_DAYS ?? '12', 10)
  ),
  batchLimit: parseInt(process.env.DMCA_PUTBACK_BATCH_LIMIT ?? '50', 10),
};

let timer: NodeJS.Timeout | null = null;
let running = false;

export interface PutbackResult {
  scanned: number;
  putback: string[];
  skipped: { id: string; reason: string }[];
}

/**
 * Run one putback sweep. Exported so ops can trigger via admin endpoint or
 * the smoke harness without waiting for the next tick. Always best-effort —
 * individual row failures are logged but don't abort the sweep.
 */
export async function dmcaPutbackOnce(
  cfg: Partial<DmcaPutbackConfig> = {}
): Promise<PutbackResult> {
  const result: PutbackResult = { scanned: 0, putback: [], skipped: [] };
  if (!firebaseAvailable || !db) return result;

  const config: DmcaPutbackConfig = { ...DEFAULT_CONFIG, ...cfg };
  const holdBusinessDays = clampHoldDays(config.holdBusinessDays);
  const now = new Date();

  // First pass: cheap calendar-day pre-filter so we don't load every
  // pending counter-notice on every tick. The minimum calendar span that
  // can contain `holdBusinessDays` business days is `holdBusinessDays`
  // itself (impossible) — but a true business-day span of 10 needs at
  // least 12 calendar days (one weekend), so we floor with that.
  const calendarFloor = Math.max(holdBusinessDays, holdBusinessDays + 2);
  const cutoff = new Date(Date.now() - calendarFloor * DAY_MS);

  // `counterNotices.createdAt` is written as an ISO string (see index.ts
  // /api/counter-notice handler), so string comparison is correct here.
  const snap = await db
    .collection('counterNotices')
    .where('status', '==', 'pending')
    .where('createdAt', '<=', cutoff.toISOString())
    .orderBy('createdAt', 'asc')
    .limit(config.batchLimit)
    .get();

  result.scanned = snap.size;
  if (snap.empty) return result;

  for (const cnDoc of snap.docs) {
    const cn = cnDoc.data() as {
      takedownRequestId?: string;
      respondentEmail?: string;
      createdAt?: string;
    };
    if (!cn.takedownRequestId) {
      result.skipped.push({ id: cnDoc.id, reason: 'missing takedownRequestId' });
      continue;
    }

    // Second pass: confirm the BUSINESS-day floor before we restore.
    // § 512(g)(2)(C) requires "not less than 10 ... business days", so
    // restoring a day early on a holiday week is a statutory violation.
    const createdAt = cn.createdAt ? new Date(cn.createdAt) : null;
    if (!createdAt || Number.isNaN(createdAt.getTime())) {
      result.skipped.push({ id: cnDoc.id, reason: 'missing/invalid createdAt' });
      continue;
    }
    const elapsedBusinessDays = businessDaysBetween(createdAt, now);
    if (elapsedBusinessDays < holdBusinessDays) {
      result.skipped.push({
        id: cnDoc.id,
        reason: `business-day floor not met (${elapsedBusinessDays}/${holdBusinessDays})`,
      });
      continue;
    }

    try {
      await processOnePutback(cnDoc.id, cn.takedownRequestId, result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.skipped.push({ id: cnDoc.id, reason: `error: ${msg.slice(0, 200)}` });
      console.error(`[dmca-putback] ${cnDoc.id} failed:`, err);
    }
  }

  if (result.putback.length > 0) {
    void sendSlackAlert({
      title: `DMCA auto-putback: ${result.putback.length} item(s) reinstated`,
      body:
        `Counter-notice hold period expired — content restored per 17 U.S.C. § 512(g).\n` +
        `Reviewed takedowns: ${result.putback.slice(0, 10).join(', ')}` +
        (result.putback.length > 10 ? ` +${result.putback.length - 10} more` : ''),
      severity: 'info',
    });
  }

  return result;
}

async function processOnePutback(
  counterNoticeId: string,
  takedownId: string,
  result: PutbackResult
): Promise<void> {
  const tdRef = db.collection('takedownRequests').doc(takedownId);
  const tdDoc = await tdRef.get();
  if (!tdDoc.exists) {
    result.skipped.push({ id: counterNoticeId, reason: 'takedown missing' });
    return;
  }
  const td = tdDoc.data() as { contentId?: string; status?: string };

  // Court action filed — claimant asked us to hold. Skip until they
  // withdraw or the deadline is explicitly extended.
  if (td.status === 'court_action_filed') {
    result.skipped.push({ id: counterNoticeId, reason: 'court action pending' });
    return;
  }
  if (!td.contentId) {
    result.skipped.push({ id: counterNoticeId, reason: 'takedown missing contentId' });
    return;
  }

  const now = new Date().toISOString();
  const batch = db.batch();

  // Flip content back to active. Matches moderation.updateContentStatus
  // shape so downstream consumers see a normal state change.
  batch.update(db.collection('content').doc(td.contentId), {
    contentStatus: 'active',
    contentStatusUpdatedAt: now,
    contentStatusUpdatedBy: 'system_dmca_putback',
  });

  // Counter-notice is complete.
  batch.update(db.collection('counterNotices').doc(counterNoticeId), {
    status: 'putback_complete',
    putbackAt: now,
  });

  // Close the takedown as expired (the claimant didn't file in time).
  batch.update(tdRef, {
    status: 'counter_notice_hold_expired',
    counterNoticeHoldExpiredAt: now,
  });

  // Immutable audit row — legal defence evidence if we ever have to show
  // we followed § 512(g) correctly.
  const auditRef = db.collection('contentAuditLog').doc();
  batch.set(auditRef, {
    contentId: td.contentId,
    action: 'dmca_putback_auto',
    takedownRequestId: takedownId,
    counterNoticeId,
    adminUid: 'system_dmca_putback',
    reason: `Auto-putback per 17 U.S.C. § 512(g): counter-notice hold period (${DEFAULT_CONFIG.holdBusinessDays} business days) expired without court action.`,
    createdAt: now,
  });

  await batch.commit();
  result.putback.push(takedownId);

  // Transparency email to the original claimant — no legal requirement but
  // a clean paper trail eliminates "why is this content back up?" tickets.
  // Fire-and-forget; the durable audit row already proves we complied.
  try {
    const cnDoc = await db.collection('counterNotices').doc(counterNoticeId).get();
    const cn = cnDoc.exists ? (cnDoc.data() as any) : null;
    const td = tdDoc.data() as any;
    if (td?.claimantEmail && cn) {
      const { emailPutbackToClaimant } = await import('../lib/dmca-email');
      void emailPutbackToClaimant(
        {
          id: takedownId,
          contentId: td.contentId ?? '',
          claimantName: td.claimantName,
          claimantEmail: td.claimantEmail,
          copyrightWork: td.copyrightWork,
          createdAt: td.createdAt ?? now,
        },
        {
          id: counterNoticeId,
          respondentName: cn.respondentName ?? '',
          respondentEmail: cn.respondentEmail ?? '',
          respondentAddress: cn.respondentAddress,
          explanation: cn.explanation ?? '',
          createdAt: cn.createdAt ?? now,
        }
      );
    }
  } catch (err) {
    console.warn(`[dmca-putback] putback email dispatch failed for ${takedownId}:`, err);
  }
}

/**
 * Start the in-process hourly sweep. Idempotent — calling twice is a no-op.
 * Disabled by default; set DMCA_PUTBACK_ENABLED=true in env to turn on.
 * Only ONE replica should run this (set the env on one node in multi-replica).
 */
export function startDmcaPutbackJob(): void {
  if (timer) return;
  if (process.env.DMCA_PUTBACK_ENABLED !== 'true') {
    console.log('[dmca-putback] disabled (set DMCA_PUTBACK_ENABLED=true to enable)');
    return;
  }

  const { intervalMs, holdBusinessDays } = DEFAULT_CONFIG;
  console.log(
    `[dmca-putback] enabled — interval ${intervalMs}ms, hold ${holdBusinessDays} business days`
  );

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await dmcaPutbackOnce();
      if (r.putback.length > 0 || r.skipped.length > 0) {
        console.log(
          `[dmca-putback] scanned=${r.scanned} putback=${r.putback.length} skipped=${r.skipped.length}`
        );
      }
    } catch (err) {
      console.error('[dmca-putback] tick failed:', err);
    } finally {
      running = false;
    }
  };

  // First sweep shortly after boot so operators see feedback.
  setTimeout(tick, 60_000);
  timer = setInterval(tick, intervalMs);
  if (timer.unref) timer.unref();
}

export function stopDmcaPutbackJob(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
