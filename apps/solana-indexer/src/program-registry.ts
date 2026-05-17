/**
 * Central registry of LOAR Anchor programs for the indexer.
 *
 * Adding a new program (rights, licensing, marketplace, …) is a single-line
 * change here once its IDL is emitted by `anchor build`. The decoder + router
 * pick it up automatically — no per-program hand-rolled borsh.
 *
 * Program ID resolution order:
 *   1. Env var (mainnet override differs from committed devnet IDL.address)
 *   2. IDL.address (devnet default committed to repo)
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BorshEventCoder, type Idl } from '@coral-xyz/anchor';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadIdl(name: string): Idl {
  const path = resolve(__dirname, '../../programs/target/idl/', `${name}.json`);
  return JSON.parse(readFileSync(path, 'utf8')) as Idl;
}

export interface RegisteredProgram {
  /** Short name from IDL.metadata.name. */
  name: string;
  /** Program ID on-chain (env override → IDL.address fallback). */
  programId: string;
  /** Full IDL. */
  idl: Idl;
  /** Per-program event decoder. */
  events: BorshEventCoder;
}

function registerProgram(name: string, envVar: string): RegisteredProgram {
  const idl = loadIdl(name);
  // IDL.address is present in Anchor 0.30+ IDLs; cast to access the field
  // since the published Idl type doesn't include it in older anchor versions.
  const idlAddress = (idl as { address?: string }).address;
  const programId = process.env[envVar] || idlAddress || '';
  if (!programId) {
    throw new Error(
      `Program "${name}" has no programId — set ${envVar} or include "address" in IDL`
    );
  }
  return { name, programId, idl, events: new BorshEventCoder(idl) };
}

export const PROGRAMS: RegisteredProgram[] = [
  registerProgram('universe', 'UNIVERSE_PROGRAM_ID'),
  registerProgram('episode', 'EPISODE_PROGRAM_ID'),
  registerProgram('payment', 'PAYMENT_PROGRAM_ID'),
  registerProgram('rights', 'RIGHTS_PROGRAM_ID'),
  registerProgram('licensing', 'LICENSING_PROGRAM_ID'),
  registerProgram('split_router', 'SPLIT_ROUTER_PROGRAM_ID'),
  registerProgram('staking', 'STAKING_PROGRAM_ID'),
  registerProgram('credit_manager', 'CREDIT_MANAGER_PROGRAM_ID'),
  registerProgram('subscription', 'SUBSCRIPTION_PROGRAM_ID'),
  registerProgram('remix_fees', 'REMIX_FEES_PROGRAM_ID'),
  registerProgram('bonding_curve', 'BONDING_CURVE_PROGRAM_ID'),
  registerProgram('canon_market', 'CANON_MARKET_PROGRAM_ID'),
  registerProgram('fee_locker', 'FEE_LOCKER_PROGRAM_ID'),
  registerProgram('premium_actions', 'LOAR_BURNER_PROGRAM_ID'),
  registerProgram('collab_manager', 'COLLAB_MANAGER_PROGRAM_ID'),
];

export const PROGRAM_BY_ID: ReadonlyMap<string, RegisteredProgram> = new Map(
  PROGRAMS.map((p) => [p.programId, p])
);

export const KNOWN_PROGRAM_IDS: ReadonlySet<string> = new Set(PROGRAMS.map((p) => p.programId));

export function findProgram(programId: string): RegisteredProgram | undefined {
  return PROGRAM_BY_ID.get(programId);
}
