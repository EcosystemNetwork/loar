# LOAR — AI Lab: Seed Agents Challenge submission

> Beta University · BytePlus · AI Valley
> Track 5 — Most Creative (Multimodal Focus)
> Hard deadline: April 27 · In-person finale: May 2 (Silicon Valley)

## One-liner

**LOAR is an autonomous studio for original IP.** Seed agents read a universe's canon, plan multi-scene episodes, and generate them with character consistency on Seedance — then the community votes which episodes become canonical, on-chain.

## Why this is different

Today's AI video is a passive loop — one prompt, one clip, no memory. LOAR builds **persistent story worlds** where:

- Every episode lives inside a tokenized universe with on-chain canon
- A **showrunner agent** reasons over prior canon before generating new content
- **Character consistency** is enforced across scenes using Seedance's reference-to-video mode + a per-universe cast registry
- The **community** votes which agent-generated episodes become canonical via the on-chain canon marketplace
- The output isn't a clip — it's a **persistent IP universe** that creators own and the community governs

## How we use the Seed stack

| Model                                       | Where it lives in our pipeline                                                                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Seedance 2.0** (T2V / I2V / ref-to-video) | Primary video generator. `apps/server/src/services/bytedance.ts` :: `generateVideo()`. Multi-clip episode flow uses ref-to-video for cast consistency. |
| **Seedream 5.0**                            | Storyboard keyframes and character portraits. `bytedance.ts` :: `generateImage()`. Wired into the studio's image pipeline.                             |
| **Seed 2.0** (chat completions)             | Orchestrator brain — episode planner, prompt enhancer, dialog scripter. `bytedance.ts` :: `chat()`. Default model: `seed-1-6-thinking-250715`.         |
| **Seed Speech** (TTS)                       | Synthesizes voice for talking-scene flow. `bytedance.ts` :: `generateSpeech()`.                                                                        |
| **OmniHuman**                               | Drives the talking-scene flow (portrait + speech → talking video). `bytedance.ts` :: `generateTalkingScene()`.                                         |

**Hard rule we comply with:** All video generation runs through BytePlus Seed models. No Sora, no Runway, no Kling. Third-party LLMs are only used for non-video orchestration where Seed 2.0 isn't applicable.

## Architecture

```
                ┌────────────────────────────────────────┐
                │            User intent                 │
                │   "make a Space Fleet episode about    │
                │    the captain confronting the AI"     │
                └────────────────┬───────────────────────┘
                                 │
              ┌──────────────────▼──────────────────┐
              │   Showrunner Agent (Seed 2.0 chat)  │
              │   - reads universe canon            │
              │   - plans 3-clip episode arc        │
              │   - emits scene-by-scene script     │
              └────┬─────────────┬──────────────────┘
                   │             │
        ┌──────────▼──┐    ┌─────▼────────┐
        │ Seedream 5  │    │ Cast registry │
        │ keyframes   │    │ + reference   │
        │ per scene   │    │ portraits     │
        └──────┬──────┘    └─────┬────────┘
               │                  │
               └────────┬─────────┘
                        ▼
              ┌─────────────────────────┐
              │    Seedance 2.0         │
              │  ref-to-video per scene │
              │  cast-consistent        │
              └────────────┬────────────┘
                           │
                ┌──────────▼──────────────┐
                │  Optional: OmniHuman    │
                │  + Seed Speech for      │
                │  talking-scene cameos   │
                └──────────┬──────────────┘
                           ▼
            ┌─────────────────────────────────┐
            │  Episode assembled & published  │
            │  Content hash → IPFS (Pinata)   │
            │  Hash → Universe smart contract │
            │  Listed in Netflix-style canon  │
            │  rail; community can vote it    │
            │  canonical on-chain             │
            └─────────────────────────────────┘
```

## Bring-Your-Own-Key (BYOK)

Every authenticated user can plug in their own ModelArk API key at [/settings/api-keys](apps/web/src/routes/settings.api-keys.tsx).

- Keys are validated with a small chat round-trip on the user's quota before storage
- Stored encrypted with AES-256-GCM (`USER_SECRETS_MASTER_KEY` server-side)
- Never returned to the client — UI shows only `•••• abcd` for confirmation
- All four pipelines (video / image / chat / talking-scene) automatically route through the user's key when set, falling back to the platform key when not

This means **judges can demo on their own credits**, and any builder watching can fork LOAR and bring their own ModelArk keys without sharing them with us.

## 2-minute demo script

### 0:00–1:00 — Live demo

1. Land on Space Fleet universe page. Canon rail shows 3 prior episodes.
2. Click **Generate episode** → type one line of intent.
3. Cut to backend trace: Seed 2.0 returns a 3-scene plan; Seedream 5 produces keyframes; Seedance 2.0 generates each scene with cast reference images.
4. Episode auto-assembles, lands in the Netflix-style canon rail.
5. Show on-chain: content hash on Sepolia explorer, "Submit to canon" button.

