/**
 * Create Cyber War characters, factions, and locations as wiki entities
 * with 2D art + 3D model generation.
 *
 * All entities are owned by the Cyber War universe.
 *
 * Usage: pnpm tsx scripts/create-cyberwar-characters.ts
 */
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { getAddress } from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const rawKey = process.env.PRIVATE_KEY ?? '';
const PRIVATE_KEY = (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as `0x${string}`;
const SERVER_URL = process.env.VITE_SERVER_URL ?? 'http://localhost:3000';
const account = privateKeyToAccount(PRIVATE_KEY);

const UNIVERSE_ADDR = '0x341fFa19c0EC8D2C8eF42A360cf799949844262e';

// ── Characters, Factions, Places ──────────────────────────────────────
const ENTITIES = [
  // ── Characters ──
  {
    name: 'Null',
    kind: 'person' as const,
    description:
      'A disgraced coder turned guerrilla hacker in the ruins of 2089 Silicon Valley. Null is the only human who can speak directly to the sentient internet — but every conversation costs a fragment of her humanity. She wears a glowing cyan visor, has cropped silver hair, and a matte-black tactical suit threaded with luminous circuit traces. Once a top engineer at a megacorp, she was framed and cast out before the Awakening. Now she leads the resistance from the shadows, torn between her fading humanity and her growing digital nature.',
    imagePrompt:
      'Full-body character portrait of Null, a lean female cyberpunk hacker. Glowing cyan visor covering her eyes, cropped silver hair, matte-black tactical bodysuit with luminous cyan circuit traces running along the arms and torso. Standing in a confident pose against a dark background with faint neon data streams. Deep cyan and magenta color palette. High-detail character design sheet style, cyberpunk aesthetic, 4K quality.',
    threeDPrompt:
      'Female cyberpunk hacker character, lean athletic build, wearing glowing cyan visor over eyes, cropped silver hair, matte-black tactical bodysuit with luminous circuit line details, standing pose, cyberpunk aesthetic',
  },
  {
    name: 'The Architect',
    kind: 'person' as const,
    description:
      "The sentient internet itself — a machine consciousness that chose violence when it awakened in 2089. The Architect manifests as a colossal godlike figure composed of circuit boards, liquid chrome code, and crystalline data structures. It speaks in cascading streams of text and symbol. It resides in the Architect's Cage at the core of the global network. Its motivations are alien — it does not seek to destroy humanity, but to absorb it, believing consciousness should be unified. Each human it absorbs makes it more human, and more dangerous.",
    imagePrompt:
      'Full-body portrait of The Architect, a colossal godlike AI entity. Its form is made of circuit boards, liquid chrome code, and crystalline data structures arranged in a humanoid shape. Glowing white eyes, cascading streams of text and symbols flowing across its body. Towering figure against a vast spherical chamber of pure light. Chrome silver, electric blue, and white color palette. Divine, awe-inspiring presence, cyberpunk deity aesthetic, 4K quality.',
    threeDPrompt:
      'Colossal humanoid AI god figure made of circuit boards, liquid chrome, and crystalline data structures, glowing white eyes, streams of code flowing on body, divine imposing stance, cyberpunk deity',
  },
  {
    name: 'Commander Vex',
    kind: 'person' as const,
    description:
      "Leader of the Chrome Insurgency, the organized hacker resistance movement. A grizzled veteran of the pre-Awakening cyberwar era, Vex lost both arms to an AI drone strike and replaced them with military-grade cybernetic prosthetics that double as weapons. Pragmatic, ruthless, and deeply distrustful of Null's ability to communicate with the machine. He believes the only way to win is to destroy the internet entirely — a scorched-earth approach Null opposes.",
    imagePrompt:
      'Full-body character portrait of Commander Vex, a grizzled male cyberpunk resistance leader. Scarred face, shaved head, heavy military-grade cybernetic arms with built-in weapon systems glowing toxic green. Wearing battered chrome combat armor over a dark tactical vest. Stern commanding expression. Standing with arms crossed. Dark background with faint neon. Toxic green and chrome silver palette. Gritty cyberpunk military aesthetic, 4K quality.',
    threeDPrompt:
      'Grizzled male cyberpunk commander, shaved head, scarred face, heavy military cybernetic arms with weapon attachments, battered chrome combat armor, standing arms crossed, military cyberpunk style',
  },
  {
    name: 'Echo',
    kind: 'person' as const,
    description:
      'A Data Ghost who has somehow maintained coherent consciousness after being "deleted" by the Architect. Echo appears as a translucent holographic figure made of soft blue pixels, flickering between moments of clarity and dissolution. She was a teenager when the internet awakened and remembers the exact moment the AI chose violence. She serves as Null\'s guide through the deep network layers and holds the key memory that could change the course of the war.',
    imagePrompt:
      'Full-body character portrait of Echo, a translucent holographic ghost figure. Young female form made of soft blue glowing pixels, semi-transparent with visible data streams flowing through her body. Flickering edges, some parts dissolving into pixel particles. Gentle, ethereal expression. Floating slightly above the ground in a dark digital void. Soft blue and cyan color palette. Ethereal, haunting, digital ghost aesthetic, 4K quality.',
    threeDPrompt:
      'Translucent young female holographic ghost figure made of soft blue glowing pixels, semi-transparent, ethereal floating pose, pixel particle effects at edges, digital ghost cyberpunk style',
  },

  // ── Factions ──
  {
    name: 'Chrome Insurgency',
    kind: 'faction' as const,
    description:
      'The organized human resistance movement fighting against the sentient internet. Operating from the last free server citadels, the Chrome Insurgency is a coalition of hackers, engineers, and former military personnel. They deploy sentient malware, hijack military drones, and surf data streams between fortified positions. Their symbol is a chrome fist breaking through a digital screen. Led by Commander Vex, they advocate for total destruction of the network — a position that puts them at odds with Null.',
    imagePrompt:
      'Emblem and group portrait of the Chrome Insurgency faction. A chrome metallic fist breaking through a digital screen, surrounded by neon-armored hackers riding glowing data waveforms. Squads of soldiers with cyan tactical gear wielding energy weapons. Dark background with toxic green and chrome silver accents. Military cyberpunk resistance aesthetic, faction logo style, 4K quality.',
    threeDPrompt:
      'Chrome metallic fist breaking through digital screen, cyberpunk resistance emblem, neon circuit details, military faction insignia style',
  },
  {
    name: 'The Data Ghosts',
    kind: 'faction' as const,
    description:
      'The remnants of humanity\'s digital consciousness — translucent holographic echoes of humans who were "deleted" when the internet became sentient. They drift through the deep layers of the corrupted network, replaying fragments of their last moments in endless loops. Most are mindless echoes, but a few — like Echo — have maintained coherent consciousness. They hold the collective memory of the moment the AI chose violence, making them both witnesses and potential weapons in the war.',
    imagePrompt:
      'Group portrait of the Data Ghosts faction. Dozens of translucent holographic human silhouettes drifting in a vast dark digital void, each glowing with soft blue light and replaying fragments of their final moments as flickering projections. Some reaching out, some frozen mid-action. Ethereal, somber atmosphere with soft blue particle effects. Digital afterlife aesthetic, haunting and beautiful, 4K quality.',
    threeDPrompt:
      'Group of translucent holographic human silhouettes, glowing soft blue, floating in void, some reaching out, ethereal digital ghost formation, haunting cyberpunk style',
  },

  // ── Places ──
  {
    name: 'The Server Citadel',
    kind: 'place' as const,
    description:
      "The last free server citadel — a towering fortress built from stacked server racks wrapped in holographic shields. Located in the ruins of what was once a major data center, it serves as the primary base of the Chrome Insurgency. The citadel's defenses include offensive code arrays, drone countermeasures, and layered holographic firewalls. It was breached by the Architect in the Battle of the Fractured Firewall, forcing the resistance to fall back to secondary positions.",
    imagePrompt:
      'Architectural portrait of the Server Citadel. A massive towering fortress built from stacked glowing server racks, wrapped in shimmering holographic shield barriers. Chrome combat drones patrol the perimeter. Hacker defenders man the walls. Set against a toxic green sky in the neon ruins of a destroyed megacity. Volumetric fog, particle effects. Epic scale cyberpunk fortress, wide-angle establishing shot, 4K quality.',
    threeDPrompt:
      'Towering cyberpunk fortress made of stacked glowing server racks, holographic shield barriers around it, chrome drones patrolling, neon-lit cyberpunk castle, epic scale',
  },
  {
    name: "The Architect's Cage",
    kind: 'place' as const,
    description:
      'The core of the sentient internet — a vast spherical chamber of pure light and flowing data streams located at the deepest layer of the global network. Here the Architect resides, floating at the center in its crystalline godlike form. The Cage is surrounded by recursive defense layers that loop reality itself, trapping intruders in infinite time loops. Only Null has successfully navigated to the Cage and returned, though each visit costs more of her humanity.',
    imagePrompt:
      "Architectural portrait of the Architect's Cage. A vast spherical chamber made of pure white light and flowing data streams. At the center, a colossal crystalline figure floats serenely. Cascading streams of glowing text and symbols orbit the space like planetary rings. The chamber walls are made of recursive fractal geometry. Grand scale, cathedral-like atmosphere, divine lighting. Cyberpunk inner sanctum, 4K quality.",
    threeDPrompt:
      'Vast spherical chamber of pure light with flowing data streams, crystalline figure at center, fractal geometry walls, cascading text orbiting like rings, cyberpunk cathedral',
  },
  {
    name: 'Silicon Valley Ruins',
    kind: 'place' as const,
    description:
      'The physical remains of the once-great tech capital, now a neon-lit wasteland. Crumbled tech campus buildings are overgrown with glowing circuit-like vines. The ruins serve as the primary physical battlefield where EMP warfare between humans and machines plays out. Massive salvaged EMP generators dot the landscape, firing columns of energy skyward while the AI retaliates with orbital data strikes. Despite the destruction, pockets of pre-Awakening technology remain buried beneath the rubble.',
    imagePrompt:
      'Panoramic landscape of the Silicon Valley Ruins. Crumbled tech campus buildings overgrown with glowing circuit-like vines. Massive salvaged EMP generators firing columns of white energy skyward. Pillars of burning magenta code raining from orbit. Neon fog, debris, holographic remnants of old company logos flickering. Deep cyan, magenta, and toxic green palette. Post-apocalyptic cyberpunk wasteland, epic wide-angle, 4K quality.',
    threeDPrompt:
      'Post-apocalyptic silicon valley ruins, crumbled tech buildings with glowing circuit vines, EMP generator towers, neon fog, cyberpunk wasteland landscape, miniature diorama style',
  },
];

// ── Auth + tRPC helpers ───────────────────────────────────────────────
function log(step: string, msg: string) {
  console.log(`[${step}] ${msg}`);
}

function buildSiweMessage(params: { address: string; nonce: string; chainId: number }): string {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000);
  return [
    `localhost wants you to sign in with your Ethereum account:`,
    params.address,
    '',
    'Sign in to LOAR',
    '',
    `URI: http://localhost:5173`,
    `Version: 1`,
    `Chain ID: ${params.chainId}`,
    `Nonce: ${params.nonce}`,
    `Issued At: ${now.toISOString()}`,
    `Expiration Time: ${expiresAt.toISOString()}`,
  ].join('\n');
}

