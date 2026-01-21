// Chrome tab group color palette
export const GROUP_COLORS = {
  grey: '#5f6368',
  blue: '#1a73e8',
  red: '#d93025',
  yellow: '#f9ab00',
  green: '#1e8e3e',
  pink: '#d01884',
  purple: '#9334e6',
  cyan: '#007b83',
  orange: '#e8710a'
};

// All available Chrome tab group color names
export const ALL_COLOR_NAMES = ['blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange', 'grey'];

/**
 * Get hex color code for a color name
 */
export function getColorHex(colorName) {
  return GROUP_COLORS[colorName] || GROUP_COLORS.grey;
}

/**
 * Get hex color code for a group object
 */
export function getGroupColor(group) {
  return GROUP_COLORS[group.color] || GROUP_COLORS.grey;
}

/**
 * Find an available color not in the used or reserved sets
 * @param {Set<string>} usedColors - Colors currently in use
 * @param {Set<string>} reservedColors - Colors reserved (e.g., by custom groups)
 * @returns {string} Available color name
 */
export function findAvailableColor(usedColors, reservedColors = new Set()) {
  // Prefer colors not used and not reserved
  for (const color of ALL_COLOR_NAMES) {
    if (!usedColors.has(color) && !reservedColors.has(color)) {
      return color;
    }
  }
  // Fall back to any unused color
  for (const color of ALL_COLOR_NAMES) {
    if (!usedColors.has(color)) {
      return color;
    }
  }
  // All colors used, return blue as default
  return 'blue';
}
