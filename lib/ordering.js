import { matchesGroupTitle } from './abbrev.js';

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

/**
 * Position of a group in the custom groups list, matched by title. An
 * abbreviated title still matches its full name.
 * @param {string} title - Title currently on the group
 * @param {Array} customGroups - Custom group definitions, with name property
 * @returns {number} Index in customGroups, or -1 if the group is not custom
 */
export function customGroupRank(title, customGroups) {
  if (!title || !Array.isArray(customGroups)) return -1;
  return customGroups.findIndex(g => matchesGroupTitle(title, g.name));
}

/**
 * Sort comparator for sidebar items. Items with customRank >= 0 come first,
 * in custom list order. All other items keep their firstTabIndex order.
 * @param {Object} a - Item with firstTabIndex and optional customRank
 * @param {Object} b - Item with firstTabIndex and optional customRank
 * @returns {number}
 */
export function compareCustomFirst(a, b) {
  const aRank = a.customRank ?? -1;
  const bRank = b.customRank ?? -1;
  const aCustom = aRank >= 0;
  const bCustom = bRank >= 0;
  if (aCustom !== bCustom) return aCustom ? -1 : 1;
  if (aCustom && aRank !== bRank) return aRank - bRank;
  return a.firstTabIndex - b.firstTabIndex;
}

/**
 * IDs of the custom groups in one window, in the order they must have in the
 * tab strip: custom list order first, then current strip position.
 * @param {Array} groups - Tab groups of the window, with id and title
 * @param {Array} tabs - Tabs of the window, with index and groupId
 * @param {Array} customGroups - Custom group definitions, with name property
 * @returns {Array<number>} Ordered group IDs
 */
export function orderedCustomGroupIds(groups, tabs, customGroups) {
  const firstIndex = new Map();
  for (const tab of tabs) {
    if (tab.groupId === -1) continue;
    const current = firstIndex.get(tab.groupId);
    if (current === undefined || tab.index < current) firstIndex.set(tab.groupId, tab.index);
  }
  return groups
    .map(g => ({ id: g.id, rank: customGroupRank(g.title, customGroups) }))
    .filter(g => g.rank >= 0 && firstIndex.has(g.id))
    .sort((a, b) => a.rank - b.rank || firstIndex.get(a.id) - firstIndex.get(b.id))
    .map(g => g.id);
}

/**
 * Group moves that put the given groups, in order, directly after the pinned
 * tabs. A group that is already in its place gets no move, so a strip that is
 * in order gives an empty list.
 * @param {Array} tabs - Tabs of the window, with index, groupId and pinned
 * @param {Array<number>} groupIds - Group IDs in their wanted order
 * @returns {Array<{groupId: number, index: number}>} Moves to do in sequence
 */
export function planCustomGroupMoves(tabs, groupIds) {
  const strip = [...tabs].sort((a, b) => a.index - b.index);
  const slots = strip.map(t => t.groupId);
  let pos = strip.filter(t => t.pinned).length;
  const moves = [];
  for (const groupId of groupIds) {
    const start = slots.indexOf(groupId);
    if (start === -1) continue;
    let count = 0;
    while (slots[start + count] === groupId) count++;
    if (start !== pos) {
      moves.push({ groupId, index: pos });
      slots.splice(start, count);
      slots.splice(pos, 0, ...Array(count).fill(groupId));
    }
    pos += count;
  }
  return moves;
}

/**
 * Strip index directly after the pinned tabs and the given groups. Ungrouped
 * tabs sorted "first" go here, so they do not push custom groups away.
 * @param {Array} tabs - Tabs of the window, with groupId and pinned
 * @param {Array<number>} groupIds - Group IDs that stay at the front
 * @returns {number}
 */
export function frontBlockEnd(tabs, groupIds) {
  const front = new Set(groupIds);
  return tabs.filter(t => t.pinned || front.has(t.groupId)).length;
}
