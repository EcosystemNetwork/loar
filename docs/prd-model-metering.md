# PRD: Model Metering, BYOK & Provider Routing

**Status:** Approved 2026-05-17. Phase 1 + Phase 2 to land together.
**Owner:** Eric.
**Scope:** Every paid model call across captions, image gen, video gen, audio gen, editing.

## Problem

LOAR routes through ~70 model IDs across 8 providers, each priced in a different
unit (per-minute, per-second, per-image, per-megapixel, per-token). Today every
caller hardcodes a credit cost (`TRANSCRIBE_CREDITS = 2`, etc.) and uses a single
`deductCredits`/`refundCredits` pair. That works for one provider per surface;
it does not work once we let users:

1. **Pick the model** for a given task (already partially supported via per-surface
   model registries).
2. **Pick the provider** that hosts that model (e.g. Whisper on FAL vs Groq vs
   Replicate).
3. **Bring their own API key** (BYOK) for any provider — so LOAR routes but
   does not pay the provider.

Without a unified metering layer we cannot:

- Estimate cost before a job runs.
- Reconcile estimate vs actual after the job.
- Enforce a monthly subscription bucket safely under concurrent jobs.
- Bill BYOK calls at a different rate than server-paid calls.

## Decisions

These are the locked-in defaults. Future PRDs can revisit but should not
silently violate.

| #   | Decision                 | Choice                                                       | Why                                                               |
| --- | ------------------------ | ------------------------------------------------------------ | ----------------------------------------------------------------- |
| 1   | Behavior at zero balance | **Hard wall — refuse the job**                               | Overages become collections. Refuse > apologize.                  |
| 2   | Bucket reset cadence     | **Monthly, on subscription anniversary**                     | Matches billing. Daily creates support tickets.                   |
| 3   | Bucket granularity       | **One unified bucket per user**                              | No "I have caption credits but no image credits".                 |
| 4   | Pre-flight strictness    | **Reserve `estimate × 1.20` at job start, reconcile at end** | Stops parallel-job overruns. Stripe-style auth/capture.           |
| 5   | BYOK billing             | **Flat 0.5 credit / call routing fee**                       | Doesn't require knowing the would-have-been price. Audit-aligned. |

## Architecture

### Three new service packages

```
apps/server/src/services/
├── pricing/
│   ├── catalog.ts        Per (modelId, provider) entry:
│   │                       unit ('minute' | 'second' | 'image' | 'megapixel' | 'token')
│   │                       usdPerUnit, lastVerified (YYYY-MM-DD), source
│   ├── quote.ts          quote({ modelId, units, byok }) → { usd, credits }
│   │                     Applies FIAT_MARGIN (1.35) × LOAR_MARGIN (1.25).
│   │                     BYOK → returns flat 0.5 credit routing fee.
│   └── refresh.ts        Daily cron — alerts if any catalog entry > 30 days stale,
│                         auto-disables at 60 days.
│
├── credits/              (extends existing apps/server/src/lib/credits.ts)
│   ├── buckets.ts        Bucket priority: freeMonthly → subscription → topup
│   ├── enforce.ts        canAfford(uid, credits) → { ok, reason, balance }
│   ├── reserve.ts        Atomic Firestore tx — debit estimate × 1.20, write
│   │                     a pending `creditReservation` doc, return reservationId.
│   └── reconcile.ts      Given reservationId + actualCredits:
│                           refund (reservation − actual) if positive
│                           charge   (actual − reservation) if negative & bucket allows
│                                    else mark reservation as `overrun_blocked`
│
└── provider-keys/        BYOK foundation
    ├── types.ts          ProviderKey { userId, provider, fingerprint, encryptedKey,
    │                                   testedAt, lastUsedAt, enabled }
    ├── registry.ts       PROVIDER_REGISTRY — known providers + test endpoints
    ├── store.ts          Encrypted CRUD on Firestore `userProviderKeys`
    ├── crypto.ts         AES-256-GCM seal/unseal via PROVIDER_KEY_MASTER_KEY
    │                     (32-byte hex env var; KMS-wrapped DEK is future work)
    └── dispatcher.ts     resolveProviderClient({ uid, provider }) →
                            { client, source: 'byok' | 'server', keyFingerprint? }
```

### Per-job flow

