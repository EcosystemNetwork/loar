# PRD: LOAR Mobile — Workstream 1: Consumer Feed, World Discovery, and Quick Create

**Product:** LOAR Mobile Core
**Workstream:** 1 of 3
**Status:** Draft
**Date:** 2026-03-28
**Platform:** React Native (Expo)

---

## Goal

Ship the first mobile experience that feels like TikTok for viewing narrative content, but lets users become creators in one or two taps.

---

## Problem

LOAR currently feels split across desktop-style surfaces:

- universe launch wizard
- upload page
- character wiki
- universe timeline editor

That works on desktop, but on mobile it will feel fragmented. The app needs a feed-first UX where viewing is the default behavior and creation is contextual and fast. The current route structure and character-first wiki do not yet provide that mobile-native flow.

---

## Vision

When a user opens LOAR mobile, they land in a full-screen vertical feed of scenes, episodes, trailers, and universe clips. Every clip belongs to a world. From that clip, the user can:

- watch
- peek into the universe
- create a branch, person, place, thing, or lore entry
- save or remix the scene

---

## Users

- casual viewers
- fandom explorers
- creators building original universes
- remixers adding lore, people, or places to existing worlds
- collectors who discover content through the feed first

---

## Success Metrics

- day-1 feed session length
- % of viewers who open a universe detail sheet
- % of viewers who hit Create from feed
- % of creators publishing within 2 taps from a clip
- repeat 7-day viewing retention
- repeat 7-day creator retention

---

## Scope

### In scope

- native mobile app shell
- full-screen swipe feed
- universe quick-view sheet
- mobile wiki browsing
- one-tap / two-tap quick-create
- media upload from mobile camera roll
- branch/remix flow from a watched clip
- notifications for likes, canon changes, comments, and world activity

### Out of scope

- full desktop-grade graph editor on phone
- complex token deployment settings
- advanced moderation consoles
- full admin analytics suite

---

## Core UX

### Primary navigation

Bottom tabs:

1. Feed
2. Worlds
3. Create
4. Activity
5. Profile

### Feed card anatomy

**Top-left:**

- universe name
- content lane badge
- event title

**Bottom-left:**

- caption
- tags
- linked people / places / things
- "Open World"

**Right rail:**

- like
- save
- comment
- branch
- create from this
- collect / subscribe / shop

### Quick-create entry points

**From any clip:**

- Branch Scene
- Add Person
- Add Place
- Add Thing
- Add Lore
- Upload Response

**From center Create button:**

- Scene
- Person
- Place
- Thing
- Faction
- Lore
- Universe
- Upload Media

---

## Functional Requirements

### Feed

- infinite vertical feed
- algorithmic + following + universe-specific feed tabs
- video autoplay, pause on tap
- preload next clip
- show universe tags and related entity chips
- support AI videos, uploaded videos, images, and mixed media posts

### World peek

- universe bottom sheet from clip
- mini wiki cards for linked entities
- fast browse for people, places, things, factions, events, lore
- "continue watching this universe" CTA

### Quick create

- contextual creation prefilled with current universe and source event
- scene generation flow with prompt + style + publish
- person/place/thing/lore forms compressed for mobile
- publish to universe in current context
- allow draft save

### Mobile wiki

The current wiki is character-centric; mobile wiki must become universe-centric. Today the server wiki surface is centered on character fetches and event wiki generation, while entities exist in a separate router. Mobile should unify those.

Required sections:

- People
- Places
- Things
- Factions
- Events
- Lore
- Timelines / Realms

---

## Technical Approach

### Client stack

- React Native with Expo
- TanStack Query
- tRPC client shared with existing backend
- shared types package with web
- mobile wallet auth via WalletConnect / Reown-compatible flow
- native media picker + camera integration

### Backend reuse

Use existing:

- content
- wiki
- generation
- entities
- profiles
- analytics
- subscriptions
- credits

### New backend endpoints required

- `content.feedMobile` — enriched feed with entity chips + universe snippet
- `universes.preview` — compact summary payload
- `content.branch({sourceContentId, universeId})` — branch/remix mutation
- `notifications.*` router (basic in-app + push token registration)
- `entities.suggest({contentId})` — prefill quick-create from clip context

### Data model changes

The current entities backend is oriented around timeline/reality/dimension/plane/realm/domain. That is fine as deep ontology, but mobile must expose simpler first-class types like person, place, thing, faction, event, and lore.

---

## Screens

- splash / auth
- feed
- universe quick sheet
- full universe detail
- entity detail
- create menu
- quick create scene
- quick create person
- quick create place
- quick create thing
- quick create lore
- notifications
- profile

---

## Dependencies

- feed ranking service
- mobile auth
- mobile media upload
- entity schema expansion (implemented — PRD 7)
- compact wiki APIs

---

## Milestones

1. shell + auth + feed
2. universe peek + mobile wiki
3. quick-create flows
4. polish + notifications + beta

---

## Definition of Done

A new user can install the app, watch clips, open a world, create a person or scene from a clip, and publish without touching the desktop site.

---

## Production Requirements

### 1. Performance Contracts

Every screen and interaction has a measurable SLA. These are non-negotiable gates for beta release.

#### Launch and Navigation

| Interaction                                                                            | Target                                                  | Measurement method                                                                    |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Cold launch to first frame (JS bundle hydrated, splash shown)                          | < 1200ms on a 2021 mid-range Android                    | Expo `performance.now()` from process start to first `useEffect` on the splash screen |
| Feed first clip visible (video thumbnail rendered + autoplay starts)                   | < 2000ms from cold launch                               | Custom trace: `feed_session_started` → `clip_viewed` first event                      |
| Feed swipe-to-next latency (gesture release to next clip fully rendered)               | < 100ms perceived; next clip fully playing within 300ms | Reanimated gesture callback timestamp to video `onReadyForDisplay` callback           |
| Universe peek sheet open time (bottom sheet spring animation complete + data visible)  | < 250ms animation; data < 600ms                         | Sheet `onOpen` to `onContentReady` trace                                              |
| Quick-create form ready (sheet open + entity prefill from `entities.suggest` complete) | < 400ms                                                 | `quick_create_menu_opened` to `quick_create_form_shown` trace                         |

#### API Response Time SLAs

| Endpoint                                      | p50   | p95   | p99    |
| --------------------------------------------- | ----- | ----- | ------ |
| `content.feedMobile` (first page, 10 clips)   | 120ms | 400ms | 800ms  |
| `content.feedMobile` (subsequent pages)       | 80ms  | 300ms | 600ms  |
| `entities.suggest`                            | 80ms  | 250ms | 500ms  |
| `generation.generate` (queue submission only) | 200ms | 600ms | 1200ms |
| `universes.preview`                           | 60ms  | 200ms | 400ms  |
| `content.branch`                              | 150ms | 500ms | 1000ms |
| `notifications.register`                      | 100ms | 300ms | 600ms  |

These are server-side processing times (excluding client network RTT). At p99, the client must show a skeleton/spinner; if the SLA is exceeded at p99, an alert fires (see Section 5).

#### Video Preload Buffer Strategy

The feed preloads clips ahead of the current position using a sliding window:

