/**
 * DRAGON EGG — Video Generation Pipeline
 *
 * Generates episodes in pairs: Scene 1 = Egg, Scene 2 = Egg Hatching.
 * Uses ByteDance Seedance 2.0 for video generation.
 *
 * Usage:
 *   pnpm tsx scripts/generate-dragon-egg-episodes.ts              # test: 1 episode
 *   pnpm tsx scripts/generate-dragon-egg-episodes.ts --all        # full: 100 episodes
 *   pnpm tsx scripts/generate-dragon-egg-episodes.ts --dry-run    # print prompts only
 *   pnpm tsx scripts/generate-dragon-egg-episodes.ts --start 10   # resume from episode 10
 */
import dotenv from 'dotenv';
import path from 'path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { randomUUID } from 'crypto';
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
  `dragon-egg-video-${Date.now()}`
);
const db = getFirestore(firebaseApp);
db.settings({ preferRest: true });

// ── ByteDance Seedance 2.0 Direct API ──────────────────────────────────
const BYTEDANCE_API_KEY = process.env.BYTEDANCE_API_KEY;
if (!BYTEDANCE_API_KEY) {
  console.error('BYTEDANCE_API_KEY is required for Seedance 2.0');
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
const UNIVERSE_ID = '0x0000000000000000000000000000019d9e5d6003';
const CREATOR_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const RUN_ALL = args.includes('--all');
const startIdx = args.indexOf('--start');
const START_FROM = startIdx >= 0 ? parseInt(args[startIdx + 1], 10) : 1;

// ── Egg Episode Definitions ─────────────────────────────────────────────
// 100 episodes, each with 2 scenes: egg resting + egg hatching

interface EggEpisode {
  id: number;
  title: string;
  eggPrompt: string;
  hatchPrompt: string;
}

const EPISODES: EggEpisode[] = [
  // Fire eggs
  {
    id: 1,
    title: 'Ember Cradle',
    eggPrompt:
      "A massive crimson dragon egg sits in a nest of glowing embers deep inside a volcanic caldera. The egg's surface is covered in overlapping scales of deep red and molten gold that shimmer with internal heat. Tiny cracks of orange firelight pulse from within like a heartbeat. Rivers of lava flow in the background, casting dancing shadows. Steam rises from the obsidian floor. Cinematic wide shot, dramatic volcanic lighting, fantasy realism. No text, no people.",
    hatchPrompt:
      'The crimson dragon egg in the volcanic caldera begins to crack. Brilliant orange light floods through widening fissures in the scaled shell. Fragments of red and gold shell tumble away as a tiny fire dragon emerges — scales gleaming like fresh embers, wings still wet and translucent, eyes glowing amber. It opens its mouth and releases its first breath — a small burst of flame that ignites the air. The lava around the nest surges in response. Cinematic close-up, magical birth moment, warm volcanic lighting. No text, no people.',
  },
  {
    id: 2,
    title: 'Inferno Twins',
    eggPrompt:
      'Two fire dragon eggs rest side by side on a bed of white-hot coals in an underground magma chamber. One egg is dark obsidian with veins of molten orange, the other is pale ash-grey with veins of blue flame. They pulse in alternating rhythm — when one brightens, the other dims. The magma chamber glows with intense heat, stalactites dripping mineral deposits. The eggs seem to communicate through their light. Cinematic medium shot, dual subjects, extreme heat atmosphere. No text, no people.',
    hatchPrompt:
      'The twin fire dragon eggs crack simultaneously. The obsidian egg releases a dragon of deep black scales with orange underbelly, while the ash-grey egg births a pale dragon with blue flame markings. The two hatchlings tumble out together, wings tangled, and immediately nuzzle each other. They breathe tiny flames — one orange, one blue — that spiral together into a purple helix of fire. The magma chamber pulses with warmth. Cinematic shot of twin dragons discovering each other. No text, no people.',
  },
  {
    id: 3,
    title: "Volcano's Heart",
    eggPrompt:
      "A single enormous dragon egg — the size of a car — embedded halfway into the wall of an active volcano's magma tube. The egg's surface is cracked black basalt interlaced with veins of liquid fire that flow like blood vessels. The surrounding rock has crystallized into geometric patterns radiating outward from the egg, as if the volcano itself grew around it. Lava flows past below. The egg pulses with deep seismic energy. Epic wide shot, geological scale, primordial power. No text, no people.",
    hatchPrompt:
      'The enormous volcanic egg explodes outward. The entire magma tube shakes as chunks of basalt shell fly in all directions. From within emerges a dragon the size of a house — ancient-looking even as a newborn, its scales formed from cooling magma that hardens and cracks with each movement. It unfurls wings of translucent volcanic glass that catch the magma light. Its roar shakes the tunnel and triggers a small eruption. Lava fountains celebrate the birth. Epic scale hatching, cataclysmic and beautiful. No text, no people.',
  },
  {
    id: 4,
    title: 'Ember Garden',
    eggPrompt:
      'A cluster of small fire dragon eggs — each the size of a grapefruit — arranged in a spiral pattern on a flat obsidian shelf inside a lava tube. Each egg is a different shade of flame: cherry red, sunset orange, canary yellow, white-hot. Together they form a gradient spiral that glows like a galaxy of fire. Small flame salamanders tend the eggs, pushing cooling embers closer. The tube walls reflect the colors. Intimate macro-style shot, jewel-like eggs, warm palette. No text, no people.',
    hatchPrompt:
      'The spiral of tiny fire eggs begins hatching in sequence — the outermost red egg first, then orange, then yellow, spiraling inward. Each hatchling is the size of a kitten, matching its shell color. They tumble and chirp, tiny jets of colored flame escaping their mouths as they call to each other. The last egg — the white-hot center — cracks and releases a hatchling that glows so brightly it illuminates the entire lava tube. The baby dragons swarm together in a pile of warmth. Adorable mass hatching, colorful fire. No text, no people.',
  },
  {
    id: 5,
    title: 'Cinder Song',
    eggPrompt:
      'A dragon egg sits alone atop a pillar of cooled lava in the center of a vast underground lake of magma. The egg is matte black with a single glowing crack running down its center like a seam of starlight. The magma lake stretches in all directions, its surface slowly churning. Fireflies made of floating embers drift upward from the lake surface. The egg hums — a low vibration that creates concentric ripples in the magma. Solitary, dramatic, otherworldly. Cinematic isolation shot. No text, no people.',
    hatchPrompt:
      'The solitary egg on the lava pillar splits cleanly in half along its glowing seam. A dragon unfolds from within — jet black with a single line of bioluminescent orange running from snout to tail tip. It stretches its wings experimentally, sending showers of sparks cascading into the magma lake below. It looks around at its world — fire, stone, darkness — and seems content. It leaps from the pillar, catches a thermal updraft, and soars above the magma lake for the first time, trailing embers. First flight over fire. No text, no people.',
  },

  // Ice eggs
  {
    id: 6,
    title: 'Glacial Throne',
    eggPrompt:
      'An ice dragon egg suspended inside a frozen waterfall in a vast arctic cavern. The egg is pale blue with silver veins that pulse with frost magic, each pulse sending tiny ice fractals spiraling outward through the surrounding glacier. The waterfall is frozen mid-cascade, creating a curtain of translucent ice around the egg. Aurora borealis light filters through cracks in the cavern ceiling, painting everything in greens and purples. The egg radiates cold — frost grows on the camera lens. Ethereal, crystalline, silent. No text, no people.',
    hatchPrompt:
      "The frozen waterfall cracks and splinters as the ice egg within begins to hatch. The egg doesn't break — it melts from the inside, blue liquid light pouring through the shell. An ice dragon emerges, its scales like frosted glass, its breath visible as clouds of crystalline mist. As it takes its first step, frost patterns bloom across the cavern floor radiating outward from each footprint. It opens its mouth and exhales — a beam of absolute cold that re-freezes the waterfall instantly into a new, more beautiful formation. The aurora above flares in response. Magical winter birth. No text, no people.",
  },
  {
    id: 7,
    title: 'Permafrost Clutch',
    eggPrompt:
      'Three ice dragon eggs buried in ancient permafrost on a windswept arctic tundra. Only their tops are visible — smooth domes of pale ice breaking through the frozen earth like moons rising. Each egg is a slightly different shade: powder blue, steel grey, and diamond-clear. Snow drifts around them but never covers them — they radiate a field that sublimates snow directly into mist. The northern lights dance above. A lone arctic fox watches from a distance. Vast, cold, ancient landscape. No text, no people.',
    hatchPrompt:
      'The permafrost erupts as three ice dragons hatch simultaneously, breaking through frozen earth like seeds in fast-forward spring. Each dragon matches its egg — one powder blue with feathered wings, one steel grey with armored plates, one crystal-clear and nearly invisible against the snow. They shake off permafrost, stretch wings, and the clear one takes flight immediately — a ghost against the aurora. The other two follow, three silhouettes spiraling upward into the northern lights. The tundra below is left with three dragon-shaped craters. Arctic birth, aurora flight. No text, no people.',
  },
  {
    id: 8,
    title: 'Deep Freeze',
    eggPrompt:
      'A dragon egg entombed in the heart of an iceberg, visible through layers of blue glacial ice. The egg appears to be made of compressed snowflakes — each scale is a unique crystalline pattern. Deep within the ice, the egg glows with a cold white light that makes the entire iceberg luminescent from within. The iceberg floats in a black arctic ocean under a star-filled sky. Seen from underwater looking up through the ice. The egg is ancient, patient, dreaming of winter. Underwater perspective, glacial blue, cosmic scale. No text, no people.',
    hatchPrompt:
      'The iceberg cracks from within — a sound like a cannon shot across the arctic ocean. The dragon inside has awakened. Massive fractures race through the ice as the hatchling pushes outward. The iceberg splits and calves, sending tidal waves across the black water. From the wreckage rises a dragon made of living ice — transparent, prismatic, refracting starlight through its body like a flying chandelier. Its wingspan is enormous. It circles the remains of its iceberg once, then flies north into the aurora, leaving a trail of snowfall in its wake. Cataclysmic arctic birth. No text, no people.',
  },

  // Storm eggs
  {
    id: 9,
    title: 'Thunder Crown',
    eggPrompt:
      'A lightning dragon egg hovering above a mountain peak during a violent thunderstorm. The egg is pearl-white with branching veins of electric blue that flash and crackle with each lightning strike. It levitates three feet above the bare rock summit, suspended by its own electromagnetic field. Storm clouds swirl around the peak. Lightning strikes the mountain repeatedly, each bolt arcing toward the egg and being absorbed into its veins. Rain falls everywhere except within a perfect sphere around the egg. Raw atmospheric power. No text, no people.',
    hatchPrompt:
      'The storm egg detonates in a blinding flash of white lightning. The thunderclap is heard for fifty miles. From the epicenter, a dragon made of living electricity materializes — its body a framework of crackling blue-white plasma, its wings sheets of static discharge, its eyes twin ball-lightning orbs. It screams — the sound is thunder — and every lightning bolt in the storm redirects to orbit its body in a spiral. It launches upward into the thunderhead, becoming the storm itself. The mountain peak is left scorched and glassed. Storm birth, electric apotheosis. No text, no people.',
  },
  {
    id: 10,
    title: 'Static Nest',
    eggPrompt:
      'Five small storm dragon eggs clustered in a nest made of twisted metal — lightning rods, copper wire, and magnetized iron filings arranged in fractal patterns. The nest sits atop a radio tower in a lightning field where strikes hit every few seconds. Each egg is metallic silver with hairline cracks of blue-white electricity. The air around them shimmers with static charge. Sparks jump between the eggs in rhythmic patterns. Hair would stand on end here. The eggs crackle and hum with accumulated charge. Industrial storm aesthetic, Tesla-punk. No text, no people.',
    hatchPrompt:
      "All five storm eggs hatch at once in a cascade of electrical discharge. The radio tower becomes a Tesla coil — arcs of electricity connecting all five hatchlings as they emerge. Each is small, metallic, crackling with charge. They're connected by visible streams of electricity, moving as one organism. When one flaps its wings, the others feel the current. They leap from the tower together, a formation of five tiny lightning dragons trailing streams of plasma, and race along the power lines like surfers on an electric wave. Synchronized storm birth, electric ballet. No text, no people.",
  },

  // Water/Deep sea eggs
  {
    id: 11,
    title: 'Abyssal Pulse',
    eggPrompt:
      "A colossal dragon egg on the ocean floor at a hydrothermal vent, three miles below the surface. The egg is midnight black covered in bioluminescent spots that pulse in slow hypnotic patterns — green, blue, violet. Tube worms and blind crabs cluster at its base, warmed by the egg's internal heat. The hydrothermal vent behind it billows superheated black water. Particles of marine snow drift down through the abyss. The egg is twelve feet tall and something inside moves — a shadow shifting behind the bioluminescent shell. Deep sea horror beauty. No text, no people.",
    hatchPrompt:
      "The abyssal egg cracks and the ocean floor trembles. Bioluminescent fluid floods out — glowing blue-green — as a massive deep-sea dragon emerges. Its body is adapted for pressure: armored plates, bioluminescent stripes, enormous pale eyes that glow in the darkness. Its fins are translucent membranes that ripple like jellyfish. It opens its mouth and produces a sound so low it's felt rather than heard — a subsonic boom that sends shockwaves through the water. The hydrothermal vent erupts in response. The deep sea ecosystem scatters and regroups around the new apex predator. Abyssal birth, terrifying beauty. No text, no people.",
  },
  {
    id: 12,
    title: 'Coral Cradle',
    eggPrompt:
      "A sea dragon egg nestled in a living coral formation in a tropical reef. The egg is iridescent turquoise, covered in tiny living barnacles and sea anemones that have colonized its surface. Schools of colorful fish circle it protectively. The coral has grown around the egg over centuries, creating a natural throne. Sunlight filters down through crystal-clear water, creating caustic light patterns on the egg's surface. The egg breathes — expanding and contracting gently — pumping warm water through the reef. Tropical underwater paradise. No text, no people.",
    hatchPrompt:
      "The coral-encrusted egg hatches gently — no violence, no explosion. The shell dissolves into the water like sugar, releasing a sea dragon that looks like living coral itself. Its scales are pink, turquoise, and orange. Its fins trail like sea fans. Small cleaner fish immediately begin attending to it. The hatchling swims in a lazy spiral, and everywhere it passes, new coral begins to grow at impossible speed — blooming outward in colorful fractals. The reef expands visibly. The dragon is not just born into the reef — it is the reef's heartbeat now. Gentle tropical birth, symbiotic beauty. No text, no people.",
  },

  // Earth/Stone eggs
  {
    id: 13,
    title: 'Desert Monument',
    eggPrompt:
      "A petrified dragon egg the size of a boulder half-buried in red desert sand. Wind erosion has exposed its shape — unmistakably an egg, its surface etched with patterns that could be scales or ancient script worn smooth by ten thousand sandstorms. The desert stretches endlessly in all directions under a blazing sun. Heat shimmer distorts the horizon. Small offerings of dried flowers and water cups are arranged at the egg's base by nomads who consider it sacred. A single vulture circles overhead. Ancient, monumental, patient. No text, no people.",
    hatchPrompt:
      'The petrified egg that has sat in the desert for ten thousand years suddenly glows amber from within. The stone surface cracks — not with violence but with geological patience, like a canyon forming in fast-forward. An earth dragon emerges made of living sandstone, its body layered like sedimentary rock, its eyes like polished amber gemstones. With each step, the sand around it crystallizes into glass. It raises its head and roars — a sound like a rockslide — and a dormant mesa in the distance splits open revealing a hidden oasis beneath. The desert answers its child. Geological awakening. No text, no people.',
  },
  {
    id: 14,
    title: 'Crystal Geode',
    eggPrompt:
      "A dragon egg that is actually a massive geode — rough grey stone on the outside, but a crack reveals a hollow interior lined with enormous amethyst crystals. The egg sits in a dark cave, and the crystals inside catch the faintest light and amplify it into purple and violet rays that paint the cave walls. Mineral-rich water drips onto the egg's surface, slowly adding new crystal layers. The egg has been growing for millennia. Stalactites and stalagmites frame it like a natural cathedral. Geological wonder, crystalline beauty. No text, no people.",
    hatchPrompt:
      'The geode egg splits open and the amethyst crystals inside shatter into dust — purple light flooding the cave. From the crystalline dust, a dragon assembles itself — its body made of living crystal, each scale a different gemstone: amethyst wings, emerald eyes, ruby spine, sapphire claws. It moves with the sound of wind chimes. When it shakes itself, crystal dust falls from its body and new gemstones begin growing where they land. The cave becomes a treasure vault in seconds. The crystal dragon catches light through its body and projects rainbows on every surface. Prismatic birth, gemstone dragon. No text, no people.',
  },

  // Nature/Life eggs
  {
    id: 15,
    title: 'The Living Nest',
    eggPrompt:
      "A forest dragon egg cradled in the hollow of a tree so ancient it has become a hill. The egg is covered in living moss and tiny wildflowers that bloom in spiraling patterns along its surface — white blossoms and green tendrils. Roots have grown around the nest in a protective lattice. Birds nest in the branches above. Deer sleep at the base. Butterflies land on the egg's surface. The entire grove radiates peace and accelerated growth — trees here are twice normal size. Dappled golden sunlight through the canopy. Fairy tale forest, Studio Ghibli atmosphere. No text, no people.",
    hatchPrompt:
      "The forest egg doesn't crack — it blooms. The moss and flowers on its surface open outward like petals of an enormous flower, revealing a dragon made of living wood and leaves. Its scales are bark, its wings are translucent leaf membranes veined like maple leaves, its eyes are golden sap. As it stands, flowers bloom in its footprints. It nuzzles the ancient tree that cradled it, and the tree responds by blooming out of season — thousands of white flowers erupting from every branch at once. Birds sing. The forest celebrates. The gentlest birth, nature rejoicing. No text, no people.",
  },
  {
    id: 16,
    title: 'Mushroom Ring',
    eggPrompt:
      "A dragon egg at the center of a massive fairy ring of bioluminescent mushrooms in a dark old-growth forest. The egg is organic — its surface resembles a giant seed pod, textured like bark with spiraling grain patterns. The mushrooms around it glow blue-green, pulsing in sync with the egg's breathing rhythm. Fireflies orbit the egg in slow spirals. Mist hangs close to the forest floor. The air seems to shimmer with spores and pollen. Everything here is alive, connected, breathing together. Mystical forest, bioluminescent, enchanted. No text, no people.",
    hatchPrompt:
      'The seed-pod egg sprouts. Vines and tendrils burst from its surface, reaching outward, and then the shell peels apart like a flower bud in time-lapse. The dragon within is fungal — its body a network of mycelium and mushroom caps, its wings made of overlapping shelf fungi, its eyes glowing with the same blue-green bioluminescence as the fairy ring. As it moves, new mushrooms sprout in its wake. It exhales a cloud of luminous spores that drift through the forest, and wherever they land, new life begins — moss climbs stones, flowers push through soil, dead trees sprout fresh green. Mycelial dragon, forest regeneration. No text, no people.',
  },

  // Void/Shadow eggs
  {
    id: 17,
    title: 'The Absence',
    eggPrompt:
      'A void dragon egg in a cave where light itself dies. The egg is pure matte black and absorbs all illumination — torches dim near it, lanterns gutter, even bioluminescence bends away from its surface. The egg can only be perceived as an absence: an egg-shaped hole in reality where nothing reflects. The cave walls around it are covered in scratch marks from creatures that wandered too close and could not find their way back. Dust particles vanish as they approach. The darkness around the egg has depth — it looks like falling into infinity. Cosmic horror, existential dread, beautiful void. No text, no people.',
    hatchPrompt:
      "The void egg doesn't hatch — it inverts. Reality folds inward toward it like water down a drain, and then snaps back. Where the egg was, a dragon stands — or rather, a dragon-shaped absence stands. It is a living shadow, a creature made of the space between stars. Light curves around it. Looking at it directly is impossible — the eye slides off. But in peripheral vision, you can see it: elegant, vast, wings spread wide enough to eclipse the cave entrance. It moves without sound, without weight. Where it passes, the scratch marks on the walls heal. The creatures that were lost are released. The void is not evil — it is patient. Shadow birth, reality-bending. No text, no people.",
  },
  {
    id: 18,
    title: 'Eclipse Shell',
    eggPrompt:
      'A void dragon egg floating in the vacuum of space, silhouetted against a distant star. The egg is a perfect sphere of absolute darkness — a miniature black hole with an event horizon shaped like dragon scales. Light from the star bends around it, creating a brilliant corona effect — an eclipse caused by an egg. Nearby asteroids slowly spiral toward it, caught in its subtle gravity. Stars visible behind it are slightly warped by gravitational lensing. Space is distorted but beautiful around this egg. Cosmic scale, astrophysical dragon egg. No text, no people.',
    hatchPrompt:
      "The cosmic void egg reaches critical mass. The corona of bent starlight flares brilliantly — a supernova of trapped light releasing all at once. From the blinding flash emerges a dragon the size of a small moon, its body a map of constellations, its wings nebulae of purple and blue gas, its eyes twin white dwarf stars. It opens its mouth and exhales — not fire, not ice, but gravity — a wave that reshapes the asteroid field into orbital rings. The dragon turns toward the distant star and begins to fly, trailing a comet's tail of stardust. Cosmic birth, astronomical dragon. No text, no people.",
  },

  // Crystal/Sound eggs
  {
    id: 19,
    title: 'The Concert',
    eggPrompt:
      'A crystalline dragon egg that produces music, sitting on a pedestal of rose quartz in a marble amphitheater carved into a mountainside. The egg is translucent and faceted like a giant gemstone, and sound waves are visible emanating from it — concentric rings of light pulsing outward with each note. The music is visible as color: warm gold for low notes, electric blue for high ones. Empty stone seats for thousands surround it. The amphitheater was built by a civilization that existed solely to listen. Afternoon light catches the facets and scatters rainbows. Musical crystal, synesthesia. No text, no people.',
    hatchPrompt:
      'The singing egg reaches a crescendo — the music intensifying, frequencies layering, the amphitheater resonating like a tuning fork. Then every facet of the crystal shell chimes simultaneously — a single perfect chord — and the egg shatters into a thousand singing shards that hang suspended in the air. From the center rises a dragon made of pure sound — visible as shimmering waveforms, its body a standing wave, its wings interference patterns. Each wingbeat produces a musical note. The suspended crystal shards orbit the dragon like a choir, each one singing a different harmony. The amphitheater fills with music that has been building for 800 years. Symphonic birth, sound made visible. No text, no people.',
  },
  {
    id: 20,
    title: 'Wind Chime',
    eggPrompt:
      "A delicate crystal dragon egg hanging from a silk thread in a bamboo forest, spinning slowly in the breeze. The egg is thin-shelled and semi-transparent — you can see a tiny curled dragon silhouette inside, sleeping. When wind passes through the bamboo, the egg resonates with different tones depending on wind speed and direction. Bamboo leaves drift past. Morning mist. Sunbeams penetrate the canopy in golden shafts. The egg is small — the size of a robin's egg — but its song carries for miles. Japanese aesthetic, wabi-sabi, delicate beauty. No text, no people.",
    hatchPrompt:
      'A strong wind sweeps through the bamboo forest. The tiny crystal egg rings with a clear, perfect note — and then gently opens like a locket. A dragon no larger than a hummingbird unfurls from within, its crystal wings catching sunlight and scattering tiny rainbows through the bamboo. It hovers, testing its wings, each beat producing a delicate chime. It darts through the forest — a living wind chime — weaving between bamboo stalks, its song mixing with the rustling leaves. Mist swirls in its tiny wake. The silk thread drifts empty in the breeze. Miniature birth, maximum delicacy. No text, no people.',
  },

  // Celestial eggs
  {
    id: 21,
    title: 'Moonstone Vigil',
    eggPrompt:
      "A celestial dragon egg resting on a stone altar at the peak of a mountain, bathed in full moonlight. The egg is made of moonstone — pearlescent, shifting with internal blue and white fire as moonbeams strike it. The altar is ancient, covered in astronomical carvings that align perfectly with the moon's position. Stars blaze above. The Milky Way stretches across the sky. The egg seems to drink the moonlight, growing brighter throughout the night. Wolves howl in the valley far below. Sacred, astronomical, nocturnal. No text, no people.",
    hatchPrompt:
      'At the moment of lunar zenith, the moonstone egg blazes with reflected moonlight so intense it casts shadows like a second moon. The shell dissolves into moonbeams — literal rays of light lifting away and returning to the sky. The dragon within is made of compressed moonlight: silver-white, luminous, its body casting a soft glow on everything around it. Its wings are crescent-shaped. Its eyes are full moons. As it rises from the altar, the astronomical carvings glow, activated for the first time in millennia. The dragon flies toward the moon, becoming a new star as it ascends. Lunar ascension, celestial birth. No text, no people.',
  },
  {
    id: 22,
    title: 'Sunspot',
    eggPrompt:
      "A dragon egg made of solidified solar plasma, resting in a field of sunflowers that all face it instead of the sun. The egg radiates warmth and golden light — it IS a tiny sun, contained in an egg shape. The sunflowers lean toward it, photosynthesizing from its glow. The surrounding field is impossibly lush and green. Bees orbit the egg like tiny planets. The sky above shows both the real sun and the egg's glow competing. Warm, golden, life-giving. Solar fantasy, harvest warmth. No text, no people.",
    hatchPrompt:
      'The solar egg erupts with a miniature solar flare — a tongue of golden plasma arcing upward. The shell burns away like paper, revealing a dragon of living sunlight. Its scales are solar cells, each one a tiny sun. Its mane is a corona of plasma tendrils. It is so bright that looking at it directly creates afterimages. As it spreads its wings, the sunflower field below blooms triple — flowers bursting with new petals, growing visibly. The dragon rises, and for a moment the world has two suns. Then it flies into the real sun, merging with it, and the day becomes imperceptibly brighter. Solar birth, photosynthetic celebration. No text, no people.',
  },

  // Elemental hybrid eggs
  {
    id: 23,
    title: 'Steam Rising',
    eggPrompt:
      'A dragon egg at the exact boundary where a lava flow meets a frozen lake — half submerged in magma, half encased in ice. The egg itself is split down the middle: one side glowing red-hot, the other frosted blue-white. A permanent column of steam rises from the junction line. The egg exists in impossible equilibrium — it should be destroyed by either extreme, but instead it thrives in the contradiction. The steam creates a perpetual rainbow overhead. Elemental paradox, beautiful impossibility. No text, no people.',
    hatchPrompt:
      'The paradox egg hatches into chaos — the lava side and ice side crack simultaneously, and a dragon emerges that is both fire and ice. Its left side blazes with flame, its right side crystallizes with frost. Where the two halves meet along its spine, perpetual steam hisses. Its breath alternates — fire from one nostril, ice from the other. When it roars, the sound is both a crackle and a crack, steam and flame and frost erupting together. The lava flow and frozen lake both surge toward each other as the dragon takes flight, trailing a contrail of mixed steam. Elemental fusion birth, thermodynamic impossibility. No text, no people.',
  },
  {
    id: 24,
    title: 'Quicksand Guardian',
    eggPrompt:
      "A dragon egg hidden at the bottom of a pool of liquid gold in an ancient underground treasury. The gold is not treasure — it is the egg's amniotic fluid, generated by the egg itself over centuries of slow alchemical transformation. The pool is perfectly circular, ringed by stone pillars covered in alchemical symbols. The egg is visible through the gold as a dark ovoid shape, pulsing. Abandoned coins and jewelry from forgotten civilizations have been dissolved and absorbed. The air smells of ozone and metal. Alchemical wonder, subterranean gold. No text, no people.",
    hatchPrompt:
      'The pool of liquid gold begins to drain — absorbed back into the egg in reverse. As the gold recedes, the egg is revealed: enormous, covered in golden scales that are literally made of transmuted gold. It cracks with the sound of a bell tolling. The dragon that emerges has scales of 24-karat gold, flexible as silk, gleaming in the torchlight. Its breath is not fire but transmutation — it exhales onto a stone pillar and the surface turns to silver. It is an alchemist dragon, born from centuries of slow transformation. It shakes itself and droplets of liquid gold scatter like rain. Alchemical birth, golden dragon. No text, no people.',
  },

  // Exotic eggs
  {
    id: 25,
    title: 'Glass Bloom',
    eggPrompt:
      "A dragon egg made entirely of blown glass, impossibly thin and delicate, sitting on a velvet cushion in an abandoned glassblower's workshop. The egg is Murano glass — swirls of cobalt blue, emerald green, ruby red, and amber captured in transparent shell. Afternoon light streams through dusty windows and sets the egg ablaze with color, projecting stained-glass patterns across the workshop walls. Old tools and broken glass surround it. The egg is the glassblower's final masterpiece — art that became life. Artisan beauty, warm workshop light. No text, no people.",
    hatchPrompt:
      "The glass egg doesn't break — it melts. The colors run and flow like a Murano vase being born in reverse. The molten glass shapes itself into a dragon of living glass — transparent body swirling with captured colors, organs visible through its translucent skin, heart glowing like a furnace. When it breathes, it exhales molten glass that cools into beautiful sculptures mid-air. The workshop fills with glass flowers, glass butterflies, glass stars — all created by the dragon's first breaths. It is an artist. It has always been an artist. Artisan birth, glass art coming alive. No text, no people.",
  },
  {
    id: 26,
    title: 'Amber Prison',
    eggPrompt:
      'A prehistoric dragon egg perfectly preserved in an enormous piece of amber, displayed in a natural history museum after hours. The amber is the size of a beach ball, golden and translucent. Inside, the egg is visible in perfect detail — scales, texture, even a faint internal glow that scientists cannot explain. The museum is dark except for the egg\'s spotlight. Dinosaur skeletons frame the scene. The amber is labeled "Unknown specimen, est. 65 million years old." The egg inside is not fossilized. It is sleeping. Museum at night, amber glow, Jurassic mystery. No text, no people.',
    hatchPrompt:
      'The museum closes. The amber begins to heat from within. The spotlight flickers. A crack appears in the 65-million-year-old amber — then a web of fractures. The amber explodes outward in a shower of golden fragments. Security alarms wail. From the amber steps a dragon from the age of dinosaurs — feathered, with a long serpentine neck, four wings instead of two, and intelligent eyes that study the dinosaur skeletons with recognition. It remembers them. It touches a T-Rex skull gently with its snout, then turns to the museum windows. The modern world glows beyond the glass. A prehistoric being meets the future. Time-displaced birth, Jurassic wonder. No text, no people.',
  },
  {
    id: 27,
    title: 'Cloud Nursery',
    eggPrompt:
      'A dragon egg floating inside a cumulus cloud at forty thousand feet. The egg is made of condensed cloud — dense white vapor pressed into an ovoid shape, held together by internal wind currents visible as spiral patterns on its surface. Lightning flickers inside it like a nervous system. The egg drifts with the cloud, rolling slowly. Above: deep blue stratosphere and stars even in daylight. Below: the earth is a curved mosaic of blue oceans and brown continents. The egg is at home in the sky, born from atmosphere itself. Aerial perspective, cloud formations, atmospheric wonder. No text, no people.',
    hatchPrompt:
      'The cloud egg disperses outward — the vapor expanding rapidly, and from the center launches a dragon made of living weather. Its body is a thundercloud given form — dark grey and purple, lit from within by continuous lightning. Its wings create their own wind — gusts and thermals that reshape nearby clouds. Rain falls from its belly in a localized shower. A rainbow forms in its wake. It is not a creature that flies through weather — it IS weather, given consciousness and wings. It banks into a thermal and spirals upward, leaving a corkscrew contrail. Atmospheric birth, weather dragon. No text, no people.',
  },
  {
    id: 28,
    title: 'Tide Pool Jewel',
    eggPrompt:
      'A tiny dragon egg — the size of a marble — sitting in a tide pool on a rocky ocean shore. The egg is opalescent, shifting through sea-glass colors with each passing wave. Miniature sea anemones and hermit crabs share the tide pool. The egg is so small it could be mistaken for a polished pebble, but it pulses with life and the tide pool water is unnaturally warm. Waves crash against the rocks beyond. Sunset light turns everything gold and pink. Macro photography perspective, intimate scale, oceanic beauty. No text, no people.',
    hatchPrompt:
      'A wave washes over the tide pool and when it recedes, the marble-sized egg has cracked. A dragon the size of a seahorse unfurls from within — translucent, delicate, with fins instead of wings and a curled tail. It swims in the tide pool, testing its body, chasing a startled hermit crab. Its scales shift color with emotion — excited pink, curious blue, content green. When the next wave connects the tide pool to the ocean, the tiny dragon hesitates at the threshold of the vast Pacific — then darts forward into the biggest world it will ever know. Miniature oceanic birth, first journey. No text, no people.',
  },

  // More fire
  {
    id: 29,
    title: 'Candlelight',
    eggPrompt:
      'A dragon egg the size of a candle flame, hovering above the wick of an ancient candle in a medieval library. The egg is made of compressed fire — a teardrop of living flame, hotter than the candle that hosts it. Ancient books surround it on towering shelves. The candlelight casts long shadows. Dust motes drift through the warm light. The egg has been here for centuries, mistaken for an unusually persistent candle. Librarians have tried to blow it out. It always returns. Intimate scale, warm library atmosphere, hidden magic. No text, no people.',
    hatchPrompt:
      "The candle flame egg blazes suddenly — the library candle erupting into a pillar of fire that reaches the ceiling. Books nearby flutter but don't burn — the fire is selective. From the flame emerges a dragon the size of a moth, wings of translucent fire, body a tiny ember of white-hot intensity. It zips between the bookshelves like a firefly on amphetamines, leaving a trail of warm golden light. Every candle in the library ignites simultaneously as it passes. The dragon pauses before an ancient tome on dragonlore, illuminating the page, and the text rearranges itself to add one more entry. Micro fire birth, library magic. No text, no people.",
  },
  {
    id: 30,
    title: 'Forge Heart',
    eggPrompt:
      "A dragon egg sitting in the coals of an abandoned dwarven forge deep underground. The forge is enormous — built for weapons of legend. The egg sits where the master smith's crucible once stood. Its shell is hammered iron with rivets, as if the egg itself is a piece of forged metalwork. The forge's bellows still creak in a draft, and each gust makes the egg glow brighter. Anvils, quenching troughs, and half-finished swords surround it. Chains hang from the ceiling. The egg has been heating itself for so long the stone floor has melted into glass beneath it. Industrial fantasy, forge glow. No text, no people.",
    hatchPrompt:
      'The forge egg cracks along its rivet lines — each seam splitting with a shower of sparks and the ring of hammer on anvil. A dragon of living metal emerges — iron scales, copper wings, eyes like molten steel. Its body steams as if freshly quenched. It looks at the abandoned forge and does something unexpected: it breathes fire onto the cold furnace, reigniting it. Then it grasps a half-finished sword in its jaws, heats it with its breath, and hammers it against the anvil with its tail. The first sound the forge has heard in a thousand years: RING. RING. RING. The smith-dragon has come home. Forge awakening, craftsman dragon. No text, no people.',
  },

  // More ice
  {
    id: 31,
    title: 'Snow Globe',
    eggPrompt:
      'A dragon egg encased inside what appears to be a giant natural snow globe — a sphere of perfectly clear ice on a frozen mountaintop. Inside the sphere, snow falls perpetually around the egg in slow motion, never accumulating, never stopping. The egg is translucent blue-white. The snow inside the sphere follows complex patterns — spirals, helices, fractals — as if choreographed. Outside the sphere, a blizzard rages, but inside is perfectly calm. The contrast between chaos outside and perfect order within. Crystalline containment, eternal snowfall. No text, no people.',
    hatchPrompt:
      'The ice sphere shatters from within — the perpetual snowfall inside suddenly accelerating into a blizzard contained in a ball. The sphere explodes outward, and the internal snow merges with the external blizzard. From the fusion, an ice dragon forms out of the snowstorm itself — assembling from thousands of individual snowflakes, each one locking into place. The dragon is made of packed snow and clear ice, its features impossibly detailed. It inhales the blizzard — literally sucks in the storm — and the mountaintop goes suddenly, perfectly still. Then it exhales: a gentle snowfall of perfect crystalline flakes that are individually shaped like tiny dragons. Snowstorm birth, weather tamed. No text, no people.',
  },
  {
    id: 32,
    title: 'Frozen Tear',
    eggPrompt:
      'A dragon egg that is a frozen teardrop — literally tear-shaped, hanging from the ceiling of an ice cave like a chandelier. The egg is perfectly clear ice with a single flaw: at its center, a tiny flame burns. A flame inside ice, perpetually frozen, perpetually burning. The contradiction is beautiful and impossible. The cave walls reflect both the warm firelight and cold ice-blue in competing patterns. Icicles frame the teardrop like crystalline curtains. The flame never melts the ice. The ice never extinguishes the flame. Beautiful paradox, thermal impossibility. No text, no people.',
    hatchPrompt:
      'The frozen teardrop falls. It detaches from the ceiling and plummets in slow motion — the internal flame flaring as it falls. It hits the cave floor and does not shatter — it bounces, rings like a bell, and then gently opens along the tear-shape. From within steps a dragon of contradictions: ice scales on one side, flame scales on the other, but unlike the steam-rising dragon, this one is harmonious — the ice and fire blend seamlessly along its spine in gradient scales of blue-to-orange. The cave simultaneously warms and cools to the exact same temperature everywhere. The dragon has brought balance. It curls up where it landed, at peace. Paradox resolved, harmony born. No text, no people.',
  },

  // More nature
  {
    id: 33,
    title: 'Autumn Ember',
    eggPrompt:
      'A dragon egg buried in a pile of autumn leaves in a New England forest at peak fall color. The egg looks like an oversized acorn — brown and textured, capped with a small stem. It sits among leaves of every color: scarlet maple, golden oak, russet elm, burgundy dogwood. Shafts of warm October sunlight cut through the trees. The egg is warm — the leaves nearest to it have not yet fallen, clinging to their branches above. A squirrel investigates, then retreats. The egg smells like woodsmoke and cinnamon. Autumn warmth, harvest beauty, seasonal magic. No text, no people.',
    hatchPrompt:
      'The acorn egg cracks along its cap line. A dragon of autumn emerges — its scales are individual leaves in every fall color, its wings thin as leaf tissue and just as colorful. When it breathes, it exhales a warm wind that carries leaves in a spiral. It is small — the size of a cat — and immediately curious about everything. It chases a falling leaf, catches it, and the leaf becomes part of its wing. Every leaf it touches becomes part of its body. By the time it leaps into the air for its first flight, it is a swirling mass of autumn color, a living leaf pile given form and joy. Autumnal birth, playful and warm. No text, no people.',
  },
  {
    id: 34,
    title: 'Root Deep',
    eggPrompt:
      "A dragon egg tangled in the root system of the world's oldest tree — a bristlecone pine over 5,000 years old. The egg is wrapped in roots so completely that only a small patch of shell is visible — smooth, dark brown, warm. The tree has grown around and because of the egg for millennia. The egg feeds the tree. The tree protects the egg. They are one organism now. The landscape is harsh — high altitude, dry, windswept — but the bristlecone thrives because of its hidden passenger. Ancient symbiosis, extreme age, subtle power. No text, no people.",
    hatchPrompt:
      "After five thousand years, the roots relax. The bristlecone pine's oldest branches creak and part, revealing the egg beneath. It hatches slowly — days compressed into seconds — the shell becoming soil, the dragon growing like a plant. It is made of living wood: bristlecone bark for scales, pine needles for spines, roots for claws. It is ancient at birth, carrying 5,000 years of growth rings in its body. It stands beside the tree and they are the same height. The dragon does not leave — it puts its roots down next to the tree and begins to grow. Two ancient beings, side by side, watching millennia pass. Arboreal birth, infinite patience. No text, no people.",
  },

  // More void
  {
    id: 35,
    title: 'Mirror Crack',
    eggPrompt:
      "A void dragon egg trapped inside a mirror in an abandoned palace hall of mirrors. The egg exists only in the reflection — looking at the spot directly shows empty floor, but every mirror shows a dark egg hovering in that exact space. The mirrors disagree about the egg's appearance: some show it as black, others as silver, one cracked mirror shows it as having already hatched. The hall is dusty, chandeliers dark, moonlight streaming through broken windows. The egg is real in reflection and absent in reality. Surreal, Escher-like, reality-bending. No text, no people.",
    hatchPrompt:
      'Every mirror in the hall cracks simultaneously — a web of fractures spreading across every reflective surface. From each cracked mirror, a shadow reaches outward — dragon claws made of darkness gripping the mirror frames. The reflections step OUT of the mirrors. A hundred shadow dragons, one from each mirror, each slightly different — some larger, some smaller, some with extra wings. They converge on the center of the hall and merge — folding into each other like origami — until a single void dragon stands where the egg was never visible. It is finally real. It looks back at the mirrors and sees, for the first time, its own reflection: nothing. Surreal hatching, mirror break, reality convergence. No text, no people.',
  },

  // More storm
  {
    id: 36,
    title: 'Ball Lightning',
    eggPrompt:
      'A storm dragon egg that manifests as ball lightning — a glowing sphere of electrical plasma floating through a dark forest during a thunderstorm. The sphere drifts between trees at walking pace, leaving scorch marks on bark and ozone in the air. It phases through solid objects, passing through tree trunks without damage. Rain falls around it but evaporates before touching it. Scientists have tried to photograph it — cameras malfunction in its presence. It has been appearing in this forest for decades, always the same path, always during storms. Unexplained phenomenon, atmospheric horror beauty. No text, no people.',
    hatchPrompt:
      'The ball lightning sphere stops mid-forest. It expands — doubling, tripling in size — the trees bending away from the electromagnetic force. Lightning from the storm above connects to it — bolt after bolt, feeding it energy. The sphere reaches critical density and detonates into a directed beam of lightning that scorches a perfect circle in the forest floor. From the char stands a dragon of plasma — its body flickering between solid and energy state, never quite fully one or the other. It crackles, pops, and hums. It lifts off the ground and shoots into the thundercloud above at the speed of lightning. The forest is silent except for settling ash. Electromagnetic apotheosis, plasma dragon. No text, no people.',
  },

  // More water
  {
    id: 37,
    title: 'Rain Drop',
    eggPrompt:
      'A dragon egg inside a single raindrop — visible only with a macro lens. The raindrop hangs from the tip of a leaf after a spring rain, refracting the world upside-down inside it. Nested within the water tension is a microscopic egg, perfectly formed, scales visible at 100x magnification. The world reflected in the raindrop — clouds, trees, flowers — wraps around the egg like a blanket. The raindrop trembles on the edge of falling. Macro photography, extreme intimacy, hidden worlds within water. No text, no people.',
    hatchPrompt:
      "The raindrop falls — and doesn't splash. It hits a puddle and the puddle ripples outward in concentric circles that never stop expanding. The micro-egg within grows as it hits water — rapid expansion like a sea-monkey — from microscopic to mouse-sized in seconds. A water dragon coalesces from the puddle: transparent, its body a lens that refracts everything behind it. It swims through the grass like a stream, grows more with every puddle it absorbs. By the time it reaches the river, it is the river — a dragon-shaped current flowing downstream, growing, laughing in the sound of rushing water. Scale transformation, water becoming alive. No text, no people.",
  },
  {
    id: 38,
    title: 'Whirlpool Eye',
    eggPrompt:
      "A massive sea dragon egg at the center of a permanent whirlpool in the open ocean. The whirlpool is the egg's defense mechanism — the spinning water keeps everything away. The egg is visible at the center when the vortex aligns — glimpses of dark green shell with barnacle encrustations. Ships give this patch of ocean a wide berth. Seabirds circle but never land. The whirlpool creates a constant low roar that can be heard for miles. Under the surface, the vortex extends down to the sea floor where the egg sits like a throne. Oceanic power, maritime danger, egg as phenomenon. No text, no people.",
    hatchPrompt:
      "The whirlpool reverses. Water that has been spinning clockwise for centuries suddenly stops, then spins counterclockwise with double the force. The ocean rises in a waterspout — a column of spinning water a mile tall. At its center, the sea dragon rises with the water, growing as it ascends. Green scales like sea glass, barnacles becoming armor, the whirlpool becoming its body. At the waterspout's peak, the dragon breaches the surface and the column collapses. The dragon is vast — serpentine, as long as a cargo ship, moving through the water with undulating grace. The whirlpool stops forever. The sea goes calm. Oceanic apotheosis, serpent dragon. No text, no people.",
  },

  // More crystal
  {
    id: 39,
    title: 'Prism Peak',
    eggPrompt:
      'A crystal dragon egg balanced on the very tip of a mountain peak, catching the first light of dawn. The egg acts as a prism — splitting white sunlight into a spectrum that paints the entire mountain in rainbow colors. Red on the western slope, violet on the eastern, and every color between. Snow on the peak is tinted by the refracted light. The egg rotates slowly, causing the colors to sweep across the landscape like a lighthouse beam made of rainbows. Sunrise perspective, prismatic light show, natural spectacle. No text, no people.',
    hatchPrompt:
      "At the exact moment of sunrise alignment — light hitting the egg at the perfect angle — the crystal stores all the light instead of refracting it. The mountain goes dark. The egg blazes white-hot with accumulated photons. Then it releases: a photonic dragon made of visible light — its body a spectrum, head to tail running through every color: red head, orange neck, yellow chest, green belly, blue legs, indigo wings, violet tail. It doesn't fly — it beams. It becomes a ray of light and shoots across the sky, painting a permanent rainbow that doesn't need rain. Photonic birth, light speed, permanent rainbow. No text, no people.",
  },
  {
    id: 40,
    title: 'Echo Chamber',
    eggPrompt:
      "A crystal dragon egg in a perfectly spherical cave — a natural echo chamber where any sound reflects infinitely. The egg has been absorbing echoes for centuries: every word ever spoken here, every drip of water, every footstep is stored in its crystalline structure. The cave walls are smooth limestone, polished by ancient water. The egg vibrates with trapped sound — visible as heat shimmer around its surface. If you put your ear to it, you hear voices in languages that haven't been spoken in a thousand years. Acoustic wonder, temporal recording, sonic archaeology. No text, no people.",
    hatchPrompt:
      'The echo egg releases all its stored sound simultaneously. Centuries of absorbed echoes blast outward — ancient voices, water drips, footsteps, conversations in dead languages, songs, crying, laughter — all at once. The cave walls vibrate so intensely they hum a chord. From the sonic explosion, a dragon forms from compressed sound waves — its body visible only because sound bends air and air bends light. It speaks, and its voice is every voice it ever absorbed: a chorus of centuries. It sings, and the cave resonates at its fundamental frequency, amplifying the song until it bursts through the mountain and is heard across the entire valley. Sonic birth, acoustic explosion, voice of ages. No text, no people.',
  },

  // More earth
  {
    id: 41,
    title: 'Fossil Layer',
    eggPrompt:
      "A dragon egg embedded in a cliff face of sedimentary rock, visible in cross-section like a geological specimen. Layers of stone — each a different era — wrap around the egg like tree rings: Cambrian, Ordovician, Silurian, stacked through deep time. The egg predates all of them. Paleontologists have roped off the area but can't extract it — their tools break against the shell. Rain has eroded the cliff to reveal the egg's profile. It is the oldest object on Earth. Geological scale, deep time, paleontological wonder. No text, no people.",
    hatchPrompt:
      'The cliff face splits. A crack runs from the egg upward through every geological layer — through billions of years of compressed time. The egg extracts itself from the rock face, pulling free with the sound of continents separating. The dragon that emerges carries the rock layers as armor — each geological era a different colored band wrapping its body. It is a living geological record: Cambrian trilobites fossilized in its shoulder plates, dinosaur teeth embedded in its spine, ice age permafrost still frozen on its tail. It is every era at once. It looks at the modern world and recognizes nothing. Deep time dragon, geological birth. No text, no people.',
  },
  {
    id: 42,
    title: 'Meteor Heart',
    eggPrompt:
      'A dragon egg at the center of a meteor crater in the Siberian wilderness. The egg fell from space — the crater is its landing site, punched into the earth on impact millennia ago. The crater has become a lake, and the egg sits at the bottom, visible through clear water. It is made of meteoric iron — dark, dense, covered in Widmanstätten patterns unique to space metals. The surrounding forest was flattened by the impact and has grown back in a perfect circle, younger than the trees outside the crater rim. Extraterrestrial origin, impact site, cosmic arrival. No text, no people.',
    hatchPrompt:
      "The crater lake begins to steam. The water temperature rises rapidly — fish flee to the edges. The meteoric iron egg at the bottom glows red, then white, then blue-hot. The lake evaporates in a column of steam visible for miles. The egg stands alone on the dry lakebed, glowing like a star. It cracks along the Widmanstätten crystal patterns, each fragment floating upward, suspended by the dragon's magnetic field. A dragon of meteoric iron rises — scarred, ancient, alien. Its eyes contain starlight from another solar system. It looks up at the sky it fell from, then turns away. This is home now. Extraterrestrial birth, cosmic homecoming. No text, no people.",
  },

  // More exotic
  {
    id: 43,
    title: 'Clockwork Egg',
    eggPrompt:
      "A dragon egg made of brass gears, springs, and clockwork mechanisms, sitting on a watchmaker's bench in a Victorian workshop. The egg ticks — hundreds of tiny gears visible through a glass panel on its side, all interlocking, driving some unknown countdown. The mainspring coils and uncoils. Tick, tick, tick. Watch tools surround it. Magnifying loupes, jeweler's screwdrivers, tiny brass parts. The workshop is cluttered, warm, lamplit. The egg has been ticking since the watchmaker wound it in 1847. The watchmaker is long dead. The countdown continues. Steampunk aesthetic, clockwork precision, temporal mystery. No text, no people.",
    hatchPrompt:
      "The clockwork egg reaches zero. Every gear stops simultaneously — total silence after 179 years of ticking. Then the gears reverse. The egg unfolds mechanically — panels lifting, gears rearranging, springs releasing in precise sequence like the world's most complex music box. A clockwork dragon assembles itself from the egg's components: brass skeleton, copper wings with riveted panels, glass eyes with gear irises, a steam-driven heart visible through its chest plate. It is a mechanical wonder, ticking and whirring, steam puffing from its nostrils. It picks up the watchmaker's finest loupe in its brass claws and examines its own reflection. Steampunk birth, mechanical self-assembly. No text, no people.",
  },
  {
    id: 44,
    title: 'Ink Wash',
    eggPrompt:
      "A dragon egg painted in traditional Chinese ink wash style — it exists as a painting on a silk scroll, but the ink is wet, alive, moving. The egg shifts and ripples on the scroll's surface, drawn in masterful brushstrokes that rearrange themselves. Mountains, clouds, and pine trees frame the painted egg in classic shan shui composition. The scroll hangs in an empty studio. A brush and inkstone sit nearby, unused — the painting paints itself. The egg is art contemplating its own existence. East Asian aesthetic, living painting, ink as life. No text, no people.",
    hatchPrompt:
      'The ink egg on the scroll begins to bleed outward — ink flowing beyond the egg shape, spreading across the silk in rapid brushstrokes that draw themselves. A dragon takes form in real-time — each scale a masterful ink dot, each whisker a single confident stroke, its body a flowing river of ink. The painted dragon peels off the scroll and enters three-dimensional space — still made of ink, dripping black drops that fall and become tiny ink flowers on the studio floor. It flies through the room, leaving ink-wash landscapes on every surface it passes: mountains on the walls, rivers on the floor, clouds on the ceiling. The studio becomes a living painting. Ink birth, art becomes reality. No text, no people.',
  },
  {
    id: 45,
    title: 'Soap Bubble',
    eggPrompt:
      'A dragon egg that is a soap bubble — floating in a sunny meadow, impossibly large (three feet across) and impossibly durable. Its surface shimmers with iridescent rainbow oil-slick patterns that never repeat. Inside the transparent sphere, a tiny dragon curls in sleep, visible as a dark silhouette against the swirling colors. Dandelion seeds drift past. Butterflies investigate. The bubble drifts on warm thermals, rising and falling gently. It should pop. It never pops. Whimsical, delicate, childhood wonder. No text, no people.',
    hatchPrompt:
      "A child's laugh carries on the wind (unseen, unshown). The soap bubble egg wobbles, then pops — but instead of vanishing, it divides into a thousand smaller bubbles, each containing a fragment of rainbow. From the center, a dragon materializes from iridescent soap film — its wings are bubble-thin membranes showing rainbow interference patterns, its body shimmers like an oil slick on water, its eyes are tiny convex mirrors reflecting the whole meadow. It chases the thousand scattered bubbles, catching each one and absorbing it back — growing more colorful, more complete. When the last bubble pops against its nose, it sneezes and a stream of fresh bubbles erupts from its nostrils. Whimsical birth, bubble dragon, joy incarnate. No text, no people.",
  },
  {
    id: 46,
    title: 'Northern Light',
    eggPrompt:
      "A dragon egg floating in the aurora borealis itself — suspended in the magnetic field lines of Earth's poles, embedded in the shimmering green and purple curtains of light. The egg is made of aurora — compressed electromagnetic radiation given form. It pulses and ripples with the aurora's rhythm. Below, a frozen arctic landscape stretches to the horizon. The egg is only visible during geomagnetic storms — amateur photographers sometimes capture it accidentally and dismiss it as lens flare. It has been dancing in the northern lights since the Earth developed a magnetic field. Atmospheric wonder, polar beauty, celestial egg. No text, no people.",
    hatchPrompt:
      'The aurora intensifies — greens, purples, and rare reds blazing across the arctic sky. The egg absorbs the aurora around it, creating a dark spot in the light show — a hole where the lights should be. Then it releases everything at once: a coronal mass ejection of beauty. The aurora dragon erupts upward — a serpentine creature made of northern lights, undulating across the sky, its body the aurora itself given form and will. It weaves new light patterns: spirals, helices, shapes the aurora has never made naturally. People below (unseen) gasp. Cameras capture something impossible. Tomorrow scientists will have no explanation. Aurora birth, atmospheric dragon, sky serpent. No text, no people.',
  },

  // Additional variety
  {
    id: 47,
    title: 'Honey Comb',
    eggPrompt:
      "A dragon egg made of beeswax and honey, hidden in the center of a cathedral-sized beehive in an ancient oak tree. The egg is hexagonal in cross-section — honeycombed — and translucent amber. Thousands of bees tend it, fanning it with their wings to regulate temperature, feeding it royal jelly. The hive is enormous, filling the entire hollow trunk. Honey drips down the walls in golden rivulets. The air is thick with warmth, sweetness, and the hypnotic hum of a million wings. The egg pulses with the hive's collective heartbeat. Organic wonder, golden warmth, colony life. No text, no people.",
    hatchPrompt:
      'The bees form a perfect sphere around the egg — every bee in the colony landing on it simultaneously. They vibrate their wings in unison — a frequency that resonates through the wax. The hexagonal egg softens, melts, and from the golden honey emerges a dragon covered in fur like a bumblebee — black and gold stripes, translucent wings that buzz at hummingbird speed. It is warm, fuzzy, and immediately begins producing honey from glands along its spine. The bees accept it as their queen. It lifts off, surrounded by a swarm escort of thousands, and the oak tree blooms out of season. Bee-dragon, colony birth, sweet warmth. No text, no people.',
  },
  {
    id: 48,
    title: 'Obsidian Mirror',
    eggPrompt:
      "A dragon egg carved from a single piece of obsidian — so polished it is a perfect black mirror. It sits on a stone pedestal in an Aztec temple ruin, positioned to catch the setting sun. When sunlight hits its surface, it doesn't reflect the sun — it reflects stars. A night sky is visible in its surface regardless of the time of day. The temple walls are carved with feathered serpent imagery. Jungle vines encroach but don't touch the egg. The obsidian surface is warm despite being in shadow. Mesoamerican aesthetic, cosmic mirror, archaeological mystery. No text, no people.",
    hatchPrompt:
      "At equinox, the sun aligns perfectly with the temple passage and hits the obsidian egg directly. The stars reflected in its surface swirl into a galaxy — a spiral forming on the egg's surface. The obsidian cracks along the spiral arm patterns. A feathered dragon emerges — Quetzalcoatl reborn — iridescent green and blue feathers, no wings but undulating through the air like a serpent through water. Its body is impossibly long, coiling around the temple ruins. Where its feathers brush the stone, ancient carvings glow gold. The jungle parts before it. It rises above the canopy and the temple below glows like it did a thousand years ago. Feathered serpent birth, Mesoamerican revival. No text, no people.",
  },
  {
    id: 49,
    title: 'Paper Lantern',
    eggPrompt:
      "A dragon egg made of rice paper and bamboo — a lantern egg — glowing from within with warm orange light. It floats above a still lake in rural China during a lantern festival. Thousands of normal paper lanterns drift upward around it, but this one is different: it doesn't rise, it hovers, and the light inside it moves. Reflections of all the lanterns shimmer on the lake surface. Mountains silhouette against the twilight sky. The egg-lantern has been appearing at this festival for a hundred years. Locals make wishes to it. Chinese aesthetic, festival warmth, magical realism. No text, no people.",
    hatchPrompt:
      'The rice paper egg catches fire — but burns from the inside out, the flame tracing dragon-scale patterns across its surface before the paper falls away as glowing ash. A dragon made of paper and light unfolds — an origami dragon that crinkles and rustles with each movement, lit from within by a warm amber glow. It is delicate as a prayer. It flies among the other lanterns, and each one it touches transforms — plain paper lanterns becoming intricately painted with dragon scenes. The lake below reflects a hundred illuminated stories. The dragon rises higher than the others, becoming the brightest light in the sky. Lantern birth, paper dragon, festival magic. No text, no people.',
  },
  {
    id: 50,
    title: 'The Last Egg',
    eggPrompt:
      'A single, simple dragon egg sitting on a wooden shelf in a cottage kitchen. It is unremarkable — grey-brown, the size of an ostrich egg, slightly warm. A grandmother has been keeping it by the hearth for forty years, thinking it was a river stone her husband found. A cat sleeps next to it. A kettle steams. Afternoon light through lace curtains. It is the most ordinary setting for the most extraordinary object. No magic visible, no drama, no spectacle. Just an egg in a kitchen, waiting. Quiet domesticity, hidden wonder, the magic in ordinary places. No text, no people.',
    hatchPrompt:
      'The egg cracks quietly — a soft ticking sound, like a clock. The cat wakes up, ears forward. The shell falls away in neat pieces, and a small dragon sits on the kitchen shelf — the size of a kitten, grey-brown like its shell, warm like the hearth. It yawns, showing tiny teeth. It stretches, showing small wings. It looks around the kitchen with mild curiosity. It is not dramatic. It is not spectacular. It is simply, quietly, wonderfully alive. It hops down to the warm spot by the hearth where the cat was sleeping. The cat investigates. They sniff each other. The cat curls up next to the dragon. The kettle whistles. The most ordinary miracle. Quiet birth, domestic magic, gentle wonder. No text, no people.',
  },
];

// Episodes 51-100: Variations on the same egg types with different settings
const EPISODE_VARIATIONS: EggEpisode[] = [];
for (let i = 51; i <= 100; i++) {
  const base = EPISODES[(i - 51) % EPISODES.length];
  const variation = i - 50;
  EPISODE_VARIATIONS.push({
    id: i,
    title: `${base.title} II`,
    eggPrompt: base.eggPrompt
      .replace(/\. /g, '. Alternative angle: ')
      .replace(
        /No text, no people\./,
        `Different time of day, dramatic lighting variation. Take ${variation}. No text, no people.`
      ),
    hatchPrompt: base.hatchPrompt.replace(
      /No text, no people\./,
      `Unique hatching variation ${variation}, different camera angle and timing. No text, no people.`
    ),
  });
}

const ALL_EPISODES = [...EPISODES, ...EPISODE_VARIATIONS];

// ── Video Generation + Firestore ────────────────────────────────────────

interface GeneratedClip {
  sceneId: string;
  title: string;
  videoUrl: string;
  generationId: string;
  prompt: string;
}

async function generateAndStore(
  episodeNum: number,
  sceneType: 'egg' | 'hatching',
  prompt: string,
  title: string
): Promise<GeneratedClip> {
  const sceneLabel = sceneType === 'egg' ? 'Egg Scene' : 'Egg Hatching';
  const fullTitle = `Ep ${episodeNum}: ${title} — ${sceneLabel}`;

  console.log(`\n  Prompt (${prompt.length} chars): ${prompt.slice(0, 120)}...`);
  console.log(`  Model: seedance-2.0 | Duration: 8s | Audio: true`);

  if (DRY_RUN) {
    return {
      sceneId: `${episodeNum}-${sceneType}`,
      title: fullTitle,
      videoUrl: `https://dry-run/ep${episodeNum}-${sceneType}.mp4`,
      generationId: `dry-${randomUUID().slice(0, 8)}`,
      prompt,
    };
  }

  const videoUrl = await generateSeedanceVideo(prompt, 8, true);
  const generationId = randomUUID();

  // Persist generation record
  await db
    .collection('videoGenerations')
    .doc(generationId)
    .set({
      id: generationId,
      prompt,
      model: 'seedance-2.0',
      mode: 'text_to_video',
      videoUrl,
      status: 'completed',
      universeId: UNIVERSE_ID,
      creatorUid: CREATOR_ADDRESS,
      sceneId: `${episodeNum}-${sceneType}`,
      sceneTitle: fullTitle,
      episodeTitle: `Dragon Egg — ${title}`,
      durationSec: 8,
      hasAudio: true,
      createdAt: new Date(),
      completedAt: new Date(),
    });

  // Publish to gallery
  await db.collection('content').add({
    title: fullTitle,
    description: prompt.slice(0, 300),
    mediaUrl: videoUrl,
    mediaType: 'ai-video',
    classification: 'original',
    tags: ['dragon-egg', `episode-${episodeNum}`, sceneType],
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
    generationModel: 'seedance-2.0',
  });

  console.log(`  Done: ${videoUrl.slice(0, 80)}...`);
  return {
    sceneId: `${episodeNum}-${sceneType}`,
    title: fullTitle,
    videoUrl,
    generationId,
    prompt,
  };
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  const episodes = RUN_ALL ? ALL_EPISODES : [ALL_EPISODES[0]];
  const filtered = episodes.filter((e) => e.id >= START_FROM);

  console.log(`
${'='.repeat(60)}
  DRAGON EGG — Video Generation Pipeline
${'='.repeat(60)}
  Universe  : ${UNIVERSE_ID}
  Model     : seedance-2.0
  Episodes  : ${filtered.length} (${filtered[0]?.id}–${filtered[filtered.length - 1]?.id})
  Scenes    : ${filtered.length * 2} (2 per episode)
  Dry Run   : ${DRY_RUN}
  Mode      : ${RUN_ALL ? 'FULL (100 episodes)' : 'TEST (1 episode)'}
`);

  const allClips: GeneratedClip[] = [];
  let failCount = 0;

  for (const ep of filtered) {
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`  Episode ${ep.id}: ${ep.title}`);
    console.log(`${'─'.repeat(50)}`);

    // Scene 1: Egg
    console.log(`\n  [1/2] Egg Scene`);
    try {
      const clip = await generateAndStore(ep.id, 'egg', ep.eggPrompt, ep.title);
      allClips.push(clip);
    } catch (err) {
      failCount++;
      console.error(`  FAILED: ${(err as Error).message}`);
      if (failCount > 5) {
        console.error('\n  Too many failures, stopping.');
        break;
      }
      await new Promise((r) => setTimeout(r, 10000));
    }

    // Scene 2: Hatching
    console.log(`\n  [2/2] Egg Hatching Scene`);
    try {
      const clip = await generateAndStore(ep.id, 'hatching', ep.hatchPrompt, ep.title);
      allClips.push(clip);
    } catch (err) {
      failCount++;
      console.error(`  FAILED: ${(err as Error).message}`);
      if (failCount > 5) {
        console.error('\n  Too many failures, stopping.');
        break;
      }
      await new Promise((r) => setTimeout(r, 10000));
    }

    // Create episode document
    if (allClips.length >= 2) {
      const epClips = allClips.filter((c) => c.sceneId.startsWith(`${ep.id}-`));
      if (epClips.length === 2) {
        const episodeId = randomUUID();
        await db
          .collection('episodes')
          .doc(episodeId)
          .set({
            id: episodeId,
            title: `Dragon Egg — ${ep.title}`,
            description: `Episode ${ep.id}: ${ep.title}. A dragon egg rests in its element, then hatches into new life.`,
            universeId: UNIVERSE_ID,
            creatorUid: CREATOR_ADDRESS,
            clips: epClips.map((c, i) => ({
              nodeId: c.generationId,
              label: c.title,
              videoUrl: c.videoUrl,
              trimStart: 0,
              trimEnd: 0,
              order: i,
            })),
            status: 'draft',
            totalClips: 2,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        console.log(`  Episode saved: ${episodeId}`);
      }
    }

    // Cooldown between episodes
    if (!DRY_RUN && filtered.indexOf(ep) < filtered.length - 1) {
      console.log('\n  Cooling down 5s...');
      await new Promise((r) => setTimeout(r, 5000));
    }
  }

  console.log(`
${'='.repeat(60)}
  DRAGON EGG — GENERATION COMPLETE
${'='.repeat(60)}
  Episodes  : ${filtered.length}
  Clips     : ${allClips.length}/${filtered.length * 2}
  Failed    : ${failCount}
  Universe  : ${UNIVERSE_ID}
${'='.repeat(60)}
`);

  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
