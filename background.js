// Import shared utilities
import { getDomain, getHostname, getShortName, shouldSkipUrl } from './lib/domain.js';
import { createLock } from './lib/lock.js';
import { findAvailableColor } from './lib/colors.js';

console.log('=== BACKGROUND.JS VERSION 6 LOADED ===');

// Track sidebar state per window
const sidebarOpen = new Map();

// Settings cache
let settings = {
  allWindows: false,
  autoGrouping: false,
  autoOrdering: false,
  autoOrderingSeconds: 5,
  customGrouping: false,
  customGroups: []
};

// Track tab activation times for auto-ordering
const tabActivationTimes = new Map();

// Track auto group IDs we created (session storage - clears on browser restart)
let autoGroupIds = new Set();

async function loadAutoGroupIds() {
  const stored = await chrome.storage.session.get('autoGroupIds');
  autoGroupIds = new Set(stored.autoGroupIds || []);
}

async function saveAutoGroupIds() {
  await chrome.storage.session.set({ autoGroupIds: [...autoGroupIds] });
}

function markAsAutoGroup(groupId) {
  autoGroupIds.add(groupId);
  saveAutoGroupIds();
}

function isAutoGroupId(groupId) {
  return autoGroupIds.has(groupId);
}

// Check if a group qualifies as auto (all tabs same domain, title matches)
async function checkAndUpdateGroupStatus(groupId) {
  try {
    const group = await chrome.tabGroups.get(groupId);
    const tabs = await chrome.tabs.query({ groupId });

    if (tabs.length < 2) {
      if (isAutoGroupId(groupId)) {
        autoGroupIds.delete(groupId);
        saveAutoGroupIds();
      }
      return false;
    }

    const firstDomain = getDomain(tabs[0].url);
    const allSameDomain = tabs.every(t => getDomain(t.url) === firstDomain);
    const titleMatches = group.title === getShortName(firstDomain);

    if (allSameDomain && titleMatches) {
      if (!isAutoGroupId(groupId)) {
        markAsAutoGroup(groupId);
      }
      return true;
    } else {
      if (isAutoGroupId(groupId)) {
        autoGroupIds.delete(groupId);
        saveAutoGroupIds();
      }
      return false;
    }
  } catch {
    autoGroupIds.delete(groupId);
    saveAutoGroupIds();
    return false;
  }
}

// SINGLE GLOBAL LOCK for all grouping operations
const withGroupingLock = createLock();


// Load settings from storage
async function loadSettings() {
  const stored = await chrome.storage.sync.get('settings');
  if (stored.settings) {
    settings = { ...settings, ...stored.settings };
  }
}

// Listen for messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'settingsUpdated') {
    settings = message.settings;
  } else if (message.type === 'sidebarOpened') {
    withGroupingLock(() => applyAutoGroupingToAll());
  } else if (message.type === 'refreshAll') {
    withGroupingLock(async () => {
      await applyAutoGroupingToAll();
    });
    sendResponse({ success: true });
    return true;
  }
});

// Listen for storage changes (backup method)
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync' && changes.settings) {
    settings = { ...settings, ...changes.settings.newValue };
  }
});

// Toggle side panel when extension icon is clicked
chrome.action.onClicked.addListener(async (tab) => {
  const windowId = tab.windowId;
  const isOpen = sidebarOpen.get(windowId) || false;

  if (isOpen) {
    await chrome.storage.session.remove('ghostGroups');
    await chrome.sidePanel.setOptions({ enabled: false });
    await chrome.sidePanel.setOptions({ enabled: true, path: 'sidebar.html' });
    sidebarOpen.set(windowId, false);
  } else {
    await chrome.sidePanel.open({ windowId });
    sidebarOpen.set(windowId, true);
  }
});

// Update badge with tab count
async function updateBadge() {
  const queryOptions = settings.allWindows ? {} : { currentWindow: true };
  const tabs = await chrome.tabs.query(queryOptions);
  chrome.action.setBadgeText({ text: tabs.length.toString() });
  chrome.action.setBadgeBackgroundColor({ color: '#6366f1' });
}

// Find matching custom group for a hostname
function findCustomGroupForHostname(hostname) {
  console.log('[bg] findCustomGroupForHostname:', hostname, 'customGrouping:', settings.customGrouping, 'groups:', settings.customGroups);
  if (!settings.customGrouping || !settings.customGroups) return null;

  for (const group of settings.customGroups) {
    for (const pattern of group.domains) {
      // Match exact hostname or hostname ending with .pattern
      const exactMatch = hostname === pattern;
      const suffixMatch = hostname.endsWith('.' + pattern);
      console.log('[bg] Checking pattern:', pattern, 'against:', hostname, 'exact:', exactMatch, 'suffix:', suffixMatch);
      if (exactMatch || suffixMatch) {
        console.log('[bg] MATCH! Returning group:', group.name);
        return group;
      }
    }
  }
  console.log('[bg] No match found');
  return null;
}

