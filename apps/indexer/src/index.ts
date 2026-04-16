/**
 * Ponder Event Handlers
 *
 * Indexes on-chain events from the LOAR protocol contracts on Sepolia:
 * - UniverseManager: universe creation, token deployments, hook/locker config
 * - Universe: node creation, canonization, media updates
 * - UniverseGovernor: proposals, votes, execution
 * - GovernanceERC20: token transfers, holder balance tracking
 * - PoolManager: Uniswap v4 swap events
 */
import { ponder } from 'ponder:registry';
import {
  universe,
  token,
  hookEvent,
  node,
  nodeCanonization,
  nodeContent,
  tokenTransfer,
  tokenHolder,
  pool,
  swap,
  proposal,
  proposalExecution,
  proposalCancellation,
  vote,
} from 'ponder:schema';
import { getAddress } from 'viem';

// ============= UniverseManager Events =============

ponder.on('UniverseManager:UniverseCreated', async ({ event, context }) => {
  const universeAddress = getAddress(event.args.universe).toLowerCase() as `0x${string}`;

  // Read metadata directly from the Universe contract
  let universeName = 'Untitled Universe';
  let universeDescription = 'A narrative universe';
  let imageURL = '';

  try {
    const nameResult = await context.client.readContract({
      abi: context.contracts.Universe.abi,
      address: universeAddress,
      functionName: 'universeName',
    });
    universeName = nameResult as string;

    const descResult = await context.client.readContract({
      abi: context.contracts.Universe.abi,
      address: universeAddress,
      functionName: 'universeDescription',
    });
    universeDescription = descResult as string;

    const imageResult = await context.client.readContract({
      abi: context.contracts.Universe.abi,
      address: universeAddress,
      functionName: 'universeImageUrl',
    });
    imageURL = imageResult as string;
  } catch (error) {
    console.error(`Failed to read universe metadata for ${universeAddress}:`, error);
  }

  await context.db.insert(universe).values({
    id: universeAddress,
    universeId: null, // We don't have direct access to the ID in the event
    creator: getAddress(event.args.creator),
    createdAt: Number(event.block.timestamp),
    name: universeName,
    description: universeDescription,
    imageURL: imageURL,
    tokenAddress: null,
    governorAddress: null,
    nodeCount: 0,
  });
});

ponder.on('UniverseManager:TokenCreated', async ({ event, context }) => {
  const tokenAddress = getAddress(event.args.tokenAddress);
  const deployer = getAddress(event.args.msgSender);
  const governorAddress = getAddress(event.args.governor);

  // Resolve the universe this token belongs to by reading the contract.
  // deployUniverseToken sets universe.token and universe.admin to the governor,
  // so we can find the universe that just had its governor set to this address.
  // Alternatively, look up by deployer (creator) — the most recent universe
  // with tokenAddress=null created by this deployer is the match.
  let resolvedUniverseAddress: `0x${string}` = '0x0000000000000000000000000000000000000000';

  try {
    // Query universes created by this deployer that don't have a token yet
    const universes = await context.db.sql`
      SELECT id FROM universe
      WHERE creator = ${deployer} AND "tokenAddress" IS NULL
      ORDER BY "createdAt" DESC
      LIMIT 1
    `;
    if (universes.rows.length > 0) {
      resolvedUniverseAddress = universes.rows[0].id as `0x${string}`;

      // Also update the universe record with token + governor addresses
      await context.db.update(universe, { id: resolvedUniverseAddress }).set({
        tokenAddress: tokenAddress,
        governorAddress: governorAddress,
      });
    }
  } catch (err) {
    console.error('Failed to resolve universe for token:', err);
  }

  await context.db.insert(token).values({
    id: tokenAddress,
    universeAddress: resolvedUniverseAddress,
    deployer: deployer,
    tokenAdmin: getAddress(event.args.tokenAdmin),
    name: event.args.tokenName,
    symbol: event.args.tokenSymbol,
    imageURL: event.args.tokenImage,
    metadata: event.args.tokenMetadata,
    context: event.args.tokenContext,
    startingTick: event.args.startingTick.toString(),
    poolHook: getAddress(event.args.poolHook),
    poolId: event.args.poolId,
    pairedToken: getAddress(event.args.pairedToken),
    locker: getAddress(event.args.locker),
    createdAt: Number(event.block.timestamp),
  });
});

ponder.on('UniverseManager:SetHook', async ({ event, context }) => {
  await context.db.insert(hookEvent).values({
    id: event.id,
    timestamp: Number(event.block.timestamp),
    hook_address: getAddress(event.args.hook),
    enabled: event.args.enabled,
  });
});

