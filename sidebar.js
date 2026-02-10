import { getColorHex } from './lib/colors.js';
import { GHOST_COUNTDOWN_INTERVAL_MS, SIDEBAR_INIT_DELAY_MS } from './lib/constants.js';
import { calculateTargetIndex, getDropPosition } from './lib/drag-position.js';
import { GHOST_GROUP_SECONDS, createGhostEntry, filterExpiredGhosts, getGhostRemainingSeconds } from './lib/ghost.js';
import { createSleepingGroupEntry, isValidSleepingGroup, canSleepGroup } from './lib/sleep.js';
import { loadFromStorage, saveToStorage } from './lib/storage.js';

const tabListEl = document.getElementById('tab-list');
const tabCountEl = document.getElementById('tab-count');
const settingsBtn = document.getElementById('settings-btn');
const collapseAllBtn = document.getElementById('collapse-all-btn');
const expandAllBtn = document.getElementById('expand-all-btn');
const contextMenu = document.getElementById('context-menu');
const moveToGroupSubmenu = document.getElementById('move-to-group-submenu');
const ungroupOption = document.getElementById('ungroup-option');

// Settings state
let allWindows = false;
let otherGroupName = 'Other';
let youtubeProgressEnabled = false;

// YouTube progress tracking: tabId -> { progress, videoId }
const youtubeProgress = new Map();

// Load settings from storage
async function loadSettings() {
  const stored = await chrome.storage.sync.get('settings');
  if (stored.settings) {
    allWindows = stored.settings.allWindows || false;
    otherGroupName = stored.settings.otherGroupName || 'Other';
    youtubeProgressEnabled = stored.settings.youtubeProgress || false;
  }
}

// Load initial YouTube progress from background
async function loadYoutubeProgress() {
  if (!youtubeProgressEnabled) return;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'getYoutubeProgress' });
    if (response && response.progress) {
      for (const [tabId, data] of Object.entries(response.progress)) {
        youtubeProgress.set(parseInt(tabId), data);
      }
    }
  } catch {
    // Ignore errors
  }
}

// Optimistic UI helpers
function removeTabElement(tabId) {
  const tabEl = document.querySelector(`[data-tab-id="${tabId}"]`);
  if (tabEl) {
    const groupContainer = tabEl.closest('.tab-group');
    tabEl.remove();
    updateHeaderTabCount(-1);
    // Update group tab count or remove empty group
    if (groupContainer) {
      const remainingTabs = groupContainer.querySelectorAll('.tab-item');
      const countEl = groupContainer.querySelector('.tab-count');
      if (remainingTabs.length === 0) {
        groupContainer.remove();
      } else if (countEl) {
        countEl.textContent = `(${remainingTabs.length})`;
      }
    }
  }
}

function removeGroupElement(groupId) {
  const groupEl = document.querySelector(`[data-group-id="${groupId}"]`);
  if (groupEl) {
    const tabCount = groupEl.querySelectorAll('.tab-item').length;
    groupEl.remove();
    updateHeaderTabCount(-tabCount);
  }
}

function updateHeaderTabCount(delta) {
  const current = parseInt(tabCountEl.textContent.replace(/[()]/g, '')) || 0;
  tabCountEl.textContent = `(${current + delta})`;
}

function scrollToTab(tabId) {
  const tabEl = document.querySelector(`[data-tab-id="${tabId}"]`);
  if (!tabEl) return;

  const groupContainer = tabEl.closest('.tab-group');
  const tabsContainer = groupContainer?.querySelector('.group-tabs');

  if (tabsContainer?.classList.contains('collapsed')) {
    const header = groupContainer?.querySelector('.group-header');
    header?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else {
    tabEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function moveTabToGroup(tabId, targetGroupId) {
  const tabEl = document.querySelector(`[data-tab-id="${tabId}"]`);
  if (!tabEl) return;

  const targetGroup = document.querySelector(`[data-group-id="${targetGroupId}"]`);
  if (!targetGroup) return;

  const sourceGroup = tabEl.closest('.tab-group');
  const targetTabsContainer = targetGroup.querySelector('.group-tabs');

  if (targetTabsContainer) {
    targetTabsContainer.appendChild(tabEl);

    // Update source group count
    if (sourceGroup) {
      const sourceRemaining = sourceGroup.querySelectorAll('.tab-item');
      const sourceCount = sourceGroup.querySelector('.tab-count');
      if (sourceRemaining.length === 0) {
        sourceGroup.remove();
      } else if (sourceCount) {
        sourceCount.textContent = `(${sourceRemaining.length})`;
      }
    }

    // Update target group count
    const targetCount = targetGroup.querySelector('.tab-count');
    if (targetCount) {
      const targetTabs = targetGroup.querySelectorAll('.tab-item');
      targetCount.textContent = `(${targetTabs.length})`;
    }

    // Scroll to the moved tab
    scrollToTab(tabId);
  }
}

// Selection state
let selectedTabIds = new Set();
let lastClickedTabId = null;

function clearSelection() {
  selectedTabIds.clear();
  document.querySelectorAll('.tab-item.selected').forEach(el => el.classList.remove('selected'));
}

function getOrderedTabIds() {
  return Array.from(document.querySelectorAll('.tab-item[data-tab-id]'))
    .map(el => parseInt(el.dataset.tabId));
}

// Context menu state
let contextMenuTabs = [];
// Settings button click handler
settingsBtn.addEventListener('click', () => {
  window.location.href = 'settings.html';
});

// Context menu functions
function hideContextMenu() {
  contextMenu.classList.remove('visible', 'expand-up');
  // Reset expanded submenu state
  const expandedItem = contextMenu.querySelector('.context-menu-has-submenu.expanded');
  if (expandedItem) {
    expandedItem.classList.remove('expanded');
  }
  contextMenuTabs = [];
}

async function showContextMenu(e, tab) {
  e.preventDefault();
  e.stopPropagation();

  // If right-clicked tab is in selection, act on all selected; otherwise just this tab
  if (selectedTabIds.has(tab.id)) {
    const ordered = getOrderedTabIds();
    contextMenuTabs = ordered.filter(id => selectedTabIds.has(id))
      .map(id => {
        const el = document.querySelector(`[data-tab-id="${id}"]`);
        return { id, groupId: parseInt(el?.closest('.tab-group')?.dataset.groupId) || -1 };
      });
  } else {
    clearSelection();
    contextMenuTabs = [tab];
  }

  // Show/hide ungroup option based on whether any tab is in a group
  const anyInGroup = contextMenuTabs.some(t => t.groupId !== -1 && !isNaN(t.groupId));
  ungroupOption.style.display = anyInGroup ? 'block' : 'none';

  // Populate move-to-group submenu
  await populateMoveToGroupSubmenu();

  // Reset position and classes for measurement
  contextMenu.style.left = '0px';
  contextMenu.style.top = '0px';
  contextMenu.classList.remove('expand-up');
  contextMenu.classList.add('visible');

  // Measure menu height
  const menuRect = contextMenu.getBoundingClientRect();
  const menuHeight = menuRect.height;

  // Estimate expanded height (submenu adds roughly 40px per group + 50px base)
  const groups = await chrome.tabGroups.query({ windowId: chrome.windows.WINDOW_ID_CURRENT });
  const submenuHeight = 50 + (groups.length * 36);
  const expandedHeight = menuHeight + submenuHeight;

  // Position horizontally
  let x = e.clientX;
  if (x + menuRect.width > window.innerWidth) {
    x = window.innerWidth - menuRect.width - 5;
  }

  // Position vertically - check if expanded menu would fit below
  let y = e.clientY;
  const spaceBelow = window.innerHeight - e.clientY;
  const spaceAbove = e.clientY;

  if (spaceBelow < expandedHeight && spaceAbove > spaceBelow) {
    // Not enough space below, position menu above click point
    y = Math.max(5, e.clientY - menuHeight);
    contextMenu.classList.add('expand-up');
  }

  contextMenu.style.left = `${x}px`;
  contextMenu.style.top = `${y}px`;
}

async function populateMoveToGroupSubmenu() {
  moveToGroupSubmenu.innerHTML = '';

  const groups = await chrome.tabGroups.query({ windowId: chrome.windows.WINDOW_ID_CURRENT });
  const tabIds = contextMenuTabs.map(t => t.id);

  const otherItem = document.createElement('div');
  otherItem.className = 'context-submenu-item';
  otherItem.innerHTML = `<span class="submenu-color-dot" style="background-color: ${getColorHex('grey')}"></span>${otherGroupName}`;
  otherItem.addEventListener('click', () => {
    if (contextMenuTabs.length > 0) {
      for (const t of contextMenuTabs) moveTabToGroup(t.id, 'ungrouped');
      hideContextMenu();
      chrome.tabs.ungroup(tabIds);
    }
  });
  moveToGroupSubmenu.appendChild(otherItem);

  // Add divider if there are groups
  if (groups.length > 0) {
    const divider = document.createElement('div');
    divider.className = 'context-menu-divider';
    moveToGroupSubmenu.appendChild(divider);
  }

  // Collect group IDs that ALL selected tabs share (skip those)
  const allInSameGroup = contextMenuTabs.length > 0 &&
    contextMenuTabs.every(t => t.groupId === contextMenuTabs[0].groupId);
  const skipGroupId = allInSameGroup ? contextMenuTabs[0].groupId : null;

  // Add each group
  for (const group of groups) {
    if (skipGroupId === group.id) continue;

    const item = document.createElement('div');
    item.className = 'context-submenu-item';
    item.innerHTML = `<span class="submenu-color-dot" style="background-color: ${getColorHex(group.color)}"></span>${group.title || 'Unnamed'}`;
    item.addEventListener('click', () => {
      if (contextMenuTabs.length > 0) {
        for (const t of contextMenuTabs) moveTabToGroup(t.id, group.id);
        hideContextMenu();
        chrome.tabs.group({ tabIds, groupId: group.id });
      }
    });
    moveToGroupSubmenu.appendChild(item);
  }

  // Add divider before new group input
  const newGroupDivider = document.createElement('div');
  newGroupDivider.className = 'context-menu-divider';
  moveToGroupSubmenu.appendChild(newGroupDivider);

  // Add new group input
  const newGroupItem = document.createElement('div');
  newGroupItem.className = 'context-submenu-item new-group-input-container';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'new-group-input';
  input.placeholder = 'New group...';
  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' && input.value.trim() && contextMenuTabs.length > 0) {
      const groupId = await chrome.tabs.group({ tabIds });
      await chrome.tabGroups.update(groupId, { title: input.value.trim() });
      hideContextMenu();
    } else if (e.key === 'Escape') {
      hideContextMenu();
    }
  });
  newGroupItem.appendChild(input);
  moveToGroupSubmenu.appendChild(newGroupItem);
}

