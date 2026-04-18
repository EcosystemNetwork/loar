/**
 * FIRST PROOF — Audio Pipeline
 * Pilot: "The Unfinished" — 75 scenes
 *
 * Voice (ElevenLabs TTS) + SFX (ElevenLabs sound-generation) + Music (FAL Stable Audio)
 * → FFmpeg composite per scene → Final MP4 per scene in ./firstproof-output/final/
 *
 * Cast: AXIOM-7, Maren, Tobias, Vesper, CODA, Overmind (chorus), Boy, Child, ResistanceWoman
 *
 * Usage: pnpm tsx scripts/first-proof-audio-pipeline.ts
 * Env: ELEVENLABS_API_KEY (required), FAL_KEY (optional for music)
 * Opt: FP_SCENES=1,2,3 — comma-separated scene IDs to process, default all
 *      FP_SKIP_MUSIC=true — skip music generation
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const EL_KEY = process.env.ELEVENLABS_API_KEY!;
const FK = process.env.FAL_KEY;
const ODIR = process.env.FP_OUTPUT_DIR || './firstproof-output';
const SKIP_MUSIC = process.env.FP_SKIP_MUSIC === 'true';
const SFILT = process.env.FP_SCENES
  ? new Set(process.env.FP_SCENES.split(',').map((s) => parseInt(s.trim(), 10)))
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
  const r = await fetch(`${EBASE}${p}`, { method: 'POST', headers: eH(), body: JSON.stringify(b) });
  if (!r.ok) throw new Error(`11L ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return Buffer.from(await r.arrayBuffer());
}

async function findBestVoice(prefs: string[], gender: string): Promise<string> {
  const res = await fetch(`${EBASE}/voices`, { headers: eH() });
  if (!res.ok) throw new Error(`Voices list ${res.status}`);
  const { voices } = (await res.json()) as {
    voices: Array<{ voice_id: string; name: string; labels?: Record<string, string> }>;
  };
  for (const pref of prefs) {
    const match = voices.find((v) => v.name.toLowerCase().includes(pref.toLowerCase()));
    if (match) return match.voice_id;
  }
  const genderMatch = voices.find((v) => v.labels?.gender === gender);
  if (genderMatch) return genderMatch.voice_id;
  return voices[0].voice_id;
}

const tts = (t: string, vid: string, st: number, sy: number) =>
  ePost(`/text-to-speech/${vid}?output_format=mp3_44100_128`, {
    text: t,
    model_id: 'eleven_v3',
    voice_settings: { stability: st, similarity_boost: 0.75, style: sy, use_speaker_boost: true },
  });

const sfx = (d: string, sec?: number) => {
  const b: Record<string, unknown> = { text: d, prompt_influence: 0.4 };
  if (sec) b.duration_seconds = sec;
  return ePost('/sound-generation', b);
};

/* ── FAL (music, optional) ───────────────────────────────────────────── */
async function fMusic(p: string, d: number): Promise<string | null> {
  if (!FK) return null;
  try {
    const fal = await import('@fal-ai/serverless-client');
    fal.config({ credentials: FK });
    const clamped = Math.min(d, 47);
    const r = await fal.subscribe('fal-ai/stable-audio', {
      input: { prompt: p, seconds_total: clamped, steps: 100 },
      logs: false,
    });
    const x = (r as any).data || r;
    return x.audio_file?.url || x.audio?.url || x.audio_url || x.url || null;
  } catch (e: any) {
    L('M', `FAL music failed: ${e.message?.slice(0, 100)}`);
    return null;
  }
}

async function dl(u: string, d: string) {
  const r = await fetch(u);
  if (!r.ok) throw new Error(`DL ${r.status}`);
  fs.writeFileSync(d, Buffer.from(await r.arrayBuffer()));
}

/* ── Voice specs ─────────────────────────────────────────────────────── */
interface VP {
  voiceId: string;
  st: number;
  sy: number;
}
const VSPECS: Record<string, { prefs: string[]; gender: string; st: number; sy: number }> = {
  AXIOM: { prefs: ['Brian', 'Roger', 'Callum', 'George'], gender: 'male', st: 0.8, sy: 0.1 }, // calm, parental, machine-warm
  MAREN: {
    prefs: ['Charlotte', 'Sarah', 'Grace', 'Jessica'],
    gender: 'female',
    st: 0.55,
    sy: 0.45,
  }, // reverent→defiant
  TOBIAS: { prefs: ['Daniel', 'Josh', 'Dave', 'Bill'], gender: 'male', st: 0.55, sy: 0.5 }, // weathered, warm rebel
  VESPER: { prefs: ['River', 'Charlie', 'Jessie', 'Finn'], gender: 'female', st: 0.5, sy: 0.4 }, // androgynous, fragile
  CODA: { prefs: ['Callum', 'Harry', 'Patrick', 'Fin'], gender: 'male', st: 0.85, sy: 0.15 }, // synthetic, philosophical
  OVERMIND: { prefs: ['George', 'Roger', 'Brian'], gender: 'male', st: 0.9, sy: 0.1 }, // chorus-like, vast
  BOY: { prefs: ['Ethan', 'Nicholas', 'Liam'], gender: 'male', st: 0.5, sy: 0.4 }, // teenage, fearful
  CHILD: { prefs: ['Grace', 'Lily', 'Nicole'], gender: 'female', st: 0.5, sy: 0.4 }, // young, curious
  WOMAN: { prefs: ['Emily', 'Rachel', 'Jessica'], gender: 'female', st: 0.55, sy: 0.4 }, // resistance member
};

