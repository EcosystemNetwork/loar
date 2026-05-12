# LOAR — Creator Journey

Step-by-step from zero to a monetizable cinematic universe. Each step notes what works today and what doesn't.

---

## Step 1: Sign In

**Route:** `/login`
**Status:** LIVE

1. Click "Sign In" — the Circle DCW login screen opens
2. Continue with email, Google, Apple, or passkey
3. Server provisions a Circle-custodied EVM wallet for the account and issues a SIWE-style JWT session
4. You're authenticated — the wallet address is your identity

**What you need:** Just an email. The wallet is server-managed; gas for sponsored actions is covered by the platform.
**Time:** ~15 seconds

---

## Step 2: Create Your Universe

**Route:** `/cinematicUniverseCreate`
**Status:** LIVE

### Step 2a: Deploy the Universe Contract

1. Enter universe name and description
2. Upload or AI-generate a cover image
3. Click "Deploy" — sends transaction to UniverseManager contract
4. Wait for confirmation (~15 seconds on Sepolia)
5. Your Universe smart contract is live on-chain

### Step 2b: Deploy Governance Token

1. Set token name and symbol
2. Configure metadata
3. Click "Deploy Token" — this triggers:
   - GovernanceERC20 deployment (100B supply)
   - UniverseGovernor deployment (DAO)
   - Uniswap v4 pool initialization
   - LP token locking (anti-rug)
4. Your universe now has a tradeable governance token

**Time:** ~3-5 minutes (two transactions)

---

## Step 3: Build Your Story

**Route:** `/universe/$id`
**Status:** LIVE

The timeline editor is your creative workspace:

1. **Create a node** — Click "Create Event" in the sidebar or use the "+" button on the canvas
2. **Write your prompt** — Describe the scene, select characters from your cast
3. **Generate image** — AI creates a scene image (21 models available including FLUX, Recraft, Ideogram, Seedream, GPT Image)
4. **Generate video** — AI creates a 1-60s video from the image
   - 44 video models: Veo 3.1, Kling 3.0, Wan 2.7, Sora 2, Seedance 2.0, LTX, HunYuan, CogVideoX, PixVerse V6, Runway Gen-3, and more
   - Smart auto-routing selects best model by quality/speed/cost, or choose manually
   - Set duration and aspect ratio
5. **Preview and confirm** — Watch the video, edit if needed
6. **Save to blockchain** — Content hash stored in Universe contract
7. **Storage** — Video/image automatically uploaded to Pinata (IPFS), Lighthouse (Filecoin), or Firebase with priority-based fallback

### Timeline Editor Features

- **MiniMap** — Bird's eye view of your full timeline, pannable and zoomable. Toggle with `M` key
- **Node Search** — `Ctrl+K` opens a command palette to find nodes by title, description, or ID
- **Undo / Redo** — `Ctrl+Z` / `Ctrl+Shift+Z` for all canvas operations (up to 50 states)
- **Auto-Layout** — One-click tree layout algorithm positions nodes by depth and subtree size
- **Keyboard Shortcuts** — `F` (fit view), `1` (zoom 100%), `+/-` (zoom), `Del` (delete selected), `?` (show all shortcuts)
- **Fullscreen Mode** — Expand canvas to fill the viewport, hiding sidebars
- **Edge Labels** — Canon edges show gold "Canon" label, branch edges show gray "Branch" label
- **Multi-Select** — Shift+click or drag to select multiple nodes for batch delete or duplicate
- **Drag-and-Drop** — Drag generations from the Generations Panel onto the canvas

### Scene Controls (Per-Node)

- **Camera Presets** — 16 options: locked, handheld, dolly, pan, tilt, orbit, crane, whip pan
- **Style Presets** — 12 options: noir, watercolor, VHS 80s, anime, cyberpunk, fantasy, horror, documentary, comic book, cinematic, surreal, steampunk
- **VFX Overlays** — 14 options: color grades, film grain, lens flare, light leak, slow motion, speed ramp, rain, dust, glitch, vignette
- **Cast Assignment** — Assign cast members to nodes for character consistency
- **Motion Brush** — Paint motion masks directly on frames
- **Keyframe Handoff** — Link start/end frames between adjacent nodes for continuity

### Branching Narratives

- Each node can have multiple children (branching paths)
- Mark one path as "canon" (official storyline)
- Community can explore alternate timelines via the interactive Narrative Player (`/play/$universeId`)

### Characters & Cast

- AI-generate characters with visual descriptions
- Characters are reusable across episodes
- Gemini analyzes character images for traits/descriptions
- **Cast Manager** — Register characters as cast members with reference images for consistency across scenes

**Time per episode:** ~5-10 minutes

---

## Step 4: Set Up Your Profile

**Route:** `/profile/edit`
**Status:** LIVE

1. Choose a unique username (availability checked in real-time)
2. Write your bio
3. Add social links (Twitter, Discord, website)
4. Select a theme: Default, Minimal, Cinematic, Neon, or Retro
5. Customize accent color, banner, grid layout
6. Toggle public/private visibility