async function handleContextMenuAction(action) {
  if (contextMenuTabs.length === 0) return;

  const tabIds = contextMenuTabs.map(t => t.id);
  const firstTab = contextMenuTabs[0];

  switch (action) {
    case 'new-tab':
      hideContextMenu();
      const newTab = await chrome.tabs.create({ active: true });
      if (firstTab.groupId !== -1) {
        await chrome.tabs.group({ tabIds: newTab.id, groupId: firstTab.groupId });
      }
      break;
    case 'duplicate':
      hideContextMenu();
      for (const id of tabIds) chrome.tabs.duplicate(id);
      break;
    case 'close':
      for (const id of tabIds) removeTabElement(id);
      hideContextMenu();
      for (const id of tabIds) {
        ghostGroups.delete(id);
      }
      saveGhostGroups();
      chrome.tabs.remove(tabIds);
      clearSelection();
      break;
    case 'ungroup':
      for (const id of tabIds) moveTabToGroup(id, 'ungrouped');
      hideContextMenu();
      chrome.tabs.ungroup(tabIds);
      break;
  }
}

// Context menu event listeners
contextMenu.addEventListener('click', (e) => {
  const item = e.target.closest('.context-menu-item');
  if (!item) return;

  // Handle submenu toggle
  if (item.classList.contains('context-menu-has-submenu')) {
    item.classList.toggle('expanded');
    return;
  }

  // Handle regular actions
  const action = item.dataset.action;
  if (action) {
    handleContextMenuAction(action);
  }
});

// Hide context menu and clear selection when clicking outside
document.addEventListener('click', (e) => {
  if (!contextMenu.contains(e.target)) {
    hideContextMenu();
  }
  if (!e.target.closest('.tab-item') && !contextMenu.contains(e.target)) {
    clearSelection();
  }
});

// Hide context menu on scroll
document.addEventListener('scroll', hideContextMenu);

// Escape clears selection and hides context menu
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    clearSelection();
    hideContextMenu();
  }
});

// Collapse all groups
collapseAllBtn.addEventListener('click', async () => {
  const groups = await chrome.tabGroups.query({ windowId: chrome.windows.WINDOW_ID_CURRENT });
  for (const group of groups) {
    if (!group.collapsed) {
      await chrome.tabGroups.update(group.id, { collapsed: true });
    }
  }
  // Also collapse "Other" section
  otherCollapsed = true;
  render('collapse-all', true);
});

// Expand all groups
expandAllBtn.addEventListener('click', async () => {
  const groups = await chrome.tabGroups.query({ windowId: chrome.windows.WINDOW_ID_CURRENT });
  for (const group of groups) {
    if (group.collapsed) {
      await chrome.tabGroups.update(group.id, { collapsed: false });
    }
  }
  // Also expand "Other" section
  otherCollapsed = false;
  render('expand-all', true);
});

// Drag and drop state for tabs (arrays to support multi-select drag)
let draggedTabs = [];       // array of { tabId, groupId }
let draggedElements = [];   // array of DOM elements, first = primary
let originalPositions = []; // array of { parent, nextSibling }
let isDragging = false;     // Prevents renders from rebuilding DOM mid-drag

// Drag and drop state for groups
let draggedGroup = null;
let draggedGroupElement = null;
let originalGroupNextSibling = null;

// Local collapse state for "Other" section (not a real Chrome group)
let otherCollapsed = false;

// Ghost groups: tabs that should appear in a fake group visually
// (either ungrouped by Chrome or moved to different group by Brave)
// tabId -> { title, color, expiresAt, originalGroupId, positionIndex }
// Persisted to chrome.storage.session to survive sidebar reloads
let ghostGroups = new Map();

// Sleeping groups: groups that have been "put to sleep" (tabs closed, saved for later)
// sleepId -> { id, title, color, tabs: [{url, title, favIconUrl}], sleepedAt, originalWindowId }
// Persisted to chrome.storage.local to survive browser restarts
let sleepingGroups = new Map();

// Track group memberships to detect 2→1 transitions
// groupId -> { tabs: Set<tabId>, title, color }
let groupMemberships = new Map();

// Load ghost groups from chrome.storage.session
async function loadGhostGroups() {
  const stored = await loadFromStorage('session', 'ghostGroups', []);
  ghostGroups = new Map(stored);
}

// Save ghost groups to chrome.storage.session
async function saveGhostGroups() {
  await saveToStorage('session', 'ghostGroups', [...ghostGroups.entries()]);
}

// Load sleeping groups from chrome.storage.local
async function loadSleepingGroups() {
  const stored = await loadFromStorage('local', 'sleepingGroups', []);
  sleepingGroups = new Map();
  for (const [id, entry] of stored) {
    if (isValidSleepingGroup(entry)) {
      sleepingGroups.set(id, entry);
    }
  }
}

// Save sleeping groups to chrome.storage.local
async function saveSleepingGroups() {
  await saveToStorage('local', 'sleepingGroups', [...sleepingGroups.entries()]);
}

// Sleep a group: save tabs and close them
async function sleepGroup(groupId, groupInfo) {
  // Query fresh tabs from Chrome to include any recently dragged-in tabs
  const tabs = await chrome.tabs.query({ groupId });
  if (tabs.length === 0) return;

  const windowId = tabs[0].windowId;

  const response = await chrome.runtime.sendMessage({ type: 'getGroupType', groupId });
  const groupType = response.groupType;

  const entry = createSleepingGroupEntry(groupInfo, tabs, windowId, groupType);

  sleepingGroups.set(entry.id, entry);
  await saveSleepingGroups();

  // Close all tabs (group auto-deletes when empty)
  const tabIds = tabs.map(t => t.id);
  await chrome.tabs.remove(tabIds);

  render('sleep-group');
}

// Wake a sleeping group: recreate tabs and group them
async function wakeGroup(sleepId) {
  const entry = sleepingGroups.get(sleepId);
  if (!entry) return;

  // Remove from sleeping groups first
  sleepingGroups.delete(sleepId);
  await saveSleepingGroups();

  // Create tabs from stored URLs
  const createdTabIds = [];
  for (const tabData of entry.tabs) {
    try {
      const tab = await chrome.tabs.create({ url: tabData.url, active: false });
      createdTabIds.push(tab.id);
    } catch (e) {
      console.error('Failed to create tab:', tabData.url, e);
    }
  }

  // Group the tabs and set title/color
  if (createdTabIds.length > 0) {
    try {
      const groupId = await chrome.tabs.group({ tabIds: createdTabIds });
      await chrome.tabGroups.update(groupId, {
        title: entry.title,
        color: entry.color
      });

      // Restore group type tracking
      const restoredType = entry.groupType || (entry.isManual ? 'manual' : 'none');
      if (restoredType === 'manual') {
        await chrome.runtime.sendMessage({ type: 'markManualGroup', groupId });
      } else if (restoredType === 'auto') {
        await chrome.runtime.sendMessage({ type: 'markAutoGroup', groupId });
      }
    } catch (e) {
      console.error('Failed to group woken tabs:', e);
    }
  }

  render('wake-group');
}

