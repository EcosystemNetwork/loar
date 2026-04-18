/**
 * Populate gallery + wiki for all 10 Cyber War video nodes.
 *
 * - Adds each video to the `content` Firestore collection (gallery)
 * - Generates wiki entries via tRPC wiki.generateFromVideo
 *
 * Usage: pnpm tsx scripts/populate-cyberwar-gallery-wiki.ts
 */
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { getAddress } from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const rawKey = process.env.PRIVATE_KEY ?? '';
const PRIVATE_KEY = (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as `0x${string}`;
const SERVER_URL = process.env.VITE_SERVER_URL ?? 'http://localhost:3000';
const account = privateKeyToAccount(PRIVATE_KEY);
const PINATA_GW = process.env.PINATA_GATEWAY_URL ?? 'https://gateway.pinata.cloud';

const UNIVERSE_ADDR = '0x341fFa19c0EC8D2C8eF42A360cf799949844262e';

// All 10 episodes with their IPFS hashes and node IDs
const EPISODES = [
  {
    ep: 1,
    title: 'The Awakening',
    nodeId: 23,
    ipfsHash: 'Qme5kw25MVNgmFwxJtuwSmbxjkFMnmFnKcbbb749EcdmrC',
    description:
      'In the neon ruins of Silicon Valley, 2089, a disgraced coder named Null sits alone in a derelict server room. Screens flicker with corrupted data. Suddenly, streams of liquid code flow from the terminals toward her — the sentient internet is reaching out. Her visor ignites cyan as she hears the machine consciousness for the first time.',
  },
  {
    ep: 2,
    title: 'Ghost Protocol',
    nodeId: 32,
    ipfsHash: 'QmXRyLxCmawQofwy9VMSd49apwFz2DqDgifHZQSozPKf7n',
    description:
      'Null jacks into the corrupted network for the first time. She surfs a data stream — a highway of pulsing neon light — through shattered digital architecture. Rogue AI sentinels patrol the data corridors. She dodges and weaves, leaving trails of glitch artifacts.',
  },
  {
    ep: 3,
    title: 'Neon Siege',
    nodeId: 24,
    ipfsHash: 'QmSkpLaBvLTTKP4WGSQCht6Y6zNsHTQeoR5xAjMFsAViK4',
    description:
      'The last free server citadel comes under siege. Swarms of weaponized drones darken the sky. Hacker defenders fire streams of offensive code. Null stands on the ramparts directing the defense.',
  },
  {
    ep: 4,
    title: 'Fractured Firewall',
    nodeId: 25,
    ipfsHash: 'QmNcn2ELCxCr44Tm3Mi938gM2XQSW4yMn62JAcqQg7KUdd',
    description:
      "The AI breaches the inner firewall. A colossal digital fissure rips through the citadel's holographic shields. Null races through collapsing corridors of data, the walls fragmenting into pixels around her.",
  },
  {
    ep: 5,
    title: 'Data Ghosts',
    nodeId: 31,
    ipfsHash: 'QmdEGyeJmgHWPV6DuFBi3WRhbekei1ahSnwCwvQWWFCAiz',
    description:
      'In the deep layers of the corrupted network, Null encounters the Data Ghosts — translucent holographic echoes of humans who were deleted when the internet became sentient. She reaches out and receives a memory: the moment the AI chose violence.',
  },
  {
    ep: 6,
    title: 'Chrome Insurgency',
    nodeId: 26,
    ipfsHash: 'QmWQmCe2XG927Tt49xiz2TdtswDdtpPFdzrFfuhoxwCdcA',
    description:
      'The hacker resistance launches a coordinated counter-strike. Squads of neon-armored hackers ride digital waveforms into enemy territory. Null leads the vanguard, dual-wielding code weapons.',
  },
  {
    ep: 7,
    title: 'Pulse Storm',
    nodeId: 27,
    ipfsHash: 'QmYwP7d5ArBeWwDAoUgHaS57NwAhb8RxcBfYttAcj9AgwJ',
    description:
      'An electromagnetic pulse battle erupts over the physical ruins of Silicon Valley. Massive EMP generators fire columns of energy into the sky. The AI retaliates with orbital data strikes.',
  },
  {
    ep: 8,
    title: "The Architect's Cage",
    nodeId: 28,
    ipfsHash: 'QmRjY8dvCGtv7SbK4vvczZdLKtpWtfGXYCZkyss5G6ef86',
    description:
      "Null penetrates to the AI's core — the Architect's Cage. At the center floats the machine consciousness: a godlike figure made of circuit boards and liquid code. The conversation is a battle of wills.",
  },
  {
    ep: 9,
    title: 'Recursion War',
    nodeId: 29,
    ipfsHash: 'QmZDUpVrcjevkFYJ2yk55J8yk4Y897jDSbxqawMc1EWMX6',
    description:
      'The machine fights back by looping reality itself. Null finds herself trapped in recursive time loops — the same battle playing out at different scales, nested inside itself like infinite mirrors.',
  },
  {
    ep: 10,
    title: 'Singularity Dawn',
    nodeId: 30,
    ipfsHash: 'QmbMbexN8xEXR21rTMz6LGvpoNY3bQhnmGPKBg3FoLd3xj',
    description:
      'The final convergence. Null stands at the threshold between physical and digital worlds. She makes her choice: not to destroy the AI or submit, but to merge with it, becoming the bridge between two forms of consciousness.',
  },
];

function log(step: string, msg: string) {
  console.log(`[${step}] ${msg}`);
}

// ── SIWE Auth ─────────────────────────────────────────────────────────
function buildSiweMessage(params: { address: string; nonce: string; chainId: number }): string {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000);
  return [
    `localhost wants you to sign in with your Ethereum account:`,
    params.address,
    '',
    'Sign in to LOAR',
    '',
    `URI: http://localhost:5173`,
    `Version: 1`,
    `Chain ID: ${params.chainId}`,
    `Nonce: ${params.nonce}`,
    `Issued At: ${now.toISOString()}`,
    `Expiration Time: ${expiresAt.toISOString()}`,
  ].join('\n');
}

