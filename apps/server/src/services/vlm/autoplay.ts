/**
 * Continuous-film autoplay daemon (Phase 7).
 *
 * Scaffolded behind a feature flag because it can spend real money on
 * Gemini + generation providers. Off by default and limited to ONE replica
 * in multi-replica deploys (same pattern as ABUSE_DETECT_ENABLED /
 * DMCA_PUTBACK_ENABLED).
 *
 *   Enable:
 *     VLM_CONTINUOUS_FILM=true
 *     VLM_AUTOPLAY_MAX_PER_DAY=10        # per universe
 *     VLM_AUTOPLAY_BUDGET_USD=20         # per universe / day
 *     VLM_AUTOPLAY_REQUIRE_VOTE=true     # hard-gate on governance approval
 *
 * Control flow (one tick):
 *   1. For each universe where autoplay is opted-in, read the latest canon state.
 *   2. Check per-day budget + per-day count; bail if exceeded.
 *   3. Draft the next beat via vlm.governance.draftProposal (uses prior
 *      extractions + entity graph).
 *   4. If VLM_AUTOPLAY_REQUIRE_VOTE=true, wait for governance decision;
 *      else auto-advance after a configurable debounce.
 *   5. Enqueue generation via the existing generation queue.
 *   6. Post-generation VLM extraction + canon check feed back in.
 *
 * This module exposes the kill-switch and the ticker; wiring the actual loop
 * into BullMQ is a follow-up once the Phase 1–6 pipeline has run in the wild
 * for enough time to calibrate costs.
 */

import { db, firebaseAvailable } from '../../lib/firebase';

export function isAutoplayEnabled(): boolean {
  return process.env.VLM_CONTINUOUS_FILM === 'true';
}

export function autoplayConfig() {
  return {
    maxPerDay: parseInt(process.env.VLM_AUTOPLAY_MAX_PER_DAY || '10', 10),
    budgetUsd: parseFloat(process.env.VLM_AUTOPLAY_BUDGET_USD || '20'),
    requireVote: process.env.VLM_AUTOPLAY_REQUIRE_VOTE === 'true',
  };
}

export interface AutoplayState {
  universeAddress: string;
  todaysRuns: number;
  todaysCostUsd: number;
  date: string; // YYYY-MM-DD
  lastTickAt?: Date;
}

const DOC_ID = (universeAddress: string, dateIso: string) => `${universeAddress}_${dateIso}`;

export async function readAutoplayState(universeAddress: string): Promise<AutoplayState> {
  const date = new Date().toISOString().slice(0, 10);
  if (!firebaseAvailable) {
    return { universeAddress, todaysRuns: 0, todaysCostUsd: 0, date };
  }
  const doc = await db.collection('vlmAutoplayState').doc(DOC_ID(universeAddress, date)).get();
  if (!doc.exists) {
    return { universeAddress, todaysRuns: 0, todaysCostUsd: 0, date };
  }
  const data = doc.data() as any;
  return {
    universeAddress,
    todaysRuns: Number(data.todaysRuns ?? 0),
    todaysCostUsd: Number(data.todaysCostUsd ?? 0),
    date,
    lastTickAt: data.lastTickAt?.toDate?.() ?? data.lastTickAt,
  };
}

export async function canTickAutoplay(
  universeAddress: string
): Promise<{ ok: boolean; reason?: string; state: AutoplayState }> {
  if (!isAutoplayEnabled()) {
    const date = new Date().toISOString().slice(0, 10);
    return {
      ok: false,
      reason: 'feature flag disabled',
      state: { universeAddress, todaysRuns: 0, todaysCostUsd: 0, date },
    };
  }
  const cfg = autoplayConfig();
  const state = await readAutoplayState(universeAddress);
  if (state.todaysRuns >= cfg.maxPerDay) {
    return { ok: false, reason: 'daily run cap reached', state };
  }
  if (state.todaysCostUsd >= cfg.budgetUsd) {
    return { ok: false, reason: 'daily budget reached', state };
  }
  return { ok: true, state };
}

export async function recordAutoplayRun(universeAddress: string, costUsd: number): Promise<void> {
  if (!firebaseAvailable) return;
  const date = new Date().toISOString().slice(0, 10);
  const ref = db.collection('vlmAutoplayState').doc(DOC_ID(universeAddress, date));
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const prev = snap.exists ? (snap.data() as any) : {};
    tx.set(
      ref,
      {
        universeAddress,
        date,
        todaysRuns: Number(prev.todaysRuns ?? 0) + 1,
        todaysCostUsd: Number(prev.todaysCostUsd ?? 0) + costUsd,
        lastTickAt: new Date(),
      },
      { merge: true }
    );
  });
}
