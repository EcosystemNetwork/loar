/**
 * Ponder On-Chain Schema
 *
 * Defines the indexed database tables and their relationships for all
 * LOAR protocol entities: universes, tokens, nodes, proposals, votes,
 * swaps, token holders, and hook events. Maps directly to on-chain events.
 */
import { index, onchainTable, relations } from 'ponder';

// ============= UniverseManager Events =============

export const universe = onchainTable(
  'universe',
  (t) => ({
    id: t.text().primaryKey(), // universe address
    universeId: t.integer(), // universe ID from UniverseManager (if trackable)
    creator: t.hex().notNull(),
    createdAt: t.integer().notNull(),
    name: t.text().notNull(), // universe name from contract
    description: t.text().notNull(), // universe description from contract
    imageURL: t.text().notNull(), // universe image URL from contract
    tokenAddress: t.hex(), // set when token is created
    governorAddress: t.hex(), // set when token is created
    nodeCount: t.integer().notNull().default(0), // track number of nodes
  }),
  (table) => ({
    creatorIdx: index('universe_creator_idx').on(table.creator),
  })
);

export const token = onchainTable(
  'token',
  (t) => ({
    id: t.text().primaryKey(), // token address
    universeAddress: t.hex().notNull(),
    deployer: t.hex().notNull(),
    tokenAdmin: t.hex().notNull(),
    name: t.text().notNull(),
    symbol: t.text().notNull(),
    imageURL: t.text().notNull(),
    metadata: t.text().notNull(),
    context: t.text().notNull(),
    startingTick: t.text().notNull(), // int24 as string
    poolHook: t.hex().notNull(),
    poolId: t.hex().notNull(),
    pairedToken: t.hex().notNull(),
    locker: t.hex().notNull(),
    createdAt: t.integer().notNull(),
  }),
  (table) => ({
    deployerIdx: index('token_deployer_idx').on(table.deployer),
    universeIdx: index('token_universe_idx').on(table.universeAddress),
  })
);

// ============= Bonding Curve =============

export const bondingCurve = onchainTable(
  'bonding_curve',
  (t) => ({
    id: t.text().primaryKey(), // bonding curve contract address
    tokenAddress: t.hex().notNull(),
    universeId: t.integer().notNull(),
    graduationEth: t.text().notNull(), // target ETH as string
    curveSupply: t.text().notNull(), // total curve supply as string
    graduated: t.boolean().notNull().default(false),
    graduatedAt: t.integer(),
    createdAt: t.integer().notNull(),
    // Trading status: 'active' | 'halted' | 'graduated'
    tradingStatus: t.text().notNull().default('active'),
    tradingStatusUpdatedAt: t.integer(),
    // Aggregate counters — cheap to update per trade, avoids a scan on read
    tokensSold: t.text().notNull().default('0'),
    ethRaised: t.text().notNull().default('0'),
    lastPrice: t.text().notNull().default('0'),
    tradeCount: t.integer().notNull().default(0),
    pendingRefundsTotal: t.text().notNull().default('0'),
  }),
  (table) => ({
    tokenIdx: index('bonding_curve_token_idx').on(table.tokenAddress),
  })
);

export const bondingCurveTrade = onchainTable(
  'bonding_curve_trade',
  (t) => ({
    id: t.text().primaryKey(), // txHash:logIndex
    bondingCurve: t.hex().notNull(),
    trader: t.hex().notNull(),
    isBuy: t.boolean().notNull(),
    ethAmount: t.text().notNull(),
    tokenAmount: t.text().notNull(),
    price: t.text().notNull(),
    timestamp: t.integer().notNull(),
  }),
  (table) => ({
    curveIdx: index('bct_curve_idx').on(table.bondingCurve),
    traderIdx: index('bct_trader_idx').on(table.trader),
  })
);

/// One row per price-moving event (buy/sell). Enables historical price and
/// volume charts straight from the indexer without client-side polling.
export const bondingCurveSnapshot = onchainTable(
  'bonding_curve_snapshot',
  (t) => ({
    id: t.text().primaryKey(), // txHash:logIndex (matches bondingCurveTrade.id for buys/sells)
    bondingCurve: t.hex().notNull(),
    blockNumber: t.integer().notNull(),
    timestamp: t.integer().notNull(),
    tokensSold: t.text().notNull(),
    ethRaised: t.text().notNull(),
    price: t.text().notNull(),
    trigger: t.text().notNull(), // 'buy' | 'sell' | 'graduate'
  }),
  (table) => ({
    curveIdx: index('bcsnap_curve_idx').on(table.bondingCurve),
    blockIdx: index('bcsnap_block_idx').on(table.blockNumber),
  })
);

