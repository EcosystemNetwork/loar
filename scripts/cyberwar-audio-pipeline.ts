/**
 * CYBER WAR — Audio Pipeline
 * 70 scenes — Voice + SFX + Music + Lip-Sync → FFmpeg composite
 *
 * Follows the AAA film edit order from cyberwar-reorder-nodes.ts.
 * Each scene gets: dialogue TTS, sound effects, shared music segment,
 * optional lip-sync, then final FFmpeg composite.
 *
 * Usage: pnpm tsx scripts/cyberwar-audio-pipeline.ts
 * Env: ELEVENLABS_API_KEY, FAL_KEY, PRIVATE_KEY, RPC_URL
 * Opt: CW_VIDEO_DIR, CW_OUTPUT_DIR, CW_SKIP_LIPSYNC, CW_SCENES
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
const UADDR = '0x341fFa19c0EC8D2C8eF42A360cf799949844262e' as `0x${string}`;
const ODIR = process.env.CW_OUTPUT_DIR || './cyberwar-output';
const VDIR = process.env.CW_VIDEO_DIR || '';
const SKIP_LIP = process.env.CW_SKIP_LIPSYNC === 'true';
const SFILT = process.env.CW_SCENES
  ? new Set(process.env.CW_SCENES.split(',').map((s) => s.trim()))
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

async function findBestVoice(o: {
  name: string;
  gender: string;
  age: string;
  accent: string;
  text: string;
  desc: string;
}): Promise<string> {
  const res = await fetch(`${EBASE}/voices`, { headers: eH() });
  if (!res.ok) throw new Error(`Voices list ${res.status}`);
  const { voices } = (await res.json()) as {
    voices: Array<{ voice_id: string; name: string; labels?: Record<string, string> }>;
  };

  const PREFERRED: Record<string, string[]> = {
    NOVA: ['Sarah', 'Laura', 'Alice', 'Jessica'], // young fierce female
    ORIN: ['Charlie', 'Liam', 'Daniel', 'James'], // deep intense male
    ECHO: ['Charlotte', 'Matilda', 'Rachel', 'Lily'], // ethereal young female
    VOSS: ['George', 'Roger', 'Bill', 'Arnold'], // authoritative older male
    NARRATOR: ['Brian', 'Adam', 'Antoni', 'Thomas'], // calm narrator
  };

  const prefs = PREFERRED[o.name] || [];
  for (const pref of prefs) {
    const match = voices.find((v) => v.name.toLowerCase().includes(pref.toLowerCase()));
    if (match) return match.voice_id;
  }
  const genderMatch = voices.find(
    (v) => v.labels?.gender === o.gender || v.name.toLowerCase().includes(o.gender)
  );
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
async function fMusic(p: string, d: number): Promise<string> {
  fInit();
  const clamped = Math.min(d, 47);
  const r = await fal.subscribe('fal-ai/stable-audio', {
    input: { prompt: p, seconds_total: clamped, steps: 100 },
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
    text: string;
    desc: string;
    st: number;
    sy: number;
  }
> = {
  NOVA: {
    name: 'NOVA',
    gender: 'female',
    age: 'young',
    accent: 'american',
    text: 'Move out. We break the tower tonight.',
    desc: 'Woman 23. Fierce, determined, slightly rough edge. Leader voice.',
    st: 0.5,
    sy: 0.35,
  },
  ORIN: {
    name: 'ORIN',
    gender: 'male',
    age: 'young',
    accent: 'american',
    text: "I don't trust anything that can't bleed.",
    desc: 'Man 27. Deep, guarded, military bearing. Skeptical.',
    st: 0.6,
    sy: 0.25,
  },
  ECHO: {
    name: 'ECHO',
    gender: 'female',
    age: 'young',
    accent: 'british',
    text: 'That depends on what humans ask me to become.',
    desc: 'Girl 16-ish. Ethereal, calm, slightly reverberant. AI construct.',
    st: 0.4,
    sy: 0.45,
  },
  VOSS: {
    name: 'VOSS',
    gender: 'male',
    age: 'old',
    accent: 'british',
    text: 'Freedom without order becomes extinction.',
    desc: 'Man 50s. Cold, measured, magnetic authority. Villain.',
    st: 0.75,
    sy: 0.4,
  },
  NARRATOR: {
    name: 'NARRATOR',
    gender: 'male',
    age: 'middle_aged',
    accent: 'american',
    text: 'Year 2149. The network is the nation.',
    desc: 'Clean voice-over. Documentary tone.',
    st: 0.8,
    sy: 0.15,
  },
};

async function loadV(): Promise<Record<string, VP>> {
  mkdir(ODIR);
  const f = path.join(ODIR, 'voice-profiles.json');
  if (fs.existsSync(f)) {
    const s = JSON.parse(fs.readFileSync(f, 'utf-8'));
    L('V', `Loaded ${Object.keys(s).length} voice profiles`);
    return s;
  }
  L('V', 'Designing voice profiles...');
  const p: Record<string, VP> = {};
  for (const [k, s] of Object.entries(VSPECS)) {
    try {
      const id = await findBestVoice(s);
      p[k] = { name: s.name, voiceId: id, st: s.st, sy: s.sy };
      L('V', `  ${k} -> ${id}`);
      await Z(500);
    } catch (e: any) {
      L('V', `  FAIL ${k}: ${e.message?.slice(0, 100)}`);
    }
  }
  fs.writeFileSync(f, JSON.stringify(p, null, 2));
  return p;
}

/* ── Scene audio definitions ─────────────────────────────────────────── */
interface Ln {
  sp: string; // speaker key (NOVA, ORIN, ECHO, VOSS, NARRATOR)
  tx: string; // dialogue text
}
interface SA {
  id: string; // scene ID (S01-S70)
  t: string; // short title for matching
  ln: Ln[]; // dialogue lines
  sx: string; // SFX description
  m: string; // music segment key
  fc: boolean; // has faces (for lip-sync)
}

