/**
 * CYBER WAR — Node Reorder Script
 *
 * The 70 scenes were deployed on-chain in two linear batches:
 *   Batch 1: S01-S18 (core beats)
 *   Batch 2: S19-S70 (detail/close-up/expansion shots)
 *
 * This script writes a canonical playback order to Firestore that interleaves
 * the shots into proper AAA film editing structure:
 *
 *   ACT 0  — COLD OPEN (world-building, atmosphere)
 *   ACT 1  — SETUP (characters, motivation, plan)
 *   ACT 2  — RISING ACTION (chase, combat, infiltration)
 *   ACT 3  — CLIMAX (confrontation, battle, sacrifice)
 *   ACT 4  — RESOLUTION (aftermath, dawn, hope)
 *
 * Saves to Firestore: universes/{id}/playbackOrder
 * Also updates localStorage schema for the frontend.
 *
 * Usage: pnpm tsx scripts/cyberwar-reorder-nodes.ts
 */
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { initializeApp, cert, type ServiceAccount } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// ── Firebase init ────────────────────────────────────────────────────────
const sa: ServiceAccount = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
};
const app = initializeApp({ credential: cert(sa) });
const db = getFirestore(app);

const UNIVERSE_ID = '0x341fFa19c0EC8D2C8eF42A360cf799949844262e';

