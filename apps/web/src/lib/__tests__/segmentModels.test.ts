import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  SEGMENT_SERVER_MODEL_IDS,
  aspectRatioToImageSize,
  resolveSegmentVideoModel,
} from '../segmentModels';

describe('resolveSegmentVideoModel', () => {
  it('picks the text or image variant by whether a source image exists', () => {
    expect(resolveSegmentVideoModel('fal-kling', false)).toBe(
      'fal-ai/kling-video/v2.5-turbo/pro/text-to-video'
    );
    expect(resolveSegmentVideoModel('fal-kling', true)).toBe(
      'fal-ai/kling-video/v2.5-turbo/pro/image-to-video'
    );
    expect(resolveSegmentVideoModel('seedance-fast', true)).toBe(
      'bytedance/seedance-2.0/fast/image-to-video'
    );
  });

  it('passes Google-direct Veo ids through in both modes', () => {
    expect(resolveSegmentVideoModel('veo-31-fast-preview-google', false)).toBe(
      'veo-31-fast-preview-google'
    );
    expect(resolveSegmentVideoModel('veo-31-fast-preview-google', true)).toBe(
      'veo-31-fast-preview-google'
    );
  });
});

describe('aspectRatioToImageSize', () => {
  it('maps each video aspect to an imageToImage preset', () => {
    expect(aspectRatioToImageSize('16:9')).toBe('landscape_16_9');
    expect(aspectRatioToImageSize('9:16')).toBe('portrait_16_9');
    expect(aspectRatioToImageSize('1:1')).toBe('square_hd');
  });
});

describe('server enum drift guard', () => {
  it('every mapped id is accepted by generation.generateVideo', () => {
    const src = readFileSync(
      resolve(__dirname, '../../../../server/src/routers/generation/generation.routes.ts'),
      'utf8'
    );
    const start = src.indexOf('generateVideo: protectedProcedure');
    expect(start).toBeGreaterThan(-1);
    const enumBlock = src.slice(start, start + 3000);
    for (const id of SEGMENT_SERVER_MODEL_IDS) {
      expect(enumBlock, `server enum is missing ${id}`).toContain(`'${id}'`);
    }
  });
});
