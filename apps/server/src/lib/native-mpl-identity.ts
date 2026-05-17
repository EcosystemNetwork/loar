/**
 * Identity NFT adapter — soulbound creator profile as a Metaplex Core Asset.
 * Mirror of `apps/contracts/src/IdentityNFT.sol`.
 *
 * Soulbound via Metaplex Core's FreezeDelegate plugin (non-transferable).
 * One identity per user — caller is responsible for idempotency check
 * via the off-chain owner → identity-asset map (or by listing assets
 * owned by the user and filtering on `kind: 'identity'`).
 */
import { PublicKey } from '@solana/web3.js';
import { type DecodedMplAsset, mintMplAsset, readMplAsset } from './native-mpl-base';
import { resolveUserSolanaWallet } from './native-base';

export interface MintIdentityArgs {
  creatorUserId: string;
  /** Collection address for LOAR-platform identities (single global collection). */
  collection: PublicKey;
  profileUri: string;
  displayName: string;
}

export async function mintIdentity(args: MintIdentityArgs) {
  // Universe is N/A for identity — use the user's pubkey as the "universe"
  // ref so attribute schema stays uniform with character/entity.
  const wallet = await resolveUserSolanaWallet(args.creatorUserId);
  return mintMplAsset({
    creatorUserId: args.creatorUserId,
    universe: wallet.pubkey, // placeholder; real ref is the owner field
    collection: args.collection,
    name: args.displayName,
    uri: args.profileUri,
    attributes: [
      { key: 'kind', value: 'identity' },
      { key: 'display_name', value: args.displayName },
    ],
    royalty: { basisPoints: 0 }, // soulbound = no secondary sales
    soulbound: true,
  });
}

export interface DecodedIdentity {
  address: string;
  owner: string;
  displayName: string;
  profileUri: string;
  soulbound: boolean;
}

export async function readIdentity(asset: PublicKey): Promise<DecodedIdentity | null> {
  const decoded: DecodedMplAsset | null = await readMplAsset(asset);
  if (!decoded) return null;
  if (decoded.attributes.find((x) => x.key === 'kind')?.value !== 'identity') return null;
  return {
    address: decoded.address,
    owner: decoded.owner,
    displayName: decoded.attributes.find((x) => x.key === 'display_name')?.value ?? decoded.name,
    profileUri: decoded.uri,
    soulbound: decoded.soulbound,
  };
}

/**
 * Identity is soulbound — there is no transfer path. Re-mint to a new
 * wallet if a user needs to migrate. This export exists to make the
 * "can't transfer" contract explicit to callers grep-ing for transfer fns.
 */
export function transferIdentity(): never {
  throw new Error('Identity NFTs are soulbound — transfer is not supported');
}
