/**
 * Sleep group utilities
 * Handles data structures and validation for sleeping tab groups
 */

/**
 * Create a sleeping group entry
 * @param {Object} groupInfo - Chrome tab group info { id, title, color }
 * @param {Array} tabs - Array of tab objects { url, title, favIconUrl }
 * @param {number} windowId - Original window ID
 * @returns {Object} Sleeping group entry
 */
export function createSleepingGroupEntry(groupInfo, tabs, windowId) {
  const id = `sleep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    title: groupInfo.title || 'Unnamed Group',
    color: groupInfo.color || 'grey',
    tabs: tabs.map(tab => ({
      url: tab.url,
      title: tab.title || tab.url || 'New Tab',
      favIconUrl: tab.favIconUrl || null
    })),
    sleepedAt: Date.now(),
    originalWindowId: windowId
  };
}

/**
 * Validate a sleeping group entry has required fields
 * @param {Object} entry - Sleeping group entry to validate
 * @returns {boolean} True if valid
 */
export function isValidSleepingGroup(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (typeof entry.id !== 'string' || !entry.id.startsWith('sleep-')) return false;
  if (typeof entry.title !== 'string') return false;
  if (typeof entry.color !== 'string') return false;
  if (!Array.isArray(entry.tabs) || entry.tabs.length === 0) return false;
  if (typeof entry.sleepedAt !== 'number') return false;

  // Validate each tab has a URL
  for (const tab of entry.tabs) {
    if (!tab || typeof tab !== 'object') return false;
    if (typeof tab.url !== 'string' || !tab.url) return false;
  }

  return true;
}

/**
 * Check if a group can be slept (not ungrouped or ghost)
 * @param {string|number} groupId - Group ID to check
 * @returns {boolean} True if group can be slept
 */
export function canSleepGroup(groupId) {
  if (groupId === 'ungrouped') return false;
  if (typeof groupId === 'string' && groupId.startsWith('ghost-')) return false;
  // Must be a numeric group ID (real Chrome group)
  const numId = typeof groupId === 'string' ? parseInt(groupId, 10) : groupId;
  return !isNaN(numId) && numId > 0;
}