/// One row per pending refund (H1 pull-pattern). Marked resolved when the
/// matching RefundClaimed event fires.
export const bondingCurveRefund = onchainTable(
  'bonding_curve_refund',
  (t) => ({
    id: t.text().primaryKey(), // bondingCurve:buyer
    bondingCurve: t.hex().notNull(),
    buyer: t.hex().notNull(),
    amount: t.text().notNull(), // outstanding amount
    pendingSince: t.integer().notNull(),
    claimedAt: t.integer(), // null while outstanding
    lastEventId: t.text().notNull(), // txHash:logIndex of most recent event
  }),
  (table) => ({
    curveIdx: index('bcrefund_curve_idx').on(table.bondingCurve),
    buyerIdx: index('bcrefund_buyer_idx').on(table.buyer),
  })
);

/// Audit log of every halt/resume so UIs can show history and oncall can
/// reconstruct incidents even if `tradingStatus` has flipped back.
export const bondingCurveHaltEvent = onchainTable(
  'bonding_curve_halt_event',
  (t) => ({
    id: t.text().primaryKey(), // txHash:logIndex
    bondingCurve: t.hex().notNull(),
    universeId: t.integer().notNull(),
    halted: t.boolean().notNull(), // true=halt, false=resume
    source: t.text().notNull(), // 'manager' | 'graduation'
    timestamp: t.integer().notNull(),
    blockNumber: t.integer().notNull(),
  }),
  (table) => ({
    curveIdx: index('bchalt_curve_idx').on(table.bondingCurve),
  })
);

export const hookEvent = onchainTable('hook_event', (t) => ({
  id: t.text().primaryKey(),
  timestamp: t.integer().notNull(),
  hook_address: t.hex().notNull(),
  enabled: t.boolean().notNull(),
}));

// ============= Universe (dynamic) Events =============

export const node = onchainTable(
  'node',
  (t) => ({
    id: t.text().primaryKey(), // universe_address:node_id
    universeAddress: t.hex().notNull(),
    nodeId: t.integer().notNull(),
    previousNodeId: t.integer().notNull(),
    creator: t.hex().notNull(),
    createdAt: t.integer().notNull(),
    contentHash: t.hex(), // bytes32 SHA-256 of media file
    plotHash: t.hex(), // bytes32 SHA-256 of plot text
  }),
  (table) => ({
    universeIdx: index('node_universe_idx').on(table.universeAddress),
    creatorIdx: index('node_creator_idx').on(table.creator),
  })
);

export const nodeCanonization = onchainTable(
  'node_canonization',
  (t) => ({
    id: t.text().primaryKey(),
    universeAddress: t.hex().notNull(),
    nodeId: t.integer().notNull(),
    canonizer: t.hex().notNull(),
    timestamp: t.integer().notNull(),
  }),
  (table) => ({
    universeIdx: index('canon_universe_idx').on(table.universeAddress),
  })
);

export const nodeContent = onchainTable('node_content', (t) => ({
  id: t.text().primaryKey(), // universe:nodeId
  contentHash: t.hex(), // bytes32 content hash
  plotHash: t.hex(), // bytes32 plot hash
  videoLink: t.text().notNull(), // Full URL from event
  plot: t.text().notNull(), // Full plot text from event
}));

// ============= Revenue / Credits / Subscriptions =============

export const creditEvent = onchainTable(
  'credit_event',
  (t) => ({
    id: t.text().primaryKey(), // txHash:logIndex
    kind: t.text().notNull(), // 'granted' | 'purchased' | 'loar_purchased' | 'spent'
    user: t.hex().notNull(),
    amount: t.text().notNull(), // bigint as string
    packageId: t.text(), // numeric id as string when applicable
    bonusCredits: t.text(),
    paidWei: t.text(),
    paidLoar: t.text(),
    generationType: t.text(),
    universeId: t.text(),
    reason: t.text(),
    timestamp: t.integer().notNull(),
    blockNumber: t.integer().notNull(),
  }),
  (table) => ({
    userIdx: index('credit_user_idx').on(table.user),
    kindIdx: index('credit_kind_idx').on(table.kind),
  })
);

