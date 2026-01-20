import { describe, it, expect } from 'vitest';
import {
  findCustomGroupForDomain,
  filterGroupableTabs,
  groupTabsByDomain,
  shouldCreateGroup
} from '../lib/groups.js';

describe('findCustomGroupForDomain', () => {
  const customGroups = [
    { id: '1', name: 'Work', color: 'blue', domains: ['github.com', 'gitlab.com'] },
    { id: '2', name: 'Social', color: 'pink', domains: ['twitter.com', 'reddit.com'] },
    { id: '3', name: 'Google', color: 'red', domains: ['google.com'] },
  ];

  it('returns null when custom grouping disabled', () => {
    expect(findCustomGroupForDomain('github.com', customGroups, false)).toBe(null);
  });

  it('returns null when no groups defined', () => {
    expect(findCustomGroupForDomain('github.com', [], true)).toBe(null);
    expect(findCustomGroupForDomain('github.com', null, true)).toBe(null);
  });

  it('matches exact domain', () => {
    expect(findCustomGroupForDomain('github.com', customGroups, true)).toEqual(customGroups[0]);
    expect(findCustomGroupForDomain('twitter.com', customGroups, true)).toEqual(customGroups[1]);
    expect(findCustomGroupForDomain('google.com', customGroups, true)).toEqual(customGroups[2]);
  });

  it('matches subdomains when pattern is base domain', () => {
    expect(findCustomGroupForDomain('mail.google.com', customGroups, true)).toEqual(customGroups[2]);
    expect(findCustomGroupForDomain('docs.google.com', customGroups, true)).toEqual(customGroups[2]);
    expect(findCustomGroupForDomain('api.github.com', customGroups, true)).toEqual(customGroups[0]);
  });

  it('matches exact subdomain patterns', () => {
    // Bug: if user specifies mail.google.com as pattern, it should match mail.google.com hostname
    const groupsWithSubdomainPatterns = [
      { id: '1', name: 'Base', color: 'blue', domains: ['mail.google.com', 'ha.miker.be'] },
      { id: '2', name: 'Google', color: 'red', domains: ['google.com'] },
    ];
    // Exact match for subdomain pattern
    expect(findCustomGroupForDomain('mail.google.com', groupsWithSubdomainPatterns, true)).toEqual(groupsWithSubdomainPatterns[0]);
    expect(findCustomGroupForDomain('ha.miker.be', groupsWithSubdomainPatterns, true)).toEqual(groupsWithSubdomainPatterns[0]);
    // Regular google.com should match second group, not first
    expect(findCustomGroupForDomain('google.com', groupsWithSubdomainPatterns, true)).toEqual(groupsWithSubdomainPatterns[1]);
    // docs.google.com should match google.com pattern (second group)
    expect(findCustomGroupForDomain('docs.google.com', groupsWithSubdomainPatterns, true)).toEqual(groupsWithSubdomainPatterns[1]);
  });

  it('returns null for non-matching domains', () => {
    expect(findCustomGroupForDomain('facebook.com', customGroups, true)).toBe(null);
    expect(findCustomGroupForDomain('notgithub.com', customGroups, true)).toBe(null);
  });

  it('returns first matching group when multiple could match', () => {
    const overlapping = [
      { id: '1', name: 'First', color: 'blue', domains: ['example.com'] },
      { id: '2', name: 'Second', color: 'red', domains: ['example.com'] },
    ];
    expect(findCustomGroupForDomain('example.com', overlapping, true).id).toBe('1');
  });

  it('does not match partial domain names', () => {
    // "notgoogle.com" should not match "google.com"
    expect(findCustomGroupForDomain('notgoogle.com', customGroups, true)).toBe(null);
  });
});

describe('filterGroupableTabs', () => {
  const mockGetDomain = (url) => {
    try {
      return new URL(url).hostname;
    } catch {
      return null;
    }
  };

  it('filters out already grouped tabs', () => {
    const tabs = [
      { id: 1, groupId: -1, url: 'https://example.com' },
      { id: 2, groupId: 5, url: 'https://test.com' },
    ];
    const result = filterGroupableTabs(tabs, mockGetDomain);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });

  it('filters out chrome:// URLs', () => {
    const tabs = [
      { id: 1, groupId: -1, url: 'chrome://settings' },
      { id: 2, groupId: -1, url: 'chrome-extension://abc/page.html' },
      { id: 3, groupId: -1, url: 'https://example.com' },
    ];
    const result = filterGroupableTabs(tabs, mockGetDomain);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(3);
  });

  it('filters out special pages', () => {
    const tabs = [
      { id: 1, groupId: -1, url: 'chrome://newtab/' },
      { id: 2, groupId: -1, url: 'about:blank' },
      { id: 3, groupId: -1, url: 'https://example.com' },
    ];
    const result = filterGroupableTabs(tabs, mockGetDomain);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(3);
  });

  it('filters out tabs without URLs', () => {
    const tabs = [
      { id: 1, groupId: -1, url: null },
      { id: 2, groupId: -1, url: undefined },
      { id: 3, groupId: -1, url: 'https://example.com' },
    ];
    const result = filterGroupableTabs(tabs, mockGetDomain);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(3);
  });

  it('filters out tabs where getDomain returns null', () => {
    const failingGetDomain = () => null;
    const tabs = [
      { id: 1, groupId: -1, url: 'https://example.com' },
    ];
    const result = filterGroupableTabs(tabs, failingGetDomain);
    expect(result).toHaveLength(0);
  });
});

describe('groupTabsByDomain', () => {
  const mockGetDomain = (url) => {
    try {
      const hostname = new URL(url).hostname;
      const parts = hostname.split('.');
      return parts.slice(-2).join('.');
    } catch {
      return null;
    }
  };

  it('groups tabs by domain', () => {
    const tabs = [
      { id: 1, url: 'https://mail.google.com' },
      { id: 2, url: 'https://docs.google.com' },
      { id: 3, url: 'https://github.com' },
    ];
    const result = groupTabsByDomain(tabs, mockGetDomain);
    expect(result.get('google.com')).toHaveLength(2);
    expect(result.get('github.com')).toHaveLength(1);
  });

  it('handles single tab per domain', () => {
    const tabs = [
      { id: 1, url: 'https://google.com' },
      { id: 2, url: 'https://github.com' },
      { id: 3, url: 'https://twitter.com' },
    ];
    const result = groupTabsByDomain(tabs, mockGetDomain);
    expect(result.size).toBe(3);
    expect(result.get('google.com')).toHaveLength(1);
  });

  it('handles empty tab array', () => {
    const result = groupTabsByDomain([], mockGetDomain);
    expect(result.size).toBe(0);
  });

  it('skips tabs where getDomain returns null', () => {
    const failingGetDomain = (url) => {
      if (url.includes('invalid')) return null;
      return new URL(url).hostname;
    };
    const tabs = [
      { id: 1, url: 'https://example.com' },
      { id: 2, url: 'invalid-url' },
    ];
    const result = groupTabsByDomain(tabs, failingGetDomain);
    expect(result.size).toBe(1);
  });
});

describe('shouldCreateGroup', () => {
  it('returns true for 2 or more tabs', () => {
    expect(shouldCreateGroup(2)).toBe(true);
    expect(shouldCreateGroup(3)).toBe(true);
    expect(shouldCreateGroup(10)).toBe(true);
  });

  it('returns false for less than 2 tabs', () => {
    expect(shouldCreateGroup(0)).toBe(false);
    expect(shouldCreateGroup(1)).toBe(false);
  });
});
