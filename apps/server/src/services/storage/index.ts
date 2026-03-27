/** Barrel exports for the unified decentralized storage layer. */
export type { StorageProvider, UploadResult, StorageManifest, ProviderStatus } from './types';
export { computeSha256, sha256ToBytes32, getMimeType } from './types';
export { WalrusProvider } from './walrus';
export { IpfsProvider } from './ipfs';
export { SynapseAdapter } from './synapse-adapter';
export { FirebaseAdapter } from './firebase-adapter';
export { StorageManager, getStorageManager } from './manager';
