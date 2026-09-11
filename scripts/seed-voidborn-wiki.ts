/**
 * Seed wiki entities for "Voidborn Saga" — 16 entities, exactly one per
 * structural/creator kind, but missing its own protagonist: the synopsis
 * names Sable as the Voidborn who must choose to rewrite reality, and she
 * was never made into an entity. Adds her, the antagonist pressuring her
 * toward entropy, the forbidden magic itself, and the crisis clock.
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
const UNIVERSE_ADDR = '0x89669812f850f34f907ee9e9009f501d1b008420';
const AUTH_CHAIN = detectAuthChain(rawKey) as AuthChain;
const NANO_BANANA_MODEL = 'nano-banana-pro-google';

const STYLE =
  'VOIDBORN SAGA visual key — dark-fantasy dimensional-collapse space opera. ' +
  'Photoreal cinematic frame, epic scale, dramatic void-lit atmosphere, fine grain. ' +
  'Palette: void black shot through with dark-matter violet and static-white rift light, ash and obsidian, a fading warm gold for what is being erased. ' +
  'Recurring motifs: reality fraying at the edges into starfield static, memory rendered as dissolving light, cracks that show another dimension through them. ' +
  'No on-image text, no captions, no watermark, no logo, no UI chrome.';

const KIND_FRAMING: Record<string, string> = {
  person:
    'cinematic environmental portrait, three-quarter, shallow depth of field, motivated dramatic key light',
  lore: 'a single mythic symbolic image, grounded enough to photograph, quietly dreadful',
  place:
    'wide establishing shot, extreme scale, one small figure for reference, volumetric void-light',
  event: 'wide cinematic tableau of the moment itself, catastrophic scale',
  technology: 'a hero render of the device, motivated glow, fine detail, no legible UI text',
  faction: 'a group tableau reading a shared doctrine and posture, dramatic void-lit atmosphere',
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
    name: 'Sable',
    kind: 'person',
    description:
      'A Voidborn — a being forged from dark matter who remembers every universe that has ever died — and the one who must decide whether to let entropy finish the job or rewrite the laws of physics with forbidden narrative code. Sable is old beyond any mortal frame of reference and speaks like someone permanently one memory short of a full sentence, because every story she writes to save something costs her one of her own. She has already forgotten why she started.',
    visual:
      'Sable: a tall humanoid figure whose skin is patterned like slow-moving starfield static, eyes two points of steady violet light, wrapped in a coat that fades to transparency at its edges. Standing at the fracture-line of a collapsing dimension, one hand raised, mid-unwritten sentence.',
    aspect: 'square_hd',
  },
  {
    name: 'Null-Cantor',
    kind: 'person',
    description:
      "A rival Voidborn who believes entropy is mercy, not defeat — that a universe allowed to collapse cleanly suffers less than one kept alive by forbidden code and the theft of someone's memory to pay for it. Null-Cantor does not oppose Sable out of malice; he genuinely believes he is trying to save her from herself, one erased dimension at a time, and he may be right.",
    visual:
      'Null-Cantor: a gaunt Voidborn whose form is more absence than presence, edges dissolving into black static rather than starfield, standing perfectly still at the mouth of a slowly closing rift, arms open in invitation rather than threat.',
    aspect: 'square_hd',
  },
  {
    name: 'Forbidden Narrative Code',
    kind: 'lore',
    description:
      "The story-magic at the center of the saga: language structured with enough internal truth and consequence that reality itself accepts it as a rewrite. Any being can attempt it; only a Voidborn can survive casting it more than once, and even they pay — every story written erases one of the caster's own memories, chosen not by them but by whatever the story needed to be true. Sable has forgotten, among other things, her own true name.",
    visual:
      'A sentence of glowing violet script hanging in mid-air over a fracturing dimension, physically reshaping the stars behind it as it is spoken, one word at the end of the sentence visibly dissolving into static as the caster loses it.',
    aspect: 'square_hd',
  },
  {
    name: 'The Memory Wake',
    kind: 'place',
    description:
      'A trail of slow-fading golden light that forms in the Void Between wherever Sable has erased one of her own memories casting narrative code — a physical scar of forgetting that others can walk into and, briefly, relive a fragment of what she lost. The Archivist Order maps every Wake obsessively, since it is the only record left of a memory Sable herself no longer has.',
    visual:
      "A faint trailing ribbon of warm golden light drifting through the black-violet Void Between like a comet's tail, slowly dimming, a lone small figure reaching toward it from a distance.",
    aspect: 'landscape_16_9',
  },
  {
    name: 'The Fracture Countdown',
    kind: 'event',
    description:
      "The saga's ticking clock: the last stable dimension, Prime Material, has begun to fracture along the same pattern that preceded the Fall of Ashenmire, and the Archivist Order estimates total collapse within a span too short to argue about — only to spend. Every faction in the Ashlands is reacting to the same countdown in a different way: hoarding, fleeing, praying, or, in Sable's case, writing.",
    visual:
      'A vast cracking sky over the Ashlands, fault lines of white rift-light spreading slowly across the black-violet heavens like breaking glass, scattered small silhouettes fleeing below.',
    aspect: 'landscape_16_9',
  },
  {
    name: 'The First Erasure',
    kind: 'event',
    description:
      "The moment Sable first used forbidden narrative code — to save a dying dimension from a Fall like Ashenmire's — and lost the first of her own memories as payment, before she understood the cost or that it was permanent. Kael Duskbane, who witnessed it, is the only living being who can tell her what she wrote and what she gave up to write it, and he has not yet decided whether telling her would be a kindness.",
    visual:
      'A wide dim tableau: a glowing dimension stabilizing and going calm in the background while in the foreground a Voidborn figure staggers, one hand to her own temple, a wisp of golden light drifting away from her unnoticed.',
    aspect: 'landscape_16_9',
  },
  {
    name: 'Story-Anchors',
    kind: 'technology',
    description:
      "Devices built by the Archivist Order in a doomed attempt to record what narrative code erases — crystalline recorders that can capture the shape of a memory\'s absence, if not its content, so that a Voidborn who has lost something can at least know that they lost it, and roughly what it cost. No Story-Anchor has ever recovered an actual memory. The Order keeps building them anyway.",
    visual:
      "A faceted dark crystal recorder mounted on an ornate stand, a faint outline-shaped absence of light hovering above it where a memory should be, an Archivist's gloved hand adjusting a dial beside it.",
    aspect: 'square_hd',
  },
  {
    name: 'The Rift Cartel',
    kind: 'faction',
    description:
      "Opportunists and smugglers who treat the widening instability of the Ashlands as a resource rather than a catastrophe — mining unstable rifts for void-crystal, trafficking in dimension-fragments, and selling passage through the Void Between to anyone desperate enough to pay the Rift Market's prices. They have no stake in whether Sable succeeds, so long as the collapse takes long enough to profit from first.",
    visual:
      "A rough band of scavengers in patched void-resistant gear loading crated void-crystal onto a battered vessel at the edge of a glowing unstable rift, the Ashlands' orange scar-light behind them.",
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
  console.log('  Voidborn Saga — wiki seed');
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
