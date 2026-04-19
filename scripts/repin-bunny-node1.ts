/**
 * One-shot: re-pin Vacation Bunny node 1 to IPFS and set an off-chain media
 * override so the frontend renders the fresh URL.
 *
 * Why off-chain: the bunny Universe at 0x8e5c...73913 was deployed before
 * setMedia was opened to the original creator — its deployed bytecode gates
 * setMedia on `onlyAdmin`, where admin is the Governor contract. Fixing the
 * on-chain event would require a governance proposal. The off-chain override
 * collection (nodeMediaOverrides) lets the admin patch a dead link without
 * touching the immutable content hash. Readers (useUniverseBlockchain) prefer
 * override → indexer → on-chain hash, so once the override lands the UI shows
 * the refreshed video immediately.
 *
 * Usage: pnpm tsx scripts/repin-bunny-node1.ts
 */
import dotenv from 'dotenv';
import path from 'path';
import { readFileSync } from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import admin from 'firebase-admin';

const PINATA_JWT = process.env.PINATA_JWT!;
const PINATA_GATEWAY =
  process.env.PINATA_GATEWAY_URL ?? 'https://peach-impressive-moth-978.mypinata.cloud';
const FIREBASE_SERVICE_ACCOUNT = process.env.FIREBASE_SERVICE_ACCOUNT;
const FIREBASE_SERVICE_ACCOUNT_PATH = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

const UNIVERSE_ADDR = '0x8e5cDdb763534Fe426766e4eB035449fB9e73913'.toLowerCase();
const NODE_ID = 1;
const VIDEO_PATH = path.resolve(process.cwd(), 'vacation-bunny-output/final/S01.mp4');
const REASON =
  'Node 1 was originally minted with a 24h-signed Seedance URL; re-pinning the final render to IPFS after the signature expired.';

if (!PINATA_JWT) throw new Error('PINATA_JWT missing');
if (!FIREBASE_SERVICE_ACCOUNT && !FIREBASE_SERVICE_ACCOUNT_PATH) {
  throw new Error('FIREBASE_SERVICE_ACCOUNT or FIREBASE_SERVICE_ACCOUNT_PATH required');
}

function loadServiceAccount(): admin.ServiceAccount {
  if (FIREBASE_SERVICE_ACCOUNT) return JSON.parse(FIREBASE_SERVICE_ACCOUNT);
  return JSON.parse(readFileSync(path.resolve(FIREBASE_SERVICE_ACCOUNT_PATH!), 'utf-8'));
}

async function pin(buf: Buffer): Promise<string> {
  const form = new FormData();
  form.append('file', new Blob([buf], { type: 'video/mp4' }), 'bunny-S01.mp4');
  form.append(
    'pinataMetadata',
    JSON.stringify({ name: 'bunny-S01-repin', keyvalues: { scene: 'S01', universe: 'bunny' } })
  );
  const res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST',
    headers: { Authorization: `Bearer ${PINATA_JWT}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Pinata ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const { IpfsHash } = (await res.json()) as { IpfsHash: string };
  return IpfsHash;
}

async function main() {
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(loadServiceAccount()) });
  }
  const db = admin.firestore();

  // Reuse a pre-pinned CID when provided — avoids re-uploading 3.8MB when the
  // previous pin is still live. Verify with:
  //   curl -sI <gateway>/ipfs/<cid>
  const reuseCid = process.env.REUSE_PIN_CID;
  let videoLink: string;
  if (reuseCid) {
    videoLink = `${PINATA_GATEWAY}/ipfs/${reuseCid}`;
    console.log(`[repin] Reusing existing pin: ${videoLink}`);
  } else {
    const buf = readFileSync(VIDEO_PATH);
    console.log(`[repin] Uploading S01 (${(buf.length / 1024 / 1024).toFixed(1)}MB) to Pinata...`);
    const cid = await pin(buf);
    videoLink = `${PINATA_GATEWAY}/ipfs/${cid}`;
    console.log(`[repin] Pinned: ${videoLink}`);
  }

  const docId = `${UNIVERSE_ADDR}:${NODE_ID}`;
  await db.collection('nodeMediaOverrides').doc(docId).set(
    {
      universeAddress: UNIVERSE_ADDR,
      nodeId: NODE_ID,
      videoLink,
      reason: REASON,
      updatedAt: new Date(),
      updatedBy: 'repin-bunny-node1.ts',
    },
    { merge: true }
  );
  console.log(`[repin] ✔ Firestore override written: nodeMediaOverrides/${docId}`);
}

main().catch((e) => {
  console.error('[repin] FAILED:', e);
  process.exit(1);
});
