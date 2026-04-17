/**
 * E COMBONATOR — Episode 1: "The Weird Kid Always Wins"
 *
 * 70 scenes via Seedance 2.0 → on-chain nodes.
 * Pulls character descriptions from wiki entities for consistency.
 *
 * Usage: pnpm tsx scripts/ecombonator-film-scenes.ts
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

const UNIVERSE_ADDR = '0x36A903899f51096E8A59d5Bee018966C995888c1' as const;
const BD_BASE = 'https://ark.ap-southeast.bytepluses.com/api/v3';

// ── Helpers ──────────────────────────────────────────────────────────
function log(step: string, msg: string) {
  console.log(`[${step}] ${msg}`);
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Auth ─────────────────────────────────────────────────────────────
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
    `URI: http://localhost:5173`,
    `Version: 1`,
    `Chain ID: ${sepolia.id}`,
    `Nonce: ${nonce}`,
    `Issued At: ${now.toISOString()}`,
    `Expiration Time: ${expiresAt.toISOString()}`,
  ].join('\n');
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

// ── Pull character DNA from wiki ─────────────────────────────────────
async function fetchCharacterDNA(token: string): Promise<Record<string, string>> {
  log('WIKI', 'Fetching character data from wiki entities...');
  const res = await fetch(
    `${SERVER_URL}/trpc/entities.listByUniverse?batch=1&input=${encodeURIComponent(
      JSON.stringify({ '0': { universeAddress: UNIVERSE_ADDR } })
    )}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const json = (await res.json()) as any[];
  const entities = json[0]?.result?.data || [];

  const dna: Record<string, string> = {};
  for (const e of entities) {
    // Build a short visual DNA string for each character/place/tech
    const name = e.name || e.data?.name;
    const desc = e.description || e.data?.description;
    if (name && desc) {
      // Take first 2 sentences max for the visual DNA
      const short = desc.split('.').slice(0, 3).join('.') + '.';
      dna[name.toUpperCase().replace(/\s+/g, '_')] = `${name}: ${short}`;
      log('WIKI', `  Loaded: ${name}`);
    }
  }
  return dna;
}

// ── On-chain ABI ─────────────────────────────────────────────────────
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

// ── Video generation via ByteDance direct ────────────────────────────
async function generateVideo(prompt: string, label: string): Promise<string> {
  log(label, 'Generating video via Seedance 2.0...');
  const taskRes = await fetch(`${BD_BASE}/contents/generations/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${BYTEDANCE_API_KEY}` },
    body: JSON.stringify({
      model: 'dreamina-seedance-2-0-260128',
      content: [{ type: 'text', text: prompt }],
      duration: 10,
      aspect_ratio: '16:9',
      resolution: '720p',
      generate_audio: false,
    }),
  });
  if (!taskRes.ok)
    throw new Error(`ByteDance ${taskRes.status}: ${(await taskRes.text()).slice(0, 200)}`);
  const { id: taskId } = (await taskRes.json()) as any;
  if (!taskId) throw new Error('No task ID');
  log(label, `Task: ${taskId}`);

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
    if (st === 'failed' || st === 'error') throw new Error(s.error?.message || 'failed');
    if (i % 6 === 0) log(label, `Generating... (${i * 5}s)`);
  }
  throw new Error('Timeout');
}

// ── On-chain node ────────────────────────────────────────────────────
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

// ── Build scenes from character DNA ──────────────────────────────────
function buildScenes(dna: Record<string, string>) {
  const ELI =
    dna['ELI_REYES'] ||
    'Eli Reyes: 25-year-old lean tech founder, tired eyes, black hoodie, gray cargo pants, one white streak in dark hair, beat-up backpack.';
  const MAYA =
    dna['MAYA_CHEN'] ||
    'Maya Chen: 26-year-old female, sharp bob haircut, dark green bomber jacket, smart glasses, practical clothes.';
  const DEV =
    dna['DEV_PATEL'] ||
    'Dev Patel: 24-year-old male, curly hair, vintage startup hoodie, rings, sneakers, loud and funny.';
  const CELESTE =
    dna['CELESTE_VANE'] ||
    'Celeste Vane: 40s female, white suit, silver jewelry, precise posture, never looks rushed.';
  const WORLD =
    'San Francisco Bay Area, present day. Startup noir. Color palette: midnight blue, neon cyan, warm amber, city lights. Cinematic 16:9, dramatic lighting, photorealistic.';

  return [
    // ═══════════════════════════════════════════════════════════════
    // EPISODE 1 — "THE WEIRD KID ALWAYS WINS"
    // 70 scenes covering the full hackathon night
    // ═══════════════════════════════════════════════════════════════

    // ── ARRIVAL & ATMOSPHERE (1-8) ──
    {
      id: 'S01',
      title: 'City Rain — Aerial',
      plot: 'EXT. SAN FRANCISCO - NIGHT. Rain across the city skyline. Bay Bridge in the distance. We descend toward SOMA.',
      prompt: `${WORLD} Epic aerial shot of San Francisco at night in heavy rain. City lights shimmer through water. Bay Bridge glowing golden in distance. Camera slowly descends toward the SOMA district. Cinematic, moody, atmospheric noir.`,
    },
    {
      id: 'S02',
      title: 'SOMA Streets — Food Trucks',
      plot: 'EXT. SOMA STREET - NIGHT. Food trucks line wet pavement. Neon signs reflect in puddles. Coders huddle under umbrellas.',
      prompt: `${WORLD} Street-level tracking shot through SOMA at night. Food trucks with warm lights, rain puddles reflecting neon signs. Young coders with laptops in backpacks hurry past. Wet pavement gleams. Camera moves forward through the rain toward a glowing warehouse entrance.`,
    },
    {
      id: 'S03',
      title: 'Warehouse Exterior — The Banner',
      plot: 'EXT. WAREHOUSE - NIGHT. A giant banner reads BAYBLITZ HACK VII. RGB light spills from open doors. Hundreds stream in and out.',
      prompt: `${WORLD} A converted warehouse exterior at night. A massive illuminated banner reads BAYBLITZ HACK VII. RGB multicolor light floods out through open industrial doors. Hundreds of young developers streaming in and out. Rain falling through the colored light. Wide establishing shot.`,
    },
    {
      id: 'S04',
      title: 'Entrance — Into the Chaos',
      plot: 'INT. WAREHOUSE ENTRANCE - NIGHT. Camera pushes through the doors into organized chaos. Noise. Heat. Energy drinks and ambition.',
      prompt: `${WORLD} POV camera pushing through warehouse doors into a massive hackathon. Sensory overload: screens glowing, cables snaking everywhere, people typing furiously. Energy drinks, pizza boxes, the hum of hundreds of laptops. RGB lighting shifts colors across the ceiling. Tracking shot moving into the crowd.`,
    },
    {
      id: 'S05',
      title: 'Hackathon Floor — Teams Working',
      plot: 'INT. HACKATHON FLOOR - NIGHT. Teams pitch drones, AI agents, crypto infrastructure, biotech dashboards. Organized chaos.',
      prompt: `${WORLD} Wide tracking shot across the hackathon floor. Teams at tables: one demos a hovering drone, another shows an AI chatbot, another has crypto charts on screen. Diverse young developers in hoodies coding intensely. Organized chaos, caffeine-fueled energy. Multiple light sources creating visual depth.`,
    },
    {
      id: 'S06',
      title: 'Floor Details — Caffeine & Code',
      plot: 'INT. FLOOR - NIGHT. Close-ups: fingers on keyboards, energy drink cans stacking, a whiteboard covered in diagrams, tired eyes lit by screens.',
      prompt: `${WORLD} Montage of hackathon close-ups: fingers flying across a keyboard, a tower of empty Red Bull cans, a whiteboard covered in architecture diagrams, tired eyes illuminated by glowing code on screens, a clock showing 2 AM. The texture of sleep deprivation and ambition. Warm amber screen glow.`,
    },
    {
      id: 'S07',
      title: 'Polished Teams — The Competition',
      plot: 'INT. FLOOR - NIGHT. Well-funded teams in matching hoodies rehearse pitches. Slides with market-size numbers. The startup performance.',
      prompt: `${WORLD} A team of four in matching branded hoodies rehearsing their pitch at their table. Polished slide deck on their monitor showing TAM/SAM graphs. They high-five and practice investor eye contact. Everything about them screams funded and coached. Bright, confident energy. Medium shot.`,
    },
    {
      id: 'S08',
      title: 'The Far Corner — Isolation',
      plot: 'INT. FLOOR - NIGHT. Camera pans past all the teams to the far corner. A folding table. Two people. No branding. No matching hoodies. Just screens.',
      prompt: `${WORLD} Camera slowly pans across the bustling hackathon floor, past team after team, until it reaches the far corner. A single folding table. Two people. No logos, no branding, no matching outfits. Just screens casting blue light on focused faces. Isolated from the herd. The camera settles on this quiet pocket of intensity.`,
    },

    // ── ELI & MAYA — THE CORNER (9-14) ──
    {
      id: 'S09',
      title: 'Eli at His Screens',
      plot: 'At the folding table sits ELI REYES, alone except for MAYA CHEN. Eli stares at twelve floating windows of data.',
      prompt: `${WORLD} ${ELI} Close-up of Eli Reyes at his folding table. His face lit by twelve windows of streaming data on multiple screens. Dark hair with the white streak catching screen light. Tired intelligent eyes scanning information. Black hoodie, backpack on the floor. Completely absorbed. The crowd behind him is a blur. Intimate portrait shot.`,
    },
    {
      id: 'S10',
      title: 'Maya Soldering',
      plot: 'MAYA CHEN sits across from Eli, soldering a tiny circuit board. Focused. Precise. The team that needs no words.',
      prompt: `${WORLD} ${MAYA} Maya Chen sits across from Eli at the folding table, soldering a tiny circuit board under a desk lamp. Smart glasses pushed up on her head. Dark green bomber jacket sleeves rolled up. Her hands are steady, precise. Solder smoke curls upward. She doesn't look up. She doesn't need to. Cool green and amber lighting.`,
    },
    {
      id: 'S11',
      title: "Eli's Data Streams — Screen Detail",
      plot: "Close-up of Eli's screens. Sensor data, probability matrices, predictive vectors overlaid on camera feeds. Something beyond analytics.",
      prompt: `${WORLD} Extreme close-up of Eli's laptop screens. Dense streaming data: probability matrices, sensor fusion readouts, predictive vector fields overlaid on a live camera feed of the room. The data moves, breathes, predicts. This is not a dashboard. This is something alive. Blue and cyan data on black background. Sci-fi UI feeling.`,
    },
    {
      id: 'S12',
      title: 'The Backpack — Character Detail',
      plot: "Close-up of Eli's beat-up backpack on the floor. Covered in hackathon stickers from a dozen events. Worn straps. Everything he owns.",
      prompt: `${WORLD} Close-up of a beat-up old backpack on the floor under the table. Covered in hackathon winner stickers, travel patches, faded logos from past events. Worn canvas straps. A charging cable snaking out of the top pocket. This backpack has been everywhere. It tells a story of winning and wandering. Warm amber light.`,
    },
    {
      id: 'S13',
      title: 'Eli and Maya — Two-Shot',
      plot: 'Wide shot of Eli and Maya at their corner table. Two people in a sea of hundreds. Building something nobody asked for.',
      prompt: `${WORLD} ${ELI} ${MAYA} Wide two-shot of Eli and Maya at their folding table in the far corner. The hackathon buzzes behind them — hundreds of people — but they exist in their own world. Eli's screens glow blue, Maya's solder iron glows amber. Two quiet builders in a loud room. Cinematic framing, depth of field isolating them from the crowd.`,
    },
    {
      id: 'S14',
      title: 'The White Streak — Detail',
      plot: "Close-up of the white streak in Eli's dark hair. Lit by screen light. A mark that makes him recognizable, memorable, strange.",
      prompt: `${WORLD} ${ELI} Extreme close-up of the distinctive white streak in Eli's dark hair, illuminated by the blue glow of his screens. His eye visible in the edge of frame, reflecting code. The mark that makes him unforgettable. Shallow depth of field, cinematic portrait detail. Midnight blue and cyan.`,
    },

    // ── DEV ARRIVES (15-20) ──
    {
      id: 'S15',
      title: 'Dev Approaches — Three Drinks',
      plot: 'DEV approaches holding three energy drinks. Grinning. Rings catching the light. "There he is. Bay Area cryptid."',
      prompt: `${WORLD} ${DEV} Dev Patel walks through the hackathon crowd carrying three energy drinks stacked in his hands. Big grin on his face. Curly hair bouncing, vintage startup hoodie, silver rings catching RGB light. He weaves between tables heading for the corner. Warm, charismatic energy cutting through the room. Medium tracking shot following him.`,
    },
    {
      id: 'S16',
      title: 'Dev Greets Eli',
      plot: '"There he is. Bay Area cryptid. Still building impossible nonsense nobody asked for?" Eli: "That\'s the best kind."',
      prompt: `${WORLD} ${DEV} ${ELI} Dev arrives at Eli's table, setting down energy drinks with a flourish. He gestures broadly at Eli's setup, teasing. Eli looks up with a small half-smile — the first human connection we've seen from him. Two friends with easy chemistry. Warm amber and cool blue lighting. Medium two-shot across the table.`,
    },
    {
      id: 'S17',
      title: 'Dev Looks at Screen',
      plot: '"What even is it this time?" Dev peers at Eli\'s screens. Confusion. Fascination.',
      prompt: `${WORLD} ${DEV} ${ELI} Dev leans over Eli's shoulder looking at the screens full of prediction data. His expression shifts from joking to genuinely confused. The data reflects in his eyes. Eli watches Dev's reaction. The moment a joke turns into something real. Close-up over-the-shoulder shot, screen data visible.`,
    },
    {
      id: 'S18',
      title: 'The Camera Feed',
      plot: 'Eli taps a screen. A live camera feed of the room appears. Floating vectors surround everyone. "It predicts what happens next."',
      prompt: `${WORLD} ${ELI} Eli taps his screen and a live camera feed of the hackathon room fills the display. Blue holographic prediction vectors overlay every person — motion trajectories, probability branches extending forward in time. The room rendered as a prediction landscape. Eli's reflection in the screen. Sci-fi interface overlaid on mundane reality.`,
    },
    {
      id: 'S19',
      title: "Dev's Confusion",
      plot: '"You mean like… analytics?" "No. I mean next." Dev doesn\'t understand yet.',
      prompt: `${WORLD} ${DEV} ${ELI} Close-up of Dev's face as he tries to process what Eli is saying. His eyebrows knit together. He holds an energy drink frozen halfway to his mouth. Behind him, the prediction vectors glow on Eli's screen. The gap between what he's hearing and what he thinks is possible. Comedy and confusion. Warm lighting.`,
    },
    {
      id: 'S20',
      title: 'Yellow Hoodie — The Prediction',
      plot: 'Eli points across the room. A guy in a yellow hoodie laughs, turns, drops his laptop. Three seconds later, exactly that happens. Dev freezes.',
      prompt: `${WORLD} ${ELI} ${DEV} Eli points across the hackathon floor. In the background, a man in a bright yellow hoodie laughs with friends, turns, and his laptop slips — slow motion as it falls. Cut to Dev's face: frozen, mouth open, energy drink suspended. The prediction was exact. Three seconds. The impossible just happened. Dramatic slow-motion reveal.`,
    },

    // ── MAYA EXPLAINS / JUDGES IGNORE (21-27) ──
    {
      id: 'S21',
      title: 'Dev\'s Reaction — "Nope"',
      plot: 'Dev stares. Shakes his head. "Nope." He takes a long drink from his energy can.',
      prompt: `${WORLD} ${DEV} Close-up of Dev shaking his head slowly, eyes wide. He takes a very long pull from his energy drink, never breaking his stare at where the laptop fell. Processing the impossible. His rings catch the light as his hand trembles slightly. Comedy meeting genuine shock. Tight portrait shot.`,
    },
    {
      id: 'S22',
      title: 'Maya Explains — Technical',
      plot: 'Maya: "He trained it on public sensor spill, local device emissions, camera motion, thermal drift, posture anticipation, network timing—"',
      prompt: `${WORLD} ${MAYA} Maya pushes her smart glasses down and starts listing technical details with calm surgical precision. Her hands gesture methodically as she explains each data source. She's matter-of-fact, clinical. Faint data visualizations reflect in her smart glasses. Cool green and blue lighting. Close-up portrait, calm expertise.`,
    },
    {
      id: 'S23',
      title: 'Dev Overwhelmed',
      plot: '"Stop. You\'re turning me off." Dev holds up his hands in surrender.',
      prompt: `${WORLD} ${DEV} ${MAYA} Dev holds both hands up in mock surrender, laughing nervously. Maya pauses mid-sentence, unbothered. The contrast between her technical calm and his overwhelmed comedy. Energy drinks between them on the table. Medium two-shot capturing their dynamic. Warm amber and cool blue.`,
    },
    {
      id: 'S24',
      title: 'Judges Approach',
      plot: "Judges with lanyards and clipboards approach Eli's table. They barely slow down.",
      prompt: `${WORLD} ${ELI} Two hackathon judges in official lanyards approach Eli's corner table, clipboards in hand. They walk briskly, already looking past him toward the next team. Corporate efficiency. They barely slow their pace. Eli looks up expectantly. The camera captures their dismissive body language. Medium tracking shot.`,
    },
    {
      id: 'S25',
      title: 'The Dismissal',
      plot: '"What are you building?" "A probabilistic reality engine." "Uh-huh." They keep walking. They didn\'t even stop.',
      prompt: `${WORLD} ${ELI} The judges glance at Eli's screen for half a second. One asks a question without breaking stride. Eli answers. The judge says "Uh-huh" and they keep walking, already focused on the next table. Eli watches them go. No anger — just the familiar weight of being invisible. Over-the-shoulder shot watching the judges walk away.`,
    },
    {
      id: 'S26',
      title: "Dev's Frustration",
      plot: '"You could literally invent fire and if it didn\'t have a B2B dashboard they\'d still walk past."',
      prompt: `${WORLD} ${DEV} Dev gestures angrily at the departing judges, energy drink sloshing. His face shows genuine frustration on Eli's behalf. He turns back to the table, shaking his head. The injustice of genius being ignored. Warm lighting, medium shot capturing his animated body language and the judges' retreating backs.`,
    },
    {
      id: 'S27',
      title: "Maya's Smirk",
      plot: '"Good. Less stupid feedback." Maya doesn\'t look up from her soldering. Quiet confidence.',
      prompt: `${WORLD} ${MAYA} Maya doesn't even look up from her soldering. A small confident smirk crosses her face. She adjusts a component with tweezers. She knows what they have. She doesn't need judges to validate it. Close-up of her face in warm amber light from the solder iron, the smirk barely visible. Quiet power.`,
    },

    // ── CELESTE WATCHING (28-30) ──
    {
      id: 'S28',
      title: "The Mezzanine — Celeste's POV",
      plot: 'Across the room and above, a polished woman in white watches from a mezzanine balcony. CELESTE VANE.',
      prompt: `${WORLD} ${CELESTE} A woman in an immaculate white suit stands on a mezzanine balcony overlooking the hackathon floor. Silver jewelry catches dim light. She holds no drink, no phone. Just watching. Below her, the chaos of the hackathon — but her eyes are fixed on one corner. Low angle looking up at her composed silhouette against the ceiling lights. Character introduction.`,
    },
    {
      id: 'S29',
      title: 'Celeste Studies Eli',
      plot: "Celeste's eyes track to Eli's corner. She watches the judges walk past without stopping. Her expression is unreadable. She's seen enough.",
      prompt: `${WORLD} ${CELESTE} From Celeste's POV on the mezzanine, looking down at the hackathon floor. In the far corner, Eli and Maya are small figures at their folding table. The judges walk past without stopping. Celeste's manicured hand rests on the railing. She watches with the patience of someone who shops for talent, not companies. High angle POV shot.`,
    },
    {
      id: 'S30',
      title: "Celeste's Eyes — Detail",
      plot: "Extreme close-up of Celeste's eyes. Calculating. Patient. She found what she's looking for.",
      prompt: `${WORLD} ${CELESTE} Extreme close-up of Celeste Vane's eyes. Sharp, intelligent, unreadable. The hackathon floor reflects in miniature across her irises. Silver earring visible at the edge of frame. Not warm, not cold — calculating. She's made a decision. Shallow depth of field, cinematic portrait detail. Silver and white tones.`,
    },

    // ── DEMO TIME (31-43) ──
    {
      id: 'S31',
      title: 'Demo Stage Setup',
      plot: 'LATER - DEMO TIME. The stage is set. Screen behind podium. Host warming up the crowd. The main event.',
      prompt: `${WORLD} A brightly lit stage at the front of the warehouse. Large screen behind a podium. A host in a branded t-shirt hypes the crowd. Rows of developers settle into chairs. Camera flashes. The atmosphere shifts from building to performing. Wide establishing shot of the demo stage area.`,
    },
    {
      id: 'S32',
      title: 'Pitch Parade — Compliance',
      plot: '"AI compliance copilot." A team presents polished slides. Investors nod. Polite applause.',
      prompt: `${WORLD} A polished team on stage presenting "AI Compliance Copilot" with perfect slides full of market metrics. The audience gives respectful but tepid applause. Investors in the front row nod and take notes. Competent, safe, forgettable. Camera captures the mechanical politeness of the response. Standard startup theater.`,
    },
    {
      id: 'S33',
      title: 'Pitch Parade — DePIN',
      plot: '"DePIN wellness network." Another team, another deck, another round of polite applause. The rhythm of the expected.',
      prompt: `${WORLD} Another team on stage, another set of slides — "DePIN Wellness Network." Blockchain diagrams, user growth projections. The audience shifts in their seats. More polite applause. A pattern establishing itself: polished, safe, derivative. Camera slowly pans across the audience's neutral expressions.`,
    },
    {
      id: 'S34',
      title: 'Pitch Parade — Growth Engine',
      plot: '"Autonomous growth engine." The audience is on autopilot. Clapping on cue. Nobody\'s mind is being changed.',
      prompt: `${WORLD} A third team wraps up their pitch — "Autonomous Growth Engine." The applause is reflexive now. An investor checks his phone. The host smiles on autopilot. The audience has settled into comfortable boredom. Everything is as expected. Wide shot of the routine, the machine of startup performance grinding forward.`,
    },
    {
      id: 'S35',
      title: 'Eli Backstage — No Slides',
      plot: 'Backstage: Eli stands alone with his laptop. No slides loaded. No pitch deck. Just a black terminal. Maya gives him a nod.',
      prompt: `${WORLD} ${ELI} ${MAYA} Backstage area with curtains and cables. Eli stands holding his beat-up laptop, screen showing only a black terminal cursor. No slides. No deck. Maya stands nearby, arms crossed, and gives him a single firm nod. He takes a breath. The contrast between his raw setup and the polished teams before him. Intimate backstage moment.`,
    },
    {
      id: 'S36',
      title: 'The Call — "Team GhostLattice?"',
      plot: 'HOST: "And… Team GhostLattice?" Silence. Eli walks onstage. Alone. No branding. Just a black hoodie and a laptop.',
      prompt: `${WORLD} ${ELI} The host looks at his card and calls out the name. The audience murmurs. Eli walks onto the stage alone — no team, no matching hoodies, no slides loading behind him. Just a young man in a black hoodie with a beat-up laptop. The white streak in his hair catches the spotlight. Single figure on a wide stage. Dramatic entrance through contrast.`,
    },
    {
      id: 'S37',
      title: 'Eli Plugs In',
      plot: 'Eli plugs his laptop into the stage system. Black terminal fills the big screen. The cursor blinks. The room is quiet.',
      prompt: `${WORLD} ${ELI} Close-up of Eli's hands plugging a cable into the stage system. The massive screen behind him fills with a black terminal — just a blinking cursor. No logo, no title slide, no company name. The audience shifts uncomfortably. The blinking cursor is almost confrontational in its simplicity. Dramatic negative space on the huge screen.`,
    },
    {
      id: 'S38',
      title: 'The Pitch — Blank Stares',
      plot: '"Hi. This is a local predictive system that models the next several seconds of a physical environment in real time." Blank stares.',
      prompt: `${WORLD} ${ELI} Eli speaks into the microphone. His voice is calm, technical, unpolished. The audience stares blankly — this doesn't match the format they expect. No slides, no metrics, no market size. Just a person describing something they can't categorize. Close-up of confused faces in the crowd, then back to Eli's steady gaze.`,
    },
    {
      id: 'S39',
      title: 'The Skeptic — "Surveillance?"',
      plot: 'An investor in the crowd interrupts: "So… surveillance?" Eli pauses. "No."',
      prompt: `${WORLD} ${ELI} A man in a sport coat in the audience calls out skeptically. His tone is dismissive, trying to categorize what he's hearing into a box he understands. Eli pauses, looks directly at him. One word: "No." The pause is heavy. Then: "Watch." Close-up ping-pong between the skeptic and Eli's calm defiance.`,
    },
    {
      id: 'S40',
      title: 'Camera Points at Judges',
      plot: '"Watch." Eli points a camera at the judges\' table. Blue vectors bloom across the screen. Prediction overlays appear on every person.',
      prompt: `${WORLD} ${ELI} Eli aims a camera at the judges' table. On the massive screen behind him, the live feed transforms — blue holographic prediction vectors bloom around every judge. Motion trajectories, probability branches, timing markers appear in real-time. The audience leans forward. The mundane becomes science fiction. Wide shot showing the huge screen with its impossible overlay.`,
    },
    {
      id: 'S41',
      title: 'The Three Predictions',
      plot: '"Judge two will reject my premise in four seconds. Judge one will reach for water in six. The man in the back will receive a call and leave in eight."',
      prompt: `${WORLD} ${ELI} Eli speaks each prediction while the screen highlights the targets with countdown timers. Three prediction markers pulse on screen — each attached to a different person. The room holds its breath. Numbers count down. The audience is frozen between skepticism and fascination. Split screen feeling between Eli and the prediction display.`,
    },
    {
      id: 'S42',
      title: 'Prediction Lands — The Rejection',
      plot: 'Beat. JUDGE #2: "I reject the—" Exactly four seconds. The room stirs.',
      prompt: `${WORLD} Judge number two opens his mouth to speak exactly on cue. "I reject the—" On the huge screen behind the stage, the first countdown hits zero and flashes CONFIRMED in blue. The audience gasps. First prediction: perfect. The judge doesn't even realize he just proved the demo. Close-up of his mouth moving, the timer hitting zero.`,
    },
    {
      id: 'S43',
      title: 'Prediction Lands — The Water',
      plot: 'Judge #1 reaches for water. Six seconds. The timing is uncanny. Murmurs spread through the crowd.',
      prompt: `${WORLD} Judge one's hand reaches for a water bottle on the table. Six seconds exactly. The second countdown on screen hits zero — CONFIRMED. The audience murmurs grow louder. People look at each other. This can't be real. Close-up of the hand grabbing water, perfectly matching the predicted trajectory on screen. Uncanny precision.`,
    },

    // ── THE ROOM BREAKS (44-50) ──
    {
      id: 'S44',
      title: 'Prediction Lands — The Phone',
      plot: 'Phone rings in back. Man exits. Eight seconds. The room goes dead silent. HOST: "What the hell?"',
      prompt: `${WORLD} A phone rings in the back of the auditorium. A man stands, excuses himself, walks out. Eight seconds. The third timer hits zero — CONFIRMED. The room goes completely silent. Every eye is on the stage. The host whispers "What the hell?" into a hot mic. Wide shot of a hundred frozen people. Dead silence after chaos.`,
    },
    {
      id: 'S45',
      title: 'Audience Reaction — Shock',
      plot: 'Close-ups of faces in the crowd. Investors. Developers. Judges. Everyone recalculating what they just saw.',
      prompt: `${WORLD} Quick-cut montage of audience faces: an investor lowering his phone, jaw tight. A developer with wide eyes. A judge looking at his own water bottle like it betrayed him. The man who asked about surveillance, now very quiet. Everyone is recalculating. Close-up portraits, each face a different shade of shock. Blue stage light on stunned faces.`,
    },
    {
      id: 'S46',
      title: '"Now let\'s make it useful"',
      plot: 'Eli: "Now let\'s make it useful." He switches views. GHOSTLATTICE simulates the warehouse power grid, crowd motion, network congestion.',
      prompt: `${WORLD} ${ELI} Eli's demeanor shifts — from defense to offense. He taps his laptop and the massive screen transforms into a complex real-time simulation of the entire warehouse: power grid pathways in blue, crowd motion vectors, network congestion heat maps. The room's infrastructure rendered visible. He's not just predicting — he's demonstrating utility. The audience leans forward.`,
    },
    {
      id: 'S47',
      title: 'Livestream Save',
      plot: '"Your livestream is about to crash because three overloaded access points are about to fail in sequence." He taps twice. Reroutes traffic. "Fixed."',
      prompt: `${WORLD} ${ELI} On the big screen, three network access points flash red warning. Eli taps his laptop twice — blue rerouting lines flow around the failures. A notification: STREAM STABILIZED. People in the audience check their phones — the stream quality jumps. Eli says "Fixed" without looking up. Casual mastery. Close-up of his hands, then the audience checking phones.`,
    },
    {
      id: 'S48',
      title: 'Drone Wobble',
      plot: '"Your drone camera loses stabilization in twenty-one seconds." He points to the ceiling. A camera drone wobbles dangerously.',
      prompt: `${WORLD} ${ELI} Eli points to the ceiling. A small camera drone near the rafters begins to wobble, tilting dangerously. The prediction timer on screen counts down to zero. The drone dips — people duck instinctively. It's exactly what he said, exactly when he said it. The crowd gasps. Wide shot looking up at the wobbling drone, audience ducking.`,
    },
    {
      id: 'S49',
      title: "Maya's Patch — The Save",
      plot: 'Maya calmly uploads a patch from the audience. The drone stabilizes instantly. Teamwork without words.',
      prompt: `${WORLD} ${MAYA} Maya in the audience, utterly calm while everyone else panics. She taps her smart glasses twice and uploads a stabilization patch. The drone steadies immediately, smooth and level. She doesn't smile, doesn't look for credit. Just pushes her glasses up and crosses her arms. Close-up of her calm face amidst the surrounding chaos. Cool green glow from her glasses.`,
    },
    {
      id: 'S50',
      title: 'The Declaration',
      plot: '"GhostLattice doesn\'t just predict failure. It lets you build before failure arrives." The room is silent. Then erupts.',
      prompt: `${WORLD} ${ELI} Eli stands center stage, backlit by the massive data visualization. He delivers the line that changes everything. One beat of perfect silence. Then the room explodes — people standing, filming with phones, pushing forward. The transformation from skepticism to frenzy. Wide cinematic shot capturing the wave of reaction breaking across the crowd.`,
    },

    // ── AFTERMATH OF THE DEMO (51-55) ──
    {
      id: 'S51',
      title: 'Phones Up — The Frenzy',
      plot: 'People start filming. The room goes from polite hackathon to viral moment. Phones everywhere. Camera flashes.',
      prompt: `${WORLD} ${ELI} The audience on their feet, hundreds of phones raised recording Eli on stage. Camera flashes strobe. People are pushing forward, shouting questions. Social media being born in real time. Eli stands still in the center of the storm. The quiet builder suddenly the loudest thing in the room. Wide shot, phone screens glowing like fireflies.`,
    },
    {
      id: 'S52',
      title: 'Celeste Smiles',
      plot: 'Up on the mezzanine, Celeste smiles for the first time. Not surprise. Confirmation.',
      prompt: `${WORLD} ${CELESTE} Close-up of Celeste Vane on the mezzanine above the chaos. While the room erupts below, she allows the faintest smile. It's not surprise — it's confirmation. She found what she came for. Her silver jewelry catches a camera flash from below. The smile doesn't reach her eyes. It's the smile of acquisition, not admiration. Tight portrait, shallow depth of field.`,
    },
    {
      id: 'S53',
      title: 'Dev in the Crowd — Pride',
      plot: 'Dev in the audience, grinning huge, filming on his phone. He always knew.',
      prompt: `${WORLD} ${DEV} Dev stands in the crowd, phone raised, recording and grinning ear to ear. He turns to the person next to him: "That's my boy!" His curly hair bounces as he jumps. Rings catch the camera flash. Pure joy and vindication. He always believed. Medium shot capturing his infectious energy amidst the crowd frenzy.`,
    },
    {
      id: 'S54',
      title: 'Maya Watches — Quiet Satisfaction',
      plot: "Maya stands at the edge, arms crossed. She doesn't film. She doesn't cheer. She nods once. It's enough.",
      prompt: `${WORLD} ${MAYA} Maya stands at the edge of the crowd, arms crossed over her green bomber jacket. Everyone around her is filming, cheering, pushing forward. She is perfectly still. One slow nod. That's all. Her satisfaction is quiet, contained, absolute. She built half of what's on that stage. She knows what it means. Close-up of her single nod. Calm amidst chaos.`,
    },
    {
      id: 'S55',
      title: 'Eli on Stage — Alone in the Noise',
      plot: "Eli stands on stage, phones pointed at him, but he's looking past the crowd. Looking at something none of them can see yet.",
      prompt: `${WORLD} ${ELI} Eli on stage surrounded by the frenzy he created. Phones flash, people shout, but his eyes are focused somewhere past the crowd. He's already thinking about what comes next. The white streak catches the spotlight. A young genius in the center of attention who has never looked more alone. Portrait shot, shallow depth of field, crowd blurred behind him.`,
    },

    // ── BACKSTAGE — CELESTE'S APPROACH (56-63) ──
    {
      id: 'S56',
      title: 'Backstage — Dev Sprints In',
      plot: 'BACKSTAGE. Dev sprints through the curtain. "You broke the room." Maya: "Good."',
      prompt: `${WORLD} ${DEV} ${MAYA} ${ELI} Backstage area with black curtains and tangled cables. Dev bursts through, arms wide, barely containing himself. "You broke the room!" Maya sits on a road case, arms still crossed. "Good." Eli packs up his laptop quietly. Three different reactions to the same triumph. Warm backstage lighting, intimate contrast to the stage.`,
    },
    {
      id: 'S57',
      title: "Dev's Energy — Aftermath",
      plot: "Dev paces, buzzing with energy, replaying highlights. He can't stand still. This is the biggest thing he's ever been close to.",
      prompt: `${WORLD} ${DEV} Dev pacing backstage, gesticulating wildly, replaying the demo highlights with his whole body. He mimes the audience's shocked faces, the drone wobble, the predictions landing. His rings flash as he gestures. He's a one-man hype machine running at full speed. Eli and Maya watch him with fond amusement. Warm amber backstage light.`,
    },
    {
      id: 'S58',
      title: 'Eli Packs Up — Quiet',
      plot: 'While Dev buzzes, Eli quietly packs his laptop into his backpack. Methodical. Calm. Already past the moment.',
      prompt: `${WORLD} ${ELI} Close-up of Eli's hands carefully sliding his laptop into the beat-up backpack. Methodical, gentle — he treats the machine like it's alive. Dev's excited chatter is out of focus behind him. Eli zips the bag. He's already moved on from the demo. His mind is elsewhere. Intimate close-up, warm amber lighting on his hands and the worn canvas.`,
    },
    {
      id: 'S59',
      title: 'Celeste Appears',
      plot: 'Celeste appears backstage like she was always there. White suit pristine among cables and equipment. "Eli Reyes."',
      prompt: `${WORLD} ${CELESTE} ${ELI} Celeste materializes in the backstage area as if she'd been standing there the whole time. White suit impossibly clean among dirty cables and equipment cases. Dev and Maya freeze. She addresses Eli directly. Two different worlds meeting at the boundary. The air charges. Medium shot framing Celeste's entrance, the backstage grunge against her polish.`,
    },
    {
      id: 'S60',
      title: '"Depends who\'s asking"',
      plot: '"Eli Reyes." "Depends who\'s asking." First eye contact between Eli and Celeste. Two kinds of power meeting.',
      prompt: `${WORLD} ${CELESTE} ${ELI} Close-up two-shot: Celeste and Eli lock eyes for the first time. She is polished, composed, in control. He is scruffy, guarded, defiant. Neither blinks. Two entirely different kinds of power recognizing each other. The white suit against the black hoodie. Silver against worn canvas. Shot-reverse-shot, intimate, charged.`,
    },
    {
      id: 'S61',
      title: "Celeste's Pitch",
      plot: '"Celeste Vane. Quarry Ventures. You\'re not raising properly." Maya: "We\'re not raising at all."',
      prompt: `${WORLD} ${CELESTE} ${MAYA} Celeste introduces herself smoothly, practiced, every word placed. Maya cuts in from the side — flat, direct, unimpressed. Celeste doesn't flinch. She expected pushback. Two women sizing each other up: the operator and the recruiter. Medium three-shot capturing the dynamic, Maya's protective stance near Eli.`,
    },
    {
      id: 'S62',
      title: '"Apply to E Combonator"',
      plot: '"That can be fixed. You should apply to E Combonator." Eli shrugs. "I\'m building infrastructure, not a pitch deck." Celeste: "In this valley, that\'s the same thing."',
      prompt: `${WORLD} ${CELESTE} ${ELI} Celeste makes her pitch — smooth, confident, offering a door. Eli shrugs it off, uninterested in performing. Celeste's expression shifts: a flicker of something — respect? hunger? — at his refusal to be impressed. The dance of recruitment. Close-ups alternating between them, the push and pull visible in microexpressions.`,
    },
    {
      id: 'S63',
      title: 'The Black Card',
      plot: 'She hands him a black card with a simple embossed letter: E. "You keep winning rooms that don\'t know what you are. Come to one that does."',
      prompt: `${WORLD} ${CELESTE} ${ELI} Extreme close-up of the matte black business card being offered. A single letter — E — embossed and catching the light. Celeste's manicured fingers holding it out. Eli's rougher hand reaching for it. The card between them like a contract, a weapon, an invitation. Pull focus from the card to Celeste's composed face, then to Eli's uncertain eyes. Dramatic shallow depth of field.`,
    },

    // ── TRUST & WARNING (64-66) ──
    {
      id: 'S64',
      title: 'Celeste Leaves',
      plot: "She leaves. Unhurried. She already knows he'll come.",
      prompt: `${WORLD} ${CELESTE} Celeste turns and walks away through the backstage area. Unhurried, heels clicking on concrete, white suit disappearing into the dark. She doesn't look back. She doesn't need to. The camera holds on her retreating figure, then racks focus back to Eli holding the black card. The space she leaves behind feels deliberate.`,
    },
    {
      id: 'S65',
      title: "Maya's Warning",
      plot: 'Maya looks at Eli. "I don\'t trust her."',
      prompt: `${WORLD} ${MAYA} ${ELI} Maya turns to Eli, dead serious. Her smart glasses reflect the backstage lights. She looks at the black card in his hand, then at his face. Her expression is clear: danger. She doesn't need to explain why. She reads people better than GHOSTLATTICE reads physics. Close-up two-shot, Maya's concern versus Eli's curiosity. Tension.`,
    },
    {
      id: 'S66',
      title: "Dev's Truth",
      plot: '"I do. Which is how you know she\'s dangerous." Dev delivers the truest line of the night disguised as a joke.',
      prompt: `${WORLD} ${DEV} Dev leans against a road case, arms crossed, suddenly serious. His usual grin is gone. He delivers the line that cuts through everything. For a moment, the joker is the wisest person in the room. Then the grin flickers back, masking the insight. Medium shot, warm amber light, the moment comedy becomes prophecy.`,
    },

    // ── AWARDS & THE FINAL LINE (67-70) ──
    {
      id: 'S67',
      title: 'Awards Stage — First Place',
      plot: '"And first place goes to… GhostLattice." Crowd cheers, half impressed, half uncomfortable. Eli walks up. Cameras flash.',
      prompt: `${WORLD} ${ELI} The awards stage blazes with light. The host announces the winner. The crowd erupts — but the applause is complicated. Half admiration, half unease. They just saw something that terrifies them and they're clapping for it. Eli walks to the podium, cameras flashing, the white streak in his hair catching every strobe. Wide shot of divided energy.`,
    },
    {
      id: 'S68',
      title: 'Celeste in the Back — Studying',
      plot: "Eli looks over the crowd and sees Celeste in the back, not clapping — studying him. A predator watching prey that doesn't know it yet.",
      prompt: `${WORLD} ${ELI} ${CELESTE} From Eli's POV on the awards stage, looking out over the cheering, filming, applauding crowd. In the very back, past all the noise, Celeste stands completely still. Not clapping. Hands clasped. Watching. Her white suit a beacon in the dark back of the room. Everyone else is reacting. She is calculating. Shallow depth of field isolating her stillness.`,
    },
    {
      id: 'S69',
      title: '"Shopping for Weapons"',
      plot: '"You all keep calling this a hackathon." He looks at the investors. "But some of you are shopping for weapons." The room goes still.',
      prompt: `${WORLD} ${ELI} Eli holds the trophy but doesn't smile. He looks directly into the front rows — past the developers, into the investors. His voice is quiet but it carries. The room freezes. No more phones up. No more applause. Just his words hanging in the air like a verdict. The white streak, the tired eyes, the black hoodie — a prophet nobody asked for. Close-up of his face delivering the line, then wide shot of the frozen room.`,
    },
    {
      id: 'S70',
      title: "Celeste's Smile — CUT TO BLACK",
      plot: "Cut to Celeste's faint smile. She found something more interesting than a weapon. She found someone who knows what he's carrying. CUT TO BLACK.",
      prompt: `${WORLD} ${CELESTE} Final shot: Celeste's face in the back of the silent room. That faint, knowing smile finally forming. Not the smile of someone who's impressed. The smile of someone who's found exactly what she's been hunting for. Her silver jewelry catches the last light. The smile widens imperceptibly. Then — hard cut to black. Total darkness. End of Episode 1. Extreme close-up, dramatic, final.`,
    },
  ];
}
// ── Main ──────────────────────────────────────────────────────────────
async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('  E COMBONATOR — Episode 1: "The Weird Kid Always Wins"');
  console.log('  70 Scenes × 10s = ~12 min footage');
  console.log('  Seedance 2.0 → On-chain Nodes');
  console.log('='.repeat(60));

  if (!BYTEDANCE_API_KEY) throw new Error('BYTEDANCE_API_KEY not set');

  // Authenticate to pull wiki data
  const token = await getAuthToken();

  // Pull character DNA from wiki
  const dna = await fetchCharacterDNA(token);
  log('WIKI', `Loaded ${Object.keys(dna).length} character profiles`);

  // Build scenes with wiki-sourced character descriptions
  const SCENES = buildScenes(dna);
  log('SCENES', `Built ${SCENES.length} scenes`);

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

  // Skip scenes already confirmed on-chain from previous run
  const DONE = new Set(['S01', 'S03', 'S04', 'S05', 'S06', 'S15']);

  for (let i = 0; i < SCENES.length; i++) {
    const scene = SCENES[i];
    const label = `${scene.id} (${i + 1}/${SCENES.length})`;

    if (DONE.has(scene.id)) {
      log(label, `SKIP — already on-chain`);
      continue;
    }

    console.log(`\n--- ${scene.id}: ${scene.title} ---`);

    try {
      // 1. Generate video
      const videoUrl = await generateVideo(scene.prompt, label);

      // 2. On-chain node
      const contentHash = `ecomb-${scene.id}-${Date.now()}`;
      const nodeId = await createNode(contentHash, scene.plot, previousId, videoUrl, label);
      previousId = nodeId;

      results.push({ id: scene.id, title: scene.title, nodeId });
      log(label, `DONE — Node #${nodeId}`);
    } catch (err: any) {
      log(label, `FAILED: ${err.message?.slice(0, 200)}`);
      log(label, 'Skipping — continuing with next scene');
    }

    if (i < SCENES.length - 1) await sleep(2000);
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('  E COMBONATOR EP.1 — Generation Complete');
  console.log('='.repeat(60));
  console.log(`  Scenes completed: ${results.length}/${SCENES.length}`);
  console.log(
    `  Total footage: ~${results.length * 10}s (~${((results.length * 10) / 60).toFixed(1)} min)`
  );
  console.log(`  Node chain: ${results.map((r) => `#${r.nodeId}`).join(' → ')}`);
  console.log('');
  for (const r of results) {
    console.log(`  ${r.id} | ${r.title.padEnd(40)} | Node #${r.nodeId}`);
  }
  console.log(`\n  Universe: ${UNIVERSE_ADDR}`);
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
