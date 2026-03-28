/**
 * Mock for the `ponder:api` virtual module.
 */
import { vi } from 'vitest';

export const db = {
  select: vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
      limit: vi.fn().mockResolvedValue([]),
    }),
  }),
};
