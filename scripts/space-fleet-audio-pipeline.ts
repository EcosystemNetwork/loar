/**
 * SPACE FLEET — Audio Pipeline
 * Pilot: "Return" — 40 scenes
 *
 * Voice + SFX + Music + Lip-Sync → FFmpeg composite
 *
 * Cast: Eric, Mikel, Jeff, Dante, Marcus
 * Setting: NOS Event Center rave, hotel afterparty, ride home
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
/**
 * Fetch all available voices and find the best match by name keywords.
 * Falls back to searching by gender/age labels if no name match.
 */
async function findBestVoice(o: {
  name: string;
  gender: string;
  age: string;
  accent: string;
  as: number;
  text: string;
  desc: string;
}): Promise<string> {
  const res = await fetch(`${EBASE}/voices`, { headers: eH() });
  if (!res.ok) throw new Error(`Voices list ${res.status}`);
  const { voices } = (await res.json()) as {
    voices: Array<{ voice_id: string; name: string; labels?: Record<string, string> }>;
  };

  // Character → preferred voice mapping (ElevenLabs library voices)
  const PREFERRED: Record<string, string[]> = {
    'Eric - SF': ['Charlie', 'Liam', 'Daniel', 'James'], // young male, anxious, overwhelmed
    'Jeff - SF': ['Josh', 'Adam', 'Clyde', 'Dave'], // big bro energy, loud, warm
    'Mikel - SF': ['Callum', 'Harry', 'Fin', 'Patrick'], // ancient, calm, controlled menace
    'Dante - SF': ['Antoni', 'Arnold', 'Thomas', 'Ethan'], // charismatic, Mediterranean warmth
    'Marcus - SF': ['Michael', 'Bill', 'George', 'Sam'], // deep, curt, security build
    'The Frequency - SF': ['Callum', 'Brian', 'Roger', 'George'], // cosmic, sub-bass, ancient
    'DJ - SF': ['Adam', 'Josh', 'Dave', 'Clyde'], // casual, confused
  };

  const prefs = PREFERRED[o.name] || [];
  for (const pref of prefs) {
    const match = voices.find((v) => v.name.toLowerCase().includes(pref.toLowerCase()));
    if (match) return match.voice_id;
  }

  // Fallback: match by gender label
  const genderMatch = voices.find(
    (v) => v.labels?.gender === o.gender || v.name.toLowerCase().includes(o.gender)
  );
  if (genderMatch) return genderMatch.voice_id;

  // Last resort: first available voice
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
  // stable-audio max is ~47s, clamp and loop if needed
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
    as: number;
    text: string;
    desc: string;
    st: number;
    sy: number;
  }
> = {
  ERIC: {
    name: 'Eric - SF',
    gender: 'male',
    age: 'young',
    accent: 'american',
    as: 0.9,
    text: "What's happening to me?",
    desc: 'Young male early 20s. Anxious, overwhelmed, whispered intensity. Half-Asian.',
    st: 0.45,
    sy: 0.35,
  },
  JEFF: {
    name: 'Jeff - SF',
    gender: 'male',
    age: 'young',
    accent: 'american',
    as: 0.8,
    text: 'BRO! ERIC! OVER HERE!',
    desc: 'Young male early 20s. Loud, warm, bro energy. Big muscular guy voice.',
    st: 0.4,
    sy: 0.6,
  },
  MIKEL: {
    name: 'Mikel - SF',
    gender: 'male',
    age: 'young',
    accent: 'british',
    as: 0.7,
    text: 'Something has changed in you.',
    desc: 'Mid-20s but sounds ancient. Calm, controlled, unsettling precision. Vampire undertone.',
    st: 0.7,
    sy: 0.2,
  },
  DANTE: {
    name: 'Dante - SF',
    gender: 'male',
    age: 'young',
    accent: 'american',
    as: 0.7,
    text: 'Hey man, you good? We got a room at the hotel. Chill afterparty.',
    desc: 'Late 20s Mediterranean. Charismatic, warm, disarming. Smooth talker.',
    st: 0.55,
    sy: 0.45,
  },
  MARCUS: {
    name: 'Marcus - SF',
    gender: 'male',
    age: 'middle_aged',
    accent: 'american',
    as: 0.8,
    text: 'Someone is going to notice.',
    desc: 'Late 20s. Deep voice, curt, security build. Says little, means everything.',
    st: 0.75,
    sy: 0.15,
  },
  FREQUENCY: {
    name: 'The Frequency - SF',
    gender: 'male',
    age: 'old',
    accent: 'british',
    as: 0.6,
    text: 'I have been waiting for you to return.',
    desc: 'Ancient cosmic entity speaking through sub-bass. Not human. Calm, patient, vast.',
    st: 0.8,
    sy: 0.1,
  },
};

