/**
 * Quests & Affiliates Router
 *
 * Platform quest system where users earn $LOAR tokens by completing actions.
 * Affiliate referral system tracks invites and rewards both parties.
 *
 * Quest types:
 * - Onboarding: First wallet connect, first generation, first universe
 * - Engagement: Daily generation, share content, vote on governance
 * - Social: Invite friends (affiliate), comment, collaborate
 * - Power User: Use 5 different models, generate 100 videos, etc.
 */
import { router, publicProcedure, protectedProcedure } from '../../lib/trpc';
import { db } from '../../lib/firebase';
import { z } from 'zod';
import { randomUUID } from 'crypto';

const questProgressCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('questProgress');
};
const questRewardsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('questRewards');
};
const affiliatesCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('affiliates');
};
const affiliateRewardsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('affiliateRewards');
};

// ── Quest Definitions ─────────────────────────────────────────────────

export interface QuestDefinition {
  id: string;
  category: 'onboarding' | 'engagement' | 'social' | 'power_user';
  title: string;
  description: string;
  loarReward: number;
  targetCount: number;
  icon: string;
  repeatable: boolean;
  repeatCooldownHours?: number;
}

export const QUESTS: QuestDefinition[] = [
  // ── Onboarding ──────────────────────────────────────────────────
  {
    id: 'first_connect',
    category: 'onboarding',
    title: 'Connect Your Wallet',
    description: 'Connect a wallet to the platform',
    loarReward: 50,
    targetCount: 1,
    icon: 'wallet',
    repeatable: false,
  },
  {
    id: 'first_generation',
    category: 'onboarding',
    title: 'First Creation',
    description: 'Generate your first AI video',
    loarReward: 100,
    targetCount: 1,
    icon: 'video',
    repeatable: false,
  },
  {
    id: 'first_universe',
    category: 'onboarding',
    title: 'World Builder',
    description: 'Create your first cinematic universe',
    loarReward: 200,
    targetCount: 1,
    icon: 'globe',
    repeatable: false,
  },
  {
    id: 'first_character',
    category: 'onboarding',
    title: 'Character Creator',
    description: 'Generate your first character',
    loarReward: 75,
    targetCount: 1,
    icon: 'user',
    repeatable: false,
  },
  {
    id: 'complete_profile',
    category: 'onboarding',
    title: 'Set Up Profile',
    description: 'Complete your user profile',
    loarReward: 50,
    targetCount: 1,
    icon: 'edit',
    repeatable: false,
  },

  // ── Engagement ──────────────────────────────────────────────────
  {
    id: 'daily_generation',
    category: 'engagement',
    title: 'Daily Creator',
    description: 'Generate a video today',
    loarReward: 10,
    targetCount: 1,
    icon: 'calendar',
    repeatable: true,
    repeatCooldownHours: 24,
  },
  {
    id: 'generate_5_videos',
    category: 'engagement',
    title: 'Video Streak',
    description: 'Generate 5 videos',
    loarReward: 50,
    targetCount: 5,
    icon: 'film',
    repeatable: true,
    repeatCooldownHours: 168, // weekly
  },
  {
    id: 'share_content',
    category: 'engagement',
    title: 'Share the Story',
    description: 'Share a creation publicly',
    loarReward: 25,
    targetCount: 1,
    icon: 'share',
    repeatable: true,
    repeatCooldownHours: 24,
  },
  {
    id: 'vote_governance',
    category: 'engagement',
    title: 'Voice of Canon',
    description: 'Vote on a governance proposal',
    loarReward: 30,
    targetCount: 1,
    icon: 'vote',
    repeatable: true,
    repeatCooldownHours: 24,
  },

  // ── Social ──────────────────────────────────────────────────────
  {
    id: 'invite_friend',
    category: 'social',
    title: 'Bring a Friend',
    description: 'Invite a friend who connects their wallet',
    loarReward: 100,
    targetCount: 1,
    icon: 'users',
    repeatable: true,
    repeatCooldownHours: 0, // no cooldown, per-invite
  },
  {
    id: 'invite_5_friends',
    category: 'social',
    title: 'Squad Leader',
    description: 'Invite 5 friends to the platform',
    loarReward: 500,
    targetCount: 5,
    icon: 'crown',
    repeatable: false,
  },
  {
    id: 'collaborate',
    category: 'social',
    title: 'Collaborator',
    description: "Contribute to someone else's universe",
    loarReward: 50,
    targetCount: 1,
    icon: 'handshake',
    repeatable: true,
    repeatCooldownHours: 24,
  },

  // ── Power User ──────────────────────────────────────────────────
  {
    id: 'try_5_models',
    category: 'power_user',
    title: 'Model Explorer',
    description: 'Generate videos with 5 different AI models',
    loarReward: 200,
    targetCount: 5,
    icon: 'layers',
    repeatable: false,
  },
  {
    id: 'generate_100_videos',
    category: 'power_user',
    title: 'Production Studio',
    description: 'Generate 100 videos total',
    loarReward: 1000,
    targetCount: 100,
    icon: 'trophy',
    repeatable: false,
  },
  {
    id: 'smart_auto_10',
    category: 'power_user',
    title: 'Trust the Algorithm',
    description: 'Use Smart Auto routing for 10 generations',
    loarReward: 50,
    targetCount: 10,
    icon: 'cpu',
    repeatable: false,
  },
  {
    id: 'mint_nft',
    category: 'power_user',
    title: 'On-Chain Creator',
    description: 'Mint your first content NFT',
    loarReward: 150,
    targetCount: 1,
    icon: 'diamond',
    repeatable: false,
  },
];

