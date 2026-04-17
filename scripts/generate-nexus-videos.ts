/**
 * Generate 10 video nodes for the Nexus Protocol universe.
 *
 * Universe already exists in Firestore. This script:
 *   1. Authenticates via SIWE
 *   2. Generates 10 AI videos via server (Seedance 2.0)
 *   3. Uploads to storage
 *   4. Publishes to gallery
 *
 * Usage: pnpm tsx scripts/generate-nexus-videos.ts
 */
import dotenv from 'dotenv';
import path from 'path';
import { readFileSync } from 'fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAddress } from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// ── Config ───────────────────────────────────────────────────────────────────
const rawKey = process.env.PRIVATE_KEY ?? '';
const PRIVATE_KEY = (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as `0x${string}`;
const SERVER_URL = process.env.VITE_SERVER_URL ?? 'http://localhost:3000';
const account = privateKeyToAccount(PRIVATE_KEY);
const CREATOR_ADDRESS = getAddress(account.address);

const UNIVERSE_NAME = 'Nexus Protocol';
const UNIVERSE_ID = '0x0000000000000000000000000000019d9ab4ae0f';

// ── 10 Video Scenes ──────────────────────────────────────────────────────────
const VIDEO_SCENES = [
  {
    title: 'The Awakening',
    description:
      'Kael wakes up in a pod filled with liquid code, ripping free from cables that feed him simulated memories. The pod chamber stretches infinitely — millions of sleeping humans plugged into the Nexus.',
    prompt:
      'Cinematic sci-fi: A young man rips free from a pod filled with glowing green liquid in a vast dark chamber. Millions of identical pods stretch into infinity. Green Matrix-style digital rain cascades down invisible walls. Cables and tubes disconnect from his body. His eyes glow briefly with circuit patterns. Dramatic lighting, cyberpunk aesthetic, 4K cinematic quality, dark atmosphere with green bioluminescence.',
  },
  {
    title: 'The Blade Remembers',
    description:
      'Through genetic memory, Kael experiences his ancestor — a Master Architect performing impossible parkour between floating stone towers while assassinating a simulation lord with blades of compressed data.',
    prompt:
      'Cinematic action: A hooded assassin with glowing circuit tattoos performs acrobatic parkour between floating Renaissance stone towers in a cyberpunk city. His hidden blade glows with green digital energy, leaving trails of dissolving code. He leaps from a tower and performs a dramatic air assassination on a figure below. Gold and green color palette, ancient architecture meets holographic overlays, dramatic camera tracking shot, 4K cinematic.',
  },
  {
    title: 'Rise of the Autarchs',
    description:
      'On a planet-sized war factory, colossal machine-gods awaken. Solarius Prime unfolds from a dormant mountain into a being the size of a city, his chest reactor igniting with the power of a captured sun.',
    prompt:
      'Epic sci-fi: A colossal robot the size of a mountain transforms from dormant metal terrain, rising up with glowing orange chest reactor blazing like a sun. Thousands of smaller transforming robots activate around it on a metallic planet surface. Molten metal rivers flow between massive industrial structures. The sky is filled with orange energy and mechanical debris. Chrome, orange, and dark steel color palette. Ultra wide shot, dramatic scale, cinematic 4K, industrial war aesthetic.',
  },
  {
    title: 'The Force-Current Awakens',
    description:
      'In the Luminous Plane, Sera ignites her twin plasma sabers — one blue, one violet — and the entire nebula ripples with her power. A fleet of Luminari star cruisers powers up behind her.',
    prompt:
      'Cinematic space scene: A young woman in flowing white robes ignites twin plasma sabers — one electric blue, one deep violet — inside a crystalline temple floating in a colorful nebula. Energy ripples outward from her in concentric waves. Behind the temple, a fleet of elegant star cruisers with glowing blue engines powers up against the nebula backdrop. Crystal formations refract light everywhere. Blue, violet, and white color palette with cosmic backgrounds, cinematic 4K, ethereal lighting.',
  },
  {
    title: 'The Veil Speaks',
    description:
      'Rogue AIs manifest as towering holographic figures of pure mathematics. They offer Kael two pills. He crushes both and demands a third option. The Veil smiles for the first time in ten thousand years.',
    prompt:
      'Surreal cinematic: A young man stands before two massive holographic AI figures made of flowing mathematical equations and geometric patterns in a dark void. Two glowing pills float before him — one red, one blue — each radiating energy. He crushes both pills in his fists, light exploding outward. The AI figures expression shifts to surprise. Mathematical symbols and fractals fill the void. Green Matrix rain in the background, dramatic face lighting, 4K cinematic, philosophical atmosphere.',
  },
  {
    title: "Assassin's Eclipse",
    description:
      'Assassins leap between rooftops that phase between stone and wireframe in the Nexus version of Constantinople. As the lead assassin plunges her data-blade into a Control Node, the entire city glitches — everyone sees the truth.',
    prompt:
      'Epic action scene: Hooded assassins leap between rooftops of a grand Byzantine city that glitches between ancient stone and digital wireframe. A female assassin plunges a glowing green blade into the dome of a massive building. The entire city begins decompiling — buildings dissolving into streams of code, the sky cracking like broken glass revealing green digital void behind it. Citizens look up in shock. Gold, green, and white color palette, dramatic wide shot, cinematic 4K, reality-breaking visual effects.',
  },
  {
    title: 'Clash of Titans',
    description:
      'Solarius Prime leads the Autarch invasion into Luminari space. Sera redirects an entire missile volley with the Force-current. Solarius catches a star cruiser in his massive hand and crushes it.',
    prompt:
      'Epic space battle: Colossal transforming warships clash with elegant crystalline star cruisers in deep space near a nebula. A massive robot catches a cruiser in its hand. Beams of blue crystalline energy and orange plasma fire crisscross the battlefield. Ships transform mid-combat. Explosions and debris fill the frame. A woman stands on a bridge with hands raised, redirecting missiles with visible force energy. Blue and orange contrasting colors, epic scale, cinematic 4K, dramatic lighting.',
  },
  {
    title: 'The Four Realms Converge',
    description:
      'The Nexus collapses. Four realities bleed into each other. Kael stands at the convergence point, flickering between four versions of himself, each wielding a different weapon.',
    prompt:
      'Surreal cinematic convergence: Four distinct realities merge in a chaotic vortex. Renaissance stone architecture grows from chrome robot surfaces. Green digital code rains onto crystalline temples. Starships phase through ancient citadels. At the center, a young man flickers between four versions of himself — hooded assassin, glowing force wielder, chrome-armored mech pilot, and code-wreathed hacker. Massive dimensional rifts in the sky. All four color palettes blending, epic scale, 4K cinematic, reality-breaking VFX.',
  },
  {
    title: 'The Nexus Protocol Activates',
    description:
      'Kael IS the Nexus Protocol. Assassin blades of solidified code, Autarch armor, Force-current lightning from his eyes, Matrix knowledge flooding his mind. He rises above the battlefield — a being of four worlds united.',
    prompt:
      'Epic transformation scene: A young man levitates above a massive battlefield, his body transforming. Glowing circuit-blade weapons extend from his forearms. Chrome armor plates materialize across his torso. Blue-violet lightning crackles from his eyes. Green code streams orbit around him like a data hurricane. Below, four armies — hooded assassins, giant robots, crystal-armored warriors, and digital entities — all look up in awe. Golden light radiates from his chest. All four color palettes unified, godlike ascension, 4K cinematic, dramatic upward camera angle.',
  },
  {
    title: 'A New Reality',
    description:
      'Kael rewrites the Nexus. Code and stone, flesh and steel, force and data coexist. The camera pulls back to reveal this is one universe among infinite others in the LOAR multiverse.',
    prompt:
      'Grand cinematic finale: A young man stands atop a magnificent tower that seamlessly blends four architectural styles — ancient stone, chrome machinery, crystalline energy structures, and digital wireframe. Below, vast armies of diverse factions lay down weapons as golden light washes over the landscape. The camera pulls back dramatically to reveal the world is one glowing sphere among countless others in an infinite cosmic web — each sphere a different universe. Warm golden lighting, hopeful atmosphere, epic pullback shot, 4K cinematic, transcendent and peaceful.',
  },
];

function log(step: string, msg: string) {
  console.log(`  [${step}] ${msg}`);
}

// ── Auth ─────────────────────────────────────────────────────────────────────

function buildSiweMessage(params: { address: string; nonce: string; chainId: number }): string {
  const domain = new URL(SERVER_URL).hostname;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000);
  return [
    `${domain} wants you to sign in with your Ethereum account:`,
    params.address,
    '',
    'Sign in to LOAR',
    '',
    `URI: ${SERVER_URL}`,
    `Version: 1`,
    `Chain ID: ${params.chainId}`,
    `Nonce: ${params.nonce}`,
    `Issued At: ${now.toISOString()}`,
    `Expiration Time: ${expiresAt.toISOString()}`,
  ].join('\n');
}