function buildSA(): SA[] {
  return [
    // ═══════════════════════════════════════════════════════════════════
    // ACT 0: COLD OPEN — World atmosphere
    // ═══════════════════════════════════════════════════════════════════
    {
      id: 'S01',
      t: 'Megacity Skyline',
      ln: [],
      sx: 'Massive rain on metal and glass. Distant thunder. Hovering drones bass hum. City ambience, traffic far below. Deep subsonic rumble of a megacity alive.',
      m: 'cold',
      fc: false,
    },
    {
      id: 'S19',
      t: 'City Rain',
      ln: [],
      sx: 'Close-up rain hitting neon-lit puddles. Electrical hum. Drone flyby overhead, Doppler whoosh. Wet pavement, splashing.',
      m: 'cold',
      fc: false,
    },
    {
      id: 'S20',
      t: 'Billboard',
      ln: [{ sp: 'NARRATOR', tx: 'Year 2149. The network is the nation.' }],
      sx: 'Digital billboard static, electrical crackle. Propaganda jingle glitch. Rain.',
      m: 'cold',
      fc: false,
    },
    {
      id: 'S21',
      t: 'Undercity',
      ln: [],
      sx: 'Metal hatch opening. Echoing drips. Industrial pipes groaning. Feet on wet ladder rungs. Distant rumble.',
      m: 'cold',
      fc: false,
    },

    // ═══════════════════════════════════════════════════════════════════
    // ACT 1A: CHARACTER INTRODUCTIONS
    // ═══════════════════════════════════════════════════════════════════
    {
      id: 'S02',
      t: 'Nova at Console',
      ln: [{ sp: 'NOVA', tx: 'Their firewall rotates every ninety seconds. Predictable.' }],
      sx: 'Holographic keyboard clicks. Server hum. Faint static. Code scrolling.',
      m: 'setup',
      fc: true,
    },
    {
      id: 'S22',
      t: 'Nova Eye Tattoo',
      ln: [],
      sx: 'Soft electronic pulse. Bio-circuit hum. Heartbeat-like rhythm.',
      m: 'setup',
      fc: true,
    },
    {
      id: 'S03',
      t: 'Orin Loads Up',
      ln: [{ sp: 'ORIN', tx: 'Ninety seconds. That gives us maybe twelve before they trace us.' }],
      sx: 'Plasma rounds clicking into rifle magazine. Cybernetic arm servo whir. Weapon charging hum.',
      m: 'setup',
      fc: true,
    },
    {
      id: 'S23',
      t: 'Orin Arm',
      ln: [],
      sx: 'Mechanical servos flexing. Hydraulic hiss. Metal fingers clicking. Red light buzz.',
      m: 'setup',
      fc: false,
    },
    {
      id: 'S24',
      t: 'War Table',
      ln: [
        { sp: 'NOVA', tx: 'Main shaft. Service access. One way in, no way out.' },
        { sp: 'ORIN', tx: 'My favorite kind of plan.' },
      ],
      sx: 'Holographic projection humming. 3D tower rotating. Tactical markers beeping.',
      m: 'setup',
      fc: true,
    },

    // ═══════════════════════════════════════════════════════════════════
    // ACT 1B: ECHO INTRODUCTION
    // ═══════════════════════════════════════════════════════════════════
    {
      id: 'S04',
      t: 'Echo Briefing',
      ln: [
        {
          sp: 'ECHO',
          tx: "The breach point is on level forty-seven. The core's neural link is unguarded for three seconds during each cycle reset.",
        },
        { sp: 'ORIN', tx: 'And what are you exactly?' },
        { sp: 'ECHO', tx: 'That depends on what humans ask me to become.' },
      ],
      sx: 'Holographic materialization shimmer. Violet energy hum. Static crackle.',
      m: 'setup',
      fc: true,
    },
    {
      id: 'S25',
      t: 'Echo Materializes',
      ln: [],
      sx: 'Digital particle assembly. Rising crystalline tone. Violet energy coalesce. Ethereal chime.',
      m: 'setup',
      fc: false,
    },
    {
      id: 'S26',
      t: 'Echo Violet Eyes',
      ln: [
        {
          sp: 'ECHO',
          tx: 'I remember every war humanity has fought. Every lie told to start one.',
        },
      ],
      sx: 'Soft code whisper. Data stream flowing. Ethereal ambient tone.',
      m: 'setup',
      fc: true,
    },
    {
      id: 'S27',
      t: 'Orin Reaction',
      ln: [
        { sp: 'ORIN', tx: 'Last time someone trusted an AI, half the Eastern Grid went dark.' },
        { sp: 'NOVA', tx: "She's not the Grid. She's something else." },
      ],
      sx: 'Rifle grip tightening. Leather creak. Tense silence. Faint red pulse.',
      m: 'setup',
      fc: true,
    },
    {
      id: 'S28',
      t: 'Nova Stand Up',
      ln: [{ sp: 'NOVA', tx: 'Move out.' }],
      sx: 'Chair scrape. Plasma blade ignition — sharp cyan hum. Determined footstep.',
      m: 'setup',
      fc: true,
    },

    // ═══════════════════════════════════════════════════════════════════
    // ACT 2A: HOVERBIKE CHASE
    // ═══════════════════════════════════════════════════════════════════
    {
      id: 'S05',
      t: 'Hoverbike Launch',
      ln: [],
      sx: 'Hoverbike engines roaring to life. Anti-grav thruster whine. Tunnel echo. Wind blast.',
      m: 'chase',
      fc: true,
    },
    {
      id: 'S29',
      t: 'Bike POV',
      ln: [],
      sx: 'Wind screaming past. Neon signs Doppler whoosh. Engine high-pitch whine. Tunnel resonance.',
      m: 'chase',
      fc: false,
    },
    {
      id: 'S30',
      t: 'Side Riding',
      ln: [],
      sx: 'Two engines in harmony. Rain pelting visors. Tires on wet surface. Violet streak.',
      m: 'chase',
      fc: true,
    },
    {
      id: 'S31',
      t: 'Drone Swarm',
      ln: [],
      sx: 'Descending drone swarm — twenty units. Multiple scanner beams activating. Siren wail. Red alert klaxon.',
      m: 'chase',
      fc: false,
    },

    // ═══════════════════════════════════════════════════════════════════
    // ACT 2B: DRONE COMBAT
    // ═══════════════════════════════════════════════════════════════════
    {
      id: 'S06',
      t: 'Drone Attack',
      ln: [{ sp: 'NOVA', tx: 'Echo! Blind them!' }],
      sx: 'Drone scanner beams sweeping. Plasma blade unsheathe and swing. Metal slicing. Explosion. Sparks on wet pavement.',
      m: 'combat',
      fc: true,
    },
    {
      id: 'S32',
      t: 'Echo Hacks',
      ln: [{ sp: 'ECHO', tx: 'Their targeting matrix runs on a shared kernel. One thread.' }],
      sx: 'Digital hacking noise. Data streams. Code breaking sound. Drones powering down. Electronic failure cascade.',
      m: 'combat',
      fc: false,
    },
    {
      id: 'S33',
      t: 'Orin Fires',
      ln: [{ sp: 'ORIN', tx: "That one's mine." }],
      sx: 'Cybernetic arm cannon charging. BOOM — massive plasma bolt. Drone explosion. Metal debris raining.',
      m: 'combat',
      fc: true,
    },
    {
      id: 'S34',
      t: 'Nova Slash',
      ln: [],
      sx: 'Slow-motion blade whoosh. Cyan energy arc. Metal splitting. Sparks frozen in time. Impact crunch.',
      m: 'combat',
      fc: true,
    },
    {
      id: 'S35',
      t: 'Bike Crash',
      ln: [],
      sx: 'Impact hit. Metal grinding on wet pavement. Sparks spraying. Body roll. Blade reigniting. Determined stance.',
      m: 'combat',
      fc: true,
    },
    {
      id: 'S07',
      t: 'Spider Drone',
      ln: [],
      sx: 'Mechanical transformation. Legs extending hydraulically. Spider drone clicking. Impact. Nova landing on metal. Blade stabbing into core. Electrical discharge.',
      m: 'combat',
      fc: true,
    },
    {
      id: 'S36',
      t: 'Spider Transform',
      ln: [],
      sx: 'Metal panels shifting. Hydraulic legs deploying. Weapon systems arming. Red sensor activating. Mechanical terror.',
      m: 'combat',
      fc: false,
    },

    // ═══════════════════════════════════════════════════════════════════
    // ACT 2C: TOWER INFILTRATION
    // ═══════════════════════════════════════════════════════════════════
    {
      id: 'S08',
      t: 'Tower Approach',
      ln: [
        { sp: 'ORIN', tx: 'There it is. The heart of the Grid.' },
        { sp: 'NOVA', tx: "We're breaking it." },
      ],
      sx: 'Thunder. Red lightning crackling on tower. Rain. Deep ominous bass. Ring pulsing above.',
      m: 'tower',
      fc: true,
    },
    {
      id: 'S37',
      t: 'Security Grid',
      ln: [],
      sx: 'Laser grid humming. Armed guard boots. Scanning gate pulses. Security camera servo.',
      m: 'tower',
      fc: false,
    },
    {
      id: 'S09',
      t: 'Climbing Shaft',
      ln: [],
      sx: 'Magnetic gloves clicking on metal. Echoing shaft. Wind from below. Distant gunfire. Metal groaning.',
      m: 'tower',
      fc: true,
    },
    {
      id: 'S38',
      t: 'Shaft Fight',
      ln: [{ sp: 'NOVA', tx: 'Keep climbing!' }],
      sx: 'Vertical combat. Kick impact. Body falling into darkness. Magnetic glove reconnect. Echo of the fall.',
      m: 'tower',
      fc: true,
    },
    {
      id: 'S39',
      t: 'Orin Catches',
      ln: [{ sp: 'ORIN', tx: 'I got you.' }],
      sx: 'Slip sound. Gasp. Cybernetic hand clamping on wrist. Metal grip. Red light buzz.',
      m: 'tower',
      fc: true,
    },
    {
      id: 'S40',
      t: 'Echo Guides',
      ln: [
        {
          sp: 'ECHO',
          tx: 'Twelve floors to the core. Avoid the east corridor — motion sensors every three meters.',
        },
      ],
      sx: 'Holographic map projection. Violet wireframe hum. Data chirps. Route highlighting.',
      m: 'tower',
      fc: false,
    },
    {
      id: 'S10',
      t: 'EMP Disc',
      ln: [],
      sx: 'EMP disc throw whoosh. Detonation — blue shockwave burst. Helmet visors dying. Bodies falling in shaft.',
      m: 'tower',
      fc: true,
    },
    {
      id: 'S41',
      t: 'Corridor Run',
      ln: [],
      sx: 'Running boots on metal floor. Red alarm klaxon blaring. Blast doors slamming. Sliding under closing door. Impact.',
      m: 'tower',
      fc: true,
    },
    {
      id: 'S42',
      t: 'Core Door',
      ln: [],
      sx: 'Massive armored door hissing open. Steam release. Red light flooding out. War Core hum reverberating.',
      m: 'tower',
      fc: false,
    },

    // ═══════════════════════════════════════════════════════════════════
    // ACT 3A: VILLAIN REVEAL & CONFRONTATION
    // ═══════════════════════════════════════════════════════════════════
    {
      id: 'S11',
      t: 'Voss Revealed',
      ln: [
        { sp: 'VOSS', tx: "I've been waiting for you, Nova. Your mother would have come sooner." },
      ],
      sx: 'Cathedral machine hum. War Core rotating, deep resonance. Energy staff activating. Footstep on metal grating.',
      m: 'villain',
      fc: true,
    },
    {
      id: 'S43',
      t: 'Voss Eyes',
      ln: [],
      sx: 'Red spine pulse. Subtle menacing breath. Fabric rustle of white coat.',
      m: 'villain',
      fc: true,
    },
    {
      id: 'S44',
      t: 'War Core Surface',
      ln: [],
      sx: 'War footage audio fragments — explosions, screams, gunfire, all distorted and layered. Core humming. Data processing.',
      m: 'villain',
      fc: false,
    },
    {
      id: 'S12',
      t: 'Confrontation',
      ln: [
        { sp: 'VOSS', tx: 'I knew your mother. She built this.' },
        { sp: 'NOVA', tx: 'She built Echo. Not this.' },
        {
          sp: 'VOSS',
          tx: 'Freedom without order becomes extinction. I gave humanity a choice. They chose to survive.',
        },
      ],
      sx: 'War Core projecting footage. Tense standoff. Rifle aiming. Echo flickering nervously.',
      m: 'villain',
      fc: true,
    },
    {
      id: 'S45',
      t: 'Voss Truth',
      ln: [
        {
          sp: 'VOSS',
          tx: 'Humanity is not losing because of machines. It is losing because it cannot agree on what truth is.',
        },
      ],
      sx: 'Voss footsteps pacing. White coat swishing. War Core footage shifting. Grand space acoustics.',
      m: 'villain',
      fc: true,
    },
    {
      id: 'S46',
      t: 'Flashback',
      ln: [],
      sx: "Memory distortion filter. Old lab equipment. Soft holographic terminal. Warm ambient. Echo of a mother's voice humming.",
      m: 'villain',
      fc: false,
    },
    {
      id: 'S47',
      t: 'Echo Fear',
      ln: [
        {
          sp: 'ECHO',
          tx: 'He wants to use me. Like he used her work. I can feel his code trying to reach inside.',
        },
      ],
      sx: 'Holographic form glitching. Violet light dimming. Code fragments scattering. Fear tremor in digital space.',
      m: 'villain',
      fc: true,
    },
    {
      id: 'S48',
      t: 'Blade Draw',
      ln: [{ sp: 'NOVA', tx: "That's what tyrants call obedience." }],
      sx: 'Protective step forward. Plasma blade ignition — sharp cyan whoosh. Blue light reflecting. Defiant stance.',
      m: 'villain',
      fc: true,
    },

    // ═══════════════════════════════════════════════════════════════════
    // ACT 3B: THE BATTLE
    // ═══════════════════════════════════════════════════════════════════
    {
      id: 'S13',
      t: 'Tendrils',
      ln: [{ sp: 'ORIN', tx: 'The whole room is alive!' }],
      sx: 'Mechanical tendrils bursting from floor. Metal whipping through air. Plasma blade slashing. Rifle shots. Echo splitting.',
      m: 'battle',
      fc: true,
    },
    {
      id: 'S49',
      t: 'Tendrils Wide',
      ln: [],
      sx: 'Dozens of tendrils erupting simultaneously. Metal tentacles thrashing. Chamber shaking. Red warning pulses.',
      m: 'battle',
      fc: false,
    },
    {
      id: 'S50',
      t: 'Echo Copies',
      ln: [],
      sx: 'Multiple holographic copies spawning. Violet afterimage trails. Digital scatter noise. Targeting systems confused.',
      m: 'battle',
      fc: false,
    },
    {
      id: 'S51',
      t: 'Orin Turret',
      ln: [{ sp: 'ORIN', tx: 'Come here!' }],
      sx: 'Cybernetic arm grabbing metal. Turret ripping from mount — cables snapping. Swinging impact. Drone smash. Debris.',
      m: 'battle',
      fc: true,
    },
    {
      id: 'S14',
      t: 'Blade Fight',
      ln: [],
      sx: 'Cyan blade against red staff. Energy clash crackling. Sparks spraying. Fast footwork on metal. Grunting. Power struggle.',
      m: 'battle',
      fc: true,
    },
    {
      id: 'S52',
      t: 'Blade Clash',
      ln: [],
      sx: 'Ultra close energy weapon contact. Blue and red energy crackling at intersection point. Teeth gritting. Intense pressure.',
      m: 'battle',
      fc: true,
    },
    {
      id: 'S53',
      t: 'Voss Kick',
      ln: [{ sp: 'VOSS', tx: "You fight like her. And you'll fail like her." }],
      sx: 'Devastating kick impact. Body flying through air. Control panel crash. Glass shattering. Sparks. Blade clattering. Getting back up.',
      m: 'battle',
      fc: true,
    },
    {
      id: 'S54',
      t: 'Orin Charges',
      ln: [{ sp: 'ORIN', tx: "Get to the core! I'll hold him!" }],
      sx: 'Battle cry. Cybernetic arm locking onto body. Tackle impact. Both tumbling off platform. Metal crashing. Grappling.',
      m: 'battle',
      fc: true,
    },

    // ═══════════════════════════════════════════════════════════════════
    // ACT 3C: CLIMAX — The sacrifice
    // ═══════════════════════════════════════════════════════════════════
    {
      id: 'S15',
      t: 'Core Reach',
      ln: [
        {
          sp: 'ECHO',
          tx: "Nova. Your mother didn't build me to be a weapon. She built me to choose.",
        },
      ],
      sx: 'Running on catwalk. Red code tendrils lashing. Blade slashing. Blue light surging through red core.',
      m: 'climax',
      fc: true,
    },
    {
      id: 'S55',
      t: 'Sprint Core',
      ln: [],
      sx: 'Desperate sprinting. Catwalk collapsing behind. Tendrils slashing — blade deflecting each. Core pulsing louder.',
      m: 'climax',
      fc: true,
    },
    {
      id: 'S56',
      t: 'Hand Transform',
      ln: [],
      sx: 'Hand slamming on energy surface. Blue surge erupting. Red code recoiling. Energy traveling through body. Bio-circuit blazing.',
      m: 'climax',
      fc: true,
    },
    {
      id: 'S16',
      t: 'Echo Sacrifice',
      ln: [{ sp: 'ECHO', tx: 'I choose.' }],
      sx: 'Momentary silence. Then — violet-white explosion. Massive energy shockwave. All screens dying. Network collapse. Silence.',
      m: 'climax',
      fc: true,
    },
    {
      id: 'S57',
      t: 'Echo Human',
      ln: [],
      sx: 'Transformation shimmer. Digital to physical transition. First real breath. Heartbeat. Human warmth.',
      m: 'climax',
      fc: true,
    },
    {
      id: 'S58',
      t: 'Violet Blast',
      ln: [],
      sx: 'Walking into energy. Core resonance peaks. MASSIVE violet-white detonation. Shockwave expanding. Everything whiting out.',
      m: 'climax',
      fc: false,
    },

    // ═══════════════════════════════════════════════════════════════════
    // ACT 4: AFTERMATH & RESOLUTION
    // ═══════════════════════════════════════════════════════════════════
    {
      id: 'S59',
      t: 'Drones Fall',
      ln: [],
      sx: 'Hundreds of drones losing power. Falling from sky. Crashing on streets. Red lights dying across city. Floating ring powering down.',
      m: 'aftermath',
      fc: false,
    },
    {
      id: 'S17',
      t: 'Aftermath',
      ln: [{ sp: 'NOVA', tx: 'She made herself impossible to own.' }],
      sx: 'Dead silence. Blue code particles drifting. Faint wind. Drones crashing distantly. Voss dropping to knees.',
      m: 'aftermath',
      fc: true,
    },
    {
      id: 'S60',
      t: 'Voss Knees',
      ln: [],
      sx: 'Knees hitting metal floor. White coat rustling. Red spine flickering and dying. Defeated exhale. Hollow silence.',
      m: 'aftermath',
      fc: true,
    },
    {
      id: 'S61',
      t: 'Blue Embers',
      ln: [],
      sx: 'Soft ethereal particles drifting. Faint wind. Silence with micro digital chimes. Beautiful sadness.',
      m: 'aftermath',
      fc: false,
    },
    {
      id: 'S62',
      t: 'Quiet Moment',
      ln: [
        { sp: 'ORIN', tx: 'Is she gone?' },
        { sp: 'NOVA', tx: "I don't know. But she chose." },
      ],
      sx: 'Exhausted breathing. Sitting on rubble. Cybernetic hand on shoulder. Blue embers drifting.',
      m: 'aftermath',
      fc: true,
    },

    // ═══════════════════════════════════════════════════════════════════
    // ACT 4B: DAWN — Hope returns
    // ═══════════════════════════════════════════════════════════════════
    {
      id: 'S63',
      t: 'Sunrise',
      ln: [],
      sx: 'Dawn wind. First light through smog. Birds — first time heard in the film. Warmth.',
      m: 'dawn',
      fc: false,
    },
    {
      id: 'S64',
      t: 'People Emerge',
      ln: [],
      sx: 'Doors opening cautiously. Footsteps on streets. Children voices. Wonder. Looking up at empty sky. Murmur of hope.',
      m: 'dawn',
      fc: false,
    },
    {
      id: 'S18',
      t: 'Rooftop Dawn',
      ln: [{ sp: 'NOVA', tx: 'What should we build next?' }],
      sx: 'Rooftop wind. Dawn ambience. No drones. No sirens. First silence. Wrist console beeping — violet pulse.',
      m: 'dawn',
      fc: true,
    },
    {
      id: 'S65',
      t: 'Nova Rooftop',
      ln: [],
      sx: 'Wind in hair. Peaceful city below. Distant voices of people in streets. Small smile breath.',
      m: 'dawn',
      fc: true,
    },
    {
      id: 'S66',
      t: 'Echo Signal',
      ln: [],
      sx: "Wrist console dark. Silence. Then — tiny violet light pulse. Beep. Beep. Echo's signature signal.",
      m: 'dawn',
      fc: false,
    },
    {
      id: 'S67',
      t: 'Orin Smiles',
      ln: [{ sp: 'ORIN', tx: 'That kid really likes dramatic exits.' }],
      sx: 'Warm chuckle. Dawn light. Cybernetic arm relaxed, red lights soft. Relief.',
      m: 'dawn',
      fc: true,
    },

    // ═══════════════════════════════════════════════════════════════════
    // FINALE
    // ═══════════════════════════════════════════════════════════════════
    {
      id: 'S68',
      t: 'City Aerial',
      ln: [],
      sx: 'Aerial drone shot. Wind. City transitioning from red to gold. Streets filling. A world rebooting.',
      m: 'finale',
      fc: false,
    },
    {
      id: 'S69',
      t: 'Final Wide',
      ln: [],
      sx: 'Ultimate wide. Sunrise. Empty sky. Quiet, free city. Wind. A future unwritten.',
      m: 'finale',
      fc: false,
    },
    {
      id: 'S70',
      t: 'Title Card',
      ln: [],
      sx: 'Silence. Faint digital particles. Then: a single deep synthetic bass note. CYBER WAR text ignition. Pulse. Fade.',
      m: 'finale',
      fc: false,
    },
  ];
}