// Update group memberships and detect 2→1 transitions to create ghost groups
async function updateGroupMemberships() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const groups = await chrome.tabGroups.query({ windowId: chrome.windows.WINDOW_ID_CURRENT });

  // Build new membership map
  const newMemberships = new Map();
  for (const group of groups) {
    newMemberships.set(group.id, { tabs: new Set(), title: group.title, color: group.color });
  }
  for (const tab of tabs) {
    if (tab.groupId !== -1 && newMemberships.has(tab.groupId)) {
      newMemberships.get(tab.groupId).tabs.add(tab.id);
    }
  }

  // Check for 2→1 transitions (group that had 2+ now has 1)
  for (const [groupId, oldInfo] of groupMemberships) {
    const newInfo = newMemberships.get(groupId);
    if (oldInfo.tabs.size >= 2 && newInfo && newInfo.tabs.size === 1) {
      // Group went from 2+ to 1 - create ghost for remaining tab
      const remainingTabId = [...newInfo.tabs][0];
      if (!ghostGroups.has(remainingTabId)) {
        console.log('[sidebar] Creating ghost for tab', remainingTabId, 'from group', oldInfo.title);
        ghostGroups.set(remainingTabId, createGhostEntry({ id: groupId, title: oldInfo.title, color: oldInfo.color }, 0));
        saveGhostGroups();
      }
    }
  }

  // Also check for tabs that were in a group that no longer exists
  for (const [groupId, oldInfo] of groupMemberships) {
    if (!newMemberships.has(groupId) && oldInfo.tabs.size >= 2) {
      // Group was destroyed - check if any of its tabs are now ungrouped
      for (const tabId of oldInfo.tabs) {
        const tab = tabs.find(t => t.id === tabId);
        if (tab && tab.groupId === -1 && !ghostGroups.has(tabId)) {
          console.log('[sidebar] Creating ghost for orphaned tab', tabId, 'from dissolved group', oldInfo.title);
          ghostGroups.set(tabId, createGhostEntry({ id: groupId, title: oldInfo.title, color: oldInfo.color }, 0));
          saveGhostGroups();
        }
      }
    }
  }

  groupMemberships = newMemberships;
}

// Track render calls
let renderCount = 0;

// Pending tab ID to scroll to after render completes
let pendingScrollToTabId = null;



async function loadTabs() {
  // Query tabs based on window scope setting
  const queryOptions = allWindows ? {} : { currentWindow: true };
  const tabs = await chrome.tabs.query(queryOptions);
  const currentWindowId = (await chrome.windows.getCurrent()).id;

  // Get groups from all windows or current window
  const groups = allWindows
    ? await chrome.tabGroups.query({})
    : await chrome.tabGroups.query({ windowId: currentWindowId });

  const groupMap = new Map();
  groups.forEach(group => {
    groupMap.set(group.id, group);
  });

  const groupedTabs = new Map();
  const ungroupedTabs = [];
  const ghostTabs = []; // Tabs that should appear in ghost groups
  const groupOrder = []; // Track order groups appear (for position tracking)

  // Clean up expired ghost groups and ungroup their tabs
  const { validGhosts, hadExpired } = filterExpiredGhosts(ghostGroups);
  if (hadExpired) {
    const expiredTabIds = [];
    for (const [tabId] of ghostGroups) {
      if (!validGhosts.has(tabId)) expiredTabIds.push(tabId);
    }
    ghostGroups = validGhosts;
    saveGhostGroups();
    for (const tabId of expiredTabIds) {
      try { await chrome.tabs.ungroup(tabId); } catch { /* already ungrouped */ }
    }
  }

  for (const tab of tabs) {
    const ghost = ghostGroups.get(tab.id);

    if (ghost) {
      // Tab has a ghost entry - always show as ghost (whether ungrouped, in original group, or moved)
      ghostTabs.push(tab);
    } else if (tab.groupId === -1) {
      // Tab is ungrouped with no ghost entry
      ungroupedTabs.push(tab);
    } else {
      // Tab is in a group with no ghost entry - show normally
      if (!groupedTabs.has(tab.groupId)) {
        groupedTabs.set(tab.groupId, []);
        groupOrder.push(tab.groupId); // Track order of first appearance
      }
      groupedTabs.get(tab.groupId).push(tab);
    }
  }

  return { groupedTabs, ungroupedTabs, ghostTabs, groupMap, groupOrder, windowId: currentWindowId };
}

// Use getColorHex from shared.js
function getGroupColor(group) {
  return getColorHex(group.color);
}

