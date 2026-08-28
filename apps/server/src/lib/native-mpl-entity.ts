/**
 * Entity NFT adapter — generic worldbuilding entity as a Metaplex Core Asset.
 * Mirror of `apps/contracts/src/revenue/EntityNFT.sol`.
 *
 * Entities have a `kind` discriminator: person, place, thing, faction,
 * event, lore, species, vehicle, technology, organization — matches the
 * worldbuilding-studio PRD's entity taxonomy.
 */
import { PublicKey } from '@solana/web3.js';
import {
  type Attribute,
  type DecodedMplAsset,
  makeAttributes,
  mintMplAsset,
  readMplAsset,
  transferMplAsset,
} from './native-mpl-base';

export type EntityKind =
  | 'person'
  | 'place'
  | 'thing'
  | 'faction'
  | 'event'
  | 'lore'
  | 'species'
  | 'vehicle'
  | 'technology'
  | 'organization';

export const ENTITY_KINDS: readonly EntityKind[] = [
  'person',
  'place',
  'thing',
  'faction',
  'event',
  'lore',
  'species',
  'vehicle',
  'technology',
  'organization',
] as const;

export interface MintEntityArgs {
  creatorUserId: string;
  universe: PublicKey;
  collection: PublicKey;
  kind: EntityKind;
  name: string;
  uri: string;
  metadata?: Record<string, string | number | boolean>;
  royaltyBasisPoints?: number;
}

export async function mintEntity(args: MintEntityArgs) {
  if (!ENTITY_KINDS.includes(args.kind)) {
    throw new Error(`invalid entity kind: ${args.kind}`);
  }
  const attributes: Attribute[] = [
    { key: 'kind', value: 'entity' },
    { key: 'entity_kind', value: args.kind },
    { key: 'universe', value: args.universe.toBase58() },
    ...makeAttributes(args.metadata ?? {}),
  ];
  return mintMplAsset({
    creatorUserId: args.creatorUserId,
    universe: args.universe,
    collection: args.collection,
    name: args.name,
    uri: args.uri,
    attributes,
    royalty: { basisPoints: args.royaltyBasisPoints ?? 500 },
  });
}

export interface DecodedEntity {
  address: string;
  owner: string;
  universe: string | null;
  kind: EntityKind | null;
  name: string;
  uri: string;
  metadata: Record<string, string>;
}

export async function readEntity(asset: PublicKey): Promise<DecodedEntity | null> {
  const decoded: DecodedMplAsset | null = await readMplAsset(asset);
  if (!decoded) return null;
  const kindAttr = decoded.attributes.find((x) => x.key === 'kind');
  if (kindAttr?.value !== 'entity') return null;
  const entityKindRaw = decoded.attributes.find((x) => x.key === 'entity_kind')?.value;
  const entityKind = ENTITY_KINDS.includes(entityKindRaw as EntityKind)
    ? (entityKindRaw as EntityKind)
    : null;
  const metadata: Record<string, string> = {};
  for (const { key, value } of decoded.attributes) {
    if (key !== 'kind' && key !== 'entity_kind' && key !== 'universe') {
      metadata[key] = value;
    }
  }
  return {
    address: decoded.address,
    owner: decoded.owner,
    universe: decoded.attributes.find((x) => x.key === 'universe')?.value ?? null,
    kind: entityKind,
    name: decoded.name,
    uri: decoded.uri,
    metadata,
  };
}

export async function transferEntity(args: {
  ownerUserId: string;
  asset: PublicKey;
  newOwner: PublicKey;
}) {
  return transferMplAsset(args);
}
