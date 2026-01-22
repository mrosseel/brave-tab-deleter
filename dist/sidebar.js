(() => {
  // lib/colors.js
  var GROUP_COLORS = {
    grey: "#5f6368",
    blue: "#1a73e8",
    red: "#d93025",
    yellow: "#f9ab00",
    green: "#1e8e3e",
    pink: "#d01884",
    purple: "#9334e6",
    cyan: "#007b83",
    orange: "#e8710a"
  };
  function getColorHex(colorName) {
    return GROUP_COLORS[colorName] || GROUP_COLORS.grey;
  }

  // lib/drag-position.js
  function calculateTargetIndex(currentIndex, nextTabIndex, prevTabIndex, count = 1) {
    let targetIndex = null;
    if (nextTabIndex !== null) {
      targetIndex = nextTabIndex;
      if (currentIndex < targetIndex) {
        targetIndex -= count;
      }
    } else if (prevTabIndex !== null) {
      targetIndex = prevTabIndex + 1;
      if (currentIndex < targetIndex) {
        targetIndex -= count;
      }
    }
    if (targetIndex === currentIndex) {
      return null;
    }
    return targetIndex;
  }
  function getDropPosition(mouseY, elementTop, elementHeight) {
    const midY = elementTop + elementHeight / 2;
    return mouseY < midY ? "before" : "after";
  }

  // lib/ghost.js
  var GHOST_GROUP_SECONDS = 15;
  function createGhostEntry(groupInfo, positionIndex) {
    return {
      title: groupInfo.title || "",
      color: groupInfo.color,
      originalGroupId: groupInfo.id,
      positionIndex,
      expiresAt: Date.now() + GHOST_GROUP_SECONDS * 1e3
    };
  }
  function isGhostExpired(ghost, now = Date.now()) {
    return now >= ghost.expiresAt;
  }
  function filterExpiredGhosts(ghostGroups2, now = Date.now()) {
    const validGhosts = /* @__PURE__ */ new Map();
    let hadExpired = false;
    for (const [tabId, ghost] of ghostGroups2.entries()) {
      if (isGhostExpired(ghost, now)) {
        hadExpired = true;
      } else {
        validGhosts.set(tabId, ghost);
      }
    }
    return { validGhosts, hadExpired };
  }
  function getGhostRemainingSeconds(ghost, now = Date.now()) {
    return Math.max(0, Math.ceil((ghost.expiresAt - now) / 1e3));
  }

  // lib/storage.js
  async function loadFromStorage(area, key, defaultValue = null) {
    try {
      const storage = area === "sync" ? chrome.storage.sync : chrome.storage.session;
      const result = await storage.get(key);
      return result[key] !== void 0 ? result[key] : defaultValue;
    } catch (e) {
      console.error(`Failed to load ${key} from ${area} storage:`, e);
      return defaultValue;
    }
  }
  async function saveToStorage(area, key, value) {
    try {
      const storage = area === "sync" ? chrome.storage.sync : chrome.storage.session;
      await storage.set({ [key]: value });
      return true;
    } catch (e) {
      console.error(`Failed to save ${key} to ${area} storage:`, e);
      return false;
    }
  }

  // sidebar.js
  var tabListEl = document.getElementById("tab-list");
  var settingsBtn = document.getElementById("settings-btn");
  var collapseAllBtn = document.getElementById("collapse-all-btn");
  var expandAllBtn = document.getElementById("expand-all-btn");
  var contextMenu = document.getElementById("context-menu");
  var moveToGroupSubmenu = document.getElementById("move-to-group-submenu");
  var ungroupOption = document.getElementById("ungroup-option");
  var contextMenuTab = null;
  settingsBtn.addEventListener("click", () => {
    window.location.href = "settings.html";
  });
  function hideContextMenu() {
    contextMenu.classList.remove("visible", "expand-up");
    const expandedItem = contextMenu.querySelector(".context-menu-has-submenu.expanded");
    if (expandedItem) {
      expandedItem.classList.remove("expanded");
    }
    contextMenuTab = null;
  }
  async function showContextMenu(e, tab) {
    e.preventDefault();
    e.stopPropagation();
    contextMenuTab = tab;
    ungroupOption.style.display = tab.groupId !== -1 ? "block" : "none";
    await populateMoveToGroupSubmenu(tab);
    contextMenu.style.left = "0px";
    contextMenu.style.top = "0px";
    contextMenu.classList.remove("expand-up");
    contextMenu.classList.add("visible");
    const menuRect = contextMenu.getBoundingClientRect();
    const menuHeight = menuRect.height;
    const groups = await chrome.tabGroups.query({ windowId: chrome.windows.WINDOW_ID_CURRENT });
    const submenuHeight = 50 + groups.length * 36;
    const expandedHeight = menuHeight + submenuHeight;
    let x = e.clientX;
    if (x + menuRect.width > window.innerWidth) {
      x = window.innerWidth - menuRect.width - 5;
    }
    let y = e.clientY;
    const spaceBelow = window.innerHeight - e.clientY;
    const spaceAbove = e.clientY;
    if (spaceBelow < expandedHeight && spaceAbove > spaceBelow) {
      y = Math.max(5, e.clientY - menuHeight);
      contextMenu.classList.add("expand-up");
    }
    contextMenu.style.left = `${x}px`;
    contextMenu.style.top = `${y}px`;
  }
  async function populateMoveToGroupSubmenu(tab) {
    moveToGroupSubmenu.innerHTML = "";
    const groups = await chrome.tabGroups.query({ windowId: chrome.windows.WINDOW_ID_CURRENT });
    const otherItem = document.createElement("div");
    otherItem.className = "context-submenu-item";
    otherItem.innerHTML = `<span class="submenu-color-dot" style="background-color: ${getColorHex("grey")}"></span>Other`;
    otherItem.addEventListener("click", async () => {
      if (contextMenuTab) {
        await chrome.tabs.ungroup(contextMenuTab.id);
        hideContextMenu();
      }
    });
    moveToGroupSubmenu.appendChild(otherItem);
    if (groups.length > 0) {
      const divider = document.createElement("div");
      divider.className = "context-menu-divider";
      moveToGroupSubmenu.appendChild(divider);
    }
    for (const group of groups) {
      if (tab.groupId === group.id) continue;
      const item = document.createElement("div");
      item.className = "context-submenu-item";
      item.innerHTML = `<span class="submenu-color-dot" style="background-color: ${getColorHex(group.color)}"></span>${group.title || "Unnamed"}`;
      item.addEventListener("click", async () => {
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
      case "duplicate":
        await chrome.tabs.duplicate(tabId);
        break;
      case "close":
        ghostGroups.delete(tabId);
        saveGhostGroups();
        await chrome.tabs.remove(tabId);
        break;
      case "ungroup":
        await chrome.tabs.ungroup(tabId);
        break;
    }
    hideContextMenu();
  }
  contextMenu.addEventListener("click", (e) => {
    const item = e.target.closest(".context-menu-item");
    if (!item) return;
    if (item.classList.contains("context-menu-has-submenu")) {
      item.classList.toggle("expanded");
      return;
    }
    const action = item.dataset.action;
    if (action) {
      handleContextMenuAction(action);
    }
  });
  document.addEventListener("click", (e) => {
    if (!contextMenu.contains(e.target)) {
      hideContextMenu();
    }
  });
  document.addEventListener("scroll", hideContextMenu);
  collapseAllBtn.addEventListener("click", async () => {
    const groups = await chrome.tabGroups.query({ windowId: chrome.windows.WINDOW_ID_CURRENT });
    for (const group of groups) {
      if (!group.collapsed) {
        await chrome.tabGroups.update(group.id, { collapsed: true });
      }
    }
    otherCollapsed = true;
    render("collapse-all", true);
  });
  expandAllBtn.addEventListener("click", async () => {
    const groups = await chrome.tabGroups.query({ windowId: chrome.windows.WINDOW_ID_CURRENT });
    for (const group of groups) {
      if (group.collapsed) {
        await chrome.tabGroups.update(group.id, { collapsed: false });
      }
    }
    otherCollapsed = false;
    render("expand-all", true);
  });
  var draggedTab = null;
  var draggedElement = null;
  var originalParent = null;
  var originalNextSibling = null;
  var draggedGroup = null;
  var draggedGroupElement = null;
  var originalGroupNextSibling = null;
  var otherCollapsed = false;
  var ghostGroups = /* @__PURE__ */ new Map();
  var groupMemberships = /* @__PURE__ */ new Map();
  async function loadGhostGroups() {
    const stored = await loadFromStorage("session", "ghostGroups", []);
    ghostGroups = new Map(stored);
  }
  async function saveGhostGroups() {
    await saveToStorage("session", "ghostGroups", [...ghostGroups.entries()]);
  }
  async function updateGroupMemberships() {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const groups = await chrome.tabGroups.query({ windowId: chrome.windows.WINDOW_ID_CURRENT });
    const newMemberships = /* @__PURE__ */ new Map();
    for (const group of groups) {
      newMemberships.set(group.id, { tabs: /* @__PURE__ */ new Set(), title: group.title, color: group.color });
    }
    for (const tab of tabs) {
      if (tab.groupId !== -1 && newMemberships.has(tab.groupId)) {
        newMemberships.get(tab.groupId).tabs.add(tab.id);
      }
    }
    for (const [groupId, oldInfo] of groupMemberships) {
      const newInfo = newMemberships.get(groupId);
      if (oldInfo.tabs.size >= 2 && newInfo && newInfo.tabs.size === 1) {
        const remainingTabId = [...newInfo.tabs][0];
        if (!ghostGroups.has(remainingTabId)) {
          console.log("[sidebar] Creating ghost for tab", remainingTabId, "from group", oldInfo.title);
          ghostGroups.set(remainingTabId, createGhostEntry({ id: groupId, title: oldInfo.title, color: oldInfo.color }, 0));
          saveGhostGroups();
        }
      }
    }
    for (const [groupId, oldInfo] of groupMemberships) {
      if (!newMemberships.has(groupId) && oldInfo.tabs.size >= 2) {
        for (const tabId of oldInfo.tabs) {
          const tab = tabs.find((t) => t.id === tabId);
          if (tab && tab.groupId === -1 && !ghostGroups.has(tabId)) {
            console.log("[sidebar] Creating ghost for orphaned tab", tabId, "from dissolved group", oldInfo.title);
            ghostGroups.set(tabId, createGhostEntry({ id: groupId, title: oldInfo.title, color: oldInfo.color }, 0));
            saveGhostGroups();
          }
        }
      }
    }
    groupMemberships = newMemberships;
  }
  var renderCount = 0;
  var renderTimeout = null;
  var lastStateHash = null;
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
    const groupMap = /* @__PURE__ */ new Map();
    groups.forEach((group) => {
      groupMap.set(group.id, group);
    });
    const groupedTabs = /* @__PURE__ */ new Map();
    const ungroupedTabs = [];
    const ghostTabs = [];
    const groupOrder = [];
    const { validGhosts, hadExpired } = filterExpiredGhosts(ghostGroups);
    if (hadExpired) {
      ghostGroups = validGhosts;
      saveGhostGroups();
    }
    for (const tab of tabs) {
      const ghost = ghostGroups.get(tab.id);
      if (ghost) {
        ghostTabs.push(tab);
      } else if (tab.groupId === -1) {
        ungroupedTabs.push(tab);
      } else {
        if (!groupedTabs.has(tab.groupId)) {
          groupedTabs.set(tab.groupId, []);
          groupOrder.push(tab.groupId);
        }
        groupedTabs.get(tab.groupId).push(tab);
      }
    }
    return { groupedTabs, ungroupedTabs, ghostTabs, groupMap, groupOrder, windowId };
  }
  function computeStateHash(groupedTabs, ungroupedTabs, ghostTabs, groupMap) {
    const parts = [];
    for (const [groupId, tabs] of groupedTabs) {
      const group = groupMap.get(groupId);
      const tabIds = tabs.map((t) => `${t.id}:${t.active}:${t.title}:${t.audible}`).join(",");
      parts.push(`g${groupId}:${group?.collapsed}:${group?.title}:${tabIds}`);
    }
    const ungroupedIds = ungroupedTabs.map((t) => `${t.id}:${t.active}:${t.title}:${t.audible}`).join(",");
    parts.push(`u:${ungroupedIds}`);
    const ghostIds = ghostTabs.map((t) => {
      const ghost = ghostGroups.get(t.id);
      return `${t.id}:${ghost?.title}:${ghost?.color}`;
    }).join(",");
    parts.push(`gh:${ghostIds}`);
    return parts.join("|");
  }
  function getGroupColor(group) {
    return getColorHex(group.color);
  }
  function createTabElement(tab, groupInfo, onClose) {
    const div = document.createElement("div");
    div.className = "tab-item" + (tab.active ? " active" : "");
    div.dataset.tabId = tab.id;
    div.draggable = true;
    div.addEventListener("dragstart", (e) => {
      draggedTab = { tabId: tab.id, groupId: tab.groupId };
      draggedElement = div;
      originalParent = div.parentNode;
      originalNextSibling = div.nextSibling;
      div.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", tab.id.toString());
      e.stopPropagation();
    });
    div.addEventListener("dragend", async () => {
      div.classList.remove("dragging");
      if (draggedTab && draggedElement) {
        const currentParent = draggedElement.parentNode;
        const movedToNewPosition = currentParent !== originalParent || draggedElement.nextSibling !== originalNextSibling;
        if (movedToNewPosition) {
          const targetGroupContainer = currentParent.closest(".tab-group");
          const targetGroupId = targetGroupContainer?.dataset.groupId;
          const nextTab = draggedElement.nextElementSibling;
          const prevTab = draggedElement.previousElementSibling;
          const nextTabId = nextTab?.dataset?.tabId ? parseInt(nextTab.dataset.tabId) : null;
          const prevTabId = prevTab?.dataset?.tabId ? parseInt(prevTab.dataset.tabId) : null;
          try {
            if (targetGroupId === "ungrouped") {
              await chrome.tabs.ungroup(draggedTab.tabId);
            } else if (targetGroupId && !targetGroupId.startsWith("ghost-")) {
              const groupIdNum = parseInt(targetGroupId);
              if (!isNaN(groupIdNum) && groupIdNum !== draggedTab.groupId) {
                await chrome.tabs.group({ tabIds: draggedTab.tabId, groupId: groupIdNum });
              }
            }
            const currentTab = await chrome.tabs.get(draggedTab.tabId);
            const nextTabIndex = nextTabId ? (await chrome.tabs.get(nextTabId)).index : null;
            const prevTabIndex = prevTabId ? (await chrome.tabs.get(prevTabId)).index : null;
            const targetIndex = calculateTargetIndex(currentTab.index, nextTabIndex, prevTabIndex);
            if (targetIndex !== null) {
              await chrome.tabs.move(draggedTab.tabId, { index: targetIndex });
            }
            render("tab-drag-complete");
          } catch (err) {
            console.error("Failed to move tab:", err);
            if (originalParent && document.contains(originalParent)) {
              try {
                originalParent.insertBefore(draggedElement, originalNextSibling);
              } catch (e) {
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
    div.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (draggedElement && draggedElement !== div) {
        const rect = div.getBoundingClientRect();
        const position = getDropPosition(e.clientY, rect.top, rect.height);
        const parent = div.parentNode;
        if (position === "before") {
          parent.insertBefore(draggedElement, div);
        } else {
          parent.insertBefore(draggedElement, div.nextSibling);
        }
      }
    });
    div.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    const closeBtn = document.createElement("button");
    closeBtn.className = "close-btn";
    closeBtn.innerHTML = "&times;";
    closeBtn.title = "Close tab";
    closeBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const scrollTop = document.documentElement.scrollTop || document.body.scrollTop;
      if (onClose) {
        onClose();
      }
      console.log("[sidebar] Closing tab:", tab.id, "groupId:", tab.groupId);
      await chrome.tabs.remove(tab.id);
      console.log("[sidebar] Tab removed");
      window.scrollTo(0, scrollTop);
    });
    const faviconWrapper = document.createElement("div");
    faviconWrapper.className = "favicon-wrapper";
    const favicon = document.createElement("img");
    favicon.className = "favicon";
    if (tab.favIconUrl && !tab.favIconUrl.startsWith("chrome://")) {
      favicon.src = tab.favIconUrl;
    } else {
      favicon.className = "favicon placeholder";
    }
    favicon.onerror = () => {
      favicon.className = "favicon placeholder";
      favicon.src = "";
    };
    faviconWrapper.appendChild(favicon);
    if (tab.audible) {
      const audioIcon = document.createElement("span");
      audioIcon.className = "audio-indicator";
      audioIcon.textContent = "\u{1F50A}";
      audioIcon.title = "Playing audio";
      faviconWrapper.appendChild(audioIcon);
    }
    const title = document.createElement("span");
    title.className = "tab-title";
    title.textContent = tab.title || tab.url || "New Tab";
    title.title = tab.title || tab.url || "New Tab";
    div.appendChild(closeBtn);
    div.appendChild(faviconWrapper);
    div.appendChild(title);
    div.addEventListener("click", () => {
      chrome.tabs.update(tab.id, { active: true });
    });
    div.addEventListener("contextmenu", (e) => {
      showContextMenu(e, tab);
    });
    return div;
  }
  function setupGroupDragHandlers(container, groupId, tabs, groupInfo) {
    container.addEventListener("dragstart", (e) => {
      if (e.target.classList.contains("tab-item")) return;
      draggedGroup = {
        groupId,
        tabs: tabs.map((t) => t.id),
        title: groupInfo?.title || "",
        color: groupInfo?.color || "blue"
      };
      draggedGroupElement = container;
      originalGroupNextSibling = container.nextSibling;
      container.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", `group-${groupId}`);
    });
    container.addEventListener("dragend", async () => {
      container.classList.remove("dragging");
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
    container.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (draggedGroupElement && draggedGroupElement !== container && !draggedTab) {
        const rect = container.getBoundingClientRect();
        const position = getDropPosition(e.clientY, rect.top, rect.height);
        if (position === "before") {
          tabListEl.insertBefore(draggedGroupElement, container);
        } else {
          tabListEl.insertBefore(draggedGroupElement, container.nextSibling);
        }
      }
    });
  }
  async function commitGroupMove(numericGroupId) {
    const nextGroup = draggedGroupElement.nextElementSibling;
    const prevGroup = draggedGroupElement.previousElementSibling;
    try {
      const groupTabs = await chrome.tabs.query({ groupId: numericGroupId });
      const sortedTabs = groupTabs.sort((a, b) => a.index - b.index);
      const tabIds = sortedTabs.map((t) => t.id);
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
      render("group-drag-complete");
    } catch (err) {
      console.error("Failed to move group:", err);
      if (draggedGroupElement && document.contains(draggedGroupElement)) {
        try {
          if (originalGroupNextSibling && document.contains(originalGroupNextSibling)) {
            tabListEl.insertBefore(draggedGroupElement, originalGroupNextSibling);
          } else {
            tabListEl.appendChild(draggedGroupElement);
          }
        } catch (e) {
        }
      }
    }
  }
  async function getFirstTabIndexOfGroup(groupEl) {
    if (!groupEl?.dataset?.groupId) return null;
    const groupTabs = groupEl.querySelectorAll(".tab-item");
    if (groupTabs.length > 0) {
      const tabId = parseInt(groupTabs[0].dataset.tabId);
      const tab = await chrome.tabs.get(tabId);
      return tab.index;
    }
    return null;
  }
  async function getLastTabIndexOfGroup(groupEl) {
    if (!groupEl?.dataset?.groupId) return null;
    const groupTabs = groupEl.querySelectorAll(".tab-item");
    if (groupTabs.length > 0) {
      const tabId = parseInt(groupTabs[groupTabs.length - 1].dataset.tabId);
      const tab = await chrome.tabs.get(tabId);
      return tab.index;
    }
    return null;
  }
  function createGroupHeader(groupInfo, isGhost, isUngrouped, ghostExpiresAt, tabs) {
    const isCollapsed = groupInfo?.collapsed || false;
    const header = document.createElement("div");
    header.className = "group-header" + (isCollapsed ? " collapsed" : "");
    if (isGhost && groupInfo) {
      header.style.borderLeftColor = getColorHex(groupInfo.color);
    } else {
      header.style.borderLeftColor = groupInfo ? getGroupColor(groupInfo) : "#888";
    }
    const collapseIcon = document.createElement("span");
    collapseIcon.className = "collapse-icon";
    collapseIcon.textContent = "\u25BC";
    const groupName = document.createElement("span");
    groupName.className = "group-name";
    if (isGhost && groupInfo) {
      groupName.textContent = groupInfo.title || "Unnamed Group";
    } else {
      groupName.textContent = groupInfo ? groupInfo.title || "Unnamed Group" : "Ungrouped";
    }
    const rightSection = createHeaderRightSection(isGhost, ghostExpiresAt, isUngrouped, tabs);
    header.appendChild(collapseIcon);
    header.appendChild(groupName);
    header.appendChild(rightSection);
    return header;
  }
  function createHeaderRightSection(isGhost, ghostExpiresAt, isUngrouped, tabs) {
    const rightSection = document.createElement("span");
    rightSection.className = "header-right";
    if (isGhost && ghostExpiresAt) {
      const remainingSeconds = getGhostRemainingSeconds({ expiresAt: ghostExpiresAt });
      const countdownEl = document.createElement("span");
      countdownEl.className = "countdown";
      countdownEl.textContent = `${remainingSeconds}s`;
      countdownEl.title = "Tab will move to Other when timer expires";
      rightSection.appendChild(countdownEl);
    }
    const closeGroupBtn = document.createElement("button");
    closeGroupBtn.className = "close-group-btn";
    closeGroupBtn.innerHTML = "&times;";
    closeGroupBtn.title = isUngrouped ? "Close all ungrouped tabs" : "Close all tabs in group";
    closeGroupBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const scrollTop = document.documentElement.scrollTop || document.body.scrollTop;
      const tabIds = tabs.map((t) => t.id);
      tabIds.forEach((id) => ghostGroups.delete(id));
      saveGhostGroups();
      await chrome.tabs.remove(tabIds);
      window.scrollTo(0, scrollTop);
    });
    rightSection.appendChild(closeGroupBtn);
    const tabCount = document.createElement("span");
    tabCount.className = "tab-count";
    tabCount.textContent = `(${tabs.length})`;
    rightSection.appendChild(tabCount);
    return rightSection;
  }
  function createTabsContainer(tabs, groupInfo, isGhost, isUngrouped, positionIndex) {
    const isCollapsed = groupInfo?.collapsed || false;
    const tabsContainer = document.createElement("div");
    tabsContainer.className = "group-tabs" + (isCollapsed ? " collapsed" : "");
    tabsContainer.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (draggedElement && draggedTab) {
        if (draggedElement.parentNode !== tabsContainer) {
          const children = Array.from(tabsContainer.children).filter((c) => c !== draggedElement);
          if (children.length === 0) {
            tabsContainer.appendChild(draggedElement);
          } else {
            let inserted = false;
            for (const child of children) {
              const rect = child.getBoundingClientRect();
              if (getDropPosition(e.clientY, rect.top, rect.height) === "before") {
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
    tabsContainer.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    tabs.forEach((tab) => {
      let onClose = null;
      if (!isUngrouped && !isGhost && tabs.length === 2 && groupInfo) {
        const otherTab = tabs.find((t) => t.id !== tab.id);
        if (otherTab) {
          onClose = () => {
            console.log("[sidebar] onClose: Creating ghost for tab", otherTab.id, "group:", groupInfo.title);
            ghostGroups.set(otherTab.id, createGhostEntry(groupInfo, positionIndex));
            saveGhostGroups();
          };
        }
      }
      tabsContainer.appendChild(createTabElement(tab, isGhost ? groupInfo : null, onClose));
    });
    return tabsContainer;
  }
  function setupCollapseHandler(header, tabsContainer, groupInfo, isUngrouped) {
    header.addEventListener("click", async (e) => {
      if (e.target.closest(".close-group-btn")) return;
      if (isUngrouped) {
        otherCollapsed = !otherCollapsed;
        header.classList.toggle("collapsed", otherCollapsed);
        tabsContainer.classList.toggle("collapsed", otherCollapsed);
      } else if (groupInfo?.id) {
        try {
          const currentGroups = await chrome.tabGroups.query({});
          const currentGroup = currentGroups.find((g) => g.id === groupInfo.id);
          if (currentGroup) {
            await chrome.tabGroups.update(groupInfo.id, { collapsed: !currentGroup.collapsed });
          }
        } catch (err) {
          console.error("Failed to toggle collapse:", err);
        }
      }
    });
  }
  function createGroupElement(groupId, groupInfo, tabs, isUngrouped = false, isGhost = false, ghostExpiresAt = null, positionIndex = 0) {
    const container = document.createElement("div");
    container.className = "tab-group" + (isGhost ? " ghost-group" : "");
    container.dataset.groupId = groupId;
    container.draggable = true;
    setupGroupDragHandlers(container, groupId, tabs, groupInfo);
    const header = createGroupHeader(groupInfo, isGhost, isUngrouped, ghostExpiresAt, tabs);
    const tabsContainer = createTabsContainer(tabs, groupInfo, isGhost, isUngrouped, positionIndex);
    setupCollapseHandler(header, tabsContainer, groupInfo, isUngrouped);
    container.appendChild(header);
    container.appendChild(tabsContainer);
    return container;
  }
  async function render(source = "unknown", forceRender = false) {
    renderCount++;
    const scrollTop = document.documentElement.scrollTop || document.body.scrollTop;
    const { groupedTabs, ungroupedTabs, ghostTabs, groupMap, groupOrder } = await loadTabs();
    const stateHash = computeStateHash(groupedTabs, ungroupedTabs, ghostTabs, groupMap);
    if (!forceRender && stateHash === lastStateHash) {
      return;
    }
    lastStateHash = stateHash;
    tabListEl.innerHTML = "";
    const renderItems = [];
    groupOrder.forEach((groupId) => {
      const tabs = groupedTabs.get(groupId);
      const firstIndex = tabs.length > 0 ? Math.min(...tabs.map((t) => t.index)) : Infinity;
      renderItems.push({
        type: "real",
        groupId,
        tabs,
        groupInfo: groupMap.get(groupId),
        firstTabIndex: firstIndex
      });
    });
    if (ungroupedTabs.length > 0) {
      const firstIndex = Math.min(...ungroupedTabs.map((t) => t.index));
      renderItems.push({
        type: "ungrouped",
        tabs: ungroupedTabs,
        firstTabIndex: firstIndex
      });
    }
    for (const tab of ghostTabs) {
      const ghost = ghostGroups.get(tab.id);
      if (ghost) {
        renderItems.push({
          type: "ghost",
          tab,
          ghost,
          firstTabIndex: tab.index
        });
      }
    }
    renderItems.sort((a, b) => a.firstTabIndex - b.firstTabIndex);
    renderItems.forEach((item, index) => {
      if (item.type === "real") {
        tabListEl.appendChild(createGroupElement(
          item.groupId,
          item.groupInfo,
          item.tabs,
          false,
          false,
          null,
          index
        ));
      } else if (item.type === "ungrouped") {
        tabListEl.appendChild(createGroupElement(
          "ungrouped",
          { title: "Other", color: "grey", collapsed: otherCollapsed },
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
  (async () => {
    await loadGhostGroups();
    chrome.runtime.sendMessage({ type: "sidebarOpened" });
    await new Promise((r) => setTimeout(r, 100));
    await updateGroupMemberships();
    render("initial", true);
  })();
  setInterval(async () => {
    if (ghostGroups.size === 0) return;
    const { validGhosts, hadExpired } = filterExpiredGhosts(ghostGroups);
    const expiredTabIds = [];
    for (const [tabId] of ghostGroups) {
      if (!validGhosts.has(tabId)) {
        expiredTabIds.push(tabId);
      }
    }
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
      for (const tabId of expiredTabIds) {
        try {
          await chrome.tabs.ungroup(tabId);
          console.log("[sidebar] Ungrouped expired ghost tab:", tabId);
        } catch (e) {
          console.log("[sidebar] Failed to ungroup tab:", tabId, e.message);
        }
      }
      render("ghost-expired");
    }
  }, 1e3);
  chrome.tabs.onCreated.addListener(() => debouncedRender("tabs.onCreated"));
  chrome.tabs.onRemoved.addListener(async (tabId) => {
    ghostGroups.delete(tabId);
    saveGhostGroups();
    await updateGroupMemberships();
    debouncedRender("tabs.onRemoved");
  });
  chrome.tabs.onUpdated.addListener(() => debouncedRender("tabs.onUpdated"));
  chrome.tabs.onMoved.addListener(() => debouncedRender("tabs.onMoved"));
  chrome.tabs.onActivated.addListener(() => debouncedRender("tabs.onActivated"));
  chrome.tabGroups.onCreated.addListener(() => debouncedRender("tabGroups.onCreated"));
  chrome.tabGroups.onRemoved.addListener(() => debouncedRender("tabGroups.onRemoved"));
  chrome.tabGroups.onUpdated.addListener(() => debouncedRender("tabGroups.onUpdated"));
})();