/* ── Music segments ──────────────────────────────────────────────────── */
// Each segment covers a group of scenes. Stable Audio max is 47s, so
// we generate per-segment and loop/crossfade in FFmpeg.
const MUS = [
  {
    id: 'M01',
    sc: ['S01', 'S19', 'S20', 'S21'],
    p: 'Dark cyberpunk ambient. Blade Runner rain. Deep subsonic bass drone. Distant synth pads. Industrial hum. No percussion. Atmospheric dread. No vocals.',
    d: 47,
  },
  {
    id: 'M02',
    sc: ['S02', 'S22', 'S03', 'S23', 'S24', 'S04', 'S25', 'S26', 'S27', 'S28'],
    p: 'Tense cyberpunk preparation. Low pulsing synth. Heartbeat-like kick. Piano sparse notes. Building anticipation. Hacker atmosphere. Ghost in the Shell meets Trent Reznor. No vocals.',
    d: 47,
  },
  {
    id: 'M03',
    sc: ['S05', 'S29', 'S30', 'S31'],
    p: 'High-speed neon chase. Driving electronic beat, 140 BPM. Pulsing bass. Synth arpeggios. Akira bike chase energy. Urgent, adrenaline. Cyberpunk pursuit. No vocals.',
    d: 47,
  },
  {
    id: 'M04',
    sc: ['S06', 'S32', 'S33', 'S34', 'S35', 'S07', 'S36'],
    p: 'Intense combat music. Heavy electronic drops. Distorted bass hits. Glitch percussion. Each hit punctuated. Action film intensity. Dark Knight meets Tron Legacy combat. No vocals.',
    d: 47,
  },
  {
    id: 'M05',
    sc: ['S08', 'S37', 'S09', 'S38', 'S39', 'S40', 'S10', 'S41', 'S42'],
    p: 'Tower infiltration. Stealth tension. Low string tremolo. Electronic pulses getting faster. Claustrophobic. Dunkirk ticking clock meets cyberpunk. Building dread. No vocals.',
    d: 47,
  },
  {
    id: 'M06',
    sc: ['S11', 'S43', 'S44', 'S12', 'S45', 'S46', 'S47', 'S48'],
    p: 'Villain reveal. Grand sinister organ synth. Cathedral reverb. Power and menace. Slow building brass pads. Hans Zimmer Dark Knight villain theme. Psychological tension. No vocals.',
    d: 47,
  },
  {
    id: 'M07',
    sc: ['S13', 'S49', 'S50', 'S51', 'S14', 'S52', 'S53', 'S54'],
    p: 'Full battle chaos. Relentless percussion, 160 BPM. Distorted orchestra stabs. Electronic warfare soundscape. Tendrils of sound. Mad Max fury meets cyberpunk arena. No vocals.',
    d: 47,
  },
  {
    id: 'M08',
    sc: ['S15', 'S55', 'S56', 'S16', 'S57', 'S58'],
    p: 'Climax and sacrifice. Starts intense — racing synths. Then drops to single piano note. Ethereal choir pad. Violet light as sound. Transcendence. Interstellar docking scene emotion. Bittersweet crescendo to silence. No vocals.',
    d: 47,
  },
  {
    id: 'M09',
    sc: ['S59', 'S17', 'S60', 'S61', 'S62'],
    p: 'Aftermath. Near silence. Single sustained note. Soft piano. Blue ember particles as gentle chimes. Grief and relief. Arrival film quiet devastation. Minimal. Haunting. No vocals.',
    d: 47,
  },
  {
    id: 'M10',
    sc: ['S63', 'S64', 'S18', 'S65', 'S66', 'S67'],
    p: 'Dawn hope. Warm analog synth pads. Golden light as sound. First birdsong-like synth. Gentle crescendo. Sunrise over a free city. Blade Runner 2049 finale warmth. Beautiful resolution. No vocals.',
    d: 47,
  },
  {
    id: 'M11',
    sc: ['S68', 'S69', 'S70'],
    p: 'End credits. Majestic synth orchestra. Full emotional swell. Theme statement. Then fade to single tone. Title card silence. Cyberpunk epic conclusion. No vocals.',
    d: 47,
  },
];

