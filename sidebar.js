import { getColorHex } from './lib/colors.js';
import { RENDER_DEBOUNCE_MS, GHOST_COUNTDOWN_INTERVAL_MS, SIDEBAR_INIT_DELAY_MS } from './lib/constants.js';
import { calculateTargetIndex, getDropPosition } from './lib/drag-position.js';
import { GHOST_GROUP_SECONDS, createGhostEntry, filterExpiredGhosts, getGhostRemainingSeconds } from './lib/ghost.js';
import { createSleepingGroupEntry, isValidSleepingGroup, canSleepGroup } from './lib/sleep.js';
import { loadFromStorage, saveToStorage } from './lib/storage.js';

const tabListEl = document.getElementById('tab-list');
const settingsBtn = document.getElementById('settings-btn');
const collapseAllBtn = document.getElementById('collapse-all-btn');
const expandAllBtn = document.getElementById('expand-all-btn');
const contextMenu = document.getElementById('context-menu');
const moveToGroupSubmenu = document.getElementById('move-to-group-submenu');
const ungroupOption = document.getElementById('ungroup-option');

// Settings state
let allWindows = false;

// Load settings from storage
async function loadSettings() {
  const stored = await chrome.storage.sync.get('settings');
  if (stored.settings) {
    allWindows = stored.settings.allWindows || false;
  }
}

// Context menu state
let contextMenuTab = null;
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
  contextMenuTab = null;
}

