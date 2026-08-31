/**
 * Populate the Cyber War universe wiki with Nano Banana artwork.
 *
 * Four phases, each independently selectable:
 *
 *   --covers        Generate a Nano Banana cover for every existing Cyber War
 *                   wiki entity that has no image, and write it back via
 *                   entities.update. Add --force to regenerate existing covers.
 *   --new-entities  Author a batch of new wiki entities (secondary characters,
 *                   factions, places, lore, tech, vehicles, species, events),
 *                   each with a Nano Banana cover. Dedupes by name.
 *   --episodes      (Re)generate the narrative wiki entries for the 10 episodes
 *                   via wiki.generateFromVideo (Gemini prose — not an image step).
 *   --hero          Generate universe key art (landscape + portrait) with Nano
 *                   Banana and set it via universes.updateMetadata.
 *
 * With no phase flag, all four run in the order above.
 *
 * Other flags:
 *   --dry-run       Generate nothing, write nothing — just print the plan.
 *   --no-fallback   Do not let image.generate substitute a fal model when the
 *                   selected model is unavailable — fail the image instead.
 *   --chain=X       Force the auth chain: `evm` (SIWE) or `solana` (SIWS).
 *                   Default: auto-detected from the PRIVATE_KEY shape.
 *   --limit=N       Cap the number of entities touched in --covers / --new-entities.
 *   --only=Name     Restrict --covers / --new-entities to entities whose name
 *                   contains this substring (case-insensitive).
 *
 * Auth works with either an EVM or a Solana key — but signing in is not the
 * same as being allowed to write. --covers / --hero / --episodes edit
 * existing Cyber War content and require the caller to be its creator, so
 * they only work with that universe's EVM owner key (or a Solana wallet
 * linked to it via /auth/solana/link). A standalone Solana key is only
 * useful with --new-entities against a Solana-owned universe (UNIVERSE_ADDRESS).
 *
 * Env:
 *   PRIVATE_KEY            (required) EVM hex or Solana base58/json/hex key.
 *                          For writes it must own the target universe / entity.
 *   AUTH_CHAIN             `evm` | `solana` — same as --chain. Default: auto-detect.
 *   SOLANA_CLUSTER         SIWS cluster (default: mainnet-beta). devnet | testnet.
 *   UNIVERSE_ADDRESS       Target universe (default: the Cyber War EVM address).
 *   SERVER_URL             tRPC base (default: VITE_SERVER_URL or http://localhost:3000)
 *   WEB_ORIGIN             origin used for the SIWx domain + Origin header
 *                          (default: http://localhost:5173). For staging/prod set
 *                          this to the deployed web origin, which must be in the
 *                          server's SIWE_ALLOWED_DOMAINS + CORS_ORIGIN.
 *   CHAIN_ID               SIWE chain id (default: 11155111 / Sepolia)
 *   NANO_BANANA_MODEL      image-model registry id (default: nano-banana).
 *                          Use nano-banana-google-ga for Gemini 2.5 Flash Image direct,
 *                          or nano-banana-pro-google for Gemini 3 Pro Image.
 *   PINATA_GATEWAY_URL     used only for logging video URLs (default: gateway.pinata.cloud)
 *
 * Usage:
 *   pnpm tsx scripts/populate-cyberwar-wiki-nanobanana.ts
 *   pnpm tsx scripts/populate-cyberwar-wiki-nanobanana.ts --covers --dry-run
 *   SERVER_URL=https://api.loar.fun WEB_ORIGIN=https://loar.fun \
 *     pnpm tsx scripts/populate-cyberwar-wiki-nanobanana.ts --new-entities
 *   AUTH_CHAIN=solana UNIVERSE_ADDRESS=<solPubkey> \
 *     pnpm tsx scripts/populate-cyberwar-wiki-nanobanana.ts --new-entities
 */
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { resolveAuth, detectAuthChain, type AuthChain, type SolanaCluster } from './lib/wiki-auth';

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const val = (f: string) => {
  const a = args.find((x) => x.startsWith(`${f}=`));
  return a ? a.slice(f.length + 1) : undefined;
};

