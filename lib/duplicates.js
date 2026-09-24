// Find tabs that share the same URL.

// Return the sets of tabs with the same URL, in the order of the first tab of
// each set. Only sets with 2 or more tabs are returned.
export function findDuplicateSets(tabs) {
  const byUrl = new Map();
  for (const tab of tabs) {
    if (!tab.url) continue;
    if (!byUrl.has(tab.url)) byUrl.set(tab.url, []);
    byUrl.get(tab.url).push(tab);
  }
  return [...byUrl]
    .filter(([, set]) => set.length >= 2)
    .map(([url, set]) => ({ url, tabs: set }));
}

// Pick the tab to keep from a set: the active tab in the given window, then
// any active tab, then the first tab.
export function pickTabToKeep(tabs, windowId) {
  return (
    tabs.find((t) => t.active && t.windowId === windowId) ||
    tabs.find((t) => t.active) ||
    tabs[0]
  );
}

// Return the ids of the tabs to close in each set, so one copy stays open.
export function getExtraTabIds(sets, windowId) {
  const ids = [];
  for (const set of sets) {
    const keep = pickTabToKeep(set.tabs, windowId);
    for (const tab of set.tabs) {
      if (tab.id !== keep.id) ids.push(tab.id);
    }
  }
  return ids;
}
