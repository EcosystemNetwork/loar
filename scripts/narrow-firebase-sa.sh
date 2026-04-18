#!/usr/bin/env bash
#
# Narrow Firebase Service Account IAM Permissions
#
# This script restricts the LOAR service account to only the roles it needs:
#   - roles/datastore.user          (Firestore read/write)
#   - roles/storage.objectAdmin     (Cloud Storage read/write)
#
# It also creates a new key, outputs the path, and reminds you to rotate
# the FIREBASE_SERVICE_ACCOUNT env var.
#
# Prerequisites:
#   - gcloud CLI installed and authenticated
#   - Permission to manage IAM on the Firebase project
#
# Usage:
#   bash scripts/narrow-firebase-sa.sh <PROJECT_ID> [SERVICE_ACCOUNT_EMAIL]
#
# If SERVICE_ACCOUNT_EMAIL is omitted, defaults to:
#   firebase-adminsdk-*@<PROJECT_ID>.iam.gserviceaccount.com
#
set -euo pipefail

PROJECT_ID="${1:?Usage: $0 <PROJECT_ID> [SERVICE_ACCOUNT_EMAIL]}"
SA_EMAIL="${2:-}"

# Auto-detect SA email if not provided
if [[ -z "$SA_EMAIL" ]]; then
  SA_EMAIL=$(gcloud iam service-accounts list \
    --project="$PROJECT_ID" \
    --filter="email:firebase-adminsdk" \
    --format="value(email)" \
    | head -1)
  if [[ -z "$SA_EMAIL" ]]; then
    echo "ERROR: Could not auto-detect Firebase Admin SDK service account."
    echo "Please provide it as the second argument."
    exit 1
  fi
  echo "Detected service account: $SA_EMAIL"
fi

echo ""
echo "=== Step 1: Audit current IAM roles ==="
echo ""
gcloud projects get-iam-policy "$PROJECT_ID" \
  --flatten="bindings[].members" \
  --filter="bindings.members:serviceAccount:$SA_EMAIL" \
  --format="table(bindings.role)"

echo ""
echo "=== Step 2: Remove overly broad roles ==="
echo ""

# Remove roles/editor if present (the default for Firebase Admin SDK SAs)
CURRENT_ROLES=$(gcloud projects get-iam-policy "$PROJECT_ID" \
  --flatten="bindings[].members" \
  --filter="bindings.members:serviceAccount:$SA_EMAIL" \
  --format="value(bindings.role)")

for role in $CURRENT_ROLES; do
  case "$role" in
    roles/datastore.user|roles/storage.objectAdmin)
      echo "KEEP: $role"
      ;;
    *)
      echo "REMOVE: $role"
      gcloud projects remove-iam-policy-binding "$PROJECT_ID" \
        --member="serviceAccount:$SA_EMAIL" \
        --role="$role" \
        --quiet
      ;;
  esac
done

echo ""
echo "=== Step 3: Ensure minimum required roles ==="
echo ""

for role in roles/datastore.user roles/storage.objectAdmin; do
  echo "GRANT: $role"
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$SA_EMAIL" \
    --role="$role" \
    --quiet > /dev/null
done

echo ""
echo "=== Step 4: Create new key and disable old keys ==="
echo ""

NEW_KEY_PATH="$(pwd)/firebase-sa-key-$(date +%Y%m%d).json"
gcloud iam service-accounts keys create "$NEW_KEY_PATH" \
  --iam-account="$SA_EMAIL" \
  --project="$PROJECT_ID"

echo ""
echo "New key written to: $NEW_KEY_PATH"

# List all keys (so operator can manually disable old ones)
echo ""
echo "=== Current keys for $SA_EMAIL ==="
gcloud iam service-accounts keys list \
  --iam-account="$SA_EMAIL" \
  --project="$PROJECT_ID" \
  --format="table(name.basename(), validAfterTime, validBeforeTime, keyType)"

echo ""
echo "=== Step 5: Verify final IAM policy ==="
echo ""
gcloud projects get-iam-policy "$PROJECT_ID" \
  --flatten="bindings[].members" \
  --filter="bindings.members:serviceAccount:$SA_EMAIL" \
  --format="table(bindings.role)"

echo ""
echo "============================================"
echo "DONE. Next steps:"
echo ""
echo "1. Update FIREBASE_SERVICE_ACCOUNT env var with contents of:"
echo "   $NEW_KEY_PATH"
echo ""
echo "2. Disable/delete old keys listed above (keep only the new one)"
echo "   gcloud iam service-accounts keys delete <KEY_ID> \\"
echo "     --iam-account=$SA_EMAIL --project=$PROJECT_ID"
echo ""
echo "3. Verify the app still works after deploying the new key"
echo ""
echo "4. Add $NEW_KEY_PATH to .gitignore (DO NOT commit)"
echo "============================================"
