/**
 * VOIDBORN SAGA — Pilot Episode: "Crash Landing"
 *
 * 35 scenes via Seedance 2.0 → on-chain nodes.
 * Pulls character DNA from wiki entities for visual consistency.
 *
 * ~6 min of core footage (35 × 10s = 5:50 + audio padding)
 *
 * Prerequisites:
 *   - Voidborn Saga universe deployed (create-voidborn-saga.ts), address in VOIDBORN_ADDR
 *   - Wiki populated (voidborn-saga-wiki.ts) — ideally with VOIDBORN_ADDR set so
 *     entities are attached to the universe
 *   - Server running (pnpm dev:server)
 *
 * Generation Modes:
 *   GEN_MODE=continuity  — Sequential i2v: each scene starts from the last
 *                          frame of the previous scene. Slower (~2.5 min/scene)
 *                          but maintains visual continuity (same characters,
 *                          environments, and motion between scenes).
 *   GEN_MODE=fast         — Parallel t2v: scenes generated in batches of
 *                          BATCH_SIZE (default 5). Much faster but each scene
 *                          is visually independent — characters may look
 *                          different between scenes.
 *
 * Usage:
 *   VOIDBORN_ADDR=0x... GEN_MODE=continuity pnpm tsx scripts/voidborn-saga-pilot-scenes.ts
 *   VOIDBORN_ADDR=0x... GEN_MODE=fast BATCH_SIZE=3 pnpm tsx scripts/voidborn-saga-pilot-scenes.ts
 *
 * Resume: Set START_SCENE=S14 env to skip completed scenes.
 */
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toBytes,
  decodeEventLog,
  getAddress,
} from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const rawKey = process.env.PRIVATE_KEY ?? '';
const PRIVATE_KEY = (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as `0x${string}`;
const RPC_URL = process.env.RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com';
const SERVER_URL = process.env.VITE_SERVER_URL ?? 'http://localhost:3000';
const BYTEDANCE_API_KEY = process.env.BYTEDANCE_API_KEY!;

const account = privateKeyToAccount(PRIVATE_KEY);
const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC_URL) });
const walletClient = createWalletClient({ account, chain: sepolia, transport: http(RPC_URL) });

const UNIVERSE_ADDR = (process.env.VOIDBORN_ADDR ??
  '0x0000000000000000000000000000000000000000') as `0x${string}`;
const BD_BASE = 'https://ark.ap-southeast.bytepluses.com/api/v3';
const START_SCENE = process.env.START_SCENE ?? 'S01';
const GEN_MODE = (process.env.GEN_MODE ?? 'continuity') as 'continuity' | 'fast';
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE ?? '5', 10);
const RESUME_FRAME = process.env.RESUME_FRAME ?? '';

