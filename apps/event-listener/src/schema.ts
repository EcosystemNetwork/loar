/**
 * Firestore entity types. 1:1 port of apps/indexer/ponder.schema.ts.
 *
 * BigInts are stored as strings to preserve precision (Firestore has no native
 * bigint). Addresses are lowercase hex, normalized at the handler boundary so
 * downstream readers can case-insensitively compare without surprise.
 *
 * Every persisted record carries a small idempotency envelope (`_event`) with
 * the chain id, block hash, block number, and the logical event id. This lets
 * the re-org handler delete records by blockHash without touching app data
 * derived from them.
 */
import type { Timestamp } from 'firebase-admin/firestore';

export type Hex = `0x${string}`;

export interface EventEnvelope {
  /** Chain id (11155111 sepolia, 84532 base-sepolia, 8453 base). */
  chainId: number;
  /** Block number the event was emitted in. */
  blockNumber: number;
  /** Block hash for re-org detection. */
  blockHash: Hex;
  /** Transaction hash. */
  txHash: Hex;
  /** Log index within the transaction. */
  logIndex: number;
  /** True while block is within finalityDepth of head. */
  unconfirmed: boolean;
  /** Server write time for ops. */
  indexedAt: Timestamp | FirebaseFirestore.FieldValue;
}

/** Doc stored per-chain at `indexerCheckpoints/{chain}`. */
export interface IndexerCheckpoint {
  chain: string; // 'sepolia' | 'base-sepolia' | 'base'
  chainId: number;
  lastBlockIndexed: number;
  lastBlockFinalized: number;
  headBlockKnown: number;
  updatedAt: Timestamp | FirebaseFirestore.FieldValue;
}

/** Factory-spawned child address registry. */
export interface FactoryChild {
  chain: string;
  factoryAddress: Hex; // the UniverseManager
  childAddress: Hex; // spawned contract
  kind: 'universe' | 'governor' | 'token' | 'bondingCurve';
  parentUniverse?: Hex; // back-link for per-universe children
  createdAtBlock: number;
  createdAt: number; // unix seconds
}

// ── Port of ponder.schema.ts ──────────────────────────────────────────

export interface Universe {
  id: Hex; // universe address (lowercase)
  universeId: number | null;
  creator: Hex;
  createdAt: number;
  name: string;
  description: string;
  imageURL: string;
  tokenAddress: Hex | null;
  governorAddress: Hex | null;
  nodeCount: number;
  _event: EventEnvelope;
}

export interface Token {
  id: Hex; // token address (lowercase)
  universeAddress: Hex;
  deployer: Hex;
  tokenAdmin: Hex;
  name: string;
  symbol: string;
  imageURL: string;
  metadata: string;
  context: string;
  startingTick: string;
  poolHook: Hex;
  poolId: Hex;
  pairedToken: Hex;
  locker: Hex;
  createdAt: number;
  _event: EventEnvelope;
}

export interface BondingCurve {
  id: Hex; // bonding curve contract address (lowercase)
  tokenAddress: Hex;
  universeId: number;
  graduationEth: string;
  curveSupply: string;
  graduated: boolean;
  graduatedAt: number | null;
  createdAt: number;
  tradingStatus: 'active' | 'halted' | 'graduated';
  tradingStatusUpdatedAt: number | null;
  tokensSold: string; // bigint as string
  ethRaised: string;
  lastPrice: string;
  tradeCount: number;
  pendingRefundsTotal: string;
  _event: EventEnvelope;
}

export interface BondingCurveTrade {
  id: string; // txHash:logIndex
  bondingCurve: Hex;
  trader: Hex;
  isBuy: boolean;
  ethAmount: string;
  tokenAmount: string;
  price: string;
  timestamp: number;
  _event: EventEnvelope;
}

export interface BondingCurveSnapshot {
  id: string; // txHash:logIndex:snap
  bondingCurve: Hex;
  blockNumber: number;
  timestamp: number;
  tokensSold: string;
  ethRaised: string;
  price: string;
  trigger: 'buy' | 'sell' | 'graduate';
  _event: EventEnvelope;
}

export interface BondingCurveRefund {
  id: string; // bondingCurve:buyer (both lowercase)
  bondingCurve: Hex;
  buyer: Hex;
  amount: string;
  pendingSince: number;
  claimedAt: number | null;
  lastEventId: string;
  _event: EventEnvelope;
}

export interface BondingCurveHaltEvent {
  id: string; // txHash:logIndex(:grad)
  bondingCurve: Hex;
  universeId: number;
  halted: boolean;
  source: 'manager' | 'graduation';
  timestamp: number;
  blockNumber: number;
  _event: EventEnvelope;
}

export interface HookEvent {
  id: string;
  timestamp: number;
  hook_address: Hex;
  enabled: boolean;
  _event: EventEnvelope;
}

export interface IndexerNode {
  id: string; // universeAddress:nodeId
  universeAddress: Hex;
  nodeId: number;
  previousNodeId: number;
  creator: Hex;
  createdAt: number;
  contentHash: Hex | null;
  plotHash: Hex | null;
  _event: EventEnvelope;
}

