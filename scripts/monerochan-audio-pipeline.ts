/**
 * MONEROCHAN — Audio Pipeline
 * Episode 1: "Shadows of Freedom" — 20 scenes
 *
 * Voice profiles + SFX + Music + Lip-Sync → FFmpeg composite
 *
 * Cast: Monerochan (soft, resolute young woman), Masked Ally (silent — no VO)
 * Dialogue: Whispered tagline + title VO only (trailer has near-zero dialogue by design)
 *
 * Saves:
 *   - voiceProfiles collection (scoped to Monerochan universe — visible in UI)
 *   - soundNodes collection (per scene — visible in AudioToolbar)
 *   - Final mixed MP4s pinned to IPFS, content.mediaUrl updated
 *
 * Usage: pnpm tsx scripts/monerochan-audio-pipeline.ts
 * Env:   ELEVENLABS_API_KEY, FAL_KEY, PINATA_JWT
 * Opt:   MC_SKIP_LIPSYNC=true, MC_SCENES=S06,S17
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import * as fal from '@fal-ai/serverless-client';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const EL_KEY = process.env.ELEVENLABS_API_KEY!;
const FK = process.env.FAL_KEY!;
const PINATA_JWT = process.env.PINATA_JWT!;
const GATEWAY = process.env.PINATA_GATEWAY_URL || 'https://gateway.pinata.cloud';
const UNIVERSE_ID = '0x0000000000000000000000000000019d9e1c8a49';
const CREATOR = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';
/** Episode tag — identifies which variant of the episode to process (photoreal vs animated) */
const EPISODE_TAG = process.env.EPISODE_TAG || 'episode-1';
const ODIR = process.env.MC_OUTPUT_DIR || `./monerochan-audio-output-${EPISODE_TAG}`;
const SKIP_LIP = process.env.MC_SKIP_LIPSYNC === 'true';
const SFILT = process.env.MC_SCENES
  ? new Set(process.env.MC_SCENES.split(',').map((s) => s.trim()))
  : null;
const EBASE = 'https://api.elevenlabs.io/v1';

const L = (s: string, m: string) => console.log(`[${s}] ${m}`);
const Z = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const mkdir = (d: string) => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
};

/* ── Firebase init ────────────────────────────────────────────────────── */
function initFirebase() {
  const saPath = path.resolve(
    process.cwd(),
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? 'firebase-sa-key-20260416.json'
  );
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : JSON.parse(fs.readFileSync(saPath, 'utf-8'));
  const app = initializeApp({ credential: cert(sa) }, 'mc-audio-' + Date.now());
  const db = getFirestore(app);
  db.settings({ preferRest: true });
  return db;
}

/* ── ElevenLabs ──────────────────────────────────────────────────────── */
const eH = (): Record<string, string> => ({
  'xi-api-key': EL_KEY,
  'Content-Type': 'application/json',
});

