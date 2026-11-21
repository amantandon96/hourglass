# Hourglass

A Chrome extension that shows where your browser time goes: which sites, which categories, and how close you are to the budgets you set.

## Private by design

- **Everything stays on your device.** Usage data lives in the browser's local storage and IndexedDB.
- **Nothing is sent anywhere.** The extension's Content Security Policy sets `connect-src 'none'`, so its pages can't make network requests. There's no analytics, no account, and no server.

## Features

- Per-site time tracking for the active tab
- Sites grouped into categories with daily time budgets
- Popup with today's summary, plus a full dashboard with charts

## Install (unpacked)

1. Clone this repo.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the repo folder.

## Development

```sh
npm test   # runs the Node test suite (node --test)
```

Project layout:

- `background.js`: service worker that tracks tab activity
- `popup/`: toolbar popup
- `dashboard/`: options page / full dashboard
- `shared/`: tracker logic, constants, storage adapters
- `docs/`: design specs and implementation plans
