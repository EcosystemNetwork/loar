# `@loar/mcp-server` Publish Runbook

> Scope: the first public release of the MCP server package to npm + skill
> registrations with OpenClaw and Hermes. All external / irreversible actions
> are flagged with ⚠️.
>
> Companion doc: [prd-mcp-integration.md](prd-mcp-integration.md) Week 3.

---

## Summary

Three distribution targets, one package:

| Target      | What it is                      | Action                                            |
| ----------- | ------------------------------- | ------------------------------------------------- |
| **npm**     | Public `@loar/mcp-server@0.2.0` | `npm publish --access public`                     |
| **ClawHub** | OpenClaw skill registry entry   | `clawhub publish skills/loar-video` + `-universe` |
| **Hermes**  | Hermes Skills Hub entry         | Hermes publisher flow (see below)                 |

All three point at the same SKILL.md files under [skills/loar-video/](../skills/loar-video/) and [skills/loar-universe/](../skills/loar-universe/). The npm package is the MCP server those skills invoke; the SKILL.md files are the agent-facing prompts.

---

## Pre-flight (runs on your workstation)

```bash
./scripts/mcp-preflight.sh
```

This validates:

- Working tree is clean in `apps/mcp/`.
- Package.json: correct name, not private, has `license` + `bin`.
- `LICENSE` file exists at `apps/mcp/LICENSE`.
- `pnpm check-types` + `pnpm build` succeed (fresh `dist/`).
- Built `dist/src/index.js` preserves the `#!/usr/bin/env node` shebang.
- `npm pack --dry-run` tarball has the expected files, no `.tsbuildinfo`, no stray test files or node_modules.
- You're logged in to npm.
- The `@loar` scope exists and you're a member.
- The target version isn't already published.

Exit code 0 = green to proceed. Any failure prints a clear fix and stops.

---

## Phase 1 — One-time npm setup

Skip if `@loar` already exists on npm and you're a member.

### Check whether the scope exists

```bash
npm org ls loar
```

- If `npm error 404 ... Scope not found` → you need to create it (next step).
- If it returns member names → you're fine, skip to Phase 2.

### ⚠️ Create the `@loar` organization (first-time-only)

```bash
npm login
npm org create loar
```

npm will prompt for a paid or free tier. **Free tier is fine** for public packages.

Then add co-maintainers:

```bash
npm org set loar <teammate-npm-user> developer
npm org set loar <your-npm-user> owner
```

### ⚠️ Optional: enable 2FA on the org

For any maintainer account, run `npm profile enable-2fa auth-and-writes`. npm orgs for published packages should require 2FA on writes — prevents a compromised token from shipping a malicious release.

---

## Phase 2 — Publish to npm

After preflight is green:

```bash
cd apps/mcp

# Tag the release in git first so the registry + git state agree
git tag mcp-v$(node -p "require('./package.json').version")

# ⚠️ Externally visible — this publishes to npmjs.com
npm publish --access public
```

`--access public` is required for first-time publishing of a scoped package; otherwise npm assumes `restricted` and fails.

Then push the tag:

```bash
# ⚠️ Makes the release visible on GitHub
git push origin mcp-v0.2.0
```

### Smoke test the published artifact

Any fresh shell:

```bash
LOAR_API_KEY=loar_... npx -y @loar/mcp-server --help 2>&1 | head -5
```

You should see "LOAR MCP Server v0.2.0 started (stdio, ...)". If it fails with `command not found`, the `bin` entry didn't publish correctly — rebuild and bump to 0.2.1.

### Rollback

- **Within 72 hours** of publish: `npm unpublish @loar/mcp-server@0.2.0` (only works in the first 72h and only if no downstream depends on it).
- **After 72 hours**: `npm deprecate @loar/mcp-server@0.2.0 "security issue — upgrade to 0.2.1"`. The version stays on the registry but installs warn.
- **Always**: bump the next version instead of trying to rewrite a published version. Never `--force`.

---

## Phase 3 — ClawHub registration (OpenClaw)

> **Note**: this section documents the expected flow. Confirm the CLI version
> and command names against current ClawHub docs before running.

### One-time setup

```bash
# Install ClawHub CLI (if not already)
npm install -g @openclaw/clawhub

# Log in
clawhub login
```

### Publish the skills

