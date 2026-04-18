/**
 * VOIDBORN SAGA — Wiki Population
 *
 * Populates all characters, places, factions, technology, vehicles, species,
 * lore, and events from the pilot episode "Crash Landing".
 *
 * Each entity gets a Google Imagen 4 portrait + a fire-and-forget 3D model.
 *
 * Universe is OPTIONAL: if VOIDBORN_ADDR is set, entities are attached to the
 * on-chain universe. Otherwise entities are created standalone
 * (universeAddress: null) and can be attached to a universe later.
 *
 * Prerequisites:
 *   - Server running (pnpm dev:server)
 *   - PRIVATE_KEY in .env for SIWE auth
 *
 * Usage:
 *   pnpm tsx scripts/voidborn-saga-wiki.ts
 *   VOIDBORN_ADDR=0x... pnpm tsx scripts/voidborn-saga-wiki.ts
 *
 * Resume: set START_INDEX=N env to skip the first N entities.
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

const UNIVERSE_ADDR = process.env.VOIDBORN_ADDR ?? null;
const START_INDEX = parseInt(process.env.START_INDEX ?? '0', 10);

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
    | 'species'
    | 'thing'
    | 'event';
  description: string;
  metadata?: Record<string, string>;
  imagePrompt: string;
  threeDPrompt: string;
}

const ENTITIES: EntityDef[] = [
  // ═══════════════════════════════════════════════════════════════════════
  // MAIN CREW — The Starling's stranded five
  // ═══════════════════════════════════════════════════════════════════════
  {
    name: 'Zix',
    kind: 'person',
    description:
      'The self-appointed captain of the Starling and the reluctant moral compass of the crew. Zix speaks in full paragraphs when one word would do, treats every setback as a sacred test of Voidborn resolve, and genuinely believes he is holding the mission together through sheer force of dignity. Cautious to a fault. Dramatic to his bones. When the ship crashes in a ravine outside a California suburb, Zix\'s first instinct is to deliver a motivational speech to a toilet flying past his head. He wants the crew to remain hidden, repair the ship, and leave Earth "undisturbed" — a phrase he says at least four times in the first hour, each time with less conviction, as it becomes clear Earth is disturbing them quite a lot.',
    metadata: {
      role: 'Self-appointed leader / Dramatic idealist',
      species: 'Voidborn',
      appearance:
        "Tall and slender Voidborn with long limbs, deep indigo skin, and large obsidian eyes. Cranial ridges that flare slightly when he gets indignant. Wears a formal expeditionary sash over a scuffed uniform that he insists is still regulation. Under the crew's fizzled camouflage field, becomes a purple-lipped tax accountant in a cheap blazer.",
      motivations:
        'Preserve the Voidborn mission code. Keep the crew alive. Get off Earth before anyone notices them. Secretly: earn the captaincy he gave himself.',
      abilities:
        'Strong sense of protocol, minor telepathic nudges, a fifty-line speech for every occasion. No useful combat skills.',
      homePlace: 'Voidborn homeworld (destroyed / displaced — unspecified in pilot)',
      catchphrase: 'We are descendants of the Voidborn. We do not panic.',
      humanDisguise: 'A tax accountant with purple lips',
    },
    imagePrompt:
      'Full-body character portrait of Zix, a tall slender alien in his prime. Deep indigo skin with subtle cranial ridges that flare along his temples. Large black almond-shaped eyes with no visible whites. A formal expeditionary sash across his chest over a scuffed dark-gray uniform jacket and fitted trousers. He stands in a dramatic pose, one hand raised mid-speech, the other resting on a holstered utility tool. Expression: theatrical, earnest, slightly overwhelmed. Background: the scorched interior of a crashed alien ship with warning lights blinking. Pixar-quality animated feature style, expressive proportions, cinematic lighting, 4K quality.',
    threeDPrompt:
      'Tall slender alien, deep indigo skin, cranial ridges on temples, large black eyes, formal sash over dark uniform, dramatic speech pose, theatrical expression, animated feature style',
  },
  {
    name: 'Mora',
    kind: 'person',
    description:
      'Chief engineer of the Starling and the only reason the ship hasn\'t exploded already. Mora is sharp, dry, perpetually unimpressed, and lives in a state of low-grade fury at her crewmates\' life choices. She is the person who carries two scorched components out of a wreck while everyone else complains about their hair. When the ship needs a phase coil, two ion relays, a converter lens, and "about three miracles," Mora is the one counting. On Earth, she becomes an accidental hacker — wiring a stolen burner phone into a ship fragment and a thrift-store radio to piggyback local towers and sniff out the Voidborn sleeper signal. Six eyebrows under camouflage.',
    metadata: {
      role: 'Engineer / Practical brain of the crew',
      species: 'Voidborn',
      appearance:
        'Compact, wiry Voidborn with moss-green skin, short braided crest feathers, and four-fingered hands covered in burn scars from fixing things in a hurry. Tool harness slung over a grease-streaked jumpsuit. Expression permanently set to "I already told you." Under the camouflage field she looks almost human — except for the six eyebrows stacked two rows on each side.',
      motivations:
        "Fix the ship. Get everyone home. Stop being the only competent person in every room. Secretly enjoys Earth electronics — they're adorable.",
      abilities:
        'Elite improvisational engineering, fluent in seventeen radio bands, can hotwire anything with a battery in it. Fluent sarcasm.',
      homePlace: 'Voidborn homeworld — worked in an orbital shipyard before the exile',
      catchphrase: 'Alive. Furious. In that order.',
      humanDisguise: 'An otherwise normal woman with six eyebrows',
    },
    imagePrompt:
      'Full-body character portrait of Mora, a compact wiry alien engineer. Moss-green skin, short braided crest feathers along her scalp, four-fingered hands with clear burn scars. She wears a grease-streaked jumpsuit with a cross-body tool harness clinking with improvised instruments. She holds two charred machine components, one in each hand, with the expression of someone about to lecture you. Background: the open guts of a crashed alien ship with sparking wires. Pixar-quality animated feature style, expressive proportions, warm practical lighting, 4K quality.',
    threeDPrompt:
      'Compact wiry alien engineer, moss-green skin, braided crest feathers, four-fingered scarred hands, grease-streaked jumpsuit, tool harness, holding charred components, unimpressed expression, animated style',
  },
  {
    name: 'Pebb',
    kind: 'person',
    description:
      'The smallest and loudest member of the crew. Pebb is chaos in a compact shell — a gleeful, toothy menace who formed an immediate and unshakeable bond with Earth food within minutes of arrival. In the first hour on planet, Pebb acquires an armful of chips, a roller hot dog, and a deep personal relationship with a convenience store. Fangs glow faintly when excited or hungry (so, constantly). Panics loudly and transparently, which is usually the most honest reaction available. Loves bad decisions as both hobby and identity. Under camouflage, Pebb comes out as a sickly Victorian child, which somehow increases their threat level.',
    metadata: {
      role: 'Chaotic comic engine / Snack evangelist',
      species: 'Voidborn',
      appearance:
        'Small rotund alien about three feet tall, pastel-lavender fur, enormous round eyes, tiny glowing fangs that flash when excited. Oversized ears that flick independently. Wears a scavenged bandolier stuffed with Earth snacks after the strip-mall run. Under camouflage: Victorian child in an oversized thrifted coat, unnaturally pale, slightly wrong in every photograph.',
      motivations:
        'Eat everything on Earth at least once. Bite something. Survive, ideally, but not at the cost of chips.',
      abilities:
        'Surprising speed, tiny bioluminescent fangs, supernatural ability to locate sodium and sugar within a 200-foot radius, bottomless stomach.',
      homePlace: 'Voidborn hatchery crèche — left as a juvenile, never looked back',
      catchphrase: 'I panicked responsibly.',
      humanDisguise: 'A sick Victorian child',
    },
    imagePrompt:
      'Full-body character portrait of Pebb, a small chaotic alien, about three feet tall, rotund and adorable-but-unhinged. Pastel-lavender fur, huge round expressive eyes, tiny sharp fangs with a faint bioluminescent glow, oversized independently-flicking ears. A scavenged bandolier across the chest stuffed with brightly colored Earth chip bags and a suspiciously shiny roller hot dog. Expression: delighted, overstimulated, up to something. Background: the glowing neon of a strip-mall convenience store at night. Pixar-quality animated feature style, comedic proportions, high-energy lighting, 4K quality.',
    threeDPrompt:
      'Small rotund alien, pastel-lavender fur, huge round eyes, tiny glowing fangs, oversized flicking ears, snack-stuffed bandolier, delighted unhinged expression, convenience store lighting, animated style',
  },
  {
    name: 'Drael',
    kind: 'person',
    description:
      "The handsome one. Drael is a thrill-seeker, a shameless flirt, and an instant convert to Earth nightlife the moment he lays eyes on a laughing human woman outside a Taco Bell. He would have preferred the moon casinos of Jath, but he is making his peace with Santa Mira County. Drael's hair survives explosions. His eyes glow faintly in the dark, which terrifies local teens and, he strongly suspects, charms local women. He is multidimensional about his priorities: save the crew, fix the ship, meet a girl, possibly in that order, possibly not.",
    metadata: {
      role: 'Thrill-seeker / Chaos romantic',
      species: 'Voidborn',
      appearance:
        'Tall, broad-shouldered Voidborn with iridescent bronze skin, jet-black hair that falls into his eyes at picturesque angles no matter the crash. Faintly glowing gold irises. Wears a partially unzipped flight jacket over a fitted black undersuit with chrome detailing. Under camouflage: absurdly, offensively handsome human — the kind teenagers run from and adults double-take at.',
      motivations:
        'Experience everything Earth has to offer. Survive the mission. Definitely flirt, repeatedly, in ways that threaten operational security.',
      abilities:
        'Exceptional reflexes, moderate piloting skill, high charm, mild night vision (the glowing eyes are a feature, not a bug).',
      homePlace: 'Voidborn merchant-caste family — ran away young for the thrill circuits',
      catchphrase: "I'm multidimensional.",
      humanDisguise: 'Absurdly attractive human — distractingly so',
    },
    imagePrompt:
      'Full-body character portrait of Drael, a tall broad-shouldered handsome alien thrill-seeker. Iridescent bronze skin with a subtle metallic sheen, jet-black hair artfully falling into faintly glowing gold irises. Partially unzipped black flight jacket with chrome piping, fitted black undersuit underneath, slim combat pants, heavy boots. A confident half-smile that has won and lost him many fights. Leaning casually against a scorched strut of the crashed ship, glowing eyes catching the moonlight. Pixar-quality animated feature style, cinematic hero lighting, 4K quality.',
    threeDPrompt:
      'Tall broad-shouldered handsome alien, iridescent bronze skin, jet-black hair over glowing gold eyes, black flight jacket with chrome piping, confident half-smile, hero pose leaning on ship strut, animated style',
  },
  {
    name: 'Nuni',
    kind: 'person',
    description:
      "The crew's resident anthropologist and the reason they are all in California and not, for example, vacationing on Jath. Nuni studied Earth from the comfort of a library nine hundred light-years away and got nearly everything wrong. Humans are extinct. Probably. Dominant lifeform: cow. Mild weather. Low risk. Every single one of these assertions gets revised in real time, out loud, while Nuni clutches a bent tablet and apologizes in a nervous chirp. Nuni is kind, brilliant in the wrong ways, and the only member of the crew who has read about Earth celebrity magazines and formed a working theory that they are priests. Under camouflage, looks like a human drawn entirely from memory by someone who has never met one.",
    metadata: {
      role: 'Anthropologist / Earth "expert" (air quotes doing a lot of work)',
      species: 'Voidborn',
      appearance:
        "Slim, nervous Voidborn with pale blue-silver skin, wide amber eyes, twin antennae that droop when anxious (so, always). Wears a scholar's robe over soft layered tunics, stuffed with field notes and a bent tablet. Under camouflage: a human rendered from pure secondhand description — proportions almost right, eyes placed just slightly wrong, smile trained from footage.",
      motivations:
        'Document Earth. Atone for decades of bad research. Avoid being eaten or taxed, whichever Earth does first.',
      abilities:
        'Fluent in Earth languages (reading), terrible at Earth languages (speaking), encyclopedic knowledge of incorrect facts, very fast note-taking.',
      homePlace: 'Voidborn academic archive — a quiet wing, deep in the old records',
      catchphrase: 'I said probably extinct.',
      humanDisguise: 'A human drawn from memory by someone who has never seen one',
    },
    imagePrompt:
      "Full-body character portrait of Nuni, a slim nervous alien anthropologist. Pale blue-silver skin with a soft metallic sheen, wide amber eyes, two long delicate antennae drooping forward. A scholar's robe layered over soft blue tunics, pockets stuffed with rolled field notes. She clutches a cracked alien tablet to her chest, one hand hovering over it as if about to apologize. Expression: earnest, anxious, eager to help. Background: the edge of a crashed ship with a glowing California suburb visible through the trees. Pixar-quality animated feature style, soft scholarly lighting, 4K quality.",
    threeDPrompt:
      'Slim nervous alien scholar, pale blue-silver skin, wide amber eyes, two drooping antennae, layered scholar robe, clutching cracked tablet, earnest anxious expression, animated style',
  },

  // ═══════════════════════════════════════════════════════════════════════
  // SUPPORTING HUMANS
  // ═══════════════════════════════════════════════════════════════════════
  {
    name: 'The Hiker',
    kind: 'person',
    description:
      "The first human the crew meets on Earth. A local in his forties with a weathered face, a headlamp, and a dog somewhere nearby barking too much. He wanders to the edge of the ravine out of basic neighborly concern and finds five of the worst human impersonators in the galaxy staring up at him from a smoking crater. He accepts their story that they are hiking recreationally. He accepts that their ship is a camper van. He is the Voidborn's first and most generous stress test, and he leaves the encounter slightly confused but fundamentally unbothered. Welcome to Santa Mira County, he says, and goes back to his dog.",
    metadata: {
      role: 'First human encounter / Accidental welcoming committee',
      species: 'Human',
      appearance:
        'Mid-forties, weathered face, graying stubble, olive-green flannel over a thermal shirt, sturdy hiking pants, well-worn boots. Headlamp strapped over a beanie. A dog leash in one hand, the other holding a flashlight pointed politely downward. Unimpressed but kind.',
      motivations:
        'Walk the dog. Help if help is needed. Not ask too many questions about the weirdos in the ravine.',
      abilities:
        'Powerful Pacific Northwest dad energy, moderate flashlight skills, an instinct for not escalating situations.',
      homePlace: 'Santa Mira County, California',
      notableQuote: '"You need me to call someone?"',
    },
    imagePrompt:
      'Full-body character portrait of The Hiker, a kindly man in his mid-forties, weathered face with graying stubble. He wears an olive-green flannel shirt over a thermal, sturdy hiking pants, and broken-in boots. A headlamp strapped over a dark beanie, a flashlight in one hand pointing politely at the ground, a dog leash in the other. Expression: politely concerned, trying not to stare. Background: the moonlit edge of a forested ravine at night with faint smoke rising from below. Pixar-quality animated feature style, cool moonlit atmosphere, 4K quality.',
    threeDPrompt:
      'Weathered man mid-forties, olive flannel over thermal, hiking pants, boots, headlamp over beanie, flashlight down, dog leash in hand, politely concerned expression, forest night, animated style',
  },
  {
    name: 'The Convenience Store Clerk',
    kind: 'person',
    description:
      'The patron saint of minimum-wage indifference, barely looking up from his phone as five aliens stumble into his 24-hour store at 2 AM. He has seen weirder. He has definitely sold beef jerky to weirder. When Zix asks for "rare machine components," the clerk says "AutoZone\'s closed." When pressed for something more discreet, he finally looks up and gives up the name Hector — the local conspiracy theorist who sells Soviet junk at the flea market and claims to "know people from beyond." The clerk delivers the crew\'s most important lead as a matter of mild inconvenience, then catches them on the security monitor and becomes, briefly, the most dangerous human in the pilot.',
    metadata: {
      role: 'Reluctant information broker / Accidental plot trigger',
      species: 'Human',
      appearance:
        'Early thirties, tired eyes, two-day stubble, a faded band tee under an official-looking store vest, one earbud in. Posture built from years of leaning on a counter. His phone is glued to his hand. A small TV behind him plays local news on loop.',
      motivations:
        'Finish the shift. Not care about anything. Except, briefly, when the weirdos on the security camera match the weirdos in his store.',
      abilities:
        'Encyclopedic knowledge of every strange local in a ten-mile radius, prolonged phone stamina, tolerance for fluorescent lighting.',
      homePlace: 'A small apartment within walking distance of the store',
      notableQuote: '"You buying something or just standing weird?"',
    },
    imagePrompt:
      'Full-body character portrait of The Convenience Store Clerk, early thirties, tired eyes with slight bags, two-day stubble. A faded rock band t-shirt under a cheap store-branded vest, dark jeans, worn sneakers. One earbud in, the other trailing. He leans on the counter of a bright 24-hour convenience store, phone in one hand, the other resting on the register. Behind him, rows of cigarettes and a small TV playing local news footage of a blurry fireball. Expression: catastrophically unbothered, until he sees the monitor. Pixar-quality animated feature style, harsh fluorescent lighting, 4K quality.',
    threeDPrompt:
      'Tired clerk early thirties, two-day stubble, faded band tee, cheap vest, jeans, sneakers, earbud in, leaning on store counter, phone in hand, unbothered expression, fluorescent lighting, animated style',
  },
  {
    name: 'Hector',
    kind: 'person',
    description:
      'Local legend of the Santa Mira flea market. An elderly man in a weathered trench coat who sells "weird radios and Soviet junk" and tells anyone who will listen that he "knows people from beyond." Everyone thinks he is nuts. The convenience store clerk mentions him as the only lead for unregistered, potentially extraterrestrial components. The Voidborn sleeper network mentions him too, but as a warning: "do not trust the flea market man." It is unclear whether Hector is a genuine Voidborn insider gone off-script, a human who got too close to the truth, or something worse — a honeypot left behind to catch newly stranded crews. The pilot does not say. That\'s on purpose.',
    metadata: {
      role: 'Possible contact / Possible trap / Flea market eccentric',
      species: 'Human (?)',
      appearance:
        'Seventies, wiry, skin weathered to leather. Long gray beard, wire-rim glasses taped at one hinge. Wears a surplus trench coat over layered sweaters, fingerless gloves, a Russian ushanka in winter. His flea market stall is a jumble of Cold-War electronics, scavenged tech, and things he will not explain.',
      motivations:
        'Unknown. He tells stories. He sells junk. He watches who asks the right questions.',
      abilities:
        'Surprisingly competent with analog electronics, unusually aware of anomalous events, speaks a half-dozen languages in fragments.',
      homePlace: 'Santa Mira flea market — stall under a patched canvas awning',
      status: 'Flagged by Voidborn sleeper network as "do not trust"',
      notableQuote: '(attributed) "I know people from beyond."',
    },
    imagePrompt:
      'Full-body character portrait of Hector, a wiry elderly man in his seventies. Weathered leather-like skin, long gray beard, wire-rim glasses with one hinge wrapped in tape. He wears a faded surplus trench coat over layered sweaters, fingerless gloves, and a Russian ushanka. Behind him, a flea market stall under a patched canvas awning, cluttered with old radios, Soviet-era electronics, strange antennas, and junk that looks oddly extraterrestrial. Expression: knowing, amused, a little dangerous. Pixar-quality animated feature style, overcast morning flea market lighting, 4K quality.',
    threeDPrompt:
      'Wiry elderly man seventies, leathered skin, long gray beard, taped wire-rim glasses, surplus trench coat, layered sweaters, fingerless gloves, ushanka hat, flea market stall of old radios and electronics, knowing expression, animated style',
  },
  {
    name: 'The Meteor Hunters',
    kind: 'person',
    description:
      "Two local teenage boys who show up at an abandoned car wash at 3 AM, armed with energy drinks, phone cameras, and the unshakable belief that a meteor landed here and they are about to go viral. They are correct about the first thing and tragically underprepared for the second. When Drael's glowing eyes emerge from the dark, they do not debate, they do not investigate, they scream and floor it. Their footage, blurry and vertical, is exactly the kind of thing the Voidborn sleeper network warned the crew to avoid.",
    metadata: {
      role: 'Accidental paparazzi / Scared runners',
      species: 'Human',
      appearance:
        'Teen One: mid-teens, lanky, oversized hoodie with the name of a local high school on it, backwards cap, phone out in selfie-cam. Teen Two: slightly heavier build, basketball shorts with a zip hoodie, backpack slung on one shoulder, second phone and an energy drink. Both sweating. Both having the night of their lives until they are not.',
      motivations: 'Go viral. Find an alien. Post first. Possibly skip school tomorrow.',
      abilities:
        'Vertical video composition, high sprint speed when motivated, a surprising amount of cellular data.',
      homePlace: 'Somewhere in Santa Mira County',
      notableQuote: '"If we find an alien, I\'m getting verified by morning."',
    },
    imagePrompt:
      'Full-body character portrait of two teenage meteor hunters at an abandoned carwash at night. Teen One: lanky mid-teens in an oversized black hoodie with a high-school mascot, backwards cap, phone held out in selfie mode, eyes wide. Teen Two: slightly heavier, zip hoodie over a plain tee, basketball shorts, backpack on one shoulder, an energy drink in one hand, a second phone in the other. Both caught mid-scream, backing away from something off-camera glowing in the dark. Flashlight beams from their phones cut through the air. Pixar-quality animated feature style, comedic horror lighting, 4K quality.',
    threeDPrompt:
      'Two teenage boys, one lanky in oversized hoodie and backwards cap with phone out, one heavier in zip hoodie and basketball shorts with energy drink and backpack, both mid-scream with phone flashlights, carwash at night, animated style',
  },
  {
    name: 'The Sleeper Network Voice',
    kind: 'person',
    description:
      'A distorted voice that breaks through Mora\'s improvised radio rig at the abandoned car wash — the crew\'s first real evidence that Voidborn survivors are already embedded on Earth. The voice is cautious, clipped, and clearly paranoid. It issues two warnings: do not trust Hector the flea market man, and meet at the old observatory before dawn, using no active tech. It signs off with an older, heavier message: "To any Voidborn survivors: Earth changes you. That is your first warning." Then silence. The owner of the voice is not revealed in the pilot. It may be a single operator. It may be a council. It may be someone who used to be Voidborn and is now something else.',
    metadata: {
      role: 'Unseen contact / Voice of the Voidborn sleeper network on Earth',
      species: 'Voidborn (assumed)',
      appearance:
        'Unseen in the pilot — experienced only as a distorted transmission riding human radio noise. Signal fingerprint suggests a long-buried Voidborn emitter modded for low detectability.',
      motivations:
        'Warn newly stranded crews. Keep the network hidden from humans. Screen for authenticity before letting anyone into the observatory.',
      abilities:
        'Signal discipline, knowledge of Voidborn protocol, apparent familiarity with Hector and whatever he really is.',
      homePlace: 'Unknown — broadcasts from somewhere near or within the observatory',
      notableQuote: 'Earth changes you. That is your first warning.',
    },
    imagePrompt:
      'Conceptual portrait of The Sleeper Network Voice — no visible body. A cluttered workbench in a dim observatory dome at night. On the bench: a jury-rigged Voidborn transceiver, mid-transmission, indicator lights pulsing with the shape of speech. A silhouette of a figure just out of frame, only the edge of a Voidborn hand on the transmit key, the rest of them lost in shadow. The transceiver glows a quiet violet. The old observatory telescope rises above the bench into moonlight. Pixar-quality animated feature style, mysterious cool lighting, 4K quality.',
    threeDPrompt:
      'Jury-rigged alien transceiver mid-transmission, pulsing violet indicator lights, silhouetted alien hand on transmit key, dim observatory workbench, telescope rising above in moonlight, mysterious mood, animated style',
  },

  // ═══════════════════════════════════════════════════════════════════════
  // PLACES
  // ═══════════════════════════════════════════════════════════════════════
  {
    name: 'Santa Mira County',
    kind: 'place',
    description:
      "A mid-sized Southern California county where foothills, strip malls, tract homes, palm trees, and freeway traffic coexist in low-grade chaos. By day it is unremarkable; by night, it is a sprawl of glowing neon, distant helicopters, and taco wrappers blowing across empty parking lots. It is also, according to the Voidborn sleeper network, one of Earth's quietly-dense clusters of stranded Voidborn cells. Home to an old observatory on a hilltop, a flea market of questionable legality, and at least one convenience store clerk who can ruin the crew's whole night.",
    metadata: {
      placeType: 'Southern California suburban county',
      atmosphere:
        'Palm trees and freeway headlights. Fast-food signs bleeding into the marine layer. Helicopters crossing the sky with no explanation. House parties thumping in the distance. Somehow both completely generic and deeply specific.',
      rulesAndDangers:
        'Dogs, joggers, teenagers with cameras, local news crews, police cruisers that roll past the strip mall on patrol, and at least one elderly man at the flea market who may or may not be human.',
      inhabitants:
        'Tens of thousands of humans, a contested number of Voidborn sleeper cells, one very stressed convenience store clerk, and five newly-crashed aliens.',
      governingFaction: 'Local county government — unaware of any of this',
    },
    imagePrompt:
      'Wide establishing shot of Santa Mira County, California at night. Rolling foothills covered in tract homes, palm trees silhouetted against a smoggy orange-violet sky. A freeway cuts through the frame, headlight streaks flowing toward a distant cluster of fast-food signs and a strip mall glowing neon. On a far hilltop, an old observatory dome catches moonlight. A helicopter crosses the sky with a blinking red light. The atmosphere is familiar California suburbia with a single impossibly alien hint — a faint green flicker in the woods to the east where a ship has crashed. Pixar-quality animated feature style, cinematic night establishing shot, 4K quality.',
    threeDPrompt:
      'Night aerial of California suburban county, palm tree foothills with tract homes, freeway headlight streaks, strip mall neon, observatory dome on distant hill, helicopter in sky, faint alien green flicker in forest, animated establishing shot',
  },
  {
    name: 'The Ravine',
    kind: 'place',
    description:
      'A steep wooded ravine in the hills outside the suburb where the Starling crashes in the cold open. The ship tumbles through pine and oak, rips a scar down the slope, and comes to rest at the bottom in a cradle of splintered trunks and scorched earth. Smoke curls up into a night sky of stars faintly visible above light pollution. It is the first Earth location the Voidborn see, the first they are seen at, and the site of a bent-tablet roll call that is funnier than any of them want to admit.',
    metadata: {
      placeType: 'Wooded ravine — crash site outside a California suburb',
      atmosphere:
        'Cold pine air, smoke, the tick-tick of cooling alien metal, a dog barking in the distance, distant strip-mall neon glowing through the treeline.',
      rulesAndDangers:
        'Steep walls, loose scree, exposed roots. Easy to be seen from above. A hiker with a flashlight will absolutely find you.',
      inhabitants: 'The crew of the Starling, occasional wildlife, one hiker with a dog',
      governingFaction: 'Nobody — county forest edge',
    },
    imagePrompt:
      'A steep wooded ravine at night in the California hills. Pine and oak trees broken and splintered on one slope, a fresh scar of torn earth running down to a smoking alien ship lodged at the bottom. The Starling — a junky, beloved, clearly alien vessel — leans against trees, hatch fallen open, warning lights dim. A thin haze of smoke drifts up through moonlit branches. Five small figures stand near the hatch. Above, faint stars through a purple-orange sky. Pixar-quality animated feature style, cinematic moonlit disaster aftermath, 4K quality.',
    threeDPrompt:
      'Steep wooded ravine at night, broken pine trees on scarred slope, smoking junky alien ship at bottom with open hatch, five alien figures near hatch, faint stars through purple-orange sky, animated style',
  },
  {
    name: 'The Strip Mall',
    kind: 'place',
    description:
      'A late-night strip mall on the edge of the suburb — a neon-lit temple of fryer grease, bleach, and bad lighting. Anchor tenants: Taco Bell, a liquor store, a nail salon, a smoke shop, a coin laundry, and a 24-hour convenience store. To the aliens, it is a sensory event of the highest order. It smells incredible. It smells like fryer grease and bleach. Both of these are true. A group of young humans laughs outside the taco place, and Drael, with a hand over his heart, tells Zix that he now understands Earth. Zix assures him he does not.',
    metadata: {
      placeType: 'Late-night Southern California strip mall',
      atmosphere:
        'Neon buzzing. Parking lot lights haloed in gnats. Bass from a passing car. Fryer vents pushing grease-scented air into the night. A single pay phone nobody uses.',
      rulesAndDangers:
        'Security cameras on every facade. Police cruisers cycle through the lot. Teens congregate and laugh loudly. A tired manager will ask if you are going to buy something.',
      inhabitants:
        'Late-shift clerks, smoke-break workers, small groups of young humans, delivery drivers, one nervous group of aliens in thrifted clothes',
      governingFaction: 'Whatever chain owns the shopping center',
    },
    imagePrompt:
      'A Southern California strip mall at 1 AM, viewed from the parking lot. A row of neon signs: TACO BELL, LIQUOR, NAILS, SMOKE SHOP, COIN LAUNDRY. A 24-hour convenience store at the end glowing white. Asphalt still warm from the day, reflecting the colored signs in shallow oil puddles. A group of young humans laugh outside the taco place. A pay phone on one pillar. Palm trees at the lot edge. Five out-of-place figures in mismatched donation-bin clothes approach from across the lot. Pixar-quality animated feature style, warm-cool neon contrast, cinematic night, 4K quality.',
    threeDPrompt:
      'California strip mall at 1 AM from parking lot, neon signs for Taco Bell Liquor Nails Smoke Shop Coin Laundry, 24-hour convenience store glowing white, oil puddle reflections, group of humans laughing near taco place, palm trees at edge, animated style',
  },
  {
    name: 'The 24-Hour Convenience Store',
    kind: 'place',
    description:
      "Fluorescent, humming, and saturated with color, the convenience store is the crew's first immersive human environment. Forty flavors of chips. A hot-dog roller. Magazines whose covers Nuni mistakes for a hierarchy of priests. A refrigerator wall of caffeinated drinks that hum like a second bass line. A small TV behind the counter that will, at precisely the wrong moment, cut to shaky cell-phone footage of a fireball over Santa Mira County. And one clerk who delivers, with perfect minimum-wage indifference, the name Hector — the lead that sets the rest of the night in motion.",
    metadata: {
      placeType: '24-hour convenience store inside the strip mall',
      atmosphere:
        'Fluorescent overhead light that flattens everything. Humming coolers. Pop music fighting with radio news. The chemical perfume of cleaning products, roller-grill meat, and energy drinks. Security mirrors in every corner.',
      rulesAndDangers:
        'Multiple security cameras, a monitor wall behind the counter, a live local-news TV, an alarm the clerk will absolutely activate if you run. Shoplifting is tracked. So are weirdos.',
      inhabitants:
        'The clerk, the occasional late-night customer, five aliens having the greatest cultural experience of their lives',
      governingFaction: 'The clerk',
    },
    imagePrompt:
      'Interior of a 24-hour convenience store at 1 AM. Bright fluorescent ceiling lights. Rows of brightly colored chip bags, candy, sodas, magazines. A roller grill with hot dogs rotating behind glass. A counter with a clerk leaning on one elbow, one earbud in, a small TV behind him playing blurry fireball footage. Five out-of-place alien figures in donation-bin human clothes scattered through the aisles, wide-eyed, overwhelmed, utterly delighted. A security monitor wall in the corner. Pixar-quality animated feature style, harsh fluorescent lighting with pops of package color, 4K quality.',
    threeDPrompt:
      'Interior 24-hour convenience store at 1 AM, fluorescent ceiling, rows of chips candy sodas magazines, hot dog roller grill, clerk at counter with earbud and TV behind, five wide-eyed alien figures in aisles, security monitor wall, animated style',
  },
  {
    name: 'The Abandoned Car Wash',
    kind: 'place',
    description:
      'A long-dead drive-thru car wash on the edge of a dark industrial lot. Peeling signage, rusted mechanisms, weeds through the drainage grates. The crew hides out here after the convenience store incident while Mora turns a stolen disposable phone, a ship fragment, and a thrifted radio into a working sleeper-network receiver. It is here that they hear the distorted Voidborn voice for the first time. It is also here that Drael smiles at two teenage meteor hunters in the dark and accidentally makes local cryptid history.',
    metadata: {
      placeType: 'Abandoned automated car wash on suburb industrial edge',
      atmosphere:
        'Concrete tunnel with faded hose guides and seized brushes. Puddles that never dry. Faint spray-paint tags on the walls. Night wind through the open bay. A distant freeway hum.',
      rulesAndDangers:
        "Exposed from the street. Teens drive in to party. Cops sometimes check it. The open bay echoes loud, so Mora's rig needs to be quiet or it gives them away.",
      inhabitants: 'The crew, occasional teens, very rare stray cats',
      governingFaction: 'Nobody — bank-owned, forgotten',
    },
    imagePrompt:
      'The interior of an abandoned drive-thru car wash at night. A long concrete tunnel with peeling paint, seized mechanical brushes on rusted arms, old hose guides drooping from the ceiling. Graffiti on the walls. Puddles reflect faint moonlight. Five alien figures huddle in the middle of the tunnel around an improvised rig made of a burner phone, a thrifted radio, and a glowing chunk of ship tech — green-blue light casts their faces from below. The open bay at the far end shows the dark industrial lot and a distant freeway. Pixar-quality animated feature style, moody moonlit noir, 4K quality.',
    threeDPrompt:
      'Abandoned drive-thru car wash interior at night, concrete tunnel with rusted seized brushes and drooping hoses, graffiti on walls, puddles with moonlight, five alien figures around glowing improvised radio rig, open bay showing industrial lot, animated noir style',
  },
  {
    name: 'The Old Observatory',
    kind: 'place',
    description:
      'A hilltop observatory on the far side of the suburb, visible from every important rooftop in the valley. The Voidborn sleeper network instructs any stranded survivors to meet here before dawn, using no active tech. In the pilot the crew never reaches it — they only stand on a hill at first light, staring across the sleeping county at its distant dome. That dome is the next episode. That dome is the first real contact with other Voidborn on Earth. Somewhere inside, a transceiver is still warm.',
    metadata: {
      placeType:
        'Hilltop astronomical observatory — daytime tourist attraction, nighttime rendezvous',
      atmosphere:
        'Cracked concrete paths, cypress trees, city lights bleeding up the hill, a chain-link fence with a broken section nobody talks about. A dome with a weather-faded seam where it opens.',
      rulesAndDangers:
        'Public access by day. Locked by night. Security patrols once per shift. The sleeper network is watching who approaches.',
      inhabitants: 'Daytime tourists, at least one sleeper-network operator, possibly more',
      governingFaction: 'Public observatory on paper; something else after hours',
    },
    imagePrompt:
      'A hilltop observatory at pre-dawn, seen from across the Southern California valley. The white dome catches the first blue-gold light. Cypress trees line the approach road. Cracked concrete paths wind up the hill. Below, a sea of suburban lights still glowing. Above, stars just beginning to fade into the coming sunrise. Five small alien figures in silhouette stand on a nearby hill, staring toward the observatory — their next destination. The composition is tiny-figures-big-world. Pixar-quality animated feature style, cinematic sunrise establishing shot, 4K quality.',
    threeDPrompt:
      'Hilltop astronomical observatory at pre-dawn with white dome catching blue-gold light, cypress trees along approach, cracked concrete paths, valley below with fading suburb lights, five small silhouetted alien figures on nearby hill staring toward dome, animated establishing shot',
  },
  {
    name: 'The Moon Casinos of Jath',
    kind: 'place',
    description:
      'A luxury entertainment destination Drael wishes they had gone to instead. The moon casinos of Jath are referenced only once in the pilot — "This is why I said we should\'ve vacationed somewhere civilized" — and never seen. Implied: an extravagant multi-dome complex carved into a lunar body around a distant star, catering to the Voidborn upper class and any travelers with enough credits to dock. It is a piece of setting texture that does two things at once: tells us Drael has a past, and tells us the Voidborn galaxy has normal places the crew could have gone instead of Earth.',
    metadata: {
      placeType: 'Luxury lunar casino complex — offworld, only referenced',
      atmosphere:
        'Transparent domes over silver regolith, floating gaming platforms in low gravity, Voidborn high society, live music with impossible instruments, the kind of place where nothing ever crashes into a ravine.',
      rulesAndDangers:
        'Credit-gated entry, strict dress code, extraordinary boredom if you cannot afford it. Safe. Normal. Civilized.',
      inhabitants: 'Wealthy Voidborn, travelers from allied systems, a staff that sees everything',
      governingFaction: 'The Jath Casino Combine (unseen, inferred)',
    },
    imagePrompt:
      'Speculative concept art of the Moon Casinos of Jath — a multi-dome luxury complex on a silver lunar body in deep space. Transparent crystalline domes glow from within with warm amber and violet lights. Low-gravity gaming platforms float between them. A ringed gas giant fills half the black sky behind. Voidborn figures in formalwear walk between domes along glass skyways. A ship much nicer than the Starling is docked at a skyport. Pixar-quality animated feature style, cinematic space-luxury lighting, 4K quality.',
    threeDPrompt:
      'Multi-dome lunar casino complex on silver moon, transparent crystalline domes glowing amber and violet, floating low-gravity gaming platforms, ringed gas giant in black sky, Voidborn figures in formalwear on glass skyways, luxury ship docked at skyport, animated space-luxury style',
  },
  {
    name: 'The Hilltop Lookout',
    kind: 'place',
    description:
      'A bald hill overlooking the sleeping suburb in the pre-dawn hours — the closing shot of the pilot. Tract homes, palm trees, fast-food signs, freeway traffic, and the distant glowing dome of the observatory all visible at once from here. The crew stands in silhouette, resolved and not resolved: the mission says leave Earth immediately, but nobody in the group is looking eager to leave. A helicopter crosses the sky. A taco wrapper blows past. Below, in the city, a hidden signal blinks back. They are not alone.',
    metadata: {
      placeType: 'Bald hilltop lookout above suburb — closing-scene vantage',
      atmosphere:
        'Cold pre-dawn wind. A thin fog in the valley below. Soft sodium-orange glow from the streetlights. Stars fading. The distant thrum of the waking city.',
      rulesAndDangers:
        'Exposed silhouette at sunrise. A passing helicopter could see you. The hidden signal below can definitely see you.',
      inhabitants: 'The crew of the Starling, briefly; otherwise empty',
      governingFaction: 'Open space',
    },
    imagePrompt:
      'A bald hilltop at pre-dawn overlooking a sleeping Southern California suburb. In the valley below: tract homes, palm trees, fast-food signs glowing, the thin ribbon of a freeway still flowing with headlights. On the far hill, an observatory dome catching first light. Five alien figures stand in silhouette on the hilltop, backs to camera, looking out. A helicopter blinks red across the fading stars. A taco wrapper blows past their feet. Somewhere in the city, a tiny blue-green signal blinks back — just visible. Pixar-quality animated feature style, cinematic dawn silhouette, 4K quality.',
    threeDPrompt:
      'Bald hilltop pre-dawn overlooking sleeping California suburb, valley with tract homes palm trees fast food signs freeway headlights, observatory dome on far hill catching first light, five silhouetted alien figures backs to camera, helicopter blinking red in sky, taco wrapper blowing, tiny signal blinking below, animated cinematic style',
  },

  // ═══════════════════════════════════════════════════════════════════════
  // VEHICLES & THINGS
  // ═══════════════════════════════════════════════════════════════════════
  {
    name: 'The Starling',
    kind: 'vehicle',
    description:
      "The crew's battered, beloved, and structurally improbable ship. A junker held together by tape, wires, and hope — and, occasionally, a toilet that flies out of the bathroom mid-meteor strike. The Starling is a short-range Voidborn explorer-class hull that has been repaired too many times by too many hands. She sputters through a meteor field in the cold open, takes a direct hit, loses stabilizers, navigation, and somehow the bathroom, and crashes into a California ravine. Mora insists she can be flown again. All she needs is a phase coil, two ion relays, a converter lens, and about three miracles.",
    metadata: {
      vehicleType: 'Voidborn short-range explorer — heavily modified / patched',
      appearance:
        'Stubby wedge hull the color of oxidized copper, visible seams where plates have been replaced, patch welds, mismatched panel colors, two external tool pods bolted on asymmetrically. Running lights that flicker. A single stencilled Voidborn glyph near the hatch that Zix claims is a family name and Mora claims is a serial number.',
      rulesAndDangers:
        'Shield plating degraded. Bathroom currently missing. Warning lights treat ordinary flight as an emergency. Needs a phase coil, two ion relays, and a converter lens before it flies again.',
      inhabitants: 'Five stranded Voidborn and their regrets',
      governingFaction: 'Captain (self-appointed) Zix',
      missingParts: 'Phase coil, two ion relays, one converter lens',
    },
    imagePrompt:
      'Three-quarter view of The Starling, a junky beloved alien spaceship. Stubby wedge hull in oxidized copper with visible patch plates in mismatched colors, bolted-on external tool pods, exposed wiring along one seam, flickering running lights. A single stencilled alien glyph near an open hatch. The ship sits tilted in a wooded ravine at night, one wing caught in trees, faint smoke rising, hatch hanging open with warm amber light inside. Pixar-quality animated feature style, cinematic lovable-junker aesthetic, 4K quality.',
    threeDPrompt:
      'Junky alien spaceship, stubby wedge hull oxidized copper, mismatched patch plates, bolted-on tool pods, exposed wiring seam, flickering running lights, single stencilled alien glyph near open hatch, tilted in wooded ravine with smoke, animated lovable junker style',
  },
  {
    name: 'The Camouflage Field Generator',
    kind: 'technology',
    description:
      'A hand-sized Voidborn device Mora slams into activation when the hiker shines a flashlight into the ravine. In theory, it projects a real-time perceptual overlay that makes the bearer appear human to the human observer. In practice, with a half-charged battery and one fried capacitor, it produces the worst human impersonations in recorded Voidborn history. Zix becomes a purple-lipped tax accountant. Mora gains six eyebrows. Pebb manifests as a sickly Victorian child. Drael comes out absurdly, dangerously handsome. Nuni looks like a human drawn from memory. It works. Technically.',
    metadata: {
      techType: 'Portable perceptual camouflage field emitter',
      appearance:
        'A hand-sized Voidborn device — matte graphite body, violet indicator ring, four small prongs around the perimeter. Slightly scorched from the crash. Emits a faint hum when active.',
      rulesAndDangers:
        'Short range. Short battery. Fidelity of the disguise scales with condition of the unit. A fried capacitor will produce unsettling "approximations" rather than accurate humans. Will absolutely fail at the worst possible moment.',
      relatedConcepts: 'The Hiker, first contact, plausible deniability',
      canonWeight: 'Hard Canon',
    },
    imagePrompt:
      'Close-up product-shot of the Camouflage Field Generator: a hand-sized matte-graphite Voidborn device with a glowing violet indicator ring around its top, four small prongs at its perimeter, slightly scorched edges from the crash. Clutched in an alien four-fingered hand, held mid-activation. The air around it shimmers with a faint violet field distorting the figures behind it — five aliens mid-transformation into comically wrong humans. Pixar-quality animated feature style, close-up tech detail with comedic background, 4K quality.',
    threeDPrompt:
      'Hand-sized Voidborn camouflage field generator, matte graphite body, violet glowing indicator ring, four perimeter prongs, slightly scorched, held in four-fingered alien hand, violet shimmer field distorting aliens behind into wrong humans, animated style',
  },
  {
    name: "Mora's Improvised Radio Rig",
    kind: 'technology',
    description:
      "The disposable phone Mora grabs during the strip-mall escape becomes, two hours later, the first real piece of Voidborn technology operating on Earth in who-knows-how-long. Wired into a ship fragment and a thrifted convenience-store radio, Mora's rig piggybacks local cell towers, boosts the signal with the Starling's emergency beacon, and filters out human noise — spam, podcasts, late-night talk radio, a lot of nonsense — until the Voidborn sleeper network's voice comes through. It is also, not incidentally, the reason the crew now knows about the observatory, Hector, and the fact that Earth changes you.",
    metadata: {
      techType: 'Hybrid Voidborn/human radio + cellular signal rig',
      appearance:
        'A cheap plastic flip-style burner phone with its back cracked open. Out of it, copper and iridescent alien filaments spiral into a fragment of ship hull about the size of a phonebook, which is in turn wired into a thrift-store handheld radio. A single glowing green indicator pulses when a signal lands.',
      rulesAndDangers:
        'Extremely visible on any SIGINT sweep that is looking. Drains the burner battery in about forty minutes. Can be jammed by any sufficiently loud FM station.',
      relatedConcepts: 'Sleeper Network Voice, the observatory rendezvous, Hector warning',
      canonWeight: 'Hard Canon',
    },
    imagePrompt:
      "Close-up on Mora's improvised radio rig sitting on the wet concrete floor of an abandoned car wash at night. A cheap plastic burner phone with its back removed, copper wiring and iridescent alien filaments twisting into a chunk of dull-metal Voidborn ship hull the size of a small book, which cables into a thrifted handheld radio. A single glowing green indicator light pulses at the junction. Moon-blue light overhead, soft green glow from the rig from below. Pixar-quality animated feature style, moody close-up tech shot, 4K quality.",
    threeDPrompt:
      'Improvised radio rig on wet car wash concrete, burner phone with back removed, copper and alien filaments into chunk of Voidborn ship hull, cabled into thrifted handheld radio, single pulsing green indicator at junction, moonlight from above, green glow from below, animated close-up tech style',
  },
  {
    name: 'Glow Fruit',
    kind: 'thing',
    description:
      'A Voidborn foodstuff Pebb ate shortly before the crash — the single most important piece of context for understanding Pebb\'s panic in the cold open ("Can we die later? I just ate glow fruit!") and a running gag waiting to happen in future episodes. Glow fruit is a bioluminescent snack that the Voidborn metabolise slowly, causing a warm internal radiance that lasts several hours and, according to Voidborn street wisdom, should absolutely not be consumed before high-G maneuvers.',
    metadata: {
      thingType: 'Voidborn bioluminescent snack food',
      appearance:
        "A plump teardrop-shaped fruit the size of a small fist, translucent pink-gold skin, a soft inner glow that pulses faintly with the eater's heartbeat after consumption. Sold in small mesh bags at Voidborn rest stops.",
      rulesAndDangers:
        'Safe at rest. Not safe in freefall, crash landings, or emergency descents. Produces a soft visible glow through the skin for several hours after eating.',
      relatedConcepts: 'Pebb, the crash, Voidborn cuisine',
      canonWeight: 'Hard Canon',
    },
    imagePrompt:
      'Close-up still life of Glow Fruit — three plump teardrop-shaped fruits the size of small fists, translucent pink-gold skin with visible inner glow that pulses softly. Arranged on a rough Voidborn cloth napkin beside a small mesh bag. The fruits cast a warm pink light on the cloth. Behind them, slightly out of focus, a small alien paw reaching toward one. Pixar-quality animated feature style, warm close-up food photography, 4K quality.',
    threeDPrompt:
      'Three plump teardrop bioluminescent fruits on rough alien cloth napkin, translucent pink-gold skin with pulsing inner glow, beside small mesh bag, warm pink light cast on cloth, small alien paw reaching for one, animated food-still-life style',
  },

  // ═══════════════════════════════════════════════════════════════════════
  // SPECIES
  // ═══════════════════════════════════════════════════════════════════════
  {
    name: 'Voidborn',
    kind: 'species',
    description:
      'A spacefaring people with a long memory and a shorter fuse. Voidborn physiology varies across castes and subspecies — indigo, moss-green, lavender, bronze, and silver-blue are all represented on a single crew — but common traits include light telepathic sensitivity, partial hive-sync in family units, large pupilless eyes, and an almost universal dependence on nutrient paste as a staple food. Voidborn culture places enormous weight on mission codes, oath structures, and dramatic speeches, which is why every crew has at least one Zix. They do not panic. Supposedly.',
    metadata: {
      speciesType: 'Humanoid spacefaring species — multiple subcastes',
      appearance:
        'Humanoid silhouette with four-fingered hands, elongated limbs, cranial ridges or crest feathers depending on caste. Pupilless eyes in varying colors. Skin tones range across indigo, green, lavender, bronze, and silver-blue. Size ranges from three feet (crèche variants like Pebb) to well over six feet (ceremonial castes).',
      rulesAndDangers:
        'Mild telepathic capacity — strong in family units, weak otherwise. Vulnerable to sustained bright light without eye shielding. Allergic to most Earth mold species, which Pebb has not yet learned the hard way.',
      culturalNotes:
        'Hive-sync bonding in family units. Mission-code traditions taken very seriously. Nutrient paste as staple food. Formal oath speeches at every important transition.',
      governingFaction: 'Council of Castes (distant / unseen in pilot)',
    },
    imagePrompt:
      'Turnaround-style group illustration of the Voidborn species showing caste variety: five figures side by side, each at a different height and build. Indigo slender noble-caste with cranial ridges, moss-green compact engineer-caste with crest feathers, pastel-lavender small crèche-variant with fangs and huge ears, bronze athletic merchant-caste with glowing gold eyes, silver-blue scholar-caste with antennae. All with four-fingered hands and pupilless eyes. Neutral studio background with soft lighting. Pixar-quality animated feature style, species-reference illustration, 4K quality.',
    threeDPrompt:
      'Voidborn species reference, five figures side by side at varied heights and castes, indigo slender with ridges, moss-green engineer with crest feathers, pastel-lavender small with fangs and big ears, bronze athletic with glowing gold eyes, silver-blue scholar with antennae, all with four-fingered hands, animated reference style',
  },
  {
    name: 'Humans',
    kind: 'species',
    description:
      'Earth\'s dominant sapient species — which Nuni previously classified as "probably extinct" and "secondary to cows." Nuni\'s research is under extensive revision. From a Voidborn perspective, humans are loud, emotive, chaotic, remarkably adaptable, weirdly confident with their eyes, and impossible to ignore. They form small social clumps that laugh for no reason. They worship actors as priests. They sell forty flavors of the same triangle-shaped snack. They run when they see something they cannot explain, but they also come back with phones. They are, by all Voidborn metrics, way more dangerous than the briefing suggested.',
    metadata: {
      speciesType: "Earth-native sapient hominid — Nuni's pre-crash classification was incorrect",
      appearance:
        'Bipedal hominid, average height 5.5 feet, wide cultural variation in coloration, dress, and ornament. Two eyes forward, rounded pupils, a disturbing amount of direct eye contact according to Pebb.',
      rulesAndDangers:
        'Highly networked via handheld devices — can broadcast alien sightings within seconds. Very protective of snacks that have been paid for. Local enforcement responds quickly to reports of disturbances.',
      culturalNotes:
        'Gather in neon-lit strip malls at night. Consume vast quantities of fried and salted foods. Worship high-status image-makers (actors). Teenagers specifically are a hazard class of their own.',
      governingFaction: 'Thousands of overlapping local, regional, and national governments',
    },
    imagePrompt:
      "A warm crowd illustration of Humans observed as an alien anthropologist's sketch: a small group of late-night young humans outside a Taco Bell in a strip mall, laughing, one holding a drink, one on a phone, all with a casual confidence in their posture. Behind them, more humans inside the glow of the restaurant. A small alien silhouette watches them from across the parking lot, tablet in hand, taking notes. Pixar-quality animated feature style, warm neon-lit night, 4K quality.",
    threeDPrompt:
      'Group of young humans laughing outside Taco Bell at night in strip mall, one with drink one on phone, warm casual confidence, more humans inside restaurant glow, small alien silhouette watching from parking lot with tablet, animated style',
  },

  // ═══════════════════════════════════════════════════════════════════════
  // FACTIONS & ORGANIZATIONS
  // ═══════════════════════════════════════════════════════════════════════
  {
    name: 'The Voidborn Sleeper Network',
    kind: 'faction',
    description:
      'A hidden, distributed cell structure of Voidborn survivors already embedded on Earth when the Starling crashes. Rumored for decades in Voidborn archives as "stranded cells" and "supply caches," the network is confirmed in the pilot by a distorted voice that issues two warnings: do not trust Hector the flea market man, and meet at the old observatory before dawn. Numbers, leadership, and motives are unknown. The tone is cautious — protect the network, screen newcomers, and above all, do not let humans discover that Earth has been a Voidborn haven for longer than the current crew has been alive.',
    metadata: {
      factionType: 'Distributed clandestine alien sleeper cells on Earth',
      appearance:
        'No uniform, no insignia visible to outsiders. Operate through radio frequencies hidden in human noise, supply caches in abandoned infrastructure, and low-profile human-presenting front identities.',
      rulesAndDangers:
        'Paranoid and hostile to exposure. Will disavow any crew that draws human attention. May already be compromised by Hector or whatever Hector really is.',
      inhabitants:
        'Unknown number of stranded Voidborn, possibly across multiple generations on Earth',
      governingFaction:
        'Unseen — the voice on the radio may speak for a council or for itself alone',
    },
    imagePrompt:
      'Conceptual illustration of the Voidborn Sleeper Network on Earth: a split composition. The upper half is a daytime American streetscape — a bus stop, a flea market stall, a convenience store, an observatory dome on a hill, a laundromat. In each location, one figure in ordinary human clothes is subtly highlighted with a faint violet aura, suggesting the sleeper identity beneath. The lower half shows the hidden layer: the same figures revealed as Voidborn in silhouette, connected by a network of glowing violet signal lines that run along power lines, radio towers, and underground cable routes. Pixar-quality animated feature style, stylized dual-layer infographic, 4K quality.',
    threeDPrompt:
      'Split conceptual illustration, upper half American streetscape with bus stop flea market convenience store observatory laundromat and subtly violet-auraed human figures, lower half same figures as Voidborn silhouettes connected by glowing violet signal lines along power lines and cables, animated infographic style',
  },

  // ═══════════════════════════════════════════════════════════════════════
  // EVENTS
  // ═══════════════════════════════════════════════════════════════════════
  {
    name: 'The Crash Landing',
    kind: 'event',
    description:
      'The cold open. The Starling sputters through a meteor field, takes a direct hit, loses stabilizers, navigation, and the bathroom, and crashes through the trees of a wooded ravine outside a California suburb. Nobody dies. Everybody is extremely annoyed. Zix attempts three separate motivational speeches during the descent. Pebb has just eaten glow fruit. Drael\'s hair is, somehow, still perfect. The hatch falls open onto cold pine air and the distant bark of a dog. The mission has officially pivoted from "quick flyby" to "strand on a planet whose anthropologist got everything wrong."',
    metadata: {
      era: 'Pilot episode — cold open',
      participants: 'Zix, Mora, Pebb, Drael, Nuni, the Starling',
      location: 'Upper atmosphere → wooded ravine outside Santa Mira County',
      causes:
        'Meteor impact in the outer belt, degraded shielding, a ship the crew knew was overdue for service and flew anyway.',
      outcome:
        'Ship disabled and hidden in the ravine. Crew alive. Confirmed breathable atmosphere. First known Voidborn crash on Earth in this timeline.',
      canonStatus: 'Canon',
    },
    imagePrompt:
      'A dramatic nighttime crash sequence: the Starling, a junky alien ship, tumbling through pine and oak trees, ripping a scar down a ravine slope, warning lights flashing across the hull. Motion blur on broken branches. Smoke and sparks. In the cockpit window (barely visible) a glimpse of Zix mid-speech, Pebb clutching something yellow. Moonlit California hills in the far background. Pixar-quality animated feature style, cinematic disaster action shot, 4K quality.',
    threeDPrompt:
      'Alien ship tumbling through pine and oak trees down ravine slope at night, warning lights on hull, motion blur on broken branches, smoke and sparks, cockpit window with alien captain mid-speech, moonlit hills behind, animated cinematic disaster shot',
  },
  {
    name: 'First Contact with the Hiker',
    kind: 'event',
    description:
      'Minutes after the crash, a local hiker with a flashlight and a dog finds the crew at the bottom of the ravine. Mora activates the damaged camouflage field generator, which produces the worst human impersonations the galaxy has ever tolerated. The hiker accepts that they are humans. He accepts that their ship is a camper van. He makes neighborly small talk, politely suggests that they not park their RV in a ravine, and leaves. It is the most forgiving version of first contact the crew will ever experience, and by the end of the night all of them will know it.',
    metadata: {
      era: 'Pilot episode — Act One',
      participants: 'Zix, Mora, Pebb, Drael, Nuni, The Hiker, the dog (offscreen)',
      location: 'The Ravine',
      causes:
        'A hiker with a flashlight and a dog walks the ridge at night and investigates the smoke and lights below.',
      outcome:
        "The crew is seen in approximate human form. The hiker leaves without alerting authorities. The crew learns that (1) the camouflage field still works, barely, and (2) humans are much more forgiving in person than in Nuni's research.",
      canonStatus: 'Canon',
    },
    imagePrompt:
      'A moonlit ravine at night. At the top of the ridge, a hiker in olive flannel with a headlamp shines a flashlight politely down the slope. At the bottom, five alien figures mid-transformation into wildly wrong humans via a shimmering violet camouflage field — purple-lipped tax accountant, six-eyebrowed woman, Victorian child, absurdly handsome man, awkwardly-proportioned human sketch. Smoke drifts. Warm comedic tension. Pixar-quality animated feature style, cinematic moonlit comedy, 4K quality.',
    threeDPrompt:
      'Moonlit ravine at night, hiker in olive flannel with headlamp shining flashlight from ridge, five aliens at bottom mid-transformation into wrong humans via shimmering violet field, purple-lipped accountant six-eyebrowed woman Victorian child handsome man awkward human, smoke drifting, animated moonlit comedy style',
  },
  {
    name: 'The Strip Mall Expedition',
    kind: 'event',
    description:
      "Wearing donation-bin clothes and carrying no local currency, the crew approaches a late-night strip mall in search of supplies and information. They are immediately overwhelmed by Taco Bell's smell, the laundromat's hum, and the laughing humans outside the taco place. Drael makes the unilateral decision to understand Earth. Nuni identifies the magazines as a hierarchy of priests. Pebb finds chips. Mora notes that the convenience store has exactly the kind of surveillance infrastructure that will become a problem in approximately four minutes.",
    metadata: {
      era: 'Pilot episode — Act One into Act Two',
      participants: 'Zix, Mora, Pebb, Drael, Nuni, late-night humans, the clerk',
      location: 'The Strip Mall / The 24-Hour Convenience Store',
      causes:
        'The crew needs local supplies, clothing, cash equivalents, and information on unregistered technology brokers.',
      outcome:
        'They acquire snacks, a lighter, sunglasses, and a disposable burner phone. They acquire the name "Hector." They appear on the convenience store\'s security feed.',
      canonStatus: 'Canon',
    },
    imagePrompt:
      'Wide shot inside a 24-hour convenience store at 1 AM. Fluorescent lighting floods rows of brightly colored chips, candy, magazines, and refrigerated drinks. Five out-of-place alien figures in mismatched donation-bin human clothes spread across the aisles — one studying magazines, one clutching an armload of chips, one flirting with his own reflection in the sunglasses rack, one approaching the counter intently. A tired clerk behind the counter, a security monitor wall in the corner faintly showing them. Pixar-quality animated feature style, comedic overwhelm, 4K quality.',
    threeDPrompt:
      'Interior 24-hour convenience store at 1 AM, fluorescent lighting, rows of chips candy magazines drinks, five alien figures in mismatched donation clothes across aisles studying magazines clutching chips flirting at sunglasses rack approaching counter, tired clerk with security monitor wall faintly showing them, animated comedic style',
  },
  {
    name: 'The Convenience Store Escape',
    kind: 'event',
    description:
      'The local news TV behind the counter cuts to shaky cell-phone footage of a fireball over Santa Mira County just as the clerk notices the security monitor showing the crew\'s pre-camouflage forms. He looks at the screen. He looks at them. He looks at the screen. He asks, slowly, "why do you guys look like that video?" The crew runs. Pebb panics responsibly (with a hot dog and multiple bags of chips). A police cruiser rolls past the lot as they duck behind a dumpster. The night officially escalates.',
    metadata: {
      era: 'Pilot episode — Act Two',
      participants: 'The crew, the clerk, an offscreen police cruiser',
      location: 'The 24-Hour Convenience Store → Strip Mall Parking Lot',
      causes:
        'Local news broadcasts crash footage. Convenience store security cameras recorded the crew in pre-camouflage form. The clerk puts it together.',
      outcome:
        'The crew flees with a disposable burner phone (which Mora will weaponize), lighter fluid, novelty sunglasses, beef jerky, and multiple bags of unpaid chips. A police cruiser cycles past without stopping — this time.',
      canonStatus: 'Canon',
    },
    imagePrompt:
      'Action shot: five alien figures in mismatched thrifted clothes burst out of a convenience store into a strip-mall parking lot at 1 AM, arms full of snacks and random items — one clutching chips and a hot dog, one gripping a cheap burner phone, one holding novelty sunglasses. The clerk visible through the glass door shouting. In the distance, blue and red police lights turning a corner. Palm trees above, neon signs overhead. Motion blur on the figures. Pixar-quality animated feature style, comedic action, 4K quality.',
    threeDPrompt:
      'Five alien figures bursting out of convenience store into strip mall parking lot at 1 AM, arms full of snacks burner phone novelty sunglasses, clerk visible through glass door shouting, police lights turning corner in distance, palm trees and neon signs overhead, motion blur, animated comedic action style',
  },
  {
    name: 'The Sleeper Network Contact',
    kind: 'event',
    description:
      'At an abandoned car wash later that night, Mora finishes wiring the stolen burner phone into a ship fragment and a thrifted radio. The rig bursts alive with human noise — music, conspiracy podcasts, late-night talk radio — and then, clearly, a distorted Voidborn voice cuts through with two warnings: do not trust Hector, and meet at the old observatory before dawn. A final message follows before the signal dies: "Earth changes you. That is your first warning." The crew now has a destination, a name to avoid, and a deeper sense of how much they don\'t know about this planet.',
    metadata: {
      era: 'Pilot episode — Act Two',
      participants: 'The crew, The Sleeper Network Voice (unseen), various human broadcasts',
      location: 'The Abandoned Car Wash',
      causes:
        "Mora's improvised rig succeeds in piggybacking local cell towers and filtering Voidborn signal out of human noise.",
      outcome:
        'First confirmed contact with the sleeper network. Two actionable pieces of intel (observatory rendezvous, Hector warning). One ominous parting message.',
      canonStatus: 'Canon',
    },
    imagePrompt:
      "Interior of an abandoned car wash tunnel at night. Five alien figures cluster in the middle around an improvised rig — a cheap burner phone wired into a glowing ship fragment and a thrifted radio. Green-blue indicator light pulses at the junction. All five faces are lit from below by the rig's glow, expressions tense, leaning in. Faint violet sparks of signal arc off the ship fragment. The open bay at the end of the tunnel shows a cold industrial lot and distant city lights. Pixar-quality animated feature style, moody noir glow, 4K quality.",
    threeDPrompt:
      'Interior abandoned car wash tunnel at night, five alien figures clustered around improvised radio rig of burner phone glowing ship fragment and thrifted radio, green-blue pulsing indicator, faces lit from below by glow, violet signal sparks arcing off fragment, cold industrial lot at far end, animated noir style',
  },
  {
    name: 'The Meteor Hunter Sighting',
    kind: 'event',
    description:
      'Two teenage boys pull into the abandoned car wash lot in a cheap sedan, armed with energy drinks and phone cameras, convinced the meteor landed nearby and they are going to go viral. They are correct about the meteor. In the dark, one of them catches Drael\'s glowing gold eyes. Drael, smiling, says "Greetings." The teens scream and floor it out of the lot. Their footage will absolutely go viral. Zix is furious. Drael is very pleased with himself. The sleeper network\'s warning about humans watching suddenly feels much more urgent.',
    metadata: {
      era: 'Pilot episode — Act Two, late',
      participants: 'The crew (especially Drael), The Meteor Hunters',
      location: 'Outside The Abandoned Car Wash',
      causes:
        "Local meteor buzz. Teens with phone cameras. Drael's inability to stop smiling at humans.",
      outcome:
        "Blurry vertical footage of Drael's glowing eyes uploaded to the internet within minutes. The crew's exposure risk increases. Zix's threshold for \"no more sightseeing\" becomes louder.",
      canonStatus: 'Canon',
    },
    imagePrompt:
      'Cinematic night shot at an abandoned car wash parking lot. In the foreground, the rear of a cheap teenage-owned sedan, brake lights glowing red, tire smoke as it accelerates away. Through the rear window: two teenage boys with phones in hands, mouths open in screams. In the background, at the mouth of the car wash, a handsome alien silhouette stands calmly with two faintly glowing gold eyes, a serene half-smile on his lips. Four other alien shapes hunched behind him facepalming. Pixar-quality animated feature style, comedic horror energy, 4K quality.',
    threeDPrompt:
      'Night shot abandoned car wash parking lot, cheap sedan peeling away with brake lights and tire smoke in foreground, two teens screaming through rear window with phones, alien silhouette at car wash mouth with glowing gold eyes and half-smile, four other aliens behind him facepalming, animated comedic horror style',
  },
  {
    name: 'The Pre-Dawn Resolve',
    kind: 'event',
    description:
      'The closing scene of the pilot. The crew stands on a bald hill overlooking the suburb at pre-dawn, with the distant dome of the observatory on the far hill. Zix announces, with all the formality he can muster, that they will go to the observatory, contact the sleeper network, repair the ship, and leave Earth immediately. He turns to find everyone else staring at the glowing city — the helicopter, the house-party music, the freeway lights, the taco wrapper blowing past — with an expression he does not want to see. Nobody looks eager to leave. The radio crackles one last time with the sleeper voice: "Earth changes you. That is your first warning." Below, in the city, a tiny signal blinks back. End of pilot.',
    metadata: {
      era: 'Pilot episode — Tag',
      participants:
        'The crew, The Sleeper Network Voice (final transmission), a distant unknown signal',
      location: 'The Hilltop Lookout',
      causes:
        'Enough has happened in one night for the crew to realize Earth is more complicated than the briefing. The sleeper network has just confirmed it.',
      outcome:
        "The mission is reaffirmed in Zix's words and quietly undermined by everyone else's face. The observatory is set up as the next destination. A hidden second signal blinks back from the city, telling the audience (but not the crew) that something else is watching them.",
      canonStatus: 'Canon',
    },
    imagePrompt:
      "Pre-dawn on a bald hilltop over a Southern California suburb. Five alien figures in silhouette stand at the crest, backs to camera. In the valley below: tract homes, palm trees, fast-food signs fading in the thinning night, a freeway ribbon of headlights, and on the far hill an observatory dome catching the first blue-gold light. A helicopter with a red blinking light crosses the sky. A taco wrapper blows past the aliens' feet. Deep in the city, one tiny blue-green pinprick of light blinks back — subtle but visible. Pixar-quality animated feature style, cinematic dawn tableau, 4K quality.",
    threeDPrompt:
      'Pre-dawn bald hilltop over California suburb, five silhouetted alien figures backs to camera at crest, valley below with tract homes palm trees fast food signs freeway headlights, observatory dome on far hill catching first blue-gold light, red blinking helicopter crossing sky, taco wrapper blowing, tiny blue-green pinprick signal blinking in city, animated cinematic tableau style',
  },

  // ═══════════════════════════════════════════════════════════════════════
  // LORE
  // ═══════════════════════════════════════════════════════════════════════
  {
    name: 'Voidborn Heritage',
    kind: 'lore',
    description:
      'The Voidborn self-mythology that Zix invokes constantly and the rest of the crew respects with varying degrees of eye-rolling. "Descendants of the Voidborn" is not a description, it is a lineage claim — implying a first generation, an origin event, and a multi-generational scattering across the stars. The pilot does not resolve the origin. It only shows the current generation struggling to uphold a mission code written by people much less annoyed than they are. Whatever the Voidborn were originally, they are no longer all in one place.',
    metadata: {
      loreType: 'Species backstory / Cultural self-identity',
      article:
        '"We are descendants of the Voidborn." The phrase appears in oaths, mission briefings, and Zix\'s speeches during crashes. It implies: (1) the Voidborn are a named originating people, (2) the current speakers are downstream of them, (3) there is a code of conduct they are expected to uphold. Whether "the Voidborn" refers to a founding generation, a home planet, a diaspora event, or something stranger remains unresolved in the pilot. The sleeper-network warning — "Earth changes you" — implies the code is flexible, and that Earth specifically has bent previous Voidborn.',
      relatedConcepts: 'The Sleeper Network, the mission code, hive-sync bonding, nutrient paste',
      canonWeight: 'Hard Canon',
    },
    imagePrompt:
      'Mythic illustration of Voidborn Heritage: a stained-glass-style panel broken into three vertical sections. Left: a cluster of towering ancestral Voidborn figures silhouetted against a nebula, holding tools and staffs, representing the founding generation. Middle: a starfield with many small ships radiating outward from a central point — the diaspora. Right: the modern crew of the Starling standing together, smaller than their ancestors but clearly lineage-bearers. Rich indigo and gold palette. Pixar-quality animated feature style with stained-glass graphic treatment, 4K quality.',
    threeDPrompt:
      'Stained-glass style triptych, left panel towering ancestral Voidborn silhouettes against nebula holding tools and staffs, middle panel starfield with ships radiating outward from central point, right panel modern Starling crew smaller than ancestors but lineage-bearers, indigo and gold palette, animated stained-glass style',
  },
  {
    name: 'Earth Changes You',
    kind: 'lore',
    description:
      'The parting message from the sleeper-network voice at the end of the car-wash transmission — and the central thematic statement of the entire series. "To any Voidborn survivors: Earth changes you. That is your first warning." The phrase implies that previous stranded crews have been changed by Earth — culturally, physically, spiritually, or all three — and that this change is significant enough to warrant the warning being the first thing a new arrival hears. What kind of change is not specified. But by the time Zix announces the mission and turns to find every other crewmember already in love with the planet, the warning has begun coming true.',
    metadata: {
      loreType: 'Central thematic warning / Series premise',
      article:
        '"Earth changes you" is the sleeper network\'s opening line to any new Voidborn arrival. In the pilot it is issued twice — once at the end of the car-wash transmission ("That is your first warning") and again as a whisper during the pre-dawn tag. The warning implies: (1) long-stranded Voidborn on Earth have observed a consistent pattern of change in new arrivals, (2) the change is significant enough to lead, (3) there is a second warning coming. The series will explore what the change actually is.',
      relatedConcepts: 'The Sleeper Network, stranded cells, going native, the mission code',
      canonWeight: 'Hard Canon',
    },
    imagePrompt:
      'Conceptual art for "Earth Changes You": a Voidborn figure in profile, the left half of their body still clearly alien — indigo skin, cranial ridges, pupilless eye — and the right half subtly, gradually, shifting toward human features — warmer skin tone, rounded pupil, softer jaw — with a thin gold seam of light running down the vertical center where the two halves meet. Behind them, a montage of small Earth elements in the negative space — a palm tree, a neon sign, a helicopter, a cup of coffee. Pixar-quality animated feature style, symbolic transformation portrait, 4K quality.',
    threeDPrompt:
      'Voidborn figure in profile with left half clearly alien indigo with cranial ridges and pupilless eye and right half shifting to human with warmer skin rounded pupil softer jaw, gold seam of light down vertical center, small Earth elements in negative space palm tree neon sign helicopter coffee cup, animated symbolic style',
  },
  {
    name: "Nuni's Misinformation",
    kind: 'lore',
    description:
      "A running catalog of things Nuni confidently asserted about Earth during the descent that turned out to be wrong. Earth is low-risk. Humans are probably extinct. Dominant lifeform: cow. Mild weather. Every one of these is revised out loud within minutes of the crash, and the list keeps growing: celebrity magazines are a hierarchy of priests, humans vacation in a vertical position, taxes are something you can love. Nuni's misinformation is both a running gag and a serious worldbuilding device — it tells the audience how the Voidborn see Earth from a distance, and how wrong that view is once you're on the ground.",
    metadata: {
      loreType: 'Running gag / Anthropological commentary',
      article:
        "The pilot establishes that the Voidborn scholarly view of Earth is extremely outdated and also just wrong in a lot of places. Confirmed misclassifications: (1) humans as probably extinct, (2) cows as dominant lifeform, (3) Earth as low-risk, (4) weather as mild, (5) celebrity magazines as religious hierarchy. Some of these will be corrected on-screen. Some will not. Nuni's research is now under real-world revision, but the rest of the Voidborn diaspora is still running on the old briefing.",
      relatedConcepts: 'Nuni, Voidborn academic archive, Earth briefings, the cow-priest problem',
      canonWeight: 'Hard Canon',
    },
    imagePrompt:
      "Conceptual illustration: a cracked alien tablet on a wooden desk, its screen showing a hierarchical chart of Earth's dominant lifeforms with COW at the top, HUMAN (extinct?) in a side branch, and priest symbols next to photographs of celebrities. Around the tablet, red-ink Voidborn glyphs have been scribbled over the chart in correction marks. A frustrated alien anthropologist's hand (pale blue-silver, four fingers) holds a pen mid-correction. Pixar-quality animated feature style, comedic academic detail, 4K quality.",
    threeDPrompt:
      'Cracked alien tablet on wooden desk with hierarchical Earth lifeform chart showing COW at top HUMAN extinct in side branch priest symbols next to celebrity photos, red-ink Voidborn glyphs scribbled over chart as corrections, pale blue-silver four-fingered alien hand with pen mid-correction, animated comedic academic style',
  },
  {
    name: 'Voidborn Daily Life',
    kind: 'lore',
    description:
      'Texture details about normal pre-crash Voidborn life implied by the pilot\'s offhand references. Drael mentions "nutrient paste" as the default food. He mentions "hive sync" as something humans uniquely do not have. He mentions the moon casinos of Jath as a normal vacation option. Pebb ate glow fruit before takeoff. Voidborn families are said to be telepathically bonded at the crèche. Ships have designated bathrooms that can fly out of them. Mission codes are spoken in multi-page oaths. Taken together, the picture is of a people whose daily life is more networked, more ritualized, and considerably more catered than Earth — which makes the appeal of chaotic Earth nightlife to someone like Drael make uncomfortable sense.',
    metadata: {
      loreType: 'Texture / Implied culture and daily life',
      article:
        'Inferred from the pilot: (1) Voidborn family units share partial telepathic/hive-sync connection, (2) nutrient paste is a staple food, (3) glow fruit is a common bioluminescent snack, (4) luxury travel exists (moon casinos of Jath), (5) mission codes are formal and memorized, (6) ships are small, personal, and frequently in need of repair. Implication: Voidborn daily life has a lot of structure, and Earth has a lot of chaos. Some crews will fall hard for the chaos. Hence the sleeper network warning.',
      relatedConcepts:
        'Hive-sync, nutrient paste, glow fruit, moon casinos of Jath, mission code, Voidborn crèche',
      canonWeight: 'Hard Canon',
    },
    imagePrompt:
      "Slice-of-life illustration of normal Voidborn daily life before the pilot's crash: an interior of a modest Voidborn family habitat. Soft violet ambient light. A family of four Voidborn of varying castes sharing a low table, eating from a communal tray of nutrient paste and glow fruit, their eyes half-closed in the subtle unison of hive-sync bonding. Out the large curved window, a quiet alien city skyline with elegant ships drifting between towers. Warm, ordinary, deeply not-Earth. Pixar-quality animated feature style, warm domestic lighting, 4K quality.",
    threeDPrompt:
      'Voidborn family interior, soft violet ambient light, family of four at low table sharing communal tray of nutrient paste and glow fruit with eyes half-closed in hive-sync, large curved window showing quiet alien city skyline with ships drifting between towers, warm domestic, animated style',
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
  console.log('  VOIDBORN SAGA — Wiki Population');
  console.log('  Pilot Episode: "Crash Landing"');
  console.log('  ' + ENTITIES.length + ' entities across all categories');
  if (UNIVERSE_ADDR) {
    console.log('  Universe: ' + UNIVERSE_ADDR);
  } else {
    console.log('  Universe: (standalone — no VOIDBORN_ADDR set)');
  }
  console.log('═'.repeat(60));

  log('AUTH', 'Authenticating...');
  const token = await getAuthToken();
  log('AUTH', `Authenticated as ${account.address}`);

  const results: Array<{ name: string; kind: string; id: string | null; image: boolean }> = [];

  for (let i = START_INDEX; i < ENTITIES.length; i++) {
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
          ...(UNIVERSE_ADDR ? { universeId: UNIVERSE_ADDR } : {}),
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
            ...(UNIVERSE_ADDR ? { universeId: UNIVERSE_ADDR } : {}),
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

    if (i < ENTITIES.length - 1) await sleep(1500);
  }

  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log('  VOIDBORN SAGA — Wiki Population Complete');
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

  if (UNIVERSE_ADDR) {
    console.log(`\n  Universe: ${UNIVERSE_ADDR}`);
  }
  console.log(`  View at: http://localhost:5173/wiki\n`);
}

main().catch((err) => {
  console.error('FAILED:', err.message ?? err);
  process.exit(1);
});
