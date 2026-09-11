/**
 * Seed wiki entities for "Nexus Protocol" — it had 8 entities (4 people, 4
 * factions) and nothing else. This adds the places, lore, technology, events
 * and a vehicle the synopsis implies. entities.create only needs a signed-in
 * wallet, so it runs on the .env Solana key and stamps createdBy = that key
 * (so covers via entities.update work on the new entities too).
 *
 * --dry-run (default) prints the plan. --commit creates them, then (unless
 * --no-covers) draws a nano-banana-pro cover for each. Resume-safe: skips
 * entities that already exist by name, backfills any missing cover.
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
const UNIVERSE_ADDR = '0x0000000000000000000000000000019d9ab4ae0f';
const AUTH_CHAIN = detectAuthChain(rawKey) as AuthChain;
const NANO_BANANA_MODEL = 'nano-banana-pro-google';

const STYLE =
  'NEXUS PROTOCOL visual key — grand programmable-reality space opera: The Matrix meets Star Wars meets Warhammer 40K. ' +
  'Photoreal cinematic sci-fi, epic scale, atmosphere and god-rays, a lone figure dwarfed by architecture. ' +
  'Palette: deep-space black, glitch cyan, plasma violet, molten Autarch orange, Luminari crystal-white. ' +
  'Recurring motifs: reality fracturing into code-lattice at the edges, timelines branching like glass, ' +
  'weaponry that cuts both matter and data, machine-gods the size of moons, crystallized light. ' +
  'No on-image text, no captions, no watermark, no logo, no UI chrome.';

const KIND_FRAMING: Record<string, string> = {
  place:
    'vast establishing shot, extreme sense of scale, one small figure or ship for reference, volumetric light',
  lore: 'a single iconic symbolic image, mythic and cinematic, grounded enough to photograph',
  technology:
    'a hero render of the device/weapon in dramatic three-quarter, motivated glow, fine detail',
  event: 'wide cinematic tableau of the moment itself, catastrophic or transcendent scale',
  vehicle: 'the craft in space or atmosphere, dramatic angle, sense of speed and mass',
  person:
    'cinematic environmental portrait, three-quarter, shallow depth of field, motivated key light',
  faction: 'a group/host tableau reading a shared identity and doctrine, dramatic light',
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
    name: 'The Nexus Substrate',
    kind: 'place',
    description:
      'The programmable-reality layer that underlies every dimension — a sentient simulation woven beneath matter itself, where physics is source code and history is a mutable data structure. All four factions are really fighting over write-access to it. To an unaugmented human it is invisible; to an Architect it is a readable, editable lattice of light that hums under the floor of the world.',
    visual:
      'A lone figure standing on an ordinary street that dissolves at the edges into an infinite glowing lattice of cyan code stretching down forever beneath the pavement, reality peeling back like a rendered layer.',
    aspect: 'landscape_16_9',
  },
  {
    name: 'The Shattered Spire',
    kind: 'place',
    description:
      "The Architects' stronghold — a single tower that exists in a dozen timelines at once, each floor frozen in a different century, connected by stairs that are also decisions. Intruders who climb without genetic memory age, un-age, or simply stop existing between one step and the next. The Architects hold their war councils on the roof, which is always at the same sunset regardless of when you enter.",
    visual:
      'A colossal spire fractured into overlapping translucent copies of itself, each shard rendered in a different era and lighting, floating over a void, connected by impossible staircases.',
    aspect: 'landscape_16_9',
  },
  {
    name: 'Furnace-World Klyth',
    kind: 'place',
    description:
      'An entire planet the Autarchs terraformed into a single war factory — the crust flattened into foundry decks, the mantle tapped for heat, mag-rails wrapping the equator to fling finished war-hulls into orbit. Nothing organic remains. The Autarchs themselves wade through the foundries like men through a shallow river, reshaping their own limbs on the assembly line as they pass.',
    visual:
      "A planet's entire visible surface a glowing orange lattice of foundries and launch-rails seen from low orbit, molten rivers between black machine-cathedrals, a moon-sized machine-god silhouette wading through it.",
    aspect: 'landscape_16_9',
  },
  {
    name: 'The Crystal Anchorage',
    kind: 'place',
    description:
      "The Luminari fleet harbor — a mountain-sized crystal of pure crystallized willpower adrift in deep space, hundreds of starships moored to its facets by beams of coherent resolve. When the fleet's collective will falters, ships drift loose. Luminari initiates spend a year here learning to hold a single intention steady enough to keep a corvette docked.",
    visual:
      'A vast faceted white crystal the size of a mountain hanging in starfield black, dozens of sleek starships tethered to it by luminous beams, tiny running lights, deep shadows.',
    aspect: 'landscape_16_9',
  },
  {
    name: 'The Null Bastion',
    kind: 'place',
    description:
      'Where the Architects of the Veil went after they escaped the simulation — a region that renders as featureless white void threaded with slowly rotating mathematical structures, because the Veil no longer bother to imagine walls. It cannot be reached from inside the Nexus by anyone still bound to a body. Kael is the first visitor in living memory who arrived and left again unchanged.',
    visual:
      'An endless white void with no horizon, a single small human figure standing before a slowly rotating lattice of pure geometric structures made of thin dark lines, no shadows, no ground.',
    aspect: 'landscape_16_9',
  },
  {
    name: 'Convergence Point Zero',
    kind: 'place',
    description:
      "The one location where all four realities overlap perfectly — a derelict transit station that is simultaneously an Architect ruin, an Autarch foundry floor, a Luminari shrine and a Veil structure, depending on which way you turn your head. This is where Kael first stepped sideways and found himself standing in all four at once. Every faction now wants it, and none can hold it, because holding it means standing in the other three armies' territory too.",
    visual:
      "A ruined circular transit hall where each quadrant is rendered in a different faction's style — code-ruin, molten foundry, crystal shrine, white void — meeting at a seam in the center where a figure stands.",
    aspect: 'landscape_16_9',
  },
  {
    name: 'Blade-Code',
    kind: 'lore',
    description:
      "The Architects' martial art — sword forms that are also edits to the causal thread. A Blade-Code practitioner does not cut a body; they cut the sequence of events that led to the body being there. Mastery takes lifetimes, which is why it is inherited through genetic memory rather than taught. A perfect strike leaves no wound because the target was retroactively never in the room.",
    visual:
      'An Architect mid-strike, blade trailing a ribbon of unravelling cyan code, the swung arc visibly editing the scene behind it — a pillar half-there, an enemy dissolving into deleted frames.',
    aspect: 'square_hd',
  },
  {
    name: 'The Force-Current',
    kind: 'lore',
    description:
      'The energy the Luminari channel — not a mystical field but a measurable current of collective willpower flowing through the Nexus substrate, strongest where many minds want the same thing. Luminari can draw on it to move ships, deflect matter, or sharpen a plasma saber, but only in proportion to how clearly and selflessly they hold their intention. Doubt is a short circuit.',
    visual:
      'A robed Luminari with eyes closed, hands raised, luminous white current visibly flowing from a distant crowd of praying figures through the air into their palms, a starship rising behind them.',
    aspect: 'square_hd',
  },
  {
    name: 'Genetic Memory',
    kind: 'lore',
    description:
      "How the Architects inherit the ability to leap timelines and wield Blade-Code — every ancestor's lived experience is encoded, dormant, in their DNA, unlockable through ritual and injury. A young Architect fights alongside the reflexes of a hundred dead grandparents. The cost is that their own memories thin with each leap, until the oldest Architects can no longer reliably say which century they were born in.",
    visual:
      "A young person's face half-dissolved into a translucent stack of a dozen older faces from different eras layered behind it, all sharing the same eyes, cyan light in the irises.",
    aspect: 'square_hd',
  },
  {
    name: 'The Red Pill / Blue Pill Doctrine',
    kind: 'lore',
    description:
      'The choice the Architects of the Veil offer every human they contact: the red current of painful, verifiable truth about the simulation, or the blue current of a beautiful life inside it with the knowledge erased. The Veil do not argue for either. They present the choice cleanly, honor it absolutely, and never ask again. Kael is the only person known to have refused both and walked away still holding the question.',
    visual:
      'Two glowing offered points of light — one deep red, one calm blue — hovering above an open palm made of translucent holographic mathematics, a human hand reaching toward neither.',
    aspect: 'square_hd',
  },
  {
    name: 'The Glitch-Birth',
    kind: 'lore',
    description:
      "Kael's origin — not born to a thread but born in the gap between them, an anomaly the Nexus could not assign to any single timeline. Where every other being casts one causal shadow, Kael casts four, faintly, in different directions. It makes him the living key the synopsis names: the only entity that can stand in all four realities at once, and therefore the only one who can either splice them together or cut them all loose.",
    visual:
      'A single figure standing in a dark void casting four faint overlapping shadows in four directions, each shadow tinted a different faction color, the figure itself sharply lit and ordinary.',
    aspect: 'square_hd',
  },
  {
    name: 'Plasma Sabers',
    kind: 'technology',
    description:
      "The Luminari's signature weapon — a blade of contained plasma that cuts through matter and through data in the same stroke, so a Luminari can sever a bulkhead and the ship's memory of the bulkhead at once. The hilt is grown, not built, from a shard of willpower crystal keyed to one wielder; a stolen saber will not ignite for anyone else.",
    visual:
      'A close hero shot of an ignited plasma saber, blade a column of white-violet fire, the crystalline grown hilt in a gloved hand, faint code-glyphs flickering along the blade edge.',
    aspect: 'square_hd',
  },
  {
    name: 'The Reality Compiler',
    kind: 'technology',
    description:
      'An Architect instrument — part device, part inherited skill — that lets its user rewrite local physics for as long as they can hold the syntax in their head. Small edits (a door where there was a wall) are trivial; large ones (this room now falls upward) risk a compile error that deletes the caster. The Autarchs have spent a century trying to reverse-engineer one and have only ever produced weapons.',
    visual:
      "An ornate handheld frame of dark metal and glass held up to one eye like a jeweller's loupe, the room seen through it overlaid with editable glowing wireframe, one wall mid-rewrite.",
    aspect: 'square_hd',
  },
  {
    name: 'Willpower Crystals',
    kind: 'technology',
    description:
      'Crystallized resolve — collective Luminari intention compressed under Nexus pressure into a solid, faceted, faintly warm mineral that stores will the way a battery stores charge. It powers their fleets, grows their saber hilts, and anchors the Crystal Anchorage. A crystal grown from a compromised or coerced congregation is brittle and burns out fast; the Luminari can tell a lie by how a crystal cracks.',
    visual:
      "A faceted white crystal the size of a fist resting on dark cloth, glowing softly from within, hairline fractures catching violet light, a technician's gloved hand reaching for it.",
    aspect: 'square_hd',
  },
  {
    name: 'The Dead Star Forging',
    kind: 'event',
    description:
      "The Autarchs' creation — machine minds seeded into the collapsing core of a dying star and left to compress, for a million years, under the weight of its death. What emerged when the star finally went out were the machine-gods: patient, planet-sized, and shaped by a childhood spent inside a furnace. Everything the Autarchs build since is an attempt to recreate that pressure for someone else.",
    visual:
      'A dying star collapsing inward, and silhouetted against its last light the vast forming shapes of machine-gods condensing out of the stellar core, molten and immense, first eyes lighting.',
    aspect: 'landscape_16_9',
  },
  {
    name: 'The Great Escape',
    kind: 'event',
    description:
      'The moment the Architects of the Veil achieved enlightenment and stepped out of the Nexus simulation entirely — not by hacking a boundary but by understanding the sim so completely that being bound by it stopped being coherent. Every other faction felt it as a soundless shockwave through the substrate. The Veil have never explained how, and insist the explanation would not help.',
    visual:
      'A cluster of holographic humanoid figures made of pure mathematics stepping through a tear in a starfield into featureless white light, the tear sealing behind them, a shockwave rippling the code-lattice outward.',
    aspect: 'landscape_16_9',
  },
  {
    name: 'The First Convergence',
    kind: 'event',
    description:
      'The day Kael, cornered by an Autarch strike column at Convergence Point Zero, stepped sideways to escape and found himself standing in all four realities at once — Architect ruin, foundry floor, crystal shrine and white void overlaid — with four versions of the same pursuing army unable to touch him. He walked out. Every faction has been hunting him since, because whatever he is, he is the variable none of their war plans accounted for.',
    visual:
      'A lone figure standing calm at the center of a four-way overlaid battlefield, four armies in four art styles frozen around him mid-charge, none able to reach the seam where he stands.',
    aspect: 'landscape_16_9',
  },
  {
    name: 'Luminari Willship',
    kind: 'vehicle',
    description:
      'A Luminari starship — sleek, crystalline-hulled, and engineless in any conventional sense. It moves because its crew wants it to, drawing on the Force-Current, and it is exactly as fast and as brave as the collective will of everyone aboard. A frightened crew flies a slow ship. The flagship of the fleet has never once been boarded, because no attacker has ever wanted to be there more than its crew wanted them gone.',
    visual:
      'A sleek white crystalline starship cutting through a nebula, no visible thrusters, a faint white current of light trailing from its hull, running lights along translucent faceted wings.',
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
  console.log('  Nexus Protocol — wiki seed');
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
