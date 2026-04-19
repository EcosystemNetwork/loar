const PUBLIC_GATEWAY = 'https://gateway.pinata.cloud';
const CONFIGURED_GATEWAY = (import.meta.env.VITE_PINATA_GATEWAY_URL || PUBLIC_GATEWAY).replace(
  /\/$/,
  ''
);
const GATEWAY_TOKEN = import.meta.env.VITE_PINATA_GATEWAY_TOKEN || '';

let CONFIGURED_HOST = '';
try {
  CONFIGURED_HOST = new URL(CONFIGURED_GATEWAY).host;
} catch {
  CONFIGURED_HOST = '';
}

const IS_DEDICATED_GATEWAY = CONFIGURED_HOST.endsWith('.mypinata.cloud');

const ACTIVE_GATEWAY = IS_DEDICATED_GATEWAY && !GATEWAY_TOKEN ? PUBLIC_GATEWAY : CONFIGURED_GATEWAY;
const ACTIVE_HOST =
  IS_DEDICATED_GATEWAY && !GATEWAY_TOKEN ? 'gateway.pinata.cloud' : CONFIGURED_HOST;

if (IS_DEDICATED_GATEWAY && !GATEWAY_TOKEN && typeof console !== 'undefined') {
  console.warn(
    '[ipfs-url] Dedicated Pinata gateway configured without VITE_PINATA_GATEWAY_TOKEN — falling back to public gateway. Dedicated gateways on *.mypinata.cloud require a token or custom domain.'
  );
}

function appendToken(url: string): string {
  if (!GATEWAY_TOKEN) return url;
  try {
    const parsed = new URL(url);
    if (!parsed.host.endsWith('.mypinata.cloud') && parsed.host !== ACTIVE_HOST) return url;
    if (parsed.searchParams.has('pinataGatewayToken')) return url;
    parsed.searchParams.set('pinataGatewayToken', GATEWAY_TOKEN);
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Rewrites legacy dedicated-gateway URLs that are now 403ing because the gateway
 * requires a token we don't have. Returns the original URL untouched if it's not
 * a known-broken dedicated-gateway URL.
 */
function rewriteBrokenDedicatedGatewayUrl(url: string): string {
  if (GATEWAY_TOKEN) return url;
  try {
    const parsed = new URL(url);
    if (!parsed.host.endsWith('.mypinata.cloud')) return url;
    return `${PUBLIC_GATEWAY}${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

export function resolveIpfsUrl(url?: string | null): string {
  if (!url) return '';
  if (url.startsWith('ipfs://')) {
    const path = url.slice('ipfs://'.length).replace(/^ipfs\//, '');
    return appendToken(`${ACTIVE_GATEWAY}/ipfs/${path}`);
  }
  return appendToken(rewriteBrokenDedicatedGatewayUrl(url));
}
