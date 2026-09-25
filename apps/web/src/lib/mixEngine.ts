/**
 * MixEngine — live preview of the multi-track mix, using Web Audio.
 *
 * It schedules every audible audio clip against the audio clock the moment
 * playback starts (start time, in-point, length, loop, fades, level) and sums
 * them through one master gain and a limiter — the same summing the server
 * does at export (`services/ffmpeg/audio-mix.ts`), driven by the same gain
 * rules from `lib/audioMix.ts`.
 *
 * The AudioContext is injected, so tests can pass a fake one to assert exactly
 * what gets scheduled, and a real `OfflineAudioContext` to render the mix
 * without a sound card.
 *
 * The video track's own audio is NOT routed through here (a cross-origin
 * <video> can't be tapped without CORS); the caller sets that element's volume
 * from `videoAudioGain(mix)` instead.
 */
import {
  clipEnd,
  effectiveClipGain,
  gainKeyframes,
  type AudioClip,
  type AudioMix,
} from './audioMix';

/** Sync lookup of an already-decoded buffer; undefined = not loaded (that clip stays silent). */
export type BufferLookup = (url: string) => AudioBuffer | undefined;

/** Lead time between "now" and the first scheduled sample, so nothing starts in the past. */
export const SCHEDULE_LEAD_SEC = 0.06;

interface Live {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

export class MixEngine {
  private readonly master: GainNode;
  private readonly limiter: DynamicsCompressorNode;
  private live: Live[] = [];
  private startedAt = 0;
  private fromTime = 0;
  private playing = false;

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly getBuffer: BufferLookup,
    destination: AudioNode = ctx.destination
  ) {
    this.master = ctx.createGain();
    // Brick-wall-ish limiter (the export uses alimiter): keeps summed tracks from clipping.
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -1;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.05;
    this.master.connect(this.limiter);
    this.limiter.connect(destination);
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /**
   * Timeline time the engine believes it is at, from the audio clock — the
   * caller compares it to the video's clock to spot drift. Null when stopped.
   */
  position(): number | null {
    if (!this.playing) return null;
    return this.fromTime + Math.max(0, this.ctx.currentTime - this.startedAt);
  }

  /** Schedule everything that sounds at or after `fromTime` (timeline seconds) and start. */
  play(mix: AudioMix, fromTime: number): void {
    this.stop();
    this.playing = true;
    this.fromTime = fromTime;
    this.startedAt = this.ctx.currentTime + SCHEDULE_LEAD_SEC;
    this.master.gain.value = mix.mixer.master;

    for (const track of mix.tracks) {
      for (const clip of track.clips) {
        const gain = effectiveClipGain(mix, track, clip);
        if (gain <= 0 || clipEnd(clip) <= fromTime) continue;
        const buffer = this.getBuffer(clip.url);
        if (buffer) this.schedule(clip, buffer, gain, fromTime);
      }
    }
  }

  stop(): void {
    for (const { source, gain } of this.live) {
      try {
        source.stop();
      } catch {
        // already ended / never started
      }
      source.disconnect();
      gain.disconnect();
    }
    this.live = [];
    this.playing = false;
  }

  dispose(): void {
    this.stop();
    this.master.disconnect();
    this.limiter.disconnect();
  }

  private schedule(clip: AudioClip, buffer: AudioBuffer, gain: number, fromTime: number): void {
    const localFrom = Math.max(0, fromTime - clip.start);
    // When (audio clock) this clip's first audible sample should play.
    const when = this.startedAt + Math.max(0, clip.start - fromTime);
    const remaining = clip.length - localFrom;
    // A looped clip resumes at the right point inside the loop; a normal one at its in-point + offset.
    const offset = clip.loop ? localFrom % buffer.duration : clip.trimStart + localFrom;
    if (remaining <= 0 || offset >= buffer.duration) return;

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    if (clip.loop) {
      source.loop = true;
      source.loopStart = 0;
      source.loopEnd = buffer.duration;
    }
    const node = this.ctx.createGain();

    const frames = gainKeyframes(clip, gain, localFrom);
    node.gain.setValueAtTime(frames[0]?.value ?? gain, when);
    for (const f of frames.slice(1)) node.gain.linearRampToValueAtTime(f.value, when + f.at);

    source.connect(node);
    node.connect(this.master);
    // Non-looping audio may be shorter than `remaining`; it simply ends early.
    source.start(when, offset, remaining);
    this.live.push({ source, gain: node });
  }
}