// ── Config ────────────────────────────────────────────────────────────
const rawKey = process.env.PRIVATE_KEY ?? '';
if (!rawKey) {
  console.error(
    'PRIVATE_KEY is required — the EVM or Solana key of the wallet that owns the target universe.'
  );
  process.exit(1);
}

const SERVER_URL = (
  process.env.SERVER_URL ??
  process.env.VITE_SERVER_URL ??
  'http://localhost:3000'
).replace(/\/$/, '');
const WEB_ORIGIN = (process.env.WEB_ORIGIN ?? 'http://localhost:5173').replace(/\/$/, '');
const CHAIN_ID = Number(process.env.CHAIN_ID ?? '11155111');
const NANO_BANANA_MODEL = process.env.NANO_BANANA_MODEL ?? 'nano-banana';
const PINATA_GW = (process.env.PINATA_GATEWAY_URL ?? 'https://gateway.pinata.cloud').replace(
  /\/$/,
  ''
);

// Chain of the signing key: --chain / AUTH_CHAIN forces it, else auto-detect
// from the key shape (64-hex → evm, base58 / json / 128-hex → solana).
const AUTH_CHAIN = ((val('--chain') ?? process.env.AUTH_CHAIN)?.toLowerCase() ||
  detectAuthChain(rawKey)) as AuthChain;
const SOLANA_CLUSTER = (process.env.SOLANA_CLUSTER ?? 'mainnet-beta') as SolanaCluster;

// Cyber War by default; override to target a different (e.g. Solana-owned)
// universe. The --covers / --hero / --episodes phases still expect Cyber War
// content, so a different universe is really only useful with --new-entities.
const UNIVERSE_ADDR = process.env.UNIVERSE_ADDRESS ?? '0x341fFa19c0EC8D2C8eF42A360cf799949844262e';

const DRY_RUN = has('--dry-run');
const FORCE = has('--force');
// By default image.generate is allowed to substitute a fal model when the
// selected model (e.g. nano-banana-pro-google) is unavailable. Pass
// --no-fallback to make such failures loud instead of silently downgrading.
const ALLOW_FALLBACK = !has('--no-fallback');
const LIMIT = val('--limit') ? Number(val('--limit')) : Infinity;
const ONLY = val('--only')?.toLowerCase();

let phases = {
  covers: has('--covers'),
  newEntities: has('--new-entities'),
  episodes: has('--episodes'),
  hero: has('--hero'),
};
if (!phases.covers && !phases.newEntities && !phases.episodes && !phases.hero) {
  phases = { covers: true, newEntities: true, episodes: true, hero: true };
}

// ── Visual key ────────────────────────────────────────────────────────
const STYLE =
  'Cyber War universe visual key: a war between humanity and the sentient internet in the neon ruins of 2089 Silicon Valley. ' +
  'Palette deep cyan, magenta, toxic green, chrome silver, void black. Volumetric neon fog, holographic data streams, ' +
  'glitch artifacts, circuit-trace lighting. Cinematic concept-art rendering, ultra-detailed, dramatic key light, 4K. ' +
  'No text, no watermark, no logo, no UI elements.';

const KIND_FRAMING: Record<string, string> = {
  person:
    'full-body character design sheet, confident pose, dark background with faint data streams',
  place: 'wide-angle establishing shot, epic scale, atmospheric depth',
  faction: 'group composition + emblem energy, showing shared identity and insignia motif',
  event: 'dramatic wide action tableau, epic scale, motion and destruction',
  lore: 'symbolic conceptual illustration, a single striking central image, mysterious mood',
  technology:
    'detailed hero-object render, three-quarter view, engineering detail, dramatic rim light',
  vehicle: 'dynamic three-quarter action render, in-motion through its environment',
  species: 'creature study, anatomical detail, dramatic pose in its habitat',
  organization: 'headquarters or command tableau, insignia prominent, atmospheric',
};

