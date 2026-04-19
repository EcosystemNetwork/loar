/**
 * Governance Router
 *
 * Caches on-chain governance proposals in Firestore for fast querying.
 * Frontend writes to chain first, then syncs data here via syncProposal.
 * Supports proposal listing, filtering, and delegation tracking.
 *
 * On-chain verification:
 *   - syncProposal verifies the proposal TX succeeded on-chain
 *   - updateState reads vote counts from the Governor contract
 *   - recordDelegation verifies the delegation TX
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createPublicClient, http } from 'viem';
import { sepolia, baseSepolia } from 'viem/chains';
import { protectedProcedure, publicProcedure, router } from '../../lib/trpc';
import { db } from '../../lib/firebase';

const ALLOWED_CHAIN_IDS: Set<number> = new Set([sepolia.id, baseSepolia.id]);

// ── Chain clients for on-chain verification ─────────────────────────
const sepoliaClient = createPublicClient({
  chain: sepolia,
  transport: http(process.env.RPC_URL ?? process.env.PONDER_RPC_URL_2 ?? ''),
});
const baseSepoliaClient = createPublicClient({
  chain: baseSepolia,
  transport: http(process.env.RPC_URL_BASE_SEPOLIA ?? ''),
});
function getChainClient(chainId?: number) {
  if (chainId === baseSepolia.id) return baseSepoliaClient;
  return sepoliaClient;
}

// Minimal Governor ABI for reading proposal state and vote counts
const GOVERNOR_ABI = [
  {
    name: 'state',
    type: 'function',
    inputs: [{ name: 'proposalId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
  },
  {
    name: 'proposalVotes',
    type: 'function',
    inputs: [{ name: 'proposalId', type: 'uint256' }],
    outputs: [
      { name: 'againstVotes', type: 'uint256' },
      { name: 'forVotes', type: 'uint256' },
      { name: 'abstainVotes', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
] as const;

const PROPOSAL_STATES = [
  'Pending',
  'Active',
  'Canceled',
  'Defeated',
  'Succeeded',
  'Queued',
  'Expired',
  'Executed',
] as const;

/**
 * Read proposal state and votes directly from the Governor contract.
 * Returns null if governor address is missing or call fails.
 */
async function readOnChainProposal(governorAddress: string, proposalId: string, chainId?: number) {
  try {
    const client = getChainClient(chainId);
    const addr = governorAddress as `0x${string}`;
    const pid = BigInt(proposalId);

    const [stateIndex, votes] = await Promise.all([
      client.readContract({
        address: addr,
        abi: GOVERNOR_ABI,
        functionName: 'state',
        args: [pid],
      }),
      client.readContract({
        address: addr,
        abi: GOVERNOR_ABI,
        functionName: 'proposalVotes',
        args: [pid],
      }),
    ]);

    return {
      state: PROPOSAL_STATES[stateIndex] ?? 'Pending',
      againstVotes: votes[0].toString(),
      forVotes: votes[1].toString(),
      abstainVotes: votes[2].toString(),
    };
  } catch (err) {
    console.error('[governance] Failed to read on-chain proposal:', err);
    return null;
  }
}

const proposalsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('governanceProposals');
};

const delegationsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('governanceDelegations');
};

const proposalStateEnum = z.enum([
  'Pending',
  'Active',
  'Canceled',
  'Defeated',
  'Succeeded',
  'Queued',
  'Expired',
  'Executed',
]);

const syncProposalSchema = z.object({
  proposalId: z.string(),
  universeId: z.string(),
  governorAddress: z.string(),
  tokenAddress: z.string(),
  description: z.string(),
  proposer: z.string(),
  targets: z.array(z.string()),
  values: z.array(z.string()),
  calldatas: z.array(z.string()),
  state: proposalStateEnum,
  forVotes: z.string().default('0'),
  againstVotes: z.string().default('0'),
  abstainVotes: z.string().default('0'),
  startBlock: z.number(),
  endBlock: z.number(),
  executedAt: z.string().optional(),
});

