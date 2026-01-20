# Tab Deleter - Browser Extension

## Overview
Chrome/Brave extension for managing tabs via a sidebar panel with auto-grouping, custom groups, ghost groups, and drag-and-drop.

## Build System
- **Build command**: `npm run build` (required after any JS changes)
- **Bundler**: esbuild bundles `background.js`, `sidebar.js`, `settings.js` → `dist/`
- **Manifest** points to `dist/background.js` for service worker
- **HTML files** load from `dist/` (e.g., `dist/sidebar.js`)

## Architecture

### Files
- `background.js` - Service worker: handles tab grouping logic, settings, badge
- `sidebar.js` - Sidebar UI: tab list, drag-drop, ghost groups, collapse/expand
- `settings.js` - Settings page: auto-grouping toggle, custom groups CRUD
- `shared.js` - Shared utilities (ES module): getDomain, getShortName, shouldSkipUrl, getColorHex

### Key Concepts
- **Auto-grouping**: Groups tabs by domain when 2+ tabs share same domain
- **Custom groups**: User-defined groups with domain patterns
- **Ghost groups**: Temporary visual groups for tabs recently removed from a group (15s countdown)
- **"Other" group**: Grey group for ungrouped single-domain tabs

### Grouping Lock
All grouping operations use `withGroupingLock()` to prevent race conditions. Operations are queued if lock is held.

## Testing
- `npm test` - Run vitest tests
- Tests in `tests/` directory for domain, groups, ghost, ordering logic

## Common Issues

### Service Worker Not Updating
Service workers can be stubborn. To force reload:
1. Toggle extension OFF/ON in chrome://extensions, OR
2. Remove and re-add the extension

### Groups Being Destroyed
Previous bug where duplicating a tab destroyed all groups. Fixed by:
1. Proper global locking for all grouping operations
2. `groupSingleTab()` only adds to existing groups or creates new when 2+ same-domain tabs
3. Removed concurrent init + sidebar-open auto-grouping race

## Development Workflow
1. Edit source files (background.js, sidebar.js, settings.js, shared.js)
2. Run `npm run build`
3. Reload extension in browser
4. Check Service Worker console for "VERSION X LOADED" to confirm new code
