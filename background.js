// Import shared utilities
import { getDomain, getHostname, getShortName, shouldSkipUrl } from './shared.js';

console.log('=== BACKGROUND.JS VERSION 2 LOADED ===');

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
let groupingLock = false;
let groupingQueue = [];

async function withGroupingLock(fn) {
  // If lock is held, queue this operation
  if (groupingLock) {
    return new Promise((resolve) => {
      groupingQueue.push(async () => {
        const result = await fn();
        resolve(result);
      });
    });
  }

  groupingLock = true;
  try {
    return await fn();
  } finally {
    groupingLock = false;
    // Process next queued operation
    if (groupingQueue.length > 0) {
      const next = groupingQueue.shift();
      next();
    }
  }
}

// Load settings from storage
async function loadSettings() {
  const stored = await chrome.storage.sync.get('settings');
  console.log('Loading settings from storage:', stored);
  if (stored.settings) {
    settings = { ...settings, ...stored.settings };
  }
  console.log('Settings after load:', settings);
}

// Listen for messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'settingsUpdated') {
    console.log('Received settings update message:', message.settings);
    settings = message.settings;
  } else if (message.type === 'sidebarOpened') {
    console.log('Sidebar opened, applying auto-grouping...');
    withGroupingLock(() => applyAutoGroupingToAll());
  }
});

// Listen for storage changes (backup method)
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync' && changes.settings) {
    console.log('Storage changed, new settings:', changes.settings.newValue);
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
  if (!settings.customGrouping || !settings.customGroups) return null;

  for (const group of settings.customGroups) {
    for (const pattern of group.domains) {
      // Match exact hostname or hostname ending with .pattern
      if (hostname === pattern || hostname.endsWith('.' + pattern)) {
        return group;
      }
    }
  }
  return null;
}

// Find existing group by title and color
async function findGroupByTitleAndColor(windowId, title, color) {
  const groups = await chrome.tabGroups.query({ windowId });
  return groups.find(g => g.title === title && g.color === color);
}

// Find existing auto-created group for domain
async function findAutoGroupForDomain(windowId, domain) {
  const expectedTitle = getShortName(domain);
  const groups = await chrome.tabGroups.query({ windowId });
  return groups.find(g => g.title === expectedTitle && g.color === 'blue');
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
        const groupId = await chrome.tabs.group({ tabIds: currentTab.id });
        await chrome.tabGroups.update(groupId, { title: customGroup.name, color: customGroup.color });
      }
      return;
    }
  }

  // Skip if already in a group (don't move between auto-groups)
  if (currentTab.groupId !== -1) return;

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
        await chrome.tabGroups.update(groupId, {
          title: getShortName(domain),
          color: 'blue'
        });
      }
      // If only 1 tab, leave it ungrouped for now
    }
  }
}

