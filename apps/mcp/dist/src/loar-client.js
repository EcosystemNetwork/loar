/**
 * LOAR API Client — HTTP client for calling the LOAR tRPC server
 *
 * Used by MCP tools to make authenticated requests to the LOAR server.
 * Authenticates via API key (X-API-Key header).
 */
export class LoarClient {
    serverUrl;
    apiKey;
    constructor(config) {
        this.serverUrl = config.serverUrl.replace(/\/$/, '');
        this.apiKey = config.apiKey;
    }
    /**
     * Call a tRPC query endpoint
     */
    async query(path, input) {
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
        return json.result?.data;
    }
    /**
     * Call a tRPC mutation endpoint
     */
    async mutate(path, input) {
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
        return json.result?.data;
    }
}