export const paymentEvent = onchainTable(
  'payment_event',
  (t) => ({
    id: t.text().primaryKey(),
    kind: t.text().notNull(), // 'routed' | 'loar_routed' | 'claimed' | 'loar_claimed'
    creator: t.hex().notNull(),
    creatorAmount: t.text(), // bigint as string
    platformAmount: t.text(),
    feeBps: t.integer(),
    timestamp: t.integer().notNull(),
    blockNumber: t.integer().notNull(),
  }),
  (table) => ({
    creatorIdx: index('payment_creator_idx').on(table.creator),
    kindIdx: index('payment_kind_idx').on(table.kind),
  })
);

export const subscriptionEvent = onchainTable(
  'subscription_event',
  (t) => ({
    id: t.text().primaryKey(),
    kind: t.text().notNull(), // 'subscribed' | 'cancelled' | 'renewed'
    user: t.hex().notNull(),
    universeId: t.text().notNull(),
    tier: t.integer(), // SubscriptionTier enum
    expiresAt: t.integer(),
    timestamp: t.integer().notNull(),
    blockNumber: t.integer().notNull(),
  }),
  (table) => ({
    userIdx: index('subscription_user_idx').on(table.user),
    universeIdx: index('subscription_universe_idx').on(table.universeId),
  })
);

// ============= Token Transfer Tracking =============

export const tokenTransfer = onchainTable(
  'token_transfer',
  (t) => ({
    id: t.text().primaryKey(),
    tokenAddress: t.hex().notNull(),
    from: t.hex().notNull(),
    to: t.hex().notNull(),
    value: t.text().notNull(), // bigint as string
    timestamp: t.integer().notNull(),
    blockNumber: t.integer().notNull(),
  }),
  (table) => ({
    tokenIdx: index('transfer_token_idx').on(table.tokenAddress),
    fromIdx: index('transfer_from_idx').on(table.from),
    toIdx: index('transfer_to_idx').on(table.to),
  })
);

export const tokenHolder = onchainTable(
  'token_holder',
  (t) => ({
    id: t.text().primaryKey(), // tokenAddress:holderAddress
    tokenAddress: t.hex().notNull(),
    holderAddress: t.hex().notNull(),
    balance: t.text().notNull(), // bigint as string
  }),
  (table) => ({
    tokenIdx: index('holder_token_idx').on(table.tokenAddress),
    holderIdx: index('holder_address_idx').on(table.holderAddress),
  })
);

// ============= Uniswap v4 Pool Tracking =============

export const pool = onchainTable(
  'pool',
  (t) => ({
    poolId: t.hex().primaryKey(),
    currency0: t.hex().notNull(),
    currency1: t.hex().notNull(),
    fee: t.integer().notNull(),
    tickSpacing: t.integer().notNull(),
    hooks: t.hex().notNull(),
    sqrtPriceX96: t.text(), // bigint as string
    tick: t.integer(),
    creationBlock: t.integer().notNull(),
  }),
  (table) => ({
    currency0Idx: index('pool_currency0_idx').on(table.currency0),
    currency1Idx: index('pool_currency1_idx').on(table.currency1),
    hooksIdx: index('pool_hooks_idx').on(table.hooks),
  })
);

export const swap = onchainTable(
  'swap',
  (t) => ({
    id: t.text().primaryKey(),
    poolId: t.hex().notNull(),
    sender: t.hex().notNull(),
    amount0: t.text().notNull(), // bigint as string
    amount1: t.text().notNull(), // bigint as string
    sqrtPriceX96: t.text().notNull(), // bigint as string
    liquidity: t.text().notNull(), // bigint as string
    tick: t.integer().notNull(),
    timestamp: t.integer().notNull(),
    blockNumber: t.integer().notNull(),
  }),
  (table) => ({
    poolIdIdx: index('swap_pool_idx').on(table.poolId),
    senderIdx: index('swap_sender_idx').on(table.sender),
    blockIdx: index('swap_block_idx').on(table.blockNumber),
  })
);