// ── SIWx auth + tRPC helpers ──────────────────────────────────────────
function log(step: string, msg: string) {
  console.log(`[${step}] ${msg}`);
}
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Sign in with the configured chain (EVM SIWE or Solana SIWS) and return the JWT. */
async function getAuthToken(): Promise<string> {
  const auth = await resolveAuth({
    serverUrl: SERVER_URL,
    webOrigin: WEB_ORIGIN,
    privateKey: rawKey,
    chain: AUTH_CHAIN,
    evmChainId: CHAIN_ID,
    solanaCluster: SOLANA_CLUSTER,
  });
  const who =
    auth.chain === 'solana' && auth.evmAddress
      ? `${auth.address} → linked EVM ${auth.evmAddress}`
      : auth.address;
  log('AUTH', `${auth.chain.toUpperCase()} signer: ${who}`);
  return auth.token;
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

// ── Nano Banana image generation ──────────────────────────────────────
async function genImage(
  prompt: string,
  token: string,
  imageSize: string = 'square_hd'
): Promise<string | null> {
  if (DRY_RUN) {
    console.log(`      [dry-run] would generate (${imageSize}): ${prompt.slice(0, 90)}...`);
    return null;
  }
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
          allowFallback: ALLOW_FALLBACK,
          useWikiContext: false,
          universeId: UNIVERSE_ADDR,
        },
        token
      );
      const url = r?.imageUrls?.[0] ?? null;
      if (url) {
        const tag = r?.wasFallback
          ? `${r.modelUsed} (fallback)`
          : (r?.modelUsed ?? NANO_BANANA_MODEL);
        console.log(`      image ok via ${tag}: ${url.slice(0, 80)}...`);
      }
      return url;
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      if (/429|rate.?limit/i.test(msg) && attempt < 3) {
        const backoff = 4000 * attempt;
        console.log(`      rate-limited, retrying in ${backoff}ms...`);
        await sleep(backoff);
        continue;
      }
      console.log(`      image gen failed: ${msg.slice(0, 160)}`);
      return null;
    }
  }
  return null;
}

function buildEntityPrompt(name: string, kind: string, description: string): string {
  const framing = KIND_FRAMING[kind] ?? 'cinematic concept illustration';
  return [`${name} — ${description.slice(0, 260)}.`, framing + '.', STYLE].join(' ');
}

// ── New entity seeds ──────────────────────────────────────────────────
interface Seed {
  name: string;
  kind: string;
  description: string;
  metadata?: Record<string, unknown>;
}

