/**
 * Build a universe's world in 3D through the live API (Tripo, via tripo.*).
 *
 * For each --universe:
 *   models        modelable entities (person/species/thing/vehicle/technology)
 *                 with cover art but no 3D model → tripo.batchEntityTo3D
 *   --puppets     characters/species with a cover but no puppet → characterPuppet
 *   --environments places with a cover but no environment → placeEnvironment
 *
 * This is also how to restore the ~118 entities whose Meshy models expired
 * (see the 2026-09-06 media purge) — they show up as "no model" here.
 *
 * Runs as the signer, so generation is billed to the SIGNER's own Tripo key
 * (BYOK — add it at /settings/api-keys first). Batch generation is
 * universe-manager only; puppets/environments need entity-manager rights.
 * Resume-safe: re-running skips anything that already has its 3D. Waits for
 * each wave of jobs to settle before starting the next (Tripo concurrency).
 *
 * Usage:
 *   PRIVATE_KEY=<owner> pnpm tsx scripts/backfill-world-3d.ts --universe=<addr>            # dry run
 *   PRIVATE_KEY=<owner> pnpm tsx scripts/backfill-world-3d.ts --prod --universe=<addr> --commit [--puppets] [--environments]
 *
 * Flags: --universe=<addr> (repeatable, required)  --commit  --limit=N (per universe, default 25)
 *        --quality=hifi|game  --puppets  --environments  --chain=evm|solana  --prod
 * Env:   PRIVATE_KEY (required), SERVER_URL, WEB_ORIGIN, CHAIN_ID, SOLANA_CLUSTER
 * Cost:  ~$0.40 per model, ~$1.20 per puppet, ~$0.30 per environment (Tripo list prices).
 */
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { resolveAuth, detectAuthChain, type AuthChain, type SolanaCluster } from './lib/wiki-auth';

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const val = (f: string) => args.find((x) => x.startsWith(`${f}=`))?.slice(f.length + 1);
const UNIVERSES = args.filter((x) => x.startsWith('--universe=')).map((x) => x.slice(11));

const rawKey = process.env.PRIVATE_KEY ?? '';
if (!rawKey) {
  console.error('PRIVATE_KEY is required — the universe owner key (its Tripo key pays).');
  process.exit(1);
}
if (UNIVERSES.length === 0) {
  console.error('Scope required: pass one or more --universe=<addr>.');
  process.exit(1);
}

const PROD = has('--prod');
const SERVER_URL = (
  process.env.SERVER_URL ??
  (PROD ? 'https://api.loar.fun' : undefined) ??
  process.env.VITE_SERVER_URL ??
  'http://localhost:3000'
).replace(/\/$/, '');
const WEB_ORIGIN = (
  process.env.WEB_ORIGIN ?? (PROD ? 'https://loar.fun' : 'http://localhost:5173')
).replace(/\/$/, '');
const DRY_RUN = !has('--commit');
const LIMIT = val('--limit') ? Number(val('--limit')) : 25;
const QUALITY = val('--quality') === 'game' ? 'game' : 'hifi';
const PUPPETS = has('--puppets');
const ENVIRONMENTS = has('--environments');
const WAVE = 5;

const MODELABLE = ['person', 'species', 'thing', 'vehicle', 'technology'];
const PUPPETABLE = ['person', 'species'];
const ENV_KINDS = ['place', 'realm', 'plane', 'dimension'];

async function trpc<T>(kind: 'query' | 'mutation', proc: string, input: unknown, token: string) {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const res =
    kind === 'query'
      ? await fetch(
          `${SERVER_URL}/trpc/${proc}?batch=1&input=${encodeURIComponent(JSON.stringify({ '0': input }))}`,
          { headers }
        )
      : await fetch(`${SERVER_URL}/trpc/${proc}?batch=1`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ '0': input }),
        });
  const json = (await res.json()) as any[];
  if (json[0]?.error)
    throw new Error(`tRPC ${proc}: ${JSON.stringify(json[0].error).slice(0, 400)}`);
  return json[0]?.result?.data as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll jobs until none is running; returns per-status counts. */
