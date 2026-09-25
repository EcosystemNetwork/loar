import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WIKI_TAB,
  WIKI_GROUPS,
  WIKI_TABS,
  buildWikiSearch,
  groupForTab,
  resolveWikiTab,
} from './nav';

describe('wiki nav model', () => {
  it('lists every view exactly once', () => {
    const ids = WIKI_TABS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    // 12 creator kinds + 6 structural kinds + 15 synthesised/media views
    expect(ids).toHaveLength(33);
  });

  it('keeps every group small enough to scan', () => {
    for (const g of WIKI_GROUPS) expect(g.tabs.length).toBeLessThanOrEqual(12);
  });

  it('maps every view to a group that contains it', () => {
    for (const t of WIKI_TABS) {
      expect(groupForTab(t.id).tabs.map((x) => x.id)).toContain(t.id);
    }
  });

  it('resolves unknown or missing ?tab= to the default view', () => {
    expect(resolveWikiTab(undefined)).toBe(DEFAULT_WIKI_TAB);
    expect(resolveWikiTab('nope')).toBe(DEFAULT_WIKI_TAB);
    expect(resolveWikiTab('az-index')).toBe('az-index');
    expect(resolveWikiTab('style_pack')).toBe('style_pack');
  });

  it('omits the default view but keeps the universe in the URL', () => {
    expect(buildWikiSearch('gallery', undefined)).toEqual({});
    expect(buildWikiSearch('gallery', '0xabc')).toEqual({ universe: '0xabc' });
    expect(buildWikiSearch('person', '0xabc')).toEqual({ universe: '0xabc', tab: 'person' });
  });
});