```bash
# From repo root
clawhub publish skills/loar-video
clawhub publish skills/loar-universe
```

Each `clawhub publish` reads the frontmatter from `SKILL.md`:

- `name`
- `description` (the trigger phrase — the single most-important field)
- `version`
- `requires_mcp_server` pin (`@loar/mcp-server>=0.2.0`)

And bundles `EXAMPLES.md`, `POLICY.md`, and `setup.sh` as part of the skill.

### ⚠️ Acceptance test

Open an OpenClaw-compatible agent, search for "loar", verify:

- Both skills appear.
- Installing loar-video runs `setup.sh` which validates `LOAR_API_KEY`.
- The install config block injected into the host's MCP config matches the pattern in `setup.sh`.

### Rollback

`clawhub unpublish loar-video@0.1.0` (subject to ClawHub policy — may require a version bump instead).

---

## Phase 4 — Hermes Skills Hub registration

> Same caveat as Phase 3: confirm the publisher flow against current Hermes docs.

### One-time setup

```bash
# Hermes publisher CLI (install path depends on their release channel)
hermes skills login
```

### Publish

```bash
hermes skills publish skills/loar-video
hermes skills publish skills/loar-universe
```

### Notes

- Hermes uses native MCP natively, so the same SKILL.md files work without modification.
- The `requires_mcp_server` frontmatter field tells Hermes which npm package to install when a user adds the skill — our `@loar/mcp-server>=0.2.0` is the identifier.

---

## Phase 5 — Document the release publicly

### ⚠️ GitHub release (visible to everyone watching the repo)

```bash
gh release create mcp-v0.2.0 \
  --title "MCP server 0.2.0" \
  --notes-file apps/mcp/CHANGELOG.md \
  --verify-tag
```

### Post-release comms

- Update [https://loar.fun/docs/agent-integration](https://loar.fun/docs/agent-integration) with install snippets.
- ⚠️ Announce in whatever channels you use (ops Slack, Discord, X). Mention:
  - What's new (from CHANGELOG — not everything; highlight the 3 biggest)
  - The pinned requirement (`@loar/mcp-server>=0.2.0`)
  - The hosted-SSE gap (Week 4 — not yet live at `mcp.loar.fun`)

---

## After publish — what's still TBD

These land in follow-up releases:

| Deliverable                                                                                                                      | Tracked in                |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| OAuth 2.1 hosted SSE at `mcp.loar.fun/sse`                                                                                       | PRD §Week 4               |
| Admin `/admin/mcp-usage` dashboard                                                                                               | backlog #3                |
| `clientToken` / `webhookUrl` on secondary mutations (editing, lipsync, cutdown, outpaint, lora, talkingScene, characterPipeline) | backlog #4 — same pattern |
| Per-session webhookSecret (vs. platform-wide `WEBHOOK_SIGNING_SECRET`)                                                           | post-Week-4               |

---

## Incident playbook

### A bad release made it to npm

1. If < 72h old and no downstream dependents: `npm unpublish @loar/mcp-server@<bad-version>`.
2. Otherwise: `npm deprecate @loar/mcp-server@<bad-version> "<what's wrong>"`.
3. Fix the issue, run preflight, publish the next patch.
4. In ClawHub / Hermes, push a skill update pinning `>=<next-version>`.

### A published key leaked

1. Revoke immediately at `https://loar.fun` → Settings → API Keys.
2. If the leak was committed to git: rotate the key server-side, deprecate any npm release that may have embedded it (shouldn't happen — the key is env-only, never bundled).
3. Audit `apiKeyUsage` for any anomalous requests that used the compromised key.

### Webhooks are missing for some users

Check in order:

1. Is `WEBHOOK_SIGNING_SECRET` set on the server? (`enqueueWebhook` no-ops if missing.)
2. Is the worker running? Logs contain `"[webhook delivered]"` lines.
3. BullMQ metrics: `getQueueMetrics()` — are webhook jobs piling up in `waiting` or `failed`?
4. Per-job: does the Firestore doc have `webhookUrl`? The mutation persists it at job-creation time.
5. HMAC: does the receiver's signature verification match? Test locally via `verifyWebhookSignature()` in [apps/server/src/lib/webhooks.ts](../apps/server/src/lib/webhooks.ts).
