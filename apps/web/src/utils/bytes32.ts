/**
 * bytes32 hash detection.
 *
 * On-chain the Universe contract stores only `bytes32` content/plot hashes;
 * the resolved video URL / plot text come from the Ponder indexer. When the
 * indexer has nothing, callers fall back to the raw on-chain value — which
 * is one of these hashes and must NOT be shown to the user or fed to a
 * <video> tag. Three call sites (the timeline editor graph rebuild, the
 * branching player, useContractSave's previousEvents backfill) each had
 * their own copy of this check; this is the single source of truth.
 */
export function isBytes32Hash(value: unknown): boolean {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value);
}
