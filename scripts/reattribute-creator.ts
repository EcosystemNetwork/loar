/**
 * Reattribute Firestore content from old dev wallets to a target wallet.
 *
 * The new content-fill scripts (regen-hero-clip, fill-audio-and-voices,
 * fill-meshy-3d, build-episode-from-nodes, fill-entity-portraits) used to
 * stamp `creator`/`creatorUid`/`creatorAddress`/`sourceCreator` with the
 * Sepolia deployer wallet 0x116c28...d90e (or the Anvil default 0xf39Fd...266).
 * This rewrites those fields to a target wallet so the operator can browse
 * the test content as their own.
 *
 * Strict matching: only docs whose creator field equals one of the known
 * dev wallets are touched. Null / missing / unknown creators are left alone.
 *
 * Usage:
 *   pnpm tsx scripts/reattribute-creator.ts                # dry-run, default target
 *   pnpm tsx scripts/reattribute-creator.ts --apply        # write
 *   pnpm tsx scripts/reattribute-creator.ts --target 0xABC --apply
 */
import dotenv from 'dotenv';
import path from 'path';
import { readFileSync } from 'fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const APPLY = process.argv.includes('--apply');
const targetIdx = process.argv.indexOf('--target');
const TARGET = (
  targetIdx >= 0 && process.argv[targetIdx + 1]
    ? process.argv[targetIdx + 1]
    : '0x80baf7fffc430cdaced4f1d673f4138d6d493077'
).toLowerCase();

if (!/^0x[0-9a-f]{40}$/.test(TARGET)) {
  console.error(`Invalid --target address: ${TARGET}`);
  process.exit(1);
}

// Known dev/test creator wallets that should be reattributed.
const OLD_CREATORS = new Set<string>([
  '0x116c28e6dcabca363f83217c712d79dce168d90e', // Sepolia deployer (also used as PLATFORM_CREATOR in scripts)
  '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266', // Anvil default account 0
]);

const saPath = path.resolve(
  process.cwd(),
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? 'firebase-sa-key-20260416.json'
);
const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
  : JSON.parse(readFileSync(saPath, 'utf-8'));
const app = initializeApp({ credential: cert(serviceAccount) }, `reattribute-${Date.now()}`);
const db = getFirestore(app);
db.settings({ preferRest: true });

type Mapping = { collection: string; fields: string[] };

// Collections + fields where creator/owner addresses are stored.
// `creatorUid` is the lowercased-address uid; treated identically.
const MAPPINGS: Mapping[] = [
  { collection: 'cinematicUniverses', fields: ['creator', 'creatorAddress', 'creatorUid'] },
  { collection: 'entities', fields: ['creator', 'creatorAddress', 'creatorUid', 'createdBy'] },
  { collection: 'content', fields: ['creator', 'creatorAddress', 'creatorUid'] },
  { collection: 'episodes', fields: ['creator', 'sourceCreator', 'creatorUid'] },
  { collection: 'offChainNodes', fields: ['creator', 'creatorAddress', 'creatorUid'] },
  { collection: 'videoGenerations', fields: ['creator', 'creatorAddress', 'creatorUid'] },
  { collection: 'imageGenerations', fields: ['creator', 'creatorAddress', 'creatorUid'] },
  { collection: 'audioGenerations', fields: ['creator', 'creatorAddress', 'creatorUid'] },
  { collection: 'meshyJobs', fields: ['creator', 'creatorAddress', 'creatorUid'] },
];

interface Plan {
  docPath: string;
  changes: Record<string, { from: string; to: string }>;
}

function normalize(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  return v.toLowerCase();
}

async function planCollection(m: Mapping): Promise<Plan[]> {
  const snap = await db.collection(m.collection).get();
  const plans: Plan[] = [];
  for (const doc of snap.docs) {
    const data = doc.data();
    const changes: Record<string, { from: string; to: string }> = {};
    for (const f of m.fields) {
      const norm = normalize(data[f]);
      if (norm && OLD_CREATORS.has(norm) && norm !== TARGET) {
        changes[f] = { from: data[f], to: TARGET };
      }
    }
    if (Object.keys(changes).length > 0) {
      plans.push({ docPath: doc.ref.path, changes });
    }
  }
  return plans;
}

async function main() {
  console.log(`\n=== Reattribute Creator ===`);
  console.log(`Target: ${TARGET}`);
  console.log(`Old creators: ${[...OLD_CREATORS].join(', ')}`);
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN (use --apply to write)'}\n`);

  let total = 0;
  for (const m of MAPPINGS) {
    process.stdout.write(`scanning ${m.collection.padEnd(22)} ... `);
    const plans = await planCollection(m);
    process.stdout.write(`${plans.length} doc(s) need rewrite\n`);
    total += plans.length;
    for (const p of plans.slice(0, 5)) {
      const fields = Object.entries(p.changes)
        .map(([k, v]) => `${k}: ${v.from.slice(0, 10)}… → ${v.to.slice(0, 10)}…`)
        .join(', ');
      console.log(`  - ${p.docPath}  { ${fields} }`);
    }
    if (plans.length > 5) console.log(`  … and ${plans.length - 5} more`);

    if (APPLY && plans.length) {
      let batch = db.batch();
      let ops = 0;
      for (const p of plans) {
        const update: Record<string, unknown> = {};
        for (const [field, { to }] of Object.entries(p.changes)) {
          update[field] = to;
        }
        update.creatorReattributedAt = FieldValue.serverTimestamp();
        batch.update(db.doc(p.docPath), update);
        ops++;
        if (ops >= 400) {
          await batch.commit();
          batch = db.batch();
          ops = 0;
        }
      }
      if (ops > 0) await batch.commit();
      console.log(`  ✓ wrote ${plans.length} doc(s)`);
    }
  }

  console.log(`\nTotal docs ${APPLY ? 'rewritten' : 'matching'}: ${total}`);
  if (!APPLY) console.log(`(dry-run — re-run with --apply to write)`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