```
estimate(modelId, input)
  → pricing.quote(units)                                       (USD, credits)
  → credits.canAfford(uid, estimated × 1.20)                   hard-wall here
  → credits.reserve(uid, estimated × 1.20)                     reservationId
  → providerKeys.resolveProviderClient({ uid, provider })      BYOK or pool
  → call provider
  → credits.reconcile(reservationId, actualCredits)            refund / overrun
  → audit log row in modelCallAudit (userId, modelId, provider,
                                     units, credits, byok, durationMs)
```

`modelCallAudit` is a new Firestore collection — append-only, never updated,
admin-readable. Replaces ad-hoc logging across the generation routers.

## Schema

### `userProviderKeys` (Firestore)

| field          | type      | notes                                                |
| -------------- | --------- | ---------------------------------------------------- |
| `userId`       | string    | doc ID = `${userId}_${provider}`                     |
| `provider`     | string    | one of `PROVIDER_REGISTRY`                           |
| `fingerprint`  | string    | `sha256(plaintextKey).slice(0, 16)` — for UI display |
| `encryptedKey` | string    | base64(nonce + ciphertext + authTag)                 |
| `enabled`      | boolean   | user can disable without deleting                    |
| `testedAt`     | timestamp | last successful test call                            |
| `lastUsedAt`   | timestamp | last dispatch                                        |
| `createdAt`    | timestamp |                                                      |
| `updatedAt`    | timestamp |                                                      |

### `creditReservations` (Firestore)

| field              | type            | notes                                                         |
| ------------------ | --------------- | ------------------------------------------------------------- |
| `id`               | string          | doc ID                                                        |
| `userId`           | string          |                                                               |
| `modelId`          | string          | e.g. `whisper-large-v3`                                       |
| `provider`         | string          | e.g. `fal`                                                    |
| `estimatedCredits` | number          | what we reserved                                              |
| `actualCredits`    | number\|null    | filled on reconcile                                           |
| `status`           | enum            | `pending` \| `reconciled` \| `overrun_blocked` \| `cancelled` |
| `byok`             | boolean         | true if user's own key was used                               |
| `bucketUsed`       | enum            | which bucket the debit came from                              |
| `createdAt`        | timestamp       |                                                               |
| `reconciledAt`     | timestamp\|null |                                                               |

### `modelCallAudit` (Firestore — append-only)

| field        | type         | notes                           |
| ------------ | ------------ | ------------------------------- |
| `userId`     | string       |                                 |
| `modelId`    | string       |                                 |
| `provider`   | string       |                                 |
| `byok`       | boolean      |                                 |
| `units`      | number       | minutes / images / etc.         |
| `unitKind`   | string       | matches catalog `unit`          |
| `usd`        | number       | provider-side cost (0 for BYOK) |
| `credits`    | number       | what user was charged           |
| `latencyMs`  | number       |                                 |
| `success`    | boolean      |                                 |
| `errorClass` | string\|null | grouped error code              |
| `createdAt`  | timestamp    | indexed                         |

Firestore rules: client read = own rows only. Admin = all. No client writes.

## Pricing catalog source of truth

`pricing/catalog.ts` is a TypeScript array, manually maintained, one entry per
`(modelId, provider)` pair. Each entry carries `lastVerified: '2026-MM-DD'`.
A daily cron checks for entries > 30 days stale and posts to the Slack ops
channel; entries > 60 days stale are auto-disabled (cannot be selected).

Two margin constants (already present in image-models/registry.ts):

- `FIAT_MARGIN = 1.35` — applied to USD before display
- `LOAR_MARGIN = 1.25` — applied when converting USD to credits via `usdToLoar`

`creditsCost = ceil(units × usdPerUnit × FIAT_MARGIN × LOAR_MARGIN × LOAR_PER_USD)`

`LOAR_PER_USD` is a single env-tunable constant. Today: `100` (1 credit ≈ $0.01).

## Known unsolved (and what we do about it)

| Risk                                            | Mitigation                                                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Provider doubles price overnight, catalog stale | 30-day staleness Slack alert + 60-day auto-disable                                                     |
| User uploads 10hr audio we estimated at 1min    | Probe duration HEAD/metadata before estimating; hard cap input size per call                           |
| Mid-job provider failure                        | Reservation `cancelled`, full refund — same as today's `refundCredits`                                 |
| User crams monthly bucket into last hour        | Per-day soft rate limit on top of monthly bucket (Phase 2.5, not P1)                                   |
| Concurrent reserve attempts                     | Firestore tx ensures only one wins; loser retries or fails                                             |
| Lost master key                                 | Re-encryption pass via temporary dual-key support. **Document rotation runbook before Phase 2 ships.** |