// ══════════════════════════════════════════════════════════════════════════
// AAA FILM EDIT ORDER — 70 scenes interleaved for maximum cinematic impact
// ══════════════════════════════════════════════════════════════════════════
//
// Structure follows the Nolan/Villeneuve school:
//   - Atmosphere before exposition
//   - Character moments between action beats
//   - Escalating tension with breathers
//   - Emotional payoff before spectacle
//
const FILM_ORDER: Array<{
  sceneId: string;
  act: string;
  beat: string;
  title: string;
}> = [
  // ── ACT 0: COLD OPEN — Establish the world before any character ────────
  { sceneId: 'S01', act: 'ACT 0', beat: 'COLD OPEN', title: 'Megacity Skyline — Establishing' },
  { sceneId: 'S19', act: 'ACT 0', beat: 'COLD OPEN', title: 'City Rain — Close Up' },
  { sceneId: 'S20', act: 'ACT 0', beat: 'COLD OPEN', title: 'Billboard Propaganda' },
  { sceneId: 'S21', act: 'ACT 0', beat: 'COLD OPEN', title: 'Undercity Descent' },

  // ── ACT 1A: CHARACTER INTRODUCTIONS — Meet the heroes ──────────────────
  { sceneId: 'S02', act: 'ACT 1', beat: 'INTRO', title: 'Safehouse — Nova at Console' },
  { sceneId: 'S22', act: 'ACT 1', beat: 'INTRO', title: 'Nova Close-Up — Eye Tattoo' },
  { sceneId: 'S03', act: 'ACT 1', beat: 'INTRO', title: 'Safehouse — Orin Loads Up' },
  { sceneId: 'S23', act: 'ACT 1', beat: 'INTRO', title: "Orin's Cybernetic Arm — Detail" },
  { sceneId: 'S24', act: 'ACT 1', beat: 'PLANNING', title: 'Safehouse War Table' },

  // ── ACT 1B: ECHO & THE BRIEFING — The wild card enters ────────────────
  { sceneId: 'S04', act: 'ACT 1', beat: 'ECHO INTRO', title: 'Echo Appears — The Briefing' },
  { sceneId: 'S25', act: 'ACT 1', beat: 'ECHO INTRO', title: 'Echo Materializes — Full Body' },
  { sceneId: 'S26', act: 'ACT 1', beat: 'ECHO INTRO', title: 'Echo Close-Up — Violet Eyes' },
  { sceneId: 'S27', act: 'ACT 1', beat: 'ECHO INTRO', title: "Orin's Reaction to Echo" },
  { sceneId: 'S28', act: 'ACT 1', beat: 'LAUNCH', title: 'Nova Decides — Stand Up' },

  // ── ACT 2A: THE CHASE — Hoverbike pursuit through neon rain ────────────
  { sceneId: 'S05', act: 'ACT 2', beat: 'CHASE', title: 'Hoverbike Launch' },
  { sceneId: 'S29', act: 'ACT 2', beat: 'CHASE', title: 'Bike POV — Tunnel Speed' },
  { sceneId: 'S30', act: 'ACT 2', beat: 'CHASE', title: 'Side-by-Side Riding' },
  { sceneId: 'S31', act: 'ACT 2', beat: 'CHASE', title: 'Drone Swarm Descends' },

  // ── ACT 2B: DRONE COMBAT — First real test ────────────────────────────
  { sceneId: 'S06', act: 'ACT 2', beat: 'DRONE FIGHT', title: 'Drone Attack' },
  { sceneId: 'S32', act: 'ACT 2', beat: 'DRONE FIGHT', title: 'Echo Hacks Drones — Digital View' },
  { sceneId: 'S33', act: 'ACT 2', beat: 'DRONE FIGHT', title: 'Orin Fires — Cybernetic Arm' },
  { sceneId: 'S34', act: 'ACT 2', beat: 'DRONE FIGHT', title: 'Nova Blade Slash — Slow Motion' },
  { sceneId: 'S35', act: 'ACT 2', beat: 'DRONE FIGHT', title: 'Bike Crash and Roll' },
  { sceneId: 'S07', act: 'ACT 2', beat: 'DRONE FIGHT', title: 'Spider Drone Fight' },
  { sceneId: 'S36', act: 'ACT 2', beat: 'DRONE FIGHT', title: 'Spider Drone Transform — Detail' },

  // ── ACT 2C: TOWER INFILTRATION — Into the belly of the beast ──────────
  { sceneId: 'S08', act: 'ACT 2', beat: 'TOWER', title: 'Tower Approach' },
  { sceneId: 'S37', act: 'ACT 2', beat: 'TOWER', title: 'Tower Base — Security Grid' },
  { sceneId: 'S09', act: 'ACT 2', beat: 'TOWER', title: 'Climbing the Shaft' },
  { sceneId: 'S38', act: 'ACT 2', beat: 'TOWER', title: 'Shaft Fight — Vertical Combat' },
  { sceneId: 'S39', act: 'ACT 2', beat: 'TOWER', title: 'Orin Catches Nova' },
  { sceneId: 'S40', act: 'ACT 2', beat: 'TOWER', title: 'Echo Guides — Holographic Map' },
  { sceneId: 'S10', act: 'ACT 2', beat: 'TOWER', title: 'EMP Disc Fight' },
  { sceneId: 'S41', act: 'ACT 2', beat: 'TOWER', title: 'Corridor Run — Red Emergency' },
  { sceneId: 'S42', act: 'ACT 2', beat: 'TOWER', title: 'Core Chamber Door Opens' },

  // ── ACT 3A: VILLAIN REVEAL & CONFRONTATION ────────────────────────────
  { sceneId: 'S11', act: 'ACT 3', beat: 'VILLAIN', title: 'Voss Revealed' },
  { sceneId: 'S43', act: 'ACT 3', beat: 'VILLAIN', title: 'Voss Close-Up — Cold Eyes' },
  { sceneId: 'S44', act: 'ACT 3', beat: 'VILLAIN', title: 'War Core — Close Up Surface' },
  { sceneId: 'S12', act: 'ACT 3', beat: 'CONFRONTATION', title: 'The Confrontation' },
  { sceneId: 'S45', act: 'ACT 3', beat: 'CONFRONTATION', title: 'Voss Speech — "Truth"' },
  {
    sceneId: 'S46',
    act: 'ACT 3',
    beat: 'CONFRONTATION',
    title: "Nova's Mother Revelation — Flashback",
  },
  { sceneId: 'S47', act: 'ACT 3', beat: 'CONFRONTATION', title: 'Echo Reacts — Fear' },
  { sceneId: 'S48', act: 'ACT 3', beat: 'CONFRONTATION', title: 'Nova Steps Forward — Blade Draw' },

  // ── ACT 3B: THE BATTLE — Full-scale war in the core chamber ───────────
  { sceneId: 'S13', act: 'ACT 3', beat: 'BATTLE', title: 'Battle Begins — Tendrils' },
  { sceneId: 'S49', act: 'ACT 3', beat: 'BATTLE', title: 'Tendrils Erupt — Wide Shot' },
  { sceneId: 'S50', act: 'ACT 3', beat: 'BATTLE', title: 'Echo Copies Scatter' },
  { sceneId: 'S51', act: 'ACT 3', beat: 'BATTLE', title: 'Orin Tears Turret' },
  { sceneId: 'S14', act: 'ACT 3', beat: 'BLADE FIGHT', title: 'Nova vs Voss — Blade Fight' },
  { sceneId: 'S52', act: 'ACT 3', beat: 'BLADE FIGHT', title: 'Blade vs Staff — Clash Close-Up' },
  { sceneId: 'S53', act: 'ACT 3', beat: 'BLADE FIGHT', title: 'Voss Kicks Nova' },
  { sceneId: 'S54', act: 'ACT 3', beat: 'BLADE FIGHT', title: 'Orin Charges Voss' },

  // ── ACT 3C: CLIMAX — The sacrifice ────────────────────────────────────
  { sceneId: 'S15', act: 'ACT 3', beat: 'CLIMAX', title: 'Nova Reaches the Core' },
  { sceneId: 'S55', act: 'ACT 3', beat: 'CLIMAX', title: 'Nova Sprints to Core' },
  { sceneId: 'S56', act: 'ACT 3', beat: 'CLIMAX', title: 'Hand on Core — Transformation' },
  { sceneId: 'S16', act: 'ACT 3', beat: 'SACRIFICE', title: "Echo's Sacrifice" },
  { sceneId: 'S57', act: 'ACT 3', beat: 'SACRIFICE', title: 'Echo Becomes Human' },
  { sceneId: 'S58', act: 'ACT 3', beat: 'SACRIFICE', title: 'Echo Enters Core — Violet Blast' },

  // ── ACT 4: AFTERMATH — The world without chains ───────────────────────
  { sceneId: 'S59', act: 'ACT 4', beat: 'AFTERMATH', title: 'Drones Fall — City Wide' },
  { sceneId: 'S17', act: 'ACT 4', beat: 'AFTERMATH', title: 'The Aftermath' },
  { sceneId: 'S60', act: 'ACT 4', beat: 'AFTERMATH', title: 'Voss on Knees' },
  { sceneId: 'S61', act: 'ACT 4', beat: 'GRIEF', title: 'Blue Embers Float' },
  { sceneId: 'S62', act: 'ACT 4', beat: 'GRIEF', title: 'Nova and Orin — Quiet Moment' },

  // ── ACT 4B: DAWN — Hope returns ───────────────────────────────────────
  { sceneId: 'S63', act: 'ACT 4', beat: 'DAWN', title: 'Sunrise Through Smog' },
  { sceneId: 'S64', act: 'ACT 4', beat: 'DAWN', title: 'People Emerge — Streets' },
  { sceneId: 'S18', act: 'ACT 4', beat: 'DAWN', title: 'Rooftop Dawn — New Beginning' },
  { sceneId: 'S65', act: 'ACT 4', beat: 'DAWN', title: 'Nova Rooftop — Wind in Hair' },
  { sceneId: 'S66', act: 'ACT 4', beat: 'STINGER', title: "Echo's Signal — Wrist Console" },
  { sceneId: 'S67', act: 'ACT 4', beat: 'STINGER', title: 'Orin Smiles' },

  // ── FINALE ─────────────────────────────────────────────────────────────
  { sceneId: 'S68', act: 'FINALE', beat: 'PULLBACK', title: 'City Waking — Aerial' },
  { sceneId: 'S69', act: 'FINALE', beat: 'PULLBACK', title: 'Final Wide — City and Sunrise' },
  { sceneId: 'S70', act: 'FINALE', beat: 'TITLE', title: 'Title Card — CYBER WAR' },
];

