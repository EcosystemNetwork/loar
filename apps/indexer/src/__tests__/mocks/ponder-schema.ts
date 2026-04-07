/**
 * Mock for the `ponder:schema` virtual module.
 * Each export is just a string identifier — the mock db doesn't need the real schema objects.
 */
export const universe = 'universe';
export const token = 'token';
export const hookEvent = 'hookEvent';
export const node = 'node';
export const nodeCanonization = 'nodeCanonization';
export const nodeContent = 'nodeContent';
export const tokenTransfer = 'tokenTransfer';
export const tokenHolder = 'tokenHolder';
export const pool = 'pool';
export const swap = 'swap';
export const proposal = 'proposal';
export const proposalExecution = 'proposalExecution';
export const proposalCancellation = 'proposalCancellation';
export const vote = 'vote';

export default {
  universe,
  token,
  hookEvent,
  node,
  nodeCanonization,
  nodeContent,
  tokenTransfer,
  tokenHolder,
  pool,
  swap,
  proposal,
  proposalExecution,
  proposalCancellation,
  vote,
};
