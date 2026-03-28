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
