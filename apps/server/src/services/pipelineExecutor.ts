/**
 * Pipeline Executor Service
 *
 * Executes AI agent pipelines step-by-step, mapping outputs between steps,
 * checking permissions, and managing credit budgets.
 *
 * Each pipeline step maps to an internal handler function from the existing
 * router system (entities, studio, generation, marketplace, etc.)
 */
import { db } from '../lib/firebase';
import { TRPCError } from '@trpc/server';
import { FieldValue } from 'firebase-admin/firestore';
import {
  PERMISSION_ACTION_MAP,
  type AIAgentPermission,
  type PipelineStep,
  type PipelineRunStep,
} from '../routers/aiAgents/aiAgents.types';
import { deductAgentCredits, refundAgentCredits } from './aiAgentCredits';
import { executeTransaction, getOrCreateWallet } from '../lib/circle-wallets';
import { encodeFunctionData, type Abi, type Hex } from 'viem';

// Minimal ABIs for the on-chain actions the executor can sign. Kept inline
// to avoid pulling the full @loar/abis dist into the server bundle — only
// the function signatures we actually invoke.
const STORY_BOUNTIES_POST_ABI = [
  {
    type: 'function',
    name: 'postBounty',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'universeId', type: 'uint256' },
      { name: 'reward', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'contentType', type: 'string' },
    ],
    outputs: [{ name: 'bountyId', type: 'uint256' }],
  },
] as const satisfies Abi;

const EPISODE_NFT_MINT_ABI = [
  {
    type: 'function',
    name: 'createEpisode',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'metadataURI', type: 'string' },
      { name: 'mintPrice', type: 'uint256' },
      { name: 'maxSupply', type: 'uint256' },
      { name: 'royaltyBps', type: 'uint256' },
    ],
    outputs: [{ name: 'episodeId', type: 'uint256' }],
  },
] as const satisfies Abi;

const CANON_MARKETPLACE_SUBMIT_ABI = [
  {
    type: 'function',
    name: 'submit',
    stateMutability: 'payable',
    inputs: [
      { name: 'universeId', type: 'uint256' },
      { name: 'subType', type: 'uint8' },
      { name: 'contentHash', type: 'bytes32' },
      { name: 'metadataURI', type: 'string' },
    ],
    outputs: [{ name: 'submissionId', type: 'uint256' }],
  },
] as const satisfies Abi;

// ── Types ──────────────────────────────────────────────────────────────

interface AgentContext {
  agentId: string;
  createdByUid: string;
  universeId: string | null;
  permissions: AIAgentPermission[];
  /** G3: when true, generation/image actions tag their queued docs with
   *  `useBYOK: true` so the downstream worker bills against the agent
   *  owner's stored API keys instead of platform credits. */
  useBYOK: boolean;
  /** G1: which EVM chain on-chain actions should target. Default is Base
   *  Sepolia (84532) for testnet; the agent owner's Circle DCW wallet is
   *  resolved at execution time. */
  chainId: number;
}

// ── G1 helper: sign an EVM tx via the agent owner's Circle DCW ─────────
//
// Encodes the function call, fetches or provisions the owner's wallet, and
// submits the contract execution. Synchronous path — waits up to 60s for
// COMPLETE state. Throws on any error so the pipeline step's retry loop
// can decide whether to abort.

interface AgentEvmTxInput {
  ownerUid: string;
  contractAddress: string;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
  value?: string; // wei as string
  chainId: number;
}

async function executeAgentEvmTx(input: AgentEvmTxInput): Promise<{ txHash: string }> {
  const wallet = await getOrCreateWallet(input.ownerUid, input.chainId);
  const calldata = encodeFunctionData({
    abi: input.abi,
    functionName: input.functionName,
    args: input.args,
  }) as Hex;

  const result = await executeTransaction({
    walletId: wallet.walletId,
    contractAddress: input.contractAddress,
    calldata,
    chainId: input.chainId,
    value: input.value,
  });

  if (!result.txHash) {
    throw new Error(
      `On-chain action returned no tx hash (state: ${result.state}, txId: ${result.txId})`
    );
  }
  return { txHash: result.txHash };
}

