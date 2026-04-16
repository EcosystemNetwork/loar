import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

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
const allowedOrigins = (env.CORS_ORIGIN || 'http://localhost:3001')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  '/*',
  cors({
    origin: (origin) => {
      // Non-browser requests (curl, server-to-server) have no Origin header.
      // Allow them through CORS — auth middleware handles access control.
      if (!origin) return allowedOrigins[0];
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
    const isOctetStream = file.type === 'application/octet-stream' || file.type === '';
    if (
      !allowedMimeTypes.has(file.type) &&
      !(isOctetStream && allowedBinaryExtensions.has(fileExt))
    ) {
      return c.json(
        { code: 'BAD_REQUEST', message: `Unsupported file type: ${file.type || fileExt}` },
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

// Stricter rate limits for AI generation endpoints: 10 requests/min per IP per endpoint
app.use('/trpc/generation.*', aiRateLimiter({ windowMs: 60_000, max: 10 }));
app.use('/trpc/image.*', aiRateLimiter({ windowMs: 60_000, max: 10 }));
app.use('/trpc/voice.*', aiRateLimiter({ windowMs: 60_000, max: 10 }));
app.use('/trpc/threed.*', aiRateLimiter({ windowMs: 60_000, max: 10 }));

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

  const checks = {
    firebase: firebaseAvailable ? 'ok' : 'degraded',
  };

  const status = Object.values(checks).every((v) => v === 'ok') ? 'healthy' : 'degraded';

  return c.json({
    status,
    service: 'loar-server',
    version: process.env.npm_package_version || '0.0.0',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    env: env.NODE_ENV,
    checks,
    pricing: getPricingStatus(),
  });
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Promise Rejection at:', promise, 'Reason:', reason);
});

// Start pricing heartbeat (12-hour cycle)
import('./services/pricing/heartbeat')
  .then(({ startPricingHeartbeat }) => startPricingHeartbeat())
  .catch((err) => console.warn('[pricing] Failed to start heartbeat:', err));

const port = env.PORT;

console.log(`Starting server on port ${port}`);
console.log(`CORS origin: ${env.CORS_ORIGIN || 'http://localhost:3001 (default)'}`);
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
