/**
 * Seed wiki entities for "Orange Pills" (0 entities today, despite a full
 * synopsis). entities.create only requires a signed-in wallet — no universe
 * ownership needed — so this runs with the .env Solana key and stamps
 * createdBy = that key, meaning entities.update (covers) works on them too.
 *
 * --dry-run (default) prints the plan. --commit creates them for real, then
 * (unless --no-covers) generates a nano-banana cover for each.
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
const UNIVERSE_ADDR = '0x6c3ae0Be32a7200f73bA59F1FE95eD9e06D15abE';
const AUTH_CHAIN = detectAuthChain(rawKey) as AuthChain;
const NANO_BANANA_MODEL = 'nano-banana-pro-google';

const STYLE =
  'ORANGE PILLS visual key — a quiet crypto-truth-religion prestige drama in failing American cities. ' +
  'Photoreal cinematic frame, 35mm anamorphic, fine grain, mixed practical light (fluorescent office vs. warm candle-and-laptop vigil). ' +
  'Palette: bitcoin orange as a sacred accent against cold institutional grey, warm amber candlelight, cool blue screen-glow. ' +
  'Recurring motifs: open laptops as altars, printed hashes and QR codes treated like scripture, handwritten verification ledgers, ' +
  'a wallet address rendered like a holy sigil. Grounded, real clothes, real rooms — the only "unreal" note is how reverently ordinary ' +
  'objects are lit. No on-image text, no captions, no watermark, no logo, no UI chrome.';

const KIND_FRAMING: Record<string, string> = {
  person:
    'cinematic environmental portrait, chest-up to three-quarter, shallow depth of field, expressive face, motivated practical light',
  place: 'wide establishing shot, real architecture, atmospheric light, no readable signage',
  faction:
    'documentary group tableau showing a shared identity and posture, available light, slightly unposed',
  lore: 'a single striking symbolic still-life, grounded and photographable, mysterious but real',
  event: 'wide cinematic tableau of the moment itself — light and staging doing the work',
  technology:
    'a detailed device/interface render, clean readable form, motivated glow, no legible UI text',
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
    name: 'Mara Vance',
    kind: 'person',
    description:
      "A disgraced tech journalist in her late 30s, burned by a retracted story two years ago and drinking through a freelance-obituary career when she catches wind of missing cryptographers linked to a fringe movement called the Citrine. She goes in chasing contempt and a comeback byline; she does not plan on staying. Sharp, exhausted, allergic to belief of any kind — which is exactly why the Citrine's insistence on proof over faith gets under her skin.",
    visual:
      "Mara Vance: late 30s, sharp tired eyes, second-hand blazer over a wrinkled shirt, a coffee-stained reporter's notebook and an old digital recorder. Standing at the back of a candlelit vigil she wasn't invited to, arms crossed, unconvinced.",
    aspect: 'square_hd',
  },
  {
    name: 'The Signing Wallet',
    kind: 'person',
    description:
      "The Citrine's founder, publicly known only by a wallet address, has been dead for two years — and every new doctrine the movement adopts still arrives signed from that same wallet, cryptographically valid, impossible to forge. No one has the private key. No one can explain the signatures. The congregation calls it proof of continued communion; Mara calls it the story. Whether it is a dead man's pre-signed message queue, a hidden co-founder, or something else entirely is the central mystery of Orange Pills.",
    visual:
      "A single laptop on a bare altar table in a dim room, screen showing a freshly verified signature and a timestamp, candlelight flickering across the keys, nobody's hands anywhere near it.",
    aspect: 'square_hd',
  },
  {
    name: 'Deacon Ellis Roth',
    kind: 'person',
    description:
      "The Citrine's day-to-day administrator — not a prophet, a systems administrator, and proud of it. Roth runs the movement's verification pipeline, teaches new members to read a block explorer before they're taught any doctrine, and treats Mara's hostility as just another claim to be checked rather than refuted. Late 40s, former backend engineer at a bank he won't name, permanently patient in a way that unsettles people looking for a villain.",
    visual:
      'Deacon Ellis Roth: late 40s, cardigan over a plain t-shirt, wire-rim glasses, standing at a whiteboard covered in a hand-drawn verification flowchart in a repurposed storefront, calm and unhurried.',
    aspect: 'square_hd',
  },
  {
    name: 'Undersecretary Diane Kwok',
    kind: 'person',
    description:
      "A federal financial-crimes investigator quietly building a case against the Citrine on behalf of an interagency task force that would rather this movement not exist. Kwok doesn't think they're a scam — that's what worries her. A religion that can't be caught lying is a religion that can't be regulated, and that makes it dangerous to everyone with something to hide. Precise, humorless, entirely sincere about the threat.",
    visual:
      'Undersecretary Diane Kwok: 50s, severe grey suit, government ID on a lanyard, in a windowless briefing room lit by fluorescent tubes, a wall of printed transaction graphs behind her.',
    aspect: 'square_hd',
  },
  {
    name: 'Bishop Aurelio Vann',
    kind: 'person',
    description:
      "An old-guard cardinal-adjacent church official whose diocese has bled congregants to the Citrine for three years running. Vann doesn't believe the Citrine are heretics in the old sense — he believes they're something worse: a faith that has made honesty structurally impossible to fake, which is a standard his own institution could never survive being held to. He is trying, quietly and without admitting it to himself, to have them discredited before that comparison becomes public.",
    visual:
      'Bishop Aurelio Vann: 60s, black clerical suit and collar, seated alone in an ornate but half-empty cathedral nave, afternoon light through stained glass, a single unlit candle in his hand.',
    aspect: 'square_hd',
  },
  {
    name: 'The Citrine',
    kind: 'faction',
    description:
      'A fast-growing lay movement that worships nothing but verifiable truth — its sacraments are open-source code, its scripture is any claim that can be independently proven, its only heresy is belief without evidence. Membership skews young, downwardly mobile, and burned by institutions — laid-off engineers, foreclosed homeowners, journalists nobody trusts anymore. They meet in repurposed storefronts and call their services "vigils," where members read block explorers aloud like liturgy.',
    visual:
      'A repurposed storefront at night, a loose circle of ordinary people — hoodies, work uniforms still on — gathered around a laptop projecting a scrolling ledger onto a bedsheet screen, candles at their feet.',
    aspect: 'landscape_16_9',
  },
  {
    name: 'The Consortium',
    kind: 'faction',
    description:
      "An informal alliance of banks, legacy media conglomerates, and one very large search-and-ads company, none of whom will admit to coordinating, all of whom have quietly funded the same three opposition-research firms targeting the Citrine. Their public line is consumer protection. Their private motive is that a religion built on cheap, universal, unfalsifiable verification is a threat to every business model built on being the only party who can tell you what's true.",
    visual:
      'A glass high-rise boardroom at dusk, a dozen executives around a table lit by a single presentation screen showing a slide titled with a redacted codename, city lights below.',
    aspect: 'landscape_16_9',
  },
  {
    name: 'The Ledger House',
    kind: 'place',
    description:
      "The Citrine's flagship vigil space — a failed check-cashing storefront in a hollowed-out downtown, gutted and repainted, folding chairs in a loose circle around a table that holds nothing but a laptop and a stack of printed, notarized verification logs. No altar, no icon, no cross — the closest thing to an image of the divine is a QR code stenciled on the back wall, hand-painted, slightly crooked.",
    visual:
      'The interior of a converted storefront church: bare brick, folding chairs in a circle, one laptop glowing on a plain table, a large hand-painted QR code on the back wall lit by a single warm lamp.',
    aspect: 'landscape_16_9',
  },
  {
    name: 'Meridian Tower',
    kind: 'place',
    description:
      "The Consortium's unofficial headquarters — technically owned by none of the member companies, formally leased by a shell entity, floor 40 kept permanently half-empty so no one can say a meeting happened there. This is where the opposition-research briefings happen, where the smear timeline gets built, and where, three episodes in, someone finally says out loud what they're actually afraid of.",
    visual:
      'A cold glass-and-steel tower lobby at night, security turnstiles under sterile white light, a bank of elevators, the city skyline reflected and doubled in the glass.',
    aspect: 'landscape_16_9',
  },
  {
    name: 'The Verification Rite',
    kind: 'lore',
    description:
      "The Citrine's only sacrament: before any claim — a doctrine, a donation, a rumor about a member — is accepted, it must be independently reproducible by at least three congregants using only public information. Claims that can't be verified aren't condemned, just set aside, unresolved, sometimes for years. The rite has no priest, no absolution, and no exceptions — which is exactly what makes outsiders, including Mara, unable to dismiss it as easily as they expected to.",
    visual:
      'A hand-lettered ledger open on a wooden table, three different handwriting styles cross-checking the same entry in different colored ink, a laptop showing a matching hash beside it, candlelight.',
    aspect: 'square_hd',
  },
  {
    name: 'The Long Silence',
    kind: 'lore',
    description:
      "The two years between the founder's death and the movement's current size — a period the Citrine themselves treat as doctrinally significant and refuse to discuss with outsiders. Whatever happened during the Long Silence, membership was flat for eighteen months and then tripled in four, coinciding almost exactly with the first post-mortem signed doctrine. Mara becomes convinced the real story isn't the wallet — it's what changed.",
    visual:
      'A dust-covered desk in an abandoned apartment, a monitor left on standby for years, a wall calendar frozen two years in the past, a single new footprint in the dust leading to the keyboard.',
    aspect: 'square_hd',
  },
  {
    name: 'The Doctrine Chain',
    kind: 'technology',
    description:
      "The public, append-only ledger where every Citrine doctrine is posted, timestamped, and signed — readable by anyone, editable by no one, forkable by anyone who disagrees enough to start their own congregation. It is deliberately boring infrastructure, no better or more mystical than any public blockchain explorer, and that ordinariness is the entire point: the Citrine's claim to legitimacy rests on the fact that there is nothing to take on faith.",
    visual:
      'A clean, mostly-empty terminal window on a laptop screen showing a scrolling list of timestamped, signed entries, reflected in a pair of reading glasses resting beside the keyboard, dim room.',
    aspect: 'square_hd',
  },
  {
    name: 'The Founding Signature',
    kind: 'event',
    description:
      "The first doctrine the Citrine adopted after the founder's death — a single cryptic line about honesty being cheaper than belief, signed from the wallet three days after the funeral no one from the movement attended. It should have ended the Citrine as a curiosity. Instead it became the event the entire movement dates itself from, the proof they point to first, and the mystery Mara ends up circling for the rest of the story.",
    visual:
      'A small huddle of early congregants crowded around a single laptop in a bare unfinished room, faces lit only by the screen, the exact moment a new signature resolves as verified.',
    aspect: 'landscape_16_9',
  },
  {
    name: 'The Vigil Mara Stumbles Into',
    kind: 'event',
    description:
      "The cold open of Orange Pills: Mara, chasing a lead on a missing cryptographer, walks into what she assumes is a tech-bro cult meeting and instead finds a room of very normal, very exhausted people cross-checking a claim about a local landlord's falsified inspection records — and getting it right, publicly, before the sun comes up. She leaves more disturbed by how ordinary it was than she would have been by any theatrics.",
    visual:
      'A journalist standing frozen in a storefront doorway at night, half-lit by streetlight behind her, looking in at a candlelit circle of people bent over papers and a laptop, unnoticed for a beat too long.',
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
      const r = await tRPCMutate<{
        imageUrls?: string[];
        modelUsed?: string;
        wasFallback?: boolean;
      }>(
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
  console.log('  Orange Pills — wiki seed (entities.create, any signer)');
  console.log('═'.repeat(64));
  console.log(`  entities : ${SEEDS.length}`);
  console.log(
    `  mode     : ${DRY_RUN ? 'DRY RUN' : 'COMMIT'}${DO_COVERS ? ' + covers' : ' (no covers)'}`
  );

  if (DRY_RUN) {
    for (const s of SEEDS) {
      console.log(`\n• ${s.name} (${s.kind})`);
      console.log(`  desc: ${s.description.slice(0, 100)}…`);
      console.log(`  prompt: ${buildPrompt(s).slice(0, 100)}…`);
    }
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

  // Resume-safe: skip entities that already exist by name; still fill a missing
  // cover on one that was created but never got its image.
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
      const prompt = buildPrompt(s);
      const url = await genImage(prompt, auth.token, s.aspect);
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
