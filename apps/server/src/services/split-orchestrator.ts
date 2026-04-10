/**
 * Split Orchestrator
 *
 * Computes revenue split arrays for content generated within a universe.
 * Returns the Split[] structure compatible with SplitRouter.sol's setSplits().
 *
 * Flow:
 * 1. Load split config from Firestore (or use defaults)
 * 2. Build recipient array: [generator, universeCreator, platform]
 * 3. Return as both structured data and ABI-encoded calldata
 */
import { db } from '../lib/firebase';
import { encodeFunctionData, keccak256, encodePacked } from 'viem';

const PLATFORM_BPS = 1000;
const DEFAULT_UNIVERSE_CREATOR_BPS = 2000;
const TOTAL_BPS = 10000;

// Platform treasury address — loaded from env
const PLATFORM_TREASURY =
  process.env.PLATFORM_TREASURY_ADDRESS || '0x0000000000000000000000000000000000000000';

export interface SplitRecipient {
  recipient: string;
  bps: number;
  label: string;
}

export interface ComputedSplits {
  splits: SplitRecipient[];
  entityHash: string | null;
  totalBps: number;
}

/**
 * Compute the entity hash for a content piece in SplitRouter.
 * entityHash = keccak256(abi.encodePacked("content", contentId))
 */
export function computeEntityHash(contentId: string): string {
  return keccak256(encodePacked(['string', 'string'], ['content:', contentId]));
}

/**
 * Load split config for a universe from Firestore, or return defaults.
 */
async function loadSplitConfig(universeId: string) {
  if (!db) return null;

  const doc = await db.collection('splitConfigs').doc(universeId.toLowerCase()).get();
  if (!doc.exists) return null;
  return doc.data();
}

/**
 * Compute splits for content generated in a universe.
 * Returns the Split[] array and metadata.
 */
export async function computeSplitsForContent(
  universeId: string,
  generatorAddress: string
): Promise<ComputedSplits> {
  const config = await loadSplitConfig(universeId);

  const universeCreatorBps = config?.universeCreatorBps ?? DEFAULT_UNIVERSE_CREATOR_BPS;
  const universeCreatorAddress = config?.universeCreatorAddress;
  const generatorBps = TOTAL_BPS - universeCreatorBps - PLATFORM_BPS;

  const splits: SplitRecipient[] = [];

  // Generator gets their share
  if (generatorBps > 0) {
    splits.push({
      recipient: generatorAddress,
      bps: generatorBps,
      label: 'Content Generator',
    });
  }

  // Universe creator gets their share (if address is set and BPS > 0)
  if (universeCreatorBps > 0 && universeCreatorAddress) {
    splits.push({
      recipient: universeCreatorAddress,
      bps: universeCreatorBps,
      label: 'Universe Creator',
    });
  } else if (universeCreatorBps > 0) {
    // No universe creator address — give their share to generator
    splits[0].bps += universeCreatorBps;
  }

  // Platform treasury
  if (PLATFORM_BPS > 0) {
    splits.push({
      recipient: PLATFORM_TREASURY,
      bps: PLATFORM_BPS,
      label: 'Platform',
    });
  }

  // Validate total
  const totalBps = splits.reduce((sum, s) => sum + s.bps, 0);

  return {
    splits,
    entityHash: null, // set when contentId is known
    totalBps,
  };
}

/**
 * Build SplitRouter.setSplits() calldata for a specific content piece.
 * This is returned to the client for signing.
 */
export function buildSetSplitsCalldata(entityHash: string, splits: SplitRecipient[]): string {
  const SPLIT_ROUTER_ABI = [
    {
      name: 'setSplits',
      type: 'function',
      inputs: [
        { name: 'entityHash', type: 'bytes32' },
        {
          name: 'splits',
          type: 'tuple[]',
          components: [
            { name: 'recipient', type: 'address' },
            { name: 'bps', type: 'uint16' },
          ],
        },
      ],
      outputs: [],
    },
  ] as const;

  return encodeFunctionData({
    abi: SPLIT_ROUTER_ABI,
    functionName: 'setSplits',
    args: [
      entityHash as `0x${string}`,
      splits.map((s) => ({
        recipient: s.recipient as `0x${string}`,
        bps: s.bps,
      })),
    ],
  });
}

/**
 * Record a content split assignment in Firestore for tracking.
 */
export async function recordContentSplit(
  contentId: string,
  universeId: string,
  generatorAddress: string,
  splits: SplitRecipient[],
  entityHash: string
): Promise<void> {
  if (!db) return;

  await db
    .collection('contentSplits')
    .doc(contentId)
    .set({
      contentId,
      universeId: universeId.toLowerCase(),
      generatorAddress: generatorAddress.toLowerCase(),
      entityHash,
      splits: splits.map((s) => ({
        recipient: s.recipient.toLowerCase(),
        bps: s.bps,
        label: s.label,
      })),
      configured: false, // true after on-chain TX confirmed
      createdAt: new Date(),
    });
}
