/**
 * Pure model for everything an episode edit consists of beyond the clip list:
 * text overlays, the soundtrack, export settings, and the small calculations
 * the preview and timeline share (fade curves, where a dropped clip lands).
 *
 * The three editable parts live together in one `Cut` so a single undo history
 * covers them. Nothing here touches the DOM.
 */
import type { EpisodeClip } from '@/components/episode-studio/EpisodeClipTimeline';
import type { PlacedClip } from '@/lib/timelineEdit';

export type OverlayPosition = 'top' | 'center' | 'bottom';
export type OverlaySize = 'sm' | 'md' | 'lg';

/** A caption / title card, in timeline seconds. */
export interface TextOverlay {
  id: string;
  text: string;
  start: number;
  end: number;
  position: OverlayPosition;
  size: OverlaySize;
}

/** A music / voice-over bed mixed under the whole episode at export. */
export interface Soundtrack {
  url: string;
  label?: string;
  /** 0–1 */
  volume: number;
}

export interface ExportSettings {
  aspect: '16:9' | '9:16' | '1:1';
  resolution: '720p' | '1080p';
  framing: 'fit' | 'fill';
}

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  aspect: '16:9',
  resolution: '720p',
  framing: 'fit',
};

/** The undoable part of an episode. */
export interface Cut {
  clips: EpisodeClip[];
  overlays: TextOverlay[];
  soundtrack: Soundtrack | null;
}

export const EMPTY_CUT: Cut = { clips: [], overlays: [], soundtrack: null };

export const MAX_OVERLAYS = 50;
export const MIN_OVERLAY_SEC = 0.5;
export const MAX_FADE_SEC = 10;

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);
const round3 = (n: number) => Math.round(n * 1000) / 1000;

// ── Clips ───────────────────────────────────────────────────────────────

export function patchClip(
  clips: EpisodeClip[],
  nodeId: string,
  patch: Partial<EpisodeClip>
): EpisodeClip[] {
  let hit = false;
  const next = clips.map((c) => {
    if (c.nodeId !== nodeId) return c;
    hit = true;
    return { ...c, ...patch };
  });
  return hit ? next : clips;
}

