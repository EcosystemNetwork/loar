# PRD: LOAR Worldbuilding Studio

**Entity-first creation + world-encyclopedia wiki**
Status: Draft — 2026-03-27

---

## Problem

LOAR's current frontend surfaces three disconnected experiences:

| Surface           | Route                          | What it actually is              |
| ----------------- | ------------------------------ | -------------------------------- |
| Universe launcher | `/cinematicUniverseCreate`     | On-chain contract deployer       |
| Media uploader    | `/upload`                      | IP classification + file publish |
| Character wiki    | `/wiki`, `/wiki/character/$id` | NFT character gallery            |

The backend already has a richer model — an `entities` router that supports CRUD + parent-child + metadata inside a universe — but it exposes only six abstract ontology types (`timeline`, `reality`, `dimension`, `plane`, `realm`, `domain`). Users can't create a character, a city, or a faction anywhere without going through the timeline node editor.

The result: creation is split across three surfaces, the wiki is character-only, and nothing feels like a worldbuilding tool.

---

## Goal

Make LOAR feel like a **worldbuilding studio** by:

1. Giving every meaningful narrative object a first-class creation form.
2. Replacing the character gallery with a world-encyclopedia wiki.
3. Making universe attachment **optional** — entities exist independently and can be tagged to a universe as an organizational layer, not a structural requirement.

---

## Scope

### In scope

- New `/create` hub route and child form routes
- Expanded `ENTITY_KINDS` on server (additive, non-breaking)
- Per-kind metadata schemas in `entities.types.ts`
- **Schema change**: move entities to top-level Firestore collection; `universeAddress` becomes optional
- New `/wiki` structure with tabbed browsing, universe filter, and kind-scoped list views
- `/wiki/:kind/:id` entity detail pages (no universe address needed in URL)

### Out of scope (later)

- Relationship graph editor (links between entities)
- Advanced hierarchy assignment UI (assign a person to a realm/dimension)
- On-chain entity anchoring (nodeIds remain optional)
- Full-text search across entity bodies

---

## Current State Inventory

### Backend — `entities` router

- **Storage (current)**: `cinematicUniverses/{universeAddress}/entities/{entityId}` subcollection — universe address is baked into the Firestore path, making it structurally required
- **Schema**: `id, name, description, kind, universeAddress, parentId, nodeIds[], imageUrl, metadata{}, creator, createdAt, updatedAt`
- **CRUD**: create, get, list (by universe + optional kind), children, update, delete, addNode, removeNode
- **Auth**: reads are public, mutations require auth
- **Current kinds**: `timeline | reality | dimension | plane | realm | domain`
- **Parent rules**: enforced by `VALID_PARENTS` in `entities.types.ts`

The `metadata` field is `Record<string, unknown>` — this is where per-kind structured data lives.

### Frontend — existing routes

```
/cinematicUniverseCreate   on-chain universe deployer (keep as-is)
/upload                    media publish (keep as-is)
/wiki/                     character gallery (replace)
/wiki/character/$id        character detail (keep, still renders)
/universe/$id              timeline editor (unchanged)
```

### Key constraint

The existing `wiki.characters` query reads from a top-level `characters` Firestore collection (NFT characters from the collection drop). New entity-system `person` entries are a separate population and must be treated separately in the wiki.

---

## Changes

### 0. Schema Change — Universe Attachment Is Optional

**Decision**: entities are first-class objects that exist independently. A universe is an optional organizational tag, not a structural requirement. Universe attachment enables wiki filtering and on-chain anchoring, but is not needed to create an entity.

**Storage migration required**: the current subcollection path `cinematicUniverses/{addr}/entities/{id}` bakes the universe address into the Firestore path, making it structurally mandatory. This must change.

**New storage**: top-level `entities` collection.

```
entities/{entityId}          ← was: cinematicUniverses/{addr}/entities/{entityId}
```

**Schema delta**:

```ts
// Before
universeAddress: string; // required, Ethereum address

// After
universeAddress: string | null; // null = not attached to any universe
```

