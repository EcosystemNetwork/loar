import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

// Initialize Sentry early — must be after dotenv so SENTRY_DSN is available
await import('./lib/sentry');

// Must use dynamic import — static imports are hoisted above dotenv.config()
const { initFirebase } = await import('./lib/firebase');
initFirebase();

const { validateEnv } = await import('./lib/env');
const env = validateEnv();

// Dynamic imports — must load after dotenv.config() above
const { serve } = await import('@hono/node-server');
const { trpcServer } = await import('@hono/trpc-server');
const { createContext } = await import('./lib/context');
const { appRouter } = await import('./routers/index');
const { Hono } = await import('hono');
const { cors } = await import('hono/cors');
const { logger } = await import('hono/logger');
const { imageRouter } = await import('./routes/image');
const { authRoutes } = await import('./routes/auth');
const { verifyAuth } = await import('./lib/auth');
const { securityHeaders } = await import('./middleware/security-headers');
const { rateLimiter, aiRateLimiter } = await import('./middleware/rate-limit');
const { errorHandler } = await import('./middleware/error-handler');
const { csrfProtection } = await import('./middleware/csrf');
const { z } = await import('zod');

const app = new Hono();

// Global error handler
app.onError(errorHandler);

// Security headers on all responses
app.use('/*', securityHeaders);

// ── Prometheus /metrics — registered BEFORE rate limiting and auth so a
// scraper hitting it every 15s doesn't get throttled. Protected by bearer
// token when METRICS_AUTH_TOKEN is set; otherwise open (deploy on a private
// network or behind a reverse-proxy allowlist).
const { renderMetrics } = await import('./lib/metrics');
const { metricsMiddleware } = await import('./middleware/metrics');
app.get('/metrics', async (c) => {
  const expected = process.env.METRICS_AUTH_TOKEN;
  if (expected) {
    const auth = c.req.header('authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (token !== expected) {
      return c.text('Unauthorized', 401);
    }
  }
  const { body, contentType } = await renderMetrics();
  return c.text(body, 200, { 'Content-Type': contentType });
});

// Record request counts + durations for everything else.
app.use('/*', metricsMiddleware());

// Rate limiting: 100 requests per minute per IP
app.use('/*', rateLimiter({ windowMs: 60_000, max: 100 }));

app.use(logger());

// Support comma-separated CORS origins (e.g. "https://loar.fun,https://staging.loar.fun")
const allowedOrigins = (env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  '/*',
  cors({
    origin: (origin) => {
      // No Origin header = non-browser request (curl, server-to-server).
      // Return null to omit CORS headers entirely — auth middleware
      // enforces access control independently of CORS.
      if (!origin) return null;
      // Reject unknown origins instead of falling back to a default
      return allowedOrigins.includes(origin) ? origin : null;
    },
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
    credentials: true,
  })
);

// CSRF protection — validate Origin header on mutating requests.
// Must be AFTER CORS (which sets response headers) but BEFORE route handlers.
// Stripe webhook is excluded (uses its own signature verification).
app.use('/*', csrfProtection(allowedOrigins));

// Stripe webhook (must be before body-parsing middleware — needs raw body)
const { stripeWebhookRoutes } = await import('./routes/stripe-webhook');
app.route('/api/stripe', stripeWebhookRoutes);

// SIWE authentication routes — stricter rate limit (20 req/min per IP)
// Each sign-in needs nonce + verify (2 reqs), plus /me checks and /refresh calls
app.use('/auth/*', rateLimiter({ windowMs: 60_000, max: 20 }));
// Extra-tight bucket on /auth/nonce specifically: each nonce is a Firestore
// write, and the shared `/auth/*` bucket of 20/min lets an attacker pull ~29k
// nonces/day per IP (burning Firestore quota + outrunning the 15-min cleanup
// sweep). Legitimate clients call nonce once per login attempt, so 6/min is
// generous.
app.use('/auth/nonce', rateLimiter({ windowMs: 60_000, max: 6 }));
app.route('/auth', authRoutes);

// Circle Developer Controlled Wallet auth routes (email/social login)
const { circleAuthRoutes } = await import('./routes/circle-auth');
app.route('/auth/circle', circleAuthRoutes);

// Circle transaction proxy — server-side contract execution via Circle KMS
const { txProxyRoutes } = await import('./routes/tx-proxy');
app.route('/api/tx', txProxyRoutes);

// Add image serving routes
app.route('/images', imageRouter);

// Unstoppable Domains reverse-resolve proxy (browser → server → UD).
const { unstoppableRoutes } = await import('./routes/unstoppable');
app.route('/api/ud', unstoppableRoutes);

// IPFS URL resolver — server-side Pinata gateway token stays on the server
// (WEB-1). Clients pass an ipfs:// URL or known gateway URL and get back a
// signed gateway URL they can use directly. Public, rate-limited by shared
// IP bucket below.
const { ipfsRoutes } = await import('./routes/ipfs');
app.use('/api/ipfs/*', rateLimiter({ windowMs: 60_000, max: 120 }));
app.route('/api/ipfs', ipfsRoutes);

// Image resize proxy (sharp). Powers SmartImage's srcset on the web app —
// snaps requested widths to a fixed ladder, content-negotiates webp/avif,
// LRU-caches in-process. Public, gateway-allowlisted, rate-limited.
const { imgResizeRoutes } = await import('./routes/img-resize');
app.use('/api/img/*', rateLimiter({ windowMs: 60_000, max: 240 }));
app.route('/api/img', imgResizeRoutes);