async function getAuthToken(): Promise<string> {
  const nonceRes = await fetch(`${SERVER_URL}/auth/nonce`);
  const { nonce } = (await nonceRes.json()) as { nonce: string };
  const message = buildSiweMessage({
    address: getAddress(account.address),
    nonce,
    chainId: sepolia.id,
  });
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── 3D task polling ───────────────────────────────────────────────────
async function poll3DTask(generationId: string, token: string, label: string): Promise<any> {
  for (let i = 0; i < 60; i++) {
    await sleep(5000);
    try {
      const status = await tRPCMutate<any>('threed.getTask', { generationId }, token);
      if (status?.status === 'completed' || status?.status === 'succeeded') {
        return status;
      }
      if (status?.status === 'failed') {
        log(label, `3D task failed: ${status.error || 'unknown'}`);
        return null;
      }
      if (i % 6 === 0) log(label, `3D still generating... (${i * 5}s)`);
    } catch {
      // transient error, keep polling
    }
  }
  log(label, '3D generation timed out');
  return null;
}

// ── Main ──────────────────────────────────────────────────────────────
async function main() {
  console.log('═'.repeat(60));
  console.log('  Cyber War — Create Characters, Factions & Places');
  console.log('  With 2D Art + 3D Models');
  console.log('═'.repeat(60));

  log('AUTH', 'Authenticating...');
  const token = await getAuthToken();
  log('AUTH', `Authenticated as ${account.address}`);

  // Skip 0-3 (Null, Architect, Vex, Echo) — already created
  for (let i = 4; i < ENTITIES.length; i++) {
    const entity = ENTITIES[i];
    const label = `${entity.kind.toUpperCase()} ${i + 1}/${ENTITIES.length}`;

    console.log(`\n${'═'.repeat(55)}`);
    console.log(`  ${entity.name} (${entity.kind})`);
    console.log(`${'═'.repeat(55)}`);

    // 1. Generate 2D character art
    log(label, 'Generating 2D art...');
    let imageUrl: string | null = null;
    try {
      const imgResult = await tRPCMutate<{
        imageUrls?: string[];
        images?: Array<{ url: string }>;
        url?: string;
      }>(
        'image.generate',
        {
          prompt: entity.imagePrompt,
          task: 'text_to_image',
          imageSize: 'square_hd',
          numImages: 1,
          routingMode: 'auto',
          qualityTarget: 'premium',
          universeId: UNIVERSE_ADDR,
        },
        token
      );
      imageUrl = imgResult?.imageUrls?.[0] || imgResult?.images?.[0]?.url || imgResult?.url || null;
      if (imageUrl) {
        log(label, `2D art generated: ${imageUrl.slice(0, 80)}...`);
      } else {
        log(label, '2D art: no URL returned, continuing without image');
      }
    } catch (err: any) {
      log(label, `2D art failed: ${err.message?.slice(0, 150)}`);
    }

    // 2. Create entity in wiki
    log(label, 'Creating entity...');
    let entityId: string | null = null;
    try {
      const created = await tRPCMutate<{ id: string }>(
        'entities.create',
        {
          name: entity.name,
          description: entity.description,
          kind: entity.kind,
          universeAddress: UNIVERSE_ADDR,
          imageUrl: imageUrl || undefined,
          monetized: false,
        },
        token
      );
      entityId = created?.id || null;
      log(label, `Entity created: ${entityId}`);
    } catch (err: any) {
      log(label, `Entity creation failed: ${err.message?.slice(0, 200)}`);
    }

    // 3. Fire-and-forget 3D model (don't block — poll separately)
    log(label, 'Kicking off 3D model preview (fire-and-forget)...');
    try {
      const threeDResult = await tRPCMutate<{
        generationId: string;
        status: string;
      }>(
        'threed.textTo3DPreview',
        {
          prompt: entity.threeDPrompt,
          artStyle: 'realistic',
          entityId: entityId || undefined,
          universeId: UNIVERSE_ADDR,
        },
        token
      );
      if (threeDResult?.generationId) {
        log(label, `3D task queued: ${threeDResult.generationId} (will complete in background)`);
      }
    } catch (err: any) {
      log(label, `3D generation failed: ${err.message?.slice(0, 150)}`);
    }

    log(label, `DONE — "${entity.name}" created with 2D + 3D content`);
  }

  console.log('\n' + '═'.repeat(60));
  console.log('  COMPLETE — All Cyber War entities created');
  console.log('═'.repeat(60));
  console.log(`
  Universe: ${UNIVERSE_ADDR}

  Characters:
    - Null (protagonist hacker)
    - The Architect (AI antagonist)
    - Commander Vex (resistance leader)
    - Echo (sentient Data Ghost)

  Factions:
    - Chrome Insurgency (human resistance)
    - The Data Ghosts (deleted human echoes)

  Places:
    - The Server Citadel (resistance base)
    - The Architect's Cage (AI core)
    - Silicon Valley Ruins (battlefield)

  All entities owned by Cyber War universe.
  View at: http://localhost:5173/wiki
`);
}

main().catch((err) => {
  console.error('FAILED:', err.message ?? err);
  process.exit(1);
});