// ============= Universe (Dynamic Contract) Events =============

ponder.on('Universe:NodeCreated', async ({ event, context }) => {
  const universeAddress = getAddress(event.log.address).toLowerCase() as `0x${string}`;
  const nodeId = Number(event.args.id);

  // Content is now available directly in event args (no readContract needed)
  const contentHash = event.args.contentHash;
  const plotHash = event.args.plotHash;
  const videoLink = event.args.link;
  const plot = event.args.plot;

  // Insert node with content hashes
  await context.db.insert(node).values({
    id: `${universeAddress}:${nodeId}`,
    universeAddress: universeAddress,
    nodeId: nodeId,
    previousNodeId: Number(event.args.previous),
    creator: getAddress(event.args.creator),
    createdAt: Number(event.block.timestamp),
    contentHash: contentHash,
    plotHash: plotHash,
  });

  // Insert node content (full strings from event, plus hashes)
  await context.db.insert(nodeContent).values({
    id: `${universeAddress}:${nodeId}`,
    contentHash: contentHash,
    plotHash: plotHash,
    videoLink: videoLink,
    plot: plot,
  });

  // Increment node count for the universe
  const universeRecord = await context.db.find(universe, { id: universeAddress });

  if (universeRecord) {
    await context.db
      .update(universe, { id: universeAddress })
      .set({ nodeCount: universeRecord.nodeCount + 1 });
  }
});

ponder.on('Universe:NodeCanonized', async ({ event, context }) => {
  const universeAddress = getAddress(event.log.address).toLowerCase() as `0x${string}`;
  const nodeId = Number(event.args.id);

  await context.db.insert(nodeCanonization).values({
    id: `${universeAddress}:${nodeId}:${event.id}`,
    universeAddress: universeAddress,
    nodeId: nodeId,
    canonizer: getAddress(event.args.canonizer),
    timestamp: Number(event.block.timestamp),
  });
});

ponder.on('Universe:MediaUpdated', async ({ event, context }) => {
  const universeAddress = getAddress(event.log.address).toLowerCase() as `0x${string}`;
  const nodeId = Number(event.args.nodeId);
  const compositeId = `${universeAddress}:${nodeId}`;

  // Update node content with new media hash and link
  const existing = await context.db.find(nodeContent, { id: compositeId });
  if (existing) {
    await context.db.update(nodeContent, { id: compositeId }).set({
      contentHash: event.args.contentHash,
      videoLink: event.args.link,
    });
  }

  // Update node record with new content hash
  const existingNode = await context.db.find(node, { id: compositeId });
  if (existingNode) {
    await context.db.update(node, { id: compositeId }).set({
      contentHash: event.args.contentHash,
    });
  }
});

ponder.on('Universe:TokenUpdated', async ({ event, context }) => {
  const universeAddress = getAddress(event.log.address).toLowerCase() as `0x${string}`;
  const tokenAddress = getAddress(event.args.token);

  const existing = await context.db.find(universe, { id: universeAddress });
  if (existing) {
    await context.db.update(universe, { id: universeAddress }).set({
      tokenAddress: tokenAddress,
    });
  }
});

ponder.on('Universe:AdminUpdated', async ({ event, context }) => {
  const universeAddress = getAddress(event.log.address).toLowerCase() as `0x${string}`;
  // Universe schema doesn't have an admin field currently, but we log the event
  // for future use. If admin tracking is needed, add an 'admin' column to the universe table.
  console.log(
    `[indexer] Admin updated for ${universeAddress} to ${getAddress(event.args.newAdmin)}`
  );
});

// ============= UniverseGovernor Events =============

ponder.on('UniverseGovernor:ProposalCreated', async ({ event, context }) => {
  const governorAddress = getAddress(event.log.address);
  const proposalId = event.args.proposalId.toString();

  // Universe address is resolved lazily in the API layer via governor→universe join.
  // Handler context does not support Drizzle select queries.
  const universeAddress: `0x${string}` | null = null;

  await context.db.insert(proposal).values({
    id: proposalId,
    governorAddress: governorAddress,
    universeAddress: universeAddress,
    proposer: getAddress(event.args.proposer),
    targets: JSON.stringify(event.args.targets),
    values: JSON.stringify(event.args.values.map((v) => v.toString())),
    calldatas: JSON.stringify(event.args.calldatas),
    description: event.args.description,
    startBlock: Number(event.args.voteStart),
    endBlock: Number(event.args.voteEnd),
    createdAt: Number(event.block.timestamp),
    executed: false,
    cancelled: false,
  });
});

