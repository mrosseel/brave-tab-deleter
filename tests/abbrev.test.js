import { describe, it, expect } from 'vitest';
import {
  abbreviateGroupTitle,
  matchesGroupTitle,
  stripOverflows,
  visibleTabs,
  visibleGroupLabels
} from '../lib/abbrev.js';

describe('abbreviateGroupTitle', () => {
  it('squeezes vowels out after the first character', () => {
    expect(abbreviateGroupTitle('github')).toBe('gth');
    expect(abbreviateGroupTitle('gitlab')).toBe('gtl');
    expect(abbreviateGroupTitle('stackoverflow')).toBe('stc');
    expect(abbreviateGroupTitle('youtube')).toBe('ytb');
  });

  it('keeps the leading vowel of the title', () => {
    expect(abbreviateGroupTitle('amazon')).toBe('amz');
  });

  it('falls back to a prefix when squeezing leaves too little', () => {
    expect(abbreviateGroupTitle('ikea')).toBe('ike');
  });

  it('leaves already-short titles alone', () => {
    expect(abbreviateGroupTitle('x')).toBe('x');
    expect(abbreviateGroupTitle('bbc')).toBe('bbc');
  });

  it('handles empty input', () => {
    expect(abbreviateGroupTitle('')).toBe('');
    expect(abbreviateGroupTitle(undefined)).toBe('');
  });

  it('respects a custom length', () => {
    expect(abbreviateGroupTitle('stackoverflow', 4)).toBe('stck');
  });
});

describe('matchesGroupTitle', () => {
  it('matches the full title regardless of case', () => {
    expect(matchesGroupTitle('GitHub', 'github')).toBe(true);
  });

  it('matches the abbreviated form', () => {
    expect(matchesGroupTitle('gth', 'github')).toBe(true);
  });

  it('rejects an unrelated title', () => {
    expect(matchesGroupTitle('gtl', 'github')).toBe(false);
  });

  it('rejects empty titles', () => {
    expect(matchesGroupTitle('', 'github')).toBe(false);
    expect(matchesGroupTitle('gth', '')).toBe(false);
  });
});

describe('visibleTabs', () => {
  it('drops tabs hidden inside collapsed groups', () => {
    const tabs = [
      { id: 1, groupId: -1 },
      { id: 2, groupId: 10 },
      { id: 3, groupId: 11 }
    ];
    const groups = [{ id: 10, collapsed: true }, { id: 11, collapsed: false }];
    expect(visibleTabs(tabs, groups).map(t => t.id)).toEqual([1, 3]);
  });
});

describe('visibleGroupLabels', () => {
  it('resolves each group through the title resolver', () => {
    const groups = [{ id: 1, title: 'gth' }, { id: 2, title: 'ytb' }];
    const full = { 1: 'github', 2: 'youtube' };
    expect(visibleGroupLabels(groups, g => full[g.id])).toEqual(['github', 'youtube']);
  });
});

describe('stripOverflows', () => {
  const tabs = (n) => Array.from({ length: n }, (_, i) => ({ id: i, pinned: false }));

  it('reports no overflow when a few tabs fit a wide window', () => {
    expect(stripOverflows(1600, tabs(5), ['github'])).toBe(false);
  });

  it('reports overflow once the strip is packed', () => {
    expect(stripOverflows(1600, tabs(40), ['github', 'youtube'])).toBe(true);
  });

  it('counts pinned tabs as narrower than normal tabs', () => {
    const pinned = Array.from({ length: 20 }, (_, i) => ({ id: i, pinned: true }));
    expect(stripOverflows(1200, pinned, [])).toBe(false);
    expect(stripOverflows(1200, tabs(20), [])).toBe(true);
  });

  it('charges longer group titles more room', () => {
    const many = Array.from({ length: 8 }, (_, i) => `group-title-${i}`);
    expect(stripOverflows(1000, tabs(10), [])).toBe(false);
    expect(stripOverflows(1000, tabs(10), many)).toBe(true);
  });

  it('treats an unknown window width as no overflow', () => {
    expect(stripOverflows(0, tabs(50), [])).toBe(false);
  });
});
