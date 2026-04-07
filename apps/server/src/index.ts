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

import { serve } from '@hono/node-server';
import { trpcServer } from '@hono/trpc-server';
import { createContext } from './lib/context';
import { appRouter } from './routers/index';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { imageRouter } from './routes/image';
import { authRoutes } from './routes/auth';
import { verifyAuth } from './lib/auth';
import { securityHeaders } from './middleware/security-headers';
import { rateLimiter } from './middleware/rate-limit';
import { errorHandler } from './middleware/error-handler';

const app = new Hono();

// Global error handler
app.onError(errorHandler);

// Security headers on all responses
app.use('/*', securityHeaders);

// Rate limiting: 100 requests per minute per IP
app.use('/*', rateLimiter({ windowMs: 60_000, max: 100 }));

app.use(logger());

app.use(
  '/*',
  cors({
    origin: env.CORS_ORIGIN || 'http://localhost:3001',
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  })
);

// SIWE authentication routes
app.route('/auth', authRoutes);

// Add image serving routes
app.route('/images', imageRouter);

// Add Filecoin content serving route
app.get('/api/filecoin/:pieceCid', async (c) => {
  // Require authentication
  const user = await verifyAuth(c.req.raw.headers);
  if (!user) {
    return c.json({ code: 'UNAUTHORIZED', message: 'Authentication required' }, 401);
  }

  let downloadTimeout: NodeJS.Timeout | undefined;

  try {
    const pieceCid = c.req.param('pieceCid');

    if (!pieceCid || pieceCid.length < 10) {
      return c.json({ code: 'BAD_REQUEST', message: 'Invalid PieceCID format' }, 400);
    }

    const { getSynapseService } = await import('./services/synapse');
    const service = await getSynapseService();

    const downloadPromise = service.download(pieceCid).then((data) => {
      return data as Uint8Array;
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      downloadTimeout = setTimeout(() => {
        reject(new Error('Download timeout after 2 minutes'));
      }, 120000);
    });

    const data = await Promise.race([downloadPromise, timeoutPromise]);

    if (downloadTimeout) {
      clearTimeout(downloadTimeout);
    }

    if (data.length > 50 * 1024 * 1024) {
      return c.json(
        {
          code: 'PAYLOAD_TOO_LARGE',
          message: `File too large: ${Math.round(data.length / 1024 / 1024)}MB (max 50MB)`,
        },
        413
      );
    }

    return new Response(Buffer.from(data), {
      headers: {
        'Content-Type': 'video/mp4',
        'Cache-Control': 'public, max-age=31536000',
        'Accept-Ranges': 'bytes',
        'Content-Length': data.length.toString(),
      },
    });
  } catch (error) {
    if (downloadTimeout) {
      clearTimeout(downloadTimeout);
    }

    console.error(`Error serving Filecoin content for ${c.req.param('pieceCid')}:`, error);

    return c.json(
      {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to retrieve content',
      },
      500
    );
  }
});

// Direct file upload endpoint (multipart form, bypasses tRPC for large files)
app.post('/api/upload', async (c) => {
  const user = await verifyAuth(c.req.raw.headers);
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
  });
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Promise Rejection at:', promise, 'Reason:', reason);
});

const port = env.PORT;

console.log(`Starting server on port ${port}`);
console.log(`CORS origin: ${env.CORS_ORIGIN || 'http://localhost:3001 (default)'}`);
console.log(`Environment: ${env.NODE_ENV}`);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Server listening on http://localhost:${info.port}`);
});
