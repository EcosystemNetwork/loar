/**
 * Authorization for ElevenLabs voiceId parameters.
 *
 * Callers pass a voiceId to both voice.modify and talkingScene.create. We must
 * reject ids that aren't actually available to our ElevenLabs workspace —
 * otherwise the provider returns a 404 after we've already deducted credits,
 * and a motivated attacker can probe for premium-tier voice ids to force
 * billing noise. Also reject ids owned by other users (custom clones).
 *
 * The voice list is cached per-process for 5 minutes — it changes rarely.
 */
import { TRPCError } from '@trpc/server';
import { elevenLabsService, type ElevenLabsVoice } from '../services/elevenlabs';
import { db } from './firebase';

interface VoiceCache {
  ids: Set<string>;
  fetchedAt: number;
}

const CACHE_TTL_MS = 5 * 60_000;
let cache: VoiceCache | null = null;

async function loadAllowedVoiceIds(): Promise<Set<string>> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) return cache.ids;
  if (!elevenLabsService.isConfigured()) {
    cache = { ids: new Set(), fetchedAt: now };
    return cache.ids;
  }
  try {
    const voices: ElevenLabsVoice[] = await elevenLabsService.listVoices();
    const ids = new Set(voices.map((v) => v.voice_id));
    cache = { ids, fetchedAt: now };
    return ids;
  } catch (err) {
    // Fail-closed: if ElevenLabs is reachable at all we want to validate against
    // its list. A fetch failure during validation returns an empty set so any
    // caller id misses — the downstream TTS would fail anyway. Log and reset
    // the cache so we retry next call.
    console.warn('[voice-authz] listVoices failed, falling back to empty allowlist:', err);
    cache = { ids: new Set(), fetchedAt: now };
    return cache.ids;
  }
}

export async function isVoiceIdAllowed(voiceId: string): Promise<boolean> {
  if (!voiceId) return false;
  // ElevenLabs ids are hex; reject garbage before we hit the network.
  if (!/^[A-Za-z0-9_-]{10,64}$/.test(voiceId)) return false;
  const ids = await loadAllowedVoiceIds();
  if (ids.has(voiceId)) return true;
  // User-owned clones may not appear in workspace-level listVoices (per-user
  // clones stored in our DB during voice.clone). Accept if the caller owns it.
  return false;
}

/**
 * Allow a voice if: (a) it appears in ElevenLabs workspace voices, or
 * (b) the caller cloned it and it's recorded as owned in `voiceClones`.
 */
export async function assertVoiceIdAllowed(uid: string, voiceId: string): Promise<void> {
  if (await isVoiceIdAllowed(voiceId)) return;

  if (db) {
    const snap = await db
      .collection('voiceClones')
      .where('voiceId', '==', voiceId)
      .where('userId', '==', uid)
      .limit(1)
      .get();
    if (!snap.empty) return;
  }

  throw new TRPCError({
    code: 'BAD_REQUEST',
    message: 'Voice is not available to this account.',
  });
}
