// Import shared utilities
import { getDomain, getHostname, getShortName, shouldSkipUrl } from './lib/domain.js';
import { createLock } from './lib/lock.js';
import { findAvailableColor } from './lib/colors.js';

console.log('=== BACKGROUND.JS VERSION 6 LOADED ===');

// Track sidebar state per window
const sidebarOpen = new Map();

// Settings cache
let settings = {
  autoGrouping: false,
  autoOrdering: false,
  autoOrderingSeconds: 5,
  customGrouping: false,
  customGroups: []
};

// Track tab activation times for auto-ordering
const tabActivationTimes = new Map();

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
  const tabs = await chrome.tabs.query({ currentWindow: true });
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

  // Check custom grouping first
  const hostname = getHostname(tab.url);
  if (settings.customGrouping && hostname) {
    const customGroup = findCustomGroupForHostname(hostname);
    if (customGroup) {
      const existingGroup = await findGroupByTitleAndColor(currentTab.windowId, customGroup.name, customGroup.color);

      // Move to custom group if not already there
      if (existingGroup && currentTab.groupId !== existingGroup.id) {
        await chrome.tabs.group({ tabIds: currentTab.id, groupId: existingGroup.id });
      } else if (!existingGroup) {
        // Ensure custom group gets its color (swap if needed)
        await ensureColorForCustomGroup(currentTab.windowId, customGroup.name, customGroup.color);
        const groupId = await chrome.tabs.group({ tabIds: currentTab.id });
        await chrome.tabGroups.update(groupId, { title: customGroup.name, color: customGroup.color });
      }
      return;
    }
  }

  // Skip if already in a non-auto group (custom group protection)
  if (currentTab.groupId !== -1) {
    try {
      const group = await chrome.tabGroups.get(currentTab.groupId);
      // Only skip if it's a custom group (not blue/auto-created)
      if (group.color !== 'blue') return;
    } catch {
      // Group doesn't exist, continue
    }
  }

  // Auto-grouping by domain
  if (settings.autoGrouping) {
    const existingGroup = await findAutoGroupForDomain(currentTab.windowId, domain);

    if (existingGroup) {
      await chrome.tabs.group({ tabIds: currentTab.id, groupId: existingGroup.id });
    } else {
      // Check if there are other ungrouped tabs with the same domain
      const allTabs = await chrome.tabs.query({ windowId: currentTab.windowId });
      const sameDomainUngrouped = allTabs.filter(t =>
        t.id !== currentTab.id &&
        t.groupId === -1 &&
        getDomain(t.url) === domain
      );

      if (sameDomainUngrouped.length >= 1) {
        // 2+ tabs with same domain (this one + at least 1 other) - create group
        const tabIds = [currentTab.id, ...sameDomainUngrouped.map(t => t.id)];
        const groupId = await chrome.tabs.group({ tabIds });
        const color = await getNextAvailableColor(currentTab.windowId);
        await chrome.tabGroups.update(groupId, {
          title: getShortName(domain),
          color
        });
      }
      // If only 1 tab, leave it ungrouped for now
    }
  }
}

// Apply auto-grouping to all ungrouped tabs
async function applyAutoGroupingToAll() {
  if (!settings.autoGrouping && !settings.customGrouping) return;

  const tabs = await chrome.tabs.query({ currentWindow: true });
  const groups = await chrome.tabGroups.query({ windowId: chrome.windows.WINDOW_ID_CURRENT });

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
    const updatedTabs = await chrome.tabs.query({ currentWindow: true });
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
  updateBadge();
  // Don't auto-group on init - only when sidebar opens
}

init();
