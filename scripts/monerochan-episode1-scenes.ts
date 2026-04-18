/**
 * MONEROCHAN — Episode 1: "Shadows of Freedom"
 *
 * 20 scenes via Seedance 2.0 → Firestore gallery nodes.
 * Cinematic photorealistic Hollywood trailer — Christopher Nolan × Denis Villeneuve
 * style with cyberpunk neon and dark electronic score.
 *
 * ~3 min episode (20 × 10s = 3.3 min core footage)
 *
 * Prerequisites:
 *   - Monerochan universe created (create-monerochan-universe.ts)
 *   - Wiki populated (entities exist)
 *   - Server running (pnpm dev:server) — only needed for wiki fetch
 *
 * Generation Modes:
 *   GEN_MODE=continuity  — Sequential i2v with frame handoff (slower, visual consistency)
 *   GEN_MODE=fast         — Parallel t2v in batches (faster, independent scenes)
 *
 * Usage:
 *   pnpm tsx scripts/monerochan-episode1-scenes.ts
 *   GEN_MODE=fast BATCH_SIZE=3 pnpm tsx scripts/monerochan-episode1-scenes.ts
 *   START_SCENE=S10 pnpm tsx scripts/monerochan-episode1-scenes.ts
 */
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { execSync } from 'child_process';
import fs from 'fs';
import { tmpdir } from 'os';

const BYTEDANCE_API_KEY = process.env.BYTEDANCE_API_KEY!;
const BD_BASE = 'https://ark.ap-southeast.bytepluses.com/api/v3';
const START_SCENE = process.env.START_SCENE ?? 'S01';
const GEN_MODE = (process.env.GEN_MODE ?? 'continuity') as 'continuity' | 'fast';
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE ?? '3', 10);
const RESUME_FRAME = process.env.RESUME_FRAME ?? '';
const UNIVERSE_ID = process.env.MONEROCHAN_ADDR ?? '';
/** STYLE=animated → anime-style short film (original spec) | STYLE=photoreal → Hollywood trailer */
const STYLE = (process.env.STYLE ?? 'photoreal') as 'photoreal' | 'animated';
/** Episode tag lets us run multiple variants without clobbering each other in the gallery */
const EPISODE_TAG =
  process.env.EPISODE_TAG ?? (STYLE === 'animated' ? 'episode-1-animated' : 'episode-1');

// ── Helpers ─────────────────────────────────────────────────────────────
function log(step: string, msg: string) {
  console.log(`[${step}] ${msg}`);
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Firebase init ───────────────────────────────────────────────────────
function initFirebase() {
  const saPath = path.resolve(
    process.cwd(),
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? 'firebase-sa-key-20260416.json'
  );
  let sa: any;
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } else {
    sa = JSON.parse(readFileSync(saPath, 'utf-8'));
  }
  const app = initializeApp({ credential: cert(sa) }, 'monerochan-ep1-' + Date.now());
  const db = getFirestore(app);
  db.settings({ preferRest: true });
  return db;
}

// ── Sanitize prompt to dodge ByteDance copyright filter ──────────────────
function sanitizePrompt(prompt: string, attempt: number): string {
  if (attempt === 0) return prompt;
  let p = prompt
    .replace(/\bMonerochan\b/gi, 'the young woman')
    .replace(/\bMonero\b/gi, 'privacy coin')
    .replace(/\bXMR\b/gi, 'crypto')
    .replace(/\bGuy Fawkes\b/gi, 'anonymous')
    .replace(/\bFederal Reserve\b/gi, 'central bank')
    .replace(/Christopher Nolan/gi, 'cinematic')
    .replace(/Denis Villeneuve/gi, 'epic cinematic');
  if (attempt >= 2) {
    p = p
      .replace(/photorealistic/gi, 'realistic')
      .replace(/Hollywood/gi, 'cinematic')
      .replace(/35mm film/gi, 'cinema camera');
  }
  return p;
}

// ── Frame extraction for scene continuity ───────────────────────────────
async function extractLastFrame(videoUrl: string, label: string): Promise<string | null> {
  try {
    const tmpFile = `${tmpdir()}/mc-frame-${Date.now()}.jpg`;
    const tmpVid = `${tmpdir()}/mc-vid-${Date.now()}.mp4`;
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
      return `data:image/jpeg;base64,${frameBuffer.toString('base64')}`;
    }
    const formData = new FormData();
    formData.append(
      'file',
      new Blob([frameBuffer], { type: 'image/jpeg' }),
      `frame-${Date.now()}.jpg`
    );
    formData.append('pinataMetadata', JSON.stringify({ name: `monerochan-continuity-${label}` }));
    const pinataRes = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
      method: 'POST',
      headers: { Authorization: `Bearer ${pinataJwt}` },
      body: formData,
    });
    if (!pinataRes.ok) return null;
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
        generate_audio: true,
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