// Find existing group by title and color
async function findGroupByTitleAndColor(windowId, title, color) {
  const groups = await chrome.tabGroups.query({ windowId });
  return groups.find(g => g.title === title && g.color === color);
}

// Find existing auto-created group for domain (by title, any color)
async function findAutoGroupForDomain(windowId, domain) {
  const expectedTitle = getShortName(domain);
  const groups = await chrome.tabGroups.query({ windowId });
  // Find by title - auto groups can have any color now
  return groups.find(g => g.title === expectedTitle);
}

// Get colors reserved by custom groups
function getCustomGroupColors() {
  if (!settings.customGrouping || !settings.customGroups) return new Set();
  return new Set(settings.customGroups.map(g => g.color));
}

// Find next available color not used by existing groups
async function getNextAvailableColor(windowId) {
  const groups = await chrome.tabGroups.query({ windowId });
  const usedColors = new Set(groups.map(g => g.color));
  return findAvailableColor(usedColors, getCustomGroupColors());
}

// Ensure custom group gets its color - swap with existing group if needed
async function ensureColorForCustomGroup(windowId, customGroupTitle, desiredColor) {
  const groups = await chrome.tabGroups.query({ windowId });
  const conflictingGroup = groups.find(g => g.color === desiredColor && g.title !== customGroupTitle);

  if (conflictingGroup) {
    const usedColors = new Set(groups.map(g => g.color));
    usedColors.add(desiredColor); // Reserve the desired color
    const newColor = findAvailableColor(usedColors, getCustomGroupColors());

    if (newColor !== desiredColor) {
      console.log(`[bg] Swapping color: ${conflictingGroup.title} from ${desiredColor} to ${newColor}`);
      await chrome.tabGroups.update(conflictingGroup.id, { color: newColor });
    }
  }
}

// Core grouping logic - groups a single tab appropriately
async function groupSingleTab(tab) {
  if (shouldSkipUrl(tab.url)) return;

  const domain = getDomain(tab.url);
  if (!domain) return;

  // Re-fetch to get current state
  let currentTab;
  try {
    currentTab = await chrome.tabs.get(tab.id);
  } catch {
    return; // Tab no longer exists
  }

  const hostname = getHostname(tab.url);

  // 1. Check custom groups first (highest priority)
  if (settings.customGrouping && hostname) {
    const customGroup = findCustomGroupForHostname(hostname);
    if (customGroup) {
      const existingGroup = await findGroupByTitleAndColor(currentTab.windowId, customGroup.name, customGroup.color);

      if (existingGroup) {
        if (currentTab.groupId !== existingGroup.id) {
          await chrome.tabs.group({ tabIds: currentTab.id, groupId: existingGroup.id });
        }
      } else {
        await ensureColorForCustomGroup(currentTab.windowId, customGroup.name, customGroup.color);
        const groupId = await chrome.tabs.group({ tabIds: currentTab.id });
        await chrome.tabGroups.update(groupId, { title: customGroup.name, color: customGroup.color });
      }
      return;
    }
  }

  // 2. Check auto groups (if enabled)
  if (settings.autoGrouping) {
    const existingAutoGroup = await findAutoGroupForDomain(currentTab.windowId, domain);

    if (existingAutoGroup) {
      // Move to existing auto group if not already there
      if (currentTab.groupId !== existingAutoGroup.id) {
        await chrome.tabs.group({ tabIds: currentTab.id, groupId: existingAutoGroup.id });
      }
      return;
    }

    // No existing auto group - check if we can create one (2+ tabs with same domain)
    const allTabs = await chrome.tabs.query({ windowId: currentTab.windowId });
    const sameDomainTabs = allTabs.filter(t =>
      t.id !== currentTab.id &&
      t.groupId === -1 &&
      getDomain(t.url) === domain
    );

    if (sameDomainTabs.length >= 1) {
      // 2+ tabs - create new auto group
      const tabIds = [currentTab.id, ...sameDomainTabs.map(t => t.id)];
      const groupId = await chrome.tabs.group({ tabIds });
      const color = await getNextAvailableColor(currentTab.windowId);
      await chrome.tabGroups.update(groupId, { title: getShortName(domain), color });
      markAsAutoGroup(groupId);
      return;
    }
  }

  // 3. Tab doesn't fit custom or auto groups
  if (currentTab.groupId !== -1) {
    const groupId = currentTab.groupId;

    // Check if OTHER tabs (excluding this one) all share same domain
    const groupTabs = await chrome.tabs.query({ groupId });
    const otherTabs = groupTabs.filter(t => t.id !== currentTab.id);

    if (otherTabs.length > 0) {
      const otherDomains = new Set(otherTabs.map(t => getDomain(t.url)));

      if (otherDomains.size > 1) {
        // Other tabs have mixed domains - this is a manual group
        // User intentionally put mismatched tabs together, respect that
        if (isAutoGroupId(groupId)) {
          autoGroupIds.delete(groupId);
          saveAutoGroupIds();
        }
        return; // Don't ungroup, keep tab in place
      }
    }

    // Other tabs are pure (or no other tabs) - ungroup this mismatched tab
    await chrome.tabs.ungroup(currentTab.id);

    // Re-evaluate the group status (might become valid auto again)
    if (otherTabs.length >= 2) {
      await checkAndUpdateGroupStatus(groupId);
    }
  }
}

