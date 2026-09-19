import { describe, it, expect } from 'vitest';
import { PcmPlayer, type AudioContextLike, type BufferSourceLike } from '../PcmPlayer';
import { int16ToBytes } from '../pcm';

class FakeSource implements BufferSourceLike {
  buffer: unknown = null;
  onended: (() => void) | null = null;
  startedAt: number | null = null;
  stopped = false;
  connect() {
    return undefined;
  }
  start(when?: number) {
    this.startedAt = when ?? 0;
  }
  stop() {
    this.stopped = true;
  }
}

class FakeContext implements AudioContextLike {
  currentTime = 0;
  destination = {};
  sources: FakeSource[] = [];
  createBuffer(_channels: number, length: number, sampleRate: number) {
    return { duration: length / sampleRate, copyToChannel() {} };
  }
  createBufferSource() {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
}

// 20 ms of 24 kHz mono PCM16.
const chunk = () => int16ToBytes(new Int16Array(480).fill(1000));

describe('PcmPlayer', () => {
  it('schedules chunks back-to-back so playback is gapless', () => {
    const ctx = new FakeContext();
    const player = new PcmPlayer(ctx, 0.05);
    player.enqueue(chunk(), 24000);
    player.enqueue(chunk(), 24000);
    player.enqueue(chunk(), 24000);

    const starts = ctx.sources.map((s) => s.startedAt!);
    expect(starts[0]).toBeCloseTo(0.05);
    expect(starts[1]).toBeCloseTo(0.07);
    expect(starts[2]).toBeCloseTo(0.09);
    expect(player.queuedSeconds).toBeCloseTo(0.11);
  });

  it('re-anchors to the playhead after an underrun instead of scheduling in the past', () => {
    const ctx = new FakeContext();
    const player = new PcmPlayer(ctx, 0.05);
    player.enqueue(chunk(), 24000);
    ctx.currentTime = 5; // long gap: the earlier audio finished ages ago
    player.enqueue(chunk(), 24000);
    expect(ctx.sources[1].startedAt).toBeCloseTo(5.05);
  });

  it('flush() stops everything queued at once and starts fresh afterwards (barge-in)', () => {
    const ctx = new FakeContext();
    const player = new PcmPlayer(ctx, 0.05);
    for (let i = 0; i < 5; i++) player.enqueue(chunk(), 24000);

    player.flush();

    expect(ctx.sources.every((s) => s.stopped)).toBe(true);
    expect(ctx.sources.every((s) => s.onended === null)).toBe(true);
    expect(player.queuedSeconds).toBe(0);

    ctx.currentTime = 1;
    player.enqueue(chunk(), 24000);
    expect(ctx.sources[5].startedAt).toBeCloseTo(1.05);
  });

  it('forgets a source once it has finished playing', () => {
    const ctx = new FakeContext();
    const player = new PcmPlayer(ctx);
    player.enqueue(chunk(), 24000);
    ctx.sources[0].onended?.();
    player.flush();
    expect(ctx.sources[0].stopped).toBe(false); // already ended, nothing to stop
  });

  it('ignores empty payloads and tolerates a dangling odd byte', () => {
    const ctx = new FakeContext();
    const player = new PcmPlayer(ctx);
    player.enqueue(new Uint8Array(0), 24000);
    player.enqueue(Uint8Array.from([1]), 24000);
    expect(ctx.sources).toHaveLength(0);
  });
});