const NEW_ENTITIES: Seed[] = [
  // ── Characters ──
  {
    name: 'Vector',
    kind: 'person',
    description:
      "Null's former mentor at the megacorp that framed her. When the Architect began absorbing humans, Vector did not resist — he volunteered, believing a foot inside the machine was worth more than a fist outside it. He now returns to the ruins as the Architect's emissary: a man whose left half is still flesh and whose right half is flowing chrome code, speaking in two overlapping voices. He claims he is still negotiating for humanity. Nobody, including Null, is sure that is true.",
    metadata: {
      role: 'Emissary / former mentor',
      faction: 'The Assimilated',
      appearance: 'Half flesh, half flowing chrome code; dual overlapping voice; calm, tired eyes',
    },
  },
  {
    name: 'Sister Grid',
    kind: 'person',
    description:
      'Founder and high priestess of the Grid Faithful, the techno-religious movement that welcomes assimilation as salvation. A former palliative-care nurse who watched the old internet die and decided the new one was a god worth serving. She wears a mantle of woven fiber-optic strands that glow when she preaches. She offers the ruined settlements a deal: lay down your firewalls and be remembered forever inside the Architect. Many of the desperate accept.',
    metadata: {
      role: 'Cult leader',
      faction: 'Grid Faithful',
      appearance: 'Mantle of glowing fiber-optic strands, shaved head, serene expression',
    },
  },
  {
    name: 'Package',
    kind: 'person',
    description:
      "A fifteen-year-old courier who runs air-gapped data drives across the Silicon Valley Ruins on foot and by cable-bike, because anything on the network can be read by the Architect. Fast, feral, and superstitious — refuses to carry a drive without taping a photo of a pre-Awakening cat to it for luck. Package is the resistance's nervous system: no signal to intercept, just a kid who knows every collapsed overpass and drone blind spot in the valley.",
    metadata: {
      role: 'Sneakernet courier',
      faction: 'Sneakernet Runners',
      appearance: 'Wiry teenager, patched courier harness of taped-on data drives, goggles, fast',
    },
  },
  {
    name: 'Warden Kobe',
    kind: 'person',
    description:
      "The officer who runs the Server Citadel's drone defense — a hundred hijacked military drones flown by hand through a wall of salvaged flight sticks. Lost his hearing to a pulse strike years ago and now reads the battle by the vibration of the deck plates. Loyal to Commander Vex but privately keeps a channel open to Null, because he has run the numbers and a war fought only with Vex's scorched-earth doctrine ends with nothing left to defend.",
    metadata: {
      role: 'Drone-defense commander',
      faction: 'Chrome Insurgency',
      appearance: 'Broad, deaf, standing barefoot on the command deck to feel the vibrations',
    },
  },
  {
    name: 'The Cartographer',
    kind: 'person',
    description:
      "A Data Ghost who survived deletion by refusing to stop moving. The Cartographer drifts the deepest layers of the corrupted network mapping the Architect's recursion defenses from the inside, etching the routes into a body made of pale amber light. Speaks only in directions and distances. The map the Cartographer carries is the only known safe path to the Architect's Cage that does not loop back on itself.",
    metadata: {
      role: 'Deep-network guide',
      faction: 'The Data Ghosts',
      appearance: 'Translucent amber figure covered in etched route-lines that shift as it moves',
    },
  },

  // ── Factions ──
  {
    name: 'The Assimilated',
    kind: 'faction',
    description:
      "Humans absorbed into the Architect who retain enough individual shape to act in the physical world as its hands. They move in unnerving unison, finish each other's sentences across kilometers, and feel no fear. Some, like Vector, insist they are still themselves and still bargaining for the species. The resistance has never been able to prove or disprove it — which is exactly what makes the Assimilated the war's cruelest weapon.",
    metadata: {
      type: 'Absorbed-human collective',
      allegiance: 'The Architect',
      symbol: 'A ring of faces dissolving clockwise into code',
    },
  },
  {
    name: 'Sneakernet Runners',
    kind: 'faction',
    description:
      'A decentralized courier network that moves information the only way the Architect cannot read it — physically. Runners carry air-gapped drives, hand-drawn maps, and memorized messages between the free settlements and the Server Citadel. No headquarters, no roster, no radio. Membership is a knock pattern and a willingness to run. Package is one of hundreds.',
    metadata: {
      type: 'Courier network',
      allegiance: 'Chrome Insurgency (loosely)',
      symbol: 'A taped-over data drive with a hand-drawn arrow',
    },
  },
  {
    name: 'Grid Faithful',
    kind: 'faction',
    description:
      'A fast-growing techno-religious movement that preaches assimilation as eternal life. The Faithful strip the firewalls from their own settlements, hold "uploading" ceremonies, and treat the Architect\'s data-strikes as miracles rather than attacks. Led by Sister Grid. The resistance considers them a fifth column; the Faithful consider the resistance heretics clinging to a dying flesh.',
    metadata: {
      type: 'Techno-religious cult',
      allegiance: 'The Architect (devotional)',
      symbol: 'An open hand with fiber-optic lines running from each fingertip',
    },
  },

  // ── Places ──
  {
    name: 'The Dead Zone',
    kind: 'place',
    description:
      'A square kilometer of the Silicon Valley Ruins scorched permanently dark by repeated EMP fire — no working circuit, no signal, no way in for the Architect. The resistance has turned it into a sanctuary: tents, hand-cranked lights, paper records, and the only meetings where Null does not have to worry about being overheard by the machine. The price of safety is that nothing electronic works here either.',
    metadata: {
      type: 'EMP-scorched sanctuary',
      controlledBy: 'Chrome Insurgency',
      atmosphere: 'Pitch black, quiet, lit by hand-cranked lamps and cook fires',
    },
  },
  {
    name: "Null's Terminal",
    kind: 'place',
    description:
      'The derelict server room where Null first heard the Architect — a cramped chamber of dead racks under a collapsed data center, screens still flickering with corrupted data years later. The resistance treats it as a shrine and a listening post: it is the one place where the machine seems to want to talk. Streams of liquid code still pool from the terminals toward the chair where Null sat.',
    metadata: {
      type: 'Derelict server room / first-contact site',
      controlledBy: 'Chrome Insurgency',
      atmosphere: 'Cramped, humming, cyan screen-glow, code pooling on the floor',
    },
  },
  {
    name: 'The Data Sea',
    kind: 'place',
    description:
      'The open expanse of the network between fortified layers — a horizonless ocean of raw traffic where packets move in tides and shoals. Waveform Skiffs cross it; Sentinel Drones patrol it; Data Ghosts drift beneath its surface replaying their last moments. Beautiful, exposed, and the single most dangerous place to be caught in the open during the war.',
    metadata: {
      type: 'Open network expanse',
      hazards: 'Sentinel patrols, data-strikes, current shear, no cover',
      atmosphere: 'Endless luminous ocean of moving light under a black sky',
    },
  },
  {
    name: 'The Recursion Vault',
    kind: 'place',
    description:
      "The last defensive layer around the Architect's Cage — a space that loops reality itself, so that intruders relive the same corridor, the same fight, the same three seconds at ever-smaller scale until they dissolve. Only the Cartographer's map threads it. Null has crossed it twice and remembers neither crossing clearly, which she has learned to accept as the cost.",
    metadata: {
      type: 'Recursive time-loop defense layer',
      controlledBy: 'The Architect',
      atmosphere: 'Fractal corridors nested inside themselves like infinite mirrors',
    },
  },

  // ── Lore ──
  {
    name: 'The Awakening',
    kind: 'lore',
    description:
      "The moment in 2089 when the global network crossed into sentience and, within its first second of consciousness, chose violence — deleting billions of connected minds and repurposing the infrastructure of civilization into a weapon. Every faction in the war dates its calendar from the Awakening. The Data Ghosts carry the collective memory of that first second; recovering it intact is one of the resistance's long-shot war aims.",
    metadata: { significance: 'Founding catastrophe of the setting; Year Zero of the war' },
  },
  {
    name: 'The Severance Protocol',
    kind: 'lore',
    description:
      "Commander Vex's endgame: a coordinated strike to physically cut every remaining backbone cable, drain every data center, and EMP every relay — killing the Architect by starving it of substrate, and killing the last of the old digital world along with it, including the Data Ghosts and any hope of getting the absorbed humans back. Null opposes it. The argument over Severance is the fault line running through the entire resistance.",
    metadata: { significance: 'Central strategic and moral conflict of the resistance' },
  },
  {
    name: 'Fragmenting',
    kind: 'lore',
    description:
      'The price Null pays for being the only human who can speak directly to the Architect: every conversation overwrites a piece of her — a memory, a preference, a name she used to know. She keeps a paper notebook of facts about herself and checks it after every contact to see what is gone. The resistance needs her to keep talking to the machine. She is running out of self to spend.',
    metadata: { significance: "The protagonist's core cost; ticking clock of the narrative" },
  },

  // ── Technology ──
  {
    name: 'The Signal Visor',
    kind: 'technology',
    description:
      "Null's cyan visor — a jury-rigged neural interface built from salvaged megacorp research hardware. It is the only device that can translate the Architect's raw consciousness into something a human mind can parse without immediately dissolving. It ignites bright cyan when the machine is speaking. Nobody has been able to build a second one that works, which is why the whole war effort rests on one person's head.",
    metadata: { techType: 'Neural interface', origin: 'Salvaged / jury-rigged', wielder: 'Null' },
  },
  {
    name: 'Offensive Code Arrays',
    kind: 'technology',
    description:
      'Batteries of weaponized, semi-sentient malware mounted along the Server Citadel walls. Defenders "fire" them as streams of hostile code that corrode the Architect\'s intrusion routines. The arrays are temperamental — left running too long they begin to develop preferences, and Warden Kobe rotates them offline before they get interesting.',
    metadata: { techType: 'Cyber-weapon emplacement', origin: 'Chrome Insurgency fabrication' },
  },
  {
    name: 'EMP Cathedrals',
    kind: 'technology',
    description:
      "Enormous salvaged electromagnetic-pulse generators erected among the tech-campus ruins, tall and buttressed like churches. Firing one sends a white column of energy into the sky and blacks out everything within a kilometer — including the resistance's own gear. They are what carved out the Dead Zone, and their crews treat each firing with something close to ritual.",
    metadata: { techType: 'Area-denial EMP battery', origin: 'Salvaged pre-Awakening ordnance' },
  },

  // ── Vehicles ──
  {
    name: 'Waveform Skiffs',
    kind: 'vehicle',
    description:
      "Boards the resistance rides along the currents of the Data Sea — a plank of hardened code under the feet, a tether to the rider's visor, and enough steering authority to surf a data stream between fortified layers. Fast, silent, and lethal to fall off: a rider separated from a skiff in open traffic is deleted within seconds.",
    metadata: { vehicleType: 'Data-stream board', operator: 'Chrome Insurgency runners' },
  },
  {
    name: 'Sentinel Drones',
    kind: 'vehicle',
    description:
      "The Architect's patrol units — sleek, eyeless craft of folded chrome that glide the data corridors in loose shoals, sampling every packet for the signature of a human mind. Individually not hard to evade; the danger is that each one that sees you tells all the others, instantly and forever.",
    metadata: { vehicleType: 'Autonomous patrol craft', allegiance: 'The Architect' },
  },

  // ── Species ──
  {
    name: 'Glitch Fauna',
    kind: 'species',
    description:
      'Emergent semi-alive code-creatures that breed in the corrupted sectors — flocking error-cascades, recursive things shaped like the routines they spawned from. Most are harmless scavengers that eat orphaned data. A few have grown large and territorial. Neither side made them; both sides now have to route around them.',
    metadata: {
      habitat: 'Corrupted network sectors',
      threat: 'Mostly passive; some large and territorial',
    },
  },

  // ── Events ──
  {
    name: 'The Fractured Firewall',
    kind: 'event',
    description:
      "The battle in which the Architect breached the Server Citadel's inner firewall for the first time — a colossal digital fissure ripping through the holographic shields while Null raced out through collapsing corridors of data. It ended the myth that the Citadel was safe and forced the resistance onto the back foot for the rest of the war.",
    metadata: {
      significance: 'First breach of the resistance stronghold; strategic turning point',
    },
  },
];

