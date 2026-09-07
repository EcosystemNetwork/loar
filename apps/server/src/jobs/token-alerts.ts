/**
 * Token price-alert sweep — evaluates user-defined alerts in `tokenAlerts`
 * against the current ETH-per-token price and pushes a notification when a
 * threshold is crossed. One-shot: a fired alert flips `active: false` so it
 * doesn't spam; the user re-arms from the UI.
 *
 * Opt-in — set TOKEN_ALERT_ENABLED=true on ONE replica (same rule as
 * cost-alerts / abuse-detect). Prices come from the Firestore indexer mirror
 * (`indexer_pools` / `indexer_bondingCurves`); if that mirror isn't populated
 * the sweep simply finds no prices and no-ops.
 */
import { db, firebaseAvailable } from '../lib/firebase';
import { getTokenPrices } from '../services/token-price';
import { sendPushToUser } from '../services/push-notifications';

const DEFAULT_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
const MIN_INTERVAL_MS = 60_000;
/** Don't re-fire the same alert within this window even if still crossed. */
const RETRIGGER_COOLDOWN_MS = 10 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;

interface AlertDoc {
  uid: string;
  tokenAddress: string;
  tokenSymbol?: string;
  kind: 'above' | 'below';
  targetPrice: number;
  chainId?: number;
  active?: boolean;
  lastTriggeredAt?: FirebaseFirestore.Timestamp | null;
}

function fmtPrice(p: number): string {
  return p < 0.001 ? p.toExponential(3) : p.toFixed(8);
}

async function runSweep(): Promise<number> {
  if (!db) return 0;
  const snap = await db.collection('tokenAlerts').where('active', '==', true).limit(2000).get();
  if (snap.empty) return 0;

  const alerts = snap.docs.map((d) => ({ id: d.id, ref: d.ref, ...(d.data() as AlertDoc) }));
  const chainId = alerts[0]?.chainId ?? 11155111;
  const prices = await getTokenPrices(
    alerts.map((a) => a.tokenAddress),
    chainId
  );
  if (prices.size === 0) return 0;

  const now = Date.now();
  let fired = 0;

  for (const a of alerts) {
    const price = prices.get(a.tokenAddress.toLowerCase());
    if (price == null) continue;

    const crossed = a.kind === 'above' ? price >= a.targetPrice : price <= a.targetPrice;
    if (!crossed) continue;

    const lastMs = a.lastTriggeredAt?.toMillis?.() ?? 0;
    if (now - lastMs < RETRIGGER_COOLDOWN_MS) continue;

    const sym = a.tokenSymbol ? `$${a.tokenSymbol}` : 'A token you watch';
    try {
      await sendPushToUser(a.uid, {
        title: `${sym} ${a.kind === 'above' ? 'crossed above' : 'dropped below'} ${fmtPrice(a.targetPrice)} ETH`,
        body: `Now trading at ${fmtPrice(price)} ETH.`,
        url: `/tokens/${a.tokenAddress}`,
        data: { kind: 'token-alert', tokenAddress: a.tokenAddress },
      });
      await a.ref.update({
        active: false,
        lastTriggeredAt: new Date(),
        triggerCount: (Number((a as { triggerCount?: number }).triggerCount) || 0) + 1,
      });
      fired++;
    } catch (err) {
      console.error(`[token-alerts] failed to fire alert ${a.id}:`, err);
    }
  }
  return fired;
}

export function startTokenAlertJob(): void {
  if (process.env.TOKEN_ALERT_ENABLED !== 'true') return;
  if (!firebaseAvailable || !db) {
    console.warn('[token-alerts] Firebase unavailable — job not started');
    return;
  }
  if (timer) return;

  const raw = parseInt(process.env.TOKEN_ALERT_INTERVAL_MS ?? '', 10);
  const interval = Number.isFinite(raw) && raw >= MIN_INTERVAL_MS ? raw : DEFAULT_INTERVAL_MS;
  console.log(`[token-alerts] enabled — sweep every ${interval / 1000}s`);

  const tick = async () => {
    try {
      const fired = await runSweep();
      if (fired > 0) console.log(`[token-alerts] fired ${fired} alert(s)`);
    } catch (err) {
      console.error('[token-alerts] sweep failed:', err);
    }
  };

  void tick();
  timer = setInterval(tick, interval);
  if (typeof timer.unref === 'function') timer.unref();
}

export function stopTokenAlertJob(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
