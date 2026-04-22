const PUBLIC_GATEWAY = 'https://gateway.pinata.cloud';
const CONFIGURED_GATEWAY = (import.meta.env.VITE_PINATA_GATEWAY_URL || PUBLIC_GATEWAY)
  .trim()
  .replace(/\/$/, '');
const GATEWAY_TOKEN = (import.meta.env.VITE_PINATA_GATEWAY_TOKEN || '').trim();
const PREFER_PUBLIC =
  String(import.meta.env.VITE_PINATA_PREFER_PUBLIC || '')
    .trim()
    .toLowerCase() === 'true';

let CONFIGURED_HOST = '';
try {
  CONFIGURED_HOST = new URL(CONFIGURED_GATEWAY).host;
} catch {
  CONFIGURED_HOST = '';
}

const IS_DEDICATED_GATEWAY = CONFIGURED_HOST.endsWith('.mypinata.cloud');
const BYPASS_DEDICATED = PREFER_PUBLIC || (IS_DEDICATED_GATEWAY && !GATEWAY_TOKEN);

const ACTIVE_GATEWAY = BYPASS_DEDICATED ? PUBLIC_GATEWAY : CONFIGURED_GATEWAY;
const ACTIVE_HOST = BYPASS_DEDICATED ? 'gateway.pinata.cloud' : CONFIGURED_HOST;

if (IS_DEDICATED_GATEWAY && !GATEWAY_TOKEN && typeof console !== 'undefined') {
  console.warn(
    '[ipfs-url] Dedicated Pinata gateway configured without VITE_PINATA_GATEWAY_TOKEN — falling back to public gateway. Dedicated gateways on *.mypinata.cloud require a token or custom domain.'
  );
}

function appendToken(url: string): string {
  try {
    const parsed = new URL(url);
    if (!parsed.host.endsWith('.mypinata.cloud') && parsed.host !== ACTIVE_HOST) return url;
    if (BYPASS_DEDICATED) {
      parsed.searchParams.delete('pinataGatewayToken');
      return parsed.toString();
    }
    const existing = parsed.searchParams.get('pinataGatewayToken');
    if (existing !== null) {
      const cleaned = existing.trim();
      if (cleaned !== existing) {
        parsed.searchParams.set('pinataGatewayToken', cleaned);
        return parsed.toString();
      }
      return url;
    }
    if (!GATEWAY_TOKEN) return url;
    parsed.searchParams.set('pinataGatewayToken', GATEWAY_TOKEN);
    return parsed.toString();
  } catch {
    return url;
  }
}

function rewriteBrokenDedicatedGatewayUrl(url: string): string {
  if (!BYPASS_DEDICATED) return url;
  try {
    const parsed = new URL(url);
    if (!parsed.host.endsWith('.mypinata.cloud')) return url;
    parsed.searchParams.delete('pinataGatewayToken');
    return `${PUBLIC_GATEWAY}${parsed.pathname}${parsed.search ? parsed.search : ''}`;
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
