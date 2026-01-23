# Tab Deleter - Functional Specifications

A Chrome/Brave browser extension for managing tabs via a sidebar panel with automatic grouping, custom groups, and drag-and-drop organization.

## 1. Extension Activation

- Extension icon in toolbar toggles sidebar open/closed
- Badge on icon displays current window's tab count (indigo color)
- Badge updates in real-time as tabs open/close

## 2. Sidebar Interface

### Header
- Title: "Tabs"
- Sort button: Cycle through group sort options
- Collapse All button (double chevron up): Collapse all tab groups
- Expand All button (double chevron down): Expand all tab groups
- Settings button (sliders icon): Navigate to settings page

### Group Sorting
Groups can be sorted using the sort button in the header. Available sort options:
- **Browser Order** (default): Order as they appear in browser tab bar
- **Alphabetically**: Sort groups A-Z by name
- **By Tab Count**: Groups with most tabs first
- **Custom Groups First**: Custom groups at top, then auto-groups

Sleeping groups are always sorted last, regardless of the selected sort option.

Sort preference is persisted in settings.

### Tab Groups Display
Groups displayed according to current sort setting. Each group shows:
- Collapse/expand chevron icon
- Group name (uppercase)
- Tab count in parentheses
- Sleep button (Zzz icon on hover) - toggles group sleep state
- Close group button (× on hover) - closes all tabs in group

Groups have a colored left border matching Chrome's tab group colors.

Sleeping groups appear greyed out with the same structure but no active tabs.

### Individual Tabs
Each tab displays:
- Close button (× on hover)
- Favicon (with grey placeholder fallback)
- Tab title (truncated with ellipsis)
- Active tab has highlighted background

Clicking a tab activates it in the browser.

### Tab Context Menu
Right-clicking a tab shows a custom context menu with:
- **Duplicate**: Creates a copy of the tab (same URL, placed after original)
- **Close**: Closes the tab
- **Move to group**: Submenu listing all available groups + "Other" (ungrouped)
- **Ungroup**: Removes tab from its group (only shown if tab is in a group)

The custom menu replaces the default browser context menu.

### "Other" Section
- Grey pseudo-group containing all ungrouped tabs
- Collapsible (local state, not persisted)
- Close button removes ALL ungrouped tabs

## 3. Auto-Grouping

When enabled:
- Groups tabs by main domain when 2+ tabs share the same domain
- Triggers on: sidebar open, new tab loads, settings change
- Tabs already in a custom group are NOT moved (auto-groups can be reorganized)
- Each auto-created group gets a unique color (avoids colors reserved by custom groups)
- When all 9 colors are used, colors are reused (cycling through available colors)
- Group name is the short domain name (e.g., "google" from google.com)

### Domain Extraction
- Extracts main domain from URL hostname
- Handles two-part TLDs: co.uk, com.au, co.nz, co.jp, com.br, co.kr, co.in, org.uk, net.au, com.mx
- IP addresses kept as-is

### Group Recovery
If an auto-group is destroyed and 2+ matching ungrouped tabs remain, the group is automatically recreated.

## 4. Custom Groups

User-defined groups with:
- **Name**: User-specified label
- **Color**: One of 9 colors (grey, blue, red, yellow, green, pink, purple, cyan, orange)
- **Domain Patterns**: One or more domains (supports subdomain matching)

### Domain Matching
Pattern "example.com" matches:
- example.com (exact)
- mail.example.com (subdomain)
- any.sub.example.com (any depth)

### Priority
Custom groups checked FIRST before auto-grouping. A tab matching a custom group moves there even if already in an auto-group.

### Color Priority
Custom groups have priority over their assigned colors. If an auto-group or other group already has a color that a custom group needs, the existing group's color is automatically swapped to a different available color.

### Group Recovery
If a custom group is destroyed and 1+ matching ungrouped tabs exist, the group is automatically recreated.

## 5. Ghost Groups

Temporary visual feedback when removing a tab from a 2-tab group:
- Remaining tab moves to a "ghost group" showing original group name/color
- Countdown timer displayed (configurable 5-30 seconds, default 15)
- When timer expires, tab moves to "Other" section
- Semi-transparent appearance
- Survives sidebar reload within browser session

## 6. Drag and Drop

### Tab Drag & Drop
- Drag tab to reorder within tab bar
- Drop on another tab: moves to that position
- Drop on group header: moves tab INTO that group
- Drop on "Other" section: removes tab from group (ungrouped)

### Group Drag & Drop
- Drag group header to reorder groups
- All tabs in group move together
- Cannot drag "Other" section, ghost groups, or sleeping groups

### Visual Feedback
- Dragged tab: Highlighted/bright appearance with color glow (stands out from other tabs)
- Drop targets: Blue top border indicator
- Multi-select drag: Future feature - drag multiple selected tabs at once

## 7. Tab Ordering (within groups)

Controls how tabs are ordered within each group. Available ordering options:
- **Manual** (default): Only change order via drag-and-drop
- **Recently Used First**: Most recently activated tabs at top of group
- **Opening Order**: Oldest tabs first, newest at bottom
- **Alphabetical**: Sort tabs A-Z by title within each group

### Scope
- Global setting applies to all groups by default
- Individual groups can override the global setting
- Override is set via right-click on group header (future feature)

## 8. Collapse/Expand Behavior

