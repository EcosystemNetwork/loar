/**
 * SPACE FLEET — Audio Pipeline
 * Pilot: "Nothing to See Here" — 65 scenes
 *
 * Voice + SFX + Music + Lip-Sync → FFmpeg composite
 *
 * Mirrors ecombonator-audio-pipeline.ts pattern with Space Fleet cast.
 *
 * Usage: pnpm tsx scripts/space-fleet-audio-pipeline.ts
 * Env: ELEVENLABS_API_KEY, FAL_KEY, PRIVATE_KEY, RPC_URL
 * Opt: SF_VIDEO_DIR, SF_OUTPUT_DIR, SF_SKIP_LIPSYNC, SF_SCENES
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
const UADDR = (process.env.SPACE_FLEET_ADDR ?? '0x' + '0'.repeat(40)) as `0x${string}`;
const ODIR = process.env.SF_OUTPUT_DIR || './spacefleet-output';
const VDIR = process.env.SF_VIDEO_DIR || '';
const SKIP_LIP = process.env.SF_SKIP_LIPSYNC === 'true';
const SFILT = process.env.SF_SCENES
  ? new Set(process.env.SF_SCENES.split(',').map((s) => s.trim()))
  : null;
const EBASE = 'https://api.elevenlabs.io/v1';

const L = (s: string, m: string) => console.log(`[${s}] ${m}`);
const Z = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const mkdir = (d: string) => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
};

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
async function designVoice(o: {
  name: string;
  gender: string;
  age: string;
  accent: string;
  as: number;
  text: string;
  desc: string;
}): Promise<string> {
  const g = await fetch(`${EBASE}/voice-generation/generate-voice`, {
    method: 'POST',
    headers: eH(),
    body: JSON.stringify({
      gender: o.gender,
      age: o.age,
      accent: o.accent,
      accent_strength: o.as,
      text: o.text,
    }),
  });
  if (!g.ok) throw new Error(`VGen ${g.status}`);
  const gd = await g.json();
  const s = await fetch(`${EBASE}/voice-generation/create-voice`, {
    method: 'POST',
    headers: eH(),
    body: JSON.stringify({
      voice_name: o.name,
      voice_description: o.desc,
      generated_voice_id: gd.generated_voice_id,
      labels: {},
    }),
  });
  if (!s.ok) throw new Error(`VSave ${s.status}`);
  return (await s.json()).voice_id;
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
async function fMusic(p: string, d: number): Promise<string> {
  fInit();
  const r = await fal.subscribe('fal-ai/stable-audio', {
    input: { prompt: p, seconds_total: d, steps: 100 },
    logs: true,
  });
  const x = (r as any).data || r;
  return x.audio_file?.url || x.audio?.url || x.audio_url || x.url;
}
async function fLip(vu: string, au: string): Promise<string | null> {
  fInit();
  for (const model of ['fal-ai/lipsync', 'fal-ai/sadtalker']) {
    try {
      const r = await fal.subscribe(model, {
        input: { video_url: vu, audio_url: au },
        logs: true,
      });
      const d = (r as any).data || r;
      const u = d.video?.url || d.video_url || d.url;
      if (u) return u;
    } catch {
      /* try next */
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

/* ── Voices ──────────────────────────────────────────────────────────── */
interface VP {
  name: string;
  voiceId: string;
  st: number;
  sy: number;
}
const VSPECS: Record<
  string,
  {
    name: string;
    gender: string;
    age: string;
    accent: string;
    as: number;
    text: string;
    desc: string;
    st: number;
    sy: number;
  }
