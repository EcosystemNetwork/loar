/**
 * E COMBONATOR — Audio Pipeline
 *
 * Adds voice, sound effects, music, and lip-sync to the generated video scenes.
 *
 * Pipeline steps per scene:
 *   1. Design/reuse character voice profiles (ElevenLabs voice design)
 *   2. Extract dialogue from scene plots → TTS via ElevenLabs
 *   3. Generate ambient SFX per scene (ElevenLabs sound effects)
 *   4. Generate background music/score segments (FAL stable-audio)
 *   5. Run lip-sync on dialogue scenes (FAL lipsync CV model)
 *   6. Composite all layers via ffmpeg
 *
 * Usage:
 *   pnpm tsx scripts/ecombonator-audio-pipeline.ts
 *
 * Required env vars:
 *   ELEVENLABS_API_KEY   — Voice synthesis + SFX
 *   FAL_KEY              — Music generation + lip-sync
 *   PRIVATE_KEY          — Read on-chain video URLs
 *   RPC_URL              — Ethereum RPC
 *
 * Optional:
 *   ECOMB_VIDEO_DIR      — Local directory of downloaded .mp4 files (skips on-chain fetch)
 *   ECOMB_OUTPUT_DIR     — Output directory (default: ./ecombonator-output)
 *   ECOMB_SKIP_LIPSYNC   — Set "true" to skip lip-sync pass (faster iteration)
 *   ECOMB_SCENES         — Comma-separated scene IDs to process (e.g. "S01,S05,S16")
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import * as fal from '@fal-ai/serverless-client';
import { createPublicClient, http, decodeEventLog } from 'viem';
import { sepolia } from 'viem/chains';
import { execSync } from 'child_process';

// ── Config ─────────────────────────────────────────────────────────────

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY!;
const FAL_KEY = process.env.FAL_KEY!;
const RPC_URL = process.env.RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com';
const UNIVERSE_ADDR = '0x36A903899f51096E8A59d5Bee018966C995888c1' as const;

const OUTPUT_DIR = process.env.ECOMB_OUTPUT_DIR || './ecombonator-output';
const VIDEO_DIR = process.env.ECOMB_VIDEO_DIR || '';
const SKIP_LIPSYNC = process.env.ECOMB_SKIP_LIPSYNC === 'true';
const SCENE_FILTER = process.env.ECOMB_SCENES
  ? new Set(process.env.ECOMB_SCENES.split(',').map((s) => s.trim()))
  : null;

const ELEVEN_BASE = 'https://api.elevenlabs.io/v1';

// ── Helpers ─────────────────────────────────────────────────────────────

function log(step: string, msg: string) {
  console.log(`[${step}] ${msg}`);
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function isValidAudioFile(filePath: string, minBytes = 1024): boolean {
  if (!fs.existsSync(filePath)) return false;
  return fs.statSync(filePath).size >= minBytes;
}

function progress(current: number, total: number, label: string) {
  const pct = Math.round((current / total) * 100);
  const bar = '█'.repeat(Math.floor(pct / 5)) + '░'.repeat(20 - Math.floor(pct / 5));
  console.log(`  [${bar}] ${pct}% (${current}/${total}) ${label}`);
}

// ── ElevenLabs API (direct, no server dependency) ───────────────────────

function elevenHeaders(): Record<string, string> {
  return { 'xi-api-key': ELEVENLABS_API_KEY, 'Content-Type': 'application/json' };
}

async function elevenFetchBuffer(urlPath: string, body: Record<string, unknown>): Promise<Buffer> {
  const res = await fetch(`${ELEVEN_BASE}${urlPath}`, {
    method: 'POST',
    headers: elevenHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`ElevenLabs ${res.status}: ${text.slice(0, 300)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function elevenDesignVoice(opts: {
  name: string;
  gender: 'male' | 'female' | 'neutral';
  age: 'young' | 'middle_aged' | 'old';
  accent: string;
  accentStrength: number;
  previewText: string;
  description: string;
}): Promise<{ voiceId: string }> {
  // Step 1: generate voice preview
  const genRes = await fetch(`${ELEVEN_BASE}/voice-generation/generate-voice`, {
    method: 'POST',
    headers: elevenHeaders(),
    body: JSON.stringify({
      gender: opts.gender,
      age: opts.age,
      accent: opts.accent,
      accent_strength: opts.accentStrength,
      text: opts.previewText,
    }),
  });
  if (!genRes.ok) throw new Error(`Voice design gen failed: ${genRes.status}`);
  const genData = await genRes.json();

  // Step 2: save it
  const saveRes = await fetch(`${ELEVEN_BASE}/voice-generation/create-voice`, {
    method: 'POST',
    headers: elevenHeaders(),
    body: JSON.stringify({
      voice_name: opts.name,
      voice_description: opts.description,
      generated_voice_id: genData.generated_voice_id,
      labels: {},
    }),
  });
  if (!saveRes.ok) throw new Error(`Voice design save failed: ${saveRes.status}`);
  const saveData = await saveRes.json();
  return { voiceId: saveData.voice_id };
}

async function elevenTTS(
  text: string,
  voiceId: string,
  opts?: { stability?: number; style?: number }
): Promise<Buffer> {
  return elevenFetchBuffer(`/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
    text,
    model_id: 'eleven_v3',
    voice_settings: {
      stability: opts?.stability ?? 0.5,
      similarity_boost: 0.75,
      style: opts?.style ?? 0.4,
      use_speaker_boost: true,
    },
  });
}

async function elevenSFX(description: string, durationSec?: number): Promise<Buffer> {
  const body: Record<string, unknown> = { text: description, prompt_influence: 0.4 };
  if (durationSec) body.duration_seconds = durationSec;
  return elevenFetchBuffer('/sound-generation', body);
}

// ── FAL API (direct) ────────────────────────────────────────────────────

function ensureFalConfigured() {
  fal.config({ credentials: FAL_KEY });
}

async function falGenerateMusic(prompt: string, durationSec: number): Promise<string> {
  ensureFalConfigured();
  const result = await fal.subscribe('fal-ai/stable-audio', {
    input: { prompt, seconds_total: durationSec, steps: 100 },
    logs: true,
  });
  const data = (result as any).data || result;
  return data.audio_file?.url || data.audio?.url || data.audio_url || data.url;
}

async function falLipSync(videoUrl: string, audioUrl: string): Promise<string | null> {
  ensureFalConfigured();
  try {
    const result = await fal.subscribe('fal-ai/lipsync', {
      input: { video_url: videoUrl, audio_url: audioUrl },
      logs: true,
    });
    const data = (result as any).data || result;
    return data.video?.url || data.video_url || data.url || null;
  } catch (err: any) {
    log('LIPSYNC', `Failed (will use original video): ${err.message?.slice(0, 200)}`);
    // Try sadtalker fallback
    try {
      const result = await fal.subscribe('fal-ai/sadtalker', {
        input: { video_url: videoUrl, audio_url: audioUrl },
        logs: true,
      });
      const data = (result as any).data || result;
      return data.video?.url || data.video_url || data.url || null;
    } catch {
      return null;
    }
  }
}

// ── Download helper ─────────────────────────────────────────────────────

async function downloadFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed ${res.status}: ${url.slice(0, 100)}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
}

// ── Upload audio buffer to temporary hosting (for lip-sync input) ───────

async function uploadToFalStorage(buffer: Buffer, filename: string): Promise<string> {
  ensureFalConfigured();
  const blob = new Blob([buffer], { type: 'audio/mpeg' });
  const file = new File([blob], filename, { type: 'audio/mpeg' });
  const url = await fal.storage.upload(file);
  return url;
}

async function uploadVideoToFalStorage(filePath: string): Promise<string> {
  ensureFalConfigured();
  const buffer = fs.readFileSync(filePath);
  const blob = new Blob([buffer], { type: 'video/mp4' });
  const file = new File([blob], path.basename(filePath), { type: 'video/mp4' });
  const url = await fal.storage.upload(file);
  return url;
}

// ── Character Voice Profiles ────────────────────────────────────────────

interface VoiceProfile {
  name: string;
  voiceId: string;
  stability: number;
  style: number;
}

const VOICE_PROFILES_FILE = path.join(OUTPUT_DIR, 'voice-profiles.json');

const CHARACTER_VOICE_SPECS = {
  ELI: {
    name: 'Eli Reyes - E Combonator',
    gender: 'male' as const,
    age: 'young' as const,
    accent: 'american',
    accentStrength: 0.8,
    previewText:
      'This is a local predictive system that models the next several seconds of a physical environment in real time. Watch.',
    description:
      'Young male tech founder, calm, technical, slightly detached. Quiet intensity. Think young engineer presenting something extraordinary without hype.',
    stability: 0.55,
    style: 0.3,
  },
  MAYA: {
    name: 'Maya Chen - E Combonator',
    gender: 'female' as const,
    age: 'young' as const,
    accent: 'american',
    accentStrength: 0.6,
    previewText:
      'He trained it on public sensor spill, local device emissions, camera motion, thermal drift, posture anticipation, network timing.',
    description:
      'Young female systems engineer, precise, clinical, calm. No-nonsense. Dry wit. Speaks like someone reading a technical spec out loud.',
    stability: 0.6,
    style: 0.2,
  },
  DEV: {
    name: 'Dev Patel - E Combonator',
    gender: 'male' as const,
    age: 'young' as const,
    accent: 'american',
    accentStrength: 0.7,
    previewText:
      'There he is. Bay Area cryptid. Still building impossible nonsense nobody asked for?',
    description:
      'Young male, energetic, charismatic, expressive. The hype man. Speaks with big gestures in his voice. Mix of comedy and genuine warmth.',
    stability: 0.4,
    style: 0.6,
  },
  CELESTE: {
    name: 'Celeste Vane - E Combonator',
    gender: 'female' as const,
    age: 'middle_aged' as const,
    accent: 'british',
    accentStrength: 0.4,
    previewText: "You keep winning rooms that don't know what you are. Come to one that does.",
    description:
      'Mature female VC, composed, precise, slightly predatory. Controlled elegance. Every word placed deliberately. Slight British inflection.',
    stability: 0.7,
    style: 0.5,
  },
  HOST: {
    name: 'Hackathon Host - E Combonator',
    gender: 'male' as const,
    age: 'young' as const,
    accent: 'american',
    accentStrength: 1.0,
    previewText: 'And first place goes to... Team GhostLattice! What the hell?',
    description:
      'Male event MC, professional, hype energy, clear enunciation. Standard tech event host voice.',
    stability: 0.5,
    style: 0.4,
  },
  JUDGE: {
    name: 'Hackathon Judge - E Combonator',
    gender: 'male' as const,
    age: 'middle_aged' as const,
    accent: 'american',
    accentStrength: 0.8,
    previewText: 'What are you building? Uh-huh. So... surveillance?',
    description: 'Middle-aged male, dismissive, corporate. The skeptic in every pitch room.',
    stability: 0.6,
    style: 0.3,
  },
};

async function loadOrCreateVoiceProfiles(): Promise<Record<string, VoiceProfile>> {
  // Try to load existing profiles
  if (fs.existsSync(VOICE_PROFILES_FILE)) {
    log('VOICES', 'Loading existing voice profiles...');
    const saved = JSON.parse(fs.readFileSync(VOICE_PROFILES_FILE, 'utf-8'));
    log('VOICES', `Loaded ${Object.keys(saved).length} profiles`);
    return saved;
  }

  log('VOICES', 'Designing voice profiles for all characters...');
  const profiles: Record<string, VoiceProfile> = {};

  for (const [key, spec] of Object.entries(CHARACTER_VOICE_SPECS)) {
    log('VOICES', `Designing voice: ${spec.name}...`);
    try {
      const { voiceId } = await elevenDesignVoice({
        name: spec.name,
        gender: spec.gender,
        age: spec.age,
        accent: spec.accent,
        accentStrength: spec.accentStrength,
        previewText: spec.previewText,
        description: spec.description,
      });
      profiles[key] = {
        name: spec.name,
        voiceId,
        stability: spec.stability,
        style: spec.style,
      };
      log('VOICES', `  ${key} → ${voiceId}`);
      await sleep(1000); // Rate limit
    } catch (err: any) {
      log('VOICES', `  FAILED for ${key}: ${err.message?.slice(0, 200)}`);
    }
  }

  // Save profiles for reuse
  fs.writeFileSync(VOICE_PROFILES_FILE, JSON.stringify(profiles, null, 2));
  log('VOICES', `Saved ${Object.keys(profiles).length} voice profiles`);
  return profiles;
}

// ── Dialogue Extraction ─────────────────────────────────────────────────

interface DialogueLine {
  speaker: string; // Character key (ELI, MAYA, DEV, CELESTE, HOST, JUDGE)
  text: string;
}

/**
 * Extract dialogue lines from a scene's plot text.
 * Dialogue is in quotes, speakers are identified by name or context.
 */
