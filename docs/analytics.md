# Product Analytics

LOAR uses [PostHog](https://posthog.com) for product analytics across web, mobile, and server. This lets admins answer questions the `/admin/ops` dashboard can't:

- How many clicks on the "Create Universe" button this week?
- Median session duration by user cohort?
- Time on `/create` before drop-off?
- Conversion funnel: landing → sign in → first generation → first mint?
- Which routes have the worst retention?

Sentry handles error tracking. Prometheus + Grafana handle infrastructure metrics. PostHog handles **what users do**.

## Setup

### PostHog project

1. Create an account at [posthog.com](https://posthog.com) (US or EU region) or self-host.
2. Create one project called "LOAR". The same project receives events from web + mobile + server.
3. Copy the **Project API Key** (starts with `phc_`). This is public-safe.

### Server env

```
# Root .env (server reads from here)
POSTHOG_API_KEY=phc_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
POSTHOG_HOST=https://us.i.posthog.com
```

### Web env

```
VITE_POSTHOG_KEY=phc_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
VITE_POSTHOG_HOST=https://us.i.posthog.com
```

### Mobile env (Expo)

```
EXPO_PUBLIC_POSTHOG_KEY=phc_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
EXPO_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
```

Any of the three env vars can be unset — that surface becomes a silent no-op, the other two keep reporting.

## What's captured automatically

**Web (PostHog browser SDK):**

- Every page view (route change)
- Every click (autocapture via `data-ph-*` attributes + element heuristics)
- Every form submit, input change
- Session duration (from `$session_start` to 30-min idle timeout)
- Time on page (`$pageview` → `$pageleave`)
- Session replay with inputs masked (see privacy note below)

**Mobile (PostHog RN SDK):**

- App lifecycle events (launch, foreground, background)
- Screen views (wire `useScreenView('screen-name')` on each screen component)
- Custom taps — call `track('tap:create-button')` on key buttons

**Server (PostHog Node SDK):**

- `auth:siwe_verified` — successful sign-in, distinctId = wallet
- `generation:admitted` — credits deducted, job about to run
- `generation:blocked` — kill switch OR monthly cap fired; `reason` prop
- (Extend as needed in `apps/server/src/lib/analytics.ts`)

## Event naming convention

`<surface>:<action>`

- `auth:login_started`, `auth:login_succeeded`, `auth:login_failed`, `auth:logout`
- `generation:admitted`, `generation:blocked`
- `credits:purchase_started`, `credits:purchase_completed`
- `admin:kill_switch_flipped`
- `universe:created`, `universe:published`
- `content:minted`

Lowercase-snake_case for everything. Matches PostHog's autocaptured event prefixes (`$pageview`, `$click`) without collision.

## User identity

On SIWE login, web + mobile call `identifyUser(address)` and PostHog stitches the anonymous pre-login session to the wallet-scoped user. Subsequent events carry `distinct_id = <wallet-address-lowercased>`.

On logout, `resetUser()` breaks the link so the next anonymous user doesn't inherit the previous one's identity.

Server events use the authenticated wallet as `distinctId` so they stitch into the same user history.

## Privacy posture

**What we send:**

- Public, on-chain identifiers (wallet addresses)
- URL path (no query strings — PostHog strips `?foo=bar` by default)
- Element text content of clicked elements (button labels, link text)
- Screen names on mobile

**What we do NOT send:**

- Input values (masked in session replay, `maskAllInputs: true`)
- Personal data (we don't collect email / real name in the product)
- Private keys, JWTs, or API keys (not on any code path)
- Request bodies, response bodies

**Data locality:**

- `POSTHOG_HOST=https://us.i.posthog.com` — US cloud
- `POSTHOG_HOST=https://eu.i.posthog.com` — EU cloud (GDPR)
- `POSTHOG_HOST=https://posthog.mycompany.com` — self-hosted

**User control:**

- Respect `Do Not Track` — the web SDK is configured with `respect_dnt: true`. A user whose browser sends DNT=1 never has their events captured.
- Selective masking: add `.ph-mask` class to any element you don't want in session replay.
- Selective no-capture: add `.ph-no-capture` to opt out of autocapture.

**Privacy policy update required:** the /privacy page must list PostHog as a data processor. Add it alongside Sentry + Resend + FAL + ElevenLabs + Meshy.

## How to query

### "How long are users logged in?"

In PostHog → Insights → New trend:

- Event: `$session_end`
- Property: `$session_duration` (median)
- Breakdown by: `distinct_id` (or by cohort)

### "Clicks on a specific button"

PostHog's autocapture UI → pick the element → "Trend" → scope to authenticated users.

### "Time on /create before they bounce"

- Event: `$pageview` where `$current_url` contains `/create`
- Next event: `$pageleave`
- Measure: `duration_seconds` = `$pageleave` timestamp − `$pageview` timestamp

### "Conversion funnel: landing → sign in → first generation"

PostHog → Funnels → steps:

1. `$pageview` where `$current_url` = `/`
2. `auth:siwe_verified`
3. `generation:admitted`

Show conversion rate + time-between-steps.

### "Which users hit the monthly cap?"

- Event: `generation:blocked`
- Filter: `reason` = `spend_cap`
- Group by: `distinct_id`

Links directly to the `/admin/ops` abuse-flag flow — confirm the flag, decide to raise cap or ban.

## Cost

Free tier covers:

- 1M events / month
- 15K session recordings / month
- 1M feature-flag requests / month

At 10K MAU with normal engagement, 1M events/mo is plenty. Past that, PostHog pricing scales linearly; self-host option is free forever if you run the infra.

## Not included (follow-ups)

- Feature flags via PostHog — could replace the `platformConfig` kill switches for per-cohort rollouts, but the current Firestore-backed system works and has audit log + Slack alerts built in.
- A/B tests — same SDK supports experiments; add when there's a hypothesis to test.
- Retention cohorts — PostHog builds these automatically once events flow; no extra wiring.
