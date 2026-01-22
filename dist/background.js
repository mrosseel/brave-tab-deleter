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
  function getHostname(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.toLowerCase();
    } catch {
      return null;
    }
  }
  function shouldSkipUrl(url) {
    return !url || url === "chrome://newtab/" || url === "about:blank" || url.startsWith("chrome://") || url.startsWith("chrome-extension://");
  }

  // lib/lock.js
  function createLock() {
    let locked = false;
    let queue = [];
    function processQueue() {
      if (queue.length > 0 && !locked) {
        locked = true;
        const next = queue.shift();
        next().finally(() => {
          locked = false;
          processQueue();
        });
      }
    }
    return async function withLock(fn) {
      if (locked) {
        return new Promise((resolve, reject) => {
          queue.push(async () => {
            try {
              const result = await fn();
              resolve(result);
            } catch (err) {
              reject(err);
            }
          });
        });
      }
      locked = true;
      try {
        return await fn();
      } finally {
        locked = false;
        processQueue();
      }
    };
  }

  // lib/colors.js
  var ALL_COLOR_NAMES = ["blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange", "grey"];
  function findAvailableColor(usedColors, reservedColors = /* @__PURE__ */ new Set()) {
    for (const color of ALL_COLOR_NAMES) {
      if (!usedColors.has(color) && !reservedColors.has(color)) {
        return color;
      }
    }
    for (const color of ALL_COLOR_NAMES) {
      if (!usedColors.has(color)) {
        return color;
      }
    }
    return "blue";
  }

  // background.js
  console.log("=== BACKGROUND.JS VERSION 6 LOADED ===");
  var sidebarOpen = /* @__PURE__ */ new Map();
  var settings = {
    autoGrouping: false,
    autoOrdering: false,
    autoOrderingSeconds: 5,
    customGrouping: false,
    customGroups: []
  };
  var tabActivationTimes = /* @__PURE__ */ new Map();
  var autoGroupIds = /* @__PURE__ */ new Set();
  async function loadAutoGroupIds() {
    const stored = await chrome.storage.session.get("autoGroupIds");
    autoGroupIds = new Set(stored.autoGroupIds || []);
  }
  async function saveAutoGroupIds() {
    await chrome.storage.session.set({ autoGroupIds: [...autoGroupIds] });
  }
  function markAsAutoGroup(groupId) {
    autoGroupIds.add(groupId);
    saveAutoGroupIds();
  }
  function isAutoGroupId(groupId) {
    return autoGroupIds.has(groupId);
  }
  async function checkAndUpdateGroupStatus(groupId) {
    try {
      const group = await chrome.tabGroups.get(groupId);
      const tabs = await chrome.tabs.query({ groupId });
      if (tabs.length < 2) {
        if (isAutoGroupId(groupId)) {
          autoGroupIds.delete(groupId);
          saveAutoGroupIds();
        }
        return false;
      }
      const firstDomain = getDomain(tabs[0].url);
      const allSameDomain = tabs.every((t) => getDomain(t.url) === firstDomain);
      const titleMatches = group.title === getShortName(firstDomain);
      if (allSameDomain && titleMatches) {
        if (!isAutoGroupId(groupId)) {
          markAsAutoGroup(groupId);
        }
        return true;
      } else {
        if (isAutoGroupId(groupId)) {
          autoGroupIds.delete(groupId);
          saveAutoGroupIds();
        }
        return false;
      }
    } catch {
      autoGroupIds.delete(groupId);
      saveAutoGroupIds();
      return false;
    }
  }
  var withGroupingLock = createLock();
  async function loadSettings() {
    const stored = await chrome.storage.sync.get("settings");
    if (stored.settings) {
      settings = { ...settings, ...stored.settings };
    }
  }
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "settingsUpdated") {
      settings = message.settings;
    } else if (message.type === "sidebarOpened") {
      withGroupingLock(() => applyAutoGroupingToAll());
    }
  });
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "sync" && changes.settings) {
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
    console.log("[bg] findCustomGroupForHostname:", hostname, "customGrouping:", settings.customGrouping, "groups:", settings.customGroups);
    if (!settings.customGrouping || !settings.customGroups) return null;
    for (const group of settings.customGroups) {
      for (const pattern of group.domains) {
        const exactMatch = hostname === pattern;
        const suffixMatch = hostname.endsWith("." + pattern);
        console.log("[bg] Checking pattern:", pattern, "against:", hostname, "exact:", exactMatch, "suffix:", suffixMatch);
        if (exactMatch || suffixMatch) {
          console.log("[bg] MATCH! Returning group:", group.name);
          return group;
        }
      }
    }
    console.log("[bg] No match found");
    return null;
  }
  async function findGroupByTitleAndColor(windowId, title, color) {
    const groups = await chrome.tabGroups.query({ windowId });
    return groups.find((g) => g.title === title && g.color === color);
  }
  async function findAutoGroupForDomain(windowId, domain) {
    const expectedTitle = getShortName(domain);
    const groups = await chrome.tabGroups.query({ windowId });
    return groups.find((g) => g.title === expectedTitle);
  }
  function getCustomGroupColors() {
    if (!settings.customGrouping || !settings.customGroups) return /* @__PURE__ */ new Set();
    return new Set(settings.customGroups.map((g) => g.color));
  }
  async function getNextAvailableColor(windowId) {
    const groups = await chrome.tabGroups.query({ windowId });
    const usedColors = new Set(groups.map((g) => g.color));
    return findAvailableColor(usedColors, getCustomGroupColors());
  }
  async function ensureColorForCustomGroup(windowId, customGroupTitle, desiredColor) {
    const groups = await chrome.tabGroups.query({ windowId });
    const conflictingGroup = groups.find((g) => g.color === desiredColor && g.title !== customGroupTitle);
    if (conflictingGroup) {
      const usedColors = new Set(groups.map((g) => g.color));
      usedColors.add(desiredColor);
      const newColor = findAvailableColor(usedColors, getCustomGroupColors());
      if (newColor !== desiredColor) {
        console.log(`[bg] Swapping color: ${conflictingGroup.title} from ${desiredColor} to ${newColor}`);
        await chrome.tabGroups.update(conflictingGroup.id, { color: newColor });
      }
    }
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
        if (existingGroup) {
          if (currentTab.groupId !== existingGroup.id) {
            await chrome.tabs.group({ tabIds: currentTab.id, groupId: existingGroup.id });
          }
        } else {
          await ensureColorForCustomGroup(currentTab.windowId, customGroup.name, customGroup.color);
          const groupId = await chrome.tabs.group({ tabIds: currentTab.id });
          await chrome.tabGroups.update(groupId, { title: customGroup.name, color: customGroup.color });
        }
        return;
      }
    }
    if (settings.autoGrouping) {
      const existingAutoGroup = await findAutoGroupForDomain(currentTab.windowId, domain);
      if (existingAutoGroup) {
        if (currentTab.groupId !== existingAutoGroup.id) {
          await chrome.tabs.group({ tabIds: currentTab.id, groupId: existingAutoGroup.id });
        }
        return;
      }
      const allTabs = await chrome.tabs.query({ windowId: currentTab.windowId });
      const sameDomainTabs = allTabs.filter(
        (t) => t.id !== currentTab.id && t.groupId === -1 && getDomain(t.url) === domain
      );
      if (sameDomainTabs.length >= 1) {
        const tabIds = [currentTab.id, ...sameDomainTabs.map((t) => t.id)];
        const groupId = await chrome.tabs.group({ tabIds });
        const color = await getNextAvailableColor(currentTab.windowId);
        await chrome.tabGroups.update(groupId, { title: getShortName(domain), color });
        markAsAutoGroup(groupId);
        return;
      }
    }
    if (currentTab.groupId !== -1) {
      const groupId = currentTab.groupId;
      const groupTabs = await chrome.tabs.query({ groupId });
      const otherTabs = groupTabs.filter((t) => t.id !== currentTab.id);
      if (otherTabs.length > 0) {
        const otherDomains = new Set(otherTabs.map((t) => getDomain(t.url)));
        if (otherDomains.size > 1) {
          if (isAutoGroupId(groupId)) {
            autoGroupIds.delete(groupId);
            saveAutoGroupIds();
          }
          return;
        }
      }
      await chrome.tabs.ungroup(currentTab.id);
      if (otherTabs.length >= 2) {
        await checkAndUpdateGroupStatus(groupId);
      }
    }
  }
  async function applyAutoGroupingToAll() {
    if (!settings.autoGrouping && !settings.customGrouping) return;
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const groups = await chrome.tabGroups.query({ windowId: chrome.windows.WINDOW_ID_CURRENT });
    const otherGroup = groups.find((g) => g.title === "Other" && g.color === "grey");
    const otherGroupId = otherGroup?.id;
    const customGroupTitles = new Set((settings.customGroups || []).map((g) => g.name));
    const customGroupIds = new Set(groups.filter((g) => customGroupTitles.has(g.title)).map((g) => g.id));
    let hasWork = false;
    if (settings.customGrouping) {
      for (const tab of tabs) {
        if (tab.groupId !== -1 && tab.groupId !== otherGroupId && customGroupIds.has(tab.groupId)) continue;
        if (shouldSkipUrl(tab.url)) continue;
        const hostname = getHostname(tab.url);
        if (!hostname) continue;
        if (findCustomGroupForHostname(hostname)) {
          hasWork = true;
          break;
        }
      }
    }
    if (!hasWork && settings.autoGrouping) {
      const domainCounts = /* @__PURE__ */ new Map();
      for (const tab of tabs) {
        if (tab.groupId !== -1 && tab.groupId !== otherGroupId) continue;
        if (shouldSkipUrl(tab.url)) continue;
        const domain = getDomain(tab.url);
        if (!domain) continue;
        const hostname = getHostname(tab.url);
        if (settings.customGrouping && hostname && findCustomGroupForHostname(hostname)) continue;
        domainCounts.set(domain, (domainCounts.get(domain) || 0) + 1);
      }
      for (const [domain, count] of domainCounts) {
        const existingGroup = groups.find((g) => g.title === getShortName(domain));
        if (existingGroup || count >= 2) {
          hasWork = true;
          break;
        }
      }
    }
    if (!hasWork) return;
    if (settings.customGrouping) {
      const customGroupBatches = /* @__PURE__ */ new Map();
      for (const tab of tabs) {
        if (tab.groupId !== -1 && tab.groupId !== otherGroupId && customGroupIds.has(tab.groupId)) continue;
        if (shouldSkipUrl(tab.url)) continue;
        const hostname = getHostname(tab.url);
        if (!hostname) continue;
        const customGroup = findCustomGroupForHostname(hostname);
        if (customGroup) {
          const key = `${customGroup.name}:${customGroup.color}`;
          if (!customGroupBatches.has(key)) {
            customGroupBatches.set(key, { config: customGroup, tabIds: [] });
          }
          customGroupBatches.get(key).tabIds.push(tab.id);
        }
      }
      for (const [key, { config, tabIds }] of customGroupBatches) {
        const existingGroup = await findGroupByTitleAndColor(tabs[0].windowId, config.name, config.color);
        if (existingGroup) {
          await chrome.tabs.group({ tabIds, groupId: existingGroup.id });
        } else {
          await ensureColorForCustomGroup(tabs[0].windowId, config.name, config.color);
          const groupId = await chrome.tabs.group({ tabIds });
          await chrome.tabGroups.update(groupId, { title: config.name, color: config.color });
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
          const tabsToAdd = domainTabs.filter((t) => t.groupId !== existingGroup.id);
          if (tabsToAdd.length > 0) {
            const tabIds = tabsToAdd.map((t) => t.id);
            await chrome.tabs.group({ tabIds, groupId: existingGroup.id });
          }
        } else if (domainTabs.length >= 2) {
          const tabIds = domainTabs.map((t) => t.id);
          const groupId = await chrome.tabs.group({ tabIds });
          const color = await getNextAvailableColor(domainTabs[0].windowId);
          await chrome.tabGroups.update(groupId, { title: displayName, color });
          markAsAutoGroup(groupId);
        }
      }
    }
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
  chrome.tabs.onCreated.addListener(updateBadge);
  chrome.tabs.onRemoved.addListener(updateBadge);
  chrome.windows.onFocusChanged.addListener(updateBadge);
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
  chrome.tabGroups.onRemoved.addListener((group) => {
    if (autoGroupIds.has(group.id)) {
      autoGroupIds.delete(group.id);
      saveAutoGroupIds();
    }
  });
  setInterval(() => {
    if (settings.autoOrdering) {
      chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
        if (tabs[0]) checkAutoOrdering(tabs[0].id);
      });
    }
  }, 1e3);
  async function init() {
    await loadSettings();
    await loadAutoGroupIds();
    updateBadge();
  }
  init();
})();
