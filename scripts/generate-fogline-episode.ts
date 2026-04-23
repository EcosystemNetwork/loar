/**
 * FALLOUT: FOGLINE — Video Generation Pipeline
 *
 * Pulls wiki entity data from Firestore to build lore-aware prompts,
 * then generates video clips scene by scene using Veo 3.1 Fast (cinematic + audio).
 *
 * After all clips are generated, creates an Episode in Firestore
 * that can be exported via the Episode Builder.
 *
 * Usage:
 *   pnpm tsx scripts/generate-fogline-episode.ts
 *
 * Options:
 *   --dry-run       Print prompts without generating
 *   --model <id>    Override model (default: veo3.1-fast)
 *   --start <n>     Start from scene N (1-indexed, for resuming)
 *   --scenes <list> Comma-separated scene numbers to generate (e.g. "1,3,5")
 */
import dotenv from 'dotenv';
import path from 'path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { keccak256, toBytes } from 'viem';
import { rehostVideoToPinata, isEphemeralVideoUrl } from './lib/rehost-video';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// ── Firebase Init ───────────────────────────────────────────────────────
const saPathEnv = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
const saPath = path.resolve(process.cwd(), saPathEnv ?? 'firebase-sa-key-20260416.json');
let serviceAccount: any;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} else {
  serviceAccount = JSON.parse(readFileSync(saPath, 'utf-8'));
}
const firebaseApp = initializeApp(
  { credential: cert(serviceAccount) },
  `fogline-video-${Date.now()}`
);
const db = getFirestore(firebaseApp);
db.settings({ preferRest: true });

// ── ByteDance Seedance 2.0 Direct API ──────────────────────────────────
const BYTEDANCE_API_KEY = process.env.BYTEDANCE_API_KEY;
if (!BYTEDANCE_API_KEY) {
  console.error('❌ BYTEDANCE_API_KEY is required for Seedance 2.0');
  process.exit(1);
}
const BD_BASE = 'https://ark.ap-southeast.bytepluses.com/api/v3';
const BD_POLL_INTERVAL = 5000;
const BD_MAX_POLLS = 120;

async function bdRequest<T>(bdPath: string, body?: any): Promise<T> {
  const res = await fetch(`${BD_BASE}${bdPath}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${BYTEDANCE_API_KEY}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`ByteDance ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

async function generateSeedanceVideo(
  prompt: string,
  duration: number,
  audio: boolean
): Promise<string> {
  const body = {
    model: 'dreamina-seedance-2-0-260128',
    content: [{ type: 'text', text: prompt }],
    duration,
    aspect_ratio: '16:9',
    resolution: '720p',
    generate_audio: audio,
  };

  const task = await bdRequest<{ id?: string; task_id?: string }>(
    '/contents/generations/tasks',
    body
  );
  const taskId = task.id || task.task_id;
  if (!taskId) throw new Error('No task ID from ByteDance');

  for (let i = 0; i < BD_MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, BD_POLL_INTERVAL));
    const status = await bdRequest<any>(`/contents/generations/tasks/${taskId}`);
    const s = status.status?.toLowerCase();

    if (s === 'completed' || s === 'succeeded' || s === 'success') {
      const url =
        status.content?.video_url ||
        status.output?.video_url ||
        status.output?.video?.url ||
        status.result?.video_url;
      if (!url) throw new Error('Task done but no video URL');
      return url;
    }
    if (s === 'failed' || s === 'error' || s === 'cancelled') {
      const err =
        typeof status.error === 'string' ? status.error : status.error?.message || 'failed';
      throw new Error(`Seedance failed: ${err}`);
    }
    if (i % 6 === 0 && i > 0) console.log(`    [poll ${i}] ${s}...`);
  }
  throw new Error('Seedance timed out');
}

// ── Config ──────────────────────────────────────────────────────────────
const UNIVERSE_ID = '0x0000000000000000000000000000019d9e26795c';
const CREATOR_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

// Parse CLI args
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const modelIdx = args.indexOf('--model');
const MODEL = modelIdx >= 0 ? args[modelIdx + 1] : 'seedance-2.0';
const startIdx = args.indexOf('--start');
const START_FROM = startIdx >= 0 ? parseInt(args[startIdx + 1], 10) : 1;
const scenesIdx = args.indexOf('--scenes');
const ONLY_SCENES = scenesIdx >= 0 ? args[scenesIdx + 1].split(',').map(Number) : null;

// ── Wiki Context Builder ────────────────────────────────────────────────

interface WikiEntity {
  id: string;
  name: string;
  kind: string;
  description?: string;
  metadata?: Record<string, any>;
  imageUrl?: string;
}

async function fetchWikiEntities(): Promise<WikiEntity[]> {
  const snap = await db.collection('entities').where('universeAddress', '==', UNIVERSE_ID).get();

  return snap.docs.map(
    (doc) =>
      ({
        id: doc.id,
        ...doc.data(),
      }) as WikiEntity
  );
}

function buildWikiContext(entities: WikiEntity[], sceneEntityNames: string[]): string {
  const relevant = entities.filter((e) =>
    sceneEntityNames.some(
      (name) =>
        e.name.toLowerCase().includes(name.toLowerCase()) ||
        name.toLowerCase().includes(e.name.toLowerCase())
    )
  );

  if (relevant.length === 0) return '';

  const lines: string[] = ['[UNIVERSE LORE — Fallout: Fogline]'];

  for (const entity of relevant) {
    let line = `- ${entity.name} (${entity.kind})`;
    if (entity.description) {
      const desc =
        entity.description.length > 200
          ? entity.description.slice(0, 197) + '...'
          : entity.description;
      line += `: ${desc}`;
    }
    // Add key visual metadata
    const visualFields = ['appearance', 'atmosphere', 'physiology', 'role'];
    for (const field of visualFields) {
      const val = entity.metadata?.[field];
      if (val && typeof val === 'string') {
        line += ` [${field}: ${val.slice(0, 100)}]`;
      }
    }
    lines.push(line);
  }

  return lines.join('\n');
}

// ── Scene Definitions ───────────────────────────────────────────────────
// Each scene maps to a screenplay beat with a cinematic video prompt
// and references to wiki entities for lore injection.

interface Scene {
  id: number;
  title: string;
  /** Which wiki entity names to pull context from */
  entities: string[];
  /** The cinematic video prompt — will be prepended with wiki context */
  prompt: string;
  /** Duration in seconds */
  duration: number;
  /** Camera direction hint */
  camera?: string;
  /** Whether this scene has dialogue (affects audio gen) */
  hasDialogue: boolean;
}