- **Real Groups**: Uses Chrome API, persists across sessions
- **"Other" Section**: Local state only, resets on sidebar reload
- Collapse All/Expand All buttons affect all groups simultaneously

## 9. Settings Page

Accessible via settings button in sidebar header.

### Available Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Window Scope | Current Window | Show tabs from current window only or all windows |
| Auto Grouping | OFF | Group tabs by domain when 2+ share same domain |
| Custom Grouping | OFF | Enable user-defined custom groups |
| Group Sort Order | Browser Order | How to sort groups in sidebar |
| Tab Ordering | Manual | How to order tabs within groups |
| Ghost Duration | 15 | Seconds before ghost group expires (5-30) |

### Custom Groups Management
- List of all custom groups with edit/delete options
- Each card shows: color indicator, name, domain chips
- Add Group button opens modal dialog

### Add/Edit Group Modal
- Group Name (text input)
- Color Picker (9 color options)
- Domains (textarea, one per line)
- Cancel and Save buttons
- Click outside modal closes it

## 10. Window Scope

Controls whether the extension operates on the current browser window only or across all windows.

### Options
- **Current Window** (default): Only show and manage tabs from the window where the sidebar is open
- **All Windows**: Show and manage tabs from all browser windows

### Behavior by Scope

| Feature | Current Window | All Windows |
|---------|---------------|-------------|
| Tab display | Tabs from current window | Tabs from all windows |
| Auto-grouping | Applied to current window | Applied across all windows |
| Custom groups | Applied to current window | Applied across all windows |
| Tab count badge | Current window count | Total across all windows |
| Drag & drop | Within current window | Within current window only |
| Sleeping groups | Shown regardless of scope | Shown regardless of scope |

### Notes
- Drag and drop always operates within the current window for safety
- Sleeping groups are always visible since they have no window association
- Ghost groups are scoped to the window where they were created
- When "All Windows" is selected, tabs are visually grouped by window with a subtle separator

## 11. Excluded URLs

These URLs are never grouped or shown in sidebar:
- chrome://newtab/
- about:blank
- chrome://* (all Chrome internal pages)
- chrome-extension://* (all extension pages)

## 12. Theme Support

- Supports system light/dark mode via `prefers-color-scheme`
- Both sidebar and settings adapt colors automatically

## 13. Group Sleep

Allows temporarily "sleeping" a group to free resources while preserving its tabs for later.

### Activation
- Sleep icon (Zzz) displayed on each group header
- Click to toggle sleep state

### Sleep Behavior
When a group is put to sleep:
- The real Chrome tab group is deleted
- All tabs in the group are closed
- Group metadata saved to local storage: name, color, tab URLs, tab titles
- Group appears greyed out in sidebar (visual sleep indicator)
- Sleeping groups are always sorted last, regardless of sort setting

### Wake Behavior
When a sleeping group is woken:
- All tabs are recreated from stored URLs
- Chrome tab group is recreated with original name and color
- Tabs are added to the recreated group
- Group returns to normal appearance and sorting

### Persistence
- Sleeping groups persist across browser sessions (stored in chrome.storage.local)
- Sleeping groups are window-agnostic: can be woken in any window

### Restrictions
- Cannot sleep the "Other" section
- Cannot sleep ghost groups
- Cannot drag tabs into or out of sleeping groups

---

# Technical Considerations

## Architecture

| File | Purpose |
|------|---------|
| background.js | Service worker: grouping logic, settings, badge |
| sidebar.js | Sidebar UI: tab list, drag-drop, ghost groups |
| settings.js | Settings page: toggles, custom groups CRUD |
| lib/domain.js | Domain utilities: getDomain, getHostname, getShortName, shouldSkipUrl |
| lib/colors.js | Color utilities: getColorHex |
| lib/lock.js | Global locking: createLock |
| lib/drag-position.js | Drag-drop utilities: calculateTargetIndex, getDropPosition |

## Build System
- esbuild bundles source files to `dist/`
- Manifest points to `dist/background.js` for service worker
- Run `npm run build` after any JS changes

## Race Condition Prevention
All grouping operations use a global lock (`withGroupingLock()`) to prevent concurrent modifications. Operations queue if lock is held.

## Storage

| Type | Contents |
|------|----------|
| chrome.storage.sync | Settings (persists across devices) |
| chrome.storage.session | Ghost groups (persists within session) |
| chrome.storage.local | Sleeping groups (persists across sessions) |

## Inter-Component Communication
- Sidebar sends `sidebarOpened` message to background
- Settings sends `settingsUpdated` message with new settings
- Background watches `chrome.storage.onChanged` for settings sync

## Required Permissions
- `tabs` - query, move, ungroup, close tabs
- `tabGroups` - query, create, update groups
- `sidePanel` - sidebar functionality
- `storage` - sync and session storage

## Performance Optimizations
- 300ms debounced rendering in sidebar
- Scroll position preserved during re-renders
- FIFO queue for locked grouping operations

---

# Future Features (Wishlist)

Features identified for potential future implementation:

## High Priority
- **Multi-select drag**: Select and drag multiple tabs at once
- **Per-group tab ordering override**: Right-click group header to set ordering for that group only

## Medium Priority
- **Keyboard shortcuts**: Navigate and manage tabs without mouse
- **Tab previews**: Hover to see tab thumbnail/preview
- **Session save/restore**: Save current tab arrangement as named session for later restoration

## Low Priority
- **Tab notes/tags**: Add notes or tags to individual tabs for organization