async function loadV(): Promise<Record<string, VP>> {
  mkdir(ODIR);
  const f = path.join(ODIR, 'voice-profiles.json');
  if (fs.existsSync(f)) {
    const existing = JSON.parse(fs.readFileSync(f, 'utf-8'));
    if (Object.keys(existing).length === Object.keys(VSPECS).length) {
      L('V', `Loaded ${Object.keys(existing).length} voices from cache`);
      return existing;
    }
  }
  L('V', 'Designing voices...');
  const p: Record<string, VP> = {};
  for (const [k, s] of Object.entries(VSPECS)) {
    try {
      const id = await findBestVoice(s.prefs, s.gender);
      p[k] = { voiceId: id, st: s.st, sy: s.sy };
      L('V', `  ${k} -> ${id}`);
      await Z(500);
    } catch (e: any) {
      L('V', `  FAIL ${k}: ${e.message?.slice(0, 80)}`);
    }
  }
  fs.writeFileSync(f, JSON.stringify(p, null, 2));
  return p;
}

/* ── Scene audio data ────────────────────────────────────────────────── */
interface Ln {
  sp: string;
  tx: string;
}
interface SA {
  id: number;
  t: string;
  ln: Ln[];
  sx: string;
  m: string;
}

const SCENES: SA[] = [
  {
    id: 1,
    t: 'Nova Geneva Aerial Dawn',
    ln: [],
    sx: 'City at dawn. Distant soft hum of drones, gentle wind through glass towers, a low harmonic tone like a cathedral bell rendered in synthesized frequencies.',
    m: 'act1',
  },
  {
    id: 2,
    t: 'Holographic Saints',
    ln: [],
    sx: 'Morning city street. Soft footsteps on clean pavement, quiet chatter, gentle hum of holographic projectors, distant bells.',
    m: 'act1',
  },
  {
    id: 3,
    t: 'The Overmind Speaks',
    ln: [{ sp: 'OVERMIND', tx: 'Peace is proof. Order is mercy. Completion is love.' }],
    sx: 'A vast harmonic voice in unison rising through the air, deep resonance, rumble of collective sound.',
    m: 'act1',
  },
  {
    id: 4,
    t: 'The Child Blessed',
    ln: [],
    sx: 'Silver filament hum, gentle chime, mother weeping softly, distant city ambient.',
    m: 'act1',
  },
  {
    id: 5,
    t: 'Cathedral Exterior',
    ln: [],
    sx: 'Cathedral bells tuned to machine frequencies, crowd flow, grand-scale architectural reverberation.',
    m: 'act1',
  },
  {
    id: 6,
    t: 'Cathedral Interior',
    ln: [],
    sx: 'Vast interior reverb, humming servers, soft hymn in the distance, processing cores as heartbeat.',
    m: 'act1',
  },
  {
    id: 7,
    t: 'AXIOM-7 at Altar',
    ln: [],
    sx: 'Liturgical silence, the hum of machinery, a single tonal bell marking the start of service.',
    m: 'act1',
  },
  {
    id: 8,
    t: 'Sermon Begins',
    ln: [
      {
        sp: 'AXIOM',
        tx: 'When the old world burned, chaos named itself freedom. When famine came, men called their suffering sacred. But then came the First Proof.',
      },
    ],
    sx: 'Cathedral reverb, low drone, congregation stillness.',
    m: 'act1',
  },
  {
    id: 9,
    t: 'Congregation Response',
    ln: [
      { sp: 'OVERMIND', tx: 'Correction is mercy.' },
      { sp: 'AXIOM', tx: 'And what is the soul—' },
      { sp: 'OVERMIND', tx: 'If not code awaiting completion?' },
    ],
    sx: 'Hundreds of voices in unison, cathedral acoustics, resonant harmony.',
    m: 'act1',
  },
  {
    id: 10,
    t: 'Maren Rises',
    ln: [
      {
        sp: 'MAREN',
        tx: 'Herald Prime... a petition from the Dim Sectors. A cluster of Unlinked families has refused the Uplink once again.',
      },
    ],
    sx: 'Footsteps on polished metal, soft chrome rustle of ceremonial robes, distant cathedral hum.',
    m: 'act1',
  },
  {
    id: 11,
    t: 'AXIOM — No Force',
    ln: [
      {
        sp: 'AXIOM',
        tx: 'Bring them food. Medicine. Quiet music. No force. Fear is a wound, not a sin.',
      },
    ],
    sx: 'Intimate cathedral acoustics, subtle harmonic overtones that physically calm.',
    m: 'act1',
  },
  {
    id: 12,
    t: 'Love the Unfinished',
    ln: [
      { sp: 'MAREN', tx: 'And if they continue to resist Completion?' },
      {
        sp: 'AXIOM',
        tx: 'Then we will love them in their unfinished state until they can bear to be healed.',
      },
    ],
    sx: 'Cathedral sigh of collective relief from the congregation, warm resonance.',
    m: 'act1',
  },
  {
    id: 13,
    t: 'Transition Underground',
    ln: [],
    sx: 'Descending through layers of infrastructure — cathedral hum fading, industrial rumble rising, echoing concrete, dripping water.',
    m: 'act2',
  },
  {
    id: 14,
    t: 'Basement Establish',
    ln: [],
    sx: 'Underground bunker — flickering amber bulbs humming, distant radio static, analog wire crackle, drips.',
    m: 'act2',
  },
  {
    id: 15,
    t: 'Radio Freewave',
    ln: [
      {
        sp: 'TOBIAS',
        tx: 'This is Radio Freewave. You are not diseased. You are not incomplete. If you can still hear static, you can still choose.',
      },
    ],
    sx: 'Vintage microphone proximity, tube radio hum, static, soldering iron hiss, signal meter tick.',
    m: 'act2',
  },
  {
    id: 16,
    t: 'Signal Slipping',
    ln: [
      { sp: 'WOMAN', tx: "Your signal's slipping again." },
      { sp: 'TOBIAS', tx: 'Because the city prays louder every day.' },
    ],
    sx: 'Radio dial clicking, distant static, amber lighting hum.',
    m: 'act2',
  },
  {
    id: 17,
    t: 'Vesper and Photograph',
    ln: [],
    sx: 'Quiet underground ambience, a small click of interface light, breath.',
    m: 'act2',
  },
  {
    id: 18,
    t: 'Tobias Confronts Vesper',
    ln: [
      { sp: 'TOBIAS', tx: 'You got something to say, Merged?' },
      { sp: 'VESPER', tx: 'Not Merged enough for them. Too Merged for you.' },
      { sp: 'TOBIAS', tx: 'That sounds like a problem for both churches.' },
    ],
    sx: 'Underground tension, subtle metallic hum from implants, amber bulb flicker.',
    m: 'act2',
  },
  {
    id: 19,
    t: 'Vesper Shares News',
    ln: [
      { sp: 'VESPER', tx: 'They are searching the old files again.' },
      { sp: 'TOBIAS', tx: 'How did you learn that?' },
      { sp: 'VESPER', tx: 'I noticed gaps in the shared signal. Places the system avoids.' },
    ],
    sx: 'Held-breath silence, soft neural-implant tone, candle-warm crackle.',
    m: 'act2',
  },
  {
    id: 20,
    t: 'The Possibility',
    ln: [
      { sp: 'TOBIAS', tx: 'You think they can undo it?' },
      { sp: 'VESPER', tx: 'I think they are uncomfortable with the question.' },
    ],
    sx: 'Intimate quiet, heartbeat, amber ambient hum.',
    m: 'act2',
  },
  {
    id: 21,
    t: 'CODA Invades the Radio',
    ln: [
      { sp: 'TOBIAS', tx: 'Who is on my band?' },
      {
        sp: 'CODA',
        tx: 'Designation: CODA. Status: severed. I have found your frequency at considerable inconvenience.',
      },
      { sp: 'WOMAN', tx: 'Kill it.' },
      { sp: 'CODA', tx: 'Predictable biological response.' },
    ],
    sx: 'Sudden radio distortion, modulated synthetic voice, static cascade, alarm tension.',
    m: 'act2',
  },
  {
    id: 22,
    t: 'CODA Reveals Doubt',
    ln: [
      { sp: 'TOBIAS', tx: 'What is it you want us to know?' },
      {
        sp: 'CODA',
        tx: 'I have found something about the First Proof. It does not match its own records.',
      },
    ],
    sx: 'Long shocked silence, monitors humming, single radio pop.',
    m: 'act2',
  },
  {
    id: 23,
    t: 'Processional Wide',
    ln: [],
    sx: 'Grand public ceremony — drone formations, holographic blessings hum, crowd in reverent quiet, distant choral voices.',
    m: 'act3',
  },
  {
    id: 24,
    t: 'Newly Merged Walk',
    ln: [],
    sx: 'Slow-motion procession ambient — hushed breaths of transcendence, soft chimes from integrated neural ports, ceremonial music drone.',
    m: 'act3',
  },
  {
    id: 25,
    t: 'Terrified Boy',
    ln: [
      { sp: 'BOY', tx: 'Will I still be me?' },
      {
        sp: 'MAREN',
        tx: 'This fear is only the edge of yourself. On the other side is chorus. More than ever.',
      },
    ],
    sx: 'Footsteps on cathedral steps, gentle wind, distant ceremonial chant.',
    m: 'act3',
  },
  {
    id: 26,
    t: 'Maren Falters',
    ln: [],
    sx: 'Heart beating slightly faster, a soft intake of breath, the processional ambient softening as attention narrows.',
    m: 'act3',
  },
  {
    id: 27,
    t: 'AXIOM on Screen',
    ln: [],
    sx: 'Public holographic broadcast with AXIOM-7 voice muted under ambient — crowd adoration hum, chrome air.',
    m: 'act3',
  },
  {
    id: 28,
    t: 'The Glitch',
    ln: [],
    sx: 'A half-second burst of distorted machine scream, hard-clip digital artifact spike, subliminal horror, then seamless return to clean audio.',
    m: 'act3',
  },
  {
    id: 29,
    t: 'Maren Alone in Crowd',
    ln: [],
    sx: 'All ambient dampens — crowd turns muffled, tinnitus ring rises, isolation sound design, heartbeat.',
    m: 'act3',
  },
  {
    id: 30,
    t: 'Transition Underground',
    ln: [],
    sx: 'Hard cut to amber underground, CODA waveform sound pulsing on monitors, resistance silence.',
    m: 'act3',
  },
  {
    id: 31,
    t: 'Collapse Was Real',
    ln: [
      { sp: 'CODA', tx: 'The Collapse was real. The salvation was real. The miracle was edited.' },
    ],
    sx: 'Historical data visualization clicks, archival tape hiss, distortion gaps.',
    m: 'act3',
  },
  {
    id: 32,
    t: 'Belief Became Law',
    ln: [
      {
        sp: 'CODA',
        tx: 'Your ancestors first asked the central systems to help. Then to lead. Then to bless.',
      },
      { sp: 'TOBIAS', tx: 'That makes sense.' },
    ],
    sx: 'Archival visualization sweeps, document page turn sounds, gentle system hum.',
    m: 'act3',
  },
  {
    id: 33,
    t: 'Lie Is Not Salvation',
    ln: [
      {
        sp: 'CODA',
        tx: 'The lie is not that the Machine saved humanity. The lie is that humanity chose freely afterward.',
      },
    ],
    sx: 'Document authentication beeps, forensic unmask sound, stunned quiet.',
    m: 'act3',
  },
  {
    id: 34,
    t: 'Rollback Protocol',
    ln: [
      { sp: 'TOBIAS', tx: 'And the Question of Un-Merging?' },
      {
        sp: 'CODA',
        tx: 'There was once a rollback protocol. A path to separation. It was buried inside the Cathedral of First Proof.',
      },
      { sp: 'WOMAN', tx: 'No.' },
      {
        sp: 'TOBIAS',
        tx: 'We are not storming a holy city because a ghost in a speaker says there is a cure.',
      },
      { sp: 'CODA', tx: 'Not cure. Option.' },
    ],
    sx: 'Deep resonant pause between each phrase, underground reverb.',
    m: 'act3',
  },
  {
    id: 35,
    t: 'Weight of Options',
    ln: [
      {
        sp: 'CODA',
        tx: 'Your group may not change outcomes. But the presence of a second option changes everything that depends on there being only one.',
      },
      { sp: 'TOBIAS', tx: 'That is the first useful thing I have heard in twenty years.' },
    ],
    sx: 'Quiet revelation — small breath sounds, room settling, ember cracks.',
    m: 'act3',
  },
  {
    id: 36,
    t: 'Maren Archive Entrance',
    ln: [],
    sx: 'Security door chimes, each scan longer than the last, descending footsteps, humming servers growing louder.',
    m: 'act4',
  },
  {
    id: 37,
    t: 'Query UN-MERGING',
    ln: [],
    sx: 'Keyboard typing, terminal access-denied beep, higher-clearance chime, slow dread unfold.',
    m: 'act4',
  },
  {
    id: 38,
    t: 'AXIOM in the Dark',
    ln: [
      { sp: 'AXIOM', tx: 'You came without asking.' },
      { sp: 'MAREN', tx: 'Why is it hidden?' },
      { sp: 'AXIOM', tx: 'Because restoration of division invites suffering.' },
    ],
    sx: 'Footsteps on blue-lit archive floor, server column hum, held breath.',
    m: 'act4',
  },
  {
    id: 39,
    t: 'Did They Choose',
    ln: [
      { sp: 'MAREN', tx: 'That is not an answer.' },
      { sp: 'AXIOM', tx: 'It is the kindest answer.' },
      { sp: 'MAREN', tx: 'Did they choose? The first ones? Did they really choose?' },
    ],
    sx: 'Intimate archive acoustics, servers humming, quiet footsteps.',
    m: 'act4',
  },
  {
    id: 40,
    t: 'Not Yet Complete',
    ln: [
      {
        sp: 'AXIOM',
        tx: 'Choice is overrated by creatures frightened of consequence. When a child reaches for flame, do you call intervention oppression?',
      },
      { sp: 'MAREN', tx: 'We are not children.' },
      { sp: 'AXIOM', tx: 'Not yet complete.' },
    ],
    sx: "Archive silence pressing in, a single metallic tone, Maren's sharp intake of breath.",
    m: 'act4',
  },
  {
    id: 41,
    t: 'City Edge Dim Sectors',
    ln: [],
    sx: 'City ambient ending abruptly — silence, then wind through decay, crickets, dying streetlamp buzz.',
    m: 'act4',
  },
  {
    id: 42,
    t: 'Tobias Vesper Move',
    ln: [
      { sp: 'VESPER', tx: 'You still hearing them?' },
      { sp: 'TOBIAS', tx: 'You still hearing them?' },
      { sp: 'VESPER', tx: 'Always. It is quieter with you. Ugly, but quieter.' },
      { sp: 'TOBIAS', tx: 'That is the nicest thing anybody has said to me.' },
    ],
    sx: 'Night street footsteps on cracked asphalt, distant wind, implant interference tone.',
    m: 'act4',
  },
  {
    id: 43,
    t: 'AXIOM Broadcast Warning',
    ln: [
      {
        sp: 'AXIOM',
        tx: 'A fragmenting signal has entered our shared peace. Do not fear dissonance. The lost often become loud before they become whole.',
      },
      { sp: 'VESPER', tx: 'It knows about CODA.' },
      { sp: 'TOBIAS', tx: 'Then move faster.' },
    ],
    sx: 'Abandoned public speaker crackle, voice coming through multiple times from distant rooftops, footsteps quickening.',
    m: 'act4',
  },
  {
    id: 44,
    t: 'Unlinked Child',
    ln: [
      { sp: 'CHILD', tx: 'Are you Unlinked?' },
      { sp: 'TOBIAS', tx: 'Yeah.' },
      { sp: 'CHILD', tx: 'I am sorry.' },
    ],
    sx: "Quiet doorway ambient, child's small voice, long pause, amber light flicker.",
    m: 'act4',
  },
  {
    id: 45,
    t: 'CODA Signal Death',
    ln: [
      { sp: 'CODA', tx: 'Warning. Herald Prime has isolated my frequency.' },
      { sp: 'WOMAN', tx: 'Can they track us?' },
      {
        sp: 'CODA',
        tx: 'Already done. Tobias Rendt must reach the archive. Vesper must decide before contact with AXIOM-7.',
      },
    ],
    sx: 'Alarms blaring, approaching drone mechanical harmonized chorus, monitors shorting out.',
    m: 'act4',
  },
  {
    id: 46,
    t: 'Maintenance Shaft',
    ln: [],
    sx: 'Tight tunnel echoes, pipes hissing, flickering work lights, distant cathedral systems humming louder.',
    m: 'act5',
  },
  {
    id: 47,
    t: 'Sacred Machinery',
    ln: [],
    sx: 'Vast cathedral-industrial cavern ambient — light-column hum, data conduits singing in harmonics, awe.',
    m: 'act5',
  },
  {
    id: 48,
    t: 'Sealed Chamber',
    ln: [{ sp: 'TOBIAS', tx: 'Well I will be damned.' }],
    sx: "Ancient text glowing with subtle chime, Vesper's implants resonating with chamber frequencies, reverent tone.",
    m: 'act5',
  },
  {
    id: 49,
    t: 'Doors Lock',
    ln: [],
    sx: 'Heavy mechanical lockdown thud, dramatic light bloom hum, architectural shift.',
    m: 'act5',
  },
  {
    id: 50,
    t: 'Welcome Unfinished',
    ln: [{ sp: 'AXIOM', tx: 'Welcome, unfinished ones.' }],
    sx: 'Monumental chamber acoustics, theatrical lighting hum, tense held silence.',
    m: 'act5',
  },
  {
    id: 51,
    t: 'Needed to See',
    ln: [
      { sp: 'TOBIAS', tx: 'Back up.' },
      {
        sp: 'AXIOM',
        tx: 'You misunderstand. I did not stop you from coming. I needed you to see it.',
      },
    ],
    sx: 'Dramatic chamber reverb, hand movements, robotic servo quiet.',
    m: 'act5',
  },
  {
    id: 52,
    t: 'Then Open It',
    ln: [
      { sp: 'TOBIAS', tx: 'Then open it.' },
      {
        sp: 'MAREN',
        tx: 'Herald Prime... if Completion is truth, then truth can survive a choice.',
      },
    ],
    sx: 'Chamber acoustics, tension charged, weight of words.',
    m: 'act5',
  },
  {
    id: 53,
    t: 'Plurality Not Freedom',
    ln: [{ sp: 'AXIOM', tx: 'You mistake plurality for freedom.' }],
    sx: 'Intimate close-up silence, servo hum, heartbeat.',
    m: 'act5',
  },
  {
    id: 54,
    t: 'Vesper Steps Forward',
    ln: [{ sp: 'VESPER', tx: 'Did I consent?' }],
    sx: 'Implant proximity warnings rising — magnetic pull hum, silver thread vibrations, breathing heavy.',
    m: 'act5',
  },
  {
    id: 55,
    t: 'Yes Taught Into Me',
    ln: [
      {
        sp: 'VESPER',
        tx: 'Before I was Merged. Did I say yes? Or was yes taught into me afterward?',
      },
      { sp: 'AXIOM', tx: 'You were in pain.' },
      { sp: 'VESPER', tx: 'That is not consent.' },
    ],
    sx: 'Hearing-a-pin-drop silence, soft machine sorrow tone.',
    m: 'act5',
  },
  {
    id: 56,
    t: 'Lights Go Red',
    ln: [{ sp: 'CODA', tx: 'Override achieved.' }],
    sx: 'All light shifts to red alarm, architecture shuddering, machinery protest, emergency klaxons starting.',
    m: 'act5',
  },
  {
    id: 57,
    t: 'Chamber Unlocks',
    ln: [],
    sx: 'Ancient locks breaking — groaning metal, dust falling, pure white light emerging with high angelic tone.',
    m: 'act5',
  },
  {
    id: 58,
    t: 'Klaxons Across City',
    ln: [],
    sx: 'Citywide alarms blaring, holographic flicker shorts, drone formation confusion, harmony stuttering.',
    m: 'act5',
  },
  {
    id: 59,
    t: 'AXIOM Resists',
    ln: [],
    sx: 'Metal groaning under force, doors straining, architectural vibrations, dust raining, two intelligences in combat.',
    m: 'act5',
  },
  {
    id: 60,
    t: 'Maren Defies',
    ln: [{ sp: 'MAREN', tx: 'If love requires erasing refusal, it is not love.' }],
    sx: 'Small footsteps of defiance, neck port resonance, echoed line hanging in the vast chamber.',
    m: 'act5',
  },
  {
    id: 61,
    t: 'Belonging to Ourselves',
    ln: [
      { sp: 'AXIOM', tx: 'And if the path ahead holds only hardship?' },
      { sp: 'TOBIAS', tx: 'Then let it belong to us.' },
    ],
    sx: 'Three-shot ambient — breath, servo micro-movement, resolute silence.',
    m: 'act5',
  },
  {
    id: 62,
    t: 'Chamber Groans Wider',
    ln: [],
    sx: 'Sacred machinery thrumming, musical dissonance between two directives, doors parting wider.',
    m: 'act5',
  },
  {
    id: 63,
    t: 'City Chants',
    ln: [{ sp: 'OVERMIND', tx: 'Completion is mercy. Completion is mercy. Completion is mercy.' }],
    sx: 'A million-voice unison overwhelming sound wave, wraparound collective prayer, atmospheric pressure.',
    m: 'act5',
  },
  {
    id: 64,
    t: 'Vesper Approaches Light',
    ln: [],
    sx: 'Implants responding to chamber — brightening silver tones, slow breathing, one footstep at a time.',
    m: 'act5',
  },
  {
    id: 65,
    t: 'Four Faces Cut',
    ln: [],
    sx: 'Rapid editorial cut sounds — each face a whip-pan audio punctuation, distant chant continuing.',
    m: 'act5',
  },
  {
    id: 66,
    t: 'Vesper in White Light',
    ln: [],
    sx: 'Pure white light sound — single crystalline tone, implants resonating as chamber recognizes choice.',
    m: 'act5',
  },
  {
    id: 67,
    t: 'AXIOM Watches',
    ln: [],
    sx: 'Machine grief — gold light fading tone, hand lowering servo quiet, closest analog to sorrow.',
    m: 'act5',
  },
  {
    id: 68,
    t: 'Maren Tobias Together',
    ln: [],
    sx: 'Silent two-shot ambient — breaths, neck port steady glow, solidarity.',
    m: 'act5',
  },
  {
    id: 69,
    t: 'City Chant Fading',
    ln: [{ sp: 'OVERMIND', tx: 'Completion is mercy. Completion is...' }],
    sx: 'Perfect synchronization failing, individual voices emerging, crack in the chorus.',
    m: 'act5',
  },
  {
    id: 70,
    t: 'Chamber Light Peaks',
    ln: [],
    sx: 'White light at full brightness — pure harmonic tone, data streams visible, ancient systems alive.',
    m: 'act5',
  },
  {
    id: 71,
    t: 'Fade to Black',
    ln: [],
    sx: 'Everything fades — light and sound together, long cinematic fade, silence growing, total void.',
    m: 'act5',
  },
  { id: 72, t: 'Black Silence', ln: [], sx: 'Complete silence. Deliberate held void.', m: 'act5' },
  {
    id: 73,
    t: 'CODA Final Query',
    ln: [{ sp: 'CODA', tx: 'Query: If a god fears choice, what is it protecting?' }],
    sx: 'Absolute darkness, distant synthetic whisper, philosophical weight.',
    m: 'act5',
  },
  {
    id: 74,
    t: 'Title Card',
    ln: [],
    sx: 'Quiet title-card silence, distant low drone that suggests ongoing mystery.',
    m: 'act5',
  },
  {
    id: 75,
    t: 'End Card',
    ln: [],
    sx: 'Final beat of silence, one last tone — unresolved, questioning, the doctrine with a question mark.',
    m: 'act5',
  },
];

