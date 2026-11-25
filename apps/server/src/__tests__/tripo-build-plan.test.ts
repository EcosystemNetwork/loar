import { describe, expect, it } from 'vitest';
import { entityUsage } from '../services/tripo-world/build-plan';
import type { Entity } from '../routers/entities/entities.types';

const ent = (id: string, name: string, description = '') =>
  ({ id, name, kind: 'person', description }) as Entity;

describe('entityUsage', () => {
  const vex = ent('vex', 'Captain Vex');
  const heron = ent('heron', 'Night Heron');
  const key = ent('key', 'Brass Key');
  const guild = ent('guild', 'Harbor Guild', 'Loyal to Captain Vex.');
  const all = [vex, heron, key, guild];

  it('counts episodes, wiki mentions and set placements per candidate', () => {
    const usage = entityUsage(
      [vex, heron, key],
      all,
      [
        { id: 'e1', title: 'Pilot', description: 'Captain Vex boards the Night Heron.' },
        { id: 'e2', title: 'Captain Vex returns' },
      ],
      [
        { objects: [{ entityId: 'heron' }, { entityId: 'heron' }] },
        { environment: null, objects: [{ link: { kind: 'entity', target: 'key' } }] },
      ]
    );
    expect(usage.vex).toEqual({ episodes: 2, mentions: 1, sets: 0, score: 7 });
    // Two placements in one set count as one set.
    expect(usage.heron).toEqual({ episodes: 1, mentions: 0, sets: 1, score: 6 });
    expect(usage.key).toEqual({ episodes: 0, mentions: 0, sets: 1, score: 3 });
  });

  it('scores unused entities 0', () => {
    expect(entityUsage([key], all, [], []).key.score).toBe(0);
  });

  it('counts a place used as a set environment', () => {
    const dock = ent('dock', 'Dock Nine');
    expect(entityUsage([dock], [dock], [], [{ environment: { entityId: 'dock' } }]).dock.sets).toBe(
      1
    );
  });
});
