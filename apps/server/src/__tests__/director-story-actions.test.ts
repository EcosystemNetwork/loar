/**
 * Tests for `director.executeStoryAction` — the voice-director path that
 * creates / branches / edits off-chain timeline nodes. Real Firestore
 * emulator (see off-chain-nodes.test.ts); the credit-spending
 * `generate_scene` branch is deliberately not exercised here.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { TRPCError } from '@trpc/server';
import './_real-firebase';

const ALICE = '0x1234567890abcdef1234567890abcdef12345678';
const BOB = '0x2222222222222222222222222222222222222222';

let universeId: string;
beforeEach(() => {
  universeId = `0x${Math.random().toString(16).slice(2).padEnd(40, '0').slice(0, 40)}`;
});

async function director(address: string | null = ALICE) {
  const { router } = await import('../lib/trpc');
  const { directorRouter } = await import('../routers/director/director.routes');
  const app = router({ director: directorRouter });
  return app.createCaller({
    user: address ? { uid: `uid-${address.slice(2, 8)}`, address, email: 't@example.com' } : null,
    clientIp: '127.0.0.1',
  } as never).director;
}

async function nodes() {
  const { db } = await import('../lib/firebase');
  const snap = await db!.collection('offChainNodes').where('universeId', '==', universeId).get();
  return snap.docs.map((d) => d.data()).sort((a, b) => a.nodeId - b.nodeId);
}

describe('director.executeStoryAction (node actions)', () => {
  it('rejects unauthenticated callers', async () => {
    const d = await director(null);
    await expect(
      d.executeStoryAction({ universeId, kind: 'create_node', description: 'x' })
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it('create_node writes a root node with the description as plot', async () => {
    const d = await director();
    const res = await d.executeStoryAction({
      universeId,
      kind: 'create_node',
      title: 'Opening',
      description: 'A door opens.',
    });
    expect(res).toEqual({ kind: 'create_node', nodeId: 1 });
    const [n] = await nodes();
    expect(n).toMatchObject({
      title: 'Opening',
      plot: 'A door opens.',
      previousNodeId: 0,
      canon: true,
    });
    expect(n.videoUrl).toBe('');
  });

  it('branch_story links to the parent as a non-canon child', async () => {
    const d = await director();
    await d.executeStoryAction({ universeId, kind: 'create_node', description: 'root' });
    const res = await d.executeStoryAction({
      universeId,
      kind: 'branch_story',
      previousNodeId: 1,
      description: 'what if',
    });
    expect(res).toEqual({ kind: 'branch_story', nodeId: 2 });
    const [root, branch] = await nodes();
    expect(root.children).toEqual([2]);
    expect(branch).toMatchObject({ previousNodeId: 1, canon: false });
  });

  it('branch_story without previousNodeId is a BAD_REQUEST', async () => {
    const d = await director();
    await expect(
      d.executeStoryAction({ universeId, kind: 'branch_story', description: 'x' })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(await nodes()).toHaveLength(0);
  });

  it('branching from a nonexistent parent is NOT_FOUND and creates nothing', async () => {
    const d = await director();
    await expect(
      d.executeStoryAction({
        universeId,
        kind: 'branch_story',
        previousNodeId: 9,
        description: 'x',
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await nodes()).toHaveLength(0);
  });

  it('update_node rewrites title + plot', async () => {
    const d = await director();
    await d.executeStoryAction({ universeId, kind: 'create_node', title: 'a', description: 'old' });
    const res = await d.executeStoryAction({
      universeId,
      kind: 'update_node',
      nodeId: 1,
      title: 'b',
      description: 'new',
    });
    expect(res).toEqual({ kind: 'update_node', nodeId: 1 });
    expect((await nodes())[0]).toMatchObject({ title: 'b', plot: 'new' });
  });

  it('update_node without nodeId is a BAD_REQUEST', async () => {
    const d = await director();
    await expect(
      d.executeStoryAction({ universeId, kind: 'update_node', description: 'x' })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it("update_node cannot edit someone else's node", async () => {
    await (
      await director(ALICE)
    ).executeStoryAction({
      universeId,
      kind: 'create_node',
      description: 'mine',
    });
    await expect(
      (await director(BOB)).executeStoryAction({
        universeId,
        kind: 'update_node',
        nodeId: 1,
        description: 'hijack',
      })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await nodes())[0].plot).toBe('mine');
  });

  it('enforces the description bounds', async () => {
    const d = await director();
    await expect(
      d.executeStoryAction({ universeId, kind: 'create_node', description: '' })
    ).rejects.toThrow();
    await expect(
      d.executeStoryAction({ universeId, kind: 'create_node', description: 'x'.repeat(2001) })
    ).rejects.toThrow();
  });
});

describe('director.submitCanonProposal', () => {
  it('is NOT_FOUND for a node that does not exist', async () => {
    const d = await director();
    await expect(
      d.submitCanonProposal({ universeId, nodeId: 3, title: 'Make it canon' })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('validates the title length', async () => {
    const d = await director();
    await expect(d.submitCanonProposal({ universeId, nodeId: 1, title: 'no' })).rejects.toThrow();
  });
});