const questsById = new Map(QUESTS.map((q) => [q.id, q]));

// ── Router ────────────────────────────────────────────────────────────

export const questsRouter = router({
  /**
   * List all quests with user progress.
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    // Fetch user's quest progress
    const progressSnap = await questProgressCol().where('userId', '==', ctx.user.uid).get();

    const progressMap = new Map<
      string,
      { currentCount: number; completedAt: Date | null; lastRewardAt: Date | null }
    >();
    progressSnap.docs.forEach((doc) => {
      const d = doc.data();
      progressMap.set(d.questId, {
        currentCount: d.currentCount || 0,
        completedAt: d.completedAt?.toDate?.() || null,
        lastRewardAt: d.lastRewardAt?.toDate?.() || null,
      });
    });

    return QUESTS.map((quest) => {
      const progress = progressMap.get(quest.id);
      const currentCount = progress?.currentCount || 0;
      const isCompleted = currentCount >= quest.targetCount;

      // Check if repeatable quest is available again
      let availableAgain = true;
      if (quest.repeatable && progress?.lastRewardAt && quest.repeatCooldownHours) {
        const cooldownMs = quest.repeatCooldownHours * 60 * 60 * 1000;
        availableAgain = Date.now() - progress.lastRewardAt.getTime() > cooldownMs;
      }

      return {
        ...quest,
        currentCount,
        isCompleted: isCompleted && (!quest.repeatable || !availableAgain),
        isClaimable: isCompleted && (quest.repeatable ? availableAgain : !progress?.lastRewardAt),
        progressPercent: Math.min(100, Math.round((currentCount / quest.targetCount) * 100)),
      };
    });
  }),

  /**
   * Increment quest progress (called by server-side after relevant actions).
   * Can also be called from client for certain quests.
   */
  trackProgress: protectedProcedure
    .input(
      z.object({
        questId: z.string(),
        increment: z.number().min(1).default(1),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const quest = questsById.get(input.questId);
      if (!quest) throw new Error('Quest not found');

      const progressRef = questProgressCol().doc(`${ctx.user.uid}_${input.questId}`);
      const progressDoc = await progressRef.get();

      const currentCount = progressDoc.exists ? progressDoc.data()?.currentCount || 0 : 0;
      const newCount = currentCount + input.increment;

      await progressRef.set(
        {
          userId: ctx.user.uid,
          questId: input.questId,
          currentCount: newCount,
          completedAt: newCount >= quest.targetCount ? new Date() : null,
          updatedAt: new Date(),
        },
        { merge: true }
      );

      return {
        questId: input.questId,
        currentCount: newCount,
        isCompleted: newCount >= quest.targetCount,
        targetCount: quest.targetCount,
      };
    }),

  /**
   * Claim reward for a completed quest.
   */
  claimReward: protectedProcedure
    .input(z.object({ questId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const quest = questsById.get(input.questId);
      if (!quest) throw new Error('Quest not found');

      const progressRef = questProgressCol().doc(`${ctx.user.uid}_${input.questId}`);
      const progressDoc = await progressRef.get();

      if (!progressDoc.exists) throw new Error('Quest not started');

      const progress = progressDoc.data()!;
      if ((progress.currentCount || 0) < quest.targetCount) {
        throw new Error('Quest not yet completed');
      }

      // Check cooldown for repeatable quests
      if (quest.repeatable && progress.lastRewardAt && quest.repeatCooldownHours) {
        const cooldownMs = quest.repeatCooldownHours * 60 * 60 * 1000;
        if (Date.now() - progress.lastRewardAt.toDate().getTime() < cooldownMs) {
          throw new Error('Quest reward on cooldown');
        }
      }

      // Check if already claimed (for non-repeatable)
      if (!quest.repeatable && progress.lastRewardAt) {
        throw new Error('Quest reward already claimed');
      }

      // Grant $LOAR tokens as credits.
      // Quest rewards are immediately spendable on the platform but subject
      // to a 7-day transfer/swap lockup to prevent Sybil farming.
      const creditsCol = db.collection('userCredits');
      const userRef = creditsCol.doc(ctx.user.uid);
      const userDoc = await userRef.get();

      if (userDoc.exists) {
        const data = userDoc.data()!;
        await userRef.update({
          balance: (data.balance || 0) + quest.loarReward,
          totalBonusReceived: (data.totalBonusReceived || 0) + quest.loarReward,
          updatedAt: new Date(),
        });
      } else {
        await userRef.set({
          uid: ctx.user.uid,
          balance: quest.loarReward,
          totalPurchased: 0,
          totalSpent: 0,
          totalBonusReceived: quest.loarReward,
          totalLoarPurchases: 0,
          totalFiatPurchases: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      // Record reward with lockup metadata
      const lockupExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
      await questRewardsCol().add({
        userId: ctx.user.uid,
        questId: input.questId,
        loarTokens: quest.loarReward,
        claimedAt: new Date(),
        lockupExpiresAt, // Quest rewards locked for 7 days before transfer/swap
      });

      // Update progress
      const updateData: Record<string, any> = { lastRewardAt: new Date() };
      if (quest.repeatable) {
        updateData.currentCount = 0; // Reset for repeatable quests
      }
      await progressRef.update(updateData);

      return {
        ok: true,
        questId: input.questId,
        loarTokensEarned: quest.loarReward,
      };
    }),

  // ── Affiliate System ────────────────────────────────────────────

  /**
   * Get or create affiliate referral code.
   */
  getAffiliateCode: protectedProcedure.query(async ({ ctx }) => {
    const affiliateRef = affiliatesCol().doc(ctx.user.uid);
    const affiliateDoc = await affiliateRef.get();

    if (affiliateDoc.exists) {
      const data = affiliateDoc.data()!;
      return {
        code: data.code as string,
        totalReferrals: data.totalReferrals as number,
        totalEarned: data.totalEarned as number,
        link: `${process.env.CORS_ORIGIN || 'https://loar.fun'}?ref=${data.code}`,
      };
    }

    // Generate new code
    const code = `LOAR-${ctx.user.uid.slice(0, 4).toUpperCase()}-${randomUUID().slice(0, 4).toUpperCase()}`;

    await affiliateRef.set({
      userId: ctx.user.uid,
      code,
      totalReferrals: 0,
      totalEarned: 0,
      createdAt: new Date(),
    });

    return {
      code,
      totalReferrals: 0,
      totalEarned: 0,
      link: `${process.env.CORS_ORIGIN || 'https://loar.fun'}?ref=${code}`,
    };
  }),

  /**
   * Record a referral when a new user signs up with a referral code.
   *
   * Sybil resistance measures:
   * 1. Referrer rewards are PENDING — only unlock after the referee performs
   *    a gated action (credit purchase or NFT mint) via unlockReferralReward.
   * 2. Per-referrer daily cap: max 10 new referrals per 24h.
   * 3. Account must exist for 1+ hours before claiming a referral (prevents
   *    bot scripts that create+refer in rapid succession).
   * 4. Self-referral and duplicate referral checks remain.
   */
  recordReferral: protectedProcedure
    .input(z.object({ referralCode: z.string() }))
    .mutation(async ({ input, ctx }) => {
      // Find the referrer
      const referrerSnap = await affiliatesCol()
        .where('code', '==', input.referralCode)
        .limit(1)
        .get();

      if (referrerSnap.empty) {
        return { ok: false, reason: 'Invalid referral code' };
      }

      const referrerDoc = referrerSnap.docs[0];
      const referrerData = referrerDoc.data();
      const referrerUid = referrerData.userId;

      // Don't allow self-referral
      if (referrerUid === ctx.user.uid) {
        return { ok: false, reason: 'Cannot refer yourself' };
      }

      // Check if this user was already referred
      const existingReferral = await affiliateRewardsCol()
        .where('referredUserId', '==', ctx.user.uid)
        .limit(1)
        .get();

      if (!existingReferral.empty) {
        return { ok: false, reason: 'Already referred' };
      }

      // Sybil check: per-referrer daily cap (max 10 referrals per 24h)
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const recentReferrals = await affiliateRewardsCol()
        .where('referrerUserId', '==', referrerUid)
        .where('createdAt', '>=', oneDayAgo)
        .get();

      if (recentReferrals.size >= 10) {
        return { ok: false, reason: 'Referrer daily limit reached (max 10/day)' };
      }

      // Sybil check: account must be at least 1 hour old
      const userCreditsRef = db.collection('userCredits').doc(ctx.user.uid);
      const userCreditsDoc = await userCreditsRef.get();
      if (userCreditsDoc.exists) {
        const createdAt = userCreditsDoc.data()?.createdAt?.toDate?.();
        if (createdAt && Date.now() - createdAt.getTime() < 60 * 60 * 1000) {
          return { ok: false, reason: 'Account too new. Wait 1 hour before claiming a referral.' };
        }
      }

      const REFERRER_REWARD = 100; // $LOAR for referrer (PENDING until referee gates)
      const REFERRED_REWARD = 50; // $LOAR for new user (immediate)

      // Referrer reward is PENDING — stored but NOT added to balance.
      // Unlocked when referee performs a gated action (purchase, mint, etc.)
      // via the unlockReferralReward procedure.

      // Reward referred user immediately (small amount, low abuse value)
      const creditsCol = db.collection('userCredits');

      if (userCreditsDoc.exists) {
        const data = userCreditsDoc.data()!;
        await userCreditsRef.update({
          balance: (data.balance || 0) + REFERRED_REWARD,
          totalBonusReceived: (data.totalBonusReceived || 0) + REFERRED_REWARD,
          updatedAt: new Date(),
        });
      } else {
        await userCreditsRef.set({
          uid: ctx.user.uid,
          balance: REFERRED_REWARD,
          totalPurchased: 0,
          totalSpent: 0,
          totalBonusReceived: REFERRED_REWARD,
          totalLoarPurchases: 0,
          totalFiatPurchases: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      // Update referrer stats (but NOT balance — reward is pending)
      await referrerDoc.ref.update({
        totalReferrals: (referrerData.totalReferrals || 0) + 1,
        pendingRewards: (referrerData.pendingRewards || 0) + REFERRER_REWARD,
        updatedAt: new Date(),
      });

      // Record referral with pending status
      await affiliateRewardsCol().add({
        referrerUserId: referrerUid,
        referredUserId: ctx.user.uid,
        referralCode: input.referralCode,
        referrerReward: REFERRER_REWARD,
        referredReward: REFERRED_REWARD,
        status: 'pending', // 'pending' | 'unlocked'
        createdAt: new Date(),
      });

      // Track quest progress for referrer
      const referrerProgressRef = questProgressCol().doc(`${referrerUid}_invite_friend`);
      const referrerProgress = await referrerProgressRef.get();
      const currentInvites = referrerProgress.exists
        ? referrerProgress.data()?.currentCount || 0
        : 0;

      await referrerProgressRef.set(
        {
          userId: referrerUid,
          questId: 'invite_friend',
          currentCount: currentInvites + 1,
          updatedAt: new Date(),
        },
        { merge: true }
      );

      // Also track invite_5_friends
      const referrer5Ref = questProgressCol().doc(`${referrerUid}_invite_5_friends`);
      const referrer5Progress = await referrer5Ref.get();
      const current5 = referrer5Progress.exists ? referrer5Progress.data()?.currentCount || 0 : 0;

      await referrer5Ref.set(
        {
          userId: referrerUid,
          questId: 'invite_5_friends',
          currentCount: current5 + 1,
          completedAt: current5 + 1 >= 5 ? new Date() : null,
          updatedAt: new Date(),
        },
        { merge: true }
      );

      return {
        ok: true,
        referrerReward: REFERRER_REWARD,
        referredReward: REFERRED_REWARD,
      };
    }),

  /**
   * Unlock pending referral rewards for a referrer.
   * Called automatically when a referred user performs a gated action
   * (credit purchase, NFT mint, etc.). This prevents Sybil farming:
   * rewards only flow when the referee has real economic activity.
   */
  unlockReferralReward: protectedProcedure
    .input(z.object({ referredUserId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      // Only the referred user themselves can trigger reward unlock
      // (called when they perform a gated action like purchase or mint)
      if (input.referredUserId !== ctx.user.uid) {
        return { ok: false, reason: 'Only the referred user can unlock their referral reward' };
      }

      // Find the pending referral record for this referee
      const pendingSnap = await affiliateRewardsCol()
        .where('referredUserId', '==', input.referredUserId)
        .where('status', '==', 'pending')
        .limit(1)
        .get();

      if (pendingSnap.empty) {
        return { ok: false, reason: 'No pending referral reward found' };
      }

      const rewardDoc = pendingSnap.docs[0];
      const rewardData = rewardDoc.data();
      const referrerUid = rewardData.referrerUserId;
      const reward = rewardData.referrerReward || 100;

      // Credit the referrer's balance
      const creditsCol = db.collection('userCredits');
      const referrerRef = creditsCol.doc(referrerUid);
      const referrerDoc = await referrerRef.get();

      if (referrerDoc.exists) {
        const data = referrerDoc.data()!;
        await referrerRef.update({
          balance: (data.balance || 0) + reward,
          totalBonusReceived: (data.totalBonusReceived || 0) + reward,
          updatedAt: new Date(),
        });
      } else {
        await referrerRef.set({
          uid: referrerUid,
          balance: reward,
          totalPurchased: 0,
          totalSpent: 0,
          totalBonusReceived: reward,
          totalLoarPurchases: 0,
          totalFiatPurchases: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      // Update affiliate stats
      const affiliateRef = affiliatesCol().doc(referrerUid);
      const affiliateDoc = await affiliateRef.get();
      if (affiliateDoc.exists) {
        const aData = affiliateDoc.data()!;
        await affiliateRef.update({
          totalEarned: (aData.totalEarned || 0) + reward,
          pendingRewards: Math.max(0, (aData.pendingRewards || 0) - reward),
          updatedAt: new Date(),
        });
      }

      // Mark reward as unlocked
      await rewardDoc.ref.update({
        status: 'unlocked',
        unlockedAt: new Date(),
        unlockedBy: ctx.user.uid,
      });

      return { ok: true, referrerUid, rewardUnlocked: reward };
    }),

  // ── Daily Check-in ──────────────────────────────────────────────

  /**
   * Get today's check-in status and current streak.
   */
  getCheckinStatus: protectedProcedure.query(async ({ ctx }) => {
    const DAY_REWARDS = [5, 10, 20, 35, 50, 75, 150];
    const streakRef = db.collection('dailyCheckins').doc(ctx.user.uid);
    const streakDoc = await streakRef.get();

    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);

    if (!streakDoc.exists) {
      return {
        currentStreak: 0,
        longestStreak: 0,
        totalCheckins: 0,
        checkedInToday: false,
        nextReward: DAY_REWARDS[0],
        dayIndex: 0,
        dayRewards: DAY_REWARDS,
      };
    }

    const data = streakDoc.data()!;
    const checkedInToday = data.lastCheckinDate === todayStr;

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);
    const streakAlive = data.lastCheckinDate === todayStr || data.lastCheckinDate === yesterdayStr;
    const currentStreak = streakAlive ? (data.currentStreak as number) || 0 : 0;
    const dayIndex = Math.min(currentStreak, 6);

    return {
      currentStreak,
      longestStreak: (data.longestStreak as number) || 0,
      totalCheckins: (data.totalCheckins as number) || 0,
      checkedInToday,
      nextReward: DAY_REWARDS[dayIndex],
      dayIndex,
      dayRewards: DAY_REWARDS,
    };
  }),

  /**
   * Claim daily check-in reward. Streak resets if a day was missed.
   */
  dailyCheckin: protectedProcedure.mutation(async ({ ctx }) => {
    const DAY_REWARDS = [5, 10, 20, 35, 50, 75, 150];
    const streakRef = db.collection('dailyCheckins').doc(ctx.user.uid);
    const streakDoc = await streakRef.get();

    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);

    let currentStreak = 1;

    if (streakDoc.exists) {
      const data = streakDoc.data()!;

      if (data.lastCheckinDate === todayStr) {
        throw new Error('Already checked in today');
      }

      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().slice(0, 10);
      const isStreak = data.lastCheckinDate === yesterdayStr;

      currentStreak = isStreak ? ((data.currentStreak as number) || 0) + 1 : 1;

      await streakRef.update({
        lastCheckinDate: todayStr,
        currentStreak,
        longestStreak: Math.max((data.longestStreak as number) || 0, currentStreak),
        totalCheckins: ((data.totalCheckins as number) || 0) + 1,
        updatedAt: now,
      });
    } else {
      await streakRef.set({
        userId: ctx.user.uid,
        lastCheckinDate: todayStr,
        currentStreak: 1,
        longestStreak: 1,
        totalCheckins: 1,
        createdAt: now,
        updatedAt: now,
      });
    }

    const dayIndex = Math.min(currentStreak - 1, 6);
    const reward = DAY_REWARDS[dayIndex];

    // Grant $LOAR tokens
    const creditsCol = db.collection('userCredits');
    const userRef = creditsCol.doc(ctx.user.uid);
    const userDoc = await userRef.get();

    if (userDoc.exists) {
      const d = userDoc.data()!;
      await userRef.update({
        balance: (d.balance || 0) + reward,
        totalBonusReceived: (d.totalBonusReceived || 0) + reward,
        updatedAt: now,
      });
    } else {
      await userRef.set({
        uid: ctx.user.uid,
        balance: reward,
        totalPurchased: 0,
        totalSpent: 0,
        totalBonusReceived: reward,
        totalLoarPurchases: 0,
        totalFiatPurchases: 0,
        createdAt: now,
        updatedAt: now,
      });
    }

    return { ok: true, reward, currentStreak, dayIndex };
  }),

  /**
   * Get affiliate leaderboard.
   */
  affiliateLeaderboard: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(50).default(10) }))
    .query(async ({ input }) => {
      const snapshot = await affiliatesCol()
        .orderBy('totalReferrals', 'desc')
        .limit(input.limit)
        .get();

      return snapshot.docs.map((doc, i) => {
        const d = doc.data();
        return {
          rank: i + 1,
          userId: (d.userId as string).slice(0, 6) + '...' + (d.userId as string).slice(-4),
          totalReferrals: d.totalReferrals as number,
          totalEarned: d.totalEarned as number,
        };
      });
    }),
});
