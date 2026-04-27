/**
 * Dump every wiki entity for the two ZAI-regen target universes so the
 * operator can pick which to use as the video scene seed + image portraits.
 * Read-only.
 */
import dotenv from 'dotenv';
import path from 'path';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const TARGETS = [
  { addr: '0x228295466c531c1d55b9dfdd5cf15ad0b88782fa', label: 'Space Fleet' },
  { addr: '0x8e5cddb763534fe426766e4eb035449fb9e73913', label: 'The Vacation Bunny Universe' },
  { addr: '0x341ffa19c0ec8d2c8ef42a360cf799949844262e', label: 'Cyber War' },
  { addr: '0x89669812f850f34f907ee9e9009f501d1b008420', label: 'Voidborn Saga' },
  { addr: '0x38f1e8b9c2d31f163fbfcbb9638de959fedcb964', label: 'Dragon Egg' },
  { addr: '0x36a903899f51096e8a59d5bee018966c995888c1', label: 'E Combonator' },
  { addr: '0x0000000000000000000000000000019d9ab4ae0f', label: 'Nexus Protocol' },
];

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

  for (const t of TARGETS) {
    const snap = await db.collection('entities').where('universeAddress', '==', t.addr).get();
    const ents = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
    ents.sort((a, b) => {
      // group by kind, then by name
      if (a.kind !== b.kind) return String(a.kind).localeCompare(String(b.kind));
      return String(a.name || '').localeCompare(String(b.name || ''));
    });

    console.log(`\n══════════════ ${t.label} (${ents.length} entities) ══════════════`);
    let curKind = '';
    for (const e of ents) {
      if (e.kind !== curKind) {
        curKind = e.kind;
        console.log(`\n── ${curKind.toUpperCase()} ──`);
      }
      const desc = String(e.description || '')
        .replace(/\s+/g, ' ')
        .slice(0, 140);
      const hasImg = e.imageUrl ? '🖼' : '  ';
      console.log(`  ${hasImg}  ${e.name}`);
      if (desc) console.log(`        ${desc}${desc.length === 140 ? '…' : ''}`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
