// Import shared utilities
import { getDomain, getHostname, getShortName, shouldSkipUrl } from './lib/domain.js';
import { createLock } from './lib/lock.js';
import { findAvailableColor } from './lib/colors.js';
import { AUTO_ORDERING_CHECK_INTERVAL_MS } from './lib/constants.js';
import {
  loadAutoGroupIds,
  loadManualGroupIds,
  markAsAutoGroup,
  markAsManualGroup,
  isAutoGroupId,
  isManualGroupId,
  unmarkAutoGroup,
  removeGroupId
} from './lib/group-tracking.js';
import { DEFAULT_SETTINGS } from './lib/settings-defaults.js';
import { bus, emitSettingsChanges } from './lib/events.js';
import { ensureLabelsForWindows, releaseLabelForWindow } from './lib/window-labels.js';

console.log('=== BACKGROUND.JS VERSION 13 LOADED ===');

// Track sidebar state per window
const sidebarOpen = new Map();

// Settings cache
let settings = { ...DEFAULT_SETTINGS };

// YouTube progress tracking: tabId -> { progress, videoId }
let youtubeProgress = new Map();

// Load YouTube progress from session storage
async function loadYoutubeProgress() {
  try {
    const stored = await chrome.storage.session.get('youtubeProgress');
    if (stored.youtubeProgress) {
      youtubeProgress = new Map(stored.youtubeProgress);
    }
  } catch {}
}

// Save YouTube progress to session storage
async function saveYoutubeProgress() {
  try {
    await chrome.storage.session.set({ youtubeProgress: [...youtubeProgress.entries()] });
  } catch {}
}

// Load sidebarOpen from session storage (survives service worker hibernation)
async function loadSidebarOpen() {
  try {
    const stored = await chrome.storage.session.get('sidebarOpen');
    if (stored.sidebarOpen) {
      for (const [k, v] of stored.sidebarOpen) {
        sidebarOpen.set(k, v);
      }
    }
  } catch {}
}

// Save sidebarOpen to session storage
async function saveSidebarOpen() {
  try {
    await chrome.storage.session.set({ sidebarOpen: [...sidebarOpen.entries()] });
  } catch {}
}

// Track tab activation times for auto-ordering
const tabActivationTimes = new Map();


// Check if a group qualifies as auto (all tabs same domain)
// After crash/restart, session storage is lost so we re-classify and rename if needed
async function checkAndUpdateGroupStatus(groupId) {
  try {
    const group = await chrome.tabGroups.get(groupId);
    const tabs = await chrome.tabs.query({ groupId });

    if (tabs.length < 2) {
      await unmarkAutoGroup(groupId);
      return false;
    }

    const firstDomain = getDomain(tabs[0].url);
    const allSameDomain = tabs.every(t => getDomain(t.url) === firstDomain);
    const expectedTitle = getShortName(firstDomain);
    const titleMatches = group.title?.toLowerCase() === expectedTitle.toLowerCase();

    if (allSameDomain) {
      if (!titleMatches) {
        // Restore title lost after crash/restart
        await chrome.tabGroups.update(groupId, { title: expectedTitle });
      }
      if (!isAutoGroupId(groupId)) {
        await markAsAutoGroup(groupId);
      }
      return true;
    } else {
      await unmarkAutoGroup(groupId);
      return false;
    }
  } catch {
    await unmarkAutoGroup(groupId);
    return false;
  }
}

// SINGLE GLOBAL LOCK for all grouping operations
const withGroupingLock = createLock();

// Coalesce per-tab grouping work. Bursts (e.g. session restore) are batched
// into a single bulk pass instead of dozens of locked operations.
const PER_TAB_DEBOUNCE_MS = 200;
const BURST_TO_BULK_THRESHOLD = 5;
const pendingTabIds = new Set();
let pendingTabTimer = null;
let bulkPending = false;

async function scheduleBulkGrouping() {
  if (bulkPending) return;
  bulkPending = true;
  try {
    await withGroupingLock(async () => {
      try {
        await applyAutoGroupingToAll();
      } catch (err) {
        console.error('[bg] applyAutoGroupingToAll failed:', err);
      }
    });
  } finally {
    bulkPending = false;
  }
}

