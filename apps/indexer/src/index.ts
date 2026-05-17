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
import { sql } from 'ponder';
import {
  universe,
  token,
  bondingCurve,
  bondingCurveTrade,
  bondingCurveSnapshot,
  bondingCurveRefund,
  bondingCurveHaltEvent,
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
  canonSubmission,
  canonVote,
  adSlot,
  sponsorship,
  license,
  collab,
  creditEvent,
  paymentEvent,
  subscriptionEvent,
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

  // Resolve which universe this token belongs to.
  // Strategy 1: Read on-chain — iterate recent universe IDs to find the one
  // whose token was just set to this address.
  // Strategy 2: SQL fallback — match by deployer (creator) with no token yet.
  let resolvedUniverseAddress: `0x${string}` = '0x0000000000000000000000000000000000000000';

  try {
    // Read total supply to know how many universes exist
    const totalSupply = await context.client.readContract({
      abi: context.contracts.UniverseManager.abi,
      address: context.contracts.UniverseManager.address as `0x${string}`,
      functionName: 'totalSupply',
    });

    // Check the most recent universes first (most likely match)
    const count = Number(totalSupply);
    for (let i = count - 1; i >= Math.max(0, count - 10); i--) {
      try {
        const data = await context.client.readContract({
          abi: context.contracts.UniverseManager.abi,
          address: context.contracts.UniverseManager.address as `0x${string}`,
          functionName: 'getUniverseData',
          args: [BigInt(i)],
        });
        const [universeAddr, tokenAddr] = data as [
          `0x${string}`,
          `0x${string}`,
          `0x${string}`,
          `0x${string}`,
          `0x${string}`,
          `0x${string}`,
        ];
        if (getAddress(tokenAddr) === tokenAddress) {
          resolvedUniverseAddress = getAddress(universeAddr).toLowerCase() as `0x${string}`;
          break;
        }
      } catch {
        // Universe ID doesn't exist or call failed, skip
      }
    }
  } catch (err) {
    console.error('On-chain universe resolution failed, trying SQL fallback:', err);
  }

  // Fallback: SQL query by deployer.
  //
  // The on-chain back-resolution above scans the most recent 10 universes,
  // which races when two universes are created in the same block (or within
  // 10 universes of each other). This SQL fallback also races when one
  // creator deploys multiple universes in a single session.
  //
  // To minimize collisions:
  //   - Restrict the candidate row to the same block height (a tx that
  //     creates a universe and tx that deploys its token must be within the
  //     same block in the v3 deployer flow), AND
  //   - Require the candidate has no tokenAddress yet (still empty),
  //   - Order by createdAt DESC and take a single row.
  //
  // This is still not perfectly safe across reorgs / concurrent creates, but
  // tightens the window from "any prior universe by this creator" to "the
  // most-recent universe created in the same block by this creator", which is
  // accurate for the canonical single-tx flow. Long-term fix: emit `universeId`
  // in TokenCreated and switch to a direct lookup (contract change).
  if (resolvedUniverseAddress === '0x0000000000000000000000000000000000000000') {
    try {
      const deployerLower = deployer.toLowerCase();
      // 60-second window matches the canonical create-then-deploy single-tx
      // flow. Universes created earlier than that by the same deployer are
      // assumed to belong to a separate session and not picked up here.
      const tsLowerBound = Number(event.block.timestamp) - 60;
      const universes = await context.db.sql.execute(sql`
        SELECT id FROM universe
        WHERE LOWER(creator) = ${deployerLower}
          AND "tokenAddress" IS NULL
          AND "createdAt" >= ${tsLowerBound}
        ORDER BY "createdAt" DESC
        LIMIT 1
      `);
      if (universes.rows.length > 0) {
        resolvedUniverseAddress = universes.rows[0]!.id as `0x${string}`;
      }
    } catch (err) {
      console.error('SQL fallback for universe resolution also failed:', err);
    }
  }

  // Update the universe record with token + governor addresses
  if (resolvedUniverseAddress !== '0x0000000000000000000000000000000000000000') {
    try {
      await context.db.update(universe, { id: resolvedUniverseAddress }).set({
        tokenAddress: tokenAddress,
        governorAddress: governorAddress,
      });
    } catch (err) {
      console.error('Failed to update universe with token address:', err);
    }
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

// ============= Bonding Curve Events =============

ponder.on('UniverseManager:BondingCurveCreated', async ({ event, context }) => {
  await context.db.insert(bondingCurve).values({
    id: getAddress(event.args.bondingCurve),
    tokenAddress: getAddress(event.args.token),
    universeId: Number(event.args.universeId),
    graduationEth: event.args.graduationEth.toString(),
    curveSupply: event.args.curveSupply.toString(),
    graduated: false,
    graduatedAt: null,
    createdAt: Number(event.block.timestamp),
  });
});

ponder.on('UniverseManager:TokenGraduated', async ({ event, context }) => {
  // Find the bonding curve by token address and mark as graduated
  try {
    const curves = await context.db.sql.execute(sql`
      SELECT id FROM bonding_curve
      WHERE LOWER("tokenAddress") = ${getAddress(event.args.token).toLowerCase()}
      LIMIT 1
    `);
    if (curves.rows.length > 0) {
      await context.db.update(bondingCurve, { id: curves.rows[0]!.id as string }).set({
        graduated: true,
        graduatedAt: Number(event.block.timestamp),
      });
    }
  } catch (err) {
    console.error('Failed to update bonding curve graduation:', err);
  }
});

/// Shared helper: recompute curve aggregates on each trade so read paths don't
/// need to scan bondingCurveTrade. `deltaTokensSold` is signed (positive on buy,
/// negative on sell).
async function applyTradeToCurve(
  context: any,
  curveAddr: `0x${string}`,
  deltaTokensSold: bigint,
  deltaEthRaised: bigint,
  newPrice: bigint,
  timestamp: number,
  blockNumber: number,
  trigger: 'buy' | 'sell',
  eventId: string
) {
  const row = await context.db.find(bondingCurve, { id: curveAddr });
  if (!row) return; // Curve not yet indexed (out-of-order events shouldn't happen, but be safe)

  const nextTokensSold = BigInt(row.tokensSold) + deltaTokensSold;
  const nextEthRaised = BigInt(row.ethRaised) + deltaEthRaised;

  await context.db.update(bondingCurve, { id: curveAddr }).set({
    tokensSold: (nextTokensSold < 0n ? 0n : nextTokensSold).toString(),
    ethRaised: (nextEthRaised < 0n ? 0n : nextEthRaised).toString(),
    lastPrice: newPrice.toString(),
    tradeCount: row.tradeCount + 1,
  });

  await context.db.insert(bondingCurveSnapshot).values({
    id: eventId,
    bondingCurve: curveAddr,
    blockNumber,
    timestamp,
    tokensSold: (nextTokensSold < 0n ? 0n : nextTokensSold).toString(),
    ethRaised: (nextEthRaised < 0n ? 0n : nextEthRaised).toString(),
    price: newPrice.toString(),
    trigger,
  });
}

ponder.on('BondingCurve:TokensPurchased', async ({ event, context }) => {
  const id = `${event.transaction.hash}:${event.log.logIndex}`;
  const curveAddr = getAddress(event.log.address);
  await context.db.insert(bondingCurveTrade).values({
    id,
    bondingCurve: curveAddr,
    trader: getAddress(event.args.buyer),
    isBuy: true,
    ethAmount: event.args.ethAmount.toString(),
    tokenAmount: event.args.tokenAmount.toString(),
    price: event.args.newPrice.toString(),
    timestamp: Number(event.block.timestamp),
  });
  await applyTradeToCurve(
    context,
    curveAddr,
    event.args.tokenAmount,
    event.args.ethAmount,
    event.args.newPrice,
    Number(event.block.timestamp),
    Number(event.block.number),
    'buy',
    `${id}:snap`
  );
});

ponder.on('BondingCurve:TokensSold', async ({ event, context }) => {
  const id = `${event.transaction.hash}:${event.log.logIndex}`;
  const curveAddr = getAddress(event.log.address);
  await context.db.insert(bondingCurveTrade).values({
    id,
    bondingCurve: curveAddr,
    trader: getAddress(event.args.seller),
    isBuy: false,
    ethAmount: event.args.ethReturned.toString(),
    tokenAmount: event.args.tokenAmount.toString(),
    price: event.args.newPrice.toString(),
    timestamp: Number(event.block.timestamp),
  });
  // ETH raised shrinks on sells; tokens sold decreases too.
  await applyTradeToCurve(
    context,
    curveAddr,
    -event.args.tokenAmount,
    -event.args.ethReturned,
    event.args.newPrice,
    Number(event.block.timestamp),
    Number(event.block.number),
    'sell',
    `${id}:snap`
  );
});

// ── H1 refund pull-pattern tracking ─────────────────────────────────
ponder.on('BondingCurve:RefundPending', async ({ event, context }) => {
  const curveAddr = getAddress(event.log.address);
  const buyer = getAddress(event.args.buyer);
  const id = `${curveAddr.toLowerCase()}:${buyer.toLowerCase()}`;
  const eventId = `${event.transaction.hash}:${event.log.logIndex}`;

  const existing = await context.db.find(bondingCurveRefund, { id });
  if (existing && existing.claimedAt === null) {
    // Outstanding refund grew (multiple failed sends to the same buyer)
    await context.db.update(bondingCurveRefund, { id }).set({
      amount: (BigInt(existing.amount) + event.args.amount).toString(),
      lastEventId: eventId,
    });
  } else {
    await context.db.insert(bondingCurveRefund).values({
      id,
      bondingCurve: curveAddr,
      buyer,
      amount: event.args.amount.toString(),
      pendingSince: Number(event.block.timestamp),
      claimedAt: null,
      lastEventId: eventId,
    });
  }

  // Update aggregate on the curve row
  const curve = await context.db.find(bondingCurve, { id: curveAddr });
  if (curve) {
    await context.db.update(bondingCurve, { id: curveAddr }).set({
      pendingRefundsTotal: (BigInt(curve.pendingRefundsTotal) + event.args.amount).toString(),
    });
  }
});

ponder.on('BondingCurve:RefundClaimed', async ({ event, context }) => {
  const curveAddr = getAddress(event.log.address);
  const buyer = getAddress(event.args.buyer);
  const id = `${curveAddr.toLowerCase()}:${buyer.toLowerCase()}`;
  const eventId = `${event.transaction.hash}:${event.log.logIndex}`;

  const existing = await context.db.find(bondingCurveRefund, { id });
  if (existing) {
    await context.db.update(bondingCurveRefund, { id }).set({
      amount: '0',
      claimedAt: Number(event.block.timestamp),
      lastEventId: eventId,
    });
  }

  const curve = await context.db.find(bondingCurve, { id: curveAddr });
  if (curve) {
    const prev = BigInt(curve.pendingRefundsTotal);
    const next = prev > event.args.amount ? prev - event.args.amount : 0n;
    await context.db.update(bondingCurve, { id: curveAddr }).set({
      pendingRefundsTotal: next.toString(),
    });
  }
});

// ── Trading halt/resume ─────────────────────────────────────────────
// TradingHalted/TradingResumed fire both from manager action AND from
// graduation. We dedupe the "source" via TradingHaltedByManager: that event
// is manager-originated, so we log the manager flavor when present.
ponder.on('BondingCurve:TradingHaltedByManager', async ({ event, context }) => {
  const curveAddr = getAddress(event.log.address);
  const timestamp = Number(event.block.timestamp);

  await context.db.insert(bondingCurveHaltEvent).values({
    id: `${event.transaction.hash}:${event.log.logIndex}`,
    bondingCurve: curveAddr,
    universeId: Number(event.args.universeId),
    halted: event.args.halted,
    source: 'manager',
    timestamp,
    blockNumber: Number(event.block.number),
  });

  const curve = await context.db.find(bondingCurve, { id: curveAddr });
  if (curve && curve.tradingStatus !== 'graduated') {
    await context.db.update(bondingCurve, { id: curveAddr }).set({
      tradingStatus: event.args.halted ? 'halted' : 'active',
      tradingStatusUpdatedAt: timestamp,
    });
  }
});

ponder.on('BondingCurve:Graduated', async ({ event, context }) => {
  // Emitted from inside _graduate() — authoritative graduation signal from
  // the curve itself (complements UniverseManager:TokenGraduated).
  const curveAddr = getAddress(event.log.address);
  const timestamp = Number(event.block.timestamp);
  await context.db.update(bondingCurve, { id: curveAddr }).set({
    graduated: true,
    graduatedAt: timestamp,
    tradingStatus: 'graduated',
    tradingStatusUpdatedAt: timestamp,
  });
  await context.db.insert(bondingCurveHaltEvent).values({
    id: `${event.transaction.hash}:${event.log.logIndex}:grad`,
    bondingCurve: curveAddr,
    universeId: Number(event.args.universeId),
    halted: true,
    source: 'graduation',
    timestamp,
    blockNumber: Number(event.block.number),
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

// Universe.sol emits `CanonChanged(newCanonId, previousCanonId, canonizer)` —
// the legacy `NodeCanonized` event is deprecated and never emitted in current
// contracts. The new `EpisodeCanonized(episodeHash, tipNodeId, canonizer)`
// event is also emitted but isn't yet in the generated ABI; handler will be
// added after `forge build && wagmi generate`.
ponder.on('Universe:CanonChanged', async ({ event, context }) => {
  const universeAddress = getAddress(event.log.address).toLowerCase() as `0x${string}`;
  const nodeId = Number(event.args.newCanonId);

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

// Governor + Timelock: ProposalQueued lands between propose and execute. The
// UI needs the eta to show "executable in X hours" on queued proposals.
ponder.on('UniverseGovernor:ProposalQueued', async ({ event, context }) => {
  const proposalId = event.args.proposalId.toString();
  const eta = Number(event.args.etaSeconds);
  await context.db.update(proposal, { id: proposalId }).set({ queued: true, queuedEta: eta });
});

// Quadratic / parameterized voting variant — same projection as VoteCast.
ponder.on('UniverseGovernor:VoteCastWithParams', async ({ event, context }) => {
  const governorAddress = getAddress(event.log.address);
  const proposalId = event.args.proposalId.toString();
  const voter = getAddress(event.args.voter);

  await context.db
    .insert(vote)
    .values({
      id: `${proposalId}:${voter}`,
      proposalId: proposalId,
      governorAddress: governorAddress,
      voter: voter,
      support: event.args.support,
      weight: event.args.weight.toString(),
      reason: event.args.reason || null,
      timestamp: Number(event.block.timestamp),
    })
    .onConflictDoUpdate(() => ({
      // Re-vote semantics: latest vote with params overwrites prior vote.
      support: event.args.support,
      weight: event.args.weight.toString(),
      reason: event.args.reason || null,
    }));
});

// ============= Token Transfer Tracking =============

ponder.on('GovernanceToken:Transfer', async ({ event, context }) => {
  const tokenAddress = getAddress(event.log.address);
  const from = getAddress(event.args.from);
  const to = getAddress(event.args.to);
  const amount = event.args.amount;

  // Record transfer first — `event.id` is `${txHash}:${logIndex}` which
  // makes the row idempotent against re-org re-ingest. If the row already
  // exists we MUST skip the holder mutations below — otherwise the same
  // event double-credits `to` and double-debits `from` on every reprocess.
  let isReplay = false;
  try {
    await context.db.insert(tokenTransfer).values({
      id: event.id,
      tokenAddress,
      from,
      to,
      value: amount.toString(),
      timestamp: Number(event.block.timestamp),
      blockNumber: Number(event.block.number),
    });
  } catch (err) {
    // Drizzle/Ponder throws on duplicate primary key. Treat as already
    // processed — do not re-apply balance deltas.
    isReplay = true;
  }

  if (isReplay) return;

  // Update holder balances (skip mint/burn from/to zero address for balance tracking)
  if (from !== '0x0000000000000000000000000000000000000000') {
    const fromHolder = await context.db.find(tokenHolder, { id: `${tokenAddress}:${from}` });
    if (fromHolder) {
      const newBalance = BigInt(fromHolder.balance) - amount;
      await context.db
        .update(tokenHolder, { id: `${tokenAddress}:${from}` })
        .set({ balance: newBalance > 0n ? newBalance.toString() : '0' });
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
  const existing = await context.db.find(swap, { id: event.id });
  if (existing) return;
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

// ============= Revenue Contract Events =============

// ── CanonMarketplace ──────────────────────────────────────────────────

// Status codes mirror the SubmissionStatus enum in CanonMarketplace.sol:
// 0=PENDING, 1=VOTING, 2=ACCEPTED, 3=REJECTED, 4=EXPIRED.
ponder.on('CanonMarketplace:SubmissionCreated', async ({ event, context }) => {
  const submissionId = event.args.id;

  // SubmissionCreated doesn't carry universeToken/metadataURI/submissionFee/votingDeadline;
  // read them from the submissions() struct getter.
  const sub = (await context.client.readContract({
    abi: context.contracts.CanonMarketplace.abi,
    address: context.contracts.CanonMarketplace.address as `0x${string}`,
    functionName: 'submissions',
    args: [submissionId],
  })) as readonly [
    bigint,
    bigint,
    `0x${string}`,
    number,
    number,
    `0x${string}`,
    `0x${string}`,
    string,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
  ];

  await context.db.insert(canonSubmission).values({
    id: submissionId.toString(),
    universeId: Number(event.args.universeId),
    universeToken: getAddress(sub[2]),
    submissionType: Number(event.args.subType),
    status: 1, // VOTING
    creator: getAddress(event.args.creator),
    contentHash: event.args.contentHash,
    metadataURI: sub[7],
    submissionFee: sub[8].toString(),
    votesFor: '0',
    votesAgainst: '0',
    votingDeadline: Number(sub[11]),
    createdAt: Number(event.block.timestamp),
  });
});

ponder.on('CanonMarketplace:VoteCast', async ({ event, context }) => {
  const submissionIdStr = event.args.submissionId.toString();
  await context.db.insert(canonVote).values({
    id: `${submissionIdStr}:${getAddress(event.args.voter)}`,
    submissionId: Number(event.args.submissionId),
    voter: getAddress(event.args.voter),
    support: event.args.support,
    weight: event.args.weight.toString(),
    timestamp: Number(event.block.timestamp),
  });

  // Keep the aggregate tallies on canonSubmission in sync with per-vote rows.
  const existing = await context.db.find(canonSubmission, { id: submissionIdStr });
  if (existing) {
    const weight = event.args.weight;
    if (event.args.support) {
      await context.db
        .update(canonSubmission, { id: submissionIdStr })
        .set({ votesFor: (BigInt(existing.votesFor) + weight).toString() });
    } else {
      await context.db
        .update(canonSubmission, { id: submissionIdStr })
        .set({ votesAgainst: (BigInt(existing.votesAgainst) + weight).toString() });
    }
  }
});

ponder.on('CanonMarketplace:SubmissionAccepted', async ({ event, context }) => {
  await context.db
    .update(canonSubmission, { id: event.args.submissionId.toString() })
    .set({ status: 2, finalizedAt: Number(event.block.timestamp) });
});

// Emitted for both merit-rejection and quorum-expiry paths; indexer can't distinguish
// without a dedicated event. Both land as status=3 (REJECTED) here.
ponder.on('CanonMarketplace:SubmissionRejected', async ({ event, context }) => {
  await context.db
    .update(canonSubmission, { id: event.args.submissionId.toString() })
    .set({ status: 3, finalizedAt: Number(event.block.timestamp) });
});

// ── AdPlacement ───────────────────────────────────────────────────────
// AdSlotCreated doesn't carry episodesRemaining, and SponsorshipActivated
// doesn't carry totalPaid — read them from the adSlots()/sponsorships()
// struct getters so the schema's notNull contract holds.

ponder.on('AdPlacement:AdSlotCreated', async ({ event, context }) => {
  const slotId = event.args.slotId;

  const slot = (await context.client.readContract({
    abi: context.contracts.AdPlacement.abi,
    address: context.contracts.AdPlacement.address as `0x${string}`,
    functionName: 'adSlots',
    args: [slotId],
  })) as readonly [bigint, bigint, number, bigint, bigint, `0x${string}`, string, bigint, boolean];

  await context.db.insert(adSlot).values({
    id: slotId.toString(),
    universeId: Number(event.args.universeId),
    placementType: Number(event.args.placementType),
    minBid: event.args.minBid.toString(),
    episodesRemaining: Number(slot[7]),
    active: true,
    createdAt: Number(event.block.timestamp),
  });
});

ponder.on('AdPlacement:SponsorshipActivated', async ({ event, context }) => {
  const sponsorshipId = event.args.sponsorshipId;

  const spon = (await context.client.readContract({
    abi: context.contracts.AdPlacement.abi,
    address: context.contracts.AdPlacement.address as `0x${string}`,
    functionName: 'sponsorships',
    args: [sponsorshipId],
  })) as readonly [bigint, bigint, `0x${string}`, bigint, bigint, bigint, boolean];

  await context.db.insert(sponsorship).values({
    id: sponsorshipId.toString(),
    adSlotId: Number(event.args.slotId),
    sponsor: getAddress(event.args.sponsor),
    totalPaid: spon[3].toString(),
    impressions: 0,
    active: true,
    startedAt: Number(event.block.timestamp),
  });
});

// ── LicensingRegistry ─────────────────────────────────────────────────
// License status (integer): 0=PROPOSED, 1=ACTIVE, 2=EXPIRED, 3=REVOKED.
// licensor + royaltyBps aren't in LicenseCreated — read from licenses() struct.

ponder.on('LicensingRegistry:LicenseCreated', async ({ event, context }) => {
  const licenseId = event.args.licenseId;

  const lic = (await context.client.readContract({
    abi: context.contracts.LicensingRegistry.abi,
    address: context.contracts.LicensingRegistry.address as `0x${string}`,
    functionName: 'licenses',
    args: [licenseId],
  })) as readonly [
    bigint,
    bigint,
    number,
    number,
    `0x${string}`,
    `0x${string}`,
    bigint,
    number,
    bigint,
    bigint,
    bigint,
    string,
  ];

  await context.db.insert(license).values({
    id: licenseId.toString(),
    universeId: Number(event.args.universeId),
    licenseType: Number(event.args.licenseType),
    status: 0, // PROPOSED
    licensor: getAddress(lic[4]),
    licensee: getAddress(event.args.licensee),
    upfrontFee: event.args.upfrontFee.toString(),
    royaltyBps: Number(lic[7]),
    createdAt: Number(event.block.timestamp),
  });
});

ponder.on('LicensingRegistry:LicenseActivated', async ({ event, context }) => {
  await context.db
    .update(license, { id: event.args.licenseId.toString() })
    .set({ status: 1, startTime: Number(event.block.timestamp) });
});

ponder.on('LicensingRegistry:LicenseRevoked', async ({ event, context }) => {
  await context.db
    .update(license, { id: event.args.licenseId.toString() })
    .set({ status: 3, endTime: Number(event.block.timestamp) });
});

// ── CollabManager ─────────────────────────────────────────────────────
// Collab status (integer): 0=PROPOSED, 1=ACCEPTED, 2=ACTIVE, 3=COMPLETED, 4=CANCELLED.
// revenueShareBps isn't in CollabProposed — read from collabs() struct.

ponder.on('CollabManager:CollabProposed', async ({ event, context }) => {
  const collabId = event.args.collabId;

  const c = (await context.client.readContract({
    abi: context.contracts.CollabManager.abi,
    address: context.contracts.CollabManager.address as `0x${string}`,
    functionName: 'collabs',
    args: [collabId],
  })) as readonly [
    bigint,
    bigint,
    bigint,
    `0x${string}`,
    `0x${string}`,
    number,
    bigint,
    bigint,
    bigint,
    bigint,
    string,
    bigint,
  ];

  await context.db.insert(collab).values({
    id: collabId.toString(),
    universeA: Number(event.args.universeA),
    universeB: Number(event.args.universeB),
    proposer: getAddress(event.args.proposer),
    status: 0, // PROPOSED
    revenueShareBps: Number(c[6]),
    totalRevenue: '0',
    createdAt: Number(event.block.timestamp),
  });
});

ponder.on('CollabManager:CollabAccepted', async ({ event, context }) => {
  await context.db
    .update(collab, { id: event.args.collabId.toString() })
    .set({ status: 1, acceptor: getAddress(event.args.acceptor) });
});

ponder.on('CollabManager:CollabCompleted', async ({ event, context }) => {
  await context.db.update(collab, { id: event.args.collabId.toString() }).set({
    status: 3,
    totalRevenue: event.args.totalRevenue.toString(),
    endTime: Number(event.block.timestamp),
  });
});

ponder.on('CollabManager:CollabCancelled', async ({ event, context }) => {
  await context.db.update(collab, { id: event.args.collabId.toString() }).set({ status: 4 });
});

// ============= CreditManager Events =============
// All four credit-flow events project into the same `credit_event` table with
// a discriminator `kind`, so callers can sum spend by user without joining
// across separate tables.

ponder.on('CreditManager:CreditsGranted', async ({ event, context }) => {
  await context.db.insert(creditEvent).values({
    id: event.id,
    kind: 'granted',
    user: getAddress(event.args.user).toLowerCase() as `0x${string}`,
    amount: event.args.amount.toString(),
    reason: event.args.reason,
    timestamp: Number(event.block.timestamp),
    blockNumber: Number(event.block.number),
  });
});

ponder.on('CreditManager:CreditsPurchasedWithEth', async ({ event, context }) => {
  await context.db.insert(creditEvent).values({
    id: event.id,
    kind: 'purchased',
    user: getAddress(event.args.user).toLowerCase() as `0x${string}`,
    amount: event.args.credits.toString(),
    packageId: event.args.packageId.toString(),
    bonusCredits: event.args.bonus.toString(),
    paidWei: event.args.paid.toString(),
    timestamp: Number(event.block.timestamp),
    blockNumber: Number(event.block.number),
  });
});

ponder.on('CreditManager:CreditsPurchasedWithLoar', async ({ event, context }) => {
  await context.db.insert(creditEvent).values({
    id: event.id,
    kind: 'loar_purchased',
    user: getAddress(event.args.user).toLowerCase() as `0x${string}`,
    amount: event.args.credits.toString(),
    packageId: event.args.packageId.toString(),
    bonusCredits: event.args.bonus.toString(),
    paidLoar: event.args.loarPaid.toString(),
    timestamp: Number(event.block.timestamp),
    blockNumber: Number(event.block.number),
  });
});

ponder.on('CreditManager:CreditsSpent', async ({ event, context }) => {
  await context.db.insert(creditEvent).values({
    id: event.id,
    kind: 'spent',
    user: getAddress(event.args.user).toLowerCase() as `0x${string}`,
    amount: event.args.amount.toString(),
    generationType: event.args.generationType,
    universeId: event.args.universeId.toString(),
    timestamp: Number(event.block.timestamp),
    blockNumber: Number(event.block.number),
  });
});

// ============= PaymentRouter Events =============

ponder.on('PaymentRouter:PaymentRouted', async ({ event, context }) => {
  await context.db.insert(paymentEvent).values({
    id: event.id,
    kind: 'routed',
    creator: getAddress(event.args.creator).toLowerCase() as `0x${string}`,
    creatorAmount: event.args.creatorAmount.toString(),
    platformAmount: event.args.platformAmount.toString(),
    feeBps: Number(event.args.feeBps),
    timestamp: Number(event.block.timestamp),
    blockNumber: Number(event.block.number),
  });
});

ponder.on('PaymentRouter:LoarPaymentRouted', async ({ event, context }) => {
  await context.db.insert(paymentEvent).values({
    id: event.id,
    kind: 'loar_routed',
    creator: getAddress(event.args.creator).toLowerCase() as `0x${string}`,
    creatorAmount: event.args.creatorAmount.toString(),
    platformAmount: event.args.platformAmount.toString(),
    feeBps: Number(event.args.feeBps),
    timestamp: Number(event.block.timestamp),
    blockNumber: Number(event.block.number),
  });
});

ponder.on('PaymentRouter:Claimed', async ({ event, context }) => {
  await context.db.insert(paymentEvent).values({
    id: event.id,
    kind: 'claimed',
    creator: getAddress(event.args.creator).toLowerCase() as `0x${string}`,
    creatorAmount: event.args.amount.toString(),
    timestamp: Number(event.block.timestamp),
    blockNumber: Number(event.block.number),
  });
});

ponder.on('PaymentRouter:LoarClaimed', async ({ event, context }) => {
  await context.db.insert(paymentEvent).values({
    id: event.id,
    kind: 'loar_claimed',
    creator: getAddress(event.args.creator).toLowerCase() as `0x${string}`,
    creatorAmount: event.args.amount.toString(),
    timestamp: Number(event.block.timestamp),
    blockNumber: Number(event.block.number),
  });
});

// ============= SubscriptionManager Events =============

ponder.on('SubscriptionManager:Subscribed', async ({ event, context }) => {
  await context.db.insert(subscriptionEvent).values({
    id: event.id,
    kind: 'subscribed',
    user: getAddress(event.args.user).toLowerCase() as `0x${string}`,
    universeId: event.args.universeId.toString(),
    tier: Number(event.args.tier),
    expiresAt: Number(event.args.expiresAt),
    timestamp: Number(event.block.timestamp),
    blockNumber: Number(event.block.number),
  });
});

ponder.on('SubscriptionManager:SubscriptionCancelled', async ({ event, context }) => {
  await context.db.insert(subscriptionEvent).values({
    id: event.id,
    kind: 'cancelled',
    user: getAddress(event.args.user).toLowerCase() as `0x${string}`,
    universeId: event.args.universeId.toString(),
    timestamp: Number(event.block.timestamp),
    blockNumber: Number(event.block.number),
  });
});

ponder.on('SubscriptionManager:SubscriptionRenewed', async ({ event, context }) => {
  await context.db.insert(subscriptionEvent).values({
    id: event.id,
    kind: 'renewed',
    user: getAddress(event.args.user).toLowerCase() as `0x${string}`,
    universeId: event.args.universeId.toString(),
    expiresAt: Number(event.args.newExpiry),
    timestamp: Number(event.block.timestamp),
    blockNumber: Number(event.block.number),
  });
});
