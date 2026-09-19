/**
 * PCM helpers for the live voice client. Pure functions so the parts most
 * likely to produce silent garbage (endianness, clipping, resampling) are
 * unit-tested rather than discovered by ear.
 */

/** Float [-1,1] → signed 16-bit, clamped so loud input clips instead of wrapping. */
export function floatToInt16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}

export function int16ToFloat(input: Int16Array): Float32Array {
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) out[i] = input[i] / (input[i] < 0 ? 0x8000 : 0x7fff);
  return out;
}

/** Int16 samples → little-endian bytes (what the wire carries), independent of host endianness. */
export function int16ToBytes(samples: Int16Array): Uint8Array {
  const out = new Uint8Array(samples.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < samples.length; i++) view.setInt16(i * 2, samples[i], true);
  return out;
}

/** Little-endian bytes → Int16 samples. A trailing odd byte is dropped. */
export function bytesToInt16(bytes: Uint8Array): Int16Array {
  const count = Math.floor(bytes.length / 2);
  const out = new Int16Array(count);
  const view = new DataView(bytes.buffer, bytes.byteOffset, count * 2);
  for (let i = 0; i < count; i++) out[i] = view.getInt16(i * 2, true);
  return out;
}

/**
 * Box-filter resampler (each output sample is the weighted mean of the input
 * span it covers). The averaging doubles as an anti-alias low-pass when
 * downsampling, which is the mic path's only use (device rate → 16 kHz).
 */
export function resample(input: Float32Array, inRate: number, outRate: number): Float32Array {
  if (inRate === outRate) return input;
  const ratio = inRate / outRate;
  const outLength = Math.floor(input.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const start = i * ratio;
    const end = start + ratio;
    let sum = 0;
    let weight = 0;
    for (let j = Math.floor(start); j < Math.ceil(end) && j < input.length; j++) {
      const w = Math.min(j + 1, end) - Math.max(j, start);
      sum += input[j] * w;
      weight += w;
    }
    out[i] = weight > 0 ? sum / weight : 0;
  }
  return out;
}

/** Root-mean-square level in [0,1], for the mic meter. */
export function rms(input: Float32Array): number {
  if (input.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
  return Math.sqrt(sum / input.length);
}

/**
 * Accumulates variable-size mic blocks (an AudioWorklet delivers 128-sample
 * quanta) and emits fixed-duration chunks at the target rate, carrying the
 * unconsumed remainder across calls so no audio is dropped at boundaries.
 */
export class MicChunker {
  private pending = new Float32Array(0);

  constructor(
    private readonly inRate: number,
    private readonly outRate: number,
    private readonly chunkMs: number
  ) {}

  push(block: Float32Array): Int16Array[] {
    const merged = new Float32Array(this.pending.length + block.length);
    merged.set(this.pending);
    merged.set(block, this.pending.length);

    const inChunk = Math.round((this.inRate * this.chunkMs) / 1000);
    const chunks: Int16Array[] = [];
    let offset = 0;
    while (merged.length - offset >= inChunk) {
      chunks.push(
        floatToInt16(resample(merged.subarray(offset, offset + inChunk), this.inRate, this.outRate))
      );
      offset += inChunk;
    }
    this.pending = merged.slice(offset);
    return chunks;
  }
}
