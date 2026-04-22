/**
 * Shared handler context and dispatch types.
 *
 * A handler is keyed by `eventKey` — a string of the form
 * `"<ContractKind>:<EventName>"` mirroring Ponder's handler naming
 * (`ponder.on('UniverseManager:UniverseCreated', ...)`). The dispatch layer
 * looks up the handler by event signature topic hash and contract kind (for
 * factory-spawned dynamic contracts).
 *
 * The context object matches the arguments Ponder gave handlers as closely as
 * practical so the port from `apps/indexer/src/index.ts` can be nearly
 * mechanical.
 */
import type { Log, PublicClient, Abi, AbiEvent, DecodeEventLogReturnType } from 'viem';
import type { Batcher } from '../batcher.js';
import type { EventEnvelope, Hex } from '../schema.js';

export type ContractKind =
  | 'UniverseManager'
  | 'Universe'
  | 'UniverseGovernor'
  | 'GovernanceToken'
  | 'BondingCurve'
  | 'PoolManager'
  | 'CanonMarketplace'
  | 'LicensingRegistry'
  | 'CollabManager';

export interface HandlerCtx<TArgs = unknown> {
  /** Raw viem log — available for unusual cases where decoded args aren't enough. */
  log: Log;
  /** Decoded event args (typed by caller). */
  args: TArgs;
  /** Contract address the event was emitted from (lowercase). */
  address: Hex;
  /** Block metadata. */
  block: { number: number; hash: Hex; timestamp: number };
  /** Transaction hash. */
  txHash: Hex;
  /** Log index within the transaction. */
  logIndex: number;
  /** Deterministic event id (`${txHash}:${logIndex}`). */
  eventId: string;
  /** Event envelope to attach to every document we write from this handler. */
  envelope: EventEnvelope;
  /** Batcher to stage writes — caller commits at the end of the block range. */
  batcher: Batcher;
  /** Viem client for on-chain reads (contract views). */
  client: PublicClient;
}

export interface Handler<TEvent extends AbiEvent = AbiEvent> {
  /** Contract kind this handler fires against. */
  kind: ContractKind;
  /** Human-readable event name. */
  event: string;
  /** Event ABI for decoding. */
  abi: TEvent;
  /** Handler body. Throw to abort the batch; caller decides retry strategy. */
  run: (ctx: HandlerCtx<DecodedArgs<TEvent>>) => Promise<void>;
}

// DecodeEventLogReturnType's second generic expects a ContractEventName derived
// from the ABI tuple, but we already know the event name (`E['name']`). The
// cast-through-any keeps viem happy without losing the decoded arg types at
// the call site (handlers see `ctx.args.<field>` typed correctly).
type DecodedArgs<E extends AbiEvent> = DecodeEventLogReturnType<[E], any>['args'];

/** Convenience key combining kind + event, matching Ponder's `'<Kind>:<Event>'` style. */
export function handlerKey(kind: ContractKind, event: string): string {
  return `${kind}:${event}`;
}
