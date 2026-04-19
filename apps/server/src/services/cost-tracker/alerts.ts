/**
 * Cost / margin alerts.
 *
 * Checks the daily margin against the configured threshold (default = target)
 * and fires a Slack alert + writes a row to `costAlerts/` when it breaches.
 * Respects a cooldown so the same breach doesn't spam the channel every tick.
 *
 * Usage:
 *   - Called from a background timer in `apps/server/src/index.ts`
 *   - Or from `admin.cost.alerts.runNow` (admin-triggered manual check)
 */

import { randomUUID } from 'node:crypto';
import { db, firebaseAvailable } from '../../lib/firebase';
import { sendSlackAlert } from '../../lib/slack';
import { computeMargin, marginTarget } from './margin';
import { getControls } from './controls';

export type AlertKind = 'margin_breach' | 'platform_cap_hit';

export interface CostAlert {
  id: string;
  kind: AlertKind;
  severity: 'warn' | 'page';
  message: string;
  data: Record<string, unknown>;
  firedAt: Date;
  acknowledged: boolean;
  acknowledgedAt?: Date;
  acknowledgedBy?: string | null;
}

const COOLDOWN_DOC = 'alertCooldown';

async function lastFiredAt(kind: AlertKind): Promise<Date | null> {
  if (!firebaseAvailable) return null;
  const doc = await db.collection('costControls').doc(COOLDOWN_DOC).get();
  const v = doc.data()?.[kind];
  const t = v?.toDate?.() ?? v;
  return t instanceof Date ? t : null;
}

async function stampCooldown(kind: AlertKind) {
  if (!firebaseAvailable) return;
  await db
    .collection('costControls')
    .doc(COOLDOWN_DOC)
    .set({ [kind]: new Date() }, { merge: true });
}

async function persistAlert(alert: Omit<CostAlert, 'id'>): Promise<string> {
  if (!firebaseAvailable) return '';
  const id = `alert_${randomUUID()}`;
  await db
    .collection('costAlerts')
    .doc(id)
    .set({ ...alert, id });
  return id;
}

function fmtUsd(n: number): string {
  return `$${Number(n ?? 0).toFixed(2)}`;
}

function fmtPct(r: number): string {
  return `${(Number(r ?? 0) * 100).toFixed(1)}%`;
}

/**
 * Check the current daily margin against the threshold; fire + persist an
 * alert when breached past the cooldown window. Idempotent per cooldown.
 */
export async function checkAndFireMarginAlert(): Promise<CostAlert | null> {
  const controls = await getControls();
  if (!controls.alert.enabled) return null;
  const threshold = controls.alert.marginThreshold ?? marginTarget();
  const cooldownMs = controls.alert.cooldownMinutes * 60 * 1000;

  const margin = await computeMargin('day');
  if (margin.revenueUsd <= 0) return null; // no signal, don't spam
  if (margin.marginRatio >= threshold) return null;

  const last = await lastFiredAt('margin_breach');
  if (last && Date.now() - last.getTime() < cooldownMs) return null;

  const message =
    `Daily gross margin ${fmtPct(margin.marginRatio)} is below target ${fmtPct(threshold)}. ` +
    `Revenue ${fmtUsd(margin.revenueUsd)} · Cost ${fmtUsd(margin.costUsd)} · ` +
    `Net ${fmtUsd(margin.marginUsd)}.`;

  await sendSlackAlert({
    title: `Margin alert — ${fmtPct(margin.marginRatio)}`,
    body: message,
    severity: 'warn',
    fields: [
      { label: 'revenue', value: fmtUsd(margin.revenueUsd) },
      { label: 'cost', value: fmtUsd(margin.costUsd) },
      { label: 'margin', value: fmtPct(margin.marginRatio) },
      { label: 'target', value: fmtPct(threshold) },
      { label: 'period', value: margin.period },
    ],
  });
  const payload: Omit<CostAlert, 'id'> = {
    kind: 'margin_breach',
    severity: 'warn',
    message,
    data: {
      period: margin.period,
      revenueUsd: margin.revenueUsd,
      costUsd: margin.costUsd,
      marginRatio: margin.marginRatio,
      target: threshold,
    },
    firedAt: new Date(),
    acknowledged: false,
  };
  const id = await persistAlert(payload);
  await stampCooldown('margin_breach');
  return { ...payload, id };
}

/**
 * Check the platform daily cap (if configured) and fire + persist an alert
 * when today's spend crosses it.
 */
export async function checkAndFirePlatformCapAlert(): Promise<CostAlert | null> {
  const controls = await getControls();
  if (!controls.alert.enabled) return null;
  const cap = controls.caps.platformDailyUsd;
  if (!cap || cap <= 0) return null;
  if (!firebaseAvailable) return null;

  const day = new Date().toISOString().slice(0, 10);
  const doc = await db.collection('costAggregates').doc(`${day}__platform__all`).get();
  const spent = Number(doc.data()?.costUsd ?? 0);
  if (spent < cap) return null;

  const cooldownMs = controls.alert.cooldownMinutes * 60 * 1000;
  const last = await lastFiredAt('platform_cap_hit');
  if (last && Date.now() - last.getTime() < cooldownMs) return null;

  const message = `Platform daily cost cap hit — ${fmtUsd(spent)} ≥ cap ${fmtUsd(cap)}. Paid API calls will now fail until the cap is raised or the day rolls over.`;
  await sendSlackAlert({
    title: `Cost cap hit — ${fmtUsd(spent)} / ${fmtUsd(cap)}`,
    body: message,
    severity: 'critical',
    fields: [
      { label: 'spent', value: fmtUsd(spent) },
      { label: 'cap', value: fmtUsd(cap) },
      { label: 'period', value: day },
    ],
  });
  const payload: Omit<CostAlert, 'id'> = {
    kind: 'platform_cap_hit',
    severity: 'page',
    message,
    data: { period: day, spentUsd: spent, capUsd: cap },
    firedAt: new Date(),
    acknowledged: false,
  };
  const id = await persistAlert(payload);
  await stampCooldown('platform_cap_hit');
  return { ...payload, id };
}

export async function runAlertSweep(): Promise<CostAlert[]> {
  const out: CostAlert[] = [];
  const margin = await checkAndFireMarginAlert();
  if (margin) out.push(margin);
  const cap = await checkAndFirePlatformCapAlert();
  if (cap) out.push(cap);
  return out;
}

export async function listRecentAlerts(limit = 50): Promise<CostAlert[]> {
  if (!firebaseAvailable) return [];
  const snap = await db
    .collection('costAlerts')
    .orderBy('firedAt', 'desc')
    .limit(Math.min(Math.max(limit, 1), 200))
    .get();
  return snap.docs.map((d) => {
    const x = d.data();
    return {
      id: d.id,
      kind: x.kind,
      severity: x.severity,
      message: x.message,
      data: x.data ?? {},
      firedAt: x.firedAt?.toDate?.() ?? x.firedAt,
      acknowledged: Boolean(x.acknowledged),
      acknowledgedAt: x.acknowledgedAt?.toDate?.() ?? x.acknowledgedAt,
      acknowledgedBy: x.acknowledgedBy ?? null,
    };
  });
}

export async function acknowledgeAlert(alertId: string, adminUid: string): Promise<void> {
  if (!firebaseAvailable) return;
  await db.collection('costAlerts').doc(alertId).set(
    {
      acknowledged: true,
      acknowledgedAt: new Date(),
      acknowledgedBy: adminUid,
    },
    { merge: true }
  );
}
