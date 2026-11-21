# Panopticon — Chrome Extension Design Spec

**Date:** 2026-05-01  
**Status:** Approved

---

## Overview

Panopticon is a Chrome extension that tracks time spent on **all** websites, enforces a configurable daily leisure budget (counted only against designated leisure domains), and provides a productivity audit dashboard. All data is stored locally — no backend, no sync.

**Core goals:**
1. Self-control: alert the user when they exceed their daily leisure budget
2. Productivity audit: show per-site usage trends over time

---

## Architecture

Single Chrome extension (Manifest V3), four components:

### 1. Background Service Worker (`background.js`)
The core tracking engine.

- Listens to `chrome.tabs.onActivated`, `chrome.tabs.onUpdated`, `chrome.windows.onFocusChanged` to detect the active domain
- Time accrues **only** when: the tab is active AND the Chrome window has focus
- Tracks **all** domains — not just leisure sites — for full browsing audit
- Accumulates time per domain in memory; flushes to the storage layer every 60 seconds and on every tab/window change event
- Uses `chrome.alarms` to trigger midnight reset (local time) and periodic flush
- Fires `chrome.notifications` at 80% and 100% of daily **leisure** budget (only time on leisure domains counts toward budget)
- Handles snooze state: suppresses notifications for 15 minutes when snoozed, then re-alerts

### 2. Popup (`popup.html` / `popup.js`)
Visible when the user clicks the extension icon.

- **Card Light** style: white cards on light grey background
- Budget progress bar at top (e.g. "46m used of 2h — 1h 14m left") — leisure time only
- Per-site cards sorted by time spent descending, showing domain + time
- "View full dashboard →" link opens the options page
- Shows **all** tracked domains (not just leisure); leisure domains are visually tagged

### 3. Dashboard (`options.html` / `options.js`)
Full-page extension options page, opened from the popup or Chrome's extension menu.

**Sidebar navigation with four sections:**

- **Overview** — weekly bar chart (7 days), today's top sites list (all sites), current leisure budget status card
- **History** — day-by-day list of past usage; total time per day (all sites), expandable per-site breakdown with leisure sites tagged
- **Sites** — manage the leisure domain list; add/remove domains; shows time tracked per domain this week (all domains visible)
- **Settings** — daily budget (minutes), notification thresholds (default: 80% and 100%), option to reset today's data

### 4. Notifications
Chrome native notifications (`chrome.notifications`).

- **80% alert**: Informational. "Heads up — 24 minutes of leisure left today."
- **100% alert**: Stern Warning style. Orange-accented. Lists top 2-3 offender domains with time. Two buttons: **Snooze 15 min** and **Dismiss**.
- **Snooze behaviour**: Sets `snoozedUntil = now + 15min` in session state. At snooze expiry, re-fires the 100% notification if still over budget.
- **Dismiss behaviour**: Suppresses all further notifications for the rest of the day. Tracking continues.
- No notifications fired before 80% threshold.

---

## Data Model

Stored in `chrome.storage.local`:

```json
{
  "settings": {
    "dailyBudgetMinutes": 120,
    "notifyAt": [80, 100],
    "leisureDomains": [
      "youtube.com", "reddit.com", "twitter.com", "x.com",
      "tiktok.com", "instagram.com", "facebook.com",
      "twitch.tv", "netflix.com", "hulu.com",
      "9gag.com", "buzzfeed.com", "tumblr.com",
      "pinterest.com", "imgur.com", "digg.com",
      "hackernews.com", "lobste.rs", "producthunt.com",
      "discord.com"
    ]
  },
  "usage": {
    "2026-05-01": {
      "youtube.com": 1920,
      "reddit.com": 840
    }
  },
  "session": {
    "activeDomain": "youtube.com",
    "activeStart": 1746123456789,
    "activeDate": "2026-05-01",
    "snoozedUntil": null,
    "dismissedToday": false,
    "notifiedThresholds": [80]
  }
}
```

**Notes:**
- Usage values are in **seconds**
- **All** domains are tracked; `leisureDomains` controls which ones count toward the budget and trigger notifications
- `session` stores notification state and the active tracking interval so it
  can be restored after a service worker restart
- `usage` keys are ISO date strings in local time (`YYYY-MM-DD`)
- Data older than 90 days is pruned on startup to keep storage bounded

---

## Storage Abstraction

To allow swapping `chrome.storage.local` for IndexedDB in the future without touching business logic, all storage access goes through a `StorageAdapter` interface. The background service worker, popup, and dashboard never call `chrome.storage` directly.

### Interface (defined in `shared/storage.js`)

```js
// StorageAdapter interface — all methods return Promises
{
  getSettings()                        // → settings object
  saveSettings(settings)
  getUsageForDate(dateStr)             // → { domain: seconds, ... }
  saveUsageForDate(dateStr, usage)
  getUsageRange(startDateStr, endDateStr) // → { dateStr: { domain: seconds }, ... }
  getSession()                         // → session object
  saveSession(session)
  pruneOldData(beforeDateStr)
}
```

### Implementations

- `shared/storage/chrome-storage-adapter.js` — implements the interface using `chrome.storage.local`. Default for v1.
- `shared/storage/indexed-db-adapter.js` — stub file created in v1, to be fully implemented in v2.

The active adapter is instantiated once in `shared/storage/index.js` and exported as a singleton. Switching storage backends in the future requires only changing this one file.

---

| Behaviour | Detail |
|---|---|
| Tracking pauses | Tab inactive, window minimized, or window loses focus |
| Day reset | `chrome.alarms` fires at midnight local time; resets session state, clears `dismissedToday` and `notifiedThresholds` |
| Storage flush | Every 60s via alarm + on every tab/window event |
| Default domain list | ~20 common leisure sites, shipped in extension; user can add/remove |
| New site detection | Not automatic — user adds sites manually from Settings > Sites |
| Storage pruning | Usage entries older than 90 days deleted on service worker startup |
| Service worker restart | Active session is restored, flushed, and reconciled with the currently focused tab |

---

## File Structure

```
panopticon/
├── manifest.json
├── background.js
├── popup/
│   ├── popup.html
│   ├── popup.js
│   └── popup.css
├── dashboard/
│   ├── options.html
│   ├── options.js
│   └── options.css
├── shared/
│   ├── storage/
│   │   ├── index.js                  # exports active adapter singleton
│   │   ├── chrome-storage-adapter.js # v1 implementation
│   │   └── indexed-db-adapter.js     # stub for future v2
│   ├── tracker.js       # domain extraction, time accumulation logic
│   └── constants.js     # default domain list, default settings
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## Out of Scope (v1)

- Cross-device sync
- Auto-categorization of sites
- CSV/export
- Site blocking (only notifications, no hard blocks)
- Per-site individual limits (only a single total leisure budget)
- Mobile / other browsers