**Router changes needed** (`entities.routes.ts` + `entities.handlers.ts`):

| Procedure                          | Before                                        | After                                                         |
| ---------------------------------- | --------------------------------------------- | ------------------------------------------------------------- |
| `create`                           | `universeAddress` required                    | `universeAddress` optional, defaults to `null`                |
| `get`                              | `entities.get({ universeAddress, entityId })` | `entities.get({ entityId })` — top-level lookup               |
| `list`                             | `entities.list({ universeAddress, kind? })`   | `entities.list({ universeAddress?, kind?, creatorAddress? })` |
| `children`                         | scoped to universe                            | same, parentId is still an entityId                           |
| `update/delete/addNode/removeNode` | need `universeAddress` for path               | only need `entityId` now                                      |

**`entitiesCol` helper** in `entities.handlers.ts` becomes:

```ts
// Before: subcollection
function entitiesCol(universeAddress: string) {
  return db.collection('cinematicUniverses').doc(addr).collection('entities');
}

// After: top-level collection
const entitiesCol = db.collection('entities');
```

**Firestore index needed**: composite index on `(universeAddress, kind, createdAt)` for the filtered wiki list queries.

**Migration note**: the structural kinds (`timeline`, `reality`, `dimension`, `plane`, `realm`, `domain`) currently require a universe — that's fine, they still set `universeAddress`. The optional-ness only applies to the creator-facing kinds (`person`, `place`, `thing`, etc.). The `VALID_PARENTS` validation remains unchanged.

**No existing documents to migrate** — these entity kinds don't exist in production yet. The `VALID_PARENTS` parent-child relationship uses `entityId` references, not universe-scoped paths, so it works identically in the top-level collection.

---

### 1. Entity Kinds — `entities.types.ts`

Expand `ENTITY_KINDS` from 6 to 16. Existing 6 are preserved. New creator-facing kinds added first.

```ts
export const ENTITY_KINDS = [
  // Creator-facing (primary)
  'person',
  'place',
  'thing',
  'faction',
  'event',
  'lore',
  'species',
  'vehicle',
  'technology',
  'organization',
  // Advanced world structure (existing — unchanged)
  'timeline',
  'reality',
  'dimension',
  'plane',
  'realm',
  'domain',
] as const;
```

Update `VALID_PARENTS` — new kinds can be root-level (`null`) or nested under `realm`, `timeline`, or `dimension`:

```ts
const CREATOR_KINDS = [
  'person',
  'place',
  'thing',
  'faction',
  'event',
  'lore',
  'species',
  'vehicle',
  'technology',
  'organization',
] as const;

// All creator kinds: can be root or under a structural parent
CREATOR_KINDS.forEach((k) => {
  VALID_PARENTS[k] = [null, 'realm', 'timeline', 'dimension'];
});
```

Existing `VALID_PARENTS` entries for the 6 structural kinds are **unchanged**.

Add per-kind metadata field manifest (used by forms and detail views only — not server-validated):

```ts
export const KIND_META_FIELDS: Record<string, string[]> = {
  person: ['role', 'appearance', 'motivations', 'affiliations', 'abilities', 'homePlace'],
  place: ['placeType', 'atmosphere', 'dangers', 'governingFaction', 'connectedPlaces'],
  thing: ['thingType', 'origin', 'owner', 'powers', 'rarity', 'rules'],
  faction: ['mission', 'ideology', 'leader', 'rivals', 'hq', 'symbols'],
  event: ['era', 'participants', 'location', 'causes', 'outcome', 'canonStatus'],
  lore: ['loreType', 'body', 'relatedConcepts', 'canonWeight'],
  species: ['origin', 'keyTraits', 'habitat', 'culture'],
  vehicle: ['vehicleType', 'owner', 'specs', 'weaponry'],
  technology: ['techType', 'creator', 'function', 'era'],
  organization: ['mission', 'leader', 'members', 'resources'],
};
```

