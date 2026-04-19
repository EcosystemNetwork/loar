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

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DmcaPutbackConfig {
  /** How often the scan runs. Default 1 hour. */
  intervalMs: number;
  /** How old a pending counter-notice must be before auto-putback fires. */
  holdDays: number;
  /** Max rows processed per tick (bounds Firestore usage). */
  batchLimit: number;
}

const DEFAULT_CONFIG: DmcaPutbackConfig = {
  intervalMs: parseInt(process.env.DMCA_PUTBACK_INTERVAL_MS ?? String(60 * 60_000), 10),
  // 10 business days ≈ 14 calendar days in the conservative case.
  holdDays: parseInt(process.env.DMCA_PUTBACK_HOLD_DAYS ?? '14', 10),
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
  const cutoff = new Date(Date.now() - config.holdDays * DAY_MS);

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
    };
    if (!cn.takedownRequestId) {
      result.skipped.push({ id: cnDoc.id, reason: 'missing takedownRequestId' });
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
    reason: `Auto-putback per 17 U.S.C. § 512(g): counter-notice hold period (${DEFAULT_CONFIG.holdDays} days) expired without court action.`,
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

  const { intervalMs, holdDays } = DEFAULT_CONFIG;
  console.log(`[dmca-putback] enabled — interval ${intervalMs}ms, hold ${holdDays} days`);

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