## Phase plan

### Phase 1 — Refactor only (invisible to users)

1. `pricing/catalog.ts` — port all existing hardcoded credit costs into catalog format.
2. `pricing/quote.ts` — pure function. Replaces `TRANSCRIBE_CREDITS = 2` etc.
3. `credits/reserve.ts` + `credits/reconcile.ts` — new primitives. `deductCredits`/`refundCredits` kept as thin wrappers calling the new flow.
4. `transcription-models/` registry — first new model surface, mirrors `audio-models/`.
5. `captions.routes.ts` adopts the new flow as the **first caller**.
6. All other generation routers untouched in P1. Migration is opt-in per router.

**Acceptance for P1:** captions transcribe end-to-end works exactly as before;
`creditReservations` collection has rows; existing routers unaffected;
`pnpm check-types` green; `pnpm smoke` green.

### Phase 2 — User-facing

1. `provider-keys/` BYOK foundation (encrypt/store/dispatch).
2. AssemblyAI, Deepgram, Groq backends + catalog entries.
3. tRPC `providers.*` router — `list`, `addKey`, `testKey`, `deleteKey`, `usage`.
4. `/settings/providers` page.
5. CaptionsPanel model picker (capability-aware — greys out diarize/translate when
   selected model can't do it; greys out BYOK-only models when user has no key).
6. Usage dashboard ("523 / 2000 credits this month, top 3 models, BYOK split").

**Acceptance for P2:** add an AssemblyAI key in /settings/providers, transcribe
a clip with diarization, see speaker labels in the editor, export VTT with
karaoke highlighting; usage dashboard shows correct breakdown including BYOK
rows at 0.5-credit rate.

### Phase 3 — Optional, post-launch

- Auto-price refresh where providers expose APIs (Replicate, maybe FAL).
- Smart routing — "cheapest healthy provider for this model" given the user's
  preferences.
- Provider-side webhook reconciliation (some providers emit actual usage at
  job end).

## File touch list

**New (Phase 1):**

- `apps/server/src/services/pricing/catalog.ts`
- `apps/server/src/services/pricing/quote.ts`
- `apps/server/src/services/pricing/refresh.ts`
- `apps/server/src/services/credits/buckets.ts`
- `apps/server/src/services/credits/enforce.ts`
- `apps/server/src/services/credits/reserve.ts`
- `apps/server/src/services/credits/reconcile.ts`
- `apps/server/src/services/transcription-models/types.ts`
- `apps/server/src/services/transcription-models/registry.ts`
- `apps/server/src/services/transcription-models/router.ts`

**Edited (Phase 1):**

- `apps/server/src/routers/generation/captions.routes.ts` — adopt reserve/reconcile.
- `apps/server/src/lib/credits.ts` — kept as wrapper layer.

**New (Phase 2):**

- `apps/server/src/services/provider-keys/{types,registry,store,crypto,dispatcher}.ts`
- `apps/server/src/services/captions-backend/{types,registry}.ts` + `backends/{fal-whisper,assemblyai,deepgram,groq}.ts`
- `apps/server/src/routers/providers/providers.routes.ts`
- `apps/web/src/routes/settings.providers.tsx`
- `apps/web/src/components/voice-studio/CaptionsModelPicker.tsx`
- `apps/web/src/routes/settings.usage.tsx`

**Env vars (added to root `.env.example`):**

```
PROVIDER_KEY_MASTER_KEY=<32-byte hex, generated with `openssl rand -hex 32`>
LOAR_PER_USD=100
ASSEMBLYAI_SERVER_API_KEY=
DEEPGRAM_SERVER_API_KEY=
GROQ_SERVER_API_KEY=
```

## Open follow-ups (do not block landing)

- KMS-wrapped DEK for `PROVIDER_KEY_MASTER_KEY` — currently env-only. Switch when
  we have KMS in production.
- `modelCallAudit` retention policy — currently infinite. Define a 12-month
  retention + cold-storage archive after the first month of real data.
- Tier-based bucket sizes (Free / Pro / Studio) — currently single bucket per
  user. PRD-6 token system already designs the tiering; this PRD inherits it.