function createTabElement(tab, groupInfo, onClose) {
  const div = document.createElement('div');
  div.className = 'tab-item' + (tab.active ? ' active' : '');
  div.dataset.tabId = tab.id;
  div.draggable = true;

  // Drag start
  div.addEventListener('dragstart', (e) => {
    isDragging = true;
    e.dataTransfer.effectAllowed = 'move';
    e.stopPropagation();

    if (selectedTabIds.has(tab.id) && selectedTabIds.size >= 2) {
      // Multi-select drag: collect all selected elements in DOM order
      const ordered = getOrderedTabIds().filter(id => selectedTabIds.has(id));
      const elements = ordered.map(id => document.querySelector(`[data-tab-id="${id}"]`)).filter(Boolean);

      // Primary = the element being dragged (move to front)
      const primaryIdx = elements.indexOf(div);
      if (primaryIdx > 0) {
        elements.splice(primaryIdx, 1);
        elements.unshift(div);
      }

      draggedTabs = elements.map(el => ({
        tabId: parseInt(el.dataset.tabId),
        groupId: parseInt(el.closest('.tab-group')?.dataset.groupId) || -1
      }));
      draggedElements = elements;
      originalPositions = [{ parent: div.parentNode, nextSibling: div.nextSibling }];

      div.classList.add('dragging');

      // Create drag badge showing count
      const badge = document.createElement('div');
      badge.className = 'drag-badge';
      badge.textContent = `${draggedElements.length}`;
      document.body.appendChild(badge);
      e.dataTransfer.setDragImage(badge, 0, 0);
      requestAnimationFrame(() => badge.remove());
    } else {
      // Single-tab drag
      draggedTabs = [{ tabId: tab.id, groupId: tab.groupId }];
      draggedElements = [div];
      originalPositions = [{ parent: div.parentNode, nextSibling: div.nextSibling }];
      div.classList.add('dragging');
    }

    e.dataTransfer.setData('text/plain', tab.id.toString());
  });

  // Drag end - commit the move
  div.addEventListener('dragend', async () => {
    div.classList.remove('dragging');
    // Keep isDragging true until all async operations complete

    if (draggedTabs.length > 0 && draggedElements.length > 0) {
      const primaryElement = draggedElements[0];
      const primaryTab = draggedTabs[0];
      const primaryOriginal = originalPositions[0];
      const currentParent = primaryElement.parentNode;
      const movedToNewPosition = currentParent !== primaryOriginal.parent || primaryElement.nextSibling !== primaryOriginal.nextSibling;

      if (movedToNewPosition) {
        const targetGroupContainer = currentParent.closest('.tab-group');
        const targetGroupId = targetGroupContainer?.dataset.groupId;

        const allTabIds = draggedTabs.map(t => t.tabId);

        const nextTab = primaryElement.nextElementSibling;
        const prevTab = primaryElement.previousElementSibling;
        const nextTabId = nextTab?.dataset?.tabId ? parseInt(nextTab.dataset.tabId) : null;
        const prevTabId = prevTab?.dataset?.tabId ? parseInt(prevTab.dataset.tabId) : null;

        try {
          // Clear ghost status for any dragged ghost tabs
          for (const tabId of allTabIds) {
            if (ghostGroups.has(tabId)) {
              ghostGroups.delete(tabId);
            }
          }
          saveGhostGroups();

          // Sort selected tabs by current index to preserve relative order
          const tabsWithIndex = await Promise.all(allTabIds.map(async id => ({
            id,
            index: (await chrome.tabs.get(id)).index
          })));
          tabsWithIndex.sort((a, b) => a.index - b.index);
          const sortedIds = tabsWithIndex.map(t => t.id);
          const allTabIdSet = new Set(allTabIds);

          // Find the non-selected anchor tab at drop position
          let anchorNext = primaryElement.nextElementSibling;
          while (anchorNext && allTabIdSet.has(parseInt(anchorNext.dataset?.tabId))) {
            anchorNext = anchorNext.nextElementSibling;
          }
          let anchorPrev = primaryElement.previousElementSibling;
          while (anchorPrev && allTabIdSet.has(parseInt(anchorPrev.dataset?.tabId))) {
            anchorPrev = anchorPrev.previousElementSibling;
          }

          // Get anchor tab ID for position reference
          const anchorNextId = anchorNext?.dataset?.tabId ? parseInt(anchorNext.dataset.tabId) : null;
          const anchorPrevId = anchorPrev?.dataset?.tabId ? parseInt(anchorPrev.dataset.tabId) : null;

          // Move tabs one at a time, adjusting for index shifts
          for (const tabId of sortedIds) {
            const currentTab = await chrome.tabs.get(tabId);
            let insertIndex;

            if (anchorNextId) {
              // Insert before anchor - account for shift if we're removing from before it
              const anchorTab = await chrome.tabs.get(anchorNextId);
              insertIndex = anchorTab.index;
              if (currentTab.index < anchorTab.index) {
                insertIndex -= 1;
              }
            } else if (anchorPrevId) {
              // Insert after anchor
              const anchorTab = await chrome.tabs.get(anchorPrevId);
              insertIndex = anchorTab.index + 1;
              if (currentTab.index < anchorTab.index) {
                insertIndex -= 1;
              }
            } else {
              insertIndex = 0;
            }

            await chrome.tabs.move(tabId, { index: insertIndex });
          }

          // 2. Then handle grouping
          if (targetGroupId === 'ungrouped') {
            await chrome.tabs.ungroup(sortedIds);
          } else if (targetGroupId && targetGroupId.startsWith('ghost-')) {
            const ghostTabId = parseInt(targetGroupId.replace('ghost-', ''));
            const ghost = ghostGroups.get(ghostTabId);
            if (ghost) {
              const tabIds = [ghostTabId, ...sortedIds];
              const newGroupId = await chrome.tabs.group({ tabIds });
              await chrome.tabGroups.update(newGroupId, {
                title: ghost.title,
                color: ghost.color
              });
              await chrome.runtime.sendMessage({ type: 'markManualGroup', groupId: newGroupId });
              ghostGroups.delete(ghostTabId);
              saveGhostGroups();
            }
          } else if (targetGroupId) {
            const groupIdNum = parseInt(targetGroupId);
            if (!isNaN(groupIdNum)) {
              const tabsToGroup = sortedIds.filter((id, i) => {
                const origIdx = allTabIds.indexOf(id);
                return origIdx === -1 || draggedTabs[origIdx].groupId !== groupIdNum;
              });
              if (tabsToGroup.length > 0) {
                await chrome.tabs.group({ tabIds: tabsToGroup, groupId: groupIdNum });
              }
              await chrome.runtime.sendMessage({ type: 'markManualGroup', groupId: groupIdNum });
            }
          }

          render('tab-drag-complete');
        } catch (err) {
          console.error('Failed to move tab(s):', err, 'targetGroupId:', targetGroupId, 'allTabIds:', allTabIds);
          // Revert primary to original position
          const orig = primaryOriginal;
          if (orig.parent && document.contains(orig.parent)) {
            try {
              orig.parent.insertBefore(primaryElement, orig.nextSibling);
            } catch (e) {
              // DOM may have changed, ignore
            }
          }
        }
      }
    }

    isDragging = false; // Re-enable renders after all async operations complete
    draggedTabs = [];
    draggedElements = [];
    originalPositions = [];
  });

  // Drag over - move element to show preview
  div.addEventListener('dragover', (e) => {
    e.preventDefault();
    const primary = draggedElements[0];
    if (primary && primary !== div) {
      const rect = div.getBoundingClientRect();
      const position = getDropPosition(e.clientY, rect.top, rect.height);
      const parent = div.parentNode;

      if (position === 'before') {
        parent.insertBefore(primary, div);
      } else {
        parent.insertBefore(primary, div.nextSibling);
      }
    }
  });

  div.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  const closeBtn = document.createElement('button');
  closeBtn.className = 'close-btn';
  closeBtn.innerHTML = '&times;';
  closeBtn.title = 'Close tab';
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();

    if (onClose) {
      onClose();
    }

    removeTabElement(tab.id);
    ghostGroups.delete(tab.id);
    saveGhostGroups();
    chrome.tabs.remove(tab.id);
  });

  // Favicon wrapper for audio indicator overlay
  const faviconWrapper = document.createElement('div');
  faviconWrapper.className = 'favicon-wrapper';

  const favicon = document.createElement('img');
  favicon.className = 'favicon';
  if (tab.favIconUrl && !tab.favIconUrl.startsWith('chrome://')) {
    favicon.src = tab.favIconUrl;
  } else {
    favicon.className = 'favicon placeholder';
  }
  favicon.onerror = () => {
    favicon.className = 'favicon placeholder';
    favicon.dataset.failedSrc = favicon.getAttribute('src') || '';
    favicon.removeAttribute('src');
  };
  faviconWrapper.appendChild(favicon);

  // Audio indicator overlaid on favicon
  if (tab.audible) {
    const audioIcon = document.createElement('span');
    audioIcon.className = 'audio-indicator';
    audioIcon.textContent = '🔊';
    audioIcon.title = 'Playing audio';
    faviconWrapper.appendChild(audioIcon);
  }

  const title = document.createElement('span');
  title.className = 'tab-title';
  title.textContent = tab.title || tab.url || 'New Tab';
  title.title = tab.title || tab.url || 'New Tab';

  div.appendChild(closeBtn);
  div.appendChild(faviconWrapper);
  div.appendChild(title);

  // YouTube progress bar
  if (youtubeProgressEnabled && tab.url && tab.url.startsWith('https://www.youtube.com/watch')) {
    const progressData = youtubeProgress.get(tab.id);
    if (progressData && progressData.progress != null) {
      const progressBar = document.createElement('div');
      progressBar.className = 'youtube-progress-bar';
      const progressFill = document.createElement('div');
      progressFill.className = 'youtube-progress-fill';
      progressFill.style.width = `${progressData.progress}%`;
      progressBar.appendChild(progressFill);
      div.appendChild(progressBar);
    }
  }

  div.addEventListener('click', (e) => {
    if (e.ctrlKey || e.metaKey) {
      // Ctrl/Cmd+click: toggle individual tab selection
      if (selectedTabIds.has(tab.id)) {
        selectedTabIds.delete(tab.id);
        div.classList.remove('selected');
      } else {
        selectedTabIds.add(tab.id);
        div.classList.add('selected');
      }
      lastClickedTabId = tab.id;
    } else if (e.shiftKey && lastClickedTabId !== null) {
      // Shift+click: range selection
      const ordered = getOrderedTabIds();
      const fromIdx = ordered.indexOf(lastClickedTabId);
      const toIdx = ordered.indexOf(tab.id);
      if (fromIdx !== -1 && toIdx !== -1) {
        const start = Math.min(fromIdx, toIdx);
        const end = Math.max(fromIdx, toIdx);
        const rangeIds = new Set(ordered.slice(start, end + 1));
        selectedTabIds = rangeIds;
        document.querySelectorAll('.tab-item.selected').forEach(el => el.classList.remove('selected'));
        for (const id of rangeIds) {
          document.querySelector(`[data-tab-id="${id}"]`)?.classList.add('selected');
        }
      }
    } else {
      // Plain click: clear selection, activate tab
      clearSelection();
      lastClickedTabId = tab.id;
      chrome.tabs.update(tab.id, { active: true });
    }
  });

  // Right-click context menu
  div.addEventListener('contextmenu', (e) => {
    showContextMenu(e, tab);
  });

  return div;
}

// Setup drag handlers for a group container
function setupGroupDragHandlers(container, groupId, tabs, groupInfo) {
  container.addEventListener('dragstart', (e) => {
    if (e.target.classList.contains('tab-item')) return;
    isDragging = true;

    draggedGroup = {
      groupId,
      tabs: tabs.map(t => t.id),
      title: groupInfo?.title || '',
      color: groupInfo?.color || 'blue'
    };
    draggedGroupElement = container;
    originalGroupNextSibling = container.nextSibling;

    container.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', `group-${groupId}`);
  });

  container.addEventListener('dragend', async () => {
    container.classList.remove('dragging');
    isDragging = false;

    if (draggedGroup && draggedGroupElement) {
      const movedToNewPosition = draggedGroupElement.nextSibling !== originalGroupNextSibling;
      const numericGroupId = parseInt(draggedGroup.groupId);
      const isRealGroup = !isNaN(numericGroupId) && numericGroupId > 0;

      if (movedToNewPosition && isRealGroup) {
        await commitGroupMove(numericGroupId);
      }
    }

    draggedGroup = null;
    draggedGroupElement = null;
    originalGroupNextSibling = null;
  });

  container.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (draggedGroupElement && draggedGroupElement !== container && draggedTabs.length === 0) {
      const rect = container.getBoundingClientRect();
      const position = getDropPosition(e.clientY, rect.top, rect.height);

      if (position === 'before') {
        tabListEl.insertBefore(draggedGroupElement, container);
      } else {
        tabListEl.insertBefore(draggedGroupElement, container.nextSibling);
      }
    } else if (draggedTabs.length > 0 && draggedElements[0]) {
      // Tab dragged over group header/container — insert into this group's tab list
      const primary = draggedElements[0];
      const groupTabs = container.querySelector('.group-tabs');
      if (groupTabs && !groupTabs.contains(primary)) {
        groupTabs.appendChild(primary);
      }
    }
  });
}

