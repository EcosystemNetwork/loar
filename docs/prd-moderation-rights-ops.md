# PRD: Minimum Viable Rights, Moderation, and Abuse Ops

> Status: Draft
> Date: 2026-03-28
> Priority: Testnet survival gate — required before public invite

---

## Problem

LOAR already exposes three rights lanes (`fan` / `original` / `licensed`) and an IP declaration system (see [ip-policy.md](ip-policy.md), [rights-classification-ui.md](rights-classification-ui.md)), but there is no infrastructure to act on violations. When a user flags infringing content, there is no queue. When a rights holder sends a DMCA notice, there is no intake. When an admin takes action, there is no record. When a monetized creator gets reclassified, there is no traceable history.

The platform will be publicly accessible on testnet. Testnet has no real money, but it does have real users producing real content — some of it potentially infringing. Without moderation infrastructure, the only response to abuse is database surgery.

---

## Goal

Make the testnet survivable for user-generated AI content by shipping:

1. **Content flagging** — any user can report a content item
2. **Admin review queue** — platform team can see and act on flags and takedown requests
3. **DMCA/takedown intake** — documented path for rights holders to submit removal requests
4. **Immutable audit log** — every content status change is permanently recorded
5. **Enforcement rules** — classification lane gates which operations are allowed

---

## Non-Goals

- Automated similarity detection / proactive scanning (planned pre-mainnet)
- User-facing appeals portal (admin action is final on testnet)
- Counter-notice workflow (DMCA safe harbor full stack — mainnet only)
- Arbitration or dispute escrow
- Public transparency reports

---

## Enforcement Model

The existing IP policy defines the invariant:

> You can create anything for fun. You can only monetize what you own.

This PRD operationalizes it. Each content item has a `classification` and a `contentStatus`. These two fields together determine what the item can do.

### Content Status Values

| Value          | Meaning                                                                                             |
| -------------- | --------------------------------------------------------------------------------------------------- |
| `active`       | Normal — all operations allowed per classification                                                  |
| `flagged`      | One or more community flags pending review; content still visible but monetization gates check this |
| `under_review` | Admin has opened a review; DMCA hold or escalated flag                                              |
| `hidden`       | Admin-hidden pending resolution; not returned in public queries                                     |
| `removed`      | Permanently removed from public surfaces; on-chain hash remains                                     |
| `reinstated`   | Was hidden/removed, admin cleared it                                                                |

### Allowed Operations by State

| Operation        | `active`                 | `flagged` | `under_review` | `hidden` | `removed` |
| ---------------- | ------------------------ | --------- | -------------- | -------- | --------- |
| View (public)    | ✓                        | ✓         | ✓              | ✗        | ✗         |
| Mint NFT         | ✓ (if original/licensed) | ✗         | ✗              | ✗        | ✗         |
| List for sale    | ✓ (if original/licensed) | ✗         | ✗              | ✗        | ✗         |
| Subscribe access | ✓                        | ✓         | ✗              | ✗        | ✗         |
| License deal     | ✓ (if original/licensed) | ✗         | ✗              | ✗        | ✗         |
| Edit metadata    | ✓                        | ✓         | ✗              | ✗        | ✗         |
| Creator delete   | ✓                        | ✓         | ✗              | ✗        | ✗         |

**Classification × status gate:** `original` and `licensed` content in `flagged` state cannot enter any new commercial transaction. Existing subscription access continues (no surprise disruption) but is re-evaluated on next renewal.

---

## Data Model

All moderation data lives in Firestore. Nothing here modifies on-chain data — the blockchain record is permanent.

### `contentStatus` field on content documents

Add two fields to every content document:

```ts
contentStatus: ContentStatus; // default: 'active'
contentStatusUpdatedAt: Timestamp;
contentStatusUpdatedBy: string; // uid or 'system'
```

### `flags` collection (top-level)

```ts
interface ContentFlag {
  id: string; // auto-generated
  contentId: string; // ref to content doc
  contentCreatorUid: string; // denormalized for queue
  reporterUid: string; // who flagged
  reason: FlagReason; // enum (see below)
  detail: string | null; // optional free text, max 500 chars
  status: 'open' | 'resolved' | 'dismissed';
  resolvedBy: string | null; // admin uid
  resolvedAt: Timestamp | null;
  resolution: FlagResolution | null; // enum (see below)
  createdAt: Timestamp;
}

type FlagReason =
  | 'copyright_infringement'
  | 'trademark_infringement'
  | 'impersonation'
  | 'prohibited_content' // CSAM, illegal, etc.
  | 'harassment'
  | 'spam'
  | 'misleading_classification' // claimed original but clearly fan work
  | 'other';

type FlagResolution =
  | 'content_hidden'
  | 'content_removed'
  | 'classification_downgraded' // monetized → fan
  | 'no_action'
  | 'escalated_to_dmca';
```

