// Ghost group expiration time in seconds
export const GHOST_GROUP_SECONDS = 15;

/**
 * Create a ghost group entry for a tab
 * @param {Object} groupInfo - Original group info { id, title, color }
 * @param {number} positionIndex - Position in the group list
 * @returns {Object} Ghost entry
 */
export function createGhostEntry(groupInfo, positionIndex) {
  return {
    title: groupInfo.title || '',
    color: groupInfo.color,
    originalGroupId: groupInfo.id,
    positionIndex: positionIndex,
    expiresAt: Date.now() + (GHOST_GROUP_SECONDS * 1000)
  };
}

/**
 * Check if a ghost entry has expired
 * @param {Object} ghost - Ghost entry with expiresAt
 * @param {number} now - Current timestamp (defaults to Date.now())
 * @returns {boolean}
 */
export function isGhostExpired(ghost, now = Date.now()) {
  return now >= ghost.expiresAt;
}

/**
 * Filter out expired ghosts from a Map
 * @param {Map} ghostGroups - Map of tabId -> ghost entry
 * @param {number} now - Current timestamp (defaults to Date.now())
 * @returns {{ validGhosts: Map, hadExpired: boolean }}
 */
export function filterExpiredGhosts(ghostGroups, now = Date.now()) {
  const validGhosts = new Map();
  let hadExpired = false;

  for (const [tabId, ghost] of ghostGroups.entries()) {
    if (isGhostExpired(ghost, now)) {
      hadExpired = true;
    } else {
      validGhosts.set(tabId, ghost);
    }
  }

  return { validGhosts, hadExpired };
}

/**
 * Calculate remaining seconds until ghost expires
 * @param {Object} ghost - Ghost entry with expiresAt
 * @param {number} now - Current timestamp (defaults to Date.now())
 * @returns {number} Remaining seconds (minimum 0)
 */
export function getGhostRemainingSeconds(ghost, now = Date.now()) {
  return Math.max(0, Math.ceil((ghost.expiresAt - now) / 1000));
}

/**
 * Classify a tab's ghost status
 * @param {Object} tab - Tab object with id and groupId
 * @param {Map} ghostGroups - Map of tabId -> ghost entry
 * @returns {'ungrouped'|'ghost'|'grouped'}
 */
export function classifyTabGhostStatus(tab, ghostGroups) {
  const ghost = ghostGroups.get(tab.id);

  if (tab.groupId === -1) {
    return ghost ? 'ghost' : 'ungrouped';
  } else if (ghost && tab.groupId !== ghost.originalGroupId) {
    return 'ghost'; // Moved to different group (Brave behavior)
  }
  return 'grouped';
}