function extractDialogue(plot: string): DialogueLine[] {
  const lines: DialogueLine[] = [];

  // Match patterns like: Character: "dialogue" or "dialogue"
  // Also handles — SPEAKER: "line" format
  const patterns = [
    // Explicit speaker: "dialogue"
    /(?:^|[.!?\s])(ELI|MAYA|DEV|CELESTE|HOST|JUDGE\s*#?\d*)[:\s]+["'""]([^"""'']+)["'""]/gi,
    // "dialogue" after speaker name mention
    /(?:Eli|Maya|Dev|Celeste)[^.]*?:\s*["'""]([^"""'']+)["'""]/gi,
  ];

  // Manual extraction with smarter context-aware parsing
  const segments = plot
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const seg of segments) {
    // Find quoted text
    const quoteMatch = seg.match(/["'""]([^"""'']+)["'""]/);
    if (!quoteMatch) continue;
    const text = quoteMatch[1].trim();
    if (text.length < 3) continue;

    // Determine speaker from context
    const segUpper = seg.toUpperCase();
    let speaker = 'NARRATOR';

    if (segUpper.includes('ELI') || segUpper.includes('HE SAYS') || segUpper.includes('HE LOOKS')) {
      speaker = 'ELI';
    } else if (
      segUpper.includes('MAYA') ||
      segUpper.includes('SHE SAYS') ||
      segUpper.includes('SHE DOESN')
    ) {
      speaker = 'MAYA';
    } else if (
      segUpper.includes('DEV') ||
      (segUpper.includes('HIS') && segUpper.includes('GRIN'))
    ) {
      speaker = 'DEV';
    } else if (
      segUpper.includes('CELESTE') ||
      segUpper.includes('QUARRY') ||
      segUpper.includes('VANE')
    ) {
      speaker = 'CELESTE';
    } else if (segUpper.includes('HOST')) {
      speaker = 'HOST';
    } else if (
      segUpper.includes('JUDGE') ||
      segUpper.includes('INVESTOR') ||
      segUpper.includes('REJECT')
    ) {
      speaker = 'JUDGE';
    }

    // Skip narrator lines (plot descriptions in quotes)
    if (speaker === 'NARRATOR') continue;

    lines.push({ speaker, text });
  }

  return lines;
}

// ── Scene Definitions (matching the film scenes script) ─────────────────

interface SceneAudio {
  id: string;
  title: string;
  plot: string;
  dialogue: DialogueLine[];
  sfxDescription: string;
  musicMood: string;
  hasFaces: boolean; // Whether lip-sync can work (scenes with character faces)
}

function buildSceneAudio(): SceneAudio[] {
  // Scene data with audio metadata
  // We only need: id, title, plot (for dialogue), sfx description, music mood, face presence
  return [
    // ── ARRIVAL & ATMOSPHERE (1-8) ──
    {
      id: 'S01',
      title: 'City Rain — Aerial',
      plot: 'EXT. SAN FRANCISCO - NIGHT. Rain across the city skyline. Bay Bridge in the distance. We descend toward SOMA.',
      dialogue: [],
      sfxDescription:
        'Heavy rain falling on a city, distant traffic, wind, helicopter rotors fading',
      musicMood: 'Dark atmospheric synth, noir tension, low rumbling bass, sparse piano notes',
      hasFaces: false,
    },
    {
      id: 'S02',
      title: 'SOMA Streets — Food Trucks',
      plot: 'EXT. SOMA STREET - NIGHT. Food trucks line wet pavement. Neon signs reflect in puddles. Coders huddle under umbrellas.',
      dialogue: [],
      sfxDescription:
        'Wet street footsteps, rain on metal food truck roofs, sizzling grill, distant chatter, car splashing through puddle',
      musicMood: 'Moody urban beat, lo-fi hip hop undertone, rain percussion',
      hasFaces: false,
    },
    {
      id: 'S03',
      title: 'Warehouse Exterior — The Banner',
      plot: 'EXT. WAREHOUSE - NIGHT. A giant banner reads BAYBLITZ HACK VII. RGB light spills from open doors. Hundreds stream in and out.',
      dialogue: [],
      sfxDescription:
        'Crowd murmur growing louder, bass thump from inside, rain on concrete, footsteps rushing, doors creaking',
      musicMood: 'Building energy, electronic pulse, anticipation building',
      hasFaces: false,
    },
    {
      id: 'S04',
      title: 'Entrance — Into the Chaos',
      plot: 'INT. WAREHOUSE ENTRANCE - NIGHT. Camera pushes through the doors into organized chaos. Noise. Heat. Energy drinks and ambition.',
      dialogue: [],
      sfxDescription:
        'Door opening into loud room, crowd noise swelling, keyboard clacking, energy drink cans opening, electrical hum of many laptops',
      musicMood: 'Electronic buildup, hackathon energy, driving synth rhythm',
      hasFaces: false,
    },
    {
      id: 'S05',
      title: 'Hackathon Floor — Teams Working',
      plot: 'INT. HACKATHON FLOOR - NIGHT. Teams pitch drones, AI agents, crypto infrastructure, biotech dashboards. Organized chaos.',
      dialogue: [],
      sfxDescription:
        'Busy hackathon ambience, multiple keyboards typing, drone buzzing briefly, screens beeping, excited chatter',
      musicMood: 'Upbeat tech soundtrack, busy creative energy, moderate tempo electronic',
      hasFaces: false,
    },
    {
      id: 'S06',
      title: 'Floor Details — Caffeine & Code',
      plot: 'INT. FLOOR - NIGHT. Close-ups: fingers on keyboards, energy drink cans stacking, a whiteboard covered in diagrams, tired eyes lit by screens.',
      dialogue: [],
      sfxDescription:
        'Keyboard typing rapid-fire, energy drink can set down on table, marker squeaking on whiteboard, computer fan whirring',
      musicMood: 'Atmospheric lo-fi, late night coding vibe, gentle electronic pulse',
      hasFaces: false,
    },
    {
      id: 'S07',
      title: 'Polished Teams — The Competition',
      plot: 'INT. FLOOR - NIGHT. Well-funded teams in matching hoodies rehearse pitches. Slides with market-size numbers. The startup performance.',
      dialogue: [],
      sfxDescription:
        'Confident voices rehearsing in background, laptop mouse clicks, high-five slap sound, projected slide changing',
      musicMood: 'Corporate upbeat, polished startup energy, slightly ironic',
      hasFaces: false,
    },
    {
      id: 'S08',
      title: 'The Far Corner — Isolation',
      plot: 'INT. FLOOR - NIGHT. Camera pans past all the teams to the far corner. A folding table. Two people. No branding. No matching hoodies. Just screens.',
      dialogue: [],
      sfxDescription:
        'Crowd noise gradually fading to quiet, single keyboard typing softly, solder iron hiss, isolation from the buzzing room',
      musicMood: 'Quiet tension, isolated piano over distant bass, the outsider theme',
      hasFaces: false,
    },

    // ── ELI & MAYA — THE CORNER (9-14) ──
    {
      id: 'S09',
      title: 'Eli at His Screens',
      plot: 'At the folding table sits ELI REYES, alone except for MAYA CHEN. Eli stares at twelve floating windows of data.',
      dialogue: [],
      sfxDescription:
        'Data streaming sounds, soft electronic beeps, mouse scroll clicking, quiet breathing, distant crowd muffled',
      musicMood: 'Mysterious, data-driven ambient, sparse electronic notes with reverb',
      hasFaces: true,
    },
    {
      id: 'S10',
      title: 'Maya Soldering',
      plot: 'MAYA CHEN sits across from Eli, soldering a tiny circuit board. Focused. Precise. The team that needs no words.',
      dialogue: [],
      sfxDescription:
        'Solder iron sizzling and hissing, small metal components clicking, steady breathing, faint circuit board buzz',
      musicMood: 'Precise minimal electronic, clockwork feeling, warm undertone',
      hasFaces: true,
    },
    {
      id: 'S11',
      title: "Eli's Data Streams — Screen Detail",
      plot: "Close-up of Eli's screens. Sensor data, probability matrices, predictive vectors overlaid on camera feeds. Something beyond analytics.",
      dialogue: [],
      sfxDescription:
        'Digital data processing sounds, matrix calculation tones, camera feed switching, electronic pulse rhythms',
      musicMood: 'Sci-fi data visualization soundtrack, mysterious electronic layers',
      hasFaces: false,
    },
    {
      id: 'S12',
      title: 'The Backpack — Character Detail',
      plot: "Close-up of Eli's beat-up backpack on the floor. Covered in hackathon stickers from a dozen events. Worn straps. Everything he owns.",
      dialogue: [],
      sfxDescription: 'Quiet room tone, distant muffled hackathon sounds, fabric rustling slightly',
      musicMood: 'Nostalgic, warm analog synth, the weight of wandering',
      hasFaces: false,
    },
    {
      id: 'S13',
      title: 'Eli and Maya — Two-Shot',
      plot: 'Wide shot of Eli and Maya at their corner table. Two people in a sea of hundreds. Building something nobody asked for.',
      dialogue: [],
      sfxDescription:
        'Soft keyboard typing, solder hiss, distant crowd buzz, quiet partnership sounds',
      musicMood: 'Partnership theme, warm duo melody, acoustic guitar and soft synth',
      hasFaces: true,
    },
    {
      id: 'S14',
      title: 'The White Streak — Detail',
      plot: "Close-up of the white streak in Eli's dark hair. Lit by screen light. A mark that makes him recognizable, memorable, strange.",
      dialogue: [],
      sfxDescription:
        'Soft data pulse, screen light humming, almost imperceptible electronic heartbeat',
      musicMood: 'Character theme intro, single haunting synth note, identity motif',
      hasFaces: true,
    },

    // ── DEV ARRIVES (15-20) ──
    {
      id: 'S15',
      title: 'Dev Approaches — Three Drinks',
      plot: 'DEV approaches holding three energy drinks. Grinning. Rings catching the light. "There he is. Bay Area cryptid."',
      dialogue: [{ speaker: 'DEV', text: 'There he is. Bay Area cryptid.' }],
      sfxDescription:
        'Footsteps through crowd, energy drink cans clinking, crowd parting, rings jingling',
      musicMood: 'Upbeat character intro, funky bass line, confident swagger groove',
      hasFaces: true,
    },
    {
      id: 'S16',
      title: 'Dev Greets Eli',
      plot: '"There he is. Bay Area cryptid. Still building impossible nonsense nobody asked for?" Eli: "That\'s the best kind."',
      dialogue: [
        { speaker: 'DEV', text: 'Still building impossible nonsense nobody asked for?' },
        { speaker: 'ELI', text: "That's the best kind." },
      ],
      sfxDescription:
        'Energy drinks set on table, friendly shoulder pat, cans sliding on folding table',
      musicMood: 'Warm friendship theme, easy groove, comfortable chemistry',
      hasFaces: true,
    },
    {
      id: 'S17',
      title: 'Dev Looks at Screen',
      plot: '"What even is it this time?" Dev peers at Eli\'s screens. Confusion. Fascination.',
      dialogue: [{ speaker: 'DEV', text: 'What even is it this time?' }],
      sfxDescription: 'Chair scooting closer, data streams intensifying, Dev leaning in sound',
      musicMood: 'Curiosity building, rising electronic tension, question motif',
      hasFaces: true,
    },
    {
      id: 'S18',
      title: 'The Camera Feed',
      plot: 'Eli taps a screen. A live camera feed of the room appears. Floating vectors surround everyone. "It predicts what happens next."',
      dialogue: [{ speaker: 'ELI', text: 'It predicts what happens next.' }],
      sfxDescription:
        'Screen tap sound, camera feed activating, holographic overlay swoosh, prediction vectors blooming with soft electronic whoosh',
      musicMood: 'Revelation moment, ascending synth sweep, wonder and danger intertwined',
      hasFaces: true,
    },
    {
      id: 'S19',
      title: "Dev's Confusion",
      plot: '"You mean like… analytics?" "No. I mean next." Dev doesn\'t understand yet.',
      dialogue: [
        { speaker: 'DEV', text: 'You mean like... analytics?' },
        { speaker: 'ELI', text: 'No. I mean next.' },
      ],
      sfxDescription: 'Energy drink held mid-air, silent beat, data pulsing softly',
      musicMood: 'Tension pause, minimal, the moment before understanding',
      hasFaces: true,
    },
    {
      id: 'S20',
      title: 'Yellow Hoodie — The Prediction',
      plot: 'Eli points across the room. A guy in a yellow hoodie laughs, turns, drops his laptop. Three seconds later, exactly that happens. Dev freezes.',
      dialogue: [],
      sfxDescription:
        'Finger pointing swoosh, distant laughter, laptop crashing to floor with crack, gasps, stunned silence beat',
      musicMood: 'Time-stop moment, slow motion bass drop, impossible made real, impact hit',
      hasFaces: true,
    },

    // ── MAYA EXPLAINS / JUDGES IGNORE (21-27) ──
    {
      id: 'S21',
      title: 'Dev\'s Reaction — "Nope"',
      plot: 'Dev stares. Shakes his head. "Nope." He takes a long drink from his energy can.',
      dialogue: [{ speaker: 'DEV', text: 'Nope.' }],
      sfxDescription:
        'Head shake, long drinking gulp from aluminum can, can set down with finality',
      musicMood: 'Comic relief beat, disbelief rhythm, slight funk undertone',
      hasFaces: true,
    },
    {
      id: 'S22',
      title: 'Maya Explains — Technical',
      plot: 'Maya: "He trained it on public sensor spill, local device emissions, camera motion, thermal drift, posture anticipation, network timing—"',
      dialogue: [
        {
          speaker: 'MAYA',
          text: 'He trained it on public sensor spill, local device emissions, camera motion, thermal drift, posture anticipation, network timing—',
        },
      ],
      sfxDescription:
        'Smart glasses glinting, precise finger tapping on table emphasizing each point, data visualization sounds',
      musicMood: 'Technical precision, staccato electronic notes, methodical rhythm',
      hasFaces: true,
    },
    {
      id: 'S23',
      title: 'Dev Overwhelmed',
      plot: '"Stop. You\'re turning me off." Dev holds up his hands in surrender.',
      dialogue: [{ speaker: 'DEV', text: "Stop. You're turning me off." }],
      sfxDescription: 'Hands slapping together in surrender gesture, Maya pausing mid-word',
      musicMood: 'Comedy beat, whimsical pause, friendship dynamic',
      hasFaces: true,
    },
    {
      id: 'S24',
      title: 'Judges Approach',
      plot: "Judges with lanyards and clipboards approach Eli's table. They barely slow down.",
      dialogue: [],
      sfxDescription:
        'Lanyard badges clinking, clipboard pages flipping, shoes on concrete floor, quick pace footsteps',
      musicMood: 'Corporate dismissal theme, cold efficiency, hollow footsteps rhythm',
      hasFaces: true,
    },
    {
      id: 'S25',
      title: 'The Dismissal',
      plot: '"What are you building?" "A probabilistic reality engine." "Uh-huh." They keep walking. They didn\'t even stop.',
      dialogue: [
        { speaker: 'JUDGE', text: 'What are you building?' },
        { speaker: 'ELI', text: 'A probabilistic reality engine.' },
        { speaker: 'JUDGE', text: 'Uh-huh.' },
      ],
      sfxDescription:
        'Footsteps not stopping, clipboard pen scratching quickly, walking away sound, weight of silence',
      musicMood: 'Rejection theme, deflating, quiet sting of being invisible',
      hasFaces: true,
    },
    {
      id: 'S26',
      title: "Dev's Frustration",
      plot: '"You could literally invent fire and if it didn\'t have a B2B dashboard they\'d still walk past."',
      dialogue: [
        {
          speaker: 'DEV',
          text: "You could literally invent fire and if it didn't have a B2B dashboard they'd still walk past.",
        },
      ],
      sfxDescription: 'Energy drink sloshing in frustration, hand gesture whoosh, angry exhale',
      musicMood: 'Frustration groove, bass-heavy, righteous anger undertone',
      hasFaces: true,
    },
    {
      id: 'S27',
      title: "Maya's Smirk",
      plot: '"Good. Less stupid feedback." Maya doesn\'t look up from her soldering. Quiet confidence.',
      dialogue: [{ speaker: 'MAYA', text: 'Good. Less stupid feedback.' }],
      sfxDescription:
        'Solder iron hiss continuing, small smirk breath, tweezers adjusting component with tiny click',
      musicMood: 'Quiet power, confident minimal theme, knowing calm',
      hasFaces: true,
    },

    // ── CELESTE WATCHING (28-30) ──
    {
      id: 'S28',
      title: "The Mezzanine — Celeste's POV",
      plot: 'Across the room and above, a polished woman in white watches from a mezzanine balcony. CELESTE VANE.',
      dialogue: [],
      sfxDescription:
        'High heels on metal grating, jewelry clinking softly, crowd noise below muffled, surveillance tone',
      musicMood: 'Predator theme intro, cold elegant strings, controlled tension, silver ice',
      hasFaces: true,
    },
    {
      id: 'S29',
      title: 'Celeste Studies Eli',
      plot: "Celeste's eyes track to Eli's corner. She watches the judges walk past without stopping. Her expression is unreadable. She's seen enough.",
      dialogue: [],
      sfxDescription:
        'Soft exhale of recognition, fingers on railing, distant crowd below, sharp focus sound',
      musicMood: 'Hunting theme, patient stalking rhythm, calculated observation',
      hasFaces: true,
    },
    {
      id: 'S30',
      title: "Celeste's Eyes — Detail",
      plot: "Extreme close-up of Celeste's eyes. Calculating. Patient. She found what she's looking for.",
      dialogue: [],
      sfxDescription: 'Heartbeat slowing, camera shutter metaphor click, absolute focus tone',
      musicMood: 'Target acquired, single held note, tension crystallizing into decision',
      hasFaces: true,
    },

    // ── DEMO TIME (31-43) ──
    {
      id: 'S31',
      title: 'Demo Stage Setup',
      plot: 'LATER - DEMO TIME. The stage is set. Screen behind podium. Host warming up the crowd. The main event.',
      dialogue: [],
      sfxDescription:
        'Stage lights powering on with electrical hum, crowd settling into seats, microphone feedback squeal then clear',
      musicMood: 'Showtime buildup, arena energy, anticipation drums',
      hasFaces: false,
    },
    {
      id: 'S32',
      title: 'Pitch Parade — Compliance',
      plot: '"AI compliance copilot." A team presents polished slides. Investors nod. Polite applause.',
      dialogue: [],
      sfxDescription:
        'Slide clicker clicking, polite sparse applause, projector hum, pen writing on notepad',
      musicMood: 'Corporate presentation music, safe and forgettable, elevator music irony',
      hasFaces: false,
    },
    {
      id: 'S33',
      title: 'Pitch Parade — DePIN',
      plot: '"DePIN wellness network." Another team, another deck, another round of polite applause. The rhythm of the expected.',
      dialogue: [],
      sfxDescription:
        'Slide transition whoosh, more polite applause slightly thinner, seats creaking as people shift',
      musicMood: 'Same corporate tune slightly different, repetition feeling, numbness setting in',
      hasFaces: false,
    },
    {
      id: 'S34',
      title: 'Pitch Parade — Growth Engine',
      plot: '"Autonomous growth engine." The audience is on autopilot. Clapping on cue. Nobody\'s mind is being changed.',
      dialogue: [],
      sfxDescription:
        'Mechanical applause, phone buzz notification, someone yawning quietly, autopilot clapping',
      musicMood: 'Fading corporate music, diminishing returns, the machine of mediocrity',
      hasFaces: false,
    },
    {
      id: 'S35',
      title: 'Eli Backstage — No Slides',
      plot: 'Backstage: Eli stands alone with his laptop. No slides loaded. No pitch deck. Just a black terminal. Maya gives him a nod.',
      dialogue: [],
      sfxDescription:
        'Terminal cursor blinking with soft electronic tick, deep breath, cable plugging sound, single firm nod',
      musicMood: 'Pre-battle calm, held breath, warrior meditation before the storm',
      hasFaces: true,
    },
    {
      id: 'S36',
      title: 'The Call — "Team GhostLattice?"',
      plot: 'HOST: "And… Team GhostLattice?" Silence. Eli walks onstage. Alone. No branding. Just a black hoodie and a laptop.',
      dialogue: [{ speaker: 'HOST', text: 'And... Team GhostLattice?' }],
      sfxDescription:
        'Microphone amplified voice, crowd murmur, single footsteps on stage, spotlight activating with thunk',
      musicMood: 'The outsider walks in, lone guitar note, silence pregnant with possibility',
      hasFaces: true,
    },
    {
      id: 'S37',
      title: 'Eli Plugs In',
      plot: 'Eli plugs his laptop into the stage system. Black terminal fills the big screen. The cursor blinks. The room is quiet.',
      dialogue: [],
      sfxDescription:
        'HDMI cable plugging in with click, screen powering on, cursor blink tick-tick-tick, dead silence from crowd, single cough',
      musicMood: 'Silence is the music, just the cursor ticking, negative space as composition',
      hasFaces: false,
    },
    {
      id: 'S38',
      title: 'The Pitch — Blank Stares',
      plot: '"Hi. This is a local predictive system that models the next several seconds of a physical environment in real time." Blank stares.',
      dialogue: [
        {
          speaker: 'ELI',
          text: 'Hi. This is a local predictive system that models the next several seconds of a physical environment in real time.',
        },
      ],
      sfxDescription:
        'Microphone picking up calm voice, uncomfortable crowd silence, seats creaking, confused murmurs',
      musicMood:
        'Unimpressed silence, tension without release, the gap between genius and understanding',
      hasFaces: true,
    },
    {
      id: 'S39',
      title: 'The Skeptic — "Surveillance?"',
      plot: 'An investor in the crowd interrupts: "So… surveillance?" Eli pauses. "No."',
      dialogue: [
        { speaker: 'JUDGE', text: 'So... surveillance?' },
        { speaker: 'ELI', text: 'No. Watch.' },
      ],
      sfxDescription:
        'Voice from crowd cutting through silence, microphone pop on "No", dramatic pause beat',
      musicMood: 'Confrontation beat, bass tension, defiance chord',
      hasFaces: true,
    },
    {
      id: 'S40',
      title: 'Camera Points at Judges',
      plot: '"Watch." Eli points a camera at the judges\' table. Blue vectors bloom across the screen. Prediction overlays appear on every person.',
      dialogue: [],
      sfxDescription:
        'Camera activating with electronic whir, holographic interface blooming with cascading whoosh sounds, prediction vectors pulsing, crowd gasping',
      musicMood:
        'Sci-fi activation sequence, systems online, data becoming visible, revelation surge',
      hasFaces: true,
    },
    {
      id: 'S41',
      title: 'The Three Predictions',
      plot: '"Judge two will reject my premise in four seconds. Judge one will reach for water in six. The man in the back will receive a call and leave in eight."',
      dialogue: [
        {
          speaker: 'ELI',
          text: 'Judge two will reject my premise in four seconds. Judge one will reach for water in six. The man in the back will receive a call and leave in eight.',
        },
      ],
      sfxDescription:
        'Countdown timer ticking, prediction markers locking on targets with electronic chirps, held breath from audience',
      musicMood: 'Countdown tension, clock-tick rhythm, impending proof, everything on the line',
      hasFaces: true,
    },
    {
      id: 'S42',
      title: 'Prediction Lands — The Rejection',
      plot: 'Beat. JUDGE #2: "I reject the—" Exactly four seconds. The room stirs.',
      dialogue: [{ speaker: 'JUDGE', text: 'I reject the—' }],
      sfxDescription:
        'Timer hitting zero with confirmation tone, crowd stirring, shocked murmurs beginning, chairs shifting',
      musicMood: 'First confirmation hit, bass impact, reality bending, proof one of three',
      hasFaces: true,
    },
    {
      id: 'S43',
      title: 'Prediction Lands — The Water',
      plot: 'Judge #1 reaches for water. Six seconds. The timing is uncanny. Murmurs spread through the crowd.',
      dialogue: [],
      sfxDescription:
        'Water bottle grabbed with plastic crinkle, second confirmation tone, crowd murmurs growing louder, disbelief spreading',
      musicMood: 'Second confirmation, deeper impact, growing wonder, the impossible continuing',
      hasFaces: true,
    },

    // ── THE ROOM BREAKS (44-50) ──
    {
      id: 'S44',
      title: 'Prediction Lands — The Phone',
      plot: 'Phone rings in back. Man exits. Eight seconds. The room goes dead silent. HOST: "What the hell?"',
      dialogue: [{ speaker: 'HOST', text: 'What the hell?' }],
      sfxDescription:
        'Phone ringing in distance, chair scraping back, door opening and closing, third confirmation tone, absolute dead silence, then whispered "what the hell" into hot mic',
      musicMood:
        'Third confirmation — complete silence as music, then the world shifts, bass drop of realization',
      hasFaces: false,
    },
    {
      id: 'S45',
      title: 'Audience Reaction — Shock',
      plot: 'Close-ups of faces in the crowd. Investors. Developers. Judges. Everyone recalculating what they just saw.',
      dialogue: [],
      sfxDescription:
        'Individual shocked breaths, phone lowering to lap, water bottle being stared at, pen dropping, stunned silence with micro-sounds',
      musicMood:
        'Aftermath shimmer, crystalline high notes, each face a different frequency of shock',
      hasFaces: true,
    },
    {
      id: 'S46',
      title: '"Now let\'s make it useful"',
      plot: 'Eli: "Now let\'s make it useful." He switches views. GHOSTLATTICE simulates the warehouse power grid, crowd motion, network congestion.',
      dialogue: [{ speaker: 'ELI', text: "Now let's make it useful." }],
      sfxDescription:
        'Screen switching with data cascade, power grid visualization humming, crowd motion vectors swooshing, network data flowing',
      musicMood:
        'Offense mode engaged, driving beat activates, from defense to demonstration, power groove',
      hasFaces: true,
    },
    {
      id: 'S47',
      title: 'Livestream Save',
      plot: '"Your livestream is about to crash because three overloaded access points are about to fail in sequence." He taps twice. Reroutes traffic. "Fixed."',
      dialogue: [
        {
          speaker: 'ELI',
          text: 'Your livestream is about to crash because three overloaded access points are about to fail in sequence.',
        },
        { speaker: 'ELI', text: 'Fixed.' },
      ],
      sfxDescription:
        'Warning alarms for network failure, two keyboard taps, rerouting data whoosh, stream stabilization chime, audience checking phones',
      musicMood: 'Problem-solve groove, fast electronic sequence, casual mastery beat',
      hasFaces: true,
    },
    {
      id: 'S48',
      title: 'Drone Wobble',
      plot: '"Your drone camera loses stabilization in twenty-one seconds." He points to the ceiling. A camera drone wobbles dangerously.',
      dialogue: [
        {
          speaker: 'ELI',
          text: 'Your drone camera loses stabilization in twenty-one seconds.',
        },
      ],
      sfxDescription:
        'Drone motor stuttering, mechanical wobble sound, crowd ducking and gasping, drone tilting with servo whine',
      musicMood: 'Danger alert, mechanical tension, things going wrong on cue',
      hasFaces: true,
    },
    {
      id: 'S49',
      title: "Maya's Patch — The Save",
      plot: 'Maya calmly uploads a patch from the audience. The drone stabilizes instantly. Teamwork without words.',
      dialogue: [],
      sfxDescription:
        'Smart glasses double-tap, upload confirmation beep, drone motors evening out to smooth hum, crowd exhale of relief',
      musicMood: "Maya's precision theme, clean electronic fix, partnership callback",
      hasFaces: true,
    },
    {
      id: 'S50',
      title: 'The Declaration',
      plot: '"GhostLattice doesn\'t just predict failure. It lets you build before failure arrives." The room is silent. Then erupts.',
      dialogue: [
        {
          speaker: 'ELI',
          text: "GhostLattice doesn't just predict failure. It lets you build before failure arrives.",
        },
      ],
      sfxDescription:
        'One beat of perfect silence, then explosion of crowd erupting — standing ovation, cheering, phone cameras clicking rapidly, chairs scraping back as people stand',
      musicMood:
        'The climax — silence then full orchestral-electronic explosion, triumph over doubt, vindication anthem',
      hasFaces: true,
    },

    // ── AFTERMATH (51-55) ──
    {
      id: 'S51',
      title: 'Phones Up — The Frenzy',
      plot: 'People start filming. The room goes from polite hackathon to viral moment. Phones everywhere. Camera flashes.',
      dialogue: [],
      sfxDescription:
        'Hundreds of phone cameras clicking, crowd shouting, camera flashes popping, viral energy, social media notification sounds',
      musicMood: 'Viral moment soundtrack, euphoric electronic, the crowd becomes the instrument',
      hasFaces: true,
    },
    {
      id: 'S52',
      title: 'Celeste Smiles',
      plot: 'Up on the mezzanine, Celeste smiles for the first time. Not surprise. Confirmation.',
      dialogue: [],
      sfxDescription:
        'Crowd noise below muffled from above, jewelry catching light with subtle chime, quiet satisfaction breath',
      musicMood:
        'Predator confirmation, cold elegant theme returns, the smile has its own frequency',
      hasFaces: true,
    },
    {
      id: 'S53',
      title: 'Dev in the Crowd — Pride',
      plot: 'Dev in the audience, grinning huge, filming on his phone. "That\'s my boy!" He always knew.',
      dialogue: [{ speaker: 'DEV', text: "That's my boy!" }],
      sfxDescription:
        'Dev shouting through crowd noise, phone held up recording, jumping and landing, crowd energy surrounding',
      musicMood: 'Pride and joy, warm bass groove, friendship payoff, pure celebration',
      hasFaces: true,
    },
    {
      id: 'S54',
      title: 'Maya Watches — Quiet Satisfaction',
      plot: "Maya stands at the edge, arms crossed. She doesn't film. She doesn't cheer. She nods once. It's enough.",
      dialogue: [],
      sfxDescription:
        'Crowd noise at edge of perception, single quiet nod sound, arms crossing leather jacket, stillness amidst chaos',
      musicMood:
        "Maya's quiet power theme, single held note amidst the storm, the builder's satisfaction",
      hasFaces: true,
    },
    {
      id: 'S55',
      title: 'Eli on Stage — Alone in the Noise',
      plot: "Eli stands on stage, phones pointed at him, but he's looking past the crowd. Looking at something none of them can see yet.",
      dialogue: [],
      sfxDescription:
        'Camera flashes becoming distant, crowd fading to background, internal focus sound, heartbeat becoming audible',
      musicMood:
        'Lonely at the top, the visionary looks ahead, beautiful isolation, bittersweet triumph',
      hasFaces: true,
    },

    // ── BACKSTAGE — CELESTE'S APPROACH (56-63) ──
    {
      id: 'S56',
      title: 'Backstage — Dev Sprints In',
      plot: 'BACKSTAGE. Dev sprints through the curtain. "You broke the room." Maya: "Good."',
      dialogue: [
        { speaker: 'DEV', text: 'You broke the room!' },
        { speaker: 'MAYA', text: 'Good.' },
      ],
      sfxDescription:
        'Curtain swooshing open, running footsteps on concrete, arms thrown wide, curtain settling',
      musicMood: 'Backstage energy, warm trio theme, relief and joy and calm coexisting',
      hasFaces: true,
    },
    {
      id: 'S57',
      title: "Dev's Energy — Aftermath",
      plot: "Dev paces, buzzing with energy, replaying highlights. He can't stand still. This is the biggest thing he's ever been close to.",
      dialogue: [],
      sfxDescription:
        'Footsteps pacing back and forth, animated gestures swooshing, energy drink can being waved around, excited breathing',
      musicMood: 'Dev energy theme, bouncy bass, post-victory high, adrenaline groove',
      hasFaces: true,
    },
    {
      id: 'S58',
      title: 'Eli Packs Up — Quiet',
      plot: 'While Dev buzzes, Eli quietly packs his laptop into his backpack. Methodical. Calm. Already past the moment.',
      dialogue: [],
      sfxDescription:
        'Laptop sliding into backpack canvas, zipper pulling closed, backpack straps adjusting, quiet amidst Dev background chatter',
      musicMood: 'Eli introspection, quiet piano over muffled celebration, already thinking ahead',
      hasFaces: true,
    },
    {
      id: 'S59',
      title: 'Celeste Appears',
      plot: 'Celeste appears backstage like she was always there. White suit pristine among cables and equipment. "Eli Reyes."',
      dialogue: [{ speaker: 'CELESTE', text: 'Eli Reyes.' }],
      sfxDescription:
        'Heels on concrete with precise clicks, air charging with tension, cables being stepped over elegantly, silence falling',
      musicMood: 'Predator enters, cold elegance theme, temperature drops, power meeting power',
      hasFaces: true,
    },
    {
      id: 'S60',
      title: '"Depends who\'s asking"',
      plot: '"Eli Reyes." "Depends who\'s asking." First eye contact between Eli and Celeste. Two kinds of power meeting.',
      dialogue: [{ speaker: 'ELI', text: "Depends who's asking." }],
      sfxDescription:
        'Eye contact tension tone, ambient cables humming, two heartbeats in opposition, charged silence',
      musicMood: 'Confrontation duet, two themes colliding, black hoodie versus white suit',
      hasFaces: true,
    },
    {
      id: 'S61',
      title: "Celeste's Pitch",
      plot: '"Celeste Vane. Quarry Ventures. You\'re not raising properly." Maya: "We\'re not raising at all."',
      dialogue: [
        { speaker: 'CELESTE', text: "Celeste Vane. Quarry Ventures. You're not raising properly." },
        { speaker: 'MAYA', text: "We're not raising at all." },
      ],
      sfxDescription:
        'Business card case clicking open, Maya stepping forward protectively, tension between two women sizing each other up',
      musicMood: 'Negotiation chess, two female power themes clashing, measured and sharp',
      hasFaces: true,
    },
    {
      id: 'S62',
      title: '"Apply to E Combonator"',
      plot: '"That can be fixed. You should apply to E Combonator." Eli shrugs. "I\'m building infrastructure, not a pitch deck." Celeste: "In this valley, that\'s the same thing."',
      dialogue: [
        { speaker: 'CELESTE', text: 'You should apply to E Combonator.' },
        { speaker: 'ELI', text: "I'm building infrastructure, not a pitch deck." },
        { speaker: 'CELESTE', text: "In this valley, that's the same thing." },
      ],
      sfxDescription:
        'Shrug sound, casual dismissal, Celeste adjusting her stance slightly, verbal chess moves landing',
      musicMood: 'Push and pull, recruitment dance, respect and hunger intertwined',
      hasFaces: true,
    },
    {
      id: 'S63',
      title: 'The Black Card',
      plot: 'She hands him a black card with a simple embossed letter: E. "You keep winning rooms that don\'t know what you are. Come to one that does."',
      dialogue: [
        {
          speaker: 'CELESTE',
          text: "You keep winning rooms that don't know what you are. Come to one that does.",
        },
      ],
      sfxDescription:
        'Black card sliding across surface, embossed letter catching light with subtle metallic ring, fingers touching card, weight of invitation',
      musicMood: 'The offer, single resonant chord, the card as a turning point, destiny knocking',
      hasFaces: true,
    },

    // ── TRUST & WARNING (64-66) ──
    {
      id: 'S64',
      title: 'Celeste Leaves',
      plot: "She leaves. Unhurried. She already knows he'll come.",
      dialogue: [],
      sfxDescription:
        'Heels clicking away slowly on concrete, white suit fabric rustling, distance growing, door opening and closing',
      musicMood: "Predator departure, confident retreat, she's already won and she knows it",
      hasFaces: false,
    },
    {
      id: 'S65',
      title: "Maya's Warning",
      plot: 'Maya looks at Eli. "I don\'t trust her."',
      dialogue: [{ speaker: 'MAYA', text: "I don't trust her." }],
      sfxDescription:
        'Smart glasses reflecting light, serious exhale, the weight of a warning between people who trust each other',
      musicMood: 'Warning theme, minor key shift, trust and fear, the friend who sees clearly',
      hasFaces: true,
    },
    {
      id: 'S66',
      title: "Dev's Truth",
      plot: '"I do. Which is how you know she\'s dangerous." Dev delivers the truest line of the night disguised as a joke.',
      dialogue: [
        {
          speaker: 'DEV',
          text: "I do. Which is how you know she's dangerous.",
        },
      ],
      sfxDescription:
        'Road case creak as Dev leans back, brief pause before the insight lands, the weight of comedy becoming prophecy',
      musicMood:
        'Truth bomb, comedy turns to wisdom, the jester sees everything, minor key revelation',
      hasFaces: true,
    },

    // ── AWARDS & THE FINAL LINE (67-70) ──
    {
      id: 'S67',
      title: 'Awards Stage — First Place',
      plot: '"And first place goes to… GhostLattice." Crowd cheers, half impressed, half uncomfortable. Eli walks up. Cameras flash.',
      dialogue: [{ speaker: 'HOST', text: 'And first place goes to... GhostLattice!' }],
      sfxDescription:
        'Dramatic pause before announcement, crowd erupting in complicated applause, camera flashes rapid-fire, trophy handling',
      musicMood:
        'Victory march, but uneasy — triumph with an undertow of fear, complicated celebration',
      hasFaces: true,
    },
    {
      id: 'S68',
      title: 'Celeste in the Back — Studying',
      plot: "Eli looks over the crowd and sees Celeste in the back, not clapping — studying him. A predator watching prey that doesn't know it yet.",
      dialogue: [],
      sfxDescription:
        'Crowd noise from stage POV, one figure perfectly still in the noise, camera flash reflecting off white suit, watching tone',
      musicMood: 'Predator POV theme, cold observation from a distance, the hunter is patient',
      hasFaces: true,
    },
    {
      id: 'S69',
      title: '"Shopping for Weapons"',
      plot: '"You all keep calling this a hackathon." He looks at the investors. "But some of you are shopping for weapons." The room goes still.',
      dialogue: [
        {
          speaker: 'ELI',
          text: 'You all keep calling this a hackathon. But some of you are shopping for weapons.',
        },
      ],
      sfxDescription:
        'Microphone catching every word, room going dead silent, phones lowering, uncomfortable shift in chairs, the weight of truth dropping',
      musicMood:
        'The verdict, single bass note, prophet speaks, everything stops, silence as the final instrument',
      hasFaces: true,
    },
    {
      id: 'S70',
      title: "Celeste's Smile — CUT TO BLACK",
      plot: "Cut to Celeste's faint smile. She found something more interesting than a weapon. She found someone who knows what he's carrying. CUT TO BLACK.",
      dialogue: [],
      sfxDescription:
        'One last camera flash, smile sound — the faintest breath of satisfaction, then hard cut to absolute silence, black',
      musicMood:
        'Final note: the smile crystallizes into a single held frequency, then instant silence, hard cut, nothing',
      hasFaces: true,
    },
  ];
}

// ── Music Segments (grouped, not per-scene) ──────────────────────────────

interface MusicSegment {
  id: string;
  scenes: string[]; // Which scenes it covers
  prompt: string;
  durationSec: number;
}

function buildMusicSegments(): MusicSegment[] {
  return [
    {
      id: 'M01_ARRIVAL',
      scenes: ['S01', 'S02', 'S03', 'S04'],
      prompt:
        'Dark atmospheric synthwave, noir tension, heavy rain ambience, low rumbling bass, sparse piano, building electronic pulse. Cinematic score for a rainy night in San Francisco. No vocals.',
      durationSec: 40,
    },
    {
      id: 'M02_HACKATHON',
      scenes: ['S05', 'S06', 'S07', 'S08'],
      prompt:
        'Upbeat tech soundtrack, busy creative energy, lo-fi hip hop beats with electronic production. Late night hackathon coding session ambience. Moderate tempo. No vocals.',
      durationSec: 40,
    },
    {
      id: 'M03_OUTSIDERS',
      scenes: ['S09', 'S10', 'S11', 'S12', 'S13', 'S14'],
      prompt:
        'Mysterious ambient electronic, sparse piano notes with deep reverb, isolated outsider theme. Quiet intensity, data-driven undertone, warm but melancholy. Cinematic character introduction. No vocals.',
      durationSec: 47,
    },
    {
      id: 'M04_DEV_ARRIVES',
      scenes: ['S15', 'S16', 'S17'],
      prompt:
        'Funky bass groove, confident swagger, warm friendship theme. Upbeat character entrance music with personality. Electronic funk with heart. No vocals.',
      durationSec: 30,
    },
    {
      id: 'M05_PREDICTION',
      scenes: ['S18', 'S19', 'S20'],
      prompt:
        'Sci-fi revelation theme, ascending synth sweep, wonder meeting danger. Time-bending bass drop for the moment the impossible becomes real. Cinematic tension building to slow-motion impact. No vocals.',
      durationSec: 30,
    },
    {
      id: 'M06_DISMISSAL',
      scenes: ['S21', 'S22', 'S23', 'S24', 'S25', 'S26', 'S27'],
      prompt:
        'Mixed moods: comic relief beats, technical precision staccato, then cold corporate dismissal followed by righteous frustration and quiet confidence. Emotional journey in electronic score. No vocals.',
      durationSec: 47,
    },
    {
      id: 'M07_CELESTE',
      scenes: ['S28', 'S29', 'S30'],
      prompt:
        'Cold elegant strings over electronic production, predator observation theme. Patient stalking rhythm, silver and ice tones, calculated beauty. Villain introduction score. No vocals.',
      durationSec: 30,
    },
    {
      id: 'M08_DEMO_SETUP',
      scenes: ['S31', 'S32', 'S33', 'S34', 'S35'],
      prompt:
        'Arena anticipation drums fading to corporate presentation music, building boredom and routine. Then sudden shift to warrior meditation, quiet before the storm. Cinematic buildup. No vocals.',
      durationSec: 47,
    },
    {
      id: 'M09_THE_PITCH',
      scenes: ['S36', 'S37', 'S38', 'S39', 'S40'],
      prompt:
        'Lone outsider walks onto stage. Single guitar note, silence pregnant with possibility. Cursor ticking rhythm. Then confrontation bass, defiance, and finally sci-fi activation sequence as systems come online. No vocals.',
      durationSec: 47,
    },
    {
      id: 'M10_PREDICTIONS',
      scenes: ['S41', 'S42', 'S43', 'S44', 'S45'],
      prompt:
        'Countdown clock-tick tension building through three confirmations. Each hit deeper — bass impacts growing. Third prediction triggers dead silence then aftermath shimmer with crystalline high notes. Mind-bending proof. No vocals.',
      durationSec: 47,
    },
    {
      id: 'M11_UTILITY',
      scenes: ['S46', 'S47', 'S48', 'S49', 'S50'],
      prompt:
        'Offense mode driving beat, fast electronic problem-solving sequences. Danger alert for drone wobble, clean fix, then THE CLIMAX — silence followed by full orchestral-electronic explosion, triumph over doubt, vindication anthem. No vocals.',
      durationSec: 47,
    },
    {
      id: 'M12_AFTERMATH',
      scenes: ['S51', 'S52', 'S53', 'S54', 'S55'],
      prompt:
        'Euphoric viral moment soundtrack, crowd energy as instrument. Then predator confirmation cold theme. Pride and warm bass. Quiet nod stillness. Beautiful isolation — lonely triumph, bittersweet. Cinematic aftermath. No vocals.',
      durationSec: 47,
    },
    {
      id: 'M13_BACKSTAGE',
      scenes: ['S56', 'S57', 'S58', 'S59', 'S60', 'S61', 'S62', 'S63'],
      prompt:
        'Warm trio backstage energy shifting to cold elegance when predator enters. Confrontation duet — two power themes clashing, negotiation chess, push-and-pull recruitment dance. Single resonant chord for the black card. No vocals.',
      durationSec: 47,
    },
    {
      id: 'M14_FINALE',
      scenes: ['S64', 'S65', 'S66', 'S67', 'S68', 'S69', 'S70'],
      prompt:
        'Predator departure, warning in minor key, truth bomb revelation. Complicated victory march with undertow of fear. Prophet speaks — single bass note, everything stops. Final held frequency crystallizing into absolute silence. Hard cut to nothing. Cinematic finale. No vocals.',
      durationSec: 47,
    },
  ];
}

// ── FFmpeg Compositing ──────────────────────────────────────────────────

function compositeAudio(opts: {
  videoPath: string;
  dialoguePath?: string;
  sfxPath: string;
  musicPath: string;
  outputPath: string;
}) {
  const inputs: string[] = ['-i', opts.videoPath];
  const filterParts: string[] = [];
  let audioIndex = 1;

  // SFX layer
  inputs.push('-i', opts.sfxPath);
  filterParts.push(`[${audioIndex}:a]volume=0.6[sfx]`);
  audioIndex++;

  // Music layer
  inputs.push('-i', opts.musicPath);
  filterParts.push(`[${audioIndex}:a]volume=0.25[music]`);
  audioIndex++;

  // Dialogue layer (if present)
  if (opts.dialoguePath && fs.existsSync(opts.dialoguePath)) {
    inputs.push('-i', opts.dialoguePath);
    filterParts.push(`[${audioIndex}:a]volume=1.0[dialog]`);
    // Mix all three: dialogue on top, SFX mid, music low
    filterParts.push(
      `[dialog][sfx][music]amix=inputs=3:duration=shortest:dropout_transition=2[mixed]`
    );
  } else {
    // Mix SFX + music only
    filterParts.push(`[sfx][music]amix=inputs=2:duration=shortest:dropout_transition=2[mixed]`);
  }

  const filter = filterParts.join(';');

  const cmd = [
    'ffmpeg',
    '-y',
    ...inputs,
    '-filter_complex',
    filter,
    '-map',
    '0:v',
    '-map',
    '[mixed]',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-shortest',
    opts.outputPath,
  ];

  execSync(
    cmd
      .map((c) => (c.includes(' ') || c.includes(';') || c.includes('[') ? `"${c}"` : c))
      .join(' '),
    {
      stdio: 'pipe',
      timeout: 60_000,
    }
  );
}

// ── On-chain video URL fetcher ──────────────────────────────────────────

const universeAbi = [
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

async function fetchVideoUrlsFromChain(): Promise<Record<string, string>> {
  log('CHAIN', 'Fetching video URLs from on-chain nodes...');
  const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC_URL) });

  const logs = await publicClient.getLogs({
    address: UNIVERSE_ADDR,
    event: universeAbi[1],
    fromBlock: 0n,
    toBlock: 'latest',
  });

  const urlMap: Record<string, string> = {};
  for (const l of logs) {
    const link = (l.args as any).link as string;
    const plot = (l.args as any).plot as string;
    // Match scene ID from plot content
    for (const scene of buildSceneAudio()) {
      if (plot && scene.plot && plot.includes(scene.plot.slice(0, 40))) {
        urlMap[scene.id] = link;
      }
    }
  }
  log('CHAIN', `Found ${Object.keys(urlMap).length} video URLs`);
  return urlMap;
}

