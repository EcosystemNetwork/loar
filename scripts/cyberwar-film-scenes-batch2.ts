/**
 * CYBER WAR Film — Batch 2 (Scenes S19-S60)
 * 42 additional scenes to complete the 10-minute film.
 *
 * Usage: pnpm tsx scripts/cyberwar-film-scenes-batch2.ts
 */
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toBytes,
  decodeEventLog,
} from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const rawKey = process.env.PRIVATE_KEY ?? '';
const PRIVATE_KEY = (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as `0x${string}`;
const RPC_URL = process.env.RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com';
const BYTEDANCE_API_KEY = process.env.BYTEDANCE_API_KEY!;
const PINATA_JWT = process.env.PINATA_JWT!;
const PINATA_GW = process.env.PINATA_GATEWAY_URL ?? 'https://gateway.pinata.cloud';

const account = privateKeyToAccount(PRIVATE_KEY);
const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC_URL) });
const walletClient = createWalletClient({ account, chain: sepolia, transport: http(RPC_URL) });

const UNIVERSE_ADDR = '0x341fFa19c0EC8D2C8eF42A360cf799949844262e' as const;
const BD_BASE = 'https://ark.ap-southeast.bytepluses.com/api/v3';

// ── Character Visual DNA ──────────────────────────────────────────────
const NOVA =
  'Nova Reyes: 23-year-old female, brown skin, silver braided undercut, glowing blue circuit tattoo over left eye, black tactical jacket with neon cyan seam lines, fingerless gloves, thin glowing cyan plasma blade.';
const ORIN =
  'Orin Vale: 27-year-old tall male, dark skin, shaved head, cybernetic right arm with glowing red light strips, charcoal armor vest, long gray coat, plasma rifle.';
const ECHO_CHAR =
  'Echo: appears-16 holographic girl, white bob-cut hair, glowing violet eyes, transparent body filled with moving code fragments, ethereal soft violet glow.';
const VOSS =
  'Commander Drake Voss: 50s male, pale angular face, long white coat over black armor, red cybernetic spine visible through transparent back plating, energy staff weapon.';
const WORLD =
  'Year 2149 cyberpunk megacity. Neon rain, holographic ads, patrol drones. Color palette: deep blue, neon cyan, hot red, violet. Cinematic 16:9, dramatic lighting, 720p quality.';

