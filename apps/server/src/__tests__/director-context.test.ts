/**
 * Pure-logic tests for the Voice Director's context helpers and the
 * Pipecat session token. Firebase is stubbed in setup.ts, so nothing here
 * touches Firestore — these pin the parts whose bugs would silently corrupt
 * a demo: which story nodes a character "remembers", which voice ids count
 * as real, and that session tokens verify (and only verify) as documented.
 */
import { describe, it, expect } from 'vitest';
import { createHmac } from 'crypto';
import {
  primaryPath,
  extractEntityVoice,
  type StoryNodeSummary,
} from '../services/director-context';
import { mintVoiceSessionToken, VOICE_SESSION_TTL_SECONDS } from '../services/voice-session';

const node = (
  nodeId: number,
  previousNodeId: number,
  title = `Ep ${nodeId}`
): StoryNodeSummary => ({
  nodeId,
  previousNodeId,
  title,
  plot: `plot ${nodeId}`,
  canon: false,
});

describe('primaryPath', () => {
  it('follows the earliest-created child, excluding alternate branches', () => {
    // 1 → 2 → 3 → 4 (original continuation), and 5 branches off 3 as an alternate
    const nodes = [node(1, 0), node(2, 1), node(3, 2), node(4, 3), node(5, 3)];
    expect(primaryPath(nodes).map((n) => n.nodeId)).toEqual([1, 2, 3, 4]);
  });

  it('is order-independent', () => {
    const nodes = [node(5, 3), node(3, 2), node(1, 0), node(4, 3), node(2, 1)];
    expect(primaryPath(nodes).map((n) => n.nodeId)).toEqual([1, 2, 3, 4]);
  });

  it('returns [] for an empty graph and never loops on a cycle', () => {
    expect(primaryPath([])).toEqual([]);
    const cyclic = [node(1, 2), node(2, 1)];
    expect(primaryPath(cyclic)).toEqual([]);
  });
});

describe('extractEntityVoice', () => {
  it('ignores REPLACE_ placeholders so unseeded characters degrade to the default voice', () => {
    expect(extractEntityVoice({ humeVoiceId: 'REPLACE_WITH_REAL_HUME_VOICE_ID_KIRA' })).toBeNull();
  });

  it("keeps real ids and truncates the acting description to Hume's 100-char limit", () => {
    const voice = extractEntityVoice({
      humeVoiceId: 'abc-123',
      humeVoiceDescription: 'x'.repeat(300),
    });
    expect(voice?.humeVoiceId).toBe('abc-123');
    expect(voice?.humeVoiceDescription).toHaveLength(100);
  });

  it('returns null with no metadata', () => {
    expect(extractEntityVoice(undefined)).toBeNull();
  });
});

describe('mintVoiceSessionToken', () => {
  const secret = 'test-secret';

  it('produces a token whose HMAC verifies with the shared secret', () => {
    const { token } = mintVoiceSessionToken(
      { universeId: '0xabc', mode: 'director', uid: 'u1' },
      secret
    );
    const [payload, sig] = token.split('.');
    const expected = createHmac('sha256', secret).update(payload).digest('base64url');
    expect(sig).toBe(expected);
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    expect(claims).toMatchObject({ v: 1, universeId: '0xabc', mode: 'director', uid: 'u1' });
  });

  it('does not verify under a different secret', () => {
    const { token } = mintVoiceSessionToken(
      { universeId: '0xabc', mode: 'director', uid: 'u1' },
      secret
    );
    const [payload, sig] = token.split('.');
    const wrong = createHmac('sha256', 'other').update(payload).digest('base64url');
    expect(sig).not.toBe(wrong);
  });

  it('expires after the TTL and uses a fresh nonce each time', () => {
    const now = 1_700_000_000_000;
    const a = mintVoiceSessionToken(
      { universeId: 'u', mode: 'character', entityId: 'e', uid: 'x' },
      secret,
      now
    );
    const b = mintVoiceSessionToken(
      { universeId: 'u', mode: 'character', entityId: 'e', uid: 'x' },
      secret,
      now
    );
    expect(a.expiresAt).toBe(Math.floor(now / 1000) + VOICE_SESSION_TTL_SECONDS);
    expect(a.token).not.toBe(b.token);
    const claims = JSON.parse(Buffer.from(a.token.split('.')[0], 'base64url').toString());
    expect(claims.entityId).toBe('e');
  });
});
