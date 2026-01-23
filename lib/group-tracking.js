/**
 * Track auto-created and manual group IDs
 * Used to determine how auto-grouping should treat existing groups
 */

// Track auto group IDs we created (session storage - clears on browser restart)
let autoGroupIds = new Set();

// Track manual group IDs (groups that should not be auto-ungrouped, e.g., woken from sleep)
let manualGroupIds = new Set();

export async function loadAutoGroupIds() {
  const stored = await chrome.storage.session.get('autoGroupIds');
  autoGroupIds = new Set(stored.autoGroupIds || []);
}

export async function saveAutoGroupIds() {
  await chrome.storage.session.set({ autoGroupIds: [...autoGroupIds] });
}

export async function loadManualGroupIds() {
  const stored = await chrome.storage.session.get('manualGroupIds');
  manualGroupIds = new Set(stored.manualGroupIds || []);
}

export async function saveManualGroupIds() {
  await chrome.storage.session.set({ manualGroupIds: [...manualGroupIds] });
}

export function markAsAutoGroup(groupId) {
  autoGroupIds.add(groupId);
  manualGroupIds.delete(groupId); // Can't be both
  saveAutoGroupIds();
  saveManualGroupIds();
}

export function markAsManualGroup(groupId) {
  manualGroupIds.add(groupId);
  autoGroupIds.delete(groupId); // Can't be both
  saveManualGroupIds();
  saveAutoGroupIds();
}

export function isAutoGroupId(groupId) {
  return autoGroupIds.has(groupId);
}

export function isManualGroupId(groupId) {
  return manualGroupIds.has(groupId);
}

export function unmarkAutoGroup(groupId) {
  if (autoGroupIds.has(groupId)) {
    autoGroupIds.delete(groupId);
    saveAutoGroupIds();
    return true;
  }
  return false;
}

export function removeGroupId(groupId) {
  let changed = false;
  if (autoGroupIds.has(groupId)) {
    autoGroupIds.delete(groupId);
    saveAutoGroupIds();
    changed = true;
  }
  if (manualGroupIds.has(groupId)) {
    manualGroupIds.delete(groupId);
    saveManualGroupIds();
    changed = true;
  }
  return changed;
}