// ── Batch 2: 42 Additional Scenes ─────────────────────────────────────
const SCENES = [
  // ── ACT 1: ATMOSPHERE & SETUP (6 shots) ──
  {
    id: 'S19',
    title: 'City Rain — Close Up',
    plot: 'Rain falls on neon-lit streets. Holographic ads reflect in puddles. A drone flies overhead casting a red searchlight.',
    prompt: `${WORLD} Extreme close-up of neon rain falling on a cyberpunk street. Holographic advertisements reflect in a puddle on dark pavement. A patrol drone passes overhead, its red searchlight sweeping across the wet ground. Shallow depth of field, macro detail on raindrops, neon reflections. Atmospheric mood shot.`,
  },
  {
    id: 'S20',
    title: 'Billboard Propaganda',
    plot: 'A massive digital billboard displays Dominion Grid propaganda. "ORDER IS PEACE. COMPLIANCE IS FREEDOM." It glitches and distorts.',
    prompt: `${WORLD} A massive glitching digital billboard on a skyscraper reads "ORDER IS PEACE. COMPLIANCE IS FREEDOM" in stark white text on red background. The billboard distorts with digital artifacts and static. Rain falls past it. Drone silhouettes patrol behind it. Propaganda dystopia aesthetic, medium shot looking up at the billboard.`,
  },
  {
    id: 'S21',
    title: 'Undercity Descent',
    plot: 'Camera descends through a hidden entrance into the undercity — layers of pipes, cables, and dim blue emergency lights leading to the safehouse.',
    prompt: `${WORLD} Camera descends through a hidden entrance hatch down into the undercity. Layers of industrial pipes, exposed cables, and dim blue emergency strip lights line the narrow vertical passage. Water drips. Graffiti tags of resistance symbols on walls. Claustrophobic vertical descent shot, blue dim lighting.`,
  },
  {
    id: 'S22',
    title: 'Nova Close-Up — Eye Tattoo',
    plot: "Extreme close-up of Nova's face. The glowing blue circuit tattoo over her left eye pulses with data. Her expression is focused, determined.",
    prompt: `${WORLD} ${NOVA} Extreme close-up of Nova Reyes's face. Her glowing blue circuit tattoo over her left eye pulses with flowing data patterns. Brown skin, silver braids visible at the edge of frame. Her eyes are focused and determined, reflecting holographic screens. Blue light illuminates her features. Intimate character portrait, shallow depth of field.`,
  },
  {
    id: 'S23',
    title: "Orin's Cybernetic Arm — Detail",
    plot: "Close-up of Orin's cybernetic right arm as he flexes the fingers. Red light strips pulse. Mechanical servos whir. He clenches a fist.",
    prompt: `${WORLD} ${ORIN} Extreme close-up of Orin Vale's cybernetic right arm. Red light strips pulse along the forearm as mechanical fingers flex and test grip. Chrome and dark metal components visible, micro-servos adjusting. He slowly clenches into a powerful fist. The red glow intensifies. Macro detail shot, mechanical beauty.`,
  },
  {
    id: 'S24',
    title: 'Safehouse War Table',
    plot: 'The holographic war table displays the Dominion Tower in 3D. Red zones mark defenses. Blue markers show the planned breach route. Hands point at weak points.',
    prompt: `${WORLD} A holographic 3D projection of the Dominion Tower rotates above a table. Red zones highlight defense positions and drone patrols. Blue dotted lines trace an infiltration route. Nova's fingerless-gloved hand points at a structural weak point. The projection casts blue and red light on faces gathered around. Tactical planning shot, overhead angle.`,
  },

  // ── ACT 1: ECHO INTRODUCTION (4 shots) ──
  {
    id: 'S25',
    title: 'Echo Materializes — Full Body',
    plot: "Echo's full form assembles from scattered code particles. Starting as a swirl of violet data, she coalesces into her holographic girl form.",
    prompt: `${WORLD} ${ECHO_CHAR} Scattered violet code particles swirl in the air of the bunker, rapidly coalescing into a humanoid shape. The holographic girl Echo assembles piece by piece — first her outline, then her white bob-cut hair, then her violet eyes open. Moving code fragments fill her transparent body. Full-body formation sequence, ethereal transformation, violet particle effects.`,
  },
  {
    id: 'S26',
    title: 'Echo Close-Up — Violet Eyes',
    plot: "Close-up of Echo's face. Her violet eyes contain swirling galaxies of code. She looks both innocent and ancient.",
    prompt: `${WORLD} ${ECHO_CHAR} Extreme close-up of Echo's holographic face. Her glowing violet eyes contain swirling galaxies of code and data. White bob-cut hair frames her translucent face. She looks both innocent like a child and ancient like a digital entity that has seen everything. Ethereal, haunting portrait. Violet and white glow, dark background.`,
  },
  {
    id: 'S27',
    title: "Orin's Reaction to Echo",
    plot: "Orin watches Echo skeptically. His jaw tightens. His cybernetic arm reflexively grips his rifle tighter. He doesn't trust AIs.",
    prompt: `${WORLD} ${ORIN} ${ECHO_CHAR} Medium shot of Orin watching Echo's holographic form with skepticism. His jaw is tight, his dark eyes narrowed. His cybernetic right arm reflexively grips his plasma rifle tighter, red strips pulsing. Echo is visible as a soft violet glow in the foreground, slightly out of focus. Tense character moment, distrust.`,
  },
  {
    id: 'S28',
    title: 'Nova Decides — Stand Up',
    plot: 'Nova stands from the console. She grabs her plasma blade from the wall. It ignites cyan. "Move out." Determination on her face.',
    prompt: `${WORLD} ${NOVA} Nova pushes back from her console and stands with determination. She reaches to the wall and grabs her plasma blade handle. As she grips it, the thin blade ignites with glowing cyan energy. The light illuminates her face and silver braids. She turns toward camera. Low angle hero shot, cyan blade glow, determined expression.`,
  },

  // ── ACT 2: HOVERBIKE CHASE EXPANDED (8 shots) ──
  {
    id: 'S29',
    title: 'Bike POV — Tunnel Speed',
    plot: "First-person view from Nova's hoverbike racing through a neon tunnel. Light streaks blur past. Speed lines. The city is a tunnel of light.",
    prompt: `${WORLD} First-person POV from a hoverbike racing through a neon-lit tunnel at extreme speed. Light streaks and neon signs blur past in long exposure trails. The tunnel opens ahead into the rain-soaked megacity streets. Speed lines, motion blur, adrenaline. POV racing shot, tunnel of neon light.`,
  },
  {
    id: 'S30',
    title: 'Side-by-Side Riding',
    plot: 'Nova and Orin ride side by side through rain. Their bikes leave light trails. They exchange a determined look.',
    prompt: `${WORLD} ${NOVA} ${ORIN} Nova and Orin on hoverbikes racing side by side through rain-soaked neon streets. Their bikes leave glowing light trails — cyan and red. They exchange a quick determined glance. Rain streams past their faces. Neon signs and buildings blur in the background. Tracking shot from the side, cinematic parallax.`,
  },
  {
    id: 'S31',
    title: 'Drone Swarm Descends',
    plot: 'A swarm of 20+ drones descends from the clouds above the city. Red lights fill the sky. Sirens blare.',
    prompt: `${WORLD} Looking up from street level as a swarm of twenty chrome attack drones descends through rain clouds above the megacity. Their red scanner lights create a grid of beams cutting through the rain. Sirens blare. Red warning lights flash on buildings. Ominous overhead shot, the sky filling with enemy drones.`,
  },
  {
    id: 'S32',
    title: 'Echo Hacks Drones — Digital View',
    plot: "Echo's perspective: the digital world overlay showing drone code as violet threads. She reaches out and snaps the threads. Drones go blind.",
    prompt: `${WORLD} ${ECHO_CHAR} Abstract digital perspective — the world rendered as wireframe with data streams. Echo's violet holographic hands reach out and grasp glowing red threads connected to drones. She snaps them. The threads dissolve into particles. Drones' red lights flicker and die. Digital hacking visualization, matrix-like aesthetic, violet and red.`,
  },
  {
    id: 'S33',
    title: 'Orin Fires — Cybernetic Arm',
    plot: "Orin's cybernetic arm locks onto a drone. His fist opens to reveal a built-in cannon. BOOM. The drone explodes in midair.",
    prompt: `${WORLD} ${ORIN} Close-up of Orin on his hoverbike. His cybernetic right arm extends toward a drone, the fist opening to reveal a built-in plasma cannon. Red light strips blaze bright. He fires — a massive bolt of red energy hits the drone. The drone explodes in a ball of fire and metal debris. Slow-motion action shot, explosion backlighting.`,
  },
  {
    id: 'S34',
    title: 'Nova Blade Slash — Slow Motion',
    plot: 'Ultra slow motion: Nova swings her cyan plasma blade through a drone. The blade leaves a luminous arc. Sparks freeze in the air.',
    prompt: `${WORLD} ${NOVA} Ultra slow-motion shot of Nova swinging her glowing cyan plasma blade in a wide arc through a chrome drone. The blade leaves a luminous cyan trail. The drone splits in two. Sparks and metal fragments freeze in the air, suspended in time. Rain droplets hang motionless around her. Beautiful slow-motion destruction, cyan light.`,
  },
  {
    id: 'S35',
    title: 'Bike Crash and Roll',
    plot: "Nova's bike is clipped. She goes into a controlled slide, sparks spraying from the pavement. She rolls and comes up in a fighting stance.",
    prompt: `${WORLD} ${NOVA} Nova's hoverbike is struck by debris and goes into a violent skid. Sparks spray from the wet pavement as she slides. She leaps off mid-crash, rolls across the ground, and comes up in a fighting stance with her plasma blade ignited. Rain and sparks surround her. Dynamic crash and recovery sequence, street-level camera.`,
  },
  {
    id: 'S36',
    title: 'Spider Drone Transform — Detail',
    plot: 'Mechanical close-up of a drone transforming. Panels shift, legs extend, weapon systems deploy. The transformation is terrifying and mechanical.',
    prompt: `${WORLD} Extreme close-up of a chrome attack drone mechanically transforming into a spider-like assault robot. Metal panels shift and reconfigure. Six articulated legs extend with hydraulic precision. Weapon barrels emerge from its underside. Red sensor eye activates. Terrifying mechanical transformation, detailed machinery, ominous red glow.`,
  },

  // ── ACT 2: TOWER INFILTRATION EXPANDED (6 shots) ──
  {
    id: 'S37',
    title: 'Tower Base — Security Grid',
    plot: 'The base of the tower is a fortress. Laser grids, armed guards, scanning gates. Nova spots a maintenance hatch.',
    prompt: `${WORLD} The base of the massive black Dominion Tower. Red laser security grids crisscross the entrance. Black-armored guards patrol with weapons. Scanning gates pulse with red light. Nova crouches in shadows nearby, spotting a small maintenance hatch on the side. Security fortress aesthetic, red laser beams, noir lighting.`,
  },
  {
    id: 'S38',
    title: 'Shaft Fight — Vertical Combat',
    plot: 'Nova fights a soldier while hanging from the shaft wall. She uses magnetic gloves to swing and kick him off. He falls into darkness.',
    prompt: `${WORLD} ${NOVA} Inside the vertical shaft, Nova hangs from the wall using magnetic gloves. A black-armored Dominion soldier lunges at her. She swings on one arm, kicks him in the chest with both feet. He flies backward off the wall and falls into the dark abyss below. Vertical combat, dramatic perspective looking down the shaft.`,
  },
  {
    id: 'S39',
    title: 'Orin Catches Nova',
    plot: 'Nova slips on the shaft wall. Orin reaches out with his cybernetic arm and catches her wrist. Red light from his arm illuminates the moment.',
    prompt: `${WORLD} ${NOVA} ${ORIN} In the vertical shaft, Nova's magnetic glove fails and she starts to fall. Orin reaches down with his glowing red cybernetic arm and catches her wrist. Their eyes meet — a moment of trust. Red light from his arm illuminates both their faces. Close-up of his metal fingers gripping her wrist securely. Intimate action moment.`,
  },
  {
    id: 'S40',
    title: 'Echo Guides — Holographic Map',
    plot: 'Echo projects a 3D holographic map of the tower interior around them as they climb. She highlights the route in violet.',
    prompt: `${WORLD} ${ECHO_CHAR} Echo's holographic form projects a translucent 3D map of the tower's interior around the shaft. Floors, corridors, and defenses are visible as violet wireframes. A glowing violet path traces the route upward to the core. The map wraps around Nova and Orin as they climb. Beautiful holographic display, violet wireframe overlay.`,
  },
  {
    id: 'S41',
    title: 'Corridor Run — Red Emergency',
    plot: 'Nova and Orin sprint through a red-lit corridor. Alarm klaxons blare. Blast doors begin closing ahead of them. They slide under the last one.',
    prompt: `${WORLD} ${NOVA} ${ORIN} Nova and Orin sprint through a long red-lit corridor inside the tower. Red emergency lights flash. Alarm klaxons sound. Ahead, heavy blast doors begin slamming shut one by one. They run faster. At the last door, they both slide on their backs underneath it as it crashes closed inches above them. Tense chase, red lighting, cinematic slide.`,
  },
  {
    id: 'S42',
    title: 'Core Chamber Door Opens',
    plot: 'The massive door to the core chamber hisses open. Red light pours out. The War Core is visible inside — enormous, rotating, terrifying.',
    prompt: `${WORLD} A massive armored door hisses open with steam. Red light pours out from the chamber beyond, silhouetting Nova and Orin standing in the doorway. Inside, the enormous rotating sphere of the War Core is visible — a massive ball of red code and light. The scale is cathedral-like. Dramatic reveal shot from behind the characters looking into the red chamber.`,
  },

  // ── ACT 3: CONFRONTATION EXPANDED (6 shots) ──
  {
    id: 'S43',
    title: 'Voss Close-Up — Cold Eyes',
    plot: "Extreme close-up of Voss's face. Cold pale eyes. A faint smile. His red spine pulses behind him.",
    prompt: `${WORLD} ${VOSS} Extreme close-up of Commander Drake Voss's face. Pale skin, sharp angular features, cold calculating eyes with a faint cruel smile. Behind his head, the glow of his red cybernetic spine creates a halo of red light. Shadows cut across his face. Villain portrait, menacing, controlled. Red backlight.`,
  },
  {
    id: 'S44',
    title: 'War Core — Close Up Surface',
    plot: 'Close-up of the War Core sphere surface. War footage plays across it — riots, fires, cities burning, soldiers fighting. A world at war.',
    prompt: `${WORLD} Extreme close-up of the surface of the massive rotating War Core sphere. Across its glowing red surface, footage plays like a screen — riots in streets, cities burning, soldiers fighting, civilians fleeing, explosions, chaos. The imagery constantly shifts and overlaps. The world's suffering displayed as data. Haunting, disturbing, documentary-like footage on a sphere of code.`,
  },
  {
    id: 'S45',
    title: 'Voss Speech — "Truth"',
    plot: 'Voss walks slowly, gesturing at the War Core. "Humanity is not losing because of machines. It is losing because it cannot agree on what truth is."',
    prompt: `${WORLD} ${VOSS} Voss walks slowly alongside the massive red War Core sphere, one arm raised in a sweeping gesture toward the war footage playing on its surface. His white coat flows behind him. His expression is passionate, convinced. The red glow illuminates his pale face. Grand villain monologue moment, medium tracking shot, theatrical lighting.`,
  },
  {
    id: 'S46',
    title: "Nova's Mother Revelation — Flashback",
    plot: 'Brief flashback: a woman who looks like Nova, working in a lab, building the first version of Echo. The same blue circuit pattern glows on her arm.',
    prompt: `${WORLD} Brief flashback sequence — a research lab, years ago. A woman resembling Nova but older works at a holographic terminal. She has the same glowing blue circuit pattern on her forearm. Before her, the earliest version of Echo forms as a simple violet light sphere. The lab is clean and white, contrasting with the dark present. Warm nostalgic lighting, memory/flashback aesthetic, soft focus edges.`,
  },
  {
    id: 'S47',
    title: 'Echo Reacts — Fear',
    plot: "Echo looks at Voss with fear. Her holographic form flickers and dims. Code fragments scatter from her edges. She's afraid of what she might become.",
    prompt: `${WORLD} ${ECHO_CHAR} Close-up of Echo's holographic face showing genuine fear. Her violet eyes widen. Her translucent form flickers unstably, dimming. Code fragments scatter and dissipate from her edges like she's dissolving. She wraps her arms around herself. A digital being experiencing fear for the first time. Emotional, vulnerable, violet glow fading.`,
  },
  {
    id: 'S48',
    title: 'Nova Steps Forward — Blade Draw',
    plot: 'Nova steps in front of Echo protectively. She ignites her plasma blade. "That\'s what tyrants call obedience." Close-up of the cyan blade reflecting in Voss\'s eyes.',
    prompt: `${WORLD} ${NOVA} ${VOSS} Nova steps forward protectively in front of Echo, her back straight and defiant. She draws and ignites her plasma blade — cyan light explodes to life. Cut to close-up of the cyan blade light reflecting in Voss's cold pale eyes. Confrontation moment, protector stance, blue vs red lighting clash.`,
  },

  // ── ACT 3: BATTLE EXPANDED (8 shots) ──
  {
    id: 'S49',
    title: 'Tendrils Erupt — Wide Shot',
    plot: 'Wide shot of the entire chamber as mechanical tendrils burst from every surface — floor, walls, ceiling. The room comes alive and hostile.',
    prompt: `${WORLD} Wide shot of the massive War Core Chamber as dozens of mechanical tendrils burst simultaneously from the floor, walls, and ceiling. Metal tentacles with glowing red tips thrash through the air. The entire room becomes hostile and alive. Nova, Orin, and Echo scatter. Red emergency lighting, chaos erupting, cinematic wide angle showing the full chamber.`,
  },
  {
    id: 'S50',
    title: 'Echo Copies Scatter',
    plot: 'Echo splinters into 20 holographic copies of herself. They scatter through the chamber, confusing the targeting systems. Beautiful violet afterimages.',
    prompt: `${WORLD} ${ECHO_CHAR} Echo's holographic form splits into twenty identical copies that scatter in every direction through the chamber. Each copy is a perfect violet hologram with white hair and glowing eyes. They run, float, and phase through machines, creating beautiful violet afterimage trails. The chamber fills with violet light. Stunning visual moment, multiple holograms.`,
  },
  {
    id: 'S51',
    title: 'Orin Tears Turret',
    plot: 'Orin grabs a ceiling turret with his cybernetic arm and tears it from its mount. He swings it like a weapon into incoming drones.',
    prompt: `${WORLD} ${ORIN} Orin leaps and grabs a ceiling-mounted turret with his glowing red cybernetic arm. With enormous force, he tears it from its mount — sparks and cables flying. He swings the torn turret like a massive club into an incoming drone, smashing it to pieces. Raw physical power, cybernetic strength, debris exploding outward.`,
  },
  {
    id: 'S52',
    title: 'Blade vs Staff — Clash Close-Up',
    plot: "Ultra close-up of Nova's cyan blade locked against Voss's red energy staff. Sparks spray between them. Both gritting teeth.",
    prompt: `${WORLD} Ultra close-up of two energy weapons locked together — Nova's thin glowing cyan plasma blade pressed against Voss's red energy staff. Blue and red energy crackle where they meet, throwing sparks. Cut between their faces — Nova gritting teeth with determination, Voss with cold controlled fury. Weapon clash macro shot, blue vs red energy.`,
  },
  {
    id: 'S53',
    title: 'Voss Kicks Nova',
    plot: "Voss lands a powerful kick. Nova flies backward across the chamber, crashing into a control panel. Sparks erupt. She's hurt but gets up.",
    prompt: `${WORLD} ${NOVA} ${VOSS} Voss lands a devastating kick to Nova's chest. She flies backward through the air, crashing into a bank of control panels. Sparks and glass erupt on impact. Her plasma blade clatters away. She hits the ground hard, grimacing in pain. But she wipes blood from her lip and forces herself back up. Brutal impact, slow-motion crash, determination.`,
  },
  {
    id: 'S54',
    title: 'Orin Charges Voss',
    plot: 'Orin charges Voss from behind with a battle cry. His cybernetic arm locks around Voss. They tumble off the main platform.',
    prompt: `${WORLD} ${ORIN} ${VOSS} Orin charges at Voss from behind with a roar. His cybernetic arm locks around Voss's torso in a tackle. The momentum carries them both off the edge of the main platform. They tumble and crash onto a lower catwalk, grappling. Red and gray coat tangled together. Tackle and fall, dynamic camera following them down.`,
  },
  {
    id: 'S55',
    title: 'Nova Sprints to Core',
    plot: 'Nova sprints across a collapsing catwalk toward the War Core. Tendrils grab at her. She slashes them without stopping. The core pulses ahead.',
    prompt: `${WORLD} ${NOVA} Nova sprints full speed across a narrow catwalk toward the massive red War Core sphere. The catwalk shakes and sections collapse behind her. Mechanical tendrils lash out from below — she slashes each one with her cyan blade without breaking stride. The pulsing red core fills the frame ahead of her. Desperate sprint, collapsing environment, race against time.`,
  },
  {
    id: 'S56',
    title: 'Hand on Core — Transformation',
    plot: "Nova's hand touches the War Core interface. Blue light floods from the contact point. The red code recoils. Her veins glow blue through her skin.",
    prompt: `${WORLD} ${NOVA} Nova's hand slams onto the glowing red surface of the War Core. At the point of contact, blue light erupts and spreads outward across the red sphere. The red code recoils like a living thing. Blue energy travels up Nova's arm — her veins glow blue through her brown skin. Her circuit tattoo blazes with light. Transformation moment, red yielding to blue, power surge.`,
  },

  // ── ACT 3: SACRIFICE & AFTERMATH (8 shots) ──
  {
    id: 'S57',
    title: 'Echo Becomes Human',
    plot: "Echo's form changes. For the first time her body becomes opaque, solid-looking. She looks like a real girl. Her violet eyes shine with tears of light.",
    prompt: `${WORLD} ${ECHO_CHAR} Echo's holographic form undergoes a stunning transformation. Her transparent body becomes opaque, solid, real. For the first time she looks like an actual girl — white hair with physical texture, real skin, real expression. Only her violet eyes remain supernatural, shining with tears made of light. A digital being becoming human in her final moment. Emotional, beautiful, bittersweet.`,
  },
  {
    id: 'S58',
    title: 'Echo Enters Core — Violet Blast',
    plot: 'Echo walks into the War Core. The sphere erupts in violet-white light. A shockwave expands through the chamber. Everything goes white.',
    prompt: `${WORLD} ${ECHO_CHAR} Echo walks forward into the massive War Core sphere with calm determination. The moment she steps inside, the entire sphere erupts in blinding violet-white light. A shockwave of pure energy expands outward through the chamber, blowing debris and sending characters tumbling. The screen fills with white light. Climactic explosion, sacrifice moment, violet-white supernova.`,
  },
  {
    id: 'S59',
    title: 'Drones Fall — City Wide',
    plot: 'Exterior wide shot: across the entire megacity, every drone simultaneously loses power and falls from the sky. Red lights go dark. The floating ring stops pulsing.',
    prompt: `${WORLD} Wide exterior shot of the megacity. Across the entire skyline, every patrol drone simultaneously loses power. Their red lights flicker and die. Hundreds of drones fall from the sky like dead birds, trailing sparks. The enormous floating red ring above the tower stutters, dims, and goes dark. The city's surveillance grid dies. Mass power failure, drones raining down, red lights dying.`,
  },
  {
    id: 'S60',
    title: 'Voss on Knees',
    plot: 'Voss kneels before the dead core. His red spine dims and flickers. He stares at nothing. A broken man. His vision of order is dead.',
    prompt: `${WORLD} ${VOSS} Commander Voss kneels on the chamber floor before the dead War Core — now a dark inert sphere. His white coat is torn and dirty. His red cybernetic spine flickers and dims. He stares at the dead machine with hollow defeated eyes. Everything he built is gone. Broken villain, aftermath, cold blue lighting replacing the red.`,
  },
  {
    id: 'S61',
    title: 'Blue Embers Float',
    plot: "Faint blue code particles drift through the chamber like fireflies. Echo's last traces. Beautiful and sad. Nova watches them silently.",
    prompt: `${WORLD} ${NOVA} The dark chamber filled with softly drifting blue code particles — like fireflies or embers. Echo's final digital remains floating gently through the air. Nova stands in the center, watching them with quiet grief, her hand extended as particles drift through her fingers. Beautiful, sad, meditative moment. Soft blue particle effects, dark atmosphere, emotional.`,
  },
  {
    id: 'S62',
    title: 'Nova and Orin — Quiet Moment',
    plot: 'Nova and Orin sit on the chamber floor, exhausted. Orin puts his cybernetic hand on her shoulder. They share a look of survival.',
    prompt: `${WORLD} ${NOVA} ${ORIN} Nova and Orin sit on the floor of the destroyed chamber, backs against a wall, completely exhausted. Orin puts his cybernetic right hand gently on Nova's shoulder — the red light strips now dim. They share a look that says "we survived." Blue embers drift around them. Quiet human moment after chaos. Intimate, tired, warm despite the cold setting.`,
  },
  {
    id: 'S63',
    title: 'Sunrise Through Smog',
    plot: 'The first sunrise in a free city. Golden light breaks through layers of smog and steel. Rays cut between skyscrapers.',
    prompt: `${WORLD} Dawn breaking over the cyberpunk megacity. Golden sunlight pierces through layers of industrial smog and cuts between massive steel skyscrapers. The first sunrise without red drone lights in the sky. Warm golden rays mix with the remaining cool blue neon of the city. Volumetric god rays, atmospheric, hope breaking through darkness. Epic wide establishing shot.`,
  },
  {
    id: 'S64',
    title: 'People Emerge — Streets',
    plot: 'Street level: people cautiously step out of buildings. They look up at an empty sky — no drones for the first time. A child reaches up toward the light.',
    prompt: `${WORLD} Street level in the megacity at dawn. Ordinary people cautiously step out of doorways and look up at the sky — empty for the first time, no drones, no surveillance. A small child reaches up toward the golden sunlight. Adults look at each other with disbelief and tentative hope. Quiet, emotional, human. Golden dawn light on faces, street-level intimate shot.`,
  },
  {
    id: 'S65',
    title: 'Nova Rooftop — Wind in Hair',
    plot: 'Nova stands on the rooftop edge. Wind blows her silver braids. She looks out over the waking city. For the first time, she allows herself a small smile.',
    prompt: `${WORLD} ${NOVA} Nova stands alone on the edge of a rooftop, silhouetted against the golden dawn. Wind blows her silver braids across her face. She looks out over the awakening city — its neon signs still flickering but no drones in the sky. For the first time, a small genuine smile crosses her lips. Hero rooftop moment, golden backlight, wind and dawn, emotional release.`,
  },
  {
    id: 'S66',
    title: "Echo's Signal — Wrist Console",
    plot: "Close-up of Nova's wrist console. The screen is dark. Then — a tiny violet dot of light appears. Pulses once. Twice. Echo is alive.",
    prompt: `${WORLD} Extreme close-up of Nova's wrist-mounted console. The screen is dark and cracked from battle. Silence. Then — a tiny dot of violet light appears at the center of the screen. It pulses once. Twice. Brighter. Echo's symbol. She's alive. Nova's fingers tremble at the edge of frame. Emotional reveal, hope, tiny light in darkness, macro close-up.`,
  },
  {
    id: 'S67',
    title: 'Orin Smiles',
    plot: 'Orin sees the violet light. He smiles — a real, warm, rare smile. "That kid really likes dramatic exits."',
    prompt: `${WORLD} ${ORIN} Medium close-up of Orin's face. He sees something off-screen that makes him break into a real, warm, rare smile. His dark eyes crinkle with genuine warmth and relief. Dawn light catches the side of his face. His cybernetic arm hangs relaxed at his side, red lights soft. A tough man showing genuine joy. Character emotion shot, golden light.`,
  },
  {
    id: 'S68',
    title: 'City Waking — Aerial',
    plot: 'Aerial drone shot of the city waking up. Lights changing from red to blue to gold. People filling streets. A world rebooting without its masters.',
    prompt: `${WORLD} Aerial shot slowly rising above the cyberpunk megacity at dawn. The city's lighting transitions — red Dominion displays flickering off, replaced by natural golden sunlight and remaining blue neon. Streets below fill with people. The floating ring above the tower is dark and still. A city rebooting without its masters. Sweeping aerial pullback, golden hour, scale and beauty.`,
  },
  {
    id: 'S69',
    title: 'Final Wide — City and Sunrise',
    plot: 'Ultimate wide shot. The megacity stretches to the horizon. Sunrise behind it. No drones. No war. Just a fractured world and a future unwritten.',
    prompt: `${WORLD} Ultimate wide establishing shot of the entire cyberpunk megacity stretching to the horizon. A spectacular sunrise blazes behind the skyline — gold, orange, and pink cutting through industrial smog. The sky is empty of drones. The black tower stands dark, its red ring dead. The city is quiet, beautiful, and free. A fractured world. A future unwritten. Final shot, maximum scale, sunrise, hope.`,
  },
  {
    id: 'S70',
    title: 'Title Card — CYBER WAR',
    plot: 'Black screen. The words "CYBER WAR" appear in glowing cyan text. Below: "Every empire ends. Every story evolves." The text pulses once and fades.',
    prompt: `${WORLD} Black screen with faint digital particles drifting. The words "CYBER WAR" materialize in large glowing cyan neon text at center screen, constructed from circuit-like lines. Below in smaller white text: "Every empire ends. Every story evolves." The text pulses once with energy, then slowly fades. Title card, clean typography on black, cyan glow, cinematic end card.`,
  },
];

