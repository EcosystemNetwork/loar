#!/usr/bin/env bash
# Backup program keypairs + .so binaries to a GPG-encrypted tarball.
#
# The program keypair file IS the upgrade authority for the program ID. Lose
# it and the program is frozen at the current binary forever. Production
# practice: keep an offline backup (encrypted USB, paper wallet, safe deposit
# box) alongside the SHA of the binary so a known-good build is recoverable.
#
# Usage:
#   ./backup-keypairs.sh <recipient-email-or-gpg-keyid> [out-dir]
#
# Example:
#   ./backup-keypairs.sh ops@loar.fun ~/loar-mainnet-backups
#
# Produces:
#   <out-dir>/loar-programs-<cluster>-<sha>-<date>.tar.gpg
#   <out-dir>/loar-programs-<cluster>-<sha>-<date>.sha256
#
# Verify a backup:
#   gpg -d backup.tar.gpg | tar -tv         # list contents
#   shasum -a 256 -c backup.sha256          # match recorded hash
set -euo pipefail

RECIPIENT="${1:?usage: backup-keypairs.sh <gpg-recipient> [out-dir]}"
OUT_DIR="${2:-$HOME/loar-program-backups}"
mkdir -p "$OUT_DIR"

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
DEPLOY_DIR="$REPO_ROOT/apps/programs/target/deploy"

if [ ! -d "$DEPLOY_DIR" ]; then
  echo "no deploy artifacts at $DEPLOY_DIR — run 'anchor build' first" >&2
  exit 1
fi

CLUSTER="${SOLANA_CLUSTER:-$(solana config get | awk '/RPC URL/ { print $NF }' || echo unknown)}"
GIT_SHA="$(cd "$REPO_ROOT" && git rev-parse --short HEAD 2>/dev/null || echo nogit)"
DATE="$(date +%Y%m%d-%H%M%S)"
LABEL="loar-programs-${CLUSTER//\//-}-${GIT_SHA}-${DATE}"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

# Stage: keypair JSONs + .so binaries + manifest with on-chain program IDs.
cp "$DEPLOY_DIR"/*-keypair.json "$STAGE/"
cp "$DEPLOY_DIR"/*.so "$STAGE/"

cat > "$STAGE/MANIFEST.txt" <<EOF
LOAR program-keypair backup
Cluster:  $CLUSTER
Git SHA:  $GIT_SHA
Created:  $(date -u +"%Y-%m-%dT%H:%M:%SZ")

Program IDs (derived from keypair pubkeys):
EOF
for kp in "$STAGE"/*-keypair.json; do
  name="$(basename "$kp" -keypair.json)"
  pubkey="$(solana-keygen pubkey "$kp" 2>/dev/null || echo '<unable to derive>')"
  echo "  $name  $pubkey" >> "$STAGE/MANIFEST.txt"
done

# SHA the .so binaries so a future rebuild can be byte-compared.
echo "" >> "$STAGE/MANIFEST.txt"
echo ".so SHA256:" >> "$STAGE/MANIFEST.txt"
(cd "$STAGE" && shasum -a 256 *.so >> MANIFEST.txt)

# Tar + GPG-encrypt
TARBALL="$OUT_DIR/$LABEL.tar"
(cd "$STAGE" && tar -cf "$TARBALL" .)
gpg --yes --output "$TARBALL.gpg" --encrypt --recipient "$RECIPIENT" "$TARBALL"
rm "$TARBALL"

# Outer hash for tamper-detection
shasum -a 256 "$TARBALL.gpg" > "$OUT_DIR/$LABEL.sha256"

echo "✓ Backup written:"
echo "  $TARBALL.gpg"
echo "  $OUT_DIR/$LABEL.sha256"
echo ""
echo "Recommended: copy both files to ≥2 offline locations (encrypted USB,"
echo "             paper-keyed safe). Test decrypt periodically."
