/**
 * Seed wiki entities for "Monerochan: Untraceable" — already well-rounded
 * (32 entities across every major kind), but missing the connective mythos
 * pieces: how internet meme-culture became Monerochan's origin religion, a
 * physical founder-relic, the Dead-Drop Network's actual courier hardware,
 * a named Panopticon antagonist, a "legal" surveillance bureaucracy distinct
 * from the Panopticon Authority, a specific failed-raid event, and the
 * technical/philosophical doctrine behind ring-signature anonymity sets.
 *
 * entities.create only needs a signed-in wallet, so it runs on the .env
 * Solana key (createdBy = that key, so entities.update/covers work on them).
 *
 * --dry-run (default) prints the plan. --commit creates them, then (unless
 * --no-covers) draws a nano-banana-pro cover for each. Resume-safe.
 */
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
import { resolveAuth, detectAuthChain, type AuthChain } from './lib/wiki-auth';

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const DRY_RUN = !has('--commit');
const DO_COVERS = !has('--no-covers');

const rawKey = process.env.PRIVATE_KEY ?? '';
const SERVER_URL = 'https://api.loar.fun';
const WEB_ORIGIN = 'https://loar.fun';
const UNIVERSE_ADDR = '0x0000000000000000000000000000019d9e1c8a49';
const AUTH_CHAIN = detectAuthChain(rawKey) as AuthChain;
const NANO_BANANA_MODEL = 'nano-banana-pro-google';

const STYLE =
  'MONEROCHAN visual key — neon-drenched surveillance dystopia versus underground cypherpunk resistance. ' +
  'Photoreal cinematic frame, heavy rain and neon reflection for the surveilled city, warm holographic-blockchain green-gold glow underground. ' +
  'Palette: cold panopticon blue-grey and camera-red above ground, warm privacy-green and gold below. ' +
  'Recurring motifs: giant surveillance-eye iconography, ring-signature diagrams rendered like sacred geometry, hooded silhouettes, ' +
  'a small glowing chan-culture mascot figure treated with genuine reverence rather than irony. ' +
  'No on-image text, no captions, no watermark, no logo, no UI chrome.';

const KIND_FRAMING: Record<string, string> = {
  lore: 'a single striking symbolic still-life, mysterious and cinematic, grounded and photoreal',
  thing: 'a reverent hero shot of the relic, dramatic lighting, shallow depth of field',
  vehicle: 'the vehicle in its element, dramatic angle, sense of stealth and speed',
  event: 'wide cinematic tableau of the moment itself, decisive-moment framing',
  person:
    'cinematic environmental portrait, three-quarter, shallow depth of field, motivated key light',
  organization:
    'a bureaucratic operations tableau in a real institutional interior, cold even light',
};

interface Seed {
  name: string;
  kind: string;
  description: string;
  visual: string;
  aspect: 'square_hd' | 'landscape_16_9';
}

