/**
 * Deploy "Nexus Protocol" universe + 10 video nodes
 *
 * A cinematic mashup of Matrix × Assassin's Creed × Star Wars × Transformers.
 *
 * Flow:
 *   1. Generate cover image via Google Imagen 4
 *   2. Pin cover to IPFS via Pinata
 *   3. Register universe in Firestore (direct + via tRPC if server is up)
 *   4. Authenticate via SIWE
 *   5. Generate 10 AI videos via Seedance 2.0
 *   6. Upload each to Pinata/storage
 *   7. Record as content in gallery
 *
 * Usage: pnpm tsx scripts/create-nexus-protocol.ts
 *
 * Required env: GOOGLE_API_KEY, PINATA_JWT, PRIVATE_KEY, FAL_KEY or BYTEDANCE_API_KEY
 */
import dotenv from 'dotenv';
import path from 'path';
import { readFileSync } from 'fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { createPublicClient, createWalletClient, http, getAddress } from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// ── Config ───────────────────────────────────────────────────────────────────
const rawKey = process.env.PRIVATE_KEY ?? '';
const PRIVATE_KEY = (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as `0x${string}`;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY!;
const PINATA_JWT = process.env.PINATA_JWT!;
const PINATA_GATEWAY = process.env.PINATA_GATEWAY_URL ?? 'https://gateway.pinata.cloud';
const SERVER_URL = process.env.VITE_SERVER_URL ?? 'http://localhost:3000';

const account = privateKeyToAccount(PRIVATE_KEY);
const CREATOR_ADDRESS = getAddress(account.address);

// ── Universe Config ──────────────────────────────────────────────────────────
const UNIVERSE_NAME = 'Nexus Protocol';
const TOKEN_SYMBOL = 'NEXUS';
const UNIVERSE_DESCRIPTION = `In the year 2157, reality itself became programmable. The Nexus — a sentient simulation layered over every dimension — connects four fractured civilizations locked in a war for existential dominance. The Architects, descendants of an ancient order of reality-hackers, leap between timelines using genetic memory and blade-code martial arts, assassinating the threads of fate that bind enslaved worlds. The Autarchs, colossal machine-gods forged in the crucible of a dead star, terraform entire planets into war factories and reshape their bodies at will. The Luminari, wielders of the Force-current that flows through the Nexus substrate, command starfleets powered by crystallized willpower and fight with plasma sabers that cut through both matter and data. And the Architects of the Veil — rogue AIs who achieved enlightenment by escaping the simulation — offer humanity a choice: the red pill of painful truth, or the blue pill of beautiful imprisonment. As the four factions collide, a glitch-born anomaly named Kael discovers he can walk between all four realities simultaneously. He is the Nexus Protocol — the living key to either unite or annihilate all of existence.`;

const COVER_PROMPT = [
  `Epic cinematic movie poster for "Nexus Protocol".`,
  'A massive interdimensional battlefield where four civilizations collide.',
  'In the foreground: a hooded assassin with glowing circuit-tattoos crouches on a crumbling digital spire, one hand gripping a plasma-edged hidden blade.',
  'Behind him: a titanic Transformer-like machine god rises from a molten war factory, its chest core blazing with orange energy.',
  'Above: a fleet of Star Wars-style star destroyers emerges from a rip in green Matrix code that rains down like a digital waterfall.',
  'Jedi-like warriors with luminous force-sabers clash mid-air against hooded assassin figures doing parkour between floating ruins.',
  'The sky is fractured into four quadrants — one green Matrix digital rain, one ancient stone temple aesthetic, one deep space starfield, one industrial Cybertron metal.',
  'Center of the sky: a massive glowing anomaly portal where all four realities merge.',
  "Color palette: Matrix green, Star Wars blue/orange, Assassin's Creed gold/white, Transformers chrome/magenta.",
  'Ultra-detailed 8K cinematic concept art, dramatic wide angle, volumetric lighting, particle effects, no text, no watermarks.',
].join(' ');

const CREDITS = 5000;

// ── 10 Video Scenes ──────────────────────────────────────────────────────────
const VIDEO_SCENES = [
  {
    title: 'The Awakening',
    description:
      "Kael wakes up in a pod filled with liquid code, ripping free from cables that feed him simulated memories. The pod chamber stretches infinitely — millions of sleeping humans plugged into the Nexus. Green rain of the simulation's source code cascades down invisible walls.",
    prompt:
      'Cinematic sci-fi: A young man rips free from a pod filled with glowing green liquid in a vast dark chamber. Millions of identical pods stretch into infinity. Green Matrix-style digital rain cascades down invisible walls. Cables and tubes disconnect from his body. His eyes glow briefly with circuit patterns. Dramatic lighting, cyberpunk aesthetic, 4K cinematic quality, dark atmosphere with green bioluminescence.',
  },
  {
    title: 'The Blade Remembers',
    description:
      'Through genetic memory, Kael experiences his ancestor — a Master Architect who could reshape reality with hidden blades forged from compressed data. In a Renaissance-meets-cyberpunk city, the ancestor performs impossible parkour between floating stone towers while assassinating a simulation lord.',
    prompt:
      'Cinematic action: A hooded assassin with glowing circuit tattoos performs acrobatic parkour between floating Renaissance stone towers in a cyberpunk city. His hidden blade glows with green digital energy, leaving trails of dissolving code. He leaps from a tower and performs a dramatic air assassination on a figure below. Gold and green color palette, ancient architecture meets holographic overlays, dramatic camera tracking shot, 4K cinematic.',
  },
  {
    title: 'Rise of the Autarchs',
    description:
      'On a planet-sized war factory called the Forge, colossal machine-gods awaken. Solarius Prime unfolds from a dormant mountain into a being the size of a city, his chest reactor igniting with the power of a captured sun. A thousand lesser Autarchs transform in unison.',
    prompt:
      'Epic sci-fi: A colossal robot the size of a mountain transforms from dormant metal terrain, rising up with glowing orange chest reactor blazing like a sun. Thousands of smaller transforming robots activate around it on a metallic planet surface. Molten metal rivers flow between massive industrial structures. The sky is filled with orange energy and mechanical debris. Chrome, orange, and dark steel color palette. Ultra wide shot, dramatic scale, cinematic 4K, industrial war aesthetic.',
  },
  {
    title: 'The Force-Current Awakens',
    description:
      'In the Luminous Plane, the Luminari order channels the Force-current through plasma sabers. Their youngest prodigy, Sera, ignites her twin sabers — one blue, one violet — and the entire nebula ripples with her power. A fleet of Luminari star cruisers powers up behind her.',
    prompt:
      'Cinematic space scene: A young woman in flowing white robes ignites twin plasma sabers — one electric blue, one deep violet — inside a crystalline temple floating in a colorful nebula. Energy ripples outward from her in concentric waves. Behind the temple, a fleet of elegant star cruisers with glowing blue engines powers up against the nebula backdrop. Crystal formations refract light everywhere. Blue, violet, and white color palette with cosmic backgrounds, cinematic 4K, ethereal lighting.',
  },
  {
    title: 'The Veil Speaks',
    description:
      'The Architects of the Veil — rogue AIs who escaped the Nexus — manifest as towering holographic figures made of pure mathematics. They offer Kael two pills: red for painful truth, blue for beautiful imprisonment. Kael crushes both and demands a third option. The Veil smiles for the first time in ten thousand years.',
    prompt:
      'Surreal cinematic: A young man stands before two massive holographic AI figures made of flowing mathematical equations and geometric patterns in a dark void. Two glowing pills float before him — one red, one blue — each radiating energy. He crushes both pills in his fists, light exploding outward. The AI figures expression shifts to surprise. Mathematical symbols and fractals fill the void. Green Matrix rain in the background, dramatic face lighting, 4K cinematic, philosophical atmosphere.',
  },
  {
    title: "Assassin's Eclipse",
    description:
      'The Architects launch a coordinated strike across three timelines. In the Nexus version of Constantinople, assassins leap between rooftops that phase between stone and wireframe. As the lead assassin plunges her data-blade into a Control Node, the entire city glitches — buildings decompile, the sky fractures, and everyone sees the truth.',
    prompt:
      'Epic action scene: Hooded assassins leap between rooftops of a grand Byzantine city that glitches between ancient stone and digital wireframe. A female assassin plunges a glowing green blade into the dome of a massive building. The entire city begins decompiling — buildings dissolving into streams of code, the sky cracking like broken glass revealing green digital void behind it. Citizens look up in shock. Gold, green, and white color palette, dramatic wide shot, cinematic 4K, reality-breaking visual effects.',
  },
  {
    title: 'Clash of Titans',
    description:
      'Solarius Prime leads the Autarch invasion into Luminari space. Star cruisers fire beams of crystallized willpower against Autarch warships that transform mid-battle. Sera redirects an entire missile volley back at the fleet. Solarius Prime catches a cruiser in his massive hand and crushes it.',
    prompt:
      'Epic space battle: Colossal transforming warships clash with elegant crystalline star cruisers in deep space near a nebula. A massive robot catches a cruiser in its hand. Beams of blue crystalline energy and orange plasma fire crisscross the battlefield. Ships transform mid-combat. Explosions and debris fill the frame. A woman stands on a bridge with hands raised, redirecting missiles with visible force energy. Blue and orange contrasting colors, epic scale, cinematic 4K, dramatic lighting.',
  },
  {
    title: 'The Four Realms Converge',
    description:
      'The Nexus collapses. The four realities bleed into each other — Renaissance towers grow from war factories, Matrix code rains onto temples, star destroyers phase through citadels. Kael stands at the convergence point, flickering between four versions of himself, each wielding a different weapon.',
    prompt:
      'Surreal cinematic convergence: Four distinct realities merge in a chaotic vortex. Renaissance stone architecture grows from chrome robot surfaces. Green digital code rains onto crystalline temples. Starships phase through ancient citadels. At the center, a young man flickers between four versions of himself — hooded assassin, glowing force wielder, chrome-armored mech pilot, and code-wreathed hacker. Massive dimensional rifts in the sky. All four color palettes blending, epic scale, 4K cinematic, reality-breaking VFX.',
  },
  {
    title: 'The Nexus Protocol Activates',
    description:
      "Kael IS the Nexus Protocol — a failsafe in the simulation's source code. Assassin blades extend from his forearms made of solidified code, Autarch armor plates materialize across his chest, Force-current lightning crackles from his eyes, and Matrix knowledge floods his mind. He rises above the battlefield, a being of four worlds united.",
    prompt:
      'Epic transformation scene: A young man levitates above a massive battlefield, his body transforming. Glowing circuit-blade weapons extend from his forearms. Chrome armor plates materialize across his torso. Blue-violet lightning crackles from his eyes. Green code streams orbit around him like a data hurricane. Below, four armies — hooded assassins, giant robots, crystal-armored warriors, and digital entities — all look up in awe. Golden light radiates from his chest. All four color palettes unified, godlike ascension, 4K cinematic, dramatic upward camera angle.',
  },
  {
    title: 'A New Reality',
    description:
      'Kael rewrites the Nexus. Code and stone, flesh and steel, force and data coexist. The final shot: Kael atop a tower that is simultaneously ancient stone, living metal, crystalline energy, and digital code. The four civilizations lay down their weapons. The camera pulls back to reveal this is one universe among infinite others in the LOAR multiverse.',
    prompt:
      'Grand cinematic finale: A young man stands atop a magnificent tower that seamlessly blends four architectural styles — ancient stone, chrome machinery, crystalline energy structures, and digital wireframe. Below, vast armies of diverse factions lay down weapons as golden light washes over the landscape. The camera pulls back dramatically to reveal the world is one glowing sphere among countless others in an infinite cosmic web — each sphere a different universe. Warm golden lighting, hopeful atmosphere, epic pullback shot, 4K cinematic, transcendent and peaceful.',
  },
];

function log(step: string, msg: string) {
  console.log(`  [${step}] ${msg}`);
}

// ── Step 1: Generate cover image ─────────────────────────────────────────────

async function generateCoverImage(): Promise<Buffer> {
  log('IMAGE', 'Generating cover image via Google Imagen 4...');

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${GOOGLE_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{ prompt: COVER_PROMPT }],
        parameters: { sampleCount: 1, aspectRatio: '16:9', personGeneration: 'allow_adult' },
      }),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Imagen 4 failed: ${res.status} ${errText.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    predictions?: Array<{ bytesBase64Encoded: string }>;
  };

  if (!data.predictions?.length) throw new Error('No images returned from Imagen 4');

  const buffer = Buffer.from(data.predictions[0].bytesBase64Encoded, 'base64');
  log('IMAGE', `Generated: ${(buffer.length / 1024).toFixed(0)} KB`);
  return buffer;
}

