import { db } from "../lib/firebase";
import { getStorage } from "firebase-admin/storage";

const BUCKET_NAME = process.env.FIREBASE_STORAGE_BUCKET || "";

class StorageService {
  private static instance: StorageService | null = null;
  private bucket;

  private constructor() {
    this.bucket = getStorage().bucket(BUCKET_NAME);
  }

  static getInstance(): StorageService {
    if (!this.instance) {
      this.instance = new StorageService();
    }
    return this.instance;
  }

  async upload(buffer: Buffer, filename: string): Promise<string> {
    const key = `videos/${filename}`;
    const file = this.bucket.file(key);

    await file.save(buffer, {
      contentType: this.getContentType(filename),
      metadata: { cacheControl: "public, max-age=31536000" },
    });

    await file.makePublic();

    return key;
  }

  async uploadFromUrl(url: string, filename?: string): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; LOARUploader/1.0)" },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const urlFilename =
      filename ||
      url.split("/").pop()?.split("?")[0] ||
      `video-${Date.now()}.mp4`;

    return await this.upload(buffer, urlFilename);
  }

  async download(key: string): Promise<Uint8Array> {
    if (!key || key.length < 1) {
      throw new Error(`Invalid key: ${key}`);
    }

    const file = this.bucket.file(key);
    const [data] = await file.download();

    if (data.length === 0) {
      throw new Error(`Empty file for key: ${key}`);
    }

    if (data.length > 200 * 1024 * 1024) {
      throw new Error(
        `File too large: ${Math.round(data.length / 1024 / 1024)}MB`
      );
    }

    return new Uint8Array(data);
  }

  getPublicUrl(key: string): string {
    return `https://storage.googleapis.com/${BUCKET_NAME}/${key}`;
  }

  async exists(key: string): Promise<boolean> {
    try {
      const [exists] = await this.bucket.file(key).exists();
      return exists;
    } catch {
      return false;
    }
  }

  private getContentType(filename: string): string {
    const ext = filename.split(".").pop()?.toLowerCase();
    const mimeTypes: Record<string, string> = {
      mp4: "video/mp4",
      webm: "video/webm",
      mov: "video/quicktime",
      avi: "video/x-msvideo",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
      json: "application/json",
      txt: "text/plain",
    };
    return mimeTypes[ext || ""] || "application/octet-stream";
  }
}

// Keep the same export name so all imports still work
export const minioService = StorageService.getInstance();