// ============= UniverseGovernor Events =============

export const proposal = onchainTable(
  'proposal',
  (t) => ({
    id: t.text().primaryKey(), // proposalId
    governorAddress: t.hex().notNull(),
    universeAddress: t.hex(), // resolved from governor
    proposer: t.hex().notNull(),
    targets: t.text().notNull(), // JSON array
    values: t.text().notNull(), // JSON array
    calldatas: t.text().notNull(), // JSON array
    description: t.text().notNull(),
    startBlock: t.integer().notNull(),
    endBlock: t.integer().notNull(),
    createdAt: t.integer().notNull(),
    executed: t.boolean().notNull().default(false),
    cancelled: t.boolean().notNull().default(false),
  }),
  (table) => ({
    governorIdx: index('proposal_governor_idx').on(table.governorAddress),
    proposerIdx: index('proposal_proposer_idx').on(table.proposer),
    universeIdx: index('proposal_universe_idx').on(table.universeAddress),
  })
);

export const proposalExecution = onchainTable(
  'proposal_execution',
  (t) => ({
    id: t.text().primaryKey(),
    proposalId: t.text().notNull(),
    governorAddress: t.hex().notNull(),
    timestamp: t.integer().notNull(),
  }),
  (table) => ({
    proposalIdx: index('execution_proposal_idx').on(table.proposalId),
  })
);

export const proposalCancellation = onchainTable(
  'proposal_cancellation',
  (t) => ({
    id: t.text().primaryKey(),
    proposalId: t.text().notNull(),
    governorAddress: t.hex().notNull(),
    timestamp: t.integer().notNull(),
  }),
  (table) => ({
    proposalIdx: index('cancellation_proposal_idx').on(table.proposalId),
  })
);

export const vote = onchainTable(
  'vote',
  (t) => ({
    id: t.text().primaryKey(), // proposalId:voter
    proposalId: t.text().notNull(),
    governorAddress: t.hex().notNull(),
    voter: t.hex().notNull(),
    support: t.integer().notNull(), // 0 = against, 1 = for, 2 = abstain
    weight: t.text().notNull(), // vote weight as string (bigint)
    reason: t.text(),
    timestamp: t.integer().notNull(),
  }),
  (table) => ({
    proposalIdx: index('vote_proposal_idx').on(table.proposalId),
    voterIdx: index('vote_voter_idx').on(table.voter),
  })
);

// ============= Revenue Stream Events =============

// Episode NFTs
export const episodeMint = onchainTable(
  'episode_mint',
  (t) => ({
    id: t.text().primaryKey(), // tx hash or event id
    episodeId: t.integer().notNull(),
    tokenId: t.integer().notNull(),
    universeId: t.integer().notNull(),
    nodeId: t.integer().notNull(),
    creator: t.hex().notNull(),
    buyer: t.hex().notNull(),
    price: t.text().notNull(), // bigint as string
    contentHash: t.hex().notNull(),
    timestamp: t.integer().notNull(),
    blockNumber: t.integer().notNull(),
  }),
  (table) => ({
    episodeIdx: index('emint_episode_idx').on(table.episodeId),
    universeIdx: index('emint_universe_idx').on(table.universeId),
    buyerIdx: index('emint_buyer_idx').on(table.buyer),
    creatorIdx: index('emint_creator_idx').on(table.creator),
  })
);

export const episodeListing = onchainTable(
  'episode_listing',
  (t) => ({
    id: t.text().primaryKey(), // episodeId
    universeId: t.integer().notNull(),
    nodeId: t.integer().notNull(),
    contentHash: t.hex().notNull(),
    creator: t.hex().notNull(),
    mintPrice: t.text().notNull(),
    maxSupply: t.integer().notNull(),
    minted: t.integer().notNull().default(0),
    active: t.boolean().notNull().default(true),
    createdAt: t.integer().notNull(),
  }),
  (table) => ({
    universeIdx: index('elisting_universe_idx').on(table.universeId),
    creatorIdx: index('elisting_creator_idx').on(table.creator),
  })
);