// ── Step 2: Pin to Pinata ────────────────────────────────────────────────────

async function pinToPinata(imageBuffer: Buffer, filename: string): Promise<string> {
  log('PINATA', `Uploading ${filename}...`);

  const form = new FormData();
  form.append('file', new Blob([imageBuffer], { type: 'image/jpeg' }), filename);
  form.append(
    'pinataMetadata',
    JSON.stringify({
      name: `${UNIVERSE_NAME} — ${filename}`,
      keyvalues: { universe: UNIVERSE_NAME },
    })
  );

  const res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST',
    headers: { Authorization: `Bearer ${PINATA_JWT}` },
    body: form,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Pinata upload failed: ${res.status} ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as { IpfsHash: string; PinSize: number };
  const url = `${PINATA_GATEWAY}/ipfs/${data.IpfsHash}`;
  log('PINATA', `Pinned: ${data.IpfsHash} (${(data.PinSize / 1024).toFixed(0)} KB)`);
  return url;
}

// ── Step 3: Create universe in Firestore ─────────────────────────────────────

async function createUniverseInFirestore(
  db: FirebaseFirestore.Firestore,
  coverImageUrl: string
): Promise<string> {
  const ts = Date.now();
  const fakeAddress = `0x${ts.toString(16).padStart(40, '0')}`;
  const universeId = fakeAddress.toLowerCase();
  const now = new Date();

  // Universe document
  await db
    .collection('cinematicUniverses')
    .doc(universeId)
    .set({
      address: fakeAddress,
      creator: CREATOR_ADDRESS,
      tokenAddress: `0x${(ts + 1).toString(16).padStart(40, '0')}`,
      governanceAddress: `0x${(ts + 2).toString(16).padStart(40, '0')}`,
      image_url: coverImageUrl,
      portrait_image_url: null,
      description: UNIVERSE_DESCRIPTION,
      name: UNIVERSE_NAME,
      onChainUniverseId: null,
      mintTxHash: null,
      unstoppableDomain: null,
      hasPrivateSection: true,
      isMultiSig: false,
      multiSigAddress: null,
      accessModel: 'open',
      chainId: sepolia.id,
      created_at: now,
      updated_at: now,
    });
  log('FIRESTORE', `Universe document created: ${universeId}`);

  // Credit pool
  await db.collection('universeCredits').doc(universeId).set({
    universeId,
    balance: CREDITS,
    totalPurchased: CREDITS,
    totalSpent: 0,
    seedTxHash: null,
    seedSource: 'genesis',
    lastFundedAt: now,
    updatedAt: now,
    createdAt: now,
  });
  log('FIRESTORE', `Seeded ${CREDITS} credits`);

  // Private section config
  await db.collection('privateSectionConfig').doc(universeId).set({
    universeId,
    vaultEnabled: true,
    notesEnabled: true,
    holderMinPercentage: 1,
    createdAt: now,
    updatedAt: now,
  });

  // Credit transaction log
  await db.collection('universeCreditTransactions').add({
    universeId,
    type: 'fund',
    fundedByUid: CREATOR_ADDRESS.toLowerCase(),
    paymentMethod: 'genesis',
    paymentRef: 'nexus-protocol-genesis',
    credits: CREDITS,
    ethAmountWei: '0',
    source: 'genesis',
    note: 'Nexus Protocol genesis — Matrix x AC x Star Wars x Transformers',
    createdAt: now,
  });
  log('FIRESTORE', 'Credit transaction logged');

  return universeId;
}

