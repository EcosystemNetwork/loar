/**
 * Thin Gemini wrapper tailored for the VLM subsystem.
 *
 * Responsibilities:
 *  - Handle both text-only and media-inclusive generateContent calls
 *  - Upload videos via File API with processing-state polling
 *  - Parse + validate JSON responses via caller-supplied Zod schemas
 *  - Report calibrated token + USD costs
 *
 * The existing `services/gemini.ts` already has analogous helpers for the
 * wiki-generation path. We keep this module separate so VLM-specific prompts
 * and schemas stay isolated from the original generation pipeline.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAIFileManager } from '@google/generative-ai/server';
import type { z } from 'zod';
import { validateUploadUrl } from '../../lib/url-validator';
import type { CostSummary, VlmModel } from './types';
import { recordProviderCost, assertProviderAllowed } from '../cost-tracker';

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY || 'missing');
const fileManager = new GoogleAIFileManager(GOOGLE_API_KEY || 'missing');

function ensureKey() {
  if (!GOOGLE_API_KEY) {
    throw new Error('GOOGLE_API_KEY is required for VLM features');
  }
}

const FILE_PROCESSING_TIMEOUT_MS = 5 * 60 * 1000;
const DOWNLOAD_TIMEOUT_MS = 60_000;

const PRICE_USD_PER_1M_IN: Record<VlmModel, number> = {
  'gemini-2.5-pro': 1.25,
  'gemini-2.5-flash': 0.075,
};

const PRICE_USD_PER_1M_OUT: Record<VlmModel, number> = {
  'gemini-2.5-pro': 10.0,
  'gemini-2.5-flash': 0.3,
};

function stripFences(text: string): string {
  let t = text.trim();
  if (t.startsWith('```json')) {
    t = t.split('```json')[1]?.split('```')[0]?.trim() ?? t;
  } else if (t.startsWith('```')) {
    t = t.split('```')[1]?.split('```')[0]?.trim() ?? t;
  }
  return t;
}

export async function downloadToBuffer(url: string): Promise<Buffer> {
  await validateUploadUrl(url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`Failed to fetch media: ${res.status} ${res.statusText}`);
    }
    const ab = await res.arrayBuffer();
    return Buffer.from(new Uint8Array(ab));
  } finally {
    clearTimeout(timeout);
  }
}

export interface GeminiFilePart {
  fileData: {
    mimeType: string;
    fileUri: string;
  };
}

export async function uploadFileAndWait(
  buffer: Buffer,
  mimeType: string,
  displayName: string
): Promise<GeminiFilePart> {
  ensureKey();
  const uploadResult = await fileManager.uploadFile(buffer, {
    mimeType,
    displayName,
  });
  let file = uploadResult.file;
  const deadline = Date.now() + FILE_PROCESSING_TIMEOUT_MS;
  while (file.state === 'PROCESSING') {
    if (Date.now() > deadline) {
      throw new Error('Media processing timed out after 5 minutes');
    }
    await new Promise((r) => setTimeout(r, 2000));
    file = await fileManager.getFile(file.name);
  }
  if (file.state === 'FAILED') {
    throw new Error('Media processing failed');
  }
  return { fileData: { mimeType: file.mimeType, fileUri: file.uri } };
}

export type MediaPart = GeminiFilePart | { inlineData: { mimeType: string; data: string } };

export interface CallJsonArgs<T> {
  model: VlmModel;
  system?: string;
  prompt: string;
  media?: MediaPart[];
  schema: z.ZodType<T>;
  label: string;
}

export interface JsonResult<T> {
  data: T;
  cost: CostSummary;
  raw: string;
}

export async function callJson<T>(args: CallJsonArgs<T>): Promise<JsonResult<T>> {
  ensureKey();
  // Admin kill-switch + cap preflight. Throws ProviderPausedError / CostCapExceededError.
  await assertProviderAllowed({ provider: 'gemini' });
  const m = genAI.getGenerativeModel({
    model: args.model,
    ...(args.system ? { systemInstruction: args.system } : {}),
  });
  const parts: any[] = [];
  if (args.media) {
    for (const mp of args.media) parts.push(mp);
  }
  parts.push({ text: args.prompt });
  const result = await m.generateContent(parts);
  const response = result.response;
  const text = response.text();
  const usage = response.usageMetadata;
  const inputTokens = usage?.promptTokenCount ?? 0;
  const outputTokens = usage?.candidatesTokenCount ?? 0;
  const tokensUsed = usage?.totalTokenCount ?? inputTokens + outputTokens;
  const costUsd =
    (inputTokens / 1_000_000) * PRICE_USD_PER_1M_IN[args.model] +
    (outputTokens / 1_000_000) * PRICE_USD_PER_1M_OUT[args.model];

  // Always record cost even on parse failure — the API call happened and we
  // were billed. Scope is picked up from AsyncLocalStorage (set by tRPC/worker).
  await recordProviderCost({
    provider: 'gemini',
    model: args.model,
    kind: 'vlm',
    costUsd,
    inputTokens,
    outputTokens,
    tokensUsed,
    extra: { label: args.label },
  });

  const stripped = stripFences(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch (err) {
    throw new Error(
      `VLM ${args.label}: invalid JSON from ${args.model}: ${(err as Error).message}\nRaw: ${stripped.slice(0, 400)}`
    );
  }
  const result2 = args.schema.safeParse(parsed);
  if (!result2.success) {
    throw new Error(
      `VLM ${args.label}: schema validation failed: ${result2.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`
    );
  }
  return {
    data: result2.data,
    cost: {
      tokensUsed,
      inputTokens,
      outputTokens,
      costUsd,
      model: args.model,
    },
    raw: stripped,
  };
}

export async function callText(args: {
  model: VlmModel;
  prompt: string;
  media?: MediaPart[];
  label: string;
}): Promise<{ text: string; cost: CostSummary }> {
  ensureKey();
  await assertProviderAllowed({ provider: 'gemini' });
  const m = genAI.getGenerativeModel({ model: args.model });
  const parts: any[] = [];
  if (args.media) for (const mp of args.media) parts.push(mp);
  parts.push({ text: args.prompt });
  const result = await m.generateContent(parts);
  const response = result.response;
  const text = response.text().trim();
  const usage = response.usageMetadata;
  const inputTokens = usage?.promptTokenCount ?? 0;
  const outputTokens = usage?.candidatesTokenCount ?? 0;
  const tokensUsed = usage?.totalTokenCount ?? inputTokens + outputTokens;
  const costUsd =
    (inputTokens / 1_000_000) * PRICE_USD_PER_1M_IN[args.model] +
    (outputTokens / 1_000_000) * PRICE_USD_PER_1M_OUT[args.model];
  await recordProviderCost({
    provider: 'gemini',
    model: args.model,
    kind: 'vlm',
    costUsd,
    inputTokens,
    outputTokens,
    tokensUsed,
    extra: { label: args.label },
  });
  return {
    text,
    cost: { tokensUsed, inputTokens, outputTokens, costUsd, model: args.model },
  };
}

export function guessMimeType(assetType: 'video' | 'image' | 'audio', fallback?: string): string {
  if (fallback) return fallback;
  if (assetType === 'video') return 'video/mp4';
  if (assetType === 'image') return 'image/png';
  return 'audio/mpeg';
}

export async function mediaPartFromUrl(
  url: string,
  assetType: 'video' | 'image' | 'audio',
  mimeType?: string
): Promise<MediaPart> {
  const mime = guessMimeType(assetType, mimeType);
  if (assetType === 'image') {
    const buf = await downloadToBuffer(url);
    return {
      inlineData: { mimeType: mime, data: buf.toString('base64') },
    };
  }
  const buf = await downloadToBuffer(url);
  const displayName = `vlm-${Date.now()}-${assetType}`;
  return uploadFileAndWait(buf, mime, displayName);
}
