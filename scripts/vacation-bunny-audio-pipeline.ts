/**
 * THE VACATION BUNNY UNIVERSE — Audio Pipeline
 * Pilot: "Butterfly Days in Cannes" — 56 scenes, dialogue-free
 *
 * Steps:
 *   1. Fetch NodeCreated events from Sepolia → scene-ID → video URL map
 *   2. Download all videos to ./vacation-bunny-output/videos/
 *   3. Generate 5 music tracks (soft piano → orchestral → waltz → emotional → ambient)
 *   4. Generate per-scene SFX via ElevenLabs /sound-generation
 *   5. ffmpeg mix per scene: video + SFX + music (low volume under)
 *   6. Concat all 56 scenes in script order → butterfly-days-in-cannes-final.mp4
 *
 * Usage: BUNNY_ADDR=0x... pnpm tsx scripts/vacation-bunny-audio-pipeline.ts
 * Env: ELEVENLABS_API_KEY, FAL_KEY, PINATA_JWT, PRIVATE_KEY, RPC_URL
 * Opt: VB_OUTPUT_DIR, VB_SCENES (CSV of scene IDs to process only)
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
import * as fal from '@fal-ai/serverless-client';
import { createPublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import { execSync } from 'child_process';

const EL_KEY = process.env.ELEVENLABS_API_KEY!;
const FK = process.env.FAL_KEY!;
const RPC = process.env.RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com';
const UADDR = (process.env.BUNNY_ADDR ??
  '0x8e5cDdb763534Fe426766e4eB035449fB9e73913') as `0x${string}`;
const ODIR = process.env.VB_OUTPUT_DIR || './vacation-bunny-output';
const SFILT = process.env.VB_SCENES
  ? new Set(process.env.VB_SCENES.split(',').map((s) => s.trim()))
  : null;
const EBASE = 'https://api.elevenlabs.io/v1';

const L = (tag: string, msg: string) => console.log(`[${tag}] ${msg}`);
const Z = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const mkdir = (d: string) => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
};

// ── ElevenLabs SFX ─────────────────────────────────────────────────────
async function sfx(description: string, seconds: number): Promise<Buffer> {
  const body: Record<string, unknown> = { text: description, prompt_influence: 0.4 };
  if (seconds) body.duration_seconds = seconds;
  const r = await fetch(`${EBASE}/sound-generation`, {
    method: 'POST',
    headers: { 'xi-api-key': EL_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`11L SFX ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return Buffer.from(await r.arrayBuffer());
}

// ── FAL music ──────────────────────────────────────────────────────────
const fInit = () => fal.config({ credentials: FK });
async function fMusic(prompt: string, seconds: number): Promise<string> {
  fInit();
  const clamped = Math.min(seconds, 47);
  const r = await fal.subscribe('fal-ai/stable-audio', {
    input: { prompt, seconds_total: clamped, steps: 100 },
    logs: true,
  });
  const d = (r as any).data || r;
  return d.audio_file?.url || d.audio?.url || d.audio_url || d.url;
}

async function dl(url: string, dest: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`DL ${r.status} for ${url.slice(0, 80)}`);
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
}

// ── Scene defs — SFX + music phase ─────────────────────────────────────
interface SceneDef {
  id: string;
  title: string;
  /** Unique substring from the on-chain plot field to match this scene. */
  plotMatch: string;
  /** ElevenLabs SFX description — atmospheric, no dialogue. */
  sfx: string;
  /** Which music phase this scene belongs to. */
  music: 'piano' | 'orchestral' | 'waltz' | 'emotional' | 'ambient';
}

