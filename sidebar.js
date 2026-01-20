import { getColorHex } from './shared.js';
import { calculateTargetIndex, getDropPosition } from './lib/drag-position.js';

const tabListEl = document.getElementById('tab-list');
const settingsBtn = document.getElementById('settings-btn');
const collapseAllBtn = document.getElementById('collapse-all-btn');
const expandAllBtn = document.getElementById('expand-all-btn');
const refreshBtn = document.getElementById('refresh-btn');

// Settings button click handler
settingsBtn.addEventListener('click', () => {
  window.location.href = 'settings.html';
});

// Refresh button - force re-render
refreshBtn.addEventListener('click', () => {
  render('manual-refresh', true);
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

// Drag and drop state
let draggedTab = null;
let draggedElement = null;
let originalParent = null;
let originalNextSibling = null;

// Local collapse state for "Other" section (not a real Chrome group)
let otherCollapsed = false;

// Ghost groups: tabs that should appear in a fake group visually
// (either ungrouped by Chrome or moved to different group by Brave)
// tabId -> { title, color, expiresAt, originalGroupId, positionIndex }
// Persisted to chrome.storage.session to survive sidebar reloads
let ghostGroups = new Map();
const GHOST_GROUP_SECONDS = 15;

// Load ghost groups from chrome.storage.session
async function loadGhostGroups() {
  try {
    const result = await chrome.storage.session.get('ghostGroups');
    if (result.ghostGroups) {
      ghostGroups = new Map(result.ghostGroups);
    }
  } catch (e) {
    console.error('Failed to load ghostGroups:', e);
  }
}

// Save ghost groups to chrome.storage.session
async function saveGhostGroups() {
  try {
    await chrome.storage.session.set({ ghostGroups: [...ghostGroups.entries()] });
  } catch (e) {
    console.error('Failed to save ghostGroups:', e);
  }
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
  }, 300);
}

async function loadTabs() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const windowId = tabs.length > 0 ? tabs[0].windowId : chrome.windows.WINDOW_ID_CURRENT;
  const groups = await chrome.tabGroups.query({ windowId });

  const groupMap = new Map();
  groups.forEach(group => {
    groupMap.set(group.id, group);
  });

  const groupedTabs = new Map();
  const ungroupedTabs = [];
  const ghostTabs = []; // Tabs that should appear in ghost groups
  const groupOrder = []; // Track order groups appear (for position tracking)

  // Clean up expired ghost groups
  const now = Date.now();
  let expired = false;
  for (const [tabId, ghost] of ghostGroups.entries()) {
    if (now >= ghost.expiresAt) {
      ghostGroups.delete(tabId);
      expired = true;
    }
  }
  if (expired) saveGhostGroups();

  for (const tab of tabs) {
    const ghost = ghostGroups.get(tab.id);

    if (tab.groupId === -1) {
      // Tab is ungrouped - check if it should appear in a ghost group
      if (ghost) {
        ghostTabs.push(tab);
      } else {
        ungroupedTabs.push(tab);
      }
    } else if (ghost && tab.groupId !== ghost.originalGroupId) {
      // Tab was moved to a DIFFERENT group (Brave behavior) - show as ghost
      ghostTabs.push(tab);
    } else {
      // Tab is in its original group (or no ghost entry) - show normally
      if (!groupedTabs.has(tab.groupId)) {
        groupedTabs.set(tab.groupId, []);
        groupOrder.push(tab.groupId); // Track order of first appearance
      }
      groupedTabs.get(tab.groupId).push(tab);
    }
  }

  return { groupedTabs, ungroupedTabs, ghostTabs, groupMap, groupOrder, windowId };
}