### 1:00–1:30 — Architecture

1. Show the architecture diagram above (live, in `/docs` or as overlay).
2. Highlight: showrunner agent → Seed 2.0; keyframes → Seedream; motion → Seedance ref-to-video; on-chain canon vote.
3. Cut to `/settings/api-keys` — show BYOK in action.

### 1:30–2:00 — Vision

1. **Tokenized AI studios** — every universe is its own tokenized IP, governed by holders.
2. **Agents that train on canon** — every published episode becomes context for the next agent run; the universe gets smarter over time.
3. **Fan-driven multiverses** — anyone can fork a universe, propose alternate canon, and earn if their episode wins the vote.

## Submission form copy

**Project name:** LOAR — Autonomous Studio for Original IP

**Tagline:** AI video today is one-shot clips. LOAR builds persistent story worlds where Seed agents act as showrunners and communities own the canon.

**Track:** 5 — Most Creative (Multimodal Focus). Strong fit also for Track 1 (Vertical Video Agents).

**Live demo:** [loar.fun](https://loar.fun)
**Demo video:** _(record + link before submission)_
**Repo:** _(public link before submission — make sure no secrets in history)_

**Tech stack (relevant to Seed):** Seedance 2.0 (T2V/I2V/ref-to-video), Seedream 5.0, Seed 2.0 chat completions, Seed Speech, OmniHuman. All wired in [`apps/server/src/services/bytedance.ts`](apps/server/src/services/bytedance.ts) with key rotation, async polling, and per-call BYOK override.

**Tech stack (rest of system):** React 18 + Vite + TanStack Router (web). Hono + tRPC + Bun (server). Ponder v0.15 (indexer). Foundry + Solidity ^0.8.30 (69 contracts on Sepolia + Base Sepolia). Firestore (off-chain metadata). Pinata + Lighthouse (decentralized storage). thirdweb + SIWE (auth). Circle DCW (server-signed transactions).

**What's novel:**

1. Showrunner agent that reasons over canon before each generation — not just a UI for video gen
2. Cast registry + reference-to-video for character consistency across scenes (the missing piece in long-form AI video)
3. On-chain canon governance — fans vote which agent outputs become canonical
4. BYOK encryption layer so judges and users can demo on their own ModelArk credits
5. Tokenized IP — every universe is its own tradable economy

## Sponsor integrations to highlight

- **BytePlus / ModelArk** — full Seed stack as primary video + planning + speech provider
- **Base** — testnet on Base Sepolia, mainnet target Base L2
- **thirdweb** — wallet auth, in-app wallets (email/social/passkey), gas sponsorship
- **Pinata** — IPFS pinning for all generated content
- **Lighthouse** — Filecoin redundancy for permanence

## What's not in the demo (intentionally)

- Mainnet deployment (testnet only — see [README.md](README.md#planned-not-implemented))
- Mobile app (Expo build works but not store-published)
- Real-money Stripe path (in test mode)

## Status checks before submission

- [ ] `BYTEDANCE_API_KEY` set on the deployed server (or BYOK key used in demo)
- [ ] `USER_SECRETS_MASTER_KEY` set on deployed server (`openssl rand -hex 32`) so BYOK encryption works
- [ ] At least one Space Fleet episode end-to-end through Seed pipeline
- [ ] Judge wallet pre-funded with testnet ETH + $LOAR + ModelArk credits
- [ ] Demo URL loads in <30s on cold cache
- [ ] Repo public, no secrets in git history
- [ ] 2-min video uploaded; link in submission form
- [ ] [betahacks.org](https://betahacks.org) submission form filled out

## What was built specifically for this submission

- Per-call BYOK override on `bytedanceService` (every method now accepts `apiKey?`)
- `seedOrchestrator.chat()` — Seed 2.0 chat-completion wrapper for the showrunner agent
- `generateSpeech()` — Seed Speech wrapper
- `generateTalkingScene()` — OmniHuman wrapper
- Encrypted user-secrets store (`apps/server/src/services/userSecrets.ts`) with AES-256-GCM
- `userSecrets` tRPC router (set / clear / test / list)
- `/settings/api-keys` UI — paste, test, save, remove
- Hackathon-aware README block + this document

## What was already there (and we get for free)

- Seedance 2.0 + Seedream 5.0 wired across studio, gallery, episode assembly
- Multi-clip episode generation (`episodes.generateFromScript`)
- Cast registry + reference-image resolution for character consistency
- Netflix-style canon rail
- On-chain canon submission + voting (`CanonMarketplace.sol`)
- Universe contracts + governance + tokenization on Sepolia + Base Sepolia
- Decentralized storage (Pinata + Lighthouse)
- Indexer with 29 GraphQL tables
- Per-universe AI agent system + MCP server with 25 tools
