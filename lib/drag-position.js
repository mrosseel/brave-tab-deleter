/**
 * Calculate the target index for a tab move operation.
 *
 * Chrome's move API: when you move a tab to index N, tabs at N and above shift right.
 * But when the moved tab is removed from its original position, tabs after it shift left.
 * This function accounts for both effects.
 *
 * @param {number} currentIndex - Current index of the tab being moved
 * @param {number|null} nextTabIndex - Index of the tab that should come AFTER the moved tab (null if none)
 * @param {number|null} prevTabIndex - Index of the tab that should come BEFORE the moved tab (null if none)
 * @param {number} count - Number of tabs being moved (default 1)
 * @returns {number|null} - Target index for chrome.tabs.move, or null if no move needed
 */
export function calculateTargetIndex(currentIndex, nextTabIndex, prevTabIndex, count = 1) {
  let targetIndex = null;

  if (nextTabIndex !== null) {
    // We want to be directly before nextTab
    targetIndex = nextTabIndex;
    // If we're currently before nextTab, after removal of 'count' tabs they shift left
    if (currentIndex < targetIndex) {
      targetIndex -= count;
    }
  } else if (prevTabIndex !== null) {
    // We want to be directly after prevTab
    targetIndex = prevTabIndex + 1;
    // If we're currently before the target position, adjust
    if (currentIndex < targetIndex) {
      targetIndex -= count;
    }
  }

  // No move needed if already at target
  if (targetIndex === currentIndex) {
    return null;
  }

  return targetIndex;
}

/**
 * Determine drop position relative to a target element based on mouse Y coordinate.
 *
 * @param {number} mouseY - Mouse Y coordinate (e.g., from event.clientY)
 * @param {number} elementTop - Top of the target element (e.g., from getBoundingClientRect().top)
 * @param {number} elementHeight - Height of the target element
 * @returns {'before'|'after'} - Whether to insert before or after the target element
 */
export function getDropPosition(mouseY, elementTop, elementHeight) {
  const midY = elementTop + elementHeight / 2;
  return mouseY < midY ? 'before' : 'after';
}