interface StepResult {
  output: Record<string, unknown>;
  creditsUsed: number;
}

// ── Action Registry ────────────────────────────────────────────────────
// Maps pipeline action strings to internal handler functions.
// Each action receives merged input (static config + mapped outputs from prior steps)
// and the agent context. Returns an output object.

type ActionHandler = (input: Record<string, unknown>, ctx: AgentContext) => Promise<StepResult>;

const ACTION_REGISTRY: Record<string, ActionHandler> = {
  'entities.create': async (input, ctx) => {
    const entitiesCol = db.collection('entities');
    const entity = {
      name: input.name as string,
      description: (input.description as string) || '',
      kind: (input.kind as string) || 'thing',
      universeAddress: ctx.universeId,
      parentId: (input.parentId as string) || null,
      nodeIds: [],
      imageUrl: (input.imageUrl as string) || null,
      metadata: (input.metadata as Record<string, unknown>) || {},
      creator: ctx.createdByUid,
      monetized: false,
      rightsDeclaration: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const ref = await entitiesCol.add(entity);
    return { output: { id: ref.id, ...entity }, creditsUsed: 0 };
  },

  'entities.update': async (input, ctx) => {
    const entityId = input.entityId as string;
    if (!entityId) throw new Error('entityId required');

    // Whitelist allowed fields to prevent privilege escalation
    const ALLOWED_FIELDS = ['name', 'description', 'parentId', 'imageUrl', 'metadata', 'kind'];
    const updates: Record<string, unknown> = {};
    for (const field of ALLOWED_FIELDS) {
      if (input[field] !== undefined) {
        updates[field] = input[field];
      }
    }

    const ref = db.collection('entities').doc(entityId);
    const existing = (await ref.get()).data();
    if (!existing) throw new Error('Entity not found');
    if (existing.creator !== ctx.createdByUid) {
      throw new Error('Agent can only update entities created by its owner');
    }

    await ref.update({ ...updates, updatedAt: new Date() });

    return { output: { id: entityId, updated: true }, creditsUsed: 0 };
  },

  'studio.createEntityPack': async (input, ctx) => {
    // Create a studio job record — the actual generation is handled by the studio service
    const studioJobsCol = db.collection('studioJobs');
    const job = {
      entityId: input.entityId as string,
      entityKind: (input.entityKind as string) || 'thing',
      capabilities: (input.capabilities as string[]) || ['portrait', 'lore_card'],
      overrides: (input.overrides as Record<string, unknown>) || {},
      userId: ctx.createdByUid,
      aiAgentId: ctx.agentId,
      status: 'queued',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const ref = await studioJobsCol.add(job);
    // Estimate ~10 credits per capability
    const estimatedCredits = (job.capabilities.length || 1) * 10;
    return { output: { jobId: ref.id, ...job }, creditsUsed: estimatedCredits };
  },

  'generation.generate': async (input, ctx) => {
    // Create a generation record — uses existing generation infrastructure
    const generationsCol = db.collection('videoGenerations');
    const gen = {
      prompt: input.prompt as string,
      mode: (input.mode as string) || 'text_to_video',
      durationSec: (input.durationSec as number) || 5,
      routingMode: 'auto',
      userId: ctx.createdByUid,
      aiAgentId: ctx.agentId,
      universeId: ctx.universeId,
      useBYOK: ctx.useBYOK,
      status: 'queued',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const ref = await generationsCol.add(gen);
    // BYOK runs bill against the agent owner's external provider account,
    // not the platform's credit pool. Skip the platform-credit deduction.
    return { output: { generationId: ref.id, ...gen }, creditsUsed: ctx.useBYOK ? 0 : 15 };
  },

  'image.generate': async (input, ctx) => {
    const generationsCol = db.collection('imageGenerations');
    const gen = {
      prompt: input.prompt as string,
      count: (input.count as number) || 1,
      aspectRatio: (input.aspectRatio as string) || 'square_hd',
      userId: ctx.createdByUid,
      aiAgentId: ctx.agentId,
      universeId: ctx.universeId,
      useBYOK: ctx.useBYOK,
      status: 'queued',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const ref = await generationsCol.add(gen);
    return { output: { generationId: ref.id, ...gen }, creditsUsed: ctx.useBYOK ? 0 : 5 };
  },

  'marketplace.submit': async (input, ctx) => {
    const submissionsCol = db.collection('canonSubmissions');
    const submission = {
      universeId: ctx.universeId || (input.universeId as string),
      universeToken: (input.universeToken as string) || '',
      submissionType: (input.submissionType as string) || 'LORE_RULE',
      title: input.title as string,
      description: input.description as string,
      contentHash: (input.contentHash as string) || '',
      metadataURI: (input.metadataURI as string) || '',
      creatorUid: ctx.createdByUid,
      creatorAddress: null,
      aiAgentId: ctx.agentId,
      status: 'VOTING',
      votesFor: 0,
      votesAgainst: 0,
      voterCount: 0,
      votingDeadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const ref = await submissionsCol.add(submission);
    return { output: { submissionId: ref.id, ...submission }, creditsUsed: 0 };
  },

  'collabs.propose': async (input, ctx) => {
    const collabsCol = db.collection('collabs');
    const collab = {
      universeA: ctx.universeId || (input.universeA as string),
      universeB: input.universeB as string,
      revenueShareBps: (input.revenueShareBps as number) || 5000,
      durationDays: (input.durationDays as number) || 90,
      title: input.title as string,
      description: (input.description as string) || '',
      proposerUid: ctx.createdByUid,
      proposerAddress: null,
      acceptorUid: null,
      acceptorAddress: null,
      status: 'PROPOSED',
      totalRevenue: '0',
      episodeCount: 0,
      startTime: null,
      endTime: null,
      aiAgentId: ctx.agentId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const ref = await collabsCol.add(collab);
    return { output: { collabId: ref.id, ...collab }, creditsUsed: 0 };
  },

  'content.create': async (input, ctx) => {
    const contentCol = db.collection('content');
    const content = {
      title: input.title as string,
      body: (input.body as string) || '',
      contentType: (input.contentType as string) || 'text',
      universeId: ctx.universeId,
      creatorUid: ctx.createdByUid,
      aiAgentId: ctx.agentId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const ref = await contentCol.add(content);
    return { output: { contentId: ref.id, ...content }, creditsUsed: 0 };
  },

  // ── On-chain actions (G1: server-signed via owner's Circle DCW) ──────

  /** Post a bounty on the StoryBounties contract. Requires the agent owner's
   *  Circle DCW wallet to be funded with $LOAR for the escrow deposit and a
   *  little ETH for gas. The off-chain bounty record (Firestore) is written
   *  by a separate `bounty.create` action that follows this step. */
  'onchain.bounty.post': async (input, ctx) => {
    const contractAddress = (input.contractAddress as string) || process.env.STORY_BOUNTIES_ADDRESS;
    if (!contractAddress) throw new Error('STORY_BOUNTIES_ADDRESS not configured');

    const reward = input.reward as string;
    const deadline = input.deadline as number;
    const universeIdNum = input.universeIdOnChain as number;
    const contentType = (input.contentType as string) || 'other';

    const { txHash } = await executeAgentEvmTx({
      ownerUid: ctx.createdByUid,
      contractAddress,
      abi: STORY_BOUNTIES_POST_ABI,
      functionName: 'postBounty',
      args: [BigInt(universeIdNum ?? 0), BigInt(reward), BigInt(deadline), contentType],
      chainId: ctx.chainId,
    });

    return { output: { txHash, contractAddress, reward, deadline }, creditsUsed: 0 };
  },

  /** Mint an EpisodeNFT for content the agent created. The owner must already
   *  hold rights to the underlying content (enforced server-side at the
   *  upstream `nft.mintContent` mutation when actingUid resolves). */
  'onchain.nft.mintEpisode': async (input, ctx) => {
    const contractAddress = (input.contractAddress as string) || process.env.EPISODE_NFT_ADDRESS;
    if (!contractAddress) throw new Error('EPISODE_NFT_ADDRESS not configured');

    const metadataURI = input.metadataURI as string;
    const mintPrice = input.mintPrice as string;
    const maxSupply = (input.maxSupply as number) ?? 0;
    const royaltyBps = (input.royaltyBps as number) ?? 500;

    const { txHash } = await executeAgentEvmTx({
      ownerUid: ctx.createdByUid,
      contractAddress,
      abi: EPISODE_NFT_MINT_ABI,
      functionName: 'createEpisode',
      args: [metadataURI, BigInt(mintPrice), BigInt(maxSupply), BigInt(royaltyBps)],
      chainId: ctx.chainId,
    });

    return { output: { txHash, contractAddress, metadataURI }, creditsUsed: 0 };
  },

  /** Submit a canon proposal on-chain via CanonMarketplace. Off-chain
   *  Firestore mirror is `marketplace.submit` (above) — typically both steps
   *  run sequentially in a pipeline. */
  'onchain.marketplace.submit': async (input, ctx) => {
    const contractAddress =
      (input.contractAddress as string) || process.env.CANON_MARKETPLACE_ADDRESS;
    if (!contractAddress) throw new Error('CANON_MARKETPLACE_ADDRESS not configured');

    const universeIdNum = input.universeIdOnChain as number;
    const subType = (input.subType as number) ?? 0;
    const contentHash = input.contentHash as Hex;
    const metadataURI = input.metadataURI as string;
    const submissionFee = (input.submissionFee as string) ?? '0';

    const { txHash } = await executeAgentEvmTx({
      ownerUid: ctx.createdByUid,
      contractAddress,
      abi: CANON_MARKETPLACE_SUBMIT_ABI,
      functionName: 'submit',
      args: [BigInt(universeIdNum), subType, contentHash, metadataURI],
      value: submissionFee,
      chainId: ctx.chainId,
    });

    return { output: { txHash, contractAddress, contentHash }, creditsUsed: 0 };
  },

  'wiki.generate': async (input, ctx) => {
    // Creates a lore/wiki entry for an entity
    const entitiesCol = db.collection('entities');
    const entity = {
      name: input.name as string,
      description: (input.description as string) || '',
      kind: 'lore',
      universeAddress: ctx.universeId,
      parentId: (input.parentId as string) || null,
      nodeIds: [],
      imageUrl: null,
      metadata: {
        loreType: (input.loreType as string) || 'general',
        ...((input.metadata as Record<string, unknown>) || {}),
      },
      creator: ctx.createdByUid,
      monetized: false,
      rightsDeclaration: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const ref = await entitiesCol.add(entity);
    return { output: { entityId: ref.id, ...entity }, creditsUsed: 0 };
  },
};

// ── Input Mapping ──────────────────────────────────────────────────────

/**
 * Resolves input values from previous step outputs using dot notation.
 * e.g., "step_1.output.id" resolves to stepOutputs["step_1"].id
 */
function resolveInputMapping(
  mapping: Record<string, string>,
  stepOutputs: Record<string, Record<string, unknown>>,
  staticConfig: Record<string, unknown>
): Record<string, unknown> {
  const resolved: Record<string, unknown> = { ...staticConfig };

  for (const [key, path] of Object.entries(mapping)) {
    const parts = path.split('.');
    if (parts.length < 2) {
      resolved[key] = path; // literal value
      continue;
    }

    const [stepId, ...rest] = parts;
    let value: unknown = stepOutputs[stepId];
    for (const part of rest) {
      if (value && typeof value === 'object') {
        value = (value as Record<string, unknown>)[part];
      } else {
        value = undefined;
        break;
      }
    }
    resolved[key] = value;
  }

  return resolved;
}

// ── Permission Check ───────────────────────────────────────────────────

function checkPermission(action: string, permissions: AIAgentPermission[]): boolean {
  for (const perm of permissions) {
    const allowed = PERMISSION_ACTION_MAP[perm];
    if (allowed?.includes(action)) return true;
  }
  return false;
}

// ── Pipeline Executor ──────────────────────────────────────────────────

const pipelineRunsCol = () => db.collection('aiAgentPipelineRuns');
const aiAgentsCol = () => db.collection('aiAgents');

/**
 * Execute a pipeline. Called as fire-and-forget from the aiPipelines router.
 * Updates the run document in real-time as steps complete.
 */
export async function executePipeline(
  runId: string,
  steps: PipelineStep[],
  agentContext: AgentContext
): Promise<void> {
  const runRef = pipelineRunsCol().doc(runId);
  const stepOutputs: Record<string, Record<string, unknown>> = {};
  let totalCreditsUsed = 0;
  let allSucceeded = true;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    // Check permission
    if (!checkPermission(step.action, agentContext.permissions)) {
      const runStep: PipelineRunStep = {
        stepId: step.stepId,
        action: step.action,
        status: 'failed',
        input: {},
        output: null,
        creditsUsed: 0,
        startedAt: new Date(),
        completedAt: new Date(),
        error: `Agent lacks permission for action: ${step.action}`,
      };

      await updateRunStep(runRef, i, runStep);

      if (step.onFailure === 'abort') {
        allSucceeded = false;
        await runRef.update({ status: 'failed', completedAt: new Date(), totalCreditsUsed });
        return;
      }
      continue;
    }

    // Resolve inputs
    const input = resolveInputMapping(step.inputMapping, stepOutputs, step.config);

    // Mark step as running
    await updateRunStep(runRef, i, {
      stepId: step.stepId,
      action: step.action,
      status: 'running',
      input,
      output: null,
      creditsUsed: 0,
      startedAt: new Date(),
      completedAt: null,
      error: null,
    });

    // Execute with retry
    let lastError: string | null = null;
    let result: StepResult | null = null;
    const maxAttempts = 1 + (step.retryCount || 0);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const handler = ACTION_REGISTRY[step.action];
        if (!handler) {
          throw new Error(`Unknown action: ${step.action}`);
        }

        result = await handler(input, agentContext);

        // Deduct credits if this step costs anything
        if (result.creditsUsed > 0) {
          await deductAgentCredits(agentContext.agentId, result.creditsUsed);
        }

        lastError = null;
        break;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        if (attempt < maxAttempts - 1) {
          // Wait before retry (exponential backoff)
          await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
        }
      }
    }

    if (lastError || !result) {
      // Step failed
      const runStep: PipelineRunStep = {
        stepId: step.stepId,
        action: step.action,
        status: 'failed',
        input,
        output: null,
        creditsUsed: 0,
        startedAt: new Date(),
        completedAt: new Date(),
        error: lastError || 'Unknown error',
      };
      await updateRunStep(runRef, i, runStep);

      if (step.onFailure === 'abort') {
        allSucceeded = false;
        await runRef.update({ status: 'failed', completedAt: new Date(), totalCreditsUsed });
        return;
      } else if (step.onFailure === 'skip') {
        allSucceeded = false;
        continue;
      }
    } else {
      // Step succeeded
      stepOutputs[step.stepId] = result.output;
      totalCreditsUsed += result.creditsUsed;

      const runStep: PipelineRunStep = {
        stepId: step.stepId,
        action: step.action,
        status: 'completed',
        input,
        output: result.output,
        creditsUsed: result.creditsUsed,
        startedAt: new Date(),
        completedAt: new Date(),
        error: null,
      };
      await updateRunStep(runRef, i, runStep);
    }
  }

  // Update agent stats atomically to prevent race conditions
  await aiAgentsCol()
    .doc(agentContext.agentId)
    .update({
      lastRunAt: new Date(),
      totalRunCount: FieldValue.increment(1),
      creditBudgetSpent: FieldValue.increment(totalCreditsUsed),
      updatedAt: new Date(),
    });

  // Finalize run
  await runRef.update({
    status: allSucceeded ? 'completed' : 'partial',
    completedAt: new Date(),
    totalCreditsUsed,
  });
}

/** Update a single step in the run document */
async function updateRunStep(
  runRef: FirebaseFirestore.DocumentReference,
  stepIndex: number,
  step: PipelineRunStep
): Promise<void> {
  const doc = await runRef.get();
  if (!doc.exists) return;

  const steps = doc.data()?.steps || [];
  steps[stepIndex] = step;

  await runRef.update({ steps });
}
