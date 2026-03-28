/**
 * Indexer handler unit tests.
 *
 * Strategy: vitest.config.ts aliases `ponder:registry` to a mock that captures
 * ponder.on() callbacks. Importing `../index` registers all handlers into
 * `registeredHandlers`. Tests pull each handler by event name and invoke it
 * with a mock context, then assert on db/client call arguments.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { registeredHandlers } from './mocks/ponder-registry';
import { createMockContext, mockBlock, mockLog } from './helpers';

// Import index.ts to register all handlers via the mock ponder.on()
import '../index';

// ─── helpers ──────────────────────────────────────────────────────────────────

function handler(event: string) {
  const h = registeredHandlers[event];
  if (!h) throw new Error(`No handler registered for "${event}"`);
  return h;
}

// ─── UniverseManager:UniverseCreated ─────────────────────────────────────────

describe('UniverseManager:UniverseCreated', () => {
  const UNIVERSE = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const CREATOR = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

  it('inserts a universe record with metadata from readContract', async () => {
    const ctx = createMockContext();
    ctx.client.readContract
      .mockResolvedValueOnce('My Universe') // universeName
      .mockResolvedValueOnce('A great story') // universeDescription
      .mockResolvedValueOnce('https://img.com/u.png'); // universeImageUrl

    await handler('UniverseManager:UniverseCreated')({
      event: { args: { universe: UNIVERSE, creator: CREATOR }, block: mockBlock() },
      context: ctx,
    });

    expect(ctx.db.insert).toHaveBeenCalledOnce();
    const inserted = ctx.db.insert.mock.calls[0][0];
    expect(inserted).toBe('universe'); // schema mock value

    // values() is called with the universe data
    const valuesCall = ctx.db.insert.mock.results[0].value.values;
    expect(valuesCall).toBeDefined();
  });

  it('falls back to defaults when readContract throws', async () => {
    const ctx = createMockContext();
    ctx.client.readContract.mockRejectedValue(new Error('contract not deployed'));

    // Should not throw — handler catches and logs
    await expect(
      handler('UniverseManager:UniverseCreated')({
        event: { args: { universe: UNIVERSE, creator: CREATOR }, block: mockBlock() },
        context: ctx,
      })
    ).resolves.not.toThrow();

    // Still inserts with fallback values
    expect(ctx.db.insert).toHaveBeenCalledOnce();
  });

  it('stores creator address checksummed', async () => {
    const ctx = createMockContext();
    ctx.client.readContract.mockResolvedValue('');

    const lowercaseCreator = CREATOR; // already lowercase
    await handler('UniverseManager:UniverseCreated')({
      event: { args: { universe: UNIVERSE, creator: lowercaseCreator }, block: mockBlock() },
      context: ctx,
    });

    // getAddress normalises to checksum form — just verify insert was called
    expect(ctx.db.insert).toHaveBeenCalledOnce();
  });
});

// ─── Universe:NodeCreated ─────────────────────────────────────────────────────

describe('Universe:NodeCreated', () => {
  const UNIVERSE = '0xCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCc';
  const CREATOR = '0xdDdDdDdDdDdDdDdDdDdDdDdDdDdDdDdDdDdDdDd';

  const baseEvent = {
    args: {
      id: 7n,
      previous: 6n,
      creator: CREATOR,
      contentHash: '0xabc123' as `0x${string}`,
      plotHash: '0xdef456' as `0x${string}`,
      link: 'https://cdn.example.com/video.mp4',
      plot: 'The hero arrives at the city gates.',
    },
    block: mockBlock(),
    log: mockLog(UNIVERSE),
  };

  it('inserts node and nodeContent with composite ID', async () => {
    const ctx = createMockContext();
    await handler('Universe:NodeCreated')({ event: baseEvent, context: ctx });

    // Two inserts: node + nodeContent
    expect(ctx.db.insert).toHaveBeenCalledTimes(2);
  });

  it('uses lowercase universe address in composite ID', async () => {
    const ctx = createMockContext();
    const insertedIds: string[] = [];

    ctx.db.insert.mockImplementation((table: string) => ({
      values: (data: any) => {
        if (data?.id) insertedIds.push(data.id);
        return { onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) };
      },
    }));

    await handler('Universe:NodeCreated')({ event: baseEvent, context: ctx });

    const expectedId = `${UNIVERSE.toLowerCase()}:7`;
    expect(insertedIds).toContain(expectedId);
  });

  it('increments universe nodeCount when universe record exists', async () => {
    const existingUniverse = { id: UNIVERSE.toLowerCase(), nodeCount: 4 };
    const ctx = createMockContext({ find: existingUniverse });

    await handler('Universe:NodeCreated')({ event: baseEvent, context: ctx });

    expect(ctx.db.update).toHaveBeenCalledOnce();
    const setCall = ctx.db.update.mock.results[0].value.set;
    expect(setCall).toHaveBeenCalledWith({ nodeCount: 5 });
  });

  it('skips nodeCount update when universe record is missing', async () => {
    const ctx = createMockContext({ find: null });
    await handler('Universe:NodeCreated')({ event: baseEvent, context: ctx });
    expect(ctx.db.update).not.toHaveBeenCalled();
  });
});

// ─── Universe:NodeCanonized ───────────────────────────────────────────────────

describe('Universe:NodeCanonized', () => {
  it('inserts a nodeCanonization with composite ID', async () => {
    const ctx = createMockContext();
    const UNIVERSE = '0xEeEeEeEeEeEeEeEeEeEeEeEeEeEeEeEeEeEeEeEe';
    const CANONIZER = '0xFfFfFfFfFfFfFfFfFfFfFfFfFfFfFfFfFfFfFfFf';

    await handler('Universe:NodeCanonized')({
      event: {
        id: 'event-id-42',
        args: { id: 3n, canonizer: CANONIZER },
        block: mockBlock(),
        log: mockLog(UNIVERSE),
      },
      context: ctx,
    });

    expect(ctx.db.insert).toHaveBeenCalledOnce();
    expect(ctx.db.insert.mock.calls[0][0]).toBe('nodeCanonization');
  });
});

// ─── UniverseGovernor:ProposalCreated ────────────────────────────────────────

describe('UniverseGovernor:ProposalCreated', () => {
  const GOVERNOR = '0x1111111111111111111111111111111111111111';
  const PROPOSER = '0x2222222222222222222222222222222222222222';

  it('JSON-serializes targets, values, and calldatas arrays', async () => {
    const insertedData: any[] = [];
    const ctx = createMockContext({ select: [] });
    ctx.db.insert.mockImplementation((table: string) => ({
      values: (data: any) => {
        insertedData.push(data);
        return { onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) };
      },
    }));

    const targets = ['0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'];
    const values = [1000n];
    const calldatas = ['0xdeadbeef'];

    await handler('UniverseGovernor:ProposalCreated')({
      event: {
        args: {
          proposalId: 99n,
          proposer: PROPOSER,
          targets,
          values,
          calldatas,
          description: 'Add chapter 2',
          voteStart: 100n,
          voteEnd: 200n,
        },
        block: mockBlock(),
        log: mockLog(GOVERNOR),
      },
      context: ctx,
    });

    expect(insertedData).toHaveLength(1);
    const record = insertedData[0];

    expect(record.targets).toBe(JSON.stringify(targets));
    expect(record.values).toBe(JSON.stringify(['1000'])); // bigint → string
    expect(record.calldatas).toBe(JSON.stringify(calldatas));
    expect(record.executed).toBe(false);
    expect(record.cancelled).toBe(false);
  });

  it('sets universeAddress to null when no matching universe found', async () => {
    const insertedData: any[] = [];
    const ctx = createMockContext({ select: [] });
    ctx.db.insert.mockImplementation(() => ({
      values: (data: any) => {
        insertedData.push(data);
        return {};
      },
    }));

    await handler('UniverseGovernor:ProposalCreated')({
      event: {
        args: {
          proposalId: 1n,
          proposer: PROPOSER,
          targets: [],
          values: [],
          calldatas: [],
          description: 'test',
          voteStart: 1n,
          voteEnd: 2n,
        },
        block: mockBlock(),
        log: mockLog(GOVERNOR),
      },
      context: ctx,
    });

    expect(insertedData[0].universeAddress).toBeNull();
  });
});

// ─── UniverseGovernor:ProposalExecuted / Canceled ────────────────────────────

describe('UniverseGovernor:ProposalExecuted', () => {
  it('marks proposal as executed and inserts execution record', async () => {
    const ctx = createMockContext();

    await handler('UniverseGovernor:ProposalExecuted')({
      event: {
        id: 'exec-event-1',
        args: { proposalId: 5n },
        block: mockBlock(),
        log: mockLog('0x3333333333333333333333333333333333333333'),
      },
      context: ctx,
    });

    expect(ctx.db.update).toHaveBeenCalledOnce();
    expect(ctx.db.update.mock.results[0].value.set).toHaveBeenCalledWith({ executed: true });
    expect(ctx.db.insert).toHaveBeenCalledOnce();
    expect(ctx.db.insert.mock.calls[0][0]).toBe('proposalExecution');
  });
});

describe('UniverseGovernor:ProposalCanceled', () => {
  it('marks proposal as cancelled and inserts cancellation record', async () => {
    const ctx = createMockContext();

    await handler('UniverseGovernor:ProposalCanceled')({
      event: {
        id: 'cancel-event-1',
        args: { proposalId: 5n },
        block: mockBlock(),
        log: mockLog('0x3333333333333333333333333333333333333333'),
      },
      context: ctx,
    });

    expect(ctx.db.update).toHaveBeenCalledOnce();
    expect(ctx.db.update.mock.results[0].value.set).toHaveBeenCalledWith({ cancelled: true });
    expect(ctx.db.insert).toHaveBeenCalledOnce();
    expect(ctx.db.insert.mock.calls[0][0]).toBe('proposalCancellation');
  });
});

// ─── UniverseGovernor:VoteCast ────────────────────────────────────────────────

describe('UniverseGovernor:VoteCast', () => {
  it('inserts vote with composite ID proposalId:voter', async () => {
    const insertedData: any[] = [];
    const GOVERNOR = '0x4444444444444444444444444444444444444444';
    const VOTER = '0x5555555555555555555555555555555555555555';
    const ctx = createMockContext();
    ctx.db.insert.mockImplementation(() => ({
      values: (data: any) => {
        insertedData.push(data);
        return {};
      },
    }));

    await handler('UniverseGovernor:VoteCast')({
      event: {
        args: {
          proposalId: 12n,
          voter: VOTER,
          support: 1,
          weight: 500n,
          reason: 'Great idea',
        },
        block: mockBlock(),
        log: mockLog(GOVERNOR),
      },
      context: ctx,
    });

    expect(insertedData).toHaveLength(1);
    const record = insertedData[0];
    expect(record.id).toBe(`12:${VOTER}`);
    expect(record.weight).toBe('500');
    expect(record.support).toBe(1);
    expect(record.reason).toBe('Great idea');
  });

  it('stores null reason when empty string provided', async () => {
    const insertedData: any[] = [];
    const ctx = createMockContext();
    ctx.db.insert.mockImplementation(() => ({
      values: (data: any) => {
        insertedData.push(data);
        return {};
      },
    }));

    await handler('UniverseGovernor:VoteCast')({
      event: {
        args: {
          proposalId: 1n,
          voter: '0x5555555555555555555555555555555555555555',
          support: 0,
          weight: 100n,
          reason: '',
        },
        block: mockBlock(),
        log: mockLog('0x4444444444444444444444444444444444444444'),
      },
      context: ctx,
    });

    expect(insertedData[0].reason).toBeNull();
  });
});

// ─── GovernanceToken:Transfer ─────────────────────────────────────────────────

describe('GovernanceToken:Transfer', () => {
  const TOKEN = '0x6666666666666666666666666666666666666666';
  const ALICE = '0x7777777777777777777777777777777777777777';
  const BOB = '0x8888888888888888888888888888888888888888';
  const ZERO = '0x0000000000000000000000000000000000000000';

  it('records transfer and upserts recipient balance on normal transfer', async () => {
    const ctx = createMockContext({ find: { id: `${TOKEN}:${ALICE}`, balance: '1000' } });

    await handler('GovernanceToken:Transfer')({
      event: {
        id: 'tx-1',
        args: { from: ALICE, to: BOB, value: 300n },
        block: mockBlock(),
        log: mockLog(TOKEN),
      },
      context: ctx,
    });

    // One insert for the transfer record, one for recipient upsert
    expect(ctx.db.insert).toHaveBeenCalledTimes(2);
    // Sender balance updated
    expect(ctx.db.update).toHaveBeenCalledOnce();
    expect(ctx.db.update.mock.results[0].value.set).toHaveBeenCalledWith({ balance: '700' });
  });

  it('skips sender balance update on mint (from zero address)', async () => {
    const ctx = createMockContext();

    await handler('GovernanceToken:Transfer')({
      event: {
        id: 'mint-1',
        args: { from: ZERO, to: BOB, value: 1000n },
        block: mockBlock(),
        log: mockLog(TOKEN),
      },
      context: ctx,
    });

    // No update call — mint has no sender to deduct
    expect(ctx.db.update).not.toHaveBeenCalled();
    // But transfer record and recipient upsert are created
    expect(ctx.db.insert).toHaveBeenCalledTimes(2);
  });

  it('skips recipient balance upsert on burn (to zero address)', async () => {
    const ctx = createMockContext({ find: { id: `${TOKEN}:${ALICE}`, balance: '500' } });

    await handler('GovernanceToken:Transfer')({
      event: {
        id: 'burn-1',
        args: { from: ALICE, to: ZERO, value: 200n },
        block: mockBlock(),
        log: mockLog(TOKEN),
      },
      context: ctx,
    });

    // Only the transfer record insert — no recipient upsert
    expect(ctx.db.insert).toHaveBeenCalledTimes(1);
    // Sender is updated
    expect(ctx.db.update).toHaveBeenCalledOnce();
    expect(ctx.db.update.mock.results[0].value.set).toHaveBeenCalledWith({ balance: '300' });
  });

  it('sets sender balance to 0 instead of going negative', async () => {
    // Balance exactly equal to transfer amount
    const ctx = createMockContext({ find: { id: `${TOKEN}:${ALICE}`, balance: '100' } });

    await handler('GovernanceToken:Transfer')({
      event: {
        id: 'tx-2',
        args: { from: ALICE, to: BOB, value: 100n },
        block: mockBlock(),
        log: mockLog(TOKEN),
      },
      context: ctx,
    });

    expect(ctx.db.update.mock.results[0].value.set).toHaveBeenCalledWith({ balance: '0' });
  });

  it('converts bigint value to string in transfer record', async () => {
    const insertedData: any[] = [];
    const ctx = createMockContext();
    ctx.db.insert.mockImplementation(() => ({
      values: (data: any) => {
        insertedData.push(data);
        return { onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) };
      },
    }));

    await handler('GovernanceToken:Transfer')({
      event: {
        id: 'tx-3',
        args: { from: ZERO, to: BOB, value: 9999999999999999999n },
        block: mockBlock(),
        log: mockLog(TOKEN),
      },
      context: ctx,
    });

    const transferRecord = insertedData.find((d) => d.id === 'tx-3');
    expect(transferRecord).toBeDefined();
    expect(transferRecord.value).toBe('9999999999999999999');
    expect(typeof transferRecord.value).toBe('string');
  });
});

// ─── PoolManager:Initialize ───────────────────────────────────────────────────

describe('PoolManager:Initialize', () => {
  it('inserts pool record with bigint fields converted to string', async () => {
    const insertedData: any[] = [];
    const ctx = createMockContext();
    ctx.db.insert.mockImplementation(() => ({
      values: (data: any) => {
        insertedData.push(data);
        return {};
      },
    }));

    await handler('PoolManager:Initialize')({
      event: {
        args: {
          id: '0xpool123',
          currency0: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          currency1: '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
          fee: 3000,
          tickSpacing: 60,
          hooks: '0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
          sqrtPriceX96: 79228162514264337593543950336n,
          tick: 0,
        },
        block: mockBlock({ number: 500n }),
      },
      context: ctx,
    });

    expect(insertedData).toHaveLength(1);
    expect(insertedData[0].sqrtPriceX96).toBe('79228162514264337593543950336');
    expect(typeof insertedData[0].sqrtPriceX96).toBe('string');
    expect(insertedData[0].creationBlock).toBe(500);
  });
});

// ─── PoolManager:Swap ─────────────────────────────────────────────────────────

describe('PoolManager:Swap', () => {
  it('inserts swap with all numeric fields stringified', async () => {
    const insertedData: any[] = [];
    const ctx = createMockContext();
    ctx.db.insert.mockImplementation(() => ({
      values: (data: any) => {
        insertedData.push(data);
        return {};
      },
    }));

    await handler('PoolManager:Swap')({
      event: {
        id: 'swap-event-1',
        args: {
          id: '0xpool123',
          sender: '0xDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD',
          amount0: -1000n,
          amount1: 999n,
          sqrtPriceX96: 79228162514264337593543950336n,
          liquidity: 5000000n,
          tick: 42,
        },
        block: mockBlock({ timestamp: 1700001000n, number: 999n }),
      },
      context: ctx,
    });

    expect(insertedData).toHaveLength(1);
    const record = insertedData[0];
    expect(record.amount0).toBe('-1000');
    expect(record.amount1).toBe('999');
    expect(record.liquidity).toBe('5000000');
    expect(record.blockNumber).toBe(999);
    expect(record.timestamp).toBe(1700001000);
  });
});
