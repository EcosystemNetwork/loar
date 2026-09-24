/**
 * Meshy remesh — client + dispatcher, run against a REAL local HTTP server that
 * implements Meshy's documented remesh contract (POST /openapi/v1/remesh ->
 * {result}, GET /openapi/v1/remesh/:id -> task). No fetch mocking: the real
 * fetch, JSON handling and polling loop all execute.
 *
 * Not verified against the live Meshy API (no key available here).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

const HOST = vi.hoisted(() => {
  // Fixed high port so MESHY_API_HOST is known before the service module loads.
  const port = 40000 + Math.floor(Math.random() * 20000);
  process.env.MESHY_API_HOST = `http://127.0.0.1:${port}`;
  return { port };
});

vi.mock('../lib/byok', async (orig) => ({
  ...(await orig<typeof import('../lib/byok')>()),
  resolveProviderKey: async () => 'test-key',
}));

interface Seen {
  method: string;
  url: string;
  auth?: string;
  body?: any;
}
let seen: Seen[] = [];
/** Statuses the GET endpoint walks through, one per poll. */
let script: Array<Record<string, unknown>> = [];
let server: Server;

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      seen.push({
        method: req.method!,
        url: req.url!,
        auth: req.headers.authorization,
        body: raw ? JSON.parse(raw) : undefined,
      });
      res.setHeader('content-type', 'application/json');
      if (req.method === 'POST' && req.url === '/openapi/v1/remesh') {
        res.end(JSON.stringify({ result: 'task-123' }));
      } else if (req.method === 'GET' && req.url === '/openapi/v1/remesh/task-123') {
        const next = script.length > 1 ? script.shift()! : script[0];
        res.end(JSON.stringify({ id: 'task-123', type: 'remesh', progress: 50, ...next }));
      } else {
        res.statusCode = 404;
        res.end(JSON.stringify({ message: 'not found' }));
      }
    });
  });
  await new Promise<void>((r) => server.listen(HOST.port, '127.0.0.1', r));
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  seen = [];
  script = [{ status: 'SUCCEEDED', model_urls: { glb: 'https://cdn/x.glb' } }];
});

describe('meshyService.remesh', () => {
  it('posts the documented body; input_task_id wins over model_url', async () => {
    const { meshyService } = await import('../services/meshy');
    const { taskId } = await meshyService.remesh({
      apiKey: 'k1',
      inputTaskId: 'prev-task',
      modelUrl: 'https://ignored/x.glb',
      targetFormats: ['glb', 'fbx'],
      topology: 'quad',
      targetPolycount: 12_000,
    });
    expect(taskId).toBe('task-123');
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ method: 'POST', url: '/openapi/v1/remesh', auth: 'Bearer k1' });
    expect(seen[0].body).toEqual({
      input_task_id: 'prev-task',
      target_formats: ['glb', 'fbx'],
      topology: 'quad',
      target_polycount: 12_000,
    });
  });

  it('sends model_url when there is no task id, and omits unset options', async () => {
    const { meshyService } = await import('../services/meshy');
    await meshyService.remesh({ apiKey: 'k', modelUrl: 'https://cdn/in.glb' });
    expect(seen[0].body).toEqual({ model_url: 'https://cdn/in.glb' });
  });

  it('rejects bad input BEFORE any request is made', async () => {
    const { meshyService } = await import('../services/meshy');
    await expect(meshyService.remesh({ apiKey: 'k' })).rejects.toThrow('modelUrl or inputTaskId');
    await expect(
      meshyService.remesh({ apiKey: 'k', modelUrl: 'u', targetPolycount: 50 })
    ).rejects.toThrow('between 100 and 300000');
    await expect(
      meshyService.remesh({ apiKey: 'k', modelUrl: 'u', targetPolycount: 300_001 })
    ).rejects.toThrow('between 100 and 300000');
    await expect(
      meshyService.remesh({ apiKey: 'k', modelUrl: 'u', targetFormats: ['exe' as any] })
    ).rejects.toThrow('unsupported remesh format');
    await expect(meshyService.remesh({ modelUrl: 'u' })).rejects.toThrow('No Meshy API key');
    expect(seen).toHaveLength(0);
  });

  it('surfaces an HTTP error from Meshy', async () => {
    const { meshyService } = await import('../services/meshy');
    await expect(meshyService.getRemeshTask('nope', 'k')).rejects.toThrow('Meshy API error 404');
  });
});

