/**
 * Realms / SPL Governance adapter — per-universe DAOs on Solana.
 *
 * Each universe gets its own Realm whose governance token is the
 * bonding-curve-minted universe SPL. Server-side flows:
 *   - Server-driven realm creation (one-time per universe)
 *   - User-driven votes on proposals (the load-bearing flow)
 *   - Read proposal/realm records
 *
 * NOTE: this adapter is for **treasury / parameter governance**. Content
 * canon decisions live in `canon_market` and are separate by design.
 *
 * The real `@solana/spl-governance` API is functional — `with*` helpers
 * mutate an instructions array, then we hand the array to Circle DCW for
 * signing via `executeSolanaTransaction`.
 *
 * Required env:
 *   REALMS_PROGRAM_ID — optional override (defaults from native-registry)
 */
import { PublicKey, type TransactionInstruction, SystemProgram } from '@solana/web3.js';
import BN from 'bn.js';
import { sendNativeTx, resolveUserSolanaWallet } from './native-base';
import { getSolanaConnection, isCircleSolanaConfigured } from './circle-solana';
import { getRealmsProgramId } from './native-registry';

export function isRealmsConfigured(): boolean {
  return isCircleSolanaConfigured();
}

// ── SDK shim types (minimal subset we use) ─────────────────────────────────

interface MintMaxVoteWeightSource {
  type: 'SupplyFraction' | 'Absolute';
  value: BN;
}

interface GovernanceTokenConfig {
  voterWeightAddin?: PublicKey;
  maxVoterWeightAddin?: PublicKey;
  tokenType: 0 | 1 | 2; // Liquid / Membership / Dormant
}

interface VoteShim {
  // SPL governance v3 vote shape: Yes/No discriminated union with vote-weight per option.
  voteType: 'Approve' | 'Deny';
  approveChoices?: { rank: number; weightPercentage: number }[];
}

interface SplGovernanceSdk {
  withCreateRealm(
    instructions: TransactionInstruction[],
    programId: PublicKey,
    programVersion: number,
    name: string,
    realmAuthority: PublicKey,
    communityMint: PublicKey,
    payer: PublicKey,
    councilMint: PublicKey | undefined,
    communityMintMaxVoteWeightSource: MintMaxVoteWeightSource,
    minCommunityWeightToCreateGovernance: BN,
    communityTokenConfig?: GovernanceTokenConfig,
    councilTokenConfig?: GovernanceTokenConfig
  ): Promise<PublicKey>; // returns realm PDA
  withCastVote(
    instructions: TransactionInstruction[],
    programId: PublicKey,
    programVersion: number,
    realm: PublicKey,
    governance: PublicKey,
    proposal: PublicKey,
    proposalOwnerRecord: PublicKey,
    tokenOwnerRecord: PublicKey,
    governanceAuthority: PublicKey,
    voteGoverningTokenMint: PublicKey,
    vote: VoteShim,
    payer: PublicKey,
    voterWeightRecord?: PublicKey,
    maxVoterWeightRecord?: PublicKey
  ): Promise<PublicKey>; // returns vote record PDA
  withCreateTokenOwnerRecord(
    instructions: TransactionInstruction[],
    programId: PublicKey,
    programVersion: number,
    realm: PublicKey,
    owner: PublicKey,
    governingTokenMint: PublicKey,
    payer: PublicKey
  ): Promise<PublicKey>;
  getRealm(
    connection: import('@solana/web3.js').Connection,
    realm: PublicKey
  ): Promise<{
    account: { name: string; authority: PublicKey | null; communityMint: PublicKey };
  } | null>;
  getProposal(
    connection: import('@solana/web3.js').Connection,
    proposal: PublicKey
  ): Promise<{
    account: {
      state: number;
      yesVotesCount?: BN;
      noVotesCount?: BN;
      governance: PublicKey;
      votingAt?: BN | null;
      votingCompletedAt?: BN | null;
    };
  } | null>;
  getGovernanceProgramVersion(
    connection: import('@solana/web3.js').Connection,
    programId: PublicKey
  ): Promise<number>;
  // PDA helpers
  getTokenOwnerRecordAddress(
    programId: PublicKey,
    realm: PublicKey,
    governingTokenMint: PublicKey,
    governingTokenOwner: PublicKey
  ): Promise<PublicKey>;
}

let _sdk: SplGovernanceSdk | null = null;
let _programVersion: number | null = null;

async function loadSdk(): Promise<SplGovernanceSdk> {
  if (_sdk) return _sdk;
  try {
    const mod = (await import('@solana/spl-governance' as never)) as unknown as SplGovernanceSdk;
    _sdk = mod;
    return _sdk;
  } catch (e) {
    throw new Error(
      `@solana/spl-governance not available. Run \`pnpm add @solana/spl-governance\` in apps/server. (${
        e instanceof Error ? e.message : String(e)
      })`
    );
  }
}

async function getProgramVersion(): Promise<number> {
  if (_programVersion !== null) return _programVersion;
  const sdk = await loadSdk();
  const conn = getSolanaConnection();
  _programVersion = await sdk.getGovernanceProgramVersion(conn, getRealmsProgramId());
  return _programVersion;
}

// ── Create realm for a universe ─────────────────────────────────────────────

export interface CreateRealmArgs {
  /** Admin user (LOAR-side identity). Will be the realm authority initially. */
  adminUserId: string;
  /** Governance token mint — typically the universe's bonding-curve token. */
  governanceToken: PublicKey;
  /** Human-readable realm name. Max 32 chars per Realms convention. */
  name: string;
  /** Minimum tokens to create a governance proposal. */
  minCommunityTokensToCreateGovernance: bigint;
}