async function showContextMenu(e, tab) {
  e.preventDefault();
  e.stopPropagation();

  contextMenuTab = tab;

  // Show/hide ungroup option based on whether tab is in a group
  ungroupOption.style.display = tab.groupId !== -1 ? 'block' : 'none';

  // Populate move-to-group submenu
  await populateMoveToGroupSubmenu(tab);

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

async function populateMoveToGroupSubmenu(tab) {
  moveToGroupSubmenu.innerHTML = '';

  const groups = await chrome.tabGroups.query({ windowId: chrome.windows.WINDOW_ID_CURRENT });

  // Add "Other" option first (ungrouped)
  const otherItem = document.createElement('div');
  otherItem.className = 'context-submenu-item';
  otherItem.innerHTML = `<span class="submenu-color-dot" style="background-color: ${getColorHex('grey')}"></span>Other`;
  otherItem.addEventListener('click', async () => {
    if (contextMenuTab) {
      await chrome.tabs.ungroup(contextMenuTab.id);
      hideContextMenu();
    }
  });
  moveToGroupSubmenu.appendChild(otherItem);

  // Add divider if there are groups
  if (groups.length > 0) {
    const divider = document.createElement('div');
    divider.className = 'context-menu-divider';
    moveToGroupSubmenu.appendChild(divider);
  }

  // Add each group
  for (const group of groups) {
    // Skip the group the tab is already in
    if (tab.groupId === group.id) continue;

    const item = document.createElement('div');
    item.className = 'context-submenu-item';
    item.innerHTML = `<span class="submenu-color-dot" style="background-color: ${getColorHex(group.color)}"></span>${group.title || 'Unnamed'}`;
    item.addEventListener('click', async () => {
      if (contextMenuTab) {
        await chrome.tabs.group({ tabIds: contextMenuTab.id, groupId: group.id });
        hideContextMenu();
      }
    });
    moveToGroupSubmenu.appendChild(item);
  }
}

async function handleContextMenuAction(action) {
  if (!contextMenuTab) return;

  const tabId = contextMenuTab.id;

  switch (action) {
    case 'duplicate':
      await chrome.tabs.duplicate(tabId);
      break;
    case 'close':
      ghostGroups.delete(tabId);
      saveGhostGroups();
      await chrome.tabs.remove(tabId);
      break;
    case 'ungroup':
      await chrome.tabs.ungroup(tabId);
      break;
  }

  hideContextMenu();
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

// Hide context menu when clicking outside
document.addEventListener('click', (e) => {
  if (!contextMenu.contains(e.target)) {
    hideContextMenu();
  }
});

// Hide context menu on scroll
document.addEventListener('scroll', hideContextMenu);

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

// Drag and drop state for tabs
let draggedTab = null;
let draggedElement = null;
let originalParent = null;
let originalNextSibling = null;

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
async function sleepGroup(groupId, groupInfo, tabs) {
  const windowId = tabs.length > 0 ? tabs[0].windowId : chrome.windows.WINDOW_ID_CURRENT;

  // Check if this is a manual (non-auto) group
  const response = await chrome.runtime.sendMessage({ type: 'isAutoGroup', groupId });
  const isManual = !response.isAuto;

  const entry = createSleepingGroupEntry(groupInfo, tabs, windowId, isManual);

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

      // If this was a manual group, mark it so auto-grouping won't touch it
      if (entry.isManual) {
        await chrome.runtime.sendMessage({ type: 'markManualGroup', groupId });
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

// Track render calls and debounce
let renderCount = 0;
let renderTimeout = null;
let lastStateHash = null;

// Debounced render - waits 300ms after last call to let grouping complete
function debouncedRender(source) {
  if (renderTimeout) {
    clearTimeout(renderTimeout);
  }
  renderTimeout = setTimeout(() => {
    renderTimeout = null;
    render(source);
  }, RENDER_DEBOUNCE_MS);
}

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

  // Clean up expired ghost groups
  const { validGhosts, hadExpired } = filterExpiredGhosts(ghostGroups);
  if (hadExpired) {
    ghostGroups = validGhosts;
    saveGhostGroups();
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

// Compute a hash of the current state for comparison
function computeStateHash(groupedTabs, ungroupedTabs, ghostTabs, groupMap) {
  const parts = [];

  // Hash grouped tabs
  for (const [groupId, tabs] of groupedTabs) {
    const group = groupMap.get(groupId);
    const tabIds = tabs.map(t => `${t.id}:${t.active}:${t.title}:${t.audible}`).join(',');
    parts.push(`g${groupId}:${group?.collapsed}:${group?.title}:${group?.color}:${tabIds}`);
  }

  // Hash ungrouped tabs
  const ungroupedIds = ungroupedTabs.map(t => `${t.id}:${t.active}:${t.title}:${t.audible}`).join(',');
  parts.push(`u:${ungroupedIds}`);

  // Hash ghost tabs (excluding expiresAt since that changes every second)
  const ghostIds = ghostTabs.map(t => {
    const ghost = ghostGroups.get(t.id);
    return `${t.id}:${ghost?.title}:${ghost?.color}`;
  }).join(',');
  parts.push(`gh:${ghostIds}`);

  // Hash sleeping groups
  const sleepingIds = [...sleepingGroups.values()].map(s =>
    `${s.id}:${s.title}:${s.color}:${s.tabs.length}`
  ).join(',');
  parts.push(`sl:${sleepingIds}`);

  return parts.join('|');
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
    draggedTab = { tabId: tab.id, groupId: tab.groupId };
    draggedElement = div;
    originalParent = div.parentNode;
    originalNextSibling = div.nextSibling;

    div.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', tab.id.toString());
    e.stopPropagation();
  });

  // Drag end - commit the move
  div.addEventListener('dragend', async () => {
    div.classList.remove('dragging');

    if (draggedTab && draggedElement) {
      const currentParent = draggedElement.parentNode;
      const movedToNewPosition = currentParent !== originalParent || draggedElement.nextSibling !== originalNextSibling;

      if (movedToNewPosition) {
        const targetGroupContainer = currentParent.closest('.tab-group');
        const targetGroupId = targetGroupContainer?.dataset.groupId;

        const nextTab = draggedElement.nextElementSibling;
        const prevTab = draggedElement.previousElementSibling;
        const nextTabId = nextTab?.dataset?.tabId ? parseInt(nextTab.dataset.tabId) : null;
        const prevTabId = prevTab?.dataset?.tabId ? parseInt(prevTab.dataset.tabId) : null;

        try {
          // Handle group change FIRST
          if (targetGroupId === 'ungrouped') {
            await chrome.tabs.ungroup(draggedTab.tabId);
          } else if (targetGroupId && !targetGroupId.startsWith('ghost-')) {
            const groupIdNum = parseInt(targetGroupId);
            if (!isNaN(groupIdNum) && groupIdNum !== draggedTab.groupId) {
              await chrome.tabs.group({ tabIds: draggedTab.tabId, groupId: groupIdNum });
            }
          }

          // Calculate final position
          const currentTab = await chrome.tabs.get(draggedTab.tabId);
          const nextTabIndex = nextTabId ? (await chrome.tabs.get(nextTabId)).index : null;
          const prevTabIndex = prevTabId ? (await chrome.tabs.get(prevTabId)).index : null;

          const targetIndex = calculateTargetIndex(currentTab.index, nextTabIndex, prevTabIndex);
          if (targetIndex !== null) {
            await chrome.tabs.move(draggedTab.tabId, { index: targetIndex });
          }

          render('tab-drag-complete');
        } catch (err) {
          console.error('Failed to move tab:', err);
          // Revert on error - only if parent is still in document
          if (originalParent && document.contains(originalParent)) {
            try {
              originalParent.insertBefore(draggedElement, originalNextSibling);
            } catch (e) {
              // DOM may have changed, ignore
            }
          }
        }
      }
    }

    draggedTab = null;
    draggedElement = null;
    originalParent = null;
    originalNextSibling = null;
  });

  // Drag over - move element to show preview
  div.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (draggedElement && draggedElement !== div) {
      const rect = div.getBoundingClientRect();
      const position = getDropPosition(e.clientY, rect.top, rect.height);
      const parent = div.parentNode;

      if (position === 'before') {
        parent.insertBefore(draggedElement, div);
      } else {
        parent.insertBefore(draggedElement, div.nextSibling);
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
  closeBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const scrollTop = document.documentElement.scrollTop || document.body.scrollTop;

    if (onClose) {
      onClose();
    }

    console.log('[sidebar] Closing tab:', tab.id, 'groupId:', tab.groupId);
    await chrome.tabs.remove(tab.id);
    console.log('[sidebar] Tab removed');
    window.scrollTo(0, scrollTop);
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
    favicon.src = '';
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

  div.addEventListener('click', () => {
    chrome.tabs.update(tab.id, { active: true });
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
    if (draggedGroupElement && draggedGroupElement !== container && !draggedTab) {
      const rect = container.getBoundingClientRect();
      const position = getDropPosition(e.clientY, rect.top, rect.height);

      if (position === 'before') {
        tabListEl.insertBefore(draggedGroupElement, container);
      } else {
        tabListEl.insertBefore(draggedGroupElement, container.nextSibling);
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
function createGroupHeader(groupInfo, isGhost, isUngrouped, ghostExpiresAt, tabs, groupId, isSleeping = false, sleepId = null) {
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

  const rightSection = createHeaderRightSection(isGhost, ghostExpiresAt, isUngrouped, tabs, groupId, groupInfo, isSleeping, sleepId);

  header.appendChild(collapseIcon);
  header.appendChild(groupName);
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
    countdownEl.title = 'Tab will move to Other when timer expires';
    rightSection.appendChild(countdownEl);
  }

  // Add sleep/wake button for real groups (not Other, not ghost)
  if (!isUngrouped && !isGhost) {
    const sleepBtn = document.createElement('button');
    sleepBtn.className = 'sleep-btn';
    sleepBtn.textContent = 'Zzz';

    if (isSleeping) {
      sleepBtn.title = 'Wake group (restore tabs)';
      sleepBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await wakeGroup(sleepId);
      });
    } else {
      sleepBtn.title = 'Sleep group (close tabs, save for later)';
      sleepBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (canSleepGroup(groupId)) {
          await sleepGroup(groupId, groupInfo, tabs);
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
      const scrollTop = document.documentElement.scrollTop || document.body.scrollTop;
      const tabIds = tabs.map(t => t.id);
      tabIds.forEach(id => ghostGroups.delete(id));
      saveGhostGroups();
      await chrome.tabs.remove(tabIds);
      window.scrollTo(0, scrollTop);
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
    if (draggedElement && draggedTab) {
      if (draggedElement.parentNode !== tabsContainer) {
        const children = Array.from(tabsContainer.children).filter(c => c !== draggedElement);
        if (children.length === 0) {
          tabsContainer.appendChild(draggedElement);
        } else {
          let inserted = false;
          for (const child of children) {
            const rect = child.getBoundingClientRect();
            if (getDropPosition(e.clientY, rect.top, rect.height) === 'before') {
              tabsContainer.insertBefore(draggedElement, child);
              inserted = true;
              break;
            }
          }
          if (!inserted) {
            tabsContainer.appendChild(draggedElement);
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

// Create a non-interactive preview of sleeping tabs
function createSleepingTabsPreview(tabs) {
  const tabsContainer = document.createElement('div');
  tabsContainer.className = 'group-tabs sleeping-tabs';

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

function createGroupElement(groupId, groupInfo, tabs, isUngrouped = false, isGhost = false, ghostExpiresAt = null, positionIndex = 0, isSleeping = false, sleepId = null) {
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

  const header = createGroupHeader(groupInfo, isGhost, isUngrouped, ghostExpiresAt, tabs, groupId, isSleeping, sleepId);

  let tabsContainer;
  if (isSleeping) {
    tabsContainer = createSleepingTabsPreview(tabs);
  } else {
    tabsContainer = createTabsContainer(tabs, groupInfo, isGhost, isUngrouped, positionIndex);
  }

  // Sleeping groups don't need collapse handler (always expanded preview)
  if (!isSleeping) {
    setupCollapseHandler(header, tabsContainer, groupInfo, isUngrouped);
  }

  container.appendChild(header);
  container.appendChild(tabsContainer);

  return container;
}

async function render(source = 'unknown', forceRender = false) {
  renderCount++;
  const scrollTop = document.documentElement.scrollTop || document.body.scrollTop;

  const { groupedTabs, ungroupedTabs, ghostTabs, groupMap, groupOrder } = await loadTabs();

  // Skip render if state hasn't changed (unless forced)
  const stateHash = computeStateHash(groupedTabs, ungroupedTabs, ghostTabs, groupMap);
  if (!forceRender && stateHash === lastStateHash) {
    return;
  }
  lastStateHash = stateHash;

  tabListEl.innerHTML = '';

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

  // Render in sorted order
  renderItems.forEach((item, index) => {
    if (item.type === 'real') {
      tabListEl.appendChild(createGroupElement(
        item.groupId,
        item.groupInfo,
        item.tabs,
        false,
        false,
        null,
        index
      ));
    } else if (item.type === 'ungrouped') {
      tabListEl.appendChild(createGroupElement(
        'ungrouped',
        { title: 'Other', color: 'grey', collapsed: otherCollapsed },
        item.tabs,
        true,
        false,
        null,
        index
      ));
    } else if (item.type === 'ghost') {
      const ghostId = `ghost-${item.tab.id}`;
      const fakeGroupInfo = { title: item.ghost.title, color: item.ghost.color };
      tabListEl.appendChild(createGroupElement(
        ghostId,
        fakeGroupInfo,
        [item.tab],
        false,
        true,
        item.ghost.expiresAt,
        index
      ));
    } else if (item.type === 'sleeping') {
      const groupInfo = { title: item.entry.title, color: item.entry.color };
      tabListEl.appendChild(createGroupElement(
        item.sleepId,
        groupInfo,
        item.entry.tabs,
        false,
        false,
        null,
        index,
        true,
        item.sleepId
      ));
    }
  });

  window.scrollTo(0, scrollTop);
}

// Initialize: load settings, ghost groups, sleeping groups, trigger auto-grouping, then render
(async () => {
  await loadSettings();
  await loadGhostGroups();
  await loadSleepingGroups();
  // Notify background to apply auto-grouping (if enabled)
  chrome.runtime.sendMessage({ type: 'sidebarOpened' });
  // Small delay to let grouping complete before render
  await new Promise(r => setTimeout(r, SIDEBAR_INIT_DELAY_MS));
  // Initialize group memberships tracking
  await updateGroupMemberships();
  render('initial', true);
})();

// Listen for settings changes and re-render
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.settings) {
    const newSettings = changes.settings.newValue;
    if (newSettings && newSettings.allWindows !== allWindows) {
      allWindows = newSettings.allWindows || false;
      render('settings-changed', true);
    }
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

chrome.tabs.onCreated.addListener(() => debouncedRender('tabs.onCreated'));
chrome.tabs.onRemoved.addListener(async (tabId) => {
  ghostGroups.delete(tabId);
  saveGhostGroups();
  // Check for 2→1 group transitions before rendering
  await updateGroupMemberships();
  debouncedRender('tabs.onRemoved');
});
chrome.tabs.onUpdated.addListener(() => debouncedRender('tabs.onUpdated'));
chrome.tabs.onMoved.addListener(() => debouncedRender('tabs.onMoved'));
chrome.tabs.onActivated.addListener(() => debouncedRender('tabs.onActivated'));
chrome.tabGroups.onCreated.addListener(() => debouncedRender('tabGroups.onCreated'));
chrome.tabGroups.onRemoved.addListener(() => debouncedRender('tabGroups.onRemoved'));
chrome.tabGroups.onUpdated.addListener(() => debouncedRender('tabGroups.onUpdated'));
