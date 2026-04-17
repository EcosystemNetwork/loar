# Disaster Recovery

Firestore backup and restore procedures for the LOAR platform.

## What is backed up

Firestore exports capture all documents and subcollections in the `(default)` database. This includes users, entities, content metadata, flags, audit logs, nonces, and all other Firestore collections.

## What is NOT backed up

| Data                                     | Why                                               | Recovery path                                    |
| ---------------------------------------- | ------------------------------------------------- | ------------------------------------------------ |
| On-chain state (contracts, tokens, NFTs) | Immutable on Base L2 / Sepolia                    | Re-index from chain via Ponder                   |
| Pinata-hosted files (images, videos)     | IPFS with Pinata pinning — redundant by design    | Re-pin from CIDs stored in Firestore             |
| Lighthouse-hosted files                  | Filecoin deals — decentralized redundancy         | Retrieve via CID from any IPFS/Filecoin gateway  |
| Firebase Storage blobs                   | Separate GCS bucket, not part of Firestore export | Use `gsutil` or GCS lifecycle policies for those |
| Redis cache                              | Ephemeral by design                               | Rebuilds automatically on restart                |

## Prerequisites

1. A GCS bucket for backups (e.g. `loar-firestore-backups`). Create one:

   ```bash
   gsutil mb -l us-central1 gs://loar-firestore-backups
   ```

2. IAM permissions on the service account used by LOAR:
   - **Cloud Datastore Import Export Admin** on the project
   - **Storage Admin** on the backup bucket

3. The default Firestore service agent (`service-PROJECT_NUMBER@gcp-sa-firestore.iam.gserviceaccount.com`) also needs **Storage Object Admin** on the bucket:

   ```bash
   gsutil iam ch serviceAccount:service-PROJECT_NUMBER@gcp-sa-firestore.iam.gserviceaccount.com:roles/storage.objectAdmin \
     gs://loar-firestore-backups
   ```

4. Set the env var:
   ```
   FIRESTORE_BACKUP_BUCKET=loar-firestore-backups
   ```

## Manual backup

```bash
# From the monorepo root
npx tsx apps/server/src/scripts/firestore-backup.ts
```

The script exports all collections to `gs://BUCKET/backups/TIMESTAMP/` and waits for the operation to finish. Output includes the full GCS path needed for restore.

## Manual restore

```bash
# Dry run (no --confirm) — shows what would happen
npx tsx apps/server/src/scripts/firestore-restore.ts \
  --backup gs://loar-firestore-backups/backups/2026-04-17T00-00-00-000Z

# Actual restore
npx tsx apps/server/src/scripts/firestore-restore.ts \
  --backup gs://loar-firestore-backups/backups/2026-04-17T00-00-00-000Z \
  --confirm
```

Restore behavior:

- Documents with matching IDs are **overwritten** with the backup version.
- Documents that exist in the live database but not in the backup are **not deleted**.
- This is a merge, not a wipe-and-replace.

## Automated backup schedule

### Recommended schedule

| Environment | Frequency           | Retention                     |
| ----------- | ------------------- | ----------------------------- |
| Testnet     | Daily               | 7 days                        |
| Mainnet     | Daily + weekly full | 30 days daily, 90 days weekly |

### Setting up with Cloud Scheduler

```bash
# Create a Cloud Scheduler job that triggers daily at 02:00 UTC
gcloud scheduler jobs create http firestore-daily-backup \
  --schedule="0 2 * * *" \
  --uri="https://YOUR_CLOUD_RUN_URL/api/admin/trigger-backup" \
  --http-method=POST \
  --oidc-service-account-email=YOUR_SA@PROJECT.iam.gserviceaccount.com \
  --time-zone="UTC"
```

Alternatively, use GCP's built-in Firestore scheduled exports:

```bash
gcloud firestore export gs://loar-firestore-backups/scheduled/$(date +%Y-%m-%d) \
  --async
```

Wrap this in a Cloud Scheduler + Cloud Function for full automation.

### Retention cleanup

Use GCS lifecycle rules to auto-delete old backups:

```bash
gsutil lifecycle set lifecycle-config.json gs://loar-firestore-backups
```

Example `lifecycle-config.json`:

```json
{
  "rule": [
    {
      "action": { "type": "Delete" },
      "condition": { "age": 30, "matchesPrefix": ["backups/"] }
    },
    {
      "action": { "type": "Delete" },
      "condition": { "age": 90, "matchesPrefix": ["weekly/"] }
    }
  ]
}
```

## RTO / RPO targets

|                           | Testnet  | Mainnet    |
| ------------------------- | -------- | ---------- |
| **RPO** (max data loss)   | 24 hours | 4 hours    |
| **RTO** (time to recover) | 2 hours  | 30 minutes |

Testnet: daily backups are sufficient. Losing a day of testnet data is acceptable.

Mainnet: tighter RPO requires more frequent exports (every 4h via Cloud Scheduler) or streaming backups via Firestore change triggers to BigQuery.

## Point-in-time recovery limitations

Firestore's managed export/import is **snapshot-based**, not point-in-time:

- You can only restore to the exact moment an export was taken.
- There is no WAL replay or incremental restore between snapshots.
- If you need finer granularity, enable **Firestore Point-in-Time Recovery (PITR)** in the GCP console (available on Firestore Native mode databases). PITR allows restoring to any point within the last 7 days but requires the Blaze plan.

To enable PITR:

```bash
gcloud firestore databases update --type=firestore-native \
  --enable-pitr --project=YOUR_PROJECT_ID
```

## Recovery runbook

### Scenario: Corrupted data (bad deploy, script error)

1. Identify when the corruption happened.
2. Find the most recent clean backup before that time:
   ```bash
   gsutil ls gs://loar-firestore-backups/backups/
   ```
3. Restore from that backup:
   ```bash
   npx tsx apps/server/src/scripts/firestore-restore.ts \
     --backup gs://loar-firestore-backups/backups/TIMESTAMP --confirm
   ```
4. Verify data integrity in the Firebase console.
5. Re-index on-chain state if the Ponder indexer's Firestore cache was affected.

### Scenario: Accidental collection deletion

Same as above. Firestore import will re-create deleted documents but will not remove documents added after the backup.

### Scenario: Full project loss

1. Create a new Firebase project.
2. Deploy Firestore security rules and indexes.
3. Restore from the latest backup.
4. Redeploy the server, web, and indexer apps.
5. On-chain state does not need recovery (it lives on-chain).
6. Re-pin IPFS content if Pinata pins were lost (CIDs are in restored Firestore docs).
