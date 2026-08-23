/**
 * ComfyUI Local Video Generation Service — self-hosted, $0 inference.
 *
 * Talks to a ComfyUI server you run on your own GPU (default
 * http://127.0.0.1:8188). Nothing leaves your machine, so generations are
 * free. The LOAR server fetches the resulting clip from ComfyUI's local
 * `/view` endpoint and pins it to IPFS via the normal persist pipeline — the
 * fact that the source URL is localhost is fine because the server runs on
 * the same box as ComfyUI.
 *
 * Flow (mirrors every other provider so the caller gets the same shape):
 *   1. (i2v only) POST /upload/image      → upload the reference frame
 *   2. POST /prompt                       → queue a workflow, returns prompt_id
 *   3. GET  /history/{prompt_id}          → poll until the node graph finishes
 *   4. build a /view?filename=... URL for the saved video
 *
 * The workflow itself is NOT hardcoded — node graphs differ per model and per
 * ComfyUI version. Instead we load a workflow exported from ComfyUI in
 * "API format" (Settings → enable dev mode → "Save (API Format)") and inject
 * the runtime values by replacing placeholder tokens:
 *
 *   %prompt%            positive prompt
 *   %negative_prompt%   negative prompt
 *   %width% %height%    resolution
 *   %length%            frame count (duration * fps)
 *   %seed%              random-ish seed (derived from prompt_id-free counter)
 *   %image%             uploaded reference filename (i2v only)
 *
 * Configure which workflow file to use via env:
 *   COMFYUI_BASE_URL            default http://127.0.0.1:8188
 *   COMFYUI_WORKFLOW_T2V_PATH   text-to-video workflow (API format JSON)
 *   COMFYUI_WORKFLOW_I2V_PATH   image-to-video workflow (API format JSON)
 *
 * If the *_PATH vars are unset we fall back to the bundled LTX-Video templates
 * in ./comfyui-workflows/. Those assume a standard LTX + VideoHelperSuite
 * install — adjust the model filenames inside them (or export your own) to
 * match your ComfyUI.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeFetch } from '../lib/url-validator';

// The server runs as ESM, where `__dirname` is undefined — derive it from the
// module URL (same approach as lib/firebase.ts) so the bundled workflow
// templates in ./comfyui-workflows/ resolve.
const moduleDir = dirname(fileURLToPath(import.meta.url));

const DEFAULT_BASE_URL = 'http://127.0.0.1:8188';
const POLL_INTERVAL_MS = 3_000;
const POLL_MAX_ATTEMPTS = 400; // ~20 min ceiling — local video can be slow

/** Video file extensions ComfyUI save nodes may emit. */
const VIDEO_EXTS = ['.mp4', '.webm', '.mkv', '.gif', '.webp', '.mov'];

