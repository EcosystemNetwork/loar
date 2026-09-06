/**
 * Unit tests for lib/apiKeyGate.ts — the imperative "add your BYOK key"
 * modal trigger (sonner-style singleton listener). requireProviderKey()
 * resolves true once a key is saved, false on dismiss or when no modal is
 * mounted.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type ApiKeyGateRequest,
  registerApiKeyGateListener,
  requireProviderKey,
} from '../apiKeyGate';

afterEach(() => {
  // Leave no listener registered between tests (module state is global).
  registerApiKeyGateListener(() => {})();
});

describe('requireProviderKey — no modal mounted', () => {
  it('resolves false immediately when no listener is registered', async () => {
    await expect(requireProviderKey('openai')).resolves.toBe(false);
  });
});

describe('requireProviderKey — with a listener', () => {
  it('forwards provider + reason to the listener and resolves with its verdict', async () => {
    const seen: ApiKeyGateRequest[] = [];
    const unsub = registerApiKeyGateListener((req) => seen.push(req));

    const p = requireProviderKey('meshy', { reason: 'This model needs a Meshy key' });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ provider: 'meshy', reason: 'This model needs a Meshy key' });

    seen[0].resolve(true); // user saved a key
    await expect(p).resolves.toBe(true);
    unsub();
  });

  it('resolves false when the user dismisses (resolve(false))', async () => {
    const unsub = registerApiKeyGateListener((req) => req.resolve(false));
    await expect(requireProviderKey('google')).resolves.toBe(false);
    unsub();
  });

  it('omits reason when none is given', () => {
    const fn = vi.fn();
    const unsub = registerApiKeyGateListener(fn);
    void requireProviderKey('fal');
    expect(fn).toHaveBeenCalledWith(expect.objectContaining({ provider: 'fal' }));
    expect(fn.mock.calls[0][0].reason).toBeUndefined();
    unsub();
  });
});

describe('registerApiKeyGateListener — lifecycle', () => {
  it('unsubscribe removes the listener (back to resolving false)', async () => {
    const fn = vi.fn();
    const unsub = registerApiKeyGateListener(fn);
    unsub();
    await expect(requireProviderKey('zai')).resolves.toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });

  it('a later register replaces the earlier listener; the stale unsub is a no-op', async () => {
    const first = vi.fn();
    const second = vi.fn((req: ApiKeyGateRequest) => req.resolve(true));
    const unsubFirst = registerApiKeyGateListener(first);
    const unsubSecond = registerApiKeyGateListener(second);

    unsubFirst(); // must NOT clear `second`

    await expect(requireProviderKey('groq')).resolves.toBe(true);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
    unsubSecond();
  });
});