ponder.on('UniverseGovernor:ProposalExecuted', async ({ event, context }) => {
  const governorAddress = getAddress(event.log.address);
  const proposalId = event.args.proposalId.toString();

  // Update proposal status
  await context.db.update(proposal, { id: proposalId }).set({ executed: true });

  // Record execution event
  await context.db.insert(proposalExecution).values({
    id: event.id,
    proposalId: proposalId,
    governorAddress: governorAddress,
    timestamp: Number(event.block.timestamp),
  });
});

ponder.on('UniverseGovernor:ProposalCanceled', async ({ event, context }) => {
  const governorAddress = getAddress(event.log.address);
  const proposalId = event.args.proposalId.toString();

  // Update proposal status
  await context.db.update(proposal, { id: proposalId }).set({ cancelled: true });

  // Record cancellation event
  await context.db.insert(proposalCancellation).values({
    id: event.id,
    proposalId: proposalId,
    governorAddress: governorAddress,
    timestamp: Number(event.block.timestamp),
  });
});

ponder.on('UniverseGovernor:VoteCast', async ({ event, context }) => {
  const governorAddress = getAddress(event.log.address);
  const proposalId = event.args.proposalId.toString();
  const voter = getAddress(event.args.voter);

  await context.db.insert(vote).values({
    id: `${proposalId}:${voter}`,
    proposalId: proposalId,
    governorAddress: governorAddress,
    voter: voter,
    support: event.args.support,
    weight: event.args.weight.toString(),
    reason: event.args.reason || null,
    timestamp: Number(event.block.timestamp),
  });
});

// ============= Token Transfer Tracking =============

ponder.on('GovernanceToken:Transfer', async ({ event, context }) => {
  const tokenAddress = getAddress(event.log.address);
  const from = getAddress(event.args.from);
  const to = getAddress(event.args.to);
  const amount = event.args.amount;

  // Record transfer
  await context.db.insert(tokenTransfer).values({
    id: event.id,
    tokenAddress,
    from,
    to,
    value: amount.toString(),
    timestamp: Number(event.block.timestamp),
    blockNumber: Number(event.block.number),
  });

  // Update holder balances (skip mint/burn from/to zero address for balance tracking)
  if (from !== '0x0000000000000000000000000000000000000000') {
    const fromHolder = await context.db.find(tokenHolder, { id: `${tokenAddress}:${from}` });
    if (fromHolder) {
      const newBalance = BigInt(fromHolder.balance) - amount;
      if (newBalance > 0n) {
        await context.db
          .update(tokenHolder, { id: `${tokenAddress}:${from}` })
          .set({ balance: newBalance.toString() });
      } else {
        await context.db
          .update(tokenHolder, { id: `${tokenAddress}:${from}` })
          .set({ balance: '0' });
      }
    }
  }

  if (to !== '0x0000000000000000000000000000000000000000') {
    await context.db
      .insert(tokenHolder)
      .values({
        id: `${tokenAddress}:${to}`,
        tokenAddress,
        holderAddress: to,
        balance: amount.toString(),
      })
      .onConflictDoUpdate((row) => ({
        balance: (BigInt(row.balance) + amount).toString(),
      }));
  }
});

// ============= Uniswap v4 Pool Tracking =============

ponder.on('PoolManager:Initialize', async ({ event, context }) => {
  await context.db.insert(pool).values({
    poolId: event.args.id,
    currency0: getAddress(event.args.currency0),
    currency1: getAddress(event.args.currency1),
    fee: event.args.fee,
    tickSpacing: event.args.tickSpacing,
    hooks: getAddress(event.args.hooks),
    sqrtPriceX96: event.args.sqrtPriceX96.toString(),
    tick: event.args.tick,
    creationBlock: Number(event.block.number),
  });
});

ponder.on('PoolManager:Swap', async ({ event, context }) => {
  await context.db.insert(swap).values({
    id: event.id,
    poolId: event.args.id,
    sender: getAddress(event.args.sender),
    amount0: event.args.amount0.toString(),
    amount1: event.args.amount1.toString(),
    sqrtPriceX96: event.args.sqrtPriceX96.toString(),
    liquidity: event.args.liquidity.toString(),
    tick: event.args.tick,
    timestamp: Number(event.block.timestamp),
    blockNumber: Number(event.block.number),
  });
});
