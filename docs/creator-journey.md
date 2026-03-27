# LOAR — Creator Journey

The end-to-end flow from signing up to earning revenue.

---

## 1. Connect Wallet

**Route:** `/login`

- Connect via RainbowKit (MetaMask, Coinbase Wallet, WalletConnect, etc.)
- Sign an SIWE message to authenticate
- Server issues a JWT session token
- Wallet address becomes your creator identity

**What you need:** A browser wallet with Sepolia ETH for gas.

---

## 2. Create Your Universe

**Route:** `/cinematicUniverseCreate`

**Step 1 — Deploy Universe Contract**

- Name your cinematic universe
- Write a description
- Upload or AI-generate a cover image (FAL AI)
- Deploy the Universe smart contract to Sepolia
- Transaction creates your universe on-chain via UniverseManager

**Step 2 — Deploy Governance Token**

- Set token symbol and metadata
- Deploy GovernanceERC20 + UniverseGovernor
- Initialize a Uniswap v4 liquidity pool
- LP tokens are locked (anti-rug protection)

**Result:** You own a cinematic universe with its own governance token and trading pool.

---

## 3. Build Your Story

**Route:** `/universe/$id`

The timeline editor is your workspace:

- **Create nodes** — Each node is a narrative event (episode, scene, chapter)
- **Generate content** — AI video (Veo3, Kling, Wan2.5, Sora; 1–60s) or images (4 FAL models)
- **Link events** — Build linear storylines or branching narrative paths
- **Canonize** — Mark events as official canon (owner-only)
- **Store content** — Automatically uploaded to Walrus/IPFS/Filecoin with SHA-256 dedup
- **Create characters** — AI-powered character creation with visual generation and trait analysis

**On-chain:** Each node's contentHash and plotHash are stored in the Universe contract. Full content is emitted in events and indexed by Ponder.

---

## 4. Set Up Your Profile

**Route:** `/profile/edit`

- Choose a username (unique, checked for availability)
- Write a bio, add social links
- Select a theme (default, minimal, cinematic, neon, retro)
- Customize layout: accent color, banner, grid columns
- Toggle public/private visibility

**Public profile** at `/profile/$username` — your portfolio for fans and collaborators.

---

## 5. Upload Additional Content

**Route:** `/upload`

For content outside the timeline editor:

- **Classification** — Choose "Fun" (non-commercial, flexible IP) or "Monetized" (commercial, strict IP)
- **IP Declaration** — Confirm originality, flag copyrighted materials, select license
- **Enforcement** — Monetized content must be original with no copyrighted material
- **Visibility** — Public, private, or unlisted
- **Tags** — Categorize for discovery

---

## 6. Monetize

**Route:** `/market`

### Revenue Stream 1: Credits

- Users buy credits to fund AI generation
- Your universe's content drives credit purchases
- Costs: image (1 credit), video (5), story (2), spinoff (10), character (3), scene (8)

### Revenue Stream 2: Episode NFTs

- Mint narrative events as NFTs
- Set price (ETH), max supply, royalty percentage
- Track mints and revenue

### Revenue Stream 3: Character NFTs

- Mint AI-generated characters
- Rare characters (by trait/rarity rank) command higher prices

### Revenue Stream 4: Subscriptions

- Configure tiers: Free, Basic, Premium, VIP
- Gate features per tier: early access, voting boost, premium content, behind-the-scenes
- Set duration and pricing
- Track subscriber count and revenue

### Revenue Stream 5: Canon Marketplace

- Community members submit story contributions (characters, plot arcs, locations, lore)
- Token-weighted voting decides which submissions win
- License winning submissions for revenue

### Revenue Stream 6: Cross-Universe Collabs

- Propose partnerships with other universe creators
- Define revenue sharing (basis points)
- Activate within a time window
- Record joint episodes

### Revenue Stream 7: IP Licensing

- License your universe for: streaming, merch, gaming, comic, audio, other
- Set upfront fees and royalty rates
- Track payments and duration

### Revenue Stream 8: Programmatic Ads

- Create ad slots: billboard, product placement, sponsored character, audio mention
- Sponsors bid competitively
- Accept winning bids
- Track impressions for payout

### Revenue Stream 9: Token Trading

- Your governance token trades on Uniswap v4
- Fee hooks collect revenue on every swap
- LP locking prevents rug pulls, building holder trust

### Revenue Stream 10: Merch (Coming Soon)

- Sell physical merchandise tied to your universe
- Backend infrastructure exists; needs fulfillment partner

---

## 7. Govern Your Universe

**From the universe editor + governance sidebar:**

- **Proposals** — Token holders submit governance proposals
- **Voting** — Token-weighted voting on canon decisions, policy changes
- **Execution** — Passed proposals execute on-chain via UniverseGovernor
- **Whitelisting** — Control who can create nodes (open or gated)

---

## 8. Grow Your Audience

**Route:** `/discover`

Your universe appears in:

- **Discovery feed** — Filtered by classification, media type, tags
- **Trending** — Ranked by views, trading volume, engagement
- **Creator profiles** — Your portfolio showcases your work
- **Platform stats** — Total universes, views, mints, revenue displayed on marketplace

**Analytics tracked:**

- Episode views (with duration)
- Engagement: likes, shares, comments, bookmarks
- Subscriber growth
- Mint count and revenue
- Trending score

---

## Journey Summary

```
Connect Wallet → Create Universe → Generate AI Content → Build Timeline
    → Canonize Story → Set Up Monetization → Attract Audience → Earn Revenue
        → Govern with Community → Scale via Collabs & Licensing
```

**Time to first universe:** ~5 minutes (wallet connect + contract deployment)
**Time to first content:** ~10 minutes (AI generation + on-chain storage)
**Time to first revenue:** Depends on audience, but all rails are live from day one