export const governanceRouter = router({
  /** Sync an on-chain proposal to Firestore cache (called after tx confirmation).
   *  Only the proposer (authenticated caller) can create/update their own proposals. */
  syncProposal: protectedProcedure
    .input(syncProposalSchema.extend({ chainId: z.number().optional() }))
    .mutation(async ({ ctx, input }) => {
      // Validate chain ID if provided
      if (input.chainId && !ALLOWED_CHAIN_IDS.has(input.chainId)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Unsupported chain ID: ${input.chainId}`,
        });
      }

      // Verify caller is the proposer
      if (input.proposer.toLowerCase() !== ctx.user.address?.toLowerCase()) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the proposer can sync this proposal',
        });
      }

      // Pin governorAddress to the trusted universe record. Without this
      // the caller can point the `onChainVerified` check at an attacker-
      // deployed Governor clone that returns fabricated state/vote counts.
      if (!db) throw new TRPCError({ code: 'SERVICE_UNAVAILABLE', message: 'DB unavailable' });
      const universeDoc = await db.collection('universes').doc(input.universeId).get();
      const canonicalGovernor = (universeDoc.data()?.governanceAddress ?? '')
        .toString()
        .toLowerCase();
      if (!canonicalGovernor) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Universe is missing a registered governance address',
        });
      }
      if (input.governorAddress && input.governorAddress.toLowerCase() !== canonicalGovernor) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'governorAddress does not match the universe record',
        });
      }

      const ref = proposalsCol().doc(input.proposalId);

      // If doc exists, verify original proposer matches
      const existing = await ref.get();
      if (existing.exists) {
        const existingProposer = existing.data()?.proposer?.toLowerCase();
        if (existingProposer && existingProposer !== ctx.user.address?.toLowerCase()) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: "Cannot overwrite another proposer's proposal",
          });
        }
      }

      // Always verify on-chain state against the canonical governor.
      const onChainState = await readOnChainProposal(
        canonicalGovernor,
        input.proposalId,
        input.chainId
      );

      await ref.set(
        {
          ...input,
          // Override with on-chain data if available
          ...(onChainState
            ? {
                state: onChainState.state,
                forVotes: onChainState.forVotes,
                againstVotes: onChainState.againstVotes,
                abstainVotes: onChainState.abstainVotes,
                onChainVerified: true,
              }
            : { onChainVerified: false }),
          updatedAt: new Date(),
        },
        { merge: true }
      );
      return { ok: true, onChainVerified: !!onChainState };
    }),

  /** List proposals for a universe, optionally filtered by state */
  listProposals: publicProcedure
    .input(
      z.object({
        universeId: z.string(),
        state: proposalStateEnum.optional(),
        limit: z.number().min(1).max(50).default(20),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      let query = proposalsCol()
        .where('universeId', '==', input.universeId)
        .orderBy('startBlock', 'desc')
        .limit(input.limit);

      if (input.state) {
        query = proposalsCol()
          .where('universeId', '==', input.universeId)
          .where('state', '==', input.state)
          .orderBy('startBlock', 'desc')
          .limit(input.limit);
      }

      if (input.cursor) {
        const cursorDoc = await proposalsCol().doc(input.cursor).get();
        if (cursorDoc.exists) {
          query = query.startAfter(cursorDoc);
        }
      }

      const snapshot = await query.get();
      const proposals = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      return {
        proposals,
        nextCursor:
          snapshot.docs.length === input.limit
            ? snapshot.docs[snapshot.docs.length - 1]?.id
            : undefined,
      };
    }),

  /** Get a single proposal by ID */
  getProposal: publicProcedure
    .input(z.object({ proposalId: z.string() }))
    .query(async ({ input }) => {
      const doc = await proposalsCol().doc(input.proposalId).get();
      if (!doc.exists) return null;
      return { id: doc.id, ...doc.data() };
    }),

  /** Update proposal state by reading directly from the Governor contract.
   *  Falls back to client-supplied state if governor call fails. */
  updateState: protectedProcedure
    .input(
      z.object({
        proposalId: z.string(),
        state: proposalStateEnum.optional(),
        forVotes: z.string().optional(),
        againstVotes: z.string().optional(),
        abstainVotes: z.string().optional(),
        executedAt: z.string().optional(),
        chainId: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { proposalId, chainId, ...clientUpdates } = input;

      // Validate chain ID if provided
      if (chainId && !ALLOWED_CHAIN_IDS.has(chainId)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Unsupported chain ID: ${chainId}` });
      }

      const proposalDoc = await proposalsCol().doc(proposalId).get();
      if (!proposalDoc.exists) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Proposal not found' });
      }
      const proposer = proposalDoc.data()?.proposer?.toLowerCase();
      if (proposer !== ctx.user.address?.toLowerCase()) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the proposer can update proposal state',
        });
      }

      // Read authoritative state from on-chain Governor
      const governorAddress = proposalDoc.data()?.governorAddress;
      if (!governorAddress) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'Proposal has no governor address — cannot update state without on-chain verification',
        });
      }

      let updates: Record<string, unknown> = { updatedAt: new Date() };
      const onChain = await readOnChainProposal(governorAddress, proposalId, chainId);
      if (onChain) {
        updates = {
          state: onChain.state,
          forVotes: onChain.forVotes,
          againstVotes: onChain.againstVotes,
          abstainVotes: onChain.abstainVotes,
          onChainVerified: true,
          updatedAt: new Date(),
          ...(clientUpdates.executedAt ? { executedAt: clientUpdates.executedAt } : {}),
        };
      } else {
        // On-chain read failed — only allow state/executedAt updates, never vote counts
        if (clientUpdates.state) updates.state = clientUpdates.state;
        if (clientUpdates.executedAt) updates.executedAt = clientUpdates.executedAt;
        updates.onChainVerified = false;
      }

      await proposalsCol().doc(proposalId).update(updates);
      return { ok: true, onChainVerified: !!updates.onChainVerified };
    }),

  /** Record a delegation event — verifies the TX succeeded on-chain */
  recordDelegation: protectedProcedure
    .input(
      z.object({
        delegatee: z.string(),
        universeId: z.string(),
        tokenAddress: z.string(),
        txHash: z.string(),
        chainId: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify the delegation TX succeeded on-chain
      const client = getChainClient(input.chainId);
      try {
        const receipt = await client.getTransactionReceipt({
          hash: input.txHash as `0x${string}`,
        });
        if (receipt.status !== 'success') {
          throw new Error('Delegation transaction was reverted on-chain');
        }
      } catch (err: any) {
        if (err?.message?.includes('reverted')) throw err;
        throw new Error('Delegation transaction not found on-chain');
      }

      await delegationsCol().add({
        delegator: ctx.user.address?.toLowerCase() || ctx.user.uid,
        delegatee: input.delegatee,
        universeId: input.universeId,
        tokenAddress: input.tokenAddress,
        txHash: input.txHash,
        onChainVerified: true,
        createdAt: new Date(),
      });
      return { ok: true };
    }),

  /** Get delegations for a universe */
  getDelegations: publicProcedure
    .input(
      z.object({
        universeId: z.string(),
        limit: z.number().min(1).max(50).default(20),
      })
    )
    .query(async ({ input }) => {
      const snapshot = await delegationsCol()
        .where('universeId', '==', input.universeId)
        .orderBy('createdAt', 'desc')
        .limit(input.limit)
        .get();

      return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    }),
});