// Admin cost ledger CSV download (admin-address-gated). Lives outside tRPC
// because tRPC batches JSON — CSV streaming is simpler as a plain REST route.
const { adminCostRoutes } = await import('./routes/admin-cost');
app.route('/api/admin/cost', adminCostRoutes);

// MCP Gateway service endpoints — called by apps/mcp-gateway for per-session
// key minting. Service-key gated (not user-accessible).
const { mcpGatewayRoutes } = await import('./routes/mcp-gateway');
app.route('/api', mcpGatewayRoutes);

// Paymaster proxy (POST /api/paymaster/sponsor). Pluggable provider —
// thirdweb / pimlico / biconomy based on env. Stricter rate limit because
// each call translates to a vendor-side spend.
app.use('/api/paymaster/*', rateLimiter({ windowMs: 60_000, max: 20 }));
const { paymasterRoutes } = await import('./routes/paymaster');
app.route('/api/paymaster', paymasterRoutes);

/**
 * Sanitize a browser-supplied filename before it reaches any storage backend.
 * See SRV-6: path separators, NULs, leading dots, and oversized names can
 * surprise backends that treat the name as a key. We normalize to
 * `[A-Za-z0-9._-]`, preserve at most one extension, and cap to 128 chars.
 */
function sanitizeUploadFilename(raw: string): string {
  const fallback = 'upload.bin';
  if (typeof raw !== 'string' || raw.length === 0) return fallback;

  // Strip any path components the browser sent (IE does this, some mobile
  // browsers do too) and null/control chars.
  const basename = raw.split(/[\\/]/).pop() ?? '';
  const stripped = basename.replace(/[\x00-\x1f\x7f]/g, '').trim();
  if (!stripped) return fallback;

  const dot = stripped.lastIndexOf('.');
  let name = dot > 0 ? stripped.slice(0, dot) : stripped;
  let ext = dot > 0 ? stripped.slice(dot + 1) : '';

  name = name
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 96);
  ext = ext.replace(/[^A-Za-z0-9]+/g, '').slice(0, 16);

  if (!name) name = 'upload';
  return ext ? `${name}.${ext}` : name;
}

/** Detect MIME type from file magic bytes. Returns null if unrecognised. */
function detectMimeFromMagic(header: Buffer): string | null {
  if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return 'image/jpeg';
  if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47)
    return 'image/png';
  if (header[0] === 0x47 && header[1] === 0x49 && header[2] === 0x46) return 'image/gif';
  if (
    header[0] === 0x52 &&
    header[1] === 0x49 &&
    header[2] === 0x46 &&
    header[3] === 0x46 &&
    header[8] === 0x57 &&
    header[9] === 0x45 &&
    header[10] === 0x42 &&
    header[11] === 0x50
  )
    return 'image/webp';
  if (header[0] === 0x25 && header[1] === 0x50 && header[2] === 0x44 && header[3] === 0x46)
    return 'application/pdf';
  // MP4/QuickTime (ftyp box)
  if (header[4] === 0x66 && header[5] === 0x74 && header[6] === 0x79 && header[7] === 0x70)
    return 'video/mp4';
  // WebM/MKV (EBML header)
  if (header[0] === 0x1a && header[1] === 0x45 && header[2] === 0xdf && header[3] === 0xa3)
    return 'video/webm';
  // MP3 (ID3 tag or sync word)
  if (
    (header[0] === 0x49 && header[1] === 0x44 && header[2] === 0x33) ||
    (header[0] === 0xff && (header[1] & 0xe0) === 0xe0)
  )
    return 'audio/mpeg';
  // OGG
  if (header[0] === 0x4f && header[1] === 0x67 && header[2] === 0x67 && header[3] === 0x53)
    return 'audio/ogg';
  // FLAC
  if (header[0] === 0x66 && header[1] === 0x4c && header[2] === 0x61 && header[3] === 0x43)
    return 'audio/flac';
  // WAV (RIFF + WAVE)
  if (
    header[0] === 0x52 &&
    header[1] === 0x49 &&
    header[2] === 0x46 &&
    header[3] === 0x46 &&
    header[8] === 0x57 &&
    header[9] === 0x41 &&
    header[10] === 0x56 &&
    header[11] === 0x45
  )
    return 'audio/wav';
  return null;
}