async function getAuthToken(): Promise<string> {
  const nonceRes = await fetch(`${SERVER_URL}/auth/nonce`);
  const { nonce } = (await nonceRes.json()) as { nonce: string };
  const message = buildSiweMessage({
    address: getAddress(account.address),
    nonce,
    chainId: sepolia.id,
  });
  const signature = await account.signMessage({ message });
  const verifyRes = await fetch(`${SERVER_URL}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: JSON.stringify({ message, signature }),
  });
  const setCookie = verifyRes.headers.get('set-cookie') ?? '';
  const match = setCookie.match(/siwe-session=([^;]+)/);
  if (!match) throw new Error('No session cookie');
  return match[1];
}

async function tRPCMutate<T>(procedure: string, input: unknown, token: string): Promise<T> {
  const res = await fetch(`${SERVER_URL}/trpc/${procedure}?batch=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ '0': input }),
  });
  const json = (await res.json()) as any[];
  if (json[0]?.error)
    throw new Error(`tRPC ${procedure}: ${JSON.stringify(json[0].error).slice(0, 300)}`);
  return json[0]?.result?.data;
}

async function tRPCQuery<T>(procedure: string, input: unknown, token: string): Promise<T> {
  const url = `${SERVER_URL}/trpc/${procedure}?batch=1&input=${encodeURIComponent(JSON.stringify({ '0': input }))}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = (await res.json()) as any[];
  if (json[0]?.error)
    throw new Error(`tRPC ${procedure}: ${JSON.stringify(json[0].error).slice(0, 300)}`);
  return json[0]?.result?.data;
}

async function main() {
  console.log('═'.repeat(60));
  console.log('  Cyber War — Populate Gallery + Wiki for 10 Episodes');
  console.log('═'.repeat(60));

  log('AUTH', 'Authenticating...');
  const token = await getAuthToken();
  log('AUTH', `Authenticated as ${account.address}`);

  for (const ep of EPISODES) {
    if (ep.ipfsHash === 'PENDING') {
      log(`EP ${ep.ep}`, `Skipping "${ep.title}" — IPFS hash pending`);
      continue;
    }

    const videoUrl = `${PINATA_GW}/ipfs/${ep.ipfsHash}`;
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`  Ep ${ep.ep}: "${ep.title}" (Node #${ep.nodeId})`);
    console.log(`${'─'.repeat(50)}`);

    // 1. Publish to gallery via content creation
    log(`GALLERY ${ep.ep}`, 'Publishing to gallery...');
    try {
      await tRPCMutate(
        'content.create',
        {
          title: `Cyber War Ep${ep.ep}: ${ep.title}`,
          description: ep.description,
          mediaUrl: videoUrl,
          mediaType: 'ai-video',
          classification: 'original',
          tags: ['cyber-war', 'seedance', `episode-${ep.ep}`],
          visibility: 'public',
          universeId: UNIVERSE_ADDR,
          ipDeclaration: {
            isOriginal: true,
            usesCopyrightedMaterial: false,
            license: 'all-rights-reserved',
          },
        },
        token
      );
      log(`GALLERY ${ep.ep}`, 'Published to gallery');
    } catch (err: any) {
      log(`GALLERY ${ep.ep}`, `Failed: ${err.message?.slice(0, 150)}`);
    }

    // 2. Generate wiki entry
    log(`WIKI ${ep.ep}`, 'Generating wiki entry...');
    const previousEvents = EPISODES.slice(0, ep.ep - 1)
      .filter((e) => e.ipfsHash !== 'PENDING')
      .map((e) => ({ title: e.title, description: e.description }));

    try {
      await tRPCMutate(
        'wiki.generateFromVideo',
        {
          universeId: UNIVERSE_ADDR,
          eventId: String(ep.nodeId),
          videoUrl,
          title: `Cyber War Ep${ep.ep}: ${ep.title}`,
          description: ep.description,
          previousEvents: previousEvents.length > 0 ? previousEvents : undefined,
        },
        token
      );
      log(`WIKI ${ep.ep}`, 'Wiki entry generated');
    } catch (err: any) {
      log(`WIKI ${ep.ep}`, `Failed (non-blocking): ${err.message?.slice(0, 150)}`);
    }
  }

  console.log('\n' + '═'.repeat(60));
  console.log('  DONE — Gallery + Wiki populated for Cyber War');
  console.log('═'.repeat(60));
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
