/**
 * LOAR API Client — HTTP client for calling the LOAR tRPC server
 *
 * Used by MCP tools to make authenticated requests to the LOAR server.
 * Authenticates via API key using `Authorization: Bearer loar_<...>`.
 * (Server also accepts the legacy `X-API-Key` header for the same key.)
 */
export class LoarApiError extends Error {
  readonly status: number;
  readonly body: string;
  readonly errorCode: string;
  constructor(status: number, body: string, errorCode: string) {
    super(`LOAR API error (${status}): ${body}`);
    this.name = 'LoarApiError';
    this.status = status;
    this.body = body;
    this.errorCode = errorCode;
  }
}

function classifyHttpError(status: number, body: string): string {
  if (status === 429) return 'RATE_LIMITED';
  if (status === 401 || status === 403) {
    const b = body.toLowerCase();
    if (b.includes('credit')) return 'INSUFFICIENT_CREDITS';
    if (b.includes('moderation') || b.includes('flagged')) return 'MODERATION_BLOCKED';
    return 'FORBIDDEN';
  }
  if (status === 400 || status === 422) return 'INVALID_INPUT';
  if (status === 404) return 'NOT_FOUND';
  if (status >= 500) return 'UPSTREAM_TIMEOUT';
  return 'INTERNAL_ERROR';
}

export interface LoarClientConfig {
  serverUrl: string;
  apiKey: string;
  /**
   * Optional end-user wallet address. Sent as `X-Loar-End-User-Address` on
   * every request. LOAR server only honors this header when the API key
   * carries the `mcp_server` scope (SSRF/impersonation guard — see
   * apps/server/src/lib/auth.ts). Used by the hosted MCP gateway to
   * attribute calls back to the authenticated OAuth session subject.
   */
  endUserAddress?: string;
}

export class LoarClient {
  private serverUrl: string;
  private apiKey: string;
  private endUserAddress?: string;

  constructor(config: LoarClientConfig) {
    this.serverUrl = config.serverUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.endUserAddress = config.endUserAddress;
  }

  private authHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    };
    if (this.endUserAddress) {
      headers['X-Loar-End-User-Address'] = this.endUserAddress;
    }
    return headers;
  }

  /**
   * Call a tRPC query endpoint
   */
  async query<T = unknown>(path: string, input?: Record<string, unknown>): Promise<T> {
    const url = new URL(`${this.serverUrl}/trpc/${path}`);
    if (input) {
      url.searchParams.set('input', JSON.stringify(input));
    }

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: this.authHeaders(),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new LoarApiError(res.status, body, classifyHttpError(res.status, body));
    }

    const json = await res.json();
    return json.result?.data as T;
  }

  /**
   * Call a tRPC mutation endpoint
   */
  async mutate<T = unknown>(path: string, input: Record<string, unknown>): Promise<T> {
    const url = `${this.serverUrl}/trpc/${path}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify(input),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new LoarApiError(res.status, body, classifyHttpError(res.status, body));
    }

    const json = await res.json();
    return json.result?.data as T;
  }
}
