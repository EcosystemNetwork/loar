import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROVIDER_REGISTRY } from './registry';
import { KeyVerificationUnavailableError } from './types';

function stubFetch(status: number) {
  const fn = vi.fn().mockResolvedValue({ status } as Response);
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe('provider key verification', () => {
  it('rejects a key the provider answers 401/403 to', async () => {
    stubFetch(401);
    expect(await PROVIDER_REGISTRY.openai.testKey('sk-bad')).toBe(false);
    stubFetch(403);
    expect(await PROVIDER_REGISTRY.meshy.testKey('bad')).toBe(false);
  });

  it('treats a rate-limited (429) key as valid — auth passed', async () => {
    stubFetch(429);
    expect(await PROVIDER_REGISTRY.openai.testKey('sk-good')).toBe(true);
  });

  it('treats the fal made-up-request 404 as valid', async () => {
    stubFetch(404);
    expect(await PROVIDER_REGISTRY.fal.testKey('id:secret')).toBe(true);
  });

  it('treats Google 400 (API_KEY_INVALID) as rejected', async () => {
    stubFetch(400);
    expect(await PROVIDER_REGISTRY.google.testKey('AIzaBad')).toBe(false);
  });

  it('does NOT accept a key when the provider is down (5xx)', async () => {
    stubFetch(503);
    await expect(PROVIDER_REGISTRY.zai.testKey('k'.repeat(12))).rejects.toBeInstanceOf(
      KeyVerificationUnavailableError
    );
  });

  it('reports a network failure/timeout as unavailable, not as a rejected key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));
    await expect(PROVIDER_REGISTRY.bytedance.testKey('k'.repeat(12))).rejects.toBeInstanceOf(
      KeyVerificationUnavailableError
    );
  });

  it('sends the key in headers, never the URL', async () => {
    const fn = stubFetch(200);
    await PROVIDER_REGISTRY.google.testKey('AIzaSecret');
    const [url, init] = fn.mock.calls[0];
    expect(String(url)).not.toContain('AIzaSecret');
    expect((init as RequestInit).headers).toMatchObject({ 'x-goog-api-key': 'AIzaSecret' });
  });
});

describe('missing-key errors reach the client as a BYOK gate', () => {
  it('wrapError keeps the actionable message and the cause the formatter keys off', async () => {
    const { wrapError } = await import('../../lib/errors');
    const { NoKeyAvailableError } = await import('./types');
    const wrapped = wrapError(new NoKeyAvailableError('fal'));
    expect(wrapped.code).toBe('FORBIDDEN');
    expect(wrapped.message).toMatch(/\/settings\/api-keys/);
    expect(wrapped.cause).toBeInstanceOf(NoKeyAvailableError);
  });

  it('errorFormatter flags byokRequired even when a route re-wraps the error', async () => {
    const { t } = await import('../../lib/trpc');
    const { NoKeyAvailableError } = await import('./types');
    const { TRPCError, getErrorShape } = await import('@trpc/server/unstable-core-do-not-import');
    const wrapped = new TRPCError({
      code: 'BAD_REQUEST',
      message: 'x',
      cause: new TRPCError({
        code: 'BAD_REQUEST',
        message: 'y',
        cause: new NoKeyAvailableError('google'),
      }),
    });
    const shape = getErrorShape({
      config: t._config,
      error: wrapped,
      type: 'mutation',
      path: 'boom',
      input: undefined,
      ctx: { user: null, clientIp: '127.0.0.1' },
    });
    expect(shape.data).toMatchObject({ byokRequired: true, provider: 'google' });
  });
});
