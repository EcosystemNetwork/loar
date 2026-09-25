/**
 * A local backup of the episode being edited, so a crash, a lost connection or
 * a failed save doesn't cost the creator their work. Purely a safety net —
 * the server copy stays the source of truth, and every access is best-effort
 * (private windows and blocked storage must not break the editor).
 */
import type { Cut, ExportSettings } from '@/lib/episodeCut';
import { normalizeMix } from '@/lib/audioMix';

export interface EpisodeDraft {
  title: string;
  description: string;
  cut: Cut;
  settings: ExportSettings;
  /** Epoch ms when this backup was written. */
  savedAt: number;
}

const key = (episodeId: string) => `loar:episode-draft:${episodeId}`;

export function saveDraft(episodeId: string, draft: EpisodeDraft): void {
  try {
    localStorage.setItem(key(episodeId), JSON.stringify(draft));
  } catch {
    // storage full / unavailable — nothing to do
  }
}

export function loadDraft(episodeId: string): EpisodeDraft | null {
  try {
    const raw = localStorage.getItem(key(episodeId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<EpisodeDraft>;
    if (!parsed || !Array.isArray(parsed.cut?.clips) || typeof parsed.savedAt !== 'number') {
      return null;
    }
    // Backups written before the audio mix existed (or by an older tab) lack it.
    const cut = parsed.cut as Partial<Cut> & { clips: Cut['clips'] };
    return {
      ...(parsed as EpisodeDraft),
      cut: {
        clips: cut.clips,
        overlays: cut.overlays ?? [],
        soundtrack: null,
        audioMix: normalizeMix(cut.audioMix),
      },
    };
  } catch {
    return null;
  }
}

export function clearDraft(episodeId: string): void {
  try {
    localStorage.removeItem(key(episodeId));
  } catch {
    // ignore
  }
}

/**
 * Is the backup worth offering? Only when it's newer than what the server has
 * AND actually differs — otherwise every clean load would nag.
 */
export function draftIsNewer(
  draft: EpisodeDraft,
  server: { updatedAt?: string | null },
  draftSignature: string,
  serverSignature: string
): boolean {
  if (draftSignature === serverSignature) return false;
  const serverTime = server.updatedAt ? Date.parse(server.updatedAt) : 0;
  return draft.savedAt > (Number.isFinite(serverTime) ? serverTime : 0);
}
