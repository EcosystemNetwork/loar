/**
 * Trim in/out points for playing a clip — the small rules every player shares.
 *
 * Episode clips store their trim in SECONDS with `trimEnd: 0` meaning "to the
 * end of the file". The universe timeline editor stores a scene's trim in
 * MILLISECONDS on its event (`trimStart`/`trimEnd`), where a missing `trimEnd`
 * means "full". Episodes built from timeline nodes used to drop that trim, so a
 * clip the editor called "trimmed" still played the whole file everywhere it was
 * published; `resolveClipTrim` lets a player fall back to the scene's own trim.
 *
 * Pure (no DOM), so the rules are unit-tested.
 */

export interface ClipTrim {
  /** In-point, seconds. */
  start: number;
  /** Out-point, seconds; 0 = play to the end of the file. */
  end: number;
}

export const NO_TRIM: ClipTrim = { start: 0, end: 0 };

/** Stop this close (s) to the out-point — `timeupdate` only fires ~4×/s. */
export const END_SLACK = 0.05;
/** A viewer scrubbing earlier than this before the in-point is snapped back to it. */
const START_SLACK = 0.25;

export const isTrimmed = (t: ClipTrim): boolean => t.start > 0 || t.end > 0;

/** A timeline scene's trim (milliseconds, `trimEnd` optional) as clip seconds. */
export function sceneTrimToSeconds(
  scene: { trimStart?: number | null; trimEnd?: number | null } | null | undefined
): ClipTrim {
  if (!scene) return NO_TRIM;
  const start =
    typeof scene.trimStart === 'number' && scene.trimStart > 0 ? scene.trimStart / 1000 : 0;
  const end = typeof scene.trimEnd === 'number' && scene.trimEnd > 0 ? scene.trimEnd / 1000 : 0;
  // An out-point at or before the in-point is corrupt data, not a zero-length clip.
  return end > 0 && end <= start ? NO_TRIM : { start, end };
}

/**
 * The trim to play a clip with: the clip's own (episode, seconds) when it has one,
 * otherwise the scene's trim from the timeline editor.
 */
export function resolveClipTrim(
  clip: { trimStart?: number | null; trimEnd?: number | null },
  scene?: { trimStart?: number | null; trimEnd?: number | null } | null
): ClipTrim {
  const own: ClipTrim = {
    start: typeof clip.trimStart === 'number' && clip.trimStart > 0 ? clip.trimStart : 0,
    end: typeof clip.trimEnd === 'number' && clip.trimEnd > 0 ? clip.trimEnd : 0,
  };
  return isTrimmed(own) ? own : sceneTrimToSeconds(scene);
}

/** Has playback reached the out-point? */
export function pastTrimEnd(currentTime: number, trim: ClipTrim): boolean {
  return trim.end > 0 && currentTime >= trim.end - END_SLACK;
}

/** Where to jump if the playhead is before the in-point (start of playback, or a scrub); else null. */
export function seekTarget(currentTime: number, trim: ClipTrim): number | null {
  return trim.start > 0 && currentTime < trim.start - START_SLACK ? trim.start : null;
}

/** Length the clip plays for once trimmed, given the file's real duration; null if unknown. */
export function trimmedLength(
  trim: ClipTrim,
  fileDuration: number | null | undefined
): number | null {
  if (!fileDuration || !Number.isFinite(fileDuration))
    return trim.end > 0 ? trim.end - trim.start : null;
  const end = trim.end > 0 ? Math.min(trim.end, fileDuration) : fileDuration;
  return Math.max(0, end - trim.start);
}
