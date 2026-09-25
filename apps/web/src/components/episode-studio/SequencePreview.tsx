/**
 * SequencePreview — plays the episode timeline the way the export will cut it.
 *
 * Two stacked <video> elements are swapped at each clip boundary: while one
 * plays, the other is already loaded and seeked to the next clip's in-point,
 * so cuts don't stall on a fresh network fetch. The active element is the
 * master clock; a rAF loop turns its `currentTime` back into timeline time.
 *
 * It also reproduces what the export applies per clip, so what you hear and
 * see is what you get:
 *   • volume and fade in / out (picture fades through black, audio ramps)
 *   • an `audioUrl` overlay replacing the clip's own audio, kept in sync
 *   • text overlays, sized relative to the frame like the export burns them in
 * Each video slot owns a sibling <audio> element for its overlay.
 */
import { useCallback, useEffect, useRef } from 'react';
import {
  activeOverlays,
  clipGain,
  fadeLevel,
  OVERLAY_FONT_FRACTION,
  type ExportSettings,
  type TextOverlay,
} from '@/lib/episodeCut';
import { locate, totalDuration, type PlacedClip } from '@/lib/timelineEdit';
import { cn } from '@/lib/utils';
import { resolveIpfsUrlPreferred } from '@/utils/ipfs-url';

/** Switch clips this close (s) to the out-point — about one frame of rAF slack. */
const EDGE_EPSILON = 0.02;
/** Re-seek an overlay track that has drifted this far (s) from its video. */
const AUDIO_DRIFT = 0.15;

interface SequencePreviewProps {
  placed: PlacedClip[];
  playhead: number;
  playing: boolean;
  overlays?: TextOverlay[];
  aspect?: ExportSettings['aspect'];
  framing?: ExportSettings['framing'];
  /**
   * The mixer's level for the video track's own audio (0–1): mute / solo / fader /
   * master from the audio mix, applied on top of each clip's own volume and fades.
   */
  videoVolume?: number;
  /** Timeline time, fired every frame while playing. */
  onTick: (t: number) => void;
  /** Playback ran off the end of the last clip. */
  onEnded: () => void;
}

type Slot = 0 | 1;

function seek(media: HTMLMediaElement, time: number) {
  if (media.readyState >= 1) {
    if (Math.abs(media.currentTime - time) > 0.001) media.currentTime = time;
  } else {
    media.addEventListener(
      'loadedmetadata',
      () => {
        media.currentTime = time;
      },
      { once: true }
    );
  }
}

/** `play()` rejects on autoplay policy / a superseded load; neither matters here. */
function safePlay(media: HTMLMediaElement | null | undefined) {
  try {
    void media?.play()?.catch(() => {});
  } catch {
    // jsdom and very old browsers throw synchronously
  }
}

