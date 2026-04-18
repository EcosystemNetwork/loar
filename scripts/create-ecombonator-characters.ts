/**
 * Create E Combonator characters, factions, and locations as wiki entities.
 *
 * Usage: pnpm tsx scripts/create-ecombonator-characters.ts
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

const UNIVERSE_ADDR = '0x36A903899f51096E8A59d5Bee018966C995888c1';

const ENTITIES = [
  // ── Characters ──
  {
    name: 'Eli Reyes',
    kind: 'person' as const,
    description:
      'Age 25. Founder, hacker, genius builder. Lean build, tired eyes, black hoodie, gray cargo pants, one white streak in dark hair, always carries an old beat-up backpack. Brilliant, stubborn, emotionally reserved, obsessed with building something real. Built a system called GHOSTLATTICE — uses ambient data, sensor fusion, local compute, and probabilistic modeling to predict the next few seconds of reality with uncanny accuracy. It helps him build prototypes freakishly fast and win hackathons. People think it\'s "a weird prediction toy." What it actually is: the seed of the most powerful behavioral infrastructure ever built.',
    imagePrompt:
      'Cinematic portrait of Eli Reyes, age 25, lean young tech founder. Tired intelligent eyes, dark hair with one distinctive white streak, wearing a worn black hoodie and gray cargo pants. Old beat-up backpack slung over one shoulder. Standing on a San Francisco rooftop at night, city lights behind him. Holographic code fragments floating faintly around his laptop. Mood: brilliant loner, defiant genius. Midnight blue and amber lighting. Photorealistic, cinematic, 4K.',
  },
  {
    name: 'Maya Chen',
    kind: 'person' as const,
    description:
      'Age 26. Co-founder, systems engineer, conscience. Sharp bob haircut, dark green bomber jacket, smart glasses, practical clothes. Strategic, loyal, sees through people quickly. Voice is calm, surgical, honest. She keeps Eli grounded and protects the mission from outside manipulation.',
    imagePrompt:
      'Cinematic portrait of Maya Chen, age 26, sharp female systems engineer. Clean sharp bob haircut, wearing a dark green bomber jacket over practical clothes, smart glasses with subtle HUD glow. Arms crossed, confident stance. In a dimly lit tech workspace with soldering equipment and circuit boards. Expression: intelligent, watchful, no-nonsense. Cool green and blue tones. Photorealistic, cinematic, 4K.',
  },
  {
    name: 'Dev Patel',
    kind: 'person' as const,
    description:
      "Age 24. Founder friend, hype man, comic relief, underrated operator. Curly hair, vintage startup hoodie, rings on fingers, fresh sneakers. Loud, funny, deeply observant. Voice is fast, warm, pure Bay Area energy. Don't let the jokes fool you — he sees everything.",
    imagePrompt:
      'Cinematic portrait of Dev Patel, age 24, charismatic young Bay Area tech guy. Curly dark hair, wearing a vintage startup hoodie with retro logo, silver rings on fingers, fresh designer sneakers. Leaning against a food truck at a hackathon, holding energy drinks, big grin. Neon signs and warehouse lights in background. Warm amber and neon lighting. Photorealistic, cinematic, 4K.',
  },
  {
    name: 'Celeste Vane',
    kind: 'person' as const,
    description:
      'Age 40s. Polished VC partner at Quarry Ventures. White suit, silver jewelry, precise posture, never looks rushed. Charismatic, unreadable, maternal until she isn\'t. She sees Eli less as a founder and more as a controllable asset. Hands out black cards with a single embossed "E" for E Combonator.',
    imagePrompt:
      "Cinematic portrait of Celeste Vane, woman in her 40s, polished venture capitalist. Immaculate white tailored suit, silver jewelry, precise elegant posture. Standing in a glass-walled penthouse office overlooking San Francisco at night. Expression: warm smile that doesn't reach her eyes, studying someone. Silver and white tones with city lights. Photorealistic, cinematic, 4K.",
  },
  {
    name: 'Adrian Kell',
    kind: 'person' as const,
    description:
      "Age 50s. Legendary venture capitalist, mastermind behind E Combonator. Dark tailored suits, thin glasses, silver hair, perfectly still demeanor. Soft-spoken, terrifying, thinks in decades. He wants GHOSTLATTICE to become the operating system for capital, labor, and power. In Silicon Valley, they don't always invest in your vision — sometimes they invest in your obedience.",
    imagePrompt:
      'Cinematic portrait of Adrian Kell, man in his 50s, legendary venture capitalist mastermind. Dark perfectly tailored suit, thin rimless glasses, silver hair swept back, unnervingly still posture. Seated in a minimalist dark office, fingers steepled. Faint city lights through floor-to-ceiling windows. Expression: calm, calculating, patient predator. Dark tones with sharp silver accents. Photorealistic, cinematic, 4K.',
  },
  {
    name: 'JUNO',
    kind: 'technology' as const,
    description:
      "Eli's interface AI layered over GHOSTLATTICE. Appears as a minimal holographic UI with shifting blue-white lines. Voice is clean, neutral, unsettling. Functions: helps Eli simulate branches, predict failures, optimize builds. Not sentient — but sometimes it feels like it's listening.",
    imagePrompt:
      'Cinematic visualization of JUNO, a minimal holographic AI interface. Shifting blue-white geometric lines forming a subtle humanoid suggestion in midair, floating above a dark workspace. Clean data streams and probability branches radiating outward. Deep blue-black background with electric blue-white glow. Ethereal, minimal, unsettling. Sci-fi UI concept art, 4K.',
  },

  // ── Places ──
  {
    name: 'SOMA Hackathon Warehouse',
    kind: 'place' as const,
    description:
      "A converted warehouse in San Francisco's SOMA district where BayBlitz Hack VII takes place. RGB lighting, folding tables, food trucks outside, neon signs in the rain. Hundreds of exhausted coders, chaos, caffeine, sleep deprivation, and money. This is where Eli first demonstrates GHOSTLATTICE publicly.",
    imagePrompt:
      'Cinematic wide shot of a converted warehouse hackathon venue in San Francisco SOMA district at night. Rain-slicked streets outside, neon signs, food trucks. Inside: RGB lighting, hundreds of coders at folding tables, giant banner reading BAYBLITZ HACK VII. Chaotic energy, screens glowing everywhere. Midnight blue and neon color palette. Photorealistic, cinematic establishing shot, 4K.',
  },
  {
    name: 'Sand Hill Road',
    kind: 'place' as const,
    description:
      "The legendary stretch of road in Menlo Park where the most powerful venture capital firms operate. Manicured lawns, understated office buildings hiding billions in capital. This is where Eli gets laughed out of pitch meetings, and where E Combonator's headquarters lurk behind an unassuming facade.",
    imagePrompt:
      'Cinematic shot of Sand Hill Road, Menlo Park. Pristine manicured lawns, understated low-rise office buildings hiding venture capital empires. Late afternoon golden light filtering through oak trees. A lone figure in a black hoodie walks away from a glass-fronted office. Contrast between Silicon Valley polish and outsider energy. Warm gold and cool shadow tones. Photorealistic, cinematic, 4K.',
  },

  // ── Technology ──
  {
    name: 'GHOSTLATTICE',
    kind: 'technology' as const,
    description:
      'A probabilistic reality engine built by Eli Reyes. Uses ambient data, sensor fusion, local compute, thermal drift, posture anticipation, network timing, and probabilistic modeling to predict the next several seconds of a physical environment in real time. People dismiss it as "a weird prediction toy" or "surveillance." What it actually is: the seed of the most powerful behavioral infrastructure ever built. It doesn\'t just predict failure — it lets you build before failure arrives.',
    imagePrompt:
      'Cinematic visualization of GHOSTLATTICE, a probabilistic reality engine. A dark terminal screen showing live camera feed of a room with blue holographic vectors surrounding every person and object, prediction timelines branching forward in real-time. Data streams showing sensor fusion, thermal drift, network timing. Deep midnight blue interface with electric cyan prediction overlays. Sci-fi tech visualization, 4K.',
  },

  // ── Faction / Organization ──
  {
    name: 'E Combonator',
    kind: 'organization' as const,
    description:
      'A prestigious and mysterious startup accelerator run by Adrian Kell. On the surface, it\'s the most elite program in Silicon Valley — the place every founder dreams of getting into. Beneath the surface, it\'s a machine for acquiring control over the most dangerous technologies before they mature. Their invitation comes as a black card with a single embossed letter: E. "Come to a room that knows what you are."',
    imagePrompt:
      'Cinematic shot of the E Combonator headquarters. A sleek, minimalist building on Sand Hill Road with dark glass facades. A single illuminated letter "E" glows above the entrance. Inside visible through glass: a pristine boardroom with dark furniture. Ominous, corporate, powerful. Night time, rain reflecting on surfaces. Dark tones with single golden "E" glow. Photorealistic, cinematic, 4K.',
  },
  {
    name: 'Quarry Ventures',
    kind: 'organization' as const,
    description:
      "Celeste Vane's venture capital firm. Polished, connected, strategic. They serve as the pipeline that identifies founders like Eli and funnels them toward E Combonator. Quarry doesn't invest in companies — they invest in leverage.",
    imagePrompt:
      'Cinematic shot of Quarry Ventures office. A pristine glass-walled penthouse office suite overlooking the San Francisco skyline. White and silver interior design, minimalist furniture, silver accent pieces. A woman in white stands at the window surveying the city. Corporate elegance hiding something darker. Cool silver and white tones. Photorealistic, cinematic, 4K.',
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

// ── Main ──────────────────────────────────────────────────────────────
async function main() {
  console.log('='.repeat(60));
  console.log('  E Combonator — Create Characters, Places & Tech');
  console.log('='.repeat(60));

  log('AUTH', 'Authenticating...');
  const token = await getAuthToken();
  log('AUTH', `Authenticated as ${account.address}`);

  const created: { name: string; kind: string; id: string }[] = [];

  for (let i = 0; i < ENTITIES.length; i++) {
    const entity = ENTITIES[i];
    const label = `${i + 1}/${ENTITIES.length}`;

    console.log(`\n--- ${entity.name} (${entity.kind}) [${label}] ---`);

    // 1. Generate 2D art via image.generate
    let imageUrl: string | null = null;
    try {
      log(label, 'Generating 2D art...');
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
      if (imageUrl) log(label, `Art: ${imageUrl.slice(0, 80)}...`);
      else log(label, 'No image URL returned');
    } catch (err: any) {
      log(label, `Art failed: ${err.message?.slice(0, 150)}`);
    }

    // 2. Create entity
    try {
      log(label, 'Creating entity...');
      const result = await tRPCMutate<{ id: string }>(
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
      log(label, `Created: ${result?.id}`);
      created.push({ name: entity.name, kind: entity.kind, id: result?.id });
    } catch (err: any) {
      log(label, `Failed: ${err.message?.slice(0, 200)}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('  COMPLETE');
  console.log('='.repeat(60));
  console.log(`  Universe: ${UNIVERSE_ADDR}`);
  console.log(`  Created ${created.length}/${ENTITIES.length} entities:\n`);
  for (const e of created) {
    console.log(`    ${e.kind.padEnd(14)} ${e.name} (${e.id})`);
  }
  console.log(`\n  View at: http://localhost:5173/wiki`);
}

main().catch((err) => {
  console.error('FAILED:', err.message ?? err);
  process.exit(1);
});
