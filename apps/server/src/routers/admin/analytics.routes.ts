/**
 * admin.analytics — platform-wide site analytics for the admin dashboard
 * (`/admin/dashboard`): total users, signup/DAU trends, subscription tier
 * mix, monetization funnel, universe/episode counts.
 *
 * Financial metrics (revenue, spend, margin) intentionally live in
 * `admin.cost` (services/cost-tracker) instead of being re-derived here —
 * the dashboard route composes both.
 *
 * Reads from the `users` / `walletLogins` collections written by
 * `trackWalletLogin` (apps/server/src/routers/index.ts), plus
 * `cinematicUniverses`, `episodes`, `platformSubscriptions`, and
 * `creditPurchases`.
 */
import { z } from 'zod';
import { router, adminProcedure } from '../../lib/trpc';
import { db } from '../../lib/firebase';

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export const adminAnalyticsRouter = router({
  // ── Headline counts ─────────────────────────────────────────────────
  overview: adminProcedure.query(async () => {
    const usersCol = db.collection('users');
    const loginsCol = db.collection('walletLogins');

    const [totalUsers, newToday, new7d, new30d, universes, episodes, loginsLast24h] =
      await Promise.all([
        usersCol.count().get(),
        usersCol.where('firstLoginAt', '>=', daysAgo(1)).count().get(),
        usersCol.where('firstLoginAt', '>=', daysAgo(7)).count().get(),
        usersCol.where('firstLoginAt', '>=', daysAgo(30)).count().get(),
        db.collection('cinematicUniverses').count().get(),
        db.collection('episodes').count().get(),
        loginsCol.where('loginAt', '>=', daysAgo(1)).count().get(),
      ]);

    // Distinct active wallets in the last 24h. Bounded window, so it's safe
    // to read the docs and dedupe (count() alone can't dedupe) — same
    // pattern as getFunnel/getCohorts in routers/analytics/analytics.routes.ts.
    const recentLoginsSnap = await loginsCol.where('loginAt', '>=', daysAgo(1)).limit(5000).get();
    const activeWallets = new Set<string>();
    recentLoginsSnap.docs.forEach((d) => {
      const addr = d.data().address as string | undefined;
      if (addr) activeWallets.add(addr);
    });

    return {
      totalUsers: totalUsers.data().count,
      newUsers: {
        today: newToday.data().count,
        last7d: new7d.data().count,
        last30d: new30d.data().count,
      },
      dailyActiveWallets: activeWallets.size,
      loginsLast24h: loginsLast24h.data().count,
      totalUniverses: universes.data().count,
      totalEpisodes: episodes.data().count,
    };
  }),

  // ── Daily signup trend, zero-filled so the chart has no gaps ────────
  signupTrend: adminProcedure
    .input(z.object({ days: z.number().min(7).max(90).default(30) }))
    .query(async ({ input }) => {
      const since = daysAgo(input.days);
      const snap = await db
        .collection('users')
        .where('firstLoginAt', '>=', since)
        .orderBy('firstLoginAt', 'asc')
        .get();

      const byDay = new Map<string, number>();
      snap.docs.forEach((d) => {
        const raw = d.data().firstLoginAt;
        const date: Date | undefined = raw?.toDate?.() ?? raw;
        if (!date) return;
        const key = dayKey(date instanceof Date ? date : new Date(date));
        byDay.set(key, (byDay.get(key) ?? 0) + 1);
      });

      const series: { day: string; newUsers: number }[] = [];
      for (let i = input.days - 1; i >= 0; i--) {
        const key = dayKey(daysAgo(i));
        series.push({ day: key, newUsers: byDay.get(key) ?? 0 });
      }

      return { days: input.days, series };
    }),

  // ── Daily active-wallet trend (distinct logins per day) ──────────────
  dailyActiveTrend: adminProcedure
    .input(z.object({ days: z.number().min(7).max(90).default(30) }))
    .query(async ({ input }) => {
      const since = daysAgo(input.days);
      // Bounded window read + client-side dedupe, same pattern as `overview`
      // above and getCohorts in routers/analytics/analytics.routes.ts.
      const snap = await db
        .collection('walletLogins')
        .where('loginAt', '>=', since)
        .orderBy('loginAt', 'asc')
        .limit(20_000)
        .get();

      const byDay = new Map<string, Set<string>>();
      snap.docs.forEach((d) => {
        const data = d.data();
        const raw = data.loginAt;
        const date: Date | undefined = raw?.toDate?.() ?? raw;
        const addr = data.address as string | undefined;
        if (!date || !addr) return;
        const key = dayKey(date instanceof Date ? date : new Date(date));
        if (!byDay.has(key)) byDay.set(key, new Set());
        byDay.get(key)!.add(addr);
      });

      const series: { day: string; activeUsers: number }[] = [];
      for (let i = input.days - 1; i >= 0; i--) {
        const key = dayKey(daysAgo(i));
        series.push({ day: key, activeUsers: byDay.get(key)?.size ?? 0 });
      }

      return { days: input.days, series };
    }),

  // ── Subscription tier distribution (active subscribers, plus a "free"
  // bucket for every other registered user) ────────────────────────────
  subscriptionTiers: adminProcedure.query(async () => {
    const [subsSnap, totalUsers] = await Promise.all([
      db.collection('platformSubscriptions').where('status', '==', 'active').get(),
      db.collection('users').count().get(),
    ]);

    const byTier = new Map<string, number>();
    subsSnap.docs.forEach((d) => {
      const tier = (d.data().tier as string | undefined) ?? 'unknown';
      byTier.set(tier, (byTier.get(tier) ?? 0) + 1);
    });

    const tiers = [...byTier.entries()]
      .map(([tier, count]) => ({ tier, count }))
      .sort((a, b) => a.tier.localeCompare(b.tier));

    const free = Math.max(0, totalUsers.data().count - subsSnap.size);

    return { free, tiers, totalUsers: totalUsers.data().count };
  }),

  // ── Monetization funnel: registered → ever paid → currently subscribed ─
  //
  // "Ever paid" is the union of one-off credit purchasers and active
  // subscribers — a subscription itself is a monetization event even for
  // a user who never bought a one-off credit pack, so it must count here
  // too (not just gate the final "subscribed" stage).
  funnel: adminProcedure.query(async () => {
    const [totalUsers, purchasesSnap, activeSubsSnap] = await Promise.all([
      db.collection('users').count().get(),
      // Bounded read to dedupe by uid — same pattern used throughout this
      // file. completed-only so failed/pending orders don't inflate the count.
      db.collection('creditPurchases').where('status', '==', 'completed').limit(20_000).get(),
      db.collection('platformSubscriptions').where('status', '==', 'active').get(),
    ]);

    const purchasers = new Set<string>();
    purchasesSnap.docs.forEach((d) => {
      const uid = d.data().uid as string | undefined;
      if (uid) purchasers.add(uid.toLowerCase());
    });
    // Subscription doc id is the user's uid (see platformSubscriptions.routes.ts).
    const subscriberUids = new Set(activeSubsSnap.docs.map((d) => d.id.toLowerCase()));

    const everPaid = new Set([...purchasers, ...subscriberUids]);

    return {
      stages: [
        { key: 'registered', label: 'Registered', count: totalUsers.data().count },
        { key: 'paid', label: 'Ever paid', count: everPaid.size },
        { key: 'subscribed', label: 'Subscribed', count: subscriberUids.size },
      ],
    };
  }),
});
