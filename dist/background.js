(() => {
  // shared.js
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
  function getHostname(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.toLowerCase();
    } catch {
      return null;
    }
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
  function shouldSkipUrl(url) {
    return !url || url === "chrome://newtab/" || url === "about:blank" || url.startsWith("chrome://") || url.startsWith("chrome-extension://");
  }

  // background.js
  console.log("=== BACKGROUND.JS VERSION 2 LOADED ===");
  var sidebarOpen = /* @__PURE__ */ new Map();
  var settings = {
    autoGrouping: false,
    autoOrdering: false,
    autoOrderingSeconds: 5,
    customGrouping: false,
    customGroups: []
  };
  var tabActivationTimes = /* @__PURE__ */ new Map();
  var groupingLock = false;
  var groupingQueue = [];
  async function withGroupingLock(fn) {
    if (groupingLock) {
      return new Promise((resolve) => {
        groupingQueue.push(async () => {
          const result = await fn();
          resolve(result);
        });
      });
    }
    groupingLock = true;
    try {
      return await fn();
    } finally {
      groupingLock = false;
      if (groupingQueue.length > 0) {
        const next = groupingQueue.shift();
        next();
      }
    }
  }
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
    } else if (message.type === "sidebarOpened") {
      console.log("Sidebar opened, applying auto-grouping...");
      withGroupingLock(() => applyAutoGroupingToAll());
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
    chrome.action.setBadgeText({ text: tabs.length.toString() });
    chrome.action.setBadgeBackgroundColor({ color: "#6366f1" });
  }
  function findCustomGroupForHostname(hostname) {
    if (!settings.customGrouping || !settings.customGroups) return null;
    for (const group of settings.customGroups) {
      for (const pattern of group.domains) {
        if (hostname === pattern || hostname.endsWith("." + pattern)) {
          return group;
        }
      }
    }
    return null;
  }
  async function findGroupByTitleAndColor(windowId, title, color) {
    const groups = await chrome.tabGroups.query({ windowId });
    return groups.find((g) => g.title === title && g.color === color);
  }
  async function findAutoGroupForDomain(windowId, domain) {
    const expectedTitle = getShortName(domain);
    const groups = await chrome.tabGroups.query({ windowId });
    return groups.find((g) => g.title === expectedTitle && g.color === "blue");
  }
  async function groupSingleTab(tab) {
    if (shouldSkipUrl(tab.url)) return;
    const domain = getDomain(tab.url);
    if (!domain) return;
    let currentTab;
    try {
      currentTab = await chrome.tabs.get(tab.id);
    } catch {
      return;
    }
    const hostname = getHostname(tab.url);
    if (settings.customGrouping && hostname) {
      const customGroup = findCustomGroupForHostname(hostname);
      if (customGroup) {
        const existingGroup = await findGroupByTitleAndColor(currentTab.windowId, customGroup.name, customGroup.color);
        if (existingGroup && currentTab.groupId !== existingGroup.id) {
          await chrome.tabs.group({ tabIds: currentTab.id, groupId: existingGroup.id });
        } else if (!existingGroup) {
          const groupId = await chrome.tabs.group({ tabIds: currentTab.id });
          await chrome.tabGroups.update(groupId, { title: customGroup.name, color: customGroup.color });
        }
        return;
      }
    }
    if (currentTab.groupId !== -1) return;
    if (settings.autoGrouping) {
      const existingGroup = await findAutoGroupForDomain(currentTab.windowId, domain);
      if (existingGroup) {
        await chrome.tabs.group({ tabIds: currentTab.id, groupId: existingGroup.id });
      } else {
        const allTabs = await chrome.tabs.query({ windowId: currentTab.windowId });
        const sameDomainUngrouped = allTabs.filter(
          (t) => t.id !== currentTab.id && t.groupId === -1 && getDomain(t.url) === domain
        );
        if (sameDomainUngrouped.length >= 1) {
          const tabIds = [currentTab.id, ...sameDomainUngrouped.map((t) => t.id)];
          const groupId = await chrome.tabs.group({ tabIds });
          await chrome.tabGroups.update(groupId, {
            title: getShortName(domain),
            color: "blue"
          });
        }
      }
    }
  }
  async function applyAutoGroupingToAll() {
    if (!settings.autoGrouping && !settings.customGrouping) return;
    console.log("applyAutoGroupingToAll: starting...");
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const groups = await chrome.tabGroups.query({ windowId: chrome.windows.WINDOW_ID_CURRENT });
    const otherGroup = groups.find((g) => g.title === "Other" && g.color === "grey");
    const otherGroupId = otherGroup?.id;
    const autoGroupIds = new Set(groups.filter((g) => g.color === "blue").map((g) => g.id));
    console.log("customGrouping enabled:", settings.customGrouping, "groups:", settings.customGroups);
    if (settings.customGrouping) {
      for (const tab of tabs) {
        if (shouldSkipUrl(tab.url)) continue;
        const hostname = getHostname(tab.url);
        if (!hostname) continue;
        const customGroup = findCustomGroupForHostname(hostname);
        console.log("Tab hostname:", hostname, "-> customGroup:", customGroup?.name || "none");
        if (customGroup) {
          const existingCustomGroup = await findGroupByTitleAndColor(tab.windowId, customGroup.name, customGroup.color);
          const shouldMove = tab.groupId === -1 || tab.groupId === otherGroupId || autoGroupIds.has(tab.groupId);
          if (shouldMove && tab.groupId !== existingCustomGroup?.id) {
            if (existingCustomGroup) {
              await chrome.tabs.group({ tabIds: tab.id, groupId: existingCustomGroup.id });
            } else {
              const groupId = await chrome.tabs.group({ tabIds: tab.id });
              await chrome.tabGroups.update(groupId, { title: customGroup.name, color: customGroup.color });
            }
          }
        }
      }
    }
    if (settings.autoGrouping) {
      const updatedTabs = await chrome.tabs.query({ currentWindow: true });
      const domainMap = /* @__PURE__ */ new Map();
      for (const tab of updatedTabs) {
        if (tab.groupId !== -1 && tab.groupId !== otherGroupId) continue;
        if (shouldSkipUrl(tab.url)) continue;
        const domain = getDomain(tab.url);
        if (!domain) continue;
        const hostname = getHostname(tab.url);
        if (settings.customGrouping && hostname && findCustomGroupForHostname(hostname)) continue;
        if (!domainMap.has(domain)) {
          domainMap.set(domain, []);
        }
        domainMap.get(domain).push(tab);
      }
      for (const [domain, domainTabs] of domainMap.entries()) {
        const displayName = getShortName(domain);
        const existingGroup = await findAutoGroupForDomain(domainTabs[0].windowId, domain);
        if (existingGroup) {
          const tabIds = domainTabs.map((t) => t.id);
          await chrome.tabs.group({ tabIds, groupId: existingGroup.id });
          console.log("Added", tabIds.length, "tabs to existing group", displayName);
        } else if (domainTabs.length >= 2) {
          const tabIds = domainTabs.map((t) => t.id);
          const groupId = await chrome.tabs.group({ tabIds });
          await chrome.tabGroups.update(groupId, { title: displayName, color: "blue" });
          console.log("Created new group", displayName, "with", tabIds.length, "tabs");
        }
      }
    }
    console.log("applyAutoGroupingToAll: complete");
  }
  async function checkAutoOrdering(tabId) {
    if (!settings.autoOrdering) return;
    const activationTime = tabActivationTimes.get(tabId);
    if (!activationTime) return;
    const elapsedSeconds = (Date.now() - activationTime) / 1e3;
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
  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status !== "complete") return;
    if (shouldSkipUrl(tab.url)) return;
    withGroupingLock(() => groupSingleTab(tab));
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    tabActivationTimes.delete(tabId);
  });
  setInterval(() => {
    if (settings.autoOrdering) {
      chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
        if (tabs[0]) checkAutoOrdering(tabs[0].id);
      });
    }
  }, 1e3);
  chrome.tabs.onCreated.addListener(updateBadge);
  chrome.tabs.onRemoved.addListener(updateBadge);
  chrome.windows.onFocusChanged.addListener(updateBadge);
  chrome.tabGroups.onRemoved.addListener(async (group) => {
    console.log("!!! GROUP DESTROYED:", group.id, "title:", group.title, "color:", group.color);
    if (!group.title || group.title === "Other") return;
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const customGroup = settings.customGroups?.find((g) => g.name === group.title && g.color === group.color);
    if (customGroup && settings.customGrouping) {
      const matchingTabs = tabs.filter((t) => {
        if (t.groupId !== -1) return false;
        if (shouldSkipUrl(t.url)) return false;
        const hostname = getHostname(t.url);
        if (!hostname) return false;
        return customGroup.domains.some(
          (pattern) => hostname === pattern || hostname.endsWith("." + pattern)
        );
      });
      if (matchingTabs.length >= 1) {
        console.log("Recovering custom group:", group.title, "with", matchingTabs.length, "tabs");
        const tabIds = matchingTabs.map((t) => t.id);
        const newGroupId = await chrome.tabs.group({ tabIds });
        await chrome.tabGroups.update(newGroupId, { title: group.title, color: group.color });
      }
      return;
    }
    if (settings.autoGrouping && group.color === "blue") {
      const matchingTabs = tabs.filter(
        (t) => t.groupId === -1 && !shouldSkipUrl(t.url) && getShortName(getDomain(t.url)) === group.title
      );
      if (matchingTabs.length >= 2) {
        console.log("Recovering auto group:", group.title, "with", matchingTabs.length, "tabs");
        const tabIds = matchingTabs.map((t) => t.id);
        const newGroupId = await chrome.tabs.group({ tabIds });
        await chrome.tabGroups.update(newGroupId, { title: group.title, color: group.color });
      }
    }
  });
  chrome.tabGroups.onUpdated.addListener((group) => {
    console.log("GROUP UPDATED:", group.id, "title:", group.title, "color:", group.color);
  });
  chrome.tabGroups.onCreated.addListener((group) => {
    console.log("GROUP CREATED:", group.id);
  });
  async function init() {
    await loadSettings();
    updateBadge();
  }
  init();
})();