All metadata values are stored as plain strings (comma-separated for list fields). The form serializes them into `entity.metadata` before submitting.

**Risk**: purely additive. No existing documents touched. `VALID_PARENTS` for the 6 structural kinds unchanged.

---

### 2. New Frontend Routes

#### Create

```
/create                    hub — entity type picker + universe selector
/create/universe           → redirect to /cinematicUniverseCreate
/create/person
/create/place
/create/thing
/create/faction
/create/event
/create/lore
/create/species
/create/vehicle
/create/technology
/create/organization
```

New files:

- `apps/web/src/routes/create/index.tsx` — hub
- `apps/web/src/routes/create/$kind.tsx` — parameterised form

#### Wiki

```
/wiki                      hub — tabbed world overview
/wiki/people               person list
/wiki/places               place list
/wiki/things               thing list
/wiki/factions             faction list
/wiki/events               event list
/wiki/lore                 lore list
/wiki/characters           NFT character gallery (existing content, keep working)
/wiki/character/$id        character detail (keep working)
/wiki/$kind/$id            entity detail (new, unified)
```

New/modified files:

- `apps/web/src/routes/wiki/index.tsx` — replace current
- `apps/web/src/routes/wiki/$section.tsx` — section list view (new)
- `apps/web/src/routes/wiki/$kind/$id.tsx` — entity detail (new)

---

### 3. Shared Components

#### `EntityCreateForm`

`apps/web/src/components/EntityCreateForm.tsx`

```
Props:
  kind: EntityKind
  universeAddress?: string   // optional — pre-fills the universe selector if provided
  onSuccess: (entity) => void

Renders:
  name                    → entity.name        (required)
  description             → entity.description
  image                   → entity.imageUrl
  [per-kind fields]       → entity.metadata keys from KIND_META_FIELDS[kind]
  [Universe (optional)]   → entity.universeAddress — collapsible "Add to Universe" picker
                             Shows as: "📌 Attach to a universe (optional)"
                             Selecting a universe enables wiki organization and filtering
  [Submit]                → entities.create mutation
```

The universe selector is intentionally placed at the bottom, below the content fields, so it reads as "optionally file this under a universe" rather than "you must pick a universe first."

Per-kind fields are rendered as: text input, textarea, or tag input (comma-separated). No custom widget needed.

#### `EntityCard`

`apps/web/src/components/EntityCard.tsx`

Generic card: kind badge, image thumbnail, name, description excerpt. Links to `/wiki/:kind/:id`. Used in all list views.

#### `EntityDetail`

`apps/web/src/components/EntityDetail.tsx`

Detail view: header (name, kind badge, universe), full-size image, description, metadata fields (labels from KIND_META_FIELDS, values from entity.metadata, empty fields hidden), associated media (via nodeIds), edit button (auth + creator check).

#### `WikiTabs`

`apps/web/src/components/WikiTabs.tsx`

Tab bar: Overview | People | Places | Things | Factions | Events | Lore | Collection | Timelines | Realms

Each tab is a link to `/wiki/$section`. Highlights on route match.

---

### 4. Create Hub — `/create`

Grid of entity type cards. No universe selector at the top — universe is attached per-entity inside the form.

| Kind       | Icon      | Tagline                                     |
| ---------- | --------- | ------------------------------------------- |
| Universe   | Globe     | Deploy a new on-chain story universe        |
| Person     | User      | Characters, NPCs, historical figures        |
| Place      | MapPin    | Cities, planets, taverns, kingdoms          |
| Thing      | Box       | Artifacts, weapons, relics, tools           |
| Faction    | Shield    | Guilds, houses, armies, companies           |
| Event      | Zap       | Battles, discoveries, betrayals, milestones |
| Lore       | BookOpen  | Laws, prophecies, magic systems, religions  |
| Species    | Dna       | Creatures, races, lifeforms                 |
| Vehicle    | Rocket    | Ships, mounts, war machines                 |
| Technology | Cpu       | Inventions, systems, protocols              |
| Timeline   | GitBranch | Story branches and chronologies             |
| Realm      | Layers    | Planes, dimensions, world layers            |

