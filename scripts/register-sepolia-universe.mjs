import { initializeApp, cert, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import path from 'path';
import dotenv from 'dotenv';
const ROOT = process.env.LOAR_ROOT || process.cwd();
dotenv.config({ path: path.resolve(ROOT, '.env') });

const SCR = process.argv[2];
const APPLY = process.argv.includes('--apply');
const brand = JSON.parse(readFileSync(SCR + '/brand.json', 'utf8'));

const ADDRESS = '0x95245242e1e26b8c7d92fd8e4e9274dde600f7d4';   // doc id = lowercase address
const CREATOR = '0x80baf7fffc430cdaced4f1d673f4138d6d493077';
const ZERO    = '0x0000000000000000000000000000000000000000';
const TX      = '0x7030cfdee522d5fdcc72eb28275ab81cc3caafbc56a893f161499d8383949202';

if (process.env.FIRESTORE_EMULATOR_HOST) {
  console.log(`(ignoring FIRESTORE_EMULATOR_HOST=${process.env.FIRESTORE_EMULATOR_HOST})`);
  delete process.env.FIRESTORE_EMULATOR_HOST;
}
let credential;
try {
  const p = path.resolve(ROOT, process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? '');
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
                                                  : JSON.parse(readFileSync(p, 'utf8'));
  credential = /local-emulator/.test(String(sa.client_email)) ? applicationDefault() : cert(sa);
} catch { credential = applicationDefault(); }
const db = getFirestore(getApps()[0] ?? initializeApp({ credential, projectId: 'loar-db' }));
db.settings({ preferRest: true });

const doc = {
  address: ADDRESS,
  creator: CREATOR,
  name: brand.name,
  description: brand.description,
  image_url: brand.image_url,
  portrait_image_url: null,
  // No token yet: deployUniverseToken requires LoarHookStaticFee, which is not
  // deployed on Sepolia. The universe works without it; EGG can be added later.
  tokenAddress: ZERO,
  governanceAddress: ZERO,
  onChainUniverseId: 3,
  mintTxHash: TX,
  unstoppableDomain: null,
  chainId: 11155111,
  hasPrivateSection: true,
  isMultiSig: false,
  multiSigAddress: null,
  accessModel: 'open',
  universeType: 'monetized',
  isPrivate: false,
  migratedFrom: '0x38f1e8b9c2d31f163fbfcbb9638de959fedcb964',
  migratedFromChainId: 84532,
  created_at: new Date(),
  updated_at: new Date(),
};

const ref = db.collection('cinematicUniverses').doc(ADDRESS);
const existing = await ref.get();
console.log(`  target doc exists: ${existing.exists}`);
console.log(`  name : ${doc.name}`);
console.log(`  chain: ${doc.chainId}  onChainId: ${doc.onChainUniverseId}`);
if (!APPLY) { console.log('\n  dry run — re-run with --apply'); process.exit(0); }
await ref.set(doc, { merge: true });
console.log('  WROTE cinematicUniverses/' + ADDRESS);
