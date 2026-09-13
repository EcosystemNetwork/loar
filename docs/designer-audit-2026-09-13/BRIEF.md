# LOAR.FUN — Designer Issue Brief

**Date:** 2026-09-13
**Scope:** Live product at https://loar.fun (logged-out, desktop 1440 and mobile 390)
**Goal:** Give design a punch list they can work, not a vibe dump.
**Screenshots:** this folder.

LOAR is supposed to feel like a cinematic universe studio. Right now it looks like three products glued together: a periwinkle logo brand, an amber “Netflix” home, and a purple Web3 login. Fix identity first. Everything else is downstream.

---

## P0 — Brand is not one thing

### 1. Three visual identities on one site

**Problem:** Logo, primary CTA, and Sign In do not belong to the same brand.

| Surface                          | Color                       | Evidence                                    |
| -------------------------------- | --------------------------- | ------------------------------------------- |
| Wordmark `/loarIconTextLogo.png` | Periwinkle / lavender       | Header on every page                        |
| SVG logo `loarlogo.svg`          | `#ba9bc9`                   | Unused in UI, third logo                    |
| Old mark `logo.png`              | Orange book + tree + glitch | Still in `/public`                          |
| Theme tokens (`index.css`)       | Amber + navy                | Explore, Featured, Accept all, Launch Token |
| Sign In / Continue with Email    | Indigo → purple gradient    | Header, login, create gate                  |

**Ask:** Pick **one** brand system. Deliver:

- Primary / secondary / accent / destructive
- Logo on dark (and a reverse if light mode stays)
- Button hierarchy: primary, secondary, ghost, destructive
- Kill the indigo–purple gradient. It is the default AI-slop CTA and fights the mark.
- Archive `logo.png` (orange book/tree). It is a previous product.

### 2. Competing CTAs in the same viewport

**Problem:** Header Sign In is purple. In-page actions are amber. Cookie “Accept all” is also amber. User does not know what the “real” button is.

**Ask:** One primary color for the action you want (Sign In _or_ Explore, not both in different hues). Cookie accept should not look more important than Sign In.

### 3. Missing social share image

**Problem:** `og:image` points at `https://loar.fun/og-image.png`. That URL 404s into the SPA HTML. Discord/X/Telegram cards will be blank or broken.

**Ask:** 1200×630 OG + 1080×1080 square + favicon set (16/32/48 + apple-touch 180). Use the wordmark, not the old orange logo.

---

## P0 — First 10 seconds do not explain the product

### 4. Home is a Netflix clone with no product sentence

**Problem:** Logged-out home is a hero of “Space Fleet” + a ticker of testnet names. There is no “what is LOAR / why sign in / what can I make.” A stranger cannot tell this is an AI studio vs a streaming site vs a memecoin.

**Ask:** Logged-out home needs a product beat above or instead of the gallery:

- One line: what you can do (create cinematic universes with AI, own them on-chain)
- One primary CTA: Create / Sign in
- Proof: 3–4 real universes, not a fake Top 10 of the same poster
- Testnet names (“LOAR Testnet Universe”, “Orange Pills”) should not lead the ticker

### 5. Hero Explore and Details go to the same place

**Problem:** Both buttons route to `/universe/$id/watch`. Details is a ghost with a book icon; it does no extra job.

**Ask:** Either make Details a real destination (wiki / about / trailer) or delete it. Two buttons that do the same thing looks unfinished.

### 6. Hero token chip can render as a lone `$`

**Problem:** When a universe has a token with empty `symbol`, the chip shows a bolt + `$` with no ticker. Looks broken.

**Ask:** Hide the chip unless `symbol` is a real string. Design the filled and empty states.

### 7. Hero crossfade leaks the next slide

**Problem:** Desktop hero shows Space Fleet ships in the top half and an interior ceiling in the bottom half. Vignette is not covering the outgoing frame.

**Ask:** Spec a hero treatment: full-bleed key art, bottom-to-top scrim strong enough for white title, no second image visible during transition.

---

## P0 — Navigation is a junk drawer

### 8. “More” is a 7-group mega menu

**Problem:** Primary nav: Discover, Create, Launchpad, Wiki, Dashboard, More. More is a **640px 3-column** menu: Marketplace, Likeness Marketplace, Governance, Activity, Canvas, Notebook, Clip Editor, Voice Studio, Model Lab, GPT Image Lab, Marketing Studio, Ad Reference, My Works, Notifications, Series Mode, Virality Predictor, Royalty Splits, Points Balance, Swap, Subscriptions, Pricing, Faucet, Points Leaderboard, Bounties, Sell, Residency, API Keys, Provider Keys, Docs, Agents, Agent Economy, Arc USDC, Ads, Brand Dashboard — many tagged Beta.

This is not a consumer product nav. It is an internal lab index.

**Ask:** Design a **logged-out** nav and a **logged-in creator** nav.

Logged-out (max 5):

- Home · Discover · Create · Wiki · Sign In

Logged-in:

- Home · Discover · Create · Studio · [avatar]

Everything else lives in the avatar / Studio. Beta tools do not get a Beta pill in global nav — they live in Studio → Labs.

