/**
 * Backfill character profiles for existing `person` wiki entities.
 *
 * Seeded characters are just a description + cover; the structured dossier the
 * wiki page renders (role, appearance, personality, backstory, …) is empty.
 * This calls `entities.completeCharacterProfile` for each character in scope,
 * which asks Gemini for ONLY the still-empty fields (using the entity's own
 * description and filled fields as canon) and never overwrites anything already
 * written. Resume-safe: re-running skips characters that are already complete.
 *
 * completeCharacterProfile is creator-gated, so the signing key must be the
 * entity's creator, and it is capped at 20 AI profile generations per user per
 * hour — the script stops cleanly when it hits the cap; run it again later.
 * Generation uses the signer's Google key (BYOK) — the server 503s without one.
 *
 * Usage:
 *   PRIVATE_KEY=<creator> pnpm tsx scripts/backfill-character-profiles.ts --universe=<addr>          # dry run (default)
 *   PRIVATE_KEY=<creator> pnpm tsx scripts/backfill-character-profiles.ts --prod --universe=<addr> --commit
 *
 * Flags: --universe=<addr> (repeatable, required; case-sensitive for Solana PDAs)
 *        --commit  actually write   --limit=N  cap characters   --only=Str  name filter
 *        --chain=evm|solana   --prod  (SERVER_URL=https://api.loar.fun WEB_ORIGIN=https://loar.fun)
 * Env:   PRIVATE_KEY (required), SERVER_URL, WEB_ORIGIN, CHAIN_ID, SOLANA_CLUSTER
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
  console.error('PRIVATE_KEY is required — the key that created the target characters.');
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
const LIMIT = val('--limit') ? Number(val('--limit')) : Infinity;
const ONLY = val('--only')?.toLowerCase();

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

async function listPeople(universeId: string, token: string) {
  const out: any[] = [];
  let cursor: string | undefined;
  do {
    const page = await trpc<{ entities: any[]; nextCursor?: string }>(
      'query',
      'entities.list',
      { universeAddress: universeId, kind: 'person', limit: 200, cursor },
      token
    );
    out.push(...(page?.entities ?? []));
    cursor = page?.nextCursor;
  } while (cursor);
  return out.filter((e) => e.kind === 'person');
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
  const signer = (auth.evmAddress ?? auth.address).toLowerCase();
  console.log(
    `signer ${signer} → ${SERVER_URL}${DRY_RUN ? '  [DRY RUN — pass --commit to write]' : ''}`
  );

  let touched = 0;
  let filled = 0;
  let stopped = false;

  for (const universeId of UNIVERSES) {
    let people = await listPeople(universeId, auth.token);
    if (ONLY) people = people.filter((e) => String(e.name).toLowerCase().includes(ONLY));
    console.log(`\n${universeId}: ${people.length} character(s)`);

    for (const e of people) {
      if (touched >= LIMIT || stopped) break;
      const profile = await trpc<any>(
        'query',
        'entities.characterProfile',
        { entityId: e.id },
        auth.token
      );
      const { percent, missing } = profile.completeness;
      const mine = String(e.creator ?? '').toLowerCase() === signer;
      const status =
        missing.length === 0
          ? 'complete'
          : !mine
            ? 'not creator — skipped'
            : `${percent}%, ${missing.length} missing`;
      console.log(`  • ${String(e.name).padEnd(32)} ${status}`);
      if (missing.length === 0 || !mine) continue;

      touched++;
      if (DRY_RUN) continue;
      try {
        const res = await trpc<{ added: string[] }>(
          'mutation',
          'entities.completeCharacterProfile',
          { entityId: e.id },
          auth.token
        );
        filled += res.added.length;
        console.log(`      + ${res.added.length} field(s): ${res.added.join(', ')}`);
      } catch (err: any) {
        const msg = String(err?.message ?? err);
        console.log(`      ✗ ${msg.slice(0, 200)}`);
        if (/rate limit/i.test(msg)) {
          console.log(
            '\nHit the hourly AI-generation cap — re-run later; finished characters are skipped.'
          );
          stopped = true;
        }
      }
    }
  }

  console.log(
    `\nDONE — ${touched} character(s) ${DRY_RUN ? 'would be completed' : `completed, ${filled} field(s) written`}.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