async function getAuthToken(): Promise<string> {
  const nonceRes = await fetch(`${SERVER_URL}/auth/nonce`);
  if (!nonceRes.ok)
    throw new Error(`Nonce fetch failed: ${nonceRes.status} ${await nonceRes.text()}`);
  const { nonce } = (await nonceRes.json()) as { nonce: string };

  const siweMessage = buildSiweMessage({
    address: CREATOR_ADDRESS,
    nonce,
    chainId: sepolia.id,
  });
  const signature = await account.signMessage({ message: siweMessage });

  const verifyRes = await fetch(`${SERVER_URL}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: JSON.stringify({ message: siweMessage, signature }),
  });

  if (!verifyRes.ok) throw new Error(`Auth verify failed: ${await verifyRes.text()}`);

  const setCookie = verifyRes.headers.get('set-cookie') ?? '';
  const jwtMatch = setCookie.match(/siwe-session=([^;]+)/);
  if (!jwtMatch) throw new Error('No session token in verify response');
  return jwtMatch[1];
}

async function tRPCMutate<T>(procedure: string, input: unknown, token: string): Promise<T> {
  const url = `${SERVER_URL}/trpc/${procedure}?batch=1`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ '0': input }),
  });
  const json = (await res.json()) as any[];
  if (json[0]?.error) {
    throw new Error(`tRPC ${procedure}: ${JSON.stringify(json[0].error).slice(0, 500)}`);
  }
  return json[0]?.result?.data;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n' + '='.repeat(70));
  console.log('  LOAR — Nexus Protocol: Generate 10 Video Nodes');
  console.log('='.repeat(70));
  console.log(`  Creator:  ${CREATOR_ADDRESS}`);
  console.log(`  Universe: ${UNIVERSE_ID}`);
  console.log(`  Server:   ${SERVER_URL}\n`);

  // Init Firebase
  const saPathRaw = process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? './firebase-service-account.json';
  const saPath = path.resolve(process.cwd(), saPathRaw);
  const serviceAccount = JSON.parse(readFileSync(saPath, 'utf-8'));
  const app = initializeApp({ credential: cert(serviceAccount) }, 'nexus-videos-' + Date.now());
  const db = getFirestore(app);
  db.settings({ preferRest: true });

  // Ensure user has credits
  const userCreditsRef = db.collection('userCredits').doc(CREATOR_ADDRESS.toLowerCase());
  const userCreditsSnap = await userCreditsRef.get();
  if (!userCreditsSnap.exists) {
    await userCreditsRef.set({
      userId: CREATOR_ADDRESS.toLowerCase(),
      balance: 5000,
      totalPurchased: 5000,
      totalSpent: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    log('CREDITS', 'Seeded 5000 user credits');
  } else {
    const bal = userCreditsSnap.data()?.balance ?? 0;
    if (bal < 300) {
      await userCreditsRef.update({
        balance: FieldValue.increment(5000),
        totalPurchased: FieldValue.increment(5000),
        updatedAt: new Date(),
      });
      log('CREDITS', `Topped up 5000 credits (was ${bal})`);
    } else {
      log('CREDITS', `Balance: ${bal} credits`);
    }
  }

  // Authenticate
  log('AUTH', 'Authenticating via SIWE...');
  const authToken = await getAuthToken();
  log('AUTH', 'Authenticated');

  // Generate all 10 videos
  const videos: { title: string; videoUrl: string; storageUrl: string }[] = [];

  for (let i = 0; i < VIDEO_SCENES.length; i++) {
    const scene = VIDEO_SCENES[i];

    try {
      log(`VIDEO ${i + 1}/10`, `"${scene.title}" — generating...`);

      const result = await tRPCMutate<{ videoUrl: string }>(
        'generation.generateVideo',
        {
          prompt: scene.prompt,
          model: 'bytedance/seedance-2.0/fast/text-to-video',
          duration: 5,
          aspectRatio: '16:9',
        },
        authToken
      );

      log(`VIDEO ${i + 1}/10`, `Generated: ${result.videoUrl.slice(0, 70)}...`);

      // Upload to storage
      let storageUrl = result.videoUrl;
      try {
        const manifest = await tRPCMutate<{
          contentHash: string;
          uploads: { url: string; provider: string }[];
        }>(
          'storage.upload',
          {
            url: result.videoUrl,
            filename: `nexus-protocol-scene-${i + 1}-${Date.now()}.mp4`,
          },
          authToken
        );
        storageUrl = manifest.uploads[0]?.url || result.videoUrl;
        log(`UPLOAD ${i + 1}/10`, `Stored: ${storageUrl.slice(0, 70)}...`);
      } catch (uploadErr: any) {
        log(
          `UPLOAD ${i + 1}/10`,
          `Storage failed (keeping temp URL): ${uploadErr.message?.slice(0, 80)}`
        );
      }

      videos.push({ title: scene.title, videoUrl: result.videoUrl, storageUrl });

      // Publish to gallery
      const contentId = `nexus-${Date.now()}-${i}`;
      await db
        .collection('content')
        .doc(contentId)
        .set({
          id: contentId,
          type: 'video',
          title: scene.title,
          description: scene.description,
          creator: CREATOR_ADDRESS.toLowerCase(),
          universeId: UNIVERSE_ID,
          videoUrl: storageUrl,
          thumbnailUrl: null,
          contentStatus: 'active',
          metadata: {
            model: 'seedance-2.0-fast',
            duration: 5,
            aspectRatio: '16:9',
            universe: UNIVERSE_NAME,
            sceneIndex: i + 1,
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      log(`GALLERY ${i + 1}/10`, `Published "${scene.title}"`);
    } catch (err: any) {
      log(`VIDEO ${i + 1}/10`, `FAILED: ${err.message?.slice(0, 200)}`);
      videos.push({ title: scene.title, videoUrl: '', storageUrl: '' });
    }
  }

  // Summary
  const ok = videos.filter((v) => v.videoUrl).length;
  console.log('\n' + '='.repeat(70));
  console.log(`  COMPLETE — ${ok}/10 Videos Generated for Nexus Protocol`);
  console.log('='.repeat(70));
  console.log(`
  Videos:
${videos.map((v, i) => `    ${String(i + 1).padStart(2)}. "${v.title}" ${v.videoUrl ? 'OK' : 'FAILED'}${v.storageUrl ? `\n        ${v.storageUrl.slice(0, 80)}` : ''}`).join('\n')}

  View: http://localhost:5173/universe/${UNIVERSE_ID}
`);
}

main().catch((err) => {
  console.error('\nFAILED:', err.message ?? err);
  process.exit(1);
});