export interface NodeCanonization {
  id: string;
  universeAddress: Hex;
  nodeId: number;
  canonizer: Hex;
  timestamp: number;
  _event: EventEnvelope;
}

export interface NodeContent {
  id: string; // universeAddress:nodeId
  contentHash: Hex | null;
  plotHash: Hex | null;
  videoLink: string;
  plot: string;
  _event: EventEnvelope;
}

export interface TokenTransfer {
  id: string;
  tokenAddress: Hex;
  from: Hex;
  to: Hex;
  value: string;
  timestamp: number;
  blockNumber: number;
  _event: EventEnvelope;
}

export interface TokenHolder {
  id: string; // tokenAddress:holderAddress
  tokenAddress: Hex;
  holderAddress: Hex;
  balance: string;
  _event: EventEnvelope;
}

export interface Pool {
  poolId: Hex;
  currency0: Hex;
  currency1: Hex;
  fee: number;
  tickSpacing: number;
  hooks: Hex;
  sqrtPriceX96: string | null;
  tick: number | null;
  creationBlock: number;
  _event: EventEnvelope;
}

export interface Swap {
  id: string;
  poolId: Hex;
  sender: Hex;
  amount0: string;
  amount1: string;
  sqrtPriceX96: string;
  liquidity: string;
  tick: number;
  timestamp: number;
  blockNumber: number;
  _event: EventEnvelope;
}

export interface Proposal {
  id: string; // proposalId
  governorAddress: Hex;
  universeAddress: Hex | null;
  proposer: Hex;
  targets: string; // JSON
  values: string; // JSON
  calldatas: string; // JSON
  description: string;
  startBlock: number;
  endBlock: number;
  createdAt: number;
  executed: boolean;
  cancelled: boolean;
  _event: EventEnvelope;
}

export interface ProposalExecution {
  id: string;
  proposalId: string;
  governorAddress: Hex;
  timestamp: number;
  _event: EventEnvelope;
}

export interface ProposalCancellation {
  id: string;
  proposalId: string;
  governorAddress: Hex;
  timestamp: number;
  _event: EventEnvelope;
}

export interface Vote {
  id: string; // proposalId:voter
  proposalId: string;
  governorAddress: Hex;
  voter: Hex;
  support: number;
  weight: string;
  reason: string | null;
  timestamp: number;
  _event: EventEnvelope;
}

export interface CanonSubmission {
  id: string;
  universeId: number;
  universeToken: Hex;
  submissionType: number;
  status: number;
  creator: Hex;
  contentHash: Hex;
  metadataURI: string;
  submissionFee: string;
  votesFor: string;
  votesAgainst: string;
  votingDeadline: number;
  createdAt: number;
  finalizedAt: number | null;
  _event: EventEnvelope;
}

export interface CanonVote {
  id: string; // submissionId:voter
  submissionId: number;
  voter: Hex;
  support: boolean;
  weight: string;
  timestamp: number;
  _event: EventEnvelope;
}

export interface License {
  id: string;
  universeId: number;
  licenseType: number;
  status: number;
  licensor: Hex;
  licensee: Hex;
  upfrontFee: string;
  royaltyBps: number;
  totalRoyalties: string;
  startTime: number | null;
  endTime: number | null;
  createdAt: number;
  _event: EventEnvelope;
}

export interface Collab {
  id: string;
  universeA: number;
  universeB: number;
  proposer: Hex;
  acceptor: Hex | null;
  status: number;
  revenueShareBps: number;
  totalRevenue: string;
  episodeCount: number;
  startTime: number | null;
  endTime: number | null;
  createdAt: number;
  _event: EventEnvelope;
}

// ── Collection names ────────────────────────────────────────────────────
// Single source of truth — handlers and readers (tRPC router) import these
// so a rename propagates without grep-and-replace.

export const COLLECTIONS = {
  universes: 'indexer_universes',
  tokens: 'indexer_tokens',
  bondingCurves: 'indexer_bondingCurves',
  bondingCurveTrades: 'indexer_bondingCurveTrades',
  bondingCurveSnapshots: 'indexer_bondingCurveSnapshots',
  bondingCurveRefunds: 'indexer_bondingCurveRefunds',
  bondingCurveHaltEvents: 'indexer_bondingCurveHaltEvents',
  hookEvents: 'indexer_hookEvents',
  nodes: 'indexer_nodes',
  nodeCanonizations: 'indexer_nodeCanonizations',
  episodeCanonizations: 'indexer_episodeCanonizations',
  nodeContents: 'indexer_nodeContents',
  tokenTransfers: 'indexer_tokenTransfers',
  tokenHolders: 'indexer_tokenHolders',
  pools: 'indexer_pools',
  swaps: 'indexer_swaps',
  proposals: 'indexer_proposals',
  proposalExecutions: 'indexer_proposalExecutions',
  proposalCancellations: 'indexer_proposalCancellations',
  votes: 'indexer_votes',
  canonSubmissions: 'indexer_canonSubmissions',
  canonVotes: 'indexer_canonVotes',
  licenses: 'indexer_licenses',
  collabs: 'indexer_collabs',
  checkpoints: 'indexer_checkpoints',
  factoryChildren: 'indexer_factoryChildren',
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];
