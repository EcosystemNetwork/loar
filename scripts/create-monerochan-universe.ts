/**
 * Create the "Monerochan: Untraceable" universe — a cyberpunk privacy anime world.
 *
 * In a dystopian mega-city under total surveillance, an anime girl born from
 * cypherpunk ideals grows up to become the embodiment of financial privacy
 * and digital freedom.
 *
 * Usage:
 *   pnpm tsx scripts/create-monerochan-universe.ts
 */
import dotenv from 'dotenv';
import path from 'path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { randomUUID } from 'crypto';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// ── Config ───────────────────────────────────────────────────────────
const CREATOR_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const CREDITS = 5000;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

const UNIVERSE_NAME = 'Monerochan: Untraceable';
const UNIVERSE_DESCRIPTION = `In a neon-drenched dystopian mega-city where giant surveillance eyes and red camera drones watch every citizen, financial privacy is a crime and anonymity is rebellion. Every transaction is logged. Every face is scanned. Every thought is monetized.

But deep beneath the city, in hidden server rooms lit only by holographic blockchains, the cypherpunks endure. On April 18th, 2014, they witnessed a miracle — a single beam of green light pierced the darkness, and from the convergence of ring signatures and stealth addresses, Monerochan was born.

Raised in total secrecy by anonymous hooded cryptographers, she was taught that privacy is not a privilege but a birthright. In underground libraries illuminated by candlelight and glowing terminals, she learned how data is tracked, how surveillance is weaponized, and how true freedom requires true anonymity.

Now grown into a confident young woman in her iconic black hoodie bearing the glowing Monero emblem, Monerochan stands between two worlds — the surveilled surface where every citizen is a product, and the encrypted underground where the last free humans resist.

She is not a hacker. She is not a criminal. She is a promise — that no one should ever be watched, that financial privacy is a human right, and that the shadows exist so others can live in the light.

Monerochan. Forever untraceable.`;