- **Buffer size**: 2 clips ahead of the currently playing clip are preloaded; 1 clip behind is retained in memory to support backward swipe.
- **Resolution ladder**: Clips are served at three resolutions. The initial buffer fetches the 540p version immediately. If bandwidth > 5 Mbps (measured via a HEAD request to a known-size probe URL at session start), the player upgrades to 1080p mid-play without rebuffering using HLS adaptive bitrate. On <2 Mbps, the player locks to 360p. The resolution decision is made once per session and stored in React context.
- **Preload initiation**: When the user has watched 40% of the current clip (measured via `onPlaybackStatusUpdate`), the preload of the next clip's video URL begins. The clip metadata (title, universe, entity chips) is fetched one full clip ahead — i.e., when swipe begins to the next clip, the clip after that one's metadata is already in the TanStack Query cache.
- **Preload cancellation**: If the user swipes backward, any in-progress preload for forward clips is cancelled (`ExpoAV` unload). The previously retained clip behind is promoted.
- **Cache eviction**: The feed maintains a maximum of 5 video instances in memory at any time (current + 2 ahead + 1 behind + 1 transitioning). On eviction, the oldest non-visible clip is unloaded.

#### Image CDN and Entity Thumbnail Caching

- All entity thumbnails and universe cover images are served from a CDN with a `Cache-Control: max-age=86400, stale-while-revalidate=604800` header.
- On the client, `expo-image` is used for all thumbnail rendering. It maintains an on-disk LRU cache of up to 200MB. Thumbnails are pre-fetched when the universe peek sheet is opened (all entity thumbnails in the sheet are batch-prefetched using `Image.prefetch`).
- Feed card thumbnail overlays (universe logo, user avatar) are fetched with `priority: "high"` on the visible card and `priority: "low"` on the two preloaded cards.

#### Animation Frame Rate

- Target: 60fps sustained on all feed interactions. 120fps on ProMotion-capable devices.
- All feed swipe animations use `react-native-reanimated` v3 with `useAnimatedStyle` and `withSpring` / `withTiming` running on the UI thread. No JavaScript thread involvement in swipe gesture response.
- The swipe gesture uses `react-native-gesture-handler` `Pan` gesture with `runOnJS(false)` — the animated value driving the card transform is updated entirely on the UI thread.
- Right-rail button tap animations (like, save, branch) use `useAnimatedStyle` with a `withSequence(withSpring(1.3), withSpring(1.0))` bounce — all on UI thread.
- Universe peek sheet uses `@gorhom/bottom-sheet` which is backed by Reanimated — no JS thread blocking during open/close.
- Frame drops are tracked via `Perf.startMark` / `Perf.endMark` on the feed scroll handler. If more than 3 frames drop below 50fps in a single swipe gesture, that event is logged to the analytics sink as a `performance_jank` event with device model and OS version.

#### Memory Budget

| Platform | Feed memory budget                                                                                                                                                                                                                               |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| iOS      | 180MB resident RAM for the feed tab. Above 200MB, begin proactive clip eviction. Above 250MB, the OS will send a memory warning — the feed must respond by evicting all non-visible videos immediately.                                          |
| Android  | 150MB heap for the feed tab. Android has stricter per-app limits on mid-range devices. Above 180MB, proactive eviction. The feed must handle `onTrimMemory` callbacks and release video resources in response to `TRIM_MEMORY_RUNNING_CRITICAL`. |

Memory is measured via the Hermes profiler in development and via device vitals in production (tracked as a custom metric in the analytics sink).

#### Battery Impact

- Background fetch for feed preload is disabled by default. The feed does not pre-fetch new content while backgrounded.
- When the app returns to foreground, a single `content.feedMobile` call is made to append new clips to the top of the feed (stale-while-revalidate: the cached feed is shown immediately, and new clips appear above after the fetch completes).
- `expo-background-fetch` is used only for push notification wake-up, not for feed preloading. This is a deliberate decision to avoid appearing in battery usage reports as a high-drain app during beta.
- Push notifications use APNs/FCM directly, which are zero-cost to battery (system-handled). The app does not maintain a persistent WebSocket while backgrounded.
- Target: < 3% battery drain per hour of active feed viewing on a 4000mAh Android device (measured via Android Battery Historian during QA).

---

### 2. Security Requirements

#### JWT Expiry and Refresh Strategy

