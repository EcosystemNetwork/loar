import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import dotenv from 'dotenv';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
const execFileAsync = promisify(execFile);

async function main() {
  const sa = JSON.parse(readFileSync('firebase-sa-key-20260416.json', 'utf-8'));
  const app = getApps()[0] || initializeApp({ credential: cert(sa) });
  const db = getFirestore(app);
  db.settings({ preferRest: true });

  const snap = await db
    .collection('content')
    .where('universeId', '==', '0x0000000000000000000000000000019d9e26795c')
    .limit(3)
    .get();

  for (const doc of snap.docs) {
    const d = doc.data() as any;
    console.log(`\n═══ ${doc.id} ═══`);
    console.log(`mediaType: ${d.mediaType}`);
    console.log(`mediaUrl:  ${d.mediaUrl}`);
    console.log(`contentStatus: ${d.contentStatus || 'active'}`);

    // HEAD the URL
    const urlWithToken = new URL(d.mediaUrl);
    if (process.env.PINATA_GATEWAY_TOKEN) {
      urlWithToken.searchParams.set('pinataGatewayToken', process.env.PINATA_GATEWAY_TOKEN);
    }
    const headRes = await fetch(urlWithToken.toString(), { method: 'HEAD' });
    console.log(
      `HEAD: ${headRes.status} ct=${headRes.headers.get('content-type')} len=${headRes.headers.get('content-length')}`
    );

    // Try ffmpeg probe
    try {
      const { stdout, stderr } = await execFileAsync(
        'ffprobe',
        [
          '-v',
          'error',
          '-print_format',
          'json',
          '-show_streams',
          '-show_format',
          '-protocol_whitelist',
          'https,tls,tcp',
          urlWithToken.toString(),
        ],
        { timeout: 30000 }
      );
      const info = JSON.parse(stdout);
      const video = info.streams?.find((s: any) => s.codec_type === 'video');
      console.log(
        `ffprobe: codec=${video?.codec_name} duration=${info.format?.duration}s format=${info.format?.format_name}`
      );
    } catch (err) {
      console.log(`ffprobe FAILED: ${(err as Error).message.slice(0, 150)}`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