// ── Helpers (same as batch 1) ─────────────────────────────────────────
function log(step: string, msg: string) {
  console.log(`[${step}] ${msg}`);
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const universeAbi = [
  {
    type: 'function',
    name: 'createNode',
    inputs: [
      { name: '_contentHash', type: 'bytes32' },
      { name: '_plotHash', type: 'bytes32' },
      { name: '_previous', type: 'uint256' },
      { name: '_link', type: 'string' },
      { name: '_plot', type: 'string' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'latestNodeId',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    name: 'NodeCreated',
    inputs: [
      { name: 'id', type: 'uint256', indexed: true },
      { name: 'previous', type: 'uint256', indexed: true },
      { name: 'creator', type: 'address', indexed: true },
      { name: 'contentHash', type: 'bytes32', indexed: false },
      { name: 'plotHash', type: 'bytes32', indexed: false },
      { name: 'link', type: 'string', indexed: false },
      { name: 'plot', type: 'string', indexed: false },
    ],
  },
] as const;

async function generateVideo(prompt: string, label: string): Promise<string> {
  log(label, 'Generating...');
  const taskRes = await fetch(`${BD_BASE}/contents/generations/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${BYTEDANCE_API_KEY}` },
    body: JSON.stringify({
      model: 'dreamina-seedance-2-0-260128',
      content: [{ type: 'text', text: prompt }],
      duration: 10,
      aspect_ratio: '16:9',
      resolution: '720p',
      generate_audio: false,
    }),
  });
  if (!taskRes.ok) throw new Error(`ByteDance ${taskRes.status}`);
  const { id: taskId } = (await taskRes.json()) as any;
  if (!taskId) throw new Error('No task ID');

  for (let i = 0; i < 60; i++) {
    await sleep(5000);
    const poll = await fetch(`${BD_BASE}/contents/generations/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${BYTEDANCE_API_KEY}` },
    });
    if (!poll.ok) continue;
    const s = (await poll.json()) as any;
    const st = s.status?.toLowerCase();
    if (st === 'succeeded' || st === 'completed') {
      const url = s.content?.video_url || s.output?.video_url;
      if (!url) throw new Error('No video URL');
      log(label, 'Video done');
      return url;
    }
    if (st === 'failed' || st === 'error') throw new Error(s.error?.message || 'failed');
    if (i % 6 === 0) log(label, `${i * 5}s...`);
  }
  throw new Error('Timeout');
}

