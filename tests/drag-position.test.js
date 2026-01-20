import { describe, it, expect } from 'vitest';
import { calculateTargetIndex, getDropPosition } from '../lib/drag-position.js';

describe('calculateTargetIndex', () => {
  describe('moving backward (to lower index)', () => {
    it('moves to beginning using nextTab reference', () => {
      // Tabs: A(0), B(1), C(2), D(3) - drag D before A
      // nextTab = A (index 0), currentIndex = 3
      const result = calculateTargetIndex(3, 0, null);
      expect(result).toBe(0);
    });

    it('moves to middle using nextTab reference', () => {
      // Tabs: A(0), B(1), C(2), D(3) - drag D before B
      // nextTab = B (index 1), currentIndex = 3
      const result = calculateTargetIndex(3, 1, null);
      expect(result).toBe(1);
    });

    it('moves using prevTab reference', () => {
      // Tabs: A(0), B(1), C(2), D(3) - drag D after A
      // prevTab = A (index 0), currentIndex = 3
      const result = calculateTargetIndex(3, null, 0);
      expect(result).toBe(1);
    });
  });

  describe('moving forward (to higher index)', () => {
    it('moves to end using prevTab reference', () => {
      // Tabs: A(0), B(1), C(2), D(3) - drag A after D
      // prevTab = D (index 3), currentIndex = 0
      // After removing A: B(0), C(1), D(2)
      // Want to be after D, so index 3, but D shifted to 2, so target = 3
      const result = calculateTargetIndex(0, null, 3);
      // prevTabIndex + 1 = 4, currentIndex(0) < 4, so 4 - 1 = 3
      expect(result).toBe(3);
    });

    it('moves to middle using nextTab reference', () => {
      // Tabs: A(0), B(1), C(2), D(3) - drag A before C
      // nextTab = C (index 2), currentIndex = 0
      // After removing A: B(0), C(1), D(2)
      // Want to be before C (now at 1), so target = 1
      const result = calculateTargetIndex(0, 2, null);
      // nextTabIndex = 2, currentIndex(0) < 2, so 2 - 1 = 1
      expect(result).toBe(1);
    });

    it('moves using prevTab reference in middle', () => {
      // Tabs: A(0), B(1), C(2), D(3) - drag A after B
      // prevTab = B (index 1), currentIndex = 0
      // After removing A: B(0), C(1), D(2)
      // Want to be after B (now at 0), so target = 1
      const result = calculateTargetIndex(0, null, 1);
      // prevTabIndex + 1 = 2, currentIndex(0) < 2, so 2 - 1 = 1
      expect(result).toBe(1);
    });
  });

  describe('no move needed', () => {
    it('returns null when already at target (nextTab reference)', () => {
      // Tab at index 1, nextTab at index 2 - already in position
      const result = calculateTargetIndex(1, 2, null);
      // nextTabIndex = 2, currentIndex(1) < 2, so 2 - 1 = 1, same as current
      expect(result).toBeNull();
    });

    it('returns null when already at target (prevTab reference)', () => {
      // Tab at index 2, prevTab at index 1 - already in position
      const result = calculateTargetIndex(2, null, 1);
      // prevTabIndex + 1 = 2, currentIndex(2) not < 2, so stays 2, same as current
      expect(result).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('returns null when no reference tabs', () => {
      const result = calculateTargetIndex(0, null, null);
      expect(result).toBeNull();
    });

    it('prefers nextTab over prevTab when both provided', () => {
      // Both references provided - nextTab takes precedence
      const result = calculateTargetIndex(3, 1, 0);
      expect(result).toBe(1);
    });
  });
});

describe('getDropPosition', () => {
  it('returns "before" when mouse is in upper half', () => {
    // Element from y=100 to y=140 (height 40), mid = 120
    // Mouse at y=110 (upper half)
    expect(getDropPosition(110, 100, 40)).toBe('before');
  });

  it('returns "after" when mouse is in lower half', () => {
    // Element from y=100 to y=140 (height 40), mid = 120
    // Mouse at y=130 (lower half)
    expect(getDropPosition(130, 100, 40)).toBe('after');
  });

  it('returns "after" when mouse is exactly at midpoint', () => {
    // Element from y=100 to y=140 (height 40), mid = 120
    // Mouse at y=120 (exactly at mid)
    expect(getDropPosition(120, 100, 40)).toBe('after');
  });

  it('returns "before" when mouse is just above midpoint', () => {
    expect(getDropPosition(119, 100, 40)).toBe('before');
  });
});
