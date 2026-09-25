/**
 * SequencePreview — plays the episode timeline the way the export will cut it.
 *
 * Two stacked <video> elements are swapped at each clip boundary: while one
 * plays, the other is already loaded and seeked to the next clip's in-point,
 * so cuts don't stall on a fresh network fetch. The active element is the
 * master clock; a rAF loop turns its `currentTime` back into timeline time.
 *
 * Preview plays each clip's own audio — an `audioUrl` overlay is only mixed in
 * by the server at export.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { locate, totalDuration, type PlacedClip } from '@/lib/timelineEdit';
import { resolveIpfsUrlPreferred } from '@/utils/ipfs-url';

/** Switch clips this close (s) to the out-point — about one frame of rAF slack. */
const EDGE_EPSILON = 0.02;

interface SequencePreviewProps {
  placed: PlacedClip[];
  playhead: number;
  playing: boolean;
  /** Timeline time, fired every frame while playing. */
  onTick: (t: number) => void;
  /** Playback ran off the end of the last clip. */
  onEnded: () => void;
}

type Slot = 0 | 1;

function seek(video: HTMLVideoElement, time: number) {
  if (video.readyState >= 1) {
    if (Math.abs(video.currentTime - time) > 0.001) video.currentTime = time;
  } else {
    video.addEventListener(
      'loadedmetadata',
      () => {
        video.currentTime = time;
      },
      { once: true }
    );
  }
}

export function SequencePreview({
  placed,
  playhead,
  playing,
  onTick,
  onEnded,
}: SequencePreviewProps) {
  const slotA = useRef<HTMLVideoElement>(null);
  const slotB = useRef<HTMLVideoElement>(null);
  const slots = [slotA, slotB];
  const [active, setActive] = useState<Slot>(0);
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

  const prepare = useCallback((slot: Slot, p: PlacedClip | undefined, sourceTime?: number) => {
    const video = slots[slot].current;
    if (!video || !p) return;
    const url = resolveIpfsUrlPreferred(p.clip.videoUrl);
    if (video.dataset.src !== url) {
      video.dataset.src = url;
      video.src = url;
    }
    seek(video, sourceTime ?? p.srcStart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Scrubbing / paused: park the active element on the frame under the playhead.
  useEffect(() => {
    if (playing) return;
    const hit = locate(placed, playhead);
    if (!hit) return;
    clipIndexRef.current = hit.placed.index;
    prepare(activeRef.current, hit.placed, hit.sourceTime);
  }, [playhead, playing, placed, prepare]);

  useEffect(() => {
    if (!playing) {
      slots.forEach((s) => s.current?.pause());
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
    slots[first].current?.play().catch(() => {});
    prepare((1 - first) as Slot, list[hit.placed.index + 1]);

    let raf = 0;
    const loop = () => {
      const current = placedRef.current[clipIndexRef.current];
      const video = slots[activeRef.current].current;
      if (!current || !video) return;

      if (video.currentTime >= current.srcEnd - EDGE_EPSILON || video.ended) {
        const next = placedRef.current[clipIndexRef.current + 1];
        if (!next) {
          video.pause();
          onEndedRef.current();
          return;
        }
        const nextSlot = (1 - activeRef.current) as Slot;
        const nextVideo = slots[nextSlot].current;
        prepare(nextSlot, next); // no-op when already parked on its in-point
        nextVideo?.play().catch(() => {});
        video.pause();
        activeRef.current = nextSlot;
        setActive(nextSlot);
        clipIndexRef.current += 1;
        prepare((1 - nextSlot) as Slot, placedRef.current[clipIndexRef.current + 1]);
      }

      const p = placedRef.current[clipIndexRef.current];
      const v = slots[activeRef.current].current;
      if (p && v) {
        const within = Math.min(Math.max(v.currentTime - p.srcStart, 0), p.length);
        onTickRef.current(p.start + within);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      slots.forEach((s) => s.current?.pause());
    };
    // Only (re)start when playback is toggled; everything else is read via refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, prepare]);

  if (placed.length === 0) {
    return (
      <div className="flex aspect-video w-full items-center justify-center rounded-lg bg-black text-sm text-white/50">
        No clips on the timeline
      </div>
    );
  }

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
      {([0, 1] as Slot[]).map((slot) => (
        <video
          key={slot}
          ref={slots[slot]}
          playsInline
          preload="auto"
          className="absolute inset-0 h-full w-full object-contain"
          style={{ opacity: active === slot ? 1 : 0, pointerEvents: 'none' }}
        />
      ))}
    </div>
  );
}
