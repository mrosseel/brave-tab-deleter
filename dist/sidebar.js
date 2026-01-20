(() => {
  // shared.js
  var TAB_COLORS = {
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
    return TAB_COLORS[colorName] || TAB_COLORS.grey;
  }

  // lib/drag-position.js
  function calculateTargetIndex(currentIndex, nextTabIndex, prevTabIndex) {
    let targetIndex = null;
    if (nextTabIndex !== null) {
      targetIndex = nextTabIndex;
      if (currentIndex < targetIndex) {
        targetIndex -= 1;
      }
    } else if (prevTabIndex !== null) {
      targetIndex = prevTabIndex + 1;
      if (currentIndex < targetIndex) {
        targetIndex -= 1;
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

  // sidebar.js
  var tabListEl = document.getElementById("tab-list");
  var settingsBtn = document.getElementById("settings-btn");
  var collapseAllBtn = document.getElementById("collapse-all-btn");
  var expandAllBtn = document.getElementById("expand-all-btn");
  var refreshBtn = document.getElementById("refresh-btn");
  settingsBtn.addEventListener("click", () => {
    window.location.href = "settings.html";
  });
  refreshBtn.addEventListener("click", () => {
    render("manual-refresh", true);
  });
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
  var otherCollapsed = false;
  var ghostGroups = /* @__PURE__ */ new Map();
  var GHOST_GROUP_SECONDS = 15;
  async function loadGhostGroups() {
    try {
      const result = await chrome.storage.session.get("ghostGroups");
      if (result.ghostGroups) {
        ghostGroups = new Map(result.ghostGroups);
      }
    } catch (e) {
      console.error("Failed to load ghostGroups:", e);
    }
  }
  async function saveGhostGroups() {
    try {
      await chrome.storage.session.set({ ghostGroups: [...ghostGroups.entries()] });
    } catch (e) {
      console.error("Failed to save ghostGroups:", e);
    }
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
        if (ghost) {
          ghostTabs.push(tab);
        } else {
          ungroupedTabs.push(tab);
        }
      } else if (ghost && tab.groupId !== ghost.originalGroupId) {
        ghostTabs.push(tab);
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
      const tabIds = tabs.map((t) => `${t.id}:${t.active}:${t.title}`).join(",");
      parts.push(`g${groupId}:${group?.collapsed}:${group?.title}:${tabIds}`);
    }
    const ungroupedIds = ungroupedTabs.map((t) => `${t.id}:${t.active}:${t.title}`).join(",");
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
    const title = document.createElement("span");
    title.className = "tab-title";
    title.textContent = tab.title || tab.url || "New Tab";
    title.title = tab.title || tab.url || "New Tab";
    div.appendChild(closeBtn);
    div.appendChild(favicon);
    div.appendChild(title);
    div.addEventListener("click", () => {
      chrome.tabs.update(tab.id, { active: true });
    });
    return div;
  }
  function createGroupElement(groupId, groupInfo, tabs, isUngrouped = false, isGhost = false, ghostExpiresAt = null, positionIndex = 0) {
    const container = document.createElement("div");
    container.className = "tab-group" + (isGhost ? " ghost-group" : "");
    container.dataset.groupId = groupId;
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
    const rightSection = document.createElement("span");
    rightSection.className = "header-right";
    if (isGhost && ghostExpiresAt) {
      const remainingSeconds = Math.max(0, Math.ceil((ghostExpiresAt - Date.now()) / 1e3));
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
    header.appendChild(collapseIcon);
    header.appendChild(groupName);
    header.appendChild(rightSection);
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
            ghostGroups.set(otherTab.id, {
              title: groupInfo.title || "",
              color: groupInfo.color,
              originalGroupId: groupInfo.id,
              positionIndex,
              expiresAt: Date.now() + GHOST_GROUP_SECONDS * 1e3
            });
            saveGhostGroups();
          };
        }
      }
      tabsContainer.appendChild(createTabElement(tab, isGhost ? groupInfo : null, onClose));
    });
    header.addEventListener("click", async (e) => {
      if (e.target.closest(".close-group-btn")) return;
      if (isUngrouped) {
        otherCollapsed = !otherCollapsed;
        header.classList.toggle("collapsed", otherCollapsed);
        tabsContainer.classList.toggle("collapsed", otherCollapsed);
      } else if (groupInfo && groupInfo.id) {
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
    render("initial", true);
  })();
  setInterval(() => {
    if (ghostGroups.size === 0) return;
    const now = Date.now();
    let needsFullRender = false;
    for (const [tabId, ghost] of ghostGroups.entries()) {
      if (now >= ghost.expiresAt) {
        ghostGroups.delete(tabId);
        needsFullRender = true;
      } else {
        const remainingSeconds = Math.ceil((ghost.expiresAt - now) / 1e3);
        const countdownEl = document.querySelector(`[data-group-id="ghost-${tabId}"] .countdown`);
        if (countdownEl) {
          countdownEl.textContent = `${remainingSeconds}s`;
        }
      }
    }
    if (needsFullRender) {
      saveGhostGroups();
      render("ghost-expired");
    }
  }, 1e3);
  chrome.tabs.onCreated.addListener(() => debouncedRender("tabs.onCreated"));
  chrome.tabs.onRemoved.addListener((tabId) => {
    ghostGroups.delete(tabId);
    saveGhostGroups();
    debouncedRender("tabs.onRemoved");
  });
  chrome.tabs.onUpdated.addListener(() => debouncedRender("tabs.onUpdated"));
  chrome.tabs.onMoved.addListener(() => debouncedRender("tabs.onMoved"));
  chrome.tabs.onActivated.addListener(() => debouncedRender("tabs.onActivated"));
  chrome.tabGroups.onCreated.addListener(() => debouncedRender("tabGroups.onCreated"));
  chrome.tabGroups.onRemoved.addListener(() => debouncedRender("tabGroups.onRemoved"));
  chrome.tabGroups.onUpdated.addListener(() => debouncedRender("tabGroups.onUpdated"));
})();
