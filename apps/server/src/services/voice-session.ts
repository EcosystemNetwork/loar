/**
 * Short-lived, single-use session tokens for the Pipecat voice pipeline
 * (apps/voice-pipeline). LOAR mints the token after authenticating the user
 * and checking universe access; the pipeline verifies the HMAC with the
 * shared VOICE_SESSION_SECRET and refuses expired or replayed tokens — so
 * the WebSocket endpoint can't be driven by anyone LOAR didn't vouch for.
 *
 * Wire format: base64url(JSON claims) + "." + base64url(HMAC-SHA256(secret,
 * the first segment)). Kept in sync with apps/voice-pipeline/session.py.
 */
import { createHmac, randomBytes } from 'crypto';

export type VoiceSessionMode = 'director' | 'character';

export interface VoiceSessionClaims {
  v: 1;
  universeId: string;
  mode: VoiceSessionMode;
  entityId?: string;
  uid: string;
  /** Unix seconds. */
  exp: number;
  nonce: string;
}

export const VOICE_SESSION_TTL_SECONDS = 300;

export function mintVoiceSessionToken(
  input: { universeId: string; mode: VoiceSessionMode; entityId?: string; uid: string },
  secret: string,
  nowMs: number = Date.now()
): { token: string; expiresAt: number } {
  const claims: VoiceSessionClaims = {
    v: 1,
    universeId: input.universeId,
    mode: input.mode,
    uid: input.uid,
    exp: Math.floor(nowMs / 1000) + VOICE_SESSION_TTL_SECONDS,
    nonce: randomBytes(16).toString('hex'),
    ...(input.entityId ? { entityId: input.entityId } : {}),
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return { token: `${payload}.${sig}`, expiresAt: claims.exp };
}