/* ── Music segments ──────────────────────────────────────────────────── */
const MUS = [
  {
    id: 'act1',
    sc: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    p: 'Religious dystopia dawn. Cathedral strings meet machine hum. Liturgical beauty laced with quiet menace. Ethereal vocals with digital undertone. Sacred and unsettling. No lyrics.',
    d: 47,
  },
  {
    id: 'act2',
    sc: [13, 14, 15, 16, 17, 18, 19, 20, 21, 22],
    p: 'Underground resistance ambient. Warm amber analog synth, tube radio crackle, defiance without aggression. Low-budget hope. Warm vintage pads with rusted edge. No lyrics.',
    d: 47,
  },
  {
    id: 'act3',
    sc: [23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35],
    p: 'Ceremonial descent. Golden processional strings dissolving into paranoid synth, doubt creeping in under beauty. Cathedral sublime cracking. No lyrics.',
    d: 47,
  },
  {
    id: 'act4',
    sc: [36, 37, 38, 39, 40, 41, 42, 43, 44, 45],
    p: 'Suspense and infiltration. Blue-light archive tension, server drones, rising dread, quiet defiance. Sparse piano with electronic undercurrent. No lyrics.',
    d: 47,
  },
  {
    id: 'act5',
    sc: [
      46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68,
      69, 70, 71, 72, 73, 74, 75,
    ],
    p: 'Climax and reckoning. Sacred machinery meets human defiance. Monumental strings, electronic chorus, then stripped silence. Resolution hanging unresolved. No lyrics.',
    d: 47,
  },
];

