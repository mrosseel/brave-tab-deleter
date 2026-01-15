import { getDomain, getShortName } from './lib/domain.js';
import { findCustomGroupForDomain } from './lib/groups.js';
import { shouldReorderTab, findFirstPositionInGroup, needsReordering } from './lib/ordering.js';

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
const tabActivationTimes = new Map(); // tabId -> timestamp

// Load settings from storage
async function loadSettings() {
  const stored = await chrome.storage.sync.get('settings');
  console.log('Loading settings from storage:', stored);
  if (stored.settings) {
    settings = { ...settings, ...stored.settings };
  }
  console.log('Settings after load:', settings);
}

// Listen for settings updates via message
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'settingsUpdated') {
    console.log('Received settings update message:', message.settings);
    settings = message.settings;
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
    // Clear ghost groups storage when closing sidebar
    await chrome.storage.session.remove('ghostGroups');
    // Close by disabling and re-enabling
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
  const count = tabs.length;

  chrome.action.setBadgeText({ text: count.toString() });
  chrome.action.setBadgeBackgroundColor({ color: '#6366f1' });
}

// Find or create a group for a domain
async function findOrCreateGroupForDomain(domain, windowId) {
  // Get all groups in the window
  const groups = await chrome.tabGroups.query({ windowId });

  // Get all tabs to find tabs with the same domain
  const tabs = await chrome.tabs.query({ windowId });

  // Find tabs with the same domain that are already grouped
  for (const tab of tabs) {
    if (tab.groupId !== -1 && getDomain(tab.url) === domain) {
      return tab.groupId;
    }
  }

  return null; // No existing group found
}

// Find or create a custom group
async function findOrCreateCustomGroup(customGroup, windowId) {
  // Get all groups and tabs
  const groups = await chrome.tabGroups.query({ windowId });
  const tabs = await chrome.tabs.query({ windowId });

  // Look for existing group with same name and color
  for (const group of groups) {
    if (group.title === customGroup.name && group.color === customGroup.color) {
      return group.id;
    }
  }

  // Look for any tab that matches this custom group and is already grouped
  for (const tab of tabs) {
    if (tab.groupId !== -1) {
      const domain = getDomain(tab.url);
      const matchedGroup = findCustomGroupForDomain(domain, settings.customGroups, settings.customGrouping);
      if (domain && matchedGroup?.id === customGroup.id) {
        // Check if this group matches our custom group settings
        const group = groups.find(g => g.id === tab.groupId);
        if (group && group.title === customGroup.name) {
          return tab.groupId;
        }
      }
    }
  }

  return null;
}