// Compute a hash of the current state for comparison
function computeStateHash(groupedTabs, ungroupedTabs, ghostTabs, groupMap) {
  const parts = [];

  // Hash grouped tabs
  for (const [groupId, tabs] of groupedTabs) {
    const group = groupMap.get(groupId);
    const tabIds = tabs.map(t => `${t.id}:${t.active}:${t.title}`).join(',');
    parts.push(`g${groupId}:${group?.collapsed}:${group?.title}:${tabIds}`);
  }

  // Hash ungrouped tabs
  const ungroupedIds = ungroupedTabs.map(t => `${t.id}:${t.active}:${t.title}`).join(',');
  parts.push(`u:${ungroupedIds}`);

  // Hash ghost tabs (excluding expiresAt since that changes every second)
  const ghostIds = ghostTabs.map(t => {
    const ghost = ghostGroups.get(t.id);
    return `${t.id}:${ghost?.title}:${ghost?.color}`;
  }).join(',');
  parts.push(`gh:${ghostIds}`);

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
          // Revert on error
          if (originalParent) {
            originalParent.insertBefore(draggedElement, originalNextSibling);
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

  const title = document.createElement('span');
  title.className = 'tab-title';
  title.textContent = tab.title || tab.url || 'New Tab';
  title.title = tab.title || tab.url || 'New Tab';

  div.appendChild(closeBtn);
  div.appendChild(favicon);
  div.appendChild(title);

  div.addEventListener('click', () => {
    chrome.tabs.update(tab.id, { active: true });
  });

  return div;
}

function createGroupElement(groupId, groupInfo, tabs, isUngrouped = false, isGhost = false, ghostExpiresAt = null, positionIndex = 0) {
  const container = document.createElement('div');
  container.className = 'tab-group' + (isGhost ? ' ghost-group' : '');
  container.dataset.groupId = groupId;

  // Group dragging disabled - using mouse-based tab dragging only

  const isCollapsed = groupInfo?.collapsed || false;
  const header = document.createElement('div');
  header.className = 'group-header' + (isCollapsed ? ' collapsed' : '');

  if (isGhost && groupInfo) {
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
  } else {
    groupName.textContent = groupInfo ? (groupInfo.title || 'Unnamed Group') : 'Ungrouped';
  }

  const rightSection = document.createElement('span');
  rightSection.className = 'header-right';

  // Show countdown for ghost groups
  if (isGhost && ghostExpiresAt) {
    const remainingSeconds = Math.max(0, Math.ceil((ghostExpiresAt - Date.now()) / 1000));
    const countdownEl = document.createElement('span');
    countdownEl.className = 'countdown';
    countdownEl.textContent = `${remainingSeconds}s`;
    countdownEl.title = 'Tab will move to Other when timer expires';
    rightSection.appendChild(countdownEl);
  }

  // Close group button (for all groups including "Other")
  const closeGroupBtn = document.createElement('button');
  closeGroupBtn.className = 'close-group-btn';
  closeGroupBtn.innerHTML = '&times;';
  closeGroupBtn.title = isUngrouped ? 'Close all ungrouped tabs' : 'Close all tabs in group';
  closeGroupBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const scrollTop = document.documentElement.scrollTop || document.body.scrollTop;
    const tabIds = tabs.map(t => t.id);
    // Clean up ghost groups for these tabs
    tabIds.forEach(id => ghostGroups.delete(id));
    saveGhostGroups();
    await chrome.tabs.remove(tabIds);
    window.scrollTo(0, scrollTop);
  });
  rightSection.appendChild(closeGroupBtn);

  const tabCount = document.createElement('span');
  tabCount.className = 'tab-count';
  tabCount.textContent = `(${tabs.length})`;
  rightSection.appendChild(tabCount);

  header.appendChild(collapseIcon);
  header.appendChild(groupName);
  header.appendChild(rightSection);

  const tabsContainer = document.createElement('div');
  tabsContainer.className = 'group-tabs' + (isCollapsed ? ' collapsed' : '');

  // Allow dropping tabs into the group's tab container
  tabsContainer.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (draggedElement && draggedTab) {
      if (draggedElement.parentNode !== tabsContainer) {
        // Move element into this group
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
    // For 2-tab groups, set up ghost group for the remaining tab when one is closed
    let onClose = null;

    if (!isUngrouped && !isGhost && tabs.length === 2 && groupInfo) {
      const otherTab = tabs.find(t => t.id !== tab.id);
      if (otherTab) {
        onClose = () => {
          ghostGroups.set(otherTab.id, {
            title: groupInfo.title || '',
            color: groupInfo.color,
            originalGroupId: groupInfo.id,
            positionIndex: positionIndex,
            expiresAt: Date.now() + (GHOST_GROUP_SECONDS * 1000)
          });
          saveGhostGroups();
        };
      }
    }

    tabsContainer.appendChild(createTabElement(tab, isGhost ? groupInfo : null, onClose));
  });

  header.addEventListener('click', async (e) => {
    // Don't toggle if clicking the close button
    if (e.target.closest('.close-group-btn')) return;

    if (isUngrouped) {
      // Toggle local collapse state for "Other" section
      otherCollapsed = !otherCollapsed;
      header.classList.toggle('collapsed', otherCollapsed);
      tabsContainer.classList.toggle('collapsed', otherCollapsed);
    } else if (groupInfo && groupInfo.id) {
      // For real groups, toggle collapse state via Chrome API
      try {
        // Get current state from Chrome (not cached groupInfo)
        const currentGroups = await chrome.tabGroups.query({ });
        const currentGroup = currentGroups.find(g => g.id === groupInfo.id);
        if (currentGroup) {
          await chrome.tabGroups.update(groupInfo.id, { collapsed: !currentGroup.collapsed });
        }
        // The onUpdated event will trigger a re-render
      } catch (err) {
        console.error('Failed to toggle collapse:', err);
      }
    }
  });

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
    } else {
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
    }
  });

  window.scrollTo(0, scrollTop);
}