async function loadV(): Promise<Record<string, VP>> {
  mkdir(ODIR);
  const f = path.join(ODIR, 'voice-profiles.json');
  // Force regeneration since cast changed
  if (fs.existsSync(f)) {
    const existing = JSON.parse(fs.readFileSync(f, 'utf-8'));
    // Check if profiles match new cast
    if (existing.ERIC && existing.JEFF && existing.MIKEL && existing.DANTE) {
      L('V', `Loaded ${Object.keys(existing).length} voices (new cast)`);
      return existing;
    }
    // Old cast profiles — regenerate
    L('V', 'Old cast profiles detected — regenerating for new cast...');
  }
  L('V', 'Designing voices for new cast...');
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
  fc: boolean; // has face for lip-sync
}

function buildSA(): SA[] {
  return [
    // ═══════════════════════════════════════════════════════════════
    // ACT 1 — THE ARRIVAL (S01–S08)
    // ═══════════════════════════════════════════════════════════════
    {
      id: 'S01',
      t: 'Highway',
      ln: [
        {
          sp: 'JEFF',
          tx: "Bro. BRO. Can you feel that? We're not even inside yet and the bass is shaking my mirrors.",
        },
        { sp: 'ERIC', tx: 'I can feel it.' },
        { sp: 'JEFF', tx: 'TONIGHT IS THE NIGHT!' },
      ],
      sx: 'Truck engine rumble, highway asphalt hum, distant bass thump growing louder, wind buffeting, stereo bass vibrating metal.',
      m: 'arrival',
      fc: true,
    },
    {
      id: 'S02',
      t: 'Parking',
      ln: [],
      sx: 'Car doors slamming, distant massive bass from venue, crowd chatter, footsteps on asphalt, laser hum overhead.',
      m: 'arrival',
      fc: false,
    },
    {
      id: 'S03',
      t: 'Entrance',
      ln: [{ sp: 'JEFF', tx: "WOOOO! Let's GO!" }],
      sx: 'MASSIVE bass wall hit, fog machine hiss, crowd roar, laser crackling overhead, sensory overload sound design.',
      m: 'arrival',
      fc: true,
    },
    {
      id: 'S04',
      t: 'Moving Through',
      ln: [],
      sx: 'Dense crowd noise, bodies bumping, bass pulsing, strobe clicks, distant DJ mixing.',
      m: 'arrival',
      fc: false,
    },
    {
      id: 'S05',
      t: 'Cathedral',
      ln: [],
      sx: 'Cathedral-scale reverb, massive speaker wall hum, sub-bass that vibrates the chest, fog machine ambient, ten thousand voices as one organism.',
      m: 'arrival',
      fc: false,
    },
    {
      id: 'S06',
      t: 'Jeff Pit',
      ln: [{ sp: 'JEFF', tx: 'COME ON! Get in here!' }],
      sx: 'Mosh pit chaos, bodies colliding, crowd surge, ecstatic screams, bass drop impact.',
      m: 'arrival',
      fc: true,
    },
    {
      id: 'S07',
      t: 'Mushrooms',
      ln: [],
      sx: 'Sound design: reality warping. Bass becomes liquid. Frequencies separate and breathe. Synesthetic audio — colors as tones. Swelling, breathing, organic electronic.',
      m: 'arrival',
      fc: false,
    },
    {
      id: 'S08',
      t: 'Mikel Notices',
      ln: [{ sp: 'MIKEL', tx: 'Eric.' }],
      sx: 'Crowd falls to background. Sharp focus sound. Heartbeat. A presence shifting — something ancient recognizing something familiar.',
      m: 'arrival',
      fc: true,
    },

    // ═══════════════════════════════════════════════════════════════
    // ACT 2 — THE SEPARATION & AWAKENING (S09–S23)
    // ═══════════════════════════════════════════════════════════════
    {
      id: 'S09',
      t: 'Drop Surge',
      ln: [],
      sx: 'MASSIVE bass drop. Crowd surge like ocean. Phone screen cracking underfoot. Bodies colliding. Hands reaching and missing.',
      m: 'awaken',
      fc: false,
    },
    {
      id: 'S10',
      t: 'Alone',
      ln: [{ sp: 'ERIC', tx: 'Jeff? ... Mikel? ... shit.' }],
      sx: 'Isolation sound design — crowd becomes muffled, heartbeat prominent, breathing close and panicked, tinnitus ring.',
      m: 'awaken',
      fc: true,
    },
    {
      id: 'S11',
      t: 'Jeff Search',
      ln: [
        { sp: 'JEFF', tx: 'ERIC! ERICCC!' },
        { sp: 'MIKEL', tx: "He's not here. Something happened." },
      ],
      sx: 'Crowd noise drowning out shouting, concrete barrier, distant bass, wind.',
      m: 'awaken',
      fc: true,
    },
    {
      id: 'S12',
      t: 'Deeper',
      ln: [],
      sx: 'Synesthetic audio — bass becomes magnetic pull, frequency layers separating, each sound gaining color and texture. Walking through liquid music.',
      m: 'awaken',
      fc: false,
    },
    {
      id: 'S13',
      t: 'First Sync',
      ln: [],
      sx: 'Heartbeat and bass perfectly synchronized. Two rhythms becoming one. Sub-bass locked to pulse. The sound of a human body becoming a speaker.',
      m: 'awaken',
      fc: true,
    },
    {
      id: 'S14',
      t: 'Fear Drop',
      ln: [],
      sx: 'MASSIVE unplanned bass drop. Crowd eruption. Shockwave through fog. Speaker distortion. Something that was NOT in the DJ set.',
      m: 'awaken',
      fc: true,
    },
    {
      id: 'S15',
      t: 'Wonder',
      ln: [],
      sx: 'Music lifts — beautiful soaring melody emerging from bass. Crowd unified sway. Someone gasping through tears. Ethereal synth pad. Transcendent beauty.',
      m: 'awaken',
      fc: false,
    },
    {
      id: 'S16',
      t: 'Eric Conducts',
      ln: [],
      sx: 'Full control soundscape — every element responding: fog machines breathing with him, lasers tracking, crowd as instrument. Concentric sound waves. Orchestra of ten thousand. Peak transcendence.',
      m: 'awaken',
      fc: true,
    },
    {
      id: 'S17',
      t: 'DJ Notices',
      ln: [],
      sx: 'Equipment autonomous. Faders moving alone. Waveform displays showing impossible patterns. The hum of technology being controlled by something else.',
      m: 'void',
      fc: false,
    },
    {
      id: 'S18',
      t: 'Void Opens',
      ln: [],
      sx: 'Sound drains — active void sucking audio into silence. Fog freezes. Time stops for the front rows. Deep cosmic horror drone. Sub-bass so low it becomes absence.',
      m: 'void',
      fc: false,
    },
    {
      id: 'S19',
      t: 'Frequency Speaks',
      ln: [{ sp: 'FREQUENCY', tx: 'I have been waiting for you to return.' }],
      sx: 'The Voice of The Frequency — not through ears but through bass, through chest, through bone. Music restructuring around a presence. Frequencies parting like curtains. Ancient sub-bass communication.',
      m: 'void',
      fc: false,
    },
    {
      id: 'S20',
      t: 'Terror',
      ln: [],
      sx: 'Heartbeat accelerating. Breathing becoming ragged. Pupils contracting (sharp audio focus snap). The sound of primal fear. Rave audio becoming threatening.',
      m: 'void',
      fc: true,
    },
    {
      id: 'S21',
      t: 'Eric Runs',
      ln: [],
      sx: 'Running through crowd — bass distorting behind him. Music becoming dissonant. Crowd flinching. Panic spreading through sound. His fear feeding back into the system.',
      m: 'void',
      fc: false,
    },
    {
      id: 'S22',
      t: 'Corridor',
      ln: [],
      sx: 'Sprinting footsteps echoing wrong in concrete corridor. Red emergency light buzz. Distorted bass through walls. Breathing hard. Exit door crash open.',
      m: 'void',
      fc: false,
    },
    {
      id: 'S23',
      t: 'Outside',
      ln: [{ sp: 'ERIC', tx: 'Oh god. Oh god. What was that.' }],
      sx: 'Desert night air rush. Cool wind. Stars. Distant bass from venue. Gasping, doubled over. Sweat dripping. The silence of outdoors after indoor hell.',
      m: 'void',
      fc: true,
    },

    // ═══════════════════════════════════════════════════════════════
    // ACT 3 — THE HOTEL & THE OVERHEARD (S24–S32)
    // ═══════════════════════════════════════════════════════════════
    {
      id: 'S24',
      t: 'Dante',
      ln: [
        { sp: 'DANTE', tx: "Hey man, you good? You look like you've seen something." },
        { sp: 'ERIC', tx: 'Yeah... yeah I just... got separated from my friends.' },
        { sp: 'DANTE', tx: 'Been there. Here — water.' },
      ],
      sx: 'Outdoor ambient, distant bass, concrete curb, water bottle opening, warm human sounds.',
      m: 'hotel',
      fc: true,
    },
    {
      id: 'S25',
      t: 'Marcus Watch',
      ln: [],
      sx: 'Shadow ambient. Distant festival. A ring turning on a finger. Breathing measured and controlled. The sound of surveillance.',
      m: 'hotel',
      fc: false,
    },
    {
      id: 'S26',
      t: 'Invitation',
      ln: [
        {
          sp: 'DANTE',
          tx: "We got a room at the hotel across the street. Chill afterparty. You're welcome to come decompress.",
        },
        { sp: 'ERIC', tx: 'Yeah... yeah okay. Thanks.' },
      ],
      sx: 'Walking on asphalt, festival receding, motel neon, distant highway, three sets of footsteps — one trailing.',
      m: 'hotel',
      fc: true,
    },
    {
      id: 'S27',
      t: 'Hotel Room',
      ln: [{ sp: 'DANTE', tx: 'Make yourself at home. Got water, got vibes.' }],
      sx: 'Hotel room ambience — bluetooth speaker playing soft ambient, lamp click, water bottles, bed creak. Cheap AC unit.',
      m: 'hotel',
      fc: false,
    },
    {
      id: 'S28',
      t: 'Eric Zoning',
      ln: [],
      sx: 'Internal processing soundscape — ambient music from speaker becoming geometric, residual psychedelic perception, heartbeat, fabric gripping. The sound of replaying terror.',
      m: 'hotel',
      fc: true,
    },
    {
      id: 'S29',
      t: 'Whispers',
      ln: [
        {
          sp: 'DANTE',
          tx: "Did you see the new ones near the south stage? They're not even trying to hide it anymore.",
        },
        { sp: 'MARCUS', tx: 'Getting obvious. Someone will notice.' },
      ],
      sx: 'Low conspiratorial whisper ambience. Bathroom doorframe. Hotel room distant. Two men talking shop they think nobody hears.',
      m: 'hotel',
      fc: true,
    },
    {
      id: 'S30',
      t: 'Symbols',
      ln: [
        {
          sp: 'MARCUS',
          tx: 'Summoning sigils. In the LED panel art. In the stage geometry. In the venue floor plan.',
        },
        { sp: 'DANTE', tx: 'Nobody notices. Nobody ever does.' },
      ],
      sx: 'Near silence. Eric listening — controlled breathing. Two voices in background. The sound of a mind memorizing everything.',
      m: 'hotel',
      fc: true,
    },
    {
      id: 'S31',
      t: 'Eric Leaves',
      ln: [
        { sp: 'ERIC', tx: 'Thanks for the hangout man. I need some air.' },
        { sp: 'DANTE', tx: 'Take care of yourself.' },
      ],
      sx: 'Bed creak standing. Footsteps past chair. Door handle turning. Door click shut. Tension.',
      m: 'hotel',
      fc: true,
    },
    {
      id: 'S32',
      t: 'Corridor',
      ln: [],
      sx: 'Exterior motel corridor — fluorescent buzz. Composed footsteps. Corner turn. Then: composure breaking. Gasping. Leaning on stucco. Then fast walking becoming near-running.',
      m: 'hotel',
      fc: false,
    },

    // ═══════════════════════════════════════════════════════════════
    // ACT 4 — THE REUNION & RIDE HOME (S33–S40)
    // ═══════════════════════════════════════════════════════════════
    {
      id: 'S33',
      t: 'Searching',
      ln: [],
      sx: 'Outdoor festival ambient. Multiple competing stages. Crowd chatter. Walking with purpose. Subtle — nearest stage lights shift warmer. The power still there, quieter.',
      m: 'home',
      fc: false,
    },
    {
      id: 'S34',
      t: 'Jeff Spots',
      ln: [{ sp: 'JEFF', tx: "BRO! ERIC! OVER HERE! I'VE BEEN LOOKING EVERYWHERE!" }],
      sx: "Jeff yelling from concrete barrier. Festival background. The most beautiful sound — a friend's voice cutting through chaos.",
      m: 'home',
      fc: true,
    },
    {
      id: 'S35',
      t: 'Bear Hug',
      ln: [
        { sp: 'JEFF', tx: 'WHERE WERE YOU BRO? I was about to fight a security guard for you.' },
      ],
      sx: "Bear hug impact — body slam, fabric, Jeff's big exhale. Eric can't speak. Warm human contact after cosmic horror.",
      m: 'home',
      fc: true,
    },
    {
      id: 'S36',
      t: 'Mikel Appears',
      ln: [],
      sx: 'Shadow. Footstep from darkness. Dual-colored light — magenta and blue. Ancient recognition. The vampire seeing what woke up.',
      m: 'home',
      fc: false,
    },
    {
      id: 'S37',
      t: 'Walk Truck',
      ln: [
        {
          sp: 'JEFF',
          tx: "So I climbed the barrier right, and this security dude comes up, and I'm like bro I'm LOOKING for my friend—",
        },
      ],
      sx: 'Parking lot footsteps. Jeff animated monologue. Bass fading behind them. Three friends, three versions of the same night.',
      m: 'home',
      fc: true,
    },
    {
      id: 'S38',
      t: 'Silence',
      ln: [],
      sx: 'Truck interior — engine hum, road noise, dashboard rattle. No music. No talking. Weighted silence. Impossibly, distant bass still faintly audible through truck frame.',
      m: 'home',
      fc: false,
    },
    {
      id: 'S39',
      t: 'Bass Through',
      ln: [],
      sx: 'Extreme close sound design — metal vibrating under fingers. Faint bass from miles away through the truck frame, through the road, through the earth. The power that does not turn off. Geometric sound patterns flowing through metal.',
      m: 'home',
      fc: false,
    },
    {
      id: 'S40',
      t: 'Eyes Open',
      ln: [],
      sx: 'Eyes opening — a single resonant tone. Dashboard ambient. Then for one heartbeat: an ancient frequency, deep and vast, reflected in irises. Cut to silence. Title card.',
      m: 'home',
      fc: true,
    },
  ];
}

