import { describe, it, expect } from 'vitest';
import { findDuplicateSets, getExtraTabIds, pickTabToKeep } from '../lib/duplicates.js';

describe('findDuplicateSets', () => {
  it('returns only URLs with 2 or more tabs', () => {
    const tabs = [
      { id: 1, url: 'https://a.com/' },
      { id: 2, url: 'https://b.com/' },
      { id: 3, url: 'https://a.com/' }
    ];
    expect(findDuplicateSets(tabs)).toEqual([
      { url: 'https://a.com/', tabs: [tabs[0], tabs[2]] }
    ]);
  });

  it('treats a different hash or query as a different URL', () => {
    const tabs = [
      { id: 1, url: 'https://a.com/' },
      { id: 2, url: 'https://a.com/#x' },
      { id: 3, url: 'https://a.com/?q=1' }
    ];
    expect(findDuplicateSets(tabs)).toEqual([]);
  });

  it('ignores tabs without a URL', () => {
    expect(findDuplicateSets([{ id: 1 }, { id: 2 }])).toEqual([]);
  });

  it('keeps the order of the first tab of each set', () => {
    const tabs = [
      { id: 1, url: 'https://b.com/' },
      { id: 2, url: 'https://a.com/' },
      { id: 3, url: 'https://a.com/' },
      { id: 4, url: 'https://b.com/' }
    ];
    expect(findDuplicateSets(tabs).map((s) => s.url)).toEqual(['https://b.com/', 'https://a.com/']);
  });
});

describe('pickTabToKeep', () => {
  it('prefers the active tab in the given window', () => {
    const tabs = [
      { id: 1, windowId: 1, active: true },
      { id: 2, windowId: 2, active: true }
    ];
    expect(pickTabToKeep(tabs, 2).id).toBe(2);
  });

  it('falls back to any active tab', () => {
    const tabs = [
      { id: 1, windowId: 1, active: false },
      { id: 2, windowId: 3, active: true }
    ];
    expect(pickTabToKeep(tabs, 1).id).toBe(2);
  });

  it('falls back to the first tab', () => {
    const tabs = [{ id: 1, windowId: 1 }, { id: 2, windowId: 1 }];
    expect(pickTabToKeep(tabs, 1).id).toBe(1);
  });
});

describe('getExtraTabIds', () => {
  it('returns all ids except the kept tab of each set', () => {
    const sets = [
      { url: 'a', tabs: [{ id: 1, windowId: 1 }, { id: 2, windowId: 1, active: true }] },
      { url: 'b', tabs: [{ id: 3, windowId: 1 }, { id: 4, windowId: 1 }, { id: 5, windowId: 2 }] }
    ];
    expect(getExtraTabIds(sets, 1)).toEqual([1, 4, 5]);
  });

  it('returns nothing for no sets', () => {
    expect(getExtraTabIds([], 1)).toEqual([]);
  });
});
