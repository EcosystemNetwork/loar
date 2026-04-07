/**
 * Mock for the `ponder` npm package (used by src/api/index.ts for graphql/client exports).
 */
import { vi } from 'vitest';

export const client = vi.fn(() => vi.fn());
export const graphql = vi.fn(() => vi.fn());
