import { beforeAll, describe, expect, it, vi } from 'vitest';
import { handlers, type Handler } from './mocks/ponder-registry';

type Write = { table: string; where?: unknown; values: any };

type DbOptions = {
  find?: (table: string, where: any) => unknown;
  sqlRows?: any[];
  failInsert?: string;
};

function createDb(options: DbOptions = {}) {
  const inserts: Write[] = [];
  const updates: Write[] = [];
  const conflicts: Array<{ table: string; update: unknown }> = [];

  const db = {
    inserts,
    updates,
    conflicts,
    insert: vi.fn((table: string) => ({
      values(values: any) {
        if (options.failInsert === table) throw new Error('duplicate');
        inserts.push({ table, values });
        const promise = Promise.resolve();
        return {
          onConflictDoUpdate(update: unknown) {
            conflicts.push({ table, update });
            return Promise.resolve();
          },
          then: promise.then.bind(promise),
        };
      },
    })),
    update: vi.fn((table: string, where: unknown) => ({
      set(values: any) {
        updates.push({ table, where, values });
        return Promise.resolve();
      },
    })),
    find: vi.fn(async (table: string, where: any) => options.find?.(table, where)),
    sql: {
      execute: vi.fn(async () => ({ rows: options.sqlRows ?? [] })),
    },
  };

  return db;
}

const addresses = {
  universe: '0x1111111111111111111111111111111111111111',
  creator: '0x2222222222222222222222222222222222222222',
  token: '0x3333333333333333333333333333333333333333',
  governor: '0x4444444444444444444444444444444444444444',
  curve: '0x5555555555555555555555555555555555555555',
  buyer: '0x6666666666666666666666666666666666666666',
  recipient: '0x7777777777777777777777777777777777777777',
  other: '0x8888888888888888888888888888888888888888',
  zero: '0x0000000000000000000000000000000000000000',
} as const;

function event(args: Record<string, any> = {}, overrides: Record<string, any> = {}) {
  return {
    id: '0xhash:4',
    args,
    block: { timestamp: 1_700_000_000n, number: 123n },
    transaction: { hash: '0xhash' },
    log: { address: addresses.curve, logIndex: 4 },
    ...overrides,
  };
}

function context(db: ReturnType<typeof createDb>, readContract = vi.fn()) {
  const contract = { abi: [], address: addresses.other };
  return {
    db,
    client: { readContract },
    contracts: {
      Universe: contract,
      UniverseManager: contract,
      CanonMarketplace: contract,
      AdPlacement: contract,
      LicensingRegistry: contract,
      CollabManager: contract,
    },
  };
}

function handler(name: string): Handler {
  const registered = handlers.get(name);
  if (!registered) throw new Error(`Missing handler ${name}`);
  return registered;
}

function inserted(db: ReturnType<typeof createDb>, table: string) {
  return db.inserts.filter((write) => write.table === table).map((write) => write.values);
}

beforeAll(async () => {
  await import('../src/index');
});

describe('handler registration', () => {
  it('registers every configured event projection', () => {
    expect(handlers.size).toBe(49);
    expect([...handlers.keys()]).toEqual(
      expect.arrayContaining([
        'UniverseManager:UniverseCreated',
        'BondingCurve:TokensPurchased',
        'Universe:NodeCreated',
        'GovernanceToken:Transfer',
        'CanonMarketplace:SubmissionCreated',
        'SubscriptionManager:SubscriptionRenewed',
      ])
    );
  });
});