// Auto-group a tab
async function autoGroupTab(tab) {
  console.log('autoGroupTab called for:', tab.url, 'settings.autoGrouping:', settings.autoGrouping, 'settings.customGrouping:', settings.customGrouping);

  if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
    console.log('Skipping - chrome URL');
    return;
  }

  const domain = getDomain(tab.url);
  if (!domain) {
    console.log('Skipping - no domain');
    return;
  }

  console.log('Domain:', domain, 'Tab groupId:', tab.groupId);

  // Check custom grouping first (takes priority)
  if (settings.customGrouping) {
    const customGroup = findCustomGroupForDomain(domain, settings.customGroups, settings.customGrouping);
    if (customGroup) {
      let groupId = await findOrCreateCustomGroup(customGroup, tab.windowId);

      if (groupId && tab.groupId !== groupId) {
        await chrome.tabs.group({ tabIds: tab.id, groupId });
      } else if (!groupId) {
        // Create new group
        groupId = await chrome.tabs.group({ tabIds: tab.id });
        await chrome.tabGroups.update(groupId, {
          title: customGroup.name,
          color: customGroup.color
        });
      }
      return; // Don't do auto-grouping if custom group matched
    }
  }

  // Auto-grouping by domain
  if (settings.autoGrouping) {
    console.log('Auto-grouping enabled, checking tab...');

    // Re-fetch tab to get current state (might have changed)
    let currentTab;
    try {
      currentTab = await chrome.tabs.get(tab.id);
    } catch (e) {
      console.log('Tab no longer exists');
      return;
    }

    // Skip if tab is already grouped
    if (currentTab.groupId !== -1) {
      console.log('Tab already in group', currentTab.groupId, '- skipping');
      return;
    }

    const existingGroupId = await findOrCreateGroupForDomain(domain, currentTab.windowId);
    console.log('Existing group for domain:', existingGroupId);

    if (existingGroupId) {
      // Re-check tab is still ungrouped before adding
      try {
        const recheckTab = await chrome.tabs.get(tab.id);
        if (recheckTab.groupId === -1) {
          console.log('Adding tab to existing group', existingGroupId);
          await chrome.tabs.group({ tabIds: tab.id, groupId: existingGroupId });
          // Mark as recently grouped
          recentlyGroupedTabs.add(tab.id);
          setTimeout(() => recentlyGroupedTabs.delete(tab.id), 2000);
        }
      } catch (e) {
        console.log('Tab no longer exists or error:', e);
      }
    } else {
      // Check if there are other ungrouped tabs with same domain
      const allTabs = await chrome.tabs.query({ windowId: currentTab.windowId });
      const sameDomainTabs = allTabs.filter(t =>
        t.id !== tab.id &&
        t.groupId === -1 &&
        getDomain(t.url) === domain
      );

      console.log('Same domain ungrouped tabs:', sameDomainTabs.length);

      if (sameDomainTabs.length > 0) {
        // Re-check our tab is still ungrouped
        try {
          const recheckTab = await chrome.tabs.get(tab.id);
          if (recheckTab.groupId !== -1) {
            console.log('Tab was grouped while we were checking, skipping');
            return;
          }
        } catch (e) {
          return;
        }

        // Create a new group with this tab and others
        const tabIds = [tab.id, ...sameDomainTabs.map(t => t.id)];
        console.log('Creating new group with tabs:', tabIds);
        try {
          const groupId = await chrome.tabs.group({ tabIds });

          // Mark all tabs as recently grouped
          tabIds.forEach(id => {
            recentlyGroupedTabs.add(id);
            setTimeout(() => recentlyGroupedTabs.delete(id), 2000);
          });

          // Set group title to short name (without TLD)
          const displayName = getShortName(domain);
          await chrome.tabGroups.update(groupId, {
            title: displayName,
            color: 'blue'
          });
          console.log('Created group', groupId, 'with title', displayName);
        } catch (e) {
          console.log('Error creating group:', e);
        }
      } else {
        console.log('No other tabs with same domain to group with');
      }
    }
  } else {
    console.log('Auto-grouping disabled');
  }
}

// Auto-order: move tab to first position in group after being active for X seconds
async function checkAutoOrdering(tabId) {
  if (!settings.autoOrdering) return;

  if (!shouldReorderTab(tabId, tabActivationTimes, settings.autoOrderingSeconds)) return;

  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.groupId === -1) return; // Not in a group

    // Get all tabs in the same group
    const groupTabs = await chrome.tabs.query({ groupId: tab.groupId });

    if (needsReordering(tab, groupTabs)) {
      const firstIndex = findFirstPositionInGroup(groupTabs);
      if (firstIndex !== null) {
        await chrome.tabs.move(tab.id, { index: firstIndex });
      }
    }
  } catch (e) {
    // Tab might have been closed
  }
}

// Track tab activation for auto-ordering
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  // Clear previous activation time for other tabs in the same window
  const tabs = await chrome.tabs.query({ windowId: activeInfo.windowId });
  for (const tab of tabs) {
    if (tab.id !== activeInfo.tabId) {
      // Check if previous tab should be reordered before clearing
      checkAutoOrdering(tab.id);
    }
  }

  // Set activation time for new tab
  tabActivationTimes.set(activeInfo.tabId, Date.now());
});

// Clean up activation times when tabs are closed
chrome.tabs.onRemoved.addListener((tabId) => {
  tabActivationTimes.delete(tabId);
});

// Track tabs being processed to avoid race conditions
const processingTabs = new Set();
// Track recently grouped tabs to avoid re-processing
const recentlyGroupedTabs = new Set();
// Track newly created tabs (eligible for auto-grouping)
const newlyCreatedTabs = new Set();

// Mark new tabs when created
chrome.tabs.onCreated.addListener((tab) => {
  console.log('Tab created:', tab.id);
  newlyCreatedTabs.add(tab.id);
  // Remove from newly created after 10 seconds
  setTimeout(() => newlyCreatedTabs.delete(tab.id), 10000);
});

