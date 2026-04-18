#!/usr/bin/env bash
#
# restrict-firebase-iam.sh — Create a custom IAM role with minimum permissions
# for the LOAR Firebase service account and remove the default Editor role.
#
# The LOAR server uses Firebase Admin SDK for:
#   - Firestore read/write (db.collection().get/add/set/update/delete)
#   - No Firebase Auth, no FCM, no Remote Config, no Realtime Database
#   - Cloud Storage only if FIREBASE_STORAGE_BUCKET is set (optional)
#
# Minimum required predefined roles:
#   - roles/datastore.user         (Firestore CRUD)
#   - roles/storage.objectAdmin    (Cloud Storage, if used)
#
# This script goes further by creating a CUSTOM role with only the exact
# permissions needed, rather than using predefined roles which include extras.
#
# Usage:
#   bash scripts/restrict-firebase-iam.sh <PROJECT_ID> [SERVICE_ACCOUNT_EMAIL]
#
# DRY_RUN mode (prints commands without executing):
#   DRY_RUN=1 bash scripts/restrict-firebase-iam.sh <PROJECT_ID> [SA_EMAIL]
#
# Prerequisites:
#   - gcloud CLI installed and authenticated
#   - roles/iam.roleAdmin on the project (to create custom roles)
#   - roles/resourcemanager.projectIamAdmin (to modify IAM bindings)
#
set -euo pipefail

PROJECT_ID="${1:?Usage: $0 <PROJECT_ID> [SERVICE_ACCOUNT_EMAIL]}"
SA_EMAIL="${2:-}"
DRY_RUN="${DRY_RUN:-0}"

CUSTOM_ROLE_ID="loarServerMinimal"
CUSTOM_ROLE_TITLE="LOAR Server Minimal"

# ── Helpers ─────────────────────────────────────────────────────────────

run_cmd() {
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "[DRY RUN] $*"
  else
    "$@"
  fi
}

echo "============================================"
echo "  LOAR Firebase SA IAM Restriction"
echo "  Project: $PROJECT_ID"
echo "  Mode:    $([ "$DRY_RUN" == "1" ] && echo "DRY RUN (no changes)" || echo "LIVE")"
echo "============================================"
echo ""

# ── Step 0: Auto-detect service account ─────────────────────────────────

if [[ -z "$SA_EMAIL" ]]; then
  echo "Auto-detecting Firebase Admin SDK service account..."
  SA_EMAIL=$(gcloud iam service-accounts list \
    --project="$PROJECT_ID" \
    --filter="email:firebase-adminsdk" \
    --format="value(email)" \
    | head -1)
  if [[ -z "$SA_EMAIL" ]]; then
    echo "ERROR: Could not auto-detect Firebase Admin SDK service account."
    echo "Provide it as the second argument."
    exit 1
  fi
  echo "Detected: $SA_EMAIL"
fi

echo ""

# ── Step 1: Audit current roles ────────────────────────────────────────
# Shows what the SA currently has so you can see what will be removed.

echo "=== Step 1: Current IAM roles for $SA_EMAIL ==="
echo ""
gcloud projects get-iam-policy "$PROJECT_ID" \
  --flatten="bindings[].members" \
  --filter="bindings.members:serviceAccount:$SA_EMAIL" \
  --format="table(bindings.role)" 2>/dev/null || echo "(no roles found)"

echo ""

# ── Step 2: Create custom role with minimum permissions ─────────────────
# These are the exact Firestore permissions the LOAR server needs.
# No wildcards, no admin permissions beyond document CRUD.

echo "=== Step 2: Create custom role '$CUSTOM_ROLE_ID' ==="
echo ""
echo "Permissions included:"
echo "  - datastore.databases.get          (connect to Firestore)"
echo "  - datastore.entities.create        (add documents)"
echo "  - datastore.entities.get           (read documents)"
echo "  - datastore.entities.list          (list/query documents)"
echo "  - datastore.entities.update        (update documents)"
echo "  - datastore.entities.delete        (delete documents)"
echo "  - datastore.indexes.list           (use composite indexes)"
echo "  - storage.objects.create           (upload files, if Storage used)"
echo "  - storage.objects.get              (download files, if Storage used)"
echo "  - storage.objects.delete           (delete files, if Storage used)"
echo "  - storage.objects.list             (list files, if Storage used)"
echo ""

# Check if role already exists
ROLE_EXISTS=$(gcloud iam roles describe "$CUSTOM_ROLE_ID" \
  --project="$PROJECT_ID" \
  --format="value(name)" 2>/dev/null || echo "")