describe('universe and token projections', () => {
  it('stores contract metadata for a newly created universe', async () => {
    const db = createDb();
    const readContract = vi
      .fn()
      .mockResolvedValueOnce('The Expanse')
      .mockResolvedValueOnce('A space opera')
      .mockResolvedValueOnce('ipfs://cover');

    await handler('UniverseManager:UniverseCreated')({
      event: event({ universe: addresses.universe, creator: addresses.creator }),
      context: context(db, readContract),
    });

    expect(readContract).toHaveBeenCalledTimes(3);
    expect(inserted(db, 'universe')).toEqual([
      {
        id: addresses.universe,
        universeId: null,
        creator: addresses.creator,
        createdAt: 1_700_000_000,
        createdAtBlock: 123,
        createdAtLogIndex: 4,
        name: 'The Expanse',
        description: 'A space opera',
        imageURL: 'ipfs://cover',
        tokenAddress: null,
        governorAddress: null,
        nodeCount: 0,
      },
    ]);
  });

  it('uses safe metadata defaults when contract reads fail', async () => {
    const db = createDb();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await handler('UniverseManager:UniverseCreated')({
      event: event({ universe: addresses.universe, creator: addresses.creator }),
      context: context(db, vi.fn().mockRejectedValue(new Error('rpc unavailable'))),
    });

    expect(inserted(db, 'universe')[0]).toMatchObject({
      name: 'Untitled Universe',
      description: 'A narrative universe',
      imageURL: '',
    });
  });

  it('resolves a token to its universe on-chain and updates both projections', async () => {
    const db = createDb();
    const readContract = vi
      .fn()
      .mockResolvedValueOnce(2n)
      .mockResolvedValueOnce([addresses.universe, addresses.token, addresses.zero, addresses.zero]);

    await handler('UniverseManager:TokenCreated')({
      event: event({
        tokenAddress: addresses.token,
        msgSender: addresses.creator,
        governor: addresses.governor,
        tokenAdmin: addresses.creator,
        tokenName: 'Lore',
        tokenSymbol: 'LORE',
        tokenImage: 'ipfs://token',
        tokenMetadata: '{}',
        tokenContext: 'context',
        startingTick: -10,
        poolHook: addresses.other,
        poolId: '0x01',
        pairedToken: addresses.other,
        locker: addresses.other,
      }),
      context: context(db, readContract),
    });

    expect(db.sql.execute).not.toHaveBeenCalled();
    expect(db.updates[0]).toEqual({
      table: 'universe',
      where: { id: addresses.universe },
      values: { tokenAddress: addresses.token, governorAddress: addresses.governor },
    });
    expect(inserted(db, 'token')[0]).toMatchObject({
      id: addresses.token,
      universeAddress: addresses.universe,
      startingTick: '-10',
      createdAt: 1_700_000_000,
    });
  });

  it('falls back to the SQL candidate when on-chain resolution fails', async () => {
    const db = createDb({ sqlRows: [{ id: addresses.universe }] });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const readContract = vi.fn().mockRejectedValue(new Error('rpc unavailable'));

    await handler('UniverseManager:TokenCreated')({
      event: event({
        tokenAddress: addresses.token,
        msgSender: addresses.creator,
        governor: addresses.governor,
        tokenAdmin: addresses.creator,
        tokenName: 'Lore',
        tokenSymbol: 'LORE',
        tokenImage: '',
        tokenMetadata: '',
        tokenContext: '',
        startingTick: 0,
        poolHook: addresses.other,
        poolId: '0x01',
        pairedToken: addresses.other,
        locker: addresses.other,
      }),
      context: context(db, readContract),
    });

    expect(db.sql.execute).toHaveBeenCalledOnce();
    expect(db.updates[0]?.where).toEqual({ id: addresses.universe });
    expect(inserted(db, 'token')[0]?.universeAddress).toBe(addresses.universe);
  });
});

