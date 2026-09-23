import { describe, it, expect } from 'vitest';
import { getContrastTextColor } from '../lib/colors.js';

describe('getContrastTextColor', () => {
  it('uses white text on a dark accent', () => {
    expect(getContrastTextColor('#4f46e5')).toBe('#ffffff');
    expect(getContrastTextColor('#000000')).toBe('#ffffff');
  });

  it('uses black text on a light accent', () => {
    expect(getContrastTextColor('#818cf8')).toBe('#111111');
    expect(getContrastTextColor('#ffff00')).toBe('#111111');
  });

  it('falls back to white for an invalid color', () => {
    expect(getContrastTextColor('red')).toBe('#ffffff');
    expect(getContrastTextColor('')).toBe('#ffffff');
  });
});
