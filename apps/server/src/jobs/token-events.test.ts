import { describe, it, expect } from 'vitest';
import { diffTokenEvents, type TokenSnapshot } from './token-events';

const cur = (o: Partial<TokenSnapshot> = {}): TokenSnapshot => ({
  id: '0xa',
  symbol: 'A',
  name: 'A',
  deployer: '0xd',
  graduated: false,
  halted: false,
  ...o,
});

describe('diffTokenEvents', () => {
  it('announces a never-seen token as a launch only', () => {
    expect(diffTokenEvents(undefined, cur())).toEqual(['launch']);
    expect(diffTokenEvents(undefined, cur({ graduated: true }))).toEqual(['launch']);
  });
  it('fires graduated exactly on the transition', () => {
    expect(diffTokenEvents({ graduated: false, halted: false }, cur({ graduated: true }))).toEqual([
      'graduated',
    ]);
    expect(diffTokenEvents({ graduated: true, halted: false }, cur({ graduated: true }))).toEqual(
      []
    );
  });
  it('fires halted on the transition, not while it stays halted', () => {
    expect(diffTokenEvents({ graduated: false, halted: false }, cur({ halted: true }))).toEqual([
      'halted',
    ]);
    expect(diffTokenEvents({ graduated: false, halted: true }, cur({ halted: true }))).toEqual([]);
  });
  it('re-fires halted after a resume + second halt, and can emit both at once', () => {
    expect(
      diffTokenEvents({ graduated: false, halted: false }, cur({ halted: true, graduated: true }))
    ).toEqual(['graduated', 'halted']);
    expect(diffTokenEvents({ graduated: false, halted: true }, cur({ halted: false }))).toEqual([]);
  });
  it('emits nothing when nothing changed', () => {
    expect(diffTokenEvents({ graduated: false, halted: false }, cur())).toEqual([]);
  });
});