// ── Upload video to Pinata IPFS for permanent storage ───────────────────
async function pinVideo(videoUrl: string, label: string): Promise<string> {
  const pinataJwt = process.env.PINATA_JWT;
  if (!pinataJwt) return videoUrl;

  const dlRes = await fetch(videoUrl);
  if (!dlRes.ok) throw new Error(`Failed to download video: ${dlRes.status}`);
  const buffer = Buffer.from(await dlRes.arrayBuffer());

  const formData = new FormData();
  formData.append('file', new Blob([buffer], { type: 'video/mp4' }), `${label}.mp4`);
  formData.append('pinataMetadata', JSON.stringify({ name: `monerochan-ep1-${label}` }));

  const pinataRes = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST',
    headers: { Authorization: `Bearer ${pinataJwt}` },
    body: formData,
  });
  if (!pinataRes.ok) {
    log(label, `Pinata upload failed (${pinataRes.status}) — using temp URL`);
    return videoUrl;
  }
  const { IpfsHash } = (await pinataRes.json()) as { IpfsHash: string };
  const gateway = process.env.PINATA_GATEWAY_URL || 'https://gateway.pinata.cloud';
  return `${gateway}/ipfs/${IpfsHash}`;
}

// ── Pull entity descriptions from wiki for visual consistency ─────────────
async function fetchWikiDNA(
  db: FirebaseFirestore.Firestore,
  universeId: string
): Promise<Record<string, string>> {
  log('WIKI', 'Fetching entity DNA from wiki for visual consistency...');
  const snap = await db
    .collection('entities')
    .where('universeAddress', '==', universeId.toLowerCase())
    .get();
  const dna: Record<string, string> = {};
  for (const doc of snap.docs) {
    const e = doc.data();
    const name = (e.name || '').trim();
    if (!name) continue;
    const desc = (e.description || '').split('\n\n').slice(0, 2).join(' ').slice(0, 600);
    const key = name.toUpperCase().replace(/[^A-Z0-9]/g, '_');
    dna[key] = `${name}: ${desc}`;
    log('WIKI', `  [${e.kind}] ${name}`);
  }
  log('WIKI', `Loaded ${Object.keys(dna).length} entities`);
  return dna;
}

