# Chrome Web Store Listing

Tab Deleter - A powerful sidebar for managing your browser tabs

FEATURES:

- Sidebar Panel - Click the extension icon to open a clean sidebar showing all your tabs organized by groups

- Auto-Grouping - Automatically groups tabs by domain when 2+ tabs share the same site (e.g., all YouTube tabs grouped together)

- Custom Groups - Create your own groups with custom names, colors, and domain patterns. Tabs matching your patterns are automatically sorted into the right group

- Drag & Drop - Reorder tabs and groups by dragging. Move tabs between groups or to "Other" (ungrouped)

- Quick Actions - Right-click tabs to duplicate, close, or move to another group

- Quick Navigation - Header buttons to scroll to the active tab or cycle through tabs currently playing audio (jumps to each audible tab in turn)

- Collapse/Expand - Click group headers to collapse or expand. Use header buttons to collapse/expand all groups at once

- Rename Groups - Double-click any group name to rename it inline

- Dark Mode - Automatically adapts to your system's light/dark theme

- Tab Count Badge - See your total tab count on the extension icon

- Sleep Groups - Put tab groups to sleep to save memory. Sleeping groups save URLs and can be restored later

- All Windows Mode - Optionally show and manage tabs from all browser windows in one sidebar

- Audio Indicator - See which tabs are playing audio with a speaker icon on the favicon

- YouTube Progress - Opt-in feature to show video progress bars for YouTube tabs (requires permission)

- Move Tabs Between Windows - Right-click tabs, groups, or fused groups to move them to another window. Window letter labels (A, B, C...) show where each tab lives

- Other Tabs Sorting - Keep ungrouped tabs together at the end (or start) of the tab strip instead of scattered between groups

- Abbreviate Collapsed Groups - Opt-in: shortens collapsed group titles only when the tab strip runs out of room, so more tabs stay visible

- Active Tab Highlight - Pick your own accent color for the currently active tab

- Tab Search - Click the search icon to filter tabs by title with wildcard support (use * as wildcard)

Works with Chrome and Brave browsers.

## Changelog

### v1.8.0 (2026-07-31)
- Move tabs, groups, and fused groups to another window from the right-click menu, with window letter labels (A, B, C...) showing where each tab lives
- Add "Fuse same-named groups" setting to merge groups that share a name across windows
- Close the sidebar from within via the header button
- New "Other Tabs Sorting" setting keeps ungrouped tabs together at the end (or start) of the tab strip instead of scattered between groups
- New opt-in setting abbreviates collapsed group titles, but only while the tab strip is out of room - collapsed groups keep their full name whenever they fit, and spell themselves out again when you widen the window
- Pick a custom accent color for the active tab
- Keep the active tab in view when switching tabs instead of snapping back to the previous scroll position
- Fix YouTube progress bars going dead after the service worker hibernated: progress updates arriving during startup were dropped, and tabs were told to stop reporting until the sidebar was reopened
- Keep YouTube progress running for every window while any sidebar is open in all-windows mode
