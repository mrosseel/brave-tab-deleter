import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  GHOST_GROUP_SECONDS,
  createGhostEntry,
  isGhostExpired,
  filterExpiredGhosts,
  getGhostRemainingSeconds,
  classifyTabGhostStatus
} from '../lib/ghost.js';

describe('GHOST_GROUP_SECONDS', () => {
  it('is set to 15 seconds', () => {
    expect(GHOST_GROUP_SECONDS).toBe(15);
  });
});

describe('createGhostEntry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T10:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates ghost entry with correct expiration', () => {
    const groupInfo = { id: 1, title: 'Test', color: 'blue' };
    const ghost = createGhostEntry(groupInfo, 2);

    expect(ghost.title).toBe('Test');
    expect(ghost.color).toBe('blue');
    expect(ghost.originalGroupId).toBe(1);
    expect(ghost.positionIndex).toBe(2);
    expect(ghost.expiresAt).toBe(Date.now() + (GHOST_GROUP_SECONDS * 1000));
  });

  it('handles empty title', () => {
    const groupInfo = { id: 1, color: 'red' };
    const ghost = createGhostEntry(groupInfo, 0);
    expect(ghost.title).toBe('');
  });

  it('handles undefined title', () => {
    const groupInfo = { id: 1, title: undefined, color: 'green' };
    const ghost = createGhostEntry(groupInfo, 0);
    expect(ghost.title).toBe('');
  });
});

describe('isGhostExpired', () => {
  it('returns false for future expiration', () => {
    const ghost = { expiresAt: Date.now() + 10000 };
    expect(isGhostExpired(ghost)).toBe(false);
  });

  it('returns true for past expiration', () => {
    const ghost = { expiresAt: Date.now() - 1 };
    expect(isGhostExpired(ghost)).toBe(true);
  });

  it('returns true for exact expiration time', () => {
    const now = Date.now();
    const ghost = { expiresAt: now };
    expect(isGhostExpired(ghost, now)).toBe(true);
  });

  it('uses provided now parameter', () => {
    const ghost = { expiresAt: 1000 };
    expect(isGhostExpired(ghost, 500)).toBe(false);
    expect(isGhostExpired(ghost, 1500)).toBe(true);
  });
});

describe('filterExpiredGhosts', () => {
  it('removes expired ghosts', () => {
    const now = 1000;
    const ghosts = new Map([
      [1, { expiresAt: 500 }],  // expired
      [2, { expiresAt: 1500 }], // valid
      [3, { expiresAt: 900 }],  // expired
    ]);

    const { validGhosts, hadExpired } = filterExpiredGhosts(ghosts, now);
    expect(validGhosts.size).toBe(1);
    expect(validGhosts.has(2)).toBe(true);
    expect(validGhosts.has(1)).toBe(false);
    expect(validGhosts.has(3)).toBe(false);
    expect(hadExpired).toBe(true);
  });

  it('returns hadExpired=false when none expired', () => {
    const now = 1000;
    const ghosts = new Map([
      [1, { expiresAt: 2000 }],
      [2, { expiresAt: 3000 }],
    ]);

    const { validGhosts, hadExpired } = filterExpiredGhosts(ghosts, now);
    expect(validGhosts.size).toBe(2);
    expect(hadExpired).toBe(false);
  });

  it('handles empty Map', () => {
    const { validGhosts, hadExpired } = filterExpiredGhosts(new Map(), 1000);
    expect(validGhosts.size).toBe(0);
    expect(hadExpired).toBe(false);
  });

  it('handles all expired', () => {
    const now = 2000;
    const ghosts = new Map([
      [1, { expiresAt: 500 }],
      [2, { expiresAt: 1000 }],
    ]);

    const { validGhosts, hadExpired } = filterExpiredGhosts(ghosts, now);
    expect(validGhosts.size).toBe(0);
    expect(hadExpired).toBe(true);
  });
});

describe('getGhostRemainingSeconds', () => {
  it('calculates remaining seconds', () => {
    const ghost = { expiresAt: 15000 };
    expect(getGhostRemainingSeconds(ghost, 10000)).toBe(5);
  });

  it('returns 0 for expired ghosts', () => {
    const ghost = { expiresAt: 5000 };
    expect(getGhostRemainingSeconds(ghost, 10000)).toBe(0);
  });

  it('rounds up partial seconds', () => {
    const ghost = { expiresAt: 10100 };
    expect(getGhostRemainingSeconds(ghost, 10000)).toBe(1);
  });

  it('rounds up to next second for small remainders', () => {
    const ghost = { expiresAt: 10001 };
    expect(getGhostRemainingSeconds(ghost, 10000)).toBe(1);
  });

  it('returns exact seconds when no remainder', () => {
    const ghost = { expiresAt: 15000 };
    expect(getGhostRemainingSeconds(ghost, 10000)).toBe(5);
  });
});

describe('classifyTabGhostStatus', () => {
  it('returns ungrouped for ungrouped tab without ghost', () => {
    const tab = { id: 1, groupId: -1 };
    const ghosts = new Map();
    expect(classifyTabGhostStatus(tab, ghosts)).toBe('ungrouped');
  });

  it('returns ghost for ungrouped tab with ghost entry', () => {
    const tab = { id: 1, groupId: -1 };
    const ghosts = new Map([[1, { originalGroupId: 5 }]]);
    expect(classifyTabGhostStatus(tab, ghosts)).toBe('ghost');
  });

  it('returns grouped for grouped tab without ghost', () => {
    const tab = { id: 1, groupId: 5 };
    const ghosts = new Map();
    expect(classifyTabGhostStatus(tab, ghosts)).toBe('grouped');
  });

  it('returns ghost for tab moved to different group (Brave behavior)', () => {
    const tab = { id: 1, groupId: 10 }; // Now in group 10
    const ghosts = new Map([[1, { originalGroupId: 5 }]]); // Was in group 5
    expect(classifyTabGhostStatus(tab, ghosts)).toBe('ghost');
  });

  it('returns grouped for tab still in original group', () => {
    const tab = { id: 1, groupId: 5 };
    const ghosts = new Map([[1, { originalGroupId: 5 }]]);
    expect(classifyTabGhostStatus(tab, ghosts)).toBe('grouped');
  });

  it('handles tab with different id than ghost entry', () => {
    const tab = { id: 2, groupId: -1 };
    const ghosts = new Map([[1, { originalGroupId: 5 }]]); // Ghost for different tab
    expect(classifyTabGhostStatus(tab, ghosts)).toBe('ungrouped');
  });
});
