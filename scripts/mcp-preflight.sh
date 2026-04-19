#!/usr/bin/env bash
# mcp-preflight.sh — Validates everything needed before `npm publish @loar/mcp-server`.
#
# Runs the full publish checklist but STOPS before anything externally visible
# happens (no `npm publish`, no git tag push, no ClawHub/Hermes calls). Exit
# code 0 means the package is ready; operator runs the publish command by hand.
#
# Usage:
#   ./scripts/mcp-preflight.sh
#
# Exit codes:
#   0  Ready to publish
#   1  Build / type-check / lint failure
#   2  Tarball validation failure (missing LICENSE, wrong contents, etc.)
#   3  Auth / registry state problem (not logged in, org missing, version already published)

set -u
set -o pipefail

readonly PKG_DIR="apps/mcp"
readonly PKG_NAME="@loar/mcp-server"

if [ -t 1 ]; then
  readonly C_RED=$'\033[31m' C_GREEN=$'\033[32m' C_YELLOW=$'\033[33m' C_BLUE=$'\033[34m' C_DIM=$'\033[2m' C_RESET=$'\033[0m'
else
  readonly C_RED="" C_GREEN="" C_YELLOW="" C_BLUE="" C_DIM="" C_RESET=""
fi
fail() { printf "%s[fail]%s %s\n" "$C_RED" "$C_RESET" "$1" >&2; }
warn() { printf "%s[warn]%s %s\n" "$C_YELLOW" "$C_RESET" "$1" >&2; }
ok()   { printf "%s[ ok ]%s %s\n" "$C_GREEN" "$C_RESET" "$1"; }
step() { printf "\n%s▸ %s%s\n" "$C_BLUE" "$1" "$C_RESET"; }

# Run from repo root regardless of cwd.
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$REPO_ROOT" || { fail "cannot cd to repo root"; exit 1; }

if [ ! -d "$PKG_DIR" ]; then
  fail "expected $PKG_DIR to exist — run from repo root"
  exit 1
fi

# ── 1. Working tree is clean ────────────────────────────────────────────
step "git state"

if ! git diff --quiet "$PKG_DIR"; then
  fail "$PKG_DIR has uncommitted changes. Commit or stash before publishing."
  git status --short "$PKG_DIR" >&2
  exit 2
fi
ok "$PKG_DIR has no uncommitted changes"

current_branch=$(git rev-parse --abbrev-ref HEAD)
if [ "$current_branch" != "main" ]; then
  warn "on branch '$current_branch' (not main) — make sure this is intentional"
fi

# ── 2. Package.json sanity ──────────────────────────────────────────────
step "package.json"

cd "$PKG_DIR" || exit 1

pkg_name=$(node -p "require('./package.json').name")
pkg_version=$(node -p "require('./package.json').version")
pkg_private=$(node -p "require('./package.json').private")
pkg_license=$(node -p "require('./package.json').license")
pkg_bin=$(node -p "Object.keys(require('./package.json').bin || {})[0] || ''")

if [ "$pkg_name" != "$PKG_NAME" ]; then
  fail "package name mismatch: got '$pkg_name', expected '$PKG_NAME'"
  exit 2
fi
if [ "$pkg_private" = "true" ]; then
  fail "package.json has 'private: true' — cannot publish"
  exit 2
fi
if [ -z "$pkg_license" ]; then
  fail "package.json missing 'license' field"
  exit 2
fi
if [ -z "$pkg_bin" ]; then
  warn "package.json has no 'bin' entry — npx invocation won't work"
fi
ok "name=$pkg_name version=$pkg_version license=$pkg_license"

# ── 3. LICENSE file present ─────────────────────────────────────────────
step "LICENSE"

if [ ! -f LICENSE ]; then
  fail "$PKG_DIR/LICENSE missing — copy from repo root or write one"
  exit 2
fi
ok "LICENSE present"

# ── 4. Type-check + build ───────────────────────────────────────────────
step "type-check + build"

if ! pnpm check-types >/dev/null 2>&1; then
  fail "pnpm check-types failed"
  pnpm check-types 2>&1 | tail -20 >&2
  exit 1
fi
ok "type-check clean"

# Clean + rebuild so stale .d.ts files can't sneak in
rm -rf dist
if ! pnpm build >/dev/null 2>&1; then
  fail "pnpm build failed"
  pnpm build 2>&1 | tail -20 >&2
  exit 1
