import { describe, it, expect } from 'vitest';
import { notificationTokenAddress } from '../notification-links';

describe('notificationTokenAddress', () => {
  const A = '0xaaaa1111111111111111111111111111111111aa';
  it('returns the token address for token notifications', () => {
    expect(notificationTokenAddress({ targetType: 'token', targetId: A })).toBe(A);
  });
  it('is null for other targets or malformed ids', () => {
    expect(notificationTokenAddress({ targetType: 'user', targetId: A })).toBeNull();
    expect(notificationTokenAddress({ targetType: 'token', targetId: 'nope' })).toBeNull();
    expect(notificationTokenAddress({ targetType: 'token', targetId: `${A}/../x` })).toBeNull();
    expect(notificationTokenAddress({})).toBeNull();
  });
});
