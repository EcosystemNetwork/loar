#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:-${FIREBASE_PROJECT_ID:-}}"
DATABASE_ID="${FIRESTORE_DATABASE_ID:-(default)}"
APPLY="${1:-}"

if [[ -z "$PROJECT_ID" ]]; then
  echo "Set GCP_PROJECT_ID or FIREBASE_PROJECT_ID." >&2
  exit 1
fi

COLLECTIONS=(authOTPs authOTPIssuances jobIdempotency vlmJobs)

for collection in "${COLLECTIONS[@]}"; do
  command=(
    gcloud firestore fields ttls update expiresAt
    "--collection-group=$collection"
    "--database=$DATABASE_ID"
    "--project=$PROJECT_ID"
    --enable-ttl
    --quiet
  )
  if [[ "$APPLY" == "--apply" ]]; then
    "${command[@]}"
  else
    printf 'DRY RUN:'
    printf ' %q' "${command[@]}"
    printf '\n'
  fi
done

if [[ "$APPLY" != "--apply" ]]; then
  echo "Re-run with --apply after reviewing the commands."
fi
