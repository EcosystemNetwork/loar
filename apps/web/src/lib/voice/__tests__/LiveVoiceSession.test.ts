import { describe, it, expect, vi } from 'vitest';
import { LiveVoiceSession, describeClose } from '../LiveVoiceSession';
import { encodeAudioFrame, encodeMessageFrame } from '../pipecatProtocol';

function makeSession() {
  const cb = { onRtvi: vi.fn(), onStatus: vi.fn(), onMicLevel: vi.fn() };
  const session = new LiveVoiceSession('wss://voice.test/ws?token=t', cb);
  const player = { enqueue: vi.fn(), flush: vi.fn() };
  (session as any).player = player;
  return { session, cb, player };
}

const buf = (bytes: Uint8Array) =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const audio = () =>
  buf(
    encodeAudioFrame({ audio: Uint8Array.from([1, 0, 2, 0]), sampleRate: 24000, numChannels: 1 })
  );
const rtvi = (type: string, data?: unknown) =>
  buf(encodeMessageFrame(JSON.stringify({ label: 'rtvi-ai', type, data })));

describe('LiveVoiceSession barge-in', () => {
  it('plays bot audio as it arrives', () => {
    const { session, player } = makeSession();
    session.onSocketMessage(audio());
    expect(player.enqueue).toHaveBeenCalledWith(Uint8Array.from([1, 0, 2, 0]), 24000);
  });

  it('flushes queued audio the instant the user starts speaking, and still reports the event', () => {
    const { session, cb, player } = makeSession();
    session.onSocketMessage(audio());
    session.onSocketMessage(rtvi('user-started-speaking'));

    expect(player.flush).toHaveBeenCalledTimes(1);
    expect(cb.onRtvi).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'user-started-speaking' })
    );
  });

  it('interrupt() silences the bot and discards its remaining audio until the next turn', () => {
    const { session, player } = makeSession();
    session.interrupt();
    expect(player.flush).toHaveBeenCalledTimes(1);

    session.onSocketMessage(audio()); // tail of the interrupted utterance
    expect(player.enqueue).not.toHaveBeenCalled();

    session.onSocketMessage(rtvi('bot-started-speaking')); // a new turn begins
    session.onSocketMessage(audio());
    expect(player.enqueue).toHaveBeenCalledTimes(1);
  });

  it('accepts bot audio again once the user speaks, even after an interrupt', () => {
    const { session, player } = makeSession();
    session.interrupt();
    session.onSocketMessage(rtvi('user-started-speaking'));
    session.onSocketMessage(audio());
    expect(player.enqueue).toHaveBeenCalledTimes(1);
  });

  it('honours the protobuf interruption frame', () => {
    const { session, player } = makeSession();
    session.onSocketMessage(Uint8Array.from([0x2a, 0x00]).buffer);
    expect(player.flush).toHaveBeenCalledTimes(1);
  });

  it('survives malformed frames, non-binary messages and non-RTVI JSON without side effects', () => {
    const { session, cb, player } = makeSession();
    session.onSocketMessage(Uint8Array.from([0x12, 0x2e, 0x08]).buffer); // truncated
    session.onSocketMessage('text frames are not part of the protocol');
    session.onSocketMessage(buf(encodeMessageFrame('{"label":"someone-else","type":"x"}')));
    session.onSocketMessage(buf(encodeMessageFrame('not json')));

    expect(cb.onRtvi).not.toHaveBeenCalled();
    expect(player.enqueue).not.toHaveBeenCalled();
    expect(player.flush).not.toHaveBeenCalled();
  });
});

describe('describeClose', () => {
  it('is silent for normal closes and explains the ones a user can act on', () => {
    expect(describeClose(1000)).toBeUndefined();
    expect(describeClose(4003)).toMatch(/expired or was already used/);
    expect(describeClose(1006)).toMatch(/Lost the connection/);
    expect(describeClose(1011)).toMatch(/error/);
    expect(describeClose(4999)).toMatch(/4999/);
  });
});