function baseUrl(): string {
  return (process.env.COMFYUI_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
}

export interface ComfyVideoOptions {
  prompt: string;
  negativePrompt?: string;
  /** Reference frame URL for image-to-video. */
  imageUrl?: string;
  mode: 'text_to_video' | 'image_to_video';
  durationSec?: number;
  /** Frames per second the workflow renders at (used to derive %length%). */
  fps?: number;
  width?: number;
  height?: number;
  seed?: number;
  /** Explicit workflow template (API-format JSON string). Overrides file/default. */
  workflowJson?: string;
}

export interface ComfyVideoResult {
  id: string;
  status: 'completed' | 'failed';
  videoUrl?: string;
  error?: string;
}

/** Map an aspect-ratio-ish resolution string to width/height defaults. */
function resolveDimensions(width?: number, height?: number): { width: number; height: number } {
  // LTX wants dimensions divisible by 32. 768x512 is a safe 12GB-friendly default.
  const w = width && width > 0 ? width : 768;
  const h = height && height > 0 ? height : 512;
  const round32 = (n: number) => Math.max(32, Math.round(n / 32) * 32);
  return { width: round32(w), height: round32(h) };
}

async function loadWorkflowTemplate(mode: ComfyVideoOptions['mode']): Promise<string> {
  const envPath =
    mode === 'image_to_video'
      ? process.env.COMFYUI_WORKFLOW_I2V_PATH
      : process.env.COMFYUI_WORKFLOW_T2V_PATH;

  if (envPath) {
    return readFile(envPath, 'utf8');
  }

  // Default to Wan 2.2 TI2V-5B (verified working on a 16GB GPU). LTX templates
  // remain in ./comfyui-workflows/ as a lighter alternative — point the
  // COMFYUI_WORKFLOW_*_PATH env vars at them (or your own export) to switch.
  const bundled = mode === 'image_to_video' ? 'wan-i2v.json' : 'wan-t2v.json';
  return readFile(join(moduleDir, 'comfyui-workflows', bundled), 'utf8');
}

/** Replace %token% placeholders. Numeric tokens are injected unquoted. */
function injectPlaceholders(template: string, values: Record<string, string | number>): string {
  let out = template;
  for (const [key, value] of Object.entries(values)) {
    const token = `%${key}%`;
    if (typeof value === 'number') {
      // Numbers may sit either bare (`"length": %length%`) or quoted in the
      // exported JSON (`"length": "%length%"`). Handle the quoted form first
      // so we don't leave a stray pair of quotes around a number.
      out = out.split(`"${token}"`).join(String(value));
      out = out.split(token).join(String(value));
    } else {
      // Strings land inside JSON string literals — escape accordingly.
      const safe = JSON.stringify(value).slice(1, -1);
      out = out.split(token).join(safe);
    }
  }
  return out;
}

/** Upload a reference image to ComfyUI's input folder; returns the filename. */
async function uploadImage(imageUrl: string): Promise<string> {
  // SEC-3: imageUrl is client-supplied (generation.routes.ts `imageUrl` input)
  // — fetch it through the SSRF-safe helper (private-IP/loopback/metadata
  // block + DNS-rebinding pin), same as every other server-side fetch of a
  // user-supplied URL in this codebase. A raw `fetch()` here let an attacker
  // point the server at internal/cloud-metadata hosts.
  const res = await safeFetch(imageUrl);
  if (!res.ok) throw new Error(`Failed to fetch reference image (${res.status})`);
  const buf = Buffer.from(new Uint8Array(await res.arrayBuffer()));

  const form = new FormData();
  const blob = new Blob([buf], { type: res.headers.get('content-type') || 'image/png' });
  form.append('image', blob, 'loar-ref.png');
  form.append('overwrite', 'true');

  const up = await fetch(`${baseUrl()}/upload/image`, { method: 'POST', body: form });
  if (!up.ok) throw new Error(`ComfyUI /upload/image failed (${up.status})`);
  const data = (await up.json()) as { name?: string; subfolder?: string };
  if (!data.name) throw new Error('ComfyUI upload returned no filename');
  return data.subfolder ? `${data.subfolder}/${data.name}` : data.name;
}

/** Scan a /history outputs object for the first video-like file. */
function findVideoOutput(
  outputs: Record<string, any>
): { filename: string; subfolder: string; type: string } | null {
  for (const node of Object.values(outputs)) {
    // VHS uses `gifs`; native nodes use `images`/`videos`. Check them all.
    const candidates = [
      ...((node as any).gifs ?? []),
      ...((node as any).videos ?? []),
      ...((node as any).images ?? []),
    ];
    for (const f of candidates) {
      const name: string = f?.filename ?? '';
      if (VIDEO_EXTS.some((ext) => name.toLowerCase().endsWith(ext))) {
        return { filename: name, subfolder: f.subfolder ?? '', type: f.type ?? 'output' };
      }
    }
  }
  return null;
}

class ComfyUIService {
  /**
   * Queue a workflow and block until it produces a video. Returns the same
   * `{ id, status, videoUrl, error }` shape as the FAL/ByteDance/Veo services.
   */
  async generateVideo(options: ComfyVideoOptions): Promise<ComfyVideoResult> {
    try {
      const { width, height } = resolveDimensions(options.width, options.height);
      const fps = options.fps && options.fps > 0 ? options.fps : 25;
      const durationSec = options.durationSec && options.durationSec > 0 ? options.durationSec : 5;
      // LTX wants (frames - 1) divisible by 8; keep it simple and clamp.
      const rawLen = Math.round(durationSec * fps);
      const length = Math.max(9, Math.round((rawLen - 1) / 8) * 8 + 1);
      const seed = options.seed ?? (Date.parse('2026-01-01') % 1_000_000) + length * width;

      let imageName = '';
      if (options.mode === 'image_to_video') {
        if (!options.imageUrl) {
          return { id: '', status: 'failed', error: 'image_to_video requires an imageUrl' };
        }
        imageName = await uploadImage(options.imageUrl);
      }

      const template = options.workflowJson ?? (await loadWorkflowTemplate(options.mode));
      const injected = injectPlaceholders(template, {
        prompt: options.prompt,
        negative_prompt:
          options.negativePrompt ??
          'low quality, worst quality, deformed, distorted, blurry, jpeg artifacts',
        width,
        height,
        length,
        seed,
        image: imageName,
      });

      let workflow: Record<string, unknown>;
      try {
        workflow = JSON.parse(injected);
      } catch (e) {
        return {
          id: '',
          status: 'failed',
          error: `ComfyUI workflow template is not valid JSON after injection: ${
            (e as Error).message
          }`,
        };
      }

      // Queue it.
      const queueRes = await fetch(`${baseUrl()}/prompt`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: workflow }),
      });
      if (!queueRes.ok) {
        const body = await queueRes.text().catch(() => '');
        return {
          id: '',
          status: 'failed',
          error: `ComfyUI /prompt rejected the workflow (${queueRes.status}): ${body.slice(0, 500)}`,
        };
      }
      const { prompt_id: promptId } = (await queueRes.json()) as { prompt_id?: string };
      if (!promptId) {
        return { id: '', status: 'failed', error: 'ComfyUI did not return a prompt_id' };
      }

      // Poll history until the graph finishes.
      for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        const hres = await fetch(`${baseUrl()}/history/${promptId}`);
        if (!hres.ok) continue;
        const history = (await hres.json()) as Record<string, any>;
        const entry = history[promptId];
        if (!entry) continue;

        const statusStr: string = entry.status?.status_str ?? '';
        if (statusStr === 'error') {
          return {
            id: promptId,
            status: 'failed',
            error: 'ComfyUI workflow errored — check the ComfyUI console for the failing node',
          };
        }

        if (entry.outputs && Object.keys(entry.outputs).length > 0) {
          const out = findVideoOutput(entry.outputs);
          if (out) {
            const url = `${baseUrl()}/view?filename=${encodeURIComponent(
              out.filename
            )}&subfolder=${encodeURIComponent(out.subfolder)}&type=${encodeURIComponent(out.type)}`;
            return { id: promptId, status: 'completed', videoUrl: url };
          }
        }
      }

      return {
        id: promptId,
        status: 'failed',
        error: `ComfyUI polling timed out after ${(POLL_MAX_ATTEMPTS * POLL_INTERVAL_MS) / 1000}s`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'ComfyUI request failed';
      // Connection refused → server isn't running. Make that actionable.
      const hint = /ECONNREFUSED|fetch failed|ENOTFOUND/i.test(msg)
        ? ` — is ComfyUI running at ${baseUrl()}? Start it with: python main.py --listen`
        : '';
      return { id: '', status: 'failed', error: `${msg}${hint}` };
    }
  }
}

export const comfyUIService = new ComfyUIService();