function scheduleSingleTabGrouping(tabId) {
  pendingTabIds.add(tabId);
  if (pendingTabTimer) clearTimeout(pendingTabTimer);
  pendingTabTimer = setTimeout(() => {
    pendingTabTimer = null;
    const ids = [...pendingTabIds];
    pendingTabIds.clear();
    if (ids.length === 0) return;
    if (bulkPending) return; // Bulk pass already on its way
    if (ids.length >= BURST_TO_BULK_THRESHOLD) {
      scheduleBulkGrouping().catch(err => console.error('[bg] bulk grouping failed:', err));
      return;
    }
    withGroupingLock(async () => {
      for (const id of ids) {
        try {
          const t = await chrome.tabs.get(id);
          await groupSingleTab(t);
        } catch {
          // Tab gone or grouping threw; skip
        }
      }
    }).catch(err => console.error('[bg] per-tab grouping failed:', err));
  }, PER_TAB_DEBOUNCE_MS);
}


// Load settings from storage
async function loadSettings() {
  const stored = await chrome.storage.sync.get('settings');
  if (stored.settings) {
    settings = { ...settings, ...stored.settings };
  }
}

// Listen for messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'sidebarOpened') {
    scheduleBulkGrouping()
      .catch(err => console.error('[bg] sidebarOpened bulk failed:', err))
      .finally(() => sendResponse({ done: true }));
    // Start YouTube polling. Wait for init so settings/sidebar state are loaded.
    initPromise.then(async () => {
      const windowId = sender.tab?.windowId ?? (await chrome.windows.getCurrent()).id;
      sidebarOpen.set(windowId, true);
      saveSidebarOpen();
      startYoutubePolling(windowId);
    });
    return true; // Keep message channel open for async response
  } else if (message.type === 'refreshAll') {
    scheduleBulkGrouping().catch(err => console.error('[bg] refreshAll failed:', err));
    sendResponse({ success: true });
    return true;
  } else if (message.type === 'getGroupType') {
    const groupId = message.groupId;
    if (groupId === -1 || groupId === undefined) {
      sendResponse({ groupType: 'none' });
    } else if (isAutoGroupId(groupId)) {
      sendResponse({ groupType: 'auto' });
    } else if (isManualGroupId(groupId)) {
      sendResponse({ groupType: 'manual' });
    } else {
      sendResponse({ groupType: 'none' });
    }
    return true;
  } else if (message.type === 'markManualGroup') {
    markAsManualGroup(message.groupId).then(() => sendResponse({ success: true }));
    return true;
  } else if (message.type === 'markAutoGroup') {
    markAsAutoGroup(message.groupId).then(() => sendResponse({ success: true }));
    return true;
  } else if (message.type === 'youtubeProgress') {
    // A progress poll often wakes the service worker, so wait for init before
    // reading settings — otherwise the update is dropped against defaults.
    initPromise.then(() => {
      if (!sender.tab || !settings.youtubeProgress) return;
      youtubeProgress.set(sender.tab.id, {
        progress: message.progress,
        videoId: message.videoId
      });
      saveYoutubeProgress();
      // Broadcast to all sidebars
      chrome.runtime.sendMessage({
        type: 'youtubeProgressUpdate',
        tabId: sender.tab.id,
        progress: message.progress,
        videoId: message.videoId
      }).catch(() => {});
    });
  } else if (message.type === 'getYoutubeProgress') {
    initPromise.then(() => sendResponse({ progress: Object.fromEntries(youtubeProgress) }));
    return true;
  } else if (message.type === 'youtubeContentScriptReady') {
    if (sender.tab) {
      const windowId = sender.tab.windowId;
      initPromise.then(() => sendResponse({ startPolling: shouldPollYoutube(windowId) }));
      return true;
    }
  }
});

// Listen for storage changes (backup method)
chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName === 'sync' && changes.settings) {
    const oldSettings = { ...settings };
    settings = { ...settings, ...changes.settings.newValue };
    await emitSettingsChanges(oldSettings, settings);

    // Handle youtubeProgress setting change - send to all YouTube tabs
    if (oldSettings.youtubeProgress !== settings.youtubeProgress) {
      const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
      for (const win of windows) {
        sendYoutubePollingControl(win.id, shouldPollYoutube(win.id));
      }
    }
  }
});

