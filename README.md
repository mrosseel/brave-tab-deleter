# Tab Deleter

Browser extension for managing tabs via a sidebar panel with auto-grouping, custom groups, and drag-and-drop.

## Quick Start

### Create Extension ZIP (for Chrome Web Store)

```bash
npm run package
```

This builds the extension and creates `tab-deleter-<version>.zip` ready for upload.

### Run Tests

```bash
npm test              # Run once
npm run test:watch    # Watch mode
```

### Build Only

```bash
npm run build
```

Bundles source files to `dist/` using esbuild. Required after any JS changes.

## Development

1. Edit source files (`background.js`, `sidebar.js`, `settings.js`, `shared.js`)
2. Run `npm run build`
3. Reload extension in browser (chrome://extensions)
4. Check Service Worker console for version confirmation

### Loading Unpacked Extension

1. Go to `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select this directory

## Architecture

| File | Purpose |
|------|---------|
| `background.js` | Service worker: tab grouping logic, settings, badge |
| `sidebar.js` | Sidebar UI: tab list, drag-drop, ghost groups, collapse |
| `settings.js` | Settings page: auto-grouping toggle, custom groups CRUD |
| `shared.js` | Shared utilities (ES module) |
| `lib/` | Extracted modules for unit testing |

### Key Concepts

- **Auto-grouping**: Groups tabs by domain when 2+ tabs share same domain
- **Custom groups**: User-defined groups with domain patterns
- **Ghost groups**: Temporary visual groups for tabs recently removed (15s countdown)
- **"Other" group**: Grey group for ungrouped single-domain tabs

## Specs

See [specs.md](specs.md) for detailed feature specifications.