> = {
  ELI: {
    name: 'Eli Vance - SF',
    gender: 'male',
    age: 'young',
    accent: 'american',
    as: 0.9,
    text: "They're not hiding prototypes. This is operational. Industrial scale.",
    desc: 'Young male 24. Controlled intensity. Quietly precise.',
    st: 0.55,
    sy: 0.3,
  },
  MARA: {
    name: 'Mara Chen - SF',
    gender: 'female',
    age: 'young',
    accent: 'american',
    as: 0.7,
    text: 'The truth is buried under seven acceptable lies.',
    desc: 'Woman 30s. Sharp warm surface, steel underneath.',
    st: 0.6,
    sy: 0.35,
  },
  HALDEN: {
    name: 'Dir Halden - SF',
    gender: 'male',
    age: 'middle_aged',
    accent: 'american',
    as: 0.8,
    text: 'Come inside and see why the wall exists.',
    desc: 'Male 50s. Calm measured. Institutional power.',
    st: 0.75,
    sy: 0.4,
  },
  VOICE: {
    name: 'The Voice - SF',
    gender: 'male',
    age: 'old',
    accent: 'american',
    as: 0.6,
    text: 'Stop looking up where civilians can see you.',
    desc: 'Older male. Calm surveillance voice.',
    st: 0.7,
    sy: 0.25,
  },
  INTERCOM: {
    name: 'Intercom - SF',
    gender: 'female',
    age: 'young',
    accent: 'american',
    as: 1.0,
    text: 'Orpheus transfer team to Launch Spine Two.',
    desc: 'Clean PA voice. Military.',
    st: 0.85,
    sy: 0.1,
  },
  ARCHIVAL: {
    name: 'Archival - SF',
    gender: 'male',
    age: 'middle_aged',
    accent: 'american',
    as: 1.0,
    text: 'No evidence of unauthorized orbital infrastructure.',
    desc: 'Government spokesman. Polished bland denial.',
    st: 0.8,
    sy: 0.15,
  },
};

async function loadV(): Promise<Record<string, VP>> {
  mkdir(ODIR);
  const f = path.join(ODIR, 'voice-profiles.json');
  if (fs.existsSync(f)) {
    const s = JSON.parse(fs.readFileSync(f, 'utf-8'));
    L('V', `Loaded ${Object.keys(s).length}`);
    return s;
  }
  L('V', 'Designing...');
  const p: Record<string, VP> = {};
  for (const [k, s] of Object.entries(VSPECS)) {
    try {
      const id = await designVoice(s);
      p[k] = { name: s.name, voiceId: id, st: s.st, sy: s.sy };
      L('V', `  ${k} -> ${id}`);
      await Z(1000);
    } catch (e: any) {
      L('V', `  FAIL ${k}`);
    }
  }
  fs.writeFileSync(f, JSON.stringify(p, null, 2));
  return p;
}

/* ── Scene audio defs ────────────────────────────────────────────────── */
interface Ln {
  sp: string;
  tx: string;
}
interface SA {
  id: string;
  t: string;
  ln: Ln[];
  sx: string;
  m: string;
  fc: boolean;
}