const SCENES: SceneDef[] = [
  // SCENE 1 — MORNING MAGIC (soft piano)
  {
    id: 'S01',
    title: 'Morning Light Floods Apartment',
    plotMatch: 'warm sunlight fills the cozy',
    sfx: 'Gentle morning ambient: soft breeze through curtains, distant Mediterranean seabirds, quiet apartment air, warm peaceful silence, faint ticking clock.',
    music: 'piano',
  },
  {
    id: 'S02',
    title: 'Baby Bunny Asleep — Pendant on Chest',
    plotMatch: 'pajamas. The purple pendant rests',
    sfx: 'Tiny soft sleeping breath, morning bedroom ambient, subtle rustle of pastel bedsheets.',
    music: 'piano',
  },
  {
    id: 'S03',
    title: 'Judy Asleep — White Pendant on Table',
    plotMatch: 'asleep in soft sleepwear',
    sfx: 'Peaceful sleeping breath, soft bedroom morning ambient, tiny metallic shimmer of jewelry on wood.',
    music: 'piano',
  },
  {
    id: 'S04',
    title: 'They Wake Up — Shared Smile',
    plotMatch: 'Judy wakes and smiles',
    sfx: 'Soft waking rustle, tiny bunny stretch sounds, small excited bounce on mattress, morning birdsong faint through window.',
    music: 'piano',
  },
  {
    id: 'S05',
    title: 'Outfit Montage',
    plotMatch: 'Quick montage',
    sfx: 'Fabric rustle, tulle swishing, tiny clasp click of silver chain, playful quick movement sounds.',
    music: 'piano',
  },
  {
    id: 'S06',
    title: 'Mirror Moment — Color Contrast',
    plotMatch: 'Both stand in front of the antique mirror',
    sfx: 'Soft apartment ambient, gentle clothes shifting, quiet morning hush.',
    music: 'piano',
  },
  {
    id: 'S07',
    title: 'Sparkle Makeup — Judy Applies',
    plotMatch: 'applying soft sparkle to her eyebrows',
    sfx: 'Delicate makeup brush whisper, soft tinkling sparkle magic sound, quiet bedroom ambient.',
    music: 'piano',
  },
  {
    id: 'S08',
    title: 'Baby Bunny Gets Sparkle Too',
    plotMatch: 'gestures asking for makeup',
    sfx: 'Soft gentle brush strokes, tiny excited bunny squeak, magical sparkle shimmer.',
    music: 'piano',
  },
  {
    id: 'S09',
    title: 'Mirror Selfie Playtime',
    plotMatch: 'Music becomes playful',
    sfx: 'Playful tutu swish spinning, tiny paws patting, happy bunny giggle sounds, joyful movement ambient.',
    music: 'piano',
  },
  {
    id: 'S10',
    title: 'Shared Smile Beat',
    plotMatch: 'soft shared smile in the mirror',
    sfx: 'Quiet held breath, soft warm room ambient, tiny magical pendant chime.',
    music: 'piano',
  },

  // SCENE 2 — BAKERY RITUAL (soft piano)
  {
    id: 'S11',
    title: 'Cannes Morning Street',
    plotMatch: 'Cannes morning street',
    sfx: 'Cobblestone footsteps, distant French village morning, tiny songbirds, soft breeze, gentle church bell far away.',
    music: 'piano',
  },
  {
    id: 'S12',
    title: 'Bakery Interior — Latte & Milk',
    plotMatch: 'Inside the bakery',
    sfx: 'Espresso machine steam hiss, milk pouring, quiet bakery morning hum, soft music playing very faint.',
    music: 'piano',
  },
  {
    id: 'S13',
    title: 'Pastry Wonder',
    plotMatch: 'reacting to the pastries',
    sfx: 'Soft tiny gasp of wonder, delicate glass tap, distant bakery bustle, warm morning ambient.',
    music: 'piano',
  },
  {
    id: 'S14',
    title: 'Croissant Shared',
    plotMatch: 'breaks a warm croissant',
    sfx: 'Crisp flaky croissant breaking, tiny happy claps, soft bakery background.',
    music: 'piano',
  },
  {
    id: 'S15',
    title: 'Milk Moustache — Watching',
    plotMatch: 'milk moustache',
    sfx: 'Tiny sipping sound from glass, soft happy swallow, quiet bakery ambient, warm maternal laugh whisper.',
    music: 'piano',
  },
  {
    id: 'S16',
    title: 'Pendants Catch Morning Light',
    plotMatch: 'pendants resting on their chests',
    sfx: 'Magical soft chime, tiny metal shimmer, warm bakery hum under.',
    music: 'piano',
  },

  // SCENE 3 — BEACH LUNCH (light orchestral)
  {
    id: 'S17',
    title: 'Beach Restaurant — Yellow Parasols',
    plotMatch: 'beach restaurant with rows of yellow parasols',
    sfx: 'Ocean waves lapping white sand, seabirds calling, parasol fabric flutter in sea breeze, distant restaurant chatter, glassware tinkle.',
    music: 'orchestral',
  },
  {
    id: 'S18',
    title: 'Table Setup — Ocean View',
    plotMatch: 'ocean view from their corner table',
    sfx: 'Gentle ocean wash, soft restaurant ambient, fries being placed on plate, crystal glasses set down.',
    music: 'orchestral',
  },
  {
    id: 'S19',
    title: 'The Clink — Crystal Glasses',
    plotMatch: 'cocktail glass and Baby Bunny',
    sfx: 'Crystal glasses clinking delicately, tiny magical shimmer, soft ocean backdrop.',
    music: 'orchestral',
  },
  {
    id: 'S20',
    title: 'The Seagull Swoops',
    plotMatch: 'plump seagull lands',
    sfx: 'Seagull wingbeat and cheeky squawk, surprised bunny gasp, restaurant glass rattle, comedic moment sound.',
    music: 'orchestral',
  },
  {
    id: 'S21',
    title: 'Baby Bunny Shocked',
    plotMatch: 'mouth open in total disbelief',
    sfx: 'Tiny shocked gasp, frozen moment ambient, very soft ocean underneath.',
    music: 'orchestral',
  },
  {
    id: 'S22',
    title: 'Baby Bunny Rises Bravely',
    plotMatch: 'stands bravely on her chair',
    sfx: 'Heroic little whoosh, brave tiny bunny war cry, brass orchestra hint.',
    music: 'orchestral',
  },
  {
    id: 'S23',
    title: 'The Chase',
    plotMatch: 'chases the seagull',
    sfx: 'Tiny hopping footsteps on wooden deck, seagull flapping away with squawks, playful chase sound, orchestral scramble.',
    music: 'orchestral',
  },
  {
    id: 'S24',
    title: 'Resolution — Judy Laughs Silently',
    plotMatch: 'returns proud. Judy laughs silently',
    sfx: 'Proud bunny huff, soft silent-laugh breath, ocean waves, victory calm.',
    music: 'orchestral',
  },

  // SCENE 4 — CASTLE & TOWER (light orchestral → emotional)
  {
    id: 'S25',
    title: 'The Castle on the Hill',
    plotMatch: 'old stone castle on a hill',
    sfx: 'Wind on stone, distant medieval ambience, Mediterranean cicadas, warm afternoon air.',
    music: 'orchestral',
  },
  {
    id: 'S26',
    title: 'Walking Up Hand-in-Hand',
    plotMatch: 'walking up the stone path',
    sfx: 'Small feet on worn stone steps, cypress leaves rustling, distant seaside breeze, cicadas.',
    music: 'orchestral',
  },
  {
    id: 'S27',
    title: 'Baby Bunny Amazed',
    plotMatch: 'amazed. Reveal of the tower',
    sfx: 'Soft awed gasp, wind high in the tower, distant bird call, atmospheric scale reveal.',
    music: 'orchestral',
  },
  {
    id: 'S28',
    title: 'Spiral Staircase Climb',
    plotMatch: 'Spiral upward shot',
    sfx: 'Echoing tiny footsteps in stone spiral staircase, ancient tower reverb, subtle wind through arrow-slit.',
    music: 'orchestral',
  },
  {
    id: 'S29',
    title: 'Small Steps Climbing',
    plotMatch: 'small steps on stone',
    sfx: 'Gentle tiny feet hopping on stone, hem fabric brushing, soft breathing, echoing tower space.',
    music: 'orchestral',
  },
  {
    id: 'S30',
    title: 'Princess Spin — Tutu Expands',
    plotMatch: 'tutu expands beautifully',
    sfx: 'Magical slow-motion whoosh, tulle billowing, shimmering sparkle, soft orchestral swell breath.',
    music: 'orchestral',
  },
  {
    id: 'S31',
    title: '360° Top of Tower',
    plotMatch: '360° Cannes view',
    sfx: 'Panoramic windswept mountaintop ambient, distant sea, soaring vista whoosh, warm open air.',
    music: 'orchestral',
  },
  {
    id: 'S32',
    title: "Judy's Emotional Moment",
    plotMatch: 'kisses Baby Bunny on the head',
    sfx: 'Soft tender kiss sound, wind on stone, held emotional breath, warm sniff, tiny tear moment.',
    music: 'emotional',
  },
  {
    id: 'S33',
    title: 'Pendants Side-by-Side — Soft Glow',
    plotMatch: 'pendants side-by-side with a soft glow',
    sfx: 'Magical warm glow chime, tiny pendant shimmer, held emotional hush, distant wind.',
    music: 'emotional',
  },

  // SCENE 5 — CAROUSEL NIGHTS (dreamy waltz)
  {
    id: 'S34',
    title: 'Night Carousel Glow',
    plotMatch: 'carousel glowing, bubbles',
    sfx: 'Magical carousel bells, distant waltz organ, soap bubble pops, warm night seaside ambient, soft laughter of families.',
    music: 'waltz',
  },
  {
    id: 'S35',
    title: 'Baby Bunny Runs to Carousel',
    plotMatch: 'runs excitedly toward the carousel',
    sfx: 'Tiny happy running feet on promenade stones, excited breathless giggle, carousel music growing closer, bubble pops.',
    music: 'waltz',
  },
  {
    id: 'S36',
    title: 'She Points — the Black Horse',
    plotMatch: 'points to the black horse',
    sfx: 'Carousel organ music, soft wooden creak of horses in rotation, magical twinkle.',
    music: 'waltz',
  },
  {
    id: 'S37',
    title: 'The Ride — Circular Camera',
    plotMatch: 'Circular camera motion',
    sfx: 'Full carousel waltz music playing, rhythmic rise-and-fall wooden horse creak, bubble pops, happy breath, night seaside.',
    music: 'waltz',
  },
  {
    id: 'S38',
    title: 'Judy Joins — Mother Rides Too',
    plotMatch: 'Judy decides',
    sfx: 'Gentle mounting of carousel horse, soft laughter, continuing waltz, bubble pops, warm night.',
    music: 'waltz',
  },
  {
    id: 'S39',
    title: 'Slow-Mo Bubbles and Glowing Dress',
    plotMatch: 'bubbles + glowing tutu',
    sfx: 'Dreamy slow-motion whoosh, iridescent bubble chimes, carousel waltz muted and distant, magical atmospheric swell.',
    music: 'waltz',
  },

  // SCENE 6 — GELATO EVENING (emotional piano)
  {
    id: 'S40',
    title: 'Gelato Case — Matcha & Chocolate',
    plotMatch: 'matcha & chocolate gelato',
    sfx: 'Gelato shop evening ambient, glass case hum, spoons clinking, soft dusk crowd, distant promenade waves.',
    music: 'emotional',
  },
  {
    id: 'S41',
    title: 'Choosing Flavors',
    plotMatch: 'Judy points matcha',
    sfx: 'Gelato being scooped onto waffle cone, soft interior ambient, happy tiny vocalization.',
    music: 'emotional',
  },
  {
    id: 'S42',
    title: 'Messy Chocolate — Judy Cleans',
    plotMatch: 'chocolate on her cheek',
    sfx: 'Soft napkin dab, warm maternal hum, gentle sigh, distant ocean waves.',
    music: 'emotional',
  },
  {
    id: 'S43',
    title: 'Sitting by the Ocean — Pendants Tap',
    plotMatch: 'necklaces lightly tap as they lean',
    sfx: 'Gentle ocean waves lapping, pendant chime-tap of tiny metal on metal, warm seaside dusk ambient, soft contentment breath.',
    music: 'emotional',
  },

  // SCENE 7 — NIGHT REFLECTION (emotional → ambient)
  {
    id: 'S44',
    title: 'Quiet Apartment at Night',
    plotMatch: 'quiet apartment in soft moonlight',
    sfx: 'Very quiet night apartment, distant ocean whisper through open window, soft curtain movement, warm silence.',
    music: 'ambient',
  },
  {
    id: 'S45',
    title: 'Baby Bunny Asleep in Pajamas',
    plotMatch: 'asleep in pastel pajamas. Tiara',
    sfx: 'Tiny peaceful sleeping breath, quiet moonlit bedroom, gentle nighttime hush.',
    music: 'ambient',
  },
  {
    id: 'S46',
    title: 'Judy Watching — No Pendant',
    plotMatch: 'Judy watching her sleep',
    sfx: 'Soft maternal breath, fabric of sleepwear shifting, deep peaceful night ambient.',
    music: 'ambient',
  },
  {
    id: 'S47',
    title: 'Memory Montage — Mirror, Bakery, Beach',
    plotMatch: 'mirror selfies, bakery joy, beach bravery',
    sfx: 'Warm memory whoosh transitions, tiny echoes of earlier moments softened, nostalgic reverb, distant emotion.',
    music: 'emotional',
  },
  {
    id: 'S48',
    title: 'Memory Montage — Tower, Carousel',
    plotMatch: 'Montage continues: tower view',
    sfx: 'Warm memory whoosh transitions, soft pendant chime, carousel bells muted and distant, nostalgic reverb.',
    music: 'emotional',
  },
  {
    id: 'S49',
    title: 'Final Shot — Two Pendants',
    plotMatch: 'white + purple pendants resting close',
    sfx: 'Tiny magical chime of two pendants touching, deep emotional held hush, single soft piano breath, slow fade.',
    music: 'ambient',
  },

  // TITLE CARD
  {
    id: 'S50',
    title: 'Title Card — Butterfly Days in Cannes',
    plotMatch: 'Title card',
    sfx: 'Single warm piano sustain, soft magical butterfly flutter, peaceful end-of-film ambient.',
    music: 'ambient',
  },

  // AFTER-CREDITS (emotional piano)
  {
    id: 'S51',
    title: 'Older Baby Bunny at the Mirror',
    plotMatch: 'older Baby Bunny stands at a mirror',
    sfx: 'Quiet older-room ambient, soft breath, warm lamp hum.',
    music: 'emotional',
  },
  {
    id: 'S52',
    title: 'She Applies Her Own Sparkle Makeup',
    plotMatch: 'sparkle to her own eyebrows',
    sfx: 'Delicate makeup brush whisper, soft tinkling sparkle magic, quiet room.',
    music: 'emotional',
  },
  {
    id: 'S53',
    title: 'Judy Appears Behind Her',
    plotMatch: 'after-credits',
    sfx: 'Soft magical reveal shimmer, warm maternal presence, gentle held breath, emotional piano note.',
    music: 'emotional',
  },
  {
    id: 'S54',
    title: 'Final Callback Pose',
    plotMatch: 'One soft, simple pose',
    sfx: 'Soft closeness breath, warm emotional piano breath, calm meaningful room ambient.',
    music: 'emotional',
  },
  {
    id: 'S55',
    title: 'Beach at Sunrise — Walking Side-by-Side',
    plotMatch: 'beach at sunrise',
    sfx: 'Gentle sunrise ocean waves, soft sand footsteps, peaceful dawn seabird call, warm dawn breeze.',
    music: 'ambient',
  },
  {
    id: 'S56',
    title: 'Pendants Sway — Butterfly Glow',
    plotMatch: 'purple pendant + white pendant sway',
    sfx: 'Tiny pendant chime touching, magical butterfly flutter rising, final held ambient swell, warm piano sustain fade to silence.',
    music: 'ambient',
  },
];

