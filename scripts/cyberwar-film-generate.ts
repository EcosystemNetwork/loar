/**
 * CYBER WAR Film — Full Scene Generator (All 70 scenes)
 *
 * Pulls character/location data from wiki entities for consistent prompts.
 * Generates via Seedance 2.0, creates on-chain nodes.
 * Retries RPC on 429s.
 *
 * Usage: pnpm tsx scripts/cyberwar-film-generate.ts
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
  getAddress,
} from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const rawKey = process.env.PRIVATE_KEY ?? '';
const PRIVATE_KEY = (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as `0x${string}`;
const RPC_URL = process.env.RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com';
const BYTEDANCE_API_KEY = process.env.BYTEDANCE_API_KEY!;
const SERVER_URL = process.env.VITE_SERVER_URL ?? 'http://localhost:3000';

const account = privateKeyToAccount(PRIVATE_KEY);
const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC_URL) });
const walletClient = createWalletClient({ account, chain: sepolia, transport: http(RPC_URL) });

const UNIVERSE_ADDR = '0x341fFa19c0EC8D2C8eF42A360cf799949844262e' as const;
const BD_BASE = 'https://ark.ap-southeast.bytepluses.com/api/v3';

function log(step: string, msg: string) {
  console.log(`[${step}] ${msg}`);
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Wiki-Pulled Character DNA ─────────────────────────────────────────
let NOVA = '';
let ORIN = '';
let ECHO_CHAR = '';
let VOSS = '';
let WORLD =
  'Year 2149 cyberpunk megacity. Neon rain, holographic ads, patrol drones. Color palette: deep blue, neon cyan, hot red, violet. Cinematic 16:9, dramatic lighting, 720p quality.';

const WIKI_ENTITIES: Record<string, string> = {
  'Nova Reyes': 'MWBnOOjOFsf8foFzGIao',
  'Orin Vale': 'gT9oiI9PfWxOpw4GEFgp',
  'Echo (AI Construct)': 'tptmvvggTwWjfqXcEknQ',
  'Commander Drake Voss': 'MPNjSvAidoxIw3ejksnB',
  'Megacity 2149': 'YzeTgT7tpdAmsQzIQzlB',
};

async function fetchCharacterDNA(): Promise<void> {
  log('WIKI', 'Pulling character data from wiki entities...');
  for (const [name, entityId] of Object.entries(WIKI_ENTITIES)) {
    try {
      const url = `${SERVER_URL}/trpc/entities.get?batch=1&input=${encodeURIComponent(JSON.stringify({ '0': { entityId } }))}`;
      const res = await fetch(url);
      const json = (await res.json()) as any[];
      const entity = json[0]?.result?.data;
      if (entity?.description) {
        const desc = entity.description.slice(0, 350).replace(/\n/g, ' ');
        const visual = `${entity.name}: ${desc}`;
        if (name.includes('Nova')) NOVA = visual;
        else if (name.includes('Orin')) ORIN = visual;
        else if (name.includes('Echo')) ECHO_CHAR = visual;
        else if (name.includes('Voss')) VOSS = visual;
        else if (name.includes('Megacity'))
          WORLD = `${desc} Cinematic 16:9, dramatic lighting, 720p quality.`;
        log('WIKI', `  ${entity.name}: loaded (${desc.length} chars)`);
      }
    } catch (err: any) {
      log('WIKI', `  ${name}: FAILED (${err.message?.slice(0, 40)})`);
    }
  }
  // Fallbacks
  if (!NOVA)
    NOVA =
      'Nova Reyes: 23-year-old female, brown skin, silver braided undercut, glowing blue circuit tattoo over left eye, black tactical jacket with neon cyan seam lines, fingerless gloves, thin glowing cyan plasma blade.';
  if (!ORIN)
    ORIN =
      'Orin Vale: 27-year-old tall male, dark skin, shaved head, cybernetic right arm with glowing red light strips, charcoal armor vest, long gray coat, plasma rifle.';
  if (!ECHO_CHAR)
    ECHO_CHAR =
      'Echo: appears-16 holographic girl, white bob-cut hair, glowing violet eyes, transparent body filled with moving code fragments, ethereal soft violet glow.';
  if (!VOSS)
    VOSS =
      'Commander Drake Voss: 50s male, pale angular face, long white coat over black armor, red cybernetic spine visible through transparent back plating, energy staff weapon.';
  log('WIKI', 'Character DNA loaded from wiki.');
}

// ── All 70 Scenes ─────────────────────────────────────────────────────
// Prompts use template literals that resolve AFTER fetchCharacterDNA populates the vars.
function buildScenes() {
  return [
    // ── ACT 1: OPENING (S01-S06) ──
    {
      id: 'S01',
      title: 'Megacity Skyline — Establishing',
      plot: 'EXT. MEGACITY SKYLINE - NIGHT. Sprawling neon metropolis. Holograms flicker through rain. Drones patrol. Floating red ring over black tower.',
      prompt: `${WORLD} Epic wide establishing shot of a massive neon cyberpunk megacity at night. Rain falling through holographic advertisements. Huge patrol drones flying between skyscrapers. In the center, an enormous floating red ring structure pulses ominously above a black tower. Camera slowly pushes forward. Atmospheric, cinematic, Blade Runner scale.`,
    },
    {
      id: 'S02',
      title: 'City Rain — Close Up',
      plot: 'Rain on neon streets. Holographic ads reflect in puddles. Drone overhead with red searchlight.',
      prompt: `${WORLD} Extreme close-up of neon rain falling on a cyberpunk street. Holographic advertisements reflect in a puddle. A patrol drone passes overhead, red searchlight sweeping. Shallow depth of field, macro raindrops, neon reflections.`,
    },
    {
      id: 'S03',
      title: 'Billboard Propaganda',
      plot: 'Digital billboard: "ORDER IS PEACE. COMPLIANCE IS FREEDOM." Glitches and distorts.',
      prompt: `${WORLD} A massive glitching digital billboard reads "ORDER IS PEACE" in white on red. The billboard distorts with digital artifacts. Rain falls past it. Drone silhouettes patrol behind. Propaganda dystopia aesthetic.`,
    },
    {
      id: 'S04',
      title: 'Undercity Descent',
      plot: 'Camera descends through hidden entrance into undercity. Pipes, cables, dim blue lights.',
      prompt: `${WORLD} Camera descends through a hidden hatch into the undercity. Industrial pipes, exposed cables, dim blue emergency strip lights. Water drips. Graffiti resistance symbols on walls. Claustrophobic vertical descent.`,
    },
    {
      id: 'S05',
      title: 'Nova at Console',
      plot: 'INT. SAFEHOUSE. Nova at holographic console. Silver braids sway. Code reflects in eye tattoo.',
      prompt: `${WORLD} ${NOVA} Interior underground bunker lit by blue light. Nova sits at a holographic console, fingers dancing across floating keys. Code reflects in her glowing blue eye tattoo. Silver braids sway. Screens and cables on walls. Close-up pulling to medium shot.`,
    },
    {
      id: 'S06',
      title: 'Nova Close-Up — Eye Tattoo',
      plot: 'Extreme close-up of Nova. Blue circuit tattoo pulses with data. Focused, determined.',
      prompt: `${WORLD} ${NOVA} Extreme close-up of Nova's face. Glowing blue circuit tattoo over left eye pulses with flowing data. Brown skin, silver braids at edge of frame. Eyes focused and determined, reflecting holographic screens. Blue light on features.`,
    },

    // ── ACT 1: ORIN + ECHO INTRO (S07-S14) ──
    {
      id: 'S07',
      title: 'Orin Loads Up',
      plot: 'Orin loads plasma rounds with cybernetic arm. Red light strips glow. Tower hologram on table behind.',
      prompt: `${WORLD} ${ORIN} Interior bunker. Orin loads glowing plasma rounds into a rifle. His cybernetic right arm with red light strips moves with mechanical precision. A holographic tower map rotates on the table behind. Gray coat on shoulders. Medium shot, red and blue lighting.`,
    },
    {
      id: 'S08',
      title: 'Orin Cybernetic Arm — Detail',
      plot: "Close-up of Orin's cybernetic arm flexing. Red strips pulse. Servos whir. He clenches a fist.",
      prompt: `${WORLD} ${ORIN} Extreme close-up of Orin's cybernetic right arm. Red light strips pulse as mechanical fingers flex. Chrome and dark metal, micro-servos adjusting. He clenches into a powerful fist. Red glow intensifies. Macro detail.`,
    },
    {
      id: 'S09',
      title: 'Safehouse War Table',
      plot: 'Holographic war table: Dominion Tower in 3D. Red zones = defenses. Blue = breach route.',
      prompt: `${WORLD} A holographic 3D projection of the Dominion Tower rotates above a table. Red zones highlight defenses. Blue lines trace infiltration route. Nova's gloved hand points at a weak point. Blue and red light on faces. Tactical overhead angle.`,
    },
    {
      id: 'S10',
      title: 'Echo Materializes',
      plot: 'Echo assembles from scattered code particles. Violet swirl coalesces into holographic girl.',
      prompt: `${WORLD} ${ECHO_CHAR} Scattered violet code particles swirl, rapidly coalescing into a humanoid shape. Echo assembles — first outline, then white bob-cut hair, then violet eyes open. Moving code fills her transparent body. Ethereal transformation, violet particle effects.`,
    },
    {
      id: 'S11',
      title: 'Echo Close-Up — Violet Eyes',
      plot: "Echo's violet eyes contain swirling galaxies of code. Innocent and ancient.",
      prompt: `${WORLD} ${ECHO_CHAR} Extreme close-up of Echo's holographic face. Glowing violet eyes contain swirling galaxies of code. White bob-cut hair frames translucent face. Both innocent and ancient. Ethereal, haunting portrait. Violet glow, dark background.`,
    },
    {
      id: 'S12',
      title: 'Echo Appears — The Briefing',
      plot: 'Echo materializes between Nova and Orin. She reveals the breach point. "That depends on what humans ask me to become."',
      prompt: `${WORLD} ${NOVA} ${ORIN} ${ECHO_CHAR} Echo materializes in the bunker between Nova and Orin. Transparent violet body flickers with code. Nova and Orin stand on either side. Three characters framed together. Blue and violet lighting. Character introduction shot.`,
    },
    {
      id: 'S13',
      title: 'Orin Reacts to Echo',
      plot: 'Orin watches Echo skeptically. Jaw tightens. Cybernetic arm grips rifle tighter.',
      prompt: `${WORLD} ${ORIN} ${ECHO_CHAR} Medium shot of Orin watching Echo with skepticism. Jaw tight, eyes narrowed. Cybernetic arm grips plasma rifle tighter, red strips pulsing. Echo visible as violet glow in foreground. Tense distrust.`,
    },
    {
      id: 'S14',
      title: 'Nova Decides — Blade Draw',
      plot: 'Nova stands, grabs plasma blade. It ignites cyan. "Move out." Low angle hero shot.',
      prompt: `${WORLD} ${NOVA} Nova stands with determination, grabs her plasma blade from the wall. The thin blade ignites with glowing cyan energy. Light illuminates her face and silver braids. She turns toward camera. Low angle hero shot, cyan blade glow.`,
    },

    // ── ACT 2: HOVERBIKE CHASE (S15-S24) ──
    {
      id: 'S15',
      title: 'Hoverbike Launch',
      plot: 'Nova and Orin blast from shadows on hoverbikes. Echo streams as violet light. Rain whips. Sirens.',
      prompt: `${WORLD} ${NOVA} ${ORIN} Two sleek hoverbikes blast from a dark undercity alley into rain-soaked neon streets. Nova leads, Orin behind. Violet light streak (Echo) between them. Rain whips past, neon reflections on wet pavement. Sirens above. High-speed tracking shot.`,
    },
    {
      id: 'S16',
      title: 'Bike POV — Tunnel Speed',
      plot: 'First-person hoverbike racing through neon tunnel. Light streaks blur.',
      prompt: `${WORLD} First-person POV from hoverbike racing through a neon-lit tunnel at extreme speed. Light streaks and signs blur past in long exposure trails. Tunnel opens to rain-soaked streets. Speed lines, motion blur, adrenaline.`,
    },
    {
      id: 'S17',
      title: 'Side-by-Side Riding',
      plot: 'Nova and Orin ride together through rain. Cyan and red light trails. They exchange a look.',
      prompt: `${WORLD} ${NOVA} ${ORIN} Nova and Orin on hoverbikes side by side through rain. Bikes leave glowing trails — cyan and red. They exchange a determined glance. Neon signs blur behind. Tracking shot from the side.`,
    },
    {
      id: 'S18',
      title: 'Drone Swarm Descends',
      plot: '20+ drones descend from clouds. Red lights fill the sky. Sirens blare.',
      prompt: `${WORLD} Looking up from street level as twenty chrome attack drones descend through rain clouds. Red scanner lights create beams cutting through rain. Sirens blare. Warning lights flash on buildings. Sky filling with enemy drones.`,
    },
    {
      id: 'S19',
      title: 'Echo Hacks Drones — Digital View',
      plot: "Echo's perspective: wireframe world, drone code as violet threads. She snaps them. Drones go blind.",
      prompt: `${WORLD} ${ECHO_CHAR} Abstract digital perspective — world as wireframe with data streams. Echo's violet hands grasp glowing red threads connected to drones. She snaps them. Threads dissolve. Drones' red lights die. Digital hacking visualization, matrix aesthetic.`,
    },
    {
      id: 'S20',
      title: 'Nova Blade Slash — Slow Mo',
      plot: 'Ultra slow-mo: Nova swings cyan blade through drone. Luminous arc. Sparks freeze in air.',
      prompt: `${WORLD} ${NOVA} Ultra slow-motion of Nova swinging her cyan plasma blade through a chrome drone. Blade leaves luminous cyan trail. Drone splits. Sparks and fragments freeze in air. Rain droplets hang motionless. Beautiful slow-motion destruction.`,
    },
    {
      id: 'S21',
      title: 'Orin Fires — Cybernetic Arm Cannon',
      plot: "Orin's arm locks on drone. Fist opens revealing cannon. BOOM. Drone explodes.",
      prompt: `${WORLD} ${ORIN} Close-up of Orin on hoverbike. Cybernetic arm extends, fist opens revealing plasma cannon. Red light strips blaze. He fires — massive bolt hits drone. Drone explodes in fire and debris. Slow-motion action, explosion backlight.`,
    },
    {
      id: 'S22',
      title: 'Spider Drone Transform',
      plot: 'Drone transforms into spider assault machine. Panels shift, legs extend. Terrifying.',
      prompt: `${WORLD} Close-up of chrome drone mechanically transforming into spider-like assault robot. Metal panels shift, six legs extend with hydraulic precision. Weapon barrels emerge. Red sensor eye activates. Terrifying mechanical transformation, ominous red glow.`,
    },
    {
      id: 'S23',
      title: 'Nova vs Spider Drone',
      plot: 'Nova leaps from bike onto spider drone. Stabs blade into core. Electric explosion.',
      prompt: `${WORLD} ${NOVA} Nova leaps from damaged hoverbike through the air, lands on spider drone's back. Drives cyan plasma blade into its core. Explosion of electric blue energy erupts. Rain and sparks fly. Dynamic action from below, dramatic backlight.`,
    },
    {
      id: 'S24',
      title: 'Bike Crash and Recovery',
      plot: "Nova's bike clips. Controlled slide, sparks. She rolls up in fighting stance.",
      prompt: `${WORLD} ${NOVA} Nova's hoverbike skids violently. Sparks spray from wet pavement. She leaps off, rolls, comes up in fighting stance with plasma blade ignited. Rain and sparks surround her. Dynamic crash and recovery, street-level camera.`,
    },

    // ── ACT 2: TOWER APPROACH + INFILTRATION (S25-S34) ──
    {
      id: 'S25',
      title: 'Tower Approach',
      plot: 'Nova and Orin look up at Dominion Tower. Red lightning crawls. Ring pulses above. "We\'re breaking it."',
      prompt: `${WORLD} ${NOVA} ${ORIN} Nova and Orin at the base of the massive black Dominion Tower looking up. Red lightning crawls across its surface. Floating red ring pulses above against storm clouds. Low angle past silhouetted figures. Epic scale, ominous.`,
    },
    {
      id: 'S26',
      title: 'Tower Security Grid',
      plot: 'Tower base: laser grids, armed guards, scanning gates. Nova spots maintenance hatch.',
      prompt: `${WORLD} Base of Dominion Tower. Red laser security grids crisscross the entrance. Black-armored guards patrol. Scanning gates pulse red. Nova crouches in shadows nearby. Security fortress, red laser beams, noir lighting.`,
    },
    {
      id: 'S27',
      title: 'Climbing the Shaft',
      plot: 'Vertical shaft lit by red strips. Nova climbs with magnetic gloves. Orin follows. Echo guides above.',
      prompt: `${WORLD} ${NOVA} ${ECHO_CHAR} Dark vertical maintenance shaft, red light strips. Nova climbs rapidly with cyan-glowing magnetic gloves. Orin below with cybernetic arm gripping rungs. Echo's violet form flickers above guiding. Vertical camera angle looking up.`,
    },
    {
      id: 'S28',
      title: 'Echo Holographic Map',
      plot: 'Echo projects 3D map of tower interior around them. Violet wireframe route highlighted.',
      prompt: `${WORLD} ${ECHO_CHAR} Echo projects a translucent 3D holographic map of the tower around the shaft. Floors, corridors, defenses as violet wireframes. Glowing violet path traces route upward. Map wraps around Nova and Orin as they climb. Holographic display, violet wireframe.`,
    },
    {
      id: 'S29',
      title: 'Shaft Fight — Soldiers Rappel',
      plot: 'Black-armored soldiers rappel in from below. Gunfire echoes up the shaft.',
      prompt: `${WORLD} Inside the vertical shaft, black-armored Dominion soldiers rappel upward firing weapons. Muzzle flashes illuminate the dark shaft. Red tracer rounds streak upward. Nova and Orin scramble to take cover. Vertical combat, red lighting, gunfire.`,
    },
    {
      id: 'S30',
      title: 'EMP Disc — Nova Flip',
      plot: "Nova kicks off wall, flips, throws EMP disc. Detonates midair. Soldiers' visors die. They fall.",
      prompt: `${WORLD} ${NOVA} Nova kicks off the shaft wall performing an acrobatic flip. She throws a disc that explodes with blue EMP shockwave. Soldiers' helmet visors go dark, they tumble downward. Blue shockwave against red lighting. Dynamic action.`,
    },
    {
      id: 'S31',
      title: 'Orin Catches Nova',
      plot: "Nova slips. Orin's cybernetic arm catches her wrist. Red light illuminates the moment of trust.",
      prompt: `${WORLD} ${NOVA} ${ORIN} Nova's magnetic glove fails, she falls. Orin reaches down with red cybernetic arm and catches her wrist. Eyes meet — trust. Red arm light illuminates both faces. Close-up of metal fingers gripping her wrist. Intimate action moment.`,
    },
    {
      id: 'S32',
      title: 'Corridor Sprint',
      plot: 'Nova and Orin sprint through red-lit corridor. Alarms blare. Blast doors closing. They slide under the last one.',
      prompt: `${WORLD} ${NOVA} ${ORIN} Nova and Orin sprint through a red-lit corridor. Emergency lights flash. Blast doors slam shut one by one ahead. They slide under the last door as it crashes closed inches above. Tense chase, red lighting, cinematic slide.`,
    },
    {
      id: 'S33',
      title: 'Core Chamber Door Opens',
      plot: 'Massive door hisses open. Red light pours out. War Core visible — enormous, rotating, terrifying.',
      prompt: `${WORLD} Massive armored door hisses open with steam. Red light pours out, silhouetting Nova and Orin in the doorway. Inside, the enormous rotating War Core sphere — massive ball of red code. Cathedral scale. Dramatic reveal from behind characters.`,
    },
    {
      id: 'S34',
      title: 'War Core — Surface Detail',
      plot: 'Close-up of War Core surface. War footage plays — riots, fires, cities burning, soldiers fighting.',
      prompt: `${WORLD} Extreme close-up of the rotating War Core sphere surface. War footage plays across it — riots, cities burning, soldiers, civilians fleeing, explosions. Imagery shifts and overlaps. World's suffering as data. Haunting, documentary-like footage on sphere of code.`,
    },

    // ── ACT 3: CONFRONTATION (S35-S42) ──
    {
      id: 'S35',
      title: 'Voss Revealed',
      plot: 'War Core chamber. Voss stands before the sphere. White coat, red spine. He turns calmly.',
      prompt: `${WORLD} ${VOSS} Massive cathedral chamber of machines. Huge glowing red War Core sphere rotates at center. Standing before it, Commander Drake Voss in white coat, black armor, red cybernetic spine glowing through transparent back plating. He turns calmly. Villain reveal. Red dominant lighting.`,
    },
    {
      id: 'S36',
      title: 'Voss Close-Up — Cold Eyes',
      plot: 'Extreme close-up of Voss. Cold pale eyes. Faint smile. Red spine halo.',
      prompt: `${WORLD} ${VOSS} Extreme close-up of Voss's face. Pale skin, sharp features, cold calculating eyes, faint cruel smile. Red cybernetic spine creates halo of red light behind his head. Shadows cut across face. Villain portrait, menacing. Red backlight.`,
    },
    {
      id: 'S37',
      title: 'The Confrontation — Four Characters',
      plot: 'Voss faces Nova, Orin, Echo across the chamber. War Core between them. Tense standoff.',
      prompt: `${WORLD} ${NOVA} ${ORIN} ${VOSS} ${ECHO_CHAR} In the War Core Chamber, Voss faces Nova across the room. Massive red sphere rotates between them showing war footage. Echo hovers nearby, dimming with fear. Orin has rifle raised. Tense standoff. Red and blue clash. Wide shot all four characters.`,
    },
    {
      id: 'S38',
      title: 'Voss Speech — Walking',
      plot: 'Voss walks alongside Core. "Humanity is not losing because of machines. It is losing because it cannot agree on what truth is."',
      prompt: `${WORLD} ${VOSS} Voss walks slowly alongside the red War Core sphere, arm raised gesturing at war footage on its surface. White coat flows. Expression passionate, convinced. Red glow on pale face. Villain monologue, medium tracking shot, theatrical lighting.`,
    },
    {
      id: 'S39',
      title: "Flashback — Nova's Mother",
      plot: 'Brief flashback: woman resembling Nova in a clean lab, building first Echo. Blue circuit on her arm.',
      prompt: `${WORLD} Flashback — a research lab years ago. A woman resembling Nova works at a holographic terminal. Same blue circuit pattern on her forearm. Before her, earliest Echo forms as violet light sphere. Clean white lab contrasting dark present. Warm nostalgic, memory aesthetic, soft focus edges.`,
    },
    {
      id: 'S40',
      title: 'Echo Reacts — Fear',
      plot: 'Echo looks at Voss with fear. Form flickers, dims. Code fragments scatter from edges.',
      prompt: `${WORLD} ${ECHO_CHAR} Close-up of Echo's face showing fear. Violet eyes widen. Translucent form flickers, dimming. Code fragments scatter from her edges. She wraps arms around herself. Digital being experiencing fear. Emotional, vulnerable, violet fading.`,
    },
    {
      id: 'S41',
      title: 'Nova Protects Echo',
      plot: "Nova steps in front of Echo protectively. Ignites blade. Cyan light reflects in Voss's eyes.",
      prompt: `${WORLD} ${NOVA} ${VOSS} Nova steps forward protectively in front of Echo. Draws and ignites plasma blade — cyan light explodes. Close-up of cyan blade reflecting in Voss's cold eyes. Protector stance, blue vs red lighting.`,
    },
    {
      id: 'S42',
      title: 'Voss Summons Tendrils',
      plot: 'Voss raises his hand. Mechanical tendrils erupt from every surface. The room becomes hostile.',
      prompt: `${WORLD} ${VOSS} Voss raises his hand with authority. Dozens of mechanical tendrils burst from floor, walls, ceiling. Metal tentacles with red tips thrash through the air. The entire chamber becomes hostile. Red emergency lighting, chaos erupting. Wide angle showing full chamber.`,
    },

    // ── ACT 3: BATTLE (S43-S54) ──
    {
      id: 'S43',
      title: 'Nova Cuts Tendrils',
      plot: 'Nova slashes through tendrils with cyan blade. Sparks fly.',
      prompt: `${WORLD} ${NOVA} Nova slashes through mechanical tendrils with her cyan plasma blade, sparks flying with each cut. She moves fast and fluid, blade leaving cyan arcs. Tendrils recoil. Dynamic melee action, multiple cuts in sequence.`,
    },
    {
      id: 'S44',
      title: 'Echo Copies Scatter',
      plot: 'Echo splinters into 20 holographic copies. Violet afterimages fill the chamber. Targeting systems confused.',
      prompt: `${WORLD} ${ECHO_CHAR} Echo splits into twenty identical violet holographic copies scattering in every direction. Each copy runs, floats, phases through machines. Beautiful violet afterimage trails fill the chamber. Stunning visual, multiple holograms, violet light.`,
    },
    {
      id: 'S45',
      title: 'Orin Tears Turret',
      plot: 'Orin grabs ceiling turret with cybernetic arm, tears it off, swings it into drones.',
      prompt: `${WORLD} ${ORIN} Orin leaps and grabs a ceiling turret with his red cybernetic arm. Tears it from its mount — sparks and cables flying. Swings it like a club into an incoming drone, smashing it. Raw power, debris exploding.`,
    },
    {
      id: 'S46',
      title: 'Blade vs Staff — First Clash',
      plot: 'Nova and Voss engage. Blue blade against red staff. First clash sends sparks flying.',
      prompt: `${WORLD} ${NOVA} ${VOSS} Nova lunges at Voss. Her cyan plasma blade meets his red energy staff with an explosion of sparks. Blue and red energy crackle at the contact point. Both fighters brace against the impact. First weapon clash, dramatic sparks.`,
    },
    {
      id: 'S47',
      title: 'Blade vs Staff — Fast Exchange',
      plot: 'Rapid exchange of blows. She is fast. He is precise. Sparks with each clash.',
      prompt: `${WORLD} ${NOVA} ${VOSS} Rapid melee exchange — Nova attacks with speed, Voss parries with precision. Blue blade and red staff clash repeatedly, sparks exploding with each hit. Fast choreography, multiple strikes. Dynamic camera, blue and red flashing.`,
    },
    {
      id: 'S48',
      title: 'Blade vs Staff — Close-Up Lock',
      plot: 'Ultra close-up of weapons locked. Both gritting teeth. Blue vs red energy crackling.',
      prompt: `${WORLD} Ultra close-up of cyan blade locked against red staff. Blue and red energy crackle between them. Cut between faces — Nova gritting teeth with determination, Voss with cold fury. Weapon clash macro, blue vs red.`,
    },
    {
      id: 'S49',
      title: 'Voss Kicks Nova',
      plot: 'Voss kicks Nova across chamber. She crashes into control panel. Sparks. Gets back up.',
      prompt: `${WORLD} ${NOVA} ${VOSS} Voss lands devastating kick to Nova's chest. She flies backward, crashing into control panels. Sparks and glass erupt. Blade clatters away. She hits ground hard, wipes blood from lip, forces herself back up. Brutal impact, slow-motion crash.`,
    },
    {
      id: 'S50',
      title: 'Orin Tackles Voss',
      plot: 'Orin charges Voss from behind. Cybernetic arm locks around him. They tumble off the platform.',
      prompt: `${WORLD} ${ORIN} ${VOSS} Orin charges Voss from behind with a roar. Cybernetic arm locks around Voss's torso. Momentum carries them off the platform edge. They tumble onto a lower catwalk, grappling. Red and gray tangled. Dynamic tackle and fall.`,
    },
    {
      id: 'S51',
      title: 'Nova Sprints to Core',
      plot: 'Nova sprints across collapsing catwalk toward War Core. Tendrils grab at her. She slashes without stopping.',
      prompt: `${WORLD} ${NOVA} Nova sprints across a narrow catwalk toward the massive red War Core. Catwalk shakes, sections collapse behind her. Tendrils lash out — she slashes each without breaking stride. Pulsing red core fills frame ahead. Desperate sprint, race against time.`,
    },
    {
      id: 'S52',
      title: 'Hand on Core — Red to Blue',
      plot: "Nova's hand hits the Core interface. Blue light surges through red. Veins glow blue through her skin.",
      prompt: `${WORLD} ${NOVA} Nova's hand slams onto the red War Core surface. Blue light erupts and spreads outward across the red sphere. Red code recoils. Blue energy travels up her arm — veins glow blue through brown skin. Circuit tattoo blazes. Red yielding to blue, power surge.`,
    },
    {
      id: 'S53',
      title: 'Voss Screams No',
      plot: 'Voss throws Orin off. Sees Nova at the Core. Rushes toward Echo. "NO!"',
      prompt: `${WORLD} ${VOSS} Voss throws Orin aside and looks up to see Nova connected to the War Core, blue light spreading. His face twists with rage and desperation. He screams and rushes forward. Camera tracks his charge. Villain losing control, desperate fury.`,
    },
    {
      id: 'S54',
      title: "Echo's Decision",
      plot: 'Echo turns to face Voss. For the first time her form looks solid, human. "I choose."',
      prompt: `${WORLD} ${ECHO_CHAR} Echo turns to face the charging Voss. Her form undergoes stunning transformation — transparent body becomes opaque, solid, real. For the first time she looks like an actual girl. Violet eyes shine with tears of light. "I choose." Digital being becoming human in final moment. Emotional, beautiful.`,
    },

    // ── ACT 3: SACRIFICE + AFTERMATH (S55-S62) ──
    {
      id: 'S55',
      title: 'Echo Enters Core',
      plot: 'Echo walks into War Core. Sphere erupts violet-white. Shockwave expands. Everything goes white.',
      prompt: `${WORLD} ${ECHO_CHAR} Echo walks forward into the massive War Core sphere with calm determination. The sphere erupts in blinding violet-white light. Shockwave of energy expands outward. Characters tumble. Screen fills with white light. Climactic sacrifice, violet-white supernova.`,
    },
    {
      id: 'S56',
      title: 'Drones Fall — City Wide',
      plot: 'Across the city, every drone loses power and falls. Red lights die. Floating ring goes dark.',
      prompt: `${WORLD} Wide exterior shot. Across the entire skyline, every drone loses power. Red lights die. Hundreds of drones fall like dead birds trailing sparks. The floating red ring above the tower stutters and goes dark. Mass power failure, drones raining down.`,
    },
    {
      id: 'S57',
      title: 'Core Goes Dark',
      plot: 'Silence. Every screen black. Red glow dead. Blue code embers float like fireflies.',
      prompt: `${WORLD} The War Core Chamber in silence. The massive sphere is dark, dead, inert. Faint blue code particles drift through the air like fireflies. All screens are black. All red lights are dead. Only the gentle blue embers remain. Quiet, aftermath, somber beauty.`,
    },
    {
      id: 'S58',
      title: 'Voss Defeated',
      plot: 'Voss kneels before dead core. Red spine dims. Hollow defeated eyes. A broken man.',
      prompt: `${WORLD} ${VOSS} Voss kneels on the chamber floor before the dark dead War Core. White coat torn. Red cybernetic spine flickers and dims. Hollow defeated eyes stare at nothing. Everything he built is gone. Broken villain, cold blue replacing red.`,
    },
    {
      id: 'S59',
      title: 'Nova Watches Embers',
      plot: "Nova watches blue code particles drift. Echo's last traces. Hand extended as particles pass through fingers.",
      prompt: `${WORLD} ${NOVA} Nova stands watching softly drifting blue code particles — Echo's remains. Her hand extended as particles drift through her fingers. Quiet grief on her face. Beautiful, sad, meditative. Soft blue particle effects, dark atmosphere.`,
    },
    {
      id: 'S60',
      title: '"She made herself impossible to own"',
      plot: 'Nova speaks quietly. Orin beside her. Blue embers around them. The line that defines the film.',
      prompt: `${WORLD} ${NOVA} ${ORIN} Nova and Orin stand together in the dark chamber, illuminated only by drifting blue code particles. Nova's face is resolute, at peace. She speaks quietly — the most important line. Intimate two-shot, blue embers floating, emotional gravity.`,
    },
    {
      id: 'S61',
      title: 'Nova and Orin — Exhausted',
      plot: 'They sit on the floor. Orin puts cybernetic hand on her shoulder. A look of survival.',
      prompt: `${WORLD} ${NOVA} ${ORIN} Nova and Orin sit on the floor of the destroyed chamber, backs against a wall, exhausted. Orin puts his dim cybernetic hand gently on her shoulder. They share a look — "we survived." Blue embers drift. Intimate, tired, warm despite cold setting.`,
    },
    {
      id: 'S62',
      title: 'Walking Out — Silhouettes',
      plot: 'Nova and Orin walk out of the tower. Silhouettes against the first grey light of dawn.',
      prompt: `${WORLD} ${NOVA} ${ORIN} Nova and Orin walk out of the dark Dominion Tower into the first grey light of pre-dawn. Two silhouettes against the lightening sky. The tower behind them dark and powerless. Walking away from the battlefield. Silhouette shot, dawn approaching.`,
    },

    // ── ENDING (S63-S70) ──
    {
      id: 'S63',
      title: 'Sunrise Through Smog',
      plot: 'First sunrise in a free city. Golden light through smog. Rays between skyscrapers.',
      prompt: `${WORLD} Dawn breaking over the cyberpunk megacity. Golden sunlight pierces smog between steel skyscrapers. First sunrise without drones. Warm golden rays mix with cool blue neon. Volumetric god rays, atmospheric hope. Epic wide establishing shot.`,
    },
    {
      id: 'S64',
      title: 'People Emerge',
      plot: 'Street level: people step out of buildings. Look up at empty sky. A child reaches toward light.',
      prompt: `${WORLD} Street level at dawn. People cautiously step out of doorways and look up — empty sky, no drones for the first time. A small child reaches toward golden sunlight. Adults look at each other with disbelief and hope. Quiet, emotional, human. Golden dawn on faces.`,
    },
    {
      id: 'S65',
      title: 'Nova Rooftop — Wind',
      plot: 'Nova on rooftop edge. Wind in silver braids. Looking over waking city. Small smile.',
      prompt: `${WORLD} ${NOVA} Nova stands on a rooftop edge, silhouetted against golden dawn. Wind blows silver braids. She looks over the awakening city — neon still flickering but no drones. A small genuine smile crosses her lips. Hero rooftop moment, golden backlight, emotional release.`,
    },
    {
      id: 'S66',
      title: "Echo's Signal — Wrist",
      plot: "Close-up of Nova's wrist console. Dark. Then — a tiny violet dot pulses. Echo is alive.",
      prompt: `${WORLD} Extreme close-up of Nova's wrist console. Screen dark and cracked. Silence. Then a tiny violet dot of light appears. Pulses once. Twice. Brighter. Echo's symbol. She's alive. Nova's fingers tremble. Emotional reveal, hope, tiny light in darkness.`,
    },
    {
      id: 'S67',
      title: 'Orin Smiles',
      plot: 'Orin sees the violet light. Rare warm smile. "That kid really likes dramatic exits."',
      prompt: `${WORLD} ${ORIN} Medium close-up of Orin's face. He sees something that makes him break into a real, warm, rare smile. Dark eyes crinkle with relief. Dawn light catches his face. Cybernetic arm relaxed, red lights soft. Tough man showing joy. Golden light.`,
    },
    {
      id: 'S68',
      title: 'City Aerial — Waking Up',
      plot: 'Aerial: city lights transition from red to gold. Streets fill with people. City rebooting without masters.',
      prompt: `${WORLD} Aerial shot rising above the megacity at dawn. Lighting transitions — red displays flickering off, golden sunlight replacing them. Streets fill with people. Floating ring dark and still. City rebooting without masters. Sweeping aerial pullback, golden hour.`,
    },
    {
      id: 'S69',
      title: 'Final Wide — Sunrise',
      plot: 'Ultimate wide shot. City to horizon. Sunrise behind. No drones. A future unwritten.',
      prompt: `${WORLD} Ultimate wide shot of the entire megacity stretching to the horizon. Spectacular sunrise blazing behind the skyline — gold, orange, pink through smog. Sky empty of drones. Black tower dark, ring dead. Quiet, beautiful, free. Final shot, maximum scale, sunrise, hope.`,
    },
    {
      id: 'S70',
      title: 'Title Card — CYBER WAR',
      plot: 'Black. "CYBER WAR" in glowing cyan. "Every empire ends. Every story evolves." Fades.',
      prompt: `${WORLD} Black screen with faint digital particles. "CYBER WAR" materializes in large glowing cyan neon text, built from circuit lines. Below: "Every empire ends. Every story evolves." in white. Text pulses with energy, slowly fades. Title card, clean typography, cyan glow, cinematic end card.`,
    },
  ];
}

// ── On-chain with RPC retry ───────────────────────────────────────────
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
  // Retry task creation up to 3 times on fetch failure
  let taskId: string | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      log(label, attempt === 0 ? 'Generating...' : `Retrying generate (${attempt + 1}/3)...`);
      const taskRes = await fetch(`${BD_BASE}/contents/generations/tasks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${BYTEDANCE_API_KEY}`,
        },
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
      const data = (await taskRes.json()) as any;
      taskId = data.id;
      if (!taskId) throw new Error('No task ID');
      break;
    } catch (err: any) {
      log(label, `Attempt ${attempt + 1} failed: ${err.message?.slice(0, 60)}`);
      if (attempt < 2) await sleep(5000);
    }
  }
  if (!taskId) throw new Error('ByteDance task creation failed after 3 attempts');
  log(label, `Task: ${taskId}`);

  for (let i = 0; i < 60; i++) {
    await sleep(5000);
    try {
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
    } catch (pollErr: any) {
      if (pollErr.message?.includes('No video') || pollErr.message?.includes('failed'))
        throw pollErr;
    }
  }
  throw new Error('Timeout');
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

  // Retry on RPC 429
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
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
    } catch (err: any) {
      if (err.message?.includes('429') && attempt < 2) {
        log(label, `RPC rate limited — waiting 10s (attempt ${attempt + 1}/3)`);
        await sleep(10_000);
      } else {
        throw err;
      }
    }
  }
  throw new Error('RPC failed after 3 attempts');
}

// ── Main ──────────────────────────────────────────────────────────────
async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('  CYBER WAR — Full Film Generator (70 Scenes)');
  console.log('  Wiki-driven character consistency');
  console.log('  Seedance 2.0 → On-chain');
  console.log('═'.repeat(60));

  // 1. Pull character DNA from wiki
  await fetchCharacterDNA();

  // 2. Build scenes (uses wiki data in prompts)
  const SCENES = buildScenes();

  const latestId = (await publicClient.readContract({
    address: UNIVERSE_ADDR,
    abi: universeAbi,
    functionName: 'latestNodeId',
  })) as bigint;
  log('SETUP', `Chaining from node #${latestId}`);

  let previousId = latestId;
  let completed = 0;

  // Cleanup pass — only run the 7 missing scenes
  const TODO_IDS = new Set(['S48', 'S49', 'S59', 'S60', 'S61', 'S62', 'S63']);
  const DONE_IDS = new Set(SCENES.map((s) => s.id).filter((id) => !TODO_IDS.has(id)));

  for (let i = 0; i < SCENES.length; i++) {
    if (DONE_IDS.has(SCENES[i].id)) {
      log(SCENES[i].id, `Already done — skipping`);
      completed++;
      continue;
    }
    const scene = SCENES[i];
    const label = scene.id;

    console.log(`\n── ${scene.id}: ${scene.title} (${i + 1}/${SCENES.length}) ──`);

    // Retry whole scene up to 2 times
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const videoUrl = await generateVideo(scene.prompt, label);
        const contentHash = `cw-${scene.id}-${Date.now()}`;
        const nodeId = await createNode(contentHash, scene.plot, previousId, videoUrl, label);
        previousId = nodeId;
        completed++;
        log(label, `DONE — Node #${nodeId}`);
        break;
      } catch (err: any) {
        if (attempt === 0) {
          log(label, `FAILED (attempt 1): ${err.message?.slice(0, 100)} — retrying in 10s`);
          await sleep(10_000);
        } else {
          log(label, `FAILED (attempt 2): ${err.message?.slice(0, 100)} — skipping`);
        }
      }
    }

    if (i < SCENES.length - 1) await sleep(3000);
  }

  console.log('\n' + '═'.repeat(60));
  console.log(`  CYBER WAR FILM — ${completed}/${SCENES.length} scenes completed`);
  console.log(`  ~${completed * 10}s of footage`);
  console.log('═'.repeat(60));
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
