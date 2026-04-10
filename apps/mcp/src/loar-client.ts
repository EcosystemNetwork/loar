/**
 * LOAR API Client — HTTP client for calling the LOAR tRPC server
 *
 * Used by MCP tools to make authenticated requests to the LOAR server.
 * Authenticates via API key (X-API-Key header).
 */

export interface LoarClientConfig {
  serverUrl: string;
  apiKey: string;
}

export class LoarClient {
  private serverUrl: string;
  private apiKey: string;

  constructor(config: LoarClientConfig) {
    this.serverUrl = config.serverUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
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
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`LOAR API error (${res.status}): ${body}`);
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
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
      },
      body: JSON.stringify(input),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`LOAR API error (${res.status}): ${body}`);
    }

    const json = await res.json();
    return json.result?.data as T;
  }
}