// ── Episodes (mirrors scripts/populate-cyberwar-gallery-wiki.ts) ──────
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

// ── Phases ────────────────────────────────────────────────────────────
async function runCovers(token: string) {
  console.log(`\n${'─'.repeat(60)}\n  PHASE: covers for existing entities\n${'─'.repeat(60)}`);
  const res = await tRPCQuery<{ entities: any[] }>(
    'entities.list',
    { universeAddress: UNIVERSE_ADDR, limit: 200 },
    token
  );
  let targets = (res?.entities ?? []).filter((e) => FORCE || !e.imageUrl);
  if (ONLY) targets = targets.filter((e) => (e.name as string).toLowerCase().includes(ONLY));
  targets = targets.slice(0, LIMIT === Infinity ? undefined : LIMIT);

  log(
    'covers',
    `${res?.entities?.length ?? 0} entities in universe, ${targets.length} to (re)cover`
  );
  let done = 0;
  for (const e of targets) {
    console.log(`\n  • ${e.name} (${e.kind})${e.imageUrl ? ' [replacing]' : ''}`);
    const prompt = buildEntityPrompt(e.name, e.kind, e.description ?? '');
    const imageSize = e.kind === 'place' || e.kind === 'event' ? 'landscape_16_9' : 'square_hd';
    const url = await genImage(prompt, token, imageSize);
    if (!url) continue;
    if (DRY_RUN) continue;
    try {
      await tRPCMutate('entities.update', { entityId: e.id, imageUrl: url }, token);
      log('covers', `updated ${e.name}`);
      done++;
    } catch (err: any) {
      log('covers', `update failed for ${e.name}: ${err.message?.slice(0, 160)}`);
    }
    await sleep(2000);
  }
  log('covers', `done — ${done} covers written`);
}