const SCENES: Scene[] = [
  // ══════════════════════════════════════════════════════════════════════
  // ACT 1: THE WASTELAND (0:00 – 2:40) — 20 clips = 160s
  // ══════════════════════════════════════════════════════════════════════

  // ── COLD OPEN: The Bay ──
  {
    id: 1,
    title: 'Cold Open — Fog on Black Water',
    entities: ['The Fog', 'Golden Gate Bridge Ruins'],
    prompt: `Extreme wide aerial shot, pre-dawn darkness. Thick radioactive fog rolls across pitch-black water of San Francisco Bay. Slow, ominous, beautiful. The fog glows faintly green from radiation. No land visible — just endless fog and black water stretching to the horizon. A distant ferry horn moans. Sound design: deep ambient drone, water lapping. Cinematic 2.39:1 aspect feel, desaturated color grading with toxic green fog highlights.`,
    duration: 8,
    camera: 'slow_aerial_push',
    hasDialogue: false,
  },
  {
    id: 2,
    title: 'Cold Open — Golden Gate Reveal',
    entities: ['Golden Gate Bridge Ruins', 'The Fog'],
    prompt: `Slow push through fog revealing the GOLDEN GATE BRIDGE — broken, rusted, skeletal. Cables hang slack like dead tendons. One tower stands at a slight lean, the other is intact but stripped of paint, pure rust-red metal against grey fog. The camera drifts past a broken cable thick as a tree trunk. Pre-dawn amber light barely touching the highest point. The bridge is a cathedral ruin. No people, no sound except wind and groaning metal. Post-apocalyptic monument photography, epic scale.`,
    duration: 8,
    camera: 'slow_push_through',
    hasDialogue: false,
  },
  {
    id: 3,
    title: 'Cold Open — Alcatraz & Sunken Ships',
    entities: ['Alcatraz Fortress', 'The Fog'],
    prompt: `Wide shot across the Bay. Half-sunken cargo ships drift near ALCATRAZ ISLAND, now crowned with crude scrap-metal walls and sweeping spotlights cutting through fog. The island looks fortified, military, alive — spotlights scanning the water in slow arcs. Rusted ship hulls break the water surface like metal whales. A faint red light blinks on a distant tower (Sutro Tower, barely visible). Pre-dawn, eerie, desolate beauty. The fog begins to thin slightly as dawn approaches.`,
    duration: 8,
    camera: 'slow_pan',
    hasDialogue: false,
  },
  {
    id: 4,
    title: 'TITLE CARD',
    entities: ['The Fog'],
    prompt: `Cinematic shot looking straight across the Bay as the first light of dawn breaks through radioactive fog, casting amber rays across the water. The silhouette of the ruined San Francisco skyline emerges from fog — cracked towers, skeletal structures. Title card appears: "FALLOUT: FOGLINE" in weathered military stencil font. The light shifts, fog swirls. Atmospheric, grand, ominous. Sound: distant rumble, wind, a single piano note fading. Movie poster composition brought to life.`,
    duration: 8,
    camera: 'static_wide',
    hasDialogue: false,
  },

  // ── OAKLAND: The Market ──
  {
    id: 5,
    title: 'Oakland Skyline — Morning',
    entities: ['Oakland Free Trade Zone', 'East Bay Scrap Market'],
    prompt: `Wide establishing shot of post-apocalyptic Oakland at morning. The East Bay hills in background, brown and barren. In the foreground, the ruins of downtown Oakland — crumbling buildings, collapsed overpasses, but smoke rising from cooking fires showing life. A sprawling scrap market visible in the center. The BART elevated tracks are broken but some sections serve as walkways. Morning light, dusty golden haze. Sounds of distant hammering and crowd noise. Post-apocalyptic settlement, alive and scrappy.`,
    duration: 8,
    camera: 'wide_establishing',
    hasDialogue: false,
  },
  {
    id: 6,
    title: 'Scrap Market — Wide Interior',
    entities: ['East Bay Scrap Market', 'Oakland Free Trade Zone'],
    prompt: `Tracking shot pushing into the EAST BAY SCRAP MARKET. A chaotic maze of welded sheet metal stalls, smashed Tesla vehicles converted to storefronts, busted BART subway cars repurposed as workshops. Hand-painted signs: "OAKLAND FREE TRADE ZONE", "NO SYNTHS", "CAPS OR BATTERIES ONLY". Traders hawk salvaged electronics, ammunition, canned food. Children run between stalls. A brahmin (two-headed cow) is tied to a parking meter. Dusty golden light filtering through makeshift roofing. Crowded, noisy, alive.`,
    duration: 8,
    camera: 'tracking_push',
    hasDialogue: false,
  },
  {
    id: 7,
    title: 'Mara Pushes Through Crowd',
    entities: ['Mara Reyes', 'East Bay Scrap Market'],
    prompt: `Medium tracking shot following MARA REYES (24) as she pushes through the crowded scrap market. Lean, sharp-eyed Latina woman wearing pieced-together armor made from highway road signs — green and white metal plates riveted together. An old Cal Berkeley golden football helmet on her head. A jury-rigged laser rifle strapped across her back. She moves with purpose, weaving through traders and scavengers. Her eyes scan the stalls — looking for something specific. Close enough to see determination in her face. Warm dusty light, shallow depth of field on her face.`,
    duration: 8,
    camera: 'tracking_follow',
    hasDialogue: false,
  },
  {
    id: 8,
    title: 'The Old Merchant — Booth Reveal',
    entities: ['The Old Merchant', 'East Bay Scrap Market'],
    prompt: `Mara approaches a booth made from a flipped autonomous taxi — its roof is the counter, its interior is shelving crammed with salvaged tech. An OLD MERCHANT sits behind the counter, weathered brown skin, white beard, fingerless gloves. He's examining a small device under a magnifying glass rig made from old spectacle lenses. Warm amber interior light, dust motes floating. The merchant looks up as Mara's shadow falls across his counter. Intimate market scene, close framing.`,
    duration: 8,
    camera: 'medium_approach',
    hasDialogue: false,
  },
  {
    id: 9,
    title: 'Signal Compass — First Look',
    entities: ['The Signal Compass', 'The Old Merchant', 'Mara Reyes'],
    prompt: `Extreme close-up of the SIGNAL COMPASS — a cracked, battered Vault-Tec device the size of a pocket watch. Its glass face is spiderwebbed but a faint green LED blinks steadily beneath the cracks. The merchant's weathered fingers turn it over, revealing the yellow Vault-Tec gear logo. The green light pulses — blink, blink, blink — pointing in a fixed direction. Mara's eyes reflect the green glow. The merchant's voice: "Been beeping toward Frisco for three weeks." Macro photography style, shallow focus, green light reflecting off faces.`,
    duration: 8,
    camera: 'extreme_closeup',
    hasDialogue: true,
  },
  {
    id: 10,
    title: 'The Haggle — Caps and Microfusion',
    entities: ['Mara Reyes', 'The Old Merchant', 'Microfusion Cells'],
    prompt: `Close two-shot of Mara and the Old Merchant negotiating. Mara digs out a leather pouch and pours bottle caps onto the counter — clearly not enough. She hesitates, then reaches into her vest and slides a GLOWING MICROFUSION CELL across the counter. The cell emits a soft blue-white glow. The merchant's eyes widen — this is serious currency. He looks at her with new respect and suspicion. "Where'd you get—" "Don't insult me by asking." He takes the cell. Intimate transaction, the glow of the cell illuminating both their faces.`,
    duration: 8,
    camera: 'close_two_shot',
    hasDialogue: true,
  },
  {
    id: 11,
    title: 'Merchant Warning — Sutro Tower',
    entities: ['The Old Merchant', 'Sutro Tower Relay Bunker', 'The Fog'],
    prompt: `Close-up of the Old Merchant leaning in conspiratorially, his face half in shadow. He speaks quietly — a warning. His eyes dart around to make sure nobody's listening. Behind him, a crude map is pinned to the taxi wall showing the Bay Area, with San Francisco marked with skull symbols. He taps the map near a tower icon. "Signal's strongest near Sutro Tower. Folk say a pre-war weather net's waking up. Others say Enclave ghosts." His face is grave. "Out here, they should." Atmospheric close-up, warm light, genuine concern on an old man's face.`,
    duration: 8,
    camera: 'close_up',
    hasDialogue: true,
  },
  {
    id: 12,
    title: 'Mara Leaves the Market',
    entities: ['Mara Reyes', 'East Bay Scrap Market', 'The Signal Compass'],
    prompt: `Wide shot from behind as Mara walks away from the scrap market, the signal compass now clipped to her belt, blinking green. She passes the "NO SYNTHS" sign and heads toward the collapsed freeway overpass. The market noise fades behind her. She checks the compass — it points west, toward the Bay, toward San Francisco. She adjusts her laser rifle strap and keeps walking. Determination in her stride. The market behind her, the wasteland ahead. Late morning light, long shadow stretching before her.`,
    duration: 8,
    camera: 'wide_following',
    hasDialogue: false,
  },

  // ── BART GRAVEYARD: Home ──
  {
    id: 13,
    title: "BART Graveyard — Mara's Home",
    entities: ['BART Graveyard — MacArthur Station', 'Mara Reyes'],
    prompt: `Wide shot of the collapsed MacArthur BART station. A dozen frozen subway cars sit on tracks — doors open, destination boards reading "SFO/Millbrae" after 219 years. Families have turned the cars into homes — curtains made from old maps hang in windows, cooking fires in cut-open oil drums on the platform. Children play between the cars. Mara walks along the platform toward Car 7 — her home. She touches the door frame briefly, then looks toward the tunnel entrance at the end of the platform. The darkness beyond. She's going in there. Domestic wasteland life meets impending danger.`,
    duration: 8,
    camera: 'wide_tracking',
    hasDialogue: false,
  },

  // ══════════════════════════════════════════════════════════════════════
  // ACT 2: THE TUNNEL (2:40 – 4:48) — 16 clips = 128s
  // ══════════════════════════════════════════════════════════════════════

  {
    id: 14,
    title: 'Tunnel Entrance — West Oakland',
    entities: ['Transbay Tunnel', 'Mara Reyes'],
    prompt: `Cinematic shot of Mara standing at the entrance to the collapsed BART tunnel in West Oakland. A jagged opening in concrete and rebar leads into absolute darkness. Warning signs — faded, pre-war — read "AUTHORIZED PERSONNEL ONLY" and "DANGER: STRUCTURAL INSTABILITY". Fresh scavenger guild chalk marks on the wall: an arrow pointing down and a symbol meaning "passable with caution". Mara clicks on her flashlight. The beam barely penetrates the black. She takes a breath and descends. The light of day shrinks behind her. Threshold moment, light to dark.`,
    duration: 8,
    camera: 'medium_static',
    hasDialogue: false,
  },
  {
    id: 15,
    title: 'Tunnel Interior — Maintenance Shaft',
    entities: ['Transbay Tunnel'],
    prompt: `First-person-adjacent shot moving through the Transbay Tunnel maintenance shaft. A narrow concrete corridor beneath San Francisco Bay. Cracked walls, dripping water from the ceiling, puddles reflecting a single flashlight beam. Ancient emergency lights flicker — orange, dim, barely functional — every fifty feet. Exposed pipes run along the ceiling, some leaking. The sound design: dripping water, distant groaning metal, footsteps echoing. Claustrophobic, horror-adjacent. The flashlight beam catches something — old graffiti: "QUINN WAS HERE" scratched into concrete.`,
    duration: 8,
    camera: 'pov_push',
    hasDialogue: false,
  },
  {
    id: 16,
    title: 'Compass Goes Wild',
    entities: ['The Signal Compass', 'Mara Reyes', 'Transbay Tunnel'],
    prompt: `Close-up of the signal compass on Mara's belt — the green LED is now blinking rapidly, almost strobing. She holds it up, the green glow illuminating her face in the dark tunnel. The compass needle spins, then locks toward the west end of the tunnel — San Francisco. Something is close. She hears a SPLASH in the darkness ahead. She freezes. Her flashlight beam holds steady but her breathing quickens. The compass keeps blinking. Tension building, green light pulsing in darkness, survival horror atmosphere.`,
    duration: 8,
    camera: 'close_then_pull',
    hasDialogue: false,
  },
  {
    id: 17,
    title: 'Amos Steps Out — "Charging Double"',
    entities: ['Amos Quinn', 'Transbay Tunnel', 'Ghouls'],
    prompt: `A VOICE echoes from the darkness: "If you shoot me, I'm charging double for directions." Mara's flashlight snaps toward the voice. Out steps AMOS QUINN — a GHOUL. Skin like burnt parchment, cracked and leathery. Intelligent, tired eyes that have seen 219 years of the worst humanity has to offer. He wears a torn San Francisco MUNI transit jacket, faded blue, with a name patch still readable: "QUINN". He carries a long-barreled revolver in one hand and raises the other in a lazy half-wave. His expression is bone-dry amusement. Dramatic character reveal, chiaroscuro lighting.`,
    duration: 8,
    camera: 'reveal_push',
    hasDialogue: true,
  },
  {
    id: 18,
    title: 'Standoff — Mara and Amos',
    entities: ['Mara Reyes', 'Amos Quinn'],
    prompt: `Tense two-shot in the tunnel. Mara has her laser rifle aimed at Amos. He hasn't raised his revolver — just looks at her with tired patience. Emergency light casts orange pools between them. "You're following me?" "No. I'm surviving in the exact same tunnel you walked into like it belonged to you." He notices the signal compass on her belt — the green blink reflects in his ghoul eyes. His expression shifts. Recognition. "Well, hell. That explains it." He knows something. Standoff dissolving into reluctant alliance. Dramatic underground lighting.`,
    duration: 8,
    camera: 'two_shot_static',
    hasDialogue: true,
  },
  {
    id: 19,
    title: 'The Growl — Something in the Dark',
    entities: ['Feral Ghoul Packs', 'Transbay Tunnel'],
    prompt: `Both characters freeze. A LOW GROWL rises from deeper in the tunnel — guttural, inhuman, multiplying. More growls join. The sound of bare feet slapping on wet concrete. Scraping nails. Mara's flashlight beam catches MOVEMENT in the darkness — pale, hunched shapes shifting between pillars. FERAL GHOULS. Dozens of glowing eyes catch the light. Amos sighs heavily: "And why we should keep moving." Pure horror tension, survival instinct. Dark tunnel, multiple threat contacts, flashlight sweeping.`,
    duration: 8,
    camera: 'tension_hold',
    hasDialogue: true,
  },
  {
    id: 20,
    title: 'Feral Attack — First Wave',
    entities: ['Feral Ghoul Packs', 'Mara Reyes', 'Transbay Tunnel'],
    prompt: `FERALS ATTACK. A pack of feral ghouls — mindless, irradiated humans with decayed grey skin, missing lips exposing teeth, glowing yellow eyes — lurches from the darkness in a screaming charge. Mara opens fire — RED LASER BOLTS slash through the tunnel, each shot illuminating the corridor in crimson flashes. A feral's torso explodes in a burst of irradiated gore. Two more charge from the left. The laser rifle strobes like a deadly flashlight. Intense close-quarters combat in confined space, muzzle flash and laser bolts cutting darkness.`,
    duration: 8,
    camera: 'dynamic_action',
    hasDialogue: false,
  },
  {
    id: 21,
    title: 'Amos — Clean Revolver Work',
    entities: ['Amos Quinn', 'Feral Ghoul Packs'],
    prompt: `AMOS fires his revolver — BOOM, BOOM — two precise shots. Each muzzle flash fills the tunnel with white light for a split second. Two ferals drop mid-sprint, clean headshots. The revolver is huge in his ghoul hands, kick controlled by decades of practice. He fires methodically while backing up, each shot placed. No panic, just 219 years of practice. Spent casings ring on concrete. Between shots, the darkness closes in again. Sound design: booming revolver echoes, feral screams, shell casings.`,
    duration: 8,
    camera: 'medium_tracking',
    hasDialogue: false,
  },
  {
    id: 22,
    title: 'Feral Leaps on Mara — Transit Spike Kill',
    entities: ['Mara Reyes', 'Feral Ghoul Packs'],
    prompt: `A FERAL GHOUL leaps from above — it tackles Mara to the ground. Her laser rifle clatters away. The feral snaps its jaws inches from her face, drooling irradiated saliva. She struggles, one hand on its throat pushing it back. With her free hand she grabs a RUSTED TRANSIT SPIKE from her belt and drives it through the feral's skull. The creature goes limp. She shoves the body off, gasping. Amos grabs her arm and pulls her to her feet. "Run!" Visceral close combat, desperate survival, horror action.`,
    duration: 8,
    camera: 'ground_level_action',
    hasDialogue: false,
  },
  {
    id: 23,
    title: 'Sprint Through the Shaft',
    entities: ['Mara Reyes', 'Amos Quinn', 'Feral Ghoul Packs', 'Transbay Tunnel'],
    prompt: `Handheld tracking shot — Mara and Amos SPRINT through the maintenance shaft. Feral ghouls chase them, a wave of pale bodies and glowing eyes pouring through the corridor behind them. Emergency lights strobe past as they run. Amos's MUNI jacket flaps behind him. Mara's highway-sign armor clangs with every stride. The ferals are fast, closing the gap. The tunnel is narrow — no room to fight, only room to run. Pure chase energy, horror pursuit, claustrophobic sprint.`,
    duration: 8,
    camera: 'handheld_chase',
    hasDialogue: false,
  },
  {
    id: 24,
    title: 'Bulkhead Gate — Seal Them In',
    entities: ['Transbay Tunnel', 'Mara Reyes'],
    prompt: `Mara spots a BULKHEAD EMERGENCY GATE — a massive steel blast door on hydraulic rails. She slams the activation button on the wall. The gate SCREECHES to life, grinding downward on ancient hydraulics. Two ferals dive under the closing gap — she kicks one back, the gate CRUSHES the second one, spattering the floor. The gate slams shut with a deafening CLANG. Ferals pound on the other side, screaming. Then silence. Just the sound of Mara and Amos breathing hard. The crisis is over. Emergency amber light, aftermath of violence, two survivors catching their breath.`,
    duration: 8,
    camera: 'action_to_stillness',
    hasDialogue: false,
  },
  {
    id: 25,
    title: 'Mara Confronts Amos — "You Know"',
    entities: ['Mara Reyes', 'Amos Quinn', 'The Signal Compass'],
    prompt: `Mara turns to Amos in the aftermath. Both breathing hard. Blood (not theirs) on their clothes. She holds up the signal compass — still blinking green, still pointing west. "You know where that signal goes." "Yeah." "Then you're coming with me." "No." Beat. "You really want me guessing my way through San Francisco?" He stares at her. Sighs the sigh of a man who's been alive too long to argue with someone this stubborn. "Fine. But when this gets ugly, I reserve the right to say I told you so." He starts walking. Reluctant partnership forming, dramatic tunnel light.`,
    duration: 8,
    camera: 'close_dialogue',
    hasDialogue: true,
  },

  // ══════════════════════════════════════════════════════════════════════
  // ACT 3: SAN FRANCISCO (4:48 – 7:12) — 18 clips = 144s
  // ══════════════════════════════════════════════════════════════════════

  {
    id: 26,
    title: 'Emerging into SF — First Light',
    entities: ['San Francisco Ruins', 'Mara Reyes', 'Amos Quinn'],
    prompt: `Mara and Amos emerge from underground into San Francisco. First daylight after the tunnel — blinding for a moment. The camera pulls back to reveal the ruined city in a slow, breathtaking wide shot. Downtown towers stand cracked and hollow, windows blown out, vegetation growing from upper floors. Cable cars lie fused into the streets exactly where they stopped 219 years ago. An overturned bus serves as a planter for mutated ferns. The scale is staggering — a dead megacity, beautiful in its decay. Epic post-apocalyptic establishing shot, golden afternoon light.`,
    duration: 8,
    camera: 'slow_pullback_reveal',
    hasDialogue: false,
  },
  {
    id: 27,
    title: 'SF Details — Fused Cable Cars',
    entities: ['San Francisco Ruins'],
    prompt: `Montage of San Francisco wasteland details. Close-up: a cable car fused into its rail, metal melted by nuclear heat into the asphalt. Medium: mutated eucalyptus trees twenty stories tall pushing through a parking garage, roots cracking concrete. Wide: the Transamerica Pyramid, its top third broken off, the remaining structure wrapped in vines. Close-up: a pre-war parking meter still showing "EXPIRED". Each detail tells the story of a city frozen at the moment of destruction and slowly consumed by nature. Beautiful decay, quiet devastation.`,
    duration: 8,
    camera: 'detail_montage',
    hasDialogue: false,
  },
  {
    id: 28,
    title: 'Sutro Tower — First Clear View',
    entities: ['Sutro Tower Relay Bunker', 'Amos Quinn'],
    prompt: `Amos points toward the horizon. Through a gap between ruined buildings, SUTRO TOWER is visible for the first time — a massive skeletal communications tower on Twin Peaks, three-pronged, wrapped in rust and improvised scaffolding. Its red warning light BLINKS steadily through the fog. The signal compass on Mara's belt blinks in sync with the tower light. Amos: "That tower's not just a tower. Pre-war relay nexus." He knows this place. He worked for the city that built it. Dramatic reveal shot, the tower as destination and destiny.`,
    duration: 8,
    camera: 'reveal_point',
    hasDialogue: true,
  },
  {
    id: 29,
    title: 'Brotherhood Graffiti — "TECH BELONGS TO THE ORDER"',
    entities: ['Brotherhood Outcasts', 'San Francisco Ruins'],
    prompt: `Close-up on a wall: fresh blood-red spray paint letters reading "TECH BELONGS TO THE ORDER". The paint drips are recent — days old. Mara and Amos see it simultaneously. Amos stops walking. His expression darkens. "Brotherhood scouts." The camera pulls back to reveal more graffiti: the Brotherhood of Steel gear symbol, crude but recognizable. Territorial markings. Warnings. The city isn't empty — it's claimed. Mara: "Then we move faster." Ominous discovery, red paint on grey concrete, threat established.`,
    duration: 8,
    camera: 'close_to_wide',
    hasDialogue: true,
  },
  {
    id: 30,
    title: 'Amos Explains FOGLINE',
    entities: ['Amos Quinn', 'FOGLINE Civic Response Grid', 'Offshore Weather Beacons'],
    prompt: `Walking shot — Amos and Mara move through SF ruins as Amos explains what the tower is. He speaks while scanning rooftops for Brotherhood. Medium two-shot, walking and talking. "Pre-war relay nexus. Weather control, emergency signal routing, military line-of-sight links... all patched together after the bombs by whoever lived long enough to need it." He pauses at a junction, checks a compass bearing. "If it's active? Then someone up there can talk to everything from Marin to San Jose." He knows more than he's saying. Walking dialogue scene, post-apocalyptic backdrop scrolling past.`,
    duration: 8,
    camera: 'walk_and_talk',
    hasDialogue: true,
  },
  {
    id: 31,
    title: "Mara's Plea — Oakland Needs Water",
    entities: ['Mara Reyes', 'East Bay Water Crisis', 'Oakland Free Trade Zone'],
    prompt: `Mara stops walking and faces Amos. Close-up on her face — urgent, desperate beneath the tough exterior. "My settlement in Oakland's been rationing brown water for a month. If that tower can wake a purifier, reroute a pump, open a reservoir —" She's not asking for adventure. She's trying to save her people. Amos looks at her, then at the ruined city. "You're hoping the old world left you a gift." "Didn't it ever leave one for you?" Beat. "It left me this face." Emotional dialogue exchange, vulnerability breaking through armor — literal and figurative.`,
    duration: 8,
    camera: 'shot_reverse_shot',
    hasDialogue: true,
  },

  // ── HAIGHT STREET: The Ambush ──
  {
    id: 32,
    title: 'Haight Street — Bone Wind Chimes',
    entities: ['Haight Street Ruins'],
    prompt: `Atmospheric establishing shot of Haight Street. A narrow corridor of bombed-out storefronts, the former heart of 1960s counterculture. Wind chimes made from human and animal BONES click and rattle in the radioactive fog. A faded peace sign is visible beneath a mural of a MUSHROOM CLOUD painted over it — the wasteland's dark commentary on the Summer of Love. Fog drifts between the buildings. Everything is still. Too still. Sound design: bone chimes clicking, wind moaning through broken windows, distant fog horn.`,
    duration: 8,
    camera: 'slow_dolly',
    hasDialogue: false,
  },
  {
    id: 33,
    title: "Laser Sight on Mara's Chest",
    entities: ['Mara Reyes', 'Brotherhood Outcasts'],
    prompt: `Close-up on Mara's chest armor (highway sign metal). A RED LASER DOT appears on the metal, right over her heart. She looks down at it. Her eyes widen. She starts to raise her hands. Three laser dots now — one on Mara, one on Amos, one sweeping between them. They've walked into an ambush. Mara's hand moves slowly toward her laser rifle. The dot tracks her movement. Sound: clicking of weapons being readied from behind cover. Tension, threat, the moment before violence.`,
    duration: 8,
    camera: 'close_tension',
    hasDialogue: false,
  },
  {
    id: 34,
    title: 'Vega Steps Out — "Drop the Rifle"',
    entities: ['Paladin Vega', 'Brotherhood Outcasts', 'Haight Street Ruins'],
    prompt: `Three BROTHERHOOD OUTCASTS step from cover behind ruined storefronts. Mixed armor — salvaged power armor plates bolted over combat fatigues, not standard Brotherhood issue. Their leader is PALADIN VEGA (30s) — sharp features, military-short hair, cold disciplined eyes. She wears the heaviest armor, a glowing PLASMA PISTOL aimed at Mara. "Drop the rifle." Her voice is flat, commanding, practiced. Two soldiers flank her — one with a laser rifle, one with a minigun on a shoulder mount. Professional, organized, dangerous. Military standoff in the ruins.`,
    duration: 8,
    camera: 'villain_reveal',
    hasDialogue: true,
  },
  {
    id: 35,
    title: 'Vega Claims the Compass',
    entities: ['Paladin Vega', 'Mara Reyes', 'The Signal Compass'],
    prompt: `Close exchange between Vega and Mara. Mara has her hands half-raised, defiant. Vega eyes the signal compass on Mara's belt. "That signal compass is Brotherhood property." "Didn't have your name on it." "Everything useful had our name on it. People just forgot." One Outcast soldier moves to seize the compass. Mara ELBOWS him — quick, instinctive — grabs the compass and backs up. Vega raises the plasma pistol higher. The pistol glows purple-hot. "Last warning." Intense close-quarters standoff, power dynamics shifting.`,
    duration: 8,
    camera: 'close_confrontation',
    hasDialogue: true,
  },
  {
    id: 36,
    title: 'Amos Mediates — "You Lose Your Guide"',
    entities: ['Amos Quinn', 'Paladin Vega'],
    prompt: `Amos steps forward between Mara and Vega's plasma pistol. He doesn't raise his hands — just stands there, looking at Vega with the exhausted patience of a man who's outlived every conflict he's ever seen. "You shoot her, you lose your guide." "I have maps." "From before half the city slid into the ocean? Good luck." Beat. Vega studies the ghoul. She lowers the pistol slightly — not putting it away, just an inch of concession. The moment a standoff becomes a negotiation. Dramatic three-way composition.`,
    duration: 8,
    camera: 'three_shot',
    hasDialogue: true,
  },
  {
    id: 37,
    title: 'Reluctant Alliance — "Civilization Decides"',
    entities: ['Paladin Vega', 'Mara Reyes', 'Amos Quinn'],
    prompt: `Medium group shot. Vega makes her terms: "We go together. We secure the relay. Then we decide who gets to use it." Mara: "That means you decide." Vega: "That means civilization decides." Mara: "Civilization's been deciding without Oakland for two hundred years." Vega studies Mara for a long moment — recognizing something. Then nods. "Move." The group forms — an uneasy five: Mara, Amos, Vega, and two Outcast soldiers. Walking toward Sutro Tower together. Enemies becoming reluctant allies, marching formation.`,
    duration: 8,
    camera: 'group_walk',
    hasDialogue: true,
  },

  // ── MARCH TO SUTRO ──
  {
    id: 38,
    title: 'March Through SF Ruins — Montage',
    entities: ['San Francisco Ruins', 'Mara Reyes', 'Amos Quinn', 'Paladin Vega'],
    prompt: `Montage of the group of five moving through San Francisco ruins toward Sutro Tower. Wide shot crossing a ruined intersection, power armor soldiers scanning rooftops. Medium: Mara and Amos walking side by side, not talking to the Brotherhood, talking quietly to each other. Close: Vega checking a map, comparing it to the actual terrain — half the streets have collapsed or been reclaimed by vegetation. The tower grows larger with each shot, its red light blinking. Tension between allies who don't trust each other. Golden hour light through fog.`,
    duration: 8,
    camera: 'montage_march',
    hasDialogue: false,
  },
  {
    id: 39,
    title: 'Sutro Tower — Full Approach',
    entities: ['Sutro Tower Relay Bunker', 'FOGLINE Civic Response Grid'],
    prompt: `Epic low-angle shot of SUTRO TOWER filling the frame. The three-pronged communications tower looms above the shattered city, enormous, skeletal, wrapped in rust and improvised scaffolding from unknown repair attempts. It's taller than anything still standing in San Francisco. The red warning light at the top blinks steadily. At its base: a fortified maintenance bunker with old Vault-Tec vault-gear logos and U.S. military stencil markings on blast doors. The compass device on Mara's belt goes WILD — blinking so fast it's nearly solid green. They've arrived. Epic scale, monumental.`,
    duration: 8,
    camera: 'low_angle_epic',
    hasDialogue: false,
  },
  {
    id: 40,
    title: 'Bunker Door Opens — Lights Already On',
    entities: ['Sutro Tower Relay Bunker', 'Sergeant Rook'],
    prompt: `One Outcast soldier (SERGEANT ROOK) pries open the heavy bunker door with a crowbar. It groans open, revealing: the interior is already LIT. Green light spills out from inside. Everyone tenses. Weapons come up. Rook looks back at Vega — this wasn't expected. The bunker should be dead, sealed, dark. Instead: humming power, glowing screens, warmth. Something has been alive in here for a very long time. The group enters cautiously, weapons drawn. Threshold moment, mystery revealed, green light washing over their faces.`,
    duration: 8,
    camera: 'doorway_reveal',
    hasDialogue: false,
  },

  // ══════════════════════════════════════════════════════════════════════
  // ACT 4: FOGLINE (7:12 – 9:04) — 14 clips = 112s
  // ══════════════════════════════════════════════════════════════════════

  {
    id: 41,
    title: 'Bunker Interior — Server Room',
    entities: ['Sutro Tower Relay Bunker', 'FOGLINE Civic Response Grid'],
    prompt: `Interior of the relay bunker. Banks of ANCIENT SERVERS hum with power, cooling fans spinning after 219 years. Rows of blinking status lights — green, amber, red. Cable bundles thick as arms run along the ceiling. The air is warm, dry, electric. Dust motes swirl in the green monitor glow. The place feels alive — a heart beating underground while the world above died. The group spreads out, weapons lowered slightly, awed by the scale of functioning pre-war technology. Retro-futuristic data center aesthetic, green CRT glow.`,
    duration: 8,
    camera: 'slow_pan_interior',
    hasDialogue: false,
  },
  {
    id: 42,
    title: 'Main Terminal — "BAY CIVIC RESPONSE GRID"',
    entities: ['FOGLINE', 'FOGLINE Civic Response Grid', 'Mara Reyes'],
    prompt: `Mara approaches the biggest terminal screen. It flickers and displays green text: "BAY CIVIC RESPONSE GRID — STANDBY". Below it: system status readouts, uptime counters showing 219 years of continuous operation, weather beacon status, water infrastructure maps. Mara's face is illuminated by the screen — awe, hope, disbelief. She reaches out and almost touches the glass. Close-up on the screen reflected in her eyes. This is what the signal compass was pointing to. This is the old world's last gift. Reverent discovery, green light, wonder.`,
    duration: 8,
    camera: 'close_discovery',
    hasDialogue: false,
  },
  {
    id: 43,
    title: 'FOGLINE Speaks — "Welcome, Continuity Personnel"',
    entities: ['FOGLINE', 'Mara Reyes', 'Paladin Vega'],
    prompt: `A SPEAKER crackles overhead. A calm female voice — clipped, artificial, polite: "Unauthorized municipal access detected. Welcome, Bay Area continuity personnel." Everyone freezes. The voice comes from everywhere — ceiling speakers, the terminal, even a small speaker in the wall. It's FOGLINE. An AI that's been talking to an empty room for 219 years, now finally has visitors. Vega raises her pistol toward the ceiling: "Identify yourself." "I am FOGLINE, regional emergency coordination intelligence. Last full update: October 23, 2077." Everyone absorbs that date. The day the world ended. Chilling AI revelation.`,
    duration: 8,
    camera: 'reaction_montage',
    hasDialogue: true,
  },
  {
    id: 44,
    title: 'Mara Asks — "Can You Restore Water?"',
    entities: ['Mara Reyes', 'FOGLINE', 'East Bay Water Crisis'],
    prompt: `Close-up on Mara's face, illuminated by green terminal light. She asks the question she crossed the Bay for: "Can you restore water service to Oakland?" The terminal processes. Text scrolls. FOGLINE responds: "Partial answer: yes." Mara's face — half a second of pure, startled HOPE. Then: "Required conditions: reactivation of East Bay pumping spine, clearance of contamination valves, and sacrifice of forty-two percent remaining tower power reserves." The hope flickers. Forty-two percent. That's a lot. Emotional close-up, hope tested by reality.`,
    duration: 8,
    camera: 'extreme_close',
    hasDialogue: true,
  },
  {
    id: 45,
    title: 'Vega Objects — "Power Is Strategic"',
    entities: ['Paladin Vega', 'Mara Reyes'],
    prompt: `Vega steps forward, voice sharp: "Negative. Power is strategic. We preserve it for communications and defense." Mara rounds on her: "People are drinking poison." "People always are." The two women face each other across the terminal — Mara in scavenged highway signs, Vega in Brotherhood power armor. Two worldviews in direct collision. The green terminal light casts their shadows on opposite walls. Ideological confrontation, dramatic two-shot, political tension made personal.`,
    duration: 8,
    camera: 'confrontation_two_shot',
    hasDialogue: true,
  },
  {
    id: 46,
    title: 'Amos at the Terminal — Weather Data',
    entities: ['Amos Quinn', 'FOGLINE', 'Offshore Weather Beacons', 'The Fog'],
    prompt: `While Mara and Vega argue, Amos quietly steps to a side terminal and scans readouts. Data scrolls — weather patterns, beacon status, power allocation charts. His ghoul eyes widen. He's found something. "Not exactly." He turns to the group. "FOGLINE's been holding back a storm wall offshore for years with weather beacons. If he hoards the power for radio toys, the fog gets worse. Crops die from here to Vallejo." He looks at Vega. The tactical calculation just changed. Close-up on data screens, Amos connecting the dots, revelation moment.`,
    duration: 8,
    camera: 'discovery_reveal',
    hasDialogue: true,
  },
  {
    id: 47,
    title: 'Vega Draws — "Step Back"',
    entities: ['Paladin Vega', 'Mara Reyes'],
    prompt: `Vega's jaw tightens. "We can rebuild agriculture later." Mara: "With what people?" Vega raises her plasma pistol directly at Mara — the weapon hums, glowing hot purple. "I said step back." The room goes absolutely still. The Outcast soldiers shift uncomfortably. The terminal screens glow green, indifferent to human conflict. A standoff in the nerve center of the old world. The plasma pistol fills the frame, aimed at Mara's chest. Maximum tension, weapons drawn, irreversible choice approaching.`,
    duration: 8,
    camera: 'tension_extreme',
    hasDialogue: true,
  },
  {
    id: 48,
    title: 'FOGLINE — "Municipal Arbitration Available"',
    entities: ['FOGLINE', 'The Civic Oath Protocol'],
    prompt: `Into the silence, FOGLINE speaks: "Advisory: command deadlock detected. Municipal arbitration available." Everyone looks at the speaker. "What kind of arbitration?" "Single authorized operator may be recognized through legacy civic oath." Amos lets out a dry, disbelieving laugh. "You have got to be kidding me." "Please state your department and service designation." Close-up on Amos's face — something old wakes up in him. Something he hasn't been in 219 years. A city employee. Green terminal glow on his ghoul features, a lifetime of identity crystallizing.`,
    duration: 8,
    camera: 'reaction_close',
    hasDialogue: true,
  },
  {
    id: 49,
    title: 'Amos Takes the Oath — Badge 11-4-7-2',
    entities: ['Amos Quinn', 'FOGLINE', 'The Civic Oath Protocol'],
    prompt: `Close-up on AMOS at the terminal. He stands straighter than he has in decades. He speaks clearly, formally, like reporting for duty: "Amos Quinn. San Francisco Municipal Transit. Maintenance division. Badge... 11-4-7-2." The terminal processes. A beat. FOGLINE: "Identity partially confirmed. Pre-war employee pension records found. Civic access granted." Mara blinks: "You were a janitor?" Amos: "Transit systems engineer." Beat. "Mostly janitor." A moment of absurd heroism — a janitor's badge number saving the world. Emotional, funny, deeply human.`,
    duration: 8,
    camera: 'hero_close',
    hasDialogue: true,
  },
  {
    id: 50,
    title: 'Vega Lunges — Chaos in the Bunker',
    entities: ['Paladin Vega', 'Mara Reyes', 'Amos Quinn'],
    prompt: `Vega LUNGES for the console. Mara TACKLES her. They crash into a server rack — sparks fly. Vega's plasma pistol fires wild — a MONITOR EXPLODES in a shower of glass and green sparks. One Outcast grabs Mara. Another goes for Amos. Chaos in the bunker — bodies slamming into equipment, sparks cascading, alarms triggering. Amos fights toward the terminal, shoving past a soldier. The bunker lights flicker from the damage. Physical conflict in a cramped space full of irreplaceable technology. Controlled chaos, stakes at maximum.`,
    duration: 8,
    camera: 'chaos_action',
    hasDialogue: false,
  },
  {
    id: 51,
    title: 'Amos Activates FOGLINE — "Full Civic Priority!"',
    entities: ['Amos Quinn', 'FOGLINE', 'FOGLINE Civic Response Grid'],
    prompt: `Amos SLAMS his hand onto the main terminal. He shouts over the chaos: "FOGLINE! Route power to East Bay pumps and storm beacons. Full civic priority!" FOGLINE responds immediately: "Command accepted." SIRENS WAIL through the bunker. The lights dim, then shift — power rerouting through the entire system. The tower above them begins to THRUM, vibrating through the floor. Status screens cascade: "EAST BAY PUMPING SPINE: REACTIVATING", "WEATHER BEACONS: ONLINE", "POWER RESERVES: 58% → 16%". The old world's last gift, activated by a janitor. Triumphant system activation, urgent and victorious.`,
    duration: 8,
    camera: 'climax_action',
    hasDialogue: true,
  },
  {
    id: 52,
    title: 'Mara Seizes the Plasma Pistol — "Enough!"',
    entities: ['Mara Reyes', 'Paladin Vega', "Vega's Plasma Pistol"],
    prompt: `Vega throws Mara off and charges Amos. Mara spots Vega's dropped plasma pistol on the floor. She snatches it up and FIRES — past Vega's head, deliberately missing by inches. The plasma bolt EXPLODES a steam pipe behind Vega — superheated steam blasts across the room. Everyone FREEZES. Mara stands with the plasma pistol in both hands, aimed at Vega. Steam hisses around them. "ENOUGH!" The room is chaos frozen — steam, sparks, broken monitors, five people breathing hard. The power has shifted. Mara has the gun now. Dramatic power reversal, steam and green light.`,
    duration: 8,
    camera: 'power_shift',
    hasDialogue: true,
  },
  {
    id: 53,
    title: 'FOGLINE Status Report — "27 Percent Improvement"',
    entities: ['FOGLINE', 'East Bay Water Crisis'],
    prompt: `Through the hissing steam and flickering lights, FOGLINE's calm voice cuts through: "East Bay pumping spine reactivated. Offshore fog suppression beacons online. Estimated potable water improvement in Oakland sectors: twenty-seven percent within forty-eight hours." Close-up on Mara's face as she hears the numbers. Twenty-seven percent. Her people will have clean water in two days. She exhales — stunned, relieved, overwhelmed. Tears she'd never admit to. The terminal displays scrolling status updates in green. Mission accomplished. Emotional payoff, the weight lifting.`,
    duration: 8,
    camera: 'emotional_close',
    hasDialogue: true,
  },
  {
    id: 54,
    title: 'Vega\'s Fury — "For Squatters"',
    entities: ['Paladin Vega', 'Amos Quinn'],
    prompt: `Vega stares at the darkened communication screens — the strategic asset she came for is gone, power diverted to water and weather. Furious: "You just burned a strategic asset for squatters." Amos turns to her, utterly calm. "No." He looks her in the eye. "For citizens." The word hangs in the air. Citizens. Not squatters, not wastelanders, not survivors. Citizens. A pre-war word, from a pre-war man, for a concept nobody's used in 219 years. Vega has no response. Close-up exchange, moral victory, the power of a single word.`,
    duration: 8,
    camera: 'dialogue_close',
    hasDialogue: true,
  },

  // ══════════════════════════════════════════════════════════════════════
  // ACT 5: THE BAY REMEMBERS (9:04 – 10:00) — 7 clips = 56s
  // ══════════════════════════════════════════════════════════════════════

  {
    id: 55,
    title: 'Sutro Tower Overlook — Fog Thinning',
    entities: ['The Fog', 'Offshore Weather Beacons'],
    prompt: `Wide shot from the Sutro Tower overlook at night. The fog over the Bay begins to THIN — visibly, dramatically. Gaps open in the radioactive blanket. For the first time, MOONLIGHT touches the broken black water of San Francisco Bay. The water shimmers silver where the fog has pulled back. The weather beacons are working. The air is clearing. Beautiful, ethereal, transformative. The ugliest feature of the wasteland — the fog — is retreating. Night sky, moonlight on water, fog dissolving, post-apocalyptic beauty.`,
    duration: 8,
    camera: 'slow_wide_pan',
    hasDialogue: false,
  },
  {
    id: 56,
    title: 'East Bay Lights — Oakland Wakes Up',
    entities: ['Oakland Free Trade Zone', 'East Bay Water Crisis'],
    prompt: `In the distance across the Bay, LIGHTS FLICKER TO LIFE. One by one, then in clusters — patches of warm amber light appearing in the East Bay darkness. Oakland is waking up. Water pumps reactivating means power flowing means lights turning on for the first time. It's a cascade — each light triggering another as the municipal grid partially restores. From Sutro Tower, it looks like stars falling to earth on the far shore. Two silhouettes — Mara and Amos — stand watching from the overlook. Hope made visible. City lights returning to life, emotional wide shot.`,
    duration: 8,
    camera: 'wide_emotional',
    hasDialogue: false,
  },
  {
    id: 57,
    title: 'Mara and Amos — Overlook Conversation',
    entities: ['Mara Reyes', 'Amos Quinn'],
    prompt: `Mara stands at the overlook railing, watching Oakland's lights. Amos joins her, producing a cigarette he doesn't need (ghoul lungs) and lighting it. The flame briefly illuminates his ghoul features. "You could've kept the tower." "For what? So I could die guarding another machine nobody deserves?" He looks toward Oakland. "Better this way. City finally did one decent thing." Quiet moment between two people who just changed the world and are processing it. Night air, distant city glow, intimacy after chaos. The calm after the storm.`,
    duration: 8,
    camera: 'two_shot_quiet',
    hasDialogue: true,
  },
  {
    id: 58,
    title: 'Sutro Tower Heartbeat',
    entities: ['Sutro Tower Relay Bunker', 'FOGLINE Civic Response Grid'],
    prompt: `Medium-wide shot of Sutro Tower from below at night. The tower's red warning light pulses steadily — THRUM, THRUM, THRUM — like a giant heartbeat. The tower is alive. FOGLINE is alive. The system is running. The red light illuminates the fog in pulses, painting the clouds crimson, then dark, then crimson again. The tower that held the old world's last gift is now the heartbeat of the new one. Iconic visual: the tower as a living thing, pulsing red against the clearing night sky. Sound: deep rhythmic thrum, almost organic.`,
    duration: 8,
    camera: 'low_angle_pulse',
    hasDialogue: false,
  },
  {
    id: 59,
    title: 'FOGLINE — "Thank You for Your Patience"',
    entities: ['FOGLINE'],
    prompt: `Close-up on a speaker mounted on the bunker exterior. FOGLINE's voice emerges one last time, calm, bureaucratic, oddly warm: "Municipal notice: service restoration in progress. Thank you for your patience." Amos LAUGHS — genuine, surprised, the first real laugh he's had in years. "There's the old world." The absurdity and beauty of a government AI politely thanking citizens for waiting 219 years. Amos's laughter echoes across the hilltop. Close-up on speaker, then Amos's laughing ghoul face. Comedy and pathos in one beat.`,
    duration: 8,
    camera: 'close_comedy',
    hasDialogue: true,
  },
  {
    id: 60,
    title: 'Walking Home — Down the Hill',
    entities: ['Mara Reyes', 'Amos Quinn'],
    prompt: `Wide shot from behind. Mara shoulders her laser rifle and starts walking down the hill toward the distant glowing lights of Oakland across the Bay. The path is rough — rubble, weeds, broken road. Amos follows a few steps behind, cigarette trailing smoke. Behind them, Sutro Tower pulses red. Ahead, Oakland glows amber. Between them, the fog-thinned Bay shimmers in moonlight. They walk in comfortable silence — two strangers who became partners, heading toward a future neither expected. Emotional, hopeful, cinematic. The long walk home.`,
    duration: 8,
    camera: 'wide_walking',
    hasDialogue: false,
  },
  {
    id: 61,
    title: 'Final Frame — Stars Over the Bay',
    entities: ['The Fog', 'Golden Gate Bridge Ruins'],
    prompt: `Final shot. The widest lens. San Francisco Bay at night from high above. The fog has thinned enough that for the first time in the story, STARS are visible. The Milky Way stretches faintly above the broken Golden Gate Bridge. Oakland glows in the east. Sutro Tower pulses in the west. The Bay shimmers between them. Two tiny figures walk along the eastern shore, heading home. Title card fades in: "WAR NEVER CHANGES. BUT CITIES DO." Hold on the stars, the bridge, the lights. The Bay Area is still alive. Final frame, emotional, vast, hopeful. Fade to black.`,
    duration: 8,
    camera: 'ultra_wide_final',
    hasDialogue: false,
  },
];

