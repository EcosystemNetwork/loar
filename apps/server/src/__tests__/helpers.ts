/**
 * Test helpers for creating tRPC callers with mock auth contexts.
 */
import { appRouter } from '../routers/index';

type AuthUser = { uid: string; address: string; email?: string };

/** The wallet address used by createAdminCaller — set ADMIN_ADDRESSES to match */
export const ADMIN_TEST_ADDRESS = '0xad0000000000000000000000000000000000dead';

/** Create a tRPC caller with no auth (anonymous/public) */
export function createPublicCaller() {
  return appRouter.createCaller({ user: null });
}

/** Create a tRPC caller with a mock authenticated user (non-admin) */
export function createAuthCaller(overrides?: Partial<AuthUser>) {
  const user: AuthUser = {
    uid: 'test-uid',
    address: '0x1234567890abcdef1234567890abcdef12345678',
    email: 'test@example.com',
    ...overrides,
  };
  return appRouter.createCaller({ user });
}

/**
 * Create a tRPC caller with admin privileges.
 * Requires ADMIN_ADDRESSES env var to include ADMIN_TEST_ADDRESS.
 */
export function createAdminCaller(overrides?: Partial<AuthUser>) {
  const user: AuthUser = {
    uid: 'admin-uid',
    address: ADMIN_TEST_ADDRESS,
    email: 'admin@example.com',
    ...overrides,
  };
  return appRouter.createCaller({ user });
}
