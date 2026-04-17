/**
 * CYBER WAR Film — Wiki Setup
 *
 * Creates all characters, factions, and locations from the screenplay
 * as wiki entities under the Cyber War universe, with 2D reference art.
 *
 * Usage: pnpm tsx scripts/cyberwar-film-setup.ts
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
const UNIVERSE = '0x341fFa19c0EC8D2C8eF42A360cf799949844262e';

// ── CHARACTERS ────────────────────────────────────────────────────────
const ENTITIES = [
  {
    name: 'Nova Reyes',
    kind: 'person' as const,
    description:
      "Age 23. Main protagonist, hacker-warrior. Brown skin, silver braided undercut, glowing blue circuit tattoo over left eye, black tactical jacket with neon cyan seams, fingerless gloves. Calm under pressure, sharp, emotionally guarded, brave. Confident low direct voice. Carries a thin plasma blade glowing cyan. Her mother built the first version of Echo. Nova's neural pattern is compatible with the War Core because her mother used her own mind as the template.",
    imagePrompt:
      'Full-body character design sheet of Nova Reyes, a 23-year-old female cyberpunk hacker-warrior. Brown skin, silver braided undercut hairstyle, glowing blue circuit tattoo over her left eye, wearing a black tactical jacket with neon cyan seam lines, fingerless gloves. She holds a thin glowing cyan plasma blade. Confident determined stance. Dark cyberpunk background with faint neon rain. Character reference sheet style, multiple angles, 4K cinematic quality.',
  },
  {
    name: 'Orin Vale',
    kind: 'person' as const,
    description:
      "Age 27. Ex-military pilot, Nova's partner. Tall, dark skin, shaved head, cybernetic right arm with red light strips, charcoal armor vest, long gray coat. Loyal, skeptical, protective, dry humor. Grounded strong slightly rough voice. Carries a plasma rifle. Was reported dead three years ago. His cybernetic arm can lock onto and tear apart machinery.",
    imagePrompt:
      'Full-body character design sheet of Orin Vale, a 27-year-old tall male ex-military cyberpunk pilot. Dark skin, shaved head, cybernetic right arm with glowing red light strips along the forearm, wearing a charcoal armor vest over tactical gear and a long gray coat. Holding a plasma rifle. Stoic protective stance. Dark cyberpunk background. Character reference sheet style, multiple angles, 4K cinematic quality.',
  },
  {
    name: 'Echo (AI Construct)',
    kind: 'person' as const,
    description:
      'Appears age 16. Childlike AI construct, digital key to the war network. Holographic girl with white bob-cut hair, glowing violet eyes, transparent body filled with moving code fragments. Curious, innocent, increasingly self-aware. Soft precise eerie but gentle voice. She can phase into digital systems, create holographic copies of herself, blind drone optics, and ultimately merge with the War Core. She chooses to sacrifice herself to destroy the war network, making herself "impossible to own."',
    imagePrompt:
      'Full-body character design sheet of Echo, a childlike AI holographic construct appearing age 16. White bob-cut hair, glowing violet eyes, transparent semi-translucent body filled with moving code fragments and data streams. Ethereal floating pose, gentle curious expression. Soft violet and white glow against dark digital void background. Holographic digital ghost aesthetic, character reference sheet style, 4K quality.',
  },
  {
    name: 'Commander Drake Voss',
    kind: 'person' as const,
    description:
      "Age 50s. Antagonist, leader of the Dominion Grid. Pale angular face, long white coat with black armor underneath, red cybernetic spine visible through transparent back plating. Cold, persuasive, obsessed with order. Controlled elegant threatening voice. Carries an energy staff drawn from his arm plating. He knew Nova's mother and believes freedom without order becomes extinction. He wants to use Echo to rewrite human choice and eliminate suffering through total control.",
    imagePrompt:
      'Full-body character design sheet of Commander Drake Voss, a man in his 50s, cyberpunk antagonist and military leader. Pale angular face with sharp features, wearing a long white coat over black armor, red cybernetic spine glowing and visible through transparent back plating. Cold calculating expression. Standing with authority. Dark ominous background with red accent lighting. Villain character reference sheet style, multiple angles, 4K cinematic quality.',
  },

  // ── FACTION ──
  {
    name: 'The Dominion Grid',
    kind: 'faction' as const,
    description:
      'The authoritarian network-state that controls the megacity in 2149. Led by Commander Drake Voss, the Dominion Grid believes that humanity\'s chaos can only be solved by machine-enforced order. They control the War Core — a massive red glowing sphere of code that powers their war network, drone armies, and surveillance systems. Their soldiers wear black armor, their drones patrol the skies, and their floating ring structure pulses red over the central black tower. Their motto: "The Network is the Nation."',
    imagePrompt:
      'Faction emblem and key art for the Dominion Grid. A massive floating red ring structure over a black tower, surrounded by patrol drones and holographic surveillance screens. Black-armored soldiers in formation. Red and black color palette with chrome accents. Authoritarian cyberpunk military aesthetic, propaganda poster style, 4K quality.',
  },

  // ── LOCATIONS ──
  {
    name: 'Megacity 2149',
    kind: 'place' as const,
    description:
      'A sprawling neon metropolis stretching to the horizon in the year 2149. Holograms flicker through rain. Massive drones patrol above skyscrapers. In the center, an enormous floating ring pulses red over a black tower — the Dominion Grid headquarters. Digital billboards glitch with propaganda. The undercity below is a maze of hidden bunkers and resistance safehouses. After the war network falls, the city goes quiet for the first time — no drones, no ad-swarms, no sirens — and people emerge into streets under a sky no longer owned by machines.',
    imagePrompt:
      'Panoramic establishing shot of a sprawling neon cyberpunk megacity at night, year 2149. Massive skyscrapers with holographic advertisements, rain falling through neon light. Huge patrol drones flying between buildings. In the center, an enormous floating red ring structure pulses above a black tower. Digital billboards glitching. Deep blue, neon cyan, and red color palette. Epic wide-angle cinematic establishing shot, 4K quality.',
  },
  {
    name: 'Undercity Safehouse',
    kind: 'place' as const,
    description:
      'A hidden resistance bunker beneath the megacity. Filled with screens, cables, salvaged tech, and flickering blue light. This is where Nova and Orin plan their missions. A central holographic table displays tactical projections. The walls are lined with weapon racks and hacking terminals. Alarm lights pulse softly when Dominion forces are detected above. The blue lighting gives the space an intimate, tense atmosphere.',
    imagePrompt:
      'Interior of a cyberpunk underground resistance bunker. Screens covering the walls showing code and maps, exposed cables, salvaged tech equipment, flickering blue light illuminating the space. A central holographic table projecting a 3D map of a tower. Weapon racks on walls. Intimate tense atmosphere. Blue and cyan lighting. Cyberpunk safehouse interior, cinematic wide shot, 4K quality.',
  },
  {
    name: 'The Dominion Tower',
    kind: 'place' as const,
    description:
      'The central black tower of the Dominion Grid, crowned by the enormous floating red ring. Inside, vertical maintenance shafts lit by red strips lead up to the Core Chamber. Black-armored soldiers guard every level. The tower is a cathedral of machines — part military installation, part digital temple. Red lightning crawls around its exterior. At its heart lies the War Core.',
    imagePrompt:
      'Exterior and interior of the Dominion Tower. A massive black cyberpunk skyscraper with a floating red ring pulsing at its crown. Red lightning crawling across its surface. Interior shows dark corridors lit by red strip lights, mechanical tendrils on walls, cathedral-like scale. Ominous authoritarian architecture. Red and black palette. Cinematic establishing shot, 4K quality.',
  },
  {
    name: 'The War Core Chamber',
    kind: 'place' as const,
    description:
      "A massive cathedral of machines deep inside the Dominion Tower. At its center, a glowing sphere of red code rotates — the War Core, the heart of the Dominion's war network. The chamber has catwalks crossing at multiple levels, ceiling turrets, and mechanical tendrils that can erupt from the floor. On the War Core's surface: war footage, riots, fires, collapsing cities play in endless loops. When Echo merges with the core, the red light transforms to blinding violet-white before going dark forever.",
    imagePrompt:
      'Interior of the War Core Chamber. A massive cathedral-like space filled with machines and catwalks at multiple levels. At the center, a huge glowing sphere of red code rotates, displaying war footage on its surface. Mechanical tendrils extend from the floor. Ceiling turrets visible. Red lighting dominates with chrome metal surfaces. Epic scale, ominous, grand. Cyberpunk machine cathedral, 4K quality.',
  },
];

// ── Auth helpers ──────────────────────────────────────────────────────
function log(step: string, msg: string) {
  console.log(`[${step}] ${msg}`);
}

function buildSiweMessage(p: { address: string; nonce: string; chainId: number }): string {
  const now = new Date();
  const exp = new Date(now.getTime() + 5 * 60 * 1000);
  return [
    `localhost wants you to sign in with your Ethereum account:`,
    p.address,
    '',
    'Sign in to LOAR',
    '',
    `URI: http://localhost:5173`,
    `Version: 1`,
    `Chain ID: ${p.chainId}`,
    `Nonce: ${p.nonce}`,
    `Issued At: ${now.toISOString()}`,
    `Expiration Time: ${exp.toISOString()}`,
  ].join('\n');
}

async function getAuthToken(): Promise<string> {
  const { nonce } = (await (await fetch(`${SERVER_URL}/auth/nonce`)).json()) as { nonce: string };
  const msg = buildSiweMessage({
    address: getAddress(account.address),
    nonce,
    chainId: sepolia.id,
  });
  const sig = await account.signMessage({ message: msg });
  const res = await fetch(`${SERVER_URL}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: JSON.stringify({ message: msg, signature: sig }),
  });
  return (res.headers.get('set-cookie') ?? '').match(/siwe-session=([^;]+)/)?.[1] || '';
}

async function tRPC<T>(proc: string, input: unknown, token: string): Promise<T> {
  const res = await fetch(`${SERVER_URL}/trpc/${proc}?batch=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ '0': input }),
  });
  const json = (await res.json()) as any[];
  if (json[0]?.error)
    throw new Error(`tRPC ${proc}: ${JSON.stringify(json[0].error).slice(0, 300)}`);
  return json[0]?.result?.data;
}

// ── Main ──────────────────────────────────────────────────────────────
async function main() {
  console.log('═'.repeat(60));
  console.log('  CYBER WAR FILM — Wiki Setup');
  console.log('  4 Characters + 1 Faction + 4 Locations');
  console.log('═'.repeat(60));

  const token = await getAuthToken();
  log('AUTH', `Authenticated as ${account.address}`);

  const created: Array<{ name: string; id: string; imageUrl: string | null }> = [];

  for (let i = 0; i < ENTITIES.length; i++) {
    const e = ENTITIES[i];
    const label = `${i + 1}/${ENTITIES.length}`;

    console.log(`\n${'─'.repeat(50)}`);
    console.log(`  ${e.name} (${e.kind})`);
    console.log(`${'─'.repeat(50)}`);

    // 1. Generate 2D reference art
    log(label, 'Generating 2D reference art...');
    let imageUrl: string | null = null;
    try {
      const img = await tRPC<any>(
        'image.generate',
        {
          prompt: e.imagePrompt,
          task: 'text_to_image',
          imageSize: 'square_hd',
          numImages: 1,
          routingMode: 'auto',
          qualityTarget: 'premium',
          universeId: UNIVERSE,
        },
        token
      );
      imageUrl = img?.imageUrls?.[0] || img?.images?.[0]?.url || null;
      if (imageUrl) log(label, `Art generated`);
    } catch (err: any) {
      log(label, `Art failed: ${err.message?.slice(0, 100)}`);
    }

    // 2. Create entity
    log(label, 'Creating wiki entity...');
    try {
      const result = await tRPC<{ id: string }>(
        'entities.create',
        {
          name: e.name,
          description: e.description,
          kind: e.kind,
          universeAddress: UNIVERSE,
          imageUrl: imageUrl || undefined,
          monetized: false,
        },
        token
      );
      log(label, `Entity created: ${result?.id}`);
      created.push({ name: e.name, id: result?.id, imageUrl });
    } catch (err: any) {
      log(label, `Failed: ${err.message?.slice(0, 150)}`);
      created.push({ name: e.name, id: 'FAILED', imageUrl });
    }
  }

  console.log('\n' + '═'.repeat(60));
  console.log('  CYBER WAR FILM — Wiki Setup Complete');
  console.log('═'.repeat(60));
  for (const c of created) {
    console.log(
      `  ${c.id === 'FAILED' ? 'FAIL' : ' OK '} | ${c.name.padEnd(25)} | img: ${c.imageUrl ? 'YES' : 'NO'} | ${c.id}`
    );
  }
  console.log(`\n  Universe: ${UNIVERSE}`);
  console.log(
    `  Total: ${created.filter((c) => c.id !== 'FAILED').length}/${ENTITIES.length} created`
  );

  // Output entity IDs as JSON for the scene generator
  const idMap = Object.fromEntries(
    created.filter((c) => c.id !== 'FAILED').map((c) => [c.name, c.id])
  );
  console.log('\n  Entity ID map (for scene generator):');
  console.log('  ' + JSON.stringify(idMap, null, 2).replace(/\n/g, '\n  '));
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
