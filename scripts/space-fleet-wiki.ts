/**
 * SPACE FLEET — Wiki Population
 *
 * Creates all characters, places, factions, technology, lore, organizations,
 * and vehicles from the pilot episode "Nothing to See Here".
 *
 * Each entity gets 2D art + 3D model generation (fire-and-forget).
 *
 * Prerequisites:
 *   - Space Fleet universe deployed via create-space-fleet.ts
 *   - Server running (pnpm dev:server)
 *   - Set SPACE_FLEET_ADDR env or update the constant below
 *
 * Usage: pnpm tsx scripts/space-fleet-wiki.ts
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

// ── Universe address — update after deployment ──────────────────────────
const UNIVERSE_ADDR = process.env.SPACE_FLEET_ADDR ?? '0x0000000000000000000000000000000000000000';

// ── Entity definitions ──────────────────────────────────────────────────
interface EntityDef {
  name: string;
  kind:
    | 'person'
    | 'place'
    | 'faction'
    | 'technology'
    | 'lore'
    | 'organization'
    | 'vehicle'
    | 'event';
  description: string;
  metadata?: Record<string, string>;
  imagePrompt: string;
  threeDPrompt: string;
}

const ENTITIES: EntityDef[] = [
  // ═══════════════════════════════════════════════════════════════════════
  // CHARACTERS
  // ═══════════════════════════════════════════════════════════════════════
  {
    name: 'Eli Vance',
    kind: 'person',
    description:
      'A 24-year-old junior analyst at the Defense Analysis Center. Sharp, ambitious, wiry, and intensely focused. Eli plays the obedient patriot — saying the right things, climbing the ladder — while secretly hunting for proof of the hidden space program. He scored unusually high on anomaly pattern recognition, which earned him a fast-track promotion to Level 3 Public Misattribution Review and eventually temporary access to Project Orpheus. He carries a hidden data wafer and records private video logs on an encrypted laptop. His apartment wall is covered in printed launch windows, defense budgets, redacted memos, and amateur astronomy images. His goal: expose the greatest cover-up in human history.',
    metadata: {
      role: 'Protagonist',
      appearance:
        '24-year-old male, wiry build, intense dark eyes, cheap suit and tie, deliberately ordinary appearance. Carries a government badge and notebook filled with sketches of triangular craft.',
      motivations:
        'Expose the hidden space program to the public. Refuses to be gaslit by institutional lies.',
      abilities:
        'Exceptional anomaly pattern recognition, social manipulation (plays dumb convincingly), data exfiltration',
      homePlace: 'Small apartment near the Defense Analysis Center',
      affiliations: 'Defense Analysis Center (cover), secretly working to expose Project Orpheus',
    },
    imagePrompt:
      'Full-body character portrait of Eli Vance, a 24-year-old male intelligence analyst. Wiry build, intense dark eyes that miss nothing, wearing a cheap government suit with a thin tie. Deliberately ordinary and forgettable appearance. Government ID badge clipped to his jacket. In one hand a small notebook with sketches of triangular aircraft. Expression of controlled determination — a man hiding his true purpose behind perfect obedience. Sterile gray government hallway behind him. Paranoid thriller aesthetic, muted government colors with cool blue undertones, cinematic lighting, 4K quality.',
    threeDPrompt:
      'Young male intelligence analyst, wiry build, cheap government suit and tie, government ID badge, intense focused expression, holding notebook, standing pose, thriller cinematic style',
  },
  {
    name: 'Mara Chen',
    kind: 'person',
    description:
      'A woman in her 30s who works at the Defense Analysis Center. Cheerful on the surface but razor-sharp underneath. Mara knows far more than she lets on — she is already part of Project Orpheus when Eli discovers it, wearing the same black uniform in the sublevel facility. She tests Eli with provocative comments about the cover stories, watching who flinches. Her advice to Eli: "Play dumb better." She understands the system from the inside and walks the line between loyalty and conscience. Her final warning to Eli: "If you ever do leak it... make sure the world gets proof, not a story. They\'ve trained people to laugh at stories."',
    metadata: {
      role: 'Deuteragonist / Mentor figure',
      appearance:
        '30s female, sharp and professional, cheerful demeanor masking deep awareness. Wears standard government attire above ground, black Orpheus uniform below.',
      motivations:
        "Navigating the system from within. Possibly shares Eli's desire for truth but plays the longer game.",
      abilities:
        'Deep institutional knowledge, social intelligence, classified clearance within Orpheus',
      homePlace: 'Unknown — compartmentalized',
      affiliations: 'Defense Analysis Center (official), Project Orpheus (classified)',
    },
    imagePrompt:
      'Full-body character portrait of Mara Chen, a sharp woman in her 30s. Professional government attire — smart blazer, practical clothes. Cheerful expression that masks deep intelligence and awareness. Sharp eyes that evaluate everyone. One hand holding a government coffee cup casually. Split lighting — warm on her cheerful side, cold blue on the calculating side. Government facility background with fluorescent lighting. Paranoid thriller aesthetic, 4K quality.',
    threeDPrompt:
      'Professional woman in her 30s, smart blazer and government attire, sharp evaluating expression, holding coffee cup, standing confident pose, government thriller style',
  },
  {
    name: 'Director Halden',
    kind: 'person',
    description:
      'The head of the Defense Analysis Center and a senior figure within Project Orpheus. In his 50s, clean, polished, and completely unreadable. Halden is the gatekeeper between the public facade and the hidden truth. He assigns Eli to the disinformation triage queue — ostensibly a promotion, actually a test. His warnings are veiled threats: "Ambition is useful here. Curiosity is not the same thing." He ultimately reveals the hidden fleet to Eli, offering him a choice: spend his life shouting from outside the wall, or come inside and see why the wall exists. He demands loyalty, competence, and silence.',
    metadata: {
      role: 'Antagonist / Gatekeeper',
      appearance:
        '50s male, clean-shaven, immaculate suit, polished shoes. Military bearing hidden under bureaucratic calm. Completely unreadable face.',
      motivations:
        'Maintain the secrecy of the hidden space program. Believes public disclosure would collapse civilization. Recruits talent he can control.',
      abilities:
        'Institutional authority, psychological manipulation, classified intelligence access',
      homePlace: 'Sublevel offices beneath the Defense Analysis Center',
      affiliations: 'Defense Analysis Center (Director), Project Orpheus (senior command)',
    },
    imagePrompt:
      'Full-body character portrait of Director Halden, a man in his 50s. Immaculate dark suit, perfectly polished shoes, clean-shaven with steel-gray hair. Face completely unreadable — neither kind nor cruel, just calculating. Standing in a polished black corridor with minimalist design. Behind him, reinforced glass reveals faint telemetry displays. Cold authority radiates from every detail. Government thriller villain aesthetic, dramatic low lighting, 4K quality.',
    threeDPrompt:
      'Authoritative man in 50s, immaculate dark suit, steel gray hair, unreadable expression, hands clasped behind back, standing in dark corridor, government thriller style',
  },
  {
    name: 'The Voice',
    kind: 'person',
    description:
      'An unknown figure who contacts Eli via his burner phone during the cold open. A calm, older male voice who knows Eli\'s name, knows he stopped to watch the launches, and warns him: "If you want the truth, Mr. Vance... stop looking up in places where civilians can see you." Identity unknown. Possibly an ally within the system, possibly a handler monitoring Eli. The voice represents the invisible surveillance apparatus that tracks anyone who gets too close to the truth.',
    metadata: {
      role: 'Mysterious contact',
      appearance: 'Unknown — voice only. Calm, older male voice with authority.',
      motivations:
        'Unknown — could be warning Eli for his protection or threatening him into compliance',
      abilities:
        "Access to Eli's identity, location, and burner phone number. Surveillance capabilities.",
      homePlace: 'Unknown',
      affiliations: 'Unknown — possibly Project Orpheus intelligence division',
    },
    imagePrompt:
      'Abstract character concept for a mysterious unnamed caller. A silhouette of a man in shadow, only the outline visible against a field of surveillance monitors and signal waveforms. A glowing phone line connects from darkness to a desert highway below. One eye barely visible in the shadow, reflecting starlight. Cold blue and black color palette with thin green signal lines. Paranoid thriller mystery aesthetic, 4K quality.',
    threeDPrompt:
      'Shadowy male silhouette against surveillance monitors, only outline visible, mysterious anonymous figure, thriller spy aesthetic',
  },

  // ═══════════════════════════════════════════════════════════════════════
  // PLACES
  // ═══════════════════════════════════════════════════════════════════════
  {
    name: 'Defense Analysis Center',
    kind: 'place',
    description:
      'A gray, windowless government facility with badge scanners and frosted glass. The public-facing workplace where Eli and Mara operate. Wall screens show news anchors debunking UFO sightings. Below the listed floors lies the sublevel facility housing Project Orpheus — a polished black corridor leading to the underground hangar and launch infrastructure. The upper floors maintain the illusion of routine intelligence work; the sublevels contain the truth.',
    metadata: {
      placeType: 'Government facility / Secret military installation',
      atmosphere:
        'Sterile, quiet, controlled. Fluorescent lighting above, dramatic minimalism below. The mundane concealing the extraordinary.',
      rulesAndDangers:
        'Badge-restricted access. Sublevel access requires elevated clearance. Surveillance everywhere. Saying the wrong thing gets you relocated to offices with no clocks.',
      inhabitants: 'Analysts, intelligence officers, Project Orpheus personnel',
      governingFaction: 'Project Orpheus / US Government (classified division)',
    },
    imagePrompt:
      'Architectural portrait of the Defense Analysis Center. A brutalist gray government building with no windows, surrounded by security fencing and badge-access checkpoints. Above ground: sterile fluorescent-lit offices with frosted glass walls and rows of analyst terminals. Below: a reveal showing a polished black corridor descending into a vast underground hangar. Split composition — mundane gray government above, sleek black military-industrial below. Paranoid thriller architecture, cinematic lighting, 4K quality.',
    threeDPrompt:
      'Brutalist gray government building, no windows, security fencing, split to reveal polished black underground facility below, government thriller architecture, miniature style',
  },
  {
    name: 'Triage Office',
    kind: 'place',
    description:
      'A dim room within the Defense Analysis Center filled with rows of screens. This is the Level 3 Public Misattribution Review station where Eli is assigned. Endless social posts, leaked clips, civilian telescope footage, and cockpit recordings scroll across terminals. Each piece of evidence is tagged with recommended cover explanations: sensor bloom, viral fabrication, classified test aircraft misidentified. It is here that Eli discovers the ACCESS RESTRICTED file referencing "Section Orpheus."',
    metadata: {
      placeType: 'Intelligence review station',
      atmosphere:
        'Dim, screen-lit, claustrophobic. The blue glow of monitors illuminating analysts who sort truth from fiction — then bury the truth.',
      rulesAndDangers:
        'Strict access protocols. Attempting to access restricted files triggers alerts. Everything is logged.',
      inhabitants: 'Junior analysts assigned to disinformation triage',
      governingFaction: 'Defense Analysis Center',
    },
    imagePrompt:
      'Interior of a dimly lit government intelligence office. Rows of glowing screens display social media posts, UFO footage, cockpit recordings, and satellite imagery. Each screen has overlay tags: SENSOR BLOOM, VIRAL FABRICATION, ARTIFACT. A single analyst sits alone at a terminal, face illuminated by blue screen light. On one screen, a red ACCESS RESTRICTED warning. Paranoid, surveillance-heavy atmosphere. Cold blue monitor light, dark surroundings, 4K quality.',
    threeDPrompt:
      'Dim government office with rows of glowing surveillance monitors, analyst at terminal, ACCESS RESTRICTED on screen, cold blue lighting, intelligence review room style',
  },
  {
    name: "Eli's Apartment",
    kind: 'place',
    description:
      'A small, cheap apartment near the Defense Analysis Center. Sparse furniture but one wall is covered in Eli\'s investigation: printed launch windows, defense budgets, redacted government memos, and amateur astronomy images. Pinned in the center: "IF THEY\'RE LYING ABOUT THE TECHNOLOGY, WHAT ELSE ARE THEY LYING ABOUT?" He records encrypted video logs here. One night, a black SUV with no plates idles outside, and a message appears unbidden on his laptop: "YOU WANT TO EXPOSE THE SECRET. FIRST SURVIVE IT."',
    metadata: {
      placeType: 'Personal apartment / Investigation headquarters',
      atmosphere:
        'Paranoid, cramped, obsessive. A conspiracy board dominates one wall. The mundane life of a government worker hiding an extraordinary pursuit.',
      rulesAndDangers:
        'Under surveillance. Black SUVs appear outside. His laptop has been compromised — messages appear from unknown sources.',
      inhabitants: 'Eli Vance (sole occupant)',
      governingFaction: 'N/A — private residence (surveilled by unknown parties)',
    },
    imagePrompt:
      'Interior of a small, sparse apartment. Cheap furniture, bare walls except for ONE wall completely covered in an investigation board: printed satellite photos, launch window calendars, redacted government memos with black bars, amateur telescope images of strange lights, and red string connecting pieces. A handwritten note pinned in the center. A laptop glows on a desk. Through the window, a black SUV with no plates idles on the street below. Paranoid thriller aesthetic, warm lamplight vs cold surveillance blue, 4K quality.',
    threeDPrompt:
      'Small apartment interior with conspiracy investigation wall, printed documents and red string, laptop on desk, black SUV visible through window, thriller paranoia style, diorama',
  },
  {
    name: 'Underground Hangar',
    kind: 'place',
    description:
      'A cavernous underground hangar beneath the Defense Analysis Center, accessed via a sublevel elevator that descends below all listed floors. The facility is labeled "Aerospace Logistics Command" — a lie so obvious it feels insulting. Inside: a matte-black craft the size of a destroyer section, suspended in a magnetic cradle. Angular but elegant. Human-made, yet impossibly advanced. Service crews work beneath it. This is where Eli first sees proof that the hidden space program is real — not prototypes, not experiments, but operational warships.',
    metadata: {
      placeType: 'Secret military shipyard / Underground hangar',
      atmosphere:
        'Awe-inspiring, terrifying, revelatory. The scale of the deception becomes physical here. The craft is impossible yet undeniable.',
      rulesAndDangers:
        'Maximum security clearance required. Lethal force authorized for unauthorized access. No personal devices permitted.',
      inhabitants: 'Orpheus engineering crews, flight personnel, security forces',
      governingFaction: 'Project Orpheus / Aerospace Logistics Command',
    },
    imagePrompt:
      'A vast underground military hangar carved from rock. At the center, a matte-black angular warship the size of a destroyer section floats in a glowing magnetic cradle. The craft is angular but elegant — human engineering pushed to impossible limits. Service crews in dark uniforms work beneath it on elevated platforms. Blue-white magnetic field energy courses through cradle arms. The hangar stretches into darkness. A tiny human figure (Eli in a suit) stands at an observation window, dwarfed by the scale. Military sci-fi meets government thriller, dramatic lighting, 4K quality.',
    threeDPrompt:
      'Vast underground hangar with matte-black angular warship suspended in magnetic cradle, service crews below, observation window with tiny figure, military sci-fi underground base',
  },
  {
    name: 'Launch Spine Two',
    kind: 'place',
    description:
      'A towering vertical launch chamber humming with impossible energy. The matte-black ship sits sealed and fueled at the base. When the massive blast doors part overhead, they reveal not open sky but a hidden shaft leading up through mountain rock to the stars. The ship rises soundlessly through the shaft as sunlight pours down like revelation. Wall screens update: "FLEET MOVEMENT CONFIRMED — DESTINATION: OUTER PERIMETER COMMAND" alongside "PUBLIC NARRATIVE PACKAGE PREPARED — COVER STORY: METEOROLOGICAL TEST FAILURE." This is the moment Eli fully understands the scale of what has been hidden.',
    metadata: {
      placeType: 'Secret vertical launch facility',
      atmosphere:
        'Reverential, terrifying, transcendent. The sound of impossible energy. Sunlight pouring through a shaft in mountain rock as a warship rises silently.',
      rulesAndDangers:
        'Maximum security. Launch protocols active. The energy output alone is dangerous at close range.',
      inhabitants: 'Orpheus launch crews, transfer teams',
      governingFaction: 'Project Orpheus',
    },
    imagePrompt:
      'A towering vertical launch chamber inside a mountain. At the base, a matte-black angular warship sealed and ready. Above, massive blast doors have parted to reveal a shaft carved through solid rock, leading up to a circle of blue sky and stars. Brilliant sunlight pours down the shaft like a column of divine light. The ship is beginning to rise silently, leaving trails of energy. Personnel in dark uniforms watch in reverent silence. On a wall screen: fleet status updates. The scale is cathedral-like. Military sci-fi launch facility, dramatic vertical composition, 4K quality.',
    threeDPrompt:
      'Vertical launch chamber inside mountain, matte-black warship rising through shaft to sky, sunlight pouring down, personnel watching below, military sci-fi cathedral scale',
  },
  {
    name: 'Desert Highway',
    kind: 'place',
    description:
      'A lonely two-lane road cutting through black desert under a sky crowded with stars. The cold open location where Eli witnesses three streaks of white light rising silently — too fast, too vertical, too controlled to be aircraft. The air shimmers and the stars behind the streaks distort like heat over asphalt. Something MASSIVE moves above, implied only by its effect on the sky. This is where Eli receives the mysterious phone call warning him to stop looking up.',
    metadata: {
      placeType: 'Desert road / Observation point',
      atmosphere:
        "Isolated, exposed, paranoid. A vast empty landscape under an impossibly full sky. The silence is broken only by launches that shouldn't exist.",
      rulesAndDangers:
        'Restricted airspace above. Civilian observation is monitored. Being seen here marks you.',
      inhabitants: 'None visible — but surveillance is active',
      governingFaction: 'N/A — public road near restricted airspace',
    },
    imagePrompt:
      'A lonely two-lane desert highway at night cutting through pitch-black desert terrain. Above, an impossibly star-filled sky. Three streaks of white light rise vertically from behind distant mountains — too fast, too controlled, too silent. The air around them shimmers and distorts, bending the starfield. A beat-up sedan is stopped on the roadside, door open. A lone figure stands beside it, looking up. The sense of something massive and invisible moving above. Paranoid sci-fi thriller, vast empty landscape, dramatic sky, 4K quality.',
    threeDPrompt:
      'Desert highway at night, three vertical light streaks rising from mountains, stopped sedan with figure looking up, distorted starfield, sci-fi thriller landscape',
  },

  // ═══════════════════════════════════════════════════════════════════════
  // FACTIONS
  // ═══════════════════════════════════════════════════════════════════════
  {
    name: 'Project Orpheus',
    kind: 'faction',
    description:
      'The classified program responsible for humanity\'s hidden space fleet. Orpheus operates an industrial-scale interstellar military capability that the public is told does not exist. The project maintains orbital shipyards, lunar extraction corridors, civilian observation suppression protocols, encounter management procedures, and deep-range fleet groups. A single line in the classified briefings hints at the ultimate scope: "NON-HUMAN SIGNAL EVENT / OUTER PERIMETER / ACTIVE." Orpheus is not just hiding technology — it may be hiding a war. Personnel are recruited through careful vetting and given the choice: loyalty, competence, and silence — or obscurity.',
    metadata: {
      mission:
        "Maintain and operate humanity's hidden interstellar fleet while keeping its existence secret from the public",
      ideology:
        'Secrecy as civilization preservation. Public disclosure would collapse markets, fracture alliances, and split religions.',
      leader: 'Director Halden (visible command); higher echelons unknown',
      rivals: 'Potential whistleblowers, civilian astronomers, investigative journalists',
      hq: 'Sublevel facility beneath the Defense Analysis Center; distributed across hidden installations',
      resources:
        'Orbital shipyards, 40,000+ warships, deep-space colonies, lunar extraction, encounter management systems',
    },
    imagePrompt:
      'Faction emblem and concept art for Project Orpheus. A stylized black shield containing a hidden constellation pattern — stars connected by thin lines forming the shape of a fleet in formation. Below the shield, the word ORPHEUS in minimal military typography. Behind the emblem, a ghostly fleet of angular warships stretches to the horizon in deep space. The color palette is matte black, steel gray, and cold blue with pinpoints of white starlight. Military classification aesthetic — stamps, redaction bars, TOP SECRET overlays. 4K quality.',
    threeDPrompt:
      'Military faction emblem, black shield with constellation pattern forming fleet silhouette, ORPHEUS text, angular warships in background, classified military aesthetic',
  },
  {
    name: 'Aerospace Logistics Command',
    kind: 'faction',
    description:
      'The official cover name for the underground military infrastructure supporting the hidden fleet. A sign on the sublevel wall reads "AEROSPACE LOGISTICS COMMAND — AUTHORIZED PERSONNEL ONLY." The name is deliberately boring — designed to deflect curiosity. In reality, behind the signage lies the hangar housing operational warships, fleet telemetry monitoring, and launch spine access. The name itself is a weapon of narrative control: mundane enough to be overlooked, official enough to discourage questions.',
    metadata: {
      mission: 'Provide cover identity for Project Orpheus ground operations and infrastructure',
      ideology: 'Institutional camouflage — hide the extraordinary behind bureaucratic mediocrity',
      leader: 'Director Halden',
      rivals: 'Anyone who digs below the surface of the name',
      hq: 'Sublevel facility beneath the Defense Analysis Center',
      resources: 'Underground hangars, launch spines, fleet telemetry systems, engineering crews',
    },
    imagePrompt:
      'A boring government sign reading "AEROSPACE LOGISTICS COMMAND — AUTHORIZED PERSONNEL ONLY" mounted on a polished black wall in a minimalist corridor. The sign is deliberately dull and bureaucratic. But reflected in the polished floor beneath it, the reflection shows the truth: a vast underground hangar with a warship floating in a magnetic cradle. The contrast between the mundane sign and the impossible reflection. Split reality composition, government thriller aesthetic, 4K quality.',
    threeDPrompt:
      'Boring government sign on polished black wall, but floor reflection reveals vast underground hangar with warship, split reality concept, thriller aesthetic',
  },

  // ═══════════════════════════════════════════════════════════════════════
  // ORGANIZATIONS
  // ═══════════════════════════════════════════════════════════════════════
  {
    name: 'Public Disinformation Bureau',
    kind: 'organization',
    description:
      'The apparatus responsible for manufacturing and distributing cover stories for Space Fleet activities. When civilians film launches, the Bureau generates explanations: sensor bloom, viral fabrication, classified test aircraft misidentified, astrophotography artifact, atmospheric distortion, weather balloons, ion reflections, swamp gas, cosmic dust. The Level 3 Triage Office is their operational center, where analysts review footage and tag it with recommended dismissals. News chyrons reading "MYSTERY LIGHTS OVER NEVADA DEBUNKED AS ATMOSPHERIC DISTORTION" originate here. As Mara notes: "The truth is never hidden. It\'s buried under seven acceptable lies."',
    metadata: {
      orgType: 'Intelligence / Narrative control division',
      purpose:
        'Generate and maintain cover stories for all civilian observations of Space Fleet activity',
      structure:
        'Hierarchical — junior analysts in triage, senior staff in narrative design, director-level approval for major cover operations',
      members: 'Eli Vance (Level 3 analyst), Mara Chen, Director Halden (oversight)',
      influence: 'Controls public perception of all aerospace anomalies worldwide',
    },
    imagePrompt:
      'Concept art for the Public Disinformation Bureau. A wall of screens showing UFO footage, civilian telescope images, and cockpit recordings — each with an overlay stamp: SENSOR BLOOM, FABRICATION, ATMOSPHERIC ARTIFACT. In front of the screens, analysts in government attire work at terminals, crafting cover stories. A news broadcast plays on one screen: "MYSTERY LIGHTS DEBUNKED." The irony is palpable — the truth is on every screen, being systematically buried. Cold blue monitor light, government office aesthetic, 4K quality.',
    threeDPrompt:
      'Government office wall of screens showing UFO footage with debunking overlay stamps, analysts at terminals, news broadcast debunking on screen, intelligence office diorama',
  },

  // ═══════════════════════════════════════════════════════════════════════
  // TECHNOLOGY
  // ═══════════════════════════════════════════════════════════════════════
  {
    name: 'Orpheus-Class Warship',
    kind: 'technology',
    description:
      'The matte-black angular craft Eli sees in the underground hangar — the size of a destroyer section, suspended in a magnetic cradle. Angular but elegant. Human-made, yet impossibly advanced. The craft rises soundlessly through Launch Spine Two and vanishes upward in a column of white light. Fleet readiness dashboards show these ships organized into deep-range fleet groups operating at the Outer Perimeter. The technology represents decades of secret development — propulsion systems that produce no visible bloom, stealth capabilities that make the craft invisible except by their effect on the starfield, and the ability to reach destinations described only as "Outer Perimeter Command."',
    metadata: {
      techType: 'Military starship / Stealth warship',
      inventor: 'Unknown — classified development program spanning decades',
      howItWorks:
        'Propulsion produces no visible bloom. Rises soundlessly. Causes atmospheric distortion and starfield bending. Launches vertically through concealed mountain shafts.',
      limitations: "Unknown — classified. The public is told these don't exist.",
      users: 'Project Orpheus fleet personnel',
    },
    imagePrompt:
      'Technical concept art of the Orpheus-Class Warship. A matte-black angular craft the size of a naval destroyer, elegant and menacing. Sharp angular surfaces designed for stealth, no visible engine nozzles or traditional propulsion. The craft is shown suspended in a glowing magnetic cradle inside an underground hangar, with blue-white energy coursing through the cradle arms. Inset detail: the craft rising silently through a vertical mountain shaft, trailing distorted light. Military sci-fi design document aesthetic, technical blueprint feel with dramatic rendering, 4K quality.',
    threeDPrompt:
      'Matte-black angular stealth warship, destroyer-sized, sharp angular surfaces, no visible engines, suspended in magnetic cradle with blue energy, military sci-fi ship design',
  },
  {
    name: 'Magnetic Cradle System',
    kind: 'technology',
    description:
      'The suspension and maintenance system used in the underground hangar to hold the Orpheus-Class warship. Blue-white energy courses through massive cradle arms that hold the ship in place without physical contact. The cradle serves as both a docking system and a maintenance platform, allowing service crews to work beneath the suspended craft. The technology implies mastery of electromagnetic or gravitational manipulation far beyond anything in the public scientific record.',
    metadata: {
      techType: 'Electromagnetic suspension / Ship maintenance platform',
      inventor: 'Project Orpheus engineering division',
      howItWorks:
        'Massive arms generate fields that suspend the warship without physical contact. Blue-white energy visibly courses through the cradle structure.',
      limitations:
        'Requires enormous power infrastructure — only possible in purpose-built underground facilities',
      users: 'Project Orpheus hangar crews',
    },
    imagePrompt:
      'Technical concept art of the Magnetic Cradle System. Massive mechanical arms extending from the walls of an underground hangar, tips glowing with blue-white electromagnetic energy. Between the arms, a matte-black warship floats without any physical support. Energy arcs and fields visible between the cradle and the hull. Service crews on platforms work beneath the hovering craft. Blueprint overlay with technical annotations. Military engineering aesthetic, 4K quality.',
    threeDPrompt:
      'Massive mechanical cradle arms with glowing blue energy tips suspending a warship in underground hangar, electromagnetic field effects visible, military engineering tech',
  },
  {
    name: 'Vertical Launch Spine',
    kind: 'technology',
    description:
      'A concealed vertical launch system built inside a mountain. The launch chamber hums with impossible energy. When activated, massive blast doors part overhead to reveal a shaft carved through solid rock leading to the sky. Ships rise soundlessly through the shaft. The system is completely hidden from satellite observation — from above, it appears to be an ordinary mountain. The cover story infrastructure generates "METEOROLOGICAL TEST FAILURE" narratives for any anomalous signatures detected by civilian instruments during launches.',
    metadata: {
      techType: 'Concealed launch facility / Vertical ship deployment system',
      inventor: 'Project Orpheus infrastructure division',
      howItWorks:
        'Ships rise soundlessly through vertical shafts carved through mountain rock. Blast doors conceal the shaft opening. Sunlight pours down during launches. Energy signature is massive but brief.',
      limitations:
        'Fixed location — cannot be relocated. Launch signature may be detectable by sufficiently advanced civilian instruments.',
      users: 'Project Orpheus launch operations',
    },
    imagePrompt:
      'Cross-section technical illustration of a Vertical Launch Spine built inside a mountain. Shows the vertical shaft carved through rock, blast doors at the top opening to reveal sky, a warship rising silently through the shaft. Sunlight pouring down the shaft. At the base, the launch chamber with energy conduits feeding into the walls. From the outside, the mountain appears completely ordinary. Cutaway architectural drawing with dramatic rendering, military engineering blueprint aesthetic, 4K quality.',
    threeDPrompt:
      'Cross-section mountain with vertical launch shaft, warship rising through rock tunnel to sky above, blast doors opening, sunlight pouring down, cutaway military facility model',
  },

  // ═══════════════════════════════════════════════════════════════════════
  // VEHICLES
  // ═══════════════════════════════════════════════════════════════════════
  {
    name: "Eli's Sedan",
    kind: 'vehicle',
    description:
      "A beat-up sedan Eli drives through the desert in the cold open. The car is deliberately unimpressive — part of his ordinary cover. On the passenger seat: a government badge, a cheap burner phone, and a notebook filled with sketches of strange triangular craft. The car represents Eli's dual existence: the mundane government worker on the surface, the relentless investigator underneath.",
    metadata: {
      vehicleType: 'Civilian automobile',
      crew: 'Eli Vance (sole driver)',
      capabilities: 'Basic transportation — nothing special. Its ordinariness is the point.',
      origin: 'Standard civilian vehicle',
      currentStatus: "Active — Eli's personal transport",
    },
    imagePrompt:
      'A beat-up sedan stopped on a lonely desert highway at night. Door ajar, interior light on. On the passenger seat: a government ID badge, a cheap burner phone, and an open notebook showing hand-drawn sketches of triangular aircraft. Through the windshield, an impossibly star-filled sky. The contrast between the mundane vehicle and the cosmic mystery above it. Cinematic thriller composition, warm interior light vs cold desert blue, 4K quality.',
    threeDPrompt:
      'Beat-up sedan on desert highway at night, door open, government badge and notebook on seat, starry sky above, thriller atmosphere, miniature model',
  },
  {
    name: 'Black SUV',
    kind: 'vehicle',
    description:
      'A black SUV with no license plates that appears outside Eli\'s apartment at night. It idles silently, watching. When Eli notices it, it drives away. The SUV represents the surveillance apparatus — the unseen watchers who know Eli is getting too close. Its appearance coincides with a message appearing on his laptop: "YOU WANT TO EXPOSE THE SECRET. FIRST SURVIVE IT."',
    metadata: {
      vehicleType: 'Surveillance vehicle',
      crew: 'Unknown — occupants never visible',
      capabilities: 'Silent operation, no identifying marks, surveillance equipment (implied)',
      origin: 'Unknown government or intelligence agency',
      currentStatus: 'Active — appears and disappears without explanation',
    },
    imagePrompt:
      'A black SUV with no license plates idling on a dark residential street at night. Tinted windows reflect nothing. Street lamp light slides off the polished surface. From an apartment window above, a faint blue glow (laptop screen). The SUV represents pure surveillance menace — anonymous, patient, watching. Paranoid thriller aesthetic, high contrast between dark vehicle and dim street lighting, 4K quality.',
    threeDPrompt:
      'Black SUV with no plates idling on dark residential street at night, tinted windows, surveillance menace, apartment window glowing above, thriller miniature',
  },

  // ═══════════════════════════════════════════════════════════════════════
  // LORE
  // ═══════════════════════════════════════════════════════════════════════
  {
    name: 'The Orpheus Briefing',
    kind: 'lore',
    description:
      'The classified document Eli reads on the tablet Halden gives him: "PROJECT ORPHEUS — STRATEGIC FLEET READINESS / CIVILIAN DISCLOSURE RISK MATRIX." The briefing reveals the full scope of what has been hidden: orbital shipyards, lunar extraction corridors, civilian observation suppression protocols, encounter management procedures, and deep-range fleet groups. But one line stops him cold: "NON-HUMAN SIGNAL EVENT / OUTER PERIMETER / ACTIVE." This single line transforms the story from government conspiracy to something far larger — the fleet isn\'t just hidden technology, it may be responding to an alien presence.',
    metadata: {
      loreType: 'Classified military briefing',
      article:
        "The Orpheus Briefing contains the following classified sections: (1) Orbital Shipyard Locations and Capacity, (2) Lunar Extraction Corridor Operations, (3) Civilian Observation Suppression Protocol, (4) Encounter Management Procedures, (5) Deep-Range Fleet Group Deployments, (6) Non-Human Signal Event — Outer Perimeter — Active. The existence of Section 6 implies that the fleet's purpose extends beyond human territorial expansion into active response to extraterrestrial contact.",
      relatedConcepts:
        'Project Orpheus, Civilian Disclosure Risk Matrix, Outer Perimeter Command, Non-Human Signal Event',
      canonWeight: 'Hard Canon',
    },
    imagePrompt:
      'A classified military document displayed on a slim government tablet. The header reads "PROJECT ORPHEUS — STRATEGIC FLEET READINESS / CIVILIAN DISCLOSURE RISK MATRIX" with TOP SECRET stamps and classification markings. Sections visible include orbital shipyard data, fleet deployment maps, and highlighted in red: "NON-HUMAN SIGNAL EVENT / OUTER PERIMETER / ACTIVE." The tablet glows in a dark room. Dramatic close-up, classified document aesthetic with redaction bars and security watermarks, 4K quality.',
    threeDPrompt:
      'Government tablet displaying classified PROJECT ORPHEUS document with TOP SECRET stamps, fleet data, and highlighted non-human signal warning, classified document prop',
  },
  {
    name: 'Cover Story Protocols',
    kind: 'lore',
    description:
      'The systematic framework used by the Public Disinformation Bureau to explain away civilian observations of Space Fleet activity. Standard cover explanations include: sensor bloom, viral fabrication, classified test aircraft misidentified, astrophotography artifact, atmospheric distortion, weather balloons, ion reflections, swamp gas, and cosmic dust. As Mara describes it: "The truth is never hidden. It\'s buried under seven acceptable lies, and your career depends on repeating the right one at the right time." The latest cover story for fleet movement: "METEOROLOGICAL TEST FAILURE." The system is so effective that most people laugh off genuine evidence.',
    metadata: {
      loreType: 'Intelligence doctrine / Narrative control system',
      article:
        'The Cover Story Protocol hierarchy: Level 1 (default) — natural phenomenon (atmospheric distortion, swamp gas, cosmic dust). Level 2 — technology explanation (weather balloon, sensor bloom, classified test aircraft). Level 3 — social explanation (viral fabrication, hoax, astrophotography artifact). Level 4 — institutional dismissal (no evidence of unauthorized orbital infrastructure). Each civilian observation is assigned a triage score and routed to the appropriate cover level. News media coordination ensures consistent narrative deployment.',
      relatedConcepts:
        'Public Disinformation Bureau, Level 3 Triage, Civilian Observation Suppression Protocol',
      canonWeight: 'Hard Canon',
    },
    imagePrompt:
      'Infographic-style concept art showing the Cover Story Protocol hierarchy. A pyramid diagram with layers: at the bottom, natural explanations (weather, gas, dust); middle, technology explanations (balloons, test aircraft); top, institutional denial. Around the pyramid, screens show news chyrons debunking real sightings. At the very top, a tiny eye symbol watches everything. Documentary infographic crossed with paranoid thriller aesthetic, clean design with sinister undertones, 4K quality.',
    threeDPrompt:
      'Pyramid infographic of cover story hierarchy with surrounding news screens showing debunking chyrons, eye symbol at top, conspiracy thriller infographic style',
  },
  {
    name: 'Civilian Disclosure Risk Matrix',
    kind: 'lore',
    description:
      'A classified assessment framework within the Orpheus Briefing that quantifies the risks of public disclosure. Director Halden articulates its philosophy: "Do you know what happens if the public learns their governments have operated an off-book fleet for decades? Markets collapse. Alliances fracture. Religions split. Every population on Earth asks the same question: if you hid this, what else did you hide?" The matrix presumably assigns risk scores to various disclosure scenarios, informing decisions about how aggressively to suppress evidence and manage narrative.',
    metadata: {
      loreType: 'Classified risk assessment framework',
      article:
        'The Civilian Disclosure Risk Matrix models cascading societal collapse scenarios triggered by public knowledge of the hidden fleet. Key risk categories: (1) Economic — market collapse from trust erosion in institutional truthfulness, (2) Geopolitical — alliance fractures as nations question shared intelligence integrity, (3) Religious/Cultural — existential philosophical crisis across multiple belief systems, (4) Meta-Trust — the "if you hid THIS, what ELSE" cascade effect that undermines all institutional credibility simultaneously.',
      relatedConcepts:
        'Project Orpheus, The Orpheus Briefing, Director Halden, Cover Story Protocols',
      canonWeight: 'Hard Canon',
    },
    imagePrompt:
      'A classified risk assessment chart on a government screen. Rows labeled: ECONOMIC COLLAPSE, ALLIANCE FRACTURE, RELIGIOUS SCHISM, META-TRUST CASCADE. Columns show probability percentages in red. A world map below shows cascading failure zones spreading from disclosure point. Everything stamped CLASSIFIED — ORPHEUS EYES ONLY. Cold analytical aesthetic combined with the dread of civilizational collapse. Government thriller data visualization, 4K quality.',
    threeDPrompt:
      'Government screen showing classified risk matrix chart with cascading failure zones on world map, red probability bars, CLASSIFIED stamps, data visualization prop',
  },

  // ═══════════════════════════════════════════════════════════════════════
  // EVENTS
  // ═══════════════════════════════════════════════════════════════════════
  {
    name: 'Desert Sighting',
    kind: 'event',
    description:
      "The inciting event of the pilot. Eli, driving through the desert at night, witnesses three streaks of white light rising silently from behind mountains — too fast, too vertical, too controlled to be aircraft. The air shimmers. The stars distort. Something massive and invisible moves above. Moments later, his burner phone rings with an unknown caller who knows his name and warns him to stop looking up. This is the moment Eli's investigation becomes personal and dangerous — he is no longer just searching for evidence, he is being watched by the very apparatus he is trying to expose.",
    metadata: {
      era: 'Pilot episode — Night before Day 1 at Level 3',
      participants: 'Eli Vance, The Voice (phone caller), unknown fleet vessels',
      location: 'Desert highway, western restricted sector',
      causes: 'Eli driving near restricted airspace during an active launch window',
      outcome:
        'Eli receives direct warning from unknown operative. His investigation is now known to the surveillance apparatus.',
      canonStatus: 'Canon',
    },
    imagePrompt:
      'A dramatic scene on a desert highway at night. A man stands beside a stopped sedan, looking up at the sky with his phone to his ear. Above, three streaks of brilliant white light rise vertically from behind distant mountains. The air around the streaks shimmers and distorts, bending the star field. The sense of something impossibly large and invisible passing overhead. The desert is vast and empty. Sci-fi thriller key art, cinematic wide composition, dramatic sky, 4K quality.',
    threeDPrompt:
      'Desert highway night scene, man with phone beside sedan, three light streaks rising from mountains, distorted starfield, dramatic sci-fi thriller diorama',
  },
  {
    name: 'The Elevation',
    kind: 'event',
    description:
      'Eli arrives at the Defense Analysis Center to find his badge has been changed: ACCESS ELEVATED: TEMPORARY ASSIGNMENT. He is taken by elevator below all listed floors to the sublevel facility, where Director Halden walks him through the polished black corridors to the observation window overlooking the underground hangar. This is the moment Eli sees the truth: not prototypes, not experiments, but operational warships. Halden offers him a choice — loyalty or obscurity. Eli chooses to play along, accepting with a lie: "You\'ll have all three, sir." He palms a hidden data wafer, beginning his infiltration.',
    metadata: {
      era: 'Pilot episode — Day 2',
      participants: 'Eli Vance, Director Halden, Mara Chen',
      location: 'Defense Analysis Center sublevel facility / Underground Hangar',
      causes: 'Halden decides to recruit Eli after testing him in Level 3',
      outcome:
        'Eli gains access to Project Orpheus. Begins covert data collection with hidden wafer. Discovers Mara is also Orpheus personnel.',
      canonStatus: 'Canon',
    },
    imagePrompt:
      'A dramatic scene: two figures stand at an observation window in a polished black corridor. Through the reinforced glass, a vast underground hangar is visible with a matte-black warship floating in a magnetic cradle. The older figure (Halden) stands with authority, gesturing toward the ship. The younger figure (Eli) stares with barely concealed shock, one hand subtly clenched around something hidden in his palm. Dramatic backlighting from the hangar. Revelation moment, thriller aesthetic, 4K quality.',
    threeDPrompt:
      'Two figures at observation window overlooking underground hangar with floating warship, revelation moment, dramatic backlighting, thriller scene diorama',
  },
];

// ── Auth + tRPC helpers ─────────────────────────────────────────────────
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

// ── Main ────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('  SPACE FLEET — Wiki Population');
  console.log('  Pilot Episode: "Nothing to See Here"');
  console.log('  ' + ENTITIES.length + ' entities across all categories');
  console.log('═'.repeat(60));

  if (UNIVERSE_ADDR === '0x0000000000000000000000000000000000000000') {
    console.error('\n  ERROR: Set SPACE_FLEET_ADDR env var to the deployed universe address.');
    console.error('  Run create-space-fleet.ts first if the universe has not been deployed.\n');
    process.exit(1);
  }

  log('AUTH', 'Authenticating...');
  const token = await getAuthToken();
  log('AUTH', `Authenticated as ${account.address}`);

  const results: Array<{ name: string; kind: string; id: string | null; image: boolean }> = [];

  for (let i = 0; i < ENTITIES.length; i++) {
    const entity = ENTITIES[i];
    const label = `${entity.kind.toUpperCase()} ${i + 1}/${ENTITIES.length}`;

    console.log(`\n${'═'.repeat(55)}`);
    console.log(`  ${entity.name} (${entity.kind})`);
    console.log(`${'═'.repeat(55)}`);

    // 1. Generate 2D art
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
        log(label, `2D art: ${imageUrl.slice(0, 80)}...`);
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
          metadata: entity.metadata || {},
          monetized: false,
        },
        token
      );
      entityId = created?.id || null;
      log(label, `Entity created: ${entityId}`);
    } catch (err: any) {
      log(label, `Entity creation failed: ${err.message?.slice(0, 200)}`);
    }

    // 3. Fire-and-forget 3D model
    if (entityId) {
      log(label, 'Kicking off 3D model (fire-and-forget)...');
      try {
        const threeDResult = await tRPCMutate<{ generationId: string; status: string }>(
          'threed.textTo3DPreview',
          {
            prompt: entity.threeDPrompt,
            artStyle: 'realistic',
            entityId,
            universeId: UNIVERSE_ADDR,
          },
          token
        );
        if (threeDResult?.generationId) {
          log(label, `3D task queued: ${threeDResult.generationId}`);
        }
      } catch (err: any) {
        log(label, `3D generation failed: ${err.message?.slice(0, 150)}`);
      }
    }

    results.push({ name: entity.name, kind: entity.kind, id: entityId, image: !!imageUrl });
    log(label, `DONE — "${entity.name}"`);

    // Small delay between entities to avoid rate limits
    if (i < ENTITIES.length - 1) await sleep(1500);
  }

  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log('  SPACE FLEET — Wiki Population Complete');
  console.log('═'.repeat(60));
  const created = results.filter((r) => r.id);
  const failed = results.filter((r) => !r.id);
  console.log(`  Created: ${created.length}/${results.length}`);
  if (failed.length) {
    console.log(`  Failed:  ${failed.map((r) => r.name).join(', ')}`);
  }
  console.log('');

  const byKind: Record<string, string[]> = {};
  for (const r of created) {
    if (!byKind[r.kind]) byKind[r.kind] = [];
    byKind[r.kind].push(r.name);
  }
  for (const [kind, names] of Object.entries(byKind)) {
    console.log(`  ${kind.toUpperCase()}:`);
    for (const n of names) console.log(`    - ${n}`);
  }

  console.log(`\n  Universe: ${UNIVERSE_ADDR}`);
  console.log(`  View at: http://localhost:5173/wiki\n`);
}

main().catch((err) => {
  console.error('FAILED:', err.message ?? err);
  process.exit(1);
});