describe('bonding curve accounting', () => {
  it('records a buy and updates aggregate state plus a snapshot', async () => {
    const db = createDb({
      find: (table) =>
        table === 'bondingCurve'
          ? { tokensSold: '100', ethRaised: '40', tradeCount: 2 }
          : undefined,
    });

    await handler('BondingCurve:TokensPurchased')({
      event: event({ buyer: addresses.buyer, ethAmount: 10n, tokenAmount: 25n, newPrice: 3n }),
      context: context(db),
    });

    expect(inserted(db, 'bondingCurveTrade')[0]).toMatchObject({
      id: '0xhash:4',
      trader: addresses.buyer,
      isBuy: true,
      ethAmount: '10',
      tokenAmount: '25',
    });
    expect(db.updates[0]?.values).toEqual({
      tokensSold: '125',
      ethRaised: '50',
      lastPrice: '3',
      tradeCount: 3,
    });
    expect(inserted(db, 'bondingCurveSnapshot')[0]).toMatchObject({
      id: '0xhash:4:snap',
      trigger: 'buy',
      tokensSold: '125',
      ethRaised: '50',
    });
  });

  it('clamps aggregate token and ETH totals to zero on an oversized sell', async () => {
    const db = createDb({
      find: () => ({ tokensSold: '5', ethRaised: '2', tradeCount: 0 }),
    });

    await handler('BondingCurve:TokensSold')({
      event: event({ seller: addresses.buyer, ethReturned: 9n, tokenAmount: 20n, newPrice: 1n }),
      context: context(db),
    });

    expect(db.updates[0]?.values).toMatchObject({ tokensSold: '0', ethRaised: '0', tradeCount: 1 });
    expect(inserted(db, 'bondingCurveSnapshot')[0]).toMatchObject({
      trigger: 'sell',
      tokensSold: '0',
      ethRaised: '0',
    });
  });

  it('accumulates pending refunds and the curve-level total', async () => {
    const refundId = `${addresses.curve}:${addresses.buyer}`;
    const db = createDb({
      find: (table) => {
        if (table === 'bondingCurveRefund') return { amount: '7', claimedAt: null };
        if (table === 'bondingCurve') return { pendingRefundsTotal: '11' };
      },
    });

    await handler('BondingCurve:RefundPending')({
      event: event({ buyer: addresses.buyer, amount: 5n }),
      context: context(db),
    });

    expect(db.updates).toEqual(
      expect.arrayContaining([
        {
          table: 'bondingCurveRefund',
          where: { id: refundId },
          values: { amount: '12', lastEventId: '0xhash:4' },
        },
        {
          table: 'bondingCurve',
          where: { id: addresses.curve },
          values: { pendingRefundsTotal: '16' },
        },
      ])
    );
  });

  it('marks a refund claimed and prevents the aggregate from going negative', async () => {
    const db = createDb({
      find: (table) =>
        table === 'bondingCurveRefund'
          ? { amount: '9', claimedAt: null }
          : { pendingRefundsTotal: '3' },
    });

    await handler('BondingCurve:RefundClaimed')({
      event: event({ buyer: addresses.buyer, amount: 9n }),
      context: context(db),
    });

    expect(db.updates.map((write) => write.values)).toEqual([
      { amount: '0', claimedAt: 1_700_000_000, lastEventId: '0xhash:4' },
      { pendingRefundsTotal: '0' },
    ]);
  });

  it('does not overwrite graduated status with a manager resume', async () => {
    const db = createDb({ find: () => ({ tradingStatus: 'graduated' }) });

    await handler('BondingCurve:TradingHaltedByManager')({
      event: event({ universeId: 9n, halted: false }),
      context: context(db),
    });

    expect(inserted(db, 'bondingCurveHaltEvent')[0]).toMatchObject({
      halted: false,
      source: 'manager',
      universeId: 9,
    });
    expect(db.updates).toHaveLength(0);
  });
});