### `takedownRequests` collection (top-level)

```ts
interface TakedownRequest {
  id: string;
  // Requester info (self-reported)
  requesterName: string;
  requesterEmail: string;
  requesterOrganization: string | null;
  isRightsHolder: boolean; // "I am the rights holder"
  isAuthorizedAgent: boolean; // "I am authorized to act on their behalf"

  // What they want removed
  targetContentId: string | null; // if known
  targetUniverseAddress: string | null;
  targetCreatorUid: string | null;
  targetDescription: string; // free text if contentId unknown

  // The IP claim
  claimedWorkTitle: string;
  claimedWorkDescription: string;
  infringementDescription: string;
  evidenceUrls: string[]; // links to the original work

  // Legal attestation fields (DMCA §512 checklist)
  goodFaithAttestation: boolean; // "I have good faith belief..."
  accuracyAttestation: boolean; // "Information is accurate, under penalty of perjury"
  authorityAttestation: boolean; // "I am authorized to act..."

  // Workflow
  status: TakedownStatus;
  assignedTo: string | null; // admin uid
  internalNotes: string | null;
  resolution: TakedownResolution | null;
  resolvedAt: Timestamp | null;

  createdAt: Timestamp;
  updatedAt: Timestamp;
}

type TakedownStatus = 'received' | 'under_review' | 'resolved' | 'invalid'; // missing attestations, bad faith

type TakedownResolution =
  | 'content_removed'
  | 'content_hidden'
  | 'classification_downgraded'
  | 'no_violation_found'
  | 'forwarded_to_creator'; // creator asked to respond
```

### `contentAuditLog` collection (top-level, append-only)

Every status change to a content item writes one record. Records are never updated or deleted.

```ts
interface ContentAuditEntry {
  id: string;
  contentId: string;
  contentCreatorUid: string; // denormalized

  action: AuditAction;
  previousStatus: ContentStatus | null;
  newStatus: ContentStatus | null;
  previousClassification: string | null;
  newClassification: string | null;

  // What triggered this
  triggerType: 'user_flag' | 'dmca_request' | 'admin_action' | 'system' | 'creator_action';
  triggerId: string | null; // flagId or takedownRequestId if applicable

  actorUid: string; // who did this (admin uid, creator uid, or 'system')
  actorRole: 'admin' | 'creator' | 'system';

  reason: string; // human-readable, stored with the record

  createdAt: Timestamp; // immutable timestamp
}

type AuditAction =
  | 'status_change'
  | 'classification_change'
  | 'flag_opened'
  | 'flag_resolved'
  | 'dmca_received'
  | 'dmca_resolved'
  | 'content_created'
  | 'content_deleted';
```

**Immutability enforcement:** Firestore security rules deny `update` and `delete` on `contentAuditLog/{id}`. Only server-side Firebase Admin SDK can write (append) to this collection. Client SDK cannot write to it at all.

---

## API: tRPC Routes

### `moderation` router — public endpoints

```ts
// Flag a piece of content
moderation.flagContent({
  contentId: string
  reason: FlagReason
  detail?: string
})
// → { flagId: string }
// Rate-limited: 5 flags per user per hour

// Submit a DMCA / takedown request (no auth required — public form)
moderation.submitTakedown({
  requesterName, requesterEmail, requesterOrganization?,
  isRightsHolder, isAuthorizedAgent,
  targetContentId?, targetUniverseAddress?, targetCreatorUid?, targetDescription,
  claimedWorkTitle, claimedWorkDescription, infringementDescription,
  evidenceUrls,
  goodFaithAttestation, accuracyAttestation, authorityAttestation
})
// → { requestId: string, message: string }
// All three attestation fields must be true or request is rejected with 400

// Get audit trail for a content item (creator only — own content, or admin)
moderation.getAuditLog({
  contentId: string
  limit?: number   // default 50, max 200
  cursor?: string
})
// → { entries: ContentAuditEntry[], nextCursor: string | null }
```

### `admin.moderation` router — admin-only (requires `role: 'admin'` in JWT)

