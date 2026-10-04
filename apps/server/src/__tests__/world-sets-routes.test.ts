/**
 * worldSets.* — real router + Firestore emulator. Managers (universe creator)
 * build sets; everyone else only sees published ones.
 *
 * Prereq: firebase emulators:start --only firestore --project loar-db
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import './_real-firebase';

// setup.ts stubs lib/safe-admin (every check -> false); sets need the REAL ownership logic.
vi.unmock('../lib/safe-admin');

const run = randomUUID().slice(0, 8);
const ALICE = { uid: `alice-${run}`, address: `0x${'1'.repeat(32)}${run}` };
const BOB = { uid: `bob-${run}`, address: `0x${'2'.repeat(32)}${run}` };
const UNIVERSE = `0x${run}${'c'.repeat(32)}`;

async function caller(user: { uid: string; address: string } | null = ALICE) {
  const { router } = await import('../lib/trpc');
  const { worldSetsRouter } = await import('../routers/world/worldSets.routes');
  return router({ worldSets: worldSetsRouter }).createCaller({
    user: user ? { ...user, email: 't@example.com' } : null,
    clientIp: '127.0.0.1',
  } as never).worldSets;
}

beforeEach(async () => {
  const { db } = await import('../lib/firebase');
  await db!.collection('cinematicUniverses').doc(UNIVERSE).set({
    name: 'Test World',
    creator: ALICE.address,
    createdAt: new Date(),
  });
});

const object = (over: Record<string, unknown> = {}) => ({
  id: randomUUID().slice(0, 8),
  label: 'Captain Vex',
  entityId: 'ent-1',
  url: 'https://media.example/vex.glb',
  position: [0, 0, 0] as [number, number, number],
  rotationY: 0,
  scale: 1,
  ...over,
});

describe('worldSets', () => {
  it('a manager creates, edits and publishes a set; others only see it once published', async () => {
    const alice = await caller();
    const { setId } = await alice.create({ universeId: UNIVERSE, name: 'Rust Harbor docks' });

    const updated = await alice.update({
      setId,
      patch: {
        objects: [object({ isPlayer: true, link: { kind: 'episode', target: 'ep-1' } })],
        cameras: [{ id: 'c1', name: 'Wide', position: [0, 2, 6], target: [0, 1, 0], fov: 40 }],
        environment: {
          entityId: 'place-1',
          splatUrl: 'https://media.example/harbor.spz',
          format: 'spz',
          position: [0, 0, 0],
          rotationY: 0,
          scale: 2,
        },
      },
    });
    expect(updated.objects).toHaveLength(1);
    expect(updated.environment?.scale).toBe(2);

    const bob = await caller(BOB);
    expect(await bob.list({ universeId: UNIVERSE })).toEqual([]);
    await expect(bob.get({ setId })).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await alice.update({ setId, patch: { published: true } });
    const anon = await caller(null);
    const listed = await anon.list({ universeId: UNIVERSE });
    expect(listed.map((s) => s.id)).toContain(setId);
    const got = await anon.get({ setId });
    expect(got.canEdit).toBe(false);
    expect(got.set.cameras[0].name).toBe('Wide');
    expect((await alice.get({ setId })).canEdit).toBe(true);
  });

  it('non-managers cannot create, edit or delete', async () => {
    const bob = await caller(BOB);
    await expect(bob.create({ universeId: UNIVERSE, name: 'x' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    const { setId } = await (await caller()).create({ universeId: UNIVERSE, name: 'y' });
    await expect(bob.update({ setId, patch: { name: 'pwned' } })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(bob.delete({ setId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects private asset URLs and more than one player', async () => {
    const alice = await caller();
    const { setId } = await alice.create({ universeId: UNIVERSE, name: 'z' });
    await expect(
      alice.update({ setId, patch: { objects: [object({ url: 'http://127.0.0.1/x.glb' })] } })
    ).rejects.toThrow(/public http/);
    await expect(
      alice.update({
        setId,
        patch: { objects: [object({ isPlayer: true }), object({ isPlayer: true })] },
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});
