/**
 * Group title abbreviation for collapsed groups.
 *
 * A collapsed tab group renders as a chip sized to its title, so shortening the
 * title is the only way an extension can reclaim tab strip space. Tab widths
 * themselves are laid out by the browser and ignore title length.
 */

const MAX_ABBREV_LENGTH = 3;
const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);

/**
 * Squeeze a title down to a short form: keep the first character, drop vowels
 * from the rest, then cap the length. Falls back to a plain prefix when that
 * leaves too little (e.g. vowel-heavy names like "ikea").
 * @param {string} title - Full group title
 * @param {number} maxLength - Maximum characters to keep
 * @returns {string} Abbreviated title ('' for empty input)
 */
export function abbreviateGroupTitle(title, maxLength = MAX_ABBREV_LENGTH) {
  if (!title) return '';
  const clean = title.trim();
  if (!clean) return '';
  if (clean.length <= maxLength) return clean;

  const [first, ...rest] = [...clean];
  const squeezed = first + rest.filter(ch => !VOWELS.has(ch.toLowerCase())).join('');
  const source = squeezed.length >= maxLength ? squeezed : clean;
  return source.slice(0, maxLength);
}

// Tab strip geometry. Nothing exposes the real strip width, so we estimate it
// from the window width and what the strip has to fit. Values are Chromium's
// approximate minimums: below these the browser starts clipping tabs.
const STRIP_RESERVED_PX = 180;   // Window controls, new-tab button, tab search
const PINNED_TAB_PX = 40;
const MIN_TAB_PX = 56;           // Tabs stop shrinking around here
const GROUP_CHIP_BASE_PX = 34;   // Chip padding + color dot
const GROUP_CHIP_PER_CHAR_PX = 7;

/**
 * Width a group's label chip needs in the strip.
 * @param {string} title - Title as it would be shown
 * @returns {number} Estimated pixels
 */
function groupChipWidth(title) {
  return GROUP_CHIP_BASE_PX + (title ? title.length * GROUP_CHIP_PER_CHAR_PX : 0);
}

/**
 * Estimate whether the tab strip has to clip tabs at this window width.
 *
 * Chromium exposes no strip metrics, so this is a heuristic: it adds up the
 * minimum width every tab and group label needs and compares that to the space
 * the window can give them. Titles are measured as they would be *displayed*.
 *
 * @param {number} windowWidth - Window width in px
 * @param {Array} tabs - Tabs in the window (pinned flag, groupId)
 * @param {Array} groupLabels - Titles the strip would render for groups
 * @returns {boolean} True when the strip is estimated to overflow
 */
export function stripOverflows(windowWidth, tabs, groupLabels = []) {
  if (!windowWidth || windowWidth <= 0) return false;

  let required = STRIP_RESERVED_PX;
  for (const tab of tabs) {
    required += tab.pinned ? PINNED_TAB_PX : MIN_TAB_PX;
  }
  for (const label of groupLabels) {
    required += groupChipWidth(label);
  }
  return required > windowWidth;
}

/**
 * Titles the strip renders for a window's groups. A collapsed group hides its
 * tabs, so only its chip takes space; an expanded group shows chip + tabs.
 * @param {Array} groups - Tab groups with title and collapsed
 * @param {Function} resolveTitle - Maps a group to the title it would show
 * @returns {Array<string>}
 */
export function visibleGroupLabels(groups, resolveTitle) {
  return groups.map(g => resolveTitle(g) ?? g.title ?? '');
}

/**
 * Tabs the strip actually renders — tabs inside a collapsed group are hidden
 * and cost nothing but their group's chip.
 * @param {Array} tabs - All tabs in the window
 * @param {Array} groups - Tab groups with id and collapsed
 * @returns {Array} Tabs that occupy strip space
 */
export function visibleTabs(tabs, groups) {
  const collapsed = new Set(groups.filter(g => g.collapsed).map(g => g.id));
  return tabs.filter(t => !collapsed.has(t.groupId));
}

/**
 * Does a group's current title correspond to this full title, whether it is
 * spelled out or abbreviated? Used so lookups still find a collapsed group.
 * @param {string} groupTitle - Title currently on the group
 * @param {string} fullTitle - Full title to test against
 * @returns {boolean}
 */
export function matchesGroupTitle(groupTitle, fullTitle) {
  if (!groupTitle || !fullTitle) return false;
  const actual = groupTitle.toLowerCase();
  return actual === fullTitle.toLowerCase()
    || actual === abbreviateGroupTitle(fullTitle).toLowerCase();
}
