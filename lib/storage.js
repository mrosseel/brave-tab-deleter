/**
 * Load data from chrome storage
 * @param {'sync'|'session'} area - Storage area
 * @param {string} key - Storage key
 * @param {*} defaultValue - Default if not found
 * @returns {Promise<*>}
 */
export async function loadFromStorage(area, key, defaultValue = null) {
  try {
    const storage = area === 'sync' ? chrome.storage.sync : chrome.storage.session;
    const result = await storage.get(key);
    return result[key] !== undefined ? result[key] : defaultValue;
  } catch (e) {
    console.error(`Failed to load ${key} from ${area} storage:`, e);
    return defaultValue;
  }
}

/**
 * Save data to chrome storage
 * @param {'sync'|'session'} area - Storage area
 * @param {string} key - Storage key
 * @param {*} value - Value to save
 * @returns {Promise<boolean>} Success
 */
export async function saveToStorage(area, key, value) {
  try {
    const storage = area === 'sync' ? chrome.storage.sync : chrome.storage.session;
    await storage.set({ [key]: value });
    return true;
  } catch (e) {
    console.error(`Failed to save ${key} to ${area} storage:`, e);
    return false;
  }
}

/**
 * Remove data from chrome storage
 * @param {'sync'|'session'} area - Storage area
 * @param {string} key - Storage key
 * @returns {Promise<boolean>} Success
 */
export async function removeFromStorage(area, key) {
  try {
    const storage = area === 'sync' ? chrome.storage.sync : chrome.storage.session;
    await storage.remove(key);
    return true;
  } catch (e) {
    console.error(`Failed to remove ${key} from ${area} storage:`, e);
    return false;
  }
}