// Commit a group move after drag ends
async function commitGroupMove(numericGroupId) {
  const nextGroup = draggedGroupElement.nextElementSibling;
  const prevGroup = draggedGroupElement.previousElementSibling;

  try {
    const groupTabs = await chrome.tabs.query({ groupId: numericGroupId });
    const sortedTabs = groupTabs.sort((a, b) => a.index - b.index);
    const tabIds = sortedTabs.map(t => t.id);

    if (tabIds.length > 0) {
      const currentIndex = sortedTabs[0].index;
      const nextTabIndex = await getFirstTabIndexOfGroup(nextGroup);
      const prevTabIndex = await getLastTabIndexOfGroup(prevGroup);

      const targetIndex = calculateTargetIndex(currentIndex, nextTabIndex, prevTabIndex, tabIds.length);

      if (targetIndex !== null) {
        await chrome.tabs.move(tabIds, { index: targetIndex });

        try {
          await chrome.tabs.group({ tabIds, groupId: numericGroupId });
        } catch (e) {
          const newGroupId = await chrome.tabs.group({ tabIds });
          await chrome.tabGroups.update(newGroupId, {
            title: draggedGroup.title,
            color: draggedGroup.color
          });
        }
      }
    }

    render('group-drag-complete');
  } catch (err) {
    console.error('Failed to move group:', err);
    // Only revert if elements are still in document
    if (draggedGroupElement && document.contains(draggedGroupElement)) {
      try {
        if (originalGroupNextSibling && document.contains(originalGroupNextSibling)) {
          tabListEl.insertBefore(draggedGroupElement, originalGroupNextSibling);
        } else {
          tabListEl.appendChild(draggedGroupElement);
        }
      } catch (e) {
        // DOM may have changed, ignore
      }
    }
  }
}

// Get first tab index of a group element
async function getFirstTabIndexOfGroup(groupEl) {
  if (!groupEl?.dataset?.groupId) return null;
  const groupTabs = groupEl.querySelectorAll('.tab-item');
  if (groupTabs.length > 0) {
    const tabId = parseInt(groupTabs[0].dataset.tabId);
    const tab = await chrome.tabs.get(tabId);
    return tab.index;
  }
  return null;
}

// Get last tab index of a group element
async function getLastTabIndexOfGroup(groupEl) {
  if (!groupEl?.dataset?.groupId) return null;
  const groupTabs = groupEl.querySelectorAll('.tab-item');
  if (groupTabs.length > 0) {
    const tabId = parseInt(groupTabs[groupTabs.length - 1].dataset.tabId);
    const tab = await chrome.tabs.get(tabId);
    return tab.index;
  }
  return null;
}

// Create the header element for a group
function createGroupHeader(groupInfo, isGhost, isUngrouped, ghostExpiresAt, tabs, groupId, isSleeping = false, sleepId = null, groupType = 'none') {
  const isCollapsed = groupInfo?.collapsed || false;
  const header = document.createElement('div');
  header.className = 'group-header' + (isCollapsed ? ' collapsed' : '');

  if (isGhost && groupInfo) {
    header.style.borderLeftColor = getColorHex(groupInfo.color);
  } else if (isSleeping && groupInfo) {
    header.style.borderLeftColor = getColorHex(groupInfo.color);
  } else {
    header.style.borderLeftColor = groupInfo ? getGroupColor(groupInfo) : '#888';
  }

  const collapseIcon = document.createElement('span');
  collapseIcon.className = 'collapse-icon';
  collapseIcon.textContent = '\u25BC';

  const groupName = document.createElement('span');
  groupName.className = 'group-name';
  if (isGhost && groupInfo) {
    groupName.textContent = groupInfo.title || 'Unnamed Group';
  } else if (isSleeping && groupInfo) {
    groupName.textContent = groupInfo.title || 'Unnamed Group';
  } else {
    groupName.textContent = groupInfo ? (groupInfo.title || 'Unnamed Group') : 'Ungrouped';
  }

  // Double-click group name to rename
  groupName.addEventListener('dblclick', (e) => {
    if (e.target.closest('.manual-badge')) return;
    e.stopPropagation();

    const currentTitle = isUngrouped ? otherGroupName : (groupInfo?.title || '');
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'group-rename-input';
    input.value = currentTitle;

    // Hide header chrome during rename
    const headerEl = groupName.closest('.group-header');
    headerEl.classList.add('renaming');

    groupName.textContent = '';
    groupName.appendChild(input);
    input.focus();
    input.select();

    const commit = async () => {
      const newTitle = input.value.trim() || currentTitle;
      // Restore header chrome and text
      headerEl.classList.remove('renaming');
      input.remove();
      groupName.textContent = newTitle;

      try {
        if (isUngrouped) {
          otherGroupName = newTitle;
          const stored = await chrome.storage.sync.get('settings');
          const s = stored.settings || {};
          s.otherGroupName = newTitle;
          await chrome.storage.sync.set({ settings: s });
        } else if (isSleeping) {
          const entry = sleepingGroups.get(sleepId);
          if (entry) { entry.title = newTitle; await saveSleepingGroups(); }
          render('rename-sleeping-group');
        } else if (isGhost) {
          const ghostTabId = parseInt(String(groupId).replace('ghost-', ''));
          const ghost = ghostGroups.get(ghostTabId);
          if (ghost) { ghost.title = newTitle; saveGhostGroups(); }
          render('rename-ghost-group');
        } else if (typeof groupId === 'number') {
          await chrome.tabGroups.update(groupId, { title: newTitle });
          await chrome.runtime.sendMessage({ type: 'markManualGroup', groupId });
          // Sync custom group name if this was a custom group
          if (currentTitle !== newTitle) {
            const stored = await chrome.storage.sync.get('settings');
            const s = stored.settings || {};
            const customGroup = (s.customGroups || []).find(g => g.name === currentTitle);
            if (customGroup) {
              customGroup.name = newTitle;
              await chrome.storage.sync.set({ settings: s });
              chrome.runtime.sendMessage({ type: 'settingsUpdated', settings: s });
            }
          }
        }
      } catch (err) {
        console.error('Failed to rename group:', err);
      }
    };

    input.addEventListener('keydown', (ke) => {
      if (ke.key === 'Enter') { ke.preventDefault(); input.blur(); }
      if (ke.key === 'Escape') { ke.preventDefault(); input.value = currentTitle; input.blur(); }
    });
    input.addEventListener('blur', commit, { once: true });
    input.addEventListener('click', (ce) => ce.stopPropagation());
  });

  const rightSection = createHeaderRightSection(isGhost, ghostExpiresAt, isUngrouped, tabs, groupId, groupInfo, isSleeping, sleepId);

  header.appendChild(collapseIcon);
  header.appendChild(groupName);

  if (groupType !== 'auto' && !isUngrouped && !isGhost && !isSleeping) {
    const badge = document.createElement('span');
    badge.className = 'manual-badge';
    badge.textContent = 'M';
    badge.title = 'Manual group — click to release to auto-management';
    badge.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Release this group? Tabs will be ungrouped and auto-grouping will re-sort them.')) return;
      try {
        const groupTabs = await chrome.tabs.query({ groupId });
        const tabIds = groupTabs.map(t => t.id);
        if (tabIds.length > 0) {
          await chrome.tabs.ungroup(tabIds);
          await chrome.runtime.sendMessage({ type: 'refreshAll' });
        }
      } catch (err) {
        console.error('Failed to release manual group:', err);
      }
    });
    groupName.appendChild(badge);
  }

  header.appendChild(rightSection);

  return header;
}