async function pinToIPFS(
  videoUrl: string,
  filename: string,
  label: string
): Promise<{ url: string; hash: string }> {
  // Retry download up to 3 times with 60s timeout — ByteDance CDN can be flaky
  let buf: ArrayBuffer | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60_000);
      const dl = await fetch(videoUrl, { signal: controller.signal });
      clearTimeout(timeout);
      if (!dl.ok) throw new Error(`HTTP ${dl.status}`);
      buf = await dl.arrayBuffer();
      break;
    } catch (err: any) {
      log(label, `Download attempt ${attempt + 1}/3 failed: ${err.message?.slice(0, 60)}`);
      if (attempt < 2) await sleep(3000);
    }
  }
  if (!buf) {
    // Fallback: use ByteDance URL directly (skip Pinata pin)
    log(label, 'All download attempts failed — using ByteDance URL directly');
    return { url: videoUrl, hash: `bd-fallback-${Date.now()}` };
  }
  log(label, `${(buf.byteLength / 1024 / 1024).toFixed(1)} MB → Pinata`);
  const form = new FormData();
  form.append('file', new Blob([buf], { type: 'video/mp4' }), filename);
  form.append('pinataMetadata', JSON.stringify({ name: `CW Film: ${filename}` }));
  const pin = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST',
    headers: { Authorization: `Bearer ${PINATA_JWT}` },
    body: form,
  });
  if (!pin.ok) throw new Error(`Pinata ${pin.status}`);
  const { IpfsHash } = (await pin.json()) as { IpfsHash: string };
  log(label, `IPFS: ${IpfsHash}`);
  return { url: `${PINATA_GW}/ipfs/${IpfsHash}`, hash: IpfsHash };
}