// ── Music phases ───────────────────────────────────────────────────────
interface MusicPhase {
  id: string;
  prompt: string;
  seconds: number;
}
const MUSIC_PHASES: Record<SceneDef['music'], MusicPhase> = {
  piano: {
    id: 'M01-piano',
    prompt:
      'Soft gentle solo piano, warm morning melody, Pixar-style children film score, tender mother-and-daughter theme, simple hopeful notes, no vocals, peaceful start-of-day mood, dreamy, emotional, high-quality animated family film soundtrack.',
    seconds: 47,
  },
  orchestral: {
    id: 'M02-orchestral',
    prompt:
      'Light playful orchestral children animated film score, warm strings and flute, adventure on a sunny Mediterranean coast, bright brass stabs for comedy moments, curious woodwinds, orchestral warmth, no vocals, heartwarming kids feature soundtrack.',
    seconds: 47,
  },
  waltz: {
    id: 'M03-waltz',
    prompt:
      'Dreamy magical waltz, seaside night carousel theme, twinkling celesta, soft strings, warm accordion, slow three-quarter time, enchanted children animated film, bubbles in the air, no vocals, wondrous nighttime mood.',
    seconds: 47,
  },
  emotional: {
    id: 'M04-emotional',
    prompt:
      'Emotional tender solo piano with soft warm strings, mother-daughter bond theme, Pixar-style heartwarming score, gentle tears-in-eyes melody, nostalgic, memory-dreamy, no vocals, children animated film emotional climax.',
    seconds: 47,
  },
  ambient: {
    id: 'M05-ambient',
    prompt:
      'Minimal peaceful ambient, soft sustained warm pad, single gentle piano note, end-of-film quiet conclusion, warm closing theme, no vocals, children animated film soft fade-out mood, butterfly magic.',
    seconds: 47,
  },
};

