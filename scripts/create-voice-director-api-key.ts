/**
 * Issue an API key for the Pipecat voice pipeline service to call LOAR's
 * tRPC backend (director.dispatch / director.executeStoryAction /
 * director.talkToCharacter / lipsync.transcribe / generation.generate)
 * as a server-to-server client, per lib/auth.ts's API-key auth path
 * (X-API-Key or Authorization: Bearer loar_<...>).
 *
 * Signs in as the same identity that owns the seeded demo content
 * (CREATOR_ADDRESS, the Hardhat account #0 key) so ownership checks in
 * offChainNodes.update etc. see the key's caller as the content's creator
 * — a key issued under a different identity would get FORBIDDEN on
 * update_node against Meridian's seeded episodes.
 *
 * Usage:
 *   pnpm tsx scripts/create-voice-director-api-key.ts               # local
 *   SERVER_URL=https://api.loar.fun WEB_ORIGIN=https://loar.fun \
 *     pnpm tsx scripts/create-voice-director-api-key.ts             # prod
 *
 * Prints the raw key once — it is not recoverable after this. Set it as
 * LOAR_API_KEY on the Pipecat Railway service.
 */
import dotenv from 'dotenv';
import path from 'path';
import { resolveAuth } from './lib/wiki-auth';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const SERVER_URL = (
  process.env.SERVER_URL ??
  process.env.VITE_SERVER_URL ??
  'http://localhost:3000'
).replace(/\/$/, '');
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:5173';

// Same Hardhat account #0 key used by the repo's other create-*-universe.ts
// / populate-*-wiki.ts scripts — public well-known test key, not a secret.
const PRIVATE_KEY =
  process.env.PRIVATE_KEY ?? '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

async function tRPCMutate<T>(procedure: string, input: unknown, token: string): Promise<T> {
  const res = await fetch(`${SERVER_URL}/trpc/${procedure}?batch=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ '0': input }),
  });
  const json = (await res.json()) as any[];
  if (json[0]?.error) {
    throw new Error(`tRPC ${procedure}: ${JSON.stringify(json[0].error).slice(0, 400)}`);
  }
  return json[0]?.result?.data;
}

async function main() {
  console.log(`Server: ${SERVER_URL}`);
  const auth = await resolveAuth({
    serverUrl: SERVER_URL,
    webOrigin: WEB_ORIGIN,
    privateKey: PRIVATE_KEY,
    chain: 'evm',
  });
  console.log(`Signed in as: ${auth.address}`);

  const result = await tRPCMutate<{
    rawKey: string;
    keyId: string;
    keyPrefix: string;
    permissions: string[];
  }>(
    'apiKeys.create',
    {
      name: 'voice-director-pipecat',
      permissions: [
        'entities.read',
        'entities.update',
        'universes.read',
        'generation.lipsync',
        'generation.video',
      ],
      rateLimitPerMinute: 120,
    },
    auth.token
  );

  console.log('\n' + '═'.repeat(60));
  console.log('  API KEY CREATED — copy this now, it will not be shown again');
  console.log('═'.repeat(60));
  console.log(`  Key id     : ${result.keyId}`);
  console.log(`  Prefix     : ${result.keyPrefix}`);
  console.log(`  Permissions: ${result.permissions.join(', ')}`);
  console.log(`  Raw key    : ${result.rawKey}`);
  console.log('═'.repeat(60));
  console.log('\n  Set this as LOAR_API_KEY on the Pipecat Railway service.\n');
}

main().catch((err) => {
  console.error('Failed:', err.message ?? err);
  process.exit(1);
});
