/**
 * Ingest local media into Pinata + Firestore.
 *
 * Walks one or more source directories, uploads each media file to Pinata,
 * writes a `storageManifests` doc for dedup, and writes a `content` doc so
 * the file appears in the gallery. SHA-256 is the canonical ID: files
 * already ingested (present in `storageManifests`) are skipped.
 *
 * Usage:
 *   DRY_RUN=1 pnpm tsx scripts/ingest-local-outputs.ts     # list what would upload
 *   pnpm tsx scripts/ingest-local-outputs.ts               # run
 *
 * Env:
 *   PINATA_JWT                       (required)
 *   PINATA_GATEWAY_URL               (optional)
 *   FIREBASE_SERVICE_ACCOUNT_PATH    (default: firebase-sa-key-20260416.json)
 *   INGEST_SOURCES                   CSV override (absolute or relative dirs)
 *   INGEST_CREATOR_UID               creatorUid for content docs (default: 'recovery')
 *   INGEST_CONCURRENCY               parallel uploads (default: 3)
 *   INGEST_MAX_FILES                 cap for smoke-test runs
 *   INGEST_DEFAULT_UNIVERSE_ID       attach universeId to every doc
 *   DRY_RUN=1                        enumerate + stat only, no uploads
 *
 * Resumable: writes `ingest-log.json` at the repo root keyed by contentHash.
 * A file already in the log (or in Firestore `storageManifests`) is skipped.
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { createHash } from 'crypto';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue, Firestore } from 'firebase-admin/firestore';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// ── Config ───────────────────────────────────────────────────────────────

const PINATA_JWT = process.env.PINATA_JWT;
const PINATA_GATEWAY = (process.env.PINATA_GATEWAY_URL ?? 'https://gateway.pinata.cloud').replace(
  /\/$/,
  ''
);
const DRY_RUN = process.env.DRY_RUN === '1';
const CONCURRENCY = Math.max(1, parseInt(process.env.INGEST_CONCURRENCY ?? '3', 10));
const CREATOR_UID = process.env.INGEST_CREATOR_UID ?? 'recovery';
const DEFAULT_UNIVERSE_ID = process.env.INGEST_DEFAULT_UNIVERSE_ID || null;
const MAX_FILES = parseInt(process.env.INGEST_MAX_FILES ?? '0', 10); // 0 = no cap
const LOG_PATH = path.resolve(process.cwd(), 'ingest-log.json');

const HOME = process.env.HOME ?? '~';
const DEFAULT_SOURCES = [
  // Local output directories (only if present on disk)
  'vacation-bunny-output',
  'monerochan-audio-output',
  'monerochan-audio-output-episode-1-animated',
  'firstproof-output',
  // Recovery extracts (populated by the recovery step from git history)
  path.join(HOME, 'loar-recovered/cyberwar-output'),
  path.join(HOME, 'loar-recovered/voidborn-output'),
  path.join(HOME, 'loar-recovered/spacefleet-output'),
  path.join(HOME, 'loar-recovered/firstproof-output'),
  path.join(HOME, 'loar-recovered/monerochan-audio-output_git'),
  path.join(HOME, 'loar-recovered/monerochan-audio-output-episode-1-animated_git'),
];
const SOURCES = (process.env.INGEST_SOURCES?.split(',').filter(Boolean) ?? DEFAULT_SOURCES).map(
  (p) => (path.isAbsolute(p) ? p : path.resolve(process.cwd(), p))
);

const MEDIA_EXT = new Set([
  'mp4',
  'webm',
  'mov',
  'm4v',
  'mp3',
  'wav',
  'm4a',
  'flac',
  'ogg',
  'aiff',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
]);

const MIME: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  m4v: 'video/mp4',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  aiff: 'audio/aiff',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

// ── Types ────────────────────────────────────────────────────────────────

interface LogEntry {
  contentHash: string;
  filename: string;
  source: string;
  size: number;
  mimeType: string;
  cid: string;
  mediaUrl: string;
  contentDocId: string | null;
  completedAt: string;
}

interface IngestLog {
  entries: Record<string, LogEntry>;
}

interface Task {
  abs: string;
  rel: string;
  sourceRoot: string;
  size: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function mimeOf(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return MIME[ext] ?? 'application/octet-stream';
}

function mediaTypeOf(mime: string): 'video' | 'audio' | 'image' {
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'image';
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function walkMedia(root: string): Task[] {
  const out: Task[] = [];
  if (!fs.existsSync(root)) return out;
  const stat = fs.statSync(root);
  if (!stat.isDirectory()) return out;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!e.isFile()) continue;
      const ext = e.name.split('.').pop()?.toLowerCase() ?? '';
      if (!MEDIA_EXT.has(ext)) continue;
      let size = 0;
      try {
        size = fs.statSync(full).size;
      } catch {
        continue;
      }
      if (size === 0) continue; // skip empty
      out.push({ abs: full, rel: path.relative(root, full), sourceRoot: root, size });
    }
  }
  return out;
}

function loadLog(): IngestLog {
  if (fs.existsSync(LOG_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(LOG_PATH, 'utf-8')) as IngestLog;
    } catch (err) {
      console.warn(`[ingest] Could not parse ${LOG_PATH}, starting fresh:`, err);
    }
  }
  return { entries: {} };
}

function saveLog(log: IngestLog) {
  fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 2));
}

// ── Pinata ───────────────────────────────────────────────────────────────

async function pinFile(
  buffer: Buffer,
  filename: string,
  sourceLabel: string
): Promise<{ cid: string; url: string }> {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimeOf(filename) }), filename);
  form.append(
    'pinataMetadata',
    JSON.stringify({
      name: filename,
      keyvalues: { source: sourceLabel, ingestedAt: new Date().toISOString() },
    })
  );
  const res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST',
    headers: { Authorization: `Bearer ${PINATA_JWT}` },
    body: form,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Pinata ${res.status}: ${body.slice(0, 400)}`);
  }
  const { IpfsHash } = (await res.json()) as { IpfsHash: string };
  return { cid: IpfsHash, url: `${PINATA_GATEWAY}/ipfs/${IpfsHash}` };
}

// ── Firestore writes ─────────────────────────────────────────────────────

async function findExistingManifest(db: Firestore, contentHash: string) {
  const ref = db.collection('storageManifests').doc(contentHash);
  const snap = await ref.get();
  return snap.exists ? (snap.data() as { contentHash: string; uploads?: { url: string }[] }) : null;
}

async function writeManifest(
  db: Firestore,
  contentHash: string,
  filename: string,
  mimeType: string,
  size: number,
  cid: string,
  url: string
) {
  await db
    .collection('storageManifests')
    .doc(contentHash)
    .set({
      contentHash,
      originalFilename: filename,
      mimeType,
      size,
      createdAt: Date.now(),
      uploads: [{ provider: 'pinata', contentId: cid, contentHash, url, size }],
      ingestSource: 'ingest-local-outputs',
    });
}

async function writeContent(
  db: Firestore,
  params: {
    creatorUid: string;
    mediaUrl: string;
    mediaType: 'video' | 'audio' | 'image';
    title: string;
    description: string;
    universeId: string | null;
    tags: string[];
  }
): Promise<string> {
  const now = new Date();
  const doc = {
    title: params.title.slice(0, 100) || 'Ingested',
    description: params.description,
    mediaUrl: params.mediaUrl,
    thumbnailUrl: null,
    mediaType: params.mediaType,
    classification: 'original',
    tags: params.tags,
    ipDeclaration: {
      isOriginal: true,
      usesCopyrightedMaterial: false,
      license: 'all-rights-reserved',
    },
    visibility: 'public',
    creatorUid: params.creatorUid,
    ...(params.universeId ? { universeId: params.universeId } : {}),
    createdAt: now,
    updatedAt: now,
    views: 0,
    likes: 0,
    reviewStatus: 'not_required',
    generationId: `ingest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    generationModel: 'local-ingest',
    source: 'ingest-local-outputs',
  };
  const ref = await db.collection('content').add(doc);
  return ref.id;
}

// ── Main ─────────────────────────────────────────────────────────────────

function deriveTitle(rel: string): string {
  const base = path.basename(rel).replace(/\.[^.]+$/, '');
  return base.replace(/[-_]/g, ' ').slice(0, 100);
}

function deriveTags(sourceRoot: string, rel: string): string[] {
  const tags = new Set<string>();
  tags.add('ingested');
  const root = path.basename(sourceRoot).replace(/_git$/, '');
  tags.add(root);
  const dirParts = path.dirname(rel).split(path.sep).filter(Boolean);
  for (const p of dirParts.slice(0, 2)) tags.add(p);
  return Array.from(tags).filter((t) => t && t !== '.');
}

async function processOne(
  db: Firestore,
  log: IngestLog,
  task: Task
): Promise<{ status: 'skipped' | 'uploaded' | 'failed'; reason?: string; entry?: LogEntry }> {
  let buf: Buffer;
  try {
    buf = fs.readFileSync(task.abs);
  } catch (err) {
    return { status: 'failed', reason: `read failed: ${(err as Error).message}` };
  }

  const hash = sha256(buf);
  if (log.entries[hash]) {
    return { status: 'skipped', reason: 'already in local log' };
  }

  const existingManifest = await findExistingManifest(db, hash);
  if (existingManifest && existingManifest.uploads && existingManifest.uploads[0]?.url) {
    const entry: LogEntry = {
      contentHash: hash,
      filename: path.basename(task.rel),
      source: task.sourceRoot,
      size: task.size,
      mimeType: mimeOf(task.rel),
      cid: '',
      mediaUrl: existingManifest.uploads[0].url,
      contentDocId: null,
      completedAt: new Date().toISOString(),
    };
    log.entries[hash] = entry;
    return { status: 'skipped', reason: 'manifest already in Firestore', entry };
  }

  const filename = path.basename(task.rel);
  const mime = mimeOf(task.rel);
  const sourceLabel = path.basename(task.sourceRoot);

  if (DRY_RUN) {
    return {
      status: 'uploaded',
      reason: 'dry-run (would upload)',
      entry: {
        contentHash: hash,
        filename,
        source: task.sourceRoot,
        size: task.size,
        mimeType: mime,
        cid: 'DRY_RUN',
        mediaUrl: 'DRY_RUN',
        contentDocId: null,
        completedAt: new Date().toISOString(),
      },
    };
  }

  let pinned: { cid: string; url: string };
  try {
    pinned = await pinFile(buf, filename, sourceLabel);
  } catch (err) {
    return { status: 'failed', reason: `pinata upload: ${(err as Error).message}` };
  }

  try {
    await writeManifest(db, hash, filename, mime, task.size, pinned.cid, pinned.url);
  } catch (err) {
    console.warn(`[ingest] manifest write failed for ${hash.slice(0, 12)}:`, err);
  }

  let contentDocId: string | null = null;
  try {
    contentDocId = await writeContent(db, {
      creatorUid: CREATOR_UID,
      mediaUrl: pinned.url,
      mediaType: mediaTypeOf(mime),
      title: deriveTitle(task.rel),
      description: `Ingested from ${sourceLabel}/${task.rel}`,
      universeId: DEFAULT_UNIVERSE_ID,
      tags: deriveTags(task.sourceRoot, task.rel),
    });
  } catch (err) {
    console.warn(`[ingest] content doc write failed for ${filename}:`, err);
  }

  const entry: LogEntry = {
    contentHash: hash,
    filename,
    source: task.sourceRoot,
    size: task.size,
    mimeType: mime,
    cid: pinned.cid,
    mediaUrl: pinned.url,
    contentDocId,
    completedAt: new Date().toISOString(),
  };
  return { status: 'uploaded', entry };
}

function fmtBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${n}B`;
}

async function main() {
  if (!PINATA_JWT && !DRY_RUN) {
    console.error('PINATA_JWT required (or set DRY_RUN=1)');
    process.exit(1);
  }

  // Firestore client (service account).
  let db: Firestore;
  try {
    const saPath = path.resolve(
      process.cwd(),
      process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? 'firebase-sa-key-20260416.json'
    );
    const sa = process.env.FIREBASE_SERVICE_ACCOUNT
      ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
      : JSON.parse(fs.readFileSync(saPath, 'utf-8'));
    const app = initializeApp({ credential: cert(sa) }, `ingest-${Date.now()}`);
    db = getFirestore(app);
    db.settings({ preferRest: true });
  } catch (err) {
    console.error('Firebase init failed:', err);
    process.exit(1);
  }

  // Enumerate sources.
  console.log(`\n=== INGEST LOCAL OUTPUTS (${DRY_RUN ? 'DRY-RUN' : 'LIVE'}) ===\n`);
  console.log(`Sources (${SOURCES.length}):`);
  let all: Task[] = [];
  for (const src of SOURCES) {
    const tasks = walkMedia(src);
    const bytes = tasks.reduce((s, t) => s + t.size, 0);
    console.log(
      `  ${fs.existsSync(src) ? '✓' : '✗'} ${src}  →  ${tasks.length} files, ${fmtBytes(bytes)}`
    );
    all = all.concat(tasks);
  }

  if (MAX_FILES > 0 && all.length > MAX_FILES) {
    console.log(`\nINGEST_MAX_FILES=${MAX_FILES} set, truncating from ${all.length}.`);
    all = all.slice(0, MAX_FILES);
  }

  const totalBytes = all.reduce((s, t) => s + t.size, 0);
  console.log(
    `\nTotal: ${all.length} files, ${fmtBytes(totalBytes)}, concurrency=${CONCURRENCY}, creator=${CREATOR_UID}\n`
  );
  if (all.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  const log = loadLog();
  const startLogSize = Object.keys(log.entries).length;

  // Bounded-concurrency processor.
  let cursor = 0;
  const counts = { uploaded: 0, skipped: 0, failed: 0 };
  const failures: Array<{ file: string; reason: string }> = [];

  async function worker(id: number) {
    while (true) {
      const i = cursor++;
      if (i >= all.length) return;
      const task = all[i];
      const tag = `[${i + 1}/${all.length}]`;
      try {
        const result = await processOne(db, log, task);
        if (result.status === 'uploaded') counts.uploaded++;
        else if (result.status === 'skipped') counts.skipped++;
        else counts.failed++;
        // Never persist dry-run entries — they'd false-positive skip a later live run.
        if (result.entry && !DRY_RUN) log.entries[result.entry.contentHash] = result.entry;
        const short = result.entry?.contentHash?.slice(0, 10) ?? '??';
        console.log(
          `${tag} w${id} ${result.status.padEnd(8)} ${short} ${task.rel}  ${fmtBytes(task.size)}${result.reason ? `  (${result.reason})` : ''}`
        );
        if (result.status === 'failed' && result.reason) {
          failures.push({ file: task.abs, reason: result.reason });
        }
        // Persist log periodically to make runs resumable.
        if ((counts.uploaded + counts.skipped + counts.failed) % 10 === 0) saveLog(log);
      } catch (err) {
        counts.failed++;
        const msg = err instanceof Error ? err.message : String(err);
        failures.push({ file: task.abs, reason: msg });
        console.error(`${tag} w${id} THREW  ${task.rel}  ${msg}`);
      }
    }
  }

  const started = Date.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i + 1)));
  saveLog(log);

  const elapsed = Math.round((Date.now() - started) / 1000);
  console.log('\n=== SUMMARY ===');
  console.log(
    `  Uploaded: ${counts.uploaded}   Skipped: ${counts.skipped}   Failed: ${counts.failed}`
  );
  console.log(
    `  Log entries: ${startLogSize} → ${Object.keys(log.entries).length} (delta ${Object.keys(log.entries).length - startLogSize})`
  );
  console.log(`  Elapsed: ${elapsed}s`);
  if (failures.length) {
    console.log(`\n  First 5 failures:`);
    for (const f of failures.slice(0, 5)) console.log(`    ${f.file}  →  ${f.reason}`);
  }
  if (DRY_RUN) {
    console.log('\n  (DRY_RUN — no uploads performed.)');
  }
}

main().catch((err) => {
  console.error('INGEST FAILED:', err);
  process.exit(1);
});