// ── Main Pipeline ───────────────────────────────────────────────────────

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('  E COMBONATOR — Audio Pipeline');
  console.log('  Voice + SFX + Music + Lip-Sync');
  console.log('='.repeat(60));

  // Validate env
  if (!ELEVENLABS_API_KEY) throw new Error('ELEVENLABS_API_KEY not set');
  if (!FAL_KEY) throw new Error('FAL_KEY not set');

  // Check ffmpeg
  try {
    execSync('ffmpeg -version', { stdio: 'pipe' });
  } catch {
    throw new Error('ffmpeg not found. Install: sudo apt install ffmpeg');
  }

  // Create output dirs
  ensureDir(OUTPUT_DIR);
  ensureDir(path.join(OUTPUT_DIR, 'dialogue'));
  ensureDir(path.join(OUTPUT_DIR, 'sfx'));
  ensureDir(path.join(OUTPUT_DIR, 'music'));
  ensureDir(path.join(OUTPUT_DIR, 'lipsync'));
  ensureDir(path.join(OUTPUT_DIR, 'videos'));
  ensureDir(path.join(OUTPUT_DIR, 'final'));

  // ── Step 1: Voice Profiles ──
  const voices = await loadOrCreateVoiceProfiles();
  if (Object.keys(voices).length === 0) {
    throw new Error('No voice profiles created. Check ELEVENLABS_API_KEY.');
  }

  // ── Step 2: Build scene audio data ──
  const scenes = buildSceneAudio();
  const filteredScenes = SCENE_FILTER ? scenes.filter((s) => SCENE_FILTER!.has(s.id)) : scenes;
  log('SCENES', `Processing ${filteredScenes.length} scenes`);

  // ── Step 3: Generate music segments ──
  const musicSegments = buildMusicSegments();
  const musicUrlMap: Record<string, string> = {};
  const musicFileMap: Record<string, string> = {};

  for (const seg of musicSegments) {
    const musicFile = path.join(OUTPUT_DIR, 'music', `${seg.id}.mp3`);
    if (fs.existsSync(musicFile)) {
      log('MUSIC', `SKIP ${seg.id} — already exists`);
      musicFileMap[seg.id] = musicFile;
      continue;
    }

    log('MUSIC', `Generating ${seg.id} (${seg.durationSec}s)...`);
    try {
      const musicUrl = await falGenerateMusic(seg.prompt, seg.durationSec);
      if (musicUrl) {
        await downloadFile(musicUrl, musicFile);
        musicFileMap[seg.id] = musicFile;
        musicUrlMap[seg.id] = musicUrl;
        log('MUSIC', `  Done: ${seg.id}`);
      }
    } catch (err: any) {
      log('MUSIC', `  FAILED: ${err.message?.slice(0, 200)}`);
    }
    await sleep(1500);
  }

  // Build scene → music file mapping
  const sceneMusicMap: Record<string, string> = {};
  for (const seg of musicSegments) {
    if (!musicFileMap[seg.id]) continue;
    for (const sceneId of seg.scenes) {
      sceneMusicMap[sceneId] = musicFileMap[seg.id];
    }
  }

  // ── Step 4: Get video URLs ──
  let videoUrls: Record<string, string> = {};
  if (VIDEO_DIR && fs.existsSync(VIDEO_DIR)) {
    // Load from local directory
    const files = fs.readdirSync(VIDEO_DIR).filter((f) => f.endsWith('.mp4'));
    for (const f of files) {
      const match = f.match(/^(S\d+)/);
      if (match) videoUrls[match[1]] = path.join(VIDEO_DIR, f);
    }
    log('VIDEOS', `Loaded ${Object.keys(videoUrls).length} videos from ${VIDEO_DIR}`);
  } else {
    // Fetch from chain
    videoUrls = await fetchVideoUrlsFromChain();
  }

  // ── Step 5: Process each scene ──
  const results: Array<{ id: string; title: string; status: string }> = [];

  for (const scene of filteredScenes) {
    console.log(`\n--- ${scene.id}: ${scene.title} ---`);

    const videoSrc = videoUrls[scene.id];
    if (!videoSrc) {
      log(scene.id, 'SKIP — no video source found');
      results.push({ id: scene.id, title: scene.title, status: 'skipped-no-video' });
      continue;
    }

    try {
      // Download video if it's a URL
      const videoFile = path.join(OUTPUT_DIR, 'videos', `${scene.id}.mp4`);
      if (!fs.existsSync(videoFile)) {
        if (videoSrc.startsWith('http')) {
          log(scene.id, 'Downloading video...');
          await downloadFile(videoSrc, videoFile);
        } else {
          fs.copyFileSync(videoSrc, videoFile);
        }
      }

      // ── Generate dialogue TTS ──
      let dialogueFile: string | undefined;
      if (scene.dialogue.length > 0) {
        dialogueFile = path.join(OUTPUT_DIR, 'dialogue', `${scene.id}.mp3`);
        if (!fs.existsSync(dialogueFile)) {
          log(scene.id, `Generating ${scene.dialogue.length} dialogue line(s)...`);
          const dialogueBuffers: Buffer[] = [];
          for (const line of scene.dialogue) {
            const voice = voices[line.speaker];
            if (!voice) {
              log(scene.id, `  No voice for ${line.speaker}, skipping line`);
              continue;
            }
            const buf = await elevenTTS(line.text, voice.voiceId, {
              stability: voice.stability,
              style: voice.style,
            });
            dialogueBuffers.push(buf);
            // Small gap between lines (200ms of silence)
            dialogueBuffers.push(Buffer.alloc(8820)); // ~200ms at 44100Hz mono
            await sleep(500); // Rate limit
          }
          if (dialogueBuffers.length > 0) {
            fs.writeFileSync(dialogueFile, Buffer.concat(dialogueBuffers));
            log(scene.id, '  Dialogue audio saved');
          }
        } else {
          log(scene.id, 'SKIP dialogue — already exists');
        }
      }

      // ── Generate SFX ──
      const sfxFile = path.join(OUTPUT_DIR, 'sfx', `${scene.id}.mp3`);
      if (!fs.existsSync(sfxFile)) {
        log(scene.id, 'Generating SFX...');
        try {
          const sfxBuf = await elevenSFX(scene.sfxDescription, 10);
          fs.writeFileSync(sfxFile, sfxBuf);
          log(scene.id, '  SFX saved');
        } catch (err: any) {
          log(scene.id, `  SFX FAILED: ${err.message?.slice(0, 200)}`);
          // Create silent placeholder
          fs.writeFileSync(sfxFile, Buffer.alloc(44100 * 2)); // 1s silence
        }
        await sleep(500);
      } else {
        log(scene.id, 'SKIP SFX — already exists');
      }

      // ── Get music file for this scene ──
      const musicFile = sceneMusicMap[scene.id];
      if (!musicFile) {
        log(scene.id, 'No music segment for this scene, skipping composite');
        results.push({ id: scene.id, title: scene.title, status: 'partial-no-music' });
        continue;
      }

      // ── Lip-sync pass (if dialogue + faces + not skipped) ──
      let lipSyncedVideoFile = videoFile;
      if (!SKIP_LIPSYNC && dialogueFile && scene.hasFaces && fs.existsSync(dialogueFile)) {
        const lipsyncFile = path.join(OUTPUT_DIR, 'lipsync', `${scene.id}.mp4`);
        if (!fs.existsSync(lipsyncFile)) {
          log(scene.id, 'Running lip-sync (CV model)...');
          try {
            // Upload video + audio to FAL storage for processing
            const videoFalUrl = await uploadVideoToFalStorage(videoFile);
            const audioFalUrl = await uploadToFalStorage(
              fs.readFileSync(dialogueFile),
              `${scene.id}-dialogue.mp3`
            );
            const syncedUrl = await falLipSync(videoFalUrl, audioFalUrl);
            if (syncedUrl) {
              await downloadFile(syncedUrl, lipsyncFile);
              lipSyncedVideoFile = lipsyncFile;
              log(scene.id, '  Lip-sync complete');
            } else {
              log(scene.id, '  Lip-sync failed, using original video');
            }
          } catch (err: any) {
            log(scene.id, `  Lip-sync error: ${err.message?.slice(0, 200)}`);
          }
        } else {
          lipSyncedVideoFile = lipsyncFile;
          log(scene.id, 'SKIP lip-sync — already exists');
        }
        await sleep(1000);
      }

      // ── Composite final video ──
      const finalFile = path.join(
        OUTPUT_DIR,
        'final',
        `${scene.id}_${scene.title.replace(/[^a-zA-Z0-9]/g, '_')}.mp4`
      );
      if (!fs.existsSync(finalFile)) {
        log(scene.id, 'Compositing final video...');
        try {
          compositeAudio({
            videoPath: lipSyncedVideoFile,
            dialoguePath: dialogueFile,
            sfxPath: sfxFile,
            musicPath: musicFile,
            outputPath: finalFile,
          });
          log(scene.id, '  FINAL COMPOSITE DONE');
          results.push({ id: scene.id, title: scene.title, status: 'complete' });
        } catch (err: any) {
          log(scene.id, `  Composite FAILED: ${err.message?.slice(0, 200)}`);
          results.push({ id: scene.id, title: scene.title, status: 'composite-failed' });
        }
      } else {
        log(scene.id, 'SKIP composite — already exists');
        results.push({ id: scene.id, title: scene.title, status: 'complete' });
      }
    } catch (err: any) {
      log(scene.id, `FAILED: ${err.message?.slice(0, 300)}`);
      results.push({ id: scene.id, title: scene.title, status: 'failed' });
    }

    await sleep(500);
  }

  // ── Summary ──
  console.log('\n' + '='.repeat(60));
  console.log('  E COMBONATOR — Audio Pipeline Complete');
  console.log('='.repeat(60));

  const complete = results.filter((r) => r.status === 'complete').length;
  const failed = results.filter((r) => r.status.includes('fail')).length;
  const skipped = results.filter((r) => r.status.includes('skip')).length;

  console.log(`  Complete: ${complete}/${results.length}`);
  console.log(`  Failed:   ${failed}`);
  console.log(`  Skipped:  ${skipped}`);
  console.log(`  Output:   ${path.resolve(OUTPUT_DIR)}/final/`);
  console.log('');

  for (const r of results) {
    const icon = r.status === 'complete' ? '+' : r.status.includes('fail') ? 'X' : '-';
    console.log(`  [${icon}] ${r.id} | ${r.title.padEnd(40)} | ${r.status}`);
  }

  console.log(`\n  Voice profiles: ${VOICE_PROFILES_FILE}`);
  console.log(`  Music segments: ${Object.keys(musicFileMap).length}/${musicSegments.length}`);
}

main().catch((err) => {
  console.error('PIPELINE FAILED:', err.message);
  process.exit(1);
});