const SEEDS: Seed[] = [
  {
    name: 'The Genesis Meme',
    kind: 'lore',
    description:
      'The origin mythology the Cypherpunk Collective actually tells its youngest recruits — that Monerochan was not coded but summoned, the way an old imageboard drawing gets posted so many times by so many anonymous hands that it stops belonging to any of them and starts belonging to everyone, which is, the Collective argues, the entire point of what she protects. Whether this is literal or metaphorical is a debate The Fungibility Front refuses to settle on principle.',
    visual:
      'A wall of stacked, layered, endlessly reposted low-resolution drawings of the same small green figure, overlapping like sedimentary rock, a single clean glowing version emerging faintly from the center of the pile.',
    aspect: 'square_hd',
  },
  {
    name: "The Founder's Cold Wallet",
    kind: 'thing',
    description:
      "A physical hardware wallet, deliberately primitive, kept in the Hidden Server Room and never once connected to any network since the night of the Birth of Monerochan. It is said to hold the very first coins ever moved through a ring signature, and the Cypherpunk Collective's unofficial rule is that whoever eventually needs to move them will already know why, and no one has needed to yet.",
    visual:
      'A small worn USB-sized hardware wallet resting on dark velvet in a glass case, a single soft green LED blinking steadily, surrounded by candle-like holographic light in an otherwise dark server room.',
    aspect: 'square_hd',
  },
  {
    name: 'The Courier Bike',
    kind: 'vehicle',
    description:
      "The Dead-Drop Network's signature piece of hardware — a modified electric courier bike stripped of every trackable component, its frame doubling as an air-gapped data mule for physically ferrying encrypted drives between dead-drop points the Panopticon Authority's Red Eye Drone Network cannot legally search without a warrant it will never get in time.",
    visual:
      'A stripped-down matte-black electric courier bike leaning against a rain-slicked alley wall at night, no visible branding or plates, a hidden compartment in the frame just barely ajar, neon reflections in the puddles.',
    aspect: 'landscape_16_9',
  },
  {
    name: 'Warden Ilse Kade',
    kind: 'person',
    description:
      "Director Clearview's most effective field enforcer within the Panopticon Authority — methodical, unglamorous, and personally responsible for three of the Cypherpunk Collective's worst losses. Kade does not believe in Monerochan as myth or menace; she treats the whole resistance as a logistics problem with a solvable error rate, which is exactly why Agent Prism considers her more dangerous than Clearview himself.",
    visual:
      'Warden Ilse Kade: 40s, severe grey Panopticon uniform, close-cropped hair, standing in a rain-lit command vehicle doorway reviewing a printed surveillance report, utterly unhurried.',
    aspect: 'square_hd',
  },
  {
    name: 'The KYC Compliance Bureau',
    kind: 'organization',
    description:
      "The 'legal' half of the surveillance state — a bureaucratic financial-compliance agency that does through paperwork, audits, and account freezes what the Panopticon Authority does through drones and raids. Less feared than the Panopticon on the street, more feared by anyone with savings, since a Bureau flag can end a life without a single officer ever showing up.",
    visual:
      'A grey institutional office of endless cubicles under fluorescent light, a wall-sized screen displaying anonymized account-freeze statistics ticking upward, a clerk stamping a form without looking up.',
    aspect: 'landscape_16_9',
  },
  {
    name: 'The Midnight Raid',
    kind: 'event',
    description:
      "The Panopticon Authority's largest and most humiliating failure — a coordinated assault on the Hidden Server Room's suspected location that found the room exactly where Agent Prism said it would be, and completely empty, scrubbed down to the drywall, six hours before the doors were breached. Clearview has never been able to prove there was a leak, which the Cypherpunk Collective finds funnier than actually having one.",
    visual:
      'A tactical team breaching a stripped-bare underground room with flashlights and rifles raised, dust still settling, absolutely nothing left behind except bare concrete and one faint smudge of green graffiti on the wall.',
    aspect: 'landscape_16_9',
  },
  {
    name: 'The Ring Size Doctrine',
    kind: 'lore',
    description:
      "The technical and philosophical core of Ring Signatures explained as scripture: a transaction hidden among a ring of eleven decoys is not lying about who sent it, it is simply true about all eleven at once, and truth distributed evenly across many is what the Collective calls fungibility, and what the Panopticon Authority calls the crime. Whisper is said to have written the clearest layperson's version of the Doctrine, though she has never confirmed it.",
    visual:
      'Eleven identical glowing figures standing in a perfect circle, each one holding an identical small object, no way to tell by looking which one is the "real" holder, soft green sacred-geometry light connecting them.',
    aspect: 'square_hd',
  },
];

function log(step: string, msg: string) {
  console.log(`[${step}] ${msg}`);
}
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
function buildPrompt(s: Seed): string {
  const framing = KIND_FRAMING[s.kind] ?? 'cinematic concept still, grounded and photoreal';
  return [s.visual, framing + '.', STYLE].join(' ');
}

