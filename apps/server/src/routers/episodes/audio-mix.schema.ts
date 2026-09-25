/**
 * Validation for the multi-track audio mix stored on an episode
 * (`episodes.update` accepts it, `runExport` renders it).
 *
 * Mirrors the web app's `lib/audioMix.ts` model and the caps in
 * `services/ffmpeg/audio-mix.ts`. Every number is bounded so a hostile or
 * corrupt payload can't ask ffmpeg for an unbounded graph.
 */
import { z } from 'zod';
import {
  MAX_CLIPS_PER_TRACK,
  MAX_GAIN,
  MAX_TOTAL_CLIPS,
  MAX_TRACKS,
} from '../../services/ffmpeg/audio-mix';

/** Longest timeline the mix may address (10 hours) — far past any real episode. */
const MAX_SEC = 36_000;

const audioClipSchema = z.object({
  id: z.string().min(1).max(64),
  url: z.string().url().max(2048),
  label: z.string().max(120).default(''),
  start: z.number().min(0).max(MAX_SEC),
  trimStart: z.number().min(0).max(MAX_SEC).default(0),
  length: z.number().min(0.1).max(MAX_SEC),
  volume: z.number().min(0).max(MAX_GAIN).default(1),
  fadeIn: z.number().min(0).max(60).default(0),
  fadeOut: z.number().min(0).max(60).default(0),
  loop: z.boolean().optional(),
  sourceDuration: z.number().positive().max(MAX_SEC).optional(),
});

const audioTrackSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(40).default(''),
  kind: z.enum(['music', 'voice', 'sfx', 'audio']).default('audio'),
  volume: z.number().min(0).max(MAX_GAIN).default(1),
  muted: z.boolean().default(false),
  solo: z.boolean().default(false),
  clips: z.array(audioClipSchema).max(MAX_CLIPS_PER_TRACK),
});

const channelSchema = z.object({
  volume: z.number().min(0).max(MAX_GAIN).default(1),
  muted: z.boolean().default(false),
  solo: z.boolean().default(false),
});

export const audioMixSchema = z
  .object({
    tracks: z.array(audioTrackSchema).max(MAX_TRACKS),
    mixer: z
      .object({
        video: channelSchema.default({ volume: 1, muted: false, solo: false }),
        master: z.number().min(0).max(MAX_GAIN).default(1),
      })
      .default({ video: { volume: 1, muted: false, solo: false }, master: 1 }),
  })
  .refine((m) => m.tracks.reduce((n, t) => n + t.clips.length, 0) <= MAX_TOTAL_CLIPS, {
    message: `An episode can mix at most ${MAX_TOTAL_CLIPS} audio clips`,
  });

export type AudioMixInput = z.infer<typeof audioMixSchema>;
