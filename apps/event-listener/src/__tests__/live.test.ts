import { describe, expect, it } from 'vitest';
import { planLiveRanges } from '../live';

describe('planLiveRanges', () => {
  it('replays the finality boundary and the full unconfirmed window on every poll', () => {
    expect(planLiveRanges(1_000, 1_001, 100, 15)).toEqual({
      finalityCut: 986,
      windowStart: 986,
      confirmedCatchup: null,
      confirmedBoundary: { from: 986, to: 986 },
      unconfirmed: { from: 987, to: 1_001 },
    });
  });

  it('catches up confirmed blocks after downtime before replaying the live window', () => {
    expect(planLiveRanges(500, 1_000, 100, 15)).toEqual({
      finalityCut: 985,
      windowStart: 985,
      confirmedCatchup: { from: 501, to: 984 },
      confirmedBoundary: { from: 985, to: 985 },
      unconfirmed: { from: 986, to: 1_000 },
    });
  });

  it('treats the head as confirmed when finality depth is zero', () => {
    expect(planLiveRanges(99, 100, 100, 0)).toEqual({
      finalityCut: 100,
      windowStart: 100,
      confirmedCatchup: null,
      confirmedBoundary: { from: 100, to: 100 },
      unconfirmed: null,
    });
  });
});