// Direct file upload endpoint (multipart form, bypasses tRPC for large files)
// Stricter rate limit: 10 uploads per minute per IP
app.use('/api/upload', rateLimiter({ windowMs: 60_000, max: 10 }));
app.post('/api/upload', async (c) => {
  const { getCookie } = await import('hono/cookie');
  const cookieToken = getCookie(c, 'siwe-session');
  const user = await verifyAuth(c.req.raw.headers, cookieToken);
  if (!user) {
    return c.json({ code: 'UNAUTHORIZED', message: 'Authentication required' }, 401);
  }

  try {
    const body = await c.req.parseBody();
    const file = body['file'];

    if (!(file instanceof File)) {
      return c.json({ code: 'BAD_REQUEST', message: 'No file provided' }, 400);
    }

    // Server-side magic byte validation — don't trust client-supplied MIME types
    const headerBytes = Buffer.from(await file.slice(0, 12).arrayBuffer());
    const detectedMime = detectMimeFromMagic(headerBytes);

    // When magic byte detection succeeds, use the detected MIME. When it fails,
    // cross-check the client-supplied MIME against the file extension to prevent
    // MIME spoofing (e.g. uploading an executable with a fake image/png type).
    let clientMime: string;
    if (detectedMime) {
      clientMime = detectedMime;
    } else {
      // Magic detection failed — validate that client MIME is consistent with extension
      const extMimeMap: Record<string, string[]> = {
        jpg: ['image/jpeg'],
        jpeg: ['image/jpeg'],
        png: ['image/png'],
        gif: ['image/gif'],
        webp: ['image/webp'],
        mp4: ['video/mp4', 'video/quicktime'],
        mov: ['video/quicktime', 'video/mp4'],
        webm: ['video/webm'],
        avi: ['video/x-msvideo'],
        mkv: ['video/x-matroska'],
        mp3: ['audio/mpeg'],
        wav: ['audio/wav', 'audio/x-wav'],
        ogg: ['audio/ogg'],
        flac: ['audio/flac'],
        pdf: ['application/pdf'],
        // SVG removed: admin-moderation UI opens the stored URL via
        // <a target="_blank"> on user-controlled IPFS gateway domains, and
        // SVG is a script-executing format. Rasterize client-side or accept
        // as a sandboxed preview only — not as a generic upload target.
      };
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
      const expectedMimes = extMimeMap[ext];
      if (expectedMimes && file.type && !expectedMimes.includes(file.type)) {
        return c.json(
          {
            code: 'BAD_REQUEST',
            message: `MIME type "${file.type}" does not match file extension ".${ext}"`,
          },
          400
        );
      }
      clientMime = file.type || 'application/octet-stream';
    }

    const allowedMimeTypes = new Set([
      // Video
      'video/mp4',
      'video/webm',
      'video/quicktime',
      'video/x-msvideo',
      'video/x-matroska',
      // Raster images
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/tiff',
      'image/bmp',
      'image/avif',
      'image/heic',
      'image/heif',
      // Design formats with standard MIME types
      'image/vnd.adobe.photoshop',
      'image/x-xcf',
      'application/postscript',
      // 3D models
      'model/gltf+json',
      'model/gltf-binary',
      'model/obj',
      'model/stl',
      // Audio
      'audio/mpeg',
      'audio/wav',
      'audio/x-wav',
      'audio/ogg',
      'audio/flac',
      'audio/aac',
      'audio/mp4',
      // Documents / reference
      'application/pdf',
    ]);
    // Extensions for proprietary art formats browsers report as application/octet-stream
    const allowedBinaryExtensions = new Set([
      // 3D / animation
      'blend',
      'fbx',
      'ma',
      'mb',
      'max',
      'c4d',
      'zpr',
      'ztl',
      'dae',
      'abc',
      '3ds',
      'lwo',
      // Design app native
      'psd',
      'psb',
      'kra',
      'clip',
      'procreate',
      'sketch',
      'afdesign',
      'afphoto',
      'afpub',
      'cdr',
      // Texture / HDR
      'exr',
      'hdr',
      'tga',
      'dds',
    ]);
    const fileExt = file.name.split('.').pop()?.toLowerCase() ?? '';
    const isOctetStream = clientMime === 'application/octet-stream' || clientMime === '';
    if (
      !allowedMimeTypes.has(clientMime) &&
      !(isOctetStream && allowedBinaryExtensions.has(fileExt))
    ) {
      return c.json(
        { code: 'BAD_REQUEST', message: `Unsupported file type: ${clientMime || fileExt}` },
        400
      );
    }

    if (file.size > 200 * 1024 * 1024) {
      return c.json({ code: 'PAYLOAD_TOO_LARGE', message: 'File too large (max 200MB)' }, 413);
    }

    const { getStorageManager } = await import('./services/storage');
    const manager = getStorageManager();
    const buffer = Buffer.from(await file.arrayBuffer());

    // Pre-upload: compute local perceptual hash for dedup / copyright lookup.
    // CSAM vendor scan runs post-upload against the hosted URL (vendors need
    // a fetch-able URL, and base64 payloads blow past their size limits).
    let fingerprintHash: string | undefined;
    if (clientMime.startsWith('image/') || clientMime.startsWith('video/')) {
      try {
        const { scanUpload } = await import('./services/fingerprint');
        const verdict = await scanUpload({
          url: '',
          bytes: buffer,
          mimeType: clientMime,
          kind: clientMime.startsWith('video/') ? 'video' : 'image',
        });
        fingerprintHash = verdict.fingerprint?.hash;
      } catch (err) {
        console.warn('[upload] pre-upload fingerprint failed:', err);
      }
    }

    // SRV-6: sanitize the browser-supplied filename before passing it to any
    // storage backend. Previous code forwarded `file.name` verbatim, leaving
    // path separators, NULs, control chars, and oversized names to the
    // backend's own (sometimes permissive) handling. Normalize to a small
    // ASCII-safe set and cap length; extension is preserved when present.
    const sanitizedFilename = sanitizeUploadFilename(file.name);
    const manifest = await manager.upload(buffer, sanitizedFilename, clientMime);

    // Post-upload CSAM scan — fire-and-forget with result written back to
    // `content` collection by the moderation pipeline. We don't block the
    // upload response on it; the content is held in `under_review` until
    // the CSAM scan completes (see services/fingerprint/scan-hosted-job).
    if (
      (clientMime.startsWith('image/') || clientMime.startsWith('video/')) &&
      manifest.uploads?.[0]?.url
    ) {
      const hostedUrl = manifest.uploads[0].url;
      (async () => {
        try {
          const { scanHosted } = await import('./services/fingerprint');
          const verdict = await scanHosted({
            url: hostedUrl,
            mimeType: clientMime,
            kind: clientMime.startsWith('video/') ? 'video' : 'image',
          });
          if (verdict.block) {
            console.error(
              `[csam] BLOCKED upload by ${user.uid}: ${manifest.contentHash} — ${verdict.reason}`
            );
            // Caller writes a content doc later; moderation pipeline will
            // look up by contentHash and force contentStatus='removed'.
            const { db, firebaseAvailable } = await import('./lib/firebase');
            if (firebaseAvailable && db) {
              await db
                .collection('csamHolds')
                .doc(manifest.contentHash)
                .set({
                  contentHash: manifest.contentHash,
                  uploaderUid: user.uid.toLowerCase(),
                  vendor: verdict.csam?.vendor ?? 'unknown',
                  vendorReferenceId: verdict.csam?.vendorReferenceId ?? null,
                  createdAt: new Date().toISOString(),
                });
            }
          }
        } catch (err) {
          console.warn('[csam] post-upload scan failed:', err);
        }
      })();
    }

    return c.json({
      manifest,
      ...(fingerprintHash ? { fingerprint: { algorithm: 'ahash', hash: fingerprintHash } } : {}),
    });
  } catch (error) {
    console.error('Direct upload error:', error);
    return c.json(
      {
        code: 'INTERNAL_SERVER_ERROR',
        message: `Upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      },
      500
    );
  }
});

// ── Public DMCA takedown REST endpoint ─────────────────────────────
// External reporters can't use tRPC, so this mirrors moderation.submitTakedown as REST.
// Strict rate limit: 3 requests per minute per IP to prevent mass-flagging abuse
app.use('/api/takedown', rateLimiter({ windowMs: 60_000, max: 3 }));
app.post('/api/takedown', async (c) => {
  // Enforces 17 U.S.C. § 512(c)(3)(A) statutory elements. See moderation
  // router for the same schema applied to the tRPC path.
  const takedownSchema = z.object({
    contentId: z.string().min(1),
    claimantName: z.string().min(1).max(200),
    claimantEmail: z.string().email(),
    claimantAddress: z.string().min(10).max(500), // § 512(c)(3)(A)(iv)
    claimantPhone: z.string().min(7).max(30), // § 512(c)(3)(A)(iv)
    copyrightWork: z.string().min(1).max(500),
    explanation: z.string().min(20).max(5000),
    goodFaith: z.literal(true), // § 512(c)(3)(A)(v)
    swornStatement: z.literal(true), // § 512(c)(3)(A)(vi)
    signature: z.string().min(2).max(200), // § 512(c)(3)(A)(i)
  });

  try {
    const body = await c.req.json();
    const parsed = takedownSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          code: 'BAD_REQUEST',
          message: 'Validation failed',
          errors: parsed.error.flatten().fieldErrors,
        },
        400
      );
    }
    const {
      contentId,
      claimantName,
      claimantEmail,
      claimantAddress,
      claimantPhone,
      copyrightWork,
      explanation,
      signature,
    } = parsed.data;

    // § 512(c)(3)(A)(i) identity binding — see moderation.submitTakedown.
    const sigLc = signature.trim().toLowerCase();
    const nameLc = claimantName.trim().toLowerCase();
    if (sigLc !== nameLc) {
      return c.json(
        { code: 'BAD_REQUEST', message: 'Signature must match the claimant name exactly.' },
        400
      );
    }

    const { firebaseAvailable: fbAvail, db: fireDb } = await import('./lib/firebase');
    if (!fbAvail || !fireDb) {
      return c.json({ code: 'SERVICE_UNAVAILABLE', message: 'Service not available' }, 503);
    }

    const claimantEmailLower = claimantEmail.toLowerCase();

    // Rate limit per claimant email (5/day) + per-contentId flood cap (5/h)
    // via shared limiter store. The per-content bucket is the censorship-
    // flood defense — disposable-email rotation bypasses per-email alone.
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const recentByEmail = await fireDb
      .collection('takedownRequests')
      .where('claimantEmailLower', '==', claimantEmailLower)
      .where('createdAt', '>=', oneDayAgo)
      .limit(5)
      .get();
    if (recentByEmail.size >= 5) {
      return c.json(
        {
          code: 'TOO_MANY_REQUESTS',
          message: 'Too many takedown requests from this email. Try again tomorrow.',
        },
        429
      );
    }
    const { consumeRateLimit } = await import('./middleware/rate-limit');
    const { blocked: contentBlocked } = await consumeRateLimit(
      `takedown:content:${contentId}`,
      60 * 60 * 1000,
      5
    );
    if (contentBlocked) {
      return c.json(
        {
          code: 'TOO_MANY_REQUESTS',
          message:
            'This content has received several takedown notices recently. Please try again later.',
        },
        429
      );
    }

    const now = new Date();
    const request = {
      contentId,
      claimantName,
      claimantEmail,
      claimantEmailLower,
      claimantAddress,
      claimantPhone,
      copyrightWork,
      explanation,
      signature,
      goodFaithAttested: true,
      swornAttested: true,
      status: 'pending',
      createdAt: now.toISOString(),
    };

    const ref = await fireDb.collection('takedownRequests').add(request);

    // Do NOT auto-flag content on takedown submission. The tRPC path deliberately
    // omits this step to prevent abuse of the DMCA process for censorship.
    // Content status transitions require admin review via admin.moderation.*.

    return c.json({
      id: ref.id,
      status: 'pending',
      message: 'Takedown request received. We will review within 72 hours.',
    });
  } catch (error) {
    console.error('DMCA takedown error:', error);
    return c.json(
      { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to process takedown request' },
      500
    );
  }
});

// ── Public DMCA counter-notice REST endpoint (no auth required) ──────
// Respondents can file a counter-notice to dispute a takedown per 17 U.S.C. § 512(g).
// Rate limit: 3 requests per minute per IP
app.use('/api/counter-notice', rateLimiter({ windowMs: 60_000, max: 3 }));
app.post('/api/counter-notice', async (c) => {
  const counterNoticeSchema = z.object({
    takedownRequestId: z.string().min(1),
    respondentName: z.string().min(1).max(200),
    respondentEmail: z.string().email(),
    respondentAddress: z.string().min(10).max(500), // Physical address required by DMCA
    explanation: z.string().min(50).max(5000),
    consentToJurisdiction: z.literal(true),
    perjuryStatement: z.literal(true),
  });

  try {
    // Require authenticated wallet: the § 512(g) counter-notice must come from
    // the subscriber whose content was flagged, not an anonymous caller.
    const { getCookie } = await import('hono/cookie');
    const authedUser = await verifyAuth(c.req.raw.headers, getCookie(c, 'siwe-session'));
    if (!authedUser) {
      return c.json({ code: 'UNAUTHORIZED', message: 'Authentication required' }, 401);
    }

    const body = await c.req.json();
    const parsed = counterNoticeSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          code: 'BAD_REQUEST',
          message: 'Validation failed',
          errors: parsed.error.flatten().fieldErrors,
        },
        400
      );
    }
    const { takedownRequestId, respondentName, respondentEmail, respondentAddress, explanation } =
      parsed.data;

    const { firebaseAvailable: fbAvail, db: fireDb } = await import('./lib/firebase');
    if (!fbAvail || !fireDb) {
      return c.json({ code: 'SERVICE_UNAVAILABLE', message: 'Service not available' }, 503);
    }

    // Verify the referenced takedown request exists
    const takedownDoc = await fireDb.collection('takedownRequests').doc(takedownRequestId).get();
    if (!takedownDoc.exists) {
      return c.json({ code: 'NOT_FOUND', message: 'Takedown request not found' }, 404);
    }

    // Only the owner of the flagged content may file a counter-notice. This
    // prevents anonymous bulk counter-notices that would flip takedown state
    // and trigger the dmca-putback cron against content the caller has no
    // claim to.
    const td = takedownDoc.data() as { contentId?: string } | undefined;
    if (!td?.contentId) {
      return c.json({ code: 'NOT_FOUND', message: 'Takedown is missing target content' }, 404);
    }
    const contentDoc = await fireDb.collection('content').doc(td.contentId).get();
    const contentCreatorUid = contentDoc.data()?.creatorUid as string | undefined;
    if (!contentCreatorUid || contentCreatorUid.toLowerCase() !== authedUser.uid.toLowerCase()) {
      return c.json(
        { code: 'FORBIDDEN', message: 'Only the content owner may file a counter-notice' },
        403
      );
    }

    // Prevent duplicate counter-notices for the same takedown from the same
    // email. Firestore `where` is case-sensitive, so we dedup on a normalized
    // lowercase copy — an attacker otherwise bypasses dedup by varying case
    // ("Owner@X" vs "owner@x") and spams the claimant with repeat notices.
    const respondentEmailLower = respondentEmail.toLowerCase();
    const existing = await fireDb
      .collection('counterNotices')
      .where('takedownRequestId', '==', takedownRequestId)
      .where('respondentEmailLower', '==', respondentEmailLower)
      .limit(1)
      .get();
    if (!existing.empty) {
      return c.json(
        {
          code: 'CONFLICT',
          message: 'A counter-notice for this takedown from this email already exists',
        },
        409
      );
    }

    const now = new Date();
    const counterNotice = {
      takedownRequestId,
      respondentName,
      respondentEmail,
      respondentEmailLower,
      respondentAddress,
      explanation,
      status: 'pending', // pending | reviewed | rejected
      createdAt: now.toISOString(),
    };

    const ref = await fireDb.collection('counterNotices').add(counterNotice);

    // Update the original takedown request status
    await fireDb.collection('takedownRequests').doc(takedownRequestId).update({
      status: 'counter_notice_received',
      counterNoticeId: ref.id,
      counterNoticeReceivedAt: now.toISOString(),
    });

    // § 512(g)(2)(B): notify the original claimant so they have a fair
    // chance to file a court action before the hold period expires.
    // Fire-and-forget — the counter-notice is already durably stored;
    // email failures are an operator concern, not a user-facing one.
    try {
      const td = takedownDoc.data() as {
        contentId?: string;
        claimantName?: string;
        claimantEmail?: string;
        copyrightWork?: string;
        createdAt?: string;
      };
      if (td.claimantEmail) {
        const { emailCounterNoticeToClaimant } = await import('./lib/dmca-email');
        void emailCounterNoticeToClaimant(
          {
            id: takedownRequestId,
            contentId: td.contentId ?? '',
            claimantName: td.claimantName,
            claimantEmail: td.claimantEmail,
            copyrightWork: td.copyrightWork,
            createdAt: td.createdAt ?? now.toISOString(),
          },
          {
            id: ref.id,
            respondentName,
            respondentEmail,
            respondentAddress,
            explanation,
            createdAt: now.toISOString(),
          }
        );
      }
    } catch (emailErr) {
      console.warn('[dmca] counter-notice email dispatch failed:', emailErr);
    }

    return c.json({
      id: ref.id,
      status: 'pending',
      message:
        'Counter-notice received. Under DMCA § 512(g), the original claimant has 10-14 business days ' +
        'to file a court action. If no action is filed, the content may be restored.',
    });
  } catch (error) {
    console.error('DMCA counter-notice error:', error);
    return c.json(
      { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to process counter-notice' },
      500
    );
  }
});

// ── Takedown status endpoint ─────────────────────────────────────────
// Gated to parties with standing: the content owner, the original claimant
// (matched by verified email), or an admin. Previously anonymous — leaking
// takedown IDs lets an attacker use `/api/counter-notice` to flip state on
// arbitrary takedowns, and discloses DMCA dispute correlation with content.
app.get('/api/takedown/:id/status', async (c) => {
  try {
    const takedownId = c.req.param('id');

    const { firebaseAvailable: fbAvail, db: fireDb } = await import('./lib/firebase');
    if (!fbAvail || !fireDb) {
      return c.json({ code: 'SERVICE_UNAVAILABLE', message: 'Service not available' }, 503);
    }

    const { getCookie } = await import('hono/cookie');
    const authedUser = await verifyAuth(c.req.raw.headers, getCookie(c, 'siwe-session'));
    if (!authedUser) {
      return c.json({ code: 'UNAUTHORIZED', message: 'Authentication required' }, 401);
    }

    const takedownDoc = await fireDb.collection('takedownRequests').doc(takedownId).get();
    if (!takedownDoc.exists) {
      return c.json({ code: 'NOT_FOUND', message: 'Takedown request not found' }, 404);
    }

    const takedown = takedownDoc.data()!;
    const contentId: string | undefined = takedown.contentId;
    let contentCreatorUid: string | undefined;
    if (contentId) {
      const contentDoc = await fireDb.collection('content').doc(contentId).get();
      contentCreatorUid = contentDoc.data()?.creatorUid;
    }

    // SRV-9: delegate to the authoritative allowlist in lib/trpc.ts so there
    // is exactly one parser. Previously every takedown-status call re-split
    // the env vars; any future tightening of admin rules only needs to touch
    // the single isAdminAddress helper.
    const { isAdminAddress } = await import('./lib/trpc');
    const callerAddr = authedUser.address ?? authedUser.uid;
    const isAdmin = isAdminAddress(callerAddr);

    const isContentOwner =
      !!contentCreatorUid && contentCreatorUid.toLowerCase() === authedUser.uid.toLowerCase();

    if (!isAdmin && !isContentOwner) {
      // Return 404 (not 403) so status lookups don't double as existence oracles.
      return c.json({ code: 'NOT_FOUND', message: 'Takedown request not found' }, 404);
    }

    const result: Record<string, unknown> = {
      id: takedownId,
      status: takedown.status,
      createdAt: takedown.createdAt,
      contentId: takedown.contentId,
    };

    // Include counter-notice info if one exists
    if (takedown.counterNoticeId) {
      const cnDoc = await fireDb.collection('counterNotices').doc(takedown.counterNoticeId).get();
      if (cnDoc.exists) {
        const cn = cnDoc.data()!;
        result.counterNotice = {
          id: cnDoc.id,
          status: cn.status,
          createdAt: cn.createdAt,
        };
      }
    }

    return c.json(result);
  } catch (error) {
    console.error('Takedown status error:', error);
    return c.json(
      { code: 'INTERNAL_SERVER_ERROR', message: 'Failed to fetch takedown status' },
      500
    );
  }
});

// AI generation per-route rate limits — tiered by provider cost + latency so
// expensive paths can't drain the worker queue or the provider's per-key QPS
// budget. Per-IP + per-wallet buckets, plus a 200/day ceiling (in rate-limit.ts).
//
// Tuning notes:
//  - Limits are per-minute. The 200/day wallet ceiling is shared across
//    everything, so raising a single route's /min does not uncap overall spend.
//  - Several routes below (studio, episodes, editing, lipsync, sceneAudio,
//    cutdown, characterPipeline) were previously UNLIMITED beyond the global
//    100/min IP — a hole in the abuse surface. Adding starter limits here;
//    tune after observing real usage on the Board 2 Grafana panel.
app.use('/trpc/generation.*', aiRateLimiter({ windowMs: 60_000, max: 3 })); // video ~$0.25, 2–5 min
app.use('/trpc/studio.*', aiRateLimiter({ windowMs: 60_000, max: 2 })); // orchestrator — fans out
app.use('/trpc/characterPipeline.*', aiRateLimiter({ windowMs: 60_000, max: 2 })); // full pipeline ~$0.34
// Only the heavy script→clips generator burns AI budget. Read-only routes
// (`feed`, `get`, `list`, `topUniverses`) and status polls must not share this
// bucket — the home page rail polls `episodes.feed` and the previous
// `episodes.*` glob bricked it after two page loads per wallet.
app.use('/trpc/episodes.generateFromScript', aiRateLimiter({ windowMs: 60_000, max: 2 }));
app.use('/trpc/cutdown.*', aiRateLimiter({ windowMs: 60_000, max: 5 })); // video reframe, medium-heavy
app.use('/trpc/threed.*', aiRateLimiter({ windowMs: 60_000, max: 5 })); // Meshy polling, ~$0.15
app.use('/trpc/lipsync.*', aiRateLimiter({ windowMs: 60_000, max: 10 })); // medium
app.use('/trpc/editing.*', aiRateLimiter({ windowMs: 60_000, max: 15 })); // inpaint/upscale, varies
app.use('/trpc/sceneAudio.*', aiRateLimiter({ windowMs: 60_000, max: 10 })); // medium
app.use('/trpc/audio.*', aiRateLimiter({ windowMs: 60_000, max: 20 })); // music gen ~15s
app.use('/trpc/voice.*', aiRateLimiter({ windowMs: 60_000, max: 30 })); // TTS, short + cheap
app.use('/trpc/image.*', aiRateLimiter({ windowMs: 60_000, max: 30 })); // image gen ~$0.04, fast

// ── Job status SSE (real-time generation progress) ───────────────────
const { jobStatusRouter } = await import('./routes/job-status');
app.route('/api/jobs', jobStatusRouter);

// ── SSE: Real-time collaboration stream ──────────────────────────────
app.get('/api/collaboration/stream/:entityId', async (c) => {
  const entityId = c.req.param('entityId');
  if (!entityId) return c.json({ error: 'entityId required' }, 400);

  // Auth check — extract cookie token from Hono context
  let user: any;
  try {
    const { getCookie } = await import('hono/cookie');
    const cookieToken = getCookie(c, 'siwe-session');
    const headers = new Headers();
    const apiKey = c.req.header('X-API-Key');
    if (apiKey) headers.set('X-API-Key', apiKey);
    const authHeader = c.req.header('Authorization');
    if (authHeader) headers.set('Authorization', authHeader);
    user = await verifyAuth(headers, cookieToken);
    if (!user) return c.json({ error: 'Unauthorized' }, 401);
  } catch {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const { db: fireDb } = await import('./lib/firebase');
  if (!fireDb) return c.json({ error: 'Firebase not configured' }, 503);

  // Verify the user has access to this entity (must be creator or public)
  const entityDoc = await fireDb.collection('entities').doc(entityId).get();
  if (!entityDoc.exists) return c.json({ error: 'Entity not found' }, 404);
  const entityData = entityDoc.data()!;
  const isOwner = entityData.creatorUid?.toLowerCase() === user.uid.toLowerCase();
  const isPublic = entityData.visibility !== 'private';
  if (!isOwner && !isPublic) {
    return c.json({ error: 'You do not have access to this entity' }, 403);
  }

  // Set up SSE
  c.header('Content-Type', 'text/event-stream');
  c.header('Cache-Control', 'no-cache');
  c.header('Connection', 'keep-alive');

  const ALLOWED_SSE_EVENTS = new Set([
    'entity_update',
    'presence',
    'locks',
    'connected',
    'heartbeat',
  ]);

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: any) => {
        if (!ALLOWED_SSE_EVENTS.has(event)) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      // Watch entity document for changes
      const entityUnsub = fireDb
        .collection('entities')
        .doc(entityId)
        .onSnapshot(
          (snap) => {
            if (snap.exists) {
              send('entity_update', { id: snap.id, ...snap.data() });
            }
          },
          (err) => {
            console.error('Entity snapshot error:', err);
          }
        );

      // Watch edit sessions for this entity
      const sessionsUnsub = fireDb
        .collection('editSessions')
        .where('entityId', '==', entityId)
        .where('status', '==', 'active')
        .onSnapshot(
          (snap) => {
            const editors = snap.docs.map((doc) => ({
              sessionId: doc.data().sessionId,
              userId: doc.data().userId,
              displayName: doc.data().displayName,
              activeField: doc.data().activeField,
              walletAddress: doc.data().walletAddress,
            }));
            send('presence', { editors });
          },
          (err) => {
            console.error('Sessions snapshot error:', err);
          }
        );

      // Watch field locks
      const locksUnsub = fireDb
        .collection('fieldLocks')
        .doc(entityId)
        .onSnapshot(
          (snap) => {
            if (snap.exists) {
              const locks: Record<string, any> = {};
              const data = snap.data() || {};
              for (const [field, lock] of Object.entries(data)) {
                if (field === '_entityId') continue;
                locks[field] = {
                  userId: (lock as any).userId,
                  displayName: (lock as any).displayName,
                };
              }
              send('locks', { lockedFields: locks });
            }
          },
          (err) => {
            console.error('Locks snapshot error:', err);
          }
        );

      // Send initial heartbeat
      send('connected', { entityId, userId: user.uid });

      // Heartbeat every 30s to keep connection alive
      const heartbeatInterval = setInterval(() => {
        try {
          send('heartbeat', { ts: Date.now() });
        } catch {
          clearInterval(heartbeatInterval);
        }
      }, 30_000);

      // Cleanup on disconnect
      c.req.raw.signal.addEventListener('abort', () => {
        entityUnsub();
        sessionsUnsub();
        locksUnsub();
        clearInterval(heartbeatInterval);
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
});

app.use(
  '/trpc/*',
  trpcServer({
    router: appRouter,
    createContext: (_opts, context) => {
      return createContext({ context });
    },
  })
);

app.get('/', (c) => {
  return c.text('OK');
});

app.get('/health', async (c) => {
  const { firebaseAvailable } = await import('./lib/firebase');
  const { getPricingStatus } = await import('./services/pricing/heartbeat');
  const { isRedisHealthy } = await import('./lib/redis');

  const redisHealthy = await isRedisHealthy();

  const checks: Record<string, string> = {
    firebase: firebaseAvailable ? 'ok' : 'degraded',
    redis: process.env.REDIS_URL ? (redisHealthy ? 'ok' : 'degraded') : 'not_configured',
  };

  // Queue metrics (if Redis is configured)
  let queueMetrics: any = null;
  let circuitBreakers: any = null;
  if (process.env.REDIS_URL) {
    try {
      const { getQueueMetrics } = await import('./lib/queue');
      queueMetrics = await getQueueMetrics();
      checks.queue = queueMetrics.healthy ? 'ok' : 'degraded';
    } catch {
      checks.queue = 'not_initialized';
    }

    try {
      const { getAllCircuitStates } = await import('./lib/circuit-breaker');
      circuitBreakers = await getAllCircuitStates();
    } catch {
      // Not initialized yet
    }
  }

  const status = Object.values(checks).every(
    (v) => v === 'ok' || v === 'not_configured' || v === 'not_initialized'
  )
    ? 'healthy'
    : 'degraded';

  return c.json({
    status,
    service: 'loar-server',
    version: process.env.npm_package_version || '0.0.0',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    env: env.NODE_ENV,
    checks,
    pricing: getPricingStatus(),
    ...(queueMetrics ? { queue: queueMetrics } : {}),
    ...(circuitBreakers && Object.keys(circuitBreakers).length > 0 ? { circuitBreakers } : {}),
  });
});

// ── Start generation worker (in-process, if Redis configured) ─────────
if (process.env.REDIS_URL) {
  import('./workers/generation.worker')
    .then(({ startGenerationWorker }) => {
      const concurrency = parseInt(process.env.WORKER_CONCURRENCY || '5', 10);
      startGenerationWorker(concurrency);
    })
    .catch((err) => console.warn('[worker] Failed to start generation worker:', err));

  // VLM worker — only spins up when GOOGLE_API_KEY is present, since every
  // kind of VLM job requires Gemini access. Opt out via VLM_WORKER_DISABLED=true.
  if (process.env.GOOGLE_API_KEY && process.env.VLM_WORKER_DISABLED !== 'true') {
    import('./workers/vlm.worker')
      .then(({ startVlmWorker }) => startVlmWorker())
      .catch((err) => console.warn('[vlm-worker] Failed to start VLM worker:', err));
  }

  // Webhook worker — delivers signed POSTs for MCP agent integration. Only
  // starts when WEBHOOK_SIGNING_SECRET is configured; otherwise enqueue calls
  // are silent no-ops and the worker would have nothing to sign.
  // See docs/prd-mcp-integration.md §2.
  if (process.env.WEBHOOK_SIGNING_SECRET) {
    import('./workers/webhook.worker')
      .then(({ startWebhookWorker }) => startWebhookWorker())
      .catch((err) => console.warn('[webhook-worker] Failed to start webhook worker:', err));
  }
}

// ── Graceful shutdown ──────────────────────────────────────────────────
async function gracefulShutdown(signal: string) {
  console.log(`\n[server] Received ${signal} — shutting down gracefully...`);
  const shutdownOps: Promise<void>[] = [];

  try {
    const { shutdownRedis } = await import('./lib/redis');
    shutdownOps.push(shutdownRedis());
  } catch {
    // Redis optional in dev — skip if unavailable
  }

  if (process.env.REDIS_URL) {
    try {
      const { stopGenerationWorker } = await import('./workers/generation.worker');
      shutdownOps.push(stopGenerationWorker());
    } catch {
      // Optional shutdown step — module may not be loaded
    }

    try {
      const { stopVlmWorker } = await import('./workers/vlm.worker');
      shutdownOps.push(stopVlmWorker());
    } catch {
      // Optional — VLM worker may be disabled or not loaded
    }

    try {
      const { stopWebhookWorker } = await import('./workers/webhook.worker');
      shutdownOps.push(stopWebhookWorker());
    } catch {
      // Optional — webhook worker only starts when WEBHOOK_SIGNING_SECRET set
    }

    try {
      const { shutdownQueues } = await import('./lib/queue');
      shutdownOps.push(shutdownQueues());
    } catch {
      // Optional shutdown step — module may not be loaded
    }
  }

  await Promise.allSettled(shutdownOps);
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', async (error) => {
  console.error('Uncaught Exception:', error);
  const { captureException, sentryEnabled } = await import('./lib/sentry');
  if (sentryEnabled) captureException(error);
});

process.on('unhandledRejection', async (reason, promise) => {
  console.error('Unhandled Promise Rejection at:', promise, 'Reason:', reason);
  const { captureException, sentryEnabled } = await import('./lib/sentry');
  if (sentryEnabled && reason instanceof Error) captureException(reason);
});

// Start pricing heartbeat (12-hour cycle)
import('./services/pricing/heartbeat')
  .then(({ startPricingHeartbeat }) => startPricingHeartbeat())
  .catch((err) => console.warn('[pricing] Failed to start heartbeat:', err));

// Abuse-detect scan (opt-in via ABUSE_DETECT_ENABLED=true). Only one replica
// should run this in a multi-replica deploy — gate on e.g. a dedicated
// worker hostname or a Redis-locked leader election before turning on
// globally.
import('./jobs/abuse-detect')
  .then(({ startAbuseDetectJob }) => startAbuseDetectJob())
  .catch((err) => console.warn('[abuse-detect] failed to start:', err));

// DMCA § 512(g) counter-notice auto-putback (opt-in via DMCA_PUTBACK_ENABLED=true).
// Like abuse-detect, only ONE replica should run this to avoid duplicate writes.
import('./jobs/dmca-putback')
  .then(({ startDmcaPutbackJob }) => startDmcaPutbackJob())
  .catch((err) => console.warn('[dmca-putback] failed to start:', err));

// Cost / margin alert sweep (opt-in via COST_ALERT_ENABLED=true). Same
// one-replica rule as the other background jobs.
import('./jobs/cost-alerts')
  .then(({ startCostAlertJob }) => startCostAlertJob())
  .catch((err) => console.warn('[cost-alerts] failed to start:', err));

const port = env.PORT;

console.log(`Starting server on port ${port}`);
console.log(`CORS origin: ${env.CORS_ORIGIN || 'http://localhost:5173 (default)'}`);
console.log(`Environment: ${env.NODE_ENV}`);

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Server listening on http://localhost:${info.port}`);
});

// Video generation (Seedance, Veo, etc.) can take 2-5 minutes.
// Default Node.js HTTP server timeout (2 min) kills connections mid-generation.
if ('requestTimeout' in server) {
  (server as any).requestTimeout = 600_000; // 10 minutes
  (server as any).headersTimeout = 600_000;
  (server as any).keepAliveTimeout = 620_000;
}
