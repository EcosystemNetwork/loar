/**
 * Storage domain barrel — unified + provider-specific storage routers.
 *
 * `storageRouter` — Unified StorageManager (Walrus, IPFS, Synapse, Firebase)
 * `firebaseStorageRouter` — Direct Firebase Storage operations
 * `synapseRouter` — Direct Filecoin Synapse operations
 */
export { storageRouter } from './storage.routes';
export { firebaseStorageRouter } from './firebase.routes';
export { synapseRouter } from './synapse.routes';