async function tRPCMutate<T>(procedure: string, input: unknown, token: string): Promise<T> {
  const res = await fetch(`${SERVER_URL}/trpc/${procedure}?batch=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ '0': input }),
  });
  const json = (await res.json()) as any[];
  if (json[0]?.error)
    throw new Error(`tRPC ${procedure}: ${JSON.stringify(json[0].error).slice(0, 400)}`);
  return json[0]?.result?.data;
}

async function tRPCQuery<T>(procedure: string, input: unknown, token: string): Promise<T> {
  const url = `${SERVER_URL}/trpc/${procedure}?batch=1&input=${encodeURIComponent(
    JSON.stringify({ '0': input })
  )}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const json = (await res.json()) as any[];
  if (json[0]?.error)
    throw new Error(`tRPC ${procedure}: ${JSON.stringify(json[0].error).slice(0, 400)}`);
  return json[0]?.result?.data;
}

async function genImage(prompt: string, token: string, imageSize: string): Promise<string | null> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await tRPCMutate<{ imageUrls?: string[] }>(
        'image.generate',
        {
          prompt,
          task: 'text_to_image',
          imageSize,
          numImages: 1,
          routingMode: 'manual',
          selectedModelId: NANO_BANANA_MODEL,
          allowFallback: true,
          useWikiContext: false,
          universeId: UNIVERSE_ADDR,
        },
        token
      );
      const url = r?.imageUrls?.[0] ?? null;
      if (url) console.log(`      image ok: ${url.slice(0, 80)}…`);
      return url;
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      if (/429|rate.?limit/i.test(msg) && attempt < 3) {
        await sleep(4000 * attempt);
        continue;
      }
      console.log(`      image gen failed: ${msg.slice(0, 160)}`);
      return null;
    }
  }
  return null;
}

async function main() {
  console.log('═'.repeat(64));
  console.log('  Monerochan — wiki seed');
  console.log('═'.repeat(64));
  console.log(`  entities : ${SEEDS.length}`);
  console.log(
    `  mode     : ${DRY_RUN ? 'DRY RUN' : 'COMMIT'}${DO_COVERS ? ' + covers' : ' (no covers)'}`
  );

  if (DRY_RUN) {
    for (const s of SEEDS)
      console.log(`\n• ${s.name} (${s.kind})\n  ${s.description.slice(0, 110)}…`);
    console.log('\n(dry run — nothing created)');
    return;
  }

  log('AUTH', 'authenticating (SIWS)…');
  const auth = await resolveAuth({
    serverUrl: SERVER_URL,
    webOrigin: WEB_ORIGIN,
    privateKey: rawKey,
    chain: AUTH_CHAIN,
    solanaCluster: 'mainnet-beta',
  });
  log('AUTH', `signer: ${auth.address}`);

  const existing = await tRPCQuery<{ entities: any[] }>(
    'entities.list',
    { universeAddress: UNIVERSE_ADDR, limit: 200 },
    auth.token
  );
  const byName = new Map<string, any>(
    (existing?.entities ?? []).map((e) => [String(e.name).toLowerCase(), e])
  );

  for (const s of SEEDS) {
    console.log(`\n• ${s.name} (${s.kind})`);
    let entityId: string;
    let hasCover: boolean;
    const found = byName.get(s.name.toLowerCase());
    if (found) {
      entityId = found.id;
      hasCover = !!found.imageUrl;
      log('skip', `exists id=${entityId}${hasCover ? ' (has cover)' : ' (no cover)'}`);
    } else {
      const created = await tRPCMutate<{ id: string }>(
        'entities.create',
        {
          name: s.name,
          description: s.description,
          kind: s.kind,
          universeAddress: UNIVERSE_ADDR,
          monetized: false,
        },
        auth.token
      );
      entityId = created.id;
      hasCover = false;
      log('create', `id=${entityId}`);
    }

    if (DO_COVERS && !hasCover) {
      const url = await genImage(buildPrompt(s), auth.token, s.aspect);
      if (url) {
        await tRPCMutate('entities.update', { entityId, imageUrl: url }, auth.token);
        log('cover', `updated ${s.name}`);
      }
    }
    await sleep(1500);
  }
  console.log('\nDONE');
}

main().catch((err) => {
  console.error('FAILED:', err?.message ?? err);
  process.exit(1);
});