// Character NFTs
export const characterNft = onchainTable(
  'character_nft',
  (t) => ({
    id: t.text().primaryKey(), // characterId
    universeId: t.integer().notNull(),
    name: t.text().notNull(),
    visualHash: t.hex().notNull(),
    creator: t.hex().notNull(),
    owner: t.hex().notNull(),
    appearanceCount: t.integer().notNull().default(0),
    accumulatedRoyalties: t.text().notNull().default('0'),
    createdAt: t.integer().notNull(),
  }),
  (table) => ({
    universeIdx: index('cnft_universe_idx').on(table.universeId),
    ownerIdx: index('cnft_owner_idx').on(table.owner),
  })
);

export const characterAppearance = onchainTable(
  'character_appearance',
  (t) => ({
    id: t.text().primaryKey(),
    characterId: t.integer().notNull(),
    episodeId: t.integer().notNull(),
    reward: t.text().notNull(),
    timestamp: t.integer().notNull(),
  }),
  (table) => ({
    characterIdx: index('capp_character_idx').on(table.characterId),
    episodeIdx: index('capp_episode_idx').on(table.episodeId),
  })
);

// Canon Marketplace
export const canonSubmission = onchainTable(
  'canon_submission',
  (t) => ({
    id: t.text().primaryKey(), // submissionId
    universeId: t.integer().notNull(),
    universeToken: t.hex().notNull(),
    submissionType: t.integer().notNull(), // 0=CHARACTER, 1=PLOT_ARC, 2=LOCATION, 3=LORE_RULE
    status: t.integer().notNull(), // 0=PENDING, 1=VOTING, 2=ACCEPTED, 3=REJECTED, 4=EXPIRED
    creator: t.hex().notNull(),
    contentHash: t.hex().notNull(),
    metadataURI: t.text().notNull(),
    submissionFee: t.text().notNull(),
    votesFor: t.text().notNull().default('0'),
    votesAgainst: t.text().notNull().default('0'),
    votingDeadline: t.integer().notNull(),
    createdAt: t.integer().notNull(),
    finalizedAt: t.integer(),
  }),
  (table) => ({
    universeIdx: index('csub_universe_idx').on(table.universeId),
    creatorIdx: index('csub_creator_idx').on(table.creator),
    statusIdx: index('csub_status_idx').on(table.status),
  })
);

export const canonVote = onchainTable(
  'canon_vote',
  (t) => ({
    id: t.text().primaryKey(), // submissionId:voter
    submissionId: t.integer().notNull(),
    voter: t.hex().notNull(),
    support: t.boolean().notNull(),
    weight: t.text().notNull(),
    timestamp: t.integer().notNull(),
  }),
  (table) => ({
    submissionIdx: index('cvote_submission_idx').on(table.submissionId),
    voterIdx: index('cvote_voter_idx').on(table.voter),
  })
);

// Credit Purchases
export const creditPurchase = onchainTable(
  'credit_purchase',
  (t) => ({
    id: t.text().primaryKey(),
    buyer: t.hex().notNull(),
    tierId: t.integer().notNull(),
    credits: t.integer().notNull(),
    paid: t.text().notNull(),
    timestamp: t.integer().notNull(),
    blockNumber: t.integer().notNull(),
  }),
  (table) => ({
    buyerIdx: index('cpurchase_buyer_idx').on(table.buyer),
  })
);

export const creditSpend = onchainTable(
  'credit_spend',
  (t) => ({
    id: t.text().primaryKey(),
    user: t.hex().notNull(),
    amount: t.integer().notNull(),
    generationType: t.text().notNull(),
    universeId: t.integer().notNull(),
    timestamp: t.integer().notNull(),
  }),
  (table) => ({
    userIdx: index('cspend_user_idx').on(table.user),
    universeIdx: index('cspend_universe_idx').on(table.universeId),
  })
);

// Subscriptions
export const subscription = onchainTable(
  'subscription',
  (t) => ({
    id: t.text().primaryKey(), // user:universeId
    user: t.hex().notNull(),
    universeId: t.integer().notNull(),
    tier: t.integer().notNull(), // 0=FREE, 1=BASIC, 2=PREMIUM, 3=VIP
    startedAt: t.integer().notNull(),
    expiresAt: t.integer().notNull(),
    totalPaid: t.text().notNull().default('0'),
    timestamp: t.integer().notNull(),
  }),
  (table) => ({
    userIdx: index('sub_user_idx').on(table.user),
    universeIdx: index('sub_universe_idx').on(table.universeId),
  })
);