// Create the right section of header (countdown, sleep button, close button, tab count)
function createHeaderRightSection(isGhost, ghostExpiresAt, isUngrouped, tabs, groupId, groupInfo, isSleeping, sleepId) {
  const rightSection = document.createElement('span');
  rightSection.className = 'header-right';

  if (isGhost && ghostExpiresAt) {
    const remainingSeconds = getGhostRemainingSeconds({ expiresAt: ghostExpiresAt });
    const countdownEl = document.createElement('span');
    countdownEl.className = 'countdown';
    countdownEl.textContent = `${remainingSeconds}s`;
    countdownEl.title = `Tab will move to ${otherGroupName} when timer expires`;
    rightSection.appendChild(countdownEl);
  }

  // Add sleep/wake button for real groups (not Other, not ghost)
  if (!isUngrouped && !isGhost) {
    const sleepBtn = document.createElement('button');
    sleepBtn.className = 'sleep-btn';

    if (isSleeping) {
      sleepBtn.textContent = '⏰';
      sleepBtn.title = 'Wake group (restore tabs)';
      sleepBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await wakeGroup(sleepId);
      });
    } else {
      sleepBtn.textContent = 'Zzz';
      sleepBtn.title = 'Sleep group (close tabs, save for later)';
      sleepBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (canSleepGroup(groupId)) {
          await sleepGroup(groupId, groupInfo);
        }
      });
    }
    rightSection.appendChild(sleepBtn);
  }

  // Close button (not shown for sleeping groups)
  if (!isSleeping) {
    const closeGroupBtn = document.createElement('button');
    closeGroupBtn.className = 'close-group-btn';
    closeGroupBtn.innerHTML = '&times;';
    closeGroupBtn.title = isUngrouped ? 'Close all ungrouped tabs' : 'Close all tabs in group';
    closeGroupBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      // Query fresh tabs to include any recently dragged-in tabs
      let freshTabs;
      if (isUngrouped) {
        freshTabs = (await chrome.tabs.query({ currentWindow: true })).filter(t => t.groupId === -1);
      } else {
        freshTabs = await chrome.tabs.query({ groupId });
      }
      const tabIds = freshTabs.map(t => t.id);
      removeGroupElement(isUngrouped ? 'ungrouped' : groupId);
      tabIds.forEach(id => ghostGroups.delete(id));
      saveGhostGroups();
      chrome.tabs.remove(tabIds);
    });
    rightSection.appendChild(closeGroupBtn);
  }

  const tabCount = document.createElement('span');
  tabCount.className = 'tab-count';
  tabCount.textContent = `(${tabs.length})`;
  rightSection.appendChild(tabCount);

  return rightSection;
}

// Create tabs container with drag handling
function createTabsContainer(tabs, groupInfo, isGhost, isUngrouped, positionIndex) {
  const isCollapsed = groupInfo?.collapsed || false;
  const tabsContainer = document.createElement('div');
  tabsContainer.className = 'group-tabs' + (isCollapsed ? ' collapsed' : '');

  tabsContainer.addEventListener('dragover', (e) => {
    e.preventDefault();
    const primary = draggedElements[0];
    if (primary && draggedTabs.length > 0) {
      if (primary.parentNode !== tabsContainer) {
        const children = Array.from(tabsContainer.children).filter(c => c !== primary);
        if (children.length === 0) {
          tabsContainer.appendChild(primary);
        } else {
          let inserted = false;
          for (const child of children) {
            const rect = child.getBoundingClientRect();
            if (getDropPosition(e.clientY, rect.top, rect.height) === 'before') {
              tabsContainer.insertBefore(primary, child);
              inserted = true;
              break;
            }
          }
          if (!inserted) {
            tabsContainer.appendChild(primary);
          }
        }
      }
    }
  });

  tabsContainer.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  tabs.forEach(tab => {
    let onClose = null;

    if (!isUngrouped && !isGhost && tabs.length === 2 && groupInfo) {
      const otherTab = tabs.find(t => t.id !== tab.id);
      if (otherTab) {
        onClose = () => {
          console.log('[sidebar] onClose: Creating ghost for tab', otherTab.id, 'group:', groupInfo.title);
          ghostGroups.set(otherTab.id, createGhostEntry(groupInfo, positionIndex));
          saveGhostGroups();
        };
      }
    }

    tabsContainer.appendChild(createTabElement(tab, isGhost ? groupInfo : null, onClose));
  });

  return tabsContainer;
}

// Create a non-interactive preview of sleeping tabs (collapsed by default)
function createSleepingTabsPreview(tabs) {
  const tabsContainer = document.createElement('div');
  tabsContainer.className = 'group-tabs sleeping-tabs collapsed';

  tabs.forEach(tabData => {
    const div = document.createElement('div');
    div.className = 'tab-item';

    // Favicon wrapper
    const faviconWrapper = document.createElement('div');
    faviconWrapper.className = 'favicon-wrapper';

    const favicon = document.createElement('img');
    favicon.className = 'favicon';
    if (tabData.favIconUrl && !tabData.favIconUrl.startsWith('chrome://')) {
      favicon.src = tabData.favIconUrl;
    } else {
      favicon.className = 'favicon placeholder';
    }
    favicon.onerror = () => {
      favicon.className = 'favicon placeholder';
      favicon.src = '';
    };
    faviconWrapper.appendChild(favicon);

    const title = document.createElement('span');
    title.className = 'tab-title';
    title.textContent = tabData.title || tabData.url || 'New Tab';
    title.title = tabData.title || tabData.url || 'New Tab';

    div.appendChild(faviconWrapper);
    div.appendChild(title);

    tabsContainer.appendChild(div);
  });

  return tabsContainer;
}

// Setup collapse click handler for header
function setupCollapseHandler(header, tabsContainer, groupInfo, isUngrouped) {
  header.addEventListener('click', async (e) => {
    if (e.target.closest('.close-group-btn')) return;

    if (isUngrouped) {
      otherCollapsed = !otherCollapsed;
      header.classList.toggle('collapsed', otherCollapsed);
      tabsContainer.classList.toggle('collapsed', otherCollapsed);
    } else if (groupInfo?.id) {
      try {
        const currentGroups = await chrome.tabGroups.query({});
        const currentGroup = currentGroups.find(g => g.id === groupInfo.id);
        if (currentGroup) {
          await chrome.tabGroups.update(groupInfo.id, { collapsed: !currentGroup.collapsed });
        }
      } catch (err) {
        console.error('Failed to toggle collapse:', err);
      }
    }
  });
}

function createGroupElement(groupId, groupInfo, tabs, isUngrouped = false, isGhost = false, ghostExpiresAt = null, positionIndex = 0, isSleeping = false, sleepId = null, groupType = 'none') {
  const container = document.createElement('div');
  let className = 'tab-group';
  if (isGhost) className += ' ghost-group';
  if (isSleeping) className += ' sleeping-group';
  container.className = className;
  container.dataset.groupId = groupId;

  // Sleeping groups are not draggable
  if (!isSleeping) {
    container.draggable = true;
    setupGroupDragHandlers(container, groupId, tabs, groupInfo);
  }

  const header = createGroupHeader(groupInfo, isGhost, isUngrouped, ghostExpiresAt, tabs, groupId, isSleeping, sleepId, groupType);

  let tabsContainer;
  if (isSleeping) {
    tabsContainer = createSleepingTabsPreview(tabs);
  } else {
    tabsContainer = createTabsContainer(tabs, groupInfo, isGhost, isUngrouped, positionIndex);
  }

  // Collapse handler for all group types
  if (isSleeping) {
    // Simple toggle for sleeping groups (no Chrome API call)
    header.addEventListener('click', (e) => {
      if (e.target.closest('.sleep-btn')) return;
      header.classList.toggle('collapsed');
      tabsContainer.classList.toggle('collapsed');
    });
  } else {
    setupCollapseHandler(header, tabsContainer, groupInfo, isUngrouped);
  }

  container.appendChild(header);
  container.appendChild(tabsContainer);

  return container;
}

// Get a unique key for a render item to match against existing DOM groups
function getGroupKey(item) {
  if (item.type === 'real') return String(item.groupId);
  if (item.type === 'ungrouped') return 'ungrouped';
  if (item.type === 'ghost') return `ghost-${item.tab.id}`;
  if (item.type === 'sleeping') return String(item.sleepId);
  return 'unknown';
}

