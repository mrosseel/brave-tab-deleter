import { getColorHex, getGroupColor } from './lib/colors.js';
import {
  GHOST_GROUP_SECONDS,
  createGhostEntry,
  isGhostExpired,
  getGhostRemainingSeconds
} from './lib/ghost.js';

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
collapseAllBtn.addEventListener('click', () => {
  document.querySelectorAll('.tab-group').forEach(group => {
    const groupId = group.dataset.groupId;
    collapsedGroups.add(groupId);
    group.querySelector('.group-header')?.classList.add('collapsed');
    group.querySelector('.group-tabs')?.classList.add('collapsed');
  });
});

// Expand all groups
expandAllBtn.addEventListener('click', () => {
  collapsedGroups.clear();
  document.querySelectorAll('.tab-group').forEach(group => {
    group.querySelector('.group-header')?.classList.remove('collapsed');
    group.querySelector('.group-tabs')?.classList.remove('collapsed');
  });
});

let collapsedGroups = new Set();

// Drag and drop state
let draggedTab = null;
let draggedGroup = null;

// Ghost groups: tabs that should appear in a fake group visually
// (either ungrouped by Chrome or moved to different group by Brave)
// tabId -> { title, color, expiresAt, originalGroupId, positionIndex }
// Persisted to chrome.storage.session to survive sidebar reloads
let ghostGroups = new Map();

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

// Debounced render - waits 50ms after last call to actually render
function debouncedRender(source) {
  if (renderTimeout) {
    clearTimeout(renderTimeout);
  }
  renderTimeout = setTimeout(() => {
    renderTimeout = null;
    render(source);
  }, 50);
}

// Track last known group count to detect bad API responses
let lastKnownGroupCount = 0;

async function loadTabs() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const windowId = tabs.length > 0 ? tabs[0].windowId : chrome.windows.WINDOW_ID_CURRENT;
  const groups = await chrome.tabGroups.query({ windowId });

  const groupMap = new Map();
  groups.forEach(group => {
    groupMap.set(group.id, group);
  });

  // Count tabs that claim to be in groups
  const tabsInGroups = tabs.filter(t => t.groupId !== -1);
  const currentGroupCount = new Set(tabsInGroups.map(t => t.groupId)).size;

  // Detect bad data: had groups before, now suddenly 0
  const isBadData = lastKnownGroupCount > 0 && currentGroupCount === 0;

  // Update count only with good data
  if (currentGroupCount > 0) {
    lastKnownGroupCount = currentGroupCount;
  }

  const groupedTabs = new Map();
  const ungroupedTabs = [];
  const ghostTabs = []; // Tabs that should appear in ghost groups
  const groupOrder = []; // Track order groups appear (for position tracking)

  // Clean up expired ghost groups
  const now = Date.now();
  let expired = false;
  for (const [tabId, ghost] of ghostGroups.entries()) {
    if (isGhostExpired(ghost, now)) {
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

  return { groupedTabs, ungroupedTabs, ghostTabs, groupMap, groupOrder, isBadData };
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
        // Get target tab info to find its index
        const targetTab = await chrome.tabs.get(tab.id);
        // Move dragged tab to target position
        await chrome.tabs.move(draggedTabId, { index: targetTab.index });
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

    await chrome.tabs.remove(tab.id);
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
        } catch (err) {
          console.error('Failed to move tab to group:', err);
        }
      }
    });
  }

  const header = document.createElement('div');
  header.className = 'group-header' + (collapsedGroups.has(groupId) ? ' collapsed' : '');

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
    const remainingSeconds = getGhostRemainingSeconds({ expiresAt: ghostExpiresAt });
    const countdownEl = document.createElement('span');
    countdownEl.className = 'countdown';
    countdownEl.textContent = `${remainingSeconds}s`;
    countdownEl.title = 'Tab will move to Ungrouped when timer expires';
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
  tabsContainer.className = 'group-tabs' + (collapsedGroups.has(groupId) ? ' collapsed' : '');

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
          ghostGroups.set(otherTab.id, createGhostEntry(groupInfo, positionIndex));
          saveGhostGroups();
        };
      }
    }

    tabsContainer.appendChild(createTabElement(tab, isGhost ? groupInfo : null, onClose));
  });

  header.addEventListener('click', (e) => {
    // Don't toggle if clicking the close button
    if (e.target.closest('.close-group-btn')) return;

    const isCollapsed = collapsedGroups.has(groupId);
    if (isCollapsed) {
      collapsedGroups.delete(groupId);
    } else {
      collapsedGroups.add(groupId);
    }
    header.classList.toggle('collapsed');
    tabsContainer.classList.toggle('collapsed');
  });

  container.appendChild(header);
  container.appendChild(tabsContainer);

  return container;
}

let retryTimeout = null;

async function render(source = 'unknown') {
  renderCount++;
  const scrollTop = document.documentElement.scrollTop || document.body.scrollTop;

  const { groupedTabs, ungroupedTabs, ghostTabs, groupMap, groupOrder, isBadData } = await loadTabs();

  // If bad data detected, skip this render and retry shortly
  if (isBadData) {
    console.log(`[${source}] Bad data detected, scheduling retry...`);
    if (retryTimeout) clearTimeout(retryTimeout);
    retryTimeout = setTimeout(() => {
      retryTimeout = null;
      render('retry');
    }, 100);
    return;
  }

  tabListEl.innerHTML = '';

  // Render ungrouped tabs first
  if (ungroupedTabs.length > 0) {
    tabListEl.appendChild(createGroupElement('ungrouped', null, ungroupedTabs, true, false, null, -1));
  }

  // Build combined list of real groups and ghost groups with positions
  const renderItems = [];

  // Add real groups with their current position
  groupOrder.forEach((groupId, index) => {
    renderItems.push({
      type: 'real',
      groupId,
      tabs: groupedTabs.get(groupId),
      groupInfo: groupMap.get(groupId),
      positionIndex: index
    });
  });

  // Add ghost groups at their original positions
  for (const tab of ghostTabs) {
    const ghost = ghostGroups.get(tab.id);
    if (ghost) {
      renderItems.push({
        type: 'ghost',
        tab,
        ghost,
        positionIndex: ghost.positionIndex ?? renderItems.length // fallback to end if no position
      });
    }
  }

  // Sort by position index to maintain order
  // When positions are equal, ghosts come first (they represent the original group at that position)
  renderItems.sort((a, b) => {
    if (a.positionIndex !== b.positionIndex) {
      return a.positionIndex - b.positionIndex;
    }
    // Ghost takes priority at its original position
    if (a.type === 'ghost' && b.type !== 'ghost') return -1;
    if (a.type !== 'ghost' && b.type === 'ghost') return 1;
    return 0;
  });

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
        index // Use current render position for future ghosts
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
        item.positionIndex
      ));
    }
  });

  window.scrollTo(0, scrollTop);
}

// Initialize: load ghost groups then render
(async () => {
  await loadGhostGroups();
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