// Is any sidebar open? In all-windows mode a single sidebar renders tabs from
// every window, so one open sidebar is enough to keep every window polling.
function anySidebarOpen() {
  for (const open of sidebarOpen.values()) {
    if (open) return true;
  }
  return false;
}

// Should YouTube tabs in this window be polling right now?
function shouldPollYoutube(windowId) {
  if (!settings.youtubeProgress) return false;
  return settings.allWindows ? anySidebarOpen() : !!sidebarOpen.get(windowId);
}

// Start polling for the windows this sidebar covers.
async function startYoutubePolling(windowId) {
  if (!settings.allWindows) {
    await sendYoutubePollingControl(windowId, true);
    return;
  }
  const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
  for (const win of windows) {
    await sendYoutubePollingControl(win.id, true);
  }
}

// Stop polling now that this window's sidebar closed. In all-windows mode a
// remaining sidebar elsewhere still needs the data, so only stop when none left.
async function stopYoutubePolling(windowId) {
  if (settings.allWindows) {
    if (anySidebarOpen()) return;
    const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
    for (const win of windows) {
      await sendYoutubePollingControl(win.id, false);
    }
    return;
  }
  await sendYoutubePollingControl(windowId, false);
}

// Send YouTube polling control to all YouTube tabs in a window
async function sendYoutubePollingControl(windowId, start) {
  if (!settings.youtubeProgress && start) return;
  try {
    const tabs = await chrome.tabs.query({ windowId });
    for (const tab of tabs) {
      if (tab.url && tab.url.startsWith('https://www.youtube.com/')) {
        // Skip discarded tabs - they'll get injected when restored
        if (tab.discarded) continue;

        if (start) {
          // Try to inject content script if not already running
          try {
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              files: ['dist/content/youtube-progress.js']
            });
          } catch {
            // Script may already be injected or tab not accessible
          }
        }
        chrome.tabs.sendMessage(tab.id, {
          type: start ? 'startYoutubePolling' : 'stopYoutubePolling'
        }).catch(() => {});
      }
    }
  } catch {
    // Ignore errors
  }
}

// Toggle side panel when extension icon is clicked
chrome.action.onClicked.addListener(async (tab) => {
  const windowId = tab.windowId;
  const isOpen = sidebarOpen.get(windowId) || false;

  if (isOpen) {
    await initPromise;
    await chrome.storage.session.remove('ghostGroups');
    // Close sidebar for this window only by disabling/re-enabling for this tab
    await chrome.sidePanel.setOptions({ tabId: tab.id, enabled: false });
    await chrome.sidePanel.setOptions({ tabId: tab.id, enabled: true, path: 'sidebar.html' });
    sidebarOpen.set(windowId, false);
    saveSidebarOpen();
    // Stop YouTube polling
    stopYoutubePolling(windowId);
  } else {
    // Must be the first await in this handler: sidePanel.open() is only allowed
    // while the click's user gesture is still active.
    await chrome.sidePanel.open({ windowId });
    await initPromise;
    sidebarOpen.set(windowId, true);
    saveSidebarOpen();
    // Start YouTube polling
    startYoutubePolling(windowId);
  }
});

