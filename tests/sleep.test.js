import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createSleepingGroupEntry,
  isValidSleepingGroup,
  canSleepGroup
} from '../lib/sleep.js';

describe('createSleepingGroupEntry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T10:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates entry with correct structure', () => {
    const groupInfo = { id: 1, title: 'Test Group', color: 'blue' };
    const tabs = [
      { url: 'https://example.com', title: 'Example', favIconUrl: 'https://example.com/favicon.ico' },
      { url: 'https://test.com', title: 'Test' }
    ];
    const entry = createSleepingGroupEntry(groupInfo, tabs, 123);

    expect(entry.id).toMatch(/^sleep-\d+-[a-z0-9]+$/);
    expect(entry.title).toBe('Test Group');
    expect(entry.color).toBe('blue');
    expect(entry.tabs).toHaveLength(2);
    expect(entry.sleepedAt).toBe(Date.now());
    expect(entry.originalWindowId).toBe(123);
    expect(entry.isManual).toBe(false);
  });

  it('defaults isManual to false', () => {
    const groupInfo = { id: 1, title: 'Test', color: 'blue' };
    const tabs = [{ url: 'https://example.com', title: 'Test' }];
    const entry = createSleepingGroupEntry(groupInfo, tabs, 1);

    expect(entry.isManual).toBe(false);
  });

  it('sets isManual to true when specified', () => {
    const groupInfo = { id: 1, title: 'Test', color: 'blue' };
    const tabs = [{ url: 'https://example.com', title: 'Test' }];
    const entry = createSleepingGroupEntry(groupInfo, tabs, 1, true);

    expect(entry.isManual).toBe(true);
  });

  it('maps tab data correctly', () => {
    const groupInfo = { id: 1, title: 'Test', color: 'red' };
    const tabs = [
      { url: 'https://example.com', title: 'Example', favIconUrl: 'https://example.com/icon.png' }
    ];
    const entry = createSleepingGroupEntry(groupInfo, tabs, 1);

    expect(entry.tabs[0]).toEqual({
      url: 'https://example.com',
      title: 'Example',
      favIconUrl: 'https://example.com/icon.png'
    });
  });

  it('handles missing favIconUrl', () => {
    const groupInfo = { id: 1, title: 'Test', color: 'green' };
    const tabs = [{ url: 'https://example.com', title: 'Example' }];
    const entry = createSleepingGroupEntry(groupInfo, tabs, 1);

    expect(entry.tabs[0].favIconUrl).toBeNull();
  });

  it('handles missing tab title', () => {
    const groupInfo = { id: 1, title: 'Test', color: 'yellow' };
    const tabs = [{ url: 'https://example.com' }];
    const entry = createSleepingGroupEntry(groupInfo, tabs, 1);

    expect(entry.tabs[0].title).toBe('https://example.com');
  });

  it('defaults to Unnamed Group when title missing', () => {
    const groupInfo = { id: 1, color: 'purple' };
    const tabs = [{ url: 'https://example.com', title: 'Test' }];
    const entry = createSleepingGroupEntry(groupInfo, tabs, 1);

    expect(entry.title).toBe('Unnamed Group');
  });

  it('defaults to grey color when missing', () => {
    const groupInfo = { id: 1, title: 'Test' };
    const tabs = [{ url: 'https://example.com', title: 'Test' }];
    const entry = createSleepingGroupEntry(groupInfo, tabs, 1);

    expect(entry.color).toBe('grey');
  });

  it('generates unique IDs', () => {
    const groupInfo = { id: 1, title: 'Test', color: 'blue' };
    const tabs = [{ url: 'https://example.com', title: 'Test' }];

    const entry1 = createSleepingGroupEntry(groupInfo, tabs, 1);
    vi.advanceTimersByTime(1);
    const entry2 = createSleepingGroupEntry(groupInfo, tabs, 1);

    expect(entry1.id).not.toBe(entry2.id);
  });
});

