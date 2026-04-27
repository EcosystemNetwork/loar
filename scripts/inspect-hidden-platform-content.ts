/**
 * Read-only: for the four universes whose platform content is mass-hidden
 * (Dostopia, Fogline, Voidborn, Cyber War) plus Nexus Protocol's 8 hidden
 * legacy docs:
 *   - Show distinct contentStatusUpdatedBy values (who hid them?)
 *   - Show hiddenAt / hiddenReason / moderationNotes if any
 *   - Probe a sample mediaUrl per universe to see if media is reachable
 *   - Check if any flag docs reference these contentIds
 *   - Check if any contentAuditLog rows exist for them
 */
import dotenv from 'dotenv';
import path from 'path';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const PINATA_TOKEN = process.env.PINATA_GATEWAY_TOKEN || '';

function authedUrl(raw: string): string {
  if (!raw) return raw;
  try {
    const u = new URL(raw);
    if (
      /\.mypinata\.cloud$/i.test(u.host) &&
      PINATA_TOKEN &&
      !u.searchParams.has('pinataGatewayToken')
    ) {
      u.searchParams.set('pinataGatewayToken', PINATA_TOKEN);
      return u.toString();
    }
  } catch {}
  return raw;
}

async function probe(rawUrl: string): Promise<{ ok: boolean; status?: number; ct?: string }> {
  if (!rawUrl) return { ok: false };
  try {
    const r = await fetch(authedUrl(rawUrl), { method: 'HEAD', redirect: 'follow' });
    return { ok: r.ok, status: r.status, ct: r.headers.get('content-type') ?? undefined };
  } catch {
    return { ok: false };
  }
}

async function main() {
  const existing = getApps()[0];
  let db;
  if (existing) {
    db = getFirestore(existing);
  } else {
    const sa = JSON.parse(
      readFileSync(
        process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? 'firebase-sa-key-20260416.json',
        'utf-8'
      )
    );
    const app = initializeApp({ credential: cert(sa) });
    db = getFirestore(app);
    db.settings({ preferRest: true });
  }

  const targetUniverses: string[] = [];
  const unisSnap = await db.collection('cinematicUniverses').get();
  for (const d of unisSnap.docs) {
    const data = d.data() as any;
    const name = String(data.name || '');
    if (
      [
        'Dostopia: The Iron Faith',
        'Fallout: Fogline',
        'Voidborn Saga',
        'Cyber War',
        'Nexus Protocol',
      ].includes(name)
    ) {
      const addr = (data.address || data.id || d.id || '').toLowerCase();
      targetUniverses.push(addr);
    }
  }

  const HIDDEN = new Set(['flagged', 'under_review', 'hidden', 'removed']);

  for (const uid of targetUniverses) {
    const uname =
      unisSnap.docs
        .find((d) => (d.data().address || d.data().id || d.id || '').toLowerCase() === uid)
        ?.data().name ?? '(?)';
    console.log(`\n══════ ${uname}  ${uid} ══════`);

    // Pull all hidden content for this universe
    const cSnap = await db.collection('content').where('universeId', '==', uid).get();
    const hidden = cSnap.docs.filter((d) => {
      const data = d.data() as any;
      const vis = data.visibility === 'public';
      const ok = !HIDDEN.has(data.contentStatus);
      return !(vis && ok);
    });
    console.log(`  Hidden content count: ${hidden.length}`);
    if (hidden.length === 0) continue;

    const updaters = new Map<string, number>();
    const reasons = new Map<string, number>();
    const hiddenAtSamples: string[] = [];
    let withGenerationId = 0;
    let withMediaUrl = 0;
    for (const d of hidden) {
      const data = d.data() as any;
      const u = String(data.contentStatusUpdatedBy ?? '(none)');
      updaters.set(u, (updaters.get(u) ?? 0) + 1);
      const r = String(data.hiddenReason ?? data.moderationNotes ?? '(none)');
      reasons.set(r, (reasons.get(r) ?? 0) + 1);
      if (data.contentStatusUpdatedAt && hiddenAtSamples.length < 3) {
        const ts = data.contentStatusUpdatedAt?.toDate?.() ?? data.contentStatusUpdatedAt;
        hiddenAtSamples.push(String(ts));
      }
      if (data.generationId) withGenerationId++;
      if (data.mediaUrl) withMediaUrl++;
    }
    console.log('  contentStatusUpdatedBy distribution:');
    for (const [k, v] of [...updaters.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${k}  ${v}`);
    }
    console.log('  hiddenReason / moderationNotes distribution:');
    for (const [k, v] of [...reasons.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${k}  ${v}`);
    }
    console.log('  hiddenAt samples:', hiddenAtSamples);
    console.log(`  with generationId: ${withGenerationId}/${hidden.length}`);
    console.log(`  with mediaUrl:     ${withMediaUrl}/${hidden.length}`);

    // Probe up to 5 sample URLs
    console.log('  URL probes (first 5 with mediaUrl):');
    let probed = 0;
    for (const d of hidden) {
      if (probed >= 5) break;
      const data = d.data() as any;
      if (!data.mediaUrl) continue;
      const result = await probe(data.mediaUrl);
      console.log(
        `    ${d.id.slice(0, 16)}  ${data.mediaType ?? '(no-mt)'}  status=${
          result.status ?? 'err'
        }  ct=${result.ct?.slice(0, 22) ?? ''}  url=${String(data.mediaUrl).slice(0, 70)}`
      );
      probed++;
    }

    // Check for related flag/audit-log docs
    const sampleIds = hidden.slice(0, 10).map((d) => d.id);
    const flagPromises = sampleIds.map((id) =>
      db.collection('flags').where('contentId', '==', id).limit(1).get()
    );
    const auditPromises = sampleIds.map((id) =>
      db.collection('contentAuditLog').where('contentId', '==', id).limit(1).get()
    );
    const flagResults = await Promise.all(flagPromises);
    const auditResults = await Promise.all(auditPromises);
    const flagsForSamples = flagResults.filter((s) => !s.empty).length;
    const auditsForSamples = auditResults.filter((s) => !s.empty).length;
    console.log(
      `  Sample audit-trail (10 hidden items): flags=${flagsForSamples}, contentAuditLog=${auditsForSamples}`
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
