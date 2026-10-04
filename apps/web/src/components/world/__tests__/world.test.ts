import { describe, expect, it } from 'vitest';
import { planAssetPack } from '../assetPack';
import { jobProgress, type WorldOverviewRow } from '../useTripoJob';

const row = (over: Partial<WorldOverviewRow>): WorldOverviewRow => ({
  id: 'e1',
  name: 'Captain Vex',
  kind: 'person',
  imageUrl: null,
  modelUrl: null,
  webModelUrl: null,
  needsWebCopy: false,
  thumbnailUrl: null,
  usdzUrl: null,
  puppet: null,
  environment: null,
  ...over,
});

describe('planAssetPack', () => {
  it('lays out models, puppet clips, turnarounds and environments per entity with a manifest', () => {
    const { files, manifest } = planAssetPack([
      row({
        modelUrl: 'https://m/vex.glb',
        usdzUrl: 'https://m/vex.usdz',
        puppet: {
          riggedModelUrl: 'https://m/vex-rig.glb',
          webRiggedModelUrl: 'https://m/vex-rig-web.glb',
          rigType: 'biped',
          animations: [{ preset: 'preset:walk', name: 'walk', url: 'https://m/walk.glb' }],
          turnaround: { front: 'https://m/front.png' },
        },
      }),
      row({
        id: 'p1',
        name: 'Rust Harbor',
        kind: 'place',
        environment: { splatUrl: 'https://m/h', format: 'spz' },
      }),
      row({ id: 'x', name: 'No 3D' }),
    ]);
    expect(files.map((f) => f.path)).toEqual([
      'person/Captain_Vex/model.glb',
      'person/Captain_Vex/model.usdz',
      'person/Captain_Vex/rigged.glb',
      'person/Captain_Vex/anim_walk.glb',
      'person/Captain_Vex/turnaround_front.png',
      'place/Rust_Harbor/environment.spz',
    ]);
    const entities = manifest.entities as Array<Record<string, any>>;
    expect(entities).toHaveLength(2);
    expect(entities[0]).toMatchObject({ id: 'e1', rigType: 'biped' });
    expect(entities[0].files['clip:walk']).toBe('person/Captain_Vex/anim_walk.glb');
  });

  it('de-duplicates folders for entities with the same name and strips unsafe characters', () => {
    const { files } = planAssetPack([
      row({ id: 'a', name: '../Twin', modelUrl: 'https://m/a.glb' }),
      row({ id: 'b', name: '../Twin', modelUrl: 'https://m/b.glb' }),
    ]);
    expect(files.map((f) => f.path)).toEqual(['person/Twin/model.glb', 'person/Twin_2/model.glb']);
  });
});

describe('jobProgress', () => {
  it('averages over the expected step count and never shows 100 until completed', () => {
    expect(
      jobProgress({
        kind: 'character_puppet',
        status: 'running',
        steps: [
          { name: 'Pose', status: 'success' },
          { name: 'Turnaround', status: 'running', progress: 50 },
        ],
      })
    ).toBe(30);
    expect(
      jobProgress({
        kind: 'entity_model',
        status: 'running',
        steps: [{ name: 'x', status: 'success' }],
      })
    ).toBe(99);
    expect(jobProgress({ kind: 'entity_model', status: 'completed', steps: [] })).toBe(100);
  });
});
