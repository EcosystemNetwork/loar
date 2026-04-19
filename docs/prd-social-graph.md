# PRD: Social Graph (Follows, Comments, Notifications)

> **Status**: Draft. Unscheduled — this is the "retention loop" PRD the
> platform needs once the creation loop is stable. Needs scoping, design,
> and legal review (spam / harassment policy) before build starts.
>
> **Last updated**: 2026-04-19
>
> **Author**: (placeholder — assign before kickoff)

## Problem

The platform has strong creation loops (universes, generations, NFTs) but
zero retention loops. A creator who mints an episode has no mechanism to
bring their audience back next week. The three basic primitives — follows,
comments, notifications — are table stakes for every content platform and
not present in the current codebase (grep: no follows/comments/notifications
collections in Firestore).

## Goals

1. Creators can accumulate **followers** (wallet-keyed, portable).
2. Viewers can **comment** on content and universes.
3. Both parties get **notifications** when something relevant happens
   (new episode, reply, like, canon vote, takedown resolution).
4. Everything is wallet-native, no email required, no PII locked in our DB.

## Non-goals

- Full Twitter-like feed (ranking, replies-of-replies depth > 1, quote-posts).
  Out of scope for v1.
- Paid messages or tips — handled elsewhere.
- On-chain follows. Keep this off-chain; see "Why off-chain" below.

## User stories

| As a …  | I want to …                                   | So I can …                                  |
| ------- | --------------------------------------------- | ------------------------------------------- |
| creator | see my follower count and a list of followers | understand my audience + reach out directly |
| creator | push a notification when I mint a new episode | re-engage my audience                       |
| viewer  | follow a creator                              | get notified when they post something       |
| viewer  | comment on an episode or universe             | participate in the narrative                |
| viewer  | mute / block another account                  | stay safe from harassment                   |
| admin   | remove a comment or ban a commenter           | enforce content policy                      |

## Why off-chain

An on-chain social graph sounds ideologically right but is wrong here:

- Gas for every follow/unfollow → kills the UX we bought with the paymaster
- Immutable follower lists → privacy nightmare, GDPR non-compliance
- No delete/mute semantics → harassment tools break

Follow/comment data lives in Firestore. Content being followed (universes,
episodes) can be on-chain — that's a normal cross-reference.

## Data model

New Firestore collections:

```
follows/{followId}
  followerAddress: string   // 0x… lowercased
  followeeAddress: string   // 0x… lowercased
  createdAt: timestamp
  // Composite index: (followeeAddress, createdAt desc) for "list my followers"

comments/{commentId}
  targetType: 'content' | 'universe' | 'entity' | 'canon_proposal'
  targetId: string
  authorAddress: string
  authorDisplayName: string  // denormalized from profiles at write time
  body: string               // max 2000 chars, markdown subset
  parentCommentId: string | null  // 1 level of reply nesting only
  contentStatus: 'active' | 'hidden' | 'removed'
  createdAt: timestamp
  updatedAt: timestamp

commentLikes/{autoId}
  commentId: string
  likerAddress: string
  createdAt: timestamp

notifications/{notifId}
  recipientAddress: string
  kind: 'new_follower' | 'new_comment' | 'comment_reply' | 'mint_by_followee'
      | 'like_on_comment' | 'takedown_resolved' | 'canon_vote_result'
  payload: object             // kind-specific
  readAt: timestamp | null
  createdAt: timestamp

userMutes/{autoId}
  muterAddress: string
  mutedAddress: string
  createdAt: timestamp
```

All collections have **wallet-address as the only user identifier**. No email
ever appears in these collections. A separate `profiles` collection (already
exists) maps address → display name.

## API surface

### tRPC