- JWTs issued after SIWE sign-in have a 24-hour expiry on the server (`exp` claim). The mobile client stores the JWT in `expo-secure-store` (never AsyncStorage — see storage policy below).
- The client tracks JWT expiry locally by decoding the `exp` claim at login time and storing the expiry timestamp alongside the token in SecureStore.
- A TanStack Query `queryClient` error handler intercepts any tRPC response with `UNAUTHORIZED` (HTTP 401 or tRPC error code `UNAUTHORIZED`). On this error, the client attempts a silent re-auth:
  1. The wallet SDK is called to re-sign a fresh SIWE message (it can do this silently if the user's embedded wallet session is still valid — no UI shown).
  2. The new SIWE signature is sent to `auth.siweLogin` to obtain a fresh JWT.
  3. The failed query is automatically retried with the new token.
  4. If the embedded wallet session is also expired (wallet SDK returns an error), the user is shown the auth screen with a `"Your session expired. Please sign in again."` message. No data is lost — draft state is persisted to AsyncStorage before redirecting.
- Proactive refresh: 30 minutes before JWT expiry (i.e., at the 23.5-hour mark), the client silently refreshes the token in the background if the app is in the foreground. This prevents mid-session 401s for active users.

#### Signature Replay Prevention (SIWE Nonce Handling)

- The SIWE nonce is generated server-side by a `auth.getNonce` tRPC call. The server stores the nonce in Firestore under `nonces/{nonce}` with a TTL of 5 minutes (enforced by a Firestore TTL policy on that collection).
- On successful SIWE verification, the nonce document is deleted. Any attempt to reuse the nonce returns `UNAUTHORIZED` because the document no longer exists.
- On the mobile client, the nonce is held only in memory (a local variable in the auth flow) — it is never written to storage. There is no nonce in AsyncStorage or SecureStore.
- The SIWE message includes `domain` (set to `loar.fun`) and `uri` (set to `https://loar.fun`) — the server validates both fields against its own known domain before accepting the signature. A message signed against a phishing domain will be rejected.

#### Deep Link Validation

All deep links into the app follow the scheme `loar://` (and the HTTPS universal link `https://loar.fun/`). The pattern for safe deep link handling is:

1. The deep link is parsed in the Expo Router root layout's `linking` configuration.
2. Before navigating to the target screen, the app dispatches a preflight query:
   - `loar://clip/:contentId` → calls `content.get({contentId})`. If the result is a `NOT_FOUND` error, the app navigates to the feed root and shows a toast: `"This clip is no longer available."`
   - `loar://universe/:universeAddress` → calls `universes.preview({universeAddress})`. If `NOT_FOUND`, navigates to the Worlds tab with a toast.
   - `loar://entity/:entityId` → calls `entities.get({entityId})`. If `NOT_FOUND`, navigates to the feed with a toast.
3. The preflight query runs before any navigation commitment. The app shows a brief full-screen loading state (the splash screen's secondary frame) while the preflight resolves.
4. Deep links may not navigate directly to screens that require auth without first completing the auth flow. The deep link target is stored in a navigation queue and fulfilled after successful sign-in.
5. Deep link parameters are validated against a Zod schema before being passed to any API call. Malformed UUIDs or addresses are rejected client-side with no network call made.

#### Content Moderation and Draft Visibility

- Draft content (published: false) is only visible to the content owner. The `content.feedMobile` procedure filters by `published: true` unconditionally — drafts are never included in the feed regardless of the requesting user's identity.
- Private universes (visibility: 'private') gate all associated content. The server checks universe membership before returning any content in that universe. The mobile client never attempts to render a private universe's content without a valid membership token.
- Uploaded media is scanned asynchronously after upload. A `moderationStatus` field on each content document begins as `'pending'`. Content with `moderationStatus: 'pending'` is visible only to its owner. Content with `moderationStatus: 'approved'` is visible in the feed. Content with `moderationStatus: 'rejected'` is soft-deleted (not shown anywhere) and the owner receives an in-app notification explaining why. This async gate means there is a brief window (target: < 60 seconds) between upload and feed visibility.

#### Rate Limiting on Quick-Create

- `generation.generate`: 3 requests per user per minute. 20 requests per user per hour. These are server-side counters stored in Firestore under `rateLimits/{userId}/generation` with a TTL-based sliding window.
- `content.branch`: 5 branch operations per user per minute. 30 per hour.
- When the rate limit is exceeded, the server returns HTTP 429 with a tRPC error code of `TOO_MANY_REQUESTS` and a JSON body: `{ retryAfterSeconds: number }`.
- The client interprets the `retryAfterSeconds` field and shows an inline message below the submit button: `"You're creating too fast. Try again in {retryAfterSeconds}s."` A countdown timer is shown if `retryAfterSeconds < 60`. The submit button is disabled for the duration. No toast or modal — the error appears contextually in the form.

#### Network Transport: Certificate Pinning Decision

Certificate pinning is not implemented in Workstream 1. Rationale: the LOAR backend is hosted on Railway/Fly.io behind a managed TLS termination layer. The certificates rotate automatically (Let's Encrypt), and pinning would cause the app to break on certificate renewal without an app update. For a beta-stage app with < 5000 users, the risk/benefit of pinning does not justify the operational overhead. Instead, the app uses HTTPS exclusively, and all tRPC calls validate the TLS chain via the device OS's certificate store. Certificate pinning will be re-evaluated at GA if the threat model changes (e.g., significant transaction volume over the network).

#### SecureStore vs AsyncStorage Policy

The rule is: **anything that grants access or proves identity goes in SecureStore; everything else goes in AsyncStorage.**

| Data                                                 | Storage                                                           |
| ---------------------------------------------------- | ----------------------------------------------------------------- |
| JWT (SIWE session token)                             | `expo-secure-store` — hardware-backed on supported devices        |
| Wallet session token                                 | Wallet SDK manages this internally (SecureStore-backed on mobile) |
| SIWE nonce                                           | In-memory only, never persisted                                   |
| Feed cache (paginated clip list)                     | AsyncStorage via TanStack Query's `AsyncStoragePersister`         |
| Draft content (unsaved quick-create forms)           | AsyncStorage                                                      |
| Notification preferences                             | AsyncStorage                                                      |
| User settings (font size, reduced motion preference) | AsyncStorage                                                      |
| Universe preview cache                               | AsyncStorage                                                      |
| Analytics event queue (offline buffer)               | AsyncStorage                                                      |

SecureStore is synchronous on Android (using the Android Keystore) and uses iOS Keychain on iOS. The JWT is encrypted at rest via the platform's hardware security module where available.

#### Branch/Remix Abuse Prevention

Beyond the per-minute rate limit, the server enforces:

- A **per-source cooldown**: a given user may only branch the same `sourceContentId` once per 24 hours. This is checked by querying `branches` collection for `{userId, sourceContentId}` with `createdAt > now - 24h`. If a match exists, the server returns a 429 with `"You've already branched this clip today."`.
- A **universe-level daily cap**: a user may create at most 20 branch operations per universe per day. This prevents a single user from flooding a universe's branch graph.
- Both limits are checked in a single Firestore transaction before creating the branch document, so there is no race condition between concurrent requests.

---

### 3. Error Taxonomy and Handling Strategy

#### Error Table

| Error category    | Examples                                                       | Client behavior                                                                                                                                                                                                       | User-visible message                                                                                                                                                    | Retry strategy                                                                                                                                                                            |
| ----------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Network timeout   | `content.feedMobile` takes > 10s; swipe loads nothing          | Show skeleton cards in the feed for up to 3s, then replace with an inline "No connection" state in the feed area. Do not show a full-screen error unless the entire session is offline.                               | "Having trouble loading — pull down to refresh" (inside the feed, below the last loaded clip)                                                                           | User-initiated pull-to-refresh. Auto-retry once after 5s with exponential backoff (10s, 20s). After 3 failed retries, show persistent inline error.                                       |
| Auth expired      | 401 from any tRPC call                                         | Silent re-auth attempt (see Section 2). If re-auth succeeds, original request is retried transparently. If re-auth fails, navigate to auth screen.                                                                    | Only shown if silent re-auth fails: "Your session expired. Please sign in again." (full-screen overlay, not a disruptive modal — user can still see the feed behind it) | Silent auto-retry once. If that fails, user-initiated (tap "Sign In").                                                                                                                    |
| Rate limited      | 429 from `generation.generate` or `content.branch`             | Inline error below the submit button in the create form. Countdown timer if `retryAfterSeconds < 60`. Submit button disabled.                                                                                         | "You're creating too fast. Try again in {N}s."                                                                                                                          | Auto-retry after `retryAfterSeconds` elapses (client re-enables the button; user must tap).                                                                                               |
| Content not found | Deleted clip still in user's local feed cache                  | The clip card is silently replaced with the next clip (no error shown for mid-feed tombstoned content). If the user navigates directly to a deleted clip via deep link, show an inline card: "This clip was removed." | "This clip is no longer available." (shown only on direct navigation, not mid-feed)                                                                                     | No retry. The clip is tombstoned: its ID is stored in AsyncStorage under `tombstones` and filtered out of subsequent feed renders without an API call.                                    |
| Generation failed | AI model returns an error; generation job times out            | Show an error state inside the quick-create scene form: a red banner below the preview area. The draft is preserved.                                                                                                  | "Generation failed — your draft was saved. You can try again or adjust your prompt."                                                                                    | User-initiated retry (tap "Try Again"). The prompt and settings are preserved. No auto-retry (generation errors often indicate a prompt issue; auto-retry would waste credits).           |
| Upload failed     | Video from camera roll exceeds 500MB; network drops mid-upload | Show an inline error below the media picker. For size errors, show the limit. For network errors, show a retry button. The draft (prompt, caption, entity links) is preserved in AsyncStorage.                        | For size: "Video must be under 500MB. Your clip is {N}MB." For network: "Upload interrupted. Tap to retry."                                                             | For network errors: auto-retry 2 times with 5s / 15s backoff. If both fail, surface user-initiated retry. For size/validation errors: no retry (permanent failure — user must re-encode). |
| Partial failure   | Bulk entity save in quick-create: 3/5 entities saved, 2 failed | Show a bottom-sheet error summary: "3 of 5 saved successfully. 2 failed — tap to retry the failed items." List the failed entity names. Successful items are committed.                                               | "Some items couldn't be saved. Tap to retry." (bottom sheet)                                                                                                            | User-initiated retry for the failed subset only. Successful items are not re-submitted. After 2 user-initiated retries, offer "Skip and continue."                                        |

#### Error Display Hierarchy

- **Inline (within card/form)**: network timeout in feed, rate limit in create form, upload size validation, generation failure.
- **Bottom sheet errors**: partial failure summaries, auth expiry notifications that do not block the current action.
- **Full-screen error states**: complete offline state (no feed data at all, cache empty), auth session fully expired with no silent recovery, app-level crashes (caught by the error boundary).

---

### 4. Testing Strategy

#### Unit Tests (Jest + React Native Testing Library)

Coverage target: 80% statement coverage for all components in `apps/mobile/src/components/feed/` and `apps/mobile/src/components/quick-create/`. The following components are exempt from unit testing with rationale:

- Native video player wrapper (`VideoPlayer.tsx`): This is a thin wrapper around `expo-av`. Testing the native module behavior requires a real device or emulator; mock behavior diverges significantly. Covered by E2E tests instead.
- Animated swipe gesture handler (`FeedSwipeGesture.tsx`): Reanimated's `useAnimatedStyle` hooks do not run in Jest's JS environment (they run on the UI thread). Gesture behavior is covered by E2E tests.

Specific unit test cases:

1. **`FeedCard` renders universe name, content title, and right-rail action buttons from a mocked `FeedClip` object**
2. **`FeedCard` shows the correct content lane badge (`fan` / `original` / `licensed`) based on the `rightsClassification` field**
3. **`FeedCard` fires the `clip_viewed` analytics event when the `onViewable` callback triggers with `isViewable: true`**
4. **`EntityChip` renders the correct icon and label for each entity kind (person, place, thing, faction, lore, species)**
5. **`QuickCreateForm` pre-populates `universeId` and `sourceContentId` when passed via route params**
6. **`QuickCreateForm` validates required fields: shows inline error when `title` is empty and user taps submit**
7. **`QuickCreateForm` calls `entities.suggest` on mount and populates the suggested entity chips in the form**
8. **`UniversePeekSheet` renders entity mini-cards sorted by kind (people first, then places, then things, then lore)**
9. **`useRateLimit` hook correctly parses `retryAfterSeconds` from a tRPC 429 error and exposes a countdown**
10. **`feedSlice` (TanStack Query cache logic) correctly inserts tombstoned content IDs into the filter list and excludes them from rendered items**

#### Integration Tests

Test environment: local Firestore emulator (`firebase emulators:start --only firestore`) with seeded test data. Seeding is done by a `scripts/seed-test-data.ts` script that creates:

- 3 test universes with 20 clips each
- 10 test entities (2 per kind across the universes)
- 2 test users (one with auth, one without)

Specific integration test cases:

1. **`content.feedMobile` returns the first page (10 clips) enriched with entity chip data. Verify: each clip in the response includes a `entityChips` array with correctly joined entity `kind`, `name`, and `id`. Verify: the response includes a `nextCursor` for pagination.**
2. **`content.feedMobile` correctly filters out clips with `published: false` and clips from private universes where the requesting user is not a member.**
3. **`content.branch` creates a new content document in Firestore with `sourceContentId`, `universeId`, `branchedBy`, and `published: false`. Verify: the source content document's `branchCount` is incremented atomically.**
4. **`entities.suggest` returns at most 5 entity suggestions for a given `contentId`. Verify: all returned entities belong to the same universe as the source content. Verify: entity kinds are ordered by frequency of appearance in the universe's existing content.**
5. **`notifications.register` saves the push token to Firestore under `profiles/{userId}/pushTokens`. Verify: registering the same token twice is idempotent (no duplicate documents). Verify: tokens are keyed by device ID.**
6. **`universes.preview` returns the compact payload: `name`, `coverImageUrl`, `entityCount`, `clipCount`, `latestActivity`, and the top 3 entities by appearance count. Verify: the response is < 5KB.**
7. **Feed enrichment round-trip: seed a clip with 3 linked entity IDs. Call `content.feedMobile`. Verify that the enrichment logic correctly resolves all 3 entity IDs to their full `{id, name, kind, thumbnailUrl}` objects using a batched Firestore `getAll`.**

#### E2E Tests (Maestro)

Device configurations:

- iOS: iPhone 15 simulator (iOS 17), iPhone SE 3rd gen simulator (small screen, iOS 16)
- Android: Pixel 7 emulator (Android 14), Samsung Galaxy A13 emulator (mid-range, Android 12)
- Physical device gate (runs only pre-release): one iOS device (iPhone 14) and one Android device (Pixel 7a) for push notification testing and real video playback validation.

Specific E2E flows:

1. **Full cold-launch feed flow**: Launch app cold. Verify splash appears within 1.2s. Verify first clip starts playing within 2s. Swipe up 5 times. Verify each subsequent clip plays without a blank frame between swipes.
2. **Universe peek flow**: On any feed clip, tap "Open World". Verify the bottom sheet opens within 250ms. Verify entity chips are rendered. Tap "View Full Universe". Verify navigation to the universe detail screen.
3. **Quick-create person flow from clip**: On a clip belonging to Universe A, tap the "+" / "Create from this" button. Select "Add Person". Verify the form is pre-populated with Universe A's `universeId`. Fill in `name`. Submit. Verify: a success toast is shown, the form closes, and the new entity appears in the universe's wiki under "People".
4. **Branch/remix flow**: On a clip, tap the "Branch" button in the right rail. Verify the branch creation sheet opens with `sourceContentId` pre-filled. Enter a prompt. Submit. Verify: a new draft content document appears in the user's profile drafts section.
5. **Offline feed behavior**: Enable airplane mode. Relaunch the app. Verify: cached clips from the last session are shown. Verify: swipe beyond cached clips shows the "No connection" inline state. Re-enable network. Verify: pull-to-refresh loads new clips.
6. **Auth expiry recovery**: Inject an expired JWT into SecureStore. Launch the app. Verify: the feed attempts to load, receives a 401, silently re-authenticates via wallet SDK, and loads the feed without showing an error to the user.

CI triggers:

- **On every PR**: unit tests + integration tests (emulator-based). Fast feedback — must complete in < 5 minutes.
- **On merge to main**: full E2E suite on iOS simulator + Android emulator. Allowed to take up to 15 minutes.
- **Pre-release (tag `release/*`)**: full E2E suite on physical devices (push notification tests), performance SLA checks, and accessibility audit (VoiceOver automation via Maestro accessibility actions).

#### Load Tests

Tools: k6 with a custom tRPC HTTP call script.

- **`content.feedMobile`**: Expected RPS at launch: 200 RPS (500 concurrent users refreshing feeds on a roughly 2.5s interval). Load test target: 600 RPS (3× expected load). Pass criteria: p95 < 400ms at 600 RPS with no error rate increase above 0.1%.
- **`content.branch`**: Lower volume — expected 10 RPS at launch. But each branch write triggers a Firestore transaction (read + write on source document) plus a new document write. Test concurrency: 50 concurrent branch requests. Pass criteria: p95 < 500ms, no transaction contention failures (Firestore transaction retries must absorb contention transparently).
- **Feed preload simulation**: Simulate 1000 concurrent users swiping the feed at a 3-second cadence (each user calls `content.feedMobile` once every 3 seconds, fetching the next page). Measure p95 video thumbnail URL resolution time (the CDN, not the API). Pass criteria: p95 < 150ms for thumbnail URL delivery; API p95 < 300ms.

#### Manual QA Checklist for Feed

These cases cannot be reliably automated and must be verified by a human tester before each release candidate:

1. Feed swipe gesture feels native — no perceptible lag between finger lift and next clip appearing. Test on both iOS and Android.
2. Video audio plays correctly when the phone is NOT on silent mode. On iOS, verify the silent/ringer switch does not mute the feed (video audio should play even on silent, matching TikTok/Reels behavior — requires `Audio.setAudioModeAsync({ playsInSilentModeIOS: true })`).
3. Video continues playing when the app moves to split-screen mode on Android (multi-window). Verify the feed pauses correctly when the LOAR window loses focus.
4. Feed correctly pauses when a phone call is received (iOS CallKit interruption, Android AudioFocus loss).
5. Right-rail like button shows an immediate optimistic update (heart icon animates, count increments) before the server confirms the mutation.
6. Pulling the notification shade on Android (or pulling from the top on iOS) does not trigger an unintended feed swipe.
7. On a device with a notch/Dynamic Island (iPhone 14 Pro+), the universe name and content title in the top-left of the feed card do not overlap the notch or island safe area.
8. On Android with a very small screen (4.7", e.g., SE-class), the right-rail action buttons do not overlap the caption area.
9. Rotating the device to landscape mode while the feed is playing: the video expands to fill the screen, and rotating back to portrait resumes the feed correctly.
10. After watching 30+ clips in one session, memory usage has not visibly degraded (scroll performance still smooth, no OOM crash). Test this manually on a device with 3GB RAM.

---

### 5. Observability and Alerting

#### Server-Side Metrics

Metrics are exposed via a Hono middleware (`apps/server/src/middleware/metrics.ts`) that records timing for every tRPC procedure call. In production, metrics are emitted as structured JSON logs (Railway parses these into a time-series view). For detailed APM, metrics are forwarded to a Datadog/Grafana agent (TBD by infra — structured log format ensures compatibility with both).

- **`content.feedMobile` latency histogram**: Recorded as `procedure_duration_ms` with labels `{procedure: "content.feedMobile", status: "ok" | "error"}`. Histograms at p50, p95, p99.
- **Feed server-side cache hit rate**: If a Redis/Upstash cache layer is added in front of Firestore for feed queries (recommended at > 500 RPS), track `cache_hit` vs `cache_miss` labels. Target: > 60% hit rate for the first-page feed query (highly cacheable since it is ranked, not user-specific beyond the following tab).
- **`content.branch` success/failure rate**: Track as `procedure_error_rate{procedure: "content.branch"}`. Includes Firestore transaction failures (retried internally) and validation errors.
- **`generation.generate` queue depth and wait time**: The generation service maintains an in-memory queue (or a Firestore-backed queue for persistence). Emit `generation_queue_depth` (current queue size) and `generation_wait_time_ms` (time from job submission to job start) on each job dequeue.
- **Push notification delivery rate**: After sending a push notification via FCM/APNs, record the delivery receipt. Emit `push_delivery_rate = delivered / sent` as a rolling 5-minute metric. Track per `notificationType`.
- **`entities.suggest` accuracy proxy**: After a suggestion is returned, the client fires an `entity_chip_tapped` event if the user selects a suggested entity in the quick-create form. Server-side, join the `entities.suggest` call count to the downstream `entity_chip_tapped` event count (via the shared `contentId`) to compute a click-through rate proxy. Target: > 25% CTR on suggestions (i.e., at least 1 in 4 suggestions is selected by the user).

#### Client-Side Metrics

All client metrics are sent to the analytics sink (Segment, or a lightweight custom endpoint at `POST /api/analytics/event`) in batches of up to 20 events, flushed every 10 seconds or on app background.

- **Feed scroll velocity**: Computed as `swipes_per_minute` during a feed session. Logged as a session-level metric at feed session end. High velocity (> 30 swipes/min) may indicate low content quality for that user.
- **Time spent per clip**: Tracked from the moment `isViewable: true` triggers to when the clip scrolls out of view or the user swipes. Sent as `clip_viewed.viewDurationMs`. p50 view duration is the primary engagement signal for feed ranking.
- **Quick-create funnel**: Each step is an individual event (see Section 6). The funnel is: `quick_create_menu_opened` → `quick_create_kind_selected` → `quick_create_submitted` → `quick_create_published`. Drop-off between `submitted` and `published` indicates a server-side or moderation delay problem.
- **Video play-start latency**: Time from `clip_viewed` (clip enters viewport) to `onPlaybackStatusUpdate` `isPlaying: true`. This is the single most important performance UX metric. Target: p50 < 200ms, p95 < 800ms.
- **App crash rate per screen**: Captured by Expo's crash reporting (Sentry integration). Emitted per `activeRouteName` at time of crash. Feed and quick-create forms are the highest-risk surfaces.

#### Alerting Thresholds

All alerts are configured in PagerDuty (or equivalent) with severity levels:

| Alert                             | Threshold                         | Severity      | Response                                                                                                            |
| --------------------------------- | --------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------- |
| `content.feedMobile` p95 latency  | > 800ms for 5 consecutive minutes | P2 — High     | Investigate Firestore query performance; check for missing indexes; consider enabling server-side cache             |
| Push notification delivery rate   | < 90% over 5 minutes              | P2 — High     | Check FCM/APNs credentials; investigate token expiry; check notification payload size                               |
| `generation.generate` queue depth | > 50 jobs waiting                 | P2 — High     | Scale generation workers; check for stuck jobs; alert the user-facing "generation is busy" banner via remote config |
| Feed crash rate (client-side)     | > 0.5% of sessions on any screen  | P1 — Critical | Trigger Expo OTA hotfix evaluation; escalate to on-call engineer; consider disabling feed autoplay via kill switch  |
| `content.branch` error rate       | > 5% over 5 minutes               | P2 — High     | Investigate Firestore transaction failures; check rate limit logic for false positives                              |
| Cold launch time                  | > 2000ms p95 over 1 hour          | P3 — Medium   | Investigate bundle size regression; check for new synchronous imports in app entrypoint                             |

#### Dashboards

Three Grafana (or Railway Metrics) dashboards are required before beta launch:

1. **Feed Health Dashboard**: Panels: `content.feedMobile` p50/p95/p99 latency (time series), video play-start latency (p50/p95 from client events), feed swipe rate (avg swipes/min), feed crash rate (%, time series), cache hit rate (if applicable). Time range: last 1 hour / last 24 hours toggle.

2. **Quick-Create Funnel Dashboard**: Panels: daily funnel step counts (bar chart: opened → kind selected → submitted → published), daily abandonment rate per step (line chart), time-to-publish from `quick_create_menu_opened` to `quick_create_published` (p50/p95 histogram), breakdown by entity kind (scene vs person vs place etc.).

3. **Generation Queue Dashboard**: Panels: queue depth over time (area chart), generation wait time p50/p95 (line chart), success/failure rate (stacked bar), credits consumed per hour (bar chart), top-N universes by generation volume (table).

---

### 6. Analytics Instrumentation

Every event below MUST be implemented in `apps/mobile/src/lib/analytics.ts` and called at the specified trigger. All events include implicit context properties: `userId: string | null`, `sessionId: string`, `appVersion: string`, `platform: 'ios' | 'android'`, `timestamp: ISO8601`.

```
event_name: app_opened
trigger: Every time the app enters the foreground (both cold and warm launch). Use AppState 'active' listener.
properties: {
  launch_type: 'cold' | 'warm',        // cold = process start; warm = background resume
  first_launch: boolean,               // true only the very first time after install
  time_since_last_open_ms: number | null  // null on first launch
}

event_name: feed_session_started
trigger: When the Feed tab becomes active (either on app open to feed, or tab switch to feed).
properties: {
  tab: 'feed',
  algorithm_type: 'algorithmic' | 'following' | 'universe',
  initial_clip_count: number           // number of clips in the first loaded page
}

event_name: clip_viewed
trigger: When a clip's viewability crosses 50% of its height in the viewport (via Viewability tracking in FlatList). Only fires once per unique clip per session.
properties: {
  contentId: string,
  universeId: string,
  universeAddress: string | null,
  position_in_feed: number,            // 0-indexed position in the current feed page
  clip_type: 'video' | 'image' | 'mixed',
  rights_classification: 'fan' | 'original' | 'licensed',
  algorithm_type: 'algorithmic' | 'following' | 'universe'
}

event_name: clip_completed
trigger: When a video clip plays to >= 90% of its duration without the user swiping away.
properties: {
  contentId: string,
  universeId: string,
  completionPct: number,               // always >= 90; could be 100 if played to end
  viewDurationMs: number               // wall-clock time the clip was in view
}

event_name: clip_exited
trigger: When the user swipes away from a clip (before completion).
properties: {
  contentId: string,
  universeId: string,
  viewDurationMs: number,
  completionPct: number,               // percentage of video duration watched
  swipeDirection: 'up' | 'down'
}

event_name: universe_peek_opened
trigger: When the universe bottom sheet opens, either via "Open World" button or swipe-up gesture on the universe name.
properties: {
  contentId: string,                   // the clip that triggered the peek
  universeId: string,
  universeAddress: string | null,
  entity_count: number,                // number of entity chips shown in the sheet
  trigger: 'button' | 'swipe'
}

event_name: universe_peek_closed
trigger: When the universe bottom sheet is dismissed (swipe down, backdrop tap, or CTA navigation).
properties: {
  contentId: string,
  universeId: string,
  timeSpentMs: number,
  ctaTapped: 'none' | 'view_world' | 'create_from_this' | 'continue_watching'
}

event_name: quick_create_menu_opened
trigger: When the quick-create action sheet (the list of entity kinds) becomes visible.
properties: {
  sourceContentId: string,             // the clip from which create was triggered
  universeId: string,
  entry_point: 'right_rail' | 'create_tab' | 'universe_peek'
}

event_name: quick_create_kind_selected
trigger: When the user taps a kind in the quick-create action sheet.
properties: {
  kind: 'scene' | 'person' | 'place' | 'thing' | 'lore' | 'faction' | 'upload',
  sourceContentId: string | null,
  universeId: string | null
}

event_name: quick_create_submitted
trigger: When the user taps the submit/publish button on the quick-create form (before server response).
properties: {
  kind: 'scene' | 'person' | 'place' | 'thing' | 'lore' | 'faction' | 'upload',
  universeId: string,
  hasDraft: boolean,                   // true if a draft was loaded into the form
  field_count_filled: number,          // how many optional fields were filled
  time_on_form_ms: number              // time from form shown to submit tap
}

event_name: quick_create_published
trigger: When the server confirms the creation and returns a contentId or entityId.
properties: {
  kind: 'scene' | 'person' | 'place' | 'thing' | 'lore' | 'faction' | 'upload',
  universeId: string,
  contentId: string | null,            // set for scene/upload
  entityId: string | null,             // set for person/place/thing/lore/faction
  time_to_publish_ms: number           // from quick_create_submitted to this event
}

event_name: quick_create_abandoned
trigger: When the user dismisses the quick-create form or navigates away without submitting.
properties: {
  kind: 'scene' | 'person' | 'place' | 'thing' | 'lore' | 'faction' | 'upload',
  step: 'menu' | 'form' | 'confirm',   // which step was abandoned
  timeSpentMs: number,                 // time from menu opened to abandonment
  had_content: boolean                 // true if the user had typed anything before abandoning
}

event_name: branch_tapped
trigger: When the user taps the branch/remix button in the feed right rail.
properties: {
  sourceContentId: string,
  universeId: string,
  position_in_feed: number
}

event_name: upload_started
trigger: When the user confirms media selection from the camera roll and the upload begins.
properties: {
  mediaType: 'video' | 'image',
  fileSizeMb: number,
  durationSeconds: number | null,      // null for images
  source: 'camera_roll' | 'camera'
}

event_name: upload_completed
trigger: When the server confirms the upload and returns a storage URL.
properties: {
  contentId: string,
  durationMs: number,                  // total upload time
  fileSizeMb: number,
  provider: 'walrus' | 'ipfs' | 'firebase' | 'synapse'  // which storage backend handled it
}

event_name: upload_failed
trigger: When the upload fails after all retries are exhausted.
properties: {
  reason: 'file_too_large' | 'network_error' | 'server_error' | 'timeout',
  fileSizeMb: number,
  attempt_count: number                // how many times it was tried before failing
}

event_name: notification_received
trigger: Via the Expo Notifications `addNotificationReceivedListener` callback.
properties: {
  type: 'like' | 'comment' | 'branch' | 'canon_change' | 'world_activity' | 'system',
  foreground: boolean,                 // true if app was in foreground when received
  notification_id: string
}

event_name: notification_tapped
trigger: Via the Expo Notifications `addNotificationResponseReceivedListener` callback.
properties: {
  type: 'like' | 'comment' | 'branch' | 'canon_change' | 'world_activity' | 'system',
  destination: string,                 // the route the notification navigates to
  time_since_received_ms: number | null
}

event_name: feed_tab_switched
trigger: When the user switches between the algorithmic, following, or universe feed tabs at the top of the feed screen.
properties: {
  from: 'algorithmic' | 'following' | 'universe' | null,  // null on initial load
  to: 'algorithmic' | 'following' | 'universe',
  clips_viewed_before_switch: number   // how many clips were viewed on the previous tab
}

event_name: entity_chip_tapped
trigger: When the user taps an entity chip on a feed card or in the universe peek sheet.
properties: {
  entityId: string,
  kind: 'person' | 'place' | 'thing' | 'faction' | 'lore' | 'species' | 'event',
  sourceContentId: string,
  universeId: string,
  chip_position: number,               // 0-indexed position in the chip list
  source_surface: 'feed_card' | 'universe_peek' | 'quick_create_form'
}
```

---

### 7. Rollout Strategy

#### Feature Flags

All flags are evaluated via a Firestore-backed remote config service (`apps/server/src/services/remote-config.ts`). The client fetches the config at app launch and caches it for 10 minutes. The server also reads the same config for server-side gating.

Flag evaluation is: `GET /api/config` (unauthenticated, cacheable, CDN-friendly) returns the full flag set. The client applies flags locally after fetch.

| Flag                      | Description                                         | Why flag-gated                                                                       |
| ------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `feed_algorithm_v1`       | Enables the engagement-ranked feed algorithm        | May have ranking bugs at launch; fallback is chronological                           |
| `universe_following_tab`  | Shows the "Following" tab in the feed               | Requires sufficient follow graph data to be useful; useless at < 100 users           |
| `generation_quick_create` | Enables AI scene generation from quick-create       | Generation costs money; gate behind credits check AND flag for emergency shutoff     |
| `branch_remix_flow`       | Enables the branch/remix button in the right rail   | Branch fanout is untested at scale; can be disabled if Firestore write volume spikes |
| `push_notifications`      | Enables push notification registration and delivery | APNs/FCM credentials may need rotation; must be disableable without a build          |
| `universe_peek_sheet`     | Shows the universe bottom sheet from feed clips     | Data completeness — useless if most clips don't have enriched universe data yet      |
| `entity_chips_on_feed`    | Shows entity chips below the caption on feed cards  | UI may be visually cluttered; can be disabled for A/B test                           |

**Kill switches** (override to false disables the feature globally, no deploy needed): `generation_quick_create`, `branch_remix_flow`, `push_notifications`. These three features have external service dependencies or write-heavy paths that could cause a cascade if a dependency degrades.

#### Staged Rollout Plan

| Stage          | Size                                                | Criteria to enter                                        | Go criteria                                                                              |
| -------------- | --------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Internal alpha | ~10 users (team + advisors)                         | Build passes all CI checks; E2E suite green on simulator | Crash rate < 2%, all P1 bugs fixed, video plays on both platforms                        |
| Closed beta    | ~500 users (TestFlight / Play Store internal track) | Alpha ran for 7 days with no P1 crashes                  | Crash rate < 1%, D1 retention > 30%, no data loss bugs, store review approved            |
| Open beta      | ~5000 users (invite code via loar.fun waitlist)     | Closed beta ran for 14 days; performance SLAs met        | Crash rate < 0.5%, D7 retention > 20%, `content.feedMobile` p95 < 400ms at observed load |
| GA             | Full public release on App Store + Play Store       | Open beta ran for 14 days; no P2 bugs open               | Crash rate < 0.3%, App Store rating >= 4.3, D7 retention stable                          |

Rollout percentage at each stage: 10% → 100% within each stage via TestFlight/Play Store staged rollout. Each stage begins with 10% of the cohort and expands to 100% over 48 hours if no alert fires.

#### A/B Tests at Launch

1. **Feed algorithm**: Variant A = chronological (latest first), Variant B = engagement-ranked, Variant C = universe-weighted (clusters content from universes the user has previously engaged with). Win metric: **7-day feed session length** (primary), clip completion rate (secondary). Minimum sample: 200 users per variant. Run for 14 days.

2. **Quick-create entry point**: Variant A = dedicated right-rail button ("+" icon), Variant B = long-press on any clip reveals the create menu. Win metric: **quick-create funnel conversion rate** (`quick_create_menu_opened` / `clip_viewed`, per user per session). Minimum sample: 300 users per variant. Run for 7 days.

3. **Universe peek depth**: Variant A = mini bottom sheet (25% screen height, shows universe name + 3 entity chips + 2 CTAs), Variant B = full bottom sheet (75% screen height, full entity browse + more CTAs). Win metric: **universe_peek CTA tap rate** (`ctaTapped != 'none'` / `universe_peek_opened`). Minimum sample: 300 users per variant. Run for 7 days.

#### Rollback Plan

- **JS-only changes** (the majority of the Expo app): Roll back via Expo Updates OTA push. A rollback build is published to the `production` channel at every release, pointing to the previous JS bundle. Rollback time: < 5 minutes for users on Wi-Fi (bundle downloads in background), < 30 minutes for all active users.
- **Native module changes** (rare — only if a new native Expo module is added): Requires an App Store / Play Store expedited review (iOS expedited review: 24-48 hours). In this case, the kill switch for the affected feature is flipped remotely to disable the feature while the fixed build propagates.
- **Features that can be disabled via remote config without a new build**: `feed_algorithm_v1`, `universe_following_tab`, `generation_quick_create`, `branch_remix_flow`, `push_notifications`, `universe_peek_sheet`, `entity_chips_on_feed` — all feature flags listed above. The app re-fetches the config every 10 minutes, so a flag change propagates to all active users within 10 minutes.

---

### 8. Accessibility Requirements

#### Screen Reader Support (VoiceOver / TalkBack)

**Feed card `accessibilityLabel` pattern**:

```
"{universeTitle} — {contentTitle}. {rightsClassification} content.
{likeCount} likes. {position_in_feed + 1} of {total_in_feed} clips."
```

Example: `"The Veil Chronicles — Episode 3: The Crossing. Original content. 142 likes. 3 of 10 clips."`

The entire card is a single accessible element with `accessibilityRole="none"` (it is not a button; it is a media container). The right-rail action buttons are separate accessible elements with `accessibilityRole="button"` and individual labels:

- Like button: `"Like. Currently {liked ? 'liked' : 'not liked'}. {likeCount} likes."`
- Save button: `"Save clip"`
- Comment button: `"Comments. {commentCount} comments"`
- Branch button: `"Branch — remix this clip"`
- Create from this: `"Create from this universe"`

**Universe peek sheet focus management**:

- When the sheet opens, focus is moved to the sheet's header (`accessibilityViewIsModal: true` on the sheet container, so VoiceOver/TalkBack cannot navigate outside the sheet while it is open).
- The first focused element inside the sheet is the universe title (announced as `"Universe: {name}"`).
- When the sheet closes (by any mechanism), focus is returned to the "Open World" button on the feed card that triggered the sheet.

**Quick-create forms**:

- Every `TextInput` has an explicit `accessibilityLabel` (not relying on placeholder text, which is not announced by all screen readers).
- When a validation error appears, `accessibilityLiveRegion="polite"` on the error text ensures it is announced without stealing focus.
- The submit button announces its current state: `"Publish — ready to submit"` vs `"Publish — disabled, title required"`.

#### Motor Accessibility

- Every right-rail action (like, save, branch, create) is a standard `TouchableOpacity` with a tap handler. None of them require a swipe gesture — swipe is for navigation between clips, not for actions.
- All touch targets are minimum 44×44 points (iOS HIG requirement). The right-rail buttons are 48×48pt to provide margin. Verified via `accessibilityActivationPoint` layout assertions in unit tests.
- The feed can be navigated entirely via switch access (iOS Switch Control / Android Switch Access): the swipe gesture has a `accessibilityActions` equivalent — `[{ name: 'increment', label: 'Next clip' }, { name: 'decrement', label: 'Previous clip' }]` on the feed container, handled by `onAccessibilityAction`.
- Quick-create form fields are navigable in logical order via the keyboard tab sequence (using `returnKeyType="next"` and `ref` chaining for `TextInput` focus management).

#### Visual Accessibility

**Color contrast on video cards**: Video backgrounds are dynamic (bright sky, dark dungeon, etc.), making a fixed text color insufficient. The solution is a semi-transparent scrim:

- Bottom-left text area (caption, tags, entity chips): a linear gradient scrim from `rgba(0,0,0,0.6)` at the bottom to `rgba(0,0,0,0)` at 40% height. White text (#FFFFFF) on `rgba(0,0,0,0.6)` achieves contrast ratio of > 7:1 (WCAG AAA), well above the AA minimum of 4.5:1.
- Top-left text area (universe name, badge): a `rgba(0,0,0,0.5)` pill background behind the universe name. White text achieves > 5:1 contrast.
- Right-rail icons: white icon on a `rgba(0,0,0,0.4)` circular background. Icon contrast > 4.5:1 against the background circle. The circle is always present regardless of video background color.

**Dynamic Type (iOS) and Font Scale (Android)**:

- All text in the feed uses `Text` components with no fixed `fontSize`. Instead, font sizes use a scale from the design system (`theme.typography`) that respects `allowFontScaling: true` (the default). The caption area uses `numberOfLines` capping at 3 lines to prevent layout overflow on large fonts, with an expandable "more" affordance.
- The right-rail icon labels (numerical counts) allow font scaling up to 130% before switching to an abbreviated display (e.g., "1.2K" instead of "1,247").
- The universe peek sheet uses `ScrollView` so that large font sizes do not clip content.

**Motion reduction**:

- The app checks `AccessibilityInfo.isReduceMotionEnabled()` at launch and stores the result in a React context.
- If reduce motion is enabled: feed auto-advance (if implemented as a feature) is disabled. The Reanimated spring animations for card transitions are replaced with an instant `withTiming(0, { duration: 0 })`. Video autoplay is replaced with a play button (video does not autoplay) — the user must tap to play.
- Video autoplay can also be suppressed in Settings > Accessibility within the app, independent of the system setting, for users who prefer it (e.g., saves data without enabling full reduce motion system-wide).

#### Accessibility Testing Protocol

Before every release candidate:

1. Run the complete feed viewing flow with VoiceOver (iOS) enabled. Every clip must be reachable, its label must be meaningful, and the right-rail actions must be individually tappable.
2. Run the quick-create flow (add a person from a clip) with TalkBack (Android) enabled. Form submission must succeed without requiring touch-only gestures.
3. Run the feed with font size set to the maximum system scale (235% on iOS). Verify no text is clipped or overlapping.
4. Verify the color contrast of the scrim on at least 5 different clips with varying background luminosity (manually inspect using the Accessibility Inspector).

---

### 9. Rate Limiting Specifications

All rate limits are enforced server-side in the tRPC procedure handlers using a sliding window counter stored in Firestore (`rateLimits/{userId}/{procedure}/{windowKey}`). The window key is a truncated epoch timestamp (e.g., floor to the nearest minute). On limit breach, the server returns HTTP 429 with the tRPC error code `TOO_MANY_REQUESTS` and a body of `{ retryAfterSeconds: number, limitType: 'burst' | 'sustained' }`.

| Endpoint                 | Burst limit              | Sustained limit                                                        | Key                                                                                              | Client behavior on 429                                                                                                                                                                                                                                               |
| ------------------------ | ------------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `content.feedMobile`     | 10 requests / 10 seconds | 60 requests / minute                                                   | Per user ID (authenticated); per IP (unauthenticated)                                            | Queue the next page fetch and retry after `retryAfterSeconds`. Show a brief skeleton state. No user-visible message unless the limit is sustained (> 30s of retries).                                                                                                |
| `content.branch`         | 3 requests / 10 seconds  | 5 requests / minute                                                    | Per user ID                                                                                      | Disable the branch button for `retryAfterSeconds`. Show inline: "Slow down — try again in {N}s."                                                                                                                                                                     |
| `entities.suggest`       | 5 requests / 10 seconds  | 20 requests / minute                                                   | Per user ID                                                                                      | Delay the suggest call client-side using TanStack Query's `staleTime` (cache suggest results for 30 seconds per contentId — many suggest calls are redundant). On actual 429, return the cached suggestion if available; if no cache, show the form without prefill. |
| `generation.generate`    | 2 requests / 30 seconds  | 3 requests / minute (secondary limit; primary limit is credit balance) | Per user ID                                                                                      | Disable the generate button. Show inline countdown: "Generating too fast. Try again in {N}s." If credits are also exhausted, show the credits purchase sheet instead.                                                                                                |
| `notifications.register` | 3 requests / minute      | 10 requests / hour                                                     | Per user ID + device ID                                                                          | Silent failure on the client (silently drop the registration call and retry at next app launch). The user is unaffected — push notifications continue working from the last registered token.                                                                        |
| `universes.preview`      | 20 requests / 10 seconds | 120 requests / minute                                                  | Per user ID (but this endpoint is aggressively cached — most calls never reach the rate limiter) | Use cached response if available. If cache miss and 429, show the universe peek sheet in a "loading failed" state with a retry button.                                                                                                                               |

The unauthenticated rate limit (per-IP) for `content.feedMobile` applies to guest browsing. A guest may view up to 20 clips before being prompted to sign in. The 20-clip gate is enforced client-side (via a clip view counter in AsyncStorage) and server-side (the per-IP limit is set at 20 requests total for unauthenticated callers, after which the server returns 401 with `{ requiresAuth: true }`).

---

### 10. Caching Strategy

#### Cache Table

| Data                                          | Client cache TTL                                                                    | Server cache TTL                                                                                          | Invalidation trigger                                                                                                                                                                          | SWR?                                                                                                                                                               |
| --------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Feed page (first 10 clips)                    | 60 seconds in TanStack Query in-memory cache; 5 minutes in AsyncStorage persistence | No server-side cache in v1 (Firestore reads directly). Add Upstash Redis cache at > 300 RPS with 30s TTL. | New clip published to a universe the user follows → emit a Firestore onWrite trigger that bumps a feed version counter; client polls version counter (lightweight) to know when to invalidate | Yes. Show stale feed immediately on app foreground; re-fetch in background; insert new clips at the top of the feed without displacing the user's scroll position. |
| Universe preview (peek sheet)                 | 5 minutes in TanStack Query                                                         | 2 minutes in server-side Upstash (keyed by `universeId`)                                                  | Universe metadata updated (name, cover image, entity count changes) → server invalidates Upstash key on `universes.update` mutation                                                           | Yes. Show stale preview immediately; re-fetch after 2 minutes. Universe data changes rarely.                                                                       |
| Entity chips (linked people/places on a clip) | 10 minutes in TanStack Query (keyed by `contentId`)                                 | 5 minutes in Upstash (keyed by `contentId`)                                                               | Entity linked or unlinked from content → invalidate the cache key for that `contentId`                                                                                                        | Yes. Entity chip changes are rare mid-session. Stale chips are acceptable for up to 10 minutes.                                                                    |
| Notification preferences                      | 15 minutes in TanStack Query                                                        | Not cached server-side (Firestore read is fast for a single document)                                     | User changes a preference → `notifications.updatePreferences` mutation invalidates the query client-side immediately via `queryClient.invalidateQueries(['notifications.preferences'])`       | No. Preferences must be fresh to avoid sending notifications the user has disabled. Refetch on every app foreground.                                               |
| User's own drafts                             | No TTL (always fresh — user's own data)                                             | Not cached server-side                                                                                    | User creates, updates, or deletes a draft → optimistic update in TanStack Query cache; server confirms                                                                                        | No. Drafts must always reflect the server state. On conflict (e.g., draft edited on two devices), last-write-wins via Firestore.                                   |
| `entities.suggest` results                    | 30 seconds (per `contentId`)                                                        | Not cached server-side                                                                                    | Not applicable (suggestions are computed fresh; 30s client cache is sufficient since the user sees the form for < 30s on average)                                                             | No. If the cache is empty, show the form without prefill immediately and populate chips when the suggest call completes (non-blocking).                            |

#### Tombstone Pattern for Deleted Clips

When a clip appears in the user's local feed cache but has been deleted on the server:

1. The `content.feedMobile` response includes a `deletedIds: string[]` field on every page response — a list of content IDs that have been soft-deleted since the last fetch. This list is populated by querying the `contentTombstones` Firestore collection for documents newer than the client's last fetch timestamp (sent as a `since` parameter).
2. The client, on receiving any feed page, merges the `deletedIds` into a tombstone set stored in AsyncStorage.
3. The feed's `FlatList` data selector filters out any clip whose `contentId` is in the tombstone set before rendering.
4. When a tombstoned clip would have been the current playing clip (e.g., it was preloaded and the user swipes to it), the clip is silently skipped and the next non-tombstoned clip is shown. No error message is displayed.
5. The tombstone set is cleared on explicit feed refresh (pull-to-refresh) or after 24 hours (at which point the clip is no longer in any local cache anyway).