// Update badge with tab count
// If windowId provided, only update that window's badge
async function updateBadge(windowId) {
  chrome.action.setBadgeBackgroundColor({ color: '#6366f1' });

  if (settings.allWindows) {
    // Show total count across all windows
    const allTabs = await chrome.tabs.query({});
    const count = allTabs.length.toString();

    if (windowId) {
      // Only update tabs in specified window
      const windowTabs = allTabs.filter(t => t.windowId === windowId);
      for (const tab of windowTabs) {
        chrome.action.setBadgeText({ text: count, tabId: tab.id });
      }
    } else {
      // Update all tabs
      chrome.action.setBadgeText({ text: count });
      for (const tab of allTabs) {
        chrome.action.setBadgeText({ text: count, tabId: tab.id });
      }
    }
  } else {
    if (windowId) {
      // Only update specified window
      const tabs = await chrome.tabs.query({ windowId });
      const [activeTab] = await chrome.tabs.query({ windowId, active: true });
      if (activeTab) {
        chrome.action.setBadgeText({ text: tabs.length.toString(), tabId: activeTab.id });
      }
    } else {
      // Update all windows
      const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
      for (const win of windows) {
        const tabs = await chrome.tabs.query({ windowId: win.id });
        const [activeTab] = await chrome.tabs.query({ windowId: win.id, active: true });
        if (activeTab) {
          chrome.action.setBadgeText({ text: tabs.length.toString(), tabId: activeTab.id });
        }
      }
    }
  }
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

// Find any group (regardless of how it was created) in another window that
// already contains a tab with this domain. Used as a fusion-wide fallback so
// new same-domain tabs in other windows can adopt the existing group's name.
async function findGroupContainingDomainAnyWindow(domain, excludeWindowId) {
  const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
  for (const win of windows) {
    if (win.id === excludeWindowId) continue;
    const groups = await chrome.tabGroups.query({ windowId: win.id });
    for (const group of groups) {
      const tabs = await chrome.tabs.query({ groupId: group.id });
      if (tabs.some((t) => getDomain(t.url) === domain)) return group;
    }
  }
  return null;
}

// Find an auto-created group for this domain in any window other than excludeWindowId.
async function findAutoGroupForDomainAnyWindow(domain, excludeWindowId) {
  const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
  for (const win of windows) {
    if (win.id === excludeWindowId) continue;
    const group = await findAutoGroupForDomain(win.id, domain);
    if (group) return group;
  }
  return null;
}

// Find existing auto-created group for domain (by title, then by tab content)
async function findAutoGroupForDomain(windowId, domain) {
  const expectedTitle = getShortName(domain).toLowerCase();
  const groups = await chrome.tabGroups.query({ windowId });
  // First: match by title (case-insensitive)
  const byTitle = groups.find(g => g.title?.toLowerCase() === expectedTitle);
  if (byTitle) return byTitle;
  // Fallback: find a group where all tabs share this domain (catches unnamed/renamed groups)
  for (const group of groups) {
    if (isManualGroupId(group.id)) continue;
    const tabs = await chrome.tabs.query({ groupId: group.id });
    if (tabs.length === 0) continue;
    if (tabs.every(t => getDomain(t.url) === domain)) {
      return group;
    }
  }
  return null;
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
  await initPromise;
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

  // 1. Check custom groups first (highest priority - even overrides manual groups)
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

  // Skip tabs in manual groups (but only after custom group check above)
  if (currentTab.groupId !== -1 && isManualGroupId(currentTab.groupId)) {
    return;
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

    // Fusion: if a sibling auto-group exists in another window, create a
    // matching single-tab group here so the fused view links them.
    if (settings.allWindows && settings.fuseGroups) {
      const sibling = await findAutoGroupForDomainAnyWindow(domain, currentTab.windowId);
      if (sibling) {
        const groupId = await chrome.tabs.group({ tabIds: currentTab.id });
        await chrome.tabGroups.update(groupId, { title: sibling.title, color: sibling.color });
        await markAsAutoGroup(groupId);
        return;
      }
    }

    // No existing auto group - check if we can create one (2+ tabs with same domain)
    // Include ungrouped tabs and tabs in non-manual groups with same domain
    const allTabs = await chrome.tabs.query({ windowId: currentTab.windowId });
    const sameDomainTabs = allTabs.filter(t =>
      t.id !== currentTab.id &&
      (t.groupId === -1 || !isManualGroupId(t.groupId)) &&
      getDomain(t.url) === domain
    );

    if (sameDomainTabs.length >= 1) {
      // 2+ tabs - create new auto group
      const tabIds = [currentTab.id, ...sameDomainTabs.map(t => t.id)];
      const groupId = await chrome.tabs.group({ tabIds });
      const color = await getNextAvailableColor(currentTab.windowId);
      await chrome.tabGroups.update(groupId, { title: getShortName(domain), color });
      await markAsAutoGroup(groupId);
      return;
    }
  }

  // 3. Tab doesn't fit custom or auto groups
  if (currentTab.groupId !== -1) {
    const groupId = currentTab.groupId;

    // Never ungroup tabs from manually protected groups (e.g., woken from sleep)
    if (isManualGroupId(groupId)) {
      return;
    }

    // Check if OTHER tabs (excluding this one) all share same domain
    const groupTabs = await chrome.tabs.query({ groupId });
    const otherTabs = groupTabs.filter(t => t.id !== currentTab.id);

    if (otherTabs.length > 0) {
      const otherDomains = new Set(otherTabs.map(t => getDomain(t.url)));

      if (otherDomains.size > 1) {
        // Other tabs have mixed domains - this is a manual group
        // User intentionally put mismatched tabs together, respect that
        await unmarkAutoGroup(groupId);
        return; // Don't ungroup, keep tab in place
      }

      // Tab matches the group's domain - keep it in place
      if (otherDomains.has(domain)) {
        return;
      }
    }

    // Tab doesn't match the group - ungroup it
    await chrome.tabs.ungroup(currentTab.id);

    // Re-evaluate the group status (might become valid auto again)
    if (otherTabs.length >= 2) {
      await checkAndUpdateGroupStatus(groupId);
    }
  }

  // 4. Fusion-wide fallback: if the tab is still ungrouped and some group in
  // another window already contains a tab with this domain (manual, renamed,
  // or custom-without-pattern), mirror that group's title+color here so the
  // fused view picks them up together.
  if (settings.allWindows && settings.fuseGroups) {
    let latest;
    try { latest = await chrome.tabs.get(currentTab.id); } catch { return; }
    if (latest.groupId !== -1) return;

    const otherGroup = await findGroupContainingDomainAnyWindow(domain, latest.windowId);
    if (!otherGroup) return;

    const existingHere = await findGroupByTitleAndColor(latest.windowId, otherGroup.title, otherGroup.color);
    if (existingHere) {
      await chrome.tabs.group({ tabIds: latest.id, groupId: existingHere.id });
    } else {
      const newGroupId = await chrome.tabs.group({ tabIds: latest.id });
      await chrome.tabGroups.update(newGroupId, { title: otherGroup.title, color: otherGroup.color });
    }
  }
}

// Apply auto-grouping to all ungrouped tabs
async function applyAutoGroupingToAll() {
  await initPromise;
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

  // Re-classify existing groups that look like auto groups (e.g., after browser restart)
  for (const group of groups) {
    if (!isAutoGroupId(group.id) && !isManualGroupId(group.id)) {
      await checkAndUpdateGroupStatus(group.id);
    }
  }

  // Find "Other" group and identify custom groups by title
  const otherGroup = groups.find(g => g.title === settings.otherGroupName && g.color === 'grey');
  const otherGroupId = otherGroup?.id;
  if (otherGroupId) await markAsAutoGroup(otherGroupId);
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
      const existingGroup = groups.find(g => g.title?.toLowerCase() === getShortName(domain).toLowerCase());
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
      // Skip tabs already in custom groups or manual groups
      if (tab.groupId !== -1 && tab.groupId !== otherGroupId && customGroupIds.has(tab.groupId)) continue;
      if (tab.groupId !== -1 && isManualGroupId(tab.groupId)) continue;
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
      // Only ungrouped and "Other" tabs, skip manual groups
      if (tab.groupId !== -1 && tab.groupId !== otherGroupId) continue;
      if (tab.groupId !== -1 && isManualGroupId(tab.groupId)) continue;
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
        // Re-mark as auto (may have lost tracking after restart)
        if (!isAutoGroupId(existingGroup.id)) {
          await markAsAutoGroup(existingGroup.id);
        }
        // Restore title if lost after crash/restart
        if (existingGroup.title?.toLowerCase() !== displayName.toLowerCase()) {
          await chrome.tabGroups.update(existingGroup.id, { title: displayName });
        }
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
        await markAsAutoGroup(groupId);
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

// Window focus change still handled directly (not via bus)
chrome.windows.onFocusChanged.addListener(updateBadge);

// Periodic check for auto-ordering
setInterval(() => {
  if (settings.autoOrdering) {
    chrome.tabs.query({ active: true, currentWindow: true }).then(tabs => {
      if (tabs[0]) checkAutoOrdering(tabs[0].id);
    });
  }
}, AUTO_ORDERING_CHECK_INTERVAL_MS);

// Recover group names and tracking after browser restart/crash
// Session storage is wiped, so we re-classify all existing groups
async function recoverGroups() {
  const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
  for (const win of windows) {
    const groups = await chrome.tabGroups.query({ windowId: win.id });
    for (const group of groups) {
      if (!isAutoGroupId(group.id) && !isManualGroupId(group.id)) {
        await checkAndUpdateGroupStatus(group.id);
      }
    }
  }
}

async function seedWindowLabels() {
  const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
  await ensureLabelsForWindows(windows.map((w) => w.id));
}

// Initial setup
async function init() {
  await loadSettings();
  await loadAutoGroupIds();
  await loadManualGroupIds();
  await loadYoutubeProgress();
  await loadSidebarOpen();
  await seedWindowLabels();
  updateBadge();
  await recoverGroups();
}

const initPromise = init();

// Ensure badge is set on browser startup and extension install/update
chrome.runtime.onStartup.addListener(() => initPromise.then(() => updateBadge()));
chrome.runtime.onInstalled.addListener(() => initPromise.then(() => updateBadge()));

// --- Settings Event Handlers ---
bus.on('settings:allWindows', (newVal, oldVal, ctx) => updateBadge(ctx?.windowId));

bus.on('settings:autoGrouping', async (newValue) => {
  if (newValue) await scheduleBulkGrouping();
});

bus.on('settings:customGrouping', async (newValue) => {
  if (newValue) await scheduleBulkGrouping();
});

bus.on('settings:customGroups', async () => {
  if (settings.customGrouping) {
    await scheduleBulkGrouping();
  }
});

// --- Tab Event Handlers ---
bus.on('tab:created', (tab) => updateBadge(settings.allWindows ? undefined : tab.windowId));
bus.on('tab:removed', (tabId, removeInfo) => updateBadge(settings.allWindows ? undefined : removeInfo.windowId));
bus.on('tab:removed', (tabId) => tabActivationTimes.delete(tabId));
bus.on('tab:removed', (tabId) => {
  if (youtubeProgress.delete(tabId)) saveYoutubeProgress();
});

bus.on('tab:activated', async (activeInfo) => {
  if (!settings.allWindows) {
    const tabs = await chrome.tabs.query({ windowId: activeInfo.windowId });
    chrome.action.setBadgeText({ text: tabs.length.toString(), tabId: activeInfo.tabId });
  }
  const tabs = await chrome.tabs.query({ windowId: activeInfo.windowId });
  for (const tab of tabs) {
    if (tab.id !== activeInfo.tabId) checkAutoOrdering(tab.id);
  }
  tabActivationTimes.set(activeInfo.tabId, Date.now());
});

bus.on('tab:updated', async (tabId, changeInfo, tab) => {
  // Clear YouTube progress if tab navigates away from YouTube
  if (changeInfo.url && youtubeProgress.has(tabId)) {
    if (!changeInfo.url.startsWith('https://www.youtube.com/watch')) {
      youtubeProgress.delete(tabId);
      saveYoutubeProgress();
      chrome.runtime.sendMessage({
        type: 'youtubeProgressUpdate',
        tabId,
        progress: null,
        videoId: null
      }).catch(() => {});
    }
  }
  if (changeInfo.status !== 'complete') return;
  if (shouldSkipUrl(tab.url)) return;
  scheduleSingleTabGrouping(tab.id);
});

// --- Group Event Handlers ---
bus.on('group:removed', async (group) => { await removeGroupId(group.id); });

// --- Wire Chrome events to bus ---
chrome.tabs.onCreated.addListener((tab) => bus.emit('tab:created', tab));
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => bus.emit('tab:removed', tabId, removeInfo));
chrome.tabs.onActivated.addListener((info) => bus.emit('tab:activated', info));
chrome.tabs.onUpdated.addListener((id, info, tab) => bus.emit('tab:updated', id, info, tab));
chrome.tabGroups.onRemoved.addListener((group) => bus.emit('group:removed', group));

chrome.windows.onCreated.addListener(async (win) => {
  if (win.type !== 'normal') return;
  await ensureLabelsForWindows([win.id]);
}, { windowTypes: ['normal'] });

chrome.windows.onRemoved.addListener(async (windowId) => {
  await releaseLabelForWindow(windowId);
});
