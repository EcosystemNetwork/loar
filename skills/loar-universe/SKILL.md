---
name: loar-universe
description: Use when the user wants to look up, list, organize, or edit the metadata of a LOAR story universe, its entities (characters, places, factions, lore, etc.), profiles, talent agents, or canon — without generating new media. Invokes the LOAR platform (loar.fun) read and metadata-write surfaces. Do NOT use for image/video/audio generation (use the `loar-video` skill instead) or for on-chain mint / list / canon-vote operations (those require explicit confirmation and are covered in `loar-video`'s ask-before-anchoring rules).
version: 0.1.0
requires_mcp_server: '@loar/mcp-server>=0.2.0'
---

# LOAR Universe & Entity Management

Narrower sibling to the `loar-video` skill. Use this when the user is doing worldbuilding bookkeeping, research, or lookup — not creative generation. If the request involves rendering media, defer to `loar-video`.

---

## Scope

### Use this skill for

- Listing, reading, or searching universes (`loar_list_universes`, `loar_get_universe`, `resources/list`).
- Listing, reading, creating, or editing entities (characters, places, factions, etc.).
- Reading a creator's profile or discovering other creators (`loar_get_profile`, `loar_discover_profiles`).
- Browsing talent agents (`loar_discover_talent_agents`).
- Reading canon entries (`loar_get_canon`).
- Reading credit balance (`loar_get_credits`).
- Checking pipeline run status (`loar_get_pipeline_run`).

### Do NOT use this skill for

- Generating images, videos, voice, 3D, sound effects → `loar-video`.
- Minting NFTs, creating listings, submitting to canon, proposing collabs → `loar-video` (ask-before-anchoring rules).
- Running AI agent pipelines that render media → `loar-video`.

---

## Hard rules

### 1. Metadata writes are cheap; renders are expensive

Entity creation (`loar_create_entity`) is free — no credits charged. It's just a Firestore write. So you can create entities freely as long as the user explicitly asked. Do NOT speculatively create entities the user hasn't mentioned.

### 2. Default all new entities to unowned (no universeAddress)

When calling `loar_create_entity`, only set `universeAddress` if the user:

- Has an existing universe (verified via `loar_list_universes`), AND
- Explicitly said "add to my universe X", "put this in the Cyberdeck universe", etc.

Otherwise leave `universeAddress` unset — the entity lives standalone in the creator's workspace.

### 3. Entity kind is a choice; ask if ambiguous

The `kind` enum is: `person | place | thing | faction | event | lore | species | vehicle | technology | organization`.

A "magic sword" is `thing`. A "king" is `person`. A "space navy" is `organization` or `faction` depending on scope. If the request is ambiguous ("add Skybreaker to my universe"), ask — one clarifying question beats a wrong kind.

### 4. Universe-level ops require on-chain calls

Creating a universe itself involves smart contract deployment. That is NOT in this skill's scope. Direct the user to the web app:

> Creating a universe deploys a smart contract and tokenizes your IP. That flow is at https://loar.fun/create — I'll help with everything else once it exists.

### 5. Do not leak other users' private data

`loar_discover_profiles` returns public profiles. If a user asks about someone specifically ("what's alice's email?"), refuse — profiles expose only what the owner chose to make public. Show what the API returned, nothing more.

---

## Composition patterns

### Universe audit

**User:** What's in my Cyberdeck universe?

1. `loar_list_universes` → find by name match → get `universeAddress`.
2. `loar_list_entities({ universeAddress })` → list all.
3. Group by kind. Summarize counts. Offer to show details on any group.

### Add a character

**User:** Add a new character named Rex to Cyberdeck, he's a bounty hunter.

1. Resolve universe → `universeAddress`.
2. `loar_create_entity({ name: "Rex", description: "A bounty hunter in the Cyberdeck universe", kind: "person", universeAddress })`.
3. Return the entity ID.
4. Offer to hand off to `loar-video` for a portrait render: "Want me to generate a portrait and lore card for Rex? That switches to the media generation skill."

### Search for a creator

**User:** Find creators who work on cyberpunk stories.

1. `loar_discover_profiles({ search: "cyberpunk", limit: 10 })`.
2. Return a list. Offer to look up any of them individually via `loar_get_profile`.

### Canon lookup

**User:** What's accepted canon in the Cyberdeck universe?

1. Resolve universe → `universeId`.
2. `loar_get_canon({ universeId })`.
3. List entries, grouped by submission type.

---

## Error handling

Same structured error codes as `loar-video`. This skill mostly hits read endpoints, so the common ones are:

| `errorCode`    | What to do                                                   |
| -------------- | ------------------------------------------------------------ |
| `NOT_FOUND`    | Universe / entity / profile doesn't exist. Confirm spelling. |
| `RATE_LIMITED` | Read rate limit. Wait 60s.                                   |
| `FORBIDDEN`    | The resource is private or not owned by the requester.       |

---

## Handoff to other skills

When the user pivots from research to creation:

> "Ok I see Rex. Now generate a portrait of him."

Don't try to call `loar_generate_image` from this skill. Hand off:

> That's a render request — switching to the video/image generation skill for that.

(MCP hosts handle the handoff automatically if both skills are installed and `loar-video` matches the new trigger phrase. You don't need to invoke it manually.)

---

## Ending a session

Summarize what you surfaced. If the user took metadata-write actions (created entities), list the IDs so they can find them again. If they're likely to want renders next, proactively flag that the other skill handles that.
