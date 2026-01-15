# Privacy Policy for Tab Deleter

**Last Updated:** January 2025

## Overview

Tab Deleter is a browser extension that helps you manage and organize your browser tabs. This privacy policy explains how the extension handles your data.

## Data Collection

**Tab Deleter does not collect, transmit, or share any personal data.** All data stays on your device.

## Data Storage

The extension stores the following data locally on your device using Chrome's built-in storage APIs:

### Settings (chrome.storage.sync)
- Auto-grouping preferences (on/off)
- Auto-ordering preferences (on/off, timing)
- Custom group configurations (group names, colors, domain patterns)

This data syncs across your Chrome browsers if you're signed into Chrome, using Chrome's built-in sync feature.

### Session Data (chrome.storage.session)
- Temporary "ghost group" state for recently closed tab groups

This data is cleared when you close the browser.

## Permissions Used

- **tabs**: Required to read tab information (titles, URLs, favicons) and manage tab organization
- **tabGroups**: Required to create, modify, and manage tab groups
- **sidePanel**: Required to display the sidebar interface
- **storage**: Required to save your settings and preferences

## Third-Party Services

Tab Deleter does not use any third-party services, analytics, or tracking.

## Data Security

All data is stored locally using Chrome's secure storage APIs. No data is transmitted over the network.

## Changes to This Policy

Any changes to this privacy policy will be reflected in the "Last Updated" date above.

## Contact

For questions about this privacy policy, please open an issue on the extension's GitHub repository.
