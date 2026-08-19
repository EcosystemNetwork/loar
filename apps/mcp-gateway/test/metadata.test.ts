import { describe, expect, it } from 'vitest';
import { authorizationServerMetadata, protectedResourceMetadata } from '../src/metadata';

const ISSUER = 'https://mcp.loar.fun';

describe('OAuth / MCP metadata', () => {
  it('authorizationServerMetadata builds the discovery document', () => {
    const meta = authorizationServerMetadata(ISSUER);
    expect(meta.issuer).toBe(ISSUER);
    expect(meta.authorization_endpoint).toBe(`${ISSUER}/authorize`);
    expect(meta.token_endpoint).toBe(`${ISSUER}/token`);
    expect(meta.response_types_supported).toContain('code');
    expect(meta.grant_types_supported).toContain('authorization_code');
    expect(meta.code_challenge_methods_supported).toContain('S256');
    expect(meta.scopes_supported).toContain('mcp_server');
  });

  it('protectedResourceMetadata points at the SSE resource', () => {
    const meta = protectedResourceMetadata(ISSUER);
    expect(meta.resource).toBe(`${ISSUER}/sse`);
    expect(meta.authorization_servers).toEqual([ISSUER]);
    expect(meta.bearer_methods_supported).toContain('header');
    expect(meta.scopes_supported).toContain('mcp_server');
  });
});
