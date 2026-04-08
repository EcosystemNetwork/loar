# PRD: Domain, Brand, and Environment Unification

**Status:** Complete — 2026-04-07
**Track:** Alpha Hardening (parallel workstream 1 of 10)
**Effort:** 1–2 days

---

## Problem

LOAR is now branded as **loar.fun**, but the repo still presents three different public identities in different places:

| Surface                                   | Current state                                          | Problem                                            |
| ----------------------------------------- | ------------------------------------------------------ | -------------------------------------------------- |
| `README.md` — live demo link              | `loartech.xyz`                                         | Wrong domain, dead link risk                       |
| `README.md` — About section               | `loar-one.vercel.app`                                  | Old Vercel preview URL                             |
| `docs/deployment.md` — Environment Matrix | `loartech.xyz`, `api.loartech.xyz`, `idx.loartech.xyz` | Wrong domain in CORS/URL config table              |
| `apps/contracts/` README                  | Already describes product as `loar.fun`                | Ahead of the rest of the repo                      |
| Server `CORS_ORIGIN` default              | `loartech.xyz`                                         | Wrong domain hard-coded into deploy config         |
| SIWE domain expectation                   | Points at old domain                                   | Will silently reject wallet auth on the new domain |
| Social preview / `<title>` tags           | Unknown; likely unset or old                           | Bad OG card on any share from loar.fun             |

This creates trust risk, ops confusion, and wallet auth failures on the new domain. Any outside creator who clicks a link from the new brand lands on either a dead endpoint or a SIWE rejection.

---

## Goal

Make **loar.fun** the single canonical public identity across every surface in the repo: app metadata, docs, deploy config, CORS policy, SIWE session domain, and environment matrices. Remove every reference to `loartech.xyz` and `loar-one.vercel.app` from docs and config. Add a formal staging subdomain (`staging.loar.fun`) so environment drift cannot happen again.

---

## Scope

### In scope

- Replace all legacy domain references in docs, config, and env examples
- Update `CORS_ORIGIN` default and deploy doc environment matrix to `loar.fun`
- Update SIWE domain configuration so wallet auth works on `loar.fun`
- Add `<title>`, `<meta name="description">`, and OG tags to the web app's `index.html`
- Define a canonical environment matrix: local / staging / prod-testnet
- Update `vercel.json` project name and any Vercel-specific domain hints
- Update `apps/contracts/README.md` to match the main README on all domain references

### Out of scope

- Actual DNS changes (handled by ops/Vercel dashboard, not code)
- Design or copy changes to the landing page
- New marketing content

---

## Deliverables

### 1. Docs cleanup

**`README.md`**

- Replace `loartech.xyz` demo link → `https://loar.fun`
- Replace `loar-one.vercel.app` → `https://loar.fun`
- Update any badge links or shields pointing at old domain

**`docs/deployment.md` — Environment Matrix**

| Variable          | Local Dev                | Staging                        | Production             |
| ----------------- | ------------------------ | ------------------------------ | ---------------------- |
| `CORS_ORIGIN`     | `http://localhost:3001`  | `https://staging.loar.fun`     | `https://loar.fun`     |
| `VITE_SERVER_URL` | `http://localhost:3000`  | `https://api-staging.loar.fun` | `https://api.loar.fun` |
| `VITE_PONDER_URL` | `http://localhost:42069` | `https://idx-staging.loar.fun` | `https://idx.loar.fun` |

Replace the existing stale matrix with this one throughout `deployment.md`.

**`docs/environment.md`**

- Update all example values that reference old domains

**`.env.example`**

- `CORS_ORIGIN=https://loar.fun` (production comment)
- `SIWE_DOMAIN=loar.fun` (production comment; `localhost` for local dev)

### 2. Server SIWE domain config

File: `apps/server/src/lib/auth.ts` (or wherever `SiweMessage` domain is validated)

- The SIWE `domain` field in session verification must match the frontend's origin. Currently hard-wired to old domain or missing. Make it read from `process.env.SIWE_DOMAIN` (already in `.env.example` after step 1).
- Add `SIWE_DOMAIN` to `.env.example` with a comment explaining local vs prod values.

### 3. Server CORS config

File: `apps/server/src/index.ts` (Hono CORS middleware)

- `CORS_ORIGIN` must be read from `process.env.CORS_ORIGIN`. Verify it is not hard-coded anywhere in the Hono setup. If a fallback default exists, change it to `http://localhost:3001` (safe for local) rather than the old prod domain.

### 4. Web app metadata

File: `apps/web/index.html`

```html
<title>LOAR — AI Cinematic Universe Studio</title>
<meta
  name="description"
  content="Create, tokenize, and monetize AI-powered cinematic universes on-chain."
/>
<meta property="og:title" content="LOAR" />
<meta
  property="og:description"
  content="AI cinematic universe studio. Original IP. On-chain governance. Token economy."
/>
<meta property="og:url" content="https://loar.fun" />
<meta property="og:image" content="https://loar.fun/og-image.png" />
<meta name="twitter:card" content="summary_large_image" />
```

Add a placeholder `og-image.png` to `apps/web/public/` (even a 1200×630 branded placeholder is enough for now).

### 5. CI environment check

Add a step to `.github/workflows/ci.yml` that greps the codebase for `loartech.xyz` and `loar-one.vercel.app` and fails if either appears outside of `CHANGELOG.md` or git history references. This prevents domain drift from re-entering the codebase.

```yaml
- name: Check for legacy domains
  run: |
    if grep -r "loartech\.xyz\|loar-one\.vercel\.app" \
      --include="*.ts" --include="*.tsx" --include="*.md" \
      --include="*.json" --include="*.env*" \
      --exclude-dir=".git" --exclude-dir="node_modules" .; then
      echo "ERROR: Legacy domain reference found. Update to loar.fun."
      exit 1
    fi
```

---

## Environment Isolation Model

Going forward, three environments are canonical:

| Environment      | Web                | API                    | Indexer                | Notes                        |
| ---------------- | ------------------ | ---------------------- | ---------------------- | ---------------------------- |
| **local**        | `localhost:3001`   | `localhost:3000`       | `localhost:42069`      | `.env` at repo root          |
| **staging**      | `staging.loar.fun` | `api-staging.loar.fun` | `idx-staging.loar.fun` | Vercel preview + staging VPS |
| **prod-testnet** | `loar.fun`         | `api.loar.fun`         | `idx.loar.fun`         | Vercel prod + prod VPS       |

Staging and prod-testnet both run Sepolia. Mainnet gets its own row when that milestone is reached.

---

## Accept When

- [ ] `grep -r "loartech.xyz" .` returns no results in tracked files
- [ ] `grep -r "loar-one.vercel.app" .` returns no results in tracked files
- [ ] `loar.fun` wallet auth (SIWE) completes without domain mismatch errors
- [ ] `https://api.loar.fun/health` returns `200` from the prod server
- [ ] `https://loar.fun` OG card shows correct title/description when pasted into Slack/Twitter
- [ ] CI legacy-domain check step passes on a clean main branch
- [ ] `docs/deployment.md` environment matrix shows only `loar.fun` domain variants

---

## Risk

**SIWE domain mismatch is a silent hard failure.** If `SIWE_DOMAIN` is wrong in prod, wallet auth silently rejects every session. This is the highest-urgency item in this PRD — it must be verified with a real wallet sign-in on `loar.fun` before this track is closed.