// ── Scene definitions ───────────────────────────────────────────────────
function buildScenes(dna: Record<string, string>) {
  // ── Character Visual DNA — pull from wiki, fall back to local defaults ──
  const MONEROCHAN =
    dna['MONEROCHAN'] ??
    [
      'Monerochan: A fierce, intelligent young woman in her early 20s with subtle Japanese facial features',
      '(almond-shaped eyes with gentle epicanthic fold, delicate high cheekbones, refined jawline, fair skin with soft East Asian undertones).',
      'Long flowing straight black hair with subtle orange inner highlights, striking golden-amber eyes that glow with quiet determination,',
      'athletic yet graceful build, sharp yet elegant facial features.',
      'Iconic outfit: sleek tactical cyberpunk — dark cropped top exposing midriff with subtle Monero "M" logo,',
      'orange capelet flowing over shoulders, orange-accented skirt elements, black thighhighs,',
      'round stud earrings, black tactical jacket with orange details, bright orange high heels.',
    ].join(' ');

  // Aged variants derived from the adult Monerochan DNA above for consistent features.
  const sharedFeatures =
    'subtle Japanese facial features (almond eyes, delicate cheekbones, fair skin), golden-amber eyes, long straight black hair with subtle orange inner highlights';
  const MONEROCHAN_BABY = `Newborn baby girl sharing ${sharedFeatures}, delicate fair skin, wisps of dark hair, golden-amber eyes barely open.`;
  const MONEROCHAN_CHILD = `Young girl age 8-10 sharing ${sharedFeatures}, eyes wide with curiosity, simple modest clothing, delicate build.`;
  const MONEROCHAN_TEEN = `Teenage girl age 15-16 sharing ${sharedFeatures}, eyes now sharp with determination, early tactical streetwear.`;

  const MASKED_ALLY =
    dna['THE_FUNGIBILITY_FRONT'] ??
    'A tall, powerfully built man in rugged black tactical gear wearing the iconic Guy Fawkes mask — bone-white stylized smiling face with red cheeks, wide upturned mustache, and thin pointed goatee.';

  // ── Style-specific WORLD prompt ──
  const WORLD =
    STYLE === 'animated'
      ? [
          'Beautiful, emotional anime-style animated short film in high cinematic quality, 16:9.',
          'Vibrant cyberpunk-neon color palette mixed with soft pastel accents.',
          'Smooth 60fps motion, ultra-detailed character animation, cinematic lighting.',
          'Dreamy lofi-cyberpunk visual tone, hopeful yet intense emotional storytelling.',
          'Soft particle effects of ring-signatures and untraceable code float around key moments.',
          'Perfect facial consistency across all ages of Monerochan.',
          'No text overlays embedded in the video. No watermarks. No logos.',
        ].join(' ')
      : [
          'Cinematic photorealistic Hollywood movie trailer, ultra-realistic live-action, 8K, shot on 35mm film with subtle grain.',
          'Dramatic volumetric lighting, intense Christopher Nolan / Denis Villeneuve color grading.',
          'Dark electronic synth pulses mixed with epic orchestral score and heartbeat bass undertone.',
          'Fast-paced editing with quick cuts and slow-motion beats.',
          'Bold futuristic text overlays with orange Monero accents where applicable.',
          'Maximum production value, intense emotional storytelling, no voiceover or narration.',
          'Photorealistic faces and textures, fluid motion, immersive sound design.',
          'No text, no watermarks.',
        ].join(' ');

  return [
    // ═══════════════════════════════════════════════════════════════════
    // OPENING — BLACK SCREEN + OMINOUS BUILD (S01-S02)
    // ═══════════════════════════════════════════════════════════════════
    {
      id: 'S01',
      title: 'The Birth — Hospital',
      plot: 'A newborn baby girl cries in a sterile hospital under cold fluorescent lights. Shadowy suited figures in the background print endless money. Surveillance cameras watch from every angle.',
      prompt: `${WORLD} A sterile hospital room bathed in cold fluorescent light. ${MONEROCHAN_BABY} crying in a hospital crib, tiny fists clenched. In the background through glass windows: shadowy suited figures in a massive printing facility, endless sheets of currency rolling off industrial presses. Surveillance cameras mounted in every corner, their red recording lights blinking. The contrast between the fragile newborn and the machinery of control. Cold blue-white lighting, clinical atmosphere, ominous undertone. Close-up of the baby transitioning to wide establishing shot of the surveillance-laden hospital. Ominous low orchestral music building.`,
    },
    {
      id: 'S02',
      title: 'Childhood — Discovering Code',
      plot: 'Young Monerochan age 8-10 in a modest home watches her parents crushed by debt and inflation on an old TV. She discovers a hidden laptop in the attic, her golden-amber eyes lighting up as green code scrolls across the screen.',
      prompt: `${WORLD} ${MONEROCHAN_CHILD} in a modest, worn living room. An old CRT TV shows economic collapse — bank failures, protest footage, inflation charts. Her parents sit at a kitchen table behind her, heads in hands, surrounded by bills and final notices. The girl's golden-amber eyes reflect the screen's cold glow, face serious beyond her years. HARD CUT to: an dusty attic, golden afternoon light through a small window. The same girl opens an old laptop hidden under boxes. Green terminal code scrolls across the screen, illuminating her face from below. Her golden-amber eyes widen with wonder and curiosity — the first spark. The moment destiny finds her.`,
    },

    // ═══════════════════════════════════════════════════════════════════
    // TEEN YEARS — TRAINING MONTAGE (S03-S05)
    // ═══════════════════════════════════════════════════════════════════
    {
      id: 'S03',
      title: 'Teen Hacking — Digital Firewalls',
      plot: 'Teenage Monerochan hacks through digital firewalls in a dimly lit room, evading government agents, learning about privacy and decentralization.',
      prompt: `${WORLD} ${MONEROCHAN_TEEN} sitting in a dark room lit only by multiple monitor screens casting blue-green light on her determined face. Her fingers fly across a keyboard — holographic-style digital firewalls and encryption visualizations reflected in her golden-amber eyes. She leans forward intensely as firewall barriers shatter on screen. Quick cut: government agents in dark suits burst through a door — but the room is empty, chair still spinning. She's already gone. Back to her in a new location, different room, continuing. She's learning, growing stronger, becoming more resolute with every evasion. Fast cuts, hacker montage, determined teenager against the system.`,
    },
    {
      id: 'S04',
      title: 'Training in Shadows',
      plot: 'She trains in dark underground spaces, learning to move unseen, studying cryptography by candlelight, becoming a ghost in the machine.',
      prompt: `${WORLD} ${MONEROCHAN_TEEN} training montage in underground bunker spaces. Quick cuts: she practices moving through laser-grid security simulations, her body weaving between beams of red light with athletic grace. She studies cryptography diagrams by candlelight, ancient-looking mathematical proofs on worn paper. She practices with a worn punching bag in a concrete room, her reflection visible in a cracked mirror — each strike sharper than the last. She runs through dark tunnels, faster each time. Her golden-amber eyes grow harder, more focused with each cut. The montage of a warrior being forged. Dramatic lighting, underground textures, the making of a legend.`,
    },
    {
      id: 'S05',
      title: 'Growing Resolute — Transition',
      plot: 'Fast cuts of her evolution — child to teen to woman. Each version stronger. Each version more determined. Building toward the reveal.',
      prompt: `${WORLD} Rapid-fire transition montage: the golden-amber eyes at age 8 (wide, curious) MATCH CUT to age 12 (focused, learning) MATCH CUT to age 16 (sharp, dangerous) MATCH CUT to age 20 (commanding, burning with quiet fire). Each cut preserves the same Japanese facial features aging naturally — delicate cheekbones sharpening, jawline refining, the same distinctive eyes growing from innocent to fierce. Hair grows longer, darker, the orange highlights emerging. Clothing evolves from modest to tactical. The last cut holds on the adult eyes — golden-amber, glowing, ready. The transformation complete. Match-cut eye montage, aging progression, destiny fulfilled.`,
    },

    // ═══════════════════════════════════════════════════════════════════
    // PRESENT DAY — THE REVEAL (S06-S08)
    // ═══════════════════════════════════════════════════════════════════
    {
      id: 'S06',
      title: 'The Reveal — Toe-Up Shot',
      plot: 'Dramatic slow-motion toe-up reveal: camera starts at her bright orange high heels clicking on wet pavement, slowly rising up to reveal the full iconic Monerochan outfit and her determined face.',
      prompt: `${WORLD} ${MONEROCHAN} DRAMATIC SLOW-MOTION TOE-UP REVEAL SHOT. Camera starts at ground level: bright orange high heels clicking on rain-wet pavement, each step sending tiny splashes. Camera slowly rises — up her legs in black thighhighs, across the orange-accented skirt elements and exposed midriff of the dark crop top with subtle glowing orange "M" logo, past the orange capelet fluttering slightly in the wind, up to her face — golden-amber eyes burning with quiet determination, long straight black hair with orange inner highlights flowing. Dramatic rim lighting from behind, rain droplets catching neon light, wet reflections on the pavement. The full iconic outfit revealed in one unbroken vertical pan. Slow motion, 35mm grain, pure cinema.`,
    },
    {
      id: 'S07',
      title: 'Night Walk — Neon Streets',
      plot: 'Monerochan confidently strides toward camera through neon-lit cyberpunk streets at night, orange heels clicking rhythmically, capelet and hair flowing in the wind.',
      prompt: `${WORLD} ${MONEROCHAN} STYLISH NIGHT-WALKING SHOT. Monerochan strides confidently TOWARD the camera through neon-lit cyberpunk streets at night. Bright orange high heels click rhythmically on wet asphalt. Her orange capelet billows behind her, long black hair with orange highlights flowing in the wind. Golden-amber eyes reflect the neon signs — green, purple, orange. Her outfit moves dynamically with each powerful step — the tactical jacket open, crop top visible, skirt elements swaying. Pulsing neon lights of the city create cascading color on her face. Rain-slicked streets reflect everything. She owns every inch of the frame. Front-tracking shot, neon-soaked, pure confidence, cyberpunk atmosphere.`,
    },
    {
      id: 'S08',
      title: 'Alliance — Rain-Soaked Alley',
      plot: 'Monerochan standing shoulder-to-shoulder in a rain-soaked alley with the masked ally. They exchange an encrypted drive under flickering neon light. Silent, resolute, unbreakable alliance.',
      prompt: `${WORLD} ${MONEROCHAN} ${MASKED_ALLY} A rain-soaked back alley at night, flickering neon signs casting unstable colored light — orange, green, blue. Monerochan stands shoulder-to-shoulder with the tall masked figure. They face the camera together — her in her full iconic outfit, him in rugged black tactical gear with the bone-white mask, red cheeks and upturned mustache visible. Between them at waist level, a small encrypted drive passes from his gloved hand to hers — the exchange barely visible. Their postures are locked, silent, and resolute. Raw tension, unbreakable quiet alliance. Faintly in the shadows behind them, additional masked figures are barely visible. Rain hammers down. Two-shot, rain-soaked, flickering neon, the alliance forged in silence.`,
    },

    // ═══════════════════════════════════════════════════════════════════
    // ACTION — THE INFILTRATION (S09-S13)
    // ═══════════════════════════════════════════════════════════════════
    {
      id: 'S09',
      title: 'Infiltration — Federal Reserve Exterior',
      plot: 'Monerochan approaches a massive marble Federal Reserve-style building at night, alone. She scales the exterior, dodging searchlights and drones.',
      prompt: `${WORLD} ${MONEROCHAN} A massive neoclassical marble building at night — imposing columns, vault-like doors, American Federal Reserve architecture. Searchlights sweep the perimeter. Red-eyed surveillance drones patrol in patterns. Monerochan approaches from the shadows — a lone figure against the monolith of financial power. She leaps, grabs a stone ledge, pulls herself up with athletic grace. A searchlight sweeps past — she presses flat against the marble, orange capelet draped over her to break her silhouette. The drone passes. She moves again. One woman against the citadel of control. Wide establishing shot transitioning to close action, dramatic shadows, the David vs Goliath of financial rebellion.`,
    },
    {
      id: 'S10',
      title: 'Inside — Dodging Security',
      plot: 'Inside the building, Monerochan moves through marble hallways, dodging laser grids and security patrols with fluid precision.',
      prompt: `${WORLD} ${MONEROCHAN} Interior of a grand marble hallway — polished floors reflecting emergency lighting, gold-framed paintings of past central bank chairmen lining the walls. Monerochan moves through a laser security grid with fluid, athletic precision — her body contorting between red beams, orange capelet pulled tight. Quick cut: two armed security guards round a corner — she's already pressed into an alcove, invisible. They pass. She continues. Her orange high heels are silent now — she moves on the balls of her feet like a cat. Golden-amber eyes scan each corridor before committing. Professional, precise, lethal in her focus. Interior infiltration sequence, marble and gold vs. tactical black and orange.`,
    },
    {
      id: 'S11',
      title: 'The Upload — Machines Explode',
      plot: 'Monerochan reaches the printing floor, uploads a virus. Money-printing machines explode in dramatic slow motion. Elites scramble in panic.',
      prompt: `${WORLD} ${MONEROCHAN} A massive industrial printing floor — rows of enormous money-printing machines churning out currency at incredible speed. Monerochan crouches at a central terminal, plugging in a small device with an orange-glowing Monero symbol. She presses execute. DRAMATIC SLOW MOTION: the printing machines seize — gears grind, currency catches fire, mechanical arms twist and shatter. Sheets of burning money flutter through the air like confetti. Emergency sirens blare. Suited elites in an observation gallery above scramble in pure panic — papers flying, phones clutched to ears, faces contorted with terror. Their empires collapsing in real time. Monerochan stands amidst the beautiful destruction, orange capelet billowing from the blast heat, face calm. Slow motion destruction, burning currency, elite panic, one woman's calm.`,
    },
    {
      id: 'S12',
      title: 'Surveillance Room — Systems Dying',
      plot: 'Close-up of a vast surveillance control room: rows of monitors showing Federal Reserve data glitching, freezing, going black one by one while operators shout in rising panic.',
      prompt: `${WORLD} A vast surveillance and financial control room — dozens of operators at workstations, walls of monitors showing real-time Federal Reserve data streams, currency flows, transaction graphs. The screens begin to GLITCH — green static, corrupted data, cascading failures spreading from monitor to monitor. Operators shout, pound keyboards, grab phones. One by one the screens go BLACK. The blue-white glow of the room dims as each screen dies — darkness spreading like a virus. A senior operator in a suit stands, face illuminated by the last functioning screen, watching helplessly as it too goes dark. Total system failure. Wide shot of the room dying, intercut with close-ups of panicking faces lit by failing screens. The infrastructure of control collapsing.`,
    },
    {
      id: 'S13',
      title: 'The Banker — Empire Draining',
      plot: 'A high-ranking banker in a sterile luxury office stares in cold sweat as his offshore accounts drain in real time on multiple screens.',
      prompt: `${WORLD} A sterile ultra-luxury corner office — floor-to-ceiling windows overlooking a nighttime city skyline. A high-ranking banker in his 60s, silver hair, expensive suit, tie loosened, sits behind a massive desk. Multiple screens surround him showing offshore account balances — the numbers are DROPPING. Fast. Billions becoming millions becoming thousands becoming zero. His face glistens with cold sweat. His hand trembles holding a crystal whiskey glass. The power is visibly leaving him — his posture crumbling, his authority dissolving with each zero that vanishes. On one screen, a small orange Monero logo appears briefly before the screen dies. Close-up of his face reflecting the falling numbers, then the glass slipping from his fingers and shattering on the marble floor. The end of an empire in one man's face.`,
    },

    // ═══════════════════════════════════════════════════════════════════
    // SYMBOLIC — THE PEOPLE (S14-S16)
    // ═══════════════════════════════════════════════════════════════════
    {
      id: 'S14',
      title: 'Street Level — Silent Transactions',
      plot: 'Rain-lashed street level: ordinary people in hoods check phones showing private Monero transactions confirming — quiet, defiant normalcy.',
      prompt: `${WORLD} Rain-lashed city street at night. Ordinary people in hoodies and rain jackets walk through the downpour. Close-ups of faces illuminated ONLY by the cold green glow of their phone screens — private Monero transactions confirming silently. A young mother. An elderly man. A teenager. A construction worker. Each face shows the same quiet expression: defiant normalcy, the peace of financial privacy. No celebration, no protest — just people transacting in freedom while the financial system burns in the background. Green phone-glow on wet faces, rain streaming, the revolution happening in silence in everyone's pocket. Street-level montage, intimate close-ups, the people's quiet victory.`,
    },
    {
      id: 'S15',
      title: 'Surveillance Cameras Dying',
      plot: 'Across the city, surveillance cameras spark, glitch, and go dark one by one. The all-seeing eye is going blind.',
      prompt: `${WORLD} A montage of surveillance cameras across the city failing. A dome camera on a street corner sparks and its red LED dies. A wall of CCTV monitors in a police station goes static then black. Traffic cameras droop on their poles, lenses cracking. The massive digital billboard eye — a 50-foot holographic surveillance symbol — flickers, distorts, and shatters into pixelated fragments that rain down on the street below like digital confetti. Citizens look up as the cameras die, some confused, some slowly smiling. The panopticon going blind. Quick cuts between dying cameras, each failure more dramatic than the last, building rhythm. The system's eyes closing forever.`,
    },
    {
      id: 'S16',
      title: 'People Looking Up — Freedom Dawning',
      plot: 'Citizens slowly realize the cameras are dead. They look up. Some remove hoods. Some smile. The first taste of unwatched existence.',
      prompt: `${WORLD} City street after the cameras die. People gradually realize — the red recording lights are dark. The drones have fallen. A woman slowly lowers her hood, face tilted up to the rain, eyes closed, the faintest smile. A man removes his sunglasses — no need to hide anymore. Two strangers make eye contact and share a look of incredulous joy. A child points at a dead camera and laughs. The rain is still falling but the mood has shifted — from oppression to release, from fear to the first breath of freedom. Warm orange streetlight replacing the cold blue of surveillance. Close-ups of faces experiencing privacy for the first time. The dawn of the unwatched life.`,
    },

    // ═══════════════════════════════════════════════════════════════════
    // CLIMAX + TITLE (S17-S20)
    // ═══════════════════════════════════════════════════════════════════
    {
      id: 'S17',
      title: 'Rooftop — The Silhouette',
      plot: 'Climactic shot: slow pull-back on a rain-drenched rooftop. Monerochan stands alone, back to camera, overlooking a financial district where building lights flicker and die in waves.',
      prompt: `${WORLD} ${MONEROCHAN} THE CLIMACTIC SHOT. Slow, deliberate pull-back on a rain-drenched rooftop at night. Monerochan stands alone, back partially to camera, at the very edge. Below her: the financial district, its glass towers flickering — lights dying in waves, floor by floor, building by building, like dominoes falling in slow motion. Wind whips her orange capelet and long black hair with orange highlights. Rain streams around her silhouette. She is sharp and still against the dying glow of the system she just broke. No celebration. No fist pump. Just cold, focused, quiet resolve. The warrior surveying the battlefield after the war is won. Extreme wide shot, her silhouette small against the dying cityscape, the most powerful image in the trailer. Breathtaking.`,
    },
    {
      id: 'S18',
      title: 'Monerochan Turns — Eyes Glow',
      plot: 'She turns her head slightly. Her golden-amber eyes catch the last dying light of the financial district. A single tear of resolve. Then she turns away. The job is done.',
      prompt: `${WORLD} ${MONEROCHAN} Close-up from behind and to the side — Monerochan turns her head slightly to the right, looking back over her shoulder. Her golden-amber eyes catch and hold the dying amber glow of the financial district below — they seem to glow with their own inner fire. A single tear of resolve (not sadness — completion) traces down her cheek, catching the fading light. Her lips part slightly as if to speak, but she says nothing. She turns back to face the darkness ahead. The job is done. The system is broken. And she has more work to do. Intimate close-up portrait, the warrior's moment of private reckoning, golden eyes holding fire, rain and wind, raw emotional power.`,
    },
    {
      id: 'S19',
      title: 'Title Card — MONEROCHAN: SHADOWS OF FREEDOM',
      plot: 'Screen text appears dramatically: "MONEROCHAN" in massive glowing orange-and-black letters, then "SHADOWS OF FREEDOM" below. Final tagline: "The privacy revolution has a face."',
      prompt: `${WORLD} Black screen. Then: massive cinematic title text materializes — "MONEROCHAN" in glowing orange letters with black chrome edges, each letter appearing with a dramatic bass pulse and particle effect. The letters burn with inner fire, subtle digital glitch effects at the edges. Below, "SHADOWS OF FREEDOM" appears in smaller, elegant silver-white text with orange accents. A beat of silence. Then the final tagline fades in below: "The privacy revolution has a face." in clean minimal white text. The orange glow of the title reflects on rain-wet ground beneath it. Epic, theatrical, maximum impact. Title card sequence, black background, orange fire text, cinematic typography.`,
    },
    {
      id: 'S20',
      title: 'End Card — Monero Logo + Coming Soon',
      plot: 'Final music swell. Heartbeat pulse synced to glowing Monero logo on black screen. Text: "COMING SOON TO THE RESISTANCE"',
      prompt: `${WORLD} The final shot. Black screen. A powerful orchestral-electronic music swell building. A single heartbeat pulse — and with it, the Monero logo materializes in glowing orange, rotating slowly, casting volumetric light rays outward like a digital sun. The logo pulses with each heartbeat — orange light expanding and contracting. Below the logo, text appears: "COMING SOON TO THE RESISTANCE" in clean, futuristic white font with subtle orange underglow. A final massive heartbeat pulse — the logo flares bright — then slowly fades to black. The last ember of orange dies on a black screen. The end. Logo reveal, heartbeat synchronization, orange volumetric light, final fade to black, maximum viral impact.`,
    },
  ];
}