// Apply auto-grouping to all ungrouped tabs
async function applyAutoGroupingToAll() {
  if (!settings.autoGrouping && !settings.customGrouping) return;

  if (settings.allWindows) {
    // Apply to all windows
    const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
    for (const win of windows) {
      await applyAutoGroupingToWindow(win.id);
    }
  } else {
    // Apply to current window only
    const currentWindow = await chrome.windows.getCurrent();
    await applyAutoGroupingToWindow(currentWindow.id);
  }
}

// Apply auto-grouping to a specific window
async function applyAutoGroupingToWindow(windowId) {
  const tabs = await chrome.tabs.query({ windowId });
  const groups = await chrome.tabGroups.query({ windowId });

  // Find "Other" group and identify custom groups by title
  const otherGroup = groups.find(g => g.title === 'Other' && g.color === 'grey');
  const otherGroupId = otherGroup?.id;
  const customGroupTitles = new Set((settings.customGroups || []).map(g => g.name));
  const customGroupIds = new Set(groups.filter(g => customGroupTitles.has(g.title)).map(g => g.id));

  // First, check if there's any work to do
  let hasWork = false;

  // Check custom grouping work (ungrouped, "Other", and auto-created groups)
  if (settings.customGrouping) {
    for (const tab of tabs) {
      // Skip tabs already in custom groups
      if (tab.groupId !== -1 && tab.groupId !== otherGroupId && customGroupIds.has(tab.groupId)) continue;
      if (shouldSkipUrl(tab.url)) continue;
      const hostname = getHostname(tab.url);
      if (!hostname) continue;
      if (findCustomGroupForHostname(hostname)) {
        hasWork = true;
        break;
      }
    }
  }

  // Check auto-grouping work
  if (!hasWork && settings.autoGrouping) {
    const domainCounts = new Map();
    for (const tab of tabs) {
      if (tab.groupId !== -1 && tab.groupId !== otherGroupId) continue;
      if (shouldSkipUrl(tab.url)) continue;
      const domain = getDomain(tab.url);
      if (!domain) continue;
      const hostname = getHostname(tab.url);
      if (settings.customGrouping && hostname && findCustomGroupForHostname(hostname)) continue;
      domainCounts.set(domain, (domainCounts.get(domain) || 0) + 1);
    }
    for (const [domain, count] of domainCounts) {
      const existingGroup = groups.find(g => g.title === getShortName(domain));
      if (existingGroup || count >= 2) {
        hasWork = true;
        break;
      }
    }
  }

  if (!hasWork) return;

  // First pass: handle custom groups (ungrouped, "Other", and auto-created groups)
  if (settings.customGrouping) {
    // Batch tabs by custom group
    const customGroupBatches = new Map(); // groupKey -> { config, tabIds }

    for (const tab of tabs) {
      // Allow ungrouped tabs, "Other" group, and auto-created groups
      // Skip tabs already in custom groups
      if (tab.groupId !== -1 && tab.groupId !== otherGroupId && customGroupIds.has(tab.groupId)) continue;
      if (shouldSkipUrl(tab.url)) continue;

      const hostname = getHostname(tab.url);
      if (!hostname) continue;

      const customGroup = findCustomGroupForHostname(hostname);
      if (customGroup) {
        const key = `${customGroup.name}:${customGroup.color}`;
        if (!customGroupBatches.has(key)) {
          customGroupBatches.set(key, { config: customGroup, tabIds: [] });
        }
        customGroupBatches.get(key).tabIds.push(tab.id);
      }
    }

    // Apply batched custom groups
    for (const [key, { config, tabIds }] of customGroupBatches) {
      const existingGroup = await findGroupByTitleAndColor(tabs[0].windowId, config.name, config.color);
      if (existingGroup) {
        await chrome.tabs.group({ tabIds, groupId: existingGroup.id });
      } else {
        // Ensure custom group gets its color (swap if needed)
        await ensureColorForCustomGroup(tabs[0].windowId, config.name, config.color);
        const groupId = await chrome.tabs.group({ tabIds });
        await chrome.tabGroups.update(groupId, { title: config.name, color: config.color });
      }
    }
  }

  // Second pass: handle auto-grouping for remaining ungrouped tabs
  if (settings.autoGrouping) {
    // Re-query tabs since groupIds may have changed
    const updatedTabs = await chrome.tabs.query({ windowId });
    const domainMap = new Map();

    for (const tab of updatedTabs) {
      // Only ungrouped and "Other" tabs
      if (tab.groupId !== -1 && tab.groupId !== otherGroupId) continue;
      if (shouldSkipUrl(tab.url)) continue;

      const domain = getDomain(tab.url);
      if (!domain) continue;

      // Skip if matches a custom group (already handled above)
      const hostname = getHostname(tab.url);
      if (settings.customGrouping && hostname && findCustomGroupForHostname(hostname)) continue;

      if (!domainMap.has(domain)) {
        domainMap.set(domain, []);
      }
      domainMap.get(domain).push(tab);
    }

    // Create domain groups
    for (const [domain, domainTabs] of domainMap.entries()) {
      const displayName = getShortName(domain);
      const existingGroup = await findAutoGroupForDomain(domainTabs[0].windowId, domain);

      if (existingGroup) {
        // Only add tabs that aren't already in this group
        const tabsToAdd = domainTabs.filter(t => t.groupId !== existingGroup.id);
        if (tabsToAdd.length > 0) {
          const tabIds = tabsToAdd.map(t => t.id);
          await chrome.tabs.group({ tabIds, groupId: existingGroup.id });
        }
      } else if (domainTabs.length >= 2) {
        const tabIds = domainTabs.map(t => t.id);
        const groupId = await chrome.tabs.group({ tabIds });
        const color = await getNextAvailableColor(domainTabs[0].windowId);
        await chrome.tabGroups.update(groupId, { title: displayName, color });
        markAsAutoGroup(groupId);
      }
    }
  }
}