describe('content and market state', () => {
  it('creates node and content rows and increments universe node count', async () => {
    const db = createDb({ find: (table) => (table === 'universe' ? { nodeCount: 4 } : undefined) });

    await handler('Universe:NodeCreated')({
      event: event(
        {
          id: 7n,
          previous: 6n,
          creator: addresses.creator,
          contentHash: '0xcontent',
          plotHash: '0xplot',
          link: 'ipfs://video',
          plot: 'A twist',
        },
        { log: { address: addresses.universe, logIndex: 4 } }
      ),
      context: context(db),
    });

    expect(inserted(db, 'node')[0]).toMatchObject({
      id: `${addresses.universe}:7`,
      nodeId: 7,
      previousNodeId: 6,
      contentHash: '0xcontent',
    });
    expect(inserted(db, 'nodeContent')[0]).toMatchObject({
      videoLink: 'ipfs://video',
      plot: 'A twist',
    });
    expect(db.updates[0]?.values).toEqual({ nodeCount: 5 });
  });

  it('deduplicates swaps by event id', async () => {
    const duplicateDb = createDb({ find: () => ({ id: '0xhash:4' }) });
    await handler('PoolManager:Swap')({
      event: event({}),
      context: context(duplicateDb),
    });
    expect(duplicateDb.inserts).toHaveLength(0);

    const db = createDb();
    await handler('PoolManager:Swap')({
      event: event({
        id: '0xpool',
        sender: addresses.creator,
        amount0: -4n,
        amount1: 8n,
        sqrtPriceX96: 12n,
        liquidity: 20n,
        tick: -2,
      }),
      context: context(db),
    });
    expect(inserted(db, 'swap')[0]).toMatchObject({
      amount0: '-4',
      amount1: '8',
      blockNumber: 123,
    });
  });

  it('updates canon vote aggregates in both support directions', async () => {
    for (const [support, field] of [
      [true, 'votesFor'],
      [false, 'votesAgainst'],
    ] as const) {
      const db = createDb({
        find: () => ({ votesFor: '10', votesAgainst: '20' }),
      });
      await handler('CanonMarketplace:VoteCast')({
        event: event({ submissionId: 5n, voter: addresses.buyer, support, weight: 3n }),
        context: context(db),
      });
      expect(db.updates[0]?.values).toEqual({ [field]: support ? '13' : '23' });
    }
  });
});

describe('token transfer balances', () => {
  it('debits the sender and upserts the recipient', async () => {
    const db = createDb({
      find: (table) => (table === 'tokenHolder' ? { balance: '12' } : undefined),
    });

    await handler('GovernanceToken:Transfer')({
      event: event(
        { from: addresses.buyer, to: addresses.recipient, amount: 5n },
        { log: { address: addresses.token, logIndex: 4 } }
      ),
      context: context(db),
    });

    expect(inserted(db, 'tokenTransfer')).toHaveLength(1);
    expect(db.updates[0]?.values).toEqual({ balance: '7' });
    expect(inserted(db, 'tokenHolder')[0]).toMatchObject({
      holderAddress: addresses.recipient,
      balance: '5',
    });
    expect(db.conflicts).toHaveLength(1);
  });

  it('does not mutate balances when a transfer is replayed', async () => {
    const db = createDb({ failInsert: 'tokenTransfer' });

    await handler('GovernanceToken:Transfer')({
      event: event(
        { from: addresses.buyer, to: addresses.recipient, amount: 5n },
        { log: { address: addresses.token, logIndex: 4 } }
      ),
      context: context(db),
    });

    expect(db.find).not.toHaveBeenCalled();
    expect(db.updates).toHaveLength(0);
    expect(inserted(db, 'tokenHolder')).toHaveLength(0);
  });
});

