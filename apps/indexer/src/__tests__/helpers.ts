import { vi } from 'vitest';

/**
 * Creates a mock Ponder context with chainable db methods.
 * insert/update/find/select are all tracked with vi.fn().
 */
export function createMockContext(overrides: { find?: any; select?: any } = {}) {
  const insertValues = vi.fn().mockResolvedValue(undefined);
  const insertOnConflict = vi
    .fn()
    .mockReturnValue({ onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) });
  const insertResult = {
    values: insertValues,
    onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
  };

  // Allow insert().values().onConflictDoUpdate() chains
  insertValues.mockImplementation(() => ({
    onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
  }));

  const updateSet = vi.fn().mockResolvedValue(undefined);

  const mockDb = {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockImplementation((data) => {
        // Return an object that supports .onConflictDoUpdate() for tokenHolder upserts
        return { onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) };
      }),
    }),
    find: vi.fn().mockResolvedValue(overrides.find ?? null),
    update: vi.fn().mockReturnValue({ set: vi.fn().mockResolvedValue(undefined) }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(overrides.select ?? []),
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(overrides.select ?? []),
          }),
        }),
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(overrides.select ?? []),
        }),
        limit: vi.fn().mockResolvedValue(overrides.select ?? []),
      }),
    }),
  };

  const mockClient = {
    readContract: vi.fn().mockResolvedValue(''),
  };

  return {
    db: mockDb,
    client: mockClient,
    contracts: {
      Universe: { abi: [] },
    },
  };
}

/** Returns a minimal mock block */
export function mockBlock(overrides: Partial<{ timestamp: bigint; number: bigint }> = {}) {
  return {
    timestamp: overrides.timestamp ?? 1700000000n,
    number: overrides.number ?? 1000n,
  };
}

/** Returns a minimal mock log */
export function mockLog(address: string) {
  return { address };
}