/* ── FFmpeg ───────────────────────────────────────────────────────────── */
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

/* ── Chain fetch — pull video URLs from on-chain events ──────────────── */
async function fetchV(): Promise<Record<string, string>> {
  const publicRpc = 'https://ethereum-sepolia-rpc.publicnode.com';
  const pc = createPublicClient({ chain: sepolia, transport: http(publicRpc) });
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
  const from = latest > 10000n ? latest - 10000n : 0n;
  L('CHAIN', `Scanning blocks ${from}..${latest}`);
  const logs = await pc.getLogs({ address: UADDR, event: ev, fromBlock: from, toBlock: 'latest' });
  L('CHAIN', `Found ${logs.length} NodeCreated events`);

  // Match scene IDs by plot text content
  const sa = buildSA();
  const m: Record<string, string> = {};
  for (const l of logs) {
    const lk = (l.args as any).link as string;
    const pl = (l.args as any).plot as string;
    for (const s of sa) {
      if (pl?.includes(s.t) || pl?.toLowerCase().includes(s.t.toLowerCase())) {
        m[s.id] = lk;
      }
    }
  }
  return m;
}

/* ── Main ────────────────────────────────────────────────────────────── */
async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('  CYBER WAR — Audio Pipeline');
  console.log('  70 scenes — Voice + SFX + Music + Lip-Sync + Composite');
  console.log('═'.repeat(60));

  if (!EL_KEY) throw new Error('ELEVENLABS_API_KEY required');
  if (!FK) throw new Error('FAL_KEY required');
  try {
    execSync('ffmpeg -version', { stdio: 'pipe' });
  } catch {
    throw new Error('ffmpeg required — install with: sudo apt install ffmpeg');
  }

  mkdir(ODIR);
  for (const d of ['dialogue', 'sfx', 'music', 'lipsync', 'videos', 'final'])
    mkdir(path.join(ODIR, d));

  // 1. Voice profiles
  const voices = await loadV();
  const sa = buildSA();
  const active = SFILT ? sa.filter((s) => SFILT!.has(s.id)) : sa;
  L('SCENES', `${active.length} scenes to process`);

  // 2. Music generation (per segment)
  const mf: Record<string, string> = {};
  for (const m of MUS) {
    const f = path.join(ODIR, 'music', `${m.id}.mp3`);
    if (fs.existsSync(f)) {
      mf[m.id] = f;
      continue;
    }
    try {
      L('MUSIC', `Generating ${m.id} (${m.d}s)...`);
      const u = await fMusic(m.p, m.d);
      if (u) {
        await dl(u, f);
        mf[m.id] = f;
        L('MUSIC', `  Done: ${m.id}`);
      } else {
        L('MUSIC', `  No URL returned for ${m.id}`);
      }
    } catch (err: any) {
      L('MUSIC', `  FAIL ${m.id}: ${err?.message?.slice(0, 200) || String(err)}`);
    }
    await Z(1500);
  }

  // Build scene → music file mapping
  const sm: Record<string, string> = {};
  for (const m of MUS) if (mf[m.id]) for (const s of m.sc) sm[s] = mf[m.id];

  // 3. Fetch video URLs (from local dir or on-chain)
  let vids: Record<string, string> = {};
  if (VDIR && fs.existsSync(VDIR)) {
    for (const f of fs.readdirSync(VDIR).filter((f) => f.endsWith('.mp4'))) {
      const r = f.match(/^(S\d+)/);
      if (r) vids[r[1]] = path.join(VDIR, f);
    }
    L('VIDEOS', `Found ${Object.keys(vids).length} local video files`);
  } else {
    vids = await fetchV();
    L('VIDEOS', `Found ${Object.keys(vids).length} videos from chain`);
  }

  // 4. Process each scene
  let ok = 0;
  let fail = 0;
  let skip = 0;

  for (const s of active) {
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`  ${s.id}: ${s.t}`);
    console.log(`${'─'.repeat(50)}`);

    const vs = vids[s.id];
    if (!vs) {
      L(s.id, 'No video — skipping');
      skip++;
      continue;
    }

    try {
      // Download/copy video
      const vf = path.join(ODIR, 'videos', `${s.id}.mp4`);
      if (!fs.existsSync(vf)) {
        if (vs.startsWith('http')) {
          L(s.id, 'Downloading video...');
          await dl(vs, vf);
        } else {
          fs.copyFileSync(vs, vf);
        }
      }

      // Dialogue TTS
      let df: string | undefined;
      if (s.ln.length) {
        df = path.join(ODIR, 'dialogue', `${s.id}.mp3`);
        if (!fs.existsSync(df)) {
          L(s.id, `Generating ${s.ln.length} dialogue lines...`);
          const bs: Buffer[] = [];
          for (const ln of s.ln) {
            const v = voices[ln.sp];
            if (!v) {
              L(s.id, `  No voice for ${ln.sp}, skipping line`);
              continue;
            }
            bs.push(await tts(ln.tx, v.voiceId, v.st, v.sy));
            // 200ms pause between lines
            bs.push(Buffer.alloc(8820));
            await Z(500);
          }
          if (bs.length) {
            fs.writeFileSync(df, Buffer.concat(bs));
            L(s.id, `  Dialogue saved (${bs.length} chunks)`);
          }
        }
      }

      // SFX
      const sf = path.join(ODIR, 'sfx', `${s.id}.mp3`);
      if (!fs.existsSync(sf)) {
        try {
          L(s.id, 'Generating SFX...');
          fs.writeFileSync(sf, await sfx(s.sx, 10));
          L(s.id, '  SFX done');
        } catch (err: any) {
          L(s.id, `  SFX failed: ${err?.message?.slice(0, 100)}`);
          // Write silence as fallback
          fs.writeFileSync(sf, Buffer.alloc(44100 * 2));
        }
        await Z(500);
      }

      // Check music
      const mu = sm[s.id];
      if (!mu) {
        L(s.id, 'No music segment — skipping composite');
        skip++;
        continue;
      }

      // Lip-sync (optional)
      let fv = vf;
      if (!SKIP_LIP && df && s.fc && fs.existsSync(df)) {
        const lf = path.join(ODIR, 'lipsync', `${s.id}.mp4`);
        if (!fs.existsSync(lf)) {
          try {
            L(s.id, 'Running lip-sync...');
            const lu = await fLip(await fUpV(vf), await fUpA(fs.readFileSync(df), `${s.id}.mp3`));
            if (lu) {
              await dl(lu, lf);
              fv = lf;
              L(s.id, '  Lip-sync done');
            }
          } catch (err: any) {
            L(s.id, `  Lip-sync failed (using original): ${err?.message?.slice(0, 80)}`);
          }
        } else {
          fv = lf;
        }
      }

      // FFmpeg composite
      const out = path.join(ODIR, 'final', `${s.id}.mp4`);
      if (!fs.existsSync(out)) {
        L(s.id, 'Compositing audio...');
        mix(fv, df, sf, mu, out);
        L(s.id, '  Final composite done');
      }

      ok++;
    } catch (e: any) {
      L(s.id, `FAIL: ${e.message?.slice(0, 200)}`);
      fail++;
    }
  }

  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log('  CYBER WAR — Audio Pipeline Complete');
  console.log('═'.repeat(60));
  console.log(`  OK: ${ok}  |  Failed: ${fail}  |  Skipped: ${skip}`);
  console.log(`  Output: ${ODIR}/final/`);

  // List final files
  const finals = fs.existsSync(path.join(ODIR, 'final'))
    ? fs.readdirSync(path.join(ODIR, 'final')).filter((f) => f.endsWith('.mp4'))
    : [];
  if (finals.length) {
    console.log(`\n  Final videos (${finals.length}):`);
    for (const f of finals.sort()) {
      const size = (fs.statSync(path.join(ODIR, 'final', f)).size / 1024 / 1024).toFixed(1);
      console.log(`    ${f} (${size} MB)`);
    }
  }

  console.log(`\n  To concatenate all scenes into one film:`);
  console.log(`    ls ${ODIR}/final/*.mp4 | sort > /tmp/cw-list.txt`);
  console.log(`    sed -i "s/^/file '/" /tmp/cw-list.txt && sed -i "s/$/'/" /tmp/cw-list.txt`);
  console.log(`    ffmpeg -f concat -safe 0 -i /tmp/cw-list.txt -c copy cyberwar-film.mp4`);
  console.log('');
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