function buildSA(): SA[] {
  return [
    // COLD OPEN
    {
      id: 'S01',
      t: 'Archival',
      ln: [
        {
          sp: 'ARCHIVAL',
          tx: 'There is no evidence of unauthorized orbital infrastructure. Reports of off-book aerospace platforms are speculative and false.',
        },
      ],
      sx: 'Low mechanical hum, metallic clang, deep bass rumble. Ominous.',
      m: 'co',
      fc: false,
    },
    {
      id: 'S02',
      t: 'Desert',
      ln: [],
      sx: 'Desert wind, highway hum, car engine. Night crickets.',
      m: 'co',
      fc: false,
    },
    {
      id: 'S03',
      t: 'Eli Drives',
      ln: [],
      sx: 'Car interior engine hum, road noise, wheel creak.',
      m: 'co',
      fc: true,
    },
    { id: 'S04', t: 'Seat', ln: [], sx: 'Paper rustle, leather seat objects.', m: 'co', fc: false },
    {
      id: 'S05',
      t: '1st Launch',
      ln: [],
      sx: 'Deep thrum. Subsonic vibration cutting atmosphere.',
      m: 'co',
      fc: false,
    },
    {
      id: 'S06',
      t: '3 Launches',
      ln: [],
      sx: 'Triple pulse. Atmospheric distortion crackling.',
      m: 'co',
      fc: false,
    },
    {
      id: 'S07',
      t: 'Massive',
      ln: [],
      sx: 'Silence then impossibly low vibration. Clear sky thunder.',
      m: 'co',
      fc: true,
    },
    {
      id: 'S08',
      t: 'Phone',
      ln: [
        { sp: 'ELI', tx: 'Hello?' },
        { sp: 'VOICE', tx: "You weren't supposed to stop." },
        { sp: 'ELI', tx: 'Who is this?' },
        {
          sp: 'VOICE',
          tx: 'If you want the truth, Mr. Vance... stop looking up in places where civilians can see you.',
        },
      ],
      sx: 'Phone buzz, static, dead air. Thunder on clear sky.',
      m: 'co',
      fc: true,
    },
    // ACT ONE
    { id: 'S09', t: 'DAC', ln: [], sx: 'Badge beeps. Doors. AC hum.', m: 'a1', fc: false },
    {
      id: 'S10',
      t: 'Enter',
      ln: [],
      sx: 'Badge beep, turnstile, TV faint. Fluorescent.',
      m: 'a1',
      fc: true,
    },
    {
      id: 'S11',
      t: 'Mara Hall',
      ln: [
        { sp: 'MARA', tx: 'You look terrible.' },
        { sp: 'ELI', tx: "Didn't sleep much." },
        {
          sp: 'MARA',
          tx: "Weather balloons, ion reflections, swamp gas, whatever lie we're using this quarter.",
        },
      ],
      sx: 'Hallway hum, coffee, footsteps.',
      m: 'a1',
      fc: true,
    },
    {
      id: 'S12',
      t: 'Flinch',
      ln: [
        { sp: 'ELI', tx: 'You ever say that out loud just to see who flinches?' },
        { sp: 'MARA', tx: 'Every day.' },
      ],
      sx: 'Footsteps diverge.',
      m: 'a1',
      fc: true,
    },
    {
      id: 'S13',
      t: 'Briefing',
      ln: [],
      sx: 'Holographic hum. Tablets. Silence.',
      m: 'a1',
      fc: true,
    },
    {
      id: 'S14',
      t: 'Signal',
      ln: [
        {
          sp: 'HALDEN',
          tx: 'Your job is not to prove fantasies. Your job is to maintain signal integrity.',
        },
      ],
      sx: 'Digital chimes as data erased.',
      m: 'a1',
      fc: true,
    },
    {
      id: 'S15',
      t: 'Promote',
      ln: [
        {
          sp: 'HALDEN',
          tx: 'Mr. Vance. Anomaly pattern recognition. Disinformation triage queue.',
        },
        { sp: 'ELI', tx: 'Happy to help, sir.' },
      ],
      sx: 'Chair swivels. Pin-drop.',
      m: 'a1',
      fc: true,
    },
    {
      id: 'S16',
      t: 'Warning',
      ln: [
        { sp: 'HALDEN', tx: 'Do not mistake emotional reaction for analysis.' },
        { sp: 'ELI', tx: "Wouldn't dream of it." },
      ],
      sx: 'Silence. Breathing only.',
      m: 'a1',
      fc: true,
    },
    {
      id: 'S17',
      t: 'Triage',
      ln: [],
      sx: 'Screen hum. Server fans. Blue silence.',
      m: 'a1t',
      fc: true,
    },
    {
      id: 'S18',
      t: 'Evidence',
      ln: [],
      sx: 'Audio cuts: farmer, pilot whisper. Stamp beeps.',
      m: 'a1t',
      fc: false,
    },
    {
      id: 'S19',
      t: 'Restricted',
      ln: [],
      sx: 'Analog static. Pings. Sudden silence.',
      m: 'a1t',
      fc: true,
    },
    {
      id: 'S20',
      t: 'ORPHEUS',
      ln: [],
      sx: 'Error buzzer. Red flash. Pen on paper.',
      m: 'a1t',
      fc: true,
    },
    {
      id: 'S21',
      t: 'Behind',
      ln: [
        { sp: 'HALDEN', tx: 'Finding your footing?' },
        { sp: 'ELI', tx: 'Mostly nonsense. Some very committed nonsense.' },
      ],
      sx: 'Footsteps. Quick click.',
      m: 'a1t',
      fc: true,
    },
    {
      id: 'S22',
      t: 'Is It',
      ln: [
        { sp: 'HALDEN', tx: 'Ambition is useful. Curiosity is not the same thing.' },
        { sp: 'ELI', tx: 'Understood.' },
        { sp: 'HALDEN', tx: 'Is it?' },
        { sp: 'ELI', tx: 'Yes, sir.' },
      ],
      sx: 'Steps receding. Breath released.',
      m: 'a1t',
      fc: true,
    },
    // ACT TWO
    {
      id: 'S23',
      t: 'Cafe',
      ln: [],
      sx: 'Fluorescent buzz. Utensils. Vending.',
      m: 'a2c',
      fc: true,
    },
    {
      id: 'S24',
      t: 'Mara Sits',
      ln: [{ sp: 'MARA', tx: "Halden's attention. Congratulations or condolences." }],
      sx: 'Tray down. Chair.',
      m: 'a2c',
      fc: true,
    },
    {
      id: 'S25',
      t: 'Orpheus?',
      ln: [
        { sp: 'ELI', tx: "What's Orpheus?" },
        { sp: 'MARA', tx: 'That was fast.' },
      ],
      sx: 'Chewing stops.',
      m: 'a2c',
      fc: true,
    },
    {
      id: 'S26',
      t: 'Real',
      ln: [
        { sp: 'ELI', tx: "So it's real." },
        { sp: 'MARA', tx: "I didn't say that." },
        { sp: 'ELI', tx: 'You reacted.' },
        {
          sp: 'MARA',
          tx: 'You asked a question that gets people moved into offices with no clocks.',
        },
      ],
      sx: 'Whispered under noise.',
      m: 'a2c',
      fc: true,
    },
    {
      id: 'S27',
      t: '7 Lies',
      ln: [
        {
          sp: 'MARA',
          tx: "The truth is never hidden. It's buried under seven acceptable lies, and your career depends on repeating the right one.",
        },
      ],
      sx: 'Near silence.',
      m: 'a2c',
      fc: true,
    },
    {
      id: 'S28',
      t: 'Dumb',
      ln: [
        { sp: 'ELI', tx: "And if I don't?" },
        { sp: 'MARA', tx: "You'll never get close enough." },
        { sp: 'MARA', tx: 'Play dumb better.' },
      ],
      sx: 'Chair scrape. Steps.',
      m: 'a2c',
      fc: true,
    },
    {
      id: 'S29',
      t: 'Wall',
      ln: [],
      sx: 'Apartment traffic, creaks, lamp, paper.',
      m: 'a2a',
      fc: false,
    },
    {
      id: 'S30',
      t: 'Log1',
      ln: [{ sp: 'ELI', tx: "Day one in Level 3. Orpheus exists. Halden knows I'm looking." }],
      sx: 'Laptop fan. Recording beep.',
      m: 'a2a',
      fc: true,
    },
    {
      id: 'S31',
      t: 'Log2',
      ln: [
        { sp: 'ELI', tx: "They're not hiding prototypes. This is operational. Industrial scale." },
        { sp: 'ELI', tx: "They want the public to think we're still struggling with rockets." },
      ],
      sx: 'Laptop fan. Clock.',
      m: 'a2a',
      fc: true,
    },
    { id: 'S32', t: 'SUV', ln: [], sx: 'Flash. Deep idle. Silence.', m: 'a2a', fc: true },
    { id: 'S33', t: 'Gone', ln: [], sx: 'Tires receding. Electronic glitch.', m: 'a2a', fc: false },
    { id: 'S34', t: 'Msg', ln: [], sx: 'Static. Ghost keys. Hard silence.', m: 'a2a', fc: false },
    { id: 'S35', t: 'Trapped', ln: [], sx: 'Silence. Breathing. Creaks.', m: 'a2a', fc: true },
    // ACT THREE
    { id: 'S36', t: 'Badge', ln: [], sx: 'New badge tone.', m: 'a3d', fc: true },
    { id: 'S37', t: 'Floors', ln: [], sx: 'Beeps descending then silence.', m: 'a3d', fc: true },
    { id: 'S38', t: 'Hum', ln: [], sx: 'Bass vibration. Hydraulic hiss.', m: 'a3d', fc: true },
    { id: 'S39', t: 'Corridor', ln: [], sx: 'Chime. New acoustic.', m: 'a3d', fc: false },
    {
      id: 'S40',
      t: 'Walk',
      ln: [{ sp: 'HALDEN', tx: 'Walk with me.' }],
      sx: 'Two footstep sets. Polished floor.',
      m: 'a3d',
      fc: true,
    },
    { id: 'S41', t: 'Command', ln: [], sx: 'Muffled holo hum, keys, radio.', m: 'a3r', fc: false },
    { id: 'S42', t: 'Telem', ln: [], sx: 'Digital readout. Status pings.', m: 'a3r', fc: false },
    {
      id: 'S43',
      t: 'Window',
      ln: [],
      sx: 'Steps stop. Breath. Cavernous hum.',
      m: 'a3r',
      fc: true,
    },
    { id: 'S44', t: 'Ship', ln: [], sx: 'Magnetic throb. Cathedral echo.', m: 'a3r', fc: false },
    { id: 'S45', t: 'Breath', ln: [], sx: 'Breath catching. Heartbeat.', m: 'a3r', fc: true },
    {
      id: 'S46',
      t: 'Nonsense',
      ln: [
        { sp: 'ELI', tx: 'What is this?' },
        {
          sp: 'HALDEN',
          tx: 'The stories are pathetic fragments. We permit that. Nonsense protects the truth.',
        },
      ],
      sx: 'Hangar ambience.',
      m: 'a3r',
      fc: true,
    },
    {
      id: 'S47',
      t: 'Civilization',
      ln: [
        { sp: 'ELI', tx: 'What is this?' },
        { sp: 'HALDEN', tx: 'Continuity of civilization.' },
      ],
      sx: 'Words like stone.',
      m: 'a3r',
      fc: true,
    },
    {
      id: 'S48',
      t: 'Collapse',
      ln: [
        {
          sp: 'HALDEN',
          tx: 'Markets collapse. Alliances fracture. If you hid this, what else did you hide?',
        },
        { sp: 'ELI', tx: 'Maybe they should ask.' },
        { sp: 'HALDEN', tx: "They won't ask from calm." },
      ],
      sx: 'Silence between. Hangar.',
      m: 'a3r',
      fc: true,
    },
    {
      id: 'S49',
      t: 'Choice',
      ln: [
        {
          sp: 'HALDEN',
          tx: 'Shouting from outside the wall... or come inside and see why it exists.',
        },
      ],
      sx: 'Ship hums. Pause.',
      m: 'a3r',
      fc: true,
    },
    {
      id: 'S50',
      t: 'Lie',
      ln: [
        { sp: 'ELI', tx: 'What do you need?' },
        { sp: 'HALDEN', tx: 'Loyalty. Competence. Silence.' },
        { sp: 'ELI', tx: 'All three, sir.' },
      ],
      sx: 'Controlled performance.',
      m: 'a3r',
      fc: true,
    },
    { id: 'S51', t: 'Tablet', ln: [], sx: 'Tablet activate. Grip.', m: 'a3r', fc: false },
    { id: 'S52', t: 'Uniform', ln: [], sx: 'Locker metal. Fabric. Swipe.', m: 'a3b', fc: true },
    { id: 'S53', t: 'Pages', ln: [], sx: 'Swipes escalating.', m: 'a3b', fc: false },
    { id: 'S54', t: 'SIGNAL', ln: [], sx: 'All drops. High tone. Heartbeat.', m: 'a3b', fc: true },
    {
      id: 'S55',
      t: 'Mara',
      ln: [
        { sp: 'ELI', tx: "You're part of this." },
        { sp: 'MARA', tx: 'Everyone worth promoting is.' },
      ],
      sx: 'Footstep. Alarm hum.',
      m: 'a3b',
      fc: true,
    },
    {
      id: 'S56',
      t: 'Truth',
      ln: [
        { sp: 'ELI', tx: "Why didn't you tell me?" },
        { sp: 'MARA', tx: 'You were deciding between truth and vindication.' },
      ],
      sx: 'First honesty.',
      m: 'a3b',
      fc: true,
    },
    {
      id: 'S57',
      t: 'Proof',
      ln: [
        { sp: 'INTERCOM', tx: 'Orpheus transfer team to Launch Spine Two.' },
        {
          sp: 'MARA',
          tx: "Make sure the world gets proof, not a story. They've trained people to laugh at stories.",
        },
      ],
      sx: 'Amber pulse. Intercom. Steps.',
      m: 'a3b',
      fc: true,
    },
    { id: 'S58', t: 'Wafer', ln: [], sx: 'Metallic click. Palm.', m: 'a3b', fc: true },
    // FINALE
    {
      id: 'S59',
      t: 'Approach',
      ln: [],
      sx: 'Massive doors. Boots. Air vibrates.',
      m: 'fin',
      fc: true,
    },
    {
      id: 'S60',
      t: 'Chamber',
      ln: [],
      sx: 'Cavernous. Ship throb. Chest hum.',
      m: 'fin',
      fc: false,
    },
    { id: 'S61', t: 'Faithful', ln: [], sx: 'Held breath. Rising energy.', m: 'fin', fc: true },
    { id: 'S62', t: 'Open', ln: [], sx: 'MASSIVE doors. Rock. Light. Wind.', m: 'fin', fc: false },
    { id: 'S63', t: 'Rises', ln: [], sx: 'Near silence. Air displacement.', m: 'fin', fc: false },
    { id: 'S64', t: 'Cover', ln: [], sx: 'Status chimes. Keyboard.', m: 'fin', fc: true },
    {
      id: 'S65',
      t: 'Welcome',
      ln: [
        {
          sp: 'ELI',
          tx: "They were never hiding scraps. They were hiding a civilization. And now I'm inside it.",
        },
        { sp: 'INTERCOM', tx: 'Welcome to Space Fleet.' },
      ],
      sx: 'Energy surge. White peak. Silence. Calm intercom.',
      m: 'fin',
      fc: true,
    },
  ];
}

