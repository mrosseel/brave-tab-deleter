import { describe, it, expect } from 'vitest';
import {
  shouldReorderTab,
  findFirstPositionInGroup,
  needsReordering,
  getOtherGroupSortIndex,
  OTHER_LAST_SORT_INDEX,
  customGroupRank,
  compareCustomFirst,
  orderedCustomGroupIds,
  planCustomGroupMoves,
  frontBlockEnd
} from '../lib/ordering.js';

describe('shouldReorderTab', () => {
  it('returns false when tab not in activation map', () => {
    const activationTimes = new Map();
    expect(shouldReorderTab(1, activationTimes, 5)).toBe(false);
  });

  it('returns false when threshold not reached', () => {
    const now = 10000;
    const activationTimes = new Map([[1, 8000]]); // 2 seconds ago
    expect(shouldReorderTab(1, activationTimes, 5, now)).toBe(false);
  });

  it('returns true when threshold reached', () => {
    const now = 10000;
    const activationTimes = new Map([[1, 4000]]); // 6 seconds ago
    expect(shouldReorderTab(1, activationTimes, 5, now)).toBe(true);
  });

  it('returns true when exactly at threshold', () => {
    const now = 10000;
    const activationTimes = new Map([[1, 5000]]); // exactly 5 seconds ago
    expect(shouldReorderTab(1, activationTimes, 5, now)).toBe(true);
  });

  it('uses different threshold values', () => {
    const now = 10000;
    const activationTimes = new Map([[1, 7000]]); // 3 seconds ago
    expect(shouldReorderTab(1, activationTimes, 5, now)).toBe(false);
    expect(shouldReorderTab(1, activationTimes, 3, now)).toBe(true);
    expect(shouldReorderTab(1, activationTimes, 2, now)).toBe(true);
  });

  it('handles tab id not in map', () => {
    const activationTimes = new Map([[1, 5000]]);
    expect(shouldReorderTab(2, activationTimes, 5, 10000)).toBe(false);
  });
});

describe('findFirstPositionInGroup', () => {
  it('returns null for single tab', () => {
    const tabs = [{ id: 1, index: 5 }];
    expect(findFirstPositionInGroup(tabs)).toBe(null);
  });

  it('returns null for empty array', () => {
    expect(findFirstPositionInGroup([])).toBe(null);
  });

  it('returns lowest index', () => {
    const tabs = [
      { id: 1, index: 10 },
      { id: 2, index: 5 },
      { id: 3, index: 15 },
    ];
    expect(findFirstPositionInGroup(tabs)).toBe(5);
  });

  it('handles tabs in order', () => {
    const tabs = [
      { id: 1, index: 0 },
      { id: 2, index: 1 },
      { id: 3, index: 2 },
    ];
    expect(findFirstPositionInGroup(tabs)).toBe(0);
  });

  it('handles tabs in reverse order', () => {
    const tabs = [
      { id: 1, index: 10 },
      { id: 2, index: 9 },
      { id: 3, index: 8 },
    ];
    expect(findFirstPositionInGroup(tabs)).toBe(8);
  });

  it('handles two tabs', () => {
    const tabs = [
      { id: 1, index: 5 },
      { id: 2, index: 3 },
    ];
    expect(findFirstPositionInGroup(tabs)).toBe(3);
  });
});

describe('needsReordering', () => {
  it('returns false for single tab group', () => {
    const tab = { id: 1, index: 5 };
    const groupTabs = [tab];
    expect(needsReordering(tab, groupTabs)).toBe(false);
  });

  it('returns false when tab is already first', () => {
    const tab = { id: 1, index: 5 };
    const groupTabs = [
      { id: 1, index: 5 },
      { id: 2, index: 6 },
    ];
    expect(needsReordering(tab, groupTabs)).toBe(false);
  });

  it('returns true when tab is not first', () => {
    const tab = { id: 2, index: 6 };
    const groupTabs = [
      { id: 1, index: 5 },
      { id: 2, index: 6 },
    ];
    expect(needsReordering(tab, groupTabs)).toBe(true);
  });

  it('returns true when tab is last in group', () => {
    const tab = { id: 3, index: 7 };
    const groupTabs = [
      { id: 1, index: 5 },
      { id: 2, index: 6 },
      { id: 3, index: 7 },
    ];
    expect(needsReordering(tab, groupTabs)).toBe(true);
  });

  it('returns false for empty group', () => {
    const tab = { id: 1, index: 5 };
    expect(needsReordering(tab, [])).toBe(false);
  });

  it('handles unordered tabs array', () => {
    const tab = { id: 2, index: 3 };
    const groupTabs = [
      { id: 1, index: 10 },
      { id: 2, index: 3 },  // This is actually first by index
      { id: 3, index: 5 },
    ];
    expect(needsReordering(tab, groupTabs)).toBe(false);
  });
});

describe('getOtherGroupSortIndex', () => {
  const tabs = [{ id: 1, index: 4 }, { id: 2, index: 2 }, { id: 3, index: 9 }];

  it('pins the group last by default', () => {
    expect(getOtherGroupSortIndex(tabs, 'last')).toBe(OTHER_LAST_SORT_INDEX);
  });

  it('sorts before sleeping groups when pinned last', () => {
    expect(getOtherGroupSortIndex(tabs, 'last')).toBeLessThan(Infinity);
  });

  it('pins the group first', () => {
    expect(getOtherGroupSortIndex(tabs, 'first')).toBe(-1);
  });

  it('sorts before any real group when pinned first', () => {
    expect(getOtherGroupSortIndex(tabs, 'first')).toBeLessThan(0);
  });

  it('follows tab order with none', () => {
    expect(getOtherGroupSortIndex(tabs, 'none')).toBe(2);
  });

  it('falls back to last for an unknown mode', () => {
    expect(getOtherGroupSortIndex(tabs, 'bogus')).toBe(OTHER_LAST_SORT_INDEX);
  });

  it('handles an empty tab list with none', () => {
    expect(getOtherGroupSortIndex([], 'none')).toBe(OTHER_LAST_SORT_INDEX);
  });
});

