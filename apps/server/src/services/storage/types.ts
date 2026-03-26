import { createHash } from "crypto";

// ─── Core Types ──────────────────────────────────────────────

export interface UploadResult {
  provider: string;
  contentId: string; // Provider-specific (blobId, CID, pieceCid, key)
  contentHash: string; // SHA-256 hex of raw content (canonical ID)
  url: string;
  size: number;
}

export interface StorageManifest {
  contentHash: string;
  uploads: UploadResult[];
  originalFilename?: string;
  mimeType: string;
  size: number;
  createdAt: number;
}

export interface ProviderStatus {
  name: string;
  status: "pending" | "uploading" | "completed" | "failed";
  contentId?: string;
  url?: string;
  error?: string;
}

// ─── Provider Interface ──────────────────────────────────────

export interface StorageProvider {
  readonly name: string;
  readonly priority: number;

  isAvailable(): boolean;
  upload(
    buffer: Buffer,
    filename: string,
    mimeType?: string
  ): Promise<UploadResult>;
  uploadFromUrl(url: string, filename?: string): Promise<UploadResult>;
  download(contentId: string): Promise<Uint8Array>;
  getPublicUrl(contentId: string): string;
}

// ─── Helpers ─────────────────────────────────────────────────

export function computeSha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export function sha256ToBytes32(hex: string): `0x${string}` {
  return `0x${hex}` as `0x${string}`;
}

/** Fetch a URL into a Buffer with timeout + size limits. */
export async function fetchToBuffer(
  url: string,
  timeoutMs = 30_000,
  maxBytes = 200 * 1024 * 1024
): Promise<{ buffer: Buffer; contentType: string }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; LOARStorage/1.0)",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    if (buffer.length === 0) {
      throw new Error("Empty response body");
    }
    if (buffer.length > maxBytes) {
      throw new Error(
        `File too large: ${Math.round(buffer.length / 1024 / 1024)}MB (max ${Math.round(maxBytes / 1024 / 1024)}MB)`
      );
    }

    const contentType =
      response.headers.get("content-type") || "application/octet-stream";
    return { buffer, contentType };
  } finally {
    clearTimeout(timeoutId);
  }
}

export function getMimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    json: "application/json",
    txt: "text/plain",
  };
  return mimeTypes[ext || ""] || "application/octet-stream";
}
