/**
 * Unit tests for lib/videoLoadQueue.ts — serialises <video> loads so a
 * gallery grid fills evenly instead of every tile fighting for bandwidth.
 */
import { describe, expect, it, vi } from 'vitest';
import { VideoLoadQueue } from '../videoLoadQueue';

describe('VideoLoadQueue', () => {
  it('resolves immediately while under the concurrency limit', async () => {
    const q = new VideoLoadQueue(2);
    await expect(Promise.all([q.enqueue('a'), q.enqueue('b')])).resolves.toEqual([
      undefined,
      undefined,
    ]);
  });

  it('holds the (N+1)th request until a slot is freed with done()', async () => {
    const q = new VideoLoadQueue(1);
    await q.enqueue('a'); // takes the only slot

    const thirdStarted = vi.fn();
    const pending = q.enqueue('b').then(thirdStarted);

    await Promise.resolve();
    expect(thirdStarted).not.toHaveBeenCalled();

    q.done('a');
    await pending;
    expect(thirdStarted).toHaveBeenCalledOnce();
  });

  it('lets exactly `concurrency` requests through, then gates the rest', async () => {
    const q = new VideoLoadQueue(3);
    const order: string[] = [];
    const ids = ['a', 'b', 'c', 'd', 'e'];
    ids.forEach((id) => void q.enqueue(id).then(() => order.push(id)));

    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(['a', 'b', 'c']); // d, e still waiting

    q.done('a');
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(['a', 'b', 'c', 'd']);

    q.done('b');
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('cancel() removes a still-queued entry so it never starts', async () => {
    const q = new VideoLoadQueue(1);
    await q.enqueue('a');

    const bStarted = vi.fn();
    void q.enqueue('b').then(bStarted);
    q.cancel('b');

    q.done('a');
    await Promise.resolve();
    await Promise.resolve();
    expect(bStarted).not.toHaveBeenCalled();
  });

  it('cancel() on an id that is not queued is a no-op', () => {
    const q = new VideoLoadQueue(2);
    expect(() => q.cancel('nope')).not.toThrow();
  });

  it('done() frees a slot even for an id it was not tracking (defensive)', async () => {
    const q = new VideoLoadQueue(1);
    await q.enqueue('a');
    const nextStarted = vi.fn();
    void q.enqueue('b').then(nextStarted);

    q.done('whatever'); // active-- regardless of id
    await Promise.resolve();
    expect(nextStarted).toHaveBeenCalledOnce();
  });
});