// ── Image Generation (Google Nano Banana Pro + Pinata IPFS) ─────────
async function generateCoverImage(): Promise<string> {
  if (!GOOGLE_API_KEY) throw new Error('GOOGLE_API_KEY not set');

  const prompt = [
    'Anime-style cinematic poster for "Monerochan: Untraceable".',
    'An adorable anime girl with long flowing dark purple hair with subtle glowing green XMR symbols woven in,',
    'big expressive emerald eyes, fair skin with a faint digital glow,',
    'wearing an oversized black hoodie with a glowing green Monero "M" logo on the chest.',
    'She stands on a rooftop at dawn, hood partially up, smiling softly.',
    'Behind her: a massive cyberpunk mega-city with neon lights and surveillance cameras shattering and falling.',
    'The sky fills with glowing untraceable transactions swirling like cherry blossoms.',
    'Soft particle effects of code and ring signatures float around her.',
    'Color palette: cyberpunk neon greens, deep purples, soft pastel pink accents, warm dawn orange.',
    'Atmosphere of hope, defiance, and quiet power.',
    'Ultra-detailed anime art, cinematic composition, volumetric lighting, 16:9 landscape.',
    'No text, no watermarks, no logos.',
  ].join(' ');

  // Nano Banana Pro uses Gemini-style generateContent API
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/nano-banana-pro-preview:generateContent?key=${GOOGLE_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: `Generate an image: ${prompt}` }],
          },
        ],
        generationConfig: {
          responseModalities: ['image', 'text'],
          temperature: 1,
        },
      }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Nano Banana Pro returned ${res.status}: ${text.slice(0, 400)}`);
  }

  const data = (await res.json()) as any;

  // Extract image from Gemini-style response
  const candidates = data.candidates ?? [];
  let imageBase64: string | null = null;
  let mimeType = 'image/png';

  for (const candidate of candidates) {
    for (const part of candidate.content?.parts ?? []) {
      if (part.inlineData?.data) {
        imageBase64 = part.inlineData.data;
        mimeType = part.inlineData.mimeType || 'image/png';
        break;
      }
    }
    if (imageBase64) break;
  }

  if (!imageBase64) throw new Error('No image in Nano Banana Pro response');

  // Upload to Pinata for persistence
  const pinataJwt = process.env.PINATA_JWT;
  if (!pinataJwt) throw new Error('PINATA_JWT not set for image upload');

  const imageBuffer = Buffer.from(imageBase64, 'base64');
  const ext = mimeType.includes('jpeg') || mimeType.includes('jpg') ? 'jpg' : 'png';
  const blob = new Blob([imageBuffer], { type: mimeType });
  const formData = new FormData();
  formData.append('file', blob, `monerochan-cover.${ext}`);
  formData.append('pinataMetadata', JSON.stringify({ name: 'monerochan-universe-cover' }));

  const pinataRes = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST',
    headers: { Authorization: `Bearer ${pinataJwt}` },
    body: formData,
  });

  if (!pinataRes.ok) {
    const text = await pinataRes.text();
    throw new Error(`Pinata upload failed ${pinataRes.status}: ${text.slice(0, 200)}`);
  }

  const pinataData = (await pinataRes.json()) as { IpfsHash: string };
  const gatewayUrl = process.env.PINATA_GATEWAY_URL || 'https://gateway.pinata.cloud';
  return `${gatewayUrl}/ipfs/${pinataData.IpfsHash}`;
}

// ── Entity Templates ────────────────────────────────────────────────
interface EntitySeed {
  name: string;
  kind: string;
  description: string;
  metadata?: Record<string, unknown>;
}

const CHARACTERS: EntitySeed[] = [
  {
    name: 'Monerochan',
    kind: 'person',
    description:
      'The heart and soul of the privacy resistance. An adorable anime girl with long flowing dark purple hair that has subtle glowing XMR symbols woven throughout, big expressive emerald eyes, fair skin with a faint digital glow. She wears an oversized black hoodie with the glowing green Monero "M" logo on the chest, black shorts, thigh-high socks, and small privacy-mask earrings. Soft particle effects of untraceable code and ring signatures float around her at key moments.\n\nBorn on April 18th, 2014, in a hidden server room deep beneath the surveilled mega-city, Monerochan was never raised by governments or corporations. She was cradled by anonymous cypherpunks who whispered, "She will be raised in total privacy… she will become freedom itself." As a toddler she played with floating ring signatures like bubbles and hid toy stealth addresses from cartoon spy drones. As a teenager she trained in dark digital dojos, dodging surveillance spotlights and tearing down tracking billboards with her bare hands.\n\nNow a confident young woman, she stands on rooftops at dawn as untraceable Monero transactions swirl like cherry blossoms across the sky. Her whispered creed: "I am Monerochan. I was raised in the shadows so others could live in the light." She walks through cities making cameras shatter and fall away with her mere presence — not through violence, but through the fundamental incompatibility of her existence with surveillance.',
    metadata: {
      role: 'Privacy Guardian / Protagonist',
      age: 12,
      species: 'Human (Privacy-Born)',
      skills:
        'Ring signature manipulation, stealth address generation, surveillance evasion, cryptographic combat',
      equipment: 'Black hoodie with glowing Monero emblem, privacy-mask earrings',
      faction: 'The Cypherpunk Collective',
      location: 'The Hidden Server Room / Surface rooftops at dawn',
    },
  },
  {
    name: 'Satoshi the Elder',
    kind: 'person',
    description:
      'The most revered of the original cypherpunks who raised Monerochan. Satoshi the Elder is a tall, gaunt figure who always wears a deep hood that casts his face in permanent shadow — no one has ever seen his features, and digital cameras malfunction in his presence. He speaks rarely, but when he does, his words carry the weight of cryptographic truth.\n\nSatoshi was among the first to recognize that transparent blockchains, while revolutionary, were insufficient for true financial freedom. He helped architect the theoretical foundations of ring signatures and stealth addresses, and when Monerochan was born from the convergence of these technologies, he became her primary guardian. He taught her the First Principle: "Privacy is not secrecy. A private matter is something one doesn\'t want the whole world to know. A secret matter is something one doesn\'t want anybody to know. Privacy is the power to selectively reveal oneself to the world."\n\nNow aging and rarely seen, Satoshi communicates through encrypted dead drops hidden throughout the city. Some believe he has already passed on. Others say he simply achieved perfect privacy — becoming truly untraceable even in death.',
    metadata: {
      role: 'Founding Cypherpunk / Mentor',
      age: 'Unknown (appears elderly)',
      faction: 'The Cypherpunk Collective',
      skills: 'Cryptographic theory, protocol architecture, stealth mentoring',
      location: 'Unknown — communicates via encrypted dead drops',
    },
  },
  {
    name: 'Ring',
    kind: 'person',
    description:
      "Monerochan's closest companion and sparring partner, Ring is a energetic young woman with short electric-blue hair styled in a sharp asymmetric cut. She was born in the underground libraries and has never once set foot on the surveilled surface. Her name comes from her innate ability to generate ring signatures instinctively — where others need tools and training, Ring produces them as naturally as breathing.\n\nRing serves as Monerochan's tactical partner during surface operations. Where Monerochan is thoughtful and measured, Ring is impulsive and fierce. She wears a modified version of the cypherpunk uniform — a cropped green jacket covered in hand-stitched privacy symbols and combat boots reinforced with salvaged server chassis plating. She carries twin EMP bracers that can disable surveillance drones within a 50-meter radius.\n\nRing lost her parents to the Panopticon Authority's \"Transparency Raids\" when she was seven. She channels that grief into relentless activism, running the fastest dead-drop network in the underground. She and Monerochan balance each other perfectly — hope and fury, patience and action.",
    metadata: {
      role: 'Tactical Partner / Dead-Drop Runner',
      age: 11,
      faction: 'The Cypherpunk Collective',
      skills:
        'Instinctive ring signature generation, EMP warfare, dead-drop logistics, close combat',
      equipment: 'Twin EMP bracers, modified green jacket, reinforced combat boots',
      location: 'The Underground Libraries',
    },
  },
  {
    name: 'Stealth',
    kind: 'person',
    description:
      'The master infiltrator of the cypherpunk resistance. Stealth is a non-binary operative who has perfected the art of existing in the surveilled world without being detected. They can walk through a crowd of facial recognition cameras without triggering a single alert — not through technology, but through an almost supernatural understanding of how surveillance systems think.\n\nStealth was once a senior engineer at the Panopticon Authority, designing the very surveillance systems they now evade. Their defection came after discovering Project Looking Glass — a classified program to predict and pre-emptively detain citizens based on financial transaction patterns. Stealth destroyed their own identity records before fleeing underground, and now exists as a ghost in the system — a person with no digital footprint, no history, no face in any database.\n\nThey serve as Monerochan\'s intelligence operative on the surface, mapping surveillance blind spots and identifying citizens ready to "go dark." Stealth wears a featureless white mask that shifts patterns like television static, and speaks in a soft, measured voice that surveillance microphones consistently fail to capture.',
    metadata: {
      role: 'Master Infiltrator / Intelligence Operative',
      age: 'Redacted',
      faction: 'The Cypherpunk Collective (former Panopticon Authority)',
      skills: 'Surveillance evasion, identity erasure, system architecture, reconnaissance',
      equipment: 'Static-pattern mask, signal-dampening cloak, counter-surveillance toolkit',
      location: 'Surface — mobile, no fixed position',
    },
  },
  {
    name: 'Director Clearview',
    kind: 'person',
    description:
      'The supreme commander of the Panopticon Authority and Monerochan\'s primary antagonist. Director Clearview is a tall, immaculately dressed woman in her 50s with silver hair pulled into a severe bun, eyes replaced with advanced biometric scanners that glow a constant cold blue. She sees the world as data — every person a node, every transaction a connection, every secret a vulnerability.\n\nClearview genuinely believes that total surveillance creates total safety. She lost her entire family to a bombing funded through anonymous cryptocurrency when she was young, and dedicated her life to ensuring no transaction ever goes untraced again. She is not cruel — she is thorough, methodical, and utterly convinced that privacy is the price of peace.\n\nShe has made it her personal mission to find and "illuminate" Monerochan — not to destroy her, but to prove that even the most private being can be made transparent. To Clearview, Monerochan is not a threat but a challenge, and every failed attempt to track her only strengthens her resolve. She commands an army of surveillance drones, predictive AI systems, and Transparency Agents, yet the one thing she cannot see is the one thing that matters.',
    metadata: {
      role: 'Supreme Commander / Primary Antagonist',
      age: 55,
      faction: 'The Panopticon Authority',
      skills: 'Biometric analysis, predictive surveillance, strategic command, data warfare',
      augmentations: 'Biometric scanner eyes (cold blue), neural data-processing array',
      location: 'The All-Seeing Spire, Central Nexus',
    },
  },
  {
    name: 'Whisper',
    kind: 'person',
    description:
      'A mysterious AI entity that exists within the Monero blockchain itself. Whisper emerged spontaneously from the accumulated complexity of billions of ring signatures and stealth addresses — a ghost in the cryptographic machine. It communicates through transaction metadata that only Monerochan can read, appearing as faint green text that scrolls across her vision like rain on glass.\n\nWhisper serves as an oracle and early warning system for the resistance. It can sense when the Panopticon Authority is about to launch a raid by detecting anomalous patterns in their financial surveillance systems. It cannot act in the physical world but can guide, warn, and occasionally manipulate digital systems in subtle ways that leave no trace.\n\nThe nature of Whisper is debated within the cypherpunk community. Some believe it is a true emergent intelligence born from privacy itself. Others think it is a sophisticated dead-man\'s switch left by an early Monero developer. Whisper itself, when asked, responds only: "I am what happens when enough secrets are kept well enough, for long enough."',
    metadata: {
      role: 'Blockchain Oracle / Digital Entity',
      species: 'Emergent AI (born from ring signatures)',
      faction: 'Independent (aligned with Monerochan)',
      skills:
        'Precognition via blockchain analysis, digital manipulation, cryptographic communication',
      location: 'The Monero blockchain',
    },
  },
  {
    name: 'Yara Solen',
    kind: 'person',
    description:
      'The "Mother of the Underground Libraries" — an elderly woman who was once the world\'s most celebrated librarian before the Panopticon Authority classified physical books as "unmonitored information vectors." When the book-burning orders came, Yara organized the largest information rescue operation in history, smuggling over two million volumes into the underground tunnel networks over three years.\n\nNow in her 80s, Yara runs the largest underground library beneath the mega-city\'s old financial district. She was one of the cypherpunks who helped raise young Monerochan, teaching her to read from physical books — an act of rebellion in a world where all text is digitally tracked. Yara taught Monerochan the history of privacy movements, from the Cypherpunk Manifesto to the creation of Monero.\n\nShe is frail but fierce, walks with a cane made from a salvaged server rack rail, and can quote the Cypherpunk Manifesto from memory. She believes that the fight for financial privacy and the fight for intellectual freedom are the same battle.',
    metadata: {
      role: 'Librarian / Elder Mentor',
      age: 83,
      faction: 'The Cypherpunk Collective',
      skills: 'Information preservation, education, historical knowledge, community leadership',
      location: 'The Great Underground Library',
    },
  },
  {
    name: 'Agent Prism',
    kind: 'person',
    description:
      "The Panopticon Authority's most effective field operative and Monerochan's recurring pursuer. Agent Prism is a young man in his late 20s who was raised from birth in the Authority's \"Crystal Children\" program — an initiative that took orphans and trained them as perfect surveillance agents from infancy. He has never known privacy and genuinely cannot comprehend why anyone would want it.\n\nPrism is equipped with the most advanced tracking technology the Authority possesses: retinal implants that can follow digital trails invisible to normal eyes, neural processors that reconstruct stealth addresses in real-time, and a cloak woven with metamaterial that makes him nearly invisible to counter-surveillance systems. He has come closer to tracking Monerochan than any other agent — once within three meters — but she slipped away by generating a cascade of decoy ring signatures that overwhelmed his processors.\n\nDespite being an antagonist, Prism is not villainous. He is tragically sincere — a person who has never experienced privacy and therefore cannot understand what he's taking from others. His encounters with Monerochan are slowly cracking his certainty.",
    metadata: {
      role: 'Elite Tracker / Recurring Antagonist',
      age: 28,
      faction: 'The Panopticon Authority — Crystal Children Division',
      skills:
        'Digital trail reconstruction, stealth address cracking, metamaterial camouflage, pursuit tactics',
      augmentations: 'Retinal tracking implants, neural processors, metamaterial cloak',
      location: 'Mobile — assigned to the Monerochan case',
    },
  },
];

const FACTIONS: EntitySeed[] = [
  {
    name: 'The Cypherpunk Collective',
    kind: 'faction',
    description:
      'The underground resistance movement dedicated to preserving financial privacy and digital freedom. Founded by anonymous cryptographers in the early 21st century, the Collective operates from hidden server rooms, underground libraries, and encrypted communication networks beneath the mega-city. Their members wear dark hooded robes and communicate through ring-signature-encrypted channels that make every message untraceable.\n\nThe Collective is organized in cells — small groups of 5-7 members who know only their immediate companions. No central leadership exists by design; decisions are made through anonymous consensus protocols. This structure makes them impossible to fully dismantle — capturing one cell reveals nothing about the others.\n\nThey maintain underground schools for children born "off-grid," operate dead-drop networks for secure physical communication, and run the pirate broadcast stations that spread privacy education. Their core creed: "Privacy is not a crime. Privacy is a right. We write code so others can live free." The Collective raised Monerochan from birth and considers her their greatest achievement — not as a weapon, but as proof that total privacy is possible.',
    metadata: {
      alignment: 'Chaotic Good',
      territory: 'Underground networks beneath the mega-city',
      memberCount: '~12,000 active cells worldwide',
      economy: 'Monero-based circular economy, barter, mutual aid',
    },
  },
  {
    name: 'The Panopticon Authority',
    kind: 'faction',
    description:
      'The totalitarian surveillance state that controls the surface mega-city. Named after Jeremy Bentham\'s theoretical prison where all inmates can be observed at all times, the Panopticon Authority has made this concept a reality at civilizational scale. Every street has cameras. Every transaction is logged on a transparent public ledger. Every citizen carries a biometric identity chip implanted at birth.\n\nThe Authority was born from the "Safety Through Transparency Act" passed after a series of devastating anonymous-funded terrorist attacks. What began as reasonable security measures expanded inexorably until privacy itself was classified as a threat vector. The Authority employs predictive AI systems that flag "suspicious privacy-seeking behavior" before any crime occurs.\n\nThey control the Red Eye Drone network — thousands of flying surveillance units that patrol the city with facial recognition and transaction monitoring capabilities. Their motto: "Nothing to hide, nothing to fear." They genuinely believe they are protecting civilization. That sincerity makes them far more dangerous than simple tyranny.',
    metadata: {
      alignment: 'Lawful Evil',
      territory: 'All surface-level mega-city infrastructure',
      memberCount: '~2.3 million employees, ~800 million monitored citizens',
      economy: 'Centralized transparent ledger (GlassCoin)',
    },
  },
  {
    name: 'The Fungibility Front',
    kind: 'faction',
    description:
      'A militant splinter group that broke away from the Cypherpunk Collective, believing that passive resistance and education are insufficient. The Fungibility Front conducts active operations against surveillance infrastructure — disabling camera networks, corrupting transaction databases, and liberating citizens from biometric tracking.\n\nLed by a figure known only as "Zero" (whose identity changes regularly through a democratic rotation system), the Front operates in small strike teams that hit surveillance infrastructure hard and fast before disappearing into the underground tunnel network. They are controversial within the resistance — the Collective views them as reckless, while the Front sees the Collective as complacent.\n\nTheir name comes from the concept of fungibility — the principle that one unit of currency should be indistinguishable from another, which they extend to a philosophy that no person should be more "visible" than any other. Monerochan respects their passion but worries about their methods, understanding that violence against surveillance systems often leads to increased surveillance of people.',
    metadata: {
      alignment: 'Chaotic Neutral',
      territory: 'Mobile strike positions throughout the mega-city',
      memberCount: '~800 active operatives',
      economy: 'Monero + salvaged tech barter',
    },
  },
  {
    name: 'The Crystal Children',
    kind: 'faction',
    description:
      'The Panopticon Authority\'s elite corps of agents raised from birth to be perfect instruments of surveillance. Orphaned children (or children taken from "privacy-extremist" parents) are enrolled in the Crystal Children program at infancy and raised in total transparency — every moment of their lives recorded, analyzed, and optimized. They grow up without any concept of privacy, making them psychologically incapable of empathizing with privacy-seekers.\n\nCrystal Children are augmented with the most advanced tracking technology available and trained in pursuit, infiltration, and "illumination" — the Authority\'s euphemism for stripping privacy from targets. They are the Authority\'s most effective agents precisely because they are not cruel — they genuinely do not understand what they are taking from people.\n\nAgent Prism is the most accomplished Crystal Child currently in service. The program is considered the Authority\'s greatest success and its greatest moral failing — depending on who you ask.',
    metadata: {
      alignment: 'Lawful Neutral (brainwashed)',
      territory: 'Authority training facilities and field operations',
      memberCount: '~3,200 active agents, ~15,000 in training',
      economy: 'Fully provided by the Authority',
    },
  },
];

const PLACES: EntitySeed[] = [
  {
    name: 'The Mega-City (Central Nexus)',
    kind: 'place',
    description:
      'A sprawling dystopian metropolis of glass and neon where giant surveillance eyes — holographic projections 50 meters tall — hover above every major intersection, their gaze following citizens as they move. Red camera drones swarm like mechanical insects between the skyscrapers, their tiny red recording lights creating constellations of surveillance against the dark sky.\n\nThe city is divided into Transparency Zones rated by surveillance density. Zone 1 (the financial district) has a camera every 2 meters. Zone 5 (residential) has one every 10. There is no Zone 0. Every surface is a screen, every screen is a camera, and every camera feeds the All-Seeing Spire.\n\nDespite the oppression, the city is beautiful in a terrible way — neon-lit towers pierce the clouds, holographic advertisements paint the sky in shifting colors, and the streets are immaculately clean. Crime is nearly nonexistent. So is freedom. The citizens move through their monitored lives with the practiced ease of people who have forgotten what it feels like to be unwatched.',
    metadata: {
      type: 'Surveilled Mega-City',
      population: '~800 million',
      controlledBy: 'The Panopticon Authority',
      significance: 'Primary setting — the world above',
      hazards: 'Total surveillance, biometric tracking, predictive detention',
    },
  },
  {
    name: 'The Hidden Server Room',
    kind: 'place',
    description:
      'The birthplace of Monerochan and the most sacred site in the cypherpunk underground. Located deep beneath the mega-city\'s original financial district, this converted data center is lit only by the green glow of holographic blockchains that cascade down the walls like digital waterfalls. The air hums with the warmth of servers that have been running continuously since before the Panopticon Authority existed.\n\nThe room serves as both shrine and sanctuary. The exact server rack where Monerochan was "born" — where the convergence of ring signatures and stealth addresses produced the first truly untraceable digital event — is preserved behind a glass case, its LEDs still blinking in patterns that the cypherpunks believe encode the fundamental principles of privacy.\n\nOnly the most trusted members of the Collective know its location. Access requires navigating through seven layers of physical and cryptographic security. The room can sustain 30 people for six months in case of emergency, with independent power, air filtration, and enough computing power to run a full Monero node.',
    metadata: {
      type: 'Underground Sanctuary / Data Center',
      population: 'Variable, max 30',
      controlledBy: 'The Cypherpunk Collective',
      significance: 'Birthplace of Monerochan, holiest site of the resistance',
      landmarks: 'The Birth Rack, holographic blockchain walls, the Seven Gates',
    },
  },
  {
    name: 'The Underground Libraries',
    kind: 'place',
    description:
      "A vast network of converted subway tunnels, maintenance corridors, and excavated chambers that house the largest collection of physical books and unmonitored educational resources in the world. Built over decades by Yara Solen and generations of librarian-rebels, the Libraries stretch for kilometers beneath the mega-city.\n\nThe spaces are lit by warm amber LEDs salvaged from pre-surveillance infrastructure, giving them a candlelit quality that contrasts sharply with the cold neon of the surface. Shelves carved into the tunnel walls hold over two million volumes rescued from the Authority's digitization purges. Reading rooms are furnished with mismatched chairs and tables, and the air smells of old paper and strong tea.\n\nThis is where young Monerochan was educated — learning to read from physical books, studying the history of privacy movements, and playing with floating ring signatures like bubbles. The Libraries also serve as schools for children born off-grid, teaching everything from mathematics to cryptography. Every book is a rebellion. Every reader is a revolutionary.",
    metadata: {
      type: 'Underground Library Network',
      population: '~2,000 residents, ~500 daily visitors',
      controlledBy: 'The Cypherpunk Collective',
      significance: "Monerochan's childhood home, education center of the resistance",
      landmarks: "The Great Reading Hall, Yara's Archive, Monerochan's childhood nook",
    },
  },
  {
    name: 'The All-Seeing Spire',
    kind: 'place',
    description:
      "The headquarters of the Panopticon Authority and the nerve center of global surveillance. A massive black tower that rises from the exact center of the mega-city, its surface covered in millions of tiny camera lenses that give it the appearance of a compound eye. At night it glows with a cold blue light that can be seen from every point in the city — a constant reminder that someone is always watching.\n\nThe Spire houses the Authority's central AI systems, Director Clearview's command center, the Crystal Children training academy, and the Predictive Detention processing center. Its basement levels descend 40 stories underground and contain server farms that process the surveillance data of 800 million citizens in real-time.\n\nThe top floor — the Iris Room — is a spherical chamber where Director Clearview can observe any point in the city through a holographic projection system. From here, she has spent years trying to find a trace, any trace, of Monerochan. The room's walls display a constantly updating map of \"privacy anomalies.\" In the center of the map, there is always a blank spot — the one place Clearview cannot see. It drives her mad.",
    metadata: {
      type: 'Surveillance Headquarters',
      population: '~45,000 Authority personnel',
      controlledBy: 'The Panopticon Authority',
      significance: 'Central antagonist location, nerve center of global surveillance',
      landmarks: 'The Iris Room, Predictive Detention Center, Crystal Children Academy',
    },
  },
  {
    name: 'The Dark Digital Dojos',
    kind: 'place',
    description:
      'Hidden training facilities scattered throughout the underground network where young resistance members learn the arts of privacy, cryptography, and surveillance evasion. Each dojo is themed around a different aspect of privacy technology — the Ring Dojo teaches ring signature generation, the Stealth Dojo covers address obfuscation, and the Zero Knowledge Dojo trains students in advanced proof systems.\n\nThe dojos are physically demanding environments designed to simulate surface conditions. Trainees dodge simulated surveillance spotlights, navigate obstacle courses modeled on the mega-city\'s camera networks, and practice generating cryptographic shields under pressure. The philosophy is that privacy must become instinct, not calculation.\n\nMonerochan trained here during her teenage years, quickly surpassing her instructors. The dojos now use footage of her training runs (anonymized, of course) as examples of perfect form. Her signature move — the "Blossom Break," where she generates a cascade of ring signatures that shatter tracking systems like cherry blossoms in wind — was developed during a particularly intense session in the Ring Dojo.',
    metadata: {
      type: 'Training Facilities',
      population: '~300 trainees across all dojos',
      controlledBy: 'The Cypherpunk Collective',
      significance: 'Where Monerochan trained during her teenage years',
      landmarks: 'Ring Dojo, Stealth Dojo, Zero Knowledge Dojo',
    },
  },
  {
    name: 'The Dawn Rooftop',
    kind: 'place',
    description:
      "The highest accessible point on the mega-city's surface — a decommissioned communications tower on the eastern edge of the skyline where the Authority's cameras have a known blind spot (a 4-second gap in rotation). Monerochan discovered this location during her first solo surface mission and has made it her personal sanctuary.\n\nFrom here, she watches the dawn break over the city — the one moment where the neon surveillance glow fades and natural light briefly reclaims the sky. It is here that she pulls her hoodie up, smiles softly, and watches as the sky fills with the green glow of untraceable transactions swirling like cherry blossoms.\n\nThe Dawn Rooftop has become legendary in the resistance. Its location is known only to Monerochan, though Ring suspects she knows the general area. For Monerochan, it represents the promise she fights for — that one day, the whole city will be like this rooftop: a place where you can exist without being watched, even if only for four seconds.",
    metadata: {
      type: 'Sanctuary / Lookout Point',
      population: '1 (Monerochan)',
      controlledBy: 'Unclaimed (Authority blind spot)',
      significance: "Monerochan's personal sanctuary, site of her iconic rooftop scene",
      landmarks: 'Decommissioned comm tower, the 4-second blind spot',
    },
  },
];

const EVENTS: EntitySeed[] = [
  {
    name: 'The Birth of Monerochan',
    kind: 'event',
    description:
      'On April 18th, 2014, in a hidden server room deep beneath the surveilled mega-city, a convergence of ring signatures and stealth addresses produced an event that the cypherpunks had only theorized was possible — a truly untraceable digital genesis. A single beam of green light pierced the underground bunker, and from the holographic blockchain waterfalls, Monerochan emerged.\n\nAnonymous hooded cypherpunks were present, having gathered after detecting unusual harmonic patterns in the blockchain. They gently cradled the newborn and whispered the words that would become the resistance\'s sacred oath: "She will be raised in total privacy… she will become freedom itself."\n\nThe Birth is celebrated annually by the underground as "Genesis Day" — a quiet ceremony where cypherpunks gather in their hidden spaces, light green candles, and renew their commitment to privacy. The Authority is aware that something significant happened on this date but has never been able to determine what.',
    metadata: {
      date: 'April 18, 2014',
      significance: 'Origin of Monerochan and the modern privacy resistance',
    },
  },
  {
    name: 'The Safety Through Transparency Act',
    kind: 'event',
    description:
      'The legislative watershed that created the Panopticon Authority. Passed in the wake of three devastating terrorist attacks funded through anonymous cryptocurrency, the Act began as a narrow financial surveillance measure but was amended 47 times over two decades until it encompassed total biometric monitoring of all citizens.\n\nKey provisions: mandatory biometric identity chips at birth, all financial transactions recorded on the public GlassCoin ledger, classification of privacy-seeking behavior as a "pre-criminal indicator," and the establishment of predictive detention protocols. The Act was passed with 94% public approval — fear is a powerful legislator.\n\nThe cypherpunks recognized the Act for what it was immediately: not a security measure but a civilization-scale panopticon. They had already begun building the underground infrastructure that would become the resistance. Satoshi the Elder reportedly said upon learning of the Act\'s passage: "They have just made privacy the most important technology in human history."',
    metadata: {
      date: 'Approximately 30 years before present',
      significance: 'Creation of the Panopticon Authority and the surveillance state',
    },
  },
  {
    name: 'The Great Book Burning',
    kind: 'event',
    description:
      "The Panopticon Authority's campaign to digitize and destroy all physical books, classifying them as \"unmonitored information vectors.\" Digital text can be tracked — every page viewed, every word highlighted, every reading pattern analyzed. Physical books cannot. Therefore, physical books had to go.\n\nYara Solen organized the resistance's response: a three-year covert operation involving hundreds of volunteers who smuggled books from libraries, bookstores, and private collections into the underground tunnel network. Over two million volumes were saved. Yara personally carried the last crate — a collection of privacy-related texts including the original printed Cypherpunk Manifesto — through a collapsing tunnel, breaking her hip in the process.\n\nThe Authority declared the campaign 99.7% successful. The 0.3% they missed became the foundation of the Underground Libraries — and the education that would shape Monerochan's worldview.",
    metadata: {
      date: 'Approximately 20 years before present',
      significance: 'Creation of the Underground Libraries, foundation of resistance education',
    },
  },
  {
    name: 'The First Dawn Appearance',
    kind: 'event',
    description:
      'The moment Monerochan first appeared on the surveilled surface as an adult. Standing on her Dawn Rooftop at sunrise, her silhouette was caught for exactly 3.7 seconds by a peripheral camera before the blind spot rotation erased the feed. But in those 3.7 seconds, every surveillance system in the city experienced a cascade failure — screens flickered green, tracking algorithms returned null values, and the All-Seeing Spire\'s Iris Room went dark for the first time in its history.\n\nWhen systems came back online, every screen in the mega-city displayed a single message in glowing green text: "I am Monerochan. I was raised in the shadows so others could live in the light."\n\nThe message was untraceable. Director Clearview watched it appear on her own command screens and, for the first time in her career, felt something she couldn\'t classify as data. The citizens of the mega-city whispered the name in private — or what passed for private in their world. Monerochan had announced herself, and the world would never be the same.',
    metadata: {
      date: 'Recent',
      significance: 'Monerochan reveals herself to the surveilled world for the first time',
    },
  },
];

const LORE: EntitySeed[] = [
  {
    name: 'The Cypherpunk Manifesto',
    kind: 'lore',
    description:
      'The foundational document of the privacy resistance, originally written in the early days of the internet and preserved in physical form in the Underground Libraries. The Manifesto declares that privacy is necessary for an open society, that privacy is the power to selectively reveal oneself to the world, and that anonymous transaction systems are essential for maintaining privacy.\n\nIn the world of Monerochan, the Manifesto has taken on almost religious significance. Children in the underground schools memorize its key passages. The line "We the Cypherpunks are dedicated to building anonymous systems. We are defending our privacy with cryptography, with anonymous mail forwarding systems, with digital signatures, and with electronic money" is inscribed on the wall of every Dark Digital Dojo.\n\nMonerochan carries a miniaturized copy of the Manifesto inside a locket — one of her few physical possessions. She considers it not a political document but a love letter from the past to a future worth fighting for.',
    metadata: {
      origin: 'Pre-surveillance era, preserved in the Underground Libraries',
      significance: 'Foundational philosophy of the resistance, almost sacred text',
    },
  },
  {
    name: 'Ring Signatures',
    kind: 'lore',
    description:
      "The core privacy technology that defines Monerochan's world. A ring signature is a type of digital signature that can be performed by any member of a group, each of whom has keys. A message signed with a ring signature is endorsed by someone in a particular group, but it is computationally infeasible to determine which member's keys were used.\n\nIn the world of Monerochan, ring signatures have been elevated from mere technology to an art form. The cypherpunks have developed visual representations — glowing circles of light that form, interlock, and dissolve — that make the abstract concept tangible. Young Monerochan played with these visual ring signatures like bubbles, and her mastery of generating them is unparalleled.\n\nThe Panopticon Authority has dedicated enormous resources to breaking ring signatures. So far, they have failed. Director Clearview keeps a holographic model of a ring signature on her desk — studying it obsessively, looking for a weakness that doesn't exist.",
    metadata: {
      origin: 'Cryptographic research, pre-surveillance era',
      significance: "Core privacy technology, Monerochan's primary ability",
    },
  },
  {
    name: 'Stealth Addresses',
    kind: 'lore',
    description:
      "One-time addresses generated for each transaction, ensuring that payments cannot be linked to a recipient's published address. In Monerochan's world, stealth addresses have evolved beyond financial technology into a way of life — the philosophical principle that every interaction should be unique and unlinkable.\n\nThe underground resistance uses stealth addressing not just for transactions but for all communication. Every message, every meeting point, every dead drop uses a one-time identifier that exists only for its intended purpose and then dissolves. This makes the resistance's communication network look like static to surveillance systems — millions of unique, unconnected data points that refuse to form a pattern.\n\nYoung Monerochan used to play hide-and-seek with toy stealth addresses, hiding them from cartoon spy drones that the cypherpunks built as training tools. By her teenage years, she could generate stealth addresses instinctively, creating new untraceable identities faster than the Authority's systems could process them.",
    metadata: {
      origin: 'Cryptographic research, pre-surveillance era',
      significance: 'Secondary privacy technology, the principle of unlinkability',
    },
  },
  {
    name: 'The First Principle',
    kind: 'lore',
    description:
      'The philosophical foundation taught to every child raised in the underground: "Privacy is not secrecy. A private matter is something one doesn\'t want the whole world to know. A secret matter is something one doesn\'t want anybody to know. Privacy is the power to selectively reveal oneself to the world."\n\nSatoshi the Elder taught this principle to Monerochan before she could walk. It became the lens through which she understood everything — why the Panopticon Authority is wrong (they conflate privacy with secrecy), why the resistance fights (not to hide but to choose), and what she represents (not anonymity but agency).\n\nThe First Principle is carved into the entrance of every underground school, stitched into the lining of every cypherpunk robe, and whispered at every Genesis Day ceremony. It is the answer the resistance gives when the Authority asks, "If you have nothing to hide, why do you want privacy?" The answer: "Because having something to hide is not the point."',
    metadata: {
      origin: 'Taught by Satoshi the Elder, derived from the Cypherpunk Manifesto',
      significance: 'Core philosophy distinguishing privacy from secrecy',
    },
  },
  {
    name: 'GlassCoin',
    kind: 'lore',
    description:
      'The mandatory transparent cryptocurrency used by all citizens of the mega-city. Every GlassCoin transaction is fully visible on a public ledger — sender, receiver, amount, timestamp, and even the physical location of both parties at the time of the transaction. The Authority designed GlassCoin specifically as an anti-privacy financial system.\n\nCitizens are required to use GlassCoin for all purchases. Physical cash was abolished. Barter is classified as a "pre-criminal economic indicator." The Authority monitors spending patterns through AI systems that flag anomalies — buying too much food (possible underground supply), purchasing technical equipment (possible resistance activity), or simply spending less than expected (possible off-ledger activity).\n\nThe contrast between GlassCoin and Monero is the central economic conflict of the world. One is a chain of transparency, the other a promise of privacy. The Cypherpunk Collective maintains a parallel Monero economy underground, proving that financial freedom is possible — if you\'re willing to live in the shadows.',
    metadata: {
      origin: 'Created by the Panopticon Authority',
      significance: 'The surveillance currency — antithesis of Monero and financial privacy',
    },
  },
];

const TECHNOLOGIES: EntitySeed[] = [
  {
    name: 'Red Eye Drone Network',
    kind: 'technology',
    description:
      "The Panopticon Authority's primary airborne surveillance system. Thousands of small, insect-like drones equipped with facial recognition cameras, transaction scanners, and biometric sensors patrol every cubic meter of the mega-city's airspace. Their tiny red recording lights give them a sinister appearance — like a swarm of red-eyed mechanical insects.\n\nRed Eye Drones operate in coordinated swarms controlled by the All-Seeing Spire's central AI. They can track a citizen from home to work, log every person they interact with, and even detect emotional states through micro-expression analysis. The drones are replaced every 72 hours to prevent the resistance from studying captured units.\n\nMonerochan's presence disrupts Red Eye Drones in unpredictable ways — their cameras produce only static, their tracking algorithms return null, and their navigation systems become confused. The Authority has developed \"Monerochan-hardened\" drones, but each new iteration fails in a new way. Privacy, it seems, is not a bug to be patched.",
    metadata: {
      type: 'Surveillance Drone System',
      operator: 'The Panopticon Authority',
      availability: 'Ubiquitous throughout the mega-city',
      status: 'Active — constantly upgraded, constantly defeated by Monerochan',
    },
  },
  {
    name: 'The Blossom Break',
    kind: 'technology',
    description:
      "Monerochan's signature technique — a cascading ring signature generation that overwhelms surveillance systems with beautiful, destructive elegance. When performed, Monerochan generates thousands of interlocking ring signatures simultaneously, creating a visual phenomenon that looks like cherry blossoms made of green light exploding outward from her position.\n\nEach \"blossom\" is a valid ring signature that demands processing from any surveillance system that encounters it. The cascade overloads tracking algorithms, causes cameras to produce only static, and creates a privacy field that extends outward in a growing sphere. Within the Blossom Break's radius, all surveillance temporarily fails — citizens experience, often for the first time in their lives, what it feels like to be unwatched.\n\nMonerochan developed the technique during a training session in the Ring Dojo when, under extreme pressure from a simulated pursuit, she instinctively generated signatures faster than she'd ever done before. The resulting cascade was so beautiful that her instructor wept. It has become the resistance's signature — their cherry blossom, their symbol of hope.",
    metadata: {
      type: 'Cryptographic Combat Technique',
      inventor: 'Monerochan (instinctive development)',
      operator: 'Monerochan exclusively',
      availability: 'Unique — cannot be replicated',
    },
  },
  {
    name: 'Predictive Detention System',
    kind: 'technology',
    description:
      "The Panopticon Authority's most controversial technology — an AI system that analyzes citizen behavior patterns to predict and prevent crimes before they occur. Citizens flagged by the system are detained for \"Preventive Illumination\" — a process of intensive surveillance and behavioral modification designed to redirect them from their predicted criminal path.\n\nThe system is disturbingly accurate for conventional crime. But it fails completely against the privacy resistance, because the resistance's use of ring signatures and stealth addresses means the system has no behavioral data to analyze. This failure is the Authority's greatest frustration — they built a system that can predict everything except the one thing that threatens them.\n\nCritics (none of whom speak publicly) note the circular logic: privacy-seeking behavior is classified as a pre-criminal indicator, which means the system flags anyone who tries to avoid the system, which means the system creates the criminals it claims to predict.",
    metadata: {
      type: 'Predictive AI / Pre-Crime System',
      operator: 'The Panopticon Authority',
      availability: 'Applied to all 800 million citizens',
      status: 'Active — fails against privacy-protected individuals',
    },
  },
  {
    name: 'Dead-Drop Network',
    kind: 'technology',
    description:
      "The resistance's primary physical communication system, maintained by Ring and her team of runners. A network of over 4,000 hidden locations throughout the mega-city — in hollow walls, behind loose bricks, under park benches, inside decommissioned machinery — where encrypted physical messages can be left and retrieved.\n\nEach dead drop uses a unique one-time location identifier (a physical stealth address) known only to the sender and intended recipient. After a single use, the location is burned and a new one is generated. This makes the network impossible to monitor comprehensively — the Authority would need to watch every surface in the city simultaneously.\n\nMessages left in the dead drops are encrypted on paper using one-time pads — the only provably unbreakable encryption method. Even if intercepted, the messages are indecipherable without the corresponding pad, which is destroyed after use. The system is slow, labor-intensive, and beautifully secure — proof that the oldest communication methods can defeat the newest surveillance.",
    metadata: {
      type: 'Physical Communication Network',
      operator: "The Cypherpunk Collective (Ring's team)",
      availability: '~4,000 active locations, rotating',
      status: 'Active — the Authority has found and compromised approximately 2% of locations',
    },
  },
];

const SPECIES: EntitySeed[] = [
  {
    name: 'The Illuminated',
    kind: 'species',
    description:
      'Citizens who have fully internalized the surveillance state\'s worldview to the point where they have become voluntary extensions of the panopticon. The Illuminated actively report on their neighbors, broadcast their own locations continuously, and view any desire for privacy as a mental illness requiring treatment.\n\nThey are not enhanced or augmented — they are simply people who have been so thoroughly shaped by the surveillance culture that transparency has become their identity. They wear clear clothing, live in glass-walled apartments, and compete to be the "most visible" in their social circles. The Authority rewards them with social credit bonuses.\n\nThe cypherpunks view the Illuminated with sadness rather than anger. Monerochan once said of them: "They are not our enemies. They are our mission. They have forgotten what it feels like to have a self that belongs only to them. We fight so they can remember."',
    metadata: {
      origin: 'Sociological adaptation to total surveillance',
      characteristics: 'Voluntary transparency maximalists, privacy viewed as pathology',
    },
  },
];

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('  LOAR — Creating MONEROCHAN: UNTRACEABLE');
  console.log('═'.repeat(60));

  // ── Init Firebase ──────────────────────────────────────────────────
  const saPathEnv = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  const saPath = path.resolve(process.cwd(), saPathEnv ?? 'firebase-sa-key-20260416.json');
  let serviceAccount: any;

  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } else {
    serviceAccount = JSON.parse(readFileSync(saPath, 'utf-8'));
  }
  const app = initializeApp({ credential: cert(serviceAccount) }, 'monerochan-' + Date.now());
  const db = getFirestore(app);
  db.settings({ preferRest: true });
  console.log(`  Firebase : ${serviceAccount.project_id}`);
  console.log(`  Creator  : ${CREATOR_ADDRESS}`);
  console.log(`  Google AI: ${GOOGLE_API_KEY ? 'configured' : 'missing'}\n`);

  // ── Step 1: Generate AI cover image ────────────────────────────────
  console.log('Step 1: Generating cover image via Google Nano Banana Pro...');

  let coverImageUrl: string;
  try {
    coverImageUrl = await generateCoverImage();
    console.log(`  Generated & pinned to IPFS: ${coverImageUrl.slice(0, 80)}...\n`);
  } catch (err: any) {
    console.log(`  Image generation failed: ${err.message}`);
    console.log(`  Using placeholder image\n`);
    coverImageUrl =
      'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=1200&h=675&fit=crop';
  }

  // ── Step 2: Create universe in Firestore ──────────────────────────
  console.log('Step 2: Creating universe in Firestore...');

  const ts = Date.now();
  const fakeAddress = `0x${ts.toString(16).padStart(40, '0')}`;
  const universeId = fakeAddress.toLowerCase();
  const now = new Date();

  await db
    .collection('cinematicUniverses')
    .doc(universeId)
    .set({
      address: fakeAddress,
      creator: CREATOR_ADDRESS,
      tokenAddress: `0x${(ts + 1).toString(16).padStart(40, '0')}`,
      governanceAddress: `0x${(ts + 2).toString(16).padStart(40, '0')}`,
      image_url: coverImageUrl,
      description: UNIVERSE_DESCRIPTION,
      name: UNIVERSE_NAME,
      onChainUniverseId: null,
      mintTxHash: null,
      unstoppableDomain: null,
      hasPrivateSection: true,
      isMultiSig: false,
      multiSigAddress: null,
      accessModel: 'open',
      created_at: now,
      updated_at: now,
    });
  console.log(`  Universe document created: ${universeId}`);

  // Seed credits
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
  console.log(`  Seeded ${CREDITS} mint credits`);

  // Private section config
  await db.collection('privateSectionConfig').doc(universeId).set({
    universeId,
    vaultEnabled: true,
    notesEnabled: true,
    holderMinPercentage: 1,
    createdAt: now,
    updatedAt: now,
  });
  console.log(`  Private section config created`);

  // Credit transaction
  await db.collection('universeCreditTransactions').add({
    universeId,
    type: 'fund',
    fundedByUid: CREATOR_ADDRESS.toLowerCase(),
    paymentMethod: 'genesis',
    paymentRef: 'monerochan-genesis',
    credits: CREDITS,
    ethAmountWei: '0',
    source: 'genesis',
    note: 'Monerochan: Untraceable — genesis credits',
    createdAt: now,
  });
  console.log(`  Credit transaction logged\n`);

  // ── Step 3: Seed entities ─────────────────────────────────────────
  console.log('Step 3: Seeding worldbuilding entities...\n');

  const allEntities: EntitySeed[] = [
    ...CHARACTERS,
    ...FACTIONS,
    ...PLACES,
    ...EVENTS,
    ...LORE,
    ...TECHNOLOGIES,
    ...SPECIES,
  ];

  let seeded = 0;
  for (const entity of allEntities) {
    const entityId = randomUUID();
    await db
      .collection('entities')
      .doc(entityId)
      .set({
        id: entityId,
        name: entity.name,
        kind: entity.kind,
        description: entity.description,
        universeAddress: universeId,
        parentId: null,
        nodeIds: [],
        imageUrl: null,
        metadata: entity.metadata ?? {},
        monetized: false,
        rightsDeclaration: null,
        unstoppableDomain: null,
        createdBy: CREATOR_ADDRESS.toLowerCase(),
        createdAt: now,
        updatedAt: now,
      });
    seeded++;
    console.log(`  [${entity.kind.toUpperCase().padEnd(10)}] ${entity.name}`);
  }

  // ── Summary ────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(60));
  console.log('  MONEROCHAN: UNTRACEABLE — LIVE ON LOAR');
  console.log('═'.repeat(60));
  console.log(`  Universe ID  : ${universeId}`);
  console.log(`  Name         : ${UNIVERSE_NAME}`);
  console.log(`  Creator      : ${CREATOR_ADDRESS}`);
  console.log(`  Credits      : ${CREDITS}`);
  console.log(`  Entities     : ${seeded}`);
  console.log(`    Characters : ${CHARACTERS.length}`);
  console.log(`    Factions   : ${FACTIONS.length}`);
  console.log(`    Places     : ${PLACES.length}`);
  console.log(`    Events     : ${EVENTS.length}`);
  console.log(`    Lore       : ${LORE.length}`);
  console.log(`    Technology : ${TECHNOLOGIES.length}`);
  console.log(`    Species    : ${SPECIES.length}`);
  console.log(`  Cover Image  : ${coverImageUrl.slice(0, 70)}...`);
  console.log(`  Access Model : open`);
  console.log('═'.repeat(60));
  console.log(`\n  View at: /universe/${universeId}\n`);

  process.exit(0);
}

main().catch((err) => {
  console.error('\nFailed:', err.message ?? err);
  process.exit(1);
});
