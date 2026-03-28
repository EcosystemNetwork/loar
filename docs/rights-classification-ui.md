# LOAR — Rights Classification UI Spec

## Overview

Three content lanes govern what every piece of content can display, sell, and do. This spec covers how each lane appears across every surface that touches content: upload form, content card, universe marketplace, creator dashboard, and checkout/mint flow. It also covers the data model changes required to support a third lane.

---

## The Three Lanes

| Lane                    | Internal value | Display name   | Badge color            |
| ----------------------- | -------------- | -------------- | ---------------------- |
| Personal / Fan / Parody | `fan`          | Non-Commercial | Gray                   |
| Creator-Owned           | `original`     | Creator-Owned  | Blue                   |
| Rights-Cleared          | `licensed`     | Rights-Cleared | Green (with lock icon) |

The current codebase uses `fun` and `monetized`. The migration path:

- `fun` → `fan` (rename, no behavior change)
- `monetized` → `original` (rename, same validation rules)
- `licensed` → new third value, treated as `original` with additional `licensingProof` field and a `reviewStatus` field

---

## Data Model Changes

### `content.routes.ts` — classification enum

Current:

```ts
const contentClassification = z.enum(['fun', 'monetized']);
```

Required:

```ts
const contentClassification = z.enum(['fan', 'original', 'licensed']);
```

### New fields on `createContentSchema` for `licensed` content

```ts
// Only required when classification === 'licensed'
licensingProof: z.object({
  licensorName: z.string().min(1).max(200),
  licenseType: z.enum(['exclusive', 'non-exclusive', 'sublicense']),
  territory: z.string().max(200),          // e.g. "worldwide", "US only"
  termEnd: z.string().optional(),          // ISO date or "perpetual"
  approvedUses: z.array(z.string()),       // e.g. ["nft", "subscription", "merch"]
  restrictedUses: z.array(z.string()),     // e.g. ["gaming", "film"]
  royaltySplit: z.number().min(0).max(100), // % to licensor
  documentUrl: z.string().url().optional(), // uploaded agreement
}).optional(),
```

### New `reviewStatus` field on content document

```ts
// Added by server at creation time, not user-provided
reviewStatus: z.enum(['not_required', 'pending', 'approved', 'rejected']).default('not_required'),
reviewNotes: z.string().optional(),
```

Server logic:

- `fan` and `original` → `reviewStatus: 'not_required'`
- `licensed` → `reviewStatus: 'pending'` (triggers manual review queue)

### IP declaration rename

Current field `usescopyrightedMaterial` has a lowercase typo — should be `usesCopyrightedMaterial`. Fix this across content routes and all callers when making the enum migration.

---

## Validation Rules by Lane

Replace the current `if (input.classification === 'monetized')` block with:

```ts
if (input.classification === 'original' || input.classification === 'licensed') {
  if (input.ipDeclaration.usesCopyrightedMaterial) {
    throw new Error(
      'Monetized content cannot use third-party copyrighted material without a verified license. Use the Rights-Cleared lane and attach documentation, or switch to Non-Commercial.'
    );
  }
  if (input.ipDeclaration.license === 'fan-work') {
    throw new Error('Fan works cannot be monetized. Switch to Non-Commercial.');
  }
  if (!input.ipDeclaration.isOriginal) {
    throw new Error('Monetized content requires an originality declaration.');
  }
}

if (input.classification === 'licensed') {
  if (!input.licensingProof) {
    throw new Error(
      'Rights-Cleared content requires licensing details. Complete the licensing proof section.'
    );
  }
}
```

---

## Badge Component

### `ContentLaneBadge.tsx`

A single badge component rendered on every content surface.

Props:

```ts
type ContentLaneBadgeProps = {
  classification: 'fan' | 'original' | 'licensed';
  reviewStatus?: 'not_required' | 'pending' | 'approved' | 'rejected';
  size?: 'sm' | 'md';
};
```

Render rules:

| Lane                    | Icon       | Label          | Variant             |
| ----------------------- | ---------- | -------------- | ------------------- |
| `fan`                   | —          | Non-Commercial | `outline` (gray)    |
| `original`              | —          | Creator-Owned  | `default` (blue)    |
| `licensed` + `approved` | lock icon  | Rights-Cleared | `secondary` (green) |
| `licensed` + `pending`  | clock icon | Pending Review | `outline` (yellow)  |
| `licensed` + `rejected` | x icon     | Review Failed  | `destructive`       |