async function createNode(
  contentHash: string,
  plot: string,
  previousId: bigint,
  link: string,
  label: string
) {
  const chBytes = keccak256(toBytes(contentHash)) as `0x${string}`;
  const plotHash = keccak256(toBytes(plot));
  const txHash = await walletClient.writeContract({
    address: UNIVERSE_ADDR,
    abi: universeAbi,
    functionName: 'createNode',
    args: [chBytes, plotHash, previousId, link, plot],
  });
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
    confirmations: 1,
    timeout: 120_000,
  });
  if (receipt.status !== 'success') throw new Error('TX reverted');
  let nodeId = 0n;
  for (const l of receipt.logs) {
    try {
      const d = decodeEventLog({ abi: universeAbi, data: l.data, topics: l.topics });
      if (d.eventName === 'NodeCreated') nodeId = BigInt((d.args as any).id);
    } catch {}
  }
  log(label, `Node #${nodeId}`);
  return nodeId;
}

async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('  CYBER WAR FILM — Batch 2 (S19-S70)');
  console.log('  52 additional scenes for 10-minute film');
  console.log('═'.repeat(60));

  const latestId = (await publicClient.readContract({
    address: UNIVERSE_ADDR,
    abi: universeAbi,
    functionName: 'latestNodeId',
  })) as bigint;
  log('SETUP', `Chaining from node #${latestId}`);

  let previousId = latestId;
  let completed = 0;

  for (let i = 0; i < SCENES.length; i++) {
    const scene = SCENES[i];
    const label = `${scene.id}`;

    console.log(`\n── ${scene.id}: ${scene.title} (${i + 1}/${SCENES.length}) ──`);

    try {
      const videoUrl = await generateVideo(scene.prompt, label);
      const slug = scene.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .slice(0, 40);
      const { url: ipfsUrl, hash } = await pinToIPFS(videoUrl, `cw-${scene.id}-${slug}.mp4`, label);
      const nodeId = await createNode(hash, scene.plot, previousId, ipfsUrl, label);
      previousId = nodeId;
      completed++;
      log(label, `DONE — Node #${nodeId}`);
    } catch (err: any) {
      log(label, `FAILED: ${err.message?.slice(0, 150)}`);
    }

    if (i < SCENES.length - 1) await sleep(2000);
  }

  console.log('\n' + '═'.repeat(60));
  console.log(`  Batch 2 Complete: ${completed}/${SCENES.length} scenes`);
  console.log('═'.repeat(60));
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