// Auto-order: move tab to first position in group after being active
async function checkAutoOrdering(tabId) {
  if (!settings.autoOrdering) return;

  const activationTime = tabActivationTimes.get(tabId);
  if (!activationTime) return;

  const elapsedSeconds = (Date.now() - activationTime) / 1000;
  if (elapsedSeconds < settings.autoOrderingSeconds) return;

  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.groupId === -1) return;

    const groupTabs = await chrome.tabs.query({ groupId: tab.groupId });
    if (groupTabs.length < 2) return;

    const sortedTabs = groupTabs.sort((a, b) => a.index - b.index);
    if (tab.id !== sortedTabs[0].id) {
      await chrome.tabs.move(tab.id, { index: sortedTabs[0].index });
      await chrome.tabs.group({ tabIds: tab.id, groupId: tab.groupId });
    }
  } catch {
    // Tab might have been closed
  }
}

// Badge updates
chrome.tabs.onCreated.addListener(updateBadge);
chrome.tabs.onRemoved.addListener(updateBadge);
chrome.windows.onFocusChanged.addListener(updateBadge);

// Track tab activation for auto-ordering
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tabs = await chrome.tabs.query({ windowId: activeInfo.windowId });
  for (const tab of tabs) {
    if (tab.id !== activeInfo.tabId) {
      checkAutoOrdering(tab.id);
    }
  }
  tabActivationTimes.set(activeInfo.tabId, Date.now());
});

// Group new tabs when they finish loading
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (shouldSkipUrl(tab.url)) return;
  withGroupingLock(() => groupSingleTab(tab));
});

// Clean up when tabs are closed
chrome.tabs.onRemoved.addListener((tabId) => {
  tabActivationTimes.delete(tabId);
});

// Clean up auto group IDs when groups are removed
chrome.tabGroups.onRemoved.addListener((group) => {
  if (autoGroupIds.has(group.id)) {
    autoGroupIds.delete(group.id);
    saveAutoGroupIds();
  }
});

// Periodic check for auto-ordering
setInterval(() => {
  if (settings.autoOrdering) {
    chrome.tabs.query({ active: true, currentWindow: true }).then(tabs => {
      if (tabs[0]) checkAutoOrdering(tabs[0].id);
    });
  }
}, 1000);

// Initial setup
async function init() {
  await loadSettings();
  await loadAutoGroupIds();
  updateBadge();
  // Don't auto-group on init - only when sidebar opens
}

init();
