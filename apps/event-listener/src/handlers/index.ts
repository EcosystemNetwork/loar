/**
 * Handler dispatch registry.
 *
 * Looks up handlers by (contractKind, topic0). `contractKind` is determined by
 * the log's emitter address: UniverseManager address from deployments; any
 * address in the factoryChildren registry keyed by kind.
 *
 * For contract kinds that can emit >1 event (UniverseManager, BondingCurve,
 * etc.), each event ABI gives a unique topic0 (keccak256 of event signature),
 * so the map is (kind, topic0) → handler.
 */
import { encodeEventTopics, toHex, type Abi, type AbiEvent } from 'viem';
import { universeManagerHandlers } from './universe-manager.js';
import { bondingCurveHandlers } from './bonding-curve.js';
import { universeHandlers } from './universe.js';
import { governorHandlers } from './governor.js';
import { governanceTokenHandlers } from './governance-token.js';
import { poolManagerHandlers } from './pool-manager.js';
import { canonMarketplaceHandlers } from './canon-marketplace.js';
import { adPlacementHandlers } from './ad-placement.js';
import { licensingHandlers } from './licensing.js';
import { collabHandlers } from './collab.js';
import { storyBountiesHandlers } from './story-bounties.js';
import type { Handler, ContractKind } from './types.js';

export const allHandlers: Handler[] = [
  ...universeManagerHandlers,
  ...bondingCurveHandlers,
  ...universeHandlers,
  ...governorHandlers,
  ...governanceTokenHandlers,
  ...poolManagerHandlers,
  ...canonMarketplaceHandlers,
  ...adPlacementHandlers,
  ...licensingHandlers,
  ...collabHandlers,
  ...storyBountiesHandlers,
];

function eventTopic0(abi: AbiEvent): string {
  const topics = encodeEventTopics({ abi: [abi] as Abi, eventName: abi.name });
  return topics[0]!.toLowerCase();
}

// (kind, topic0) → handler
const byKindAndTopic = new Map<string, Handler>();
// topic0 → list of all kinds that use it (a single topic0 can be shared across
// contract kinds if two contracts happen to emit same-signature events).
const topicsByKind: Record<ContractKind, string[]> = {
  UniverseManager: [],
  Universe: [],
  UniverseGovernor: [],
  GovernanceToken: [],
  BondingCurve: [],
  PoolManager: [],
  CanonMarketplace: [],
  AdPlacement: [],
  LicensingRegistry: [],
  CollabManager: [],
  StoryBounties: [],
};

for (const h of allHandlers) {
  const topic = eventTopic0(h.abi);
  byKindAndTopic.set(`${h.kind}:${topic}`, h);
  topicsByKind[h.kind].push(topic);
}

export function findHandler(kind: ContractKind, topic0: string): Handler | undefined {
  return byKindAndTopic.get(`${kind}:${topic0.toLowerCase()}`);
}

export function topicsForKind(kind: ContractKind): string[] {
  return topicsByKind[kind];
}

export function allTopics(): string[] {
  const s = new Set<string>();
  for (const kind of Object.keys(topicsByKind) as ContractKind[]) {
    for (const t of topicsByKind[kind]) s.add(t);
  }
  return [...s];
}
