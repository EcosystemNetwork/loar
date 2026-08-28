/**
 * One-time backfill: normalize `creatorUid` on content rows that were
 * written under a Solana base58 pubkey (during the 2026-05-11 → 2026-05-15
 * SIWS-only window) into the user's canonical lowercased-EVM identity.
 *
 * Walks the configured collections, finds docs where `creatorUid` is base58
 * (not hex), looks up the linked EVM address via `walletLinks` (with a
 * fallback to `circleSolanaWallets.address`), and updates the row in-place.
 *
 * Idempotent. Safe to re-run. Rows with no resolvable link are reported and
 * left untouched — they belong to users who only ever used SIWS without
 * Circle DCW, and their identity stays base58 until they link an EVM wallet.
 *
 * Usage:
 *   DRY_RUN=1 pnpm -F server tsx scripts/migrate-solana-creator-uids.ts   (default)
 *   DRY_RUN=0 pnpm -F server tsx scripts/migrate-solana-creator-uids.ts   (writes)
 *
 * Optional env:
 *   COLLECTIONS=content,entities,videoGenerations,imageGenerations
 *     Comma-separated list of collections to walk. Defaults to those four.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const DRY_RUN = process.env.DRY_RUN !== '0';
const DEFAULT_COLLECTIONS = ['content', 'entities', 'videoGenerations', 'imageGenerations'];

const HEX_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function initFirebase(): Firestore {
  if (getApps().length === 0) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    const filePath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    let serviceAccount: any;
    if (raw) {
      serviceAccount = JSON.parse(raw);
    } else if (filePath) {
      const absPath = path.resolve(__dirname, '../../../', filePath);
      serviceAccount = JSON.parse(readFileSync(absPath, 'utf-8'));
    } else {
      throw new Error('FIREBASE_SERVICE_ACCOUNT or FIREBASE_SERVICE_ACCOUNT_PATH required');
    }
    initializeApp({ credential: cert(serviceAccount) });
  }
  return getFirestore();
}

/** In-memory memo across the run so we don't reread the same link twice. */
const linkCache = new Map<string, string | null>();

async function resolveEvm(db: Firestore, solanaAddress: string): Promise<string | null> {
  if (linkCache.has(solanaAddress)) return linkCache.get(solanaAddress)!;
  let evm: string | null = null;

  const direct = await db.collection('walletLinks').doc(solanaAddress).get();
  if (direct.exists) {
    const data = direct.data() as { evmAddress?: string };
    if (data.evmAddress && HEX_ADDRESS.test(data.evmAddress)) {
      evm = data.evmAddress.toLowerCase();
    }
  }

  if (!evm) {
    const fallback = await db
      .collection('circleSolanaWallets')
      .where('address', '==', solanaAddress)
      .limit(1)
      .get();
    if (!fallback.empty) {
      const row = fallback.docs[0].data() as { userId?: string };
      if (row.userId && HEX_ADDRESS.test(row.userId)) {
        evm = row.userId.toLowerCase();
      }
    }
  }

  linkCache.set(solanaAddress, evm);
  return evm;
}

interface CollectionStats {
  collection: string;
  scanned: number;
  hex: number;
  base58: number;
  bridged: number;
  unresolved: number;
  errors: number;
}

async function processCollection(db: Firestore, collection: string): Promise<CollectionStats> {
  const stats: CollectionStats = {
    collection,
    scanned: 0,
    hex: 0,
    base58: 0,
    bridged: 0,
    unresolved: 0,
    errors: 0,
  };
  const unresolvedExamples = new Set<string>();

  // Page through the entire collection. We can't filter by base58 server-side
  // without a regex index, so we scan everything and filter in memory.
  const PAGE_SIZE = 500;
  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;

  while (true) {
    let query: FirebaseFirestore.Query = db
      .collection(collection)
      .orderBy('__name__')
      .limit(PAGE_SIZE);
    if (lastDoc) query = query.startAfter(lastDoc);

    const snap = await query.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      stats.scanned += 1;
      const creatorUid: unknown = doc.get('creatorUid');
      if (typeof creatorUid !== 'string' || !creatorUid) continue;

      if (HEX_ADDRESS.test(creatorUid)) {
        stats.hex += 1;
        continue;
      }
      if (!BASE58_ADDRESS.test(creatorUid)) continue;
      stats.base58 += 1;

      try {
        const evm = await resolveEvm(db, creatorUid);
        if (!evm) {
          stats.unresolved += 1;
          if (unresolvedExamples.size < 5) unresolvedExamples.add(creatorUid);
          continue;
        }

        if (DRY_RUN) {
          stats.bridged += 1;
          continue;
        }

        await doc.ref.update({
          creatorUid: evm,
          creatorUidLegacySolana: creatorUid,
          creatorUidMigratedAt: new Date(),
        });
        stats.bridged += 1;
      } catch (err) {
        stats.errors += 1;
        console.warn(
          `[migrate-solana-uids] ${collection}/${doc.id} failed:`,
          (err as Error).message
        );
      }
    }

    if (snap.docs.length < PAGE_SIZE) break;
    lastDoc = snap.docs[snap.docs.length - 1];
  }

  if (unresolvedExamples.size > 0) {
    console.warn(
      `  ↳ ${stats.unresolved} unresolved base58 uid(s) in ${collection}; samples:`,
      Array.from(unresolvedExamples)
    );
  }
  return stats;
}

async function main() {
  const db = initFirebase();
  const collections = (process.env.COLLECTIONS ?? DEFAULT_COLLECTIONS.join(','))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  console.log(`[migrate-solana-uids] mode=${DRY_RUN ? 'DRY_RUN' : 'WRITE'}`);
  console.log(`[migrate-solana-uids] collections=${collections.join(', ')}`);

  const all: CollectionStats[] = [];
  for (const c of collections) {
    console.log(`[migrate-solana-uids] scanning ${c}…`);
    const s = await processCollection(db, c);
    all.push(s);
    console.log(
      `  scanned=${s.scanned} hex=${s.hex} base58=${s.base58} bridged=${s.bridged} unresolved=${s.unresolved} errors=${s.errors}`
    );
  }

  console.log('\n[migrate-solana-uids] summary');
  for (const s of all) {
    console.log(
      `  ${s.collection.padEnd(22)} scanned=${s.scanned} bridged=${s.bridged} unresolved=${s.unresolved} errors=${s.errors}`
    );
  }
  if (DRY_RUN) {
    console.log('\nRe-run with DRY_RUN=0 to apply.');
  }
}

main().catch((err) => {
  console.error('[migrate-solana-uids] fatal:', err);
  process.exit(1);
});
