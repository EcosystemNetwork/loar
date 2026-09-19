import { bytesToInt16, int16ToFloat } from './pcm';

/** The slice of the Web Audio API the player needs — narrow so tests can fake it. */
export interface BufferSourceLike {
  buffer: unknown;
  // DOM types this as an EventHandler with a `this` parameter; stay assignable from it.
  onended: ((this: any, ev: any) => any) | null;
  connect(destination: unknown): unknown;
  start(when?: number): void;
  stop(): void;
}
export interface AudioContextLike {
  readonly currentTime: number;
  readonly destination: unknown;
  createBuffer(
    channels: number,
    length: number,
    sampleRate: number
  ): { duration: number; copyToChannel(data: Float32Array, channel: number): void };
  createBufferSource(): BufferSourceLike;
}

/**
 * Plays the bot's streamed PCM gaplessly by scheduling each chunk to start
 * exactly when the previous one ends, and can drop everything queued at once —
 * which is what barge-in needs: the moment the user speaks over the bot, audio
 * already scheduled must stop, not finish playing.
 */
export class PcmPlayer {
  private nextStart = 0;
  private sources = new Set<BufferSourceLike>();

  /** `leadSeconds` is the cushion before the first chunk so scheduling never lands in the past. */
  constructor(
    private readonly ctx: AudioContextLike,
    private readonly leadSeconds = 0.05
  ) {}

  enqueue(pcm16le: Uint8Array, sampleRate: number): void {
    const samples = int16ToFloat(bytesToInt16(pcm16le));
    if (samples.length === 0) return;

    const buffer = this.ctx.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(samples, 0);

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.ctx.destination);

    const startAt = Math.max(this.ctx.currentTime + this.leadSeconds, this.nextStart);
    source.start(startAt);
    this.nextStart = startAt + buffer.duration;

    this.sources.add(source);
    source.onended = () => this.sources.delete(source);
  }

  /** Stop everything queued or playing, immediately. */
  flush(): void {
    for (const source of this.sources) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // already ended
      }
    }
    this.sources.clear();
    this.nextStart = 0;
  }

  /** Seconds of audio still scheduled ahead of the playhead. */
  get queuedSeconds(): number {
    return Math.max(0, this.nextStart - this.ctx.currentTime);
  }
}
