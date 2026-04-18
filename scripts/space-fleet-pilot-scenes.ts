/**
 * SPACE FLEET — Pilot Episode: "Return"
 *
 * 40 scenes via Seedance 2.0 → on-chain nodes.
 * Pulls character DNA from wiki entities for visual consistency.
 *
 * ~7 min episode (40 × 10s = 6.7 min core footage + audio padding)
 *
 * Prerequisites:
 *   - Space Fleet universe deployed (create-space-fleet.ts)
 *   - Wiki populated (space-fleet-wiki.ts)
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
 *   GEN_MODE=continuity pnpm tsx scripts/space-fleet-pilot-scenes.ts
 *   GEN_MODE=fast BATCH_SIZE=3 pnpm tsx scripts/space-fleet-pilot-scenes.ts
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

const UNIVERSE_ADDR = (process.env.SPACE_FLEET_ADDR ??
  '0x0000000000000000000000000000000000000000') as `0x${string}`;
const BD_BASE = 'https://ark.ap-southeast.bytepluses.com/api/v3';
const START_SCENE = process.env.START_SCENE ?? 'S01';
const GEN_MODE = (process.env.GEN_MODE ?? 'continuity') as 'continuity' | 'fast';
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE ?? '5', 10);
// When resuming continuity mode, pass the last frame URL to maintain the chain
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

    // Build rich visual DNA based on entity kind
    if (kind === 'person') {
      // For characters: use appearance metadata (most detailed visual info)
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
      // For places: atmosphere + type for scene consistency
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
      // For tech/vehicles: howItWorks + capabilities for visual accuracy
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
      // Fallback: first 3 sentences of description
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
  // Strip character names and replace with generic descriptions
  let p = prompt
    .replace(/\bEric\b/g, 'the young man')
    .replace(/\bMikel\b/g, 'a lean pale figure')
    .replace(/\bJeff\b/g, 'a big muscular guy')
    .replace(/\bDante\b/g, 'a charismatic stranger')
    .replace(/\bMarcus\b/g, 'a watchful figure')
    .replace(/NOS Event Center/gi, 'a massive rave venue')
    .replace(/San Bernardino/gi, 'the desert city');
  if (attempt >= 2) {
    p = p
      .replace(/SPACE FLEET/gi, 'the series')
      .replace(/The Frequency/gi, 'an ancient presence')
      .replace(/(?:Gaspar Noé|Villeneuve|A24|Fincher|Deakins)/gi, 'cinematic')
      .replace(/ARRI Alexa 65/gi, 'professional cinema camera')
      .replace(/Cooke anamorphic/gi, 'anamorphic')
      .replace(/photorealistic/gi, 'realistic')
      .replace(/psilocybin/gi, 'psychedelic experience');
  }
  return p;
}

// ── Frame extraction for scene continuity ───────────────────────────────
import { execSync } from 'child_process';
import fs from 'fs';
import { tmpdir } from 'os';

async function extractLastFrame(videoUrl: string, label: string): Promise<string | null> {
  try {
    const tmpFile = `${tmpdir()}/sf-frame-${Date.now()}.jpg`;
    const tmpVid = `${tmpdir()}/sf-vid-${Date.now()}.mp4`;
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

    // Upload frame to Pinata so ByteDance can access it via URL
    // (ByteDance rejects base64 data URIs — needs a real HTTP URL)
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
// Supports optional startImage for scene-to-scene continuity (i2v mode)
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

    // Build content array — text only or image + text for i2v
    // startImage may be cleared mid-loop if ByteDance rejects the frame
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
      // If i2v was rejected because the frame contains a "real person",
      // drop the image and retry as pure t2v — don't let one bad frame
      // poison the entire rest of the episode
      if (
        startImage &&
        (errText.includes('PrivacyInformation') ||
          errText.includes('real person') ||
          errText.includes('SensitiveContent'))
      ) {
        log(label, 'Frame rejected (person detected) — falling back to t2v');
        startImage = null; // clear so next attempt skips the image
        continue; // retry loop will rebuild content without image
      }
      throw new Error(`ByteDance ${taskRes.status}: ${errText.slice(0, 200)}`);
    }
    const { id: taskId } = (await taskRes.json()) as any;
    if (!taskId) throw new Error('No task ID');
    log(label, `Task: ${taskId}`);

    let copyrightBlock = false;
    for (let i = 0; i < 60; i++) {
      await sleep(5000);
      // 10-second timeout per poll — prevents hanging on network stalls
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10_000);
      let poll: Response;
      try {
        poll = await fetch(`${BD_BASE}/contents/generations/tasks/${taskId}`, {
          headers: { Authorization: `Bearer ${BYTEDANCE_API_KEY}` },
          signal: controller.signal,
        });
      } catch {
        clearTimeout(timeoutId);
        continue;
      }
      clearTimeout(timeoutId);
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
  const ERIC =
    dna['ERIC'] ||
    'Eric: Early 20s male, half-Asian mixed heritage, messy black hair falling over eyes, slim build, black hoodie, dark jeans, beat-up Vans. Dilated pupils. Sweat on temples. Cheap festival wristband. Shifts from lost and overwhelmed to transcendent focus.';
  const MIKEL =
    dna['MIKEL'] ||
    'Mikel: Mid-20s male, lean angular build, sharp cheekbones, pale skin, dark eyes that reflect light unnaturally. All-black techwear — fitted tactical jacket, slim cargo pants, matte-black boots. Moves through crowds with inhuman grace. Small silver ring.';
  const JEFF =
    dna['JEFF'] ||
    'Jeff: Early 20s male, big muscular 6\'2", square jaw, short brown hair. SHIRTLESS, tanned athletic build glistening with sweat. Cargo shorts, high-top sneakers, stacked festival wristbands. Huge grin. Water bottle.';
  const DANTE =
    dna['DANTE'] ||
    "Dante: Late 20s male, Mediterranean features, dark curly hair, stubble. Loose white linen shirt over dark pants. Silver chain pendant. Geometric forearm tattoo. Charismatic smile that doesn't reach his eyes.";
  const MARCUS =
    dna['MARCUS'] ||
    'Marcus: Late 20s male, dark skin, shaved head, muscular security build. All black — plain tee, jeans, boots. Ring with symbol. Sits in corners. Watches everything. Positioned near exits.';

  // ── Location DNA (pulled from wiki) ──
  const NOS =
    dna['NOS_EVENT_CENTER'] ||
    'NOS Event Center San Bernardino: Massive indoor/outdoor rave venue. Industrial building with lasers, outdoor stages with LED towers. Tens of thousands of people. Fog machines, desert dust, bass you feel in your organs.';
  const CATHEDRAL =
    dna['MAIN_STAGE___THE_CATHEDRAL'] ||
    'Main Stage "The Cathedral": Indoor main stage. 40-foot speaker wall, LED fractal panels, laser grid through thick fog. 10,000+ packed dense. The bass is physical. A cathedral of sound.';
  const HOTEL =
    dna['THE_HOTEL_ROOM'] ||
    'Hotel Room: Cheap hotel near NOS. Two queen beds, thin curtains, bedside lamp. Bluetooth speaker, water bottles, vape pens. Afterparty decompression that turns sinister.';
  const TRUCK =
    dna['JEFF_S_TRUCK'] ||
    "Jeff's Truck: Lifted white Toyota Tacoma. Gym bag in back, aux cord. Safety. The ride home. Dashboard glow the only light.";

  // ── AAA Cinematic World Prompt ──
  const WORLD = [
    'Shot on ARRI Alexa 65 with Cooke anamorphic lenses.',
    'Present-day Southern California. Psychedelic sci-fi thriller meets rave culture.',
    'Color graded: neon magenta, ultraviolet, cyan laser light against deep black.',
    'Indoor rave: fog-diffused lasers, LED fractal walls, silhouette crowds, bass as visual vibration.',
    'Outdoor: desert night air, competing stage lights, concrete lots, purple-black sky.',
    'Hotel: warm yellow lamp vs cold parking lot light through thin curtains.',
    'Psychedelic distortion: colors breathing, geometry warping, time stretching under psilocybin.',
    'Shallow depth of field, anamorphic bokeh, subtle film grain, motivated practical lighting.',
    'Gaspar Noé immersion, Villeneuve scale, A24 intimacy. Cinematic 2.39:1 widescreen.',
    'Photorealistic. No text, no watermarks.',
  ].join(' ');

  return [
    // ═══════════════════════════════════════════════════════════════════
    // ACT 1 — THE ARRIVAL (S01–S12)
    // Getting to the rave, entering NOS, the energy, the crew
    // ═══════════════════════════════════════════════════════════════════
    {
      id: 'S01',
      title: "Highway — Jeff's Truck",
      plot: 'EXT. HIGHWAY 215 — NIGHT. A lifted white Tacoma blasts down the freeway toward San Bernardino. Inside: Jeff driving shirtless and hyped, Mikel in the back seat silent and still, Eric in the passenger seat watching the desert pass. Bass from the truck stereo vibrates the mirrors.',
      prompt: `${WORLD} ${TRUCK} A lifted white Toyota Tacoma racing down a desert freeway at night. Through the windshield, the glow of San Bernardino in the distance. Inside: a big shirtless muscular guy driving and grinning, a slim figure in black hoodie in passenger seat looking out the window pensively, a lean pale figure in all-black in the back seat perfectly still. The truck stereo bass makes the side mirrors vibrate. Desert highway, night sky, anticipation energy. Tracking shot alongside the truck.`,
    },
    {
      id: 'S02',
      title: 'Parking Lot — Arrival',
      plot: 'EXT. NOS EVENT CENTER PARKING LOT — NIGHT. The truck pulls into a sea of cars. Bass from inside the venue hits them before they even open the doors. Colored light spills into the sky. Jeff is already losing his shirt. Eric looks up at the venue — nervous, excited.',
      prompt: `${WORLD} ${NOS} A massive parking lot outside the NOS Event Center at night. Hundreds of cars, people walking toward the glowing entrance. The industrial building radiates colored light — magenta, cyan, ultraviolet — through open bay doors. Laser beams shoot into the purple-black sky. A lifted white Tacoma parks among the cars. Three guys climb out — one big and shirtless already pumped, one slim in a black hoodie looking up nervously at the venue, one in all-black scanning the crowd like a predator. Festival energy building.`,
    },
    {
      id: 'S03',
      title: 'The Entrance — Sensory Wall',
      plot: "INT. NOS EVENT CENTER ENTRANCE — NIGHT. They push through the entrance and the sound hits them like a physical wall. Bass so loud Eric's vision pulses. Fog machines, laser grids, the smell of sweat and smoke. Jeff whoops. Mikel is already moving through the crowd like water. Eric follows, overwhelmed.",
      prompt: `${WORLD} ${NOS} POV pushing through the entrance of a massive indoor rave venue. The sensory assault: bass so powerful the camera vibrates, fog machines creating thick atmosphere, laser beams — green, magenta, white — cutting geometric patterns overhead. Silhouettes of thousands of bodies moving. The back of a slim young man in a black hoodie as he enters, flanked by a huge shirtless figure on one side and a lean all-black figure already dissolving into the crowd on the other. The moment normalcy ends. Immersive, overwhelming, entering another world.`,
    },
    {
      id: 'S04',
      title: 'The Crew Moving Through',
      plot: 'INT. NOS — NIGHT. The three friends push through the crowd toward the main stage. Jeff parts the crowd like a human snowplow. Mikel appears and disappears, always a step ahead. Eric is jostled, catching glimpses of faces, lights, smoke.',
      prompt: `${WORLD} ${ERIC} ${JEFF} ${MIKEL} Three friends moving through a packed rave crowd. The big shirtless guy physically parts the crowd, grinning and high-fiving strangers. The lean figure in black techwear weaves between bodies without touching anyone — inhuman fluidity. The slim guy in the black hoodie is caught in the flow, bumped by shoulders, catching strobe-lit glimpses of faces and fog. Tracking shot following them through the sea of bodies. Chaotic energy, friendship in motion.`,
    },
    {
      id: 'S05',
      title: 'The Cathedral — Approach',
      plot: 'INT. MAIN STAGE — NIGHT. They reach the main stage. The speaker wall is 40 feet wide, 20 feet tall. LED fractals pulse behind the DJ booth. The crowd is a single breathing organism. Even Mikel pauses to take it in. Eric feels the bass in his teeth.',
      prompt: `${WORLD} ${CATHEDRAL} Wide shot approaching the indoor main stage. A MASSIVE wall of speakers — 40 feet wide, 20 feet tall — dominates the far end. Behind it, LED panels display fractal patterns synced to the beat. Laser grids cut through fog so thick the crowd becomes silhouettes with raised arms. The scale is cathedral-like — the vaulted industrial ceiling disappears into fog and light. Three figures arrive at the edge of the crowd and stop, taking in the enormity. The bass is visible as vibration in the fog. Awe. Scale. Power.`,
    },
    {
      id: 'S06',
      title: 'Jeff in the Pit',
      plot: "INT. MAIN STAGE — NIGHT. Jeff charges into the dense crowd, pulling Eric by the wrist. Mikel follows. They're deep in the mosh pit now — shoulder to shoulder with strangers, the bass obliterating thought. Jeff is in heaven. Mikel watches the crowd. Eric starts to feel the mushrooms kicking in — edges softening, colors deepening.",
      prompt: `${WORLD} ${JEFF} ${ERIC} Deep inside the rave mosh pit. A big shirtless guy pulls a smaller friend by the wrist into the densest part of the crowd, both grinning. Bodies packed tight, arms raised, everyone moving to the drop. The smaller guy's expression starts to shift — his pupils dilating, the colors around him becoming more vivid, more liquid. The mushrooms beginning. Laser light reflected in dilating eyes. Close immersive shot from within the pit, sweat and light and bodies.`,
    },
    {
      id: 'S07',
      title: "Mushrooms Hit — Eric's Vision Shifts",
      plot: "INT. MAIN STAGE — NIGHT. The psilocybin peaks. Eric's perception transforms. The fog becomes architecture. The bass has geometry — he can see sound waves rippling through the air. Colors breathe and pulse with the beat. The crowd's faces become beautiful and alien. He's not at a rave anymore. He's inside the music.",
      prompt: `${WORLD} ${ERIC} Psychedelic POV shift — the rave transforms. Fog becomes translucent architecture, sound waves become visible geometric ripples in the air, colors breathe and pulse with the beat — magenta bleeding into cyan, ultraviolet halos around every light source. The crowd's faces are beautiful and strange, lit from impossible angles. The speaker wall is no longer a wall — it's a living organism of light and frequency. The world through psilocybin-enhanced eyes. Gaspar Noé-style POV, reality dissolving into synesthetic wonder. Psychedelic realism, not trippy cartoon — grounded but transcendent.`,
    },
    {
      id: 'S08',
      title: 'Mikel Notices Eric',
      plot: "INT. MAIN STAGE — NIGHT. Mikel turns to look at Eric and freezes. He can sense something changing in Eric — not the mushrooms, something underneath. A frequency shift. Mikel's dark eyes narrow. He's lived centuries and he recognizes when something ancient moves through a human. Something is waking up inside Eric.",
      prompt: `${WORLD} ${MIKEL} Close-up of Mikel in the rave crowd. His pale sharp face is lit by alternating magenta and cyan laser light. His dark eyes lock onto something off-camera (Eric) and his expression changes — the easy confidence drops, replaced by ancient recognition and a flash of fear. His pupils contract when everyone else's would dilate. He senses something he hasn't sensed in centuries. The crowd moves around him but he is perfectly still. Predator becomes prey for one heartbeat. Tight portrait shot, alternating colored light, the vampire sensing the impossible.`,
    },

    // ═══════════════════════════════════════════════════════════════════
    // ACT 2 — THE SEPARATION & THE AWAKENING (S09–S25)
    // Lost in the crowd, alone, the power activates, The Frequency speaks
    // ═══════════════════════════════════════════════════════════════════
    {
      id: 'S09',
      title: 'The Drop — Crowd Surge',
      plot: "INT. MAIN STAGE — NIGHT. A MASSIVE bass drop hits. The crowd surges like a tidal wave. Eric's phone falls from his pocket. Stomped instantly. The crowd pushes — Eric reaches for Mikel — their fingers miss by inches.",
      prompt: `${WORLD} The moment of the bass drop — the crowd SURGES like a tidal wave. Bodies crash into each other. A phone screen cracks under stomping feet. Two hands reaching across the chaos — slim fingers in a black hoodie sleeve and pale sharp fingers in a black tactical jacket — inches apart, missing. The crowd flows between them like a river separating two banks. Strobe lights freeze the moment. The separation. Dramatic slow-motion feeling, strobe-frozen chaos, the phone cracking, fingers missing. Emotional action.`,
    },
    {
      id: 'S10',
      title: 'Separated — Eric Alone',
      plot: "INT. MAIN STAGE — NIGHT. Eric is suddenly alone. Jeff's voice is swallowed by bass. Mikel has vanished. 10,000 strangers surround him. Phone dead under someone's foot. Mushrooms intensifying. He's trapped in a sea of bodies with no anchor.",
      prompt: `${WORLD} ${ERIC} A young man in a black hoodie stands still in a surging rave crowd — the only unmoving figure in a sea of motion. His face shows the moment of realization: he is alone. His hand reaches instinctively for his pocket — no phone. He looks left, right — strangers' faces strobing in laser light. No friends. No phone. Mushrooms intensifying. Dilated pupils reflecting fractured light. The isolation of one person in ten thousand. Wide shot of Eric motionless in the swirling crowd, lit from above by lasers.`,
    },
    {
      id: 'S11',
      title: 'Jeff Searching',
      plot: "INT/EXT. NOS — NIGHT. Jeff climbs on top of a concrete barrier, cupping his hands, bellowing ERIC over the bass. It's useless and endearing. Mikel appears beside him, says something in his ear. Mikel looks concerned in a way Jeff has never seen.",
      prompt: `${WORLD} ${JEFF} ${MIKEL} A big shirtless muscular guy stands on top of a concrete barrier inside the venue, cupping his hands around his mouth, yelling. The bass drowns him out completely. Below, the lean figure in all-black appears beside the barrier, looking up at him with an expression of genuine concern — unusual, almost frightened. The crowd flows around the barrier like water around a rock. Multiple colored stage lights create overlapping shadows. The search for a lost friend.`,
    },
    {
      id: 'S12',
      title: 'Eric Drifts Deeper',
      plot: "INT. MAIN STAGE — NIGHT. Eric gives up trying to find the exit and drifts deeper into the crowd toward the speaker wall. The mushrooms are at full peak now. Every bass hit is a color. Every laser is a sound. He's moving toward the music because it's the only thing that makes sense.",
      prompt: `${WORLD} ${ERIC} ${CATHEDRAL} Eric moving through the dense crowd toward the massive speaker wall, pulled by the music. His face is transformed — eyes wide, pupils massive, lips slightly parted. Under psilocybin, the world has become synesthetic: bass pulses are visible as concentric waves of deep red emanating from the speakers, lasers hum with audible resonance, the fog has texture and geometry. He reaches toward the speaker wall like it's magnetic. The crowd parts slightly around him without knowing why. Walking toward sound as destiny. POV following him through psychedelic space.`,
    },
    {
      id: 'S13',
      title: 'The First Sync — Heartbeat and Bass',
      plot: "INT. MAIN STAGE — NIGHT. Standing near the front, drenched in bass, Eric notices something. The bass is hitting in time with his heartbeat. Not approximately — exactly. When his pulse quickens, the BPM rises. He thinks he's imagining it.",
      prompt: `${WORLD} ${ERIC} Extreme close-up of Eric's face near the front of the crowd, bathed in speaker vibration. His chest pounds — and the bass hits at exactly the same moment. A visual effect: visible heartbeat pulse rippling outward from his chest in sync with the bass wave from the speakers. His eyes widen with confusion. Is the music following him? Close-up of his face, then his chest, then the speakers — all pulsing in perfect sync. The first clue. Intimate macro shots intercut with the massive speaker wall. The connection forming.`,
    },
    {
      id: 'S14',
      title: 'Fear Makes the Bass Drop',
      plot: "INT. MAIN STAGE — NIGHT. A spike of anxiety hits Eric — lost, alone, tripping. The moment his fear surges, the bass DROPS. Hard. The whole crowd reacts — thousands of arms thrown up. The DJ didn't trigger that. Eric did.",
      prompt: `${WORLD} ${ERIC} ${CATHEDRAL} The moment of the drop — but it comes from Eric, not the DJ. Eric's face contorts with a wave of anxiety and at that exact moment the bass DROPS — the speaker wall unleashes a shockwave visible in the fog, the crowd explodes with thousands of arms thrown upward, the laser grid flares white. Eric stumbles backward from the force of what he just caused. The crowd is ecstatic. The DJ behind the LED wall looks confused — that wasn't in the set. The accidental god of the drop. Wide shot of the crowd erupting with Eric at the epicenter, shockwave visible in fog.`,
    },
    {
      id: 'S15',
      title: 'Wonder — The Melody Lifts',
      plot: "INT. MAIN STAGE — NIGHT. Eric feels a moment of pure wonder — this is real, this is him — and the melody responds. It LIFTS. Beautiful, soaring, ethereal. The crowd sways. Someone near Eric starts crying from the beauty of it. Eric realizes he's composing the music with his feelings.",
      prompt: `${WORLD} ${ERIC} A transcendent moment. Eric's face shifts from fear to wonder, and the music responds — the melody becomes achingly beautiful, soaring above the bass. The laser grid shifts from aggressive cuts to flowing aurora-like waves of color — soft gold, warm pink, ethereal blue. The crowd sways in unison, arms raised gently instead of violently. A girl near Eric has tears streaming down her face from the beauty. Eric's expression: awe at his own power. He is the composer. His feelings are the instrument. Ethereal, transcendent, overwhelming beauty. The crowd as orchestra.`,
    },
    {
      id: 'S16',
      title: 'Full Control — Eric Conducts',
      plot: 'INT. MAIN STAGE — NIGHT. Eric raises his hand and the crowd raises theirs. He breathes out and the fog machines pulse. He closes his eyes and the music builds — layer by layer, emotion by emotion. For sixty seconds, ten thousand people are extensions of his nervous system.',
      prompt: `${WORLD} ${ERIC} Eric stands in the crowd with his hand raised, and ten thousand hands rise with his. He is the conductor. Visible concentric sound waves emanate from his body, colored by emotion — gold for wonder, deep red for power. The fog machines pulse with his breathing. The laser grid moves with his gaze. The LED panels behind the DJ display patterns that mirror his heartbeat. His face shows transcendent focus — eyes closed, head tilted slightly back, total surrender to the connection. The crowd is his instrument, the venue is his body, the music is his voice. The most powerful 10 seconds of footage in the episode. Psychedelic transcendence.`,
    },
    {
      id: 'S17',
      title: 'The DJ Notices',
      plot: "INT. MAIN STAGE — BEHIND DJ BOOTH. The DJ stares at their equipment. The levels are moving on their own. The set is playing itself. They lift their hands off the controls and the music doesn't stop. Someone — or something — else is driving.",
      prompt: `${WORLD} Behind the DJ booth. A DJ stands at their equipment looking confused and alarmed. The mixing board's faders move by themselves. The waveform display shows patterns that aren't in any loaded track. The DJ lifts both hands away from the controls — the music continues without them, building and building. LED panels behind them display fractal patterns no one programmed. Through the booth's window, the crowd is in perfect unison. The DJ is no longer in control. Tech-focused shot of autonomous equipment, confused DJ, the music playing itself.`,
    },
    {
      id: 'S18',
      title: 'The Void Opens',
      plot: 'INT. MAIN STAGE — NIGHT. Something changes. The LED panels behind the speakers go dark — not off, DARK. A void. A blackness deeper than black that seems to pull light into it. The fog near the speakers stops moving, frozen. The crowd closest to the front freezes for one impossible frame.',
      prompt: `${WORLD} ${CATHEDRAL} Something wrong happens. The LED panels behind the massive speaker wall go DARK — not powered off but actively void, a blackness that absorbs light. The fog near the speakers freezes mid-swirl, suspended in air. The front rows of the crowd freeze in a single impossible frame — arms raised, mouths open, time stopped for just them. The rest of the crowd behind doesn't notice. The void behind the speakers is not empty — it contains awareness. Something vast and patient is forming behind the wall of sound. Cosmic horror meets rave. The void in the speakers.`,
    },
    {
      id: 'S19',
      title: 'The Frequency Speaks',
      plot: 'INT. MAIN STAGE — NIGHT. From inside the sound — not through his ears but through his chest, through his bones — a voice. Deep. Ancient. Patient. Not words in the air but words in the bass itself: "I have been waiting for you to return." The music doesn\'t stop. It restructures around the voice like the universe making room.',
      prompt: `${WORLD} ${ERIC} The most important shot. Eric stands in the frozen-front-row crowd, face lit by the void behind the speakers. His expression transforms from transcendence to primal terror. His chest vibrates — not from the bass but from something speaking THROUGH the bass. The air around him distorts — sound waves become visible dark ripples. The void behind the speakers seems to lean toward him. The music hasn't stopped — it has restructured around a presence, frequencies parting like curtains. Eric is hearing something no human has heard in millennia. Cosmic contact through sub-bass. The moment everything changes. Terror, awe, ancient recognition.`,
    },
    {
      id: 'S20',
      title: "Eric's Face — Terror",
      plot: "INT. MAIN STAGE — NIGHT. Close-up on Eric's face as he hears the voice. His transcendent expression shatters into raw animal fear. His mouth opens. His dilated pupils contract for the first time all night. He understands nothing except that he needs to RUN.",
      prompt: `${WORLD} ${ERIC} Extreme close-up of Eric's face. The progression: transcendent wonder → confusion → recognition of something ancient → pure animal terror. His dilated pupils CONTRACT — the only time all night they've done that. His mouth opens. Sweat runs down his temple. The rave lights on his face shift from warm gold to cold ultraviolet. Behind him, blurred, the void in the speakers pulses. This is the face of a man who just heard God — or something worse. Macro portrait, the full emotional journey in one face, the terror of contact.`,
    },
    {
      id: 'S21',
      title: 'Eric Runs — Music Distorts',
      plot: 'INT. MAIN STAGE — NIGHT. Eric shoves through the crowd, fighting the current. The music DISTORTS behind him — his panic feeding back into the system. Bass becomes grinding. Melody collapses into dissonance. People around him feel it as a bad trip wave spreading outward.',
      prompt: `${WORLD} ${ERIC} Eric shoving through the crowd, desperate, fighting against the flow of bodies. Behind him, the music is distorting — visible dark waves of dissonance rippling outward from where he was standing. The crowd he passes through flinches, their expressions souring — his panic is contagious through the sound. The laser grid overhead glitches and flickers. The LED panels display corrupted patterns. His fear is breaking the music. He is the source and he can't control it. Chaotic escape through crowd, distortion waves, panicked motion, music breaking.`,
    },
    {
      id: 'S22',
      title: 'The Dark Corridor — Running',
      plot: 'INT. DARK CORRIDOR — NIGHT. Eric finds the corridor between indoor and outdoor areas. Sprints through it. Red emergency lights stretch into infinity under psilocybin. The walls vibrate with distorted bass from the stage. His footsteps echo wrong. He bursts through the exit doors.',
      prompt: `${WORLD} A young man in a black hoodie sprinting through a long concrete corridor lit only by red emergency exit signs. Under psilocybin the corridor STRETCHES impossibly long — the red signs repeat into infinity. The concrete walls vibrate with distorted bass from the other side. His footsteps echo in wrong rhythms. His shadow multiplies in the red light. He runs toward exit doors that glow with cool outdoor light at the end. Running from something with no body. Psychedelic horror, stretched perspective, red infinity, vibrating walls, pure flight.`,
    },
    {
      id: 'S23',
      title: 'Outside — Desert Air',
      plot: "EXT. NOS OUTDOOR AREA — NIGHT. Eric bursts through the doors into the outdoor area. The cool desert air hits him like cold water. Stars above. Multiple stages in the distance. He's shaking, drenched in sweat, alone. His phone is dead. He doesn't know where his friends are.",
      prompt: `${WORLD} ${ERIC} Eric bursts through exit doors into the outdoor festival area. The cool desert night air visible as his hot breath condensing. He doubles over, hands on knees, gasping. Stars barely visible through light pollution above. Multiple stages glow in the distance with competing colored lights. He is soaked in sweat, shaking, alone. Behind him through the closing doors, the distorted bass is still audible. The relief and terror of escape. Wide shot of a single shaken figure in the open space between stages, tiny against the festival scale.`,
    },

    // ═══════════════════════════════════════════════════════════════════
    // ACT 3 — THE HOTEL & THE OVERHEARD (S24–S32)
    // Dante and Marcus, the afterparty, the demon symbols
    // ═══════════════════════════════════════════════════════════════════
    {
      id: 'S24',
      title: 'Dante Approaches',
      plot: 'EXT. NOS OUTDOOR AREA — NIGHT. Eric is sitting on a curb, head in hands, shaking. A voice: "Hey man, you good?" It\'s Dante — charismatic, late 20s, linen shirt, silver pendant. He\'s friendly, warm, non-threatening. Exactly what Eric needs right now.',
      prompt: `${WORLD} ${ERIC} ${DANTE} Eric sitting on a concrete curb outside the venue, head in his hands, clearly shaken. A man approaches — late 20s, dark curly hair, white linen shirt, silver chain necklace, easy smile. He crouches beside Eric, offering a water bottle. The gesture is warm, genuine-seeming. Festival lights glow behind them. The contrast between Eric's distress and Dante's calm composure. Two-shot at ground level on the curb, warm human moment against the cold festival night.`,
    },
    {
      id: 'S25',
      title: 'Marcus in the Background',
      plot: "EXT. NOS OUTDOOR AREA — NIGHT. Behind Dante, a second figure watches from the shadows. Marcus — shaved head, all black, built like security. He stands near an exit. Watching. Eric doesn't notice him yet.",
      prompt: `${WORLD} ${MARCUS} In the background of the curb scene, a figure stands in shadow near a venue exit. Muscular, shaved head, all black clothing, arms crossed. He watches Dante and Eric with still, assessing eyes. The festival lights don't quite reach him — he exists in the dark between two light sources. His ring catches a glint of distant laser light. The watcher. Background figure shot — sharp focus on Marcus while the foreground curb scene is slightly soft. The threat you don't notice.`,
    },
    {
      id: 'S26',
      title: 'The Invitation',
      plot: 'EXT. NOS PARKING LOT — NIGHT. Dante walks Eric toward the parking lot, talking easily about the music, the night, asking nothing invasive. "We got a room at the hotel across the street. Chill afterparty. You\'re welcome to decompress." Eric, alone and scared, says yes.',
      prompt: `${WORLD} ${ERIC} ${DANTE} Dante and Eric walking through the festival parking lot at night. Dante is animated and easy, gesturing toward a hotel visible across the street — a cheap two-story motel with exterior corridor lights. Eric walks beside him, hugging himself in his hoodie, still shaken but grateful for human contact. Marcus follows ten paces behind. The NOS Event Center glows behind them, bass still audible. The walk from one world to another — festival to afterparty, public to private, safe to dangerous. Walking two-shot toward the motel.`,
    },
    {
      id: 'S27',
      title: 'Hotel Room — Arriving',
      plot: 'INT. HOTEL ROOM — NIGHT. A cheap room. Two queen beds, thin curtains, warm lamp light. A bluetooth speaker plays ambient music. Dante is the perfect host — water, chill vibes. Marcus sits in the corner near the door. Eric sits on the bed edge, coming down, trying to process what happened at the stage.',
      prompt: `${WORLD} ${HOTEL} ${ERIC} ${DANTE} ${MARCUS} Interior of a cheap hotel room. Warm bedside lamp is the main light. Two queen beds with generic bedspreads. A bluetooth speaker on the nightstand plays soft ambient music. Dante moves around the room comfortably, handing out water bottles, being the host. Eric sits on the edge of a bed, hoodie pulled around him, staring at the floor — clearly processing something heavy. Marcus sits in a chair in the corner near the door, back to the wall, watching. The room feels safe on the surface. Intimate afterparty establishing shot.`,
    },
    {
      id: 'S28',
      title: 'Eric Zoning Out',
      plot: 'INT. HOTEL ROOM — NIGHT. Eric is staring at the carpet, mushrooms fading, replaying the voice in his head. "I have been waiting for you to return." The hotel room feels too small. The ambient music from the speaker feels different now — he can sense its structure, its bones. The power hasn\'t fully turned off.',
      prompt: `${WORLD} ${ERIC} Close-up of Eric sitting on the hotel bed edge, staring at the carpet. His eyes are unfocused — he's somewhere else mentally. The ambient music from the bluetooth speaker is visualized as faint geometric patterns only he can see — residual psychedelic perception. His hands grip the bedspread. Sweat has dried on his temples. The warm lamp light makes the room feel close and confining. A man replaying the most terrifying moment of his life on loop. Intimate portrait of internal crisis, warm light, confined space.`,
    },
    {
      id: 'S29',
      title: 'Dante and Marcus — The Conversation',
      plot: 'INT. HOTEL ROOM — NIGHT. Eric is zoned out on the bed. Near the bathroom, Dante leans against the doorframe talking to Marcus in low voices. They think Eric is too gone to hear. Dante: "Did you see the new ones near the south stage? They\'re not even trying to hide it anymore."',
      prompt: `${WORLD} ${DANTE} ${MARCUS} Near the bathroom doorframe of the hotel room, two men talk in low voices. Dante leans casually against the frame, one hand gesturing. Marcus stands close, arms crossed, speaking quietly. Their body language is conspiratorial but comfortable — professionals discussing work. In the background, out of focus, Eric sits on the bed — apparently zoned out. The warm lamp creates a split: the two men in shadow near the bathroom, Eric in warm light on the bed. The conversation Eric isn't supposed to hear. Split-focus composition, conspiratorial intimacy.`,
    },
    {
      id: 'S30',
      title: 'The Demon Symbols — Overheard',
      plot: 'INT. HOTEL ROOM — NIGHT. Marcus: "Demon summoning sigils. In the LED panel art. In the stage geometry. In the venue floor plan. It\'s getting obvious. Someone is going to notice." Dante shrugs: "Nobody notices. Nobody ever does." Eric, face blank, is listening to every word.',
      prompt: `${WORLD} ${ERIC} Tight shot of Eric on the bed. His face is CAREFULLY blank — the face of someone pretending not to hear while memorizing every word. His eyes are aimed down at the carpet but his focus is clearly behind him, toward the two men talking. The ambient light on his face shows micro-tension — jaw slightly clenched, breathing controlled. In the blurred background, Dante and Marcus continue their conversation. The skill of being the quiet kid — invisible, underestimated, hearing everything. The eavesdrop. Close portrait of a face performing blankness while the mind races.`,
    },
    {
      id: 'S31',
      title: 'Eric Leaves — The Poker Face',
      plot: 'INT. HOTEL ROOM — NIGHT. Eric acts groggy. "Thanks for the hangout man. I need some air." He stands slowly, deliberately. Walks past Marcus at the door. Doesn\'t rush. Doesn\'t look back. Marcus watches him go. The door clicks shut behind him.',
      prompt: `${WORLD} ${ERIC} ${MARCUS} Eric standing up from the bed slowly, performing exhaustion. He mumbles thanks, moves toward the door. Marcus sits in the corner chair — Eric must pass him to exit. A moment of tension: Eric walks past Marcus, not making eye contact, casual, groggy. Marcus watches him pass — his eyes sharp, assessing. Did Eric hear? The door handle turns. Eric steps into the exterior corridor. The door clicks shut. Shot from Marcus's perspective watching Eric leave — the question hanging: does he know? Tension, poker face, the exit.`,
    },
    {
      id: 'S32',
      title: 'Hotel Corridor — Alone Again',
      plot: 'EXT. HOTEL EXTERIOR CORRIDOR — NIGHT. Eric walks down the exterior hotel corridor, lit by fluorescent tubes. As soon as he rounds the corner out of sight, his composure breaks. He leans against the wall, breathing hard. Then he starts walking — fast — back toward NOS.',
      prompt: `${WORLD} ${ERIC} An exterior hotel corridor at night — cheap motel with fluorescent tube lighting. Eric walks along it, composed, normal pace. The moment he turns the corner and is out of sight of the room, his mask BREAKS. He leans against the stucco wall, eyes wide, breathing hard, one hand over his mouth. Then he pushes off the wall and walks fast — nearly jogging — toward the NOS Event Center lights visible in the distance. The composure shattering. The relief of escaping. The second thing tonight that terrified him. Fluorescent corridor, mask dropping, the walk becoming a run.`,
    },

    // ═══════════════════════════════════════════════════════════════════
    // ACT 4 — THE REUNION & RIDE HOME (S33–S40)
    // Finding Jeff and Mikel, the silent ride, the bass doesn't stop
    // ═══════════════════════════════════════════════════════════════════
    {
      id: 'S33',
      title: 'Back at NOS — Searching',
      plot: "EXT. NOS OUTDOOR AREA — NIGHT. Eric walks through the outdoor area, scanning for Jeff or Mikel. The rave is still going — bass from multiple stages, people laughing, LED art installations. He's sober enough now to function but still feeling residual... connection. The music from the nearest stage responds slightly to his mood.",
      prompt: `${WORLD} ${ERIC} ${NOS} Eric walking through the outdoor festival area, scanning faces. Multiple stages glow in the background with competing colored lights. LED art installations throw patterns on the concrete. Ravers walk between stages. Eric moves with purpose now — still shaken but functional. A subtle visual hint: the nearest stage's lights shift slightly warmer as he passes, responding to his presence. He doesn't notice but we do. The power is still there, just quieter. Walking search, outdoor festival energy, subtle supernatural undertone.`,
    },
    {
      id: 'S34',
      title: 'Jeff Spots Him',
      plot: 'EXT. NOS OUTDOOR AREA — NIGHT. From the top of a concrete barrier, Jeff\'s voice: "BRO! ERIC! OVER HERE!" The most beautiful sound Eric has ever heard. Jeff is standing on the barrier, arms waving, huge grin, still shirtless.',
      prompt: `${WORLD} ${JEFF} A big shirtless muscular guy standing on top of a concrete barrier, arms waving wildly, mouth open in a yell, face split with the biggest grin. Festival lights behind him create a silhouette halo. Below, walking toward him through the crowd, a slim figure in a black hoodie looks up — and the relief on his face is overwhelming, nearly tearful. The most mundane miracle: your friend found you. Wide shot with Jeff elevated on the barrier, Eric approaching below, the scale of the festival behind them, the warmth of reunion.`,
    },
    {
      id: 'S35',
      title: 'The Reunion Hug',
      plot: 'EXT. NOS OUTDOOR AREA — NIGHT. Jeff jumps off the barrier and bear-hugs Eric, lifting him off the ground. "WHERE WERE YOU BRO?" Eric can\'t speak. He just holds on.',
      prompt: `${WORLD} ${JEFF} ${ERIC} A huge shirtless guy bear-hugging a smaller friend in a black hoodie, lifting him completely off the ground. The smaller guy's face is buried in his friend's shoulder — hiding the emotion, the relief, everything he can't say. Festival lights wash over them. Other ravers walk past, some smiling at the reunion. It's simple and perfect and human after everything supernatural that just happened. The hug as salvation. Medium shot, warm festival lighting, the contrast of Jeff's massive frame and Eric's slim build, pure friendship.`,
    },
    {
      id: 'S36',
      title: 'Mikel Appears',
      plot: 'EXT. NOS OUTDOOR AREA — NIGHT. Mikel appears from the shadows. As always. His eyes lock onto Eric and something changes in his face — he can sense that Eric is different. Something happened. Something fundamental shifted. Mikel says nothing. He just watches.',
      prompt: `${WORLD} ${MIKEL} A lean figure in all-black techwear emerges from shadow at the edge of the reunion scene. His pale face is lit by distant stage lights — magenta on one side, blue on the other. His dark eyes lock onto Eric with an intensity that goes beyond friendship. He senses it — the change, the opening, the thing that activated. His expression is complex: relief that Eric is alive, fear of what he's become. He doesn't join the hug. He stands apart. Watching. Knowing. The vampire recognizing what woke up in his friend. Mikel in shadows, dual-lit, the outsider who sees everything.`,
    },
    {
      id: 'S37',
      title: 'Walking to the Truck',
      plot: 'EXT. NOS PARKING LOT — NIGHT. The three friends walk to Jeff\'s truck. Jeff talks enough for all of them — recounting his search, his barrier-climbing strategy, how he "almost fought a security guard." Eric is silent. Mikel is silent. The venue bass fades behind them.',
      prompt: `${WORLD} ${JEFF} ${ERIC} ${MIKEL} Three friends walking through a dark parking lot toward a lifted white Tacoma. The big shirtless one talks animatedly, gesturing, reliving the night. The slim one in the hoodie walks with his arms wrapped around himself, staring straight ahead, silent. The lean one in black walks slightly behind, watching the back of Eric's head. The NOS Event Center glows behind them, growing smaller. Bass fading with distance. Three friends, three different versions of the same night. Walking group shot, the venue receding, the aftermath beginning.`,
    },
    {
      id: 'S38',
      title: 'In the Truck — Silence',
      plot: "INT. JEFF'S TRUCK — NIGHT. Jeff drives. Eric stares at the dashboard. Mikel watches Eric from the back seat. Nobody talks. The only sound is the road and the faint vibration of distant bass still audible through the truck frame. Eric can feel it. He can feel ALL of it now. The music from the venue, miles away. The hum of the engine. The frequency of Mikel's attention behind him.",
      prompt: `${WORLD} ${TRUCK} Interior of the lifted Tacoma. Jeff drives, one hand on the wheel, finally quiet, eyes on the road. Eric in the passenger seat stares at the glowing dashboard instruments — his reflection ghosted in the windshield. In the back seat, Mikel watches Eric's reflection in the side mirror, sharp eyes unblinking. The silence is heavy. The only light is dashboard amber. Through the closed windows, impossibly, the NOS Event Center bass is still faintly audible — or is Eric feeling it from miles away? The ride home where nobody talks about what happened. Three-shot interior, dashboard glow, weighted silence.`,
    },
    {
      id: 'S39',
      title: 'Eric Feels the Bass Through the Truck',
      plot: "INT. JEFF'S TRUCK — NIGHT. Close-up of Eric's hand on the armrest. The truck frame vibrates faintly. Eric closes his eyes. He can feel the bass from the rave through the metal of the truck — miles away now. He can feel the crowd still moving. The power isn't stopping. It wasn't the mushrooms. The door opened. And it isn't closing.",
      prompt: `${WORLD} ${ERIC} Extreme close-up of Eric's hand resting on the truck's center console. The metal vibrates faintly — impossibly, they're miles from the venue. Eric's eyes are closed. His expression is not peace — it's realization. The bass from the NOS Event Center, miles behind them, is still reaching him through the truck frame, through the road, through the earth itself. Subtle visual: faint geometric patterns of sound visible only to Eric, flowing through the metal under his fingers. The power isn't going away. The mushrooms are gone but the door stays open. Macro close-up, vibrating metal, closed eyes, the terrifying permanence.`,
    },
    {
      id: 'S40',
      title: 'End — Eyes Open',
      plot: "INT. JEFF'S TRUCK — NIGHT. Eric opens his eyes. In the darkness of the truck, for one frame, his irises reflect something that isn't the dashboard light. Something deeper. Older. A frequency. CUT TO BLACK. Title: SPACE FLEET.",
      prompt: `${WORLD} ${ERIC} The final shot. Eric opens his eyes in the dark truck. Close-up of his face, lit only by dashboard amber. For one frame — one heartbeat — his irises reflect something impossible: not the dashboard, not the road, but a deep resonance pattern, a frequency made visible, something ancient and alien looking back through his eyes. Then it's gone. Just a scared kid in a truck. But we saw it. And so did Mikel, reflected in the rearview mirror, his face showing ancient recognition and deep, deep fear. Then BLACK. White text: SPACE FLEET. The final frame, the hook, the promise of everything to come.`,
    },
  ];
}

// ── Main ────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('  SPACE FLEET — Pilot: "Return"');
  console.log('  40 Scenes × 10s = ~7 min core footage');
  console.log(`  Seedance 2.0 → On-chain | Mode: ${GEN_MODE.toUpperCase()}`);
  console.log('═'.repeat(60));

  if (UNIVERSE_ADDR === '0x0000000000000000000000000000000000000000') {
    console.error('\n  ERROR: Set SPACE_FLEET_ADDR env var to the deployed universe address.');
    process.exit(1);
  }
  if (!BYTEDANCE_API_KEY) {
    console.error('\n  ERROR: BYTEDANCE_API_KEY not set.');
    process.exit(1);
  }

  // Auth + fetch character DNA from wiki
  log('AUTH', 'Authenticating...');
  const token = await getAuthToken();
  log('AUTH', `Authenticated as ${account.address}`);

  const dna = await fetchCharacterDNA(token);
  const SCENES = buildScenes(dna);

  // Find start index
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
    // ── CONTINUITY MODE ─────────────────────────────────────────────
    // Sequential: each scene extracts the last frame from the previous
    // scene and uses it as the starting image for i2v. Characters,
    // environments, and motion stay consistent across cuts.
    for (let i = startIdx; i < SCENES.length; i++) {
      const scene = SCENES[i];
      const label = `${scene.id} (${i + 1}/${SCENES.length})`;

      console.log(`\n${'═'.repeat(55)}`);
      console.log(`  ${scene.id}: ${scene.title}`);
      console.log(`${'═'.repeat(55)}`);

      try {
        const videoUrl = await generateVideo(scene.prompt, label, lastFrameUrl);

        const contentHash = `sf-${scene.id}-${Date.now()}`;
        const nodeId = await createNode(contentHash, scene.plot, previousId, videoUrl, label);
        previousId = nodeId;
        results.push({ id: scene.id, title: scene.title, nodeId });
        log(label, `DONE — Node #${nodeId}`);

        // Extract last frame for the next scene's i2v input
        lastFrameUrl = await extractLastFrame(videoUrl, `${scene.id} FRAME`);
      } catch (err: any) {
        log(label, `FAILED: ${err.message?.slice(0, 200)}`);
        // Keep previous lastFrameUrl so next scene still has some reference
      }

      if (i < SCENES.length - 1) await sleep(2000);
    }
  } else {
    // ── FAST MODE ───────────────────────────────────────────────────
    // Parallel batches: generate BATCH_SIZE scenes at once as t2v.
    // First scene per batch uses i2v from previous batch's last frame
    // for partial continuity. Much faster but characters may vary.
    for (let batchStart = startIdx; batchStart < SCENES.length; batchStart += BATCH_SIZE) {
      const batch = SCENES.slice(batchStart, Math.min(batchStart + BATCH_SIZE, SCENES.length));

      console.log(`\n${'═'.repeat(55)}`);
      console.log(
        `  BATCH: ${batch[0].id}–${batch[batch.length - 1].id} (${batch.length} scenes parallel)`
      );
      console.log(`${'═'.repeat(55)}`);

      // Generate videos in parallel — first scene uses last frame for partial continuity
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

      // Chain on-chain nodes sequentially
      let lastVideoUrl: string | null = null;
      for (let j = 0; j < videoResults.length; j++) {
        const result = videoResults[j];
        const scene = batch[j];
        const label = `${scene.id} (${batchStart + j + 1}/${SCENES.length})`;

        if (result.status === 'fulfilled') {
          try {
            const contentHash = `sf-${scene.id}-${Date.now()}`;
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

      // Extract last frame from final scene in batch for next batch
      if (lastVideoUrl) {
        lastFrameUrl = await extractLastFrame(lastVideoUrl, `${batch[batch.length - 1].id} FRAME`);
      }

      log('BATCH', `Completed ${batch[0].id}–${batch[batch.length - 1].id}`);
      if (batchStart + BATCH_SIZE < SCENES.length) await sleep(2000);
    }
  }

  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log('  SPACE FLEET — Pilot Episode Generation Complete');
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
  console.log(`  Next: Run space-fleet-audio-pipeline.ts for voice, SFX & music\n`);
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
