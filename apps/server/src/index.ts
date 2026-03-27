import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
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
const corsOrigin = process.env.CORS_ORIGIN;
if (!corsOrigin && process.env.NODE_ENV === 'production') {
  throw new Error('CORS_ORIGIN must be set in production');
}

app.use(
  '/*',
  cors({
    origin: corsOrigin || 'http://localhost:3001',
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
    return c.json({ error: 'Authentication required' }, 401);
  }

  let downloadTimeout: NodeJS.Timeout | undefined;

  try {
    const pieceCid = c.req.param('pieceCid');

    if (!pieceCid || pieceCid.length < 10) {
      return c.json({ error: 'Invalid PieceCID format' }, 400);
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
        { error: `File too large: ${Math.round(data.length / 1024 / 1024)}MB (max 50MB)` },
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
        error: 'Failed to retrieve content',
      },
      500
    );
  }
});

// Direct file upload endpoint (multipart form, bypasses tRPC for large files)
app.post('/api/upload', async (c) => {
  const user = await verifyAuth(c.req.raw.headers);
  if (!user) {
    return c.json({ error: 'Authentication required' }, 401);
  }

  try {
    const body = await c.req.parseBody();
    const file = body['file'];

    if (!(file instanceof File)) {
      return c.json({ error: 'No file provided' }, 400);
    }

    const allowedTypes = ['video/mp4', 'video/webm', 'image/png', 'image/jpeg', 'image/gif'];
    if (!allowedTypes.includes(file.type)) {
      return c.json(
        {
          error: `Unsupported file type: ${file.type}. Allowed: ${allowedTypes.join(', ')}`,
        },
        400
      );
    }

    if (file.size > 200 * 1024 * 1024) {
      return c.json({ error: 'File too large (max 200MB)' }, 413);
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
        error: `Upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
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

app.get('/health', (c) => {
  return c.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Promise Rejection at:', promise, 'Reason:', reason);
});

const port = parseInt(process.env.PORT || '3000');

console.log(`Starting server on port ${port}`);
console.log(`CORS origin: ${process.env.CORS_ORIGIN || 'not set'}`);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Server listening on http://localhost:${info.port}`);
});
