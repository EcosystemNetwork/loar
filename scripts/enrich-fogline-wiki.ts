/**
 * Enrich the FALLOUT: FOGLINE wiki with additional entities.
 *
 * Adds secondary characters, more locations, items/things, vehicles,
 * deeper lore entries, and historical events — all pulled from and
 * expanding the screenplay's world. Also generates images for ALL
 * entities (new and existing) that don't have one yet.
 *
 * Usage:
 *   pnpm tsx scripts/enrich-fogline-wiki.ts
 *
 * Options:
 *   --skip-images   Skip image generation (just add entities)
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
const app = initializeApp({ credential: cert(serviceAccount) }, `fogline-enrich-${Date.now()}`);
const db = getFirestore(app);
db.settings({ preferRest: true });

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const PINATA_JWT = process.env.PINATA_JWT;
const PINATA_GATEWAY = process.env.PINATA_GATEWAY_URL ?? 'https://gateway.pinata.cloud';
const SKIP_IMAGES = process.argv.includes('--skip-images');

const UNIVERSE_ID = '0x0000000000000000000000000000019d9e26795c';
const CREATOR_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

// ── Image Generation ────────────────────────────────────────────────────

async function generateEntityImage(
  name: string,
  kind: string,
  description: string
): Promise<string | null> {
  if (SKIP_IMAGES || !GOOGLE_API_KEY) return null;

  const styleMap: Record<string, string> = {
    person: 'character portrait, dramatic lighting, post-apocalyptic wasteland background',
    place: 'wide establishing shot, atmospheric, volumetric fog, cinematic landscape',
    faction: 'group composition showing faction identity, insignia, post-apocalyptic military',
    event: 'dramatic historical scene, epic scale, fire and destruction',
    lore: 'mysterious artifact or concept visualization, glowing elements, dark atmosphere',
    technology: 'detailed technical illustration, retro-futuristic design, Vault-Tec aesthetic',
    species: 'creature study, anatomical detail, dramatic pose, wasteland environment',
    thing: 'detailed prop or item render, dramatic lighting, post-apocalyptic wear and patina',
    vehicle: 'vehicle in wasteland environment, dramatic angle, rust and modifications',
    organization: 'group portrait or headquarters, insignia prominent, atmospheric',
  };

  const style = styleMap[kind] || 'cinematic post-apocalyptic illustration';
  const shortDesc = description.slice(0, 200);

  const prompt = [
    `${name} — ${shortDesc}.`,
    style,
    'Fallout post-apocalyptic aesthetic, irradiated Bay Area California setting.',
    'Color palette: rust orange, toxic green, steel blue, amber, fog grey.',
    'Ultra-detailed, 8K, concept art style, dramatic volumetric lighting.',
    'No text, no watermarks, no logos, no UI elements.',
  ].join(' ');

  try {
    const model = 'imagen-4.0-generate-001';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict?key=${GOOGLE_API_KEY}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: {
          sampleCount: 1,
          aspectRatio: kind === 'place' ? '16:9' : '1:1',
          safetyFilterLevel: 'BLOCK_ONLY_HIGH',
          personGeneration: 'ALLOW_ADULT',
        },
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.log(`    ⚠️ Imagen blocked/failed for "${name}": ${response.status}`);
      return null;
    }

    const data = (await response.json()) as any;
    if (!data.predictions?.length) {
      console.log(`    ⚠️ No image returned for "${name}" (safety filter?)`);
      return null;
    }

    const base64 = data.predictions[0].bytesBase64Encoded;

    // Upload to Pinata
    if (PINATA_JWT) {
      const buffer = Buffer.from(base64, 'base64');
      const form = new FormData();
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      form.append('file', new Blob([buffer], { type: 'image/png' }), `fogline-${slug}.png`);
      form.append('pinataMetadata', JSON.stringify({ name: `Fogline: ${name}` }));

      const pinRes = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
        method: 'POST',
        headers: { Authorization: `Bearer ${PINATA_JWT}` },
        body: form,
      });

      if (pinRes.ok) {
        const pinData = (await pinRes.json()) as { IpfsHash: string };
        return `${PINATA_GATEWAY}/ipfs/${pinData.IpfsHash}`;
      }
    }

    return `data:image/png;base64,${base64.slice(0, 100)}...`;
  } catch (err) {
    console.log(`    ⚠️ Image gen error for "${name}": ${(err as Error).message.slice(0, 80)}`);
    return null;
  }
}

// ── Entity Definition ───────────────────────────────────────────────────

interface EntitySeed {
  name: string;
  kind: string;
  description: string;
  metadata?: Record<string, unknown>;
}

// ── NEW CHARACTERS ──────────────────────────────────────────────────────

const NEW_CHARACTERS: EntitySeed[] = [
  {
    name: 'Tomas "Cap" Reyes',
    kind: 'person',
    description:
      "Mara's father and one of the founding traders of the Oakland Free Trade Zone. A broad-shouldered man in his late 50s who built his reputation by establishing the caps-based economy that keeps Oakland running. Cap doesn't fight — he brokers. He runs the water rationing schedule and was the one who realized the settlement would die within three months if a clean source wasn't found. He didn't ask Mara to cross the Bay. He didn't have to. He taught her math, and she did the calculation herself.\n\nCap walks with a limp from a raider ambush five years back. He wears a pre-war Oakland A's jacket held together with electrical tape. When FOGLINE restores water to the East Bay, Cap is the one who figures out the distribution schedule, because that's what he does — he organizes survival into something that looks almost like civilization.",
    metadata: {
      role: 'Supporting Character / Father Figure',
      age: '58',
      faction: 'Oakland Free Trade Zone',
      appearance: "Broad-shouldered, limping, Oakland A's jacket, weathered face, calculating eyes",
      abilities: 'Trade negotiation, resource management, settlement leadership',
    },
  },
  {
    name: 'Doc Yuen',
    kind: 'person',
    description:
      "The Oakland Free Trade Zone's only medical practitioner — a self-taught surgeon working out of a converted BART car with pre-war medical texts and scavenged supplies. She's been treating waterborne illness for weeks and running out of antibiotics. Doc Yuen is blunt, exhausted, and maintains a kill count of patients she's lost to contaminated water on a chalkboard behind her surgery table — not for morbidity, but so the settlement council can't pretend the crisis isn't real.\n\nShe's the one who tells Cap that the water situation isn't 'difficult' — it's terminal. Her medical log documenting the progression of radiation-contaminated water illness becomes one of Oakland's most important post-restoration documents. Mid-40s, Chinese-American, close-cropped grey hair, always wearing surgical gloves that she washes and reuses until they fall apart.",
    metadata: {
      role: 'Supporting Character / Doctor',
      age: '45',
      faction: 'Oakland Free Trade Zone',
      appearance: 'Close-cropped grey hair, surgical gloves, exhausted eyes, BART car clinic',
      abilities: 'Field surgery, disease treatment, medical documentation',
    },
  },
  {
    name: 'Sergeant Rook',
    kind: 'person',
    description:
      "One of the Brotherhood Outcasts serving under Paladin Vega. Rook is the one who pries open the Sutro Tower bunker door and who grabs Mara during the confrontation inside. Unlike Vega, Rook has doubts — he joined the Outcasts because they had power armor and food, not because he believes in technology hoarding. He's seen too many settlements die of thirst to be comfortable watching it happen to Oakland.\n\nRook doesn't speak much during the Fogline events, but he's the Outcast who doesn't fire when things go sideways in the bunker. After Amos activates the water system, Rook lingers at the bunker door, looking toward the East Bay lights. Whether he reports back to Vega or walks away is left ambiguous. Late 20s, dark skin, scar across his jaw from a deathclaw encounter he doesn't talk about.",
    metadata: {
      role: 'Minor Character / Conflicted Soldier',
      age: '28',
      faction: 'Brotherhood Outcasts',
      appearance: 'Dark skin, jaw scar, partial power armor, conflicted expression',
      abilities: 'Combat training, power armor operation, lock breaching',
    },
  },
  {
    name: 'Mother Cass',
    kind: 'person',
    description:
      "A ghoul elder who runs a small community of sentient ghouls in the sub-basements of the old Federal Building in San Francisco. She's over 200 years old, was a civil rights attorney before the war, and now serves as judge, mediator, and moral compass for the ghoul underground. Mother Cass knows Amos — she's been trying to get him to stop hiding in the tunnels and join her community for decades. He always refuses.\n\nCass maintains a library of pre-war law books and insists that the ghoul community operate under something resembling legal structure. She's the one who first noticed FOGLINE's broadcast signal months ago but couldn't reach the tower because of Brotherhood patrols. When she hears what Amos did, she laughs and says: 'A janitor saves the Bay. I should have gone to trade school.'",
    metadata: {
      role: 'Supporting Character / Ghoul Elder',
      age: '~240',
      species: 'Ghoul',
      appearance: 'Aged ghoul, dignified bearing, pre-war reading glasses, law books always nearby',
      abilities: 'Legal knowledge, community leadership, pre-war institutional memory',
    },
  },
  {
    name: 'Rattlejack',
    kind: 'person',
    description:
      "A feral-adjacent scavenger who works the no-man's-land between Oakland and the collapsed Bay Bridge. Nobody's sure if Rattlejack is a very degraded ghoul or a very irradiated human — he doesn't clarify and nobody asks. He wears a suit made of rattling tin cans and bottle caps that announces his presence from a block away, which is deliberate: in the wasteland, things that sneak up on you are threats, but things that make noise are just weird.\n\nRattlejack runs a ferry service — a raft of lashed-together car hoods and styrofoam pulled by a trained radstag — that crosses the shallows near the old Bay Bridge pylons. He's the backup crossing option that Mara didn't use (she went through the tunnel instead). He charges 50 caps per crossing and throws in a complimentary paranoid conspiracy theory about Alcatraz. He claims the island is run by pre-war robots who think the war never ended.",
    metadata: {
      role: 'Minor Character / Ferryman',
      age: 'Unknown',
      appearance: 'Suit of rattling tin cans, weather-beaten, possibly ghoul, gap-toothed grin',
      abilities: 'Bay crossing navigation, radstag handling, conspiracy theories',
    },
  },
  {
    name: 'Knight-Errant Paz',
    kind: 'person',
    description:
      "A former Brotherhood of Steel knight from the main chapter who went rogue after disagreeing with Elder Maxson's technology hoarding policies. Paz operates as a lone wanderer in the Marin Headlands north of the Golden Gate, collecting and redistributing pre-war tech to settlements that need it. She still wears her T-45 power armor but has painted over the Brotherhood insignia with a crude sunflower.\n\nPaz heard the FOGLINE activation from her Marin radio post and is heading toward Oakland when the story ends. She represents a third path between Vega's hoarding and Mara's pragmatism: technology as gift rather than weapon or tool. She'll arrive in Oakland within days of the water restoration, bringing technical knowledge that the settlement desperately needs to maintain the systems Amos activated. Early 40s, Latina, hair in a tight braid under her power armor helmet, permanently sunburned from living without a roof.",
    metadata: {
      role: 'Emerging Character / Rogue Knight',
      age: '42',
      faction: 'Independent (ex-Brotherhood)',
      appearance:
        'T-45 power armor with sunflower painted over Brotherhood insignia, tight braid, sunburned',
      abilities: 'Power armor mastery, pre-war tech repair, weapons systems, settlement defense',
    },
  },
  {
    name: 'Supervisor Chen',
    kind: 'person',
    description:
      "FOGLINE's last human supervisor — long dead, but his terminal logs in the Sutro Tower bunker tell the story of the first weeks after the bombs. Chen was a systems administrator for the Bay Civic Response Grid who made it to the bunker on October 23, 2077, and spent 47 days manually maintaining FOGLINE before radiation sickness took him. His final log entry reads: 'AI is stable on autonomous. Weather beacons green. Water spine offline but valves intact. Whoever reads this — the system works. Just needs someone to say the words. Sorry I can't be the one. —David Chen, GS-12, Public Works.'\n\nChen's logs are scattered across terminals in the bunker. He's the one who configured the civic oath protocol as a backup access method, knowing he wouldn't survive but hoping someone would come after him. He was right. It just took 219 years.",
    metadata: {
      role: 'Posthumous Character / System Administrator',
      age: 'Deceased (was 34 in 2077)',
      faction: 'Pre-War Municipal Government',
      appearance:
        'Known only from ID photo in terminal: young Asian man, glasses, Public Works badge',
    },
  },
];

// ── NEW PLACES ──────────────────────────────────────────────────────────

const NEW_PLACES: EntitySeed[] = [
  {
    name: 'Marin Headlands Outpost',
    kind: 'place',
    description:
      "A small fortified position on the bluffs north of the Golden Gate, overlooking the ruins of the bridge and the fog-choked Bay. The outpost consists of three concrete bunkers from the pre-war military era, now occupied by a rotating cast of scavengers, drifters, and Knight-Errant Paz when she's in the area. The bunkers have a clear line of sight to Sutro Tower's blinking red light across the water.\n\nThe Headlands are too exposed and windy for permanent settlement but serve as a critical observation post and radio relay point. From here, Paz monitors Brotherhood movements in the city and picks up stray radio signals. She was the first to notice FOGLINE's broadcast pattern change three weeks before Mara bought the signal compass.",
    metadata: {
      type: 'Military Outpost / Observation Post',
      location: 'North of Golden Gate Bridge, Marin County',
      controlledBy: 'Loosely held by independents',
      atmosphere: 'Windswept, exposed, commanding views of the Bay and ruined bridge',
    },
  },
  {
    name: 'The Drowning District',
    kind: 'place',
    description:
      "The low-lying waterfront area of San Francisco where sea level rise and earthquake damage have put entire blocks partially underwater. Buildings stand knee-deep in irradiated tidal pools. Street signs poke above the waterline. Mutated kelp and bioluminescent algae coat everything below the tidemark, giving the district an eerie green glow at night.\n\nThe Drowning District is navigable by raft or on foot at low tide. It's home to a small community of scavengers who harvest mutated shellfish and seaweed — a diet that's slowly irradiating them but keeping them fed. The community has developed a crude aquaculture system using flooded buildings as fish farms. They're too small to attract Brotherhood attention but too exposed to the fog to thrive. FOGLINE's weather beacon activation will be transformative for them, though they don't know it yet.",
    metadata: {
      type: 'Flooded Urban Ruins',
      location: 'San Francisco waterfront, south of Market',
      hazards: 'Radiation pools, unstable structures, tidal flooding, mirelurks',
      atmosphere: 'Bioluminescent green glow at night, gurgling water, eerie beauty',
    },
  },
  {
    name: 'Yerba Buena Relay',
    kind: 'place',
    description:
      "A secondary communications relay on the artificial island between San Francisco and Oakland, built into the foundations of the old Bay Bridge. The relay was part of FOGLINE's network but went offline decades ago when the island partially submerged. Its equipment is salvageable, and restoring it would extend FOGLINE's communication range south to San Jose and north into wine country.\n\nThe relay station is half-submerged, accessible only at low tide through a flooded maintenance tunnel. Its pre-war equipment is corroded but the core transmitter array is intact — one of the objectives for Oakland's post-restoration expansion. The island is infested with mirelurks that nest in the flooded lower levels.",
    metadata: {
      type: 'Communications Relay / Ruins',
      location: 'Yerba Buena Island (between SF and Oakland)',
      status: 'Offline, partially submerged, salvageable',
      hazards: 'Mirelurks, flooding, structural instability',
    },
  },
  {
    name: 'The Pit — Old Coliseum',
    kind: 'place',
    description:
      "The ruins of the Oakland-Alameda County Coliseum, now a gladiatorial arena and trading post run by a council of raider bosses. The Pit hosts fights between wastelanders for caps, disputes settled by combat, and a weekly market that's technically separate from the Free Trade Zone's jurisdiction. The field is a mud pit surrounded by rusting bleachers where spectators bet on outcomes.\n\nThe Pit's raider council maintains a fragile peace with the Free Trade Zone through a simple arrangement: the raiders don't raid Oakland, and Oakland doesn't organize an army to burn the Coliseum down. This equilibrium will be disrupted by Oakland's water restoration — suddenly Oakland has something worth taking, and The Pit's bosses will have to decide whether to protect their neighbors or compete with them.",
    metadata: {
      type: 'Arena / Raider Stronghold',
      location: 'East Oakland, former Coliseum site',
      controlledBy: 'Raider Council (5 bosses)',
      atmosphere: 'Brutal, loud, mud and blood, rusting stadium infrastructure',
    },
  },
  {
    name: 'Chinatown Warren',
    kind: 'place',
    description:
      "The remains of San Francisco's Chinatown, compressed into an underground network of basements, sub-basements, and pre-earthquake tunnels that predate the nuclear war by over a century. Mother Cass's ghoul community lives here in the deepest levels, where the radiation is paradoxically lower because of the shielding provided by layers of rubble and concrete.\n\nThe Warren is invisible from street level — its entrances are concealed behind collapsed facades and through sewer access points. Inside, the ghouls have maintained a remarkably civilized community: Cass runs courts, a schoolroom teaches pre-war history to young ghouls (the few children who've been ghoulified), and a communal kitchen serves radroach stew that Amos describes as 'the worst thing I've eaten more than a thousand times.' The Warren has its own water supply from deep wells, uncontaminated by surface radiation — one of the few clean water sources in San Francisco.",
    metadata: {
      type: 'Underground Settlement',
      location: 'Beneath Chinatown, San Francisco',
      controlledBy: 'Mother Cass (Ghoul community)',
      population: '~40 sentient ghouls',
      atmosphere: 'Dim, civilized, cramped, surprisingly warm and functional',
    },
  },
  {
    name: 'Fort Point Bunker',
    kind: 'place',
    description:
      "A pre-war military fortification at the base of the Golden Gate Bridge's southern anchorage. The Civil War-era fort was reinforced with modern materials before the bombs and serves as one of the Brotherhood Outcasts' forward operating bases in San Francisco. Vega's squad staged from here before moving to intercept Mara on Haight Street.\n\nThe bunker contains a small armory, a radio station, and sleeping quarters for a squad of six. Its walls are thick enough to reduce radiation to survivable levels. Brotherhood graffiti marks it as Outcast territory, and the approaches are mined with fragmentation mines and tripwire traps. The fort has an unobstructed view of the Golden Gate ruins and the Marin Headlands — which is how Vega knew about the signal compass before Mara even left Oakland. Someone on the Headlands was careless with their radio.",
    metadata: {
      type: 'Military Fortification / Brotherhood Base',
      location: 'Southern base of Golden Gate Bridge',
      controlledBy: 'Brotherhood Outcasts',
      defenses: 'Fragmentation mines, tripwires, thick walls, clear sightlines',
    },
  },
  {
    name: 'Mission Creek Stilts',
    kind: 'place',
    description:
      "A small fishing community built on stilts above the flooded remains of Mission Creek in San Francisco's south side. The community of about 30 people survives on mutated fish, trade, and deliberate neutrality — they refuse to ally with the Brotherhood, the Oakland Free Trade Zone, or any faction, maintaining independence through being too small and too poor to bother conquering.\n\nThe stilts are built from salvaged wood, ship parts, and highway guardrails. Children dive for salvage in the irradiated creek. The community's leader, an ancient woman known only as 'the Admiral,' navigates Bay politics by being useful to everyone and threatening to no one. The Stilts community will become strategically important after FOGLINE's activation because they control one of the few functioning boat launches on the San Francisco side.",
    metadata: {
      type: 'Stilt Settlement / Fishing Village',
      location: 'Mission Creek, south San Francisco',
      controlledBy: 'The Admiral (independent)',
      population: '~30',
      atmosphere: 'Rickety, wind-buffeted, salt-crusted, stubbornly independent',
    },
  },
  {
    name: 'BART Graveyard — MacArthur Station',
    kind: 'place',
    description:
      "The collapsed MacArthur BART station in Oakland, where a dozen subway cars sit frozen on the tracks — doors open, seats covered in 219 years of dust, destination boards still reading 'SFO/Millbrae.' The station has been converted into a residential complex by Oakland settlers who've turned the subway cars into apartments. Families live in the cars, with curtains made from old maps hanging in the windows and cooking fires in cut-open oil drums on the platform.\n\nMara grew up in Car 7, a window seat facing the tunnel she'll eventually walk into. The station serves as the eastern entrance to the Transbay Tunnel maintenance shafts — Mara knows the access point because she spent her childhood exploring the upper levels before the ferals pushed everyone out of the deep tunnels.",
    metadata: {
      type: 'Ruins / Residential Settlement',
      location: 'MacArthur, Oakland',
      controlledBy: 'Oakland Free Trade Zone residents',
      population: '~200',
      atmosphere: 'Domestic life in subway cars, cooking smoke, children playing on platforms',
    },
  },
];

// ── NEW LORE ────────────────────────────────────────────────────────────

const NEW_LORE: EntitySeed[] = [
  {
    name: "Amos's Watch — 219 Years of Routine",
    kind: 'lore',
    description:
      "Amos Quinn has been performing maintenance on the Transbay Tunnel infrastructure for 219 years. Not because anyone asked him to. Not because it matters. Because it's what he was doing when the world ended, and he never got a new assignment. He patches concrete, clears drainage, replaces corroded bolts with salvaged ones, and keeps the emergency lights running on backup power cells he scavenges from across the East Bay.\n\nThe tunnel is navigable because of Amos. The bulkhead gates still work because of Amos. The emergency lighting that Mara follows through the darkness exists because a ghoul janitor spent two centuries maintaining infrastructure for a transit system that will never run again. When FOGLINE confirms his employee records, it's not just a plot device — it's validation that 219 years of invisible labor actually counted for something.",
    metadata: {
      significance:
        'Character depth — Amos has been doing his job for 219 years without recognition',
    },
  },
  {
    name: 'The Caps Economy',
    kind: 'lore',
    description:
      "The Oakland Free Trade Zone runs on bottle caps (caps) and charged batteries as dual currency. Caps are the universal small denomination — lightweight, countable, and impossible to counterfeit because pre-war bottling processes left microscopic markings that traders learn to identify by touch. Batteries are high-value currency: a working microfusion cell is worth hundreds of caps and is the closest thing the wasteland has to a hundred-dollar bill.\n\nThe caps economy emerged naturally from scavenger culture: early traders needed a standard unit of exchange, and bottle caps were plentiful, durable, and small enough to carry. The system works because everyone agrees it works, which is how all currency functions. Mara's microfusion cell trade for the signal compass is significant because it means she spent the equivalent of a month's wages on a blinking device — a bet that her settlement can't afford to lose.",
    metadata: {
      significance: "Economic worldbuilding — establishes the stakes of Mara's purchases",
    },
  },
  {
    name: 'The No-Synth Laws',
    kind: 'lore',
    description:
      "Signs throughout the Oakland Free Trade Zone read 'NO SYNTHS.' This refers to synthetic humans — artificial beings indistinguishable from humans created by the Institute. Whether any synths actually exist in the Bay Area is unknown. The ban reflects wasteland paranoia more than confirmed threat: the fear that the person you're trading with might not be human is enough to justify the rule.\n\nThe no-synth policy is enforced through community suspicion rather than any reliable detection method. Accusations of being a synth are sometimes used to settle personal grudges or drive out unwanted competition. Ghouls are technically not covered by the ban — they're unambiguously human, just irradiated — but the social stigma is similar enough that Amos avoids the settlement entirely.",
    metadata: {
      significance: 'Social worldbuilding — prejudice, paranoia, and exclusion in the wasteland',
    },
  },
  {
    name: 'The Fog Season Cycle',
    kind: 'lore',
    description:
      "The Bay Area fog follows an annual cycle that the wasteland population has learned to track and fear. Summer fog is thickest from June through August, when cold Pacific air rolls over warm land and condenses into the radioactive blanket that defines the region. Winter brings clearer skies but colder temperatures and occasional radiation storms that the fog normally suppresses.\n\nThe worst period is the 'Glass Weeks' in late September — a 2-3 week window when the fog shifts unpredictably, sometimes clearing entirely to reveal the ruins in harsh sunlight (the 'glass' refers to the way sunlight hits irradiated surfaces), sometimes condensing into fog so thick it reduces visibility to arm's length. Scavengers and traders plan their movements around the fog calendar. Mara's crossing happens in early autumn, during a brief thinning — one of the few windows when the tunnel approach is visible enough to navigate safely.",
    metadata: {
      significance: 'Environmental worldbuilding — the fog as a living hazard with patterns',
    },
  },
  {
    name: "Chen's Logs — 47 Days After",
    kind: 'lore',
    description:
      "Supervisor David Chen's terminal logs in the Sutro Tower bunker document the first 47 days after the Great War. They begin with terse system status reports and escalate into personal entries as Chen realizes he's dying of radiation sickness. Key excerpts:\n\nDay 1: 'Multiple detonations confirmed. Grid in emergency mode. Activating all weather beacons. Water spine reports pressure loss in 3 sectors.'\n\nDay 12: 'No contact with any municipal authority. FOGLINE performing admirably on auto. I've configured the civic oath protocol as backup access — someone has to be able to talk to this thing after I'm gone.'\n\nDay 33: 'Lost feeling in my left hand today. Classic ARS progression. I've been reading the AI ethics manual because there's nothing else to read. FOGLINE asked if I needed medical assistance. I said no. It asked again an hour later. I think it knows.'\n\nDay 47: 'AI is stable on autonomous. Weather beacons green. Water spine offline but valves intact. Whoever reads this — the system works. Just needs someone to say the words. Sorry I can't be the one. —David Chen, GS-12, Public Works.'",
    metadata: {
      significance:
        'Posthumous narrative — the human who kept FOGLINE running long enough to save everyone else 219 years later',
    },
  },
  {
    name: 'The Bay Crossing Problem',
    kind: 'lore',
    description:
      "Getting from Oakland to San Francisco is one of the most dangerous journeys in the Bay Area wasteland. The Golden Gate and Bay Bridges are collapsed. The BART tunnels are flooded or feral-infested. Boats are scarce, exposed to fog radiation, and vulnerable to whatever lives in the deep water (rumors range from mutated sharks to something larger that nobody's survived long enough to describe).\n\nThe options, ranked by sanity: (1) Rattlejack's raft ferry across the shallows near the old Bay Bridge pylons — slow, expensive, and weather-dependent. (2) The Transbay Tunnel maintenance shafts — faster but infested with ferals and requiring knowledge of the route. (3) Swimming — suicide. (4) Walking the Golden Gate ruins — structurally impossible, cables could collapse at any moment.\n\nMara chooses the tunnel because it's the fastest option and she's running out of time. She doesn't expect to find Amos living there, which turns a dangerous crossing into a guided one — though Amos would argue he's been providing infrastructure maintenance, not hospitality.",
    metadata: {
      significance: 'Geographic worldbuilding — why crossing the Bay is a narrative challenge',
    },
  },
  {
    name: 'The Alcatraz Question',
    kind: 'lore',
    description:
      "Nobody knows who controls Alcatraz. The island sits in the Bay, clearly occupied — scrap-metal walls, spotlights, what appears to be functioning power generation. Ships that approach are warned off by loudspeaker. Ships that don't turn around are fired upon with what sounds like a pre-war naval autocannon.\n\nRumors about Alcatraz range from plausible (raider warlord with salvaged military hardware) to conspiratorial (pre-war government continuity enclave) to Rattlejack's personal theory (robots running the prison exactly as it was in 1963, complete with tourist recordings). The truth is one of the Bay Area's great unsolved mysteries. Mother Cass says she saw boats leaving the island at night once, carrying what looked like agricultural supplies. Whatever Alcatraz is, it's self-sufficient, well-armed, and not interested in neighbors.",
    metadata: {
      significance: 'Mystery worldbuilding — sets up future narrative threads',
    },
  },
];

// ── NEW THINGS/ITEMS ────────────────────────────────────────────────────

const NEW_THINGS: EntitySeed[] = [
  {
    name: 'Microfusion Cells',
    kind: 'thing',
    description:
      "The premium currency of the Bay Area wasteland — compact pre-war energy storage units that can power everything from laser rifles to water purifiers. A single working microfusion cell is worth 200+ caps and represents serious purchasing power. The cells are rare because they can't be manufactured — every cell in circulation was made before the war, and the supply shrinks as cells are used, damaged, or lost.\n\nMara trades one for the signal compass, which is a significant financial sacrifice that underscores how serious the water crisis is. Where she gets her microfusion cells is a question she deflects: 'Don't insult me by asking.' The implication is that she scavenges from dangerous, possibly off-limits locations — old military installations, irradiated zones, or places the Brotherhood has claimed but can't fully patrol.",
    metadata: {
      thingType: 'Currency / Power Source',
      origin: 'Pre-War manufacturing',
      value: '200+ caps each',
    },
  },
  {
    name: "Amos's Tool Satchel",
    kind: 'thing',
    description:
      "A battered leather satchel that Amos has carried for 219 years — the same tool bag he had on his person when the bombs fell. It contains a collection of transit maintenance tools that have been repaired, replaced, and jury-rigged so many times that none of the original tools remain, but the satchel itself is original. Inside: pipe wrenches modified for bulkhead bolts, a multimeter with a cracked display that still works, wire strippers, a roll of pre-war electrical tape (irreplaceable), and a small notebook where Amos logs maintenance tasks in handwriting that's gotten progressively shakier over the centuries.\n\nThe satchel is Amos's identity. He's not a gunslinger (though he's a good shot). He's not a warrior. He's a maintenance worker with 219 years of experience, and his tools are what make him useful rather than just old.",
    metadata: {
      thingType: 'Tools / Personal Item',
      owner: 'Amos Quinn',
      age: '219+ years (continuously modified)',
    },
  },
  {
    name: "Vega's Plasma Pistol",
    kind: 'thing',
    description:
      "A pre-war plasma pistol maintained to Brotherhood specifications — one of the most powerful handheld weapons in the Bay Area. The weapon fires superheated plasma bolts that can melt through most armor and turn unarmored targets into green ash. Vega's pistol is personalized with kill marks etched into the grip and a modified heat sink that allows faster firing.\n\nThe plasma pistol represents the Brotherhood's technological advantage distilled into a single object. When Vega aims it at Mara, the power imbalance is absolute: Mara's jury-rigged laser rifle is a scavenger tool, while Vega's plasma pistol is a weapon of war. The moment Mara snatches the pistol after Vega drops it during the bunker confrontation and fires it past Vega's head is the moment the power dynamic shifts — literally and figuratively.",
    metadata: {
      thingType: 'Energy Weapon / Brotherhood Issue',
      owner: 'Paladin Vega (seized by Mara temporarily)',
      capabilities: 'Superheated plasma bolts, modified heat sink, personalized',
    },
  },
  {
    name: "Doc Yuen's Chalkboard",
    kind: 'thing',
    description:
      "A salvaged classroom chalkboard mounted behind Doc Yuen's surgery table in her BART car clinic. On it, she maintains a running count of patients lost to contaminated water. The numbers are written in white chalk with the date, and the board is never erased — only added to. It serves as both a medical record and a political statement: when the settlement council argues about whether the water crisis is 'manageable,' Doc Yuen invites them to read the board.\n\nThe chalkboard becomes a shrine after FOGLINE restores water. Doc Yuen doesn't erase the old numbers — she draws a line under them and starts a new count of patients recovering. The contrast between the two columns tells the story of what the water restoration means in human terms.",
    metadata: {
      thingType: 'Medical Record / Political Symbol',
      owner: 'Doc Yuen',
      location: 'BART Car Clinic, Oakland Free Trade Zone',
    },
  },
  {
    name: 'Brotherhood Signal Interceptor',
    kind: 'thing',
    description:
      "A modified radio receiver that the Brotherhood Outcasts use to monitor Vault-Tec frequencies across the Bay Area. It's how Vega's squad detected the signal compass's emissions and tracked Mara's movements. The interceptor can pick up transmissions across a 50-mile radius and decrypt basic pre-war emergency broadcasts.\n\nThe device represents the Brotherhood's surveillance advantage: they don't just have better weapons, they have better ears. Vega knew about the signal compass before Mara bought it because the interceptor detected the compass being activated in the Old Merchant's booth. The Brotherhood didn't seize it at the market because they wanted to see where the signal led first — letting Mara do the dangerous crossing while they followed at a safe distance.",
    metadata: {
      thingType: 'Surveillance / Communications',
      owner: 'Brotherhood Outcasts',
      capabilities: '50-mile range, Vault-Tec frequency decryption',
    },
  },
];

// ── NEW VEHICLES ────────────────────────────────────────────────────────

const NEW_VEHICLES: EntitySeed[] = [
  {
    name: "Rattlejack's Raft — The Tide Tax",
    kind: 'vehicle',
    description:
      "A watercraft built from lashed-together car hoods, blocks of styrofoam, and sheets of corrugated metal, pulled by a trained radstag named 'Meter' (Rattlejack insists the animal was named before he got it). The Tide Tax operates as a ferry service across the shallows near the old Bay Bridge pylons, charging 50 caps per passenger per crossing.\n\nThe raft is surprisingly stable and can carry up to four passengers plus cargo. Rattlejack navigates by reading the fog patterns and tidal currents, a skill he claims to have developed over 20 years of Bay crossings. The raft is painted with crude protective symbols and has a small shrine to 'Lady Luck' — a bobblehead glued to the bow. Despite its ramshackle appearance, the Tide Tax has never lost a passenger (Rattlejack's claim, unverifiable).",
    metadata: {
      vehicleType: 'Watercraft / Ferry Raft',
      operator: 'Rattlejack',
      capacity: '4 passengers + cargo',
      propulsion: 'Trained radstag (Meter)',
    },
  },
  {
    name: 'Brotherhood Vertibird Wreck',
    kind: 'vehicle',
    description:
      "A crashed Brotherhood of Steel Vertibird in Golden Gate Park, partially overgrown with mutated vegetation. The VTOL aircraft went down years ago during a supply run from the mainline Brotherhood chapter to the Outcasts. Its fusion engine is depleted, but the airframe is intact enough to serve as Vega's backup command post when Fort Point is compromised.\n\nThe wreck contains a working long-range radio transmitter that Vega uses to request reinforcements from the main Brotherhood chapter. The radio is what makes the wreck strategically important — it's the Outcasts' lifeline to their parent organization and their best argument for why they should be taken seriously. After the Sutro Tower incident, Vega retreats to the Vertibird wreck to call for backup.",
    metadata: {
      vehicleType: 'Crashed VTOL Aircraft',
      faction: 'Brotherhood Outcasts',
      status: 'Crashed, non-flyable, radio functional',
      location: 'Golden Gate Park, San Francisco',
    },
  },
];

// ── NEW ORGANIZATIONS ───────────────────────────────────────────────────

const NEW_ORGS: EntitySeed[] = [
  {
    name: 'Bay Area Scavenger Guild',
    kind: 'organization',
    description:
      "A loose network of independent scavengers who share information about safe routes, productive salvage sites, and hazard warnings. The Guild isn't a formal organization — there's no membership fee, no leadership, and no rules except one: you share what you find about danger, and you keep what you find about treasure. Guild runners leave coded markers (painted symbols on walls, stacked stones at intersections) that indicate safe passages, radiation hotspots, raider territory, and feral nesting sites.\n\nMara is a guild member, which is how she knew the Transbay Tunnel maintenance shaft was passable — a guild runner marked the entrance six months ago. The guild is entirely oral tradition and symbol-based; there are no written records because literacy is uncommon and paper is valuable.",
    metadata: {
      type: 'Informal Network',
      territory: 'Bay Area wide',
      membership: '~100-200 active scavengers',
      purpose: 'Hazard sharing, route mapping, mutual survival',
    },
  },
  {
    name: 'Vault-Tec Bay Area Division (Pre-War)',
    kind: 'organization',
    description:
      "The pre-war corporation responsible for building the Bay Area's Vault shelters and emergency infrastructure. Vault-Tec's Bay Area Division designed and installed the civic response grid that became FOGLINE, the signal compass network, and the relay infrastructure at Sutro Tower. Their corporate logo — a gear-shaped vault door — still marks equipment throughout the wasteland.\n\nVault-Tec's reputation in the wasteland is complex: they built the shelters that saved some people, but they also conducted horrifying experiments on vault populations. The Bay Area's vaults (locations mostly unknown) are assumed to follow the same pattern. What makes the Fogline narrative unique is that Vault-Tec's civic infrastructure — designed for genuine emergency management, not experiments — turns out to be their most valuable legacy. A parking meter AI saves more lives than any vault.",
    metadata: {
      type: 'Pre-War Corporation (defunct)',
      legacy: 'FOGLINE, signal compass network, Sutro Tower relay, Bay Area vaults',
      reputation: 'Mixed — saved some, experimented on others',
    },
  },
];

// ── NEW EVENTS ──────────────────────────────────────────────────────────

const NEW_EVENTS: EntitySeed[] = [
  {
    name: 'The Oakland Founding — Year 12',
    kind: 'event',
    description:
      "Twelve years after the Great War (2089), the first organized settlement formed in the Oakland ruins. A group of vault dwellers from an unknown Bay Area vault emerged and found surface survivors already scavenging the East Bay. The merger of vault knowledge (literacy, basic engineering, medical training) with surface survival skills (scavenging, combat, radiation awareness) created the foundation for what would become the Oakland Free Trade Zone.\n\nThe founding was not peaceful — early conflicts over food and territory led to the establishment of the caps economy as a way to resolve disputes through trade rather than violence. Cap Reyes's grandfather was among the founding generation, which is why the Reyes family occupies a respected position in Oakland's informal hierarchy.",
    metadata: {
      date: 'Approximately 2089 (Year 12 After Great War)',
      significance: 'Origin of Oakland Free Trade Zone, caps economy emergence',
    },
  },
  {
    name: 'The Brotherhood Arrival — The Schism',
    kind: 'event',
    description:
      "Approximately 30 years ago (2266), a Brotherhood of Steel expeditionary force arrived in the Bay Area by Vertibird, establishing a forward operating base at Fort Point. Their mission: catalog and secure pre-war technology in the San Francisco ruins. Within five years, the expedition fractured. The mainline Brotherhood pulled back to focus on a conflict further south, leaving a small garrison.\n\nThe garrison, led by Paladin Vega's predecessor, declared themselves Outcasts — independent of the main chapter's command structure but still adhering to Brotherhood doctrine. Vega inherited command after her predecessor died in a mirelurk ambush at the Drowning District. Under Vega, the Outcasts have become more aggressive about technology seizure, viewing every pre-war device as Brotherhood property by birthright.",
    metadata: {
      date: 'Approximately 2266 (30 years before story)',
      significance: 'Origin of Brotherhood Outcast presence in Bay Area',
    },
  },
  {
    name: 'The Night the Fog Turned Green',
    kind: 'event',
    description:
      "Three years before the story (2293), a massive radiation storm overwhelmed FOGLINE's weather beacons for 72 hours. The fog turned a visible toxic green, killing exposed crops across the East Bay and sickening hundreds of people. Livestock died. The scavenger guild lost eight runners who were caught in the open.\n\nNobody understood why the fog was normally survivable but turned lethal for three days. The answer — FOGLINE's beacons temporarily losing enough power to let a radiation front through — wouldn't become clear until Amos reads the relay bunker's data. The Green Night is Oakland's most traumatic recent memory and the reason Doc Yuen started her chalkboard. It's also what made Mara understand that the water crisis was just one symptom of a larger infrastructure failure they couldn't see.",
    metadata: {
      date: '2293 (3 years before story)',
      significance:
        'Worst fog event in recent memory, unknown cause (later revealed as FOGLINE power dip)',
    },
  },
];

// ── NEW SPECIES ─────────────────────────────────────────────────────────

const NEW_SPECIES: EntitySeed[] = [
  {
    name: 'Radstags',
    kind: 'species',
    description:
      "Mutated deer that roam the Bay Area hills and ruins. Radstags are larger than their pre-war ancestors, with patchy fur, bony growths, and sometimes a second head (which is usually non-functional). Despite their alarming appearance, radstags are herbivores and relatively docile — they're one of the few reliable food sources in the wasteland and can be domesticated with patience.\n\nRattlejack's radstag 'Meter' pulls his ferry raft across the Bay shallows. Oakland settlers keep small herds in fenced areas near the Coliseum for meat and leather. Radstag leather is the most common armor material for wastelanders who can't afford metal plating. The animals are skittish around gunfire and will bolt into irradiated zones if panicked, which makes hunting them a calculated risk.",
    metadata: {
      physiology: 'Enlarged, patchy fur, bony growths, occasionally two-headed',
      habitat: 'Bay Area hills, ruins, domesticated in settlements',
      uses: 'Food, leather, draft animal (rare)',
    },
  },
  {
    name: 'Mirelurks',
    kind: 'species',
    description:
      "Heavily mutated crustaceans that infest the Bay Area's waterways, flooded structures, and coastal zones. Mirelurks are aggressive, armored, and territorial. They range from human-sized 'softshells' to massive 'queens' the size of cars. Their shells are nearly impervious to ballistic weapons, making energy weapons or explosives the preferred countermeasure.\n\nMirelurks nest in the Drowning District, under the Bay Bridge pylons, and in the flooded levels of Yerba Buena Relay. The Drowning District scavengers have learned to coexist with smaller mirelurks by harvesting mirelurk eggs (a protein-rich food source) without disturbing the queens. The mirelurk infestation at Yerba Buena Relay is one of the obstacles preventing Oakland from extending FOGLINE's communication range after the story's events.",
    metadata: {
      physiology: 'Armored crustaceans, human-sized to car-sized, nearly bulletproof shells',
      habitat: 'Waterways, flooded structures, coastal zones',
      threat: 'Territorial, aggressive, resistant to ballistic weapons',
    },
  },
];

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log(`
════════════════════════════════════════════════════════════
  FALLOUT: FOGLINE — Wiki Enrichment
════════════════════════════════════════════════════════════
  Universe   : ${UNIVERSE_ID}
  Images     : ${SKIP_IMAGES ? 'SKIPPED' : GOOGLE_API_KEY ? 'Google Imagen 4 + Pinata' : 'No API key'}
  Firebase   : ${serviceAccount.project_id}
`);

  const allNew: EntitySeed[] = [
    ...NEW_CHARACTERS,
    ...NEW_PLACES,
    ...NEW_LORE,
    ...NEW_THINGS,
    ...NEW_VEHICLES,
    ...NEW_ORGS,
    ...NEW_EVENTS,
    ...NEW_SPECIES,
  ];

  console.log(`  Adding ${allNew.length} new entities...\n`);

  // Check for existing entities to avoid duplicates
  const existingSnap = await db
    .collection('entities')
    .where('universeAddress', '==', UNIVERSE_ID)
    .get();

  const existingNames = new Set(
    existingSnap.docs.map((doc) => (doc.data().name as string).toLowerCase())
  );

  let added = 0;
  let skipped = 0;
  let imagesGenerated = 0;

  for (const entity of allNew) {
    if (existingNames.has(entity.name.toLowerCase())) {
      console.log(`  [SKIP      ] ${entity.name} (already exists)`);
      skipped++;
      continue;
    }

    const entityId = randomUUID();
    let imageUrl: string | null = null;

    // Generate image
    if (!SKIP_IMAGES && GOOGLE_API_KEY) {
      console.log(
        `  [${entity.kind.toUpperCase().padEnd(10)}] ${entity.name} — generating image...`
      );
      imageUrl = await generateEntityImage(entity.name, entity.kind, entity.description);
      if (imageUrl) {
        imagesGenerated++;
        console.log(`    📸 Image: ${imageUrl.slice(0, 70)}...`);
      }
      // Rate limit: Imagen has per-minute quotas
      await new Promise((r) => setTimeout(r, 1500));
    } else {
      console.log(`  [${entity.kind.toUpperCase().padEnd(10)}] ${entity.name}`);
    }

    await db
      .collection('entities')
      .doc(entityId)
      .set({
        id: entityId,
        name: entity.name,
        kind: entity.kind,
        description: entity.description,
        metadata: entity.metadata || {},
        universeAddress: UNIVERSE_ID,
        creator: CREATOR_ADDRESS,
        imageUrl: imageUrl || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

    added++;
  }

  // Now generate images for existing entities that don't have one
  if (!SKIP_IMAGES && GOOGLE_API_KEY) {
    console.log('\n  Checking existing entities for missing images...');

    const existingWithoutImages = existingSnap.docs.filter((doc) => !doc.data().imageUrl);

    if (existingWithoutImages.length > 0) {
      console.log(`  Found ${existingWithoutImages.length} entities without images\n`);

      for (const doc of existingWithoutImages) {
        const data = doc.data();
        console.log(
          `  [${(data.kind as string).toUpperCase().padEnd(10)}] ${data.name} — generating image...`
        );

        const imageUrl = await generateEntityImage(
          data.name as string,
          data.kind as string,
          data.description as string
        );

        if (imageUrl) {
          await db.collection('entities').doc(doc.id).update({ imageUrl });
          imagesGenerated++;
          console.log(`    📸 Image: ${imageUrl.slice(0, 70)}...`);
        }

        await new Promise((r) => setTimeout(r, 1500));
      }
    } else {
      console.log('  All existing entities have images ✓');
    }
  }

  // Final count
  const finalSnap = await db
    .collection('entities')
    .where('universeAddress', '==', UNIVERSE_ID)
    .get();

  console.log(`
════════════════════════════════════════════════════════════
  WIKI ENRICHMENT COMPLETE
════════════════════════════════════════════════════════════
  Added    : ${added} new entities
  Skipped  : ${skipped} duplicates
  Images   : ${imagesGenerated} generated
  Total    : ${finalSnap.size} entities in universe

  Entity Breakdown:
${(() => {
  const counts: Record<string, number> = {};
  finalSnap.docs.forEach((doc) => {
    const kind = doc.data().kind as string;
    counts[kind] = (counts[kind] || 0) + 1;
  });
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([kind, count]) => `    ${kind.padEnd(14)} ${count}`)
    .join('\n');
})()}

  Ready for video generation!
════════════════════════════════════════════════════════════
`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