// ── Main ────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('  MONEROCHAN — Episode 1: "Shadows of Freedom"');
  console.log(`  Style: ${STYLE.toUpperCase()} | Tag: ${EPISODE_TAG}`);
  console.log('  20 Scenes × 10s = ~3.3 min trailer');
  console.log(`  Seedance 2.0 + Audio | Mode: ${GEN_MODE.toUpperCase()}`);
  console.log('═'.repeat(60));

  if (!BYTEDANCE_API_KEY) {
    console.error('\n  ERROR: BYTEDANCE_API_KEY not set.');
    process.exit(1);
  }

  const db = initFirebase();

  // Find the universe ID if not provided
  let universeId = UNIVERSE_ID;
  if (!universeId) {
    log('INIT', 'Looking up Monerochan universe...');
    const snap = await db
      .collection('cinematicUniverses')
      .where('name', '==', 'Monerochan: Untraceable')
      .limit(1)
      .get();
    if (snap.empty) {
      console.error(
        '  ERROR: Monerochan universe not found. Run create-monerochan-universe.ts first.'
      );
      process.exit(1);
    }
    universeId = snap.docs[0].id;
  }
  log('INIT', `Universe: ${universeId}`);

  // Pull visual DNA from wiki (MANDATORY — ensures visual consistency across scenes)
  const dna = await fetchWikiDNA(db, universeId);
  const SCENES = buildScenes(dna);

  // Determine starting scene
  const startIdx = SCENES.findIndex((s) => s.id === START_SCENE);
  if (startIdx < 0) {
    console.error(`  ERROR: Scene ${START_SCENE} not found.`);
    process.exit(1);
  }
  const scenes = SCENES.slice(startIdx);
  log(
    'INIT',
    `Processing ${scenes.length} scenes (${scenes[0].id} → ${scenes[scenes.length - 1].id})\n`
  );

  const results: Array<{ id: string; title: string; videoUrl: string; ipfsUrl: string }> = [];

  if (GEN_MODE === 'fast') {
    // ── Fast mode: parallel batches ──
    for (let batchStart = 0; batchStart < scenes.length; batchStart += BATCH_SIZE) {
      const batch = scenes.slice(batchStart, batchStart + BATCH_SIZE);
      log('BATCH', `Generating ${batch.map((s) => s.id).join(', ')} in parallel...`);

      const batchResults = await Promise.allSettled(
        batch.map((scene) => generateVideo(scene.prompt, scene.id))
      );

      for (let i = 0; i < batch.length; i++) {
        const scene = batch[i];
        const result = batchResults[i];
        if (result.status === 'fulfilled') {
          const ipfsUrl = await pinVideo(result.value, scene.id);
          results.push({ id: scene.id, title: scene.title, videoUrl: result.value, ipfsUrl });
          log(scene.id, `Pinned: ${ipfsUrl.slice(0, 80)}...`);

          // Save to Firestore gallery
          const contentId = randomUUID();
          await db
            .collection('content')
            .doc(contentId)
            .set({
              id: contentId,
              creatorAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
              universeId,
              universeAddress: universeId,
              mediaUrl: ipfsUrl,
              mediaType: 'video',
              type: 'video',
              videoUrl: ipfsUrl,
              visibility: 'public',
              prompt: scene.prompt.slice(0, 500),
              title: `Ep1 ${scene.id}: ${scene.title}`,
              description: scene.plot,
              model: 'seedance2-t2v',
              tags: ['monerochan', EPISODE_TAG, 'shadows-of-freedom', scene.id.toLowerCase()],
              status: 'active',
              contentStatus: 'active',
              createdAt: new Date(),
              updatedAt: new Date(),
            });
        } else {
          log(scene.id, `FAILED: ${(result.reason as Error).message}`);
        }
      }

      if (batchStart + BATCH_SIZE < scenes.length) {
        log('BATCH', 'Cooling down 3s...');
        await sleep(3000);
      }
    }
  } else {
    // ── Continuity mode: sequential with frame handoff ──
    let lastFrame: string | null = RESUME_FRAME || null;

    for (const scene of scenes) {
      console.log(`\n${'─'.repeat(50)}`);
      log(scene.id, `"${scene.title}"`);
      log(scene.id, scene.plot);

      try {
        const videoUrl = await generateVideo(scene.prompt, scene.id, lastFrame);
        const ipfsUrl = await pinVideo(videoUrl, scene.id);
        results.push({ id: scene.id, title: scene.title, videoUrl, ipfsUrl });
        log(scene.id, `Pinned: ${ipfsUrl.slice(0, 80)}...`);

        // Save to Firestore gallery
        const contentId = randomUUID();
        await db
          .collection('content')
          .doc(contentId)
          .set({
            id: contentId,
            creatorAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
            universeId,
            universeAddress: universeId,
            mediaUrl: ipfsUrl,
            mediaType: 'video',
            type: 'video',
            videoUrl: ipfsUrl,
            visibility: 'public',
            prompt: scene.prompt.slice(0, 500),
            title: `Ep1 ${scene.id}: ${scene.title}`,
            description: scene.plot,
            model: 'seedance2-i2v',
            tags: ['monerochan', EPISODE_TAG, 'shadows-of-freedom', scene.id.toLowerCase()],
            status: 'active',
            contentStatus: 'active',
            createdAt: new Date(),
            updatedAt: new Date(),
          });

        // Extract last frame for next scene
        lastFrame = await extractLastFrame(videoUrl, scene.id);
      } catch (err: any) {
        log(scene.id, `FAILED: ${err.message}`);
        lastFrame = null; // reset continuity chain

        if (err.message.includes('429') || err.message.includes('quota')) {
          log('QUOTA', 'Rate limited — stopping. Resume with START_SCENE=' + scene.id);
          break;
        }
      }
    }
  }

  // ── Create episode document ───────────────────────────────────────
  if (results.length > 0) {
    const episodeId = randomUUID();
    await db
      .collection('episodes')
      .doc(episodeId)
      .set({
        id: episodeId,
        universeId,
        title: 'Monerochan: Shadows of Freedom',
        description:
          'Episode 1 — The privacy revolution has a face. A cinematic trailer following Monerochan from birth through her war against the surveillance state.',
        clips: results.map((r, i) => ({
          nodeId: i,
          label: `${r.id}: ${r.title}`,
          videoUrl: r.ipfsUrl,
          trimStart: 0,
          trimEnd: 10,
        })),
        clipCount: results.length,
        creatorId: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    log('EPISODE', `Created episode document: ${episodeId}`);
  }

  // ── Summary ────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(60));
  console.log('  MONEROCHAN: SHADOWS OF FREEDOM — COMPLETE');
  console.log('═'.repeat(60));
  console.log(`  Universe    : ${universeId}`);
  console.log(`  Scenes      : ${results.length}/${scenes.length} generated`);
  console.log(`  Failed      : ${scenes.length - results.length}`);
  console.log(`  Mode        : ${GEN_MODE}`);
  for (const r of results) {
    console.log(`    ${r.id} "${r.title}" → ${r.ipfsUrl.slice(0, 70)}...`);
  }
  console.log('═'.repeat(60) + '\n');

  process.exit(0);
}

main().catch((err) => {
  console.error('\nFatal:', err.message ?? err);
  process.exit(1);
});
