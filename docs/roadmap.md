# LOAR — Product Roadmap

## Phase 1: Foundation (Complete)

Everything needed for the core creator loop.

- [x] Monorepo setup (Turbo, pnpm, TypeScript)
- [x] Smart contracts: UniverseManager, Universe, GovernanceERC20, Governor
- [x] Ponder indexer: universes, tokens, nodes, swaps, proposals, votes
- [x] tRPC server: 12 routers, 60+ procedures
- [x] Web app: 15 routes, TanStack Router
- [x] Wallet auth: SIWE → JWT sessions
- [x] AI generation: FAL (video + image), Gemini (wiki + storylines)
- [x] Decentralized storage: Walrus, IPFS, Filecoin, Firebase with dedup
- [x] Narrative timeline editor (ReactFlow)
- [x] On-chain node creation + canonization

## Phase 2: Monetization Stack (Complete)

Revenue rails for creators and the platform.

- [x] Credit system with generation cost model
- [x] Episode + Character NFT minting
- [x] Creator subscription tiers (4 levels, feature gating)
- [x] Canon marketplace (submit, vote, license)
- [x] Cross-universe collaborations with revenue sharing
- [x] IP licensing (6 types, royalty tracking)
- [x] Programmatic ad marketplace (bid, accept, impressions)
- [x] Uniswap v4 token pools + fee hooks + LP locking
- [x] Analytics: views, engagement, trending, platform stats

## Phase 3: Product Polish (Current)

Make the platform pitch-ready and onboarding-smooth.

- [x] Landing page redesign (Netflix × Webtoons aesthetic)
- [x] Creator profiles with customizable themes
- [x] Content discovery with classification filters
- [x] IP/copyright enforcement in upload flow
- [x] Product documentation (MVP, roadmap, creator journey, IP policy)
- [ ] Dashboard — replace placeholder data with live universe data
- [ ] Bundle optimization — code split MetaMask SDK, viem/wagmi
- [ ] Install `@coinbase/cdp-react` for embedded wallet support
- [ ] Error states and loading UX across all routes
- [ ] Mobile-responsive layouts for all pages

## Phase 4: Growth & Retention

Features that drive recurring usage and network effects.

- [ ] Social layer — follows, comments, activity feed
- [ ] Notification system — governance events, new episodes, mints
- [ ] Creator analytics dashboard — per-universe P&L, subscriber funnels, retention curves
- [ ] Recommendation engine — personalized universe suggestions
- [ ] Onboarding tutorial — guided first-universe creation
- [ ] Referral system — credits for bringing new creators
- [ ] Leaderboards — top universes, most active creators

## Phase 5: Scale & Compliance

Prepare for mainnet and real-money flows.

- [ ] Smart contract audit
- [ ] Mainnet deployment (Ethereum L1 or L2)
- [ ] Fiat on-ramp — credit card → credits/subscriptions
- [ ] KYC/AML for high-value transactions
- [ ] Content moderation tools — review queue, flagging, appeals
- [ ] DMCA takedown process
- [ ] Multi-chain support (Base, Arbitrum, Polygon)
- [ ] Rate limiting and abuse prevention

## Phase 6: Platform Expansion

New surfaces and formats.

- [ ] Mobile app (React Native or native)
- [ ] Merch fulfillment integration (print-on-demand partner)
- [ ] Live events — premiere screenings, community votes
- [ ] API for third-party apps (read universe data, embed episodes)
- [ ] Creator SDK — programmatic universe management
- [ ] Franchise tools — universe templates, story frameworks
- [ ] Cross-platform syndication — YouTube, TikTok, Webtoon exports

---

## Key Milestones

| Milestone                       | Phase | Signal                              |
| ------------------------------- | ----- | ----------------------------------- |
| First external universe created | 3     | Product works for non-team creators |
| 10 monetized universes          | 4     | Revenue model validated             |
| First fiat payment              | 5     | Non-crypto users can participate    |
| 100 DAU                         | 4     | Retention loop working              |
| Smart contract audit complete   | 5     | Ready for mainnet                   |
| Mainnet launch                  | 5     | Real economic activity              |
| 1,000 universes                 | 6     | Platform-scale network effects      |