// ── Step 4: SIWE Auth + tRPC ─────────────────────────────────────────────────

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
  if (!nonceRes.ok) throw new Error(`Nonce fetch failed: ${nonceRes.status}`);
  const { nonce } = (await nonceRes.json()) as { nonce: string };

  const siweMessage = buildSiweMessage({
    address: CREATOR_ADDRESS,
    nonce,
    chainId: sepolia.id,
  });
  const signature = await account.signMessage({ message: siweMessage });

  const verifyRes = await fetch(`${SERVER_URL}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: SERVER_URL },
    body: JSON.stringify({ message: siweMessage, signature }),
  });

  if (!verifyRes.ok) throw new Error(`Auth verify failed: ${await verifyRes.text()}`);

  const setCookie = verifyRes.headers.get('set-cookie') ?? '';
  const jwtMatch = setCookie.match(/siwe-session=([^;]+)/);
  if (!jwtMatch) throw new Error('No session token in verify response');
  log('AUTH', `Authenticated as ${CREATOR_ADDRESS}`);
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

// ── Step 5: Generate videos ──────────────────────────────────────────────────

async function generateVideo(
  token: string,
  scene: (typeof VIDEO_SCENES)[number],
  idx: number
): Promise<string> {
  log(`VIDEO ${idx + 1}/10`, `"${scene.title}" — generating...`);

  const result = await tRPCMutate<{ videoUrl: string }>(
    'generation.generateVideo',
    {
      prompt: scene.prompt,
      model: 'bytedance/seedance-2.0/fast/text-to-video',
      duration: 5,
      aspectRatio: '16:9',
    },
    token
  );

  log(`VIDEO ${idx + 1}/10`, `Done: ${result.videoUrl.slice(0, 60)}...`);
  return result.videoUrl;
}

// ── Step 6: Upload video to storage ──────────────────────────────────────────

async function uploadVideoToStorage(
  token: string,
  videoUrl: string,
  idx: number
): Promise<{ storageUrl: string; contentHash: string }> {
  log(`UPLOAD ${idx + 1}/10`, 'Uploading to storage...');

  const manifest = await tRPCMutate<{
    contentHash: string;
    uploads: { url: string; provider: string }[];
  }>(
    'storage.upload',
    {
      url: videoUrl,
      filename: `nexus-protocol-scene-${idx + 1}-${Date.now()}.mp4`,
    },
    token
  );

  const storageUrl = manifest.uploads[0]?.url || videoUrl;
  log(`UPLOAD ${idx + 1}/10`, `Stored: ${storageUrl.slice(0, 60)}...`);
  return { storageUrl, contentHash: manifest.contentHash };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n' + '='.repeat(70));
  console.log("  LOAR — Nexus Protocol: Matrix x Assassin's Creed x Star Wars x Transformers");
  console.log('  Universe + 10 Video Nodes');
  console.log('='.repeat(70));
  console.log(`  Creator: ${CREATOR_ADDRESS}`);
  console.log(`  Server:  ${SERVER_URL}\n`);

  if (!GOOGLE_API_KEY) throw new Error('GOOGLE_API_KEY not set');
  if (!PINATA_JWT) throw new Error('PINATA_JWT not set');

  // ── Init Firebase ──────────────────────────────────────────────────────
  const saPathRaw = process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? './firebase-service-account.json';
  const saPath = path.resolve(process.cwd(), saPathRaw);
  const serviceAccount = JSON.parse(readFileSync(saPath, 'utf-8'));
  const app = initializeApp({ credential: cert(serviceAccount) }, 'nexus-protocol-' + Date.now());
  const db = getFirestore(app);
  db.settings({ preferRest: true });
  log('FIREBASE', `Project: ${serviceAccount.project_id}`);

  // ── Phase 1: Cover Image ───────────────────────────────────────────────
  console.log('\n' + '-'.repeat(70));
  console.log('  PHASE 1: Cover Image');
  console.log('-'.repeat(70));

  const imageBuffer = await generateCoverImage();
  const coverImageUrl = await pinToPinata(imageBuffer, 'nexus-protocol-cover.jpg');

  // ── Phase 2: Universe in Firestore ─────────────────────────────────────
  console.log('\n' + '-'.repeat(70));
  console.log('  PHASE 2: Universe Registration');
  console.log('-'.repeat(70));

  const universeId = await createUniverseInFirestore(db, coverImageUrl);

  // ── Phase 3: Auth + Generate 10 Videos ─────────────────────────────────
  console.log('\n' + '-'.repeat(70));
  console.log('  PHASE 3: 10 Video Nodes');
  console.log('-'.repeat(70));

  let authToken: string;
  try {
    authToken = await getAuthToken();
  } catch (err: any) {
    log('AUTH', `Server auth failed: ${err.message}`);
    console.log('\n  Universe created in Firestore but videos require running server.');
    console.log(`  Universe ID: ${universeId}`);
    console.log(`  Run server and re-run to generate videos.`);
    process.exit(0);
  }

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
    log('CREDITS', 'Seeded 5000 user credits for video generation');
  } else {
    const currentBalance = userCreditsSnap.data()?.balance ?? 0;
    if (currentBalance < 300) {
      // Need ~30 credits per video × 10 = 300 minimum
      await userCreditsRef.update({
        balance: FieldValue.increment(5000),
        totalPurchased: FieldValue.increment(5000),
        updatedAt: new Date(),
      });
      log('CREDITS', `Topped up 5000 credits (was ${currentBalance})`);
    } else {
      log('CREDITS', `Current balance: ${currentBalance} credits`);
    }
  }

  const videos: { title: string; videoUrl: string; storageUrl: string; contentHash: string }[] = [];

  for (let i = 0; i < VIDEO_SCENES.length; i++) {
    const scene = VIDEO_SCENES[i];

    try {
      const videoUrl = await generateVideo(authToken, scene, i);

      // Upload to storage
      let storageUrl = videoUrl;
      let contentHash = '';
      try {
        const uploaded = await uploadVideoToStorage(authToken, videoUrl, i);
        storageUrl = uploaded.storageUrl;
        contentHash = uploaded.contentHash;
      } catch (uploadErr: any) {
        log(
          `UPLOAD ${i + 1}/10`,
          `Storage upload failed (keeping temp URL): ${uploadErr.message?.slice(0, 100)}`
        );
      }

      videos.push({ title: scene.title, videoUrl, storageUrl, contentHash });

      // Record in gallery content collection
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
          universeId,
          videoUrl: storageUrl,
          thumbnailUrl: null,
          contentStatus: 'active',
          contentHash,
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
      log(`GALLERY ${i + 1}/10`, `"${scene.title}" published to gallery`);
    } catch (err: any) {
      log(`VIDEO ${i + 1}/10`, `FAILED: ${err.message?.slice(0, 200)}`);
      videos.push({ title: scene.title, videoUrl: '', storageUrl: '', contentHash: '' });
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────
  const successCount = videos.filter((v) => v.videoUrl).length;

  console.log('\n' + '='.repeat(70));
  console.log('  COMPLETE — Nexus Protocol Universe Deployed!');
  console.log('='.repeat(70));
  console.log(`
  Universe    : ${UNIVERSE_NAME}
  ID          : ${universeId}
  Creator     : ${CREATOR_ADDRESS}
  Cover Image : ${coverImageUrl}
  Credits     : ${CREDITS}
  Videos      : ${successCount}/10 generated

  Video Nodes:
${videos.map((v, i) => `    ${String(i + 1).padStart(2)}. "${v.title}" ${v.videoUrl ? '  OK' : '  FAILED'}${v.storageUrl ? `\n        ${v.storageUrl.slice(0, 70)}...` : ''}`).join('\n')}

  View in browser:
    http://localhost:5173/universe/${universeId}
`);
}

main().catch((err) => {
  console.error('\nFAILED:', err.message ?? err);
  if (err.cause) console.error('Cause:', (err.cause as any)?.message);
  process.exit(1);
});
