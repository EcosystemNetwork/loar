/**
 * Router integration tests — verifies all top-level routers are mounted,
 * auth enforcement works correctly, and basic procedure contracts hold.
 */
import { describe, it, expect } from 'vitest';
import { TRPCError } from '@trpc/server';
import { createPublicCaller, createAuthCaller } from './helpers';

// ---------------------------------------------------------------------------
// Top-level procedures
// ---------------------------------------------------------------------------
describe('Top-level procedures', () => {
  it('healthCheck returns OK', async () => {
    const caller = createPublicCaller();
    const result = await caller.healthCheck();
    expect(result).toBe('OK');
  });

  it('privateData rejects unauthenticated callers', async () => {
    const caller = createPublicCaller();
    await expect(caller.privateData()).rejects.toThrow(TRPCError);
  });

  it('privateData returns user info for authenticated callers', async () => {
    const caller = createAuthCaller();
    const result = await caller.privateData();
    expect(result.user).toHaveProperty('uid', 'test-uid');
    expect(result.user).toHaveProperty('address');
  });

  it('trackWalletLogin accepts valid input', async () => {
    const caller = createPublicCaller();
    const result = await caller.trackWalletLogin({
      address: '0x1234567890abcdef1234567890abcdef12345678',
      chainId: 84532,
      connector: 'injected',
    });
    expect(result).toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// universes
// ---------------------------------------------------------------------------
describe('universes router', () => {
  it('getAll is public and returns a result', async () => {
    const caller = createPublicCaller();
    const result = await caller.universes.getAll();
    expect(result).toBeDefined();
  });

  it('get rejects empty id', async () => {
    const caller = createPublicCaller();
    await expect(caller.universes.get({ id: '' })).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// profiles
// ---------------------------------------------------------------------------
describe('profiles router', () => {
  it('me rejects unauthenticated callers', async () => {
    const caller = createPublicCaller();
    await expect(caller.profiles.me()).rejects.toThrow(TRPCError);
  });

  it('checkUsername is public', async () => {
    const caller = createPublicCaller();
    const result = await caller.profiles.checkUsername({ username: 'testuser' });
    expect(result).toHaveProperty('available');
  });

  it('discover is public and returns results', async () => {
    const caller = createPublicCaller();
    const result = await caller.profiles.discover({ limit: 5 });
    expect(result).toHaveProperty('profiles');
  });

  it('upsert rejects unauthenticated callers', async () => {
    const caller = createPublicCaller();
    await expect(
      caller.profiles.upsert({
        displayName: 'Test',
        username: 'testuser',
        visibility: 'private',
      })
    ).rejects.toThrow(TRPCError);
  });
});

// ---------------------------------------------------------------------------
// content
// ---------------------------------------------------------------------------
describe('content router', () => {
  it('feed is public', async () => {
    const caller = createPublicCaller();
    const result = await caller.content.feed({ limit: 5 });
    expect(result).toHaveProperty('items');
  });

  it('create rejects unauthenticated callers', async () => {
    const caller = createPublicCaller();
    await expect(
      caller.content.create({
        title: 'Test',
        mediaUrl: 'https://example.com/video.mp4',
        mediaType: 'video',
        classification: 'fan',
        ipDeclaration: { isOriginal: true, license: 'all-rights-reserved' },
      })
    ).rejects.toThrow(TRPCError);
  });

  it('myContent rejects unauthenticated callers', async () => {
    const caller = createPublicCaller();
    await expect(caller.content.myContent({})).rejects.toThrow(TRPCError);
  });
});

// ---------------------------------------------------------------------------
// image + generation (replaced deprecated fal router)
// ---------------------------------------------------------------------------
describe('image router', () => {
  it('generateImage rejects unauthenticated callers', async () => {
    const caller = createPublicCaller();
    await expect(caller.image.generateImage({ prompt: 'test' })).rejects.toThrow(TRPCError);
  });
});

describe('generation router', () => {
  it('getStatus is public', async () => {
    const caller = createPublicCaller();
    const result = await caller.generation.getStatus({ id: 'test-id' });
    expect(result).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// storage
// ---------------------------------------------------------------------------
describe('storage router', () => {
  it('upload rejects unauthenticated callers', async () => {
    const caller = createPublicCaller();
    await expect(caller.storage.upload({ url: 'https://example.com/file.mp4' })).rejects.toThrow(
      TRPCError
    );
  });

  it('resolve is public', async () => {
    const caller = createPublicCaller();
    const result = await caller.storage.resolve({ contentHash: 'abc123' });
    expect(result).toBeDefined();
  });

  it('uploadStatus is public', async () => {
    const caller = createPublicCaller();
    const result = await caller.storage.uploadStatus({ jobId: 'test-job' });
    expect(result).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// nft
// ---------------------------------------------------------------------------
describe('nft router', () => {
  it('getEpisodesByUniverse is public', async () => {
    const caller = createPublicCaller();
    const result = await caller.nft.getEpisodesByUniverse({ universeId: 'test-universe' });
    expect(Array.isArray(result)).toBe(true);
  });

  it('createEpisodeListing rejects unauthenticated callers', async () => {
    const caller = createPublicCaller();
    await expect(
      caller.nft.createEpisodeListing({
        universeId: 'u1',
        nodeId: 1,
        contentHash: 'hash',
        title: 'Ep1',
        description: 'desc',
        mediaUrl: 'https://example.com/vid.mp4',
        mintPrice: '0.01',
        metadataURI: 'ipfs://meta',
      })
    ).rejects.toThrow(TRPCError);
  });

  it('getMyNFTs rejects unauthenticated callers', async () => {
    const caller = createPublicCaller();
    await expect(caller.nft.getMyNFTs()).rejects.toThrow(TRPCError);
  });
});

// ---------------------------------------------------------------------------
// firebaseStorage (legacy minio → renamed)
// ---------------------------------------------------------------------------
describe('firebaseStorage router', () => {
  it('getPublicUrl is public', async () => {
    const caller = createPublicCaller();
    const result = await caller.firebaseStorage.getPublicUrl({ key: 'videos/test.mp4' });
    expect(result).toHaveProperty('url');
  });

  it('uploadFromUrl rejects unauthenticated callers', async () => {
    const caller = createPublicCaller();
    await expect(
      caller.firebaseStorage.uploadFromUrl({ url: 'https://example.com/file.mp4' })
    ).rejects.toThrow(TRPCError);
  });
});

// ---------------------------------------------------------------------------
// synapse
// ---------------------------------------------------------------------------
describe('synapse router', () => {
  it('getHttpUrl is public', async () => {
    const caller = createPublicCaller();
    const result = await caller.synapse.getHttpUrl({ pieceCid: 'test-cid' });
    expect(result).toHaveProperty('url');
  });

  it('uploadFromUrl rejects unauthenticated callers', async () => {
    const caller = createPublicCaller();
    await expect(
      caller.synapse.uploadFromUrl({ url: 'https://example.com/file.mp4' })
    ).rejects.toThrow(TRPCError);
  });
});
