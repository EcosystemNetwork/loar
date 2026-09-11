/**
 * Seed wiki entities for "Space Fleet" — 44 entities, well-rounded across
 * kinds, but the synopsis's own headline claim ("first-contact protocols
 * already in use with seven alien civilizations") has ZERO species, zero
 * alien factions, zero first-contact event, anywhere in the wiki. Fills that
 * specific gap: two of the seven civilizations, the treaty framework, the
 * secret division that manages it, the actual first-contact event, a
 * recovered alien artifact, and the deep-space outpost where it all happens.
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
const UNIVERSE_ADDR = '0x228295466c531c1d55b9dfdd5cf15ad0b88782fa';
const AUTH_CHAIN = detectAuthChain(rawKey) as AuthChain;
const NANO_BANANA_MODEL = 'nano-banana-pro-google';

const STYLE =
  'SPACE FLEET visual key — a secret interstellar armada hidden behind a modest public space program, revealed through a leaked-footage / found-footage lens. ' +
  'Photoreal cinematic frame, mix of clean classified-briefing lighting and grainy leaked-camcorder texture, anamorphic flare on the space material. ' +
  'Palette: matte military grey and void black for the classified world, warm desert and stage-light amber for the Earth-side conspiracy thread, cold blue-white for anything alien. ' +
  'Recurring motifs: redacted document stamps, government-issue monitors, vast real starfields, alien technology that reads as elegant and slightly wrong rather than monstrous. ' +
  'No on-image text, no captions, no watermark, no logo, no UI chrome.';

const KIND_FRAMING: Record<string, string> = {
  species:
    'a documentary-style first-contact-file creature/being study, dramatic but respectful, cold clean light',
  lore: 'a single striking symbolic still-life or classified-document tableau, grounded and photographable',
  faction: 'a command/operations tableau in a real interior, insignia understated',
  event: 'wide cinematic tableau of the moment itself, epic first-contact scale',
  thing:
    'a hero render of the artifact under classified-lab lighting, fine detail, slightly uncanny',
  place:
    'vast establishing shot, extreme sense of scale, volumetric light, one small structure for reference',
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
    name: 'The Vantessi',
    kind: 'species',
    description:
      'The first of the seven alien civilizations to make sanctioned contact with humanity — tall, slow-moving, silicate-skinned beings from a system eleven light-years out, whose entire diplomatic strategy has been patience measured in decades. The Vantessi initiated the Seven Accords and have never once raised their communication priority level, which the UEG has come to find more unsettling than a threat would be.',
    visual:
      'A tall slender humanoid figure with faintly luminous silicate-textured skin standing in a sterile classified briefing chamber, motionless, human personnel at a respectful distance, cold clean light.',
    aspect: 'square_hd',
  },
  {
    name: 'The Korrathi Swarm',
    kind: 'species',
    description:
      'A decentralized insectoid civilization operating as a distributed hive-consensus rather than individuals — one of the seven, and the only one the UEG maintains an active deterrence posture against. The Korrathi have never attacked, but their scout clusters probe the outer colonies on a rotating schedule precise enough that Aerospace Logistics Command has stopped calling it curiosity.',
    visual:
      'A tight cluster of chitinous insectoid forms moving in perfect synchronized formation against a starfield, articulated limbs catching cold light, a single human-scale warship silhouette for terrifying scale comparison.',
    aspect: 'landscape_16_9',
  },
  {
    name: 'The Seven Accords',
    kind: 'lore',
    description:
      "The classified treaty framework governing humanity's relations with all seven contacted civilizations — drafted, renegotiated, and enforced entirely outside public knowledge by the Xenowatch Division. Each Accord is customized to its species; the Vantessi Accord runs eleven pages, the Korrathi Accord runs four hundred and is still being amended. Cover Story Protocols exist specifically to keep the Accords' existence, let alone their contents, from ever reaching a Congressional hearing.",
    visual:
      "A heavy classified binder stack on a steel table under a single desk lamp, each binder spine labeled with a different redacted species designation, a security officer's hand resting on the stack.",
    aspect: 'square_hd',
  },
  {
    name: 'Xenowatch Division',
    kind: 'faction',
    description:
      'The secret UEG department that actually manages alien relations — smaller, older, and several clearance tiers above Aerospace Logistics Command, which believes itself to be the senior authority on interstellar affairs and is deliberately allowed to keep believing that. Xenowatch personnel do not appear on any organizational chart Eli Vance has ever had access to, which is exactly the kind of gap that got him looking in the first place.',
    visual:
      'A windowless command room ringed with monitors showing seven different classified species dossiers, a handful of senior officers in plain dark suits reviewing them, no visible insignia.',
    aspect: 'landscape_16_9',
  },
  {
    name: 'First Contact — Proxima Relay',
    kind: 'event',
    description:
      "The actual first-contact event, decades before the show's present day — a Vantessi vessel approaching the Proxima Relay Station at a velocity and trajectory calculated, the UEG later determined, specifically to be non-threatening in every measurable way. The full recording remains the single most classified file in Aerospace Logistics Command's archive; the version Eli eventually finds is missing eleven minutes, and everyone he asks about the gap changes the subject the same practiced way.",
    visual:
      'A remote deep-space relay station bathed in stark work-lights, a slow-approaching alien vessel silhouette lit only by its own running lights, station crew frozen at viewport windows.',
    aspect: 'landscape_16_9',
  },
  {
    name: 'The Vantessi Beacon',
    kind: 'thing',
    description:
      "A recovered piece of Vantessi communication hardware, roughly fist-sized, that has been under continuous study since First Contact and still does something Aerospace Logistics Command's own engineers cannot fully explain: it activates faintly whenever another Vantessi vessel enters the system, before any sensor array detects the approach. Project Orpheus's classified research track exists largely to reverse-engineer what the Beacon already does by instinct.",
    visual:
      'A fist-sized artifact of impossibly smooth dark material resting on a containment pedestal in a sterile lab, a faint internal blue-white glow pulsing softly, monitoring equipment surrounding it at a respectful distance.',
    aspect: 'square_hd',
  },
  {
    name: 'Interceptor-Class Scout',
    kind: 'vehicle',
    description:
      "The fast, lightly-armed scout-class vessel that shadows Korrathi probe clusters at the edge of colonized space — smaller and faster than an Orpheus-Class Warship, built for observation and retreat rather than engagement, because Aerospace Logistics Command's standing doctrine is that no one fires the first shot of a war against a hive mind by accident.",
    visual:
      'A sleek, minimal-profile scout warship banking hard against a starfield, running lights dim for stealth, a distant cluster of small alien probe-ships visible far in the background.',
    aspect: 'landscape_16_9',
  },
  {
    name: 'Proxima Relay Station',
    kind: 'place',
    description:
      "The deep-space outpost where First Contact actually happened, quietly upgraded over the decades into the UEG's primary xenodiplomatic listening post — publicly, it does not exist; the cover story places its supposed sensor function on one of the three declared orbital stations instead. Every Accord renewal happens here, by species that never quite arrive or leave at the same time as any logged departure.",
    visual:
      'A large utilitarian deep-space relay station against a dense starfield, docking arms extended, a faint blue-white shimmer of an unidentified vessel just visible near one bay, work-lights along the hull.',
    aspect: 'landscape_16_9',
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
  console.log('  Space Fleet — alien first-contact wiki seed');
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