const CUSTOM = [{ name: 'Work' }, { name: 'News' }];

// Build tabs from a strip layout: 'p' is pinned, '-' is ungrouped, a number
// is a group ID.
function stripTabs(layout) {
  return layout.map((slot, index) => ({
    id: 100 + index,
    index,
    pinned: slot === 'p',
    groupId: typeof slot === 'number' ? slot : -1
  }));
}

// Apply group moves the same way chrome.tabGroups.move does.
function applyMoves(layout, moves) {
  const slots = [...layout];
  for (const { groupId, index } of moves) {
    const start = slots.indexOf(groupId);
    const count = slots.filter(s => s === groupId).length;
    slots.splice(start, count);
    slots.splice(index, 0, ...Array(count).fill(groupId));
  }
  return slots;
}

describe('customGroupRank', () => {
  it('returns the list position of a matching title', () => {
    expect(customGroupRank('News', CUSTOM)).toBe(1);
  });

  it('matches case-insensitively', () => {
    expect(customGroupRank('work', CUSTOM)).toBe(0);
  });

  it('returns -1 for a group that is not custom', () => {
    expect(customGroupRank('github', CUSTOM)).toBe(-1);
  });

  it('returns -1 for an empty title or no list', () => {
    expect(customGroupRank('', CUSTOM)).toBe(-1);
    expect(customGroupRank('Work', undefined)).toBe(-1);
  });
});

describe('compareCustomFirst', () => {
  it('puts custom items before other items', () => {
    const items = [
      { id: 'auto', firstTabIndex: 0 },
      { id: 'other', firstTabIndex: -1 },
      { id: 'news', firstTabIndex: 2, customRank: 1 },
      { id: 'work', firstTabIndex: 9, customRank: 0 }
    ];
    items.sort(compareCustomFirst);
    expect(items.map(i => i.id)).toEqual(['work', 'news', 'other', 'auto']);
  });

  it('keeps tab order between items of the same rank', () => {
    const items = [
      { id: 'b', firstTabIndex: 5, customRank: 0 },
      { id: 'a', firstTabIndex: 1, customRank: 0 }
    ];
    items.sort(compareCustomFirst);
    expect(items.map(i => i.id)).toEqual(['a', 'b']);
  });

  it('keeps sleeping groups (Infinity) last among non-custom items', () => {
    const items = [
      { id: 'sleep', firstTabIndex: Infinity },
      { id: 'auto', firstTabIndex: 3 }
    ];
    items.sort(compareCustomFirst);
    expect(items.map(i => i.id)).toEqual(['auto', 'sleep']);
  });
});

describe('orderedCustomGroupIds', () => {
  it('orders custom groups by list order and skips other groups', () => {
    const groups = [
      { id: 1, title: 'github' },
      { id: 2, title: 'News' },
      { id: 3, title: 'Work' }
    ];
    const tabs = stripTabs([1, 1, 2, 3]);
    expect(orderedCustomGroupIds(groups, tabs, CUSTOM)).toEqual([3, 2]);
  });

  it('skips groups without tabs', () => {
    const groups = [{ id: 3, title: 'Work' }];
    expect(orderedCustomGroupIds(groups, stripTabs(['-']), CUSTOM)).toEqual([]);
  });

  it('orders two groups with the same name by strip position', () => {
    const groups = [{ id: 5, title: 'Work' }, { id: 4, title: 'Work' }];
    const tabs = stripTabs([4, 5]);
    expect(orderedCustomGroupIds(groups, tabs, CUSTOM)).toEqual([4, 5]);
  });
});

describe('planCustomGroupMoves', () => {
  it('returns no moves when the strip is already in order', () => {
    const layout = ['p', 3, 3, 2, 1, '-'];
    expect(planCustomGroupMoves(stripTabs(layout), [3, 2])).toEqual([]);
  });

  it('moves custom groups to the front after pinned tabs', () => {
    const layout = ['p', '-', 1, 1, 2, 3, 3];
    const moves = planCustomGroupMoves(stripTabs(layout), [3, 2]);
    expect(applyMoves(layout, moves)).toEqual(['p', 3, 3, 2, '-', 1, 1]);
  });

  it('only moves the groups that are out of place', () => {
    const layout = [3, 1, 2];
    expect(planCustomGroupMoves(stripTabs(layout), [3, 2])).toEqual([
      { groupId: 2, index: 1 }
    ]);
  });

  it('gives no moves on a second pass (no move loop)', () => {
    const layout = ['-', 1, 2, 2, '-', 3];
    const moves = planCustomGroupMoves(stripTabs(layout), [3, 2]);
    const after = applyMoves(layout, moves);
    expect(planCustomGroupMoves(stripTabs(after), [3, 2])).toEqual([]);
  });

  it('ignores group IDs that are not in the strip', () => {
    expect(planCustomGroupMoves(stripTabs([1, 2]), [9])).toEqual([]);
  });
});

describe('frontBlockEnd', () => {
  it('counts pinned tabs and tabs of the front groups', () => {
    const tabs = stripTabs(['p', 3, 3, 2, '-', 1]);
    expect(frontBlockEnd(tabs, [3, 2])).toBe(4);
  });

  it('equals the pinned count when there are no front groups', () => {
    expect(frontBlockEnd(stripTabs(['p', 'p', '-', 1]), [])).toBe(2);
  });
});