describe('meshyService.waitForRemesh', () => {
  it('polls PENDING -> IN_PROGRESS -> SUCCEEDED and exposes camelCase urls', async () => {
    const { meshyService } = await import('../services/meshy');
    script = [
      { status: 'PENDING' },
      { status: 'IN_PROGRESS' },
      {
        status: 'SUCCEEDED',
        model_urls: { glb: 'https://cdn/out.glb', fbx: 'https://cdn/out.fbx' },
        thumbnail_url: 'https://cdn/t.png',
      },
    ];
    const task = await meshyService.waitForRemesh('task-123', 5000, 10, 'k');
    expect(seen.filter((s) => s.method === 'GET')).toHaveLength(3);
    expect(task.modelUrls).toEqual({ glb: 'https://cdn/out.glb', fbx: 'https://cdn/out.fbx' });
    expect(task.thumbnailUrl).toBe('https://cdn/t.png');
  });

  it("throws with Meshy's message when the task FAILED", async () => {
    const { meshyService } = await import('../services/meshy');
    script = [{ status: 'FAILED', task_error: { message: 'mesh is non-manifold' } }];
    await expect(meshyService.waitForRemesh('task-123', 5000, 10, 'k')).rejects.toThrow(
      'mesh is non-manifold'
    );
  });

  it('times out if the task never finishes', async () => {
    const { meshyService } = await import('../services/meshy');
    script = [{ status: 'IN_PROGRESS' }];
    await expect(meshyService.waitForRemesh('task-123', 60, 20, 'k')).rejects.toThrow('timed out');
  });
});

describe('dispatchThreed(meshy-remesh)', () => {
  it('is wired: remeshes a model URL and returns the mesh urls', async () => {
    const { dispatchThreed } = await import('../services/threed-models');
    script = [
      {
        status: 'SUCCEEDED',
        model_urls: { glb: 'https://cdn/r.glb', obj: 'https://cdn/r.obj' },
        thumbnail_url: 'https://cdn/t.png',
      },
    ];
    const out = await dispatchThreed({
      modelId: 'meshy-remesh',
      modelUrl: 'https://cdn/in.glb',
      topology: 'quad',
      targetPolycount: 8000,
      targetFormats: ['glb', 'obj'],
      userId: 'u1',
    });
    expect(out).toMatchObject({
      task: 'remesh',
      status: 'completed',
      taskId: 'task-123',
      modelUrl: 'https://cdn/r.glb',
      modelUrls: { glb: 'https://cdn/r.glb', obj: 'https://cdn/r.obj' },
      thumbnailUrl: 'https://cdn/t.png',
    });
    expect(seen[0].body).toMatchObject({ topology: 'quad', target_polycount: 8000 });
  });

  it('falls back to another format when glb was not requested', async () => {
    const { dispatchThreed } = await import('../services/threed-models');
    script = [{ status: 'SUCCEEDED', model_urls: { stl: 'https://cdn/r.stl' } }];
    const out = await dispatchThreed({
      modelId: 'meshy-remesh',
      inputTaskId: 'prev',
      targetFormats: ['stl'],
      userId: 'u1',
    });
    expect(out.modelUrl).toBe('https://cdn/r.stl');
  });

  it('rejects a missing source and an out-of-range polycount as BAD_REQUEST', async () => {
    const { dispatchThreed } = await import('../services/threed-models');
    await expect(dispatchThreed({ modelId: 'meshy-remesh', userId: 'u1' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    await expect(
      dispatchThreed({ modelId: 'meshy-remesh', modelUrl: 'u', targetPolycount: 5, userId: 'u1' })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(seen).toHaveLength(0);
  });

  it('a failed remesh task surfaces as BAD_GATEWAY (so the caller refunds)', async () => {
    const { dispatchThreed } = await import('../services/threed-models');
    script = [{ status: 'FAILED', task_error: { message: 'boom' } }];
    await expect(
      dispatchThreed({ modelId: 'meshy-remesh', modelUrl: 'u', userId: 'u1' })
    ).rejects.toMatchObject({ code: 'BAD_GATEWAY' });
  });
});
