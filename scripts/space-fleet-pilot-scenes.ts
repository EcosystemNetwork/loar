/**
 * SPACE FLEET — Pilot Episode: "Nothing to See Here"
 *
 * 45 scenes via Seedance 2.0 → on-chain nodes.
 * Pulls character DNA from wiki entities for visual consistency.
 *
 * ~12 min episode (65 × 10s = 10.8 min core footage + audio padding)
 *
 * Prerequisites:
 *   - Space Fleet universe deployed (create-space-fleet.ts)
 *   - Wiki populated (space-fleet-wiki.ts)
 *   - Server running (pnpm dev:server)
 *
 * Usage: pnpm tsx scripts/space-fleet-pilot-scenes.ts
 *
 * Resume: Set START_SCENE=S15 env to skip completed scenes.
 */
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toBytes,
  decodeEventLog,
  getAddress,
} from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const rawKey = process.env.PRIVATE_KEY ?? '';
const PRIVATE_KEY = (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as `0x${string}`;
const RPC_URL = process.env.RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com';
const SERVER_URL = process.env.VITE_SERVER_URL ?? 'http://localhost:3000';
const BYTEDANCE_API_KEY = process.env.BYTEDANCE_API_KEY!;

const account = privateKeyToAccount(PRIVATE_KEY);
const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC_URL) });
const walletClient = createWalletClient({ account, chain: sepolia, transport: http(RPC_URL) });

const UNIVERSE_ADDR = (process.env.SPACE_FLEET_ADDR ??
  '0x0000000000000000000000000000000000000000') as `0x${string}`;
const BD_BASE = 'https://ark.ap-southeast.bytepluses.com/api/v3';
const START_SCENE = process.env.START_SCENE ?? 'S01';

