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
  function getGroupColor(group) {
    return GROUP_COLORS[group.color] || GROUP_COLORS.grey;
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
  function getGhostRemainingSeconds(ghost, now = Date.now()) {
    return Math.max(0, Math.ceil((ghost.expiresAt - now) / 1e3));
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
    render("manual-refresh");
  });
  collapseAllBtn.addEventListener("click", () => {
    document.querySelectorAll(".tab-group").forEach((group) => {
      const groupId = group.dataset.groupId;
      collapsedGroups.add(groupId);
      group.querySelector(".group-header")?.classList.add("collapsed");
      group.querySelector(".group-tabs")?.classList.add("collapsed");
    });
  });
  expandAllBtn.addEventListener("click", () => {
    collapsedGroups.clear();
    document.querySelectorAll(".tab-group").forEach((group) => {
      group.querySelector(".group-header")?.classList.remove("collapsed");
      group.querySelector(".group-tabs")?.classList.remove("collapsed");
    });
  });
  var collapsedGroups = /* @__PURE__ */ new Set();
  var draggedTab = null;
  var draggedGroup = null;
  var ghostGroups = /* @__PURE__ */ new Map();
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
  function debouncedRender(source) {
    if (renderTimeout) {
      clearTimeout(renderTimeout);
    }
    renderTimeout = setTimeout(() => {
      renderTimeout = null;
      render(source);
    }, 50);
  }
  var lastKnownGroupCount = 0;
  async function loadTabs() {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const windowId = tabs.length > 0 ? tabs[0].windowId : chrome.windows.WINDOW_ID_CURRENT;
    const groups = await chrome.tabGroups.query({ windowId });
    const groupMap = /* @__PURE__ */ new Map();
    groups.forEach((group) => {
      groupMap.set(group.id, group);
    });
    const tabsInGroups = tabs.filter((t) => t.groupId !== -1);
    const currentGroupCount = new Set(tabsInGroups.map((t) => t.groupId)).size;
    const isBadData = lastKnownGroupCount > 0 && currentGroupCount === 0;
    if (currentGroupCount > 0) {
      lastKnownGroupCount = currentGroupCount;
    }
    const groupedTabs = /* @__PURE__ */ new Map();
    const ungroupedTabs = [];
    const ghostTabs = [];
    const groupOrder = [];
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
    return { groupedTabs, ungroupedTabs, ghostTabs, groupMap, groupOrder, isBadData };
  }
  function createTabElement(tab, groupInfo, onClose) {
    const div = document.createElement("div");
    div.className = "tab-item" + (tab.active ? " active" : "");
    div.dataset.tabId = tab.id;
    div.draggable = true;
    div.addEventListener("dragstart", (e) => {
      draggedTab = { tabId: tab.id, element: div };
      div.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", tab.id.toString());
      e.stopPropagation();
    });
    div.addEventListener("dragend", () => {
      div.classList.remove("dragging");
      draggedTab = null;
      document.querySelectorAll(".drag-over, .drag-over-empty").forEach((el) => {
        el.classList.remove("drag-over", "drag-over-empty");
      });
    });
    div.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (draggedTab && draggedTab.tabId !== tab.id) {
        div.classList.add("drag-over");
      }
    });
    div.addEventListener("dragleave", () => {
      div.classList.remove("drag-over");
    });
    div.addEventListener("drop", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      div.classList.remove("drag-over");
      if (draggedTab && draggedTab.tabId !== tab.id) {
        const draggedTabId = draggedTab.tabId;
        try {
          const targetTab = await chrome.tabs.get(tab.id);
          await chrome.tabs.move(draggedTabId, { index: targetTab.index });
        } catch (err) {
          console.error("Failed to move tab:", err);
        }
      }
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
      await chrome.tabs.remove(tab.id);
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
    if (!isUngrouped && !isGhost && groupInfo) {
      container.draggable = true;
      container.addEventListener("dragstart", (e) => {
        if (draggedTab) return;
        draggedGroup = { groupId: groupInfo.id, element: container };
        container.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", `group-${groupInfo.id}`);
      });
      container.addEventListener("dragend", () => {
        container.classList.remove("dragging");
        draggedGroup = null;
        document.querySelectorAll(".drag-over").forEach((el) => {
          el.classList.remove("drag-over");
        });
      });
      container.addEventListener("dragover", (e) => {
        e.preventDefault();
        if (draggedGroup && draggedGroup.groupId !== groupInfo.id) {
          container.classList.add("drag-over");
        }
        if (draggedTab) {
          e.stopPropagation();
        }
      });
      container.addEventListener("dragleave", (e) => {
        if (!container.contains(e.relatedTarget)) {
          container.classList.remove("drag-over");
        }
      });
      container.addEventListener("drop", async (e) => {
        e.preventDefault();
        container.classList.remove("drag-over");
        const draggedGroupId = draggedGroup?.groupId;
        const draggedTabId = draggedTab?.tabId;
        if (draggedGroupId && draggedGroupId !== groupInfo.id) {
          try {
            const targetGroupTabs = await chrome.tabs.query({ groupId: groupInfo.id });
            if (targetGroupTabs.length > 0) {
              const draggedGroupTabs = await chrome.tabs.query({ groupId: draggedGroupId });
              if (draggedGroupTabs.length > 0) {
                const targetIndex = Math.min(...targetGroupTabs.map((t) => t.index));
                const tabIds = draggedGroupTabs.map((t) => t.id);
                await chrome.tabs.move(tabIds, { index: targetIndex });
              }
            }
          } catch (err) {
            console.error("Failed to reorder groups:", err);
          }
        }
        if (draggedTabId) {
          try {
            await chrome.tabs.group({ tabIds: draggedTabId, groupId: groupInfo.id });
          } catch (err) {
            console.error("Failed to move tab to group:", err);
          }
        }
      });
    }
    const header = document.createElement("div");
    header.className = "group-header" + (collapsedGroups.has(groupId) ? " collapsed" : "");
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
      const remainingSeconds = getGhostRemainingSeconds({ expiresAt: ghostExpiresAt });
      const countdownEl = document.createElement("span");
      countdownEl.className = "countdown";
      countdownEl.textContent = `${remainingSeconds}s`;
      countdownEl.title = "Tab will move to Ungrouped when timer expires";
      rightSection.appendChild(countdownEl);
    }
    if (!isUngrouped) {
      const closeGroupBtn = document.createElement("button");
      closeGroupBtn.className = "close-group-btn";
      closeGroupBtn.innerHTML = "&times;";
      closeGroupBtn.title = "Close all tabs in group";
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
    }
    const tabCount = document.createElement("span");
    tabCount.className = "tab-count";
    tabCount.textContent = `(${tabs.length})`;
    rightSection.appendChild(tabCount);
    header.appendChild(collapseIcon);
    header.appendChild(groupName);
    header.appendChild(rightSection);
    const tabsContainer = document.createElement("div");
    tabsContainer.className = "group-tabs" + (collapsedGroups.has(groupId) ? " collapsed" : "");
    tabsContainer.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (draggedTab) {
        tabsContainer.classList.add("drag-over-empty");
      }
    });
    tabsContainer.addEventListener("dragleave", (e) => {
      if (!tabsContainer.contains(e.relatedTarget)) {
        tabsContainer.classList.remove("drag-over-empty");
      }
    });
    tabsContainer.addEventListener("drop", async (e) => {
      e.preventDefault();
      tabsContainer.classList.remove("drag-over-empty");
      const draggedTabId = draggedTab?.tabId;
      if (draggedTabId) {
        try {
          if (isUngrouped) {
            await chrome.tabs.ungroup(draggedTabId);
          } else if (groupInfo && groupInfo.id) {
            await chrome.tabs.group({ tabIds: draggedTabId, groupId: groupInfo.id });
          }
        } catch (err) {
          console.error("Failed to move tab:", err);
        }
      }
    });
    tabs.forEach((tab) => {
      let onClose = null;
      if (!isUngrouped && !isGhost && tabs.length === 2 && groupInfo) {
        const otherTab = tabs.find((t) => t.id !== tab.id);
        if (otherTab) {
          onClose = () => {
            ghostGroups.set(otherTab.id, createGhostEntry(groupInfo, positionIndex));
            saveGhostGroups();
          };
        }
      }
      tabsContainer.appendChild(createTabElement(tab, isGhost ? groupInfo : null, onClose));
    });
    header.addEventListener("click", (e) => {
      if (e.target.closest(".close-group-btn")) return;
      const isCollapsed = collapsedGroups.has(groupId);
      if (isCollapsed) {
        collapsedGroups.delete(groupId);
      } else {
        collapsedGroups.add(groupId);
      }
      header.classList.toggle("collapsed");
      tabsContainer.classList.toggle("collapsed");
    });
    container.appendChild(header);
    container.appendChild(tabsContainer);
    return container;
  }
  var retryTimeout = null;
  async function render(source = "unknown") {
    renderCount++;
    const scrollTop = document.documentElement.scrollTop || document.body.scrollTop;
    const { groupedTabs, ungroupedTabs, ghostTabs, groupMap, groupOrder, isBadData } = await loadTabs();
    if (isBadData) {
      console.log(`[${source}] Bad data detected, scheduling retry...`);
      if (retryTimeout) clearTimeout(retryTimeout);
      retryTimeout = setTimeout(() => {
        retryTimeout = null;
        render("retry");
      }, 100);
      return;
    }
    tabListEl.innerHTML = "";
    if (ungroupedTabs.length > 0) {
      tabListEl.appendChild(createGroupElement("ungrouped", null, ungroupedTabs, true, false, null, -1));
    }
    const renderItems = [];
    groupOrder.forEach((groupId, index) => {
      renderItems.push({
        type: "real",
        groupId,
        tabs: groupedTabs.get(groupId),
        groupInfo: groupMap.get(groupId),
        positionIndex: index
      });
    });
    for (const tab of ghostTabs) {
      const ghost = ghostGroups.get(tab.id);
      if (ghost) {
        renderItems.push({
          type: "ghost",
          tab,
          ghost,
          positionIndex: ghost.positionIndex ?? renderItems.length
          // fallback to end if no position
        });
      }
    }
    renderItems.sort((a, b) => {
      if (a.positionIndex !== b.positionIndex) {
        return a.positionIndex - b.positionIndex;
      }
      if (a.type === "ghost" && b.type !== "ghost") return -1;
      if (a.type !== "ghost" && b.type === "ghost") return 1;
      return 0;
    });
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
          // Use current render position for future ghosts
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
  (async () => {
    await loadGhostGroups();
    render("initial");
  })();
  setInterval(() => {
    if (ghostGroups.size > 0) {
      render("interval");
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