// Collaborations
export const collab = onchainTable(
  'collab',
  (t) => ({
    id: t.text().primaryKey(), // collabId
    universeA: t.integer().notNull(),
    universeB: t.integer().notNull(),
    proposer: t.hex().notNull(),
    acceptor: t.hex(),
    status: t.integer().notNull(), // 0=PROPOSED, 1=ACCEPTED, 2=ACTIVE, 3=COMPLETED, 4=CANCELLED
    revenueShareBps: t.integer().notNull(),
    totalRevenue: t.text().notNull().default('0'),
    episodeCount: t.integer().notNull().default(0),
    startTime: t.integer(),
    endTime: t.integer(),
    createdAt: t.integer().notNull(),
  }),
  (table) => ({
    universeAIdx: index('collab_ua_idx').on(table.universeA),
    universeBIdx: index('collab_ub_idx').on(table.universeB),
    proposerIdx: index('collab_proposer_idx').on(table.proposer),
  })
);

// Licensing
export const license = onchainTable(
  'license',
  (t) => ({
    id: t.text().primaryKey(), // licenseId
    universeId: t.integer().notNull(),
    licenseType: t.integer().notNull(), // 0=STREAMING, 1=MERCH, 2=GAMING, 3=COMIC, 4=AUDIO, 5=OTHER
    status: t.integer().notNull(), // 0=PROPOSED, 1=ACTIVE, 2=EXPIRED, 3=REVOKED
    licensor: t.hex().notNull(),
    licensee: t.hex().notNull(),
    upfrontFee: t.text().notNull(),
    royaltyBps: t.integer().notNull(),
    totalRoyalties: t.text().notNull().default('0'),
    startTime: t.integer(),
    endTime: t.integer(),
    createdAt: t.integer().notNull(),
  }),
  (table) => ({
    universeIdx: index('lic_universe_idx').on(table.universeId),
    licensorIdx: index('lic_licensor_idx').on(table.licensor),
    licenseeIdx: index('lic_licensee_idx').on(table.licensee),
  })
);

// Merch Sales
export const merchSale = onchainTable(
  'merch_sale',
  (t) => ({
    id: t.text().primaryKey(),
    merchId: t.integer().notNull(),
    universeId: t.integer().notNull(),
    buyer: t.hex().notNull(),
    price: t.text().notNull(),
    timestamp: t.integer().notNull(),
  }),
  (table) => ({
    universeIdx: index('merch_universe_idx').on(table.universeId),
    buyerIdx: index('merch_buyer_idx').on(table.buyer),
  })
);

// Analytics (on-chain metrics)
export const universeAnalytics = onchainTable(
  'universe_analytics',
  (t) => ({
    id: t.text().primaryKey(), // universeId
    totalViews: t.integer().notNull().default(0),
    totalMints: t.integer().notNull().default(0),
    totalVotes: t.integer().notNull().default(0),
    totalSubscribers: t.integer().notNull().default(0),
    totalRevenue: t.text().notNull().default('0'),
    lastUpdated: t.integer().notNull(),
  }),
  (table) => ({
    revenueIdx: index('ua_revenue_idx').on(table.totalRevenue),
  })
);

// ============= Relations =============

export const universeRelations = relations(universe, ({ one, many }) => ({
  token: one(token, {
    fields: [universe.tokenAddress],
    references: [token.id],
  }),
  nodes: many(node),
  proposals: many(proposal),
}));

export const tokenRelations = relations(token, ({ one }) => ({
  universe: one(universe, {
    fields: [token.universeAddress],
    references: [universe.id],
  }),
}));

export const nodeRelations = relations(node, ({ one }) => ({
  universe: one(universe, {
    fields: [node.universeAddress],
    references: [universe.id],
  }),
}));

export const proposalRelations = relations(proposal, ({ one, many }) => ({
  universe: one(universe, {
    fields: [proposal.universeAddress],
    references: [universe.id],
  }),
  votes: many(vote),
  execution: one(proposalExecution),
  cancellation: one(proposalCancellation),
}));

export const voteRelations = relations(vote, ({ one }) => ({
  proposal: one(proposal, {
    fields: [vote.proposalId],
    references: [proposal.id],
  }),
}));