// ── Helpers ─────────────────────────────────────────────────────────────
function log(step: string, msg: string) {
  console.log(`[${step}] ${msg}`);
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Auth ─────────────────────────────────────────────────────────────────
async function getAuthToken(): Promise<string> {
  const nonceRes = await fetch(`${SERVER_URL}/auth/nonce`);
  const { nonce } = (await nonceRes.json()) as { nonce: string };
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000);
  const message = [
    `localhost wants you to sign in with your Ethereum account:`,
    getAddress(account.address),
    '',
    'Sign in to LOAR',
    '',
    `URI: http://localhost:3001`,
    `Version: 1`,
    `Chain ID: ${sepolia.id}`,
    `Nonce: ${nonce}`,
    `Issued At: ${now.toISOString()}`,
    `Expiration Time: ${expiresAt.toISOString()}`,
  ].join('\n');
  const signature = await account.signMessage({ message });
  const verifyRes = await fetch(`${SERVER_URL}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3001' },
    body: JSON.stringify({ message, signature }),
  });
  const setCookie = verifyRes.headers.get('set-cookie') ?? '';
  const match = setCookie.match(/siwe-session=([^;]+)/);
  if (!match) throw new Error('No session cookie');
  return match[1];
}

// ── Pull full entity data from wiki for visual consistency ──────────────
async function fetchCharacterDNA(token: string): Promise<Record<string, string>> {
  log('WIKI', 'Fetching ALL entity data from wiki for visual consistency...');
  const res = await fetch(
    `${SERVER_URL}/trpc/entities.list?batch=1&input=${encodeURIComponent(
      JSON.stringify({ '0': { universeAddress: UNIVERSE_ADDR.toLowerCase() } })
    )}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const json = (await res.json()) as any[];
  const result = json[0]?.result?.data;
  const entities = result?.entities || result || [];

  const dna: Record<string, string> = {};
  for (const e of entities) {
    const name = e.name || e.data?.name;
    const desc = e.description || e.data?.description || '';
    const meta = e.metadata || e.data?.metadata || {};
    const kind = e.kind || e.data?.kind || '';
    if (!name) continue;

    const key = name.toUpperCase().replace(/[^A-Z0-9]/g, '_');

    if (kind === 'person') {
      const appearance = meta.appearance || '';
      const role = meta.role || '';
      const affiliations = meta.affiliations || '';
      dna[key] = [
        `${name}:`,
        appearance,
        role ? `Role: ${role}.` : '',
        affiliations ? `Affiliation: ${affiliations}.` : '',
      ]
        .filter(Boolean)
        .join(' ');
    } else if (kind === 'place') {
      const placeType = meta.placeType || '';
      const atmosphere = meta.atmosphere || '';
      dna[key] = [
        `${name}:`,
        placeType ? `${placeType}.` : '',
        atmosphere || desc.split('.').slice(0, 2).join('.') + '.',
      ]
        .filter(Boolean)
        .join(' ');
    } else if (kind === 'technology' || kind === 'vehicle') {
      const techType = meta.techType || meta.vehicleType || '';
      const howItWorks = meta.howItWorks || meta.capabilities || '';
      dna[key] = [
        `${name}:`,
        techType ? `${techType}.` : '',
        howItWorks || desc.split('.').slice(0, 2).join('.') + '.',
      ]
        .filter(Boolean)
        .join(' ');
    } else {
      dna[key] = `${name}: ${desc.split('.').slice(0, 3).join('.')}.`;
    }

    log('WIKI', `  [${kind}] ${name}`);
  }

  log('WIKI', `Loaded ${Object.keys(dna).length} entities for visual consistency`);
  return dna;
}

// ── On-chain ABI ────────────────────────────────────────────────────────
const universeAbi = [
  {
    type: 'function',
    name: 'createNode',
    inputs: [
      { name: '_contentHash', type: 'bytes32' },
      { name: '_plotHash', type: 'bytes32' },
      { name: '_previous', type: 'uint256' },
      { name: '_link', type: 'string' },
      { name: '_plot', type: 'string' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'latestNodeId',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    name: 'NodeCreated',
    inputs: [
      { name: 'id', type: 'uint256', indexed: true },
      { name: 'previous', type: 'uint256', indexed: true },
      { name: 'creator', type: 'address', indexed: true },
      { name: 'contentHash', type: 'bytes32', indexed: false },
      { name: 'plotHash', type: 'bytes32', indexed: false },
      { name: 'link', type: 'string', indexed: false },
      { name: 'plot', type: 'string', indexed: false },
    ],
  },
] as const;

// ── Sanitize prompt to dodge ByteDance copyright filter ──────────────────
function sanitizePrompt(prompt: string, attempt: number): string {
  if (attempt === 0) return prompt;
  let p = prompt
    .replace(/\bZix\b/g, 'the tall indigo alien leader')
    .replace(/\bMora\b/g, 'the moss-green alien engineer')
    .replace(/\bPebb\b/g, 'the tiny lavender chaos alien')
    .replace(/\bDrael\b/g, 'the bronze-skinned handsome alien')
    .replace(/\bNuni\b/g, 'the pale blue-silver alien scholar')
    .replace(/\bHector\b/g, 'a weathered flea-market vendor')
    .replace(/\bthe Starling\b/gi, 'the junky alien ship')
    .replace(/Santa Mira County/gi, 'a California suburb')
    .replace(/Taco Bell/gi, 'a taco fast-food place');
  if (attempt >= 2) {
    p = p
      .replace(/VOIDBORN SAGA/gi, 'the animated series')
      .replace(/Voidborn/gi, 'alien')
      .replace(/The Sleeper Network/gi, 'the hidden network')
      .replace(/The Frequency/gi, 'an ancient presence')
      .replace(/(?:Pixar-quality|Pixar|A24|Gaspar Noé|Villeneuve|Fincher)/gi, 'cinematic')
      .replace(/ARRI Alexa 65/gi, 'professional cinema camera')
      .replace(/photorealistic/gi, 'realistic');
  }
  return p;
}

// ── Frame extraction for scene continuity ───────────────────────────────
import { execSync } from 'child_process';
import fs from 'fs';
import { tmpdir } from 'os';

async function extractLastFrame(videoUrl: string, label: string): Promise<string | null> {
  try {
    const tmpFile = `${tmpdir()}/void-frame-${Date.now()}.jpg`;
    const tmpVid = `${tmpdir()}/void-vid-${Date.now()}.mp4`;
    const dlRes = await fetch(videoUrl);
    if (!dlRes.ok) return null;
    fs.writeFileSync(tmpVid, Buffer.from(await dlRes.arrayBuffer()));
    execSync(`ffmpeg -y -sseof -0.1 -i "${tmpVid}" -frames:v 1 -q:v 2 "${tmpFile}" 2>/dev/null`, {
      timeout: 15_000,
    });
    fs.unlinkSync(tmpVid);
    if (!fs.existsSync(tmpFile)) return null;
    const frameBuffer = fs.readFileSync(tmpFile);
    fs.unlinkSync(tmpFile);
    log(label, `Extracted last frame (${(frameBuffer.length / 1024).toFixed(0)}KB)`);

    const pinataJwt = process.env.PINATA_JWT;
    if (!pinataJwt) {
      log(label, 'No PINATA_JWT — falling back to data URI (may fail with ByteDance)');
      return `data:image/jpeg;base64,${frameBuffer.toString('base64')}`;
    }
    const formData = new FormData();
    formData.append(
      'file',
      new Blob([frameBuffer], { type: 'image/jpeg' }),
      `frame-${Date.now()}.jpg`
    );
    formData.append('pinataMetadata', JSON.stringify({ name: `continuity-frame-${label}` }));
    const pinataRes = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
      method: 'POST',
      headers: { Authorization: `Bearer ${pinataJwt}` },
      body: formData,
    });
    if (!pinataRes.ok) {
      log(label, `Pinata upload failed (${pinataRes.status}) — no continuity frame`);
      return null;
    }
    const { IpfsHash } = (await pinataRes.json()) as { IpfsHash: string };
    const gateway = process.env.PINATA_GATEWAY_URL || 'https://gateway.pinata.cloud';
    const frameUrl = `${gateway}/ipfs/${IpfsHash}`;
    log(label, `Frame uploaded: ${frameUrl}`);
    return frameUrl;
  } catch (err: any) {
    log(label, `Frame extraction failed: ${err.message?.slice(0, 100)}`);
    return null;
  }
}

// ── Video generation via ByteDance Seedance 2.0 ─────────────────────────
async function generateVideo(
  prompt: string,
  label: string,
  startImage?: string | null
): Promise<string> {
  const MAX_RETRIES = 3;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const sanitized = sanitizePrompt(prompt, attempt);
    if (attempt > 0) log(label, `Retry ${attempt}/${MAX_RETRIES - 1} (sanitized prompt)...`);
    else
      log(label, startImage ? 'Generating video (i2v continuity)...' : 'Generating video (t2v)...');

    const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];
    if (startImage) {
      content.push({ type: 'image_url', image_url: { url: startImage } });
    }
    content.push({ type: 'text', text: sanitized });

    const taskRes = await fetch(`${BD_BASE}/contents/generations/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${BYTEDANCE_API_KEY}` },
      body: JSON.stringify({
        model: 'dreamina-seedance-2-0-260128',
        content,
        duration: 10,
        aspect_ratio: '16:9',
        resolution: '720p',
        generate_audio: false,
      }),
    });
    if (!taskRes.ok) {
      const errText = await taskRes.text().catch(() => '');
      if (
        startImage &&
        (errText.includes('PrivacyInformation') ||
          errText.includes('real person') ||
          errText.includes('SensitiveContent'))
      ) {
        log(label, 'Frame rejected (person detected) — falling back to t2v');
        startImage = null;
        continue;
      }
      throw new Error(`ByteDance ${taskRes.status}: ${errText.slice(0, 200)}`);
    }
    const { id: taskId } = (await taskRes.json()) as any;
    if (!taskId) throw new Error('No task ID');
    log(label, `Task: ${taskId}`);

    let copyrightBlock = false;
    for (let i = 0; i < 60; i++) {
      await sleep(5000);
      const poll = await fetch(`${BD_BASE}/contents/generations/tasks/${taskId}`, {
        headers: { Authorization: `Bearer ${BYTEDANCE_API_KEY}` },
      });
      if (!poll.ok) continue;
      const s = (await poll.json()) as any;
      const st = s.status?.toLowerCase();
      if (st === 'succeeded' || st === 'completed') {
        const url = s.content?.video_url || s.output?.video_url;
        if (!url) throw new Error('No video URL');
        log(label, 'Video done');
        return url;
      }
      if (st === 'failed' || st === 'error') {
        const msg = s.error?.message || 'failed';
        if (msg.includes('copyright') || msg.includes('restrictions')) {
          log(label, `Copyright filter triggered (attempt ${attempt + 1})`);
          copyrightBlock = true;
          break;
        }
        throw new Error(msg);
      }
      if (i % 6 === 0) log(label, `Generating... (${i * 5}s)`);
    }

    if (!copyrightBlock) throw new Error('Timeout');
    await sleep(2000);
  }
  throw new Error('Copyright filter blocked all retries');
}

