import { getColorHex } from './shared.js';

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
  render('manual-refresh');
});

// Collapse all groups
collapseAllBtn.addEventListener('click', async () => {
  const groups = await chrome.tabGroups.query({ windowId: chrome.windows.WINDOW_ID_CURRENT });
  for (const group of groups) {
    if (!group.collapsed) {
      await chrome.tabGroups.update(group.id, { collapsed: true });
    }
  }
});

// Expand all groups
expandAllBtn.addEventListener('click', async () => {
  const groups = await chrome.tabGroups.query({ windowId: chrome.windows.WINDOW_ID_CURRENT });
  for (const group of groups) {
    if (group.collapsed) {
      await chrome.tabGroups.update(group.id, { collapsed: false });
    }
  }
});

// Drag and drop state
let draggedTab = null;
let draggedGroup = null;

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

// Debounced render - waits 100ms after last call to reduce flicker during group recovery
function debouncedRender(source) {
  if (renderTimeout) {
    clearTimeout(renderTimeout);
  }
  renderTimeout = setTimeout(() => {
    renderTimeout = null;
    render(source);
  }, 100);
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

// Use getColorHex from shared.js
function getGroupColor(group) {
  return getColorHex(group.color);
}

function createTabElement(tab, groupInfo, onClose) {
  const div = document.createElement('div');
  div.className = 'tab-item' + (tab.active ? ' active' : '');
  div.dataset.tabId = tab.id;
  div.draggable = true;

  // Drag events for tab
  div.addEventListener('dragstart', (e) => {
    draggedTab = { tabId: tab.id, element: div };
    div.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', tab.id.toString());
    // Stop group drag from triggering
    e.stopPropagation();
  });

  div.addEventListener('dragend', () => {
    div.classList.remove('dragging');
    draggedTab = null;
    // Clean up all drag-over classes
    document.querySelectorAll('.drag-over, .drag-over-empty').forEach(el => {
      el.classList.remove('drag-over', 'drag-over-empty');
    });
  });

  div.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (draggedTab && draggedTab.tabId !== tab.id) {
      div.classList.add('drag-over');
    }
  });

  div.addEventListener('dragleave', () => {
    div.classList.remove('drag-over');
  });

  div.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    div.classList.remove('drag-over');

    if (draggedTab && draggedTab.tabId !== tab.id) {
      const draggedTabId = draggedTab.tabId; // Capture before async
      try {
        // Get dragged tab info BEFORE moving (to preserve group)
        const draggedTabInfo = await chrome.tabs.get(draggedTabId);
        const originalGroupId = draggedTabInfo.groupId;

        // Get target tab info to find its index
        const targetTab = await chrome.tabs.get(tab.id);
        // Move dragged tab to target position
        await chrome.tabs.move(draggedTabId, { index: targetTab.index });

        // Re-group the tab if it was in a group (move can ungroup it)
        if (originalGroupId !== -1) {
          await chrome.tabs.group({ tabIds: draggedTabId, groupId: originalGroupId });
        }

        // Force re-render to ensure sidebar syncs with browser
        render('tab-drop-reorder');
      } catch (err) {
        console.error('Failed to move tab:', err);
      }
    }
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

  // Make groups draggable (not ungrouped or ghost)
  if (!isUngrouped && !isGhost && groupInfo) {
    container.draggable = true;

    container.addEventListener('dragstart', (e) => {
      // Only start group drag if not dragging a tab
      if (draggedTab) return;
      draggedGroup = { groupId: groupInfo.id, element: container };
      container.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', `group-${groupInfo.id}`);
    });

    container.addEventListener('dragend', () => {
      container.classList.remove('dragging');
      draggedGroup = null;
      document.querySelectorAll('.drag-over').forEach(el => {
        el.classList.remove('drag-over');
      });
    });

    container.addEventListener('dragover', (e) => {
      e.preventDefault();
      // Show drop indicator for group reordering
      if (draggedGroup && draggedGroup.groupId !== groupInfo.id) {
        container.classList.add('drag-over');
      }
      // Allow dropping tabs into this group
      if (draggedTab) {
        e.stopPropagation();
      }
    });

    container.addEventListener('dragleave', (e) => {
      // Only remove if leaving the container entirely
      if (!container.contains(e.relatedTarget)) {
        container.classList.remove('drag-over');
      }
    });

    container.addEventListener('drop', async (e) => {
      e.preventDefault();
      container.classList.remove('drag-over');

      // Capture values before async operations
      const draggedGroupId = draggedGroup?.groupId;
      const draggedTabId = draggedTab?.tabId;

      // Handle group reordering
      if (draggedGroupId && draggedGroupId !== groupInfo.id) {
        try {
          // Get all tabs in the target group to find its position
          const targetGroupTabs = await chrome.tabs.query({ groupId: groupInfo.id });
          if (targetGroupTabs.length > 0) {
            // Get all tabs in the dragged group
            const draggedGroupTabs = await chrome.tabs.query({ groupId: draggedGroupId });
            if (draggedGroupTabs.length > 0) {
              // Move all tabs from dragged group to position before target group
              const targetIndex = Math.min(...targetGroupTabs.map(t => t.index));
              const tabIds = draggedGroupTabs.map(t => t.id);
              await chrome.tabs.move(tabIds, { index: targetIndex });
              // Re-group tabs (move can ungroup them)
              await chrome.tabs.group({ tabIds, groupId: draggedGroupId });
              // Force re-render to ensure sidebar syncs with browser
              render('group-reorder');
            }
          }
        } catch (err) {
          console.error('Failed to reorder groups:', err);
        }
      }

      // Handle dropping tab into group
      if (draggedTabId) {
        try {
          // Add tab to this group
          await chrome.tabs.group({ tabIds: draggedTabId, groupId: groupInfo.id });
          // Force re-render to ensure sidebar syncs with browser
          render('tab-drop-to-group');
        } catch (err) {
          console.error('Failed to move tab to group:', err);
        }
      }
    });
  }

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

  // Close group button (only for actual groups and ghost groups, not ungrouped)
  if (!isUngrouped) {
    const closeGroupBtn = document.createElement('button');
    closeGroupBtn.className = 'close-group-btn';
    closeGroupBtn.innerHTML = '&times;';
    closeGroupBtn.title = 'Close all tabs in group';
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
  }

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
    if (draggedTab) {
      tabsContainer.classList.add('drag-over-empty');
    }
  });

  tabsContainer.addEventListener('dragleave', (e) => {
    if (!tabsContainer.contains(e.relatedTarget)) {
      tabsContainer.classList.remove('drag-over-empty');
    }
  });

  tabsContainer.addEventListener('drop', async (e) => {
    e.preventDefault();
    tabsContainer.classList.remove('drag-over-empty');

    const draggedTabId = draggedTab?.tabId; // Capture before async
    if (draggedTabId) {
      try {
        if (isUngrouped) {
          // Remove from group (ungroup)
          await chrome.tabs.ungroup(draggedTabId);
        } else if (groupInfo && groupInfo.id) {
          // Add to this group
          await chrome.tabs.group({ tabIds: draggedTabId, groupId: groupInfo.id });
        }
        // Force re-render to ensure sidebar syncs with browser
        render('tabs-container-drop');
      } catch (err) {
        console.error('Failed to move tab:', err);
      }
    }
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

async function render(source = 'unknown') {
  renderCount++;
  const scrollTop = document.documentElement.scrollTop || document.body.scrollTop;

  const { groupedTabs, ungroupedTabs, ghostTabs, groupMap, groupOrder, firstTabIndex } = await loadTabs();

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
  render('initial');
})();

// Update countdown display every second
setInterval(() => {
  // Check if any ghost groups have active countdowns
  if (ghostGroups.size > 0) {
    render('interval');
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