// ── Chain fetch ────────────────────────────────────────────────────────
async function fetchVideoUrls(): Promise<Record<string, { url: string; plot: string }>> {
  const pc = createPublicClient({ chain: sepolia, transport: http(RPC) });
  const ev = {
    type: 'event' as const,
    name: 'NodeCreated' as const,
    inputs: [
      { name: 'id', type: 'uint256' as const, indexed: true },
      { name: 'previous', type: 'uint256' as const, indexed: true },
      { name: 'creator', type: 'address' as const, indexed: true },
      { name: 'contentHash', type: 'bytes32' as const },
      { name: 'plotHash', type: 'bytes32' as const },
      { name: 'link', type: 'string' as const },
      { name: 'plot', type: 'string' as const },
    ],
  };
  const latest = await pc.getBlockNumber();
  const chunkSize = 4500n;
  const startBlock = latest > 20000n ? latest - 20000n : 0n;
  L('CHAIN', `Scanning ${startBlock}..${latest}`);

  const allLogs: any[] = [];
  for (let from = startBlock; from <= latest; from += chunkSize) {
    const to = from + chunkSize - 1n > latest ? latest : from + chunkSize - 1n;
    try {
      const logs = await pc.getLogs({ address: UADDR, event: ev, fromBlock: from, toBlock: to });
      allLogs.push(...logs);
    } catch (err: any) {
      L('CHAIN', `chunk ${from}..${to} failed: ${err.message?.slice(0, 80)}`);
    }
  }
  L('CHAIN', `${allLogs.length} NodeCreated events`);

  const m: Record<string, { url: string; plot: string }> = {};
  // Walk events — match each plot against SCENES[].plotMatch using .includes()
  // Later nodes overwrite earlier ones (regens take precedence).
  for (const l of allLogs) {
    const link = (l.args as any).link as string;
    const plot = (l.args as any).plot as string;
    if (!plot || !link) continue;
    for (const s of SCENES) {
      if (plot.toLowerCase().includes(s.plotMatch.toLowerCase())) {
        m[s.id] = { url: link, plot };
        break;
      }
    }
  }
  L('CHAIN', `Matched ${Object.keys(m).length}/56 scenes`);
  const missing = SCENES.filter((s) => !m[s.id]).map((s) => s.id);
  if (missing.length) L('CHAIN', `Missing: ${missing.join(', ')}`);
  return m;
}