async function ePost(p: string, b: Record<string, unknown>): Promise<Buffer> {
  const r = await fetch(`${EBASE}${p}`, {
    method: 'POST',
    headers: eH(),
    body: JSON.stringify(b),
  });
  if (!r.ok) throw new Error(`11L ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return Buffer.from(await r.arrayBuffer());
}

/** Find best ElevenLabs voice for a character by preferred name list. */
async function findBestVoice(prefNames: string[], gender: string): Promise<string> {
  const res = await fetch(`${EBASE}/voices`, { headers: eH() });
  if (!res.ok) throw new Error(`Voices list ${res.status}`);
  const { voices } = (await res.json()) as {
    voices: Array<{ voice_id: string; name: string; labels?: Record<string, string> }>;
  };
  for (const pref of prefNames) {
    const match = voices.find((v) => v.name.toLowerCase().includes(pref.toLowerCase()));
    if (match) return match.voice_id;
  }
  const genderMatch = voices.find((v) => v.labels?.gender === gender);
  if (genderMatch) return genderMatch.voice_id;
  if (voices.length > 0) return voices[0].voice_id;
  throw new Error('No voices available');
}

const tts = (t: string, vid: string, st: number, sy: number) =>
  ePost(`/text-to-speech/${vid}?output_format=mp3_44100_128`, {
    text: t,
    model_id: 'eleven_v3',
    voice_settings: {
      stability: st,
      similarity_boost: 0.75,
      style: sy,
      use_speaker_boost: true,
    },
  });

const sfx = (d: string, sec?: number) => {
  const b: Record<string, unknown> = { text: d, prompt_influence: 0.4 };
  if (sec) b.duration_seconds = sec;
  return ePost('/sound-generation', b);
};

/* ── FAL ─────────────────────────────────────────────────────────────── */
const fInit = () => fal.config({ credentials: FK });

/** Submit to fal queue + poll for result. Returns result JSON when done. */
async function falQueue(
  modelId: string,
  input: Record<string, unknown>,
  maxWaitSec = 300
): Promise<any> {
  const submitRes = await fetch(`https://queue.fal.run/${modelId}`, {
    method: 'POST',
    headers: { Authorization: `Key ${FK}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!submitRes.ok) {
    const t = await submitRes.text();
    throw new Error(`Submit ${submitRes.status}: ${t.slice(0, 200)}`);
  }
  const sub = (await submitRes.json()) as { response_url?: string; status_url?: string };
  if (!sub.status_url || !sub.response_url) throw new Error('No status_url in queue submit');

  const pollInterval = 5000;
  const maxAttempts = Math.ceil((maxWaitSec * 1000) / pollInterval);
  for (let i = 0; i < maxAttempts; i++) {
    await Z(pollInterval);
    const statusRes = await fetch(sub.status_url, { headers: { Authorization: `Key ${FK}` } });
    if (!statusRes.ok) continue;
    const status = (await statusRes.json()) as { status?: string };
    if (status.status === 'COMPLETED') {
      const resultRes = await fetch(sub.response_url, { headers: { Authorization: `Key ${FK}` } });
      if (!resultRes.ok) {
        const t = await resultRes.text();
        throw new Error(`Result ${resultRes.status}: ${t.slice(0, 200)}`);
      }
      return await resultRes.json();
    }
    if (status.status === 'FAILED' || status.status === 'ERROR') {
      throw new Error(`Queue task ${status.status}`);
    }
  }
  throw new Error(`Timed out after ${maxWaitSec}s`);
}

async function fMusic(p: string, d: number): Promise<string> {
  const clamped = Math.min(d, 30);
  const MODELS = [
    { id: 'fal-ai/musicgen', input: { prompt: p, duration: clamped } },
    { id: 'fal-ai/musicgen/stereo-large', input: { prompt: p, duration: clamped } },
    { id: 'fal-ai/stable-audio', input: { prompt: p, seconds_total: Math.min(d, 47), steps: 100 } },
  ];
  let lastErr: any = null;
  for (const m of MODELS) {
    try {
      const result = await falQueue(m.id, m.input, 300);
      // fal response shapes vary: audio_file.url, audio.url, audio_url.url (object), audio_url (string), url
      const url =
        result.audio_file?.url ||
        result.audio?.url ||
        result.audio_url?.url ||
        (typeof result.audio_url === 'string' ? result.audio_url : null) ||
        (typeof result.url === 'string' ? result.url : null);
      if (typeof url === 'string' && url.startsWith('http')) return url;
      lastErr = new Error(`${m.id} returned no audio URL (keys: ${Object.keys(result).join(',')})`);
    } catch (e: any) {
      lastErr = e;
      L('MUSIC', `  ${m.id} failed: ${e.message?.slice(0, 100)}`);
    }
  }
  throw lastErr || new Error('All music models failed');
}

async function fLip(vu: string, au: string): Promise<string | null> {
  for (const model of ['fal-ai/lipsync', 'fal-ai/sadtalker']) {
    try {
      const r = await falQueue(model, { video_url: vu, audio_url: au }, 300);
      const u = r.video?.url || r.video_url || r.url;
      if (u) return u;
    } catch (e: any) {
      L('LIP', `  ${model} failed: ${e.message?.slice(0, 100)}`);
    }
  }
  return null;
}

async function dl(u: string, d: string) {
  const r = await fetch(u);
  if (!r.ok) throw new Error(`DL ${r.status}`);
  fs.writeFileSync(d, Buffer.from(await r.arrayBuffer()));
}

async function fUpA(b: Buffer, n: string): Promise<string> {
  fInit();
  return fal.storage.upload(new File([new Blob([b], { type: 'audio/mpeg' })], n));
}

async function fUpV(p: string): Promise<string> {
  fInit();
  return fal.storage.upload(
    new File([new Blob([fs.readFileSync(p)], { type: 'video/mp4' })], path.basename(p))
  );
}

/* ── Pinata ──────────────────────────────────────────────────────────── */
async function pinFile(filePath: string, name: string, mime: string): Promise<string> {
  if (!PINATA_JWT) return `file://${filePath}`;
  const buffer = fs.readFileSync(filePath);
  const formData = new FormData();
  formData.append('file', new Blob([buffer], { type: mime }), name);
  formData.append('pinataMetadata', JSON.stringify({ name }));
  const res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST',
    headers: { Authorization: `Bearer ${PINATA_JWT}` },
    body: formData,
  });
  if (!res.ok) throw new Error(`Pinata ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const { IpfsHash } = (await res.json()) as { IpfsHash: string };
  return `${GATEWAY}/ipfs/${IpfsHash}`;
}

/* ── Voice Profiles ──────────────────────────────────────────────────── */
interface VP {
  id: string;
  characterName: string;
  voiceId: string;
  st: number;
  sy: number;
}

const VSPECS = {
  MONEROCHAN: {
    name: 'Monerochan',
    prefs: ['Alice', 'Freya', 'Sarah', 'Dorothy', 'Matilda', 'Charlotte'],
    gender: 'female',
    age: 'young',
    accent: 'soft',
    description:
      'Young woman early 20s, soft yet resolute, whispered intensity with quiet strength. Privacy warrior.',
    sampleText: 'I am Monerochan. I was raised in the shadows so others could live in the light.',
    st: 0.55,
    sy: 0.25,
  },
  NARRATOR: {
    name: 'The Resistance (Narrator)',
    prefs: ['Rachel', 'Charlotte', 'Sarah', 'Alice'],
    gender: 'female',
    age: 'middle_aged',
    accent: 'american',
    description:
      'Mysterious female narrator, soft and hopeful, tagline voice. Neither warm nor cold — honest.',
    sampleText: 'The privacy revolution has a face.',
    st: 0.6,
    sy: 0.3,
  },
} as const;

async function loadOrCreateVoiceProfiles(
  db: FirebaseFirestore.Firestore
): Promise<Record<string, VP>> {
  const out: Record<string, VP> = {};

  // Check existing profiles for this universe
  const existing = await db
    .collection('voiceProfiles')
    .where('universeId', '==', UNIVERSE_ID)
    .get();
  const byName = new Map<string, any>();
  existing.docs.forEach((d) => byName.set(d.data().characterName, { id: d.id, ...d.data() }));

  for (const [key, spec] of Object.entries(VSPECS)) {
    const found = byName.get(spec.name);
    if (found) {
      out[key] = {
        id: found.id,
        characterName: spec.name,
        voiceId: found.voiceId,
        st: found.stability ?? spec.st,
        sy: found.style ?? spec.sy,
      };
      L('VOICE', `  Loaded existing: ${spec.name}`);
      continue;
    }

    // Create new profile — find best library voice, save to Firestore
    L('VOICE', `Creating voice profile: ${spec.name}...`);
    const voiceId = await findBestVoice([...spec.prefs], spec.gender);
    const profileId = randomUUID();

    // Generate preview for UI
    let previewUrl: string | null = null;
    try {
      const previewBuf = await tts(spec.sampleText, voiceId, spec.st, spec.sy);
      const previewPath = path.join(ODIR, 'previews', `${key}-preview.mp3`);
      mkdir(path.dirname(previewPath));
      fs.writeFileSync(previewPath, previewBuf);
      previewUrl = await pinFile(previewPath, `monerochan-voice-${key}.mp3`, 'audio/mpeg');
      L('VOICE', `  Preview: ${previewUrl.slice(0, 80)}...`);
    } catch (err: any) {
      L('VOICE', `  Preview failed: ${err.message?.slice(0, 80)}`);
    }

    await db.collection('voiceProfiles').doc(profileId).set({
      id: profileId,
      universeId: UNIVERSE_ID,
      characterName: spec.name,
      voiceId,
      description: spec.description,
      gender: spec.gender,
      age: spec.age,
      accent: spec.accent,
      accentStrength: 1.0,
      stability: spec.st,
      style: spec.sy,
      previewUrl,
      sampleText: spec.sampleText,
      createdBy: CREATOR,
      createdAt: new Date(),
    });

    out[key] = {
      id: profileId,
      characterName: spec.name,
      voiceId,
      st: spec.st,
      sy: spec.sy,
    };
    L('VOICE', `  Saved profile: ${profileId}`);
  }

  return out;
}

/* ── Scene Definitions (audio-only metadata per scene) ────────────────── */
interface SceneAudio {
  id: string;
  t: string;
  /** Dialogue lines [{ speaker, text }] — most scenes have none */
  ln: Array<{ sp: keyof typeof VSPECS; tx: string }>;
  /** SFX description for ElevenLabs sound generation */
  sx: string;
  /** Music segment key */
  m: string;
  /** Scene contains a visible face (for lip-sync) */
  fc: boolean;
}

function buildScenes(): SceneAudio[] {
  return [
    {
      id: 'S01',
      t: 'Birth — Hospital',
      ln: [],
      sx: 'Cold sterile hospital ambient — fluorescent hum, a newborn crying softly, machinery of currency printing in the background, distant surveillance camera servos whirring, subtle heartbeat bass undertone.',
      m: 'M1',
      fc: false,
    },
    {
      id: 'S02',
      t: 'Childhood — Discovering Code',
      ln: [],
      sx: 'Old CRT TV low-fi news broadcast, paper bills rustling, attic creaking footsteps, old laptop keyboard tapping, terminal bootup sound, green code scrolling like rain, a quiet wonder chime.',
      m: 'M1',
      fc: false,
    },
    {
      id: 'S03',
      t: 'Teen Hacking — Firewalls',
      ln: [],
      sx: 'Fast keyboard typing, digital firewall shatter, data stream whooshes, server rack fans, brief government radio chatter, encrypted comms glitch, electronic heartbeat bass.',
      m: 'M1',
      fc: false,
    },
    {
      id: 'S04',
      t: 'Training in Shadows',
      ln: [],
      sx: 'Underground training — footsteps on concrete, laser grid hum, breath controlled, punching bag thud, pages turning by candlelight, distant subway rumble, focused heartbeat.',
      m: 'M1',
      fc: false,
    },
    {
      id: 'S05',
      t: 'Growing Resolute — Transition',
      ln: [],
      sx: 'Time passing — match-cut audio jolts, rising digital synth pulse, age transition whoosh, building orchestral tension, heartbeat accelerating toward the reveal.',
      m: 'M1',
      fc: false,
    },
    {
      id: 'S06',
      t: 'The Reveal — Toe-Up',
      ln: [],
      sx: 'Rain-soaked pavement, bright orange high heels clicking rhythmically, wind whipping fabric, capelet flutter, distant neon hum, dramatic musical hit at reveal, heartbeat bass.',
      m: 'M2',
      fc: true,
    },
    {
      id: 'S07',
      t: 'Night Walk — Neon Streets',
      ln: [],
      sx: 'Cyberpunk street at night — neon sign buzz, distant traffic, rain drizzle, high heels striking wet pavement rhythmically, holographic ad glitches, low synth bass pulse.',
      m: 'M2',
      fc: true,
    },
    {
      id: 'S08',
      t: 'Alliance — Rain-Soaked Alley',
      ln: [],
      sx: 'Heavy rain, flickering neon, distant thunder, silent tension between two figures, small metallic click of an encrypted drive exchange, wet footsteps, held breath.',
      m: 'M2',
      fc: true,
    },
    {
      id: 'S09',
      t: 'Federal Reserve Exterior',
      ln: [],
      sx: 'Night ambient of monumental building — searchlight servo motors sweeping, drone rotors passing overhead, distant city hum, marble footsteps, infiltration heartbeat pulse.',
      m: 'M3',
      fc: false,
    },
    {
      id: 'S10',
      t: 'Inside — Dodging Security',
      ln: [],
      sx: 'Polished marble hallway — distant guard footsteps, laser grid faint hum, tense electronic heartbeat, subtle breath holds, corridor echo, sneaking tension.',
      m: 'M3',
      fc: true,
    },
    {
      id: 'S11',
      t: 'Upload — Machines Explode',
      ln: [],
      sx: 'Industrial printing machines grinding, USB click, terminal beep, rising digital alarm, catastrophic mechanical failure, slow-motion explosion impacts, burning currency, panic shouts muffled.',
      m: 'M3',
      fc: false,
    },
    {
      id: 'S12',
      t: 'Surveillance Systems Dying',
      ln: [],
      sx: 'Massive control room — panicked operator chatter, keyboards slamming, CRT screens glitching and popping off, cascading electrical failures, emergency sirens, overwhelming signal death.',
      m: 'M3',
      fc: false,
    },
    {
      id: 'S13',
      t: 'Banker — Empire Draining',
      ln: [],
      sx: 'Sterile luxury office ambient, multiple monitors beeping and flatlining, heavy breathing, trembling whiskey glass, distant city at night, crystal shattering on marble, pure financial dread.',
      m: 'M3',
      fc: true,
    },
    {
      id: 'S14',
      t: 'Street — Silent Transactions',
      ln: [],
      sx: 'Rain-lashed street, distant traffic, phones vibrating softly with transaction confirmation tones, green digital glow, quiet defiance, public privacy victory ambient.',
      m: 'M4',
      fc: false,
    },
    {
      id: 'S15',
      t: 'Cameras Dying',
      ln: [],
      sx: 'Surveillance cameras across a city sparking and dying in cascading sequence, electrical pops, digital billboard glass shattering and raining down, system-wide failure wave, liberation ambient.',
      m: 'M4',
      fc: false,
    },
    {
      id: 'S16',
      t: 'People Looking Up — Freedom',
      ln: [],
      sx: 'Rain easing, quiet breathing, the first relieved laugh, hoods lowering, communal realization ambient, dawn of unwatched life, warm orange streetlight hum.',
      m: 'M4',
      fc: false,
    },
    {
      id: 'S17',
      t: 'Rooftop — Silhouette',
      ln: [],
      sx: 'Rain-drenched rooftop at night, howling wind, orange capelet flapping violently, distant financial district lights flickering and dying in waves, pure quiet resolve, massive orchestral swell beneath.',
      m: 'M4',
      fc: false,
    },
    {
      id: 'S18',
      t: 'Eyes Glow — Whisper',
      ln: [
        {
          sp: 'MONEROCHAN',
          tx: 'I am Monerochan. I was raised in the shadows so others could live in the light.',
        },
      ],
      sx: 'Close intimate ambient — rain softened, capelet ripple, her golden eyes catching dying light, a single tear, wind subtle, whispered cinematic hush.',
      m: 'M4',
      fc: true,
    },
    {
      id: 'S19',
      t: 'Title Card',
      ln: [{ sp: 'NARRATOR', tx: 'The privacy revolution has a face.' }],
      sx: 'Dramatic title music hit, deep bass boom, digital glitch effects at letter edges, particle whoosh, massive impact, triumphant yet dark.',
      m: 'M4',
      fc: false,
    },
    {
      id: 'S20',
      t: 'End Card — Monero Logo',
      ln: [],
      sx: 'Final orchestral swell, single massive heartbeat pulse synced to logo reveal, light wave expansion, a hopeful sub-bass resolution, fading embers.',
      m: 'M4',
      fc: false,
    },
  ];
}

/* ── Music Segments (4 acts) ─────────────────────────────────────────── */
const MUS = [
  {
    id: 'M1',
    sc: ['S01', 'S02', 'S03', 'S04', 'S05'],
    p: 'Ominous cinematic build — low orchestral strings, dark electronic synth pulses, subtle heartbeat sub-bass. Christopher Nolan tension building. From sterile hospital fluorescence through childhood discovery to teenage hacking training. No vocals. Pure cinematic dread and rising determination.',
    d: 47,
  },
  {
    id: 'M2',
    sc: ['S06', 'S07', 'S08'],
    p: 'Sleek cyberpunk swagger — confident synth bass, rhythmic percussion synced to footsteps, neon-soaked electronic score with orchestral accent. Villeneuve composure meets dark synthwave. Reveal and night walk through neon streets. No vocals. Intense style.',
    d: 47,
  },
  {
    id: 'M3',
    sc: ['S09', 'S10', 'S11', 'S12', 'S13'],
    p: 'High-octane action infiltration — fast-paced electronic percussion, heartbeat bass driving, escalating orchestral brass, tension strings, digital glitch textures, catastrophic system collapse. Nolan Inception-style. Federal Reserve infiltration and empire collapse. No vocals.',
    d: 47,
  },
  {
    id: 'M4',
    sc: ['S14', 'S15', 'S16', 'S17', 'S18', 'S19', 'S20'],
    p: 'Triumphant yet gritty orchestral swell — epic strings building to massive climax, dark electronic synths underneath, heartbeat bass, hopeful rising chord progression, cinematic title-card impact hit, resolution in hopeful sub-bass drone. Villeneuve-Zimmer climax. The privacy revolution wins quietly. No vocals.',
    d: 47,
  },
];

/* ── FFmpeg mixer ─────────────────────────────────────────────────────── */
function mix(v: string, dlg: string | undefined, sx: string, mu: string | undefined, out: string) {
  const i = ['-i', v, '-i', sx];
  const f = ['[1:a]volume=0.5[s]'];
  const mixLabels: string[] = ['[s]'];
  let nextIdx = 2;
  if (mu && fs.existsSync(mu)) {
    i.push('-i', mu);
    f.push(`[${nextIdx}:a]volume=0.3[m]`);
    mixLabels.push('[m]');
    nextIdx++;
  }
  if (dlg && fs.existsSync(dlg)) {
    i.push('-i', dlg);
    f.push(`[${nextIdx}:a]volume=1.0[d]`);
    mixLabels.push('[d]');
    nextIdx++;
  }
  const mixCount = mixLabels.length;
  if (mixCount > 1) {
    f.push(`${mixLabels.join('')}amix=inputs=${mixCount}:duration=first:dropout_transition=2[x]`);
  } else {
    f.push(`${mixLabels[0]}acopy[x]`);
  }
  const c = [
    'ffmpeg',
    '-y',
    ...i,
    '-filter_complex',
    f.join(';'),
    '-map',
    '0:v',
    '-map',
    '[x]',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-shortest',
    out,
  ];
  execSync(c.map((s) => (/[\s;\[\]]/.test(s) ? `"${s}"` : s)).join(' '), {
    stdio: 'pipe',
    timeout: 120_000,
  });
}

/* ── Fetch scene videos from Firestore ───────────────────────────────── */
async function fetchSceneVideos(db: FirebaseFirestore.Firestore): Promise<Record<string, string>> {
  const snap = await db
    .collection('content')
    .where('universeId', '==', UNIVERSE_ID)
    .where('tags', 'array-contains', EPISODE_TAG)
    .get();
  const out: Record<string, string> = {};
  for (const doc of snap.docs) {
    const data = doc.data();
    const sceneTag = (data.tags || []).find((t: string) => /^s\d+$/.test(t));
    if (sceneTag) {
      out[sceneTag.toUpperCase()] = data.mediaUrl || data.videoUrl;
    }
  }
  return out;
}

/* ── Create sound node (visible in UI AudioToolbar) ──────────────────── */
async function createSoundNode(
  db: FirebaseFirestore.Firestore,
  contentId: string,
  kind: 'music' | 'sfx' | 'dialogue',
  audioUrl: string,
  prompt: string,
  duration: number,
  volume = 1.0
) {
  const id = randomUUID();
  await db.collection('soundNodes').doc(id).set({
    id,
    universeId: UNIVERSE_ID,
    videoGenerationId: contentId,
    kind,
    prompt,
    audioUrl,
    duration,
    startOffsetSec: 0,
    volume,
    loop: false,
    createdBy: CREATOR,
    createdAt: new Date(),
  });
  return id;
}

/* ── Main ────────────────────────────────────────────────────────────── */
async function main() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  MONEROCHAN — Audio Pipeline — "Shadows of Freedom"');
  console.log('  Voice profiles + Music (4 acts) + SFX (20) + Lip-sync + Mix');
  console.log('═══════════════════════════════════════════════════════════\n');

  if (!EL_KEY) throw new Error('ELEVENLABS_API_KEY missing');
  if (!FK) throw new Error('FAL_KEY missing');
  if (!PINATA_JWT) throw new Error('PINATA_JWT missing');
  try {
    execSync('ffmpeg -version', { stdio: 'pipe' });
  } catch {
    throw new Error('ffmpeg required');
  }

  mkdir(ODIR);
  for (const d of ['dialogue', 'sfx', 'music', 'lipsync', 'videos', 'final', 'previews']) {
    mkdir(path.join(ODIR, d));
  }

  const db = initFirebase();

  // ── Phase 1: Voice profiles ─────────────────────────────────────────
  console.log('\n── Phase 1: Voice profiles ──');
  const voices = await loadOrCreateVoiceProfiles(db);

  const scenes = buildScenes();
  const active = SFILT ? scenes.filter((s) => SFILT!.has(s.id)) : scenes;
  L('SCENES', `${active.length} scenes to process`);

  // ── Phase 2: Fetch scene videos ─────────────────────────────────────
  console.log('\n── Phase 2: Fetch scene videos ──');
  const videoUrls = await fetchSceneVideos(db);
  L('VIDEOS', `Found ${Object.keys(videoUrls).length} scene videos`);

  // ── Phase 3: Generate music segments ────────────────────────────────
  console.log('\n── Phase 3: Music generation (4 acts) ──');
  const musicFiles: Record<string, string> = {};
  const musicUrls: Record<string, string> = {};
  for (const m of MUS) {
    const localPath = path.join(ODIR, 'music', `${m.id}.mp3`);
    if (!fs.existsSync(localPath)) {
      try {
        L('MUSIC', `Generating ${m.id} (${m.d}s)...`);
        const url = await fMusic(m.p, m.d);
        if (url) {
          await dl(url, localPath);
          L('MUSIC', `  Done: ${m.id}`);
        } else {
          L('MUSIC', `  No URL for ${m.id}`);
          continue;
        }
      } catch (err: any) {
        L('MUSIC', `FAIL ${m.id}: ${err.message?.slice(0, 150)}`);
        continue;
      }
      await Z(1500);
    }
    musicFiles[m.id] = localPath;
    // Pin music to IPFS for UI reuse
    try {
      musicUrls[m.id] = await pinFile(localPath, `monerochan-music-${m.id}.mp3`, 'audio/mpeg');
      L('MUSIC', `  Pinned: ${musicUrls[m.id].slice(0, 70)}...`);
    } catch (err: any) {
      L('MUSIC', `  Pin failed: ${err.message?.slice(0, 80)}`);
      musicUrls[m.id] = `file://${localPath}`;
    }
  }

  // ── Phase 4: Per-scene processing ───────────────────────────────────
  console.log('\n── Phase 4: Per-scene audio (SFX + dialogue + lipsync + mix) ──');

  // Fetch content IDs for sound node linking
  const contentSnap = await db
    .collection('content')
    .where('universeId', '==', UNIVERSE_ID)
    .where('tags', 'array-contains', EPISODE_TAG)
    .get();
  const contentIdBySceneTag: Record<string, string> = {};
  for (const doc of contentSnap.docs) {
    const tag = (doc.data().tags || []).find((t: string) => /^s\d+$/.test(t));
    if (tag) contentIdBySceneTag[tag.toUpperCase()] = doc.id;
  }

  let ok = 0;
  let fail = 0;
  let skip = 0;

  for (const s of active) {
    console.log(`\n─── ${s.id}: ${s.t} ───`);
    const vurl = videoUrls[s.id];
    if (!vurl) {
      L(s.id, 'No video — skipping');
      skip++;
      continue;
    }
    const contentId = contentIdBySceneTag[s.id];

    try {
      // Download video locally
      const vf = path.join(ODIR, 'videos', `${s.id}.mp4`);
      if (!fs.existsSync(vf)) {
        L(s.id, 'Downloading video...');
        await dl(vurl, vf);
      }

      // ── Dialogue TTS ──
      let df: string | undefined;
      let dialogueUrl: string | null = null;
      if (s.ln.length) {
        df = path.join(ODIR, 'dialogue', `${s.id}.mp3`);
        if (!fs.existsSync(df)) {
          L(s.id, `Generating dialogue (${s.ln.length} line(s))...`);
          const bufs: Buffer[] = [];
          for (const ln of s.ln) {
            const v = voices[ln.sp];
            if (!v) continue;
            bufs.push(await tts(ln.tx, v.voiceId, v.st, v.sy));
            bufs.push(Buffer.alloc(8820)); // ~100ms silence
            await Z(500);
          }
          if (bufs.length) fs.writeFileSync(df, Buffer.concat(bufs));
        }
        if (fs.existsSync(df)) {
          dialogueUrl = await pinFile(df, `mc-${s.id}-dialogue.mp3`, 'audio/mpeg');
          if (contentId) {
            await createSoundNode(
              db,
              contentId,
              'dialogue',
              dialogueUrl,
              s.ln.map((l) => `${l.sp}: ${l.tx}`).join(' | '),
              10,
              1.0
            );
          }
        }
      }

      // ── SFX ──
      const sf = path.join(ODIR, 'sfx', `${s.id}.mp3`);
      if (!fs.existsSync(sf)) {
        L(s.id, 'Generating SFX...');
        try {
          fs.writeFileSync(sf, await sfx(s.sx, 10));
        } catch (err: any) {
          L(s.id, `SFX fail: ${err.message?.slice(0, 80)} — silent fallback`);
          fs.writeFileSync(sf, Buffer.alloc(44100 * 2));
        }
        await Z(500);
      }
      const sfxUrl = await pinFile(sf, `mc-${s.id}-sfx.mp3`, 'audio/mpeg');
      if (contentId) {
        await createSoundNode(db, contentId, 'sfx', sfxUrl, s.sx, 10, 0.5);
      }

      // ── Music for scene (may be missing if fal balance exhausted) ──
      const mu = musicFiles[s.m];
      if (!mu) {
        L(s.id, 'No music — mixing video + SFX + dialogue only');
      } else if (contentId && musicUrls[s.m]) {
        await createSoundNode(
          db,
          contentId,
          'music',
          musicUrls[s.m],
          `Music: ${s.m} segment`,
          47,
          0.3
        );
      }

      // ── Lip-sync (if dialogue + face visible) ──
      let fv = vf;
      if (!SKIP_LIP && df && s.fc && fs.existsSync(df)) {
        const lf = path.join(ODIR, 'lipsync', `${s.id}.mp4`);
        if (!fs.existsSync(lf)) {
          try {
            L(s.id, 'Lip-syncing...');
            const lu = await fLip(await fUpV(vf), await fUpA(fs.readFileSync(df), `${s.id}.mp3`));
            if (lu) {
              await dl(lu, lf);
              fv = lf;
              L(s.id, '  Lip-sync done');
            }
          } catch (err: any) {
            L(s.id, `Lip-sync failed: ${err.message?.slice(0, 80)}`);
          }
        } else {
          fv = lf;
        }
      }

      // ── FFmpeg composite ──
      const out = path.join(ODIR, 'final', `${s.id}.mp4`);
      if (!fs.existsSync(out)) {
        L(s.id, 'Mixing video + dialogue + SFX + music...');
        mix(fv, df, sf, mu, out);
      }

      // ── Pin mixed video + update content ──
      const mixedUrl = await pinFile(out, `mc-${s.id}-mixed.mp4`, 'video/mp4');
      if (contentId) {
        await db.collection('content').doc(contentId).update({
          mediaUrl: mixedUrl,
          videoUrl: mixedUrl,
          originalVideoUrl: vurl, // preserve the pre-mix version
          hasAudioMix: true,
          updatedAt: new Date(),
        });
      }

      L(s.id, `DONE → ${mixedUrl.slice(0, 70)}...`);
      ok++;
    } catch (err: any) {
      L(s.id, `FAIL: ${err.message?.slice(0, 200)}`);
      fail++;
    }
  }

  // ── Phase 5: Concatenate all mixed scenes into final trailer ────────
  console.log('\n── Phase 5: Final trailer concatenation ──');
  const finalTrailerPath = path.join(ODIR, 'monerochan-ep1-trailer.mp4');
  const concatList = path.join(ODIR, 'concat.txt');
  const sceneIdsInOrder = scenes.map((s) => s.id);
  const mixedScenes = sceneIdsInOrder
    .map((id) => path.join(ODIR, 'final', `${id}.mp4`))
    .filter((p) => fs.existsSync(p));

  if (mixedScenes.length > 0) {
    // Re-encode pass (concat demux needs matching codecs)
    const reencodedDir = path.join(ODIR, 'reencoded');
    mkdir(reencodedDir);
    const reencoded: string[] = [];
    for (const p of mixedScenes) {
      const rp = path.join(reencodedDir, path.basename(p));
      if (!fs.existsSync(rp)) {
        L('CONCAT', `Re-encoding ${path.basename(p)}...`);
        execSync(
          `ffmpeg -y -i "${p}" -vf "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1" -r 30 -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 192k -ar 44100 "${rp}" 2>/dev/null`,
          { stdio: 'pipe', timeout: 180_000 }
        );
      }
      reencoded.push(rp);
    }

    fs.writeFileSync(concatList, reencoded.map((p) => `file '${p}'`).join('\n'));
    L('CONCAT', `Concatenating ${reencoded.length} scenes...`);
    execSync(
      `ffmpeg -y -f concat -safe 0 -i "${concatList}" -c copy "${finalTrailerPath}" 2>/dev/null`,
      { stdio: 'pipe', timeout: 300_000 }
    );

    const trailerUrl = await pinFile(
      finalTrailerPath,
      'monerochan-ep1-trailer-final.mp4',
      'video/mp4'
    );
    L('TRAILER', `Final trailer: ${trailerUrl}`);

    // Update episode doc
    const eps = await db
      .collection('episodes')
      .where('title', '==', 'Monerochan: Shadows of Freedom')
      .get();
    for (const epDoc of eps.docs) {
      await epDoc.ref.update({
        exportUrl: trailerUrl,
        exportStorageKey: `ipfs:${trailerUrl.split('/ipfs/')[1]}`,
        exportedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
    L('EPISODE', `Updated ${eps.size} episode doc(s) with exportUrl`);
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`  COMPLETE — ${ok} ok | ${fail} fail | ${skip} skip`);
  console.log(`  Voice profiles saved to voiceProfiles collection`);
  console.log(`  Sound nodes saved to soundNodes collection (visible in AudioToolbar UI)`);
  console.log(`  Mixed videos updated on content.mediaUrl`);
  console.log(`  Final trailer exported to episode doc`);
  console.log('═══════════════════════════════════════════════════════════\n');

  process.exit(0);
}

main().catch((e) => {
  console.error('\nFATAL:', e.message ?? e);
  process.exit(1);
});
