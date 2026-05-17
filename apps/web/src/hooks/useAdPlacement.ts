/**
 * useAdPlacement — Circle DCW-signed wrappers for AdPlacement writes.
 *
 * Every contract call goes through `useWriteContract` → POST /api/tx/write
 * (server-side Circle DCW signer). No MetaMask popup.
 *
 * Inlines a minimal ABI; once `forge build && wagmi generate` runs in CI,
 * switch to the generated `adPlacementAbi` from @loar/abis/generated.
 */
import { useChainId } from 'wagmi';
import { useWriteContract } from '@/hooks/useCircleWrite';
import { AdPlacement } from '@loar/abis/addresses';
import type { Abi, Hex } from 'viem';

type ChainKey = keyof typeof AdPlacement;

function contractAddress(chainId: number): Hex | null {
  const key = String(chainId) as ChainKey;
  const addr = AdPlacement[key];
  return (addr as Hex | undefined) ?? null;
}

const AD_PLACEMENT_ABI = [
  {
    type: 'function',
    name: 'createAdSlot',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'universeId', type: 'uint256' },
      { name: 'placementType', type: 'uint8' },
      { name: 'minBid', type: 'uint256' },
      { name: 'episodes', type: 'uint256' },
      { name: 'metadata', type: 'string' },
    ],
    outputs: [{ name: 'slotId', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'bid',
    stateMutability: 'payable',
    inputs: [{ name: 'slotId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'cancelBid',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'slotId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'acceptBid',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'slotId', type: 'uint256' }],
    outputs: [{ name: 'sponsorshipId', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'withdrawRefund',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
] as const satisfies Abi;

const PLACEMENT_TYPE_MAP: Record<string, number> = {
  BILLBOARD: 0,
  PRODUCT: 1,
  SPONSORED_CHARACTER: 2,
  AUDIO_MENTION: 3,
};

export function useAdPlacementWrite() {
  const chainId = useChainId();
  const { writeContractAsync, isPending } = useWriteContract();

  async function createAdSlot(args: {
    universeId: bigint;
    placementType: keyof typeof PLACEMENT_TYPE_MAP;
    minBid: bigint; // wei
    episodes: bigint;
    metadata: string;
  }): Promise<Hex> {
    const address = contractAddress(chainId);
    if (!address) throw new Error(`AdPlacement not deployed on chain ${chainId}`);

    const hash = await writeContractAsync({
      address,
      abi: AD_PLACEMENT_ABI,
      functionName: 'createAdSlot',
      args: [
        args.universeId,
        PLACEMENT_TYPE_MAP[args.placementType],
        args.minBid,
        args.episodes,
        args.metadata,
      ] as const,
      chainId,
    });

    return hash as Hex;
  }

  async function placeBid(args: { slotId: bigint; bidValueWei: string }): Promise<Hex> {
    const address = contractAddress(chainId);
    if (!address) throw new Error(`AdPlacement not deployed on chain ${chainId}`);

    const hash = await writeContractAsync({
      address,
      abi: AD_PLACEMENT_ABI,
      functionName: 'bid',
      args: [args.slotId] as const,
      value: BigInt(args.bidValueWei),
      chainId,
    });

    return hash as Hex;
  }

  async function acceptBid(args: { slotId: bigint }): Promise<Hex> {
    const address = contractAddress(chainId);
    if (!address) throw new Error(`AdPlacement not deployed on chain ${chainId}`);

    const hash = await writeContractAsync({
      address,
      abi: AD_PLACEMENT_ABI,
      functionName: 'acceptBid',
      args: [args.slotId] as const,
      chainId,
    });

    return hash as Hex;
  }

  async function cancelBid(args: { slotId: bigint }): Promise<Hex> {
    const address = contractAddress(chainId);
    if (!address) throw new Error(`AdPlacement not deployed on chain ${chainId}`);

    const hash = await writeContractAsync({
      address,
      abi: AD_PLACEMENT_ABI,
      functionName: 'cancelBid',
      args: [args.slotId] as const,
      chainId,
    });

    return hash as Hex;
  }

  async function withdrawRefund(): Promise<Hex> {
    const address = contractAddress(chainId);
    if (!address) throw new Error(`AdPlacement not deployed on chain ${chainId}`);

    const hash = await writeContractAsync({
      address,
      abi: AD_PLACEMENT_ABI,
      functionName: 'withdrawRefund',
      args: [] as const,
      chainId,
    });

    return hash as Hex;
  }

  return { createAdSlot, placeBid, acceptBid, cancelBid, withdrawRefund, isPending };
}
