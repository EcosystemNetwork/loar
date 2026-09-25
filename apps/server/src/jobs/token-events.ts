/**
 * Token event notifications — turns indexer state changes into in-app
 * notifications (the bell) and pushes:
 *   • a creator you follow launched a token        → followers of the deployer
 *   • a token you watch graduated / was halted     → watchers of that token
 *
 * Polls the Ponder indexer, diffs against the last-seen state in Firestore
 * (`tokenEventState/{tokenAddress}`) and emits only on transitions. The first
 * ever run only seeds state (otherwise every existing token would fire at
 * once). Opt-in — set TOKEN_EVENTS_ENABLED=true on ONE replica.
 */
import { db, firebaseAvailable } from '../lib/firebase';
import { ponderQuery } from '../lib/ponder';
import { sendNotification } from '../services/activity';
import { sendPushToUser } from '../services/push-notifications';

const DEFAULT_INTERVAL_MS = 2 * 60 * 1000;
const MIN_INTERVAL_MS = 60_000;
const MAX_RECIPIENTS = 500;

let timer: NodeJS.Timeout | null = null;

export interface TokenSnapshot {
  id: string;
  symbol: string;
  name: string;
  deployer: string;
  graduated: boolean;
  halted: boolean;
}
export interface SeenState {
  graduated: boolean;
  halted: boolean;
}
export type TokenEvent = 'launch' | 'graduated' | 'halted';

/** Which events a token's move from `prev` (undefined = never seen) to `cur` produced. */
export function diffTokenEvents(prev: SeenState | undefined, cur: TokenSnapshot): TokenEvent[] {
  const events: TokenEvent[] = [];
  if (!prev) {
    events.push('launch');
    // A token first seen already graduated/halted has nothing to announce beyond the launch.
    return events;
  }
  if (!prev.graduated && cur.graduated) events.push('graduated');
  if (!prev.halted && cur.halted) events.push('halted');
  return events;
}

async function fetchSnapshots(): Promise<TokenSnapshot[] | null> {
  const data = await ponderQuery<{
    tokens: { items: { id: string; symbol: string; name: string; deployer: string }[] };
    bondingCurves: {
      items: { tokenAddress: string; graduated: boolean; tradingStatus: string }[];
    };
  }>(`query {
    tokens(orderBy: "createdAt", orderDirection: "desc", limit: 200) { items { id symbol name deployer } }
    bondingCurves(limit: 500) { items { tokenAddress graduated tradingStatus } }
  }`);
  if (!data?.tokens?.items) return null; // indexer unreachable — skip this tick entirely
  const curves = new Map(
    (data.bondingCurves?.items ?? []).map((c) => [c.tokenAddress.toLowerCase(), c])
  );
  return data.tokens.items.map((t) => {
    const c = curves.get(t.id.toLowerCase());
    return {
      id: t.id.toLowerCase(),
      symbol: t.symbol,
      name: t.name,
      deployer: t.deployer.toLowerCase(),
      graduated: !!c && (c.graduated || c.tradingStatus === 'graduated'),
      halted: !!c && c.tradingStatus === 'halted',
    };
  });
}

async function notify(
  recipients: string[],
  n: Parameters<typeof sendNotification>[0] extends infer P
    ? Omit<Extract<P, object>, 'recipientUid'>
    : never,
  push: { title: string; body: string; url: string; kind: string; token: string }
) {
  for (const uid of recipients.slice(0, MAX_RECIPIENTS)) {
    await sendNotification({ ...n, recipientUid: uid });
    try {
      await sendPushToUser(uid, {
        title: push.title,
        body: push.body,
        url: push.url,
        data: { kind: push.kind, tokenAddress: push.token },
      });
    } catch {
      /* push is best-effort */
    }
  }
}

export async function runTokenEventSweep(): Promise<number> {
  if (!db) return 0;
  const snaps = await fetchSnapshots();
  if (!snaps || snaps.length === 0) return 0;

  const stateCol = db.collection('tokenEventState');
  const seeded = !(await stateCol.limit(1).get()).empty;
  let emitted = 0;

  for (const cur of snaps) {
    const ref = stateCol.doc(cur.id);
    const prevDoc = await ref.get();
    const prev = prevDoc.exists ? (prevDoc.data() as SeenState) : undefined;
    const events = seeded ? diffTokenEvents(prev, cur) : [];

    for (const ev of events) {
      const sym = `$${cur.symbol}`;
      const url = `/tokens/${cur.id}`;
      if (ev === 'launch') {
        const f = await db
          .collection('follows')
          .where('followedUid', '==', cur.deployer)
          .limit(MAX_RECIPIENTS)
          .get();
        const followers = f.docs.map((d) => d.data().followerUid as string);
        await notify(
          followers,
          {
            type: 'token_launch',
            actorUid: cur.deployer,
            message: `A creator you follow launched ${sym} — ${cur.name}`,
            targetType: 'token',
            targetId: cur.id,
          },
          {
            title: `New launch: ${sym}`,
            body: `${cur.name} from a creator you follow.`,
            url,
            kind: 'token-launch',
            token: cur.id,
          }
        );
        emitted += followers.length;
      } else {
        const w = await db
          .collection('tokenWatchlist')
          .where('tokenAddress', '==', cur.id)
          .limit(MAX_RECIPIENTS)
          .get();
        const watchers = w.docs.map((d) => d.data().uid as string);
        const graduated = ev === 'graduated';
        await notify(
          watchers,
          {
            type: graduated ? 'token_graduated' : 'token_halted',
            actorUid: cur.id,
            message: graduated
              ? `${sym} graduated to Uniswap 🎓`
              : `Trading on ${sym} was halted by governance`,
            targetType: 'token',
            targetId: cur.id,
          },
          {
            title: graduated ? `${sym} graduated 🎓` : `${sym} trading halted`,
            body: graduated ? 'It now trades on Uniswap v4.' : 'Check the token page for details.',
            url,
            kind: graduated ? 'token-graduated' : 'token-halted',
            token: cur.id,
          }
        );
        emitted += watchers.length;
      }
    }

    // Persist current state (always — including the seeding pass and no-event ticks).
    if (!prev || prev.graduated !== cur.graduated || prev.halted !== cur.halted) {
      await ref.set({ graduated: cur.graduated, halted: cur.halted, updatedAt: new Date() });
    }
  }
  return emitted;
}

export function startTokenEventJob(): void {
  if (process.env.TOKEN_EVENTS_ENABLED !== 'true') return;
  if (!firebaseAvailable || !db) {
    console.warn('[token-events] Firebase unavailable — job not started');
    return;
  }
  if (timer) return;
  const raw = parseInt(process.env.TOKEN_EVENTS_INTERVAL_MS ?? '', 10);
  const interval = Number.isFinite(raw) && raw >= MIN_INTERVAL_MS ? raw : DEFAULT_INTERVAL_MS;
  console.log(`[token-events] enabled — sweep every ${interval / 1000}s`);
  const tick = async () => {
    try {
      const n = await runTokenEventSweep();
      if (n > 0) console.log(`[token-events] sent ${n} notification(s)`);
    } catch (err) {
      console.error('[token-events] sweep failed:', err);
    }
  };
  void tick();
  timer = setInterval(tick, interval);
  if (typeof timer.unref === 'function') timer.unref();
}

export function stopTokenEventJob(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
