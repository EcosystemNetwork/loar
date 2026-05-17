/**
 * Structural Deed NFT adapter — hierarchy-of-content Metaplex Core Asset.
 * Mirror of `apps/contracts/src/revenue/StructuralDeed.sol`.
 *
 * Encodes LOAR's ontology hierarchy: timeline / reality / dimension /
 * plane / realm / domain (per project_ontology.md). Each level can hang
 * off a parent structural — caller walks the chain off-chain via the
 * `parent` attribute.
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

export type StructuralKind = 'timeline' | 'reality' | 'dimension' | 'plane' | 'realm' | 'domain';

export const STRUCTURAL_KINDS: readonly StructuralKind[] = [
  'timeline',
  'reality',
  'dimension',
  'plane',
  'realm',
  'domain',
] as const;

export interface MintStructuralArgs {
  creatorUserId: string;
  universe: PublicKey;
  collection: PublicKey;
  structuralKind: StructuralKind;
  name: string;
  uri: string;
  /** Parent structural asset (when this is a child in the hierarchy). */
  parentAsset?: PublicKey;
  metadata?: Record<string, string | number | boolean>;
  royaltyBasisPoints?: number;
}

export async function mintStructural(args: MintStructuralArgs) {
  if (!STRUCTURAL_KINDS.includes(args.structuralKind)) {
    throw new Error(`invalid structural kind: ${args.structuralKind}`);
  }
  const attributes: Attribute[] = [
    { key: 'kind', value: 'structural' },
    { key: 'structural_kind', value: args.structuralKind },
    { key: 'universe', value: args.universe.toBase58() },
    ...(args.parentAsset ? [{ key: 'parent', value: args.parentAsset.toBase58() }] : []),
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

export interface DecodedStructural {
  address: string;
  owner: string;
  universe: string | null;
  structuralKind: StructuralKind | null;
  name: string;
  uri: string;
  parent: string | null;
  metadata: Record<string, string>;
}

export async function readStructural(asset: PublicKey): Promise<DecodedStructural | null> {
  const decoded: DecodedMplAsset | null = await readMplAsset(asset);
  if (!decoded) return null;
  if (decoded.attributes.find((x) => x.key === 'kind')?.value !== 'structural') return null;
  const skRaw = decoded.attributes.find((x) => x.key === 'structural_kind')?.value;
  const structuralKind = STRUCTURAL_KINDS.includes(skRaw as StructuralKind)
    ? (skRaw as StructuralKind)
    : null;
  const metadata: Record<string, string> = {};
  for (const { key, value } of decoded.attributes) {
    if (!['kind', 'structural_kind', 'universe', 'parent'].includes(key)) {
      metadata[key] = value;
    }
  }
  return {
    address: decoded.address,
    owner: decoded.owner,
    universe: decoded.attributes.find((x) => x.key === 'universe')?.value ?? null,
    structuralKind,
    name: decoded.name,
    uri: decoded.uri,
    parent: decoded.attributes.find((x) => x.key === 'parent')?.value ?? null,
    metadata,
  };
}

export async function transferStructural(args: {
  ownerUserId: string;
  asset: PublicKey;
  newOwner: PublicKey;
}) {
  return transferMplAsset(args);
}

/**
 * Walk a structural's parent chain. Returns ancestors oldest-first (root
 * at index 0). Caller-supplied `readFn` so the walker can short-circuit
 * via cache; defaults to live on-chain reads via `readStructural`.
 */
export async function walkLineage(
  leaf: PublicKey,
  readFn: (asset: PublicKey) => Promise<DecodedStructural | null> = readStructural,
  maxDepth = 10
): Promise<DecodedStructural[]> {
  const chain: DecodedStructural[] = [];
  let cursor: PublicKey | null = leaf;
  while (cursor && chain.length < maxDepth) {
    const node = await readFn(cursor);
    if (!node) break;
    chain.unshift(node);
    cursor = node.parent ? new PublicKey(node.parent) : null;
  }
  return chain;
}
