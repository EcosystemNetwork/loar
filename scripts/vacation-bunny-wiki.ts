/**
 * THE VACATION BUNNY UNIVERSE — Wiki Population
 *
 * Pilot: "Butterfly Days in Cannes" — dialogue-free Pixar-style kids' show.
 * Story by YOONJEONG HAN.
 *
 * LOCKED CHARACTER RULES (encoded in EVERY image prompt):
 *   - Judy: tall mother bunny, DEEP PURPLE eyes, white/cream soft fur,
 *           dark navy-purple silky dress, WHITE tiny butterfly pendant
 *           (always worn, rests on chest).
 *   - Baby Bunny: small child bunny, BRIGHT PURPLE eyes, cream-yellow fur,
 *           baby-yellow long-sleeve tutu dress, sparkly tiara (daytime only),
 *           PURPLE tiny butterfly pendant (always worn, rests on chest).
 *   - Pendants are never removed during the day. They rest naturally,
 *     move with motion, catch light during emotional beats.
 *
 * Usage:
 *   BUNNY_ADDR=0x... pnpm tsx scripts/vacation-bunny-wiki.ts
 *   (run without BUNNY_ADDR to create entities standalone)
 *
 * Resume: set START_INDEX=N to skip the first N entities.
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

const UNIVERSE_ADDR = process.env.BUNNY_ADDR ?? null;
const START_INDEX = parseInt(process.env.START_INDEX ?? '0', 10);

// ── Shared style tokens (keep every entity visually unified) ────────────
const STYLE = [
  'Pixar-style 3D animated kids show',
  'soft painterly textures',
  'cinematic lighting',
  'soft depth of field',
  'dreamy glow',
  'warm pastel palette',
  'child-friendly emotional storytelling',
  'no text no watermark',
].join(', ');

const JUDY_DNA = [
  'Judy is a tall slender adult mother bunny, soft white fluffy fur, deep purple eyes,',
  'long floppy ears, elegant long-limbed silhouette.',
  'She wears a dark navy-purple silky dress with a soft sheen, elegant but casual daywear.',
  'A tiny WHITE butterfly pendant on a delicate silver chain rests on her chest —',
  'the pendant never leaves her neck and moves naturally with her.',
].join(' ');

const BABY_DNA = [
  'Baby Bunny is a small toddler bunny, soft cream-yellow fur, bright purple eyes,',
  'short round ears, chubby cheeks, adorable tiny stature.',
  'She wears a baby-yellow long-sleeve tutu dress that flares when she moves,',
  'with a small sparkly silver tiara placed between her ears.',
  'A tiny PURPLE butterfly pendant on a delicate silver chain rests on her chest —',
  'the pendant never leaves her neck and moves naturally with her.',
].join(' ');

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
  // PEOPLE
  // ═══════════════════════════════════════════════════════════════════════
  {
    name: 'Judy',
    kind: 'person',
    description:
      "Judy is the heart of the show — a graceful, quietly radiant mother bunny who speaks in smiles, touches, and shared silences. In Cannes, as in every vacation before and every vacation to come, she carries her daughter's joy like it's the most important cargo in the world. Judy does not raise her voice. She does not hurry. She notices everything — the way the light catches her daughter's tiara, the way a croissant flakes at the first bite, the way a seagull's shadow is funnier than scary if you're brave. She wears her navy silky dress not for anyone else but because the pendant — her white butterfly — looks right against it. That butterfly is the promise she made the day her daughter was born: 'No matter where, no matter when, you and I will have days just like this one.'",
    metadata: {
      role: 'Mother / Protagonist',
      species: 'Vacation Bunny',
      eyes: 'Deep purple',
      fur: 'Soft white, slightly cream at the ears',
      signatureOutfit: 'Navy-purple silky dress (day) / soft lavender sleep set (night)',
      pendant: 'White butterfly on silver chain — NEVER removed during the day',
      personality: 'Warm, patient, observant, quietly emotional',
      voice: 'None — story is dialogue-free. Judy speaks only in expression and gesture.',
    },
    imagePrompt: `${STYLE}. Character sheet portrait of ${JUDY_DNA} She stands gently, half-smile, hands folded in front of her. Warm golden-hour rim light on her fur. Character turnaround reference art. Clean soft gradient background. Pixar-style 3D render, emotional warmth.`,
    threeDPrompt:
      'A tall slender Pixar-style mother bunny character, soft white fluffy fur, deep purple eyes, long floppy ears, wearing a dark navy-purple silky sleeveless dress, a tiny white butterfly pendant on a silver chain around her neck. Clean T-pose character model for animation.',
  },
  {
    name: 'Baby Bunny',
    kind: 'person',
    description:
      "Baby Bunny is the glow of every scene — a tiny, bright-purple-eyed toddler with a yellow tutu, a tiara, and a purple butterfly pendant that matches her mother's white one. She does not speak — she points, she spins, she claps, she runs, she hugs. She treats a croissant like a coronation, a seagull like a dragon she must defeat, a spiral staircase like a castle she was born to climb. Her tiara is removed only before sleep and placed reverently on the bedside table, because the pendant is for always and the tiara is only for princesses who are awake. Whenever Judy glances down, Baby Bunny is already looking up.",
    metadata: {
      role: 'Daughter / Co-protagonist',
      species: 'Vacation Bunny',
      eyes: 'Bright purple',
      fur: 'Soft cream-yellow, buttery warm',
      signatureOutfit:
        'Baby-yellow long-sleeve tutu + silver tiara (day) / pastel pajama set (night)',
      pendant: 'Purple butterfly on silver chain — NEVER removed',
      personality: 'Joyful, brave, theatrical, curious, adoring of her mother',
      voice: 'None — expresses everything through gesture, expression, and tiny wordless sounds.',
    },
    imagePrompt: `${STYLE}. Character sheet portrait of ${BABY_DNA} She stands with arms slightly out, wide bright-purple eyes, big excited smile, tutu skirt flaring softly. Warm golden sunlight on her fur, sparkle highlight on tiara and purple pendant. Character turnaround reference art. Clean soft gradient background. Pixar-style 3D, adorable and heartwarming.`,
    threeDPrompt:
      'A small toddler Pixar-style bunny character, soft cream-yellow fluffy fur, bright purple eyes, short round ears, wearing a baby-yellow long-sleeve tutu dress, a small sparkly silver tiara between her ears, a tiny purple butterfly pendant on a silver chain. Clean T-pose character model for animation.',
  },
  {
    name: 'Older Baby Bunny',
    kind: 'person',
    description:
      'The after-credits memory. A slightly older version of Baby Bunny — taller, the tutu fitted now rather than puffy, the tiara retired, but the purple butterfly pendant still at her throat. She stands in front of a mirror alone and, for the first time, adds sparkle makeup to her own eyebrows the same careful way her mother once did for her. She is not a new character. She is the same Baby Bunny, remembering.',
    metadata: {
      role: 'After-credits callback / future self',
      species: 'Vacation Bunny',
      eyes: 'Bright purple (slightly calmer, more aware)',
      fur: 'Soft cream-yellow, same as her younger self',
      signatureOutfit:
        'Fitted yellow dress (slightly mature silhouette), NO tiara, purple butterfly pendant',
      pendant: 'Same purple butterfly pendant, still never removed',
      personality: 'Calm, quietly emotional, carrying the memory',
    },
    imagePrompt: `${STYLE}. Character sheet portrait of a slightly older young-teen Pixar-style bunny — same cream-yellow fur, same bright purple eyes as Baby Bunny, but taller, with a more fitted baby-yellow dress (no tutu puff), NO tiara, the same tiny purple butterfly pendant on a silver chain resting on her chest. Soft contemplative smile. Golden warm light. Calm emotional tone, not playful. Pixar 3D.`,
    threeDPrompt:
      'A young-teen Pixar-style bunny character, soft cream-yellow fur, bright purple eyes, wearing a fitted baby-yellow dress (not a tutu), no tiara, a tiny purple butterfly pendant on a silver chain. Clean T-pose character model.',
  },
  {
    name: 'The Cannes Seagull',
    kind: 'person',
    description:
      "The show's only antagonist, and only for thirty seconds. A plump, scruffy Mediterranean seagull with opinions about french fries and no opinions about consequences. He swoops onto the beach restaurant table, steals exactly one fry, and stares back with the unearned confidence of a creature who has never been bested. Baby Bunny chases him off with a princess pose and a raised tiny fist. He returns to the pier to tell his friends he won.",
    metadata: {
      role: 'Comic antagonist (Scene 3)',
      species: 'Seagull',
      personality: 'Smug, opportunistic, cowardly when challenged',
    },
    imagePrompt: `${STYLE}. Character portrait of a plump cartoonish Pixar-style Mediterranean seagull with slightly scruffy white-and-grey feathers, large expressive black eyes, a smug tilted head, a single golden french fry held in his orange beak. Standing on a white tablecloth near the edge of a seaside restaurant table with ocean behind. Comic energy, mischievous and adorable.`,
    threeDPrompt:
      'A plump cartoon Pixar-style Mediterranean seagull, scruffy white and grey feathers, orange beak, bright cheeky eyes, comic expression. Clean standing pose character model.',
  },

  // ═══════════════════════════════════════════════════════════════════════
  // SPECIES
  // ═══════════════════════════════════════════════════════════════════════
  {
    name: 'Vacation Bunny',
    kind: 'species',
    description:
      "Anthropomorphic rabbits who walk on two legs, dress like humans, and treat travel as the highest art form. A Vacation Bunny family does not take vacations — they live them in small, sacred pockets. Every Vacation Bunny family carries a generational object (in Judy's line: the butterfly pendants). They favor pastel wardrobes, always accessorize, and believe that a day without at least one mirror selfie is a day that didn't happen. Judy and Baby Bunny are the audience's doorway into this quietly magical species.",
    metadata: {
      rangeOfColors: 'White, cream, cream-yellow, grey, pastel pink',
      eyeColors: 'Always some shade of purple, violet, or lavender',
      averageHeight: 'Adult ~5\'2", child ~2\'8"',
      society: 'Matrilineal, quietly sentimental, object-oriented (heirlooms matter deeply)',
      culturalNorm: 'Every major life moment is marked by a small wearable object',
    },
    imagePrompt: `${STYLE}. Species reference sheet: a family lineup of anthropomorphic Pixar-style bunnies of different heights and pastel fur tones (white, cream, cream-yellow, pastel pink, soft grey) — all with purple-tinted eyes. Various elegant casual outfits: silky dresses, tutus, pastel sweaters. Each wears a small pendant on a silver chain. Warm natural lighting, friendly group pose. Reference art style, clean background.`,
    threeDPrompt:
      'Pixar-style anthropomorphic bunny species, bipedal, humanoid proportions with bunny head and long ears, purple eyes, soft fluffy fur. Generic species reference model.',
  },

  // ═══════════════════════════════════════════════════════════════════════
  // PLACES
  // ═══════════════════════════════════════════════════════════════════════
  {
    name: 'The Cannes Apartment',
    kind: 'place',
    description:
      "A top-floor Cannes apartment Judy rents every summer. Soft white curtains, a pale blue velvet sofa, a white wooden bed with pastel linens, a full-length antique mirror, and a tall window that faces the Mediterranean. In the morning, it fills with warm apricot sunlight. At night, the window frames moonlit rooftops. The apartment is the episode's anchor — every day begins and ends inside its walls.",
    metadata: {
      location: 'Old town Cannes, France',
      keyFeatures: 'Full-length mirror, bedside table with tiara rest, French window to the sea',
      morningMood: 'Warm apricot golden hour',
      nightMood: 'Blue-silver moonlight with soft lamp glow',
    },
    imagePrompt: `${STYLE}. Wide establishing shot of a cozy top-floor Cannes French Riviera apartment interior. Soft white curtains blowing gently at a tall open French window overlooking the Mediterranean sea. A white wooden bed with pastel pink and yellow linens, an antique full-length gold-framed mirror against one wall, a bedside table with a tiny tiara resting on it, warm apricot morning light pouring in. Bright cheerful children's animated film production design. No characters in frame.`,
    threeDPrompt:
      'A cozy Pixar-style Cannes apartment interior environment, white bed with pastel linens, antique full-length mirror, French window to the sea, warm soft lighting. Environment set piece model.',
  },
  {
    name: 'La Petite Boulangerie',
    kind: 'place',
    description:
      'The tiny corner bakery three doors down from the apartment. Pale pink awning, gold lettering, a glass case full of croissants, pain au chocolat, macarons in rainbow rows, and a copper espresso machine that hisses politely every thirty seconds. Madame runs it. She never speaks — she nods, she smiles, she slides a warm croissant across the counter. For Baby Bunny, the bakery is where the day officially starts.',
    metadata: {
      location: 'Rue Meynadier, Cannes',
      signature: 'Almond croissant + café au lait + hot chocolate for Baby Bunny',
      counterHeight: 'Exactly tall enough that Baby Bunny has to stand on tiptoe',
    },
    imagePrompt: `${STYLE}. Wide shot of a tiny adorable Cannes French bakery interior with a pale pink striped awning, gold script lettering above, a glass pastry case filled with perfect golden croissants, pain au chocolat, and rainbow macarons. A copper espresso machine on marble counter, soft morning light, wood floor, blackboard menu in chalk. Warm and inviting Pixar animated film production design. No characters.`,
    threeDPrompt:
      'Pixar-style French bakery interior environment, pink awning, glass pastry case, copper espresso machine, marble counter. Environment set piece model.',
  },
  {
    name: 'Parasol Beach Restaurant',
    kind: 'place',
    description:
      'The yellow-parasol beachfront lunch spot. Wooden deck built over white sand, turquoise Mediterranean water lapping twenty feet away, crystal water glasses, white linen tablecloths, and one persistent seagull problem. Judy and Baby Bunny take the corner table — the one with the best ocean view, where crystal glasses catch the light when they clink.',
    metadata: {
      location: 'Plage du Midi, Cannes',
      signature: 'Frites, apple juice in a crystal glass, one cocktail, and eventual seagull drama',
    },
    imagePrompt: `${STYLE}. Wide shot of a luxury beachfront restaurant in Cannes. Rows of buttery-yellow parasols over wooden deck tables with crisp white linen cloths, turquoise Mediterranean sea lapping white sand just below the deck, distant sailboats, sunlit lunch setup — a plate of golden frites, a crystal cocktail glass, a crystal glass of apple juice. One plump mischievous seagull perched on a nearby railing. No people in frame. Pixar 3D warm daylight.`,
    threeDPrompt:
      'Pixar-style Mediterranean beachfront restaurant environment, yellow parasols, wooden deck over white sand, turquoise sea. Environment set piece model.',
  },
  {
    name: 'Château de Cannes',
    kind: 'place',
    description:
      "The old medieval castle on the hill above Cannes, with its iconic stone watchtower and spiral staircase. The climb is long. The view is the whole French Riviera spread out like a postcard. This is the emotional high point of the episode — the place where Judy's eyes go slightly wet and she kisses Baby Bunny on the head at the top of the world.",
    metadata: {
      location: 'Le Suquet, Cannes (old town hill)',
      signature:
        'Spiral stone staircase, 360° tower view, tutu-friendly princess spin on the parapet',
    },
    imagePrompt: `${STYLE}. Wide establishing shot of a picturesque Pixar-style medieval stone castle perched on a hill above old-town Cannes, warm sunlit beige stone, a tall circular watchtower with narrow windows, pathway of worn steps leading up through cypress trees, the Mediterranean sea in the distance. Warm golden-hour light. No characters. Cinematic establishing shot.`,
    threeDPrompt:
      'Pixar-style medieval French castle environment with a tall stone watchtower, spiral staircase, worn stone steps, cypress trees. Environment set piece model.',
  },
  {
    name: 'Night Carousel',
    kind: 'place',
    description:
      "The seaside promenade carousel at night. Every horse glows. Soap-bubble machines on the edges release slow-drifting iridescent bubbles that catch the carousel lights. A polished black wooden horse is Baby Bunny's favorite — she chooses it without hesitation. The carousel is the dreamiest, most wordless moment of the episode: a slow waltz of lights and bubbles and a mother joining her daughter on the next turn.",
    metadata: {
      location: 'Cannes seaside promenade (La Croisette), night',
      signature:
        'Black horse with gold trim for Baby Bunny, white horse for Judy, floating bubbles everywhere',
    },
    imagePrompt: `${STYLE}. Wide night shot of a magical Pixar-style seaside carousel on the Cannes promenade. Warm incandescent bulbs lining every arch, carousel horses in pastel and gold, a polished BLACK wooden horse with gold trim prominently visible, soap bubbles floating slowly through the air catching carousel light, palm trees silhouetted against navy-blue night sky, subtle ocean glow behind. No characters. Dreamy magical children's film atmosphere.`,
    threeDPrompt:
      'Pixar-style night seaside carousel environment, glowing bulbs, pastel and black horses, floating bubbles, palm trees. Environment set piece model.',
  },
  {
    name: 'Glacerie Riviera',
    kind: 'place',
    description:
      "The little gelato counter two blocks from the promenade. Pistachio-mint green walls, a curved glass display case with twenty-four flavors in rainbow order, tiny gold spoons, waffle cones stacked in a wicker basket. Matcha and chocolate are the flavors of choice — matcha for Judy, chocolate for Baby Bunny, and a small unavoidable amount of chocolate on Baby Bunny's cheek by the end.",
    metadata: {
      location: "Rue d'Antibes, Cannes",
      signature: 'Matcha + chocolate gelato, gold spoons, mandatory cheek-wipe moment',
    },
    imagePrompt: `${STYLE}. Interior shot of a tiny charming Pixar-style gelato shop with pale mint-green walls, a curved glass display case showing twenty-plus colorful gelato flavors in rainbow order, gold mini-spoons in a cup, waffle cones stacked in a wicker basket, warm evening light through the storefront window. No characters. Bright inviting children's film production design.`,
    threeDPrompt:
      'Pixar-style gelato shop interior environment, mint green walls, curved glass gelato case, gold spoons, waffle cones. Environment set piece model.',
  },
  {
    name: 'Oceanfront Promenade',
    kind: 'place',
    description:
      'La Croisette at dusk and dawn. Palm trees, pale stone balustrades, the sea changing color every ten minutes. The promenade is the stitching between every scene — the path Judy and Baby Bunny walk hand-in-hand between bakery and beach, between beach and castle, between carousel and gelato, and finally home.',
    metadata: {
      location: 'La Croisette, Cannes',
      signature: 'Palm trees, pale stone rail, ever-changing sea color',
    },
    imagePrompt: `${STYLE}. Wide shot of the Cannes Croisette oceanfront promenade at golden hour. Tall palm trees, a pale stone balustrade, the turquoise Mediterranean sea fading into warm peach sunset, sailboats in the distance, soft warm lamp posts starting to glow. Pixar 3D production design. No characters.`,
    threeDPrompt:
      'Pixar-style Mediterranean oceanfront promenade environment, palm trees, pale stone rail, golden-hour sea. Environment set piece model.',
  },

  // ═══════════════════════════════════════════════════════════════════════
  // THINGS (props)
  // ═══════════════════════════════════════════════════════════════════════
  {
    name: "Judy's White Butterfly Pendant",
    kind: 'thing',
    description:
      'A tiny white enamel butterfly, wings spread, edged in the palest silver, set on a delicate silver chain. Judy received it the day Baby Bunny was born. She has not taken it off since. It rests on her chest, moves with her breath, catches light during emotional moments. In the final shot of the pilot, it rests on the bedside table next to its purple twin — the only time in the entire episode it has ever been off her neck.',
    metadata: {
      material: 'White enamel + pale silver, fine silver chain',
      status: 'Always worn — except the final night reflection shot',
      pairedWith: "Baby Bunny's Purple Butterfly Pendant",
    },
    imagePrompt: `${STYLE}. Macro close-up product shot of a tiny delicate white enamel butterfly pendant with pale silver edging, wings spread, on a fine silver chain, resting on soft navy-purple silky fabric. Soft warm light, magical subtle glow on the wings, shallow depth of field. Pixar 3D prop reference, jewelry-box magic. No characters.`,
    threeDPrompt:
      'A tiny white enamel butterfly pendant with pale silver edging, wings spread, on a fine silver chain. Jewelry prop model.',
  },
  {
    name: "Baby Bunny's Purple Butterfly Pendant",
    kind: 'thing',
    description:
      "The matching pendant to Judy's — a tiny lavender-purple enamel butterfly on a fine silver chain. Baby Bunny has worn it since she was born. It is her favorite thing in the world after her mother. She touches it sometimes without noticing, a little self-soothing ritual. In the carousel scene, the lights catch it and it looks like the pendant itself is alive.",
    metadata: {
      material: 'Lavender-purple enamel, fine silver chain',
      status: 'Always worn — except the final night reflection shot',
      pairedWith: "Judy's White Butterfly Pendant",
    },
    imagePrompt: `${STYLE}. Macro close-up product shot of a tiny delicate lavender-purple enamel butterfly pendant with pale silver edging, wings spread, on a fine silver chain, resting on soft baby-yellow tulle fabric. Magical subtle glow on the wings, soft sparkle, shallow depth of field. Pixar 3D prop reference. No characters.`,
    threeDPrompt:
      'A tiny lavender-purple enamel butterfly pendant with pale silver edging, wings spread, on a fine silver chain. Jewelry prop model.',
  },
  {
    name: 'The Baby-Yellow Tutu Dress',
    kind: 'thing',
    description:
      "Baby Bunny's signature outfit. A long-sleeve dress in baby-yellow cotton with a layered tulle tutu skirt that flares when she spins. Soft, comfortable, washable, and flared perfectly for a princess spin at the top of a castle tower.",
    metadata: {
      color: 'Baby yellow / butter yellow',
      construction: 'Long-sleeve cotton bodice + layered tulle skirt',
      wornBy: 'Baby Bunny',
    },
    imagePrompt: `${STYLE}. Product photograph of a small baby-yellow long-sleeve tutu dress on a mannequin. Cotton bodice, layered butter-yellow tulle skirt, soft and flared. Cream neutral background, soft warm light. Pixar 3D prop reference.`,
    threeDPrompt:
      'Baby-yellow cotton long-sleeve tutu dress for a toddler character. Costume prop model.',
  },
  {
    name: "Judy's Navy Silky Dress",
    kind: 'thing',
    description:
      'Dark navy-purple silky dress with a soft sheen, cut simple and elegant — sleeveless, knee length, flowy. Casual enough for a bakery run, elegant enough for a cocktail at the beach. It makes the white butterfly pendant look like the only jewelry anyone has ever needed.',
    metadata: {
      color: 'Dark navy shading into deep purple',
      construction: 'Silky blend, sleeveless, knee-length, flowy',
      wornBy: 'Judy',
    },
    imagePrompt: `${STYLE}. Product photograph of an elegant dark navy-purple silky knee-length sleeveless dress on a mannequin. Soft sheen, flowy silhouette. Cream neutral background, warm studio light. Pixar 3D prop reference.`,
    threeDPrompt:
      'An elegant dark navy-purple silky knee-length sleeveless dress for an adult character. Costume prop model.',
  },
  {
    name: "Baby Bunny's Sparkle Tiara",
    kind: 'thing',
    description:
      "A tiny delicate silver tiara with pastel rhinestones, sized for a toddler bunny's head. Worn during the day, placed with great ceremony on the bedside table at night. It is, in Baby Bunny's opinion, the most important object after the pendants.",
    metadata: {
      material: 'Silver alloy with pastel rhinestones',
      daytime: 'Worn between her ears',
      nighttime: 'Placed on the bedside table, never stored away',
    },
    imagePrompt: `${STYLE}. Macro close-up product shot of a tiny delicate silver tiara with pastel pink and lavender rhinestones, sized for a toddler. Resting on a white wooden bedside table, soft morning light. Pixar 3D prop reference.`,
    threeDPrompt:
      'A tiny delicate silver tiara with pastel rhinestones, toddler-sized. Jewelry prop model.',
  },
  {
    name: "Baby Bunny's Pastel Pajama Set",
    kind: 'thing',
    description:
      "A two-piece short-sleeve pajama set in pastel pink and buttery yellow, with a tiny embroidered butterfly on the chest pocket. Comfortable, soft, exactly what a small bunny should be wearing when she's watched over her mother watching over her.",
    metadata: {
      color: 'Pastel pink + butter yellow',
      construction: 'Two-piece short-sleeve top + drawstring shorts, cotton',
      wornBy: 'Baby Bunny (night only)',
    },
    imagePrompt: `${STYLE}. Product photograph of a small pastel pink and buttery yellow two-piece toddler pajama set laid flat on pale linen, tiny embroidered butterfly on the chest pocket. Soft shadow, warm cream background. Pixar 3D prop reference.`,
    threeDPrompt:
      'A pastel pink and yellow toddler pajama set, short sleeve top and shorts. Costume prop model.',
  },

  // ═══════════════════════════════════════════════════════════════════════
  // EVENTS
  // ═══════════════════════════════════════════════════════════════════════
  {
    name: 'The Mirror Selfie Ritual',
    kind: 'event',
    description:
      "The signature recurring moment of the series. Judy and Baby Bunny, fully dressed for the day, stand in front of the antique mirror and take a series of playful 'selfies' — poses, peace signs, cheek-to-cheek, princess stances. In the pilot it happens twice: once in the morning (playful), and once in the after-credits (quiet, older, meaningful). The mirror sees the whole relationship in miniature.",
    metadata: {
      firstOccurrence: 'Scene 1 — Morning Magic (playful)',
      finalOccurrence: 'After-credits — older Baby Bunny alone, then joined by Judy',
      function: 'Visual anchor of the mother-daughter bond',
    },
    imagePrompt: `${STYLE}. A mirror reflection shot showing Judy (tall mother bunny, white fluffy fur, deep purple eyes, dark navy-purple silky dress, tiny white butterfly pendant) and Baby Bunny (small bunny, cream-yellow fur, bright purple eyes, baby-yellow tutu, silver tiara, tiny purple butterfly pendant) standing cheek-to-cheek in front of an antique gold-framed full-length mirror, both doing playful matching poses with soft smiles. Color contrast between navy and yellow. Both pendants visible and catching light. Warm apricot morning light through tall window. Pixar 3D, mother-daughter joyful moment.`,
    threeDPrompt:
      'Mother and toddler bunny character pair doing a cheek-to-cheek mirror selfie pose. Diorama scene model.',
  },

  // ═══════════════════════════════════════════════════════════════════════
  // LORE
  // ═══════════════════════════════════════════════════════════════════════
  {
    name: 'Butterfly Days',
    kind: 'lore',
    description:
      'The unspoken ritual at the heart of the universe. "Butterfly Days" are the days a Vacation Bunny mother and her child spend together in a new city, doing nothing important and everything meaningful. No schedule, no agenda, no phones — only a shared breakfast, a shared view, a shared laugh, and a shared pendant between them. Every episode of the series is one Butterfly Day. The pilot is the first one the audience witnesses; it is not the first one Judy and Baby Bunny have had.',
    metadata: {
      origin: 'Passed down through generations of Vacation Bunny mothers',
      rules:
        'No dialogue, no rush, one mirror selfie, one shared meal, one high view, one small adventure, one sleep',
      episodeOne: '"Butterfly Days in Cannes"',
    },
    imagePrompt: `${STYLE}. Concept art montage: a soft golden-hour collage showing fragments of a Vacation Bunny Butterfly Day — a pair of tiny butterfly pendants (one white, one purple) floating side by side, a croissant steaming, a spiral staircase, a carousel light, two bunny silhouettes holding hands walking toward a sunset sea. Dreamy painterly storybook Pixar art, emotional warmth, no text.`,
    threeDPrompt:
      'A conceptual diorama of a Vacation Bunny "Butterfly Day" — pendants floating in soft light, symbolic tableau.',
  },
  {
    name: 'The Necklace Pact',
    kind: 'lore',
    description:
      "The promise Judy made the day Baby Bunny was born. Two butterfly pendants, one white and one purple, made as a matching pair. Judy's rule: the pendants are never removed during the day. They rest on the chest, they move with breath, they touch lightly during a hug, they catch the light during emotional moments. They are only removed together, at night, placed side by side on the bedside table. The pact is what the series quietly proves every episode: the bond is not worn loudly — it is worn always.",
    metadata: {
      promiseMade: 'The day Baby Bunny was born',
      rule1: 'Never removed during the day',
      rule2: 'Only removed together at night, placed side by side',
      rule3: 'Catch light during emotional beats',
      rule4: 'Touch lightly during embraces',
    },
    imagePrompt: `${STYLE}. Macro close-up of two tiny butterfly pendants — one WHITE enamel, one PURPLE enamel — lying side by side on a white wooden bedside table in moonlight, both on delicate silver chains. Soft dreamy glow emanating from the butterflies, a faint visual suggestion of a sparkle passing between them. Pixar 3D emotional still-life, magical realism, no characters.`,
    threeDPrompt:
      'Two tiny butterfly pendants (one white, one purple) on silver chains resting side by side on a wooden bedside table, soft moonlight. Prop diorama model.',
  },
];

// ── Auth helpers ────────────────────────────────────────────────────────
function buildMessage(nonce: string): string {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000);
  return [
    `localhost wants you to sign in with your Ethereum account:`,
    getAddress(account.address),
    '',
    'Sign in to LOAR',
    '',
    `URI: http://localhost:3001`,
    `Version: 1`,
    `Chain ID: ${sepolia.id}`,
    `Nonce: ${nonce}`,
    `Issued At: ${now.toISOString()}`,
    `Expiration Time: ${expiresAt.toISOString()}`,
  ].join('\n');
}

async function getAuthToken(): Promise<string> {
  const nonceRes = await fetch(`${SERVER_URL}/auth/nonce`);
  const { nonce } = (await nonceRes.json()) as { nonce: string };
  const message = buildMessage(nonce);
  const signature = await account.signMessage({ message });
  const verifyRes = await fetch(`${SERVER_URL}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3001' },
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

function log(step: string, msg: string) {
  console.log(`[${step}] ${msg}`);
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('  THE VACATION BUNNY UNIVERSE — Wiki Population');
  console.log('  Pilot: "Butterfly Days in Cannes"');
  console.log('  ' + ENTITIES.length + ' entities');
  if (UNIVERSE_ADDR) {
    console.log('  Universe: ' + UNIVERSE_ADDR);
  } else {
    console.log('  Universe: (standalone — no BUNNY_ADDR set)');
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

    log(label, 'Generating 2D art via Google Imagen...');
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

    log(label, 'Creating entity in wiki...');
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

    if (entityId) {
      log(label, 'Kicking off 3D model (fire-and-forget)...');
      try {
        const threeDResult = await tRPCMutate<{ generationId: string; status: string }>(
          'threed.textTo3DPreview',
          {
            prompt: entity.threeDPrompt,
            artStyle: 'cartoon',
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

  console.log('\n' + '═'.repeat(60));
  console.log('  VACATION BUNNY — Wiki Population Complete');
  console.log('═'.repeat(60));
  const created = results.filter((r) => r.id);
  const failed = results.filter((r) => !r.id);
  console.log(`  Created: ${created.length}/${results.length}`);
  if (failed.length) console.log(`  Failed:  ${failed.map((r) => r.name).join(', ')}`);

  const byKind: Record<string, string[]> = {};
  for (const r of created) {
    if (!byKind[r.kind]) byKind[r.kind] = [];
    byKind[r.kind].push(r.name);
  }
  for (const [kind, names] of Object.entries(byKind)) {
    console.log(`\n  ${kind.toUpperCase()}:`);
    for (const n of names) console.log(`    - ${n}`);
  }

  if (UNIVERSE_ADDR) console.log(`\n  Universe: ${UNIVERSE_ADDR}`);
  console.log(`  View at: http://localhost:5173/wiki\n`);
}

main().catch((err) => {
  console.error('FAILED:', err.message ?? err);
  process.exit(1);
});