if [[ -n "$ROLE_EXISTS" ]]; then
  echo "Custom role already exists — updating permissions..."
  run_cmd gcloud iam roles update "$CUSTOM_ROLE_ID" \
    --project="$PROJECT_ID" \
    --permissions="\
datastore.databases.get,\
datastore.entities.create,\
datastore.entities.get,\
datastore.entities.list,\
datastore.entities.update,\
datastore.entities.delete,\
datastore.indexes.list,\
storage.objects.create,\
storage.objects.get,\
storage.objects.delete,\
storage.objects.list" \
    --quiet
else
  echo "Creating new custom role..."
  run_cmd gcloud iam roles create "$CUSTOM_ROLE_ID" \
    --project="$PROJECT_ID" \
    --title="$CUSTOM_ROLE_TITLE" \
    --description="Minimum permissions for the LOAR server: Firestore CRUD + Cloud Storage objects" \
    --permissions="\
datastore.databases.get,\
datastore.entities.create,\
datastore.entities.get,\
datastore.entities.list,\
datastore.entities.update,\
datastore.entities.delete,\
datastore.indexes.list,\
storage.objects.create,\
storage.objects.get,\
storage.objects.delete,\
storage.objects.list" \
    --stage="GA" \
    --quiet
fi

echo ""

# ── Step 3: Bind the SA to the custom role ──────────────────────────────

echo "=== Step 3: Bind service account to custom role ==="
echo ""

run_cmd gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$SA_EMAIL" \
  --role="projects/$PROJECT_ID/roles/$CUSTOM_ROLE_ID" \
  --quiet

echo ""

# ── Step 4: Remove the default Editor role ──────────────────────────────
# Firebase Admin SDK SAs are granted roles/editor by default, which is
# wildly overprivileged. This removes it and any other non-essential roles.

echo "=== Step 4: Remove overly broad roles ==="
echo ""

CURRENT_ROLES=$(gcloud projects get-iam-policy "$PROJECT_ID" \
  --flatten="bindings[].members" \
  --filter="bindings.members:serviceAccount:$SA_EMAIL" \
  --format="value(bindings.role)" 2>/dev/null || echo "")

for role in $CURRENT_ROLES; do
  case "$role" in
    # Keep our custom role and the predefined minimum roles
    "projects/$PROJECT_ID/roles/$CUSTOM_ROLE_ID")
      echo "KEEP: $role (custom LOAR role)"
      ;;
    roles/datastore.user|roles/storage.objectAdmin)
      # These are safe to keep as fallback, but we can remove them
      # since our custom role covers the needed permissions
      echo "REMOVE: $role (covered by custom role)"
      run_cmd gcloud projects remove-iam-policy-binding "$PROJECT_ID" \
        --member="serviceAccount:$SA_EMAIL" \
        --role="$role" \
        --quiet
      ;;
    roles/editor|roles/owner|roles/viewer)
      echo "REMOVE: $role (overly broad — SECURITY RISK)"
      run_cmd gcloud projects remove-iam-policy-binding "$PROJECT_ID" \
        --member="serviceAccount:$SA_EMAIL" \
        --role="$role" \
        --quiet
      ;;
    *)
      echo "REMOVE: $role (not required by LOAR server)"
      run_cmd gcloud projects remove-iam-policy-binding "$PROJECT_ID" \
        --member="serviceAccount:$SA_EMAIL" \
        --role="$role" \
        --quiet
      ;;
  esac
done

echo ""

# ── Step 5: Verify final state ──────────────────────────────────────────

echo "=== Step 5: Final IAM roles for $SA_EMAIL ==="
echo ""
if [[ "$DRY_RUN" == "1" ]]; then
  echo "[DRY RUN] Would show updated IAM policy"
else
  gcloud projects get-iam-policy "$PROJECT_ID" \
    --flatten="bindings[].members" \
    --filter="bindings.members:serviceAccount:$SA_EMAIL" \
    --format="table(bindings.role)"
fi

echo ""
echo "============================================"
echo "DONE."
echo ""
if [[ "$DRY_RUN" == "1" ]]; then
  echo "This was a DRY RUN. No changes were made."
  echo "Remove DRY_RUN=1 to execute for real."
else
  echo "The service account now has only the custom role:"
  echo "  projects/$PROJECT_ID/roles/$CUSTOM_ROLE_ID"
  echo ""
  echo "Next steps:"
  echo "  1. Test the app to verify Firestore and Storage still work"
  echo "  2. If Storage is NOT used, you can further restrict by removing"
  echo "     storage.objects.* permissions from the custom role"
  echo "  3. Monitor Cloud Audit Logs for any permission-denied errors"
fi
echo "============================================"
