import { beforeEach, describe, expect, it, vi } from 'vitest';

const save = vi.fn();
const makePublic = vi.fn();
const remove = vi.fn();
const file = vi.fn(() => ({
  save,
  makePublic,
  delete: remove,
  download: vi.fn().mockResolvedValue([Buffer.from('data')]),
  exists: vi.fn().mockResolvedValue([true]),
}));

vi.mock('firebase-admin/storage', () => ({
  getStorage: () => ({ bucket: () => ({ file }) }),
}));
vi.unmock('../services/firebase-storage');

describe('storage security', () => {
  beforeEach(() => {
    process.env.FIREBASE_STORAGE_BUCKET = 'loar-test.firebasestorage.app';
    process.env.FIREBASE_STORAGE_TOKEN_SECRET = 'a'.repeat(64);
    process.env.PINATA_JWT = 'jwt';
    process.env.PINATA_GATEWAY_URL = 'https://private.mypinata.cloud';
    process.env.PINATA_GATEWAY_TOKEN = 'secret-token';
    vi.clearAllMocks();
    save.mockResolvedValue(undefined);
  });

  it('never includes a private Pinata gateway token in persisted public URLs', async () => {
    const { PinataProvider } = await import('../services/storage/ipfs');
    const url = new PinataProvider().getPublicUrl('bafy-test');
    expect(url).toBe('https://gateway.pinata.cloud/ipfs/bafy-test');
    expect(url).not.toContain('secret-token');
  });

  it('keeps legacy provider-key ciphertext readable during KMS migration', async () => {
    process.env.PROVIDER_KEY_MASTER_KEY = 'b'.repeat(64);
    delete process.env.PROVIDER_KEY_KMS_KEY_ID;
    const { seal, unseal } = await import('../services/provider-keys/crypto');
    const encrypted = await seal('provider-secret');
    expect(encrypted).not.toContain('provider-secret');
    expect(await unseal(encrypted)).toBe('provider-secret');
  });

  it('stores Firebase objects under immutable content-hash keys without public ACLs', async () => {
    vi.resetModules();
    const { firebaseStorageService } = await import('../services/firebase-storage');
    const key = await firebaseStorageService.upload(Buffer.from('same bytes'), 'output.mp4');
    expect(key).toMatch(/^objects\/[a-f0-9]{2}\/[a-f0-9]{64}\.mp4$/);
    expect(makePublic).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith(
      Buffer.from('same bytes'),
      expect.objectContaining({
        preconditionOpts: { ifGenerationMatch: 0 },
        metadata: expect.objectContaining({ cacheControl: 'private, max-age=0, no-store' }),
      })
    );
    expect(firebaseStorageService.getPublicUrl(key)).toContain('token=');
  });
});