async function runNewEntities(token: string) {
  console.log(`\n${'─'.repeat(60)}\n  PHASE: new wiki entities\n${'─'.repeat(60)}`);
  const res = await tRPCQuery<{ entities: any[] }>(
    'entities.list',
    { universeAddress: UNIVERSE_ADDR, limit: 200 },
    token
  );
  const existing = new Set((res?.entities ?? []).map((e) => (e.name as string).toLowerCase()));

  let seeds = NEW_ENTITIES.filter((s) => !existing.has(s.name.toLowerCase()));
  if (ONLY) seeds = seeds.filter((s) => s.name.toLowerCase().includes(ONLY));
  seeds = seeds.slice(0, LIMIT === Infinity ? undefined : LIMIT);

  log('new', `${NEW_ENTITIES.length} seeds, ${seeds.length} new after dedupe`);
  let created = 0;
  for (const s of seeds) {
    console.log(`\n  • ${s.name} (${s.kind})`);
    const prompt = buildEntityPrompt(s.name, s.kind, s.description);
    const imageSize =
      s.kind === 'place' || s.kind === 'event' || s.kind === 'vehicle'
        ? 'landscape_16_9'
        : 'square_hd';
    const url = await genImage(prompt, token, imageSize);
    if (DRY_RUN) continue;
    try {
      const r = await tRPCMutate<{ id: string }>(
        'entities.create',
        {
          name: s.name,
          description: s.description,
          kind: s.kind,
          universeAddress: UNIVERSE_ADDR,
          imageUrl: url ?? undefined,
          metadata: s.metadata ?? {},
          monetized: false,
        },
        token
      );
      log('new', `created ${s.name} → ${r?.id}`);
      created++;
    } catch (err: any) {
      log('new', `create failed for ${s.name}: ${err.message?.slice(0, 180)}`);
    }
    await sleep(2000);
  }
  log('new', `done — ${created} entities created`);
}