### 9. Dashboard in primary nav while logged out

**Problem:** Clicking Dashboard dumps you on login. Same for Create’s wallet gate. Nav should not advertise rooms you cannot enter without explaining why.

**Ask:** Hide Dashboard / Studio until signed in. Create can stay, but the empty state should not say “connect your wallet” when login is email.

### 10. Header chrome for logged-out users

**Problem:** Bell (notifications), Eye (web3 mode), and Moon (theme) sit next to Sign In. None of these are first-run jobs. Eye especially is unexplained.

**Ask:** Logged-out header = logo + 3–4 links + Sign In. Theme and web3 mode go in settings. Bell only when authenticated.

### 11. Login page still shows the full app chrome

**Problem:** You are on `/login` and the header still has Sign In, Discover, Create, Launchpad, Wiki, Dashboard, More, bell, eye, theme. Mobile is worse: logo + bell + Sign In + hamburger, then the same logo again in the form.

**Ask:** Auth screens are a quiet brand moment: logo, form, one secondary link (“back to home”). No app nav. No second Sign In.

---

## P1 — Copy and vocabulary

### 12. Points vs credits vs $LOAR

**Problem:** Pricing card says “150 **points**/mo”, “6,000 **$LOAR**/mo”, and “150 **credits**/month” in the same column. Nav item is “Points Balance” pointing at `/credits`. Dashboard stat is “Credits”.

**Ask:** One word. Recommend **Credits** for spendable generation balance, **$LOAR** only for the token. Never “points” unless it is a separate loyalty layer — and then it needs its own explanation.

### 13. Create empty state lies

**Problem:** Headline: “Create anything.” Sub: “Press ⌘↵ to fire.” Body: “Connect your **wallet** to start generating.” Button: purple **Sign In** (email/social, not a wallet).

**Ask:** Match the real auth: “Sign in to generate.” Do not mention wallets until a chain action. Do not advertise a keyboard shortcut when the prompt does not exist yet.

### 14. Login “SEPOLIA” divider

**Problem:** A small “SEPOLIA” label sits under Continue with Email. First-time users do not know what that is. It reads like a brand or a sponsor.

**Ask:** If testnet must be disclosed, use a human line: “You’re on testnet — nothing here is mainnet money.” Not a mysterious all-caps word.

### 15. Product name in copy

**Problem:** `<title>` is “AI Cinematic Universe Studio.” Router meta is “Decentralized Narrative Control Suite.” Login tagline is “AI cinematic universes, on-chain.” Wiki is “World Encyclopedia.”

**Ask:** One positioning line, used everywhere.

---

## P1 — Page-level issues

### 16. Wiki is an ontology browser, not an encyclopedia

**Problem:** 30+ tabs (People, Places, Things, Factions, Events, Lore, Species, Vehicles, Tech, Orgs, Moodboards, Style Packs, Timelines, Realities, Dimensions, Planes, Realms, Domains, Episodes, Audio, Graph, Timeline, Map, A–Z, Activity, Stats, Creators, Profiles, 3D, Gallery, Collection, Bookmarks). Desktop already clips after Timelines. Two **+ Create** buttons (top-right and floating). Sort “Newest” is **blue**, every other chip is amber.

**Ask:** Default wiki = one universe + a search + 4–6 human tabs (Characters, Places, Lore, Episodes, Gallery). Structural kinds behind “More in this world.” One Create. One accent.

### 17. Wiki trending row has dead tiles

**Problem:** Two of four trending cards are black voids (“A lone astronaut…”, “SO4”). Broken media with no placeholder art.

**Ask:** Designed fallback: letterbox + title + “image unavailable”, never a black rectangle. Filter empty assets out of Trending.

### 18. Discover looks empty even when it has art

**Problem:** Beautiful posters, then “0 views” on every card. Filter row is dense (Sort / Access / Type). “$ Monetized” green pill on every universe card in the grid.