// Apply auto-grouping to all ungrouped tabs
async function applyAutoGroupingToAll() {
  if (!settings.autoGrouping && !settings.customGrouping) return;

  console.log('applyAutoGroupingToAll: starting...');

  const tabs = await chrome.tabs.query({ currentWindow: true });
  const groups = await chrome.tabGroups.query({ windowId: chrome.windows.WINDOW_ID_CURRENT });

  // Find "Other" group and auto-created groups (blue)
  const otherGroup = groups.find(g => g.title === 'Other' && g.color === 'grey');
  const otherGroupId = otherGroup?.id;
  const autoGroupIds = new Set(groups.filter(g => g.color === 'blue').map(g => g.id));

  // First pass: handle custom groups (check ALL tabs, including those in auto-groups)
  console.log('customGrouping enabled:', settings.customGrouping, 'groups:', settings.customGroups);
  if (settings.customGrouping) {
    for (const tab of tabs) {
      if (shouldSkipUrl(tab.url)) continue;

      const hostname = getHostname(tab.url);
      if (!hostname) continue;

      const customGroup = findCustomGroupForHostname(hostname);
      console.log('Tab hostname:', hostname, '-> customGroup:', customGroup?.name || 'none');
      if (customGroup) {
        const existingCustomGroup = await findGroupByTitleAndColor(tab.windowId, customGroup.name, customGroup.color);

        // Move if ungrouped, in "Other", or in an auto-group (but not already in correct custom group)
        const shouldMove = tab.groupId === -1 ||
          tab.groupId === otherGroupId ||
          autoGroupIds.has(tab.groupId);

        if (shouldMove && tab.groupId !== existingCustomGroup?.id) {
          if (existingCustomGroup) {
            await chrome.tabs.group({ tabIds: tab.id, groupId: existingCustomGroup.id });
          } else {
            const groupId = await chrome.tabs.group({ tabIds: tab.id });
            await chrome.tabGroups.update(groupId, { title: customGroup.name, color: customGroup.color });
          }
        }
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
        const tabIds = domainTabs.map(t => t.id);
        await chrome.tabs.group({ tabIds, groupId: existingGroup.id });
        console.log('Added', tabIds.length, 'tabs to existing group', displayName);
      } else if (domainTabs.length >= 2) {
        const tabIds = domainTabs.map(t => t.id);
        const groupId = await chrome.tabs.group({ tabIds });
        await chrome.tabGroups.update(groupId, { title: displayName, color: 'blue' });
        console.log('Created new group', displayName, 'with', tabIds.length, 'tabs');
      }
    }
  }

  console.log('applyAutoGroupingToAll: complete');
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

// Handle new tab navigation - only group if there's an existing group to join
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (shouldSkipUrl(tab.url)) return;

  // Use the lock to prevent conflicts
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

// Update badge on tab events
chrome.tabs.onCreated.addListener(updateBadge);
chrome.tabs.onRemoved.addListener(updateBadge);
chrome.windows.onFocusChanged.addListener(updateBadge);

// Track destroyed groups and re-apply grouping if needed
chrome.tabGroups.onRemoved.addListener(async (group) => {
  console.log('!!! GROUP DESTROYED:', group.id, 'title:', group.title, 'color:', group.color);

  if (!group.title || group.title === 'Other') return;

  const tabs = await chrome.tabs.query({ currentWindow: true });

  // Check if this was a custom group
  const customGroup = settings.customGroups?.find(g => g.name === group.title && g.color === group.color);
  if (customGroup && settings.customGrouping) {
    // Find ungrouped tabs matching this custom group's patterns
    const matchingTabs = tabs.filter(t => {
      if (t.groupId !== -1) return false;
      if (shouldSkipUrl(t.url)) return false;
      const hostname = getHostname(t.url);
      if (!hostname) return false;
      return customGroup.domains.some(pattern =>
        hostname === pattern || hostname.endsWith('.' + pattern)
      );
    });

    if (matchingTabs.length >= 1) {
      console.log('Recovering custom group:', group.title, 'with', matchingTabs.length, 'tabs');
      const tabIds = matchingTabs.map(t => t.id);
      const newGroupId = await chrome.tabs.group({ tabIds });
      await chrome.tabGroups.update(newGroupId, { title: group.title, color: group.color });
    }
    return;
  }

  // Recover auto-created groups (blue)
  if (settings.autoGrouping && group.color === 'blue') {
    const matchingTabs = tabs.filter(t =>
      t.groupId === -1 &&
      !shouldSkipUrl(t.url) &&
      getShortName(getDomain(t.url)) === group.title
    );

    if (matchingTabs.length >= 2) {
      console.log('Recovering auto group:', group.title, 'with', matchingTabs.length, 'tabs');
      const tabIds = matchingTabs.map(t => t.id);
      const newGroupId = await chrome.tabs.group({ tabIds });
      await chrome.tabGroups.update(newGroupId, { title: group.title, color: group.color });
    }
  }
});

chrome.tabGroups.onUpdated.addListener((group) => {
  console.log('GROUP UPDATED:', group.id, 'title:', group.title, 'color:', group.color);
});

chrome.tabGroups.onCreated.addListener((group) => {
  console.log('GROUP CREATED:', group.id);
});

// Initial setup
async function init() {
  await loadSettings();
  updateBadge();
  // Don't auto-group on init - only when sidebar opens
}

init();