// ── FFmpeg ─────────────────────────────────────────────────────────────
function ffMixScene(videoPath: string, sfxPath: string, musicPath: string, out: string) {
  const cmd = [
    'ffmpeg',
    '-y',
    '-i',
    videoPath,
    '-i',
    sfxPath,
    '-i',
    musicPath,
    '-filter_complex',
    '"[1:a]volume=0.55,apad[s];[2:a]volume=0.35,apad[m];[s][m]amix=inputs=2:duration=first:dropout_transition=2[a]"',
    '-map',
    '0:v',
    '-map',
    '[a]',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-shortest',
    `"${out}"`,
  ].join(' ');
  execSync(cmd, { stdio: 'pipe', timeout: 90_000 });
}

function ffConcat(scenePaths: string[], out: string) {
  // Normalize all to 720p/30fps/yuv420p/48kHz stereo first via concat filter
  const listFile = path.join(ODIR, 'concat-list.txt');
  fs.writeFileSync(listFile, scenePaths.map((p) => `file '${path.resolve(p)}'`).join('\n'));
  const cmd = [
    'ffmpeg',
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    `"${listFile}"`,
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-crf',
    '20',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    `"${out}"`,
  ].join(' ');
  execSync(cmd, { stdio: 'inherit', timeout: 600_000 });
}

