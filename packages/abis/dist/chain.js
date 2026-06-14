/**
 * Chain namespace discriminator for EVM flows.
 *
 * Uses CAIP-2 conventions:
 *   eip155:<chainId>            — EVM chains (1, 11155111)
 *
 * The rest of the codebase (auth, Circle DCW, indexer, frontend wallet UX)
 * branches on `namespace` to pick the right adapter.
 */
export function isEvmChain(ref) {
    return ref.namespace === 'eip155';
}
/** Canonical CAIP-2 string ("eip155:11155111"). */
export function formatChainRef(ref) {
    return `eip155:${ref.chainId}`;
}
/** Parse a CAIP-2 string back to a typed ChainRef. Returns null on invalid input. */
export function parseChainRef(caip) {
    const [ns, rest] = caip.split(':');
    if (!ns || !rest)
        return null;
    if (ns === 'eip155') {
        const id = Number(rest);
        return Number.isFinite(id) && id > 0 ? { namespace: 'eip155', chainId: id } : null;
    }
    return null;
}
/**
 * Detect an address's namespace by shape alone.
 *   eip155: 0x + 40 hex chars
 */
const EVM_ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
export function detectAddressNamespace(address) {
    if (EVM_ADDR_RE.test(address))
        return 'eip155';
    return null;
}
