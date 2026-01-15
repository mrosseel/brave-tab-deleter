import { describe, it, expect } from 'vitest';
import {
  shouldReorderTab,
  findFirstPositionInGroup,
  needsReordering
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