// ── Video Generation ────────────────────────────────────────────────────

interface GeneratedClip {
  sceneId: number;
  title: string;
  videoUrl: string;
  generationId: string;
  prompt: string;
}

async function generateSceneVideo(
  scene: Scene,
  wikiContext: string,
  model: string
): Promise<GeneratedClip> {
  // Prepend wiki context to the prompt
  const fullPrompt = wikiContext ? `${wikiContext}\n\n---\n\n${scene.prompt}` : scene.prompt;

  console.log(`\n  Prompt (${fullPrompt.length} chars):`);
  console.log(`  ${scene.prompt.slice(0, 120)}...`);
  console.log(`  Model: ${model} | Duration: ${scene.duration}s | Audio: ${scene.hasDialogue}`);

  if (DRY_RUN) {
    return {
      sceneId: scene.id,
      title: scene.title,
      videoUrl: `https://dry-run/scene-${scene.id}.mp4`,
      generationId: `dry-${randomUUID().slice(0, 8)}`,
      prompt: fullPrompt,
    };
  }

  try {
    // Generate via ByteDance Seedance 2.0 direct API
    const ephemeralUrl = await generateSeedanceVideo(fullPrompt, scene.duration, scene.hasDialogue);

    const generationId = randomUUID();

    // Rehost the ephemeral ByteDance URL to Pinata BEFORE writing anything to
    // Firestore. Historical data loss was caused by writing the volces.com URL
    // directly — once the 24h signature expired, every reference to the video
    // was dead. Throw if rehost fails so we don't persist a rotting link.
    let videoUrl = ephemeralUrl;
    if (isEphemeralVideoUrl(ephemeralUrl)) {
      const rehosted = await rehostVideoToPinata(ephemeralUrl, {
        filename: `fogline-scene-${scene.id}.mp4`,
        pinName: `Fogline — ${scene.title}`,
      });
      videoUrl = rehosted.url;
      console.log(`    ↳ Rehosted to Pinata (${rehosted.size} bytes): ${videoUrl.slice(0, 70)}`);
    }

    // Persist generation record to Firestore
    await db.collection('videoGenerations').doc(generationId).set({
      id: generationId,
      prompt: scene.prompt,
      fullPrompt,
      model,
      mode: 'text_to_video',
      videoUrl,
      status: 'completed',
      universeId: UNIVERSE_ID,
      creatorUid: CREATOR_ADDRESS,
      sceneId: scene.id,
      sceneTitle: scene.title,
      episodeTitle: 'Fallout: Fogline',
      durationSec: scene.duration,
      hasAudio: scene.hasDialogue,
      createdAt: new Date(),
      completedAt: new Date(),
    });

    // Also publish to gallery
    await db.collection('content').add({
      title: `Fogline — ${scene.title}`,
      description: scene.prompt.slice(0, 300),
      mediaUrl: videoUrl,
      mediaType: 'ai-video',
      classification: 'original',
      tags: ['fallout', 'fogline', 'episode', `scene-${scene.id}`],
      ipDeclaration: {
        isOriginal: true,
        usesCopyrightedMaterial: false,
        license: 'all-rights-reserved',
      },
      visibility: 'public',
      creatorUid: CREATOR_ADDRESS,
      universeId: UNIVERSE_ID,
      createdAt: new Date(),
      updatedAt: new Date(),
      views: 0,
      likes: 0,
      reviewStatus: 'not_required',
      generationId,
      generationModel: model,
    });

    // ── Create off-chain timeline node so it shows on the universe canvas ──
    try {
      await createOffChainNode({
        videoUrl,
        title: scene.title,
        plot: scene.prompt,
        sceneId: scene.id,
      });
      console.log(`    ↳ Off-chain timeline node created`);
    } catch (nodeErr) {
      console.warn(`    ⚠️ Failed to create timeline node: ${(nodeErr as Error).message}`);
    }

    console.log(`  ✅ Generated: ${videoUrl.slice(0, 80)}...`);
    return {
      sceneId: scene.id,
      title: scene.title,
      videoUrl,
      generationId,
      prompt: fullPrompt,
    };
  } catch (error) {
    console.error(`  ❌ Failed:`, (error as Error).message);
    throw error;
  }
}