/** Same as `uniqueNodeId` in timelineEdit, kept local so this file has no runtime imports. */
function freshNodeId(clips: EpisodeClip[], base: string): string {
  const root = base.replace(/#\d+$/, '');
  const taken = new Set(clips.map((c) => c.nodeId));
  let n = 2;
  while (taken.has(`${root}#${n}`)) n++;
  return `${root}#${n}`;
}

/** Copy of a clip placed right after the original, with its own nodeId. */
export function duplicateClip(clips: EpisodeClip[], nodeId: string): EpisodeClip[] {
  const index = clips.findIndex((c) => c.nodeId === nodeId);
  if (index === -1) return clips;
  const copy = { ...clips[index], nodeId: freshNodeId(clips, nodeId) };
  const next = [...clips];
  next.splice(index + 1, 0, copy);
  return next;
}

/** Give each incoming clip a nodeId that doesn't clash with `existing` (or each other). */
export function withFreshIds(existing: EpisodeClip[], incoming: EpisodeClip[]): EpisodeClip[] {
  const out: EpisodeClip[] = [];
  for (const clip of incoming) {
    const all = [...existing, ...out];
    const clash = all.some((c) => c.nodeId === clip.nodeId);
    out.push(clash ? { ...clip, nodeId: freshNodeId(all, clip.nodeId) } : clip);
  }
  return out;
}

export function insertClipsAt(
  clips: EpisodeClip[],
  incoming: EpisodeClip[],
  index: number
): EpisodeClip[] {
  if (incoming.length === 0) return clips;
  const at = clamp(index, 0, clips.length);
  return [...clips.slice(0, at), ...withFreshIds(clips, incoming), ...clips.slice(at)];
}

/**
 * Which slot a clip dropped at timeline time `t` should take: before a clip
 * whose midpoint is still ahead of `t`, else after the last one.
 */
export function insertIndexAtTime(placed: PlacedClip[], t: number): number {
  for (const p of placed) {
    if (t < p.start + p.length / 2) return p.index;
  }
  return placed.length;
}

// ── Preview curves ──────────────────────────────────────────────────────

/**
 * 0–1 level for the clip's fades at `localT` seconds into the clip. Used for
 * both picture opacity and audio gain so the preview matches the export.
 */
export function fadeLevel(clip: EpisodeClip, length: number, localT: number): number {
  const cap = length / 2;
  const fadeIn = clamp(clip.fadeIn ?? 0, 0, cap);
  const fadeOut = clamp(clip.fadeOut ?? 0, 0, cap);
  let level = 1;
  if (fadeIn > 0 && localT < fadeIn) level = Math.min(level, localT / fadeIn);
  if (fadeOut > 0 && localT > length - fadeOut)
    level = Math.min(level, (length - localT) / fadeOut);
  return clamp(level, 0, 1);
}

/** Linear gain the preview should apply to a clip's audio (HTMLMediaElement caps at 1). */
export function clipGain(clip: EpisodeClip, length: number, localT: number): number {
  return clamp((clip.volume ?? 1) * fadeLevel(clip, length, localT), 0, 1);
}

// ── Overlays ────────────────────────────────────────────────────────────

let overlaySeq = 0;
export function newOverlayId(): string {
  overlaySeq += 1;
  return `ov-${Date.now().toString(36)}-${overlaySeq}`;
}

/** A default caption placed at `at`, 3s long, kept inside the episode. */
export function newOverlay(at: number, total: number): TextOverlay {
  const length = Math.min(3, Math.max(MIN_OVERLAY_SEC, total));
  const start = clamp(at, 0, Math.max(0, total - length));
  return {
    id: newOverlayId(),
    text: 'Your caption',
    start: round3(start),
    end: round3(start + length),
    position: 'bottom',
    size: 'md',
  };
}

/** Keep an edited overlay well-formed: non-negative, at least MIN_OVERLAY_SEC long. */
export function normalizeOverlay(o: TextOverlay): TextOverlay {
  const start = Math.max(0, round3(o.start));
  const end = Math.max(round3(o.end), round3(start + MIN_OVERLAY_SEC));
  return { ...o, start, end };
}

export function patchOverlay(
  overlays: TextOverlay[],
  id: string,
  patch: Partial<TextOverlay>
): TextOverlay[] {
  let hit = false;
  const next = overlays.map((o) => {
    if (o.id !== id) return o;
    hit = true;
    return normalizeOverlay({ ...o, ...patch });
  });
  return hit ? next : overlays;
}

export function activeOverlays(overlays: TextOverlay[], t: number): TextOverlay[] {
  return overlays.filter((o) => t >= o.start && t < o.end);
}

/** Overlays that fall (partly) past the end of the episode after an edit shortened it. */
export function overlaysBeyond(overlays: TextOverlay[], total: number): TextOverlay[] {
  return overlays.filter((o) => o.start >= total);
}

// ── Server hydration ────────────────────────────────────────────────────

/** Coerce whatever the server returned into a well-formed Cut (older episodes have no overlays). */
export function cutFromEpisode(data: {
  clips?: EpisodeClip[] | null;
  overlays?: TextOverlay[] | null;
  soundtrack?: Soundtrack | null;
}): Cut {
  return {
    clips: data.clips ?? [],
    overlays: (data.overlays ?? []).map(normalizeOverlay),
    soundtrack: data.soundtrack?.url ? data.soundtrack : null,
  };
}

/** Stable text form of everything that gets saved; equal cuts compare equal. */
export function cutSignature(
  title: string,
  description: string,
  cut: Cut,
  settings: ExportSettings
): string {
  return JSON.stringify({ title, description, cut, settings });
}

// ── Formatting ──────────────────────────────────────────────────────────

export function formatSavedAt(savedAt: number | null, now = Date.now()): string {
  if (!savedAt) return '';
  const s = Math.max(0, Math.round((now - savedAt) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  return new Date(savedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