// ── Main ──────────────────────────────────────────────────────────────
async function main() {
  console.log('\n=== VACATION BUNNY — Audio Pipeline ("Butterfly Days in Cannes") ===\n');
  if (!EL_KEY) throw new Error('ELEVENLABS_API_KEY missing');
  if (!FK) throw new Error('FAL_KEY missing');
  try {
    execSync('ffmpeg -version', { stdio: 'pipe' });
  } catch {
    throw new Error('ffmpeg required');
  }

  mkdir(ODIR);
  for (const d of ['videos', 'sfx', 'music', 'final', 'logs']) mkdir(path.join(ODIR, d));

  // Step 1: video URLs from chain
  const vids = await fetchVideoUrls();
  const missing = SCENES.filter((s) => !vids[s.id]).map((s) => s.id);
  if (missing.length) {
    L('WARN', `Missing videos for: ${missing.join(', ')}. Will skip those scenes.`);
  }

  // Step 2: download all videos
  L('DL', 'Downloading videos...');
  for (const s of SCENES) {
    if (!vids[s.id]) continue;
    const dest = path.join(ODIR, 'videos', `${s.id}.mp4`);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 100_000) continue;
    try {
      await dl(vids[s.id].url, dest);
      L('DL', `  ${s.id} ok (${(fs.statSync(dest).size / 1024 / 1024).toFixed(1)}MB)`);
    } catch (err: any) {
      L('DL', `  ${s.id} FAIL: ${err.message?.slice(0, 100)}`);
    }
  }

  // Step 3: generate music phases
  L('MUSIC', 'Generating music phases...');
  const musicFiles: Record<SceneDef['music'], string> = {} as any;
  for (const [phase, def] of Object.entries(MUSIC_PHASES) as Array<
    [SceneDef['music'], MusicPhase]
  >) {
    const dest = path.join(ODIR, 'music', `${def.id}.mp3`);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 10_000) {
      musicFiles[phase] = dest;
      L('MUSIC', `  ${def.id} cached`);
      continue;
    }
    try {
      const url = await fMusic(def.prompt, def.seconds);
      if (url) {
        await dl(url, dest);
        musicFiles[phase] = dest;
        L('MUSIC', `  ${def.id} generated`);
      }
    } catch (err: any) {
      L('MUSIC', `  ${def.id} FAIL: ${err.message?.slice(0, 120)}`);
    }
    await Z(2000);
  }

  // Step 4: generate per-scene SFX
  L('SFX', 'Generating SFX per scene...');
  const active = SFILT ? SCENES.filter((s) => SFILT!.has(s.id)) : SCENES;
  for (const s of active) {
    const dest = path.join(ODIR, 'sfx', `${s.id}.mp3`);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 5_000) continue;
    try {
      fs.writeFileSync(dest, await sfx(s.sfx, 10));
      L('SFX', `  ${s.id} ok`);
    } catch (err: any) {
      L('SFX', `  ${s.id} FAIL: ${err.message?.slice(0, 120)} — using silence`);
      fs.writeFileSync(dest, Buffer.alloc(44100 * 2));
    }
    await Z(1000);
  }

  // Step 5: mix per scene
  L('MIX', 'Mixing per-scene audio...');
  const finals: string[] = [];
  for (const s of active) {
    if (!vids[s.id]) continue;
    const video = path.join(ODIR, 'videos', `${s.id}.mp4`);
    const sfxFile = path.join(ODIR, 'sfx', `${s.id}.mp3`);
    const music = musicFiles[s.music];
    const out = path.join(ODIR, 'final', `${s.id}.mp4`);
    if (!music || !fs.existsSync(video) || !fs.existsSync(sfxFile)) {
      L('MIX', `  ${s.id} skip (missing inputs)`);
      continue;
    }
    if (!fs.existsSync(out) || fs.statSync(out).size < 100_000) {
      try {
        ffMixScene(video, sfxFile, music, out);
        L('MIX', `  ${s.id} ok`);
      } catch (err: any) {
        L('MIX', `  ${s.id} FAIL: ${err.message?.slice(0, 120)}`);
        continue;
      }
    }
    finals.push(out);
  }

  // Step 6: final concat in script order
  L('CONCAT', `Concatenating ${finals.length} scenes into final 10-min cut...`);
  const finalOut = path.join(ODIR, 'butterfly-days-in-cannes-final.mp4');
  try {
    ffConcat(finals, finalOut);
    const sz = (fs.statSync(finalOut).size / 1024 / 1024).toFixed(1);
    console.log(`\n✔ DONE — ${finalOut} (${sz}MB)`);
    console.log(`  Scenes: ${finals.length}/56`);
    console.log(`  Total runtime: ~${(finals.length * 10) / 60} min of core footage\n`);
  } catch (err: any) {
    console.error(`\n✘ Concat failed: ${err.message}`);
    console.log(`  Individual scene mixes are in: ${ODIR}/final/`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