export function SequencePreview({
  placed,
  playhead,
  playing,
  overlays = [],
  aspect = '16:9',
  framing = 'fit',
  videoVolume = 1,
  onTick,
  onEnded,
}: SequencePreviewProps) {
  const videoA = useRef<HTMLVideoElement>(null);
  const videoB = useRef<HTMLVideoElement>(null);
  const audioA = useRef<HTMLAudioElement>(null);
  const audioB = useRef<HTMLAudioElement>(null);
  const videos = [videoA, videoB];
  const audios = [audioA, audioB];
  const activeRef = useRef<Slot>(0);
  const clipIndexRef = useRef(0);

  // The rAF loop and the start-of-playback effect must see the latest values
  // without re-running (and restarting playback) on every tick.
  const placedRef = useRef(placed);
  placedRef.current = placed;
  const playheadRef = useRef(playhead);
  playheadRef.current = playhead;
  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;
  const videoVolumeRef = useRef(videoVolume);
  videoVolumeRef.current = videoVolume;

  /** Point a slot at a clip: its video, and its audio overlay if it has one. */
  const prepare = useCallback((slot: Slot, p: PlacedClip | undefined, sourceTime?: number) => {
    const video = videos[slot].current;
    const audio = audios[slot].current;
    if (!video || !p) return;
    const time = sourceTime ?? p.srcStart;

    const url = resolveIpfsUrlPreferred(p.clip.videoUrl);
    if (video.dataset.src !== url) {
      video.dataset.src = url;
      video.src = url;
    }
    seek(video, time);

    if (audio) {
      const overlayUrl = p.clip.audioUrl ? resolveIpfsUrlPreferred(p.clip.audioUrl) : '';
      if (overlayUrl) {
        if (audio.dataset.src !== overlayUrl) {
          audio.dataset.src = overlayUrl;
          audio.src = overlayUrl;
        }
        seek(audio, time);
      } else if (audio.dataset.src) {
        audio.pause();
        audio.removeAttribute('src');
        delete audio.dataset.src;
      }
      // The overlay replaces the clip's own sound, exactly as in the export.
      video.muted = !!overlayUrl;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Apply the fade / volume curve for `localT` seconds into `p` to a slot. */
  const applyLevels = useCallback((slot: Slot, p: PlacedClip, localT: number) => {
    const video = videos[slot].current;
    const audio = audios[slot].current;
    if (!video) return;
    const visible = fadeLevel(p.clip, p.length, localT);
    video.style.opacity = String(visible);
    const gain = clipGain(p.clip, p.length, localT) * videoVolumeRef.current;
    video.volume = gain;
    if (audio) audio.volume = gain;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Make one slot the visible one; the other goes fully transparent. */
  const showOnly = (slot: Slot) => {
    const other = videos[(1 - slot) as Slot].current;
    if (other) other.style.opacity = '0';
  };

  // Scrubbing / paused: park the active element on the frame under the playhead.
  useEffect(() => {
    if (playing) return;
    const hit = locate(placed, playhead);
    if (!hit) return;
    clipIndexRef.current = hit.placed.index;
    prepare(activeRef.current, hit.placed, hit.sourceTime);
    showOnly(activeRef.current);
    applyLevels(activeRef.current, hit.placed, hit.sourceTime - hit.placed.srcStart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playhead, playing, placed, videoVolume, prepare, applyLevels]);

  useEffect(() => {
    const pauseAll = () => {
      videos.forEach((v) => v.current?.pause());
      audios.forEach((a) => a.current?.pause());
    };
    if (!playing) {
      pauseAll();
      return;
    }
    const list = placedRef.current;
    const total = totalDuration(list);
    // Pressing play at the very end restarts from the top, like every editor.
    const startAt = playheadRef.current >= total - 0.02 ? 0 : playheadRef.current;
    const hit = locate(list, startAt);
    if (!hit) {
      onEndedRef.current();
      return;
    }

    clipIndexRef.current = hit.placed.index;
    const first = activeRef.current;
    prepare(first, hit.placed, hit.sourceTime);
    showOnly(first);
    safePlay(videos[first].current);
    if (hit.placed.clip.audioUrl) safePlay(audios[first].current);
    prepare((1 - first) as Slot, list[hit.placed.index + 1]);

    let raf = 0;
    const loop = () => {
      const current = placedRef.current[clipIndexRef.current];
      const video = videos[activeRef.current].current;
      if (!current || !video) return;

      if (video.currentTime >= current.srcEnd - EDGE_EPSILON || video.ended) {
        const next = placedRef.current[clipIndexRef.current + 1];
        if (!next) {
          pauseAll();
          onEndedRef.current();
          return;
        }
        const nextSlot = (1 - activeRef.current) as Slot;
        prepare(nextSlot, next); // no-op when already parked on its in-point
        safePlay(videos[nextSlot].current);
        if (next.clip.audioUrl) safePlay(audios[nextSlot].current);
        video.pause();
        audios[activeRef.current].current?.pause();
        activeRef.current = nextSlot;
        clipIndexRef.current += 1;
        showOnly(nextSlot);
        prepare((1 - nextSlot) as Slot, placedRef.current[clipIndexRef.current + 1]);
      }

      const p = placedRef.current[clipIndexRef.current];
      const v = videos[activeRef.current].current;
      if (p && v) {
        const local = Math.min(Math.max(v.currentTime - p.srcStart, 0), p.length);
        applyLevels(activeRef.current, p, local);
        const a = audios[activeRef.current].current;
        if (a && p.clip.audioUrl && Math.abs(a.currentTime - v.currentTime) > AUDIO_DRIFT) {
          a.currentTime = v.currentTime;
        }
        onTickRef.current(p.start + local);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      pauseAll();
    };
    // Only (re)start when playback is toggled; everything else is read via refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, prepare, applyLevels]);

  const frameStyle: React.CSSProperties =
    aspect === '16:9'
      ? { aspectRatio: '16 / 9', width: '100%' }
      : { aspectRatio: aspect.replace(':', ' / '), height: 'min(60vh, 34rem)', maxWidth: '100%' };

  if (placed.length === 0) {
    return (
      <div
        className="mx-auto flex items-center justify-center rounded-lg bg-black text-sm text-white/50"
        style={frameStyle}
      >
        No clips on the timeline
      </div>
    );
  }

  const visibleOverlays = activeOverlays(overlays, playhead);

  return (
    <div
      role="region"
      aria-label="Program monitor"
      className="relative mx-auto overflow-hidden rounded-lg bg-black [container-type:size]"
      style={frameStyle}
    >
      {([0, 1] as Slot[]).map((slot) => (
        <video
          key={slot}
          ref={videos[slot]}
          playsInline
          preload="auto"
          className={cn(
            'absolute inset-0 h-full w-full',
            framing === 'fill' ? 'object-cover' : 'object-contain'
          )}
          style={{ opacity: slot === 0 ? 1 : 0, pointerEvents: 'none' }}
        />
      ))}
      {([0, 1] as Slot[]).map((slot) => (
        <audio key={slot} ref={audios[slot]} preload="auto" />
      ))}
      {visibleOverlays.map((o) => (
        <div
          key={o.id}
          className={cn(
            'pointer-events-none absolute inset-x-0 flex justify-center px-[10%]',
            o.position === 'top' && 'top-[8%]',
            o.position === 'center' && 'top-1/2 -translate-y-1/2',
            o.position === 'bottom' && 'bottom-[8%]'
          )}
        >
          <span
            className="whitespace-pre-wrap rounded bg-black/55 px-[0.6em] py-[0.3em] text-center font-bold leading-tight text-white"
            style={{ fontSize: `${OVERLAY_FONT_FRACTION[o.size] * 100}cqh` }}
          >
            {o.text}
          </span>
        </div>
      ))}
    </div>
  );
}