```ts
// Already-existing `socialRouter` needs:
social.follow({ address })            // protectedProcedure
social.unfollow({ address })          // protectedProcedure
social.getFollowers({ address })      // publicProcedure, paginated
social.getFollowing({ address })      // publicProcedure, paginated
social.isFollowing({ address })       // protectedProcedure, returns boolean
social.mute({ address })              // protectedProcedure
social.unmute({ address })

comments.list({ targetType, targetId, limit, cursor }) // publicProcedure
comments.create({ targetType, targetId, body, parentCommentId? }) // protectedProcedure
comments.delete({ commentId })        // protectedProcedure (own) | adminProcedure
comments.like({ commentId })          // protectedProcedure
comments.unlike({ commentId })

notifications.list({ unreadOnly?, limit, cursor }) // protectedProcedure
notifications.markRead({ ids })       // protectedProcedure
notifications.markAllRead()           // protectedProcedure
notifications.unreadCount()           // protectedProcedure — hot path
```

### Notifications push

- **SSE stream** at `/api/notifications/stream` — one long-lived connection
  per logged-in tab. Reuses the existing SSE pattern from collaboration.
- **Web Push** (future — requires VAPID keys + service worker). Phase 2.
- **Email** (future — requires user to opt in with an email on their profile).
  Phase 2.

### Rate limits

| Action            | Limit              |
| ----------------- | ------------------ |
| follow / unfollow | 60 / minute / user |
| comment create    | 10 / minute / user |
| comment like      | 60 / minute / user |
| mute              | 30 / minute / user |

All rate limits go through the existing `consumeRateLimit` util so they're
Redis-backed.

## Moderation

Comments inherit the same `contentStatus` machinery as content:

- Users can flag a comment (`moderation.flag` with targetType='comment')
- Admins review in `/admin/moderation`
- Auto-hide when VLM moderation service scores comment text as abusive
  (requires a text-only moderation provider — Perspective API or Hive text)

Blocklist: a user can mute another user. Muted author's comments are hidden
from the muter's view (but remain visible to others). This is soft mute;
hard block is admin-only.

## Spam / abuse mitigation

- **One comment per minute per (author, target)** — prevents flood posting.
- **Follower blackout** after account is < 24h old — new accounts can't spam
  follow 1000 users to inflate reach signals.
- **Notification batching** — if one user triggers many notifications to the
  same recipient in a minute, batch them ("@alice liked 7 of your comments").
- **Sybil score** (future) — use on-chain activity + age to compute a
  trust score. Sub-threshold accounts get rate-limited more aggressively.

## Metrics

| Metric                                           | SLO       |
| ------------------------------------------------ | --------- |
| `notifications.unreadCount` p95                  | < 50 ms   |
| `comments.list` p95                              | < 300 ms  |
| Notification delivery latency (write → SSE push) | < 2 s p99 |
| Comment creation success rate                    | > 99.5 %  |

Wire all four into Prometheus via the existing metrics helpers.

## Rollout plan

1. **Phase 0** — data model + write paths (follow/unfollow, comment create)
   behind a feature flag `FEATURE_SOCIAL_GRAPH=true`. Dogfood internally.
2. **Phase 1** — read paths + notification pipeline. SSE only, no email.
3. **Phase 2** — moderation wiring (flag a comment, mute a user).
4. **Phase 3** — web push + email opt-in.

Each phase is one-week scope assuming a single backend + frontend engineer.

## Out-of-scope decisions that block kickoff

- [ ] **Handle / username system?** Currently we use `profiles.displayName`
      which is not unique. Do we need @-mentions? If yes, add a unique handle.
- [ ] **Comment editing?** v1 treats comments as immutable; edits require
      a new comment. Decide.
- [ ] **Deletion policy** — GDPR right-to-erasure says yes. Firestore delete
      of own comments. Admin hard-delete is already in the moderation router.
      Confirm with legal this is enough.

## Related

- [prd-moderation-rights-ops.md](prd-moderation-rights-ops.md) — moderation pipeline
- [prd-mobile-consumer-feed-create.md](prd-mobile-consumer-feed-create.md) — feed UX this will feed
- [architecture.md](architecture.md) — where to slot this in the stack