async function settle(jobIds: string[], token: string) {
  const done = new Map<string, string>();
  while (done.size < jobIds.length) {
    await sleep(10_000);
    for (const id of jobIds) {
      if (done.has(id)) continue;
      const job = await trpc<any>('query', 'tripo.getJob', { jobId: id }, token).catch(() => null);
      if (job && job.status !== 'running') {
        done.set(id, job.status);
        const tail = job.status === 'failed' ? ` — ${job.failureReason}` : '';
        console.log(`    ${job.status.padEnd(9)} ${job.kind} ${job.entityId}${tail}`);
      }
    }
  }
  const counts: Record<string, number> = {};
  for (const s of done.values()) counts[s] = (counts[s] ?? 0) + 1;
  return counts;
}

async function main() {
  const auth = await resolveAuth({
    serverUrl: SERVER_URL,
    webOrigin: WEB_ORIGIN,
    privateKey: rawKey,
    chain: (val('--chain') ?? detectAuthChain(rawKey)) as AuthChain,
    evmChainId: Number(process.env.CHAIN_ID ?? '11155111'),
    solanaCluster: (process.env.SOLANA_CLUSTER ?? 'mainnet-beta') as SolanaCluster,
  });
  console.log(
    `signer ${auth.evmAddress ?? auth.address} → ${SERVER_URL}${DRY_RUN ? '  [DRY RUN — pass --commit to generate]' : ''}`
  );

  for (const universeId of UNIVERSES) {
    const rows = await trpc<any[]>('query', 'tripo.worldOverview', { universeId }, auth.token);
    const noModel = rows.filter((r) => MODELABLE.includes(r.kind) && r.imageUrl && !r.modelUrl);
    const noPuppet = rows.filter((r) => PUPPETABLE.includes(r.kind) && r.imageUrl && !r.puppet);
    const noEnv = rows.filter((r) => ENV_KINDS.includes(r.kind) && r.imageUrl && !r.environment);
    console.log(
      `\n${universeId}: ${rows.length} world entities — ${noModel.length} need models` +
        `, ${noPuppet.length} could get puppets, ${noEnv.length} places need environments`
    );
    for (const r of noModel.slice(0, LIMIT))
      console.log(`  • model  ${r.kind.padEnd(10)} ${r.name}`);
    if (PUPPETS)
      for (const r of noPuppet.slice(0, LIMIT))
        console.log(`  • puppet ${r.kind.padEnd(10)} ${r.name}`);
    if (ENVIRONMENTS)
      for (const r of noEnv.slice(0, LIMIT))
        console.log(`  • env    ${r.kind.padEnd(10)} ${r.name}`);
    if (DRY_RUN) continue;

    // Models — server picks the next batch itself; loop until done or capped.
    let started = 0;
    while (started < Math.min(LIMIT, noModel.length)) {
      const res = await trpc<{ jobs: Array<{ jobId: string }>; remaining: number }>(
        'mutation',
        'tripo.batchEntityTo3D',
        { universeId, quality: QUALITY, limit: Math.min(WAVE, LIMIT - started) },
        auth.token
      );
      if (!res.jobs.length) break;
      started += res.jobs.length;
      console.log(`  models wave: ${res.jobs.length} started (${res.remaining} remaining)`);
      console.log(
        '   ',
        await settle(
          res.jobs.map((j) => j.jobId),
          auth.token
        )
      );
    }

    const runEach = async (
      label: string,
      proc: string,
      list: any[],
      input: (r: any) => unknown
    ) => {
      for (let i = 0; i < Math.min(LIMIT, list.length); i += WAVE) {
        const ids: string[] = [];
        for (const r of list.slice(i, Math.min(i + WAVE, LIMIT))) {
          try {
            const { jobId } = await trpc<{ jobId: string }>('mutation', proc, input(r), auth.token);
            ids.push(jobId);
          } catch (err) {
            console.log(`    skip ${label} ${r.name}: ${(err as Error).message.slice(0, 160)}`);
          }
        }
        if (ids.length) console.log(`  ${label} wave:`, await settle(ids, auth.token));
      }
    };
    if (PUPPETS) {
      await runEach('puppet', 'tripo.characterPuppet', noPuppet, (r) => ({
        entityId: r.id,
        rigType: r.kind === 'person' ? 'biped' : 'quadruped',
      }));
    }
    if (ENVIRONMENTS) {
      await runEach('environment', 'tripo.placeEnvironment', noEnv, (r) => ({ entityId: r.id }));
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