**Ask:** Hide “0 views.” Don’t lead with monetization. Rank numbers (#1–#6) need a designed treatment that doesn’t sit on the art. Access/Type filters collapse into one “Filters” sheet on mobile.

### 19. Launchpad is a pump.fun clone with no activity

**Problem:** Stats: 1 token, `--` MCap, 0 gainers, 0 trades, “No trades yet.” Then ~15 filter chips (All / Bonding / Graduating / Graduated / Halted / Trending / New / Gainers / Volume / Liquidity / MCap / Holders / A–Z / presets). Orange Pills card repeats the title twice.

**Ask:** Empty/low-activity launchpad is a **designed empty state**, not a screener with zeros. One token should be a featured card, not a dashboard of dead metrics. Deduplicate the card title.

### 20. Pricing is a SaaS template with four accent colors

**Problem:** Headline is all-caps “PICK YOUR PLAN.” Four cards: zinc / blue / gold / pink. “MOST POPULAR” + “SAVE 20%” in a fifth green. Feels like Higgsfield/Vercel pricing, not LOAR.

**Ask:** Same brand as the rest of the site. One highlighted plan. No rainbow tier colors. Sentence-case headline. Resolve points/credits/$LOAR (issue 12) on this page first.

### 21. 404 is a blank void

**Problem:** Giant “404 / This page doesn’t exist / Go Home.” No brand, no suggested destinations, no art.

**Ask:** One branded empty-world frame + 3 links (Home, Discover, Create). This is a cheap personality win.

### 22. Create “Need more control?” is a link dump

**Problem:** Nine unlabeled text links: Detailed entity form, New universe (on-chain), Your Likeness, Persona package, Voice Studio, Model Lab, Notebook, Canvas, Upload media.

**Ask:** If these stay, they are a 2×4 icon grid with one-line descriptions. If they don’t stay, they belong in Studio. Logged-out users should not see on-chain / BYOK labs.

---

## P1 — Mobile

### 23. Cookie banner eats the bottom of every screen

**Problem:** Cookie bar is `fixed bottom z-50`. Mobile tab bar is `fixed bottom z-40`. Banner covers Home/Discover/Create/Wiki/Dashboard and the floating search FAB. On first visit you cannot use the app until you accept cookies — and you cannot even see the tab bar.

**Ask:** Cookie as a compact sheet **above** the tab bar (`bottom: 56px + safe-area`), or a modal on first visit. Never cover primary nav. Short copy — current paragraph is legal, not UI.

### 24. Header overflow on 390px

**Problem:** Logo + bell + fat purple Sign In + hamburger. Logo gets cramped. Ticker on home is clipped (`e` leftover from previous item).

**Ask:** Mobile header: mark + Sign In + menu. No bell logged out. Sign In uses the same size as other header buttons, not a large gradient pill. Ticker needs padding so the first item isn’t sheared.

### 25. Bottom nav vs hamburger

**Problem:** There is a 5-tab bar (Home, Discover, Create, Wiki, Dashboard) **and** a hamburger that opens the full mega-menu. Two navigation systems, neither complete.

**Ask:** Pick one mobile IA. Recommendation: tab bar for the 5 verbs, hamburger gone logged-out. Logged-in hamburger = account only.

### 26. Home mobile hierarchy

**Problem:** After cookie + ticker + hero, “Top 10 Universes” shows a single poster. Rank “1” is missing on mobile (desktop shows 1/2/3). Details button is an outline ghost that does nothing extra.

**Ask:** Mobile home = product line + one featured universe + a horizontal row. Top 10 with one card is a stub.

### 27. Launchpad mobile stats clip

**Problem:** Fifth stat card “LP Locked” is cut in half. 2×2 grid doesn’t account for 5 cards.

**Ask:** 2×2 of the metrics that matter, or a horizontal snap row. Don’t ship a half card.

---

## P2 — Craft / consistency

### 28. Type: italic DM Sans as “display”

**Problem:** Headlines use `font-display italic` but display = DM Sans. Italic UI sans is not cinematic. Login “Sign in” in italic looks like a pull quote.

**Ask:** A real display face for universe titles (or a heavier DM Sans, not italic). Body stays DM Sans. 4–5 sizes, 3 weights max.

### 29. Hardcoded zinc / white / purple instead of tokens

**Problem:** Wallet menu is `bg-zinc-900`. Cards use `text-white` on dark regardless of theme. Sign In ignores `--primary`. Light mode will break these.

**Ask:** If light mode stays, every surface uses tokens. If the product is dark-only (reasonable for “cinematic”), **remove the theme toggle** and commit.

### 30. Clickable cards are `div onClick`, not links

**Problem:** Universe posters are not real links. No open-in-new-tab, no focus ring, no hover URL.

**Ask:** Cards are `<a>`. Hover: 100ms, not `transition-all 300ms scale-[1.03]`. Pressed state exists.

### 31. Empty, loading, error are inconsistent

**Problem:** Launchpad zeros, wiki black tiles, 404 void, create wallet-gate, discover “0 views.” Each invented its own dead look.

**Ask:** One empty-state pattern (illustration + one sentence + one CTA). One skeleton shape per card type. One error (what happened + retry).

### 32. Motion

**Problem:** Hero Ken Burns 12s, ticker marquee, card scale 300ms, login gradient, cookie always-on. No `prefers-reduced-motion` story on these surfaces.

**Ask:** Motion spec: what moves, how long, what reduced-motion does. Cap 400ms except Ken Burns (which should pause on reduced motion).

---

## What to send back

Please deliver, in order:

1. **Brand sheet** — logo, color, type, buttons, badges. One identity.
2. **Logged-out home** — desktop + mobile. Product sentence + one CTA + gallery.
3. **Nav IA** — logged-out vs logged-in, desktop vs mobile. What dies from More.
4. **Auth screens** — login / OTP / error. No app chrome.
5. **Create empty / signed-in console** — one prompt, not nine labs.
6. **Wiki default** — 5 tabs, not 30.
7. **Launchpad empty vs 1-token vs live.**
8. **Pricing** — one vocabulary, one accent.
9. **Cookie + mobile tab bar** coexistence.
10. **OG / favicon / 404.**

Screenshots in this folder are the current live site, 2026-09-13, logged out.