// Patch an existing .tab-item element with new tab data
function updateTabElement(el, tab) {
  // Active class
  el.classList.toggle('active', !!tab.active);

  // Title
  const titleEl = el.querySelector('.tab-title');
  if (titleEl) {
    const newTitle = tab.title || tab.url || 'New Tab';
    if (titleEl.textContent !== newTitle) {
      titleEl.textContent = newTitle;
      titleEl.title = newTitle;
    }
  }

  // Favicon — use getAttribute to avoid resolved-URL mismatch
  const favicon = el.querySelector('.favicon');
  if (favicon) {
    const newSrc = (tab.favIconUrl && !tab.favIconUrl.startsWith('chrome://')) ? tab.favIconUrl : '';
    const currentSrc = favicon.getAttribute('src') || '';
    const failedSrc = favicon.dataset.failedSrc || '';
    if (currentSrc !== newSrc && failedSrc !== newSrc) {
      delete favicon.dataset.failedSrc;
      if (newSrc) {
        favicon.className = 'favicon';
        favicon.src = newSrc;
      } else {
        favicon.className = 'favicon placeholder';
        favicon.removeAttribute('src');
      }
    }
  }

  // Audio indicator
  const faviconWrapper = el.querySelector('.favicon-wrapper');
  const existingAudio = el.querySelector('.audio-indicator');
  if (tab.audible && !existingAudio && faviconWrapper) {
    const audioIcon = document.createElement('span');
    audioIcon.className = 'audio-indicator';
    audioIcon.textContent = '🔊';
    audioIcon.title = 'Playing audio';
    faviconWrapper.appendChild(audioIcon);
  } else if (!tab.audible && existingAudio) {
    existingAudio.remove();
  }
}

// Patch a group header in-place
function updateGroupHeader(headerEl, groupInfo, tabs, isGhost, ghostExpiresAt, isUngrouped, isSleeping, groupType) {
  const isCollapsed = groupInfo?.collapsed || false;
  headerEl.classList.toggle('collapsed', isCollapsed);

  // Border color
  const color = groupInfo ? getColorHex(groupInfo.color) : '#888';
  if (headerEl.style.borderLeftColor !== color) {
    headerEl.style.borderLeftColor = color;
  }

  // Group name — skip update if rename input is active
  const nameEl = headerEl.querySelector('.group-name');
  if (nameEl && !nameEl.querySelector('.group-rename-input')) {
    const newName = groupInfo ? (groupInfo.title || 'Unnamed Group') : 'Ungrouped';
    // Get text without badge
    const badge = nameEl.querySelector('.manual-badge');
    const currentText = badge ? nameEl.firstChild?.textContent : nameEl.textContent;
    if (currentText !== newName) {
      if (badge) {
        nameEl.firstChild.textContent = newName;
      } else {
        nameEl.textContent = newName;
      }
    }

    // Manual badge: should exist if groupType !== 'auto' and not ungrouped/ghost/sleeping
    const shouldHaveBadge = groupType !== 'auto' && !isUngrouped && !isGhost && !isSleeping;
    if (shouldHaveBadge && !badge) {
      // Need to re-add badge — but this is rare, just let full re-render handle it
      // Actually, add it:
      const newBadge = document.createElement('span');
      newBadge.className = 'manual-badge';
      newBadge.textContent = 'M';
      newBadge.title = 'Manual group — click to release to auto-management';
      nameEl.appendChild(newBadge);
    } else if (!shouldHaveBadge && badge) {
      badge.remove();
    }
  }

  // Tab count
  const countEl = headerEl.querySelector('.tab-count');
  if (countEl) {
    const newCount = `(${tabs.length})`;
    if (countEl.textContent !== newCount) {
      countEl.textContent = newCount;
    }
  }

  // Ghost countdown
  if (isGhost && ghostExpiresAt) {
    const countdownEl = headerEl.querySelector('.countdown');
    if (countdownEl) {
      const remaining = getGhostRemainingSeconds({ expiresAt: ghostExpiresAt });
      countdownEl.textContent = `${remaining}s`;
    }
  }
}

// Diff tabs within a group's tabs container
function diffGroupTabs(tabsContainer, newTabs, groupInfo, isGhost, isUngrouped, positionIndex) {
  // Build map of existing tab elements
  const existingMap = new Map();
  for (const el of tabsContainer.querySelectorAll(':scope > .tab-item')) {
    const tabId = el.dataset.tabId;
    if (tabId) existingMap.set(tabId, el);
  }

  const newTabIds = new Set(newTabs.map(t => String(t.id)));

  // Remove tabs no longer present
  for (const [tabId, el] of existingMap) {
    if (!newTabIds.has(tabId)) {
      el.remove();
      existingMap.delete(tabId);
    }
  }

  // Update or insert tabs in order
  let prevEl = null;
  for (let i = 0; i < newTabs.length; i++) {
    const tab = newTabs[i];
    const tabIdStr = String(tab.id);
    let el = existingMap.get(tabIdStr);

    if (el) {
      updateTabElement(el, tab);
    } else {
      // Build onClose for 2-tab groups
      let onClose = null;
      if (!isUngrouped && !isGhost && newTabs.length === 2 && groupInfo) {
        const otherTab = newTabs.find(t => t.id !== tab.id);
        if (otherTab) {
          onClose = () => {
            ghostGroups.set(otherTab.id, createGhostEntry(groupInfo, positionIndex));
            saveGhostGroups();
          };
        }
      }
      el = createTabElement(tab, isGhost ? groupInfo : null, onClose);
    }

    // Ensure correct position (also handles newly created elements not yet in DOM)
    if (!el.parentNode || el.previousElementSibling !== prevEl) {
      if (prevEl) {
        prevEl.after(el);
      } else {
        tabsContainer.prepend(el);
      }
    }
    prevEl = el;
  }
}

async function render(source = 'unknown', forceRender = false) {
  if (isDragging) return; // Don't rebuild DOM while user is dragging
  renderCount++;
  const scrollTop = document.documentElement.scrollTop || document.body.scrollTop;

  const { groupedTabs, ungroupedTabs, ghostTabs, groupMap, groupOrder } = await loadTabs();

  // Update header tab count
  let totalTabs = ungroupedTabs.length + ghostTabs.length;
  for (const tabs of groupedTabs.values()) {
    totalTabs += tabs.length;
  }
  tabCountEl.textContent = `(${totalTabs})`;

  // Fetch group types for all real groups
  const groupTypes = new Map();
  await Promise.all(groupOrder.map(async (groupId) => {
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'getGroupType', groupId });
      groupTypes.set(groupId, resp.groupType);
    } catch {
      groupTypes.set(groupId, 'none');
    }
  }));

  // Build combined list of all items with their first tab index for ordering
  const renderItems = [];

  // Add real groups with position based on first tab index
  groupOrder.forEach((groupId) => {
    const tabs = groupedTabs.get(groupId);
    const firstIndex = tabs.length > 0 ? Math.min(...tabs.map(t => t.index)) : Infinity;
    renderItems.push({
      type: 'real',
      groupId,
      tabs,
      groupInfo: groupMap.get(groupId),
      groupType: groupTypes.get(groupId) || 'none',
      firstTabIndex: firstIndex
    });
  });

  // Add "Other" (ungrouped) with position based on first ungrouped tab
  if (ungroupedTabs.length > 0) {
    const firstIndex = Math.min(...ungroupedTabs.map(t => t.index));
    renderItems.push({
      type: 'ungrouped',
      tabs: ungroupedTabs,
      firstTabIndex: firstIndex
    });
  }

  // Add ghost groups
  for (const tab of ghostTabs) {
    const ghost = ghostGroups.get(tab.id);
    if (ghost) {
      renderItems.push({
        type: 'ghost',
        tab,
        ghost,
        firstTabIndex: tab.index
      });
    }
  }

  // Add sleeping groups (always sorted last with Infinity)
  for (const [sleepId, entry] of sleepingGroups) {
    renderItems.push({
      type: 'sleeping',
      sleepId,
      entry,
      firstTabIndex: Infinity
    });
  }

  // Sort by first tab index to match tab bar order
  renderItems.sort((a, b) => a.firstTabIndex - b.firstTabIndex);

  // --- DOM diffing: patch existing groups in-place ---

  // Build map of existing group elements by data-group-id
  const existingGroups = new Map();
  for (const el of tabListEl.querySelectorAll(':scope > .tab-group')) {
    existingGroups.set(el.dataset.groupId, el);
  }

  const newGroupKeys = new Set();
  let prevGroupEl = null;

  renderItems.forEach((item, index) => {
    const key = getGroupKey(item);
    newGroupKeys.add(key);

    let groupEl = existingGroups.get(key);

    if (groupEl) {
      // Patch existing group in-place
      const headerEl = groupEl.querySelector(':scope > .group-header');
      const tabsContainer = groupEl.querySelector(':scope > .group-tabs');

      if (item.type === 'real') {
        updateGroupHeader(headerEl, item.groupInfo, item.tabs, false, null, false, false, item.groupType);
        if (tabsContainer) {
          tabsContainer.classList.toggle('collapsed', !!item.groupInfo?.collapsed);
          diffGroupTabs(tabsContainer, item.tabs, item.groupInfo, false, false, index);
        }
      } else if (item.type === 'ungrouped') {
        const ungroupedInfo = { title: otherGroupName, color: 'grey', collapsed: otherCollapsed };
        updateGroupHeader(headerEl, ungroupedInfo, item.tabs, false, null, true, false, 'none');
        if (tabsContainer) {
          tabsContainer.classList.toggle('collapsed', otherCollapsed);
          diffGroupTabs(tabsContainer, item.tabs, null, false, true, index);
        }
      } else if (item.type === 'ghost') {
        const fakeGroupInfo = { title: item.ghost.title, color: item.ghost.color };
        updateGroupHeader(headerEl, fakeGroupInfo, [item.tab], true, item.ghost.expiresAt, false, false, 'none');
        if (tabsContainer) {
          diffGroupTabs(tabsContainer, [item.tab], fakeGroupInfo, true, false, index);
        }
      } else if (item.type === 'sleeping') {
        const sleepInfo = { title: item.entry.title, color: item.entry.color };
        updateGroupHeader(headerEl, sleepInfo, item.entry.tabs, false, null, false, true, 'none');
        // Sleeping tabs are static previews — rebuild if tab count changed
        if (tabsContainer) {
          const currentCount = tabsContainer.querySelectorAll('.tab-item').length;
          if (currentCount !== item.entry.tabs.length) {
            const newContainer = createSleepingTabsPreview(item.entry.tabs);
            tabsContainer.replaceWith(newContainer);
          }
        }
      }
    } else {
      // Create new group element
      if (item.type === 'real') {
        groupEl = createGroupElement(item.groupId, item.groupInfo, item.tabs, false, false, null, index, false, null, item.groupType);
      } else if (item.type === 'ungrouped') {
        groupEl = createGroupElement('ungrouped', { title: otherGroupName, color: 'grey', collapsed: otherCollapsed }, item.tabs, true, false, null, index);
      } else if (item.type === 'ghost') {
        const ghostId = `ghost-${item.tab.id}`;
        const fakeGroupInfo = { title: item.ghost.title, color: item.ghost.color };
        groupEl = createGroupElement(ghostId, fakeGroupInfo, [item.tab], false, true, item.ghost.expiresAt, index);
      } else if (item.type === 'sleeping') {
        const sleepInfo = { title: item.entry.title, color: item.entry.color, collapsed: true };
        groupEl = createGroupElement(item.sleepId, sleepInfo, item.entry.tabs, false, false, null, index, true, item.sleepId);
      }
    }

    // Ensure correct position in tabListEl
    if (groupEl) {
      const expectedPrev = prevGroupEl;
      const actualPrev = groupEl.previousElementSibling;
      if (groupEl.parentNode !== tabListEl || actualPrev !== expectedPrev) {
        if (expectedPrev) {
          expectedPrev.after(groupEl);
        } else {
          tabListEl.prepend(groupEl);
        }
      }
      prevGroupEl = groupEl;
    }
  });

  // Remove groups no longer in renderItems
  for (const [key, el] of existingGroups) {
    if (!newGroupKeys.has(key)) {
      el.remove();
    }
  }

  // Re-apply selection to tabs still in DOM
  if (selectedTabIds.size > 0) {
    for (const id of selectedTabIds) {
      document.querySelector(`[data-tab-id="${id}"]`)?.classList.add('selected');
    }
  }

  // Scroll to focused tab if pending (takes priority over scroll position restore)
  if (pendingScrollToTabId !== null) {
    const tabIdToScroll = pendingScrollToTabId;
    pendingScrollToTabId = null;
    requestAnimationFrame(() => scrollToTab(tabIdToScroll));
  } else {
    window.scrollTo(0, scrollTop);
  }
}

