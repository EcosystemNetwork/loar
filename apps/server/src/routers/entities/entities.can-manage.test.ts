import { describe, it, expect, vi, beforeEach } from 'vitest';

const isUniverseAdmin = vi.fn();
vi.mock('../../lib/safe-admin', () => ({
  isUniverseAdmin: (...a: unknown[]) => isUniverseAdmin(...a),
}));
vi.mock('../../lib/firebase', () => ({ db: null }));

import { canManageEntity } from './entities.handlers';

describe('canManageEntity', () => {
  beforeEach(() => isUniverseAdmin.mockReset());

  it('allows the creator without a universe lookup (case-insensitive)', async () => {
    const ok = await canManageEntity({ creator: '0xABC', universeAddress: '0xu' }, '0xabc');
    expect(ok).toBe(true);
    expect(isUniverseAdmin).not.toHaveBeenCalled();
  });

  it('allows a universe admin who is not the creator', async () => {
    isUniverseAdmin.mockResolvedValue(true);
    const ok = await canManageEntity({ creator: '0xabc', universeAddress: '0xu' }, '0xowner');
    expect(ok).toBe(true);
    expect(isUniverseAdmin).toHaveBeenCalledWith('0xu', '0xowner');
  });

  it('denies a stranger', async () => {
    isUniverseAdmin.mockResolvedValue(false);
    expect(await canManageEntity({ creator: '0xabc', universeAddress: '0xu' }, '0xstranger')).toBe(
      false
    );
  });

  it('denies non-creators on universe-less entities and signed-out callers', async () => {
    expect(await canManageEntity({ creator: '0xabc', universeAddress: null }, '0xother')).toBe(
      false
    );
    expect(await canManageEntity({ creator: '0xabc', universeAddress: '0xu' }, undefined)).toBe(
      false
    );
    expect(isUniverseAdmin).not.toHaveBeenCalled();
  });
});