fi
ok "build succeeded (dist/ rebuilt from scratch)"

# Shebang preserved?
if ! head -1 dist/src/index.js 2>/dev/null | grep -q '^#!/usr/bin/env node'; then
  fail "dist/src/index.js is missing its #!/usr/bin/env node shebang"
  exit 2
fi
ok "shebang preserved in dist/src/index.js"

# ── 5. Tarball dry-run ──────────────────────────────────────────────────
step "tarball contents"

pack_output=$(npm pack --dry-run --json 2>&1)
if [ $? -ne 0 ]; then
  fail "npm pack --dry-run failed"
  echo "$pack_output" | tail -20 >&2
  exit 2
fi

tarball_size=$(echo "$pack_output" | node -e 'let s=""; process.stdin.on("data",d=>s+=d); process.stdin.on("end",()=>{ const a=JSON.parse(s); console.log(a[0].size) })')
file_count=$(echo "$pack_output" | node -e 'let s=""; process.stdin.on("data",d=>s+=d); process.stdin.on("end",()=>{ const a=JSON.parse(s); console.log(a[0].files.length) })')
# Require LICENSE, README, package.json, and at least index.js in the tarball
required_files=(LICENSE README.md package.json dist/src/index.js)
for required in "${required_files[@]}"; do
  if ! echo "$pack_output" | grep -q "\"path\":\"${required//\//\\/}\""; then
    fail "tarball is missing required file: $required"
    exit 2
  fi
done
# Forbidden files — shouldn't end up in the published tarball
forbidden_patterns=(.tsbuildinfo '\.env' '\.test\.' node_modules)
for forbidden in "${forbidden_patterns[@]}"; do
  if echo "$pack_output" | grep -qE "\"path\":\"[^\"]*$forbidden"; then
    fail "tarball contains forbidden file matching: $forbidden"
    echo "$pack_output" | grep -oE "\"path\":\"[^\"]*$forbidden[^\"]*\"" >&2
    exit 2
  fi
done
ok "tarball clean ($file_count files, $tarball_size bytes)"

# ── 6. npm auth + org ───────────────────────────────────────────────────
step "npm registry state"

if ! npm whoami >/dev/null 2>&1; then
  fail "not logged in to npm — run 'npm login' first"
  exit 3
fi
npm_user=$(npm whoami)
ok "authenticated as: $npm_user"

# Does @loar scope exist?
if ! npm org ls loar >/dev/null 2>&1; then
  fail "@loar npm scope does not exist or you're not a member"
  cat <<EOF >&2
       Create it:
         npm org create loar
       Add yourself:
         npm org set loar $npm_user developer
EOF
  exit 3
fi
ok "@loar scope accessible"

# Is this version already published?
remote_version=$(npm view "$PKG_NAME" version 2>/dev/null || echo "")
if [ "$remote_version" = "$pkg_version" ]; then
  fail "$PKG_NAME@$pkg_version is already published — bump the version first"
  exit 3
fi
if [ -n "$remote_version" ]; then
  ok "current published: $remote_version  →  about to publish: $pkg_version"
else
  ok "package not yet published — this will be the first release ($pkg_version)"
fi

# ── 7. Changelog entry exists ───────────────────────────────────────────
step "changelog"

if [ -f CHANGELOG.md ]; then
  if grep -q "$pkg_version" CHANGELOG.md; then
    ok "CHANGELOG.md mentions $pkg_version"
  else
    warn "CHANGELOG.md exists but does not mention $pkg_version"
  fi
else
  warn "no CHANGELOG.md — consider adding one before shipping"
fi

# ── Done ────────────────────────────────────────────────────────────────

cd "$REPO_ROOT" || exit 1

cat <<EOF

${C_GREEN}Pre-flight passed. Nothing has been published yet.${C_RESET}

To publish:
  ${C_DIM}cd $PKG_DIR${C_RESET}
  ${C_DIM}npm publish --access public${C_RESET}

To tag the release in git:
  ${C_DIM}git tag mcp-v$pkg_version${C_RESET}
  ${C_DIM}git push origin mcp-v$pkg_version${C_RESET}

Registry publishing (ClawHub, Hermes) — see docs/mcp-publish-runbook.md

EOF

exit 0
