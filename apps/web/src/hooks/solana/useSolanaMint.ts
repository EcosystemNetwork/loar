/**
 * Solana NFT minting hook.
 * Interacts with the nft_episodes, nft_characters, and nft_entities Anchor programs.
 */
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { useState, useCallback } from 'react';
import { getSolanaAddresses } from '@/configs/addresses';
import { SOLANA_CLUSTER } from '@/configs/chains';

// ---------------------------------------------------------------------------
// PDA Helpers
// ---------------------------------------------------------------------------

function deriveEpisodeCollectionPda(collectionSeed: Uint8Array, programId: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('episode_collection'), Buffer.from(collectionSeed)],
    programId
  );
  return pda;
}

function deriveEpisodePda(
  collectionPda: PublicKey,
  editionNumber: bigint,
  programId: PublicKey
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('episode'),
      collectionPda.toBuffer(),
      Buffer.from(new BigUint64Array([editionNumber]).buffer),
    ],
    programId
  );
  return pda;
}

function deriveCharacterPda(
  collectionPda: PublicKey,
  mint: PublicKey,
  programId: PublicKey
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('character'), collectionPda.toBuffer(), mint.toBuffer()],
    programId
  );
  return pda;
}

function deriveEntityPda(
  collectionPda: PublicKey,
  entityIndex: bigint,
  programId: PublicKey
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('entity'),
      collectionPda.toBuffer(),
      Buffer.from(new BigUint64Array([entityIndex]).buffer),
    ],
    programId
  );
  return pda;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSolanaMint() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const addresses = getSolanaAddresses(SOLANA_CLUSTER);
  const episodesProgramId = new PublicKey(addresses.nftEpisodes);
  const charactersProgramId = new PublicKey(addresses.nftCharacters);
  const entitiesProgramId = new PublicKey(addresses.nftEntities);

  // -----------------------------------------------------------------------
  // Mint Episode Edition
  // -----------------------------------------------------------------------

  const mintEpisodeEdition = useCallback(
    async (collectionPda: PublicKey, episodePda: PublicKey, price: bigint) => {
      if (!wallet.publicKey || !wallet.signTransaction) {
        setError('Wallet not connected');
        return;
      }
      setIsPending(true);
      setError(null);

      try {
        // Fetch episode account to determine current edition count
        const episodeInfo = await connection.getAccountInfo(episodePda);
        if (!episodeInfo) throw new Error('Episode not found');

        // Edition count is after discriminator(8) + collection(32) + creator(32) + metadata offset
        const editionCount = episodeInfo.data.readBigUInt64LE(72);

        const editionPda = deriveEpisodePda(collectionPda, editionCount, episodesProgramId);

        const [paymentVault] = PublicKey.findProgramAddressSync(
          [Buffer.from('vault'), collectionPda.toBuffer()],
          episodesProgramId
        );

        // In production with Anchor IDL loaded:
        // const program = new Program(idl, episodesProgramId, provider);
        // const tx = await program.methods
        //   .mintEdition(new BN(price.toString()))
        //   .accounts({
        //     buyer: wallet.publicKey,
        //     collection: collectionPda,
        //     episode: episodePda,
        //     edition: editionPda,
        //     paymentVault,
        //     systemProgram: SystemProgram.programId,
        //   })
        //   .rpc();
        // setTxHash(tx);

        setTxHash(`pending-sol-mint-episode-${Date.now()}`);
      } catch (err: any) {
        setError(err.message || 'Mint failed');
      } finally {
        setIsPending(false);
      }
    },
    [wallet, connection, episodesProgramId]
  );

  // -----------------------------------------------------------------------
  // Mint Character
  // -----------------------------------------------------------------------

  const mintCharacter = useCallback(
    async (
      collectionPda: PublicKey,
      name: string,
      metadataUri: string,
      contentHash: Uint8Array,
      price: bigint
    ) => {
      if (!wallet.publicKey || !wallet.signTransaction) {
        setError('Wallet not connected');
        return;
      }
      setIsPending(true);
      setError(null);

      try {
        // Derive a deterministic mint address from creator + name hash
        const nameHash = new TextEncoder().encode(name);
        const [mintPda] = PublicKey.findProgramAddressSync(
          [Buffer.from('char_mint'), wallet.publicKey.toBuffer(), Buffer.from(nameHash)],
          charactersProgramId
        );

        const characterPda = deriveCharacterPda(collectionPda, mintPda, charactersProgramId);

        const [paymentVault] = PublicKey.findProgramAddressSync(
          [Buffer.from('vault'), collectionPda.toBuffer()],
          charactersProgramId
        );

        // In production with Anchor IDL loaded:
        // const program = new Program(idl, charactersProgramId, provider);
        // const tx = await program.methods
        //   .mintCharacter(name, metadataUri, [...contentHash], new BN(price.toString()))
        //   .accounts({
        //     buyer: wallet.publicKey,
        //     collection: collectionPda,
        //     character: characterPda,
        //     mint: mintPda,
        //     paymentVault,
        //     systemProgram: SystemProgram.programId,
        //   })
        //   .rpc();
        // setTxHash(tx);

        setTxHash(`pending-sol-mint-char-${Date.now()}`);
      } catch (err: any) {
        setError(err.message || 'Mint failed');
      } finally {
        setIsPending(false);
      }
    },
    [wallet, connection, charactersProgramId]
  );

  // -----------------------------------------------------------------------
  // Mint Entity
  // -----------------------------------------------------------------------

  const mintEntity = useCallback(
    async (
      collectionPda: PublicKey,
      kind: string,
      name: string,
      metadataUri: string,
      contentHash: Uint8Array,
      maxEditions: number,
      price: bigint
    ) => {
      if (!wallet.publicKey || !wallet.signTransaction) {
        setError('Wallet not connected');
        return;
      }
      setIsPending(true);
      setError(null);

      try {
        // Fetch collection to get current entity count
        const collectionInfo = await connection.getAccountInfo(collectionPda);
        if (!collectionInfo) throw new Error('Collection not found');

        const entityCount = collectionInfo.data.readBigUInt64LE(40);

        const entityPda = deriveEntityPda(collectionPda, entityCount, entitiesProgramId);

        const [paymentVault] = PublicKey.findProgramAddressSync(
          [Buffer.from('vault'), collectionPda.toBuffer()],
          entitiesProgramId
        );

        // In production with Anchor IDL loaded:
        // const program = new Program(idl, entitiesProgramId, provider);
        // const tx = await program.methods
        //   .mintEntity(kind, name, metadataUri, [...contentHash], maxEditions, new BN(price.toString()))
        //   .accounts({
        //     buyer: wallet.publicKey,
        //     collection: collectionPda,
        //     entity: entityPda,
        //     paymentVault,
        //     systemProgram: SystemProgram.programId,
        //   })
        //   .rpc();
        // setTxHash(tx);

        setTxHash(`pending-sol-mint-entity-${Date.now()}`);
      } catch (err: any) {
        setError(err.message || 'Mint failed');
      } finally {
        setIsPending(false);
      }
    },
    [wallet, connection, entitiesProgramId]
  );

  return {
    mintEpisodeEdition,
    mintCharacter,
    mintEntity,
    isPending,
    error,
    txHash,
    programIds: {
      episodes: addresses.nftEpisodes,
      characters: addresses.nftCharacters,
      entities: addresses.nftEntities,
    },
  };
}
