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

- Tab Search - Click the search icon to filter tabs by title with wildcard support (use * as wildcard)

Works with Chrome and Brave browsers.

## Changelog

### v1.7.0 (2026-05-07)
- Add "scroll to playing tab" header button — cycles through tabs currently playing audio, activating each in turn so you can pause/mute it
- Add "scroll to active tab" header button and persist sidebar collapse/expand state
- Fix YouTube content script not being included in published package (progress bars now work after install)
- Reduce render thrashing: sidebar now ignores tab-update events that don't affect what's drawn
- Coalesce rapid grouping work (e.g. session restore) into a single bulk pass instead of dozens of serialized operations
- Make group-tracking writes durable across service-worker suspension
- Fix lost-write race in ghost-group expiry
- Make YouTube content script idempotent on re-injection (no listener pile-up after extension reload)
- Settings handlers no longer fire twice on save
- Better error handling for "No SW" / "Extension context invalidated" during service-worker hibernation