Universe card routes to `/cinematicUniverseCreate`. All others route to `/create/:kind`. If the user came from a universe page (`/universe/$id`), that address can be passed as `?universe=0x...` to pre-fill the optional universe picker inside the form.

---

### 5. Per-Kind Create Forms

All forms: name → description → image → kind-specific fields → [optional universe picker] → submit.

**Person**

- Role / Archetype (text)
- Appearance (textarea)
- Motivations (textarea)
- Affiliations (tags)
- Abilities (tags)
- Home Place (text)

**Place**

- Type: City | Planet | Region | Building | Dungeon | Other
- Atmosphere (textarea)
- Dangers (textarea)
- Governing Faction (text)
- Connected Places (tags)

**Thing**

- Type: Weapon | Artifact | Book | Tool | Vehicle | Other
- Origin (text)
- Current Owner (text)
- Powers / Use (textarea)
- Rarity: Common | Uncommon | Rare | Legendary | Unique

**Faction**

- Mission (textarea)
- Ideology (text)
- Leader (text)
- Rivals (tags)
- HQ Location (text)
- Symbols / Colors (text)

**Event**

- Era / Date (text — free-form, e.g. "Year 3 of the Collapse")
- Participants (tags)
- Location (text)
- Causes (textarea)
- Outcome (textarea)
- Canon Status: Canon | Legends | Non-Canon | Unknown

**Lore**

- Type: Law | Prophecy | Magic System | Religion | Myth | History | Other
- Article Body (textarea, markdown)
- Related Concepts (tags)
- Canon Weight: Core | Expanded | Apocryphal

**Species**, **Vehicle**, **Technology**, **Organization** — same pattern using their `KIND_META_FIELDS` entries.

---

### 6. Wiki Redesign

#### `/wiki` — Hub

Replace current character gallery. Layout:

```
[Search input]                     (searches across all entities, client-side)
[Universe filter: All | Universe A | Universe B | ...]   (optional — defaults to All)

[WikiTabs]

[Tab content]
```

Universe filter is a pill selector, not a required gate. Default is **All** — the wiki shows everything the user has created across all universes. Selecting a universe narrows all tabs to that universe's entities.

**Overview tab**: entity counts by kind (queries `entities.list({ kind })` per kind, filtered if universe selected), recently created entities, search.

**Section tabs** (People, Places, Things, Factions, Events, Lore): entity card grid from `entities.list({ universeAddress?, kind })`. Empty state shows "No [people] yet — [Create one]".

**Collection tab**: current NFT character gallery — `wiki.characters` query. Preserved intact.

