/**
 * SPACE FLEET — Audio Pipeline
 *
 * Adds voice acting, sound effects, music score, and lip-sync
 * to the generated pilot episode video scenes.
 *
 * Pipeline per scene:
 *   1. Design/reuse character voice profiles (ElevenLabs voice design)
 *   2. Extract dialogue from scene plots → TTS via ElevenLabs
 *   3. Generate ambient SFX per scene (ElevenLabs sound effects)
 *   4. Generate score segments (FAL stable-audio)
 *   5. Run lip-sync on dialogue scenes (FAL lipsync)
 *   6. Composite all layers via FFmpeg
 *
 * Voice profiles are saved to the wiki as entity metadata
 * and to disk for reuse across runs.
 *
 * Usage: pnpm tsx scripts/space-fleet-audio-pipeline.ts
 *
 * Required env:
 *   ELEVENLABS_API_KEY — Voice synthesis + SFX
 *   FAL_KEY            — Music generation + lip-sync
 *   PRIVATE_KEY        — Read on-chain video URLs
 *   SPACE_FLEET_ADDR   — Universe contract address
 *
 * Optional:
 *   SF_VIDEO_DIR       — Local .mp4 dir (skips on-chain fetch)
 *   SF_OUTPUT_DIR      — Output dir (default: ./space-fleet-output)
 *   SF_SKIP_LIPSYNC    — "true" to skip lip-sync pass
 *   SF_SCENES          — Comma-separated scene IDs (e.g. "S06,S11,S17")
 *   VITE_SERVER_URL    — Server URL for wiki entity updates
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import * as fal from '@fal-ai/serverless-client';
import { createPublicClient, http, getAddress } from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { execSync } from 'child_process';

// ── Config ──────────────────────────────────────────────────────────────

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY!;
const FAL_KEY = process.env.FAL_KEY!;
const RPC_URL = process.env.RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com';
const SERVER_URL = process.env.VITE_SERVER_URL ?? 'http://localhost:3000';
const UNIVERSE_ADDR = (process.env.SPACE_FLEET_ADDR ??
  '0x0000000000000000000000000000000000000000') as `0x${string}`;

const rawKey = process.env.PRIVATE_KEY ?? '';
const PRIVATE_KEY = (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as `0x${string}`;
const account = privateKeyToAccount(PRIVATE_KEY);

const OUTPUT_DIR = process.env.SF_OUTPUT_DIR || './space-fleet-output';
const VIDEO_DIR = process.env.SF_VIDEO_DIR || '';
const SKIP_LIPSYNC = process.env.SF_SKIP_LIPSYNC === 'true';
const SCENE_FILTER = process.env.SF_SCENES
  ? new Set(process.env.SF_SCENES.split(',').map((s) => s.trim()))
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

// ── ElevenLabs API ──────────────────────────────────────────────────────

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
  gender: 'male' | 'female';
  age: 'young' | 'middle_aged' | 'old';
  accent: string;
  accentStrength: number;
  previewText: string;
  description: string;
}): Promise<{ voiceId: string }> {
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

// ── FAL API ─────────────────────────────────────────────────────────────

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
    log('LIPSYNC', `Primary failed, trying sadtalker: ${err.message?.slice(0, 100)}`);
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

// ── File helpers ────────────────────────────────────────────────────────

async function downloadFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed ${res.status}: ${url.slice(0, 100)}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
}

async function uploadToFalStorage(buffer: Buffer, filename: string): Promise<string> {
  ensureFalConfigured();
  const blob = new Blob([buffer], { type: 'audio/mpeg' });
  const file = new File([blob], filename, { type: 'audio/mpeg' });
  return await fal.storage.upload(file);
}

async function uploadVideoToFalStorage(filePath: string): Promise<string> {
  ensureFalConfigured();
  const buffer = fs.readFileSync(filePath);
  const blob = new Blob([buffer], { type: 'video/mp4' });
  const file = new File([blob], path.basename(filePath), { type: 'video/mp4' });
  return await fal.storage.upload(file);
}

// ── SIWE Auth (for wiki entity updates) ─────────────────────────────────

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

// ── Voice Profiles ──────────────────────────────────────────────────────

interface VoiceProfile {
  name: string;
  voiceId: string;
  stability: number;
  style: number;
}

const VOICE_PROFILES_FILE = path.join(OUTPUT_DIR, 'voice-profiles.json');

/**
 * Character voice specifications — designed for the paranoid thriller tone.
 * Each character's voice reflects their personality and role in the story.
 */
const CHARACTER_VOICE_SPECS = {
  ELI: {
    name: 'Eli Vance - Space Fleet',
    gender: 'male' as const,
    age: 'young' as const,
    accent: 'american',
    accentStrength: 0.8,
    previewText:
      "Day one in Level 3. Orpheus exists. Halden knows I'm looking. They're not hiding prototypes. This is operational. Industrial scale. Orbital or beyond.",
    description:
      'Young male, 24, intense, quiet, controlled. Speaks with measured calm that barely conceals obsessive drive. Think a young analyst who has trained himself to sound ordinary while his mind races. Low register, slight tension in the voice, rarely raises volume.',
    stability: 0.6,
    style: 0.3,
  },
  MARA: {
    name: 'Mara Chen - Space Fleet',
    gender: 'female' as const,
    age: 'young' as const,
    accent: 'american',
    accentStrength: 0.6,
    previewText:
      "The truth is never hidden. It's buried under seven acceptable lies, and your career depends on repeating the right one at the right time.",
    description:
      'Female, 30s, sharp, knowing, sardonic. Cheerful surface masking deep awareness. Switches between friendly banter and dead-serious whispered warnings. Dry wit. The voice of someone who has seen behind the curtain and learned to laugh about it.',
    stability: 0.55,
    style: 0.4,
  },
  HALDEN: {
    name: 'Director Halden - Space Fleet',
    gender: 'male' as const,
    age: 'middle_aged' as const,
    accent: 'american',
    accentStrength: 0.7,
    previewText:
      'Do you know what happens if the public learns their governments have operated an off-book fleet for decades? Markets collapse. Alliances fracture. Religions split.',
    description:
      'Male, 50s, commanding, calm, measured. The voice of institutional authority — never raises his voice because he never needs to. Every word is deliberate. Think senior intelligence director delivering classified briefings. Slight gravitas, absolute control.',
    stability: 0.7,
    style: 0.5,
  },
  THE_VOICE: {
    name: 'The Voice - Space Fleet',
    gender: 'male' as const,
    age: 'old' as const,
    accent: 'american',
    accentStrength: 0.5,
    previewText:
      "You weren't supposed to stop. If you want the truth, Mr. Vance... stop looking up in places where civilians can see you.",
    description:
      'Older male, calm, authoritative, slightly menacing. Speaks through what sounds like a degraded phone connection. Unhurried. The voice of someone who has access to everything and fears nothing. Low, measured, slightly distorted.',
    stability: 0.75,
    style: 0.3,
  },
  ARCHIVAL: {
    name: 'Archival Narrator - Space Fleet',
    gender: 'male' as const,
    age: 'middle_aged' as const,
    accent: 'american',
    accentStrength: 0.9,
    previewText:
      'There is no evidence of unauthorized orbital infrastructure. Reports of off-book aerospace platforms are speculative and false.',
    description:
      'Official male voice, government spokesperson tone. Clinical, rehearsed, deliberately boring. The voice of institutional denial — designed to make extraordinary lies sound like mundane press releases. Flat, authoritative, slightly processed.',
    stability: 0.8,
    style: 0.1,
  },
  INTERCOM: {
    name: 'Orpheus Intercom - Space Fleet',
    gender: 'female' as const,
    age: 'young' as const,
    accent: 'american',
    accentStrength: 0.9,
    previewText: 'Orpheus transfer team to Launch Spine Two. Welcome to Space Fleet.',
    description:
      'Female intercom voice, clean, professional, military PA system. Clear enunciation, no emotion. The voice that announces impossible things as routine. Think airport announcements but for a secret space program.',
    stability: 0.9,
    style: 0.0,
  },
};