// ── Helpers ─────────────────────────────────────────────────────────────
function log(step: string, msg: string) {
  console.log(`[${step}] ${msg}`);
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Auth ─────────────────────────────────────────────────────────────────
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

// ── Pull character DNA from wiki ────────────────────────────────────────
async function fetchCharacterDNA(token: string): Promise<Record<string, string>> {
  log('WIKI', 'Fetching character data from wiki entities...');
  const res = await fetch(
    `${SERVER_URL}/trpc/entities.listByUniverse?batch=1&input=${encodeURIComponent(
      JSON.stringify({ '0': { universeAddress: UNIVERSE_ADDR } })
    )}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const json = (await res.json()) as any[];
  const entities = json[0]?.result?.data || [];

  const dna: Record<string, string> = {};
  for (const e of entities) {
    const name = e.name || e.data?.name;
    const desc = e.description || e.data?.description;
    if (name && desc) {
      const short = desc.split('.').slice(0, 3).join('.') + '.';
      dna[name.toUpperCase().replace(/[^A-Z0-9]/g, '_')] = `${name}: ${short}`;
      log('WIKI', `  Loaded: ${name}`);
    }
  }
  return dna;
}

// ── On-chain ABI ────────────────────────────────────────────────────────
const universeAbi = [
  {
    type: 'function',
    name: 'createNode',
    inputs: [
      { name: '_contentHash', type: 'bytes32' },
      { name: '_plotHash', type: 'bytes32' },
      { name: '_previous', type: 'uint256' },
      { name: '_link', type: 'string' },
      { name: '_plot', type: 'string' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
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

// ── Sanitize prompt to dodge ByteDance copyright filter ──────────────────
function sanitizePrompt(prompt: string, attempt: number): string {
  if (attempt === 0) return prompt;
  // Strip character names and replace with generic descriptions
  let p = prompt
    .replace(/Eli Vance/g, 'a young male analyst')
    .replace(/Eli/g, 'the young man')
    .replace(/Mara Chen/g, 'a sharp professional woman')
    .replace(/Mara/g, 'the woman')
    .replace(/Director Halden/g, 'the senior director')
    .replace(/Halden/g, 'the director')
    .replace(/Nova Reyes/g, 'the female protagonist')
    .replace(/Commander/g, 'the leader');
  if (attempt >= 2) {
    // Further strip any remaining proper nouns and brand-like terms
    p = p
      .replace(/SPACE FLEET/gi, 'the hidden program')
      .replace(/ORPHEUS/gi, 'the classified project')
      .replace(/(?:Blade Runner|Interstellar|Hans Zimmer|Zero Dark Thirty)/gi, 'cinematic')
      .replace(/4K quality/gi, 'high quality')
      .replace(/photorealistic/gi, 'realistic');
  }
  return p;
}

// ── Video generation via ByteDance Seedance 2.0 ─────────────────────────
async function generateVideo(prompt: string, label: string): Promise<string> {
  const MAX_RETRIES = 3;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const sanitized = sanitizePrompt(prompt, attempt);
    if (attempt > 0) log(label, `Retry ${attempt}/${MAX_RETRIES - 1} (sanitized prompt)...`);
    else log(label, 'Generating video via Seedance 2.0...');

    const taskRes = await fetch(`${BD_BASE}/contents/generations/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${BYTEDANCE_API_KEY}` },
      body: JSON.stringify({
        model: 'dreamina-seedance-2-0-260128',
        content: [{ type: 'text', text: sanitized }],
        duration: 10,
        aspect_ratio: '16:9',
        resolution: '720p',
        generate_audio: false,
      }),
    });
    if (!taskRes.ok)
      throw new Error(`ByteDance ${taskRes.status}: ${(await taskRes.text()).slice(0, 200)}`);
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
    // Wait before retry with sanitized prompt
    await sleep(2000);
  }
  throw new Error('Copyright filter blocked all retries');
}

// ── On-chain node creation ──────────────────────────────────────────────
async function createNode(
  contentHash: string,
  plot: string,
  previousId: bigint,
  link: string,
  label: string
) {
  const chBytes = keccak256(toBytes(contentHash)) as `0x${string}`;
  const plotHash = keccak256(toBytes(plot));
  const txHash = await walletClient.writeContract({
    address: UNIVERSE_ADDR,
    abi: universeAbi,
    functionName: 'createNode',
    args: [chBytes, plotHash, previousId, link, plot],
  });
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
    confirmations: 1,
    timeout: 120_000,
  });
  if (receipt.status !== 'success') throw new Error('TX reverted');
  let nodeId = 0n;
  for (const l of receipt.logs) {
    try {
      const d = decodeEventLog({ abi: universeAbi, data: l.data, topics: l.topics });
      if (d.eventName === 'NodeCreated') nodeId = BigInt((d.args as any).id);
    } catch {}
  }
  log(label, `Node #${nodeId} confirmed`);
  return nodeId;
}

// ── Scene definitions ───────────────────────────────────────────────────
function buildScenes(dna: Record<string, string>) {
  const ELI =
    dna['ELI_VANCE'] ||
    'Eli Vance: 24-year-old male analyst, wiry build, intense dark eyes, cheap government suit and tie, deliberately ordinary appearance. Government badge, notebook with sketches of triangular craft.';
  const MARA =
    dna['MARA_CHEN'] ||
    'Mara Chen: 30s female, sharp professional look, cheerful demeanor masking deep awareness. Government attire above ground, black Orpheus uniform below.';
  const HALDEN =
    dna['DIRECTOR_HALDEN'] ||
    'Director Halden: 50s male, immaculate dark suit, steel-gray hair, completely unreadable face. Military bearing under bureaucratic calm.';
  const WORLD =
    'Near-future Earth. Paranoid government thriller tone. Color palette: sterile government gray, cold fluorescent white, deep space navy blue, occasional warm amber. Cinematic 16:9, dramatic lighting, photorealistic, grounded sci-fi.';

  return [
    // ═══════════════════════════════════════════════════════════════════
    // COLD OPEN — Desert Highway (S01-S08)
    // ═══════════════════════════════════════════════════════════════════
    {
      id: 'S01',
      title: 'Black Screen — Archival Audio',
      plot: 'BLACK SCREEN. A low mechanical hum. Archival-style audio: "There is no evidence of unauthorized orbital infrastructure. Reports of off-book aerospace platforms are speculative and false." A metallic CLANG. A deep bass RUMBLE.',
      prompt: `${WORLD} Pure black screen with subtle horizontal scan lines. Faint government seal watermark barely visible. A single line of white text fades in at center: classified document redaction bars. Institutional, sterile, oppressive. The visual equivalent of a government lie. Minimal, tense, cold.`,
    },
    {
      id: 'S02',
      title: 'Desert Highway — Wide',
      plot: 'EXT. DESERT HIGHWAY — NIGHT. A lonely two-lane road cutting through black desert. A sky crowded with stars. A beat-up sedan races alone under infinite sky.',
      prompt: `${WORLD} Epic wide aerial shot of a lonely two-lane desert highway at night cutting through pitch-black terrain. An impossibly star-filled sky above — the Milky Way blazing. A single beat-up sedan drives alone, headlights carving through darkness. The road stretches to the horizon in both directions. Total isolation. Camera slowly descending toward the car. Cinematic, vast, lonely.`,
    },
    {
      id: 'S03',
      title: 'Eli in the Car — Interior',
      plot: 'INT. SEDAN — NIGHT. Eli drives, alert and tense. He keeps glancing in the rearview mirror. On the passenger seat: a government badge, a cheap burner phone, and a notebook filled with sketches of strange triangular craft.',
      prompt: `${WORLD} ${ELI} Interior of a beat-up sedan at night. Close-up of Eli Vance driving, face tense and alert, eyes flicking to the rearview mirror. Dashboard glow illuminates his sharp features. On the passenger seat beside him: a government ID badge, a cheap flip phone, and an open notebook showing hand-drawn sketches of triangular aircraft. The intimacy of a man carrying his secrets in a car. Tight framing, warm dashboard amber vs cold starlight through windshield.`,
    },
    {
      id: 'S04',
      title: 'Passenger Seat Detail',
      plot: 'INT. SEDAN — NIGHT. Close-up of the passenger seat: the badge, the phone, the notebook open to a page of triangular craft sketches with handwritten notes and calculations. These are the tools of a secret investigator.',
      prompt: `${WORLD} Extreme close-up of a car passenger seat at night. A government ID badge face-down, a cheap burner flip phone, and an open notebook covered in hand-drawn sketches of triangular aircraft with handwritten annotations: altitudes, speeds, coordinates, question marks. Red string connects some sketches. The warm amber dashboard glow illuminates these objects like evidence in a crime scene. Macro detail shot, shallow depth of field.`,
    },
    {
      id: 'S05',
      title: 'The First Launch — Sky',
      plot: 'EXT. DESERT — NIGHT. Eli slows. Above the mountains, a streak of white light rises silently — too fast, too vertical, too controlled. The air around it shimmers.',
      prompt: `${WORLD} Dramatic sky shot over desert mountains at night. A single brilliant streak of white light rises vertically from behind the mountain range — impossibly fast, impossibly controlled, impossibly silent. The air around the streak shimmers and distorts, bending the star field behind it like heat waves. The light trail is pure white against deep navy sky. No sound, no exhaust — just pure anomalous motion. Wide angle looking up from the desert floor. First sighting.`,
    },
    {
      id: 'S06',
      title: 'Three Launches — Sequence',
      plot: 'EXT. DESERT — NIGHT. A second streak rises. Then a third. The stars behind all three distort like heat over asphalt. Something is very wrong with the sky.',
      prompt: `${WORLD} Three brilliant streaks of white light now rise in parallel from behind desert mountains. The star field behind them warps and bends in waves — gravitational lensing, atmospheric distortion, something bending light itself. The three trails are evenly spaced, precisely timed — not random, not natural. The sky itself seems to ripple. Wide panoramic shot, the scale of the anomaly becoming undeniable. Sci-fi thriller, awe and dread.`,
    },
    {
      id: 'S07',
      title: 'Eli Watches — Something Massive',
      plot: 'EXT. DESERT — NIGHT. Eli stands outside the car staring up. High above, something MASSIVE moves — not seen directly, only implied by its effect on the sky. Stars bend around an invisible shape. His breath catches.',
      prompt: `${WORLD} ${ELI} Eli stands beside his stopped sedan on the desert road, head tilted back, staring at the sky in shock. Above him, the star field subtly warps and bends in an enormous oval pattern — as if something impossibly large and invisible is passing overhead, distorting light around it like gravitational lensing. Eli is tiny against the vast desert and warped sky. His expression: awe and terror. Low angle shot from behind Eli looking up at the distorted heavens.`,
    },
    {
      id: 'S08',
      title: 'The Phone Call — Title Card',
      plot: 'EXT. DESERT — NIGHT. Eli\'s burner buzzes. A calm voice: "You weren\'t supposed to stop. If you want the truth, Mr. Vance... stop looking up in places where civilians can see you." Line dead. Distant thunder — sky clear. Nothing. Just stars. CUT TO TITLE: SPACE FLEET.',
      prompt: `${WORLD} ${ELI} Close-up of Eli holding a cheap flip phone to his ear on the desert highway, face frozen in shock. The phone screen casts cold light on his face. Behind him, the desert stretches into darkness. The sky above is now perfectly clear — just stars, as if nothing happened. His expression shifts from fear to determination. Camera slowly pulls back to reveal him alone on the vast empty road. Then SMASH CUT to bold white text on black: SPACE FLEET. Paranoid thriller, dramatic lighting.`,
    },

    // ═══════════════════════════════════════════════════════════════════
    // ACT ONE — Defense Analysis Center (S09-S22)
    // ═══════════════════════════════════════════════════════════════════
    {
      id: 'S09',
      title: 'DAC Exterior — Morning',
      plot: 'EXT. DEFENSE ANALYSIS CENTER — MORNING. A gray, windowless government facility. Badge scanners. Frosted glass. Surveillance cameras. Sterile. Quiet. The architecture of secrets.',
      prompt: `${WORLD} Establishing shot of a brutalist gray government building in morning light. No windows. Security fencing, badge-access checkpoints, concrete barriers. Frosted glass entrance doors reflect cold sky. A few government vehicles in the parking lot. American flag on a pole barely moves. Surveillance cameras visible at every corner. The building radiates institutional control. Wide establishing shot, overcast morning light.`,
    },
    {
      id: 'S10',
      title: 'Eli Enters — News Screens',
      plot: 'INT. DEFENSE ANALYSIS CENTER — MORNING. Eli walks in wearing a cheap tie. Wall screens show news anchors laughing about "viral UFO hysteria." Chyron: MYSTERY LIGHTS OVER NEVADA DEBUNKED AS ATMOSPHERIC DISTORTION. The cover story is already running.',
      prompt: `${WORLD} ${ELI} Interior of a sterile government facility lobby. Eli walks through badge scanners wearing a cheap suit and thin tie, carrying a laptop bag. On wall-mounted screens behind him, news anchors smile dismissively. A news chyron scrolls: "MYSTERY LIGHTS DEBUNKED AS ATMOSPHERIC DISTORTION." The irony is invisible to everyone but Eli — he SAW those lights last night. Fluorescent lighting, frosted glass, government gray. Medium tracking shot following Eli through security.`,
    },
    {
      id: 'S11',
      title: 'Mara Catches Up — Hallway',
      plot: 'INT. HALLWAY — MORNING. Mara Chen catches up to Eli. "You look terrible." She jokes about the cover stories: "weather balloons, ion reflections, swamp gas, whatever lie we\'re using this quarter."',
      prompt: `${WORLD} ${ELI} ${MARA} A government hallway with fluorescent lights. Mara Chen walks alongside Eli, carrying a coffee, her expression cheerful and teasing. Eli looks tired but alert, studying her with subtle intensity. They walk past frosted glass offices. The hallway is sterile but Mara brings warmth to it. Two-shot, walking and talking, government corridor. Surface friendliness hiding mutual assessment.`,
    },
    {
      id: 'S12',
      title: 'Eli Studies Mara',
      plot: 'INT. HALLWAY. Eli: "You ever say stuff like that out loud just to see who flinches?" Mara smirks: "Every day." She peels off toward another section. Eli clocks that. Interesting.',
      prompt: `${WORLD} ${ELI} ${MARA} Close two-shot in the hallway. Eli watches Mara with new intensity — she just revealed she tests people too. Mara smirks knowingly and breaks off, walking away down a branching corridor. Eli watches her go, recalculating. The moment of mutual recognition between two people who both see through the institution. Mara's figure receding. Eli's evaluating expression. Government hallway, fluorescent light.`,
    },
    {
      id: 'S13',
      title: 'Briefing Room — Halden Enters',
      plot: 'INT. BRIEFING ROOM. A digital map of near-Earth orbit rotates on the wall. Director Halden stands at the front, immaculate and unreadable. Junior analysts with tablets.',
      prompt: `${WORLD} ${HALDEN} A government briefing room. A large digital map of near-Earth orbit rotates on the front wall — satellite trajectories and orbital plots. Director Halden stands at the front, immaculate suit, commanding the room. Junior analysts sit with tablets, attentive. The room is clinical and controlled. Halden is lit dramatically, face half in shadow. The orbital map glows behind him. Medium-wide shot of the briefing, institutional authority.`,
    },
    {
      id: 'S14',
      title: 'Signal Integrity Speech',
      plot: 'INT. BRIEFING ROOM. Halden: "Today you\'ll be scrubbing public-source chatter surrounding false claims of unauthorized launch activity. Your job is not to prove fantasies. Your job is to maintain signal integrity." He taps the screen. Points of light vanish.',
      prompt: `${WORLD} ${HALDEN} Close-up of Halden at the briefing screen. He taps the digital orbital map and points of light — representing real anomalies — vanish one by one. Each tap erases evidence. The gesture is casual, practiced. Behind his composed delivery is the machinery of suppression. The orbital display reflects in his glasses. Medium close-up of Halden performing the most mundane act of cosmic cover-up. Cold authority.`,
    },
    {
      id: 'S15',
      title: 'Halden Promotes Eli',
      plot: 'INT. BRIEFING ROOM. Halden: "Mr. Vance. Since you scored unusually high on anomaly pattern recognition, you\'ll assist in the disinformation triage queue." Heads turn. That\'s a promotion. Eli: "Happy to help, sir."',
      prompt: `${WORLD} ${HALDEN} ${ELI} Close two-shot in the briefing room. Halden addresses Eli directly, eyes locking on him. Other analysts turn to look. Eli maintains perfect composure — helpful, eager, unthreatening. The tension between them is invisible to everyone else. Halden's eyes rest on Eli a second too long. Dramatic close-up cutting between both faces. Cold fluorescent lighting, tense undertones.`,
    },
    {
      id: 'S16',
      title: "Halden's Warning",
      plot: 'INT. BRIEFING ROOM. Halden: "You will encounter fabricated imagery. Some of it is persuasive. Do not mistake emotional reaction for analysis." His eyes bore into Eli. "Wouldn\'t dream of it."',
      prompt: `${WORLD} ${HALDEN} ${ELI} Extreme close-up exchange. Halden's face: perfectly controlled, eyes boring into Eli with the weight of a test. Eli's face: composed, respectful, a perfect mask of compliance — but his eyes reveal defiance locked behind obedience. The briefing room blurs behind them. A silent duel disguised as bureaucratic small talk. Intense, intimate, theatrical tension.`,
    },
    {
      id: 'S17',
      title: 'Triage Office — Establishing',
      plot: 'INT. TRIAGE OFFICE — LATER. Dim light. Rows of screens. Eli sits at a terminal marked LEVEL 3 — PUBLIC MISATTRIBUTION REVIEW. The room hums with screen glow.',
      prompt: `${WORLD} ${ELI} A dimly lit intelligence office. Rows of glowing screens fill the space like a grid of blue light. Eli sits alone at a terminal, face illuminated by screen glow. The sign on his station: "LEVEL 3 — PUBLIC MISATTRIBUTION REVIEW." Other empty terminals stretch into shadow behind him. The room feels like a confession booth for classified lies. Wide establishing shot of the triage office, blue monitor light, institutional loneliness.`,
    },
    {
      id: 'S18',
      title: 'Evidence Montage',
      plot: 'INT. TRIAGE OFFICE. Eli scrolls through footage: a farmer filming a glowing object over Kansas. A cargo pilot whispering "That thing just went straight up." A child\'s science fair poster of a ring-shaped station. Each tagged: sensor bloom, viral fabrication, artifact.',
      prompt: `${WORLD} Montage of screens in the triage office. Screen 1: shaky farmer footage of a luminous oval over Kansas wheat fields, tagged "SENSOR BLOOM." Screen 2: cockpit camera of a pilot staring at something off-screen, tagged "MISIDENTIFIED TEST AIRCRAFT." Screen 3: a child's colorful poster showing a ring-shaped station orbiting the Moon, tagged "ASTROPHOTOGRAPHY ARTIFACT." Each piece of real evidence being buried under institutional labels. Close-ups cycling between screens.`,
    },
    {
      id: 'S19',
      title: 'The Restricted File — Discovery',
      plot: 'INT. TRIAGE OFFICE. Eli finds something different — a black-and-white tracking video timestamped six hours ago. A cluster of objects leaves Earth orbit... then abruptly vanishes. No propulsion bloom. No normal trajectory.',
      prompt: `${WORLD} ${ELI} Close-up of Eli's terminal screen. A black-and-white orbital tracking video — grainy, official, timestamped six hours ago. A cluster of small bright objects moves along a curved trajectory (Earth orbit) then simultaneously vanishes. No fade, no bloom — just there, then gone. Eli leans forward, recognizing this is different from everything else. His face in profile, lit by the anomalous footage. The moment of discovery. Tense, intimate.`,
    },
    {
      id: 'S20',
      title: 'ACCESS DENIED — ORPHEUS',
      plot: 'INT. TRIAGE OFFICE. Eli clicks deeper. ACCESS RESTRICTED. Tries again. ACCESS DENIED — REFER TO SECTION ORPHEUS. His face changes. He writes the word in his notebook: ORPHEUS.',
      prompt: `${WORLD} ${ELI} Eli clicks urgently. The screen flashes RED: "ACCESS RESTRICTED." He tries again. "ACCESS DENIED — REFER TO SECTION ORPHEUS." The red text fills the screen, reflecting in his wide eyes. Cut to his hands opening his notebook beneath the desk — discreet, hidden from cameras — and writing a single word in careful block letters. Screen glow shifting from blue to red on his face. The discovery moment. Tense, paranoid.`,
    },
    {
      id: 'S21',
      title: 'Halden Behind Him',
      plot: 'INT. TRIAGE OFFICE. Footsteps. Eli quickly minimizes. Halden stands behind him. "Finding your footing?" "Mostly nonsense. Some very committed nonsense." Halden glances at the notebook.',
      prompt: `${WORLD} ${HALDEN} ${ELI} Triage office. Eli sits at his terminal — hastily minimized to a blank screen. Director Halden stands directly behind him, looking down. His reflection is visible in the dark monitor. Halden's posture is casual but his presence is a threat. Eli's notebook sits partially visible on the desk edge. The power dynamic is physical: Halden standing, Eli seated, trapped. Low angle shot emphasizing Halden's looming authority.`,
    },
    {
      id: 'S22',
      title: 'Curiosity vs Ambition',
      plot: 'INT. TRIAGE OFFICE. Halden: "Ambition is useful here. Curiosity is not the same thing." "Understood." "Is it?" Beat. "Yes, sir." The faintest smile. Halden walks away. Eli exhales.',
      prompt: `${WORLD} ${HALDEN} ${ELI} Two-shot in profile. Halden delivers his veiled threat, face perfectly controlled. A beat of silence — the room holds its breath. Then Halden's faintest smile — not warmth but assessment. He turns and walks away down the dim row of terminals, his figure receding into shadow. Cut to Eli exhaling, closing his eyes for one moment of relief. The vulnerability of a man who almost got caught. Dramatic side lighting, long shadows.`,
    },

    // ═══════════════════════════════════════════════════════════════════
    // ACT TWO — Mara's Warning + Eli's Apartment (S23-S35)
    // ═══════════════════════════════════════════════════════════════════
    {
      id: 'S23',
      title: 'Cafeteria — Establishing',
      plot: 'INT. CAFETERIA — AFTERNOON. Quiet government lunchroom. Fluorescent buzz. Too clean. Eli sits alone, scrolling a blank spreadsheet while really staring at reflections in the window.',
      prompt: `${WORLD} ${ELI} A sterile government cafeteria — fluorescent lights buzzing, plastic chairs, surfaces too clean. Nearly empty. Eli sits alone at a table, laptop open to a meaningless spreadsheet, but he stares past it at reflections in the window glass. His coffee is untouched. The loneliness of a secret keeper in a room designed for nothing. Wide shot, flat institutional lighting, isolation.`,
    },
    {
      id: 'S24',
      title: 'Mara Drops In',
      plot: 'INT. CAFETERIA. Mara drops into the seat across from Eli. "You got Halden\'s attention. Congratulations or condolences, not sure which."',
      prompt: `${WORLD} ${ELI} ${MARA} Mara slides into the cafeteria seat across from Eli, tray in hand, casual but deliberate. Her expression mixes amusement and genuine concern. Eli looks up, caught between relief at company and wariness about what she might know. The fluorescent light catches them both in its flat, unflattering honesty. Two-shot across the cafeteria table. Mundane setting, charged undercurrent.`,
    },
    {
      id: 'S25',
      title: '"What\'s Orpheus?"',
      plot: 'INT. CAFETERIA. Eli: "What\'s Orpheus?" Mara stops chewing. A frozen micro-expression. "That was fast."',
      prompt: `${WORLD} ${ELI} ${MARA} Tight two-shot across the cafeteria table. Eli leans forward slightly, testing with three syllables. Mara has frozen mid-bite — a micro-expression of surprise she can't quite conceal. Her eyes widen for a fraction of a second before the mask returns. The moment crackles between them. He asked the forbidden question. She reacted. Close-up of Mara's frozen face. Fluorescent light, the intimacy of a dangerous exchange.`,
    },
    {
      id: 'S26',
      title: '"So it\'s real"',
      plot: 'INT. CAFETERIA. "So it\'s real." "I didn\'t say that." "You reacted." "And you asked a question that gets people moved into smaller offices with no clocks."',
      prompt: `${WORLD} ${ELI} ${MARA} Close-up alternating between faces. Eli's controlled intensity — he caught her and they both know it. Mara's recovery — sharp, defensive, but with a flicker of respect. She leans forward, voice dropped to barely audible. The cafeteria hum covers their words. Two people fencing with information in a room full of enemies. Intimate close-ups, shallow depth of field, fluorescent sterility around a dangerous conversation.`,
    },
    {
      id: 'S27',
      title: 'Seven Acceptable Lies',
      plot: 'INT. CAFETERIA. Mara: "The truth is never hidden. It\'s buried under seven acceptable lies, and your career depends on repeating the right one at the right time."',
      prompt: `${WORLD} ${MARA} Close-up of Mara speaking low across the table. Her face is serious now — the cheerful mask dropped for the first time. She is revealing the operating manual of the institution they both serve. The fluorescent light catches the intelligence in her eyes. Behind her, blurred cafeteria walls. This is the most dangerous thing she's ever said at work. Intimate close-up, the weight of institutional truth delivered in whisper.`,
    },
    {
      id: 'S28',
      title: '"Play Dumb Better"',
      plot: 'INT. CAFETERIA. "And if I don\'t?" "Then you\'ll never get close enough to learn anything worth knowing." Mara stands. "Play dumb better." She walks off. Eli watches her go.',
      prompt: `${WORLD} ${MARA} ${ELI} Mara standing up from the cafeteria table, looking down at Eli with an expression of equal parts warning and instruction. She is leaving — body language says "conversation over" but eyes say "listen carefully." Low angle from Eli's perspective looking up at Mara. She turns and walks away through the empty cafeteria, her figure receding under fluorescent tubes. Eli remains seated, processing. The power of someone who knows more walking away.`,
    },
    {
      id: 'S29',
      title: 'Apartment — Investigation Wall',
      plot: "INT. ELI'S APARTMENT — NIGHT. Small apartment. Cheap furniture. One wall covered in printed launch windows, defense budgets, redacted memos, amateur astronomy images. Pinned center: IF THEY'RE LYING ABOUT THE TECHNOLOGY, WHAT ELSE ARE THEY LYING ABOUT?",
      prompt: `${WORLD} Interior of a small, sparse apartment at night. Cheap furniture, bare walls — except one wall COMPLETELY covered in an investigation board. Printed satellite photos, launch window calendars, redacted government memos with black censorship bars, amateur telescope images, newspaper clippings, red string connecting pieces. A handwritten note pinned in the center. A small desk with a laptop. Single lamp creating dramatic shadows across the conspiracy wall. Paranoid thriller aesthetic.`,
    },
    {
      id: 'S30',
      title: 'Video Log — The Real Eli',
      plot: 'INT. APARTMENT — NIGHT. Eli records a video log: "Day one in Level 3. Orpheus exists. Halden knows I\'m looking. Mara knows more than she should."',
      prompt: `${WORLD} ${ELI} Close-up of Eli sitting at his desk, face illuminated by laptop webcam recording light. He speaks quietly, intensely, directly into camera. His tie is loosened, sleeves rolled up — the government mask coming off. The green recording indicator glows. The investigation wall is visible over his shoulder. This is the real Eli: driven, obsessive, dangerous. Intimate first-person confessional framing, warm lamplight.`,
    },
    {
      id: 'S31',
      title: 'Video Log — Industrial Scale',
      plot: 'INT. APARTMENT — NIGHT. Eli continues: "They\'re not hiding prototypes. Prototypes don\'t get this much narrative management. This is operational. Industrial scale. Orbital or beyond." He pauses, searching for words. "They want the public to think we\'re still struggling with rockets while something else is already running above our heads."',
      prompt: `${WORLD} ${ELI} Medium shot of Eli at his desk, laptop recording. He gestures toward the investigation wall behind him as he speaks — the evidence of his obsession visible in frame. His face shows the strain of someone who has figured out something enormous and can tell no one. The investigation wall, the laptop, the single lamp — the tools of a lone truth-seeker against an empire of lies. Camera slowly pushes in on his face as the magnitude of his words lands.`,
    },
    {
      id: 'S32',
      title: 'The Black SUV',
      plot: 'INT. APARTMENT — NIGHT. A light flashes outside. Eli turns. Across the street, a black SUV idles. No plates. He freezes.',
      prompt: `${WORLD} ${ELI} Eli at his apartment window, frozen, looking down at the street below. Through the glass, a black SUV with no license plates idles under a street lamp. Tinted windows reflect nothing. Eli's reflection overlays the scene — his face ghosted over the surveillance vehicle below. The SUV's brake lights glow red in the darkness. The moment of realization: they know where he lives. Split focus between Eli's alarmed face and the SUV below. Paranoid thriller.`,
    },
    {
      id: 'S33',
      title: 'SUV Departs',
      plot: 'INT. APARTMENT — NIGHT. The SUV drives away silently into the night. Eli watches it go. His laptop screen flickers behind him.',
      prompt: `${WORLD} Through the apartment window, the black SUV pulls away from the curb silently, taillights tracing red lines down the dark street until it disappears. Eli stands at the window, hand on the glass, watching it go. Behind him, reflected in the window, his laptop screen flickers and distorts. The surveillance leaves but the intrusion remains. Wide shot, Eli silhouetted at window, the empty street, the flickering reflection. Aftermath of menace.`,
    },
    {
      id: 'S34',
      title: 'The Message',
      plot: 'INT. APARTMENT — NIGHT. Eli\'s laptop screen flickers. A message appears that he did not type: "YOU WANT TO EXPOSE THE SECRET. FIRST SURVIVE IT." Then the screen goes black.',
      prompt: `${WORLD} Close-up of a laptop screen in a dark room. The screen flickers, distorts — then white text appears on black, letter by letter, as if typed by an invisible hand. The message fills the screen. The text glows against Eli's horrified face reflected in the monitor. Then the screen cuts to pure black. The cursor blinks once. Then nothing. Extreme close-up, the text is the only light source. Horror meets thriller. The machine knows who he is.`,
    },
    {
      id: 'S35',
      title: 'Eli Trapped Between Walls',
      plot: 'INT. APARTMENT — NIGHT. Eli stares at the dead screen. Behind him, the investigation wall. In front, digital silence. He is being watched from both sides — his own obsession and their surveillance. He is trapped.',
      prompt: `${WORLD} ${ELI} Wide symmetrical shot of Eli sitting at his desk, framed perfectly between two threats. Behind: the conspiracy investigation wall covered in documents and red string. In front: the dead black laptop screen that just delivered an impossible message. Eli sits between them, still, processing. The composition frames him as trapped between his own obsession and their surveillance. Single lamp, dramatic shadows. Paranoid thriller, symmetrical framing.`,
    },

    // ═══════════════════════════════════════════════════════════════════
    // ACT THREE — The Revelation (S36-S55)
    // ═══════════════════════════════════════════════════════════════════
    {
      id: 'S36',
      title: 'Next Morning — New Badge',
      plot: 'INT. DEFENSE ANALYSIS CENTER — NEXT MORNING. Eli arrives trying not to show fear. At security, he is handed a new badge: ACCESS ELEVATED: TEMPORARY ASSIGNMENT. He masks his surprise.',
      prompt: `${WORLD} ${ELI} Security checkpoint at the Defense Analysis Center. Eli stands at the desk receiving a new badge. Close-up of the badge: a different color from yesterday's, stamped with "ACCESS ELEVATED: TEMPORARY ASSIGNMENT." Eli's face masks his surprise with practiced neutrality. The security guard hands it over routinely. Medium shot, institutional lighting, the weight of the moment hidden behind bureaucratic routine.`,
    },
    {
      id: 'S37',
      title: 'Elevator — Floors Disappear',
      plot: 'INT. SUBLEVEL ELEVATOR. Eli rides down alone. The numbers descend below the listed floors. B4. B5. Then no numbers at all.',
      prompt: `${WORLD} ${ELI} Interior of a government elevator. Eli stands alone watching the floor indicator. Numbers pass normally at first: B1, B2, B3, B4, B5 — then the digital display goes blank. No numbers. Just a faint hum. The fluorescent light shifts from warm to cold blue. Eli watches the empty display. His reflection in the polished metal doors stares back. Tight framing, claustrophobic, descent into the classified unknown.`,
    },
    {
      id: 'S38',
      title: 'Elevator — The Hum Deepens',
      plot: 'INT. ELEVATOR. The hum deepens. The descent continues into unmarked territory. Eli braces himself. The doors begin to open.',
      prompt: `${WORLD} ${ELI} Close-up of Eli in the elevator. His jaw tightens. His hand grips the rail. The elevator hum has become a low, bass vibration that he can feel in his chest. The light is now fully cold blue. A crack of light appears as the doors begin to part — but what's beyond is shadow, not the fluorescent hallway he expected. The transition from the known world to the hidden one. Intimate close-up, anticipation, the threshold moment.`,
    },
    {
      id: 'S39',
      title: 'Black Corridor — The Sign',
      plot: 'INT. SUBLEVEL. Doors open to a polished black corridor. Minimalist. Quiet. Expensive. A sign on the wall: AEROSPACE LOGISTICS COMMAND — AUTHORIZED PERSONNEL ONLY. A lie so obvious it feels insulting.',
      prompt: `${WORLD} The elevator doors open to reveal a polished black corridor stretching ahead. Minimalist, expensive, silent. Walls, floor, and ceiling are all dark reflective surfaces. Subtle recessed lighting creates a path forward. On the wall, a plain government sign: "AEROSPACE LOGISTICS COMMAND — AUTHORIZED PERSONNEL ONLY." The sign is deliberately boring against the clearly extraordinary corridor. The contrast between mundane name and sleek architecture. Wide shot, dramatic perspective.`,
    },
    {
      id: 'S40',
      title: 'Halden Waits — Walk With Me',
      plot: 'INT. CORRIDOR. Halden waits at the far end. Dark figure in a dark space. "Walk with me." They move through the corridor together.',
      prompt: `${WORLD} ${HALDEN} Long polished black corridor. At the far end, Director Halden stands waiting — a dark figure perfectly composed against the dark space. Eli approaches from the camera's perspective. Halden's figure grows as the distance closes. The corridor gleams with their reflections. The power dynamic is architectural: Halden owns this space. Long shot with dramatic one-point perspective, the two figures meeting in darkness.`,
    },
    {
      id: 'S41',
      title: 'Behind the Glass — Command Center',
      plot: 'INT. CORRIDOR. They walk past reinforced glass. Behind it: technicians monitoring live telemetry — orbital plots, lunar transfer arcs, fleet readiness dashboards. Not planes. Not satellites.',
      prompt: `${WORLD} ${HALDEN} ${ELI} Two figures walk along the black corridor. Behind reinforced glass panels, a command center is visible: technicians at holographic displays showing orbital trajectories, lunar transfer arcs, fleet formation diagrams, readiness boards. The displays clearly show SHIPS — organized fleet groups, not individual satellites. Eli glances through the glass, absorbing. Halden walks calmly. Walking two-shot with classified command center revealed.`,
    },
    {
      id: 'S42',
      title: 'Fleet Telemetry Close-Up',
      plot: 'INT. CORRIDOR. Through the glass: close-up of the fleet readiness dashboards. Ship designations, deployment vectors, readiness status indicators. The scale is staggering — this is a military fleet, not a space program.',
      prompt: `${WORLD} Close-up through reinforced glass of fleet telemetry displays. Holographic screens show ship silhouettes with designation codes, deployment vectors with trajectory arcs, readiness indicators in green/amber/red, fleet group designations: "DEEP RANGE GROUP ALPHA," "OUTER PERIMETER PATROL." The displays pulse with real-time data. The scale implies hundreds of vessels. This is not research — this is an operational military fleet. Macro detail through glass, blue holographic glow.`,
    },
    {
      id: 'S43',
      title: 'The Observation Window',
      plot: 'INT. CORRIDOR. They stop at a wide observation window. Beyond it: a cavernous underground hangar. The scale shift hits like a physical force.',
      prompt: `${WORLD} ${HALDEN} ${ELI} The two men stop at a massive observation window. Through the reinforced glass, a vast underground space opens up — cavernous, dramatically lit, the scale suddenly enormous after the tight corridor. Both figures silhouetted against the bright hangar beyond. Eli's body language shifts — an involuntary step backward at the sheer scale. The moment before revelation. Wide shot, dramatic scale contrast, the infinite opening from the confined.`,
    },
    {
      id: 'S44',
      title: 'The Ship — First Sight',
      plot: 'INT. HANGAR. In the center: a matte-black craft the size of a destroyer section, suspended in a magnetic cradle. Angular but elegant. Human-made, yet impossibly advanced. Service crews move beneath it like ants.',
      prompt: `${WORLD} A vast underground hangar carved from rock. At the center, a MATTE-BLACK ANGULAR WARSHIP the size of a naval destroyer floats suspended in a glowing magnetic cradle. Blue-white energy courses through massive cradle arms. The ship is angular, faceted, stealth-designed — no visible engines, no familiar aerospace shapes. Human engineering pushed beyond known limits. Tiny service crews work on platforms beneath it. The scale is staggering. Epic wide shot, the ship dominating the frame.`,
    },
    {
      id: 'S45',
      title: "Eli's Breath Catches",
      plot: 'INT. OBSERVATION WINDOW. Close-up of Eli seeing the ship. His breath catches. His eyes widen despite himself. Years of searching — and now the proof floats in front of him, impossible and undeniable.',
      prompt: `${WORLD} ${ELI} Extreme close-up of Eli's face at the observation window. The warship is reflected in his wide eyes — matte black geometry floating in blue-white energy. His breath catches visibly. His pupils dilate. Years of investigation, conspiracy boards, midnight drives, and dangerous questions — and now the answer floats in front of him, impossibly real. The emotional impact of vindication and terror hitting simultaneously. The ship reflected in his eyes. Intimate, devastating close-up.`,
    },
    {
      id: 'S46',
      title: '"Nonsense Protects the Truth"',
      plot: 'INT. OBSERVATION WINDOW. Halden: "You wanted to know whether the stories were real. The stories are pathetic fragments of reality. People see pieces, shadows. We permit that because nonsense protects the truth."',
      prompt: `${WORLD} ${HALDEN} ${ELI} Two-shot at the observation window. The warship floats behind them through the glass. Halden speaks with quiet authority, one hand gesturing toward the ship. His tone is philosophical, almost gentle — a man explaining why he lies to the world. The glass reflects both their faces overlaid on the floating warship. Halden is in his element. Profile shot with the impossible ship as backdrop, dramatic hangar lighting.`,
    },
    {
      id: 'S47',
      title: '"Continuity of Civilization"',
      plot: 'INT. OBSERVATION WINDOW. Eli: "What is this?" Halden: "Continuity of civilization." The weight of two words. Eli turns to him.',
      prompt: `${WORLD} ${HALDEN} Close-up exchange. Eli asks the question, raw and direct. Halden answers with two words that reframe everything. His face is calm, carrying the weight of decades of justification. Eli turns to face him fully — the warship behind them both now, the truth between them. Two-shot, both faces visible, the enormous ship reflected in the glass behind. The gravity of nomenclature — three syllables that contain an empire.`,
    },
    {
      id: 'S48',
      title: 'The Disclosure Argument',
      plot: 'INT. OBSERVATION WINDOW. Halden: "Markets collapse. Alliances fracture. Religions split. Every population asks: if you hid this, what else did you hide?" Eli: "Maybe they should ask." Halden: "Maybe. But they won\'t ask from a position of calm."',
      prompt: `${WORLD} ${HALDEN} ${ELI} Halden and Eli face each other at the observation window. Halden makes his case — the philosophy of necessary deception. His conviction is total. Eli pushes back: "Maybe they should ask." A beat. Halden concedes the point but reframes it. Two men debating the fate of civilization while an impossible warship floats behind them. Medium two-shot, the ship as backdrop to a philosophical duel. Dramatic lighting from the hangar.`,
    },
    {
      id: 'S49',
      title: 'The Choice',
      plot: 'INT. OBSERVATION WINDOW. Halden gestures to the ship. "You can spend your life shouting from outside the wall... or you can come inside and see why the wall exists." A long beat. Eli knows this is the moment.',
      prompt: `${WORLD} ${HALDEN} Halden gestures toward the warship with a measured hand. The ship floats behind him, vast and silent. His face shows something rare — a moment of genuine offer, not manipulation but recruitment. He is giving Eli the choice he once received himself. The hangar light catches his steel-gray hair. The warship looms. The weight of the choice fills the silence. Close-up of Halden extending the offer, the ship as destiny behind him.`,
    },
    {
      id: 'S50',
      title: 'Eli Accepts — The Lie',
      plot: 'INT. OBSERVATION WINDOW. Eli lowers his eyes just enough. "What do you need from me?" "Loyalty. Competence. Silence." "You\'ll have all three, sir." A lie. But a convincing one.',
      prompt: `${WORLD} ${ELI} Close-up of Eli's face making his choice. He lowers his eyes — the perfect gesture of submission. But in that downward glance, for one frame, his eyes burn with defiance before the mask settles. He looks back up: compliant, eager, loyal. The perfect lie. The camera is close enough to see micro-expressions — truth hiding behind performance. Then cut to Halden's subtle nod of satisfaction. The deal is struck. Intimate close-up, dramatic lighting.`,
    },
    {
      id: 'S51',
      title: 'The Tablet',
      plot: 'INT. OBSERVATION WINDOW. Halden hands Eli a slim tablet. On screen: PROJECT ORPHEUS — STRATEGIC FLEET READINESS / CIVILIAN DISCLOSURE RISK MATRIX.',
      prompt: `${WORLD} Close-up of hands. Halden's manicured hand extends a slim government tablet. On the screen: bold classified text "PROJECT ORPHEUS — STRATEGIC FLEET READINESS / CIVILIAN DISCLOSURE RISK MATRIX" with TOP SECRET stamps and classification markings. Eli takes it. His fingers grip the edges tightly. The tablet glows between them — the physical object containing the truth he's hunted for years. Macro detail shot, the tablet as sacred object, dramatic lighting.`,
    },
    {
      id: 'S52',
      title: 'Locker Room — New Uniform',
      plot: 'INT. SECURE LOCKER ROOM. Eli changes into a dark uniform with no insignia. He opens the tablet. Pages of impossible truth scroll by.',
      prompt: `${WORLD} ${ELI} A sterile locker room. Eli now wears a dark uniform with no insignia — transformed from analyst to insider. The cheap suit is gone, replaced by black operational wear. He reads the tablet intensely, scrolling. The screen shows diagrams of orbital shipyards, fleet deployments, lunar operations. His face is lit by tablet glow. The uniform marks his transformation from outsider to embedded operative. Medium shot, classified light on stunned face.`,
    },
    {
      id: 'S53',
      title: 'Briefing Pages — Scope',
      plot: 'INT. LOCKER ROOM. The tablet shows: orbital shipyards, lunar extraction corridors, civilian observation suppression protocol, encounter management, deep-range fleet groups. Each page more impossible than the last.',
      prompt: `${WORLD} Close-up montage of the tablet screen as Eli scrolls. Page 1: Orbital Shipyard diagrams — massive ring structures in orbit. Page 2: Lunar extraction corridors — mining operations on the far side. Page 3: Fleet deployment maps — ship formations across the solar system. Page 4: Encounter management protocols — with redacted entity classifications. Each page escalates the impossible. Macro close-up of screen content, the scope expanding with each swipe.`,
    },
    {
      id: 'S54',
      title: 'NON-HUMAN SIGNAL',
      plot: 'INT. LOCKER ROOM. One line stops Eli cold: NON-HUMAN SIGNAL EVENT / OUTER PERIMETER / ACTIVE. His eyes widen. This is bigger than corruption. Bigger than secrecy. There is something else out there.',
      prompt: `${WORLD} ${ELI} Extreme close-up alternating between the tablet screen and Eli's face. On the screen, highlighted in red among the classified text: "NON-HUMAN SIGNAL EVENT / OUTER PERIMETER / ACTIVE." Eli's eyes widen. His breathing changes. The implications cascade across his face — this isn't just a government covering up technology. There is something else. The red text reflects in his eyes. The single most important line in the briefing. Macro close-up, red glow on shocked face.`,
    },
    {
      id: 'S55',
      title: 'Mara in the Doorway',
      plot: 'INT. LOCKER ROOM. A sound behind him. Mara stands in the doorway, also in black uniform. The cheerful mask is gone. She looks like a different person.',
      prompt: `${WORLD} ${MARA} Mara stands in the locker room doorway, now wearing the same dark Orpheus uniform. She looks fundamentally different — harder, more real, the cheerful cafeteria persona completely gone. Her posture is military-straight. Her eyes are clear and direct. The doorway frames her dramatically, amber corridor light behind. This is who Mara really is. Character reveal through costume and posture. Medium shot, the doorway as frame within frame.`,
    },
    {
      id: 'S56',
      title: '"Everyone Worth Promoting"',
      plot: 'INT. LOCKER ROOM. Eli: "You\'re part of this." Mara: "Everyone worth promoting is." Eli: "Why didn\'t you tell me?" Mara: "Because you were still deciding whether you wanted truth... or vindication."',
      prompt: `${WORLD} ${ELI} ${MARA} Two-shot in the locker room. Both in identical black uniforms, facing each other. Eli looks betrayed — she knew all along. Mara is unapologetic, direct. The dialogue strips away pretense. Two people in identical uniforms seeing each other clearly for the first time. The institutional gray locker room background. Intimate two-shot, both faces visible, the honesty of a reckoning between allies who weren't sure they were allies.`,
    },
    {
      id: 'S57',
      title: '"Proof, Not a Story"',
      plot: 'INT. LOCKER ROOM. Alarm pulses softly. Intercom: "Orpheus transfer team to Launch Spine Two." Mara: "If you ever do leak it... make sure the world gets proof, not a story. They\'ve trained people to laugh at stories." She leaves.',
      prompt: `${WORLD} ${MARA} Close-up of Mara delivering her final warning. A soft amber alarm light pulses in the background. Her expression is the most honest she's been: fierce, direct, deadly serious. She is giving Eli the key — not to the conspiracy, but to how to defeat it. Proof, not stories. Then she turns toward the amber-lit corridor as the intercom calls. Her silhouette recedes. The warning hangs in the air. Close-up to silhouette, amber alarm light.`,
    },
    {
      id: 'S58',
      title: 'The Data Wafer',
      plot: 'INT. LOCKER ROOM. Eli looks at the tablet. Then at his reflection in the metal locker. He slips a tiny data wafer from his sleeve and palms it. Game on.',
      prompt: `${WORLD} ${ELI} Close-up of Eli's hands. One holds the classified tablet. The other subtly pulls a tiny metallic data wafer from his sleeve — hair-thin, barely visible. He palms it with practiced sleight of hand. Cut to his face in the metal locker reflection: determination, rage, purpose. He has made his choice. The wafer is his weapon. Macro close-up of hands with the hidden device, then his reflected face. The birth of a double agent.`,
    },

    // ═══════════════════════════════════════════════════════════════════
    // FINAL SEQUENCE — Launch Spine Two (S59-S65)
    // ═══════════════════════════════════════════════════════════════════
    {
      id: 'S59',
      title: 'Launch Spine — Approach',
      plot: 'INT. CORRIDOR TO LAUNCH SPINE TWO. Eli walks with a group of silent personnel in black uniforms. They move through a massive blast-door entrance. The air vibrates with energy.',
      prompt: `${WORLD} ${ELI} A group of uniformed personnel walking through a massive blast-door entrance into Launch Spine Two. Eli among them, face neutral but eyes absorbing everything. The blast doors are enormous — industrial, military, designed for things much larger than people. The air seems to shimmer with energy beyond the threshold. The group moves in disciplined silence. Tracking shot from behind the group, the blast doors framing the entrance to the impossible.`,
    },
    {
      id: 'S60',
      title: 'Launch Chamber — Scale',
      plot: 'INT. LAUNCH SPINE TWO. A towering vertical chamber humming with impossible energy. The matte-black ship sits sealed, fueled, alive at the base. The shaft rises into darkness above.',
      prompt: `${WORLD} A TOWERING VERTICAL LAUNCH CHAMBER. The matte-black warship sits at the base, sealed and fueled, surfaces alive with subtle energy patterns. The chamber rises impossibly high above — a vertical shaft carved through solid mountain rock, disappearing into darkness. Energy conduits in the walls pulse with blue-white light. The chamber is cathedral-like in grandeur. Tiny personnel stand in formation at the base. Ultra-wide vertical shot emphasizing the impossible scale.`,
    },
    {
      id: 'S61',
      title: 'Eli Among the Faithful',
      plot: 'INT. LAUNCH SPINE. Eli stands with silent personnel, dwarfed by the ship and the shaft. Everyone watches with reverent silence. He watches with something else: rage, awe, purpose.',
      prompt: `${WORLD} ${ELI} Medium shot of Eli standing in a line of uniformed personnel inside the launch chamber. Everyone gazes upward at the ship with solemn reverence — this is their cathedral, their purpose. But Eli's expression is different. Behind his compliance, his eyes hold rage, awe, and calculation. His fist is subtly clenched at his side — the data wafer pressed into his palm. One man with a different agenda hidden among the faithful. Medium shot, faces upturned, dramatic vertical light.`,
    },
    {
      id: 'S62',
      title: 'Blast Doors Open — Revelation',
      plot: 'INT. LAUNCH SPINE. Massive blast doors part overhead, revealing not open sky — but a hidden shaft leading up through mountain rock to the stars. Sunlight pours down like divine revelation.',
      prompt: `${WORLD} Looking up inside the launch chamber. MASSIVE blast doors part overhead with hydraulic precision, revealing a shaft carved through raw mountain rock — and at the very top, a circle of brilliant blue sky and blazing sunlight. The light pours down the shaft like a column of divine illumination, catching dust and energy particles. The moment of opening is transcendent — darkness giving way to impossible light from above. Personnel faces are illuminated from above. The most awe-inspiring shot in the episode. Dramatic vertical composition.`,
    },
    {
      id: 'S63',
      title: 'The Ship Rises',
      plot: 'INT. LAUNCH SPINE. The ship rises soundlessly. As it ascends, sunlight pours down the shaft. Everyone watches in reverent silence. The ship climbs toward the stars.',
      prompt: `${WORLD} The matte-black warship rises silently from its cradle, ascending through the vertical shaft. Sunlight from above catches its angular surfaces, creating sharp shadows and gleaming edges. The ship moves with impossible grace — no engine noise, no vibration, just pure silent ascent. Below, upturned faces are bathed in reflected light. Energy trails wisps behind the rising ship. The ascent of the hidden. Vertical tracking shot following the ship upward through the shaft.`,
    },
    {
      id: 'S64',
      title: 'Fleet Status / Cover Story',
      plot: 'INT. LAUNCH SPINE. Wall screen: FLEET MOVEMENT CONFIRMED — DESTINATION: OUTER PERIMETER COMMAND. Below: PUBLIC NARRATIVE PACKAGE PREPARED — COVER STORY: METEOROLOGICAL TEST FAILURE. Eli almost laughs. No one else finds it funny.',
      prompt: `${WORLD} ${ELI} A large wall display in the launch chamber. Bold text: "FLEET MOVEMENT CONFIRMED — DESTINATION: OUTER PERIMETER COMMAND." Below it: "PUBLIC NARRATIVE PACKAGE PREPARED — COVER STORY: METEOROLOGICAL TEST FAILURE." Eli stands among solemn personnel, the faintest bitter smile on his face. Everyone else watches with professionalism. Only Eli sees the absurdity — the gap between the cosmic truth above and the mundane lie being prepared below. Medium shot, status board and Eli's dark amusement.`,
    },
    {
      id: 'S65',
      title: 'The Ship Vanishes — Welcome to Space Fleet',
      plot: 'INT. LAUNCH SPINE. The ship vanishes upward in a column of white light. ELI (V.O.): "They were never hiding scraps. They were hiding a civilization. And now I\'m inside it." CUT TO BLACK. Beat. INTERCOM: "Welcome to Space Fleet."',
      prompt: `${WORLD} ${ELI} The climactic shot. Looking up through the vertical shaft, the matte-black warship reaches the opening and vanishes in a brilliant column of white light that floods down the shaft. Personnel stand in silhouette below, bathed in blinding white from above. Eli is center frame, fist clenched around the hidden data wafer, face upturned into the light — rage, awe, and purpose burning on his face. The light overwhelms the frame. Then SMASH CUT to black. White text: "Welcome to Space Fleet." Epic vertical composition, transcendent light, series declaration.`,
    },
  ];
}

// ── Main ────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('  SPACE FLEET — Pilot Episode: "Nothing to See Here"');
  console.log('  65 Scenes × 10s = 10.8 min core footage');
  console.log('  Seedance 2.0 → On-chain');
  console.log('═'.repeat(60));

  if (UNIVERSE_ADDR === '0x0000000000000000000000000000000000000000') {
    console.error('\n  ERROR: Set SPACE_FLEET_ADDR env var to the deployed universe address.');
    process.exit(1);
  }
  if (!BYTEDANCE_API_KEY) {
    console.error('\n  ERROR: BYTEDANCE_API_KEY not set.');
    process.exit(1);
  }

  // Auth + fetch character DNA from wiki
  log('AUTH', 'Authenticating...');
  const token = await getAuthToken();
  log('AUTH', `Authenticated as ${account.address}`);

  const dna = await fetchCharacterDNA(token);
  const SCENES = buildScenes(dna);

  // Find start index
  const startIdx = SCENES.findIndex((s) => s.id === START_SCENE);
  if (startIdx < 0) {
    console.error(`  ERROR: START_SCENE=${START_SCENE} not found.`);
    process.exit(1);
  }
  if (startIdx > 0) {
    log('RESUME', `Skipping to ${START_SCENE} (scene ${startIdx + 1}/${SCENES.length})`);
  }

  const balance = await publicClient.getBalance({ address: account.address });
  log('SETUP', `Balance: ${(Number(balance) / 1e18).toFixed(4)} ETH`);

  const latestId = (await publicClient.readContract({
    address: UNIVERSE_ADDR,
    abi: universeAbi,
    functionName: 'latestNodeId',
  })) as bigint;
  log('SETUP', `Latest node: #${latestId}`);

  let previousId = latestId;
  const results: Array<{ id: string; title: string; nodeId: bigint }> = [];

  for (let i = startIdx; i < SCENES.length; i++) {
    const scene = SCENES[i];
    const label = `${scene.id} (${i + 1}/${SCENES.length})`;

    console.log(`\n${'═'.repeat(55)}`);
    console.log(`  ${scene.id}: ${scene.title}`);
    console.log(`${'═'.repeat(55)}`);

    try {
      // 1. Generate video
      const videoUrl = await generateVideo(scene.prompt, label);

      // 2. Create on-chain node
      const contentHash = `sf-${scene.id}-${Date.now()}`;
      const nodeId = await createNode(contentHash, scene.plot, previousId, videoUrl, label);
      previousId = nodeId;

      results.push({ id: scene.id, title: scene.title, nodeId });
      log(label, `DONE — Node #${nodeId}`);
    } catch (err: any) {
      log(label, `FAILED: ${err.message?.slice(0, 200)}`);
      log(label, 'Skipping — continuing with next scene');
      log(
        label,
        `To resume from here: START_SCENE=${scene.id} pnpm tsx scripts/space-fleet-pilot-scenes.ts`
      );
    }

    if (i < SCENES.length - 1) await sleep(2000);
  }

  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log('  SPACE FLEET — Pilot Episode Generation Complete');
  console.log('═'.repeat(60));
  console.log(`  Scenes completed: ${results.length}/${SCENES.length - startIdx}`);
  console.log(`  Total footage: ~${results.length * 10}s`);
  if (results.length > 0) {
    console.log(`  Node chain: ${results.map((r) => `#${r.nodeId}`).join(' → ')}`);
  }
  console.log('');
  for (const r of results) {
    console.log(`  ${r.id} | ${r.title.padEnd(40)} | Node #${r.nodeId}`);
  }
  console.log(`\n  Universe: ${UNIVERSE_ADDR}`);
  console.log(`  Next: Run space-fleet-audio-pipeline.ts for voice, SFX & music\n`);
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
