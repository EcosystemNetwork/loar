/**
 * Inspect WHY content docs are hidden from the gallery. Read-only.
 * Gallery filter is `visibility == 'public'` AND contentStatus not in
 * {flagged, under_review, hidden, removed}. Anything else is invisible.
 */
import dotenv from 'dotenv';
import path from 'path';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const HIDDEN = new Set(['flagged', 'under_review', 'hidden', 'removed']);

async function main() {
  const existing = getApps()[0];
  let db;
  if (existing) {
    db = getFirestore(existing);
  } else {
    const sa = JSON.parse(readFileSync('firebase-sa-key-20260416.json', 'utf-8'));
    const app = initializeApp({ credential: cert(sa) });
    db = getFirestore(app);
    db.settings({ preferRest: true });
  }

  const uSnap = await db.collection('cinematicUniverses').get();
  const uByAddr = new Map<string, string>();
  for (const d of uSnap.docs) {
    const data = d.data() as any;
    const addr = (data.address || d.id || '').toLowerCase();
    uByAddr.set(addr, data.name || '(unnamed)');
  }

  const cSnap = await db.collection('content').get();

  // Tabulate why each doc is hidden, per universe
  type Bucket = {
    visMissing: number; // visibility absent
    visNotPublic: Map<string, number>; // visibility set but not 'public'
    statusHidden: Map<string, number>; // contentStatus in HIDDEN
    visibleHere: number; // OK
    samples: string[];
  };
  const perUni = new Map<string, Bucket>();

  for (const doc of cSnap.docs) {
    const data = doc.data() as any;
    const uid = (data.universeId as string | undefined)?.toLowerCase();
    if (!uid) continue;
    if (!perUni.has(uid)) {
      perUni.set(uid, {
        visMissing: 0,
        visNotPublic: new Map(),
        statusHidden: new Map(),
        visibleHere: 0,
        samples: [],
      });
    }
    const b = perUni.get(uid)!;
    const vis = data.visibility;
    const status = data.contentStatus;

    const isVisible = vis === 'public' && !HIDDEN.has(status);
    if (isVisible) {
      b.visibleHere++;
      continue;
    }

    if (vis == null) b.visMissing++;
    else if (vis !== 'public')
      b.visNotPublic.set(String(vis), (b.visNotPublic.get(String(vis)) ?? 0) + 1);

    if (HIDDEN.has(status))
      b.statusHidden.set(String(status), (b.statusHidden.get(String(status)) ?? 0) + 1);

    if (b.samples.length < 1) {
      b.samples.push(
        `id=${doc.id}  visibility=${JSON.stringify(vis)}  contentStatus=${JSON.stringify(status)}  mediaType=${data.mediaType}`
      );
    }
  }

  console.log('──────────── WHY CONTENT IS HIDDEN ────────────');
  for (const [uid, b] of perUni) {
    const total = b.visibleHere + b.visMissing + sumMap(b.visNotPublic) + sumMap(b.statusHidden);
    if (total === b.visibleHere) continue; // all visible — skip
    const name = uByAddr.get(uid) ?? '(?)';
    console.log(`\n${name}  ${uid.slice(0, 12)}…   total=${total}  visible=${b.visibleHere}`);
    if (b.visMissing) console.log(`  visibility MISSING:        ${b.visMissing}`);
    for (const [v, n] of b.visNotPublic) console.log(`  visibility="${v}":          ${n}`);
    for (const [s, n] of b.statusHidden) console.log(`  contentStatus="${s}":  ${n}`);
    console.log(`  sample:  ${b.samples[0]}`);
  }
}

function sumMap(m: Map<string, number>) {
  let s = 0;
  for (const v of m.values()) s += v;
  return s;
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
