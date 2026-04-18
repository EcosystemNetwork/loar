/**
 * Create the "Fallout: Fogline" universe — Post-apocalyptic Bay Area, 2296.
 *
 * A scavenger from Oakland follows a signal across the ruined Bay to Sutro Tower,
 * where a pre-war AI holds the key to clean water and weather control.
 *
 * Usage:
 *   pnpm tsx scripts/create-fogline-universe.ts
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
const PINATA_JWT = process.env.PINATA_JWT;
const PINATA_GATEWAY = process.env.PINATA_GATEWAY_URL ?? 'https://gateway.pinata.cloud';

const UNIVERSE_NAME = 'Fallout: Fogline';
const UNIVERSE_DESCRIPTION = `The year is 2296. The bombs fell two centuries ago, but the Bay Area refuses to die.

Radioactive fog rolls across black water where the Golden Gate Bridge rises like the skeleton of a dead god — broken cables, rusted towers, old world bones. Half-sunken cargo ships drift near Alcatraz, now crowned with scrap-metal walls and spotlights. The East Bay survives through grit, scrap trading, and rationed brown water. San Francisco is a dead dream — cracked towers, cable cars fused into streets, mutated eucalyptus pushing through asphalt.

But something is waking up.

A pre-war emergency coordination AI called FOGLINE has been running on backup power beneath Sutro Tower for 219 years, quietly holding back radiation storms with weather beacons nobody knew existed. When a scavenger named Mara Reyes follows a Vault-Tec signal compass across the Bay, she discovers that the old world left one last gift buried in the infrastructure — clean water, storm suppression, and a functioning civic response grid waiting for someone to say the oath.

The Brotherhood wants the tower for strategic control. Oakland needs it for survival. And a ghoul transit worker named Amos Quinn — who was literally on the clock when the bombs dropped — holds the only badge number the system still recognizes.

War never changes. But cities do.

This is the Bay Area wasteland. Fog, ferals, and the stubborn belief that civilization is worth rebuilding from the ruins.`;

// ── Image Generation (Google Imagen 4 + Pinata IPFS) ────────────────

async function generateAndUploadCoverImage(): Promise<string> {
  if (!GOOGLE_API_KEY) throw new Error('GOOGLE_API_KEY is not set');

  const prompt = [
    'Epic cinematic movie poster for a post-apocalyptic San Francisco Bay Area.',
    'The Golden Gate Bridge rises broken and rusted through thick radioactive green-tinged fog,',
    'cables snapped, towers skeletal against a sickly amber sky.',
    'In the foreground, a young woman in scavenged highway-sign armor and a football helmet',
    'stands on rubble overlooking the ruined city, laser rifle on her back,',
    'a small blinking green compass device in her hand.',
    'Behind her, the cracked skyline of San Francisco — hollow towers, fused cable cars.',
    'In the far distance, a radio tower blinks red through the fog like a heartbeat.',
    'Half-sunken ships near an island fortress with scrap-metal walls.',
    'Color palette: irradiated amber, rust red, fog grey, toxic green glow, steel blue moonlight.',
    'Post-apocalyptic video game aesthetic meets gritty realism.',
    'Ultra-detailed, 8K, dramatic volumetric fog and god-rays, concept art style.',
    'No text, no watermarks, no logos.',
  ].join(' ');

  console.log('  Calling Google Imagen 4...');
  const model = 'imagen-4.0-generate-001';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict?key=${GOOGLE_API_KEY}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: {
        sampleCount: 1,
        aspectRatio: '16:9',
        safetyFilterLevel: 'BLOCK_ONLY_HIGH',
        personGeneration: 'ALLOW_ADULT',
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`Google Imagen API error ${response.status}: ${text.slice(0, 300)}`);
  }

  const data = (await response.json()) as {
    predictions?: Array<{ bytesBase64Encoded: string; mimeType: string }>;
  };

  if (!data.predictions?.length) {
    throw new Error(
      'Google Imagen returned no images — prompt may have been blocked by safety filters'
    );
  }

  const base64 = data.predictions[0].bytesBase64Encoded;
  console.log(`  Generated image (${((base64.length * 0.75) / 1024).toFixed(0)} KB)`);

  // Upload to Pinata IPFS for permanent hosting
  if (PINATA_JWT) {
    console.log('  Uploading to Pinata IPFS...');
    const buffer = Buffer.from(base64, 'base64');
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: 'image/png' }), 'fogline-cover.png');
    form.append('pinataMetadata', JSON.stringify({ name: 'Fallout: Fogline cover art' }));

    const pinRes = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
      method: 'POST',
      headers: { Authorization: `Bearer ${PINATA_JWT}` },
      body: form,
    });

    if (pinRes.ok) {
      const pinData = (await pinRes.json()) as { IpfsHash: string };
      const permanentUrl = `${PINATA_GATEWAY}/ipfs/${pinData.IpfsHash}`;
      console.log(`  Pinned to IPFS: ${pinData.IpfsHash}`);
      return permanentUrl;
    }
    console.log(`  Pinata upload failed (${pinRes.status}), using data URI fallback`);
  }

  // Fallback: base64 data URI (not ideal for production but works)
  return `data:image/png;base64,${base64}`;
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
    name: 'Mara Reyes',
    kind: 'person',
    description:
      "A 24-year-old scavenger from the Oakland Free Trade Zone. Lean, sharp-eyed, and relentlessly practical. Mara wears pieced-together armor fabricated from highway signs and an old Cal football helmet, with a jury-rigged laser rifle strapped to her back. She's not a hero by temperament — she's a survivor who does math on risk versus reward. But her settlement has been rationing brown water for a month, and when a cracked Vault-Tec signal compass starts blinking toward San Francisco, she makes the calculation that crossing the most dangerous stretch of the wasteland is better odds than watching her people slowly poison themselves.\n\nMara trades in microfusion cells she acquires through channels she won't discuss. She haggles hard, moves fast, and doesn't scare easily — though she'd never admit that the fog unsettles her. She crosses the Bay through the collapsed Transbay Tunnel, teams up with a ghoul she doesn't trust, faces down Brotherhood Outcasts she can't outgun, and ultimately activates a pre-war water system that changes the East Bay's future. She doesn't do it for glory. She does it because somebody had to, and she was already walking in that direction.",
    metadata: {
      role: 'Protagonist / Scavenger',
      age: 24,
      faction: 'Oakland Free Trade Zone',
      equipment:
        'Highway-sign armor, Cal helmet, jury-rigged laser rifle, Vault-Tec signal compass',
    },
  },
  {
    name: 'Amos Quinn',
    kind: 'person',
    description:
      "A ghoul in his pre-war 50s — which makes him roughly 270 years old. Skin like burnt parchment, eyes intelligent and profoundly tired. Amos wears a torn MUNI transit jacket and carries a long-barreled revolver and a satchel of tools. Before the bombs, he was a San Francisco Municipal Transit systems engineer — \"mostly janitor,\" as he puts it, though his badge number (11-4-7-2) is still in FOGLINE's pension records.\n\nAmos survived the Great War by being underground in a maintenance shaft when the bombs hit. He's spent two centuries drifting through the Bay Area ruins, fixing things that don't need fixing anymore and avoiding people who'd shoot him for his face. He lives in the Transbay Tunnel not out of choice but out of habit — it's the last piece of infrastructure he recognizes.\n\nWhen Mara stumbles into his tunnel with a signal compass, Amos recognizes what it's pointing at and reluctantly agrees to guide her. His civic access credentials — a janitor's badge from a city that no longer exists — turn out to be the key to activating FOGLINE's emergency protocols. He reroutes power to the East Bay pumps not because he's a hero, but because \"the city finally did one decent thing.\" He's dry, resigned, oddly warm, and completely done being surprised by the wasteland.",
    metadata: {
      role: 'Deuteragonist / Guide',
      age: '~270 (appears 50s)',
      species: 'Ghoul',
      faction: 'Unaffiliated',
      equipment: 'Long-barreled revolver, tool satchel, torn MUNI jacket, Badge 11-4-7-2',
    },
  },
  {
    name: 'Paladin Vega',
    kind: 'person',
    description:
      'Leader of a Brotherhood Outcast squad operating in the San Francisco ruins. Early 30s, disciplined, cold, and absolutely certain that technology belongs in the hands of those qualified to use it — meaning the Brotherhood. Vega wears mixed armor with salvaged power armor plates (not standard issue, marking her unit as Outcasts rather than mainline Brotherhood). She carries a plasma pistol and speaks with the clipped authority of someone who\'s never had to justify her worldview to anyone who mattered.\n\nVega has been tracking the signal compass for weeks, considering it Brotherhood property by default: "Everything useful had our name on it. People just forgot." She\'s not a villain in her own mind — she genuinely believes that concentrating technology under Brotherhood control is the path to rebuilding civilization. When she says "civilization decides," she means it. She just defines civilization very narrowly.\n\nAt Sutro Tower, Vega wants to preserve FOGLINE\'s power for communications and strategic defense. When Amos burns the reserves for water purification and storm suppression, she considers it a catastrophic waste of a strategic asset "for squatters." She\'ll be back with more guns. That\'s not a threat — it\'s logistics.',
    metadata: {
      role: 'Antagonist / Brotherhood Outcast Leader',
      age: '30s',
      faction: 'Brotherhood Outcasts',
      equipment: 'Mixed power armor plates, plasma pistol',
    },
  },
  {
    name: 'FOGLINE',
    kind: 'person',
    description:
      'Regional Emergency Coordination Intelligence, last fully updated October 23, 2077 — the day the bombs fell. FOGLINE is a pre-war AI housed in the relay bunker beneath Sutro Tower, originally designed to coordinate Bay Area civic emergency response: weather monitoring, water infrastructure, communications routing, and municipal services.\n\nFor 219 years, FOGLINE has been running on backup power, performing its programmed duties for a city that no longer exists. Its most significant ongoing operation: maintaining offshore weather beacons that suppress incoming radiation fronts, preventing the fog from becoming lethal rather than merely hazardous. It has been doing this silently, without anyone knowing, because no one told it to stop.\n\nFOGLINE speaks in a calm, clipped female voice with the bureaucratic warmth of a transit announcement. It offers "municipal arbitration" when Mara and Vega reach a command deadlock, recognizes Amos\'s pre-war pension records, and processes his civic oath to restore water service to Oakland with the same procedural politeness it would have used for a parking permit. Its final line — "Municipal notice: service restoration in progress. Thank you for your patience" — is either perfectly programmed or quietly hilarious. Possibly both.',
    metadata: {
      role: 'Key Supporting / Pre-War AI',
      species: 'Artificial Intelligence',
      location: 'Sutro Tower Relay Bunker',
      lastUpdate: 'October 23, 2077',
    },
  },
  {
    name: 'The Old Merchant',
    kind: 'person',
    description:
      'A weathered scrap trader operating out of a flipped autonomous taxi in the Oakland Free Trade Zone. Sells salvaged tech, including the cracked Vault-Tec signal compass that sets the story in motion. Shrewd but not dishonest — he charges what the market bears and doesn\'t ask where microfusion cells come from. He warns Mara about the signal pointing toward San Francisco: "Nothing out there but fog, ferals, and fools." When she buys the compass anyway, he tells her the signal is strongest near Sutro Tower and mentions rumors of a pre-war weather net waking up. His parting words — "Ghosts don\'t scare me." "Out here, they should." — are the last sensible advice Mara ignores.',
    metadata: {
      role: 'Minor Character / Catalyst',
      faction: 'Oakland Free Trade Zone',
      location: 'East Bay Scrap Market',
    },
  },
];

const FACTIONS: EntitySeed[] = [
  {
    name: 'Oakland Free Trade Zone',
    kind: 'faction',
    description:
      "The largest functioning settlement in the East Bay wasteland, built in the ruins of Oakland. A chaotic but functioning scrap economy organized around the East Bay Scrap Market — a maze of welded sheet metal, smashed Teslas, busted BART cars, and scavenger stalls. Trade runs on caps or batteries. Synths are banned. The population survives through salvage, barter, and sheer stubbornness.\n\nThe Free Trade Zone has no formal government — it's held together by trade relationships, mutual defense agreements, and the understanding that shooting your customers is bad for business. Water is the critical vulnerability: the settlement has been rationing contaminated brown water for weeks, with no purification infrastructure and no prospect of getting any. This is what drives Mara's mission to Sutro Tower.\n\nWhen FOGLINE reactivates the East Bay pumping spine, the Free Trade Zone becomes the first settlement in the Bay Area to receive restored municipal water service — a 27% improvement in potable water within 48 hours. This will transform Oakland from a scrap outpost into a genuine power center, which means every raider, faction, and opportunist in the wasteland will come knocking.",
    metadata: {
      alignment: 'Neutral / Survivalist',
      territory: 'Oakland ruins, East Bay',
      population: 'Several thousand',
      economy: 'Caps or batteries, scrap trade',
    },
  },
  {
    name: 'Brotherhood Outcasts',
    kind: 'faction',
    description:
      "A splinter group operating in the San Francisco ruins, distinct from the mainline Brotherhood of Steel. They wear mixed armor with salvaged power armor plates rather than full standard-issue suits, suggesting limited resources or separation from the main chapter's supply chain. Led by Paladin Vega, this squad has been tracking Vault-Tec signals across the city for weeks.\n\nThe Outcasts operate on Brotherhood doctrine distilled to its hardest core: technology is too dangerous for wastelanders, and the Brotherhood's duty is to secure it — all of it. \"Everything useful had our name on it. People just forgot.\" They see themselves as civilization's custodians, which conveniently means they get to decide who benefits from pre-war tech and who doesn't.\n\nVega's squad wanted Sutro Tower for communications and strategic defense — a command-and-control node that would give the Outcasts dominance over Bay Area signals. When Amos burns the power for water and weather instead, the Outcasts lose the strategic asset but gain a grudge. They'll return with reinforcements. The question is whether Oakland will be strong enough to hold what it's gained.",
    metadata: {
      alignment: 'Lawful Neutral / Authoritarian',
      territory: 'San Francisco ruins',
      equipment: 'Mixed power armor, plasma weapons, salvaged Brotherhood tech',
    },
  },
  {
    name: 'Feral Ghoul Packs',
    kind: 'faction',
    description:
      "The degenerated remnants of humans who suffered extreme radiation exposure and lost their cognitive function. Feral ghouls infest the dark, enclosed spaces of the Bay Area wasteland — particularly the Transbay Tunnel system, collapsed BART stations, and the lower levels of San Francisco's hollow towers. They attack on sight, driven by predatory instinct rather than malice.\n\nThe ferals in the Transbay Tunnel are particularly dangerous because the enclosed space funnels their pack behavior. They respond to sound and movement, hunting in groups that coordinate through growls and spatial awareness. Mara and Amos encounter a pack in the maintenance shaft and barely escape by sealing a half-dead emergency bulkhead gate. The ferals represent the wasteland's baseline threat: not organized, not strategic, but relentless and everywhere.",
    metadata: {
      alignment: 'Hostile / Feral',
      territory: 'Tunnels, ruins, dark enclosed spaces',
      threat: 'Pack predators, sound-responsive',
    },
  },
];

const PLACES: EntitySeed[] = [
  {
    name: 'Golden Gate Bridge Ruins',
    kind: 'place',
    description:
      'The skeletal remains of the Golden Gate Bridge, rising out of radioactive fog like the bones of a dead god. Broken cables hang slack, towers stand rusted and stripped. The bridge is impassable — sections have collapsed into the Bay — but it remains the defining landmark of the wasteland, visible from both shores on clear days (which are rare). It serves as a navigational reference, a symbol of what was lost, and a reminder that the old world built things magnificent enough to survive even its own destruction. Half-sunken cargo ships drift in the water nearby, part of the debris field that makes Bay crossing treacherous by boat.',
    metadata: {
      type: 'Landmark / Ruins',
      status: 'Impassable, structural collapse',
      significance: 'Iconic wasteland landmark',
    },
  },
  {
    name: 'Alcatraz Fortress',
    kind: 'place',
    description:
      "The former federal penitentiary island, now crowned with scrap-metal walls and spotlights. Alcatraz has been fortified by unknown occupants — the walls and lights suggest organization and resources, but the island's current inhabitants and allegiances are not explored in the Fogline narrative. It sits in the Bay as a visible but inaccessible power center, its spotlights cutting through the fog at night. Whether it's a raider stronghold, a settlement, or something stranger is a question for another crossing.",
    metadata: {
      type: 'Fortified Island',
      status: 'Occupied, fortified with scrap walls and spotlights',
      controlledBy: 'Unknown',
    },
  },
  {
    name: 'East Bay Scrap Market',
    kind: 'place',
    description:
      'The commercial heart of the Oakland Free Trade Zone. A sprawling maze of welded sheet metal, smashed Teslas repurposed as storefronts, busted BART cars converted to workshops, and scavenger stalls selling everything from ammunition to pre-war canned food. Signs announce the rules: OAKLAND FREE TRADE ZONE / NO SYNTHS / CAPS OR BATTERIES ONLY.\n\nThe market is loud, crowded, and functional — the closest thing to a functioning economy in the East Bay. Merchants operate from creative repurposing: the Old Merchant sells salvaged tech from a flipped autonomous taxi. Payment is strictly caps or batteries; microfusion cells are premium currency that raises eyebrows and shuts down questions. The market is where Mara acquires the Vault-Tec signal compass that starts her journey, trading a working microfusion cell of questionable provenance.',
    metadata: {
      type: 'Settlement / Market',
      location: 'Oakland Ruins, East Bay',
      controlledBy: 'Oakland Free Trade Zone',
      economy: 'Caps, batteries, barter',
    },
  },
  {
    name: 'Transbay Tunnel',
    kind: 'place',
    description:
      'A dead artery beneath San Francisco Bay — the collapsed remains of the BART tunnel system connecting Oakland to San Francisco. The main tubes are flooded or collapsed, but the maintenance shafts remain partially navigable for those desperate or foolish enough to use them. Dripping water, cracked concrete, emergency lights flickering on ancient backup power that has somehow lasted 219 years.\n\nThe tunnel is infested with feral ghouls who hunt by sound in the darkness. The maintenance shaft has bulkhead emergency gates that still partially function — Mara seals one to trap a pursuing feral pack, crushing two in the process. The tunnel is the only viable crossing point for a person on foot: the bridges are collapsed, boats are scarce and exposed to fog creatures, and swimming the irradiated Bay is suicide. Amos has been living in the tunnel system for an indeterminate time, surviving in the infrastructure he once maintained.',
    metadata: {
      type: 'Underground Passage',
      status: 'Partially navigable via maintenance shafts',
      hazards: 'Feral ghouls, flooding, structural collapse',
      connects: 'Oakland to San Francisco',
    },
  },
  {
    name: 'San Francisco Ruins',
    kind: 'place',
    description:
      "A dead dream. The former city of San Francisco stands as a cracked and hollow monument to the pre-war world. Downtown towers are gutted shells. Cable cars lie fused into the streets where they stopped 219 years ago, never to move again. Mutated eucalyptus trees push through cracked asphalt, reclaiming blocks that once held millions. The streets are silent except for wind, fog, and things that hunt in both.\n\nBrotherhood Outcast scouts have marked the ruins with blood-red graffiti: TECH BELONGS TO THE ORDER. The Haight Street corridor is a narrow gauntlet of bombed-out storefronts where wind chimes made of bones click in the fog and a mural of a mushroom cloud is painted over a peace sign — the wasteland's commentary on the Summer of Love. San Francisco is not uninhabited, but it is uninhabitable in any meaningful sense. It exists as a treasure vault of pre-war technology guarded by radiation, ferals, Brotherhood patrols, and the fog itself.",
    metadata: {
      type: 'Ruined Megacity',
      status: 'Largely abandoned, Brotherhood-patrolled',
      hazards: 'Fog, ferals, Brotherhood Outcasts, radiation',
      landmarks: 'Hollow towers, fused cable cars, Haight Street ruins',
    },
  },
  {
    name: 'Sutro Tower Relay Bunker',
    kind: 'place',
    description:
      "The nerve center of Bay Area infrastructure — a fortified maintenance bunker at the base of Sutro Tower bearing old Vault-Tec and U.S. military markings. Inside: banks of ancient servers humming on backup power, dusty monitors glowing green, and the main terminal displaying BAY CIVIC RESPONSE GRID – STANDBY. This is where FOGLINE lives.\n\nThe bunker was part of a pre-war relay nexus: weather control, emergency signal routing, military line-of-sight communications links, all patched together by whoever survived long enough after the bombs to need them. The tower itself blinks red through the fog, visible from across the Bay — a beacon that the signal compass has been tracking.\n\nWhen activated by Amos's civic credentials, FOGLINE can reroute power to the East Bay pumping spine (restoring water purification), maintain offshore fog suppression beacons (preventing radiation storms), and coordinate communications from Marin to San Jose. The catch: these functions compete for limited power reserves. Using the tower for water and weather means sacrificing its value as a strategic communications hub — the exact trade-off that puts Mara and Vega at each other's throats.",
    metadata: {
      type: 'Pre-War Bunker / AI Core',
      location: 'Base of Sutro Tower, San Francisco',
      controlledBy: 'FOGLINE (autonomous)',
      systems: 'Civic response grid, weather beacons, water infrastructure, communications relay',
    },
  },
  {
    name: 'Haight Street Ruins',
    kind: 'place',
    description:
      "A narrow corridor of bombed-out storefronts in the San Francisco ruins, once the heart of the 1960s counterculture movement. Now a kill zone. Wind chimes made from human and animal bones click in the radioactive fog. A mural of a mushroom cloud has been painted over a faded peace sign — the wasteland's dark commentary on the neighborhood's legacy.\n\nThis is where the Brotherhood Outcasts ambush Mara and Amos. The narrow street and ruined buildings provide perfect cover for an ambush: laser sights appear from nowhere, and three Outcasts materialize from the wreckage. The encounter forces an uneasy alliance — Vega can't navigate the changed city, Mara can't outgun power armor, and everyone needs the tower.",
    metadata: {
      type: 'Ruins / Ambush Site',
      location: 'San Francisco',
      significance: 'Brotherhood ambush location, ironic counterculture graveyard',
    },
  },
];

const LORE: EntitySeed[] = [
  {
    name: 'The Great War — Bay Area Impact',
    kind: 'event',
    description:
      "October 23, 2077. The day the bombs fell. The Bay Area was hit hard — San Francisco's skyline was shattered, infrastructure collapsed, and the population was decimated in hours. The Golden Gate Bridge suffered catastrophic structural failure. BART tunnels flooded or collapsed. The fog, already the region's defining weather pattern, became irradiated — a rolling blanket of contamination that never fully lifted.\n\nFOGLINE, the regional emergency coordination AI, received its last full update at the moment of detonation and has been running on emergency protocols ever since. Amos Quinn, a transit systems engineer, was underground in a maintenance shaft when the bombs hit — the radiation that killed billions instead transformed him into a ghoul, preserving his mind while destroying his body. The old world ended in a flash, but its infrastructure proved more resilient than its people. 219 years later, a janitor's badge number is still in the pension database.",
    metadata: {
      date: 'October 23, 2077',
      significance: "Apocalyptic origin event, FOGLINE's last update, Amos Quinn's ghoulification",
    },
  },
  {
    name: 'The Signal Compass',
    kind: 'lore',
    description:
      "A cracked Vault-Tec signal compass that serves as the story's MacGuffin and catalyst. The device blinks faint green and has been pointing toward San Francisco — specifically toward Sutro Tower — for three weeks before Mara purchases it from the Old Merchant in the East Bay Scrap Market.\n\nThe compass is tracking FOGLINE's emergency broadcast beacon, which the AI has been transmitting on Vault-Tec frequencies as part of its civic emergency protocols. The signal grew stronger recently because FOGLINE's power systems hit a threshold that activated a dormant broadcast mode — essentially, the AI started calling for help after 219 years of running silent.\n\nMara buys the compass for a working microfusion cell (the Old Merchant wanted 200 caps, but she was short). The merchant warns her: \"Still points somewhere. In the wasteland, that makes it holy.\" He's not wrong. The compass leads directly to the most valuable piece of pre-war infrastructure still functioning in the Bay Area.",
    metadata: {
      type: 'Pre-War Tech / MacGuffin',
      origin: 'Vault-Tec',
      significance: 'Catalyst for the entire narrative',
    },
  },
  {
    name: 'The Fog',
    kind: 'lore',
    description:
      "The defining environmental feature of the Bay Area wasteland. The fog that once defined San Francisco's climate became irradiated after the Great War, transforming from a meteorological phenomenon into a slow-killing hazard. Thick, radioactive, rolling across the black water of the Bay, it reduces visibility, contaminates exposed water sources, and makes open-air travel dangerous.\n\nWhat nobody in the wasteland knows: FOGLINE has been actively suppressing the worst of the fog for decades using offshore weather beacons. The AI's storm suppression system breaks incoming radiation fronts before they reach the coast, keeping the fog hazardous rather than lethal. Without FOGLINE's intervention, the fog would be dense enough to kill crops from the Bay to Vallejo. This is the leverage Amos uses against Vega: if the Brotherhood hoards FOGLINE's power for communications, the weather beacons go dark and agriculture collapses across the entire region. The fog is not just atmosphere — it's a ticking clock held in check by a machine nobody thanked.",
    metadata: {
      significance: "Central environmental hazard, managed by FOGLINE's weather beacons",
    },
  },
  {
    name: 'The Civic Oath Protocol',
    kind: 'lore',
    description:
      "FOGLINE's legacy authentication system — a pre-war municipal protocol that grants command access to recognized civic employees. When Mara and Vega reach a deadlock over how to use the tower's power, FOGLINE offers \"municipal arbitration\" and asks for a department and service designation.\n\nAmos Quinn — a ghoul who was literally a city employee when the bombs fell — recites his credentials: San Francisco Municipal Transit, Maintenance Division, Badge 11-4-7-2. FOGLINE cross-references its pre-war pension records, confirms a partial identity match, and grants civic access. A janitor's badge from a dead city becomes the authorization code that restores water to Oakland.\n\nThe protocol is both absurd and deeply moving: a bureaucratic system designed for parking permits and overtime disputes becomes the mechanism through which a 270-year-old ghoul saves thousands of lives. The old world's obsessive record-keeping, which probably annoyed Amos every payday, turns out to be the thing that matters most.",
    metadata: {
      significance: 'Narrative turning point — bureaucratic system becomes salvation mechanism',
    },
  },
  {
    name: 'East Bay Water Crisis',
    kind: 'lore',
    description:
      "The immediate crisis driving the plot. The Oakland Free Trade Zone has been rationing contaminated brown water for over a month. Without purification infrastructure, the settlement is slowly poisoning itself. This is what motivates Mara to follow the signal compass across the Bay — not treasure hunting or adventure, but the pragmatic calculation that finding the signal's source might lead to something that can help.\n\nWhen FOGLINE reactivates the East Bay pumping spine, it reports a 27% improvement in potable water for Oakland sectors within 48 hours. This doesn't solve the crisis entirely, but it transforms Oakland from a settlement drinking poison to one with a functioning (if limited) water supply. The cost: 42% of FOGLINE's remaining power reserves, which Vega considers a catastrophic waste. The benefit: thousands of people stop dying slowly. Mara doesn't hesitate. Amos doesn't either.",
    metadata: { significance: 'Primary plot motivation, resolved by FOGLINE activation' },
  },
];

const TECHNOLOGIES: EntitySeed[] = [
  {
    name: 'FOGLINE Civic Response Grid',
    kind: 'technology',
    description:
      "The Bay Civic Response Grid — a pre-war emergency coordination system housed beneath Sutro Tower. Designed to manage regional infrastructure during disasters: weather monitoring via offshore beacons, water distribution through the East Bay pumping spine, communications relay covering Marin to San Jose, and municipal service coordination.\n\nThe system has been running autonomously on backup power since October 23, 2077. Its most critical ongoing function — offshore fog suppression via weather beacons — has been operating without human knowledge or authorization for 219 years, preventing radiation storms from rendering the Bay Area completely uninhabitable.\n\nFOGLINE's power reserves are finite and its functions compete: communications relay, weather beacons, and water infrastructure cannot all run at full capacity simultaneously. Amos's decision to prioritize water and weather over communications is the story's central moral choice — survival of the many versus strategic advantage for the few.",
    metadata: {
      type: 'Pre-War Infrastructure AI',
      builder: 'Vault-Tec / U.S. Military / Municipal Government',
      status: 'Operational on backup power, 219 years autonomous',
    },
  },
  {
    name: 'Vault-Tec Signal Compass',
    kind: 'technology',
    description:
      'A cracked, battered pre-war device that tracks Vault-Tec emergency frequencies. The compass blinks faint green and increases its pulse rate as it approaches the signal source. Mara acquires it from the Old Merchant for a microfusion cell.\n\nThe compass is tracking FOGLINE\'s emergency broadcast — a dormant signal that recently activated when the AI\'s power systems hit a threshold. The device itself is unremarkable Vault-Tec hardware, mass-produced for civil defense purposes. Its value lies entirely in what it points to. As the Old Merchant observes: "Still points somewhere. In the wasteland, that makes it holy."',
    metadata: {
      type: 'Navigation / Signal Tracking',
      origin: 'Vault-Tec',
      status: 'Cracked but functional',
    },
  },
  {
    name: 'Jury-Rigged Laser Rifle',
    kind: 'technology',
    description:
      "Mara's primary weapon — a laser rifle assembled from salvaged components, held together with wire, tape, and mechanical ingenuity. It fires red laser bolts effective against ferals and unarmored targets. The weapon is a testament to wasteland engineering: nothing about it is elegant, but everything about it works. Mara uses it to cut through feral ghouls in the Transbay Tunnel with precision that suggests she's been surviving with it for a long time.",
    metadata: {
      type: 'Energy Weapon',
      origin: 'Wasteland salvage/fabrication',
      user: 'Mara Reyes',
    },
  },
  {
    name: 'Offshore Weather Beacons',
    kind: 'technology',
    description:
      'A network of pre-war weather modification devices positioned offshore in the Pacific, maintained and operated by FOGLINE for 219 years without human knowledge. The beacons generate electromagnetic fields that disrupt incoming radiation fronts, breaking up the worst radioactive weather systems before they make landfall.\n\nThe beacons are crude by pre-war standards but effective enough to keep the Bay Area fog hazardous rather than lethal. Without them, radiation storms would destroy agriculture from the coast to Vallejo. FOGLINE allocates a significant portion of its diminishing power reserves to keeping the beacons operational — a silent act of civic duty performed by a machine that was never told to stop protecting a city that no longer exists.',
    metadata: {
      type: 'Weather Modification / Radiation Suppression',
      operator: 'FOGLINE (autonomous)',
      range: 'Pacific coast, Bay Area coverage',
    },
  },
];

const SPECIES: EntitySeed[] = [
  {
    name: 'Ghouls',
    kind: 'species',
    description:
      'Humans who survived extreme radiation exposure through a poorly understood biological process that halted aging but caused severe physical deterioration. Ghoul skin resembles burnt parchment, and their appearance is disturbing enough that many settlements ban or ostracize them. Crucially, ghouls retain their pre-war memories and cognitive function — Amos Quinn remembers his badge number, his job, his MUNI jacket, and presumably every day of the 219 years since the bombs fell.\n\nThe distinction between sentient ghouls and feral ghouls is absolute but poorly understood. Ferals have lost all higher brain function and operate on predatory instinct. Sentient ghouls like Amos are fully cognitive but face constant prejudice — the Oakland Free Trade Zone\'s "NO SYNTHS" sign doesn\'t mention ghouls, but the implication is clear in how Amos chooses to live underground rather than among people.\n\nAmos\'s ghoulification is the story\'s quiet tragedy: the radiation gave him functional immortality but took his face, his world, and everyone he knew. When Mara asks "Didn\'t [the old world] ever leave one for you?", Amos replies: "It left me this face."',
    metadata: {
      origin: 'Extreme radiation exposure',
      characteristics:
        'Halted aging, severe physical deterioration, full cognitive retention (sentient) or complete cognitive loss (feral)',
    },
  },
];

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('  LOAR — Creating FALLOUT: FOGLINE');
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

  const app = initializeApp({ credential: cert(serviceAccount) }, 'fogline-' + Date.now());
  const db = getFirestore(app);
  db.settings({ preferRest: true });
  console.log(`  Firebase : ${serviceAccount.project_id}`);
  console.log(`  Creator  : ${CREATOR_ADDRESS}`);
  console.log(`  Imagen   : ${GOOGLE_API_KEY ? 'configured' : 'missing'}`);
  console.log(`  Pinata   : ${PINATA_JWT ? 'configured' : 'missing'}\n`);

  // ── Step 1: Generate AI cover image ────────────────────────────────
  console.log('Step 1: Generating cover image via Google Imagen 4...');

  let coverImageUrl: string;
  try {
    coverImageUrl = await generateAndUploadCoverImage();
    console.log(`  URL: ${coverImageUrl.slice(0, 80)}...\n`);
  } catch (err: any) {
    console.log(`  Image generation failed: ${err.message}`);
    console.log(`  Using placeholder image\n`);
    coverImageUrl =
      'https://images.unsplash.com/photo-1542281286-9e0a16bb7366?w=1200&h=675&fit=crop';
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
    paymentRef: 'fogline-genesis',
    credits: CREDITS,
    ethAmountWei: '0',
    source: 'genesis',
    note: 'Fallout: Fogline — genesis credits',
    createdAt: now,
  });
  console.log(`  Credit transaction logged\n`);

  // ── Step 3: Seed entities ─────────────────────────────────────────
  console.log('Step 3: Seeding worldbuilding entities...\n');

  const allEntities: EntitySeed[] = [
    ...CHARACTERS,
    ...FACTIONS,
    ...PLACES,
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
  console.log('  FALLOUT: FOGLINE — LIVE ON LOAR');
  console.log('═'.repeat(60));
  console.log(`  Universe ID  : ${universeId}`);
  console.log(`  Name         : ${UNIVERSE_NAME}`);
  console.log(`  Creator      : ${CREATOR_ADDRESS}`);
  console.log(`  Credits      : ${CREDITS}`);
  console.log(`  Entities     : ${seeded}`);
  console.log(`    Characters : ${CHARACTERS.length}`);
  console.log(`    Factions   : ${FACTIONS.length}`);
  console.log(`    Places     : ${PLACES.length}`);
  console.log(`    Lore/Events: ${LORE.length}`);
  console.log(`    Technology : ${TECHNOLOGIES.length}`);
  console.log(`    Species    : ${SPECIES.length}`);
  console.log(`  Cover Image  : ${coverImageUrl.slice(0, 70)}...`);
  console.log(`  Access Model : open`);
  console.log('═'.repeat(60));
  console.log(`\n  View at: /universe/${universeId}\n`);
  console.log('  War never changes. But cities do.\n');

  process.exit(0);
}

main().catch((err) => {
  console.error('\nFailed:', err.message ?? err);
  process.exit(1);
});
