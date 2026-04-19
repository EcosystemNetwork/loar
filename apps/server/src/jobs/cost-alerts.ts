/**
 * Cost / margin alert sweep — runs on a timer in ONE replica.
 *
 * Checks the daily margin against target + the platform daily cap, posts
 * Slack + writes `costAlerts/` when either breaches. Controls are read from
 * `costControls/platform` via the cost-tracker module (30s cache), so admin
 * changes propagate within one window.
 *
 * Opt-in — set COST_ALERT_ENABLED=true on the replica that should run it.
 * Multi-replica deploys should only enable on one (same pattern as
 * ABUSE_DETECT_ENABLED / DMCA_PUTBACK_ENABLED).
 */

import { runAlertSweep } from '../services/cost-tracker';

const DEFAULT_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

let timer: NodeJS.Timeout | null = null;

export function startCostAlertJob(): void {
  if (process.env.COST_ALERT_ENABLED !== 'true') return;
  if (timer) return;
  const raw = parseInt(process.env.COST_ALERT_INTERVAL_MS ?? '', 10);
  const interval = Number.isFinite(raw) && raw >= 60_000 ? raw : DEFAULT_INTERVAL_MS;
  console.log(`[cost-alerts] enabled — sweep every ${interval / 1000}s`);

  const tick = async () => {
    try {
      const fired = await runAlertSweep();
      if (fired.length) {
        console.log(
          `[cost-alerts] fired ${fired.length} alert(s): ${fired.map((a) => a.kind).join(', ')}`
        );
      }
    } catch (err) {
      console.error('[cost-alerts] sweep failed:', err);
    }
  };

  // Kick off once at startup so a pre-existing breach fires quickly.
  void tick();
  timer = setInterval(tick, interval);
  if (typeof timer.unref === 'function') timer.unref();
}

export function stopCostAlertJob(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