```ts
// List open flags, paginated, filterable
admin.moderation.listFlags({
  status?: 'open' | 'resolved' | 'dismissed'
  reason?: FlagReason
  cursor?: string
  limit?: number  // default 25
})

// Resolve a flag
admin.moderation.resolveFlag({
  flagId: string
  resolution: FlagResolution
  internalNote?: string
  // If resolution changes content: these are applied atomically
  newContentStatus?: ContentStatus
  newClassification?: ContentClassification
})
// Writes audit log entry automatically

// List takedown requests
admin.moderation.listTakedowns({
  status?: TakedownStatus
  cursor?: string
  limit?: number
})

// Update takedown status
admin.moderation.updateTakedown({
  requestId: string
  status: TakedownStatus
  resolution?: TakedownResolution
  internalNotes?: string
  // If resolution changes content:
  targetContentStatus?: ContentStatus
})

// Direct admin content action (no flag required)
admin.moderation.setContentStatus({
  contentId: string
  status: ContentStatus
  reason: string   // required — written to audit log
})

// Direct admin classification change
admin.moderation.setContentClassification({
  contentId: string
  classification: ContentClassification
  reason: string
})
```

### `content` router — enforcement hooks

Existing `content.create`, `content.mint`, `content.list`, `content.createLicenseDeal` must check `contentStatus` before proceeding. Add a shared utility:

```ts
// apps/server/src/lib/content-enforcement.ts
export async function assertContentOperable(
  contentId: string,
  operation: 'mint' | 'list' | 'license' | 'subscribe',
  db: Firestore
): Promise<void>;
// Throws TRPCError with appropriate code + message if blocked
```

---

## API: Hono REST Endpoints

Two public HTTP endpoints that bypass tRPC for non-authenticated access:

### `POST /api/takedown`

Public form submission endpoint. Accepts JSON body matching `submitTakedown` schema. Returns `{ requestId, message }`. No authentication required — takedown rights are not gated on platform account ownership.

Sends an email notification to `abuse@loar.fun` (or env var `ABUSE_EMAIL`) on receipt. If email not configured, logs to server stderr with `[TAKEDOWN]` prefix.

### `GET /api/content/:contentId/status`

Public endpoint returning current `contentStatus` and `classification` for a content item. Used by frontend to gate UI without loading full content.

```json
{
  "contentId": "abc123",
  "contentStatus": "hidden",
  "classification": "original",
  "updatedAt": "2026-03-28T..."
}
```

---

## Frontend

### Flag Button (all content surfaces)

Add a "..." overflow menu to every content card (`ContentCard.tsx`, universe detail, wiki entry). One option: **Report**. Opens a modal:

```
Report this content

Reason: [dropdown — 7 reasons]
Details (optional): [textarea, max 500 chars]

[Cancel] [Submit Report]
```

Calls `trpc.moderation.flagContent`. On success: "Your report has been submitted." Disabled state after submission (one flag per user per content item — enforced server-side via duplicate check).

### DMCA / Takedown Form (`/dmca`)

New public route. Static page with a multi-step form:

1. **Your information** — name, email, organization, relationship (rights holder / authorized agent)
2. **What to remove** — content URL or description, your original work details, evidence links
3. **Infringement description** — free text
4. **Legal attestations** — three checkboxes with the DMCA §512(c)(3) language, each must be checked
5. **Review + Submit**

Submits to `POST /api/takedown`. Confirmation page shows request ID. Add link to this page in the site footer: "Copyright / DMCA".

### Admin Review Queue (`/admin/moderation`)

Gated behind `role: 'admin'`. Two tabs:

**Flags tab**

- Table: Content | Reporter | Reason | Date | Status
- Filter by status, reason
- Click a flag → drawer showing: content preview, reporter info, all flags on this item, action buttons
- Actions: Hide Content / Remove Content / Downgrade to Fan / Dismiss / Escalate to DMCA

**Takedowns tab**

- Table: Requester | Target | Date | Status
- Click → full takedown request detail + internal notes field
- Actions: Mark Under Review / Resolve with action / Mark Invalid

**Audit Log tab**

- Table: Date | Content | Actor | Action | Previous → New status
- Filter by contentId or creatorUid
- Read-only. No actions.

---

## Firestore Security Rules

```
// contentAuditLog — append-only via Admin SDK only
match /contentAuditLog/{id} {
  allow read: if request.auth != null &&
    (request.auth.token.role == 'admin' ||
     resource.data.contentCreatorUid == request.auth.uid);
  allow write: false;  // Admin SDK bypasses these rules
}

// flags — authenticated users can create; admin can update
match /flags/{id} {
  allow create: if request.auth != null;
  allow read, update: if request.auth != null &&
    request.auth.token.role == 'admin';
}

// takedownRequests — public create; admin read/update
match /takedownRequests/{id} {
  allow create: if true;   // public form, no auth
  allow read, update: if request.auth != null &&
    request.auth.token.role == 'admin';
}
```

---

## Admin Role Provisioning

Admin access is controlled by the `ADMIN_ADDRESSES` env var (comma-separated wallet addresses). The `adminProcedure` middleware in `apps/server/src/lib/trpc.ts` checks `ctx.user.address` against this list. No Firebase Auth custom claims are used — LOAR uses SIWE wallet auth, not Firebase Auth.