**Timelines / Realms tabs**: structural entity list (`kind: 'timeline'` or `'realm'`). These always require a universe (they're structural), so this tab shows an empty state with a "Select a universe" prompt when no universe is filtered.

#### `/wiki/$section`

`$section` maps to `EntityKind`:

```
people     → person
places     → place
things     → thing
factions   → faction
events     → event
lore       → lore
timelines  → timeline
realms     → realm
characters → stays as legacy NFT gallery
```

Inherits the universe filter from `/wiki` via URL search param (`?universe=0x...`). Renders: WikiTabs + EntityCard grid + search.

#### `/wiki/$kind/$id`

Renders `EntityDetail`. Fetches via `entities.get({ entityId })` — no universe address needed in the URL since entities are now top-level. Shows all non-empty metadata fields, universe badge (if attached, links to `/universe/$addr`), edit button.

The existing `/wiki/character/$id` route stays working — it renders the current character detail component unchanged.

---

### 7. Navigation

Update header link from `/cinematicUniverseCreate` to `/create`:

```tsx
// apps/web/src/components/header.tsx
{ to: '/create', label: 'Create' },   // was /cinematicUniverseCreate
```

`/cinematicUniverseCreate` still exists — it's reached via the "Universe" card in the create hub.

---

### 8. Rollout Order

#### Phase 1 — Backend (breaking schema change, do first)

1. Move `entitiesCol` from subcollection to top-level `db.collection('entities')` in `entities.handlers.ts`
2. Make `universeAddress` optional (`string | null`) in `entities.types.ts` — `CreateEntityInput` and `Entity`
3. Update `entities.routes.ts`: remove `universeAddress` from `get`/`update`/`delete`/`addNode`/`removeNode` inputs; make it optional on `create` and `list`
4. Update `VALID_PARENTS` validation — structural kinds still require a universe, creator kinds do not
5. Expand `ENTITY_KINDS` to 16 kinds
6. Add `KIND_META_FIELDS` export
7. Add Firestore composite index: `(universeAddress, kind, createdAt DESC)`
8. Verify existing queries still work (there are no production entity documents to migrate)

#### Phase 2 — Create hub

1. `EntityCreateForm` component (with universe as optional bottom field)
2. `EntityCard` component
3. `/create/index.tsx` hub
4. `/create/$kind.tsx` form route
5. Header nav: `/cinematicUniverseCreate` → `/create`

#### Phase 3 — Wiki redesign

1. `EntityDetail` component
2. `WikiTabs` component
3. Replace `/wiki/index.tsx` with tabbed hub + universe filter
4. `/wiki/$section.tsx` list view
5. `/wiki/$kind/$id.tsx` detail view (entity lookup by ID only)
6. Keep `/wiki/character/$id` intact

#### Phase 4 — Polish (deferred)

- Universe filter state persisted to URL search param so tabs stay filtered on navigation
- Entity counts on wiki tabs
- Recent entities widget on dashboard sidebar
- Inline entity creation from timeline editor (create entity → optionally link to a node)
- Cross-entity soft-links: click a faction name in entity metadata → navigate to that faction's wiki page

---

### 9. What Stays Unchanged

| Thing                                | Why                                                               |
| ------------------------------------ | ----------------------------------------------------------------- |
| `/cinematicUniverseCreate`           | On-chain deploy wizard; still reachable via create hub            |
| `/upload`                            | Media publish + IP classification; separate concern               |
| Timeline editor (`/universe/$id`)    | Entity creation feeds into this via optional nodeIds              |
| `/wiki/character/$id`                | Backwards compat; renders same detail component                   |
| NFT character gallery query          | Different Firestore collection from entity system                 |
| `VALID_PARENTS` for structural kinds | Timeline/realm hierarchy unchanged; they still require a universe |

### 10. Resolved Design Decisions

| Decision                                    | Resolution                                                                            |
| ------------------------------------------- | ------------------------------------------------------------------------------------- |
| Universe required to create an entity?      | **No.** Universe is an optional organizational tag.                                   |
| Where does universe fit in the create form? | **Bottom of form**, after content fields. Label: "Add to a universe (optional)".      |
| Wiki default view                           | **All entities** — universe filter defaults to "All", users narrow optionally.        |
| Entity URL structure                        | `/wiki/:kind/:id` — no universe address in URL. `entities.get` takes only `entityId`. |
| Structural kinds (timeline/realm/dimension) | Still require a universe (they are hierarchy, not standalone objects).                |
| NFT characters vs entity persons            | Separate populations. NFT gallery stays as "Collection" tab.                          |

### 11. Open Questions

**Q1: Who can see unattached entities?**
If `universeAddress` is null, who can list them? Options: (a) only the creator, (b) public by default, (c) controlled by a `visibility` field. Current entity schema has no visibility field.
_Recommendation_: default to public (consistent with current behavior). Add `visibility: 'public' | 'private'` to the schema if needed in a future pass.

**Q2: Entity search at scale**
`entities.list` with no universe filter is a full top-level collection scan. At what entity count does this degrade?
_Recommendation_: client-side filter works up to ~1000 entities loaded. Add `limit` + `startAfter` cursor when pagination is needed. For now, always pass `kind` to keep query sets small.