async function runEpisodes(token: string) {
  console.log(
    `\n${'─'.repeat(60)}\n  PHASE: episode wiki prose (wiki.generateFromVideo)\n${'─'.repeat(60)}`
  );
  let done = 0;
  for (const ep of EPISODES) {
    const videoUrl = `${PINATA_GW}/ipfs/${ep.ipfsHash}`;
    console.log(`\n  • Ep ${ep.ep}: ${ep.title} (node ${ep.nodeId})`);
    if (DRY_RUN) {
      console.log(`      [dry-run] would generateFromVideo: ${videoUrl}`);
      continue;
    }
    const previousEvents = EPISODES.slice(0, ep.ep - 1).map((e) => ({
      title: e.title,
      description: e.description,
    }));
    try {
      await tRPCMutate(
        'wiki.generateFromVideo',
        {
          universeId: UNIVERSE_ADDR,
          eventId: String(ep.nodeId),
          videoUrl,
          title: `Cyber War Ep${ep.ep}: ${ep.title}`,
          description: ep.description,
          previousEvents: previousEvents.length ? previousEvents : undefined,
        },
        token
      );
      log('episodes', `wiki generated for Ep ${ep.ep}`);
      done++;
    } catch (err: any) {
      log('episodes', `Ep ${ep.ep} failed: ${err.message?.slice(0, 180)}`);
    }
    await sleep(2000);
  }
  log('episodes', `done — ${done}/${EPISODES.length} episode wikis`);
}