Your public profile at `/profile/$username` is your portfolio for fans and collaborators.

**Time:** ~5 minutes

---

## Step 5: Upload Additional Content

**Route:** `/upload`
**Status:** LIVE

For content outside the timeline editor (standalone videos, images, promotional material):

1. **Classify your content:**
   - **Fan** — Non-commercial. Can include fan works, copyrighted references. Cannot be monetized.
   - **Original** — Creator-owned. Must be original, no copyrighted material. Eligible for all revenue streams.
   - **Licensed** — Rights-cleared. Third-party content with licensing proof. Requires admin review.

2. **Declare IP status:**
   - Is it original? (required for original/licensed)
   - Does it use copyrighted material? (blocks monetization if yes)
   - Add copyright notes if needed
   - Select a license (All Rights Reserved, CC-BY, CC-BY-SA, CC-BY-NC, CC0)

3. **Set visibility:** Public, Private, or Unlisted
4. **Add tags** for discovery
5. **Submit** — Content appears in discovery feed

**Time:** ~2-3 minutes

---

## Step 6: Monetize (Current Status: PARTIALLY WIRED)

**Route:** `/market`

The marketplace has 10 tabs for revenue streams. Here's the honest status:

### What Works Today

- Buy credits with ETH or $LOAR on-chain (Sepolia + Base Sepolia)
- CreditStore UI with package selection and dual-margin pricing
- Credit balance tracking and generation cost deduction
- Platform stats (universes, views, mints, revenue)
- LP yield collection and claiming via dashboard
- Quest rewards and daily check-in for $LOAR
- Canon submission form + For/Against voting UI
- Stripe card payments (when `STRIPE_SECRET_KEY` is set)

### What You CANNOT Do Yet (Frontend Not Fully Wired)

| Action                          | Backend Ready | Frontend Ready |
| ------------------------------- | :-----------: | :------------: |
| List an episode as NFT          |      Yes      |       No       |
| Set NFT price and royalties     |      Yes      |       No       |
| Configure subscription tiers    |      Yes      |       No       |
| Finalize/license canon entries  |      Yes      |       No       |
| Propose a cross-universe collab |      Yes      |       No       |
| Create an ad slot               |      Yes      |       No       |
| License your IP                 |      Yes      |       No       |

**What this means:** Credit purchases and LP yield work. NFT minting and other marketplace transactions still need frontend wiring. See [roadmap](roadmap.md).

---

## Step 7: Govern Your Universe (PARTIALLY WORKING)

**Route:** `/governance/$universeId`

### What Works Today

- View governance token info (name, symbol, supply)
- See contract addresses and universe metadata
- UniverseTimelockGovernor with 24-hour execution delay
- Per-universe Governor with configurable voting delay/period/quorum
- Ponder indexes proposals, votes, executions, and cancellations
- Governance page at `/governance/$universeId`

### What Needs Completion

- Proposal creation UI needs finishing
- Vote casting UI partially wired
- Delegating voting power not yet in UI

The smart contracts, backend indexing, and governance page exist — the interactive transaction flows need completion.

---

## Step 8: Grow Your Audience

**Route:** `/discover`
**Status:** LIVE

Your universe appears in:

- **Content feed** — Filtered by classification, media type, tags
- **Creator gallery** — Browseable profiles with search
- **Trending** — Ranked by views and engagement (when analytics are wired)

### What's Missing for Growth

- No follow/subscribe notification when you publish new episodes
- No comments or social interaction on episodes
- No share buttons or embed codes
- No recommendation engine
- No email or push notifications

---

## Journey Summary

```
WORKING:
Connect Wallet → Create Universe → Generate AI Content → Build Timeline
    → Store Decentralized → Set Up Profile → Upload Content → Get Discovered

PARTIALLY WORKING:
    → Buy Credits (ETH/$LOAR on-chain) → Generate AI Content → Earn LP Yield
    → Token Governance → Community Decisions (UI partially wired)

NOT YET WORKING:
    → List NFTs → Fans Mint → Earn Revenue
    → Set Subscriptions → Fans Subscribe → Recurring Revenue
```

**Time to first universe:** ~5 minutes
**Time to first AI content:** ~10 minutes
**Time to first credit purchase:** ~2 minutes (ETH or $LOAR on-chain)

---

## What Creators Should Know

1. **You own your universe.** The smart contract is deployed from your wallet. You are the admin.
2. **Content is decentralized.** Your videos/images are stored across Pinata (IPFS), Lighthouse (Filecoin), and Firebase — not just one server.
3. **This is testnet.** Everything runs on Sepolia + Base Sepolia. No real money is at stake. When we launch on Base mainnet, you'll need to redeploy.
4. **IP matters.** If you want to monetize, your content must be original. Fan works are welcome in the "Fan" category but can't generate revenue.
5. **Credits are tracked.** AI generation costs are deducted from your credit balance. Purchase credits with ETH or $LOAR on-chain.
