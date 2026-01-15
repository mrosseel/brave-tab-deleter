(() => {
  // lib/domain.js
  var TWO_PART_TLDS = [
    "co.uk",
    "com.au",
    "co.nz",
    "co.jp",
    "com.br",
    "co.kr",
    "co.in",
    "org.uk",
    "net.au",
    "com.mx"
  ];
  function isIPAddress(hostname) {
    const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
    const ipv6Pattern = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
    return ipv4Pattern.test(hostname) || ipv6Pattern.test(hostname);
  }
  function getShortName(domain) {
    if (isIPAddress(domain)) {
      return domain;
    }
    const parts = domain.split(".");
    if (parts.length >= 2) {
      const lastTwo = parts.slice(-2).join(".");
      if (TWO_PART_TLDS.includes(lastTwo) && parts.length >= 3) {
        return parts.slice(0, -2).join(".");
      }
      return parts.slice(0, -1).join(".");
    }
    return domain;
  }
  function getDomain(url) {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname.toLowerCase();
      if (isIPAddress(hostname)) {
        return hostname;
      }
      const parts = hostname.split(".");
      if (parts.length <= 2) {
        return hostname;
      }
      const lastTwo = parts.slice(-2).join(".");
      if (TWO_PART_TLDS.includes(lastTwo)) {
        return parts.slice(-3).join(".");
      }
      return parts.slice(-2).join(".");
    } catch {
      return null;
    }
  }

  // lib/groups.js
  function findCustomGroupForDomain(domain, customGroups, customGroupingEnabled) {
    if (!customGroupingEnabled || !customGroups) return null;
    for (const group of customGroups) {
      for (const pattern of group.domains) {
        if (domain === pattern || domain.endsWith("." + pattern)) {
          return group;
        }
      }
    }
    return null;
  }

  // lib/ordering.js
  function shouldReorderTab(tabId, activationTimes, thresholdSeconds, now = Date.now()) {
    const activationTime = activationTimes.get(tabId);
    if (!activationTime) return false;
    const elapsedSeconds = (now - activationTime) / 1e3;
    return elapsedSeconds >= thresholdSeconds;
  }
  function findFirstPositionInGroup(groupTabs) {
    if (groupTabs.length < 2) return null;
    const sorted = [...groupTabs].sort((a, b) => a.index - b.index);
    return sorted[0].index;
  }
  function needsReordering(tab, groupTabs) {
    if (groupTabs.length < 2) return false;
    const sorted = [...groupTabs].sort((a, b) => a.index - b.index);
    return tab.id !== sorted[0].id;
  }

  // background.js
  var sidebarOpen = /* @__PURE__ */ new Map();
  var settings = {
    autoGrouping: false,
    autoOrdering: false,
    autoOrderingSeconds: 5,
    customGrouping: false,
    customGroups: []
  };
  var tabActivationTimes = /* @__PURE__ */ new Map();
  async function loadSettings() {
    const stored = await chrome.storage.sync.get("settings");
    console.log("Loading settings from storage:", stored);
    if (stored.settings) {
      settings = { ...settings, ...stored.settings };
    }
    console.log("Settings after load:", settings);
  }
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "settingsUpdated") {
      console.log("Received settings update message:", message.settings);
      settings = message.settings;
    }
  });
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "sync" && changes.settings) {
      console.log("Storage changed, new settings:", changes.settings.newValue);
      settings = { ...settings, ...changes.settings.newValue };
    }
  });
  chrome.action.onClicked.addListener(async (tab) => {
    const windowId = tab.windowId;
    const isOpen = sidebarOpen.get(windowId) || false;
    if (isOpen) {
      await chrome.storage.session.remove("ghostGroups");
      await chrome.sidePanel.setOptions({ enabled: false });
      await chrome.sidePanel.setOptions({ enabled: true, path: "sidebar.html" });
      sidebarOpen.set(windowId, false);
    } else {
      await chrome.sidePanel.open({ windowId });
      sidebarOpen.set(windowId, true);
    }
  });
  async function updateBadge() {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const count = tabs.length;
    chrome.action.setBadgeText({ text: count.toString() });
    chrome.action.setBadgeBackgroundColor({ color: "#6366f1" });
  }
  async function findOrCreateGroupForDomain(domain, windowId) {
    const groups = await chrome.tabGroups.query({ windowId });
    const tabs = await chrome.tabs.query({ windowId });
    for (const tab of tabs) {
      if (tab.groupId !== -1 && getDomain(tab.url) === domain) {
        return tab.groupId;
      }
    }
    return null;
  }
  async function findOrCreateCustomGroup(customGroup, windowId) {
    const groups = await chrome.tabGroups.query({ windowId });
    const tabs = await chrome.tabs.query({ windowId });
    for (const group of groups) {
      if (group.title === customGroup.name && group.color === customGroup.color) {
        return group.id;
      }
    }
    for (const tab of tabs) {
      if (tab.groupId !== -1) {
        const domain = getDomain(tab.url);
        const matchedGroup = findCustomGroupForDomain(domain, settings.customGroups, settings.customGrouping);
        if (domain && matchedGroup?.id === customGroup.id) {
          const group = groups.find((g) => g.id === tab.groupId);
          if (group && group.title === customGroup.name) {
            return tab.groupId;
          }
        }
      }
    }
    return null;
  }
  async function autoGroupTab(tab) {
    console.log("autoGroupTab called for:", tab.url, "settings.autoGrouping:", settings.autoGrouping, "settings.customGrouping:", settings.customGrouping);
    if (!tab.url || tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://")) {
      console.log("Skipping - chrome URL");
      return;
    }
    const domain = getDomain(tab.url);
    if (!domain) {
      console.log("Skipping - no domain");
      return;
    }
    console.log("Domain:", domain, "Tab groupId:", tab.groupId);
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
        return;
      }
    }
    if (settings.autoGrouping) {
      console.log("Auto-grouping enabled, checking tab...");
      let currentTab;
      try {
        currentTab = await chrome.tabs.get(tab.id);
      } catch (e) {
        console.log("Tab no longer exists");
        return;
      }
      if (currentTab.groupId !== -1) {
        console.log("Tab already in group", currentTab.groupId, "- skipping");
        return;
      }
      const existingGroupId = await findOrCreateGroupForDomain(domain, currentTab.windowId);
      console.log("Existing group for domain:", existingGroupId);
      if (existingGroupId) {
        try {
          const recheckTab = await chrome.tabs.get(tab.id);
          if (recheckTab.groupId === -1) {
            console.log("Adding tab to existing group", existingGroupId);
            await chrome.tabs.group({ tabIds: tab.id, groupId: existingGroupId });
            recentlyGroupedTabs.add(tab.id);
            setTimeout(() => recentlyGroupedTabs.delete(tab.id), 2e3);
          }
        } catch (e) {
          console.log("Tab no longer exists or error:", e);
        }
      } else {
        const allTabs = await chrome.tabs.query({ windowId: currentTab.windowId });
        const sameDomainTabs = allTabs.filter(
          (t) => t.id !== tab.id && t.groupId === -1 && getDomain(t.url) === domain
        );
        console.log("Same domain ungrouped tabs:", sameDomainTabs.length);
        if (sameDomainTabs.length > 0) {
          try {
            const recheckTab = await chrome.tabs.get(tab.id);
            if (recheckTab.groupId !== -1) {
              console.log("Tab was grouped while we were checking, skipping");
              return;
            }
          } catch (e) {
            return;
          }
          const tabIds = [tab.id, ...sameDomainTabs.map((t) => t.id)];
          console.log("Creating new group with tabs:", tabIds);
          try {
            const groupId = await chrome.tabs.group({ tabIds });
            tabIds.forEach((id) => {
              recentlyGroupedTabs.add(id);
              setTimeout(() => recentlyGroupedTabs.delete(id), 2e3);
            });
            const displayName = getShortName(domain);
            await chrome.tabGroups.update(groupId, {
              title: displayName,
              color: "blue"
            });
            console.log("Created group", groupId, "with title", displayName);
          } catch (e) {
            console.log("Error creating group:", e);
          }
        } else {
          console.log("No other tabs with same domain to group with");
        }
      }
    } else {
      console.log("Auto-grouping disabled");
    }
  }
  async function checkAutoOrdering(tabId) {
    if (!settings.autoOrdering) return;
    if (!shouldReorderTab(tabId, tabActivationTimes, settings.autoOrderingSeconds)) return;
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.groupId === -1) return;
      const groupTabs = await chrome.tabs.query({ groupId: tab.groupId });
      if (needsReordering(tab, groupTabs)) {
        const firstIndex = findFirstPositionInGroup(groupTabs);
        if (firstIndex !== null) {
          await chrome.tabs.move(tab.id, { index: firstIndex });
        }
      }
    } catch (e) {
    }
  }
  chrome.tabs.onActivated.addListener(async (activeInfo) => {
    const tabs = await chrome.tabs.query({ windowId: activeInfo.windowId });
    for (const tab of tabs) {
      if (tab.id !== activeInfo.tabId) {
        checkAutoOrdering(tab.id);
      }
    }
    tabActivationTimes.set(activeInfo.tabId, Date.now());
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    tabActivationTimes.delete(tabId);
  });
  var processingTabs = /* @__PURE__ */ new Set();
  var recentlyGroupedTabs = /* @__PURE__ */ new Set();
  var newlyCreatedTabs = /* @__PURE__ */ new Set();
  chrome.tabs.onCreated.addListener((tab) => {
    console.log("Tab created:", tab.id);
    newlyCreatedTabs.add(tab.id);
    setTimeout(() => newlyCreatedTabs.delete(tab.id), 1e4);
  });
  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status !== "complete") return;
    if (!tab.url || tab.url === "chrome://newtab/" || tab.url === "about:blank") return;
    if (tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://")) return;
    if (!newlyCreatedTabs.has(tabId)) {
      console.log("Tab", tabId, "is not newly created, skipping auto-group");
      return;
    }
    if (recentlyGroupedTabs.has(tabId)) {
      console.log("Tab", tabId, "was recently grouped, skipping");
      return;
    }
    if (tab.groupId !== -1) {
      console.log("Tab", tabId, "already in group", tab.groupId, "- skipping onUpdated");
      newlyCreatedTabs.delete(tabId);
      return;
    }
    if (processingTabs.has(tabId)) return;
    console.log("onUpdated processing NEW tab", tabId, tab.url);
    processingTabs.add(tabId);
    try {
      await autoGroupTab(tab);
      newlyCreatedTabs.delete(tabId);
    } finally {
      processingTabs.delete(tabId);
    }
  });
  setInterval(() => {
    if (settings.autoOrdering) {
      chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
        if (tabs[0]) {
          checkAutoOrdering(tabs[0].id);
        }
      });
    }
  }, 1e3);
  chrome.tabs.onCreated.addListener(updateBadge);
  chrome.tabs.onRemoved.addListener(updateBadge);
  chrome.windows.onFocusChanged.addListener(updateBadge);
  async function applyAutoGroupingToAll() {
    if (!settings.autoGrouping && !settings.customGrouping) return;
    console.log("Applying auto-grouping to existing tabs...");
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const domainMap = /* @__PURE__ */ new Map();
    for (const tab of tabs) {
      if (tab.groupId !== -1) continue;
      if (!tab.url || tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://")) continue;
      if (tab.url === "chrome://newtab/" || tab.url === "about:blank") continue;
      const domain = getDomain(tab.url);
      if (!domain) continue;
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
      if (settings.autoGrouping) {
        if (!domainMap.has(domain)) {
          domainMap.set(domain, []);
        }
        domainMap.get(domain).push(tab);
      }
    }
    for (const [domain, domainTabs] of domainMap.entries()) {
      const existingGroupId = await findOrCreateGroupForDomain(domain, domainTabs[0].windowId);
      if (existingGroupId) {
        const tabIds = domainTabs.map((t) => t.id);
        await chrome.tabs.group({ tabIds, groupId: existingGroupId });
        console.log("Added", tabIds.length, "tabs to existing group for", domain);
      } else if (domainTabs.length >= 2) {
        const tabIds = domainTabs.map((t) => t.id);
        const groupId = await chrome.tabs.group({ tabIds });
        const displayName = getShortName(domain);
        await chrome.tabGroups.update(groupId, {
          title: displayName,
          color: "blue"
        });
        console.log("Created new group", displayName, "with", tabIds.length, "tabs");
      }
    }
    console.log("Auto-grouping complete");
  }
  async function init() {
    await loadSettings();
    updateBadge();
    setTimeout(() => {
      applyAutoGroupingToAll();
    }, 1e3);
  }
  init();
})();
