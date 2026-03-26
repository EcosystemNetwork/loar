import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
import { trpcServer } from "@hono/trpc-server";
import { createContext } from "./lib/context";
import { appRouter } from "./routers/index";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { imageRouter } from "./routes/image";

const app = new Hono();

app.use(logger());
app.use(
  "/*",
  cors({
    origin: process.env.CORS_ORIGIN || "",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

// Add image serving routes
app.route("/images", imageRouter);

// Add Filecoin content serving route
app.get("/api/filecoin/:pieceCid", async (c) => {
  let downloadTimeout: NodeJS.Timeout | undefined;

  try {
    const pieceCid = c.req.param("pieceCid");
    console.log(`Serving Filecoin content for PieceCID: ${pieceCid}`);

    if (!pieceCid || pieceCid.length < 10) {
      return c.json({ error: "Invalid PieceCID format" }, 400);
    }

    const { synapseService } = await import("./services/synapse");
    const service = await synapseService;

    const downloadPromise = new Promise<Uint8Array>(async (resolve, reject) => {
      try {
        const data = await service.download(pieceCid);
        resolve(data);
      } catch (error) {
        reject(error);
      }
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
      return c.json({ error: `File too large: ${Math.round(data.length / 1024 / 1024)}MB (max 50MB)` }, 413);
    }

    return new Response(Buffer.from(data), {
      headers: {
        "Content-Type": "video/mp4",
        "Cache-Control": "public, max-age=31536000",
        "Accept-Ranges": "bytes",
        "Content-Length": data.length.toString(),
      },
    });

  } catch (error) {
    if (downloadTimeout) {
      clearTimeout(downloadTimeout);
    }

    console.error(`Error serving Filecoin content for ${c.req.param("pieceCid")}:`, error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({
      error: "Failed to retrieve content from Filecoin",
      details: errorMessage,
      pieceCid: c.req.param("pieceCid")
    }, 500);
  }
});

app.use(
  "/trpc/*",
  trpcServer({
    router: appRouter,
    createContext: (_opts, context) => {
      return createContext({ context });
    },
  })
);

app.get("/", (c) => {
  return c.text("OK");
});

app.get("/health", (c) => {
  return c.json({ status: "healthy", timestamp: new Date().toISOString() });
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Promise Rejection at:', promise, 'Reason:', reason);
});

const port = parseInt(process.env.PORT || "3000");

console.log(`Starting server on port ${port}`);
console.log(`CORS origin: ${process.env.CORS_ORIGIN || "not set"}`);

export default {
  port,
  fetch: app.fetch,
};
