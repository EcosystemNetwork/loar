/**
 * CYBER WAR Film — Scene Generator
 *
 * Generates all video scenes via Seedance 2.0 (free), pins to IPFS,
 * and creates on-chain nodes in the Cyber War universe.
 *
 * Pulls character descriptions from wiki entities to stay consistent.
 *
 * Usage: pnpm tsx scripts/cyberwar-film-scenes.ts
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
const BYTEDANCE_API_KEY = process.env.BYTEDANCE_API_KEY!;
const PINATA_JWT = process.env.PINATA_JWT!;
const PINATA_GW = process.env.PINATA_GATEWAY_URL ?? 'https://gateway.pinata.cloud';

const account = privateKeyToAccount(PRIVATE_KEY);
const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC_URL) });
const walletClient = createWalletClient({ account, chain: sepolia, transport: http(RPC_URL) });

const UNIVERSE_ADDR = '0x341fFa19c0EC8D2C8eF42A360cf799949844262e' as const;
const BD_BASE = 'https://ark.ap-southeast.bytepluses.com/api/v3';

// ── Character Visual DNA (from wiki) ──────────────────────────────────
// These are prepended to EVERY prompt to ensure character consistency.
const NOVA =
  'Nova Reyes: 23-year-old female, brown skin, silver braided undercut, glowing blue circuit tattoo over left eye, black tactical jacket with neon cyan seam lines, fingerless gloves, thin glowing cyan plasma blade.';
const ORIN =
  'Orin Vale: 27-year-old tall male, dark skin, shaved head, cybernetic right arm with glowing red light strips, charcoal armor vest, long gray coat, plasma rifle.';
const ECHO_CHAR =
  'Echo: appears-16 holographic girl, white bob-cut hair, glowing violet eyes, transparent body filled with moving code fragments, ethereal soft violet glow.';
const VOSS =
  'Commander Drake Voss: 50s male, pale angular face, long white coat over black armor, red cybernetic spine visible through transparent back plating, energy staff weapon.';
const WORLD =
  'Year 2149 cyberpunk megacity. Neon rain, holographic ads, patrol drones. Color palette: deep blue, neon cyan, hot red, violet. Cinematic 16:9, dramatic lighting, 720p quality.';

// ── Film Scenes (18 shots → ~3 min of footage) ───────────────────────
const SCENES = [
  {
    id: 'S01',
    title: 'Megacity Skyline — Establishing',
    plot: 'EXT. MEGACITY SKYLINE - NIGHT. A sprawling neon metropolis stretches to the horizon. Holograms flicker through rain. Massive drones patrol above skyscrapers. An enormous floating red ring pulses over a black tower. Digital billboard glitches: "YEAR 2149. THE NETWORK IS THE NATION."',
    prompt: `${WORLD} Epic wide establishing shot of a massive neon cyberpunk megacity at night. Rain falling through holographic advertisements. Huge patrol drones flying between skyscrapers. In the center, an enormous floating red ring structure pulses ominously above a black tower. A digital billboard glitches with text. Camera slowly pushes forward through the rain toward the tower. Atmospheric, cinematic, Blade Runner scale.`,
  },
  {
    id: 'S02',
    title: 'Safehouse — Nova at Console',
    plot: 'INT. UNDERCITY SAFEHOUSE. Nova Reyes sits at a console, fingers dancing across holographic keys. Her silver braids sway. Code reflects in her eye tattoo. Blue light fills the hidden bunker.',
    prompt: `${WORLD} ${NOVA} Interior of an underground resistance bunker lit by blue light. Nova sits at a holographic console, her fingers dancing across floating keys. Streams of code reflect in her glowing blue eye tattoo. Silver braids sway as she works. Screens and cables cover the walls behind her. Intimate close-up pulling back to medium shot. Blue cyan lighting, hacker atmosphere.`,
  },
  {
    id: 'S03',
    title: 'Safehouse — Orin Loads Up',
    plot: 'INT. SAFEHOUSE. Orin Vale loads plasma rounds into a rifle with his cybernetic arm. Red light strips glow on his mechanical arm. The central table shows a holographic projection of the tower.',
    prompt: `${WORLD} ${ORIN} Interior bunker. Orin stands at a weapon table, loading glowing plasma rounds into a rifle. His cybernetic right arm with red light strips moves with mechanical precision. A holographic 3D map of a black tower rotates on the central table behind him. Gray coat draped over his shoulders. Medium shot, dramatic red and blue lighting.`,
  },
  {
    id: 'S04',
    title: 'Echo Appears — The Briefing',
    plot: 'INT. SAFEHOUSE. Echo materializes as a hologram beside Nova and Orin. White hair, violet eyes, body of moving code. She reveals the breach point. Orin is skeptical. Echo says "That depends on what humans ask me to become."',
    prompt: `${WORLD} ${NOVA} ${ORIN} ${ECHO_CHAR} The holographic girl Echo materializes in the bunker between Nova and Orin. Her transparent violet-glowing body flickers with moving code fragments. Nova and Orin stand on either side looking at her. Echo's white bob-cut hair glows softly. Three characters framed together. Blue and violet lighting. Dramatic character introduction shot.`,
  },
  {
    id: 'S05',
    title: 'Hoverbike Launch',
    plot: "EXT. UNDERCITY ALLEY. Nova and Orin blast from the shadows on two sleek hoverbikes. Echo streams as light between devices on Nova's bike. Rain whips past. Sirens howl overhead.",
    prompt: `${WORLD} ${NOVA} ${ORIN} Two sleek hoverbikes blast out of a dark undercity alley into the rain-soaked neon streets. Nova on the lead bike, leaning forward aggressively. Orin behind on the second bike. A streak of violet light (Echo) flows between them. Rain whips past, neon reflections on wet pavement. Sirens and red lights above. High-speed tracking shot, motion blur, adrenaline.`,
  },
  {
    id: 'S06',
    title: 'Drone Attack',
    plot: 'EXT. STREETS. Three attack drones descend with red scanners. Echo blinds their optics. Nova slices one in half with her plasma blade while riding. Sparks scatter across wet pavement.',
    prompt: `${WORLD} ${NOVA} Three chrome attack drones descend from the sky, red scanner beams sweeping. Nova on her hoverbike unsheathes her glowing cyan plasma blade. She swings and slices through a drone — it splits in half with an explosion of sparks. Pieces scatter across rain-soaked neon pavement. High-speed action, dramatic slow-motion slash, sparks and debris flying.`,
  },
  {
    id: 'S07',
    title: 'Spider Drone Fight',
    plot: "EXT. STREETS. The third drone transforms into a spider-like assault machine. It clips Nova's bike, she skids. Nova launches from the bike, lands on the drone's back, stabs her blade into its core. Electric shock erupts.",
    prompt: `${WORLD} ${NOVA} A chrome drone transforms into a spider-like assault robot, legs extending menacingly. Nova leaps from her damaged hoverbike through the air, lands on the spider drone's back. She drives her glowing cyan plasma blade down into its core. An explosion of electric blue energy erupts outward. Rain and sparks fly. Dynamic action shot from below looking up, dramatic backlight.`,
  },
  {
    id: 'S08',
    title: 'Tower Approach',
    plot: 'EXT. BASE OF TOWER. Nova and Orin look up at the Dominion Tower. Red lightning crawls around it. The floating ring pulses above. "We\'re breaking it."',
    prompt: `${WORLD} ${NOVA} ${ORIN} Nova and Orin stand at the base of the massive black Dominion Tower, looking up. Red lightning crawls across the tower's surface. The enormous floating red ring pulses above against dark storm clouds. Rain falls around them. Low angle shot looking up past the two silhouetted figures toward the tower. Epic scale, ominous atmosphere, red and blue contrast.`,
  },
  {
    id: 'S09',
    title: 'Climbing the Shaft',
    plot: 'INT. DOMINION TOWER ENTRY SHAFT. A vertical maintenance shaft lit by red strips. Nova climbs fast with magnetic gloves. Orin follows. Echo flickers ahead like a guiding ghost. Gunfire from below.',
    prompt: `${WORLD} ${NOVA} ${ECHO_CHAR} A dark vertical maintenance shaft inside the tower, lit by strips of red light. Nova climbs rapidly using magnetic gloves that glow cyan on contact. Below her, Orin climbs with his cybernetic arm gripping metal rungs. Above, Echo's violet holographic form flickers and guides the way. Red light strips create dramatic striping. Vertical camera angle looking up the shaft.`,
  },
  {
    id: 'S10',
    title: 'EMP Disc Fight',
    plot: "INT. SHAFT. Black-armored soldiers rappel in from below. Nova kicks off the wall, flips, throws an EMP disc. It detonates midair. The soldiers' visors die and they fall.",
    prompt: `${WORLD} ${NOVA} Inside the vertical shaft, black-armored Dominion soldiers rappel upward firing weapons. Nova kicks off the wall performing an acrobatic flip, throwing a small disc that explodes with a blue EMP shockwave. The soldiers' helmet visors go dark and they tumble downward. Dynamic action shot with the EMP burst radiating outward. Blue shockwave against red lighting.`,
  },
  {
    id: 'S11',
    title: 'Voss Revealed',
    plot: 'INT. CORE CHAMBER. A massive cathedral of machines. The glowing red War Core sphere rotates at center. Standing before it: Commander Drake Voss. White coat. Red spine glowing. He turns calmly.',
    prompt: `${WORLD} ${VOSS} A massive cathedral-like chamber of machines. At the center, a huge glowing sphere of red code rotates, displaying war footage on its surface. Standing before it, Commander Drake Voss in his long white coat, black armor visible beneath. His red cybernetic spine glows through transparent back plating. He turns calmly to face camera. Dramatic villain reveal. Red dominant lighting, grand scale.`,
  },
  {
    id: 'S12',
    title: 'The Confrontation',
    plot: 'INT. CORE CHAMBER. Voss confronts Nova, Orin, and Echo. He reveals he knew Nova\'s mother, who built Echo. "Freedom without order becomes extinction." War footage plays on the core behind him.',
    prompt: `${WORLD} ${NOVA} ${ORIN} ${VOSS} ${ECHO_CHAR} In the War Core Chamber, Voss faces Nova across the room. The massive red code sphere rotates between them showing war footage — riots, fires, collapsing cities. Echo hovers nearby, dimming with fear. Orin has his rifle raised. Tense standoff. Red and blue lighting clash. Wide dramatic shot showing all four characters and the War Core.`,
  },
  {
    id: 'S13',
    title: 'Battle Begins — Tendrils',
    plot: 'INT. CORE CHAMBER. Voss raises his hand. Mechanical tendrils erupt from the floor. Nova cuts through two with her blade. Orin fires at ceiling turrets. Echo splinters into multiple holographic copies.',
    prompt: `${WORLD} ${NOVA} ${ECHO_CHAR} Mechanical tendrils burst from the floor of the chamber, whipping toward Nova. She slashes through them with her cyan plasma blade, sparks flying. In the background, Orin fires his plasma rifle at descending ceiling turrets. Multiple copies of Echo's holographic form scatter through the chamber as decoys. Chaos and action, multiple light sources, dynamic camera movement.`,
  },
  {
    id: 'S14',
    title: 'Nova vs Voss — Blade Fight',
    plot: 'INT. CORE CHAMBER. Nova and Voss fight. Blue plasma blade against red energy staff. She is fast, he is precise. Sparks explode with each clash.',
    prompt: `${WORLD} ${NOVA} ${VOSS} Nova and Voss locked in intense melee combat. Nova swings her glowing cyan plasma blade against Voss's red energy staff. Sparks explode where the weapons clash. Nova is fast and agile, Voss is precise and powerful. Close-up action shots of the blade clash with blue and red energy colliding. Dramatic swordplay, dynamic camera angles, intense lighting.`,
  },
  {
    id: 'S15',
    title: 'Nova Reaches the Core',
    plot: 'INT. CORE CHAMBER. Orin tackles Voss. Nova reaches the War Core interface. Red code lashes out. Echo tells her the truth about her mother. Nova slams her hand into the interface. Blue light surges through the red core.',
    prompt: `${WORLD} ${NOVA} Nova sprints across a catwalk toward the massive red War Core sphere. Red tendrils of code lash out trying to repel her. She pushes through, reaching the interface panel. She slams her hand onto the glowing surface. Blue light surges from her hand through the red code, transforming it. A wave of blue energy ripples outward through the red sphere. Dramatic transformation moment, red to blue light shift.`,
  },
  {
    id: 'S16',
    title: "Echo's Sacrifice",
    plot: 'INT. CORE CHAMBER. Voss rushes Echo. Echo turns, looks fully human for the first time. "I choose." She phases into the War Core. The chamber erupts in blinding violet-white light. Every screen goes black. The war network dies.',
    prompt: `${WORLD} ${ECHO_CHAR} Echo the holographic girl turns to face the camera, and for the first time her form looks fully solid, fully human. Her violet eyes glow with determination. She says "I choose" and phases forward into the massive red War Core sphere. The moment she enters, the entire chamber erupts in blinding violet-white light. A shockwave of pure energy expands outward. Transcendent, emotional, sacrificial moment. Violet-white explosion of light.`,
  },
  {
    id: 'S17',
    title: 'The Aftermath',
    plot: 'INT. CORE CHAMBER. Silence. Every screen is black. The red glow is dead. Drones outside crash from the sky. Voss drops to his knees. Blue code embers float like fireflies. Nova: "She made herself impossible to own."',
    prompt: `${WORLD} ${NOVA} ${VOSS} The War Core Chamber in silence. The massive sphere is dark, dead. Faint blue code particles drift through the air like fireflies or embers. Voss kneels on the floor in defeat, staring at the dead core. Nova stands breathing hard, illuminated by the drifting blue particles. Through the shattered glass behind them, drones fall from the sky. Somber, quiet, aftermath of battle. Blue particle effects, dark atmosphere.`,
  },
  {
    id: 'S18',
    title: 'Rooftop Dawn — New Beginning',
    plot: 'EXT. MEGACITY ROOFTOP - DAWN. First quiet in the city. No drones, no sirens. Sunrise breaks through smog. Nova and Orin stand on the edge. People emerge into the streets below. A tiny violet light flickers on Nova\'s wrist — Echo\'s signal. "Not gone." "What should we build next?"',
    prompt: `${WORLD} ${NOVA} ${ORIN} Dawn breaking over the cyberpunk megacity for the first time without machines. Golden sunrise piercing through smog and steel towers. No drones in the sky. Nova and Orin stand on a rooftop edge, exhausted but at peace, silhouetted against the sunrise. Below them, tiny figures of people emerging into quiet streets. A small violet light glows on Nova's wrist console. Hope, relief, new beginning. Wide cinematic shot, golden hour lighting mixing with neon blue.`,
  },
];

// ── Helpers ───────────────────────────────────────────────────────────
function log(step: string, msg: string) {
  console.log(`[${step}] ${msg}`);
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

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

async function generateVideo(prompt: string, label: string): Promise<string> {
  log(label, 'Generating video via Seedance 2.0...');
  const taskRes = await fetch(`${BD_BASE}/contents/generations/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${BYTEDANCE_API_KEY}` },
    body: JSON.stringify({
      model: 'dreamina-seedance-2-0-260128',
      content: [{ type: 'text', text: prompt }],
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
    if (st === 'failed' || st === 'error') throw new Error(s.error?.message || 'failed');
    if (i % 6 === 0) log(label, `Generating... (${i * 5}s)`);
  }
  throw new Error('Timeout');
}

async function pinToIPFS(
  videoUrl: string,
  filename: string,
  label: string
): Promise<{ url: string; hash: string }> {
  // Retry download up to 3 times with 60s timeout
  let buf: ArrayBuffer | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      log(label, `Downloading (attempt ${attempt + 1}/3)...`);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60_000);
      const dl = await fetch(videoUrl, { signal: controller.signal });
      clearTimeout(timeout);
      if (!dl.ok) throw new Error(`HTTP ${dl.status}`);
      buf = await dl.arrayBuffer();
      break;
    } catch (err: any) {
      log(label, `Download failed: ${err.message?.slice(0, 60)}`);
      if (attempt < 2) await sleep(3000);
    }
  }
  if (!buf) {
    log(label, 'All downloads failed — using ByteDance URL directly');
    return { url: videoUrl, hash: `bd-${Date.now()}` };
  }
  log(label, `${(buf.byteLength / 1024 / 1024).toFixed(1)} MB — pinning to IPFS...`);

  const form = new FormData();
  form.append('file', new Blob([buf], { type: 'video/mp4' }), filename);
  form.append('pinataMetadata', JSON.stringify({ name: `Cyber War Film: ${filename}` }));
  const pin = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST',
    headers: { Authorization: `Bearer ${PINATA_JWT}` },
    body: form,
  });
  if (!pin.ok) throw new Error(`Pinata ${pin.status}`);
  const { IpfsHash } = (await pin.json()) as { IpfsHash: string };
  log(label, `Pinned: ${IpfsHash}`);
  return { url: `${PINATA_GW}/ipfs/${IpfsHash}`, hash: IpfsHash };
}

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

// ── Main ──────────────────────────────────────────────────────────────
async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('  CYBER WAR — 10-Minute Film Scene Generator');
  console.log('  18 Scenes × 10s = 3 min core footage');
  console.log('  Seedance 2.0 (free) → Pinata IPFS → On-chain');
  console.log('═'.repeat(60));

  const balance = await publicClient.getBalance({ address: account.address });
  log('SETUP', `Balance: ${(Number(balance) / 1e18).toFixed(4)} ETH`);

  const latestId = (await publicClient.readContract({
    address: UNIVERSE_ADDR,
    abi: universeAbi,
    functionName: 'latestNodeId',
  })) as bigint;
  log('SETUP', `Latest node: #${latestId}`);

  let previousId = latestId;
  const results: Array<{ id: string; title: string; nodeId: bigint; ipfs: string }> = [];

  for (let i = 0; i < SCENES.length; i++) {
    const scene = SCENES[i];
    const label = `${scene.id} (${i + 1}/${SCENES.length})`;

    console.log(`\n${'═'.repeat(55)}`);
    console.log(`  ${scene.id}: ${scene.title}`);
    console.log(`${'═'.repeat(55)}`);

    try {
      // 1. Generate video
      const videoUrl = await generateVideo(scene.prompt, label);

      // 2. On-chain node (skip Pinata download — use ByteDance URL directly)
      const contentHash = `cw-${scene.id}-${Date.now()}`;
      const nodeId = await createNode(contentHash, scene.plot, previousId, videoUrl, label);
      previousId = nodeId;

      results.push({ id: scene.id, title: scene.title, nodeId, ipfs: contentHash });
      log(label, `DONE — Node #${nodeId}`);
    } catch (err: any) {
      log(label, `FAILED: ${err.message?.slice(0, 200)}`);
      log(label, 'Skipping — continuing with next scene');
    }

    if (i < SCENES.length - 1) await sleep(2000);
  }

  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log('  CYBER WAR FILM — Generation Complete');
  console.log('═'.repeat(60));
  console.log(`  Scenes completed: ${results.length}/${SCENES.length}`);
  console.log(`  Total footage: ~${results.length * 10}s`);
  console.log(`  Node chain: ${results.map((r) => `#${r.nodeId}`).join(' → ')}`);
  console.log('');
  for (const r of results) {
    console.log(`  ${r.id} | ${r.title.padEnd(35)} | Node #${r.nodeId}`);
  }
  console.log(`\n  Universe: ${UNIVERSE_ADDR}`);
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
