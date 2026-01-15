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
