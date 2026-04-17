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
const { z } = await import('zod');

const app = new Hono();

// Global error handler
app.onError(errorHandler);

// Security headers on all responses
app.use('/*', securityHeaders);

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

// Stripe webhook (must be before body-parsing middleware — needs raw body)
const { stripeWebhookRoutes } = await import('./routes/stripe-webhook');
app.route('/api/stripe', stripeWebhookRoutes);

// SIWE authentication routes — stricter rate limit (10 req/min per IP)
app.use('/auth/*', rateLimiter({ windowMs: 60_000, max: 10 }));
app.route('/auth', authRoutes);

// Add image serving routes
app.route('/images', imageRouter);

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
    const clientMime = detectedMime ?? file.type;

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
      'image/svg+xml',
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
    const manifest = await manager.upload(buffer, file.name, file.type);

    return c.json({ manifest });
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

// ── Public DMCA takedown REST endpoint (no auth required) ───────────
// External reporters can't use tRPC, so this mirrors moderation.submitTakedown as REST.
// Strict rate limit: 5 requests per minute per IP to prevent mass-flagging abuse
app.use('/api/takedown', rateLimiter({ windowMs: 60_000, max: 5 }));
app.post('/api/takedown', async (c) => {
  const takedownSchema = z.object({
    contentId: z.string().min(1),
    claimantName: z.string().min(1).max(200),
    claimantEmail: z.string().email(),
    copyrightWork: z.string().min(1).max(500),
    explanation: z.string().min(20).max(5000),
    swornStatement: z.literal(true),
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
    const { contentId, claimantName, claimantEmail, copyrightWork, explanation } = parsed.data;

    const { firebaseAvailable: fbAvail, db: fireDb } = await import('./lib/firebase');
    if (!fbAvail || !fireDb) {
      return c.json({ code: 'SERVICE_UNAVAILABLE', message: 'Service not available' }, 503);
    }

    const now = new Date();
    const request = {
      contentId,
      claimantName,
      claimantEmail,
      copyrightWork,
      explanation,
      status: 'pending',
      createdAt: now.toISOString(),
    };

    const ref = await fireDb.collection('takedownRequests').add(request);

    // Auto-flag the content
    await fireDb
      .collection('content')
      .doc(contentId)
      .update({
        contentStatus: 'flagged',
        contentStatusUpdatedAt: now.toISOString(),
        contentStatusUpdatedBy: 'dmca_takedown',
      })
      .catch(() => {});

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

    // Prevent duplicate counter-notices for the same takedown from the same email
    const existing = await fireDb
      .collection('counterNotices')
      .where('takedownRequestId', '==', takedownRequestId)
      .where('respondentEmail', '==', respondentEmail)
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

// ── Public takedown status endpoint ──────────────────────────────────
// Anyone can check the status of a takedown request and its counter-notice.
app.get('/api/takedown/:id/status', async (c) => {
  try {
    const takedownId = c.req.param('id');

    const { firebaseAvailable: fbAvail, db: fireDb } = await import('./lib/firebase');
    if (!fbAvail || !fireDb) {
      return c.json({ code: 'SERVICE_UNAVAILABLE', message: 'Service not available' }, 503);
    }

    const takedownDoc = await fireDb.collection('takedownRequests').doc(takedownId).get();
    if (!takedownDoc.exists) {
      return c.json({ code: 'NOT_FOUND', message: 'Takedown request not found' }, 404);
    }

    const takedown = takedownDoc.data()!;
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

// Stricter rate limits for AI generation endpoints: 10 requests/min per IP per endpoint
app.use('/trpc/generation.*', aiRateLimiter({ windowMs: 60_000, max: 10 }));
app.use('/trpc/image.*', aiRateLimiter({ windowMs: 60_000, max: 10 }));
app.use('/trpc/voice.*', aiRateLimiter({ windowMs: 60_000, max: 10 }));
app.use('/trpc/threed.*', aiRateLimiter({ windowMs: 60_000, max: 10 }));
app.use('/trpc/audio.*', aiRateLimiter({ windowMs: 60_000, max: 10 }));

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

  // Set up SSE
  c.header('Content-Type', 'text/event-stream');
  c.header('Cache-Control', 'no-cache');
  c.header('Connection', 'keep-alive');

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: any) => {
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
}

// ── Graceful shutdown ──────────────────────────────────────────────────
async function gracefulShutdown(signal: string) {
  console.log(`\n[server] Received ${signal} — shutting down gracefully...`);
  const shutdownOps: Promise<void>[] = [];

  try {
    const { shutdownRedis } = await import('./lib/redis');
    shutdownOps.push(shutdownRedis());
  } catch {}

  if (process.env.REDIS_URL) {
    try {
      const { stopGenerationWorker } = await import('./workers/generation.worker');
      shutdownOps.push(stopGenerationWorker());
    } catch {}

    try {
      const { shutdownQueues } = await import('./lib/queue');
      shutdownOps.push(shutdownQueues());
    } catch {}
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
