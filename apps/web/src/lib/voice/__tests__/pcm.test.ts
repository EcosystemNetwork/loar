import { describe, it, expect } from 'vitest';
import {
  MicChunker,
  bytesToInt16,
  floatToInt16,
  int16ToBytes,
  int16ToFloat,
  resample,
  rms,
} from '../pcm';

describe('PCM conversion', () => {
  it('clamps out-of-range floats instead of wrapping', () => {
    expect(Array.from(floatToInt16(Float32Array.from([2, -2, 1, -1, 0])))).toEqual([
      32767, -32768, 32767, -32768, 0,
    ]);
  });

  it('round-trips within one quantisation step', () => {
    const input = Float32Array.from([0.5, -0.5, 0.123, -0.987, 0]);
    const back = int16ToFloat(floatToInt16(input));
    input.forEach((v, i) => expect(Math.abs(back[i] - v)).toBeLessThan(1 / 16000));
  });

  it('serialises little-endian regardless of host byte order', () => {
    expect(Array.from(int16ToBytes(Int16Array.from([0x1234, -2])))).toEqual([
      0x34, 0x12, 0xfe, 0xff,
    ]);
    expect(Array.from(bytesToInt16(Uint8Array.from([0x34, 0x12, 0xfe, 0xff])))).toEqual([
      0x1234, -2,
    ]);
  });

  it('reads correctly from a subarray with a non-zero byteOffset and drops a trailing odd byte', () => {
    const backing = Uint8Array.from([9, 9, 0x01, 0x00, 0x02, 0x00, 0x07]);
    expect(Array.from(bytesToInt16(backing.subarray(2)))).toEqual([1, 2]);
  });
});

describe('resample', () => {
  it('passes through at equal rates', () => {
    const x = Float32Array.from([1, 2, 3]);
    expect(resample(x, 16000, 16000)).toBe(x);
  });

  it('downsamples 48k→16k to a third the length, preserving DC level', () => {
    const out = resample(new Float32Array(4800).fill(0.25), 48000, 16000);
    expect(out.length).toBe(1600);
    out.forEach((v) => expect(v).toBeCloseTo(0.25, 6));
  });

  it('handles fractional ratios (44.1k→16k) without reading past the input', () => {
    const out = resample(new Float32Array(4410).fill(1), 44100, 16000);
    expect(out.length).toBe(Math.floor(4410 / (44100 / 16000)));
    out.forEach((v) => expect(v).toBeCloseTo(1, 6));
  });

  it('low-passes: a 12 kHz tone (above the 8 kHz Nyquist of 16 kHz audio) is attenuated, not aliased at full strength', () => {
    const n = 4800;
    const tone = new Float32Array(n).map((_, i) => Math.sin((2 * Math.PI * 12000 * i) / 48000));
    expect(rms(resample(tone, 48000, 16000))).toBeLessThan(rms(tone) * 0.5);
  });

  it('keeps an in-band tone: 1 kHz survives 48k→16k nearly intact', () => {
    const tone = new Float32Array(4800).map((_, i) => Math.sin((2 * Math.PI * 1000 * i) / 48000));
    expect(rms(resample(tone, 48000, 16000))).toBeGreaterThan(rms(tone) * 0.9);
  });
});

describe('MicChunker', () => {
  it('emits fixed 20 ms chunks at the target rate and carries the remainder', () => {
    const chunker = new MicChunker(48000, 16000, 20); // 960 in → 320 out
    let out = 0;
    let chunks = 0;
    for (let i = 0; i < 60; i++) {
      // 60 × 128 = 7680 samples = exactly 8 chunks
      for (const c of chunker.push(new Float32Array(128).fill(0.1))) {
        expect(c.length).toBe(320);
        out += c.length;
        chunks++;
      }
    }
    expect(chunks).toBe(8);
    expect(out).toBe(2560);
  });

  it('does not lose audio across block boundaries', () => {
    const chunker = new MicChunker(48000, 16000, 20);
    const emitted: number[] = [];
    // One ramp split into odd-sized blocks; DC-ish ramp lets us check ordering survives.
    const ramp = Float32Array.from({ length: 1920 }, (_, i) => i / 1920);
    let offset = 0;
    for (const size of [700, 500, 720]) {
      for (const c of chunker.push(ramp.subarray(offset, offset + size))) emitted.push(...c);
      offset += size;
    }
    expect(emitted.length).toBe(640); // 2 full chunks
    for (let i = 1; i < emitted.length; i++)
      expect(emitted[i]).toBeGreaterThanOrEqual(emitted[i - 1]);
  });
});
