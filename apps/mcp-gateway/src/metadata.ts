/**
 * OAuth 2.1 / RFC 8414 server metadata documents.
 *
 * Discovery is what lets an MCP client (OpenClaw / Hermes / Claude Desktop
 * remote connector) learn our authorization + token endpoints without
 * hardcoding them — user pastes the hostname, the agent does the rest.
 */

export function authorizationServerMetadata(issuer: string) {
  return {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    // We sign JWT access tokens ourselves — no JWKS for OAuth yet (tokens
    // are verified with HMAC via the shared OAUTH_JWT_SECRET at the SSE
    // endpoint). If/when we switch to RS256 we'll expose a JWKS URL here.
    // jwks_uri: `${issuer}/.well-known/jwks.json`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    token_endpoint_auth_methods_supported: ['none'], // public client + PKCE
    code_challenge_methods_supported: ['S256'],
    scopes_supported: ['mcp_server'],
    service_documentation: 'https://loar.fun/docs/agent-integration',
  };
}

/**
 * MCP-specific protected-resource metadata. Tells clients which
 * authorization server to use for this MCP endpoint.
 */
export function protectedResourceMetadata(issuer: string) {
  return {
    resource: `${issuer}/sse`,
    authorization_servers: [issuer],
    scopes_supported: ['mcp_server'],
    bearer_methods_supported: ['header'],
    resource_documentation: 'https://loar.fun/docs/agent-integration',
  };
}