// ── On-chain node creation ──────────────────────────────────────────────
async function createNode(
  contentHash: string,
  plot: string,
  previousId: bigint,
  link: string,
  label: string
) {
  const chBytes = keccak256(toBytes(contentHash)) as `0x${string}`;
  const plotHash = keccak256(toBytes(plot));
  const txHash = await walletClient.writeContract({
    address: UNIVERSE_ADDR,
    abi: universeAbi,
    functionName: 'createNode',
    args: [chBytes, plotHash, previousId, link, plot],
  });
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
    confirmations: 1,
    timeout: 120_000,
  });
  if (receipt.status !== 'success') throw new Error('TX reverted');
  let nodeId = 0n;
  for (const l of receipt.logs) {
    try {
      const d = decodeEventLog({ abi: universeAbi, data: l.data, topics: l.topics });
      if (d.eventName === 'NodeCreated') nodeId = BigInt((d.args as any).id);
    } catch {}
  }
  log(label, `Node #${nodeId} confirmed`);
  return nodeId;
}

// ── Scene definitions ───────────────────────────────────────────────────
function buildScenes(dna: Record<string, string>) {
  // ── Character Visual DNA (pulled from wiki entities) ──
  const ZIX =
    dna['ZIX'] ||
    'Zix: Tall slender Voidborn, deep indigo skin with cranial ridges along his temples, large black almond eyes with no whites, a formal expeditionary sash across a scuffed dark-gray uniform jacket. Theatrical body language, always mid-speech.';
  const MORA =
    dna['MORA'] ||
    "Mora: Compact wiry Voidborn engineer, moss-green skin, short braided crest feathers, four-fingered scarred hands, grease-streaked jumpsuit with cross-body tool harness. Expression permanently set to 'I already told you.'";
  const PEBB =
    dna['PEBB'] ||
    'Pebb: Small rotund alien about three feet tall, pastel-lavender fur, huge round expressive eyes, tiny bioluminescent fangs, oversized independently-flicking ears. Scavenged bandolier stuffed with Earth snacks.';
  const DRAEL =
    dna['DRAEL'] ||
    'Drael: Tall broad-shouldered Voidborn, iridescent bronze skin with metallic sheen, jet-black hair perfectly falling into faintly glowing gold eyes, partially unzipped black flight jacket with chrome piping, confident half-smile.';
  const NUNI =
    dna['NUNI'] ||
    "Nuni: Slim nervous Voidborn scholar, pale blue-silver skin, wide amber eyes, two long delicate antennae drooping forward, layered scholar's robe clutching a cracked alien tablet. Earnest and anxious.";

  const HIKER =
    dna['THE_HIKER'] ||
    'The Hiker: Mid-forties man, weathered face with graying stubble, olive-green flannel over a thermal, sturdy hiking pants, broken-in boots. Headlamp over a dark beanie. Politely concerned expression.';
  const CLERK =
    dna['THE_CONVENIENCE_STORE_CLERK'] ||
    'The Clerk: Early thirties, tired eyes with slight bags, two-day stubble, faded band t-shirt under a cheap store-branded vest. Leaning on the counter, one earbud in, phone in hand.';
  const TEENS =
    dna['THE_METEOR_HUNTERS'] ||
    'Meteor Hunters: Two teenage boys — one lanky in an oversized hoodie and backwards cap with a selfie-mode phone, one heavier in a zip hoodie and basketball shorts with a backpack and energy drink. Both mid-panic.';

  // ── Location DNA ──
  const RAVINE =
    dna['THE_RAVINE'] ||
    'The Ravine: Steep wooded California ravine at night, broken pines on a scarred slope, smoking junky alien ship at the bottom.';
  const STRIP_MALL =
    dna['THE_STRIP_MALL'] ||
    'The Strip Mall: Late-night Southern California strip mall — neon signs for TACO BELL, LIQUOR, NAILS, SMOKE SHOP, COIN LAUNDRY. Oil puddle reflections, palm trees at the edge.';
  const STORE =
    dna['THE_24_HOUR_CONVENIENCE_STORE'] ||
    'The 24-Hour Convenience Store: Fluorescent-lit interior, rows of chips and candy and magazines, humming refrigerators, a roller grill with hot dogs, a counter with a tired clerk and a monitor wall of security feeds.';
  const CARWASH =
    dna['THE_ABANDONED_CAR_WASH'] ||
    'The Abandoned Car Wash: Concrete drive-thru tunnel at night, peeling paint, seized rusted brushes drooping, graffiti, puddles with moonlight, open bay looking out onto a dark industrial lot.';
  const LOOKOUT =
    dna['THE_HILLTOP_LOOKOUT'] ||
    'The Hilltop Lookout: Bald hilltop at pre-dawn over a sleeping California suburb — tract homes, palm trees, fast-food signs, freeway headlights, observatory dome on a far hill catching first blue-gold light.';
  const STARLING =
    dna['THE_STARLING'] ||
    'The Starling: Junky beloved Voidborn explorer hull, oxidized-copper wedge shape with mismatched patch plates, bolted-on tool pods, flickering running lights, a single stencilled alien glyph near the open hatch.';

  // ── AAA Cinematic World Prompt — tuned for Pixar-style 3D animated comedy ──
  const WORLD = [
    'Pixar-quality 3D animated feature film style.',
    'Expressive character proportions, rich tactile materials, cinematic lighting.',
    'Present-day Southern California at night: palm trees, tract homes, neon strip malls, freeway headlights, an observatory dome on a distant hill.',
    'Color: warm neon magenta/amber against cool ultraviolet/night-cyan; deep suburban blacks; soft sodium-orange streetlight glow.',
    'Character-focused animated comedy with moments of cosmic wonder. Specific, readable body language over abstract chaos.',
    'Cinematic 2.39:1 widescreen composition. Shallow depth of field where appropriate.',
    'No text, no subtitles, no watermarks, no logos.',
  ].join(' ');

  return [
    // ═══════════════════════════════════════════════════════════════════
    // COLD OPEN (S01–S04) — Meteor field, the smack, and Earth fills the window
    // ═══════════════════════════════════════════════════════════════════
    {
      id: 'S01',
      title: 'Meteor Field — The Starling Sputters',
      plot: 'EXT. SPACE — NIGHT. The Starling sputters through a meteor field. Warning lights flash. The ship is held together with tape, wires, and hope.',
      prompt: `${WORLD} ${STARLING} The junky oxidized-copper Voidborn explorer-class hull tumbling through a dense meteor field in deep space, warning running lights flashing across patch-plated panels, chunks of rock and ice streaming past, a bright blue-green planet growing large in the far distance. Tracking shot alongside the ship, debris whipping the frame, tension and comedy combined. Wide establishing space shot.`,
    },
    {
      id: 'S02',
      title: 'Cockpit — Zix Mid-Speech',
      plot: 'INT. STARLING COCKPIT — NIGHT. Zix grips the controls with theatrical intensity, mid-speech about Voidborn resolve. Mora braces. Pebb, tiny and wide-eyed, is strapped in. Drael lounges confidently. Nuni clutches a cracked tablet.',
      prompt: `${WORLD} ${ZIX} ${MORA} ${PEBB} ${DRAEL} ${NUNI} Cramped alien cockpit bathed in blinking amber warning light. Zix at the center console mid-speech, one arm raised dramatically, indigo skin catching red warning pulses. Mora in the engineer's seat braced hard against a bulkhead, two charred tools in her scarred four-fingered hands. Pebb strapped to a small jump-seat, oversized ears flicking, huge eyes terrified. Drael leaning back in the co-pilot seat, hair inexplicably perfect. Nuni hugging a bent tablet against her chest like a shield. Ensemble cockpit wide shot.`,
    },
    {
      id: 'S03',
      title: 'The Smack — Toilet Flies Past',
      plot: 'A meteor SMACKS the hull. The ship lurches. A metal toilet flies past. Pebb: "I am panicking in the face of that one specifically!"',
      prompt: `${WORLD} ${ZIX} ${PEBB} Inside the alien cockpit, violent impact shock — sparks raining from consoles, crew thrown sideways against harnesses. Mid-frame, absurdly, a gleaming chrome alien toilet airborne and tumbling past, trailing droplets. Pebb tiny and lavender in foreground mid-scream, bioluminescent fangs flashing, oversized ears blown back. Zix's dignified speech broken mid-word by pure terror. Comedic disaster shot, rich motion blur, warm amber sparks against indigo shadows.`,
    },
    {
      id: 'S04',
      title: 'Earth Fills the Window',
      plot: 'A giant BLUE PLANET fills the window. Zix: "Brace for emergency descent!" Pebb: "Can we die later? I just ate glow fruit!"',
      prompt: `${WORLD} ${ZIX} ${PEBB} Inside the alien cockpit, the front viewport now completely filled by the curve of Earth rushing up — atmospheric glow bloom on the canopy glass, whispers of clouds. Zix in center frame gripping the yoke, indigo jaw set, one hand raised for emphasis. In the foreground, Pebb in his harness clutching a half-eaten translucent pink-gold glow fruit that pulses softly with his heartbeat. Pull in tight on Pebb's panicked face reflected in the glow fruit's skin. Comedic dread.`,
    },

    // ═══════════════════════════════════════════════════════════════════
    // ACT 1 — RAVINE (S05–S10) — Crash, roll call, the Hiker
    // ═══════════════════════════════════════════════════════════════════
    {
      id: 'S05',
      title: 'Crash Through the Trees',
      plot: 'EXT. WOODS OUTSIDE A CALIFORNIA SUBURB — NIGHT. The ship crashes through pine and oak, rips a scar down a hill, and slams into a ravine.',
      prompt: `${WORLD} ${RAVINE} ${STARLING} The junky oxidized-copper Voidborn ship tumbling through a moonlit California pine forest, trunks snapping, branches exploding into splinters, a deep earth-scar ripping down a steep ravine slope behind it. Smoke and sparks trailing. Failing shield flickering pale green-blue. Cinematic wide action crash sequence, dynamic motion blur, dust and debris catching the moonlight.`,
    },
    {
      id: 'S06',
      title: 'Hatch Falls Open — Roll Call',
      plot: 'Silence. The hatch falls open. Zix crawls out, singed. Mora emerges carrying two scorched components. Pebb rolls out covered in potato chips somehow. Drael climbs out with perfect hair. Nuni steps out holding a bent tablet.',
      prompt: `${WORLD} ${RAVINE} ${ZIX} ${MORA} ${PEBB} ${DRAEL} ${NUNI} The crashed alien ship tilted at the bottom of a moonlit wooded ravine, thin smoke rising, hatch fallen open. Zix crawling out singed but dignified, Mora stepping out holding two charred machine components like they personally offended her, Pebb rolling out comically covered in American-brand potato chip bags, Drael climbing down the hull with hair impossibly perfect, Nuni last, hugging a bent alien tablet to her chest. Ensemble hero line-up shot. Cinematic moonlight, warm smoke backlighting.`,
    },
    {
      id: 'S07',
      title: 'First Look at Earth',
      plot: 'They stand together and look up at the dark treeline. A dog barks somewhere distant. The moon catches their faces.',
      prompt: `${WORLD} ${RAVINE} ${ZIX} ${MORA} ${PEBB} ${DRAEL} ${NUNI} Five Voidborn standing close together at the bottom of a moonlit ravine, all looking up and out toward a dark pine treeline at the ridge. Moonlight catching their varied alien skin tones — indigo, moss-green, pastel-lavender, iridescent bronze, pale blue-silver. Behind them, the smoking copper wreck of their ship, hatch still hanging open. Quiet beat. Awed, exhausted, alive. Wide hero ensemble shot with strong moonlight rim.`,
    },
    {
      id: 'S08',
      title: 'The Hiker Appears',
      plot: 'A branch snaps. A HUMAN HIKER appears at the top of the ravine with a flashlight, squinting down at them. "Hello? You guys okay down there?"',
      prompt: `${WORLD} ${RAVINE} ${HIKER} Low-angle shot from the ravine floor looking up. At the top of the ridge, silhouetted against the moonlit sky, a kindly mid-forties man in olive flannel over a thermal, sturdy hiking pants, headlamp over a beanie — politely shining a flashlight down the slope. A dog leash trailing from his other hand. The beam lands on five shocked alien faces in the foreground. Comedic first-contact composition.`,
    },
    {
      id: 'S09',
      title: 'Camouflage — Botched Disguises',
      plot: 'Mora slams a camouflage field generator. It fizzles weakly. The crew warps into five botched human approximations — purple-lipped tax accountant, six-eyebrowed woman, Victorian child, absurdly handsome guy, human drawn from memory.',
      prompt: `${WORLD} ${RAVINE} ${MORA} Close on Mora's scarred four-fingered hand slamming a glowing violet hand-sized Voidborn device onto her palm. Violet shimmer field washes outward. Pull back to reveal the five aliens mid-transformation: one fizzles into a purple-lipped tax accountant in a cheap beige blazer, one into a woman with six neatly-stacked eyebrows, one into a sickly Victorian-era child in an oversized thrifted coat, one into an absurdly dangerously-handsome young man with faintly glowing gold eyes still showing through, one into a human rendered from pure secondhand description — proportions slightly wrong, smile slightly off. Comic-horror ensemble transformation gag.`,
    },
    {
      id: 'S10',
      title: 'Hiker Leaves — Camouflage Flickers Off',
      plot: 'Hiker squints. "Uh... you folks in costume?" Zix: "Yes. Human costume. We are humans." The hiker shrugs, waves, wanders off. The camouflage flickers off with a violet fizzle.',
      prompt: `${WORLD} ${RAVINE} ${HIKER} The hiker at the top of a ravine shining a flashlight on five comically mismatched "humans" below, his politely confused expression clearly landing on 'none of my business'. He shrugs, gives a short wave, and walks off into the trees with his dog. Below, the violet camouflage field collapses with a soft electrical fizzle and the five aliens snap back to their true forms, exchanging enormously relieved glances. Two-beat comic moment, moonlit wide.`,
    },

    // ═══════════════════════════════════════════════════════════════════
    // ACT 1 — STRIP MALL (S11–S13) — Approach + humans
    // ═══════════════════════════════════════════════════════════════════
    {
      id: 'S11',
      title: 'Thrifted Clothes — Approaching the Strip Mall',
      plot: 'EXT. SUBURBAN EDGE — LATER. The crew approaches a late-night strip mall in stolen mismatched donation-bin clothes. Neon glows ahead like a mothership.',
      prompt: `${WORLD} ${STRIP_MALL} ${ZIX} ${MORA} ${PEBB} ${DRAEL} ${NUNI} Five small alien figures walking in silhouette across an empty asphalt lot toward a glowing Southern California strip mall at 1 AM. Their camouflage is down — they are in their true forms, wearing ridiculously mismatched donation-bin human clothes (oversized coat, grandma cardigan, neon tracksuit, flight jacket, floral muumuu). Palm trees at the lot edge, moths in the sign halos. Cinematic hero walk, warm neon pulling them in.`,
    },
    {
      id: 'S12',
      title: 'The Neon Sign',
      plot: 'Low-angle: the strip mall sign looms above them — TACO BELL, LIQUOR, NAILS, SMOKE SHOP, COIN LAUNDRY.',
      prompt: `${WORLD} ${STRIP_MALL} Low-angle hero shot of a Southern California strip mall pylon sign at 1 AM glowing with individual neon tenant boards: TACO BELL, LIQUOR, NAILS, SMOKE SHOP, COIN LAUNDRY. Palm tree silhouettes beside it. Gnats halo the bulbs. In the foreground at the bottom of the frame, five small alien figures staring up in awe, their tiny upturned faces lit by the colored neon — indigo, moss-green, lavender, bronze, silver-blue. Cinematic night.`,
    },
    {
      id: 'S13',
      title: 'Drael Discovers Earth',
      plot: 'A group of young humans laughs outside the taco place. A woman laughs loudly. Drael places a hand over his heart: "Zix. I understand Earth now."',
      prompt: `${WORLD} ${STRIP_MALL} ${DRAEL} A group of four young humans in their twenties standing outside a Taco Bell at night, laughing, warm restaurant light washing over them. Across the parking lot, Drael — in his true form, wearing an unzipped oversized hoodie over his flight jacket — watches them like a man having a religious experience, hand pressed to his chest, faintly glowing gold eyes soft with awe. Beside him, Zix (indigo, scandalized) is already opening his mouth to object. Character-focused two-shot.`,
    },

    // ═══════════════════════════════════════════════════════════════════
    // ACT 2 — CONVENIENCE STORE (S14–S20)
    // ═══════════════════════════════════════════════════════════════════
    {
      id: 'S14',
      title: 'Entering the Convenience Store',
      plot: 'INT. 24-HOUR CONVENIENCE STORE — NIGHT. The group enters awkwardly. Coolers hum. Fluorescent lights flatten everything. A tired CLERK at the counter looks up, one earbud in.',
      prompt: `${WORLD} ${STORE} ${ZIX} ${MORA} ${PEBB} ${DRAEL} ${NUNI} ${CLERK} Interior of a brightly-lit 24-hour convenience store at 1 AM, fluorescent ceiling flattening everything, rows of chips, candy, and magazines visible in the back. Five disguised alien figures just stepping through the glass door in a cautious cluster, wide-eyed. At the counter, a tired thirty-something clerk with an earbud in, leaning on one elbow, raising a single skeptical eyebrow. Sensory-overload establishing shot.`,
    },
    {
      id: 'S15',
      title: 'Nuni at the Magazine Rack',
      plot: 'Nuni studies celebrity magazines like sacred texts. "Humans worship high-status image-makers. Fascinating."',
      prompt: `${WORLD} ${NUNI} Medium close-up: Nuni (pale blue-silver, antennae drooping, scholar's robe peeking under an oversized thrifted cardigan) standing at a convenience-store magazine rack, one four-fingered hand tracing the glossy cover of a gossip magazine showing a movie star. Her amber eyes wide with anthropological reverence. A small alien tablet held discreetly at her side, stylus poised. Bright store light on her face. Warm character study.`,
    },
    {
      id: 'S16',
      title: 'Pebb Discovers Chips',
      plot: "Pebb discovers the chip aisle. 'Why are there forty flavors of the same triangle?' Mora: 'Because this planet is sick.'",
      prompt: `${WORLD} ${PEBB} ${MORA} Low-angle: Pebb (tiny, lavender, bandoliered) standing in front of a towering convenience-store chip wall, arms spread wide in open-mouthed religious awe at the forty flavors. Tiny fangs faintly glowing with excitement. Mora (moss-green, permanently unimpressed) stands behind him with arms crossed, delivering a dry look at camera. Cinematic comic reverence, two-shot with Pebb in hero pose.`,
    },
    {
      id: 'S17',
      title: 'Zix Questions the Clerk',
      plot: 'Zix approaches the counter. "We seek... rare machine components." Clerk (not looking up): "AutoZone is closed."',
      prompt: `${WORLD} ${STORE} ${ZIX} ${CLERK} Medium shot at the store counter. Zix, indigo and formal, leaning forward with his hands clasped diplomatically. The clerk, earbud in, does not look up from his phone, bored expression, half-eaten hot dog in a paper tray beside him. A small TV behind the counter plays local news on mute. Lotto tickets and cigarette signs fill the backdrop. Comedic deadpan two-shot.`,
    },
    {
      id: 'S18',
      title: 'Local News — Fireball Footage',
      plot: 'The store TV changes to local news: shaky cell-phone footage of a fireball over Santa Mira County. The crew freezes.',
      prompt: `${WORLD} ${STORE} Close on the small store TV above the counter. On screen: shaky vertical cell-phone footage of a fireball streaking over a dark California hillside, ANCHOR-style overlay graphics reading LOCAL NEWS. Subtle ghost reflection on the glass of five stunned alien faces in the store aisle behind, caught mid-freeze. Ominous comedic beat. Cinematic screen-within-screen composition.`,
    },
    {
      id: 'S19',
      title: 'Clerk Realizes',
      plot: "The clerk's security monitor shows the crew in their TRUE forms. He looks at the monitor. He looks at them. Slowly. 'Why do you guys look like that video?'",
      prompt: `${WORLD} ${STORE} ${CLERK} Close on the clerk behind the counter, his tired face slowly assembling a realization he did not sign up for. Behind him, the security monitor wall flickers — briefly showing the five aliens in the store aisle in their TRUE forms (indigo, green, lavender, bronze, silver-blue). His earbud slips out of his ear. He turns his head, slowly, toward the aisle. Behind him, the TV news still plays the fireball footage. Pure comedic dawning horror.`,
    },
    {
      id: 'S20',
      title: 'The Escape',
      plot: 'Pebb grabs a hot dog and hisses. Mora: "Run." They BOLT. Clerk (off-screen): "YOU DIDN\'T PAY FOR THOSE CHIPS!"',
      prompt: `${WORLD} ${STRIP_MALL} ${ZIX} ${MORA} ${PEBB} ${DRAEL} ${NUNI} Action wide: five alien figures bursting out of the convenience store through the glass door into the strip-mall parking lot at 1 AM, arms full of stolen snacks and random items — one clutching chips and a roller hot dog, one gripping a disposable burner phone, one holding novelty sunglasses, one gripping a bottle of lighter fluid. Through the glass, the clerk mid-shout. Motion blur. Comic-book action energy, palm trees and neon overhead.`,
    },

    // ═══════════════════════════════════════════════════════════════════
    // ACT 2 — PARKING LOT ESCAPE (S21–S22)
    // ═══════════════════════════════════════════════════════════════════
    {
      id: 'S21',
      title: 'Behind the Dumpster',
      plot: 'EXT. STRIP MALL — CONTINUOUS. A police cruiser rolls past the lot. The crew ducks behind dumpsters. Blue lights flash across their faces.',
      prompt: `${WORLD} ${STRIP_MALL} ${ZIX} ${MORA} ${PEBB} ${DRAEL} ${NUNI} Five alien figures crouched together behind a row of dumpsters in a strip-mall back lot, five different silhouettes lit by the pulsing blue-and-red of a passing police cruiser's lightbar out of frame. Close-cropped, comedic tension, the tops of their heads and eyes visible above the dumpster lid. Pebb clutching an armload of chip bags like a baby. Cinematic noir beat.`,
    },
    {
      id: 'S22',
      title: 'Loot Inventory',
      plot: 'Mora inventories the loot. "Chips, lighter fluid, novelty sunglasses, beef jerky... and..." She holds up a cheap disposable phone. "Actually, good."',
      prompt: `${WORLD} ${MORA} Close on Mora's scarred four-fingered hand spreading the stolen strip-mall loot on the asphalt beside a dumpster: a pile of colorful chip bags, a can of lighter fluid, novelty heart-shaped sunglasses, a plastic wrapped jerky strip, a cheap flip-style disposable burner phone. Her other hand raises the burner phone triumphantly. Her face — moss-green, unimpressed — is finally showing the ghost of a smirk. Overhead-angle product-beat shot with her reaction insert.`,
    },

    // ═══════════════════════════════════════════════════════════════════
    // ACT 2 — CAR WASH + RADIO (S23–S27)
    // ═══════════════════════════════════════════════════════════════════
    {
      id: 'S23',
      title: 'Into the Abandoned Car Wash',
      plot: 'EXT. ABANDONED CAR WASH — LATER THAT NIGHT. The crew hides out in an abandoned car wash near the suburb. Peeling paint, rusted brushes, puddles that never dry.',
      prompt: `${WORLD} ${CARWASH} ${ZIX} ${MORA} ${PEBB} ${DRAEL} ${NUNI} The five aliens sneaking into the open bay of an abandoned drive-thru car wash at night. Concrete tunnel with seized rusted mechanical brushes drooping from above, peeling paint, graffiti, puddles catching moonlight. Mora leads carrying the burner phone and a chunk of ship hull; the others file in behind, glancing over their shoulders. Cool moonlit-industrial noir palette.`,
    },
    {
      id: 'S24',
      title: 'Mora Builds the Radio',
      plot: "Mora has the disposable phone dismantled, wired to a ship fragment and a stolen radio. 'If I piggyback local towers, boost with our emergency beacon, and filter out human spam—'",
      prompt: `${WORLD} ${CARWASH} ${MORA} Close, intimate low-angle shot: Mora kneeling on wet car-wash concrete, the burner phone opened and its back removed, copper wiring and iridescent alien filaments twisting into a dull-metal Voidborn ship hull fragment the size of a small book, cabled into a thrifted handheld radio. A single indicator light at the junction pulses green-blue. Her moss-green face is lit from below by the rig's glow, focused and smirking. Macro detail on her scarred hands.`,
    },
    {
      id: 'S25',
      title: 'Radio Crackles Alive',
      plot: 'The radio bursts alive with static, music, conspiracy podcasts, and nonsense. The crew gathers close, faces lit by the glow.',
      prompt: `${WORLD} ${CARWASH} ${ZIX} ${MORA} ${PEBB} ${DRAEL} ${NUNI} Medium-wide: the five aliens cluster in the middle of the abandoned car wash tunnel around the improvised radio rig on the concrete, faces lit from below by the rig's green-blue glow. The radio is audibly bursting with overlapping human noise — visible as small iconic waveforms and sparks of energy drifting from the speaker: snippets of pop music, late-night talk, static. Expressions range from skeptical (Mora) to delighted (Pebb) to tense (Zix). Moody noir glow.`,
    },
    {
      id: 'S26',
      title: 'The Sleeper Voice',
      plot: "A distorted voice cuts through: 'Do not trust the flea market man. Repeat, do not trust Hector. Meet at the old observatory before dawn. Use no active tech. Humans are watching.'",
      prompt: `${WORLD} ${CARWASH} Close on the improvised radio rig on the wet concrete, the green-blue indicator light pulsing differently now — sharper, more deliberate. Violet sparks of signal energy arc out of the ship-hull fragment. The air around the speaker is drawn with faint visible sound-wave ripples in a cool violet tone — the voice is Voidborn in origin. In the soft background bokeh, five alien faces lean in, eyes wide. Close-focus on the rig, shallow depth, supernatural undertone.`,
    },
    {
      id: 'S27',
      title: 'Earth Changes You',
      plot: "Before the signal dies: 'To any Voidborn survivors: Earth changes you. That is your first warning.' The radio cuts out. The aliens stare at each other.",
      prompt: `${WORLD} ${CARWASH} ${ZIX} ${MORA} ${PEBB} ${DRAEL} ${NUNI} Tight group portrait: the five aliens frozen in the moment just after the radio cuts out, all of their faces caught mid-reaction — dread, curiosity, wonder, confusion. The rig on the concrete has gone dark. A single trailing violet spark drifts up between them. Moonlight through the open car-wash bay behind. The five of them silhouetted as the credits of their known reality quietly roll. Emotional ensemble beat.`,
    },

    // ═══════════════════════════════════════════════════════════════════
    // ACT 2 — THE TEEN ENCOUNTER (S28–S30)
    // ═══════════════════════════════════════════════════════════════════
    {
      id: 'S28',
      title: 'Teens Pull Into the Lot',
      plot: 'A cheap sedan pulls into the car wash lot. Two TEEN BOYS get out with energy drinks, backpacks, and phones ready. "Bro, this is where the meteor landed, I swear."',
      prompt: `${WORLD} ${CARWASH} ${TEENS} Exterior wide: a cheap teenage-owned sedan pulling into an abandoned car wash parking lot at night, headlights sweeping across the concrete, two teenage boys climbing out excited — one lanky in an oversized hoodie and backwards cap holding a selfie-mode phone, one heavier in a zip hoodie and basketball shorts with a backpack and energy drink. Their breath visible in the cold air. In the background, the dark mouth of the abandoned car wash, a subtle green-blue glow just visible inside.`,
    },
    {
      id: 'S29',
      title: '"Greetings."',
      plot: 'The teens shine their phone flashlights into the dark car wash. One beam catches Drael\'s glowing gold eyes. Drael slowly smiles: "Greetings."',
      prompt: `${WORLD} ${CARWASH} ${DRAEL} ${TEENS} Inside the mouth of the abandoned car wash at night. Foreground: two teen boys with their phone flashlights aimed into the darkness, mouths half-open. Background: out of the shadow, only two things visible — Drael's two faintly glowing gold alien eyes, and a calm confident half-smile. Four blurred alien shapes hunched behind him facepalming in the dark. The universal language of 'do not do this, Drael.' Comic-horror composition.`,
    },
    {
      id: 'S30',
      title: 'Teens Flee',
      plot: 'The teens SCREAM and run back to their car. Tires squeal. They floor it out of the lot. The aliens watch them go.',
      prompt: `${WORLD} ${CARWASH} ${DRAEL} ${TEENS} Exterior: the cheap teen sedan peeling out of the abandoned car wash parking lot, brake lights glowing red, tire smoke billowing, the two teens visible through the rear window mid-scream, phones still clutched in their hands. At the mouth of the car wash, Drael stands calmly with a serene half-smile, glowing gold eyes catching the retreating brake lights. Behind him in silhouette, Zix has buried his face in both hands. Comic-heroic composition.`,
    },

    // ═══════════════════════════════════════════════════════════════════
    // TAG — HILLTOP AT PRE-DAWN (S31–S35)
    // ═══════════════════════════════════════════════════════════════════
    {
      id: 'S31',
      title: 'Climbing the Hill at Pre-Dawn',
      plot: 'EXT. HILLSIDE — PRE-DAWN. The crew climbs a bald hill overlooking the sleeping suburb. The sky is just beginning to fade from black to violet.',
      prompt: `${WORLD} ${LOOKOUT} ${ZIX} ${MORA} ${PEBB} ${DRAEL} ${NUNI} Wide hero shot: five small alien figures climbing the bald grass of a Southern California hill at pre-dawn, backs three-quartered to camera, sky overhead fading from black-purple to deep violet. Below in the middle distance, a sleeping suburb of tract homes, palm trees, and glowing fast-food signs. On a far hill, the white dome of an observatory catching the first hints of blue-gold light. Cinematic dawn climb, cool dew in the grass.`,
    },
    {
      id: 'S32',
      title: 'Zix Declares the Mission',
      plot: 'Zix stands at the crest, resolved. "We go to the observatory. We contact the network. We repair the ship. And we leave Earth immediately."',
      prompt: `${WORLD} ${LOOKOUT} ${ZIX} Low-angle hero portrait: Zix standing alone at the hilltop crest, silhouetted against the pre-dawn violet-gold sky, the sleeping city glowing in the valley behind him, one hand gesturing off toward the distant observatory dome. His indigo skin catches the cool-warm dawn. Full-command dramatic posture, sash billowing slightly in the wind. Cinematic resolve.`,
    },
    {
      id: 'S33',
      title: 'Nobody Is Eager To Leave',
      plot: 'Zix turns and sees every other crew member staring at the glowing suburb with a look he does not want to see. Nobody looks eager to leave.',
      prompt: `${WORLD} ${LOOKOUT} ${MORA} ${PEBB} ${DRAEL} ${NUNI} Medium four-shot: Mora, Pebb, Drael, and Nuni standing shoulder-to-shoulder on a bald hilltop at pre-dawn, all four staring out at the sleeping suburb below with identical expressions of soft, unguarded wonder — Mora reluctantly charmed, Pebb in open snack-love, Drael smitten with everything, Nuni's antennae perked with genuine curiosity. The city glow catching their faces warm against the cool dawn. Character-driven ensemble reveal.`,
    },
    {
      id: 'S34',
      title: 'Helicopter and Taco Wrapper',
      plot: 'A helicopter crosses the sky with a blinking red light. A taco wrapper blows past their feet. The suburb hums below.',
      prompt: `${WORLD} ${LOOKOUT} ${ZIX} ${MORA} ${PEBB} ${DRAEL} ${NUNI} Wide composition: five Voidborn silhouettes on the bald hilltop, backs to camera, watching a single helicopter drift across the fading-violet sky with a blinking red light. In the foreground lower frame, a colorful Taco Bell paper wrapper blowing across the dewy grass past their boots. Below, the sleeping suburb's sodium-orange streetlights and freeway headlight ribbon. A subtle warm California breeze. Cinematic quiet beat, pre-dawn tone.`,
    },
    {
      id: 'S35',
      title: 'The Signal Blinks Back',
      plot: "From the dead radio, a last whisper: 'Earth changes you. That is your first warning.' Deep in the suburb below, one tiny blue-green signal blinks back. They are not alone. CUT TO BLACK. Title: VOIDBORN SAGA.",
      prompt: `${WORLD} ${LOOKOUT} The final shot. Wide aerial composition over the sleeping Southern California suburb at pre-dawn, five tiny alien silhouettes visible on a hilltop in the upper frame, the valley below them dotted with tract-home lights and glowing fast-food signs. Deep in the city, a single tiny blue-green pinprick of signal light blinks on, off, on — too small for the crew to notice but unmistakable to the audience. The dome of the observatory on the far hill catches the very first blue-gold ray of sunrise. The last frame. The hook. CUT TO BLACK.`,
    },
  ];
}

