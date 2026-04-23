/**
 * IPFS URL resolver for React Native.
 *
 * Mirrors the behavior of apps/web/src/utils/ipfs-url.ts so mobile `<Image>`
 * components can consume the same Pinata dedicated-gateway URLs that the web
 * uses (which 401 without a gateway token).
 *
 * Env:
 *   EXPO_PUBLIC_PINATA_GATEWAY_URL   — dedicated gateway, falls back to public
 *   EXPO_PUBLIC_PINATA_GATEWAY_TOKEN — token for dedicated gateway, optional
 */
const PUBLIC_GATEWAY = 'https://gateway.pinata.cloud';
const CONFIGURED_GATEWAY = (process.env.EXPO_PUBLIC_PINATA_GATEWAY_URL || PUBLIC_GATEWAY)
  .trim()
  .replace(/\/$/, '');
const GATEWAY_TOKEN = (process.env.EXPO_PUBLIC_PINATA_GATEWAY_TOKEN || '').trim();

let CONFIGURED_HOST = '';
try {
  CONFIGURED_HOST = new URL(CONFIGURED_GATEWAY).host;
} catch {
  CONFIGURED_HOST = '';
}

const IS_DEDICATED = CONFIGURED_HOST.endsWith('.mypinata.cloud');
const BYPASS_DEDICATED = IS_DEDICATED && !GATEWAY_TOKEN;
const ACTIVE_GATEWAY = BYPASS_DEDICATED ? PUBLIC_GATEWAY : CONFIGURED_GATEWAY;

function appendToken(url: string): string {
  if (!GATEWAY_TOKEN) return url;
  try {
    const parsed = new URL(url);
    if (!parsed.host.endsWith('.mypinata.cloud')) return url;
    if (parsed.searchParams.has('pinataGatewayToken')) return url;
    parsed.searchParams.set('pinataGatewayToken', GATEWAY_TOKEN);
    return parsed.toString();
  } catch {
    return url;
  }
}

function rewriteBrokenDedicatedUrl(url: string): string {
  if (!BYPASS_DEDICATED) return url;
  try {
    const parsed = new URL(url);
    if (!parsed.host.endsWith('.mypinata.cloud')) return url;
    parsed.host = 'gateway.pinata.cloud';
    parsed.searchParams.delete('pinataGatewayToken');
    return parsed.toString();
  } catch {
    return url;
  }
}

export function resolveIpfsUrl(url?: string | null): string {
  if (!url) return '';
  if (url.startsWith('ipfs://')) {
    const cid = url.slice('ipfs://'.length).replace(/^ipfs\//, '');
    return appendToken(`${ACTIVE_GATEWAY}/ipfs/${cid}`);
  }
  return appendToken(rewriteBrokenDedicatedUrl(url));
}
