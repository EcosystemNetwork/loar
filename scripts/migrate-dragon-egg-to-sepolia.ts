/**
 * Migrate Dragon Egg's off-chain content from Base Sepolia to Ethereum Sepolia.
 *
 * WHAT THIS DOES AND DOES NOT DO
 * ------------------------------
 * On-chain state cannot move between chains. The Base Sepolia universe
 * (0x38f1e8b9…), its EGG token (0x9e6d14eb…), the bonding curve holding 4 ETH,
 * and 20 trades all stay on Base Sepolia permanently. This script moves only the
 * OFF-CHAIN records — which are chain-agnostic — onto a universe that already
 * exists on Sepolia.
 *
 * So the on-chain universe must be created FIRST; pass its address via --to.
 *
 * Safe by construction:
 *   - dry run unless --apply
 *   - refuses to run if --to is not a real Sepolia universe doc
 *   - archives (never deletes) the old universe doc, leaving a forwarding pointer
 *
 * Usage:
 *   pnpm tsx scripts/migrate-dragon-egg-to-sepolia.ts --to 0x<newSepoliaUniverse>
 *   pnpm tsx scripts/migrate-dragon-egg-to-sepolia.ts --to 0x… --apply
 */
import dotenv from 'dotenv';
import path from 'path';
import { readFileSync } from 'fs';
import { initializeApp, cert, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const APPLY = process.argv.includes('--apply');
const toIdx = process.argv.indexOf('--to');
const TO_RAW = toIdx !== -1 ? process.argv[toIdx + 1] : '';

const FROM = '0x38f1e8b9c2d31f163fbfcbb9638de959fedcb964'; // Dragon Egg on Base Sepolia
const BASE_SEPOLIA = 84532;
const ETH_SEPOLIA = 11155111;

/** Collections that reference a universe by `universeId`. */
const CONTENT_COLLECTIONS = [
  'content',
  'episodes',
  'offChainNodes',
  'entities',
  'mediaAttachments',
];

function initDb(): Firestore {
  const existing = getApps()[0];
  if (existing) return getFirestore(existing);
  // The repo .env points at the Firestore emulator for local dev; this script
  // must never silently rewrite an empty emulator and report success.
  if (process.env.FIRESTORE_EMULATOR_HOST && !process.argv.includes('--emulator')) {
    console.log(`(ignoring FIRESTORE_EMULATOR_HOST=${process.env.FIRESTORE_EMULATOR_HOST})`);
    delete process.env.FIRESTORE_EMULATOR_HOST;
  }
  let credential;
  try {
    const p = path.resolve(process.cwd(), process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? '');
    const sa = process.env.FIREBASE_SERVICE_ACCOUNT
      ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
      : JSON.parse(readFileSync(p, 'utf-8'));
    credential = /local-emulator/.test(String(sa.client_email)) ? applicationDefault() : cert(sa);
  } catch {
    credential = applicationDefault();
  }
  const db = getFirestore(initializeApp({ credential, projectId: 'loar-db' }));
  db.settings({ preferRest: true });
  return db;
}

async function main() {
  console.log(APPLY ? '⚠️  APPLY — writing to Firestore' : '🔍 DRY RUN — no writes');
  if (!/^0x[0-9a-fA-F]{40}$/.test(TO_RAW)) {
    console.error('\n--to <address> is required: the Sepolia universe to migrate onto.');
    console.error('Create it on-chain first, then pass its contract address here.');
    process.exit(1);
  }
  const TO = TO_RAW.toLowerCase();
  const db = initDb();

  // ── Preconditions ────────────────────────────────────────────────────────
  const src = await db.collection('cinematicUniverses').doc(FROM).get();
  if (!src.exists) throw new Error(`source universe ${FROM} not found`);
  const srcData = src.data() as Record<string, unknown>;
  if (srcData.chainId !== BASE_SEPOLIA) {
    throw new Error(
      `source chainId is ${srcData.chainId}, expected ${BASE_SEPOLIA} — already migrated?`
    );
  }

  const dst = await db.collection('cinematicUniverses').doc(TO).get();
  if (!dst.exists) {
    throw new Error(
      `target universe ${TO} does not exist in Firestore.\n` +
        `Create the universe on Sepolia first (on-chain + universes.create), then re-run.`
    );
  }
  const dstData = dst.data() as Record<string, unknown>;
  if (dstData.chainId !== ETH_SEPOLIA) {
    throw new Error(`target chainId is ${dstData.chainId}, expected ${ETH_SEPOLIA}`);
  }
  console.log(`\n  source: ${FROM}  "${srcData.name}"  chain=${srcData.chainId}`);
  console.log(`  target: ${TO}  "${dstData.name}"  chain=${dstData.chainId}`);

  // ── Branding carried across verbatim (same name & branding) ──────────────
  const BRAND_FIELDS = [
    'name',
    'description',
    'image_url',
    'portrait_image_url',
    'unstoppableDomain',
  ];
  const brand: Record<string, unknown> = {};
  for (const f of BRAND_FIELDS)
    if (srcData[f] !== undefined && srcData[f] !== null) brand[f] = srcData[f];
  console.log(`\n  branding fields to copy: ${Object.keys(brand).join(', ') || '(none)'}`);

  // ── Re-point content ─────────────────────────────────────────────────────
  let moved = 0;
  for (const col of CONTENT_COLLECTIONS) {
    const snap = await db.collection(col).where('universeId', '==', FROM).get();
    if (snap.empty) {
      console.log(`  ${col.padEnd(18)} 0`);
      continue;
    }
    console.log(`  ${col.padEnd(18)} ${snap.size}`);
    for (const d of snap.docs) {
      moved++;
      if (APPLY) {
        await d.ref.update({
          universeId: TO,
          migratedFrom: FROM,
          migratedFromChainId: BASE_SEPOLIA,
          migratedAt: new Date(),
        });
      }
    }
  }

  // ── Archive the old universe (never delete: old links must not 404) ──────
  if (APPLY) {
    await dst.ref.update({ ...brand, updated_at: new Date() });
    await src.ref.update({
      isPrivate: true,
      archived: true,
      archivedReason: 'Migrated to Ethereum Sepolia; Base Sepolia is deprecated.',
      migratedTo: TO,
      migratedToChainId: ETH_SEPOLIA,
      migratedAt: new Date(),
      updated_at: new Date(),
    });
  }

  console.log(`\n  content records ${APPLY ? 'moved' : 'to move'}: ${moved}`);
  console.log(
    `  old universe ${APPLY ? 'archived' : 'would be archived'} with forwarding pointer -> ${TO}`
  );
  if (!APPLY) console.log('\nRe-run with --apply to persist.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
