/**
 * OAuth 2.1 / RFC 8414 server metadata documents.
 *
 * Discovery is what lets an MCP client (OpenClaw / Hermes / Claude Desktop
 * remote connector) learn our authorization + token endpoints without
 * hardcoding them — user pastes the hostname, the agent does the rest.
 */
export declare function authorizationServerMetadata(issuer: string): {
    issuer: string;
    authorization_endpoint: string;
    token_endpoint: string;
    response_types_supported: string[];
    grant_types_supported: string[];
    token_endpoint_auth_methods_supported: string[];
    code_challenge_methods_supported: string[];
    scopes_supported: string[];
    service_documentation: string;
};
/**
 * MCP-specific protected-resource metadata. Tells clients which
 * authorization server to use for this MCP endpoint.
 */
export declare function protectedResourceMetadata(issuer: string): {
    resource: string;
    authorization_servers: string[];
    scopes_supported: string[];
    bearer_methods_supported: string[];
    resource_documentation: string;
};
