# LOAR — Creator Journey

Step-by-step from zero to a monetizable cinematic universe. Each step notes what works today and what doesn't.

---

## Step 1: Connect Your Wallet

**Route:** `/login`
**Status:** LIVE

1. Click "Connect Wallet" — thirdweb wallet modal opens
2. Choose wallet (MetaMask, WalletConnect, Coinbase, etc.)
3. Sign the SIWE (Sign-In with Ethereum) message
4. Server verifies signature, issues JWT session token
5. You're authenticated — wallet address is your identity

**What you need:** A browser wallet with Sepolia ETH for gas fees.
**Time:** ~30 seconds

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

1. **Create a node** — Click "Create Event" in the sidebar
2. **Write your prompt** — Describe the scene, select characters
3. **Generate image** — AI creates a scene image (4 models available)
4. **Generate video** — AI creates a 1-60s video from the image
   - Choose provider: Veo3, Kling, Wan2.5, or Sora
   - Set duration and aspect ratio
5. **Preview and confirm** — Watch the video, edit if needed
6. **Save to blockchain** — Content hash stored in Universe contract
7. **Storage** — Video/image automatically uploaded to Walrus/IPFS/Filecoin

### Branching Narratives

- Each node can have multiple children (branching paths)
- Mark one path as "canon" (official storyline)
- Community can explore alternate timelines

### Characters

- AI-generate characters with visual descriptions
- Characters are reusable across episodes
- Gemini analyzes character images for traits/descriptions

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
   - **Fun** — Non-commercial. Can include fan works, copyrighted references. Cannot be monetized.
   - **Monetized** — Commercial. Must be original, no copyrighted material. Eligible for all revenue streams.

2. **Declare IP status:**
   - Is it original? (required for monetized)
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

### What You Can See Today

- Your credit balance and generation costs
- Platform stats (universes, views, mints, revenue)
- Descriptions of how each revenue stream works
- Your NFT collection (episodes + characters)

### What You CANNOT Do Yet (Frontend Not Wired)

| Action                          | Backend Ready | Frontend Ready |
| ------------------------------- | :-----------: | :------------: |
| List an episode as NFT          |      Yes      |       No       |
| Set NFT price and royalties     |      Yes      |       No       |
| Buy credits with ETH            |      Yes      |       No       |
| Configure subscription tiers    |      Yes      |       No       |
| Submit content for canon vote   |      Yes      |       No       |
| Vote on canon submissions       |      Yes      |       No       |
| Propose a cross-universe collab |      Yes      |       No       |
| Create an ad slot               |      Yes      |       No       |
| License your IP                 |      Yes      |       No       |

**What this means:** The marketplace page explains the revenue model but doesn't yet let you transact. This is the #1 priority to fix (see [roadmap](roadmap.md)).

---

## Step 7: Govern Your Universe (PARTIALLY WORKING)

**From the universe editor's governance sidebar:**

### What Works Today

- View governance token info (name, symbol, supply)
- See contract addresses
- View universe metadata

### What Doesn't Work Yet

- Creating governance proposals
- Voting on proposals
- Executing passed proposals
- Delegating voting power

The smart contracts and backend indexing for governance are fully functional — the frontend UI needs to be connected.

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

NOT YET WORKING:
    → List NFTs → Fans Mint → Earn Revenue
    → Set Subscriptions → Fans Subscribe → Recurring Revenue
    → Token Governance → Community Decisions → Universe Evolution
```

**Time to first universe:** ~5 minutes
**Time to first AI content:** ~10 minutes
**Time to first revenue:** Not yet possible (marketplace transactions not wired)

---

## What Creators Should Know

1. **You own your universe.** The smart contract is deployed from your wallet. You are the admin.
2. **Content is decentralized.** Your videos/images are stored across Walrus, IPFS, and Filecoin — not just one server.
3. **This is testnet.** Everything runs on Sepolia. No real money is at stake. When we launch on mainnet, you'll need to redeploy.
4. **IP matters.** If you want to monetize, your content must be original. Fan works are welcome in the "Fun" category but can't generate revenue.
5. **AI costs are currently free.** Credit spending isn't enforced yet. This will change.
