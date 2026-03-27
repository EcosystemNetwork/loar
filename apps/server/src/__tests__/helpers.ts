/**
 * Test helpers for creating tRPC callers with mock auth contexts.
 */
import { appRouter } from '../routers/index';

type AuthUser = { uid: string; address: string; email?: string };

/** Create a tRPC caller with no auth (anonymous/public) */
export function createPublicCaller() {
  return appRouter.createCaller({ user: null });
}

/** Create a tRPC caller with a mock authenticated user */
export function createAuthCaller(overrides?: Partial<AuthUser>) {
  const user: AuthUser = {
    uid: 'test-uid',
    address: '0x1234567890abcdef1234567890abcdef12345678',
    email: 'test@example.com',
    ...overrides,
  };
  return appRouter.createCaller({ user });
}