When `size='sm'`: icon only with tooltip. When `size='md'`: icon + label text.

Use the existing `Badge` component from `apps/web/src/components/ui/badge.tsx`.

---

## Upload Form — Classification Selector

The upload/create content form needs a classification step before the IP declaration fields.

### Step structure

1. **Pick a lane** (required, shown first)
2. **IP declaration** (fields change based on lane)
3. **Licensing proof** (only shown for `licensed` lane)

### Lane picker UI

Three radio cards, not a dropdown. Radio cards make the differences legible.

```
┌─────────────────────────────────────────────────────────────────┐
│ How are you using this content?                                  │
├──────────────────┬──────────────────┬──────────────────────────┤
│ Non-Commercial   │ Creator-Owned    │ Rights-Cleared           │
│                  │                  │                          │
│ Fan work, parody,│ Original work    │ Licensed from a rights   │
│ personal use,    │ you created.     │ holder. Requires         │
│ experimentation. │ Prompted AI is   │ documentation.           │
│                  │ included.        │                          │
│ Cannot mint,     │ Full             │ Full monetization with   │
│ sell, or license.│ monetization.    │ scoped permissions.      │
│                  │                  │                          │
│ ○ Select         │ ○ Select         │ ○ Select                 │
└──────────────────┴──────────────────┴──────────────────────────┘
```

### Non-Commercial disclosure (shown when `fan` is selected)

```
This content will be marked Non-Commercial. Monetization features
(NFT minting, subscriptions, licensing) will be disabled.

Fan and parody works are permitted on LOAR for personal and
creative use. This is a platform permission, not a legal opinion.
Third-party rights holders may still object to specific content
regardless of non-commercial intent.
```

### Creator-Owned disclosure (shown when `original` is selected)

```
By selecting Creator-Owned, you confirm:
☐ This work is original or based on materials you have rights to use
☐ It does not include recognizable third-party IP (characters, music,
   logos, settings) without documented permission
☐ You understand that LOAR treats AI-generated content as
   creator-claimed, subject to applicable law

LOAR does not verify originality declarations. You are responsible
for any third-party rights claims.
```

### Rights-Cleared disclosure + proof form (shown when `licensed` is selected)

```
Rights-Cleared content requires a licensing agreement before
monetization is enabled. Your content will be in Pending Review
until the LOAR team verifies your documentation.

Licensor name *          [                    ]
License type *           [ Non-Exclusive ▾    ]
Territory *              [                    ]
Term end date            [ Perpetual ▾        ]
Approved uses *          ☐ NFT  ☐ Subscribe  ☐ Merch  ☐ License
Creator royalty split *  [  80  ] %  →  Licensor: 20%
Upload agreement *       [ Choose file / paste URL ]

Rights-Cleared features are enabled only after manual approval.
You will be notified by email within 5 business days.
```

---

## Content Card

Every content card (feed, search results, universe gallery) must display the classification badge. Placement: bottom-left of the thumbnail, `size='sm'`.

Additional display logic by lane:

**Non-Commercial card:**

- Mint/Buy button: hidden (not disabled — hidden). Hiding is clearer than a disabled state that invites confusion.
- Footer line: "Non-Commercial · Not for sale"

**Creator-Owned card:**

- Mint/Buy button: shown when listing exists, enabled
- Footer line: "Creator-Owned · [price if listed]"

**Rights-Cleared pending card:**

- Mint/Buy button: hidden
- Footer line: "Rights-Cleared · Pending Review"

**Rights-Cleared approved card:**

- Mint/Buy button: shown when listing exists, enabled
- Footer line: "Rights-Cleared · [licensor name] · [approved uses]"

---

## Universe Marketplace Tab

When a fan browses a universe's marketplace, the lane classification determines what's listed and what copy is shown.

### Filter bar

Add a classification filter to the existing marketplace tab:

```
All  |  Creator-Owned  |  Rights-Cleared  |  Non-Commercial
```

Non-Commercial items are browsable but their action buttons are suppressed.

### Episode NFT listing card (expanded)

Below the title and thumbnail, show:

```
[Creator-Owned badge]
"Vera Ash — Episode 3: The Neon Awakening"
Price: 0.05 ETH  ·  42 / 500 minted
Creator: 0x1234...5678
Royalty: 5% on secondary sales

[Mint Episode NFT]
```

For `licensed` content, show the licensor and approved scope:

```
[Rights-Cleared badge]
"Licensed from: Acme Studios · Non-exclusive · US · NFT/Subscribe"
```

### Character NFT listing card

Same structure. Add character traits below the badge if available.

---

## Creator Dashboard — Content Tab

### Classification summary row

At the top of the creator's content list, show a summary:

```
Your content:  3 Non-Commercial  ·  12 Creator-Owned  ·  1 Pending Review
```

### Per-item lane switcher

Creators can switch content from `fan` to `original` (or vice versa) from the dashboard. Switching to `original` requires the originality disclosure checkboxes. Switching to `fan` from `original` is always permitted.

Switching to `licensed` from the dashboard is not permitted after upload — requires re-uploading with documentation.

Switching away from `licensed` (to `fan` or `original`) is permitted and immediately disables monetization for that item.

### Pending review items

Rights-Cleared items in `pending` review state show a yellow banner:

```
⏳ This content is awaiting rights verification. Monetization is
disabled until the review completes (typically 5 business days).
[View submitted details]  [Withdraw and resubmit]
```

---

## Mint / Checkout Flow

Before a fan completes a mint transaction, show a disclosure overlay:

**For Creator-Owned listings:**

```
You are minting: "The Neon Awakening" — Episode NFT
Creator: 0x1234...5678
Price: 0.05 ETH + gas
Royalty on resale: 5%

This is original content. The creator attests ownership.
LOAR does not independently verify IP claims.

[Confirm and Mint]  [Cancel]
```

**For Rights-Cleared listings:**

```
You are minting: "Starfall — Episode 1"
Creator: 0x1234...5678 · Licensed from: Acme Studios
License scope: NFT, Non-exclusive, US territory
Price: 0.08 ETH + gas  (includes 20% licensor royalty)
Creator royalty on resale: 5%

[Confirm and Mint]  [Cancel]
```

---

## Admin Review Queue (Rights-Cleared)

A simple review interface in the admin toolbar for `licensed` content pending approval.

Required admin actions:

- View submitted `licensingProof` fields and uploaded document
- Mark `reviewStatus` as `approved` or `rejected` with a `reviewNotes` field
- Approved items: monetization is immediately enabled
- Rejected items: creator is notified with the review notes; content reverts to Non-Commercial pending creator action

Admin tRPC procedures to add (in a new `apps/server/src/routers/admin/admin.routes.ts`):

```ts
reviewLicensedContent: adminProcedure
  .input(z.object({
    contentId: z.string(),
    decision: z.enum(['approved', 'rejected']),
    notes: z.string().optional(),
  }))
  .mutation(...)

getPendingReviews: adminProcedure
  .query(...)  // returns content where reviewStatus === 'pending'
```

---

## Copy Standards

These phrases must not appear in the UI:

| Prohibited                          | Reason                                      | Use instead                                                                                          |
| ----------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| "Parody is legal if non-commercial" | Overstates fair use                         | "Non-commercial fan/parody use is permitted on LOAR. Third-party rights holders may still object."   |
| "AI output belongs to you"          | Legal status is unsettled                   | "LOAR treats you as the rights claimant for content you generate here, subject to applicable law."   |
| "Fair use applies"                  | Platform cannot determine this              | Do not make this claim anywhere                                                                      |
| "Your content is fully protected"   | IP protection is not guaranteed by platform | "You retain the rights you declare. LOAR enforces classification rules but cannot verify ownership." |

---

## Migration Plan for Existing Content

The current Firestore collection has documents with `classification: 'fun'` and `classification: 'monetized'`. At migration time:

1. `fun` → `fan` (simple rename, no validation change, no user action required)
2. `monetized` → `original` (rename, no validation change, no user action required)
3. Add `reviewStatus: 'not_required'` to all existing documents

No existing content changes lanes. No user notification needed. The enum rename is the only breaking change and requires a one-time Firestore migration script plus updating `createContentSchema` and `updateContentSchema` in the content routes.
