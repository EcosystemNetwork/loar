import { describe, expect, it } from 'vitest';
import { withPinned } from '../routers/feed/feed.routes';

const item = (id: string, extra: Record<string, unknown> = {}) => ({ id, contentId: id, ...extra });

describe('withPinned (admin-featured content ahead of trending)', () => {
  it('puts pinned items first, in pinned order', () => {
    const out = withPinned([item('p2'), item('p1')], [item('a'), item('b')], 10);
    expect(out.map((i) => i.id)).toEqual(['p2', 'p1', 'a', 'b']);
  });

  it('drops trending duplicates of a pinned item', () => {
    const out = withPinned([item('b', { pinned: true })], [item('a'), item('b'), item('c')], 10);
    expect(out.map((i) => i.id)).toEqual(['b', 'a', 'c']);
    expect(out[0]).toMatchObject({ pinned: true });
  });

  it('matches trending signal docs by contentId', () => {
    const out = withPinned([item('x')], [{ id: 'signal-1', contentId: 'x' }, item('y')], 10);
    expect(out.map((i) => i.id)).toEqual(['x', 'y']);
  });

  it('caps the merged list at the limit', () => {
    const out = withPinned([item('p1'), item('p2')], [item('a'), item('b'), item('c')], 3);
    expect(out.map((i) => i.id)).toEqual(['p1', 'p2', 'a']);
  });

  it('is pure trending when nothing is pinned', () => {
    expect(withPinned([], [item('a'), item('b')], 1).map((i) => i.id)).toEqual(['a']);
  });
});
