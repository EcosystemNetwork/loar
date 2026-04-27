/**
 * Find every Pinata-hosted video reference across Firestore, regardless of
 * which collection or field it lives in. Read-only.
 *
 * Reports per collection:
 *  - total docs scanned
 *  - docs containing a pinata URL anywhere in their JSON
 *  - which fields the URLs land in
 *  - distinct universeId/parentId/owner addresses found alongside them
 */
import dotenv from 'dotenv';
import path from 'path';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const PINATA_RX =
  /https?:\/\/[^"'\s]*(?:mypinata\.cloud|gateway\.pinata\.cloud|ipfs\.io|w3s\.link)[^"'\s]*/gi;

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

  const colsSnap = await db.listCollections();
  const collections = colsSnap.map((c) => c.id).sort();
  console.log(`Top-level collections (${collections.length}): ${collections.join(', ')}\n`);

  type Hit = {
    coll: string;
    count: number;
    fields: Map<string, number>;
    universeIds: Set<string>;
    creators: Set<string>;
    sample: string[];
  };
  const hits: Hit[] = [];

  for (const coll of collections) {
    const snap = await db.collection(coll).get();
    let count = 0;
    const fields = new Map<string, number>();
    const universeIds = new Set<string>();
    const creators = new Set<string>();
    const sample: string[] = [];

    for (const doc of snap.docs) {
      const data = doc.data();
      const json = JSON.stringify(data);
      const m = json.match(PINATA_RX);
      if (!m) continue;
      count++;

      // walk fields to find which keys host the urls
      const walk = (v: any, p: string) => {
        if (typeof v === 'string' && PINATA_RX.test(v)) {
          fields.set(p, (fields.get(p) ?? 0) + 1);
          PINATA_RX.lastIndex = 0;
        } else if (Array.isArray(v)) {
          v.forEach((x, i) => walk(x, `${p}[${i}]`));
        } else if (v && typeof v === 'object') {
          for (const k of Object.keys(v)) walk(v[k], p ? `${p}.${k}` : k);
        }
      };
      walk(data, '');

      const uid =
        (data as any).universeId ||
        (data as any).universeAddress ||
        (data as any).universe_id ||
        '';
      if (uid) universeIds.add(String(uid).toLowerCase());

      const cr =
        (data as any).creator ||
        (data as any).owner ||
        (data as any).author ||
        (data as any).userId ||
        '';
      if (cr) creators.add(String(cr).toLowerCase());

      if (sample.length < 2) sample.push(`${doc.id}: ${m[0].slice(0, 90)}`);
    }

    if (count > 0) hits.push({ coll, count, fields, universeIds, creators, sample });
  }

  console.log('──────────── COLLECTIONS WITH PINATA/IPFS URLS ────────────\n');
  for (const h of hits) {
    console.log(`\n${h.coll}  (${h.count} docs with pinata/ipfs urls)`);
    const topFields = [...h.fields.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    console.log(`  fields:    ${topFields.map(([k, v]) => `${k}=${v}`).join('  ')}`);
    console.log(
      `  universeIds (${h.universeIds.size}): ${[...h.universeIds].slice(0, 5).join(', ')}${h.universeIds.size > 5 ? ' …' : ''}`
    );
    console.log(
      `  creators (${h.creators.size}):     ${[...h.creators].slice(0, 5).join(', ')}${h.creators.size > 5 ? ' …' : ''}`
    );
    console.log(`  sample:    ${h.sample[0]}`);
  }

  // Cross-reference universes
  console.log('\n──────────── PER-UNIVERSE ROLLUP ────────────');
  const uSnap = await db.collection('cinematicUniverses').get();
  const universes = uSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));

  for (const u of universes) {
    const addr = (u.address || u.id || '').toLowerCase();
    if (!addr) continue;
    const refs: Record<string, number> = {};
    for (const h of hits) {
      if (h.universeIds.has(addr)) refs[h.coll] = (refs[h.coll] ?? 0) + 1;
    }
    if (Object.keys(refs).length === 0) continue;
    console.log(
      `  ${(u.name || '(unnamed)').padEnd(28)} ${addr.slice(0, 10)}…  ${Object.entries(refs)
        .map(([k, v]) => `${k}:${v}`)
        .join(' ')}`
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