describe('remaining protocol projections', () => {
  it.each([
    [
      'UniverseManager:SetHook',
      'hookEvent',
      { hook: addresses.other, enabled: true },
      { hook_address: addresses.other, enabled: true },
    ],
    [
      'UniverseManager:BondingCurveCreated',
      'bondingCurve',
      {
        bondingCurve: addresses.curve,
        token: addresses.token,
        universeId: 7n,
        graduationEth: 100n,
        curveSupply: 200n,
      },
      { universeId: 7, graduationEth: '100', curveSupply: '200', graduated: false },
    ],
    [
      'Universe:CanonChanged',
      'nodeCanonization',
      { newCanonId: 7n, canonizer: addresses.creator },
      { nodeId: 7, canonizer: addresses.creator },
    ],
    [
      'UniverseGovernor:VoteCast',
      'vote',
      { proposalId: 9n, voter: addresses.buyer, support: 1, weight: 12n, reason: '' },
      { proposalId: '9', support: 1, weight: '12', reason: null },
    ],
    [
      'PoolManager:Initialize',
      'pool',
      {
        id: '0xpool',
        currency0: addresses.token,
        currency1: addresses.other,
        fee: 3000,
        tickSpacing: 60,
        hooks: addresses.curve,
        sqrtPriceX96: 99n,
        tick: -4,
      },
      { poolId: '0xpool', sqrtPriceX96: '99', creationBlock: 123 },
    ],
    [
      'PaymentRouter:LoarPaymentRouted',
      'paymentEvent',
      { creator: addresses.creator, creatorAmount: 8n, platformAmount: 2n, feeBps: 2000n },
      { kind: 'loar_routed', creatorAmount: '8', platformAmount: '2' },
    ],
    [
      'PaymentRouter:Claimed',
      'paymentEvent',
      { creator: addresses.creator, amount: 11n },
      { kind: 'claimed', creatorAmount: '11' },
    ],
  ])('projects %s', async (name, table, args, expected) => {
    const db = createDb();
    await handler(name)({ event: event(args), context: context(db) });
    expect(inserted(db, table)[0]).toMatchObject(expected);
  });

  it('projects proposal creation, execution, and cancellation', async () => {
    const db = createDb();
    await handler('UniverseGovernor:ProposalCreated')({
      event: event(
        {
          proposalId: 9n,
          proposer: addresses.creator,
          targets: [addresses.other],
          values: [3n],
          calldatas: ['0x1234'],
          description: 'Expand canon',
          voteStart: 10n,
          voteEnd: 20n,
        },
        { log: { address: addresses.governor, logIndex: 4 } }
      ),
      context: context(db),
    });
    await handler('UniverseGovernor:ProposalExecuted')({
      event: event({ proposalId: 9n }, { log: { address: addresses.governor, logIndex: 4 } }),
      context: context(db),
    });
    await handler('UniverseGovernor:ProposalCanceled')({
      event: event({ proposalId: 10n }, { log: { address: addresses.governor, logIndex: 4 } }),
      context: context(db),
    });

    expect(inserted(db, 'proposal')[0]).toMatchObject({
      id: '9',
      values: '["3"]',
      startBlock: 10,
      endBlock: 20,
      executed: false,
      cancelled: false,
    });
    expect(inserted(db, 'proposalExecution')[0]).toMatchObject({ proposalId: '9' });
    expect(inserted(db, 'proposalCancellation')[0]).toMatchObject({ proposalId: '10' });
  });

  it('applies status transitions across protocol entities', async () => {
    const cases = [
      [
        'UniverseGovernor:ProposalQueued',
        { proposalId: 9n, etaSeconds: 30n },
        'proposal',
        { queued: true, queuedEta: 30 },
      ],
      [
        'CanonMarketplace:SubmissionAccepted',
        { submissionId: 1n },
        'canonSubmission',
        { status: 2, finalizedAt: 1_700_000_000 },
      ],
      [
        'CanonMarketplace:SubmissionRejected',
        { submissionId: 2n },
        'canonSubmission',
        { status: 3, finalizedAt: 1_700_000_000 },
      ],
      [
        'LicensingRegistry:LicenseActivated',
        { licenseId: 1n },
        'license',
        { status: 1, startTime: 1_700_000_000 },
      ],
      [
        'LicensingRegistry:LicenseRevoked',
        { licenseId: 2n },
        'license',
        { status: 3, endTime: 1_700_000_000 },
      ],
      [
        'CollabManager:CollabAccepted',
        { collabId: 1n, acceptor: addresses.recipient },
        'collab',
        { status: 1, acceptor: addresses.recipient },
      ],
      [
        'CollabManager:CollabCompleted',
        { collabId: 2n, totalRevenue: 88n },
        'collab',
        { status: 3, totalRevenue: '88', endTime: 1_700_000_000 },
      ],
      ['CollabManager:CollabCancelled', { collabId: 3n }, 'collab', { status: 4 }],
    ] as const;

    for (const [name, args, table, expected] of cases) {
      const db = createDb();
      await handler(name)({ event: event(args), context: context(db) });
      expect(db.updates[0]).toMatchObject({ table, values: expected });
    }
  });

  it('updates both media projections only when their rows exist', async () => {
    const db = createDb({ find: () => ({ id: 'existing' }) });
    await handler('Universe:MediaUpdated')({
      event: event(
        { nodeId: 7n, contentHash: '0xnew', link: 'ipfs://new' },
        { log: { address: addresses.universe, logIndex: 4 } }
      ),
      context: context(db),
    });
    expect(db.updates.map((write) => write.values)).toEqual([
      { contentHash: '0xnew', videoLink: 'ipfs://new' },
      { contentHash: '0xnew' },
    ]);
  });

  it('upserts parameterized votes and marks curve graduation from both signals', async () => {
    const voteDb = createDb();
    await handler('UniverseGovernor:VoteCastWithParams')({
      event: event(
        { proposalId: 9n, voter: addresses.buyer, support: 2, weight: 12n, reason: 'quadratic' },
        { log: { address: addresses.governor, logIndex: 4 } }
      ),
      context: context(voteDb),
    });
    expect(inserted(voteDb, 'vote')[0]).toMatchObject({ reason: 'quadratic', weight: '12' });
    expect(voteDb.conflicts).toHaveLength(1);

    const managerDb = createDb({ sqlRows: [{ id: addresses.curve }] });
    await handler('UniverseManager:TokenGraduated')({
      event: event({ token: addresses.token }),
      context: context(managerDb),
    });
    expect(managerDb.updates[0]?.values).toEqual({ graduated: true, graduatedAt: 1_700_000_000 });

    const curveDb = createDb();
    await handler('BondingCurve:Graduated')({
      event: event({ universeId: 7n }),
      context: context(curveDb),
    });
    expect(curveDb.updates[0]?.values).toMatchObject({
      graduated: true,
      tradingStatus: 'graduated',
    });
    expect(inserted(curveDb, 'bondingCurveHaltEvent')[0]).toMatchObject({ source: 'graduation' });
  });

  it('updates a universe token and records admin changes without a schema write', async () => {
    const db = createDb({ find: () => ({ id: addresses.universe }) });
    await handler('Universe:TokenUpdated')({
      event: event(
        { token: addresses.token },
        { log: { address: addresses.universe, logIndex: 4 } }
      ),
      context: context(db),
    });
    expect(db.updates[0]?.values).toEqual({ tokenAddress: addresses.token });

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await handler('Universe:AdminUpdated')({
      event: event(
        { newAdmin: addresses.creator },
        { log: { address: addresses.universe, logIndex: 4 } }
      ),
      context: context(db),
    });
    expect(log).toHaveBeenCalledWith(expect.stringContaining(addresses.creator));
  });

  it('hydrates sponsorship payment data from its contract struct', async () => {
    const db = createDb();
    const readContract = vi.fn().mockResolvedValue([0n, 0n, addresses.creator, 44n, 0n, 0n, true]);
    await handler('AdPlacement:SponsorshipActivated')({
      event: event({ sponsorshipId: 1n, slotId: 2n, sponsor: addresses.creator }),
      context: context(db, readContract),
    });
    expect(inserted(db, 'sponsorship')[0]).toMatchObject({
      adSlotId: 2,
      sponsor: addresses.creator,
      totalPaid: '44',
      active: true,
    });
  });
});