// Initialize: load ghost groups, trigger auto-grouping, then render
(async () => {
  await loadGhostGroups();
  // Notify background to apply auto-grouping (if enabled)
  chrome.runtime.sendMessage({ type: 'sidebarOpened' });
  // Small delay to let grouping complete before render
  await new Promise(r => setTimeout(r, 100));
  render('initial', true);
})();

// Update countdown display in-place (no full re-render)
setInterval(() => {
  if (ghostGroups.size === 0) return;

  const now = Date.now();
  let needsFullRender = false;

  for (const [tabId, ghost] of ghostGroups.entries()) {
    if (now >= ghost.expiresAt) {
      // Ghost expired - need full render to move tab to "Other"
      ghostGroups.delete(tabId);
      needsFullRender = true;
    } else {
      // Update countdown text in-place
      const remainingSeconds = Math.ceil((ghost.expiresAt - now) / 1000);
      const countdownEl = document.querySelector(`[data-group-id="ghost-${tabId}"] .countdown`);
      if (countdownEl) {
        countdownEl.textContent = `${remainingSeconds}s`;
      }
    }
  }

  if (needsFullRender) {
    saveGhostGroups();
    render('ghost-expired');
  }
}, 1000);

chrome.tabs.onCreated.addListener(() => debouncedRender('tabs.onCreated'));
chrome.tabs.onRemoved.addListener((tabId) => {
  ghostGroups.delete(tabId);
  saveGhostGroups();
  debouncedRender('tabs.onRemoved');
});
chrome.tabs.onUpdated.addListener(() => debouncedRender('tabs.onUpdated'));
chrome.tabs.onMoved.addListener(() => debouncedRender('tabs.onMoved'));
chrome.tabs.onActivated.addListener(() => debouncedRender('tabs.onActivated'));
chrome.tabGroups.onCreated.addListener(() => debouncedRender('tabGroups.onCreated'));
chrome.tabGroups.onRemoved.addListener(() => debouncedRender('tabGroups.onRemoved'));
chrome.tabGroups.onUpdated.addListener(() => debouncedRender('tabGroups.onUpdated'));
