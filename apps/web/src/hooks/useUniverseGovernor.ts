import { useWaitForTransactionReceipt, useReadContract, useChainId, usePublicClient } from 'wagmi';
import { useWriteContract } from '@/hooks/useCircleWrite';
import { universeGovernorAbi } from '@loar/abis/generated';
import { decodeEventLog, encodeAbiParameters } from 'viem';
import { universeAbi as universeAbiForEncoding } from '@loar/abis/generated';
import { confirmTx } from '@/components/tx-confirm';

function governorChainName(id: number | undefined): string {
  switch (id) {
    case 11155111:
      return 'Sepolia';
    case 84532:
      return 'Base Sepolia';
    case 8453:
      return 'Base';
    case 1:
      return 'Ethereum';
    default:
      return id ? `Chain ${id}` : 'Unknown chain';
  }
}

/**
 * Hook for interacting with a UniverseGovernor contract
 * Handles proposal creation, voting, and execution
 *
 * Usage:
 * const { propose, castVote, execute, ... } = useUniverseGovernor(governorAddress);
 */
export function useUniverseGovernor(governorAddress: `0x${string}` | undefined) {
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { writeContractAsync, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  /**
   * Create a new governance proposal. Waits for the tx receipt and parses the
   * ProposalCreated event to return the real on-chain `proposalId`.
   */
  const propose = async (params: {
    targets: `0x${string}`[];
    values: bigint[];
    calldatas: `0x${string}`[];
    description: string;
  }): Promise<{ txHash: `0x${string}`; proposalId: bigint | null }> => {
    if (!governorAddress) {
      throw new Error('Governor address is required');
    }

    // WEB-4: propose() can queue arbitrary calldata that — if passed and
    // executed — moves treasury funds. Show the targets explicitly so the
    // user eyeballs which contracts they're authorizing votes against.
    const ok = await confirmTx({
      title: 'Create governance proposal',
      description: params.description.slice(0, 140),
      chainName: governorChainName(chainId),
      functionName: 'propose',
      to: governorAddress,
      summary: [
        ['Targets', `${params.targets.length} contract${params.targets.length === 1 ? '' : 's'}`],
        ['First target', params.targets[0] ?? '—'],
        ['Total ETH committed', params.values.reduce((a, b) => a + b, 0n).toString() + ' wei'],
      ],
      confirmLabel: 'Sign proposal',
    });
    if (!ok) throw new Error('Cancelled by user');

    const txHash = await writeContractAsync({
      address: governorAddress,
      abi: universeGovernorAbi,
      functionName: 'propose',
      args: [params.targets, params.values, params.calldatas, params.description],
      chainId,
    });

    let proposalId: bigint | null = null;
    if (publicClient) {
      try {
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
        for (const log of receipt.logs) {
          if (log.address.toLowerCase() !== governorAddress.toLowerCase()) continue;
          try {
            const decoded = decodeEventLog({
              abi: universeGovernorAbi,
              data: log.data,
              topics: log.topics,
            });
            if (decoded.eventName === 'ProposalCreated') {
              const args = decoded.args as { proposalId?: bigint } | readonly unknown[];
              proposalId =
                'proposalId' in args && typeof args.proposalId === 'bigint'
                  ? args.proposalId
                  : ((args as readonly unknown[])[0] as bigint);
              break;
            }
          } catch {
            /* unrelated log */
          }
        }
      } catch {
        /* receipt fetch failed — caller can sync later */
      }
    }

    return { txHash, proposalId };
  };

  /**
   * Cast a vote on a proposal. Awaits tx confirmation.
   * @param support 0 = Against, 1 = For, 2 = Abstain
   */
  const castVote = async (params: {
    proposalId: bigint;
    support: 0 | 1 | 2;
  }): Promise<`0x${string}`> => {
    if (!governorAddress) {
      throw new Error('Governor address is required');
    }

    const txHash = await writeContractAsync({
      address: governorAddress,
      abi: universeGovernorAbi,
      functionName: 'castVote',
      args: [params.proposalId, params.support],
      chainId,
    });

    if (publicClient) {
      await publicClient.waitForTransactionReceipt({ hash: txHash });
    }

    return txHash;
  };

  /**
   * Cast a vote with a reason. Awaits tx confirmation.
   */
  const castVoteWithReason = async (params: {
    proposalId: bigint;
    support: 0 | 1 | 2;
    reason: string;
  }): Promise<`0x${string}`> => {
    if (!governorAddress) {
      throw new Error('Governor address is required');
    }

    const txHash = await writeContractAsync({
      address: governorAddress,
      abi: universeGovernorAbi,
      functionName: 'castVoteWithReason',
      args: [params.proposalId, params.support, params.reason],
      chainId,
    });

    if (publicClient) {
      await publicClient.waitForTransactionReceipt({ hash: txHash });
    }

    return txHash;
  };

  /**
   * Execute a proposal that has passed (post-timelock).
   */
  const execute = async (params: {
    targets: `0x${string}`[];
    values: bigint[];
    calldatas: `0x${string}`[];
    descriptionHash: `0x${string}`;
  }): Promise<`0x${string}`> => {
    if (!governorAddress) {
      throw new Error('Governor address is required');
    }

    // WEB-4: execute() runs arbitrary calldata post-timelock — this is the
    // actual "fire the treasury transfer" step. Confirm loudly.
    const ok = await confirmTx({
      title: 'Execute governance proposal',
      description: 'This runs every queued call in the proposal.',
      chainName: governorChainName(chainId),
      functionName: 'execute',
      to: governorAddress,
      summary: [
        ['Targets', `${params.targets.length} contract${params.targets.length === 1 ? '' : 's'}`],
        ['First target', params.targets[0] ?? '—'],
        ['Total ETH moved', params.values.reduce((a, b) => a + b, 0n).toString() + ' wei'],
      ],
      confirmLabel: 'Execute',
    });
    if (!ok) throw new Error('Cancelled by user');

    const txHash = await writeContractAsync({
      address: governorAddress,
      abi: universeGovernorAbi,
      functionName: 'execute',
      args: [params.targets, params.values, params.calldatas, params.descriptionHash],
      chainId,
    });

    if (publicClient) {
      await publicClient.waitForTransactionReceipt({ hash: txHash });
    }

    return txHash;
  };

  /**
   * Get the state of a proposal
   * Returns: 0=Pending, 1=Active, 2=Canceled, 3=Defeated, 4=Succeeded, 5=Queued, 6=Expired, 7=Executed
   */
  const useProposalState = (proposalId: bigint | undefined) => {
    return useReadContract({
      address: governorAddress,
      abi: universeGovernorAbi,
      functionName: 'state',
      args: proposalId !== undefined ? [proposalId] : undefined,
      query: {
        enabled: !!governorAddress && proposalId !== undefined,
      },
      chainId,
    });
  };

  /**
   * Get the voting power of an account at a specific block
   */
  const useGetVotes = (account: `0x${string}` | undefined, blockNumber: bigint | undefined) => {
    return useReadContract({
      address: governorAddress,
      abi: universeGovernorAbi,
      functionName: 'getVotes',
      args: account && blockNumber !== undefined ? [account, blockNumber] : undefined,
      query: {
        enabled: !!governorAddress && !!account && blockNumber !== undefined,
      },
      chainId,
    });
  };

  /**
   * Check if an account has voted on a proposal
   */
  const useHasVoted = (proposalId: bigint | undefined, account: `0x${string}` | undefined) => {
    return useReadContract({
      address: governorAddress,
      abi: universeGovernorAbi,
      functionName: 'hasVoted',
      args: proposalId !== undefined && account ? [proposalId, account] : undefined,
      query: {
        enabled: !!governorAddress && proposalId !== undefined && !!account,
      },
      chainId,
    });
  };

  /**
   * Get proposal votes (for, against, abstain)
   */
  const useProposalVotes = (proposalId: bigint | undefined) => {
    return useReadContract({
      address: governorAddress,
      abi: universeGovernorAbi,
      functionName: 'proposalVotes',
      args: proposalId !== undefined ? [proposalId] : undefined,
      query: {
        enabled: !!governorAddress && proposalId !== undefined,
      },
      chainId,
    });
  };

  /**
   * Get the voting token address
   */
  const useToken = () => {
    return useReadContract({
      address: governorAddress,
      abi: universeGovernorAbi,
      functionName: 'token',
      query: {
        enabled: !!governorAddress,
      },
      chainId,
    });
  };

  return {
    propose,
    castVote,
    castVoteWithReason,
    execute,
    useProposalState,
    useGetVotes,
    useHasVoted,
    useProposalVotes,
    useToken,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    error,
  };
}

/**
 * Helper function to create a proposal for canonizing a node
 * This encodes a call to Universe.setCanon(nodeId)
 */
export function encodeCanonizeNodeProposal(universeAddress: `0x${string}`, nodeId: bigint) {
  const calldata = encodeAbiParameters(
    universeAbiForEncoding.find((f: any) => f.name === 'setCanon')?.inputs || [],
    [nodeId]
  );

  return {
    targets: [universeAddress],
    values: [0n],
    calldatas: [calldata],
    description: `Canonize Node #${nodeId}`,
  };
}
