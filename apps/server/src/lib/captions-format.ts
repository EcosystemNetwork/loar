/**
 * Caption format helpers — SRT/VTT/JSON serialization and segment shaping.
 *
 * Shared by `generation/lipsync.routes.ts` and `generation/captions.routes.ts`.
 * Pure functions, no I/O.
 */

export interface CaptionWord {
  start: number;
  end: number;
  text: string;
}

export interface CaptionSegment {
  start: number; // seconds
  end: number;
  text: string;
  speaker?: string | null;
  /** Per-word timing data, if produced by a word-level transcription pass. */
  words?: CaptionWord[];
}

export interface CaptionStyleOptions {
  /** Max characters per visual line (wraps within a cue). Default 42 (Netflix). */
  maxCharsPerLine?: number;
  /** Max lines per cue. Default 2. */
  maxLinesPerCue?: number;
  /** Merge adjacent segments separated by a gap <= this (seconds). 0 = off. */
  mergeGapSeconds?: number;
  /** Render speaker labels inline (e.g. "JANE: ..."). Default false. */
  includeSpeakerLabels?: boolean;
  /**
   * Karaoke-style per-word highlight in VTT output. Only meaningful when
   * `format='vtt'` and the segments carry `words[]`. Embeds inline
   * `<00:00:01.000>` timestamp tags between words inside each cue.
   */
  wordHighlight?: boolean;
}

export type CaptionFormat = 'srt' | 'vtt' | 'json';

const DEFAULTS: Required<CaptionStyleOptions> = {
  maxCharsPerLine: 42,
  maxLinesPerCue: 2,
  mergeGapSeconds: 0,
  includeSpeakerLabels: false,
  wordHighlight: false,
};

// ── Time formatters ──────────────────────────────────────────────────

export function formatTimeSRT(seconds: number): string {
  const safe = Math.max(0, seconds);
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = Math.floor(safe % 60);
  const ms = Math.round((safe % 1) * 1000);
  return `${pad2(h)}:${pad2(m)}:${pad2(s)},${pad3(ms)}`;
}

export function formatTimeVTT(seconds: number): string {
  const safe = Math.max(0, seconds);
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = Math.floor(safe % 60);
  const ms = Math.round((safe % 1) * 1000);
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}.${pad3(ms)}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function pad3(n: number): string {
  return String(n).padStart(3, '0');
}

// ── Text shaping ─────────────────────────────────────────────────────

