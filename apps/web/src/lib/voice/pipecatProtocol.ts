/**
 * Wire protocol for LOAR's Pipecat voice pipeline (apps/voice-pipeline).
 *
 * Two layers, both small enough to own rather than pull in
 * `@pipecat-ai/websocket-transport` (which drags in Daily's WebRTC SDK and a
 * protobuf compiler as runtime dependencies):
 *
 *   1. Protobuf framing — Pipecat's `ProtobufFrameSerializer` wraps each
 *      WebSocket message in `Frame { oneof: text=1, audio=2, transcription=3,
 *      message=4, interruption=5 }` (pipecat/frames/frames.proto).
 *   2. RTVI — JSON events/requests carried inside `message` frames, labelled
 *      "rtvi-ai" (client-ready, bot-ready, user-transcription, function-call
 *      events, server-message, ...).
 *
 * Verified byte-for-byte against the real Python serializer in
 * apps/voice-pipeline/tests/test_wire_compat.py.
 */

export const RTVI_LABEL = 'rtvi-ai';
export const RTVI_PROTOCOL_VERSION = '2.1.0';

const WIRE_VARINT = 0;
const WIRE_FIXED64 = 1;
const WIRE_LEN = 2;
const WIRE_FIXED32 = 5;

// Field numbers of the top-level `Frame` oneof.
const FRAME_TEXT = 1;
const FRAME_AUDIO = 2;
const FRAME_TRANSCRIPTION = 3;
const FRAME_MESSAGE = 4;
const FRAME_INTERRUPTION = 5;

export interface AudioFrame {
  type: 'audio';
  /** Raw little-endian PCM16 bytes. */
  audio: Uint8Array;
  sampleRate: number;
  numChannels: number;
}
export interface MessageFrame {
  type: 'message';
  /** The JSON payload, still a string. */
  data: string;
}
export interface TextFrame {
  type: 'text';
  text: string;
}
export interface TranscriptionFrame {
  type: 'transcription';
  text: string;
  userId: string;
  timestamp: string;
}
export interface InterruptionFrame {
  type: 'interruption';
}
export type DecodedFrame =
  | AudioFrame
  | MessageFrame
  | TextFrame
  | TranscriptionFrame
  | InterruptionFrame
  | { type: 'unknown' };

// ── Encoding ────────────────────────────────────────────────────────────

class ByteWriter {
  private bytes: number[] = [];

  varint(value: number): void {
    let v = value;
    while (v >= 0x80) {
      this.bytes.push((v % 0x80) | 0x80);
      v = Math.floor(v / 0x80);
    }
    this.bytes.push(v);
  }

  tag(field: number, wire: number): void {
    this.varint(field * 8 + wire);
  }

  lengthDelimited(field: number, payload: Uint8Array): void {
    this.tag(field, WIRE_LEN);
    this.varint(payload.length);
    for (const b of payload) this.bytes.push(b);
  }

  varintField(field: number, value: number): void {
    // proto3 omits default (zero) values on the wire.
    if (value === 0) return;
    this.tag(field, WIRE_VARINT);
    this.varint(value);
  }

