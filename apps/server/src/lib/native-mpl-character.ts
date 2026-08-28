/**
 * Character NFT adapter — Metaplex Core Asset per character.
 * Mirror of `apps/contracts/src/revenue/CharacterNFT.sol`.
 *
 * Each character is an Asset under the universe's Collection with
 * Attributes (traits) + Royalty plugins. Tensor / Magic Eden enforce the
 * royalty natively on every secondary sale.
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

export interface MintCharacterArgs {
  creatorUserId: string;
  /** Universe PDA — used here for off-chain indexing reference, not in the mint ix. */
  universe: PublicKey;
  /** Collection address from `createCollectionForUniverse`. */
  collection: PublicKey;
  /** Character display name. */
  name: string;
  /** Off-chain metadata JSON URI (image, description, etc). */
  uri: string;
  /** Optional traits: e.g. { rarity: "legendary", class: "warrior" }. */
  traits?: Record<string, string | number | boolean>;
  /** Royalty bps. Default 500 = 5%. */
  royaltyBasisPoints?: number;
}

export async function mintCharacter(args: MintCharacterArgs) {
  const attributes: Attribute[] = [
    { key: 'kind', value: 'character' },
    { key: 'universe', value: args.universe.toBase58() },
    ...makeAttributes(args.traits ?? {}),
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

export interface DecodedCharacter {
  address: string;
  owner: string;
  universe: string | null;
  name: string;
  uri: string;
  traits: Record<string, string>;
  royaltyBasisPoints: number;
}

export async function readCharacter(asset: PublicKey): Promise<DecodedCharacter | null> {
  const decoded: DecodedMplAsset | null = await readMplAsset(asset);
  if (!decoded) return null;
  return mapAssetToCharacter(decoded);
}

function mapAssetToCharacter(a: DecodedMplAsset): DecodedCharacter | null {
  const kindAttr = a.attributes.find((x) => x.key === 'kind');
  if (kindAttr?.value !== 'character') return null;
  const universe = a.attributes.find((x) => x.key === 'universe')?.value ?? null;
  const traits: Record<string, string> = {};
  for (const { key, value } of a.attributes) {
    if (key !== 'kind' && key !== 'universe') traits[key] = value;
  }
  return {
    address: a.address,
    owner: a.owner,
    universe,
    name: a.name,
    uri: a.uri,
    traits,
    royaltyBasisPoints: a.royaltyBasisPoints,
  };
}

export async function transferCharacter(args: {
  ownerUserId: string;
  asset: PublicKey;
  newOwner: PublicKey;
}) {
  return transferMplAsset(args);
}