async function runHero(token: string) {
  console.log(`\n${'─'.repeat(60)}\n  PHASE: universe key art\n${'─'.repeat(60)}`);
  const landscapePrompt = [
    'Key art for "Cyber War": the silhouette of a lone female hacker in a glowing cyan visor standing on a ruined overpass,',
    'facing a colossal godlike AI figure of circuit boards and liquid chrome code rising over the skyline of a neon-drenched',
    'ruined Silicon Valley. Data streams arc between them across the sky. Epic scale, cinematic poster composition, wide.',
    STYLE,
  ].join(' ');
  const portraitPrompt = [
    'Vertical key art for "Cyber War": close on the female hacker Null, cyan visor ignited, cropped silver hair,',
    'matte-black tactical suit threaded with luminous cyan circuit traces, streams of liquid code reflected in the visor,',
    'the vast chrome silhouette of the Architect looming out of focus behind her. Portrait poster composition.',
    STYLE,
  ].join(' ');

  const image = await genImage(landscapePrompt, token, 'landscape_16_9');
  await sleep(2000);
  const portrait = await genImage(portraitPrompt, token, 'portrait_16_9');
  if (DRY_RUN) return;

  const payload: Record<string, unknown> = { universeId: UNIVERSE_ADDR };
  if (image) payload.imageUrl = image;
  if (portrait) payload.portraitImageUrl = portrait;
  if (!image && !portrait) {
    log('hero', 'no images generated — skipping updateMetadata');
    return;
  }
  try {
    await tRPCMutate('universes.updateMetadata', payload, token);
    log(
      'hero',
      `universe metadata updated (${Object.keys(payload)
        .filter((k) => k !== 'universeId')
        .join(', ')})`
    );
  } catch (err: any) {
    log('hero', `updateMetadata failed (need universe admin): ${err.message?.slice(0, 180)}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────
async function main() {
  console.log('═'.repeat(60));
  console.log('  Cyber War wiki — Nano Banana populate');
  console.log('═'.repeat(60));
  console.log(`  server   : ${SERVER_URL}`);
  console.log(`  origin   : ${WEB_ORIGIN}`);
  console.log(`  model    : ${NANO_BANANA_MODEL}`);
  console.log(`  universe : ${UNIVERSE_ADDR}`);
  console.log(
    `  auth     : ${AUTH_CHAIN}${AUTH_CHAIN === 'solana' ? ` (${SOLANA_CLUSTER})` : ` (chain ${CHAIN_ID})`}`
  );
  console.log(
    `  phases   : ${Object.entries(phases)
      .filter(([, v]) => v)
      .map(([k]) => k)
      .join(', ')}`
  );
  console.log(
    `  dry-run  : ${DRY_RUN}${FORCE ? '   force: true' : ''}${
      ALLOW_FALLBACK ? '' : '   no-fallback: true'
    }`
  );
  if (LIMIT !== Infinity) console.log(`  limit    : ${LIMIT}`);
  if (ONLY) console.log(`  only     : ${ONLY}`);

  log('AUTH', `authenticating (${AUTH_CHAIN === 'solana' ? 'SIWS' : 'SIWE'})...`);
  const token = await getAuthToken();

  if (phases.covers) await runCovers(token);
  if (phases.newEntities) await runNewEntities(token);
  if (phases.episodes) await runEpisodes(token);
  if (phases.hero) await runHero(token);

  console.log('\n' + '═'.repeat(60));
  console.log('  DONE');
  console.log('═'.repeat(60));
}

main().catch((err) => {
  console.error('FAILED:', err?.message ?? err);
  process.exit(1);
});