// Auto-group when tab finishes loading
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Only process when page has completed loading and has a real URL
  if (changeInfo.status !== 'complete') return;
  if (!tab.url || tab.url === 'chrome://newtab/' || tab.url === 'about:blank') return;
  if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) return;

  // Only auto-group newly created tabs, not existing tabs that navigate
  if (!newlyCreatedTabs.has(tabId)) {
    console.log('Tab', tabId, 'is not newly created, skipping auto-group');
    return;
  }

  // Skip if tab was recently grouped (within last 2 seconds)
  if (recentlyGroupedTabs.has(tabId)) {
    console.log('Tab', tabId, 'was recently grouped, skipping');
    return;
  }

  // Skip if already in a group
  if (tab.groupId !== -1) {
    console.log('Tab', tabId, 'already in group', tab.groupId, '- skipping onUpdated');
    newlyCreatedTabs.delete(tabId);
    return;
  }

  // Avoid processing same tab multiple times simultaneously
  if (processingTabs.has(tabId)) return;

  console.log('onUpdated processing NEW tab', tabId, tab.url);

  processingTabs.add(tabId);
  try {
    await autoGroupTab(tab);
    // Remove from newly created after processing
    newlyCreatedTabs.delete(tabId);
  } finally {
    processingTabs.delete(tabId);
  }
});

// Periodic check for auto-ordering
setInterval(() => {
  if (settings.autoOrdering) {
    chrome.tabs.query({ active: true, currentWindow: true }).then(tabs => {
      if (tabs[0]) {
        checkAutoOrdering(tabs[0].id);
      }
    });
  }
}, 1000);

// Update badge on various tab events
chrome.tabs.onCreated.addListener(updateBadge);
chrome.tabs.onRemoved.addListener(updateBadge);
chrome.windows.onFocusChanged.addListener(updateBadge);

// Apply auto-grouping to all existing ungrouped tabs
async function applyAutoGroupingToAll() {
  if (!settings.autoGrouping && !settings.customGrouping) return;

  console.log('Applying auto-grouping to existing tabs...');

  const tabs = await chrome.tabs.query({ currentWindow: true });

  // Group tabs by domain
  const domainMap = new Map(); // domain -> [tab objects]

  for (const tab of tabs) {
    if (tab.groupId !== -1) continue; // Skip already grouped
    if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) continue;
    if (tab.url === 'chrome://newtab/' || tab.url === 'about:blank') continue;

    const domain = getDomain(tab.url);
    if (!domain) continue;

    // Check custom grouping first
    if (settings.customGrouping) {
      const customGroup = findCustomGroupForDomain(domain, settings.customGroups, settings.customGrouping);
      if (customGroup) {
        let groupId = await findOrCreateCustomGroup(customGroup, tab.windowId);
        if (groupId && tab.groupId !== groupId) {
          await chrome.tabs.group({ tabIds: tab.id, groupId });
        } else if (!groupId) {
          groupId = await chrome.tabs.group({ tabIds: tab.id });
          await chrome.tabGroups.update(groupId, {
            title: customGroup.name,
            color: customGroup.color
          });
        }
        continue;
      }
    }

    // Collect for domain-based grouping
    if (settings.autoGrouping) {
      if (!domainMap.has(domain)) {
        domainMap.set(domain, []);
      }
      domainMap.get(domain).push(tab);
    }
  }

  // Create groups for domains with 2+ ungrouped tabs
  for (const [domain, domainTabs] of domainMap.entries()) {
    // First check if there's an existing group for this domain
    const existingGroupId = await findOrCreateGroupForDomain(domain, domainTabs[0].windowId);

    if (existingGroupId) {
      // Add all ungrouped tabs to existing group
      const tabIds = domainTabs.map(t => t.id);
      await chrome.tabs.group({ tabIds, groupId: existingGroupId });
      console.log('Added', tabIds.length, 'tabs to existing group for', domain);
    } else if (domainTabs.length >= 2) {
      // Create new group
      const tabIds = domainTabs.map(t => t.id);
      const groupId = await chrome.tabs.group({ tabIds });
      const displayName = getShortName(domain);
      await chrome.tabGroups.update(groupId, {
        title: displayName,
        color: 'blue'
      });
      console.log('Created new group', displayName, 'with', tabIds.length, 'tabs');
    }
  }

  console.log('Auto-grouping complete');
}

// Initial setup
async function init() {
  await loadSettings();
  updateBadge();

  // Apply auto-grouping after a short delay to let browser settle
  setTimeout(() => {
    applyAutoGroupingToAll();
  }, 1000);
}

init();