/** Greedy word-wrap to a max line width. Never splits a word. */
export function wrapLine(text: string, maxChars: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (!cur) {
      cur = w;
    } else if (cur.length + 1 + w.length <= maxChars) {
      cur = `${cur} ${w}`;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * Reshape segments according to style options:
 *   1. Optionally merge segments with small gaps between them.
 *   2. Wrap each segment text to maxCharsPerLine.
 *   3. If wrapped lines exceed maxLinesPerCue, split the segment timing-proportionally
 *      into multiple cues.
 *   4. Optionally prefix the first line of each cue with "SPEAKER: ".
 */
export function shapeSegments(
  segments: CaptionSegment[],
  options: CaptionStyleOptions = {}
): CaptionSegment[] {
  const opts = { ...DEFAULTS, ...options };
  if (segments.length === 0) return [];

  // 1. merge
  const merged: CaptionSegment[] = [];
  for (const seg of segments) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      opts.mergeGapSeconds > 0 &&
      seg.start - prev.end <= opts.mergeGapSeconds &&
      (prev.speaker ?? null) === (seg.speaker ?? null)
    ) {
      prev.end = seg.end;
      prev.text = `${prev.text} ${seg.text}`.trim();
      if (prev.words && seg.words) prev.words = [...prev.words, ...seg.words];
      else if (seg.words) prev.words = [...seg.words];
    } else {
      merged.push({ ...seg, words: seg.words ? [...seg.words] : undefined });
    }
  }

  // 2-4. wrap + split + speaker label
  const out: CaptionSegment[] = [];
  for (const seg of merged) {
    const label = opts.includeSpeakerLabels && seg.speaker ? `${seg.speaker}: ` : '';
    const wrapped = wrapLine(`${label}${seg.text}`, opts.maxCharsPerLine);
    if (wrapped.length === 0) continue;

    if (wrapped.length <= opts.maxLinesPerCue) {
      out.push({
        start: seg.start,
        end: seg.end,
        text: wrapped.join('\n'),
        speaker: seg.speaker ?? null,
        words: seg.words,
      });
      continue;
    }

    // Split into chunks of maxLinesPerCue, allocate duration proportionally to char count.
    const totalChars = wrapped.reduce((sum, l) => sum + l.length, 0) || 1;
    const duration = Math.max(0, seg.end - seg.start);
    let cursor = seg.start;
    const cueRanges: Array<{ start: number; end: number; text: string }> = [];
    for (let i = 0; i < wrapped.length; i += opts.maxLinesPerCue) {
      const chunk = wrapped.slice(i, i + opts.maxLinesPerCue);
      const chunkChars = chunk.reduce((sum, l) => sum + l.length, 0);
      const chunkDur = duration * (chunkChars / totalChars);
      const end = i + opts.maxLinesPerCue >= wrapped.length ? seg.end : cursor + chunkDur;
      cueRanges.push({ start: cursor, end, text: chunk.join('\n') });
      cursor = end;
    }
    // Partition words by which cue's time window they fall in.
    const wordsForCue = seg.words
      ? cueRanges.map(({ start, end }, idx) => {
          const isLast = idx === cueRanges.length - 1;
          return seg.words!.filter((w) => {
            const mid = (w.start + w.end) / 2;
            return mid >= start && (isLast ? true : mid < end);
          });
        })
      : null;
    cueRanges.forEach((range, idx) => {
      out.push({
        start: range.start,
        end: range.end,
        text: range.text,
        speaker: seg.speaker ?? null,
        words: wordsForCue ? wordsForCue[idx] : undefined,
      });
    });
  }
  return out;
}

// ── Serializers ──────────────────────────────────────────────────────

export function segmentsToSRT(segments: CaptionSegment[]): string {
  return segments
    .map(
      (seg, i) =>
        `${i + 1}\n${formatTimeSRT(seg.start)} --> ${formatTimeSRT(seg.end)}\n${seg.text}\n`
    )
    .join('\n');
}

export function segmentsToVTT(
  segments: CaptionSegment[],
  options?: { wordHighlight?: boolean }
): string {
  const wordHighlight = !!options?.wordHighlight;
  const cues = segments
    .map((seg) => {
      const body =
        wordHighlight && seg.words && seg.words.length > 0
          ? renderWordHighlightedCue(seg)
          : seg.text;
      return `${formatTimeVTT(seg.start)} --> ${formatTimeVTT(seg.end)}\n${body}\n`;
    })
    .join('\n');
  return `WEBVTT\n\n${cues}`;
}

/**
 * Emit a VTT cue body with inline `<00:00:01.000>` timestamp tags
 * between words. Browsers render each word as active as the playhead
 * crosses its tag (karaoke effect).
 */
function renderWordHighlightedCue(seg: CaptionSegment): string {
  const words = seg.words!;
  // The first word starts implicitly at the cue start; subsequent words
  // get a timestamp tag before them so they activate at their start.
  return words.map((w, i) => (i === 0 ? w.text : `<${formatTimeVTT(w.start)}>${w.text}`)).join(' ');
}

export function renderCaptions(
  segments: CaptionSegment[],
  format: CaptionFormat,
  options?: CaptionStyleOptions
): string {
  const shaped = options ? shapeSegments(segments, options) : segments;
  switch (format) {
    case 'vtt':
      return segmentsToVTT(shaped, { wordHighlight: options?.wordHighlight });
    case 'json':
      return JSON.stringify(shaped, null, 2);
    case 'srt':
    default:
      return segmentsToSRT(shaped);
  }
}