  finish(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

const utf8 = new TextEncoder();
const utf8Decoder = new TextDecoder();

/** Microphone audio → server. `Frame.audio(2){ audio=3, sample_rate=4, num_channels=5 }`. */
export function encodeAudioFrame(frame: {
  audio: Uint8Array;
  sampleRate: number;
  numChannels: number;
}): Uint8Array {
  const inner = new ByteWriter();
  if (frame.audio.length > 0) inner.lengthDelimited(3, frame.audio);
  inner.varintField(4, frame.sampleRate);
  inner.varintField(5, frame.numChannels);

  const outer = new ByteWriter();
  outer.lengthDelimited(FRAME_AUDIO, inner.finish());
  return outer.finish();
}

/** An RTVI message (already-serialised JSON) → server. `Frame.message(4){ data=1 }`. */
export function encodeMessageFrame(json: string): Uint8Array {
  const inner = new ByteWriter();
  if (json.length > 0) inner.lengthDelimited(1, utf8.encode(json));

  const outer = new ByteWriter();
  outer.lengthDelimited(FRAME_MESSAGE, inner.finish());
  return outer.finish();
}

// ── Decoding ────────────────────────────────────────────────────────────

class ByteReader {
  pos = 0;
  constructor(private readonly buf: Uint8Array) {}

  get done(): boolean {
    return this.pos >= this.buf.length;
  }

  /**
   * Varints are read with multiplication, not bit shifts, because JS bitwise
   * operators truncate to 32 bits. 64-bit ids lose low-order precision, which
   * is fine: nothing here uses them.
   */
  varint(): number {
    let result = 0;
    let scale = 1;
    for (let i = 0; i < 10; i++) {
      if (this.pos >= this.buf.length) throw new Error('truncated varint');
      const byte = this.buf[this.pos++];
      result += (byte & 0x7f) * scale;
      if ((byte & 0x80) === 0) return result;
      scale *= 0x80;
    }
    throw new Error('varint too long');
  }

  bytes(): Uint8Array {
    const len = this.varint();
    if (this.pos + len > this.buf.length) throw new Error('truncated field');
    const out = this.buf.subarray(this.pos, this.pos + len);
    this.pos += len;
    return out;
  }

  skip(wire: number): void {
    if (wire === WIRE_VARINT) this.varint();
    else if (wire === WIRE_LEN) this.bytes();
    else if (wire === WIRE_FIXED64) this.pos += 8;
    else if (wire === WIRE_FIXED32) this.pos += 4;
    else throw new Error(`unsupported wire type ${wire}`);
  }
}

/** Walk the fields of one message, handing each to `visit`; unknown fields are skipped. */
function forEachField(
  buf: Uint8Array,
  visit: (field: number, wire: number, reader: ByteReader) => boolean
): void {
  const reader = new ByteReader(buf);
  while (!reader.done) {
    const key = reader.varint();
    const field = Math.floor(key / 8);
    const wire = key % 8;
    if (!visit(field, wire, reader)) reader.skip(wire);
  }
}

function decodeAudio(inner: Uint8Array): AudioFrame {
  const frame: AudioFrame = {
    type: 'audio',
    audio: new Uint8Array(0),
    sampleRate: 0,
    numChannels: 0,
  };
  forEachField(inner, (field, wire, r) => {
    if (field === 3 && wire === WIRE_LEN) frame.audio = r.bytes();
    else if (field === 4 && wire === WIRE_VARINT) frame.sampleRate = r.varint();
    else if (field === 5 && wire === WIRE_VARINT) frame.numChannels = r.varint();
    else return false;
    return true;
  });
  return frame;
}

function decodeStringField(inner: Uint8Array, wanted: number): string {
  let value = '';
  forEachField(inner, (field, wire, r) => {
    if (field === wanted && wire === WIRE_LEN) value = utf8Decoder.decode(r.bytes());
    else return false;
    return true;
  });
  return value;
}

/**
 * Decode one WebSocket message. Returns `{type:'unknown'}` for frame kinds
 * this client doesn't use and throws only on malformed bytes.
 */
export function decodeFrame(data: Uint8Array): DecodedFrame {
  let result: DecodedFrame = { type: 'unknown' };
  forEachField(data, (field, wire, r) => {
    if (wire !== WIRE_LEN) return false;
    const inner = r.bytes();
    switch (field) {
      case FRAME_AUDIO:
        result = decodeAudio(inner);
        break;
      case FRAME_MESSAGE:
        result = { type: 'message', data: decodeStringField(inner, 1) };
        break;
      case FRAME_TEXT:
        result = { type: 'text', text: decodeStringField(inner, 3) };
        break;
      case FRAME_TRANSCRIPTION:
        result = {
          type: 'transcription',
          text: decodeStringField(inner, 3),
          userId: decodeStringField(inner, 4),
          timestamp: decodeStringField(inner, 5),
        };
        break;
      case FRAME_INTERRUPTION:
        result = { type: 'interruption' };
        break;
      default:
        break;
    }
    return true;
  });
  return result;
}

// ── RTVI envelope ───────────────────────────────────────────────────────

export interface RtviMessage {
  label: typeof RTVI_LABEL;
  type: string;
  id?: string;
  data?: any;
}

/** Parse a `message` frame's JSON; null unless it's a well-formed RTVI message. */
export function parseRtvi(json: string): RtviMessage | null {
  try {
    const parsed = JSON.parse(json);
    if (parsed && parsed.label === RTVI_LABEL && typeof parsed.type === 'string') return parsed;
  } catch {
    // fall through
  }
  return null;
}

export function clientReadyMessage(id: string): RtviMessage {
  return {
    label: RTVI_LABEL,
    type: 'client-ready',
    id,
    data: {
      version: RTVI_PROTOCOL_VERSION,
      about: { library: 'loar-web-voice', library_version: '1.0.0', platform: 'web' },
    },
  };
}