// ── Main ─────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('  CYBER WAR — AAA Film Reorder');
  console.log(`  ${FILM_ORDER.length} scenes in cinematic edit order`);
  console.log('═'.repeat(60));

  // Build the playback order document
  const playbackOrder = FILM_ORDER.map((entry, index) => ({
    position: index,
    sceneId: entry.sceneId,
    act: entry.act,
    beat: entry.beat,
    title: entry.title,
  }));

  // Print the edit for review
  let currentAct = '';
  for (const entry of playbackOrder) {
    if (entry.act !== currentAct) {
      currentAct = entry.act;
      console.log(`\n  ── ${currentAct} ${'─'.repeat(45 - currentAct.length)}`);
    }
    const pos = String(entry.position + 1).padStart(2, ' ');
    console.log(`  ${pos}. [${entry.sceneId}] ${entry.title.padEnd(42)} (${entry.beat})`);
  }

  // Save to Firestore
  const docRef = db.collection('universes').doc(UNIVERSE_ID);

  // Check if universe doc exists
  const doc = await docRef.get();
  if (!doc.exists) {
    console.log('\n  Creating universe document...');
    await docRef.set({
      id: UNIVERSE_ID,
      address: UNIVERSE_ID,
      name: 'Cyber War',
      playbackOrder,
      playbackOrderUpdatedAt: new Date().toISOString(),
    });
  } else {
    console.log('\n  Updating existing universe document...');
    await docRef.update({
      playbackOrder,
      playbackOrderUpdatedAt: new Date().toISOString(),
    });
  }

  // Also save scene metadata for the frontend to label nodes properly
  const sceneMetadata: Record<
    string,
    { position: number; act: string; beat: string; title: string }
  > = {};
  for (const entry of playbackOrder) {
    sceneMetadata[entry.sceneId] = {
      position: entry.position,
      act: entry.act,
      beat: entry.beat,
      title: entry.title,
    };
  }

  await docRef.update({
    sceneMetadata,
  });

  console.log('\n  Saved to Firestore:');
  console.log(`    universes/${UNIVERSE_ID}.playbackOrder (${playbackOrder.length} entries)`);
  console.log(`    universes/${UNIVERSE_ID}.sceneMetadata`);

  // Summary
  const acts = new Map<string, number>();
  for (const e of playbackOrder) {
    acts.set(e.act, (acts.get(e.act) || 0) + 1);
  }
  console.log('\n  Act breakdown:');
  for (const [act, count] of acts) {
    console.log(`    ${act}: ${count} scenes (~${count * 10}s)`);
  }
  console.log(
    `\n  Total: ${playbackOrder.length} scenes, ~${playbackOrder.length * 10}s (~${Math.round((playbackOrder.length * 10) / 60)} min)`
  );
  console.log('\n  Done!\n');
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