async function loadOrCreateVoiceProfiles(): Promise<Record<string, VoiceProfile>> {
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
      await sleep(1000);
    } catch (err: any) {
      log('VOICES', `  FAILED for ${key}: ${err.message?.slice(0, 200)}`);
    }
  }

  fs.writeFileSync(VOICE_PROFILES_FILE, JSON.stringify(profiles, null, 2));
  log('VOICES', `Saved ${Object.keys(profiles).length} voice profiles`);
  return profiles;
}

/**
 * Save voice profile IDs to wiki entities for persistence + UI display.
 */
async function saveVoiceProfilesToWiki(
  profiles: Record<string, VoiceProfile>,
  token: string
): Promise<void> {
  log('WIKI', 'Saving voice profiles to wiki entities...');

  const entityNameMap: Record<string, string> = {
    ELI: 'Eli Vance',
    MARA: 'Mara Chen',
    HALDEN: 'Director Halden',
    THE_VOICE: 'The Voice',
  };

  // Fetch existing entities to find IDs
  const res = await fetch(
    `${SERVER_URL}/trpc/entities.listByUniverse?batch=1&input=${encodeURIComponent(
      JSON.stringify({ '0': { universeAddress: UNIVERSE_ADDR } })
    )}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const json = (await res.json()) as any[];
  const entities = json[0]?.result?.data || [];

  for (const [key, profile] of Object.entries(profiles)) {
    const entityName = entityNameMap[key];
    if (!entityName) continue;

    const entity = entities.find((e: any) => (e.name || e.data?.name) === entityName);
    if (!entity) {
      log('WIKI', `  Entity "${entityName}" not found, skipping`);
      continue;
    }

    const entityId = entity.id || entity.data?.id;
    try {
      await tRPCMutate(
        'entities.update',
        {
          id: entityId,
          metadata: {
            ...(entity.metadata || entity.data?.metadata || {}),
            voiceId: profile.voiceId,
            voiceName: profile.name,
            voiceStability: String(profile.stability),
            voiceStyle: String(profile.style),
          },
        },
        token
      );
      log('WIKI', `  ${entityName} → voiceId: ${profile.voiceId}`);
    } catch (err: any) {
      log('WIKI', `  Failed to update ${entityName}: ${err.message?.slice(0, 150)}`);
    }
  }
}

// ── Dialogue Extraction ─────────────────────────────────────────────────

interface DialogueLine {
  speaker: string;
  text: string;
}

function extractDialogue(plot: string): DialogueLine[] {
  const lines: DialogueLine[] = [];
  const segments = plot
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const seg of segments) {
    const quoteMatch = seg.match(/["'""]([^"""'']+)["'""]/);
    if (!quoteMatch) continue;
    const text = quoteMatch[1].trim();
    if (text.length < 3) continue;

    const segUpper = seg.toUpperCase();
    let speaker = 'NARRATOR';

    if (segUpper.includes('ELI') || segUpper.includes('VANCE')) {
      speaker = 'ELI';
    } else if (segUpper.includes('MARA') || segUpper.includes('CHEN')) {
      speaker = 'MARA';
    } else if (segUpper.includes('HALDEN') || segUpper.includes('DIRECTOR')) {
      speaker = 'HALDEN';
    } else if (segUpper.includes('VOICE') || segUpper.includes('PHONE')) {
      speaker = 'THE_VOICE';
    } else if (segUpper.includes('ARCHIVAL') || segUpper.includes('V.O')) {
      speaker = 'ARCHIVAL';
    } else if (segUpper.includes('INTERCOM')) {
      speaker = 'INTERCOM';
    }

    if (speaker === 'NARRATOR') continue;
    lines.push({ speaker, text });
  }

  return lines;
}

// ── Scene Audio Definitions ─────────────────────────────────────────────

interface SceneAudio {
  id: string;
  title: string;
  plot: string;
  dialogue: DialogueLine[];
  sfxDescription: string;
  musicMood: string;
  hasFaces: boolean;
}

function buildSceneAudio(): SceneAudio[] {
  return [
    // ── COLD OPEN (S01–S06) ──
    {
      id: 'S01',
      title: 'Black Screen — Archival Audio',
      plot: 'ARCHIVAL: "There is no evidence of unauthorized orbital infrastructure. Reports of off-book aerospace platforms are speculative and false."',
      dialogue: [
        {
          speaker: 'ARCHIVAL',
          text: 'There is no evidence of unauthorized orbital infrastructure. Reports of off-book aerospace platforms are speculative and false.',
        },
      ],
      sfxDescription:
        'Low mechanical hum building slowly, metallic clang impact, deep bass rumble like a massive machine powering up underground',
      musicMood:
        'Dark droning bass, industrial ambient, sub-bass tension, slow building unease, Hans Zimmer-style low brass',
      hasFaces: false,
    },
    {
      id: 'S02',
      title: 'Desert Highway — Wide',
      plot: 'A lonely two-lane road cutting through black desert. A sky crowded with stars. A beat-up sedan races alone.',
      dialogue: [],
      sfxDescription:
        'Desert wind howling softly, distant car engine humming, tires on asphalt, crickets, vast open space ambience',
      musicMood:
        'Sparse piano notes over deep ambient pad, lonely open road feeling, vast emptiness, tension underneath beauty',
      hasFaces: false,
    },
    {
      id: 'S03',
      title: 'Eli in the Car',
      plot: 'Eli drives, alert and tense. He keeps glancing in the rearview mirror.',
      dialogue: [],
      sfxDescription:
        'Car interior ambience — engine rumble, dashboard hum, occasional rearview mirror adjustment creak, leather seat shifting',
      musicMood:
        'Tense minimal strings, paranoid undertone, heartbeat-like pulse, confined space anxiety',
      hasFaces: true,
    },
    {
      id: 'S04',
      title: 'The Launches',
      plot: 'Three streaks of white light rise silently above the mountains — too fast, too vertical. The air shimmers. Stars distort.',
      dialogue: [],
      sfxDescription:
        'Deep whooshing sound rising vertically, air shimmering like heat distortion, electromagnetic hum intensifying, bass pressure wave, stars crackling with energy',
      musicMood:
        'Massive orchestral swell building from silence, choir-like pads rising, awe and terror in equal measure, Interstellar-style organ',
      hasFaces: false,
    },
    {
      id: 'S05',
      title: 'Eli Watches',
      plot: 'Eli stands outside the car staring up. Something MASSIVE moves above — implied only by its effect on the sky.',
      dialogue: [],
      sfxDescription:
        "Vast gravitational hum passing overhead very slowly, air pressure changing, Eli's shallow breathing, desert silence broken by impossible low frequency",
      musicMood:
        'Deep sub-bass drone, cosmic horror ambient, the feeling of something impossibly large passing overhead, reverent terror',
      hasFaces: true,
    },
    {
      id: 'S06',
      title: 'The Phone Call',
      plot: 'Eli\'s phone buzzes. THE_VOICE: "You weren\'t supposed to stop." THE_VOICE: "If you want the truth, Mr. Vance... stop looking up in places where civilians can see you." Distant thunder on a clear sky.',
      dialogue: [
        { speaker: 'THE_VOICE', text: "You weren't supposed to stop." },
        {
          speaker: 'THE_VOICE',
          text: 'If you want the truth, Mr. Vance... stop looking up in places where civilians can see you.',
        },
      ],
      sfxDescription:
        'Phone buzzing vibration, call connect static, degraded phone audio quality, line going dead click, distant thunder rolling across clear sky, desert silence returning',
      musicMood:
        'Paranoid strings staccato, phone call tension, sudden silence after disconnect, thunderous bass hit',
      hasFaces: true,
    },

    // ── ACT ONE — DAC (S07–S17) ──
    {
      id: 'S07',
      title: 'DAC Exterior',
      plot: 'The gray windowless building. Badge scanners. Morning.',
      dialogue: [],
      sfxDescription:
        'Morning birds distant and sparse, security gate buzzing, badge scanner beeps, heavy door mechanisms, institutional HVAC hum',
      musicMood:
        'Cold institutional ambient, fluorescent light hum translated to music, oppressive calm, bureaucratic tension',
      hasFaces: false,
    },
    {
      id: 'S08',
      title: 'Eli Enters',
      plot: 'Eli walks through security. Wall screens show news debunking UFO sightings.',
      dialogue: [],
      sfxDescription:
        'Badge scanner beep, turnstile click, footsteps on government floor tile, muffled TV news audio, fluorescent buzz, distant office chatter',
      musicMood:
        'Institutional ambient with subtle ironic undertone, the mundane soundtrack of organized lying',
      hasFaces: true,
    },
    {
      id: 'S09',
      title: 'Mara Catches Up',
      plot: 'MARA: "You look terrible." MARA: "weather balloons, ion reflections, swamp gas, cosmic dust, whatever lie we\'re using this quarter."',
      dialogue: [
        { speaker: 'MARA', text: 'You look terrible.' },
        {
          speaker: 'MARA',
          text: "Weather balloons, ion reflections, swamp gas, cosmic dust, whatever lie we're using this quarter.",
        },
      ],
      sfxDescription:
        'Footsteps walking together on tile, coffee cup held while walking, government corridor ambience, distant doors closing',
      musicMood: 'Light tension with sardonic edge, walking rhythm, collegial but watchful',
      hasFaces: true,
    },
    {
      id: 'S10',
      title: 'Briefing Room — Halden',
      plot: 'HALDEN: "Your job is not to prove fantasies. Your job is to maintain signal integrity."',
      dialogue: [
        {
          speaker: 'HALDEN',
          text: 'Your job is not to prove fantasies. Your job is to maintain signal integrity. Understood?',
        },
      ],
      sfxDescription:
        "Briefing room ambience — quiet HVAC, tablet styluses tapping, digital map rotating hum, Halden's measured footsteps",
      musicMood:
        'Authoritative low brass, controlled power, the theme of institutional control, measured and precise',
      hasFaces: true,
    },
    {
      id: 'S11',
      title: 'Halden Promotes Eli',
      plot: 'HALDEN: "Mr. Vance. Since you scored unusually high on anomaly pattern recognition, you\'ll assist in the disinformation triage queue." ELI: "Happy to help, sir."',
      dialogue: [
        {
          speaker: 'HALDEN',
          text: "Mr. Vance. Since you scored unusually high on anomaly pattern recognition, you'll assist in the disinformation triage queue.",
        },
        { speaker: 'ELI', text: 'Happy to help, sir.' },
      ],
      sfxDescription:
        'Briefing room silence, several heads turning simultaneously, tablet being set down, tension in the air',
      musicMood: 'Subtle string tension rising, the feeling of being singled out, chess move music',
      hasFaces: true,
    },
    {
      id: 'S12',
      title: 'Halden Warning',
      plot: 'HALDEN: "Do not mistake emotional reaction for analysis." ELI: "Wouldn\'t dream of it."',
      dialogue: [
        {
          speaker: 'HALDEN',
          text: 'You will encounter fabricated imagery. Some of it is persuasive. Do not mistake emotional reaction for analysis.',
        },
        { speaker: 'ELI', text: "Wouldn't dream of it." },
      ],
      sfxDescription: 'Silence. Clock ticking. Two people breathing. The weight of a stare.',
      musicMood:
        'Tense silence with barely audible high string tremolo, a standoff scored as music, psychological warfare',
      hasFaces: true,
    },
    {
      id: 'S13',
      title: 'Triage Office — Evidence',
      plot: 'Dim room. Rows of screens. Eli scrolls through civilian footage tagged with cover explanations.',
      dialogue: [],
      sfxDescription:
        'Multiple screens humming, mouse clicking and scrolling, video playback fragments — shaky footage, pilot whispering, keyboard clicks',
      musicMood:
        'Dark ambient, screen glow translated to sound, data-processing rhythm, paranoid lo-fi',
      hasFaces: true,
    },
    {
      id: 'S14',
      title: 'ACCESS RESTRICTED',
      plot: 'Eli finds the restricted file. Objects leaving orbit, then vanishing. ACCESS DENIED — REFER TO SECTION ORPHEUS.',
      dialogue: [],
      sfxDescription:
        'Mouse double-click, screen error buzz, ACCESS DENIED alarm tone — sharp and official, pen scratching on paper as Eli writes ORPHEUS',
      musicMood:
        "Discovery sting — sharp brass hit then silence, the moment of finding what you've been looking for, tension spike then hush",
      hasFaces: true,
    },
    {
      id: 'S15',
      title: 'Halden Behind Him',
      plot: 'HALDEN: "Finding your footing?" ELI: "Mostly nonsense. Some very committed nonsense." HALDEN: "Ambition is useful here. Curiosity is not the same thing." ELI: "Understood." HALDEN: "Is it?"',
      dialogue: [
        { speaker: 'HALDEN', text: 'Finding your footing?' },
        { speaker: 'ELI', text: 'Yes, sir. Mostly nonsense. Some very committed nonsense.' },
        {
          speaker: 'HALDEN',
          text: 'Ambition is useful here. Curiosity is not the same thing.',
        },
        { speaker: 'ELI', text: 'Understood.' },
        { speaker: 'HALDEN', text: 'Is it?' },
      ],
      sfxDescription:
        'Footsteps approaching from behind, screen hastily minimized click, breathing held then released, footsteps departing',
      musicMood:
        "Predator-and-prey tension, Halden's theme — controlled menace, psychological pressure scored as low cello",
      hasFaces: true,
    },
    {
      id: 'S16',
      title: 'Halden Smile',
      plot: 'Halden gives the faintest smile and walks away. Eli exhales.',
      dialogue: [],
      sfxDescription:
        "Footsteps receding on tile floor, Eli's exhale — tension releasing, chair creaking as he slumps slightly",
      musicMood: 'Tension release, brief respite theme, the relief of not being caught — yet',
      hasFaces: true,
    },
    {
      id: 'S17',
      title: 'Eli Writes ORPHEUS',
      plot: 'Eli writes the word ORPHEUS in his notebook. Underlines it twice.',
      dialogue: [],
      sfxDescription:
        'Pen on paper — deliberate careful strokes, two firm underline scratches, notebook page turning slightly',
      musicMood:
        "Eli's investigation theme — quiet determination piano, building purpose, the name of the conspiracy made real",
      hasFaces: false,
    },

    // ── ACT TWO — Mara & Apartment (S18–S25) ──
    {
      id: 'S18',
      title: 'Cafeteria',
      plot: 'MARA: "You got Halden\'s attention. Congratulations or condolences, not sure which."',
      dialogue: [
        {
          speaker: 'MARA',
          text: "You got Halden's attention. Congratulations or condolences, not sure which.",
        },
      ],
      sfxDescription:
        'Government cafeteria ambience — fluorescent hum, distant cutlery, vending machine, tray set down, minimal chatter',
      musicMood: 'Sardonic light tension, cafeteria mundanity vs dangerous subtext',
      hasFaces: true,
    },
    {
      id: 'S19',
      title: '"What\'s Orpheus?"',
      plot: 'ELI: "What\'s Orpheus?" Mara stops chewing. MARA: "That was fast." ELI: "So it\'s real." MARA: "I didn\'t say that." ELI: "You reacted."',
      dialogue: [
        { speaker: 'ELI', text: "What's Orpheus?" },
        { speaker: 'MARA', text: 'That was fast.' },
        { speaker: 'ELI', text: "So it's real." },
        { speaker: 'MARA', text: "I didn't say that." },
        { speaker: 'ELI', text: 'You reacted.' },
      ],
      sfxDescription:
        'Chewing stops abruptly, fork set down on tray, silence between two people, fluorescent buzz becomes prominent',
      musicMood:
        'Sharp tension spike on "Orpheus," rapid verbal sparring scored as staccato strings, cat-and-mouse energy',
      hasFaces: true,
    },
    {
      id: 'S20',
      title: "Mara's Warning",
      plot: 'MARA: "The truth is never hidden. It\'s buried under seven acceptable lies, and your career depends on repeating the right one at the right time." MARA: "Play dumb better."',
      dialogue: [
        {
          speaker: 'MARA',
          text: "Here's free advice. In this building, the truth is never hidden. It's buried under seven acceptable lies, and your career depends on repeating the right one at the right time.",
        },
        { speaker: 'MARA', text: 'Play dumb better.' },
      ],
      sfxDescription:
        'Chair pushing back on floor, Mara standing up, footsteps walking away, cafeteria door closing softly',
      musicMood:
        "Mara's theme — knowing, sardonic, warm underneath the warning. Viola melody over sparse piano.",
      hasFaces: true,
    },
    {
      id: 'S21',
      title: 'Investigation Wall',
      plot: "Eli's apartment. One wall covered in launch windows, defense budgets, redacted memos. Center: IF THEY'RE LYING ABOUT THE TECHNOLOGY, WHAT ELSE ARE THEY LYING ABOUT?",
      dialogue: [],
      sfxDescription:
        'Apartment quiet — clock ticking, paper rustling, pin being pressed into corkboard, red string being pulled taut, laptop fan whirring',
      musicMood:
        'Investigation theme — obsessive piano pattern, building layers of connection, conspiracy unraveling in real time',
      hasFaces: false,
    },
    {
      id: 'S22',
      title: 'Video Log',
      plot: 'ELI: "Day one in Level 3. Orpheus exists. Halden knows I\'m looking. Mara knows more than she should. They\'re not hiding prototypes. This is operational. Industrial scale. Orbital or beyond."',
      dialogue: [
        {
          speaker: 'ELI',
          text: "Day one in Level 3. Orpheus exists. Halden knows I'm looking. Mara knows more than she should.",
        },
        {
          speaker: 'ELI',
          text: "They're not hiding prototypes. Prototypes don't get this much narrative management. This is operational. Industrial scale. Orbital or beyond.",
        },
      ],
      sfxDescription:
        "Laptop webcam click recording, quiet apartment, Eli's voice close and intimate, laptop fan, distant street sounds",
      musicMood:
        "Intimate confessional, close-mic feeling, Eli's purpose crystallizing, sparse piano becoming determined",
      hasFaces: true,
    },
    {
      id: 'S23',
      title: 'Black SUV',
      plot: 'A light flashes outside. A black SUV with no plates idles across the street. Eli freezes. The SUV drives away.',
      dialogue: [],
      sfxDescription:
        "Headlight flash through window, car idling engine — low and menacing, Eli's breath catching, car pulling away slowly, silence returning",
      musicMood:
        'Surveillance dread, low bass pulse like a heartbeat, paranoia made audible, sudden silence when the SUV leaves',
      hasFaces: true,
    },
    {
      id: 'S24',
      title: 'The Message',
      plot: 'Laptop flickers. Text types itself: YOU WANT TO EXPOSE THE SECRET. FIRST SURVIVE IT. Screen goes black.',
      dialogue: [],
      sfxDescription:
        'Screen flickering electronic glitch, keyboard clacking by itself — each letter a sharp click, screen powering down whine, total silence',
      musicMood:
        'Digital horror sting, glitch-art music, each letter a note in a threatening melody, then absolute void silence',
      hasFaces: false,
    },
    {
      id: 'S25',
      title: "Eli's Reaction",
      plot: 'Eli stares at the dead screen. Investigation wall behind him. Surveillance in front. Trapped between obsession and threat.',
      dialogue: [],
      sfxDescription:
        "Dead screen silence, clock ticking loudly in empty apartment, Eli's breathing steadying, pen picked up — he starts writing again",
      musicMood:
        "Resolve theme — after the fear, determination. Eli's piano motif returns, stronger. He won't stop.",
      hasFaces: true,
    },

    // ── ACT THREE — The Revelation (S26–S40) ──
    {
      id: 'S26',
      title: 'New Badge',
      plot: 'Eli receives a new badge: ACCESS ELEVATED: TEMPORARY ASSIGNMENT.',
      dialogue: [],
      sfxDescription:
        "Badge scanner beep, new badge sliding across counter, Eli's fingers picking it up, security turnstile click",
      musicMood: 'Transition escalation, ascending tones, something shifting, opportunity or trap',
      hasFaces: true,
    },
    {
      id: 'S27',
      title: 'Elevator Descent',
      plot: 'Eli rides the elevator below listed floors. B4. B5. Then no numbers. The hum deepens.',
      dialogue: [],
      sfxDescription:
        'Elevator mechanical hum deepening, floor indicator clicking then going silent, air pressure changing, descent into the deep',
      musicMood:
        'Descending bass notes, each floor lower pitched, the crossing of a threshold, tonal gravity pulling down',
      hasFaces: true,
    },
    {
      id: 'S28',
      title: 'Black Corridor',
      plot: 'Polished black corridor. AEROSPACE LOGISTICS COMMAND — AUTHORIZED PERSONNEL ONLY.',
      dialogue: [],
      sfxDescription:
        'Elevator doors opening to silence, footsteps on polished floor — each step echoing, recessed lighting hum, the architecture of secrets',
      musicMood:
        'Sublevel theme — sleek, dark, expensive. Low synth pad with precision percussion. The soundtrack of black budgets.',
      hasFaces: false,
    },
    {
      id: 'S29',
      title: 'Halden Waits',
      plot: 'HALDEN: "Walk with me."',
      dialogue: [{ speaker: 'HALDEN', text: 'Walk with me.' }],
      sfxDescription:
        'Single commanding voice in vast corridor, two sets of footsteps beginning to walk, the corridor breathing',
      musicMood:
        "Halden's authority theme, two figures walking into the unknown, measured and inevitable",
      hasFaces: true,
    },
    {
      id: 'S30',
      title: 'Telemetry Through Glass',
      plot: 'Behind reinforced glass, technicians monitor orbital plots, lunar arcs, fleet readiness. Not satellites. Ships.',
      dialogue: [],
      sfxDescription:
        'Muffled command center chatter through glass, holographic display hum, telemetry data beeps, fleet status pings',
      musicMood:
        'Revelation building — orchestral tension rising, the scale of the secret becoming clear, wonder mixed with dread',
      hasFaces: false,
    },
    {
      id: 'S31',
      title: 'Observation Window',
      plot: 'They stop at the observation window. The vast underground hangar opens up beyond.',
      dialogue: [],
      sfxDescription:
        'Footsteps stopping, the sudden acoustic expansion of a massive space, vast hangar reverb, distant mechanical operations',
      musicMood:
        'Scale shift — intimate corridor music exploding into cathedral-scale orchestration, the reveal before the reveal',
      hasFaces: false,
    },
    {
      id: 'S32',
      title: 'The Ship',
      plot: "A matte-black warship the size of a destroyer, suspended in a magnetic cradle. Angular. Elegant. Impossible. Eli's breath catches.",
      dialogue: [],
      sfxDescription:
        "Magnetic cradle deep electromagnetic hum, energy conduits pulsing rhythmically, distant service crew sounds, the ship breathing with power, Eli's sharp intake of breath",
      musicMood:
        'THE REVELATION — massive orchestral hit then sustained awe. Full orchestra, choir, the biggest musical moment in the episode. Awe, terror, vindication. The truth is real.',
      hasFaces: true,
    },
    {
      id: 'S33',
      title: "Halden's Speech",
      plot: 'HALDEN: "The stories are pathetic fragments of reality. We permit that because nonsense protects the truth." ELI: "What is this?" HALDEN: "Continuity of civilization."',
      dialogue: [
        {
          speaker: 'HALDEN',
          text: 'You wanted to know whether the stories were real. The stories are pathetic fragments of reality. People see pieces, shadows, distortions. Then they invent nonsense around the edges. We permit that. Because nonsense protects the truth.',
        },
        { speaker: 'ELI', text: 'What is this?' },
        { speaker: 'HALDEN', text: 'Continuity of civilization.' },
      ],
      sfxDescription:
        "Hangar ambient — the warship's magnetic field humming, Halden's voice carrying across the observation space, Eli's stunned silence",
      musicMood:
        "Philosophical villain theme — Halden is reasonable and that's what makes him terrifying. Low strings, controlled, rational beauty hiding institutional violence.",
      hasFaces: true,
    },
    {
      id: 'S34',
      title: "Halden's Choice",
      plot: 'HALDEN: "Markets collapse. Alliances fracture. Religions split. Every population asks: if you hid this, what else did you hide?" HALDEN: "You can shout from outside the wall... or come inside and see why the wall exists."',
      dialogue: [
        {
          speaker: 'HALDEN',
          text: 'Do you know what happens if the public learns their governments have operated an off-book fleet for decades? Markets collapse. Alliances fracture. Religions split. Every population on Earth asks the same question: if you hid this, what else did you hide?',
        },
        {
          speaker: 'HALDEN',
          text: 'You can spend your life shouting from outside the wall... or you can come inside and see why the wall exists.',
        },
      ],
      sfxDescription:
        'The weight of an ultimatum in a quiet room, hangar systems humming behind glass, the universe holding its breath',
      musicMood:
        'The choice theme — two possible futures in one moment, tension at its absolute peak, the music holds a single note',
      hasFaces: true,
    },
    {
      id: 'S35',
      title: 'Eli Accepts',
      plot: 'ELI: "What do you need from me?" HALDEN: "Loyalty. Competence. Silence." ELI: "You\'ll have all three, sir." A lie.',
      dialogue: [
        { speaker: 'ELI', text: 'What do you need from me?' },
        { speaker: 'HALDEN', text: 'Loyalty. Competence. Silence.' },
        { speaker: 'ELI', text: "You'll have all three, sir." },
      ],
      sfxDescription:
        "Silence before the answer, Eli's steady voice — controlled, convincing, false. The sound of a lie that sounds like truth.",
      musicMood:
        "Resolution with hidden dissonance — the music resolves to a major chord but one note is wrong. Eli's deception has a theme.",
      hasFaces: true,
    },
    {
      id: 'S36',
      title: 'The Tablet',
      plot: 'Halden hands Eli a tablet: PROJECT ORPHEUS — STRATEGIC FLEET READINESS / CIVILIAN DISCLOSURE RISK MATRIX.',
      dialogue: [],
      sfxDescription:
        'Tablet passed between hands, screen activating with classification beep, pages of impossible truth scrolling',
      musicMood:
        'Sacred object theme — the tablet is a Rosetta Stone. Reverent, trembling strings. The truth in physical form.',
      hasFaces: false,
    },
    {
      id: 'S37',
      title: 'Locker Room — Briefing Pages',
      plot: 'Eli in dark uniform. Reads the tablet: orbital shipyards, lunar extraction, fleet groups.',
      dialogue: [],
      sfxDescription:
        'Locker room echo, uniform fabric rustling, tablet scrolling through pages, each revelation a quiet electronic ping',
      musicMood:
        'Data cascade theme — information overload scored as layered arpeggios building in complexity, the scope expanding with each page',
      hasFaces: true,
    },
    {
      id: 'S38',
      title: 'NON-HUMAN SIGNAL',
      plot: "One line: NON-HUMAN SIGNAL EVENT / OUTER PERIMETER / ACTIVE. Eli's eyes widen.",
      dialogue: [],
      sfxDescription:
        "Scrolling stops. A low frequency rumble builds. Eli's breathing changes — sharper, faster. The hum of something alien in the data.",
      musicMood:
        'COSMIC HORROR STING — the score goes from conspiracy thriller to something much larger. Deep brass, dissonant choir, the universe is not empty. Second biggest musical moment.',
      hasFaces: true,
    },
    {
      id: 'S39',
      title: 'Mara in Doorway',
      plot: 'MARA: "Everyone worth promoting is." MARA: "If you\'re here to leak this, you\'re already dead. If you\'re here to understand it, you might last long enough to matter."',
      dialogue: [
        { speaker: 'ELI', text: "You're part of this." },
        { speaker: 'MARA', text: 'Everyone worth promoting is.' },
        {
          speaker: 'MARA',
          text: "If you're here to leak this, you're already dead. If you're here to understand it, you might last long enough to matter.",
        },
      ],
      sfxDescription:
        'Doorway acoustics — her voice carries differently in the corridor behind her. Two people in identical uniforms having the most important conversation of their lives.',
      musicMood:
        "Mara's theme returns — knowing, serious, an ally revealed. Viola and piano, the partnership of two people who might save or destroy each other.",
      hasFaces: true,
    },
    {
      id: 'S40',
      title: "Mara's Final Warning",
      plot: 'INTERCOM: "Orpheus transfer team to Launch Spine Two." MARA: "If you ever do leak it... make sure the world gets proof, not a story. They\'ve trained people to laugh at stories."',
      dialogue: [
        {
          speaker: 'INTERCOM',
          text: 'Orpheus transfer team to Launch Spine Two.',
        },
        {
          speaker: 'MARA',
          text: "One more thing. If you ever do leak it... make sure the world gets proof, not a story. They've trained people to laugh at stories.",
        },
      ],
      sfxDescription:
        "Amber alarm pulse — soft rhythmic light and tone, intercom voice echoing through corridors, Mara's footsteps walking away, alarm continuing",
      musicMood:
        'Departure theme — Mara leaving with the most important advice in the show. Her theme fading into the alarm rhythm, transition to the finale.',
      hasFaces: true,
    },

    // ── FINAL SEQUENCE — Launch Spine (S41–S45) ──
    {
      id: 'S41',
      title: 'The Data Wafer',
      plot: 'Eli slips a tiny data wafer from his sleeve. Palms it. Game on.',
      dialogue: [],
      sfxDescription:
        'Fabric sleeve rustling, tiny metallic click of the wafer, fist clenching, the sound of commitment — a quiet physical act that changes everything',
      musicMood:
        "Spy theme begins — Eli's purpose crystallized into action. Sharp, precise, dangerous. The double agent is born.",
      hasFaces: true,
    },
    {
      id: 'S42',
      title: 'Launch Spine Chamber',
      plot: 'A towering vertical chamber. The ship is sealed, fueled, alive. Eli stands with silent personnel.',
      dialogue: [],
      sfxDescription:
        'Massive chamber acoustics — impossible reverb, energy conduits pulsing through walls, the ship humming with contained power, boots on metal grating, awe in the air',
      musicMood:
        'Cathedral of technology — full orchestral swell building slowly, the scale of the chamber reflected in the scale of the music, reverent and terrifying',
      hasFaces: false,
    },
    {
      id: 'S43',
      title: 'Blast Doors — Ship Rises',
      plot: 'Massive blast doors part overhead. A shaft through mountain rock to the stars. The ship rises soundlessly. Sunlight pours down like revelation.',
      dialogue: [],
      sfxDescription:
        'MASSIVE hydraulic blast doors grinding open — deepest mechanical sound, shaft revealed — wind rushing down, the ship rising — electromagnetic ascent hum, sunlight impact — golden warmth descending, the absence of engine roar making the silence deafening',
      musicMood:
        'THE ASCENSION — the single most epic musical moment. Full orchestra, brass fanfare, choir ascending with the ship. Sunlight translated into golden major chords pouring down. Transcendent. The pinnacle of awe.',
      hasFaces: false,
    },
    {
      id: 'S44',
      title: 'Fleet Status — Cover Story',
      plot: 'Screen: FLEET MOVEMENT CONFIRMED — OUTER PERIMETER COMMAND. Below: COVER STORY: METEOROLOGICAL TEST FAILURE. Eli almost laughs. No one else finds it funny.',
      dialogue: [],
      sfxDescription:
        "Status screen updating — electronic text rendering, a small bitter exhale from Eli that could be a laugh, the silence of people who don't see the joke",
      musicMood:
        'Dark ironic theme — the absurdity of "meteorological test failure" scored with a bitter musical wink. Brief, sardonic, then back to gravity.',
      hasFaces: true,
    },
    {
      id: 'S45',
      title: 'Ship Vanishes — End',
      plot: 'The ship vanishes in white light. ELI: "They were never hiding scraps. They were hiding a civilization. And now I\'m inside it." INTERCOM: "Welcome to Space Fleet."',
      dialogue: [
        {
          speaker: 'ELI',
          text: "They were never hiding scraps. They were hiding a civilization. And now I'm inside it.",
        },
        { speaker: 'INTERCOM', text: 'Welcome to Space Fleet.' },
      ],
      sfxDescription:
        'Ship accelerating upward — white light explosion, energy bloom washing over the chamber, total brilliant silence after the light, then the intercom — cold, professional, final',
      musicMood:
        "FINALE — the ship vanishes into light and so does the music, leaving only Eli's voiceover in near-silence. Then the intercom line drops into black. One final low note. End credits music: the Space Fleet main theme — paranoid thriller meets cosmic wonder.",
      hasFaces: true,
    },
  ];
}

// ── Music Segments (shared across multiple scenes) ──────────────────────

interface MusicSegment {
  id: string;
  prompt: string;
  durationSec: number;
  scenes: string[];
}

function buildMusicSegments(): MusicSegment[] {
  return [
    {
      id: 'M01-cold-open',
      prompt:
        'Dark cinematic ambient music, deep sub-bass drone, industrial mechanical hum building to tension, paranoid thriller tone, sparse piano notes over vast emptiness, desert night atmosphere. No vocals. Film score.',
      durationSec: 60,
      scenes: ['S01', 'S02', 'S03'],
    },
    {
      id: 'M02-desert-launches',
      prompt:
        'Massive orchestral swell building from silence, cosmic awe mixed with terror, deep brass and strings ascending, choir-like pads rising, Interstellar-style organ, the feeling of witnessing something impossibly large and hidden. No vocals. Cinematic score.',
      durationSec: 40,
      scenes: ['S04', 'S05', 'S06'],
    },
    {
      id: 'M03-dac-morning',
      prompt:
        'Cold institutional ambient music, fluorescent-light-hum translated to sound, bureaucratic tension, muted government gray as a feeling, slight ironic undertone. Subtle piano and synth pad. No vocals. Thriller score.',
      durationSec: 60,
      scenes: ['S07', 'S08', 'S09'],
    },
    {
      id: 'M04-briefing',
      prompt:
        'Authoritative low brass, controlled institutional power, chess-move tension, measured and precise orchestral thriller music, the sound of someone being tested without knowing it. No vocals. Film score.',
      durationSec: 50,
      scenes: ['S10', 'S11', 'S12'],
    },
    {
      id: 'M05-triage',
      prompt:
        'Dark paranoid ambient, screen-glow atmosphere, data-processing rhythm, lo-fi surveillance tension building to a sharp discovery sting, then hushed silence. Conspiracy thriller music. No vocals.',
      durationSec: 50,
      scenes: ['S13', 'S14', 'S15', 'S16', 'S17'],
    },
    {
      id: 'M06-cafeteria',
      prompt:
        'Cat-and-mouse verbal sparring music, staccato strings, sardonic wit as a musical quality, rapid dialogue tension building to a pointed warning. Thriller score with warm undertone. No vocals.',
      durationSec: 40,
      scenes: ['S18', 'S19', 'S20'],
    },
    {
      id: 'M07-apartment',
      prompt:
        'Obsessive investigation theme, repetitive piano pattern building layers, conspiracy unraveling, paranoid surveillance dread, digital horror moment, then quiet resolve. Night apartment atmosphere. No vocals.',
      durationSec: 50,
      scenes: ['S21', 'S22', 'S23', 'S24', 'S25'],
    },
    {
      id: 'M08-descent',
      prompt:
        'Descending tonal gravity, bass notes dropping pitch with each beat, crossing a threshold into the unknown, sleek dark expensive synth pad, black corridor architecture as sound. No vocals. Cinematic score.',
      durationSec: 40,
      scenes: ['S26', 'S27', 'S28', 'S29'],
    },
    {
      id: 'M09-revelation',
      prompt:
        'Building orchestral revelation, intimate corridor music exploding into cathedral-scale grandeur, massive full-orchestra hit for the warship reveal, awe and terror and vindication, the biggest moment in the score. Cinematic epic orchestral. No vocals.',
      durationSec: 50,
      scenes: ['S30', 'S31', 'S32'],
    },
    {
      id: 'M10-halden-speech',
      prompt:
        'Philosophical villain theme, reasonable tyranny scored as beautiful controlled strings, the seduction of secrecy as a necessary evil, low cello and piano, psychological thriller tension at its peak. No vocals. Film score.',
      durationSec: 50,
      scenes: ['S33', 'S34', 'S35', 'S36'],
    },
    {
      id: 'M11-orpheus-data',
      prompt:
        'Data cascade arpeggios building in complexity, conspiracy thriller transitioning to cosmic horror, deep brass and dissonant choir for the non-human signal reveal, spy theme emerging for the data wafer moment. No vocals. Score.',
      durationSec: 50,
      scenes: ['S37', 'S38', 'S39', 'S40', 'S41'],
    },
    {
      id: 'M12-launch-finale',
      prompt:
        'The most epic cinematic moment — massive cathedral-scale orchestral music building to a transcendent brass and choir climax as a warship ascends through a mountain shaft into sunlight. Golden major chords, ascending strings, the triumph of hidden power, then bitter dark irony, then white-light vanishing into silence. Finale energy. No vocals.',
      durationSec: 50,
      scenes: ['S42', 'S43', 'S44', 'S45'],
    },
  ];
}

// ── FFmpeg Composite ────────────────────────────────────────────────────

function compositeAudio(opts: {
  videoPath: string;
  dialoguePath?: string;
  sfxPath: string;
  musicPath: string;
  outputPath: string;
}) {
  const inputs: string[] = ['-i', opts.videoPath, '-i', opts.sfxPath, '-i', opts.musicPath];
  let filterParts: string[] = [];
  let mixInputs = '';

  // SFX at 70% volume, music at 40%
  filterParts.push('[1:a]volume=0.7[sfx]');
  filterParts.push('[2:a]volume=0.4[music]');

  if (opts.dialoguePath) {
    inputs.push('-i', opts.dialoguePath);
    // Dialogue at full volume
    filterParts.push('[3:a]volume=1.0[dial]');
    mixInputs = '[sfx][music][dial]amix=inputs=3:duration=first[mixed]';
  } else {
    mixInputs = '[sfx][music]amix=inputs=2:duration=first[mixed]';
  }

  const filter = [...filterParts, mixInputs].join(';');

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
    { stdio: 'pipe', timeout: 60_000 }
  );
}

// ── On-chain video URL fetcher ──────────────────────────────────────────

const universeAbi = [
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
    event: universeAbi[0],
    fromBlock: 0n,
    toBlock: 'latest',
  });

  const scenes = buildSceneAudio();
  const urlMap: Record<string, string> = {};
  for (const l of logs) {
    const link = (l.args as any).link as string;
    const plot = (l.args as any).plot as string;
    for (const scene of scenes) {
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
  console.log('\n' + '═'.repeat(60));
  console.log('  SPACE FLEET — Audio Pipeline');
  console.log('  Voice + SFX + Music + Lip-Sync');
  console.log('  Pilot Episode: "Nothing to See Here"');
  console.log('═'.repeat(60));

  if (!ELEVENLABS_API_KEY) throw new Error('ELEVENLABS_API_KEY not set');
  if (!FAL_KEY) throw new Error('FAL_KEY not set');
  if (UNIVERSE_ADDR === '0x0000000000000000000000000000000000000000') {
    throw new Error('SPACE_FLEET_ADDR not set');
  }

  // Check FFmpeg
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

  // Save voice profiles to wiki entities
  try {
    const token = await getAuthToken();
    await saveVoiceProfilesToWiki(voices, token);
  } catch (err: any) {
    log('WIKI', `Voice profile wiki update failed (non-blocking): ${err.message?.slice(0, 150)}`);
  }

  // ── Step 2: Build scene audio data ──
  const scenes = buildSceneAudio();
  const filteredScenes = SCENE_FILTER ? scenes.filter((s) => SCENE_FILTER!.has(s.id)) : scenes;
  log('SCENES', `Processing ${filteredScenes.length} scenes`);

  // ── Step 3: Generate music segments ──
  const musicSegments = buildMusicSegments();
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
    const files = fs.readdirSync(VIDEO_DIR).filter((f) => f.endsWith('.mp4'));
    for (const f of files) {
      const match = f.match(/^(S\d+)/);
      if (match) videoUrls[match[1]] = path.join(VIDEO_DIR, f);
    }
    log('VIDEOS', `Loaded ${Object.keys(videoUrls).length} videos from ${VIDEO_DIR}`);
  } else {
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
      // Download video if URL
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
              log(scene.id, `  No voice for ${line.speaker}, skipping`);
              continue;
            }
            const buf = await elevenTTS(line.text, voice.voiceId, {
              stability: voice.stability,
              style: voice.style,
            });
            dialogueBuffers.push(buf);
            dialogueBuffers.push(Buffer.alloc(8820)); // ~200ms silence gap
            await sleep(500);
          }
          if (dialogueBuffers.length > 0) {
            fs.writeFileSync(dialogueFile, Buffer.concat(dialogueBuffers));
            log(scene.id, '  Dialogue saved');
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
          fs.writeFileSync(sfxFile, Buffer.alloc(44100 * 2)); // silent placeholder
        }
        await sleep(500);
      } else {
        log(scene.id, 'SKIP SFX — already exists');
      }

      // ── Get music ──
      const musicFile = sceneMusicMap[scene.id];
      if (!musicFile) {
        log(scene.id, 'No music segment, skipping composite');
        results.push({ id: scene.id, title: scene.title, status: 'partial-no-music' });
        continue;
      }

      // ── Lip-sync pass ──
      let finalVideoFile = videoFile;
      if (!SKIP_LIPSYNC && dialogueFile && scene.hasFaces && fs.existsSync(dialogueFile)) {
        const lipsyncFile = path.join(OUTPUT_DIR, 'lipsync', `${scene.id}.mp4`);
        if (!fs.existsSync(lipsyncFile)) {
          log(scene.id, 'Running lip-sync...');
          try {
            const audioUrl = await uploadToFalStorage(
              fs.readFileSync(dialogueFile),
              `${scene.id}-dial.mp3`
            );
            const videoUrl = await uploadVideoToFalStorage(videoFile);
            const syncedUrl = await falLipSync(videoUrl, audioUrl);
            if (syncedUrl) {
              await downloadFile(syncedUrl, lipsyncFile);
              finalVideoFile = lipsyncFile;
              log(scene.id, '  Lip-sync done');
            }
          } catch (err: any) {
            log(scene.id, `  Lip-sync failed: ${err.message?.slice(0, 150)}`);
          }
        } else {
          finalVideoFile = lipsyncFile;
          log(scene.id, 'SKIP lip-sync — already exists');
        }
      }

      // ── Composite ──
      const outputFile = path.join(OUTPUT_DIR, 'final', `${scene.id}-final.mp4`);
      if (!fs.existsSync(outputFile)) {
        log(scene.id, 'Compositing audio layers...');
        compositeAudio({
          videoPath: finalVideoFile,
          dialoguePath: dialogueFile && fs.existsSync(dialogueFile) ? dialogueFile : undefined,
          sfxPath: sfxFile,
          musicPath: musicFile,
          outputPath: outputFile,
        });
        log(scene.id, `  Final: ${outputFile}`);
      } else {
        log(scene.id, 'SKIP composite — already exists');
      }

      results.push({ id: scene.id, title: scene.title, status: 'complete' });
    } catch (err: any) {
      log(scene.id, `FAILED: ${err.message?.slice(0, 200)}`);
      results.push({ id: scene.id, title: scene.title, status: 'failed' });
    }
  }

  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log('  SPACE FLEET — Audio Pipeline Complete');
  console.log('═'.repeat(60));
  const complete = results.filter((r) => r.status === 'complete');
  const failed = results.filter((r) => r.status === 'failed');
  const skipped = results.filter((r) => r.status.startsWith('skip'));

  console.log(`  Complete: ${complete.length}`);
  console.log(`  Failed:   ${failed.length}`);
  console.log(`  Skipped:  ${skipped.length}`);
  console.log('');
  for (const r of results) {
    console.log(`  ${r.id} | ${r.title.padEnd(35)} | ${r.status}`);
  }

  console.log(`\n  Output: ${path.resolve(OUTPUT_DIR)}/final/`);
  console.log(`  Voice profiles: ${VOICE_PROFILES_FILE}`);

  // Voice profile summary
  console.log('\n  Voice Profiles:');
  for (const [key, profile] of Object.entries(voices)) {
    console.log(`    ${key.padEnd(12)} → ${profile.voiceId} (${profile.name})`);
  }

  console.log(`\n  Universe: ${UNIVERSE_ADDR}`);
  console.log('  Next: Concatenate final scenes with ffmpeg for full episode\n');
}

main().catch((err) => {
  console.error('FAILED:', err.message ?? err);
  process.exit(1);
});