/* ── Music segments ──────────────────────────────────────────────────── */
const MUS = [
  {
    id: 'M01',
    sc: ['S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07', 'S08'],
    p: 'EDM rave build. Driving to the rave, entering the venue, the energy climbs. Desert highway bass into indoor club crescendo. Pulsing synth, 4-on-floor kick building, hi-hats, anticipation energy. No vocals. Electronic dance music meets cinematic tension.',
    d: 47,
  },
  {
    id: 'M02',
    sc: ['S09', 'S10', 'S11', 'S12', 'S13', 'S14', 'S15', 'S16'],
    p: 'Psychedelic awakening. Separation anxiety into transcendence. Bass becomes liquid, frequencies breathe and separate. Synesthetic soundscape — psilocybin perception as music. Build from isolation to godlike power. Gaspar Noe meets Aphex Twin. Ethereal synth climax. No vocals.',
    d: 47,
  },
  {
    id: 'M03',
    sc: ['S17', 'S18', 'S19', 'S20', 'S21', 'S22', 'S23'],
    p: 'Cosmic horror. The void opens behind the speakers. Ancient frequency speaking through sub-bass. Dread. Sound draining into silence then erupting. Terror run — distorted bass chasing. Exit into desert night. Lovecraft meets rave. Deep drone, reverse reverb, terrifying absence of sound. No vocals.',
    d: 47,
  },
  {
    id: 'M04',
    sc: ['S24', 'S25', 'S26', 'S27', 'S28', 'S29', 'S30', 'S31', 'S32'],
    p: 'Afterparty suspense. Cheap hotel room. False safety. Warm ambient surface hiding conspiratorial undercurrent. Overhearing things not meant for you. Thriller tension building under lounge beats. The poker face exit. Dark ambient with heartbeat. No vocals.',
    d: 47,
  },
  {
    id: 'M05',
    sc: ['S33', 'S34', 'S35', 'S36', 'S37', 'S38', 'S39', 'S40'],
    p: 'Reunion and aftermath. Relief of finding friends. Then the silent drive home. The bass that does not stop — miles away but still reaching through the truck, through the road, through the earth. Bittersweet, haunting, the door that opened will not close. Warm piano dissolving into sub-bass drone. Final chord: ancient frequency. No vocals.',
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

/* ── Chain fetch ─────────────────────────────────────────────────────── */
async function fetchV(): Promise<Record<string, string>> {
  // Use public RPC to avoid Alchemy free-tier getLogs block range limit
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
  // Get current block and scan from a recent range (universe just deployed)
  const latest = await pc.getBlockNumber();
  const from = latest > 5000n ? latest - 5000n : 0n;
  L('CHAIN', `Scanning blocks ${from}..${latest}`);
  const logs = await pc.getLogs({ address: UADDR, event: ev, fromBlock: from, toBlock: 'latest' });
  L('CHAIN', `Found ${logs.length} NodeCreated events`);
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
  console.log('\n=== SPACE FLEET Audio Pipeline — "Return" (40 scenes) ===\n');
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
      L('M', `Generating ${m.id} (${m.d}s)...`);
      const u = await fMusic(m.p, m.d);
      if (u) {
        await dl(u, f);
        mf[m.id] = f;
        L('M', `  Done: ${m.id}`);
      } else {
        L('M', `  No URL returned for ${m.id}`);
      }
    } catch (err: any) {
      L('M', `FAIL ${m.id}: ${err?.message?.slice(0, 200) || String(err)}`);
    }
    await Z(1500);
  }
  const sm: Record<string, string> = {};
  for (const m of MUS) if (mf[m.id]) for (const s of m.sc) sm[s] = mf[m.id];

  // Videos — from local dir or chain
  let vids: Record<string, string> = {};
  if (VDIR && fs.existsSync(VDIR)) {
    for (const f of fs.readdirSync(VDIR).filter((f) => f.endsWith('.mp4'))) {
      const r = f.match(/^(S\d+)/);
      if (r) vids[r[1]] = path.join(VDIR, f);
    }
  } else {
    vids = await fetchV();
  }
  L('S', `${Object.keys(vids).length} videos found`);

  let ok = 0;
  let fail = 0;
  let skip = 0;
  for (const s of active) {
    console.log(`\n--- ${s.id}: ${s.t} ---`);
    const vs = vids[s.id];
    if (!vs) {
      L(s.id, 'No video — skipping');
      skip++;
      continue;
    }
    try {
      const vf = path.join(ODIR, 'videos', `${s.id}.mp4`);
      if (!fs.existsSync(vf)) {
        if (vs.startsWith('http')) await dl(vs, vf);
        else fs.copyFileSync(vs, vf);
      }

      // Dialogue TTS
      let df: string | undefined;
      if (s.ln.length) {
        df = path.join(ODIR, 'dialogue', `${s.id}.mp3`);
        if (!fs.existsSync(df)) {
          const bs: Buffer[] = [];
          for (const ln of s.ln) {
            const v = voices[ln.sp];
            if (!v) {
              L(s.id, `  No voice for ${ln.sp} — skipping line`);
              continue;
            }
            bs.push(await tts(ln.tx, v.voiceId, v.st, v.sy));
            bs.push(Buffer.alloc(8820)); // ~100ms silence between lines
            await Z(500);
          }
          if (bs.length) fs.writeFileSync(df, Buffer.concat(bs));
        }
      }

      // SFX
      const sf = path.join(ODIR, 'sfx', `${s.id}.mp3`);
      if (!fs.existsSync(sf)) {
        try {
          fs.writeFileSync(sf, await sfx(s.sx, 10));
        } catch {
          fs.writeFileSync(sf, Buffer.alloc(44100 * 2)); // silent fallback
        }
        await Z(500);
      }

      // Music track for this scene
      const mu = sm[s.id];
      if (!mu) {
        L(s.id, 'No music track — skipping');
        skip++;
        continue;
      }

      // Lip-sync (if scene has dialogue and face)
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
            }
          } catch {
            /* use original video */
          }
        } else {
          fv = lf;
        }
      }

      // FFmpeg composite: video + dialogue + sfx + music → final
      const out = path.join(ODIR, 'final', `${s.id}.mp4`);
      if (!fs.existsSync(out)) {
        L(s.id, 'Mixing audio...');
        mix(fv, df, sf, mu, out);
      }
      L(s.id, 'DONE');
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