export interface CreateRealmResult {
  txId: string;
  signature?: string;
  realmAddress: string;
  state: string;
}

export async function createRealmForUniverse(args: CreateRealmArgs): Promise<CreateRealmResult> {
  if (!isRealmsConfigured()) throw new Error('realms not configured');
  if (args.name.length > 32) throw new Error('realm name must be ≤ 32 chars');

  const wallet = await resolveUserSolanaWallet(args.adminUserId);
  const sdk = await loadSdk();
  const programId = getRealmsProgramId();
  const version = await getProgramVersion();

  const instructions: TransactionInstruction[] = [];
  const realmAddress = await sdk.withCreateRealm(
    instructions,
    programId,
    version,
    args.name,
    wallet.pubkey, // realm authority
    args.governanceToken, // community mint
    wallet.pubkey, // payer
    undefined, // no council mint for v1
    { type: 'SupplyFraction', value: new BN('10000000000') }, // 100% in 10^10 fraction
    new BN(args.minCommunityTokensToCreateGovernance.toString()),
    { tokenType: 0 }, // Liquid community token
    undefined
  );

  const result = await sendNativeTx({
    userId: args.adminUserId,
    instructions,
    computeUnitLimit: 400_000,
  });

  return {
    txId: result.txId,
    signature: result.signature,
    realmAddress: realmAddress.toBase58(),
    state: result.state,
  };
}

// ── Cast vote ───────────────────────────────────────────────────────────────

export interface CastVoteArgs {
  voterUserId: string;
  realm: PublicKey;
  governance: PublicKey;
  proposal: PublicKey;
  /** The proposal's owner's TokenOwnerRecord PDA (NOT the voter's). */
  proposalOwnerRecord: PublicKey;
  /** The community/council mint used for this vote. */
  governingTokenMint: PublicKey;
  /** true = approve, false = deny. */
  approve: boolean;
}

export async function castVote(
  args: CastVoteArgs
): Promise<{ txId: string; signature?: string; state: string }> {
  if (!isRealmsConfigured()) throw new Error('realms not configured');
  const wallet = await resolveUserSolanaWallet(args.voterUserId);
  const sdk = await loadSdk();
  const programId = getRealmsProgramId();
  const version = await getProgramVersion();

  // The voter's TokenOwnerRecord may or may not exist. To be defensive,
  // ensure it's created in the same tx if missing — `withCreateTokenOwnerRecord`
  // is idempotent (succeeds when the PDA already exists).
  const instructions: TransactionInstruction[] = [];
  const voterTokenOwnerRecord = await sdk.getTokenOwnerRecordAddress(
    programId,
    args.realm,
    args.governingTokenMint,
    wallet.pubkey
  );

  // Best-effort create — Realms will revert if it exists; we ignore that and
  // continue with the vote. Real impl: probe getAccountInfo before adding.
  const conn = getSolanaConnection();
  const torExists = await conn.getAccountInfo(voterTokenOwnerRecord, 'confirmed');
  if (!torExists) {
    await sdk.withCreateTokenOwnerRecord(
      instructions,
      programId,
      version,
      args.realm,
      wallet.pubkey,
      args.governingTokenMint,
      wallet.pubkey
    );
  }

  await sdk.withCastVote(
    instructions,
    programId,
    version,
    args.realm,
    args.governance,
    args.proposal,
    args.proposalOwnerRecord,
    voterTokenOwnerRecord,
    wallet.pubkey, // governanceAuthority (voter)
    args.governingTokenMint,
    args.approve
      ? { voteType: 'Approve', approveChoices: [{ rank: 0, weightPercentage: 100 }] }
      : { voteType: 'Deny' },
    wallet.pubkey // payer
  );

  return sendNativeTx({
    userId: args.voterUserId,
    instructions,
    computeUnitLimit: 400_000,
  });
}

// ── Read ────────────────────────────────────────────────────────────────────

export interface DecodedProposal {
  address: string;
  governance: string;
  state: number;
  yesVotes: bigint;
  noVotes: bigint;
  votingAt: number | null;
  votingCompletedAt: number | null;
}

export async function readProposal(proposal: PublicKey): Promise<DecodedProposal | null> {
  const sdk = await loadSdk();
  const conn = getSolanaConnection();
  const r = await sdk.getProposal(conn, proposal);
  if (!r) return null;
  return {
    address: proposal.toBase58(),
    governance: r.account.governance.toBase58(),
    state: r.account.state,
    yesVotes: BigInt(r.account.yesVotesCount?.toString() ?? '0'),
    noVotes: BigInt(r.account.noVotesCount?.toString() ?? '0'),
    votingAt: r.account.votingAt ? Number(r.account.votingAt) : null,
    votingCompletedAt: r.account.votingCompletedAt ? Number(r.account.votingCompletedAt) : null,
  };
}

export interface DecodedRealm {
  address: string;
  name: string;
  authority: string | null;
  communityMint: string;
}

export async function readRealm(realm: PublicKey): Promise<DecodedRealm | null> {
  const sdk = await loadSdk();
  const conn = getSolanaConnection();
  const r = await sdk.getRealm(conn, realm);
  if (!r) return null;
  return {
    address: realm.toBase58(),
    name: r.account.name,
    authority: r.account.authority ? r.account.authority.toBase58() : null,
    communityMint: r.account.communityMint.toBase58(),
  };
}

// Reference so SystemProgram isn't unused (it's loaded for tree-shaking guards).
void SystemProgram;
