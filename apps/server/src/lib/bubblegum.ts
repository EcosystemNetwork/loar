/**
 * Bubblegum cNFT helpers — server-side `mint_v1` instruction builder.
 *
 * Strategy:
 *   1. Build instructions via @metaplex-foundation/mpl-bubblegum (Umi-based SDK)
 *      — Bubblegum's account list is non-trivial (tree authority PDA, log wrapper,
 *      account compression program, system program, payer/leaf-owner/delegate roles).
 *      Hand-rolling is bug-prone; the SDK keeps us aligned with future versions.
 *   2. Convert to @solana/web3.js TransactionInstruction via umi-web3js-adapters
 *      so our existing executeSolanaTransaction (Circle DCW signing) can broadcast.
 *
 * Tree creation is a one-time op handled by scripts/solana/create-merkle-tree.ts.
 */
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  mintV1,
  TokenProgramVersion,
  TokenStandard,
  type MetadataArgsArgs,
  MPL_BUBBLEGUM_PROGRAM_ID,
} from '@metaplex-foundation/mpl-bubblegum';
import {
  none,
  publicKey as toUmiPublicKey,
  some,
  type Umi,
  type Instruction as UmiInstruction,
} from '@metaplex-foundation/umi';
import { toWeb3JsInstruction } from '@metaplex-foundation/umi-web3js-adapters';
import { PublicKey, TransactionInstruction } from '@solana/web3.js';

let _umi: Umi | null = null;

function getUmi(): Umi {
  if (_umi) return _umi;
  const url = process.env.SOLANA_RPC_URL;
  if (!url) {
    throw new Error('SOLANA_RPC_URL is required to build Bubblegum instructions');
  }
  _umi = createUmi(url);
  return _umi;
}

export const BUBBLEGUM_PROGRAM_ID = new PublicKey(MPL_BUBBLEGUM_PROGRAM_ID);

export interface MintCnftArgs {
  /** Merkle tree address — created once via scripts/solana/create-merkle-tree.ts. */
  merkleTree: PublicKey;
  /** Wallet that pays for the mint (Circle DCW fee payer in production). */
  payer: PublicKey;
  /** Recipient of the cNFT. Usually the same as payer for self-minting. */
  leafOwner: PublicKey;
  /**
   * Tree delegate — must sign. For LOAR's flow this is the Circle DCW wallet
   * that also created the tree. If you handed the delegate off post-creation,
   * the new delegate must sign instead.
   */
  treeCreatorOrDelegate: PublicKey;
  /** NFT metadata — name, symbol, uri (off-chain JSON), seller fee, creators. */
  metadata: MetadataArgsArgs;
}

/**
 * Build a Bubblegum `mint_v1` instruction as a web3.js TransactionInstruction.
 * The caller composes this with other ixs (e.g. episode::mint_episode) and
 * signs via Circle DCW through executeSolanaTransaction.
 */
export function buildMintCnftIx(args: MintCnftArgs): TransactionInstruction {
  const umi = getUmi();

  const builder = mintV1(umi, {
    leafOwner: toUmiPublicKey(args.leafOwner.toBase58()),
    merkleTree: toUmiPublicKey(args.merkleTree.toBase58()),
    payer: {
      publicKey: toUmiPublicKey(args.payer.toBase58()),
      signMessage: async () => {
        throw new Error('signer not used — server signs via Circle DCW after ix-building');
      },
      signTransaction: async () => {
        throw new Error('signer not used — server signs via Circle DCW after ix-building');
      },
      signAllTransactions: async () => {
        throw new Error('signer not used — server signs via Circle DCW after ix-building');
      },
    },
    treeCreatorOrDelegate: {
      publicKey: toUmiPublicKey(args.treeCreatorOrDelegate.toBase58()),
      signMessage: async () => {
        throw new Error('signer not used — server signs via Circle DCW after ix-building');
      },
      signTransaction: async () => {
        throw new Error('signer not used — server signs via Circle DCW after ix-building');
      },
      signAllTransactions: async () => {
        throw new Error('signer not used — server signs via Circle DCW after ix-building');
      },
    },
    metadata: args.metadata,
  });

  const ixs = builder.getInstructions();
  if (ixs.length !== 1) {
    throw new Error(`Bubblegum mintV1 produced ${ixs.length} instructions, expected 1`);
  }
  return toWeb3JsInstruction(ixs[0] as UmiInstruction);
}

/**
 * Helper: build the standard MetadataArgs for an Episode cNFT.
 * Keeps callers from needing to know Bubblegum's metadata shape.
 */
export function episodeMetadata(args: {
  name: string;
  symbol?: string;
  uri: string;
  creators?: Array<{ address: PublicKey; share: number; verified?: boolean }>;
  sellerFeeBasisPoints?: number;
}): MetadataArgsArgs {
  // Umi's MetadataArgs uses Option<T> wrappers for nullable fields and a
  // discriminated-union TokenStandard. Wrap correctly so the borsh layout
  // matches what Bubblegum's on-chain program expects.
  return {
    name: args.name.slice(0, 32),
    symbol: (args.symbol ?? 'LOAR').slice(0, 10),
    uri: args.uri,
    sellerFeeBasisPoints: args.sellerFeeBasisPoints ?? 500, // 5% default
    collection: none(),
    primarySaleHappened: false,
    isMutable: false,
    editionNonce: none(),
    tokenStandard: some(TokenStandard.NonFungible),
    uses: none(),
    tokenProgramVersion: TokenProgramVersion.Original,
    creators:
      args.creators?.map((c) => ({
        address: toUmiPublicKey(c.address.toBase58()),
        share: c.share,
        verified: c.verified ?? false,
      })) ?? [],
  };
}
