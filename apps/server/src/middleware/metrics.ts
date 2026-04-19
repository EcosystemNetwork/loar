import type { Context, Next } from 'hono';
import { recordHttpRequest } from '../lib/metrics';

/**
 * Records HTTP request count and duration to Prometheus.
 *
 * Uses the Hono matched route pattern when available (e.g. `/api/takedown/:id/status`)
 * rather than the raw URL to keep label cardinality bounded. Requests that miss
 * every registered route are recorded under `__not_found__`.
 */
export function metricsMiddleware() {
  return async (c: Context, next: Next) => {
    // The metrics endpoint must not record itself — scraping every 15s would
    // dominate the loar_http_requests_total counter.
    if (c.req.path === '/metrics') return next();

    const start = process.hrtime.bigint();
    let statusCode = 0;
    try {
      await next();
      statusCode = c.res.status;
    } catch (err) {
      statusCode = 500;
      throw err;
    } finally {
      const elapsedSec = Number(process.hrtime.bigint() - start) / 1e9;
      const route = c.req.routePath || '__not_found__';
      recordHttpRequest(c.req.method, route, statusCode || 0, elapsedSec);
    }
  };
}