/* ── Music segments ──────────────────────────────────────────────────── */
const MUS = [
  {
    id: 'M01',
    sc: ['S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07', 'S08'],
    p: 'Paranoid sci-fi cold open. Subsonic drone. Desert isolation. Vast invisible overhead. Delayed piano. Building dread. Strings tremolo. Nolan Sicario. No vocals.',
    d: 80,
  },
  {
    id: 'M02',
    sc: ['S09', 'S10', 'S11', 'S12', 'S13', 'S14', 'S15', 'S16'],
    p: 'Government thriller. Cold sterile pulses. Fluorescent hum as music. Zero Dark Thirty. Clarinet electronic. No vocals.',
    d: 80,
  },
  {
    id: 'M03',
    sc: ['S17', 'S18', 'S19', 'S20', 'S21', 'S22'],
    p: 'Discovery danger. Screen glow. Quickening. ORPHEUS chord. Halden tension. No vocals.',
    d: 60,
  },
  {
    id: 'M04',
    sc: ['S23', 'S24', 'S25', 'S26', 'S27', 'S28'],
    p: 'Cafeteria tension. Piano long decay. Electronic pad. Near-silence. Spy intimacy. No vocals.',
    d: 60,
  },
  {
    id: 'M05',
    sc: ['S29', 'S30', 'S31', 'S32', 'S33', 'S34', 'S35'],
    p: 'Paranoid night. Conspiracy wall. Video confession. SUV surveillance. Obsession to fear. Electronic interference. Creeping horror. No vocals.',
    d: 70,
  },
  {
    id: 'M06',
    sc: ['S36', 'S37', 'S38', 'S39', 'S40'],
    p: 'Classified descent. Semitone lower each floor. Black corridors. Low brass. No vocals.',
    d: 50,
  },
  {
    id: 'M07',
    sc: ['S41', 'S42', 'S43', 'S44', 'S45', 'S46', 'S47', 'S48', 'S49', 'S50', 'S51'],
    p: 'Revelation. Cathedral silence. Brass build. Full swell. Drop for dialogue. Interstellar meets Condor. No vocals.',
    d: 110,
  },
  {
    id: 'M08',
    sc: ['S52', 'S53', 'S54', 'S55', 'S56', 'S57', 'S58'],
    p: 'Classified briefing. NON-HUMAN SIGNAL chord. Mara urgent. Data wafer resolute. No vocals.',
    d: 70,
  },
  {
    id: 'M09',
    sc: ['S59', 'S60', 'S61', 'S62', 'S63', 'S64', 'S65'],
    p: 'Launch Spine finale. Cathedral awe. Ship through mountain. Sunlight revelation. Orchestra electronic peak. Silence. Welcome. Choral for launch only.',
    d: 70,
  },
];