```ts
// apps/server/src/lib/auth.ts addition
export interface AuthUser {
  uid: string;
  address: string;
  role?: 'admin' | 'creator'; // undefined = standard user
}
```

Server-side admin claim setting (one-time script, not a route):

```ts
// scripts/set-admin.ts
// Usage: bun run scripts/set-admin.ts <uid>
```

---

## Audit Log Integrity

The audit log is append-only in Firestore rules. For testnet this is sufficient. Pre-mainnet, evaluate:

- Exporting log entries to a write-once S3/R2 bucket nightly
- Generating a Merkle root of all log entries and publishing it on-chain periodically

For now, the Firestore rule denial of `update`/`delete` is the enforcement mechanism. Document this as the current integrity model.

---

## Email Notifications

On key events, send a transactional email (use existing email provider in env, or log to stderr if not configured):

| Event                     | Recipient  | Subject                                    |
| ------------------------- | ---------- | ------------------------------------------ |
| Content hidden            | Creator    | "Your content has been temporarily hidden" |
| Content removed           | Creator    | "Action taken on your content"             |
| Classification downgraded | Creator    | "Your content has been reclassified"       |
| Takedown received         | Abuse team | "New DMCA request — [requestId]"           |
| Takedown resolved         | Requester  | "Your takedown request has been resolved"  |

Email env var: `ABUSE_EMAIL` (platform team), `TRANSACTIONAL_EMAIL_FROM`.

---

## Enforcement Rules Summary

| Content Lane                | Status Gate                                                                  | What's Blocked When Flagged           |
| --------------------------- | ---------------------------------------------------------------------------- | ------------------------------------- |
| `fan` (Non-Commercial)      | `contentStatus` checked but no commercial transactions to block              | Edit, view remain; no economic impact |
| `original` (Creator-Owned)  | `flagged` / `under_review` / `hidden` blocks all new commercial transactions | Mint, list, license, new sub enroll   |
| `licensed` (Rights-Cleared) | Same as `original` + may trigger takedown auto-escalation                    | Same as original + admin notified     |

---

## Rollout

### Phase 1 — Server-side infrastructure (ship first)

- [ ] Add `contentStatus`, `contentStatusUpdatedAt`, `contentStatusUpdatedBy` fields to content schema
- [ ] Create `flags`, `takedownRequests`, `contentAuditLog` Firestore collections + security rules
- [ ] `moderation` tRPC router (flagContent, submitTakedown, getAuditLog)
- [ ] `admin.moderation` tRPC router
- [ ] `assertContentOperable()` enforcement utility + wire into content routes
- [ ] `POST /api/takedown` Hono endpoint
- [ ] `GET /api/content/:contentId/status` Hono endpoint
- [ ] Admin role provisioning (env var + custom claim)
- [ ] Audit log write helper (called from all moderation actions)

### Phase 2 — Frontend

- [ ] Flag button + modal on content cards
- [ ] `/dmca` public takedown form
- [ ] `/admin/moderation` queue (flags + takedowns + audit log)

### Phase 3 — Notifications

- [ ] Transactional email on content status changes (creator-facing)
- [ ] Abuse team email on new takedown receipt

---

## Acceptance Criteria

- [ ] Flagged content can be reviewed via admin queue and hidden with one action
- [ ] Hiding content writes a record to `contentAuditLog` that cannot be deleted
- [ ] A `flagged` or `hidden` original/licensed content item cannot be minted, listed, or licensed
- [ ] A rights holder can submit a DMCA request without a platform account
- [ ] Every DMCA request has a traceable `requestId` and `status` path from `received` → `resolved`
- [ ] An admin can downgrade `original` → `fan` classification with a required reason field
- [ ] The audit log for any content item shows its full status history in chronological order
- [ ] Admin role is only assignable server-side (no client-exposed route to self-promote)

---

## Open Questions

1. **Flag threshold for auto-hide**: Should hitting N flags (e.g. 3) on `original` content trigger automatic `under_review` status, or is all gating manual admin review? Recommendation: manual for testnet (volume will be low), auto-threshold as a config option pre-mainnet.

2. **Creator notification timing**: Notify creator when content is flagged (before admin review) or only when action is taken? Recommendation: notify only on action — flagging is common, action is signal.

3. **DMCA counter-notice**: Out of scope for testnet. When mainnet approaches, this becomes legally load-bearing for DMCA safe harbor. Flag as a hard requirement for mainnet gate.

4. **On-chain content**: When content has an associated on-chain hash (via `createNode`), "removal" only hides the platform representation. The hash and transaction remain on Sepolia. This should be disclosed in the DMCA form: "Note: blockchain transaction records cannot be deleted."