describe('revenue projections', () => {
  it.each([
    [
      'CreditManager:CreditsGranted',
      'creditEvent',
      { user: addresses.creator, amount: 9n, reason: 'promo' },
      { kind: 'granted', amount: '9', reason: 'promo' },
    ],
    [
      'CreditManager:CreditsPurchasedWithEth',
      'creditEvent',
      { user: addresses.creator, credits: 20n, packageId: 2n, bonus: 3n, paid: 4n },
      { kind: 'purchased', amount: '20', paidWei: '4' },
    ],
    [
      'CreditManager:CreditsPurchasedWithLoar',
      'creditEvent',
      { user: addresses.creator, credits: 20n, packageId: 2n, bonus: 3n, loarPaid: 5n },
      { kind: 'loar_purchased', paidLoar: '5' },
    ],
    [
      'CreditManager:CreditsSpent',
      'creditEvent',
      { user: addresses.creator, amount: 6n, generationType: 'image', universeId: 7n },
      { kind: 'spent', generationType: 'image', universeId: '7' },
    ],
    [
      'PaymentRouter:PaymentRouted',
      'paymentEvent',
      { creator: addresses.creator, creatorAmount: 8n, platformAmount: 2n, feeBps: 2000n },
      { kind: 'routed', creatorAmount: '8', platformAmount: '2', feeBps: 2000 },
    ],
    [
      'PaymentRouter:LoarClaimed',
      'paymentEvent',
      { creator: addresses.creator, amount: 12n },
      { kind: 'loar_claimed', creatorAmount: '12' },
    ],
    [
      'SubscriptionManager:Subscribed',
      'subscriptionEvent',
      { user: addresses.creator, universeId: 7n, tier: 2n, expiresAt: 1_800_000_000n },
      { kind: 'subscribed', universeId: '7', tier: 2, expiresAt: 1_800_000_000 },
    ],
    [
      'SubscriptionManager:SubscriptionCancelled',
      'subscriptionEvent',
      { user: addresses.creator, universeId: 7n },
      { kind: 'cancelled', universeId: '7' },
    ],
    [
      'SubscriptionManager:SubscriptionRenewed',
      'subscriptionEvent',
      { user: addresses.creator, universeId: 7n, newExpiry: 1_900_000_000n },
      { kind: 'renewed', expiresAt: 1_900_000_000 },
    ],
  ])('projects %s', async (name, table, args, expected) => {
    const db = createDb();
    await handler(name)({ event: event(args), context: context(db) });
    expect(inserted(db, table)[0]).toMatchObject({
      id: '0xhash:4',
      ...expected,
      timestamp: 1_700_000_000,
      blockNumber: 123,
    });
  });

  it('hydrates struct-only fields for marketplace, ad, license, and collab events', async () => {
    const cases = [
      {
        name: 'CanonMarketplace:SubmissionCreated',
        table: 'canonSubmission',
        args: {
          id: 1n,
          universeId: 2n,
          subType: 3n,
          creator: addresses.creator,
          contentHash: '0xcontent',
        },
        result: [
          1n,
          2n,
          addresses.token,
          0,
          0,
          addresses.creator,
          addresses.other,
          'ipfs://metadata',
          9n,
          0n,
          0n,
          99n,
          0n,
          0n,
        ],
        expected: {
          universeToken: addresses.token,
          metadataURI: 'ipfs://metadata',
          submissionFee: '9',
          votingDeadline: 99,
        },
      },
      {
        name: 'AdPlacement:AdSlotCreated',
        table: 'adSlot',
        args: { slotId: 1n, universeId: 2n, placementType: 3n, minBid: 4n },
        result: [0n, 0n, 0, 0n, 0n, addresses.other, '', 6n, true],
        expected: { episodesRemaining: 6, active: true },
      },
      {
        name: 'LicensingRegistry:LicenseCreated',
        table: 'license',
        args: {
          licenseId: 1n,
          universeId: 2n,
          licenseType: 3n,
          licensee: addresses.recipient,
          upfrontFee: 4n,
        },
        result: [0n, 0n, 0, 0, addresses.creator, addresses.recipient, 0n, 750, 0n, 0n, 0n, ''],
        expected: { licensor: addresses.creator, royaltyBps: 750, status: 0 },
      },
      {
        name: 'CollabManager:CollabProposed',
        table: 'collab',
        args: { collabId: 1n, universeA: 2n, universeB: 3n, proposer: addresses.creator },
        result: [0n, 0n, 0n, addresses.creator, addresses.other, 0, 1250n, 0n, 0n, 0n, '', 0n],
        expected: { revenueShareBps: 1250, totalRevenue: '0', status: 0 },
      },
    ];

    for (const testCase of cases) {
      const db = createDb();
      const readContract = vi.fn().mockResolvedValue(testCase.result);
      await handler(testCase.name)({
        event: event(testCase.args),
        context: context(db, readContract),
      });
      expect(readContract).toHaveBeenCalledOnce();
      expect(inserted(db, testCase.table)[0]).toMatchObject(testCase.expected);
    }
  });
});