// ── Off-Chain Timeline Node Creation ────────────────────────────────────

const offChainNodesCol = () => db.collection('offChainNodes');
const counterCol = () => db.collection('offChainNodeCounters');

async function nextSequentialNodeId(universeId: string): Promise<number> {
  const ref = counterCol().doc(universeId);
  return db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    const current = doc.exists ? (doc.data()?.latest as number) || 0 : 0;
    const next = current + 1;
    tx.set(ref, { latest: next, updatedAt: new Date() }, { merge: true });
    return next;
  });
}

/**
 * Tracks the most-recently-created node per universe so we can chain
 * scenes sequentially via previousNodeId.
 */
let _lastNodeIdForUniverse = 0;

async function createOffChainNode(opts: {
  videoUrl: string;
  title: string;
  plot: string;
  sceneId: number;
}) {
  const nodeId = await nextSequentialNodeId(UNIVERSE_ID);
  const previousNodeId = _lastNodeIdForUniverse;
  _lastNodeIdForUniverse = nodeId;

  const contentHash = keccak256(toBytes(opts.videoUrl));
  const plotHash = keccak256(toBytes(opts.plot));

  const docId = randomUUID();
  await offChainNodesCol()
    .doc(docId)
    .set({
      id: docId,
      universeId: UNIVERSE_ID,
      nodeId,
      creator: CREATOR_ADDRESS.toLowerCase(),
      contentHash,
      plotHash,
      videoUrl: opts.videoUrl,
      plot: opts.plot,
      title: opts.title,
      sceneId: opts.sceneId,
      previousNodeId,
      children: [],
      canon: previousNodeId === 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

  // Append to parent's children array
  if (previousNodeId > 0) {
    const parentSnap = await offChainNodesCol()
      .where('universeId', '==', UNIVERSE_ID)
      .where('nodeId', '==', previousNodeId)
      .limit(1)
      .get();
    if (!parentSnap.empty) {
      const parent = parentSnap.docs[0];
      const children = (parent.data().children || []) as number[];
      if (!children.includes(nodeId)) {
        await parent.ref.update({ children: [...children, nodeId], updatedAt: new Date() });
      }
    }
  }

  return nodeId;
}

/**
 * Recover state on resume — find the highest existing nodeId so we continue chaining.
 */
async function loadLastNodeId() {
  const counterDoc = await counterCol().doc(UNIVERSE_ID).get();
  _lastNodeIdForUniverse = counterDoc.exists ? (counterDoc.data()?.latest as number) || 0 : 0;
  if (_lastNodeIdForUniverse > 0) {
    console.log(`  Resuming from node ${_lastNodeIdForUniverse}`);
  }
}

// ── Episode Assembly ────────────────────────────────────────────────────

async function createEpisode(clips: GeneratedClip[]): Promise<string> {
  const episodeId = randomUUID();

  const episodeClips = clips.map((clip, i) => ({
    nodeId: clip.generationId,
    label: `Scene ${clip.sceneId}: ${clip.title}`,
    videoUrl: clip.videoUrl,
    trimStart: 0,
    trimEnd: 0,
    order: i,
  }));

  await db.collection('episodes').doc(episodeId).set({
    id: episodeId,
    title: 'Fallout: Fogline',
    description:
      'Post-apocalyptic Bay Area, 2296. A scavenger follows a signal across the ruins to a pre-war AI that holds the key to survival.',
    universeId: UNIVERSE_ID,
    creatorUid: CREATOR_ADDRESS,
    clips: episodeClips,
    status: 'draft',
    totalClips: clips.length,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return episodeId;
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log(`
════════════════════════════════════════════════════════════
  FALLOUT: FOGLINE — Video Generation Pipeline
════════════════════════════════════════════════════════════
  Universe : ${UNIVERSE_ID}
  Model    : ${MODEL}
  Scenes   : ${ONLY_SCENES ? ONLY_SCENES.join(', ') : `${START_FROM}–${SCENES.length}`}
  Dry Run  : ${DRY_RUN}
  FAL Key  : configured
`);

  // Load last off-chain node id so we continue chaining sequentially
  await loadLastNodeId();

  // Step 1: Fetch wiki entities
  console.log('Step 1: Fetching wiki entities from Firestore...');
  const entities = await fetchWikiEntities();
  console.log(`  Found ${entities.length} entities for universe ${UNIVERSE_ID}`);

  if (entities.length === 0) {
    console.error('  ❌ No entities found! Run create-fogline-universe.ts first.');
    process.exit(1);
  }

  // List fetched entities
  for (const e of entities) {
    console.log(`  [${e.kind.toUpperCase().padEnd(10)}] ${e.name}`);
  }

  // Step 2: Generate videos scene by scene
  console.log('\nStep 2: Generating video clips...\n');

  const scenesToGenerate = SCENES.filter((s) => {
    if (ONLY_SCENES) return ONLY_SCENES.includes(s.id);
    return s.id >= START_FROM;
  });

  console.log(`  ${scenesToGenerate.length} scenes to generate\n`);

  const generatedClips: GeneratedClip[] = [];
  let failCount = 0;

  for (const scene of scenesToGenerate) {
    console.log(`\n── Scene ${scene.id}/${SCENES.length}: ${scene.title} ──`);

    // Build wiki context for this specific scene
    const wikiContext = buildWikiContext(entities, scene.entities);
    if (wikiContext) {
      console.log(`  Wiki context: ${scene.entities.join(', ')}`);
    }

    try {
      const clip = await generateSceneVideo(scene, wikiContext, MODEL);
      generatedClips.push(clip);
    } catch (error) {
      failCount++;
      console.error(`  ⚠️ Scene ${scene.id} failed, continuing...`);

      // Wait before retrying next scene (rate limiting)
      if (failCount <= 3) {
        console.log('  Waiting 10s before next scene...');
        await new Promise((r) => setTimeout(r, 10000));
      }
    }

    // Small delay between generations to avoid rate limits
    if (!DRY_RUN && scenesToGenerate.indexOf(scene) < scenesToGenerate.length - 1) {
      console.log('  Cooling down 5s...');
      await new Promise((r) => setTimeout(r, 5000));
    }
  }

  // Step 3: Create episode
  console.log('\n\nStep 3: Assembling episode...');

  if (generatedClips.length > 0) {
    const episodeId = await createEpisode(generatedClips);

    console.log(`
════════════════════════════════════════════════════════════
  FALLOUT: FOGLINE — GENERATION COMPLETE
════════════════════════════════════════════════════════════
  Episode ID   : ${episodeId}
  Clips        : ${generatedClips.length}/${scenesToGenerate.length} succeeded
  Failed       : ${failCount}
  Model        : ${MODEL}
  Universe     : ${UNIVERSE_ID}

  Generated Clips:
${generatedClips.map((c) => `    Scene ${c.sceneId}: ${c.title}\n      ${c.videoUrl.slice(0, 80)}...`).join('\n')}

  Next steps:
    - View at: /universe/${UNIVERSE_ID}
    - Episode builder: /episodes/${episodeId}
    - Export MP4: episodes.export({ episodeId: "${episodeId}" })

  War never changes. But cities do.
════════════════════════════════════════════════════════════
`);
  } else {
    console.error('\n  ❌ No clips were generated. Check errors above.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
