/**
 * Find matching custom group for a domain
 * @param {string} domain - The domain to match
 * @param {Array} customGroups - Array of custom group objects
 * @param {boolean} customGroupingEnabled - Whether custom grouping is enabled
 * @returns {Object|null} Matching custom group or null
 */
export function findCustomGroupForDomain(domain, customGroups, customGroupingEnabled) {
  if (!customGroupingEnabled || !customGroups) return null;

  for (const group of customGroups) {
    for (const pattern of group.domains) {
      // Check if domain matches or ends with the pattern
      if (domain === pattern || domain.endsWith('.' + pattern)) {
        return group;
      }
    }
  }
  return null;
}

/**
 * Filter tabs that are eligible for auto-grouping
 * @param {Array} tabs - Array of tab objects
 * @param {Function} getDomainFn - Function to extract domain from URL
 * @returns {Array} Filtered tabs
 */
export function filterGroupableTabs(tabs, getDomainFn) {
  return tabs.filter(tab => {
    if (tab.groupId !== -1) return false;
    if (!tab.url) return false;
    if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) return false;
    if (tab.url === 'chrome://newtab/' || tab.url === 'about:blank') return false;
    return getDomainFn(tab.url) !== null;
  });
}

/**
 * Group tabs by their domain
 * @param {Array} tabs - Array of tab objects
 * @param {Function} getDomainFn - Function to extract domain from URL
 * @returns {Map} Map of domain -> [tabs]
 */
export function groupTabsByDomain(tabs, getDomainFn) {
  const domainMap = new Map();
  for (const tab of tabs) {
    const domain = getDomainFn(tab.url);
    if (domain) {
      if (!domainMap.has(domain)) {
        domainMap.set(domain, []);
      }
      domainMap.get(domain).push(tab);
    }
  }
  return domainMap;
}

/**
 * Check if there are enough tabs to create a group
 * @param {number} tabCount - Number of tabs
 * @returns {boolean}
 */
export function shouldCreateGroup(tabCount) {
  return tabCount >= 2;
}
