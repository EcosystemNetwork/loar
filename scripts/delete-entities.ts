/**
 * Delete wiki entities by id. Signs in with either an EVM or a Solana key
 * (see scripts/lib/wiki-auth.ts) and calls entities.delete for each id —
 * only the entity creator can delete, and an entity with children fails.
 *
 * Env:
 *   PRIVATE_KEY      (required) EVM or Solana key of the entities' creator.
 *   ENTITY_IDS       comma-separated ids (or pass them as CLI args).
 *   AUTH_CHAIN       evm | solana (default: auto-detect from key shape).
 *   SOLANA_CLUSTER   SIWS cluster (default: mainnet-beta).
 *   SERVER_URL       tRPC base (default: VITE_SERVER_URL or http://localhost:3000).
 *   WEB_ORIGIN       SIWx domain + Origin header (default: http://localhost:5173).
 *
 * Usage:
 *   pnpm tsx scripts/delete-entities.ts id1 id2 id3
 *   SERVER_URL=https://api.loar.fun WEB_ORIGIN=https://loar.fun \
 *     ENTITY_IDS=id1,id2 pnpm tsx scripts/delete-entities.ts
 */
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { resolveAuth, type AuthChain, type SolanaCluster } from './lib/wiki-auth';

const rawKey = process.env.PRIVATE_KEY ?? '';
if (!rawKey) {
  console.error('PRIVATE_KEY is required (the wallet that created the entities).');
  process.exit(1);
}

const SERVER_URL = (
  process.env.SERVER_URL ??
  process.env.VITE_SERVER_URL ??
  'http://localhost:3000'
).replace(/\/$/, '');
const WEB_ORIGIN = (process.env.WEB_ORIGIN ?? 'http://localhost:5173').replace(/\/$/, '');
const AUTH_CHAIN = (process.env.AUTH_CHAIN?.toLowerCase() || undefined) as AuthChain | undefined;
const SOLANA_CLUSTER = (process.env.SOLANA_CLUSTER ?? 'mainnet-beta') as SolanaCluster;

const ids = [
  ...process.argv.slice(2),
  ...(process.env.ENTITY_IDS ?? '').split(',').map((s) => s.trim()),
].filter(Boolean);

if (ids.length === 0) {
  console.error('No entity ids given. Pass them as CLI args or ENTITY_IDS=a,b,c.');
  process.exit(1);
}

async function tRPCMutate(procedure: string, input: unknown, token: string): Promise<unknown> {
  const res = await fetch(`${SERVER_URL}/trpc/${procedure}?batch=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ '0': input }),
  });
  const json = (await res.json()) as Array<{ error?: unknown; result?: { data?: unknown } }>;
  if (json[0]?.error) {
    throw new Error(`${procedure}: ${JSON.stringify(json[0].error).slice(0, 300)}`);
  }
  return json[0]?.result?.data;
}

async function main() {
  const auth = await resolveAuth({
    serverUrl: SERVER_URL,
    webOrigin: WEB_ORIGIN,
    privateKey: rawKey,
    chain: AUTH_CHAIN,
    solanaCluster: SOLANA_CLUSTER,
  });
  console.log(
    `auth: ${auth.chain} ${auth.address}${auth.evmAddress ? ` -> linked EVM ${auth.evmAddress}` : ''}`
  );
  console.log(`server: ${SERVER_URL}`);
  console.log(`deleting ${ids.length} entit${ids.length === 1 ? 'y' : 'ies'}\n`);

  let ok = 0;
  for (const id of ids) {
    try {
      await tRPCMutate('entities.delete', { entityId: id }, auth.token);
      console.log(`  deleted ${id}`);
      ok++;
    } catch (err) {
      console.log(`  FAILED ${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log(`\ndone — ${ok}/${ids.length} deleted`);
}

main().catch((err) => {
  console.error('FAILED:', err?.message ?? err);
  process.exit(1);
});
