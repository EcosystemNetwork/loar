/**
 * useStoryBounties — Circle DCW-signed wrappers for StoryBounties writes.
 *
 * Every contract call goes through `useWriteContract` (which proxies to the
 * server-side Circle DCW signer at POST /api/tx/write). No MetaMask popup.
 *
 * Inlines a minimal ABI because `wagmi generate` hasn't been re-run since
 * StoryBounties was restored — the forge artifact isn't on disk locally yet.
 * Once `forge build && wagmi generate` runs in CI, switch to the generated
 * `storyBountiesAbi` import.
 */
import { useChainId } from 'wagmi';
import { useWriteContract } from '@/hooks/useCircleWrite';
import { StoryBounties } from '@loar/abis/addresses';
import type { Abi, Hex } from 'viem';

type ChainKey = keyof typeof StoryBounties;

function contractAddress(chainId: number): Hex | null {
  const key = String(chainId) as ChainKey;
  const addr = StoryBounties[key];
  return (addr as Hex | undefined) ?? null;
}

const STORY_BOUNTIES_ABI = [
  {
    type: 'function',
    name: 'createBounty',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'universeId', type: 'uint256' },
      { name: 'reward', type: 'uint256' },
      { name: 'title', type: 'string' },
      { name: 'descriptionHash', type: 'string' },
      { name: 'contentType', type: 'string' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ name: 'bountyId', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'awardBounty',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'bountyId', type: 'uint256' },
      { name: 'winner', type: 'address' },
      { name: 'submissionHash', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'cancelBounty',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'bountyId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'expireBounty',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'bountyId', type: 'uint256' }],
    outputs: [],
  },
] as const satisfies Abi;

export function useStoryBountiesWrite() {
  const chainId = useChainId();
  const { writeContractAsync, isPending } = useWriteContract();

  /** Lock escrow + open a bounty. Returns Circle DCW tx hash. */
  async function createBounty(args: {
    universeId: bigint;
    reward: bigint;
    title: string;
    descriptionHash: string;
    contentType: string;
    deadline: bigint;
  }): Promise<Hex> {
    const address = contractAddress(chainId);
    if (!address) {
      throw new Error(`StoryBounties not deployed on chain ${chainId}`);
    }

    const hash = await writeContractAsync({
      address,
      abi: STORY_BOUNTIES_ABI,
      functionName: 'createBounty',
      args: [
        args.universeId,
        args.reward,
        args.title,
        args.descriptionHash,
        args.contentType,
        args.deadline,
      ] as const,
      chainId,
    });

    return hash as Hex;
  }

  /** Release escrow to the chosen submitter (poster only). */
  async function awardBounty(args: {
    bountyId: bigint;
    winner: Hex;
    submissionHash: Hex;
  }): Promise<Hex> {
    const address = contractAddress(chainId);
    if (!address) {
      throw new Error(`StoryBounties not deployed on chain ${chainId}`);
    }

    const hash = await writeContractAsync({
      address,
      abi: STORY_BOUNTIES_ABI,
      functionName: 'awardBounty',
      args: [args.bountyId, args.winner, args.submissionHash] as const,
      chainId,
    });

    return hash as Hex;
  }

  /** Cancel an open bounty — escrow refunded minus cancel fee. */
  async function cancelBounty(args: { bountyId: bigint }): Promise<Hex> {
    const address = contractAddress(chainId);
    if (!address) {
      throw new Error(`StoryBounties not deployed on chain ${chainId}`);
    }

    const hash = await writeContractAsync({
      address,
      abi: STORY_BOUNTIES_ABI,
      functionName: 'cancelBounty',
      args: [args.bountyId] as const,
      chainId,
    });

    return hash as Hex;
  }

  return { createBounty, awardBounty, cancelBounty, isPending };
}