// ── Main ────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('  VOIDBORN SAGA — Pilot: "Crash Landing"');
  console.log('  35 Scenes × 10s = ~6 min core footage');
  console.log(`  Seedance 2.0 → On-chain | Mode: ${GEN_MODE.toUpperCase()}`);
  console.log('═'.repeat(60));

  if (UNIVERSE_ADDR === '0x0000000000000000000000000000000000000000') {
    console.error('\n  ERROR: Set VOIDBORN_ADDR env var to the deployed universe address.');
    process.exit(1);
  }
  if (!BYTEDANCE_API_KEY) {
    console.error('\n  ERROR: BYTEDANCE_API_KEY not set.');
    process.exit(1);
  }

  log('AUTH', 'Authenticating...');
  const token = await getAuthToken();
  log('AUTH', `Authenticated as ${account.address}`);

  const dna = await fetchCharacterDNA(token);
  const SCENES = buildScenes(dna);

  const startIdx = SCENES.findIndex((s) => s.id === START_SCENE);
  if (startIdx < 0) {
    console.error(`  ERROR: START_SCENE=${START_SCENE} not found.`);
    process.exit(1);
  }
  if (startIdx > 0) {
    log('RESUME', `Skipping to ${START_SCENE} (scene ${startIdx + 1}/${SCENES.length})`);
  }

  const balance = await publicClient.getBalance({ address: account.address });
  log('SETUP', `Balance: ${(Number(balance) / 1e18).toFixed(4)} ETH`);

  const latestId = (await publicClient.readContract({
    address: UNIVERSE_ADDR,
    abi: universeAbi,
    functionName: 'latestNodeId',
  })) as bigint;
  log('SETUP', `Latest node: #${latestId}`);

  let previousId = latestId;
  const results: Array<{ id: string; title: string; nodeId: bigint }> = [];
  let lastFrameUrl: string | null = RESUME_FRAME || null;

  if (lastFrameUrl) log('RESUME', `Using frame from previous run: ${lastFrameUrl}`);
  log(
    'MODE',
    GEN_MODE === 'continuity'
      ? 'CONTINUITY — sequential i2v chaining (slower, visually cohesive)'
      : `FAST — parallel t2v batches of ${BATCH_SIZE} (faster, less cohesive)`
  );

  if (GEN_MODE === 'continuity') {
    for (let i = startIdx; i < SCENES.length; i++) {
      const scene = SCENES[i];
      const label = `${scene.id} (${i + 1}/${SCENES.length})`;

      console.log(`\n${'═'.repeat(55)}`);
      console.log(`  ${scene.id}: ${scene.title}`);
      console.log(`${'═'.repeat(55)}`);

      try {
        const videoUrl = await generateVideo(scene.prompt, label, lastFrameUrl);
        const contentHash = `void-${scene.id}-${Date.now()}`;
        const nodeId = await createNode(contentHash, scene.plot, previousId, videoUrl, label);
        previousId = nodeId;
        results.push({ id: scene.id, title: scene.title, nodeId });
        log(label, `DONE — Node #${nodeId}`);
        lastFrameUrl = await extractLastFrame(videoUrl, `${scene.id} FRAME`);
      } catch (err: any) {
        log(label, `FAILED: ${err.message?.slice(0, 200)}`);
      }

      if (i < SCENES.length - 1) await sleep(2000);
    }
  } else {
    for (let batchStart = startIdx; batchStart < SCENES.length; batchStart += BATCH_SIZE) {
      const batch = SCENES.slice(batchStart, Math.min(batchStart + BATCH_SIZE, SCENES.length));

      console.log(`\n${'═'.repeat(55)}`);
      console.log(
        `  BATCH: ${batch[0].id}–${batch[batch.length - 1].id} (${batch.length} scenes parallel)`
      );
      console.log(`${'═'.repeat(55)}`);

      const videoResults = await Promise.allSettled(
        batch.map((scene, idx) => {
          const label = `${scene.id} (${batchStart + idx + 1}/${SCENES.length})`;
          const startImg = idx === 0 ? lastFrameUrl : null;
          return generateVideo(scene.prompt, label, startImg).then((url) => ({
            scene,
            url,
            label,
          }));
        })
      );

      let lastVideoUrl: string | null = null;
      for (let j = 0; j < videoResults.length; j++) {
        const result = videoResults[j];
        const scene = batch[j];
        const label = `${scene.id} (${batchStart + j + 1}/${SCENES.length})`;

        if (result.status === 'fulfilled') {
          try {
            const contentHash = `void-${scene.id}-${Date.now()}`;
            const nodeId = await createNode(
              contentHash,
              scene.plot,
              previousId,
              result.value.url,
              label
            );
            previousId = nodeId;
            results.push({ id: scene.id, title: scene.title, nodeId });
            lastVideoUrl = result.value.url;
            log(label, `DONE — Node #${nodeId}`);
          } catch (err: any) {
            log(label, `CHAIN FAILED: ${err.message?.slice(0, 200)}`);
          }
        } else {
          log(label, `VIDEO FAILED: ${(result.reason as Error)?.message?.slice(0, 200)}`);
        }
      }

      if (lastVideoUrl) {
        lastFrameUrl = await extractLastFrame(lastVideoUrl, `${batch[batch.length - 1].id} FRAME`);
      }

      log('BATCH', `Completed ${batch[0].id}–${batch[batch.length - 1].id}`);
      if (batchStart + BATCH_SIZE < SCENES.length) await sleep(2000);
    }
  }

  console.log('\n' + '═'.repeat(60));
  console.log('  VOIDBORN SAGA — Pilot Episode Generation Complete');
  console.log('═'.repeat(60));
  console.log(`  Scenes completed: ${results.length}/${SCENES.length - startIdx}`);
  console.log(`  Total footage: ~${results.length * 10}s`);
  if (results.length > 0) {
    console.log(`  Node chain: ${results.map((r) => `#${r.nodeId}`).join(' → ')}`);
  }
  console.log('');
  for (const r of results) {
    console.log(`  ${r.id} | ${r.title.padEnd(40)} | Node #${r.nodeId}`);
  }
  console.log(`\n  Universe: ${UNIVERSE_ADDR}`);
  console.log(`  Next: Run voidborn-saga-audio-pipeline.ts for voice, SFX & music\n`);
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