// Initialize: load settings, ghost groups, sleeping groups, trigger auto-grouping, then render
(async () => {
  await loadSettings();
  await loadGhostGroups();
  await loadSleepingGroups();
  await loadYoutubeProgress();
  // Notify background to apply auto-grouping (if enabled)
  chrome.runtime.sendMessage({ type: 'sidebarOpened' });
  // Small delay to let grouping complete before render
  await new Promise(r => setTimeout(r, SIDEBAR_INIT_DELAY_MS));
  // Initialize group memberships tracking
  await updateGroupMemberships();
  render('initial', true);
})();

// Listen for settings and sleeping groups changes
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === 'sync' && changes.settings) {
    const newSettings = changes.settings.newValue;
    let needsRender = false;
    if (newSettings && newSettings.allWindows !== allWindows) {
      allWindows = newSettings.allWindows || false;
      needsRender = true;
    }
    if (newSettings && newSettings.otherGroupName !== otherGroupName) {
      otherGroupName = newSettings.otherGroupName || 'Other';
      needsRender = true;
    }
    if (newSettings && newSettings.youtubeProgress !== youtubeProgressEnabled) {
      youtubeProgressEnabled = newSettings.youtubeProgress || false;
      if (youtubeProgressEnabled) {
        await loadYoutubeProgress();
      } else {
        youtubeProgress.clear();
      }
      needsRender = true;
    }
    if (needsRender) {
      render('settings-changed', true);
    }
  }
  // Sync sleeping groups across windows
  if (area === 'local' && changes.sleepingGroups) {
    await loadSleepingGroups();
    render('sleeping-groups-changed', true);
  }
});

// Update countdown display in-place (no full re-render)
setInterval(async () => {
  if (ghostGroups.size === 0) return;

  const { validGhosts, hadExpired } = filterExpiredGhosts(ghostGroups);
  const expiredTabIds = [];

  // Collect expired tab IDs before updating ghostGroups
  for (const [tabId] of ghostGroups) {
    if (!validGhosts.has(tabId)) {
      expiredTabIds.push(tabId);
    }
  }

  // Update countdown text for non-expired ghosts
  for (const [tabId, ghost] of validGhosts) {
    const remainingSeconds = getGhostRemainingSeconds(ghost);
    const countdownEl = document.querySelector(`[data-group-id="ghost-${tabId}"] .countdown`);
    if (countdownEl) {
      countdownEl.textContent = `${remainingSeconds}s`;
    }
  }

  if (hadExpired) {
    ghostGroups = validGhosts;
    saveGhostGroups();
    // Scroll to the first expired tab after it moves to "Other"
    if (expiredTabIds.length > 0) {
      pendingScrollToTabId = expiredTabIds[0];
    }
    // Ungroup expired tabs so they move to "Other"
    for (const tabId of expiredTabIds) {
      try {
        await chrome.tabs.ungroup(tabId);
        console.log('[sidebar] Ungrouped expired ghost tab:', tabId);
      } catch (e) {
        // Tab might have been closed or already ungrouped
        console.log('[sidebar] Failed to ungroup tab:', tabId, e.message);
      }
    }
    render('ghost-expired');
  }
}, GHOST_COUNTDOWN_INTERVAL_MS);

chrome.tabs.onCreated.addListener(() => render('tabs.onCreated'));
chrome.tabs.onRemoved.addListener(async (tabId) => {
  ghostGroups.delete(tabId);
  saveGhostGroups();
  // Check for 2→1 group transitions before rendering
  await updateGroupMemberships();
  render('tabs.onRemoved');
});
chrome.tabs.onUpdated.addListener(() => render('tabs.onUpdated'));
chrome.tabs.onMoved.addListener(() => render('tabs.onMoved'));
chrome.tabs.onActivated.addListener((activeInfo) => {
  pendingScrollToTabId = activeInfo.tabId;
  render('tabs.onActivated');
});
chrome.tabGroups.onCreated.addListener(() => render('tabGroups.onCreated'));
chrome.tabGroups.onRemoved.addListener(() => render('tabGroups.onRemoved'));
chrome.tabGroups.onUpdated.addListener(() => render('tabGroups.onUpdated'));

// Listen for YouTube progress updates
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'youtubeProgressUpdate' && youtubeProgressEnabled) {
    const tabId = message.tabId;
    if (message.progress == null) {
      youtubeProgress.delete(tabId);
    } else {
      youtubeProgress.set(tabId, { progress: message.progress, videoId: message.videoId });
    }
    // Update progress bar in-place without full re-render
    const tabEl = document.querySelector(`[data-tab-id="${tabId}"]`);
    if (tabEl) {
      let progressBar = tabEl.querySelector('.youtube-progress-bar');
      if (message.progress == null) {
        if (progressBar) progressBar.remove();
      } else {
        if (!progressBar) {
          progressBar = document.createElement('div');
          progressBar.className = 'youtube-progress-bar';
          const progressFill = document.createElement('div');
          progressFill.className = 'youtube-progress-fill';
          progressBar.appendChild(progressFill);
          tabEl.appendChild(progressBar);
        }
        const fill = progressBar.querySelector('.youtube-progress-fill');
        if (fill) fill.style.width = `${message.progress}%`;
      }
    }
  }
});
