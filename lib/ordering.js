/**
 * Check if a tab qualifies for reordering based on activation time
 * @param {number} tabId - Tab ID
 * @param {Map} activationTimes - Map of tabId -> activation timestamp
 * @param {number} thresholdSeconds - Minimum seconds tab must be active
 * @param {number} now - Current timestamp (defaults to Date.now())
 * @returns {boolean}
 */
export function shouldReorderTab(tabId, activationTimes, thresholdSeconds, now = Date.now()) {
  const activationTime = activationTimes.get(tabId);
  if (!activationTime) return false;

  const elapsedSeconds = (now - activationTime) / 1000;
  return elapsedSeconds >= thresholdSeconds;
}

/**
 * Find the first position (lowest index) in a group of tabs
 * @param {Array} groupTabs - Array of tab objects with index property
 * @returns {number|null} First index or null if group has < 2 tabs
 */
export function findFirstPositionInGroup(groupTabs) {
  if (groupTabs.length < 2) return null;
  const sorted = [...groupTabs].sort((a, b) => a.index - b.index);
  return sorted[0].index;
}

/**
 * Check if a tab needs to be reordered (not already first in group)
 * @param {Object} tab - Tab object with id
 * @param {Array} groupTabs - Array of tab objects in the same group
 * @returns {boolean}
 */
export function needsReordering(tab, groupTabs) {
  if (groupTabs.length < 2) return false;
  const sorted = [...groupTabs].sort((a, b) => a.index - b.index);
  return tab.id !== sorted[0].id;
}

/**
 * Sort key that pins the "Other" group to the bottom of the sidebar. Sleeping
 * groups sort with Infinity, so they still come after it.
 */
export const OTHER_LAST_SORT_INDEX = Number.MAX_SAFE_INTEGER;

/**
 * Sort key for the "Other" (ungrouped) group
 * @param {Array} ungroupedTabs - Ungrouped tabs, with index property
 * @param {string} sorting - 'last', 'first' or 'none' (follow tab order)
 * @returns {number} Value to sort the group by
 */
export function getOtherGroupSortIndex(ungroupedTabs, sorting) {
  if (sorting === 'first') return -1;
  if (sorting === 'none') {
    return ungroupedTabs.length > 0
      ? Math.min(...ungroupedTabs.map(t => t.index))
      : OTHER_LAST_SORT_INDEX;
  }
  return OTHER_LAST_SORT_INDEX;
}