describe('isValidSleepingGroup', () => {
  const validEntry = {
    id: 'sleep-1234567890-abc123',
    title: 'Test Group',
    color: 'blue',
    tabs: [{ url: 'https://example.com', title: 'Example' }],
    sleepedAt: Date.now(),
    originalWindowId: 1
  };

  it('returns true for valid entry', () => {
    expect(isValidSleepingGroup(validEntry)).toBe(true);
  });

  it('returns false for null', () => {
    expect(isValidSleepingGroup(null)).toBe(false);
  });

  it('returns false for non-object', () => {
    expect(isValidSleepingGroup('string')).toBe(false);
    expect(isValidSleepingGroup(123)).toBe(false);
    expect(isValidSleepingGroup(undefined)).toBe(false);
  });

  it('returns false for invalid id format', () => {
    expect(isValidSleepingGroup({ ...validEntry, id: 'invalid-id' })).toBe(false);
    expect(isValidSleepingGroup({ ...validEntry, id: 123 })).toBe(false);
    expect(isValidSleepingGroup({ ...validEntry, id: '' })).toBe(false);
  });

  it('returns false for non-string title', () => {
    expect(isValidSleepingGroup({ ...validEntry, title: 123 })).toBe(false);
    expect(isValidSleepingGroup({ ...validEntry, title: null })).toBe(false);
  });

  it('returns false for non-string color', () => {
    expect(isValidSleepingGroup({ ...validEntry, color: 123 })).toBe(false);
    expect(isValidSleepingGroup({ ...validEntry, color: null })).toBe(false);
  });

  it('returns false for non-array tabs', () => {
    expect(isValidSleepingGroup({ ...validEntry, tabs: 'tabs' })).toBe(false);
    expect(isValidSleepingGroup({ ...validEntry, tabs: {} })).toBe(false);
  });

  it('returns false for empty tabs array', () => {
    expect(isValidSleepingGroup({ ...validEntry, tabs: [] })).toBe(false);
  });

  it('returns false for non-number sleepedAt', () => {
    expect(isValidSleepingGroup({ ...validEntry, sleepedAt: '123' })).toBe(false);
    expect(isValidSleepingGroup({ ...validEntry, sleepedAt: null })).toBe(false);
  });

  it('returns false for tab without url', () => {
    expect(isValidSleepingGroup({
      ...validEntry,
      tabs: [{ title: 'No URL' }]
    })).toBe(false);
  });

  it('returns false for tab with empty url', () => {
    expect(isValidSleepingGroup({
      ...validEntry,
      tabs: [{ url: '', title: 'Empty URL' }]
    })).toBe(false);
  });

  it('returns false for non-object tab', () => {
    expect(isValidSleepingGroup({
      ...validEntry,
      tabs: ['invalid']
    })).toBe(false);
  });

  it('validates all tabs in array', () => {
    expect(isValidSleepingGroup({
      ...validEntry,
      tabs: [
        { url: 'https://valid.com', title: 'Valid' },
        { title: 'No URL' } // Invalid
      ]
    })).toBe(false);
  });
});

describe('canSleepGroup', () => {
  it('returns false for ungrouped', () => {
    expect(canSleepGroup('ungrouped')).toBe(false);
  });

  it('returns false for ghost groups', () => {
    expect(canSleepGroup('ghost-123')).toBe(false);
    expect(canSleepGroup('ghost-456')).toBe(false);
  });

  it('returns true for numeric group IDs', () => {
    expect(canSleepGroup(1)).toBe(true);
    expect(canSleepGroup(123)).toBe(true);
  });

  it('returns true for string numeric group IDs', () => {
    expect(canSleepGroup('1')).toBe(true);
    expect(canSleepGroup('123')).toBe(true);
  });

  it('returns false for zero or negative', () => {
    expect(canSleepGroup(0)).toBe(false);
    expect(canSleepGroup(-1)).toBe(false);
    expect(canSleepGroup('0')).toBe(false);
    expect(canSleepGroup('-1')).toBe(false);
  });

  it('returns false for NaN', () => {
    expect(canSleepGroup(NaN)).toBe(false);
    expect(canSleepGroup('not-a-number')).toBe(false);
  });
});