/* ���─ FFmpeg ───────────────────────────────────────────────────────────── */
function mix(v: string, dlg: string | undefined, sx: string, mu: string, out: string) {
  const i = ['-i', v, '-i', sx, '-i', mu];
  const f = ['[1:a]volume=0.6[s]', '[2:a]volume=0.25[m]'];
  if (dlg && fs.existsSync(dlg)) {
    i.push('-i', dlg);
    f.push('[3:a]volume=1.0[d]', '[d][s][m]amix=inputs=3:duration=first:dropout_transition=2[x]');
  } else {
    f.push('[s][m]amix=inputs=2:duration=first:dropout_transition=2[x]');
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
    timeout: 60_000,
  });
}

/* ── Chain fetch ─────────────────────────────────────────────────────── */
async function fetchV(): Promise<Record<string, string>> {
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
  const logs = await pc.getLogs({ address: UADDR, event: ev, fromBlock: 0n, toBlock: 'latest' });
  const sa = buildSA();
  const m: Record<string, string> = {};
  for (const l of logs) {
    const lk = (l.args as any).link as string;
    const pl = (l.args as any).plot as string;
    for (const s of sa) if (pl?.includes(s.t)) m[s.id] = lk;
  }
  return m;
}

/* ── Main ────────────────────────────────────────────────────────────── */
async function main() {
  console.log('\n=== SPACE FLEET Audio Pipeline (65 scenes) ===\n');
  if (!EL_KEY) throw new Error('ELEVENLABS_API_KEY');
  if (!FK) throw new Error('FAL_KEY');
  try {
    execSync('ffmpeg -version', { stdio: 'pipe' });
  } catch {
    throw new Error('ffmpeg needed');
  }

  mkdir(ODIR);
  for (const d of ['dialogue', 'sfx', 'music', 'lipsync', 'videos', 'final'])
    mkdir(path.join(ODIR, d));

  const voices = await loadV();
  const sa = buildSA();
  const active = SFILT ? sa.filter((s) => SFILT!.has(s.id)) : sa;
  L('S', `${active.length} scenes`);

  // Music
  const mf: Record<string, string> = {};
  for (const m of MUS) {
    const f = path.join(ODIR, 'music', `${m.id}.mp3`);
    if (fs.existsSync(f)) {
      mf[m.id] = f;
      continue;
    }
    try {
      const u = await fMusic(m.p, m.d);
      if (u) {
        await dl(u, f);
        mf[m.id] = f;
      }
    } catch {
      L('M', `FAIL ${m.id}`);
    }
    await Z(1500);
  }
  const sm: Record<string, string> = {};
  for (const m of MUS) if (mf[m.id]) for (const s of m.sc) sm[s] = mf[m.id];

  // Videos
  let vids: Record<string, string> = {};
  if (VDIR && fs.existsSync(VDIR)) {
    for (const f of fs.readdirSync(VDIR).filter((f) => f.endsWith('.mp4'))) {
      const r = f.match(/^(S\d+)/);
      if (r) vids[r[1]] = path.join(VDIR, f);
    }
  } else {
    vids = await fetchV();
  }
  L('S', `${Object.keys(vids).length} videos`);

  let ok = 0;
  let fail = 0;
  let skip = 0;
  for (const s of active) {
    console.log(`\n--- ${s.id}: ${s.t} ---`);
    const vs = vids[s.id];
    if (!vs) {
      skip++;
      continue;
    }
    try {
      const vf = path.join(ODIR, 'videos', `${s.id}.mp4`);
      if (!fs.existsSync(vf)) {
        if (vs.startsWith('http')) await dl(vs, vf);
        else fs.copyFileSync(vs, vf);
      }

      let df: string | undefined;
      if (s.ln.length) {
        df = path.join(ODIR, 'dialogue', `${s.id}.mp3`);
        if (!fs.existsSync(df)) {
          const bs: Buffer[] = [];
          for (const ln of s.ln) {
            const v = voices[ln.sp];
            if (!v) continue;
            bs.push(await tts(ln.tx, v.voiceId, v.st, v.sy));
            bs.push(Buffer.alloc(8820));
            await Z(500);
          }
          if (bs.length) fs.writeFileSync(df, Buffer.concat(bs));
        }
      }

      const sf = path.join(ODIR, 'sfx', `${s.id}.mp3`);
      if (!fs.existsSync(sf)) {
        try {
          fs.writeFileSync(sf, await sfx(s.sx, 10));
        } catch {
          fs.writeFileSync(sf, Buffer.alloc(44100 * 2));
        }
        await Z(500);
      }

      const mu = sm[s.id];
      if (!mu) {
        skip++;
        continue;
      }

      let fv = vf;
      if (!SKIP_LIP && df && s.fc && fs.existsSync(df)) {
        const lf = path.join(ODIR, 'lipsync', `${s.id}.mp4`);
        if (!fs.existsSync(lf)) {
          try {
            const lu = await fLip(await fUpV(vf), await fUpA(fs.readFileSync(df), `${s.id}.mp3`));
            if (lu) {
              await dl(lu, lf);
              fv = lf;
            }
          } catch {
            /* use original */
          }
        } else {
          fv = lf;
        }
      }

      const out = path.join(ODIR, 'final', `${s.id}.mp4`);
      if (!fs.existsSync(out)) mix(fv, df, sf, mu, out);
      ok++;
    } catch (e: any) {
      L(s.id, `FAIL: ${e.message?.slice(0, 200)}`);
      fail++;
    }
  }

  console.log(`\n=== Done: ${ok} ok | ${fail} fail | ${skip} skip ===`);
  console.log(`Output: ${ODIR}/final/\n`);
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
