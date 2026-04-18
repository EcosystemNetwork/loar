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
  // CHARACTERS — Pilot Episode: "Return"
  // ═══════════════════════════════════════════════════════════════════════
  {
    name: 'Eric',
    kind: 'person',
    description:
      "A young man in his early 20s, half-Asian mixed heritage, with messy black hair that falls over his eyes. Quiet, introspective, and deeply sensitive to sound and emotion — though he doesn't know why yet. Eric went to the rave with his friends Mikel and Jeff expecting a normal night of music and chaos. When his phone died and he got separated in a mosh pit, he stumbled alone into a crowd at a massive stage. On psilocybin mushrooms, he discovered something impossible: he could feel the music as physical architecture, and when his emotions shifted, the music shifted with him. The bass followed his heartbeat. The drops hit when his adrenaline spiked. The crowd moved with his breathing. Then a voice spoke from inside the sound — ancient, alien, patient — and said it had been waiting for him to return. Eric ran. He doesn't understand what happened. But something opened inside him that night, and it isn't closing.",
    metadata: {
      role: 'Protagonist',
      appearance:
        'Early 20s male, half-Asian mixed heritage, messy black hair falling over eyes, slim build, slightly underdressed for the cold — black hoodie, dark jeans, beat-up Vans. Dilated pupils from psilocybin. Sweat on his temples from the crowd. Cheap festival wristband. Expression shifts from lost and overwhelmed to transcendent focus when the power activates.',
      motivations:
        'Just wanted a good night out with friends. Now questioning everything about who he is and what the voice meant by "return."',
      abilities:
        "Psychedelic-activated sonic entropy manipulation — can control music, bass frequencies, crowd energy, and stage lighting through emotional state. Only works under psilocybin. Doesn't understand or control it yet.",
      homePlace: 'Southern California — lives with roommates near San Bernardino',
      affiliations:
        'Friend group: Mikel (experienced raver, secretly a vampire) and Jeff (the driver, big and dumb and lovable)',
    },
    imagePrompt:
      'Full-body character portrait of Eric, a young man in his early 20s. Half-Asian mixed heritage, messy black hair falling over his dark eyes. Slim build, wearing a black hoodie over a plain dark t-shirt, dark jeans, and beat-up Vans sneakers. Cheap neon festival wristband on his left wrist. His pupils are dilated. Sweat glistens on his temples. He stands in a crowd with colored stage lights washing over him — magenta, cyan, ultraviolet. His expression is intense and overwhelmed, caught between fear and wonder. Rave festival atmosphere, psychedelic lighting, photorealistic, 4K quality.',
    threeDPrompt:
      'Young half-Asian male, messy black hair, black hoodie, slim build, dilated pupils, festival wristband, psychedelic rave lighting, overwhelmed expression, standing pose',
  },
  {
    name: 'Mikel',
    kind: 'person',
    description:
      "Eric's close friend and rave mentor. Mikel has been going to raves and festivals for years — he knows every DJ, every stage, every secret entrance. Lean and angular with sharp features, always dressed in all-black techwear that looks expensive. He moves through crowds like water, never bumping anyone, always appearing exactly where he needs to be. There's a reason for this: Mikel is a vampire. Not the Hollywood kind — something older, quieter. The bass and the darkness and the anonymous bodies are perfect cover. He feeds rarely and carefully, and genuinely loves the music. He cares about Eric and Jeff, and when Eric gets separated, Mikel is the one who senses something wrong before Jeff does. He can feel Eric's fear through the crowd like a frequency.",
    metadata: {
      role: 'Deuteragonist / Secret protector',
      appearance:
        'Mid-20s male, lean and angular build, sharp cheekbones, pale skin that looks natural under rave lighting. All-black techwear — fitted tactical jacket, slim cargo pants, matte-black boots. Dark eyes that reflect stage lights unnaturally. Moves through crowds with inhuman grace. Small silver ring on left hand.',
      motivations:
        "Loves the rave scene genuinely. Protects Eric and Jeff without them knowing what he is. Feeds discreetly. When Eric's power activates, Mikel recognizes something ancient — and it terrifies him.",
      abilities:
        'Vampiric senses — heightened hearing, smell, spatial awareness. Can sense emotions through proximity. Moves through crowds without physical contact. Enhanced speed and strength (rarely used). Immune to bass damage.',
      homePlace: 'Unknown — changes apartments frequently. Always has cash.',
      affiliations:
        'Eric (genuine friend), Jeff (genuine friend). No vampire clan mentioned — appears to be solitary.',
    },
    imagePrompt:
      'Full-body character portrait of Mikel, a lean angular young man in his mid-20s. Sharp cheekbones, pale skin, dark eyes that catch light strangely. All-black techwear outfit — fitted tactical jacket with subtle zippers, slim black cargo pants, matte-black boots. A small silver ring on his left hand. He stands at the edge of a rave crowd, the only still figure in a sea of movement. Colored stage lights — red, violet, blue — wash across him but he seems to absorb them rather than reflect them. His expression is watchful, predatory, but not cruel. Rave atmosphere, dark techwear aesthetic, photorealistic, 4K quality.',
    threeDPrompt:
      'Lean angular male, sharp cheekbones, pale skin, all-black techwear tactical outfit, dark eyes reflecting light, standing still in rave crowd, predatory watchful pose',
  },
  {
    name: 'Jeff',
    kind: 'person',
    description:
      "The third member of the friend group and the one with the car — which makes him essential. Jeff is big, muscular, classically handsome in a way that gets him free drinks, and not the sharpest. He's the heart of the group: loyal, loud, always having the best time, always losing his shirt by midnight. He doesn't understand half the music but he loves the energy. He's the one who drove everyone to NOS Event Center in his lifted truck. When Eric goes missing, Jeff's first instinct is to climb something tall and yell Eric's name over the bass, which is both useless and endearing. He doesn't know Mikel is a vampire. He thinks Mikel is just \"really good at raves.\"",
    metadata: {
      role: 'Comic relief / Heart of the group',
      appearance:
        'Early 20s male, big and muscular, 6\'2", classically handsome square jaw, short-cropped brown hair. Shirtless by Act 2 (lost his tank top in the mosh pit). Athletic build glistening with sweat. Cargo shorts, high-top sneakers, multiple festival wristbands from past events stacked on both wrists. Huge grin. Always holding a water bottle.',
      motivations:
        "Have the best night ever. Keep the group together. Drive everyone home safe. He's simple and that's what makes him good.",
      abilities:
        'Can bench 315. Has the car keys. Can be heard yelling over any bass drop. Surprisingly good at finding lost people by pure optimistic persistence.',
      homePlace: 'San Bernardino area — lives with his parents, works at a gym',
      affiliations:
        "Eric (best friend since high school), Mikel (rave buddy, thinks he's just cool)",
    },
    imagePrompt:
      "Full-body character portrait of Jeff, a big muscular young man in his early 20s. 6'2\", classically handsome with a square jaw and short-cropped brown hair. SHIRTLESS with a tanned athletic build glistening with sweat. Cargo shorts, high-top sneakers, and multiple stacked festival wristbands on both wrists. He holds a water bottle in one hand and has a massive grin on his face. Festival lights illuminate his excited expression — he's having the best night of his life. Rave atmosphere, warm energy, photorealistic, 4K quality.",
    threeDPrompt:
      'Big muscular shirtless male, square jaw, short brown hair, cargo shorts, sneakers, festival wristbands, huge grin, holding water bottle, rave lighting, excited pose',
  },
  {
    name: 'The Frequency',
    kind: 'person',
    description:
      'The dark alien voice that speaks to Eric through the music when his power activates. Not a physical being — it exists inside sound itself, between frequencies, in the spaces where bass becomes vibration becomes thought. It has been dormant, waiting, listening through every speaker and subwoofer on Earth for the one who can hear it back. When Eric\'s psilocybin-enhanced emotions began reshaping the music at the main stage, The Frequency recognized its host — or its heir, or its weapon. It said only one thing: "I have been waiting for you to return." The voice is ancient, patient, genderless but deep, and it speaks not through ears but through the chest cavity, through bone conduction, through the bass itself. Eric is the first human in millennia who can hear it. It is unclear whether The Frequency is benevolent, predatory, or something beyond human moral categories entirely.',
    metadata: {
      role: 'Antagonist / Ancient entity / Mystery',
      appearance:
        "No physical form. Manifests as: a dark resonance felt in the chest, impossible sub-bass that vibrates bone, visual distortion in stage lighting — colors inverting, shadows moving wrong, the crowd momentarily frozen in a single frame. When it speaks, the music doesn't stop — it restructures around the voice like the universe making room.",
      motivations:
        'Unknown. Has waited millennia for someone who can "return." Whether this means Eric specifically, or a type of being, or something else entirely, is the central mystery of the series.',
      abilities:
        "Can speak through any sound system. Can restructure music in real-time. Can freeze crowd perception momentarily. Seems to amplify Eric's emotional-sonic connection. May be able to do much more.",
      homePlace: 'Exists between frequencies — lives in sound itself',
      affiliations:
        'Spoke to Eric. Implied previous relationship ("return"). No other known contacts.',
    },
    imagePrompt:
      "Abstract entity concept art for The Frequency — an alien presence that lives inside sound. A massive dark void opens behind a rave stage's speaker wall, visible only as a distortion in the light — colors inverting to negative, bass frequencies rendered as visible dark ripples in the air. The crowd is frozen mid-dance for a single impossible frame. At the center of the void, the suggestion of something vast and patient — not eyes but awareness, not a mouth but a voice shaped from pure sub-bass. The stage lights bend toward it like gravity. Psychedelic horror meets cosmic entity. Dark ultraviolet, impossible geometry in sound waves, 4K quality.",
    threeDPrompt:
      'Abstract dark void entity behind rave speakers, inverted light distortion, visible bass waves, frozen crowd, cosmic horror in sound, psychedelic dark entity',
  },

  // ═══════════════════════════════════════════════════════════════════════
  // PLACES
  // ═══════════════════════════════════════════════════════════════════════
  {
    name: 'NOS Event Center',
    kind: 'place',
    description:
      "The NOS Event Center in San Bernardino, California — a massive indoor/outdoor venue that hosts some of the biggest raves and EDM festivals in Southern California. On this night, it's packed with tens of thousands of people across multiple stages. The parking lot is a sea of cars and lifted trucks. Inside, the main building is a cavernous warehouse space with industrial ceilings, laser grids, and a wall of speakers that can be felt in your teeth. Outside, additional stages spread across concrete lots with temporary structures, LED towers, and art installations. The air smells like fog machine fluid, sweat, and desert dust. Bass from competing stages creates interference patterns you can feel in your sternum.",
    metadata: {
      placeType: 'Indoor/outdoor rave venue — massive multi-stage EDM festival',
      atmosphere:
        'Overwhelming sensory assault. Bass you feel in your organs. Laser grids cutting through fog. Tens of thousands of bodies moving in the dark. The smell of fog fluid and desert dust. Competing stages creating bass interference patterns. Pure controlled chaos.',
      rulesAndDangers:
        "Easy to get separated. Dead zones where phones don't work. Security is lax past the gates. The mosh pit near the main stage is violent. The outdoor areas are dark between stages.",
      inhabitants: 'Tens of thousands of ravers, DJs, security, medics, vendors',
      governingFaction: 'Insomniac Events / NOS Events (promoters)',
    },
    imagePrompt:
      'Massive rave venue at night — the NOS Event Center in San Bernardino. An enormous industrial building glowing from within with laser beams shooting through open bay doors. Outside, additional stages with LED towers and art installations spread across concrete lots. Tens of thousands of people flow between stages, lit by pulsing colored lights — magenta, cyan, ultraviolet. Fog machines create thick atmosphere. The desert sky above is purple-black. Cars and trucks pack the surrounding lots. The scale is overwhelming. Wide establishing shot, festival atmosphere, photorealistic, 4K quality.',
    threeDPrompt:
      'Massive rave venue at night, industrial building with lasers, outdoor stages with LED towers, tens of thousands of people, fog machines, festival lights, aerial view',
  },
  {
    name: 'Main Stage — The Cathedral',
    kind: 'place',
    description:
      'The indoor main stage at NOS Event Center — nicknamed "The Cathedral" by regulars because of the vaulted industrial ceiling and the religious experience of the bass. A wall of speakers 40 feet wide and 20 feet tall. LED panels behind the DJ booth display fractal patterns that sync with the beat. Laser grids cut geometric shapes through fog so thick you can barely see 30 feet ahead. The crowd here is the densest — 10,000+ packed shoulder to shoulder, a single organism moving to the drop. This is where Eric discovers his power. When his emotions surge under psilocybin, the music bends. The bass follows his heartbeat. The lasers track his gaze. The drop hits when his adrenaline spikes. And somewhere behind the wall of speakers, something ancient notices.',
    metadata: {
      placeType: 'Indoor main stage — massive speaker wall, laser grid, fog machine cathedral',
      atmosphere:
        'Transcendent and terrifying. The bass is physical — you breathe it, your vision pulses with it. Fog so thick the crowd becomes silhouettes. Lasers create impossible geometries overhead. The DJ is invisible behind the light wall. This is where sound becomes a living thing.',
      rulesAndDangers:
        "The mosh pit up front is dangerous — people get crushed and separated. The bass can disorient. Under psychedelics, the sensory overload can break reality. And on this night, the stage itself becomes responsive to one person's emotions.",
      inhabitants:
        'DJ (unseen behind LED wall), 10,000+ ravers packed dense, Eric (alone in the crowd)',
      governingFaction: "The DJ controls the music — until Eric doesn't let them",
    },
    imagePrompt:
      'The indoor main stage at a massive rave — a cathedral of sound. A wall of speakers 40 feet wide and 20 feet tall dominates the far end. Behind it, LED panels display fractal patterns synced to the beat. Laser beams — green, magenta, white — cut geometric grids through thick fog. The crowd is a dense sea of silhouettes, arms raised, moving as one organism. The vaulted industrial ceiling disappears into fog and laser light. The bass is visible as vibration in the fog. Overwhelming, transcendent, borderline religious. Shot from within the crowd looking toward the stage, immersive, 4K quality.',
    threeDPrompt:
      'Indoor rave main stage, massive speaker wall, LED fractal display, laser grid through fog, dense crowd of silhouettes, industrial cathedral, immersive angle',
  },
  {
    name: 'The Mosh Pit',
    kind: 'place',
    description:
      "The front section of the main stage crowd where the energy is most violent. Bodies crash into each other, people are lifted and thrown. It's where Eric gets separated from Mikel and Jeff. In the chaos of a bass drop, the crowd surges like a wave. Eric's phone falls from his pocket and gets stomped. Mikel reaches for him but the crowd pushes them apart. Jeff's voice is swallowed by the bass. Eric is alone in seconds — one moment shoulder-to-shoulder with his best friends, the next swallowed by a sea of strangers. The mosh pit doesn't care who you came with.",
    metadata: {
      placeType: 'Dense crowd zone — front of main stage',
      atmosphere:
        "Violent energy. Bodies colliding. Bass drops triggering crowd surges. Sweat and adrenaline. Impossible to communicate — voices don't carry. Phones die from impacts and sweat.",
      rulesAndDangers:
        "Easy to get separated instantly. Phones get destroyed. People get trampled if they fall. The crowd moves like a fluid — you can't fight the current.",
      inhabitants: 'Hundreds of ravers in close physical contact, moshing, pushing, surging',
      governingFaction: 'Nobody — pure entropy',
    },
    imagePrompt:
      "The mosh pit at the front of a massive rave stage. Bodies packed so tight they move as one surging mass. Arms reaching up, people being lifted and thrown. Sweat flying through laser beams. A phone screen cracking under someone's foot. The stage's bass speakers are a blinding wall of light ahead. Two friends reaching for each other as the crowd pulls them apart — fingertips almost touching. Chaos, energy, violence and joy mixed. Close-up immersive shot from within the pit, motion blur, 4K quality.",
    threeDPrompt:
      'Dense mosh pit crowd at rave, bodies surging, arms reaching, phone cracking underfoot, friends being separated, laser light from stage, chaotic motion',
  },
  {
    name: 'The Dark Corridor',
    kind: 'place',
    description:
      "The space between the indoor main stage and the outdoor areas at NOS Event Center. A long concrete corridor with minimal lighting — just emergency exit signs casting red glow. The bass from the main stage makes the walls vibrate. This is where Eric runs after The Frequency speaks to him. He's terrified, sweating, pupils massive, heart racing. The corridor feels endless under psilocybin — the red exit signs stretching into infinity, his own footsteps echoing wrong, the bass behind him sounding like breathing. He bursts through the doors at the end into the outdoor area and the desert air hits him like cold water.",
    metadata: {
      placeType: 'Transit corridor between indoor/outdoor venue areas',
      atmosphere:
        'Claustrophobic, bass-vibrating, red emergency lighting only. Under psychedelics it becomes a tunnel that stretches and breathes. The walls vibrate with the music behind you. Your footsteps echo wrong.',
      rulesAndDangers:
        'Disorienting under psychedelics. The bass vibration is physical. The minimal lighting creates shadow play that tricks the eye. Easy to panic here.',
      inhabitants: 'Occasional ravers walking between stages, Eric running alone',
      governingFaction: 'Venue infrastructure — uncontrolled, liminal',
    },
    imagePrompt:
      'A long concrete corridor inside a rave venue, lit only by red emergency exit signs. The walls vibrate visibly from bass on the other side. A single figure — young man in a black hoodie — runs toward camera, face showing pure terror, pupils dilated, sweat visible. The corridor behind him seems to stretch impossibly long. The red lighting creates shadow distortions on the concrete walls. Under the influence of psychedelics, the space breathes and pulses. Claustrophobic, horror-tinged, psychedelic distortion, 4K quality.',
    threeDPrompt:
      'Long concrete corridor with red emergency lighting, vibrating walls, young man running in terror, psychedelic distortion, claustrophobic rave venue passage',
  },
  {
    name: 'Outdoor Stage Area',
    kind: 'place',
    description:
      "The outdoor section of NOS Event Center — concrete lots transformed into festival grounds with secondary stages, LED art installations, food vendors, and chill zones. The desert air is cool compared to the indoor furnace. Stars are visible above the light pollution. Competing bass from multiple stages creates weird interference patterns. This is where Eric bursts out of the dark corridor and where he eventually finds Jeff and Mikel again. Jeff spots him from atop a concrete barrier he's been using as a lookout post. Mikel appears from nowhere, as he does.",
    metadata: {
      placeType: 'Outdoor festival grounds — secondary stages, art installations, vendor areas',
      atmosphere:
        'Cool desert air after the indoor heat. Multiple stages creating overlapping bass. LED art installations throwing colored shadows. More space to breathe. Stars barely visible above light pollution. The relief of open sky.',
      rulesAndDangers:
        "Easier to find people than indoors. Phone dead zones still exist. The desert cold hits hard when you're soaked in sweat from inside.",
      inhabitants:
        'Thousands of ravers between stages, vendors, art installations, Jeff standing on a barrier yelling',
      governingFaction: 'NOS Events / festival promoters',
    },
    imagePrompt:
      'Outdoor rave festival area at night in the desert — concrete lots with secondary stages, LED art installations glowing in the dark, food vendor lights. Cool desert air visible as slight fog. Multiple stages in the distance with different colored light shows creating overlapping beams. Ravers walking between stages, some sitting on concrete barriers. A shirtless muscular guy stands on top of a barrier, cupping his hands to yell. Stars barely visible above the light pollution. Open sky, relief of space after indoor chaos, 4K quality.',
    threeDPrompt:
      'Outdoor rave festival area at night, desert setting, LED art installations, multiple stages with colored lights, people walking between stages, open sky, wide shot',
  },
  {
    name: "Jeff's Truck",
    kind: 'place',
    description:
      "Jeff's lifted truck in the NOS Event Center parking lot — the ride home and the meeting point if anything goes wrong. A lifted white Tacoma with aftermarket wheels, a gym bag in the back seat, and an aux cord dangling from the stereo. The truck represents safety — the known world, the ride home, the end of the night. After the events of the pilot, Eric sits in the passenger seat staring at the dashboard while Jeff drives and Mikel is silent in the back. The bass from inside the venue is still audible, faintly, through the truck's closed windows. Eric can feel it. He can feel all of it now.",
    metadata: {
      placeType: 'Vehicle — lifted white Toyota Tacoma in venue parking lot',
      atmosphere:
        "Safety and normalcy after chaos. The truck is warm, familiar, smells like Jeff's gym bag and energy drinks. The dashboard glow is the only light. Bass from the venue still faintly audible. The ride home where nobody talks about what happened.",
      rulesAndDangers:
        "The one safe space. But Eric can still feel the bass from the venue through the truck frame. The power doesn't turn off.",
      inhabitants:
        'Jeff (driving), Eric (passenger, shattered), Mikel (back seat, watching Eric carefully)',
      governingFaction: "Jeff. It's his truck.",
    },
    imagePrompt:
      "A lifted white Toyota Tacoma in a dark parking lot, festival venue visible in the background with laser beams and LED towers. The truck's interior is lit by warm dashboard glow. Three figures inside: the driver (big muscular guy) looking straight ahead, the passenger (slim young man in black hoodie) staring blankly at the dashboard, and a figure in the back seat watching the passenger with sharp dark eyes. The venue bass is suggested by subtle vibration in the side mirrors. Safety after chaos. Night, parking lot, aftermath energy, photorealistic, 4K quality.",
    threeDPrompt:
      'Lifted white Toyota Tacoma in dark parking lot, rave venue with lasers in background, three figures inside lit by dashboard glow, aftermath mood, night scene',
  },

  // ═══════════════════════════════════════════════════════════════════════
  // LORE
  // ═══════════════════════════════════════════════════════════════════════
  {
    name: 'Sonic Entropy',
    kind: 'lore',
    description:
      'The name Eric will eventually give to his ability — though in the pilot he has no name for it, only terror. Under psilocybin, Eric can perceive music as physical architecture: bass as foundation, melody as structure, rhythm as motion. More importantly, his emotional state directly influences the output of any sound system within his proximity. Fear makes the bass drop harder. Joy makes the melody soar. Anger creates distortion. Calm creates silence. The effect is not metaphorical — it is literal, measurable, and terrifying. The DJ on the main stage noticed their set was playing itself. The crowd felt the shift as religious ecstasy. Only Eric knew it was coming from him.',
    metadata: {
      loreType: 'Supernatural ability / Psychedelic power system',
      article:
        "Sonic Entropy: The ability to manipulate sound output through emotional state. Requires psilocybin activation (possibly other psychedelics — untested). Range unknown but affects at minimum a 40-foot speaker wall and 10,000-person crowd. The mechanism is unclear — Eric doesn't touch anything. His emotions simply become the music. Whether this is telekinesis applied to air pressure, some form of frequency manipulation at the quantum level, or something non-human entirely is the central scientific mystery. The Frequency entity seems to recognize and amplify this ability.",
      relatedConcepts: 'The Frequency, psilocybin activation, emotional-sonic bridge, the Return',
      canonWeight: 'Hard Canon',
    },
    imagePrompt:
      'Abstract concept art for Sonic Entropy — the ability to control music through emotion. A young man stands at the center of a massive rave crowd, his body radiating visible sound waves in concentric rings. The waves are colored by emotion: deep red for fear, gold for joy, black distortion for anger. The speaker wall behind the stage bends toward him. The crowd moves in patterns that mirror his breathing. His eyes glow faintly. The air between him and the speakers is visible — filled with geometric patterns of sound made physical. Psychedelic, transcendent, terrifying. 4K quality.',
    threeDPrompt:
      'Abstract sound wave figure at rave, concentric emotional frequency rings, speaker wall bending, crowd moving in patterns, psychedelic sonic power visualization',
  },
  {
    name: 'The Return',
    kind: 'lore',
    description:
      'The word The Frequency used: "return." Not "arrive" or "awaken" — return. The implication is staggering: Eric has been here before. Or someone like him has. Or something inside Eric is older than Eric. The Return is the central mystery of the series — what is Eric returning to? A previous life? An ancestral connection? A role in something cosmic? The Frequency waited millennia for this moment, listening through every speaker on Earth. It recognized Eric specifically. The mushrooms didn\'t create the ability — they opened a door that was already there. The Return suggests Eric isn\'t gaining a new power. He\'s remembering one.',
    metadata: {
      loreType: 'Central mystery / Cosmic lore',
      article:
        'The Frequency said: "I have been waiting for you to return." Key implications: (1) Eric specifically was expected — not random, not any psychedelic user. (2) "Return" implies prior existence or connection. (3) "Waiting" implies patience spanning enormous time. (4) The Frequency exists inside sound and recognized Eric through his emotional manipulation of music. (5) Psilocybin may be the key that unlocks a pre-existing connection, not the source of the power itself. The Return is not a beginning. It is a continuation.',
      relatedConcepts:
        'The Frequency, Sonic Entropy, psilocybin, past lives, ancestral memory, cosmic inheritance',
      canonWeight: 'Hard Canon',
    },
    imagePrompt:
      'Abstract lore concept art for "The Return" — the idea that Eric has been here before. A spiraling timeline visualized as a helix of sound waves, each loop showing a different era: ancient drums around a fire, medieval church organs, jazz clubs, early synthesizers, and now a modern rave. At every point in the spiral, a figure stands in the same pose as Eric — arms slightly raised, head tilted back, receiving sound. The spiral converges on the present: Eric at the main stage, completing the loop. Time is a frequency. History repeats at the right resonance. Cosmic, psychedelic, mythic. 4K quality.',
    threeDPrompt:
      'Spiraling timeline helix of sound through eras, figures in same pose across history, converging on modern rave, cosmic psychedelic time spiral',
  },
  {
    name: 'Psilocybin Key',
    kind: 'lore',
    description:
      "Magic mushrooms didn't give Eric his power — they unlocked perception of something that was always there. Under psilocybin, the barriers between Eric's emotional state and physical reality become thin enough to cross. He perceives sound as architecture, feels bass as geography, and his emotions leak into the frequencies around him. Without psilocybin, Eric is normal — he can't hear The Frequency, can't move the music, can't feel the crowd as an extension of himself. The mushrooms are the key, not the lock and not the door. The question the series will explore: can Eric learn to open the door without the key? And what happens if the door stays open?",
    metadata: {
      loreType: 'Power system mechanic / Psychedelic lore',
      article:
        "Psilocybin as activation mechanism: The mushrooms dissolve the perceptual barrier between Eric's emotional state and acoustic reality. Effects observed: (1) Synesthetic perception of music as physical space. (2) Involuntary emotional projection into sound systems. (3) Ability to perceive The Frequency's voice. (4) Crowd-scale empathic resonance. Duration: tracks psilocybin trip length (~4-6 hours). Onset: ~30 minutes after ingestion. The power may be trainable without psilocybin — but that is untested and terrifying.",
      relatedConcepts:
        'Sonic Entropy, The Frequency, The Return, psychedelic activation, perceptual barrier dissolution',
      canonWeight: 'Hard Canon',
    },
    imagePrompt:
      "Concept art showing the psilocybin activation process. A close-up of a hand holding small dried mushrooms, and from the hand, reality splits — one side is normal (gray, flat, quiet) and the other side explodes with visible sound waves, geometric patterns in the air, and music rendered as glowing architecture. The split runs through a young man's face — one eye normal, one eye dilated with fractal patterns reflected in it. The door between perception and power. Split-reality composition, psychedelic realism, 4K quality.",
    threeDPrompt:
      'Split reality concept, hand with mushrooms, one side normal one side psychedelic sound architecture, face split between normal and awakened, psychedelic realism',
  },

  // ═══════════════════════════════════════════════════════════════════════
  // EVENTS
  // ═══════════════════════════════════════════════════════════════════════
  {
    name: 'The Separation',
    kind: 'event',
    description:
      "The moment Eric gets separated from Mikel and Jeff in the mosh pit at the main stage. A massive bass drop triggers a crowd surge. Eric's phone falls from his pocket and is immediately stomped by a dozen feet. Mikel reaches for Eric's arm but the crowd pushes them apart — their fingers miss by inches. Jeff's voice is swallowed by the wall of bass. In three seconds, Eric goes from being with his best friends to being utterly alone in a crowd of 10,000 strangers. His phone is dead. He can't find the exit. The mushrooms are hitting harder. He's alone.",
    metadata: {
      era: 'Pilot episode — 30 minutes after arriving at the main stage',
      participants: 'Eric, Mikel, Jeff, 10,000 strangers',
      location: 'The Mosh Pit, Main Stage, NOS Event Center',
      causes:
        "Massive bass drop triggers crowd surge. Eric's phone falls and is destroyed. Crowd fluid dynamics push the three friends apart.",
      outcome:
        'Eric is alone in the crowd with no phone, mushrooms intensifying, friends unreachable. This isolation is what allows The Awakening to happen.',
      canonStatus: 'Canon',
    },
    imagePrompt:
      'Two friends reaching for each other in a dense rave mosh pit — their fingertips inches apart as the crowd surges between them. One is a slim young man in a black hoodie (Eric), face panicked. The other is a lean figure in all-black techwear (Mikel), face intense with concern. A phone screen cracks under feet between them. The crowd is a blur of bodies and sweat. Stage lights strobe. The moment of separation. Dramatic, emotional, chaotic, motion blur, 4K quality.',
    threeDPrompt:
      'Two friends reaching across mosh pit crowd, fingertips missing, phone cracking under feet, stage lights strobing, separation moment, dramatic rave scene',
  },
  {
    name: 'The Awakening',
    kind: 'event',
    description:
      'Alone in the crowd, mushrooms at peak intensity, Eric feels the music change. Or rather — he feels himself change the music. His heartbeat syncs with the bass. When he feels afraid, the drops hit harder. When a moment of wonder crosses his mind, the melody lifts. He raises his hand and the crowd around him raises theirs. He breathes out and the fog machines pulse. He is the music. The music is him. For sixty transcendent, terrifying seconds, Eric controls the entire main stage through his emotions. The DJ is confused — their set is playing itself. The crowd is ecstatic — they feel the shift as divine. Then The Frequency speaks: "I have been waiting for you to return." And the transcendence becomes terror.',
    metadata: {
      era: 'Pilot episode — Peak of the night, approximately 1:30 AM',
      participants: 'Eric, The Frequency, the DJ (unknowing), 10,000 ravers (unknowing)',
      location: 'Main Stage — The Cathedral, NOS Event Center',
      causes:
        "Psilocybin peak + emotional isolation + the specific acoustics and crowd energy of the main stage + Eric's latent ability",
      outcome:
        'Eric discovers Sonic Entropy. The Frequency makes first contact. Eric panics and flees the stage. The door is now open.',
      canonStatus: 'Canon',
    },
    imagePrompt:
      'A transcendent moment at a massive rave. A young man in a black hoodie stands in a dense crowd, eyes closed, head tilted back, arms slightly raised. Visible sound waves emanate from his body in concentric rings, matching the colors of the stage lights. The crowd around him has their arms raised in perfect sync with his breathing. The fog machines pulse with his exhale. The laser grid overhead bends toward him. Behind the speaker wall, in the LED panels, a dark void is forming — something watching from inside the sound. Transcendent, psychedelic, terrifying, beautiful. The moment a human becomes something else. 4K quality.',
    threeDPrompt:
      'Young man with closed eyes in rave crowd, visible sound waves from body, crowd synced to his movement, lasers bending toward him, dark void in speakers, transcendent psychedelic moment',
  },
  {
    name: 'The Flight',
    kind: 'event',
    description:
      "The moment Eric breaks and runs. The Frequency's voice — deep, ancient, felt in his bones — says \"I have been waiting for you to return\" and Eric's transcendence shatters into pure animal fear. He shoves through the crowd, the music distorting behind him as his panic feeds back — bass grinding, melody collapsing into dissonance. He sprints through the dark corridor, red emergency lights stretching into infinity under psilocybin, and bursts into the outdoor area. Shaking, drenched in sweat, alone, phone dead. He can't find Jeff or Mikel anywhere.",
    metadata: {
      era: 'Pilot episode — Immediately after The Awakening, approximately 1:32 AM',
      participants: 'Eric alone',
      location: 'Main Stage → Dark Corridor → Outdoor Stage Area, NOS Event Center',
      causes: 'The Frequency speaks. Eric panics. Flight response overrides everything.',
      outcome:
        'Eric escapes the stage. Music distorts behind him. He is alone outside with no phone and no way to find his friends. Vulnerable to strangers.',
      canonStatus: 'Canon',
    },
    imagePrompt:
      'A young man in a black hoodie sprinting through a dark concrete corridor lit only by red emergency exit signs. His face shows pure terror — dilated pupils, sweat, mouth open. Behind him, the corridor stretches impossibly long (psychedelic distortion). The walls vibrate with distorted bass. Ahead, the exit doors glow with cool outdoor light. He is running from something that has no body, only sound. Horror-tinged psychedelic, motion blur, claustrophobic, 4K quality.',
    threeDPrompt:
      'Young man sprinting through red-lit concrete corridor, terror on face, corridor stretching psychedelically, vibrating walls, exit doors glowing ahead, horror rave escape',
  },

  // ═══════════════════════════════════════════════════════════════════════
  // AFTERPARTY ARC — New Characters & Locations
  // ═══════════════════════════════════════════════════════════════════════
  {
    name: 'Dante',
    kind: 'person',
    description:
      "One of two strangers Eric meets outside the venue after fleeing the stage. Dante is charismatic, late 20s, talks fast, seems friendly. He and his friend Marcus invite the clearly shaken Eric to their hotel afterparty nearby — just chill vibes, decompression, no pressure. Dante seems like a normal raver at first. But at the hotel, when he thinks Eric isn't listening, Dante starts talking to Marcus about the demon summoning symbols that are being placed around the rave — sigils hidden in the stage art, in the LED patterns, in the layout of the venue itself. He says it's getting more obvious every event and can't believe no one notices. He speaks about it casually, like discussing logistics — not with fear but with familiarity.",
    metadata: {
      role: 'Mysterious stranger / Occult insider',
      appearance:
        "Late 20s male, Mediterranean or mixed features, dark curly hair, stubble. Wears a loose linen shirt over dark pants — too dressed-up for a rave, like he came from somewhere else. Silver chain necklace with a pendant Eric can't quite make out. Tattoo on his inner forearm — geometric, looks like it could be decorative or could be a sigil. Charismatic smile that doesn't reach his eyes.",
      motivations:
        'Unknown. Why did he invite Eric specifically? Coincidence or something else? He and Marcus seem to know about the occult activity at raves and are not afraid of it.',
      abilities:
        'Social manipulation — makes Eric feel safe quickly. Knowledge of occult symbols and ritual placement at mass events.',
      homePlace: 'Unknown — has a hotel room near NOS Event Center',
      affiliations:
        'Marcus (close associate). Possible connection to whoever is placing the demon summoning symbols.',
    },
    imagePrompt:
      'Character portrait of Dante, a charismatic man in his late 20s. Mediterranean or mixed features, dark curly hair, stubble. Wearing a loose white linen shirt over dark pants — slightly too polished for a rave. Silver chain necklace with an ambiguous pendant. Geometric tattoo on his inner forearm that could be decorative or occult. He stands in the doorway of a hotel room, warm light behind him, extending a hand in invitation. His smile is warm but his eyes are calculating. Hotel corridor lighting, rave afterparty atmosphere, photorealistic, 4K quality.',
    threeDPrompt:
      'Charismatic man late 20s, dark curly hair, linen shirt, silver pendant, geometric forearm tattoo, standing in hotel doorway, inviting gesture, calculating eyes',
  },
  {
    name: 'Marcus',
    kind: 'person',
    description:
      'Dante\'s associate — quieter, more observant, sits in the corner of the hotel room watching. Marcus is the one Dante is talking to about the demon summoning symbols when they think Eric is in the bathroom or not paying attention. Marcus is concerned — not about the symbols existing, but about them becoming too obvious. "They\'re getting sloppy," he says. "Someone\'s going to notice." He glances toward Eric when he says it. Marcus is bigger than Dante, shaved head, dark skin, wears all black. He has the energy of security detail — watchful, still, positioned to block the exit without appearing to.',
    metadata: {
      role: 'Mysterious stranger / Occult insider — the watcher',
      appearance:
        'Late 20s or early 30s male, dark skin, shaved head, built like security. All black clothing — plain black tee, black jeans, black boots. No jewelry except a ring with a symbol on it. Sits in corners. Watches the room. Positioned near exits without appearing to block them.',
      motivations:
        'Concerned about operational security of the symbol placement. Watchful of Eric. Defers to Dante socially but may outrank him in whatever organization they serve.',
      abilities:
        'Spatial awareness — always positioned tactically. Observant — notices Eric listening before Dante does. Physical presence — intimidating without trying.',
      homePlace: 'Unknown — shares hotel room with Dante',
      affiliations:
        'Dante (close associate). Connected to the demon summoning symbol network at raves.',
    },
    imagePrompt:
      'Character portrait of Marcus, a watchful man in his late 20s or early 30s. Dark skin, shaved head, built like security. Plain black t-shirt stretched over a muscular frame, black jeans, black boots. A ring with a subtle symbol on his right hand. He sits in the corner of a hotel room, back to the wall, positioned to see the door. His expression is still, observant, not hostile but not warm. The hotel room behind him is dimly lit — cheap bedside lamp, afterparty detritus. Watchful energy, all-black aesthetic, photorealistic, 4K quality.',
    threeDPrompt:
      'Watchful muscular man, shaved head, dark skin, all black outfit, symbolic ring, sitting in hotel room corner, back to wall, tactical positioning, observant expression',
  },
  {
    name: 'The Hotel Room',
    kind: 'place',
    description:
      "A cheap hotel room near the NOS Event Center — the kind that gets booked for rave afterparties. Two queen beds, thin curtains that don't fully block the parking lot lights. A bedside lamp casting warm yellow light. Bass from the venue still faintly audible through the walls. Dante and Marcus have set up minimal afterparty vibes — a bluetooth speaker playing low ambient music, some water bottles, a couple of vape pens. It feels safe at first. Then Eric, coming down from his peak, sitting on the edge of a bed trying to collect himself, overhears Dante and Marcus talking quietly near the bathroom about the demon summoning symbols hidden in the rave's stage art and venue layout. They speak about it like professionals discussing a project. Eric acts like he didn't hear, makes an excuse, and leaves.",
    metadata: {
      placeType: 'Cheap hotel room — rave afterparty',
      atmosphere:
        "Initially safe and decompressive — warm lamp light, quiet music, the relief of a small room after the sensory assault of the rave. Then slowly unsettling as Eric overhears the conversation. The thin walls let the venue bass through. The parking lot light through the curtains creates shadows that move wrong when you're still on mushrooms.",
      rulesAndDangers:
        "Eric is alone with two strangers. His phone is dead. He doesn't know where his friends are. He just heard something he wasn't supposed to. The only exit requires passing Marcus.",
      inhabitants: 'Dante (host), Marcus (watcher), Eric (guest who overhears too much)',
      governingFaction: 'Dante and Marcus — their space, their rules',
    },
    imagePrompt:
      'A cheap hotel room near a rave venue. Two queen beds with generic bedspreads, thin curtains letting in parking lot light. A warm bedside lamp is the main light source. A small bluetooth speaker plays ambient music on the nightstand. Water bottles and vape pens scattered. One young man in a black hoodie sits on the bed edge, staring at the floor, clearly shaken and trying to act normal. Near the bathroom door, two other men talk quietly — one in a linen shirt, one in all black. The faint bass of the distant rave vibrates the thin walls. The room feels safe on the surface but something is wrong underneath. Intimate, tense, afterparty atmosphere, 4K quality.',
    threeDPrompt:
      'Cheap hotel room, warm lamp light, young man on bed edge looking down, two men talking quietly near bathroom, bluetooth speaker, thin curtains with parking lot light, tense afterparty',
  },
  {
    name: 'The Overheard',
    kind: 'event',
    description:
      'At the hotel afterparty, Eric sits on the bed trying to process what happened at the stage. The mushrooms are fading. He\'s exhausted and scared. Dante and Marcus are near the bathroom, speaking quietly, assuming Eric is zoned out or coming down too hard to pay attention. Eric hears Dante say: "Did you see the new ones near the south stage? They\'re not even trying to hide it anymore." Marcus responds: "Demon summoning sigils in the LED panel art. In the stage geometry. In the venue floor plan itself. It\'s getting obvious. Someone is going to notice." Dante shrugs: "Nobody notices. Nobody ever does." Eric\'s blood goes cold. He keeps his face blank — years of being the quiet kid pays off now. He acts groggy, says he needs air, thanks them for the hangout, and walks out. He doesn\'t run. Running would tell them he heard. He walks to the parking lot and keeps walking until he finds the outdoor stage area, and that\'s where Jeff finally spots him.',
    metadata: {
      era: 'Pilot episode — approximately 3:00 AM, hotel room near NOS Event Center',
      participants: 'Eric (overhearing), Dante (speaking), Marcus (responding)',
      location: 'Cheap hotel room near NOS Event Center',
      causes:
        'Dante and Marcus assume Eric is too intoxicated to notice their conversation about occult infrastructure at raves.',
      outcome:
        'Eric learns that demon summoning symbols are deliberately placed in rave stage art, LED patterns, and venue layouts. He keeps a poker face and leaves without revealing he heard. This connects to The Frequency — is the alien voice connected to the occult activity, or is it something else entirely?',
      canonStatus: 'Canon',
    },
    imagePrompt:
      "A tense moment in a dim hotel room. A young man in a black hoodie sits on a bed, face carefully blank, eyes looking down — but he is listening. In the background, two men lean against the bathroom doorframe talking quietly, one gesturing with his hands. The composition shows Eric in focus in the foreground with the two men blurred but visible behind him. He is hearing something he shouldn't. The warm lamp light contrasts with the cold realization on his face. Psychological tension, eavesdropping scene, intimate thriller framing, 4K quality.",
    threeDPrompt:
      'Young man sitting on hotel bed pretending not to listen, two men talking in background near bathroom, tense eavesdropping scene, warm lamp light, psychological thriller',
  },
  {
    name: 'The Reunion',
    kind: 'event',
    description:
      "Eric walks out of the hotel and back toward the NOS Event Center parking area. The mushrooms are mostly faded now — just residual visual shimmer and heightened awareness. He's carrying three impossible things: the power he felt at the stage, the alien voice that called him by destiny, and the secret conversation about demon symbols at raves. He's alone in a dark parking lot when he hears the most beautiful sound of the night — Jeff's voice bellowing \"BRO! ERIC! OVER HERE!\" from the top of a concrete barrier. Jeff has been looking for him for hours. Mikel appears from the shadows seconds later, eyes sharp, studying Eric's face with an intensity that suggests he senses something changed. They pile into Jeff's truck. Nobody talks on the ride home. Bass from the venue is still faintly audible through the closed windows. Eric can feel it in his chest. He can feel all of it now.",
    metadata: {
      era: 'Pilot episode — approximately 3:30 AM, NOS Event Center parking area',
      participants: 'Eric, Jeff, Mikel',
      location: "NOS Event Center parking area → Jeff's Truck",
      causes:
        "Jeff has been searching for Eric for hours (climbing barriers, yelling). Mikel has been searching more quietly, using senses Eric doesn't know about.",
      outcome:
        "The three friends reunite. The night ends in silence in Jeff's truck. Eric carries three secrets he can't share. Mikel senses the change. Jeff is just glad everyone is alive. The pilot ends with Eric in the passenger seat, staring at the dashboard, still feeling the bass through the truck frame.",
      canonStatus: 'Canon',
    },
    imagePrompt:
      'A parking lot at night near a rave venue. A big shirtless muscular guy stands on top of a concrete barrier, arms cupped around his mouth, yelling. Below him, a slim young man in a black hoodie walks toward him from the darkness, face showing exhaustion and overwhelming relief. A third figure — lean, all-black techwear — emerges from the shadows nearby, watching the reunion with sharp concerned eyes. Festival lights glow in the far background. The moment of reunion after the worst and most important night of their lives. Emotional, warm lighting cutting through the dark, 4K quality.',
    threeDPrompt:
      'Parking lot reunion, big shirtless guy yelling from barrier, slim hoodie guy approaching with relief, dark-clothed figure emerging from shadows, festival lights in background, emotional night scene',
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
