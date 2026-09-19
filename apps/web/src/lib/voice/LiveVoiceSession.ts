/**
 * One live, full-duplex voice conversation with the Pipecat pipeline.
 *
 *   mic ─▶ AudioWorklet ─▶ resample to 16 kHz PCM16 ─▶ WebSocket ─▶ pipeline
 *   speaker ◀─ PcmPlayer ◀─ WebSocket ◀─ pipeline (bot audio + RTVI events)
 *
 * Barge-in has two halves. The server detects the user speaking and cancels
 * its own LLM/TTS; this client's half is to silence audio that has already
 * arrived and is queued locally the instant `user-started-speaking` lands —
 * otherwise the bot keeps talking over the user for as long as the queue is
 * deep.
 */
import {
  clientReadyMessage,
  decodeFrame,
  encodeAudioFrame,
  encodeMessageFrame,
  parseRtvi,
  type RtviMessage,
} from './pipecatProtocol';
import { PcmPlayer } from './PcmPlayer';
import { MicChunker, int16ToBytes, rms } from './pcm';

export const MIC_SAMPLE_RATE = 16_000;
const MIC_CHUNK_MS = 20;
/** Drop mic chunks rather than let the socket buffer grow unbounded on a stalled link. */
const MAX_BUFFERED_BYTES = 512 * 1024;

export type SessionStatus = 'open' | 'closed' | 'failed';

export interface LiveVoiceCallbacks {
  onRtvi(message: RtviMessage): void;
  onStatus(status: SessionStatus, detail?: string): void;
  onMicLevel?(level: number): void;
}

/** Human-readable reason for a WebSocket close code from the pipeline. */
export function describeClose(code: number): string | undefined {
  switch (code) {
    case 1000:
    case 1001:
      return undefined;
    case 4003:
      return 'This voice session expired or was already used — start a new one.';
    case 1011:
      return 'The voice pipeline hit an error.';
    case 1006:
      return 'Lost the connection to the voice pipeline.';
    default:
      return `Voice connection closed (${code}).`;
  }
}

export class LiveVoiceSession {
  private ws: WebSocket | null = null;
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private capture: AudioWorkletNode | null = null;
  private player: PcmPlayer | null = null;
  private chunker: MicChunker | null = null;
  private stopped = false;
  /** Set by interrupt(); discards bot audio until the next bot turn or the user speaks. */
  private discardBotAudio = false;
  private lastLevelAt = 0;

  constructor(
    private readonly wsUrl: string,
    private readonly cb: LiveVoiceCallbacks
  ) {}

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        // Echo cancellation matters beyond quality: without it the bot's own
        // voice leaks into the mic and the server's VAD "hears" the user
        // interrupting, cutting the bot off mid-sentence.
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    });

    this.ctx = new AudioContext();
    await this.ctx.resume();
    await this.ctx.audioWorklet.addModule('/voice/pcm-capture-worklet.js');

    this.player = new PcmPlayer(this.ctx);
    this.chunker = new MicChunker(this.ctx.sampleRate, MIC_SAMPLE_RATE, MIC_CHUNK_MS);

    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.capture = new AudioWorkletNode(this.ctx, 'pcm-capture');
    this.capture.port.onmessage = (event: MessageEvent<Float32Array>) =>
      this.onMicBlock(event.data);
    this.source.connect(this.capture);
    // Some engines only run a worklet that reaches the destination; route it
    // through a muted gain so the mic is never played back to the speakers.
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    this.capture.connect(mute);
    mute.connect(this.ctx.destination);

    this.openSocket();
  }

  /** Mute/unmute the microphone without ending the session. */
  setMuted(muted: boolean): void {
    this.stream?.getAudioTracks().forEach((track) => (track.enabled = !muted));
  }

  /** Silence the bot right now; the session stays open for the user's next turn. */
  interrupt(): void {
    this.player?.flush();
    this.discardBotAudio = true;
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.player?.flush();
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) this.ws.close(1000, 'client stop');
    this.capture?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    void this.ctx?.close();
    this.ws =
      this.ctx =
      this.stream =
      this.source =
      this.capture =
      this.player =
      this.chunker =
        null;
  }

  // ── socket ──────────────────────────────────────────────────────────

  private openSocket(): void {
    const ws = new WebSocket(this.wsUrl);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    ws.onopen = () => {
      ws.send(encodeMessageFrame(JSON.stringify(clientReadyMessage(crypto.randomUUID()))));
      this.cb.onStatus('open');
    };
    ws.onmessage = (event) => this.onSocketMessage(event.data);
    ws.onerror = () => {
      if (!this.stopped) this.cb.onStatus('failed', 'Could not connect to the voice pipeline.');
    };
    ws.onclose = (event) => {
      if (this.stopped) return;
      this.cb.onStatus('closed', describeClose(event.code));
      this.stop();
    };
  }

  /** Exposed for tests; the socket handler is a thin wrapper around this. */
  onSocketMessage(data: unknown): void {
    if (!(data instanceof ArrayBuffer)) return;
    let frame;
    try {
      frame = decodeFrame(new Uint8Array(data));
    } catch {
      return; // one malformed frame must not take down the conversation
    }

    switch (frame.type) {
      case 'audio':
        if (!this.discardBotAudio) this.player?.enqueue(frame.audio, frame.sampleRate);
        break;
      case 'interruption':
        this.player?.flush();
        break;
      case 'message': {
        const message = parseRtvi(frame.data);
        if (!message) break;
        if (message.type === 'user-started-speaking') {
          // The user is talking over the bot: drop what's queued, and resume
          // accepting audio for whatever the bot says next.
          this.player?.flush();
          this.discardBotAudio = false;
        } else if (message.type === 'bot-started-speaking') {
          this.discardBotAudio = false;
        }
        this.cb.onRtvi(message);
        break;
      }
      default:
        break;
    }
  }

  // ── microphone ──────────────────────────────────────────────────────

  private onMicBlock(block: Float32Array): void {
    const now = performance.now();
    if (this.cb.onMicLevel && now - this.lastLevelAt > 80) {
      this.lastLevelAt = now;
      this.cb.onMicLevel(rms(block));
    }

    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN || !this.chunker) return;
    for (const chunk of this.chunker.push(block)) {
      if (ws.bufferedAmount > MAX_BUFFERED_BYTES) return;
      ws.send(
        encodeAudioFrame({
          audio: int16ToBytes(chunk),
          sampleRate: MIC_SAMPLE_RATE,
          numChannels: 1,
        })
      );
    }
  }
}
