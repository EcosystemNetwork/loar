import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAutosave } from '../useAutosave';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const flush = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

describe('useAutosave', () => {
  it('saves once after the debounce, not before', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useAutosave({ dirty: true, signature: 'a', enabled: true, save, delayMs: 1000 })
    );
    await flush(999);
    expect(save).not.toHaveBeenCalled();
    await flush(2);
    expect(save).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('saved');
    expect(result.current.lastSavedAt).not.toBeNull();
  });

  it('restarts the debounce on every edit', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(
      ({ sig }) => useAutosave({ dirty: true, signature: sig, enabled: true, save, delayMs: 1000 }),
      { initialProps: { sig: 'a' } }
    );
    await flush(800);
    rerender({ sig: 'b' });
    await flush(800);
    expect(save).not.toHaveBeenCalled();
    await flush(300);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('does nothing while clean, disabled, or read-only', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useAutosave({ dirty: false, signature: 'a', enabled: true, save }));
    renderHook(() => useAutosave({ dirty: true, signature: 'a', enabled: false, save }));
    await flush(10_000);
    expect(save).not.toHaveBeenCalled();
  });

  it('does not retry the same failing content in a loop, but retries after an edit', async () => {
    const save = vi.fn().mockRejectedValue(new Error('offline'));
    const { result, rerender } = renderHook(
      ({ sig }) => useAutosave({ dirty: true, signature: sig, enabled: true, save, delayMs: 500 }),
      { initialProps: { sig: 'a' } }
    );
    await flush(600);
    expect(save).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('error');
    await flush(5_000);
    expect(save).toHaveBeenCalledTimes(1);
    rerender({ sig: 'b' });
    await flush(600);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('saveNow works on demand and reports success', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useAutosave({ dirty: true, signature: 'a', enabled: false, save })
    );
    let ok = false;
    await act(async () => {
      ok = await result.current.saveNow();
    });
    expect(ok).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('queues a manual save behind one in flight so the newest state lands last', async () => {
    const order: string[] = [];
    let release: () => void = () => {};
    const save = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((res) => {
            release = () => {
              order.push('first-done');
              res();
            };
          })
      )
      .mockImplementationOnce(async () => {
        order.push('second');
      });
    const { result } = renderHook(() =>
      useAutosave({ dirty: false, signature: 'a', enabled: false, save })
    );
    let p1: Promise<boolean>;
    let p2: Promise<boolean>;
    await act(async () => {
      p1 = result.current.saveNow();
      p2 = result.current.saveNow();
    });
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => {
      release();
      await p1;
      await p2;
    });
    expect(order).toEqual(['first-done', 'second']);
  });
});
