/**
 * The hex vectors below were emitted by the real Pipecat ProtobufFrameSerializer
 * (pipecat-ai 1.11.0), so these tests pin the client to what the server actually
 * sends. The encode side is pinned against hand-derived bytes and, in the other
 * direction, apps/voice-pipeline/tests/test_wire_compat.py feeds the same bytes
 * to the real Python deserializer.
 */
import { describe, it, expect } from 'vitest';
import {
  decodeFrame,
  encodeAudioFrame,
  encodeMessageFrame,
  parseRtvi,
  clientReadyMessage,
  RTVI_LABEL,
} from '../pipecatProtocol';

const fromHex = (hex: string) => Uint8Array.from(hex.match(/../g)!.map((b) => parseInt(b, 16)));
const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

// Emitted by the Python serializer (ids/names included, exactly as on the wire).
const SERVER_AUDIO =
  '122e0894b4e4f4cb0312154f7574707574417564696f5261774672616d6523301a0801000200ff7f008020c0bb012801';
const SERVER_MESSAGE =
  '227b0a797b226c6162656c223a2022727476692d6169222c202274797065223a2022626f742d7265616479222c20226964223a2022616263222c202264617461223a207b2276657273696f6e223a2022322e312e30222c202261626f7574223a207b2278223a2022685c75303065396c6c6f205c7532373133227d7d7d';
const SERVER_TEXT = '0a190803120b546578744672616d6523301a086869207468657265';
const SERVER_TRANSCRIPTION =
  '1a39080412145472616e736372697074696f6e4672616d6523301a0568656c6c6f220275312a14323032362d30312d30315430303a30303a30305a';

describe('decodeFrame (server → client)', () => {
  it('decodes an audio frame, skipping the 64-bit id and the name', () => {
    const frame = decodeFrame(fromHex(SERVER_AUDIO));
    expect(frame).toEqual({
      type: 'audio',
      audio: Uint8Array.from([1, 0, 2, 0, 255, 127, 0, 128]),
      sampleRate: 24000,
      numChannels: 1,
    });
  });

  it('decodes an RTVI message frame, including \\u-escaped unicode', () => {
    const frame = decodeFrame(fromHex(SERVER_MESSAGE));
    expect(frame.type).toBe('message');
    const rtvi = parseRtvi((frame as { data: string }).data);
    expect(rtvi).toMatchObject({ label: RTVI_LABEL, type: 'bot-ready', id: 'abc' });
    expect(rtvi?.data.about.x).toBe('héllo ✓');
  });

  it('decodes text and transcription frames', () => {
    expect(decodeFrame(fromHex(SERVER_TEXT))).toEqual({ type: 'text', text: 'hi there' });
    expect(decodeFrame(fromHex(SERVER_TRANSCRIPTION))).toEqual({
      type: 'transcription',
      text: 'hello',
      userId: 'u1',
      timestamp: '2026-01-01T00:00:00Z',
    });
  });

  it('recognises interruption frames and ignores frame kinds it does not use', () => {
    expect(decodeFrame(fromHex('2a00'))).toEqual({ type: 'interruption' }); // field 5, empty
    expect(decodeFrame(fromHex('3200'))).toEqual({ type: 'unknown' }); // field 6, unknown
  });

  it('skips unknown fields around a known one', () => {
    // unknown varint field 15 (=7) then a real audio frame
    const bytes = Uint8Array.from([0x78, 0x07, ...fromHex('120b1a040100020020807d2801')]);
    expect(decodeFrame(bytes)).toMatchObject({ type: 'audio', sampleRate: 16000 });
  });

  it('throws on truncated input instead of returning garbage', () => {
    expect(() => decodeFrame(fromHex('122e0894'))).toThrow();
    expect(() => decodeFrame(fromHex('12'))).toThrow();
  });
});

describe('encode (client → server)', () => {
  it('encodes an audio frame as Frame.audio{audio,sample_rate,num_channels}', () => {
    const bytes = encodeAudioFrame({
      audio: Uint8Array.from([1, 0, 2, 0]),
      sampleRate: 16000,
      numChannels: 1,
    });
    expect(toHex(bytes)).toBe('120b1a040100020020807d2801');
  });

  it('encodes an RTVI JSON message as Frame.message{data}', () => {
    expect(toHex(encodeMessageFrame('{"a":1}'))).toBe('22090a077b2261223a317d');
  });

  it('round-trips through decodeFrame', () => {
    const audio = Uint8Array.from({ length: 640 }, (_, i) => i % 251);
    const decoded = decodeFrame(encodeAudioFrame({ audio, sampleRate: 16000, numChannels: 1 }));
    expect(decoded).toMatchObject({ type: 'audio', sampleRate: 16000, numChannels: 1 });
    expect((decoded as { audio: Uint8Array }).audio).toEqual(audio);

    const json = JSON.stringify(clientReadyMessage('id-1'));
    expect(decodeFrame(encodeMessageFrame(json))).toEqual({ type: 'message', data: json });
  });

  it('handles payloads that need multi-byte length varints', () => {
    const big = new Uint8Array(70_000).fill(7);
    const decoded = decodeFrame(
      encodeAudioFrame({ audio: big, sampleRate: 48000, numChannels: 2 })
    );
    expect((decoded as { audio: Uint8Array }).audio.length).toBe(70_000);
  });
});

describe('parseRtvi', () => {
  it('accepts only well-formed RTVI envelopes', () => {
    expect(parseRtvi('{"label":"rtvi-ai","type":"x"}')).toMatchObject({ type: 'x' });
    expect(parseRtvi('{"label":"other","type":"x"}')).toBeNull();
    expect(parseRtvi('{"label":"rtvi-ai"}')).toBeNull();
    expect(parseRtvi('not json')).toBeNull();
    expect(parseRtvi('null')).toBeNull();
  });

  it('client-ready announces the protocol version the server adapts its events to', () => {
    const msg = clientReadyMessage('abc');
    expect(msg).toMatchObject({ label: 'rtvi-ai', type: 'client-ready', id: 'abc' });
    expect(msg.data.version).toBe('2.1.0');
    expect(msg.data.about.library).toBeTruthy();
  });
});
