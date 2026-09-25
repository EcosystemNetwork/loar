import { describe, expect, it, vi } from 'vitest';
import {
  GenerationCancelledError,
  resolveVideoResult,
  type JobStatusResult,
} from '../generation-job';

const queued = { status: 'queued', generationId: 'g1' };
const noSleep = async () => {};

/** Feeds a fixed sequence of poll results (an Error entry rejects that poll). */
function script(seq: Array<JobStatusResult | Error>) {
  let i = 0;
  return vi.fn(async () => {
    const next = seq[Math.min(i++, seq.length - 1)];
    if (next instanceof Error) throw next;
    return next;
  });
}

describe('resolveVideoResult', () => {
  it('returns an inline videoUrl without polling', async () => {
    const fetchStatus = vi.fn();
    const url = await resolveVideoResult({ videoUrl: 'https://v/1.mp4' }, { fetchStatus });
    expect(url).toBe('https://v/1.mp4');
    expect(fetchStatus).not.toHaveBeenCalled();
  });

  it('polls a queued job to completion and reports the id once', async () => {
    const onQueued = vi.fn();
    const fetchStatus = script([
      { status: 'queued' },
      { status: 'running' },
      { status: 'completed', resultUrl: 'https://v/2.mp4' },
    ]);
    const url = await resolveVideoResult(queued, { onQueued, fetchStatus, sleep: noSleep });
    expect(url).toBe('https://v/2.mp4');
    expect(onQueued).toHaveBeenCalledOnce();
    expect(onQueued).toHaveBeenCalledWith('g1');
    expect(fetchStatus).toHaveBeenCalledTimes(3);
  });

  it('surfaces the failure reason', async () => {
    const fetchStatus = script([{ status: 'failed', message: 'provider exploded' }]);
    await expect(resolveVideoResult(queued, { fetchStatus, sleep: noSleep })).rejects.toThrow(
      'provider exploded'
    );
  });

  it('rejects with GenerationCancelledError when the job was cancelled', async () => {
    const fetchStatus = script([{ status: 'running' }, { status: 'cancelled' }]);
    await expect(
      resolveVideoResult(queued, { fetchStatus, sleep: noSleep })
    ).rejects.toBeInstanceOf(GenerationCancelledError);
  });

  it('treats a completed job with no url as an error', async () => {
    const fetchStatus = script([{ status: 'completed', resultUrl: null }]);
    await expect(resolveVideoResult(queued, { fetchStatus, sleep: noSleep })).rejects.toThrow(
      'No video returned'
    );
  });

  it('rejects responses that are neither a video nor a queued job', async () => {
    await expect(resolveVideoResult(null)).rejects.toThrow('No video returned');
    await expect(resolveVideoResult({ status: 'queued' })).rejects.toThrow('No video returned');
    await expect(resolveVideoResult({ status: 'completed' })).rejects.toThrow('No video returned');
  });

  it('rides out a few flaky polls but gives up after too many in a row', async () => {
    const ok = script([
      new Error('net'),
      new Error('net'),
      { status: 'completed', resultUrl: 'https://v/3.mp4' },
    ]);
    expect(await resolveVideoResult(queued, { fetchStatus: ok, sleep: noSleep })).toBe(
      'https://v/3.mp4'
    );

    const dead = script([new Error('down')]);
    await expect(
      resolveVideoResult(queued, { fetchStatus: dead, sleep: noSleep, maxStatusErrors: 3 })
    ).rejects.toThrow('down');
    expect(dead).toHaveBeenCalledTimes(3);
  });

  it('times out a job that never finishes', async () => {
    let t = 0;
    const fetchStatus = script([{ status: 'running' }]);
    await expect(
      resolveVideoResult(queued, {
        fetchStatus,
        sleep: async (ms) => void (t += ms),
        now: () => t,
        timeoutMs: 10_000,
      })
    ).rejects.toThrow('timed out');
  });

  it('backs off between polls up to the cap', async () => {
    const sleeps: number[] = [];
    const fetchStatus = script([
      ...Array.from({ length: 6 }, () => ({ status: 'running' as const })),
      { status: 'completed', resultUrl: 'u' },
    ]);
    await resolveVideoResult(queued, {
      fetchStatus,
      sleep: async (ms) => void sleeps.push(ms),
      pollMs: 2_000,
      maxPollMs: 6_000,
    });
    expect(sleeps).toEqual([2_000, 3_000, 4_500, 6_000, 6_000, 6_000]);
  });

  it('stops quietly when aborted', async () => {
    const ctl = new AbortController();
    const fetchStatus = script([{ status: 'running' }]);
    const p = resolveVideoResult(queued, {
      fetchStatus,
      signal: ctl.signal,
      sleep: async () => ctl.abort(),
    });
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    // no extra poll after the abort was observed
    expect(fetchStatus).toHaveBeenCalledTimes(1);
  });
});