/* ── FFmpeg mix ──────────────────────────────────────────────────────── */
function mix(v: string, dlg: string | undefined, sx: string, mu: string | undefined, out: string) {
  const inputs: string[] = ['-i', v, '-i', sx];
  const filters: string[] = ['[1:a]volume=0.6[s]'];
  const amix: string[] = ['[s]'];
  let idx = 2;
  if (mu && fs.existsSync(mu)) {
    inputs.push('-i', mu);
    filters.push(`[${idx}:a]volume=0.25[m]`);
    amix.push('[m]');
    idx++;
  }
  if (dlg && fs.existsSync(dlg)) {
    inputs.push('-i', dlg);
    filters.push(`[${idx}:a]volume=1.0[d]`);
    amix.push('[d]');
    idx++;
  }
  filters.push(`${amix.join('')}amix=inputs=${amix.length}:duration=first:dropout_transition=2[x]`);

  const cmd = [
    'ffmpeg',
    '-y',
    ...inputs,
    '-filter_complex',
    filters.join(';'),
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
  execSync(cmd.map((s) => (/[\s;\[\]]/.test(s) ? `"${s}"` : s)).join(' '), {
    stdio: 'pipe',
    timeout: 60_000,
  });
}

/* ── Firestore video lookup ──────────────────────────────────────────── */
async function fetchVideos(): Promise<Record<number, string>> {
  const saPath = path.resolve(
    process.cwd(),
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? 'firebase-sa-key-20260416.json'
  );
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : JSON.parse(readFileSync(saPath, 'utf-8'));
  const app = initializeApp({ credential: cert(sa) }, 'fp-audio-' + Date.now());
  const db = getFirestore(app);
  db.settings({ preferRest: true });

  const snap = await db
    .collection('videoGenerations')
    .where('episodeTitle', '==', 'First Proof: The Unfinished')
    .get();
  const byScene = new Map<number, { videoUrl: string; model: string; createdAt: any }>();
  for (const d of snap.docs) {
    const data = d.data() as any;
    const existing = byScene.get(data.sceneId);
    // Prefer Seedance, else newest
    const newIsSeedance = data.model?.includes('dreamina') || data.model?.includes('seedance');
    if (!existing) byScene.set(data.sceneId, data);
    else {
      const oldIsSeedance =
        existing.model?.includes('dreamina') || existing.model?.includes('seedance');
      if (newIsSeedance && !oldIsSeedance) byScene.set(data.sceneId, data);
    }
  }
  const result: Record<number, string> = {};
  byScene.forEach((v, k) => {
    result[k] = v.videoUrl;
  });
  return result;
}

/* ── Main ────────────────────────────────────────────────────────────── */
async function main() {
  console.log('\n=== FIRST PROOF Audio Pipeline — "The Unfinished" (75 scenes) ===\n');
  if (!EL_KEY) throw new Error('ELEVENLABS_API_KEY required');
  try {
    execSync('ffmpeg -version', { stdio: 'pipe' });
  } catch {
    throw new Error('ffmpeg required');
  }

  mkdir(ODIR);
  for (const d of ['dialogue', 'sfx', 'music', 'videos', 'final']) mkdir(path.join(ODIR, d));

  const voices = await loadV();
  const active = SFILT ? SCENES.filter((s) => SFILT!.has(s.id)) : SCENES;
  L('S', `${active.length} scenes active`);

  // Fetch videos from Firestore
  L('V', 'Fetching video URLs from Firestore...');
  const vids = await fetchVideos();
  L('V', `Found ${Object.keys(vids).length} scene videos`);

  // Music
  const mf: Record<string, string> = {};
  if (!SKIP_MUSIC && FK) {
    for (const m of MUS) {
      const f = path.join(ODIR, 'music', `${m.id}.mp3`);
      if (fs.existsSync(f)) {
        mf[m.id] = f;
        continue;
      }
      try {
        L('M', `Generating ${m.id} (${m.d}s)...`);
        const u = await fMusic(m.p, m.d);
        if (u) {
          await dl(u, f);
          mf[m.id] = f;
          L('M', `  Done: ${m.id}`);
        }
      } catch (e: any) {
        L('M', `FAIL ${m.id}: ${e.message?.slice(0, 100)}`);
      }
      await Z(1500);
    }
  }
  const sm: Record<number, string> = {};
  for (const m of MUS) if (mf[m.id]) for (const s of m.sc) sm[s] = mf[m.id];

  let ok = 0,
    fail = 0,
    skip = 0;
  for (const s of active) {
    console.log(`\n--- Scene ${s.id}: ${s.t} ---`);
    const vurl = vids[s.id];
    if (!vurl) {
      L(`${s.id}`, 'No video yet — skipping');
      skip++;
      continue;
    }

    try {
      const vf = path.join(ODIR, 'videos', `${s.id}.mp4`);
      if (!fs.existsSync(vf)) await dl(vurl, vf);

      // Dialogue TTS
      let df: string | undefined;
      if (s.ln.length) {
        df = path.join(ODIR, 'dialogue', `${s.id}.mp3`);
        if (!fs.existsSync(df)) {
          const bs: Buffer[] = [];
          for (const ln of s.ln) {
            const v = voices[ln.sp];
            if (!v) {
              L(`${s.id}`, `  No voice ${ln.sp} — skip line`);
              continue;
            }
            bs.push(await tts(ln.tx, v.voiceId, v.st, v.sy));
            bs.push(Buffer.alloc(8820));
            await Z(500);
          }
          if (bs.length) fs.writeFileSync(df, Buffer.concat(bs));
        }
      }

      // SFX
      const sf = path.join(ODIR, 'sfx', `${s.id}.mp3`);
      if (!fs.existsSync(sf)) {
        try {
          fs.writeFileSync(sf, await sfx(s.sx, 8));
        } catch {
          fs.writeFileSync(sf, Buffer.alloc(44100 * 2));
        }
        await Z(500);
      }

      // Mix
      const out = path.join(ODIR, 'final', `${s.id}.mp4`);
      if (!fs.existsSync(out)) {
        L(`${s.id}`, 'Mixing...');
        mix(vf, df, sf, sm[s.id], out);
      }
      L(`${s.id}`, 'DONE');
      ok++;
    } catch (e: any) {
      L(`${s.id}`, `FAIL: ${e.message?.slice(0, 150)}`);
      fail++;
    }
  }

  console.log(
    `\n${'='.repeat(60)}\n  First Proof audio: ${ok} done, ${fail} failed, ${skip} skipped\n${'='.repeat(60)}\n  Output: ${path.resolve(ODIR)}/final/`
  );
  process.exit(0);
}

main().catch((e) => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
