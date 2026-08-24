/**
 * Read-only: find credit-charged generation jobs affected by the same
 * storage.googleapis.com billing outage rescued in
 * scripts/rescue-dead-gcs-hero-clips.ts. Two distinct failure shapes:
 *
 *   1. "Charged and stuck" — videoGenerations/imageGenerations docs whose
 *      output URL is the dead storage.googleapis.com scheme. The user paid
 *      credits, the file likely still exists in GCS (now that billing is
 *      fixed), but nothing ever repointed the doc — same rescue as the hero
 *      clips, just not yet applied here.
 *   2. "Charged and never refunded" — docs in `failedRefunds` with
 *      resolved:false (the app's own audit trail for refunds that failed to
 *      apply), plus any videoGenerations/imageGenerations doc with
 *      creditsCharged > 0, status !== 'completed', and no
 *      creditsRefundedAt — a refund that should have fired (per
 *      lib/refund-audit.ts) but is invisible to the audit trail too.
 *
 * No writes. Reports counts, total credits at stake, and samples so a
 * decision (rescue vs refund) can be made with real numbers.
 *
 * Usage: pnpm tsx scripts/scan-credit-losses-from-storage-outage.ts
 * Env:   FIREBASE_SERVICE_ACCOUNT_PATH (default firebase-sa-key-20260416.json)
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const DEAD_HOST = 'storage.googleapis.com';

function assertProdSafe(keyPath: string) {
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    console.error(`\nRefusing to run: FIRESTORE_EMULATOR_HOST is set. Unset it.\n`);
    process.exit(1);
  }
  if (/emulator|local/i.test(keyPath)) {
    console.error(`\nRefusing to run: "${keyPath}" looks like a local/emulator key.\n`);
    process.exit(1);
  }
}

function hasDeadUrl(data: Record<string, unknown>): string | null {
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'string' && v.includes(DEAD_HOST)) return `${k}: ${v}`;
  }
  return null;
}

async function scanGenerationCollection(db: Firestore, name: string) {
  const snap = await db.collection(name).get();
  const stuckOnDeadUrl: Array<{ id: string; field: string; credits: number }> = [];
  const chargedNotRefunded: Array<{ id: string; status: string; credits: number }> = [];

  for (const d of snap.docs) {
    const data = d.data();
    const credits = Number(data.creditsCharged ?? 0);

    const dead = hasDeadUrl(data);
    if (dead) stuckOnDeadUrl.push({ id: d.id, field: dead, credits });

    const status = String(data.status ?? '');
    if (
      credits > 0 &&
      status !== 'completed' &&
      status !== '' &&
      !data.creditsRefundedAt &&
      !data.creditsRefunded
    ) {
      chargedNotRefunded.push({ id: d.id, status, credits });
    }
  }

  return { total: snap.size, stuckOnDeadUrl, chargedNotRefunded };
}

async function main() {
  const keyPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? 'firebase-sa-key-20260416.json';
  assertProdSafe(keyPath);

  const sa = JSON.parse(fs.readFileSync(keyPath, 'utf-8'));
  const app = initializeApp({ credential: cert(sa) }, `credit-scan-${Date.now()}`);
  const db: Firestore = getFirestore(app);
  db.settings({ preferRest: true });

  console.log(`\n=== SCAN: credit losses from the storage outage (read-only) ===\n`);

  const collections = ['videoGenerations', 'imageGenerations', 'generations'];
  const results: Record<string, Awaited<ReturnType<typeof scanGenerationCollection>>> = {};

  for (const col of collections) {
    try {
      results[col] = await scanGenerationCollection(db, col);
    } catch (err) {
      console.log(`  (skipping ${col}: ${(err as Error).message})`);
    }
  }

  console.log('══════ STUCK ON DEAD storage.googleapis.com URL (rescuable) ══════');
  let totalStuckCredits = 0;
  for (const [col, r] of Object.entries(results)) {
    if (r.stuckOnDeadUrl.length === 0) continue;
    const credits = r.stuckOnDeadUrl.reduce((s, x) => s + x.credits, 0);
    totalStuckCredits += credits;
    console.log(`${col}: ${r.stuckOnDeadUrl.length} doc(s), ${credits} credits`);
    r.stuckOnDeadUrl.slice(0, 5).forEach((x) => console.log(`  ${x.id}  ${x.field.slice(0, 90)}`));
  }
  console.log(`Total credits behind rescuable output: ${totalStuckCredits}`);

  console.log('\n══════ CHARGED, NOT COMPLETED, NOT REFUNDED (per generation doc) ══════');
  let totalUnrefunded = 0;
  for (const [col, r] of Object.entries(results)) {
    if (r.chargedNotRefunded.length === 0) continue;
    const credits = r.chargedNotRefunded.reduce((s, x) => s + x.credits, 0);
    totalUnrefunded += credits;
    console.log(`${col}: ${r.chargedNotRefunded.length} doc(s), ${credits} credits`);
    r.chargedNotRefunded
      .slice(0, 10)
      .forEach((x) => console.log(`  ${x.id}  status=${x.status}  credits=${x.credits}`));
  }
  console.log(`Total unrefunded credits (per-doc check): ${totalUnrefunded}`);

  // failedRefunds — the app's own audit trail for refunds that errored out.
  console.log('\n══════ failedRefunds collection (unresolved) ══════');
  try {
    const frSnap = await db.collection('failedRefunds').where('resolved', '==', false).get();
    const totalFailedRefundCredits = frSnap.docs.reduce(
      (s, d) => s + Number(d.data().credits ?? 0),
      0
    );
    console.log(`Unresolved failed-refund entries: ${frSnap.size}`);
    console.log(`Total credits owed via failedRefunds: ${totalFailedRefundCredits}`);
    frSnap.docs.slice(0, 10).forEach((d) => {
      const x = d.data();
      console.log(`  ${d.id}  user=${x.userId}  credits=${x.credits}  source=${x.source}`);
    });
  } catch (err) {
    console.log(`  (skipping failedRefunds: ${(err as Error).message})`);
  }

  const reportPath = path.resolve(process.cwd(), `credit-loss-scan-${Date.now()}.json`);
  fs.writeFileSync(
    reportPath,
    JSON.stringify({ scannedAt: new Date().toISOString(), results }, null, 2)
  );
  console.log(`\nFull report: ${reportPath}`);
  console.log('No writes were made.\n');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('SCAN FAILED:', err);
    process.exit(1);
  });
