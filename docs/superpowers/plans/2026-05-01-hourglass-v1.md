# Hourglass Chrome Extension — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chrome MV3 extension that tracks time on all websites, enforces a configurable daily leisure budget, and surfaces usage data via a popup and full dashboard.

**Architecture:** A background service worker tracks active tab time and flushes to a `StorageAdapter` abstraction backed by `chrome.storage.local`. A popup shows today's budget and per-site summary. A full options-page dashboard has sidebar navigation with Overview, History, Sites, and Settings sections. Chrome notifications fire at 80% and 100% of daily leisure budget.

**Tech Stack:** Vanilla JS (ES modules), Chrome Extension Manifest V3, `chrome.storage.local`, `chrome.notifications`, `chrome.alarms`, Chart.js (CDN) for bar charts.

---

## File Map

```
hourglass/
├── manifest.json
├── background.js                         # service worker entry point
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
│   │   ├── index.js                      # exports active adapter singleton
│   │   ├── chrome-storage-adapter.js     # v1 implementation
│   │   └── indexed-db-adapter.js         # stub only
│   ├── tracker.js                        # domain extraction + time math
│   └── constants.js                      # defaults: domain list, budget, thresholds
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## Task 1: Project Scaffold & Manifest

**Files:**
- Create: `manifest.json`
- Create: `shared/constants.js`
- Create: `icons/icon16.png`, `icons/icon48.png`, `icons/icon128.png` (placeholder PNGs)

- [ ] **Step 1: Create `shared/constants.js`**

```js
// shared/constants.js
export const DEFAULT_BUDGET_MINUTES = 120;
export const DEFAULT_NOTIFY_AT = [80, 100];
export const FLUSH_ALARM_NAME = 'flush';
export const MIDNIGHT_ALARM_NAME = 'midnight-reset';
export const SNOOZE_MINUTES = 15;
export const PRUNE_DAYS = 90;

export const DEFAULT_LEISURE_DOMAINS = [
  'youtube.com', 'reddit.com', 'twitter.com', 'x.com',
  'tiktok.com', 'instagram.com', 'facebook.com',
  'twitch.tv', 'netflix.com', 'hulu.com',
  '9gag.com', 'buzzfeed.com', 'tumblr.com',
  'pinterest.com', 'imgur.com', 'digg.com',
  'news.ycombinator.com', 'lobste.rs', 'producthunt.com',
  'discord.com',
];

export const DEFAULT_SETTINGS = {
  dailyBudgetMinutes: DEFAULT_BUDGET_MINUTES,
  notifyAt: DEFAULT_NOTIFY_AT,
  leisureDomains: DEFAULT_LEISURE_DOMAINS,
};
```

- [ ] **Step 2: Create `manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "Hourglass",
  "version": "0.1.0",
  "description": "Track your browsing time and enforce a daily leisure budget.",
  "permissions": [
    "tabs",
    "storage",
    "alarms",
    "notifications"
  ],
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "options_ui": {
    "page": "dashboard/options.html",
    "open_in_tab": true
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

- [ ] **Step 3: Create placeholder icons**

Create a 16×16, 48×48, and 128×128 solid-color PNG (any color). The simplest approach is to use a small Node script or any image editor. A 1×1 transparent PNG encoded as base64 will also work as a placeholder — just copy this file three times:

```bash
# Quick placeholder: copy a minimal valid PNG (you can replace later)
python3 -c "
import base64, os
# minimal 1x1 blue PNG
png = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==')
os.makedirs('icons', exist_ok=True)
for name in ['icon16.png','icon48.png','icon128.png']:
    open(f'icons/{name}','wb').write(png)
"
```

- [ ] **Step 4: Commit**

```bash
git add manifest.json shared/constants.js icons/
git commit -m "feat: project scaffold, manifest, and constants"
```

---

## Task 2: Storage Abstraction Layer

**Files:**
- Create: `shared/storage/chrome-storage-adapter.js`
- Create: `shared/storage/indexed-db-adapter.js`
- Create: `shared/storage/index.js`

- [ ] **Step 1: Create `shared/storage/chrome-storage-adapter.js`**

```js
// shared/storage/chrome-storage-adapter.js

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export class ChromeStorageAdapter {
  async getSettings() {
    const { settings } = await chrome.storage.local.get('settings');
    return settings ?? null;
  }

  async saveSettings(settings) {
    await chrome.storage.local.set({ settings });
  }

  async getUsageForDate(dateStr) {
    const key = `usage_${dateStr}`;
    const result = await chrome.storage.local.get(key);
    return result[key] ?? {};
  }

  async saveUsageForDate(dateStr, usage) {
    const key = `usage_${dateStr}`;
    await chrome.storage.local.set({ [key]: usage });
  }

  async getUsageRange(startDateStr, endDateStr) {
    // Build list of date keys in range
    const keys = [];
    const cursor = new Date(startDateStr);
    const end = new Date(endDateStr);
    while (cursor <= end) {
      keys.push(`usage_${cursor.toISOString().slice(0, 10)}`);
      cursor.setDate(cursor.getDate() + 1);
    }
    const result = await chrome.storage.local.get(keys);
    const out = {};
    for (const key of keys) {
      const dateStr = key.replace('usage_', '');
      out[dateStr] = result[key] ?? {};
    }
    return out;
  }

  async getSession() {
    const { session } = await chrome.storage.local.get('session');
    return session ?? null;
  }

  async saveSession(session) {
    await chrome.storage.local.set({ session });
  }

  async pruneOldData(beforeDateStr) {
    const all = await chrome.storage.local.get(null);
    const keysToRemove = Object.keys(all).filter((key) => {
      if (!key.startsWith('usage_')) return false;
      const dateStr = key.replace('usage_', '');
      return dateStr < beforeDateStr;
    });
    if (keysToRemove.length > 0) {
      await chrome.storage.local.remove(keysToRemove);
    }
  }
}
```

- [ ] **Step 2: Create `shared/storage/indexed-db-adapter.js` (stub)**

```js
// shared/storage/indexed-db-adapter.js
// Stub — to be implemented in v2 when migrating to IndexedDB.
// Must implement the same interface as ChromeStorageAdapter.

export class IndexedDbAdapter {
  async getSettings() { throw new Error('IndexedDbAdapter not implemented'); }
  async saveSettings(_settings) { throw new Error('IndexedDbAdapter not implemented'); }
  async getUsageForDate(_dateStr) { throw new Error('IndexedDbAdapter not implemented'); }
  async saveUsageForDate(_dateStr, _usage) { throw new Error('IndexedDbAdapter not implemented'); }
  async getUsageRange(_startDateStr, _endDateStr) { throw new Error('IndexedDbAdapter not implemented'); }
  async getSession() { throw new Error('IndexedDbAdapter not implemented'); }
  async saveSession(_session) { throw new Error('IndexedDbAdapter not implemented'); }
  async pruneOldData(_beforeDateStr) { throw new Error('IndexedDbAdapter not implemented'); }
}
```

- [ ] **Step 3: Create `shared/storage/index.js`**

```js
// shared/storage/index.js
// To switch to IndexedDB in future: swap ChromeStorageAdapter for IndexedDbAdapter here.
import { ChromeStorageAdapter } from './chrome-storage-adapter.js';

export const storage = new ChromeStorageAdapter();
```

- [ ] **Step 4: Commit**

```bash
git add shared/storage/
git commit -m "feat: storage abstraction layer with chrome.storage.local adapter"
```

---

## Task 3: Domain Tracker Utility

**Files:**
- Create: `shared/tracker.js`

- [ ] **Step 1: Create `shared/tracker.js`**

```js
// shared/tracker.js

/**
 * Extract the registrable domain from a URL string.
 * Returns null for chrome://, about:, extension pages, and invalid URLs.
 */
export function extractDomain(url) {
  if (!url) return null;
  try {
    const { hostname, protocol } = new URL(url);
    if (!['http:', 'https:'].includes(protocol)) return null;
    if (!hostname) return null;
    // Strip leading "www."
    return hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * Given a usage map { domain: seconds } and a list of leisure domains,
 * compute total leisure seconds for today.
 */
export function computeLeisureSeconds(usage, leisureDomains) {
  const set = new Set(leisureDomains);
  return Object.entries(usage).reduce((sum, [domain, seconds]) => {
    return set.has(domain) ? sum + seconds : sum;
  }, 0);
}

/**
 * Compute what percentage of the daily budget has been used.
 * Returns a number 0–N (can exceed 100).
 */
export function budgetPercent(leisureSeconds, dailyBudgetMinutes) {
  const budgetSeconds = dailyBudgetMinutes * 60;
  if (budgetSeconds === 0) return 0;
  return Math.round((leisureSeconds / budgetSeconds) * 100);
}

/**
 * Format seconds into a human-readable string: "1h 4m", "32m", "45s".
 */
export function formatDuration(totalSeconds) {
  const s = Math.floor(totalSeconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`;
}

/**
 * Return YYYY-MM-DD for a given Date object in local time.
 */
export function localDateStr(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Return the date string N days before the given date.
 */
export function daysAgo(n, from = new Date()) {
  const d = new Date(from);
  d.setDate(d.getDate() - n);
  return localDateStr(d);
}

/**
 * Return the date string for tomorrow's midnight (local time) as a Date object.
 * Used to schedule the midnight-reset alarm.
 */
export function nextMidnight() {
  const d = new Date();
  d.setHours(24, 0, 0, 0);
  return d;
}
```

- [ ] **Step 2: Commit**

```bash
git add shared/tracker.js
git commit -m "feat: tracker utility — domain extraction, budget math, duration formatting"
```

---

## Task 4: Background Service Worker

**Files:**
- Create: `background.js`

- [ ] **Step 1: Create `background.js`**

```js
// background.js
import { storage } from './shared/storage/index.js';
import { DEFAULT_SETTINGS, FLUSH_ALARM_NAME, MIDNIGHT_ALARM_NAME, SNOOZE_MINUTES, PRUNE_DAYS } from './shared/constants.js';
import { extractDomain, computeLeisureSeconds, budgetPercent, localDateStr, daysAgo, nextMidnight } from './shared/tracker.js';

// ---------------------------------------------------------------------------
// In-memory session state
// ---------------------------------------------------------------------------
let activeDomain = null;       // currently tracked domain (string | null)
let activeStart = null;        // epoch ms when tracking started (number | null)
let settings = null;           // loaded settings object
let snoozedUntil = null;       // epoch ms | null
let dismissedToday = false;    // bool — no more notifications today
let notifiedThresholds = [];   // array of percent thresholds already fired today

// ---------------------------------------------------------------------------
// Initialise on service worker startup
// ---------------------------------------------------------------------------
async function init() {
  settings = await storage.getSettings();
  if (!settings) {
    settings = { ...DEFAULT_SETTINGS };
    await storage.saveSettings(settings);
  }

  // Restore session if present
  const session = await storage.getSession();
  if (session) {
    snoozedUntil = session.snoozedUntil ?? null;
    dismissedToday = session.dismissedToday ?? false;
    notifiedThresholds = session.notifiedThresholds ?? [];
  }

  // Prune old data
  const pruneDate = daysAgo(PRUNE_DAYS);
  await storage.pruneOldData(pruneDate);

  // Set up alarms
  await setupAlarms();
}

async function setupAlarms() {
  // Periodic flush every 60s
  const existing = await chrome.alarms.get(FLUSH_ALARM_NAME);
  if (!existing) {
    chrome.alarms.create(FLUSH_ALARM_NAME, { periodInMinutes: 1 });
  }

  // Midnight reset — schedule for next midnight
  const midnightAlarm = await chrome.alarms.get(MIDNIGHT_ALARM_NAME);
  if (!midnightAlarm) {
    chrome.alarms.create(MIDNIGHT_ALARM_NAME, { when: nextMidnight().getTime() });
  }
}

// ---------------------------------------------------------------------------
// Time tracking
// ---------------------------------------------------------------------------
async function startTracking(url) {
  await flushCurrent(); // flush whatever was running
  const domain = extractDomain(url);
  if (domain) {
    activeDomain = domain;
    activeStart = Date.now();
  } else {
    activeDomain = null;
    activeStart = null;
  }
}

async function stopTracking() {
  await flushCurrent();
  activeDomain = null;
  activeStart = null;
}

async function flushCurrent() {
  if (!activeDomain || !activeStart) return;
  const elapsed = Math.floor((Date.now() - activeStart) / 1000);
  if (elapsed <= 0) return;

  const dateStr = localDateStr();
  const usage = await storage.getUsageForDate(dateStr);
  usage[activeDomain] = (usage[activeDomain] ?? 0) + elapsed;
  await storage.saveUsageForDate(dateStr, usage);

  // Reset start time so next flush doesn't double-count
  activeStart = Date.now();

  await checkBudget(usage);
}

// ---------------------------------------------------------------------------
// Budget notifications
// ---------------------------------------------------------------------------
async function checkBudget(usage) {
  if (dismissedToday) return;

  settings = await storage.getSettings();
  const leiserSec = computeLeisureSeconds(usage, settings.leisureDomains);
  const pct = budgetPercent(leiserSec, settings.dailyBudgetMinutes);

  for (const threshold of settings.notifyAt) {
    if (pct >= threshold && !notifiedThresholds.includes(threshold)) {
      await fireNotification(threshold, usage, pct);
      notifiedThresholds.push(threshold);
      await persistSession();
    }
  }
}

async function fireNotification(threshold, usage, pct) {
  // Build top offenders list for 100% notification
  const topOffenders = Object.entries(usage)
    .filter(([d]) => settings.leisureDomains.includes(d))
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([d, s]) => `${d} (${Math.floor(s / 60)}m)`)
    .join(', ');

  const budgetSec = settings.dailyBudgetMinutes * 60;
  const leiserSec = computeLeisureSeconds(usage, settings.leisureDomains);
  const remainSec = Math.max(0, budgetSec - leiserSec);
  const remainMin = Math.floor(remainSec / 60);

  const is100 = threshold >= 100;

  const title = is100
    ? 'Leisure budget exhausted'
    : `Heads up — ${remainMin}m of leisure left`;

  const message = is100
    ? `Top sites: ${topOffenders || 'none'}. Snooze or stop?`
    : `You've used ${pct}% of your ${settings.dailyBudgetMinutes}m daily leisure budget.`;

  const notifOptions = {
    type: 'basic',
    iconUrl: 'icons/icon48.png',
    title,
    message,
    priority: is100 ? 2 : 0,
    ...(is100 ? { buttons: [{ title: 'Snooze 15 min' }, { title: 'Dismiss' }] } : {}),
  };

  await chrome.notifications.create(`threshold-${threshold}`, notifOptions);
}

// ---------------------------------------------------------------------------
// Notification button clicks
// ---------------------------------------------------------------------------
chrome.notifications.onButtonClicked.addListener(async (notifId, buttonIndex) => {
  if (!notifId.startsWith('threshold-')) return;
  if (buttonIndex === 0) {
    // Snooze
    snoozedUntil = Date.now() + SNOOZE_MINUTES * 60 * 1000;
    // Remove 100 from notifiedThresholds so it re-fires after snooze
    notifiedThresholds = notifiedThresholds.filter((t) => t < 100);
    chrome.alarms.create('snooze-end', { when: snoozedUntil });
  } else if (buttonIndex === 1) {
    // Dismiss
    dismissedToday = true;
  }
  await persistSession();
  chrome.notifications.clear(notifId);
});

// ---------------------------------------------------------------------------
// Alarms
// ---------------------------------------------------------------------------
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === FLUSH_ALARM_NAME) {
    await flushCurrent();
  } else if (alarm.name === MIDNIGHT_ALARM_NAME) {
    await midnightReset();
  } else if (alarm.name === 'snooze-end') {
    const now = Date.now();
    if (snoozedUntil && now >= snoozedUntil) {
      snoozedUntil = null;
      await persistSession();
      // Re-check budget to re-fire if still over
      const dateStr = localDateStr();
      const usage = await storage.getUsageForDate(dateStr);
      await checkBudget(usage);
    }
  }
});

async function midnightReset() {
  await flushCurrent();
  activeDomain = null;
  activeStart = null;
  snoozedUntil = null;
  dismissedToday = false;
  notifiedThresholds = [];
  await persistSession();
  // Reschedule for next midnight
  chrome.alarms.create(MIDNIGHT_ALARM_NAME, { when: nextMidnight().getTime() });
}

// ---------------------------------------------------------------------------
// Tab / window events
// ---------------------------------------------------------------------------
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId);
  if (tab.url) await startTracking(tab.url);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTab?.id === tabId) await startTracking(tab.url);
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    await stopTracking();
  } else {
    const [activeTab] = await chrome.tabs.query({ active: true, windowId });
    if (activeTab?.url) await startTracking(activeTab.url);
  }
});

// ---------------------------------------------------------------------------
// Session persistence helper
// ---------------------------------------------------------------------------
async function persistSession() {
  await storage.saveSession({
    snoozedUntil,
    dismissedToday,
    notifiedThresholds,
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
init();
```

- [ ] **Step 2: Load extension in Chrome to smoke test**

1. Open `chrome://extensions`
2. Enable Developer Mode
3. Click "Load unpacked" → select the `hourglass/` folder
4. Open a few websites (youtube.com, github.com)
5. Wait ~60s, then open the background service worker's console (DevTools → Service Worker)
6. Verify no errors and that `chrome.storage.local` has `usage_<today>` entries

- [ ] **Step 3: Commit**

```bash
git add background.js
git commit -m "feat: background service worker — tracking, budget alerts, snooze/dismiss"
```

---

## Task 5: Popup

**Files:**
- Create: `popup/popup.html`
- Create: `popup/popup.css`
- Create: `popup/popup.js`

- [ ] **Step 1: Create `popup/popup.css`**

```css
/* popup/popup.css */
* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  width: 300px;
  min-height: 200px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: #f3f4f6;
  color: #111;
}

header {
  background: #fff;
  padding: 12px 16px;
  border-bottom: 1px solid #e5e7eb;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

header h1 {
  font-size: 13px;
  font-weight: 700;
  color: #6366f1;
  letter-spacing: 0.5px;
}

header a {
  font-size: 11px;
  color: #6366f1;
  text-decoration: none;
}

.budget-card {
  background: #fff;
  margin: 10px;
  border-radius: 10px;
  padding: 12px 14px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.07);
}

.budget-card .label {
  font-size: 11px;
  color: #6b7280;
  font-weight: 600;
  margin-bottom: 6px;
}

.budget-card .bar-wrap {
  height: 8px;
  background: #e5e7eb;
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 5px;
}

.budget-card .bar-fill {
  height: 100%;
  border-radius: 4px;
  background: linear-gradient(90deg, #f87171, #fb923c);
  transition: width 0.3s ease;
}

.budget-card .budget-meta {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: #6b7280;
}

.budget-card .budget-meta .remaining {
  font-weight: 700;
  color: #16a34a;
}

.site-list {
  padding: 0 10px 10px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.site-card {
  background: #fff;
  border-radius: 8px;
  padding: 8px 12px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
}

.site-card .domain {
  font-size: 12px;
  color: #374151;
}

.site-card .domain .leisure-tag {
  font-size: 9px;
  background: #fee2e2;
  color: #b91c1c;
  border-radius: 4px;
  padding: 1px 4px;
  margin-left: 5px;
  font-weight: 600;
}

.site-card .time {
  font-size: 12px;
  font-weight: 600;
  color: #dc2626;
}

.empty {
  text-align: center;
  color: #9ca3af;
  font-size: 12px;
  padding: 20px;
}
```

- [ ] **Step 2: Create `popup/popup.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hourglass</title>
  <link rel="stylesheet" href="popup.css">
</head>
<body>
  <header>
    <h1>HOURGLASS</h1>
    <a id="dashboard-link" href="#">Full report →</a>
  </header>

  <div class="budget-card">
    <div class="label">Daily Leisure Budget</div>
    <div class="bar-wrap">
      <div class="bar-fill" id="budget-bar" style="width:0%"></div>
    </div>
    <div class="budget-meta">
      <span id="used-label">0m used</span>
      <span class="remaining" id="remaining-label">Loading…</span>
    </div>
  </div>

  <div class="site-list" id="site-list">
    <div class="empty">No activity tracked today.</div>
  </div>

  <script type="module" src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 3: Create `popup/popup.js`**

```js
// popup/popup.js
import { storage } from '../shared/storage/index.js';
import { computeLeisureSeconds, budgetPercent, formatDuration, localDateStr } from '../shared/tracker.js';

async function render() {
  const settings = await storage.getSettings();
  const today = localDateStr();
  const usage = await storage.getUsageForDate(today);

  const leisureSec = computeLeisureSeconds(usage, settings.leisureDomains);
  const budgetSec = settings.dailyBudgetMinutes * 60;
  const pct = budgetPercent(leisureSec, settings.dailyBudgetMinutes);
  const remainSec = Math.max(0, budgetSec - leisureSec);

  // Budget bar
  document.getElementById('budget-bar').style.width = `${Math.min(pct, 100)}%`;
  document.getElementById('used-label').textContent = `${formatDuration(leisureSec)} used of ${settings.dailyBudgetMinutes}m`;
  document.getElementById('remaining-label').textContent = `${formatDuration(remainSec)} left`;

  // Site list — all tracked domains sorted by time desc
  const sorted = Object.entries(usage).sort(([, a], [, b]) => b - a);
  const container = document.getElementById('site-list');

  if (sorted.length === 0) {
    container.innerHTML = '<div class="empty">No activity tracked today.</div>';
    return;
  }

  const leisureSet = new Set(settings.leisureDomains);
  container.innerHTML = sorted.map(([domain, seconds]) => {
    const tag = leisureSet.has(domain)
      ? '<span class="leisure-tag">leisure</span>'
      : '';
    return `
      <div class="site-card">
        <span class="domain">${domain}${tag}</span>
        <span class="time">${formatDuration(seconds)}</span>
      </div>
    `;
  }).join('');
}

// Dashboard link
document.getElementById('dashboard-link').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

render();
```

- [ ] **Step 4: Load extension and verify popup**

1. Reload the extension in `chrome://extensions`
2. Browse a few sites for a minute
3. Click the extension icon — popup should show budget bar and site cards
4. Leisure sites should show the red "leisure" tag

- [ ] **Step 5: Commit**

```bash
git add popup/
git commit -m "feat: popup with budget bar and per-site usage cards"
```

---

## Task 6: Dashboard — Shell & Sidebar

**Files:**
- Create: `dashboard/options.html`
- Create: `dashboard/options.css`
- Create: `dashboard/options.js`

- [ ] **Step 1: Create `dashboard/options.css`**

```css
/* dashboard/options.css */
* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: #f3f4f6;
  color: #111;
  display: flex;
  height: 100vh;
  overflow: hidden;
}

/* Sidebar */
#sidebar {
  width: 180px;
  background: #fff;
  border-right: 1px solid #e5e7eb;
  display: flex;
  flex-direction: column;
  padding: 20px 12px;
  gap: 4px;
  flex-shrink: 0;
}

#sidebar .logo {
  font-size: 12px;
  font-weight: 800;
  color: #6366f1;
  letter-spacing: 1px;
  margin-bottom: 20px;
  padding-left: 8px;
}

#sidebar .nav-item {
  padding: 8px 10px;
  border-radius: 7px;
  font-size: 13px;
  color: #6b7280;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  user-select: none;
}

#sidebar .nav-item:hover { background: #f9fafb; color: #374151; }
#sidebar .nav-item.active { background: #eef2ff; color: #4338ca; font-weight: 600; }

/* Main content */
#main {
  flex: 1;
  overflow-y: auto;
  padding: 28px 32px;
}

#main h2 {
  font-size: 20px;
  font-weight: 700;
  margin-bottom: 20px;
}

/* Sections */
.section { display: none; }
.section.active { display: block; }

/* Stats row */
.stats-row {
  display: flex;
  gap: 14px;
  margin-bottom: 24px;
}

.stat-card {
  background: #fff;
  border-radius: 10px;
  padding: 14px 18px;
  flex: 1;
  box-shadow: 0 1px 3px rgba(0,0,0,0.07);
}

.stat-card .value {
  font-size: 22px;
  font-weight: 800;
  color: #111;
}

.stat-card .label {
  font-size: 11px;
  color: #9ca3af;
  margin-top: 2px;
}

/* Chart container */
.chart-container {
  background: #fff;
  border-radius: 10px;
  padding: 18px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.07);
  margin-bottom: 20px;
}

.chart-container h3 {
  font-size: 13px;
  font-weight: 600;
  color: #374151;
  margin-bottom: 14px;
}

/* Site table */
.site-table {
  background: #fff;
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0,0,0,0.07);
  margin-bottom: 20px;
}

.site-table table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.site-table th {
  text-align: left;
  padding: 10px 16px;
  font-size: 11px;
  color: #9ca3af;
  font-weight: 600;
  border-bottom: 1px solid #f3f4f6;
  text-transform: uppercase;
}

.site-table td {
  padding: 10px 16px;
  border-bottom: 1px solid #f9fafb;
  color: #374151;
}

.site-table tr:last-child td { border-bottom: none; }

.leisure-badge {
  background: #fee2e2;
  color: #b91c1c;
  font-size: 10px;
  font-weight: 600;
  border-radius: 4px;
  padding: 1px 5px;
  margin-left: 6px;
}

/* Settings form */
.settings-form {
  background: #fff;
  border-radius: 10px;
  padding: 20px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.07);
  max-width: 480px;
  margin-bottom: 20px;
}

.settings-form h3 {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 14px;
}

.form-row {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-bottom: 14px;
}

.form-row label { font-size: 12px; color: #6b7280; font-weight: 500; }

.form-row input[type="number"],
.form-row textarea {
  padding: 7px 10px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 13px;
  font-family: inherit;
  resize: vertical;
}

.form-row textarea { min-height: 120px; }

.btn {
  padding: 8px 16px;
  border-radius: 7px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border: none;
}

.btn-primary { background: #6366f1; color: #fff; }
.btn-primary:hover { background: #4f46e5; }
.btn-danger { background: #fee2e2; color: #dc2626; }
.btn-danger:hover { background: #fecaca; }
```

- [ ] **Step 2: Create `dashboard/options.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Hourglass Dashboard</title>
  <link rel="stylesheet" href="options.css">
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
</head>
<body>
  <nav id="sidebar">
    <div class="logo">HOURGLASS</div>
    <div class="nav-item active" data-section="overview">📊 Overview</div>
    <div class="nav-item" data-section="history">📅 History</div>
    <div class="nav-item" data-section="sites">🌐 Sites</div>
    <div class="nav-item" data-section="settings">⚙️ Settings</div>
  </nav>

  <main id="main">
    <!-- Overview -->
    <section id="section-overview" class="section active">
      <h2>Overview</h2>
      <div class="stats-row">
        <div class="stat-card"><div class="value" id="stat-today">—</div><div class="label">leisure today</div></div>
        <div class="stat-card"><div class="value" id="stat-week">—</div><div class="label">leisure this week</div></div>
        <div class="stat-card"><div class="value" id="stat-remaining">—</div><div class="label">budget remaining</div></div>
      </div>
      <div class="chart-container">
        <h3>Daily leisure time — last 7 days</h3>
        <canvas id="weekly-chart" height="80"></canvas>
      </div>
      <div class="site-table">
        <table>
          <thead><tr><th>Site</th><th>Today</th></tr></thead>
          <tbody id="overview-site-tbody"></tbody>
        </table>
      </div>
    </section>

    <!-- History -->
    <section id="section-history" class="section">
      <h2>History</h2>
      <div id="history-list"></div>
    </section>

    <!-- Sites -->
    <section id="section-sites" class="section">
      <h2>Leisure Sites</h2>
      <div class="settings-form">
        <h3>Add a domain</h3>
        <div class="form-row">
          <label>Domain (e.g. example.com)</label>
          <input type="text" id="add-domain-input" placeholder="example.com">
        </div>
        <button class="btn btn-primary" id="add-domain-btn">Add</button>
      </div>
      <div class="site-table">
        <table>
          <thead><tr><th>Domain</th><th>This week</th><th></th></tr></thead>
          <tbody id="sites-tbody"></tbody>
        </table>
      </div>
    </section>

    <!-- Settings -->
    <section id="section-settings" class="section">
      <h2>Settings</h2>
      <div class="settings-form">
        <h3>Daily Leisure Budget</h3>
        <div class="form-row">
          <label>Budget (minutes per day)</label>
          <input type="number" id="budget-input" min="1" max="1440">
        </div>
        <button class="btn btn-primary" id="save-settings-btn">Save</button>
      </div>
      <div class="settings-form">
        <h3>Danger Zone</h3>
        <button class="btn btn-danger" id="reset-today-btn">Reset today's data</button>
      </div>
    </section>
  </main>

  <script type="module" src="options.js"></script>
</body>
</html>
```

- [ ] **Step 3: Create `dashboard/options.js`**

```js
// dashboard/options.js
import { storage } from '../shared/storage/index.js';
import { computeLeisureSeconds, budgetPercent, formatDuration, localDateStr, daysAgo } from '../shared/tracker.js';

let settings = null;
let weeklyUsage = null; // { dateStr: { domain: seconds } }

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------
document.querySelectorAll('.nav-item').forEach((item) => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach((n) => n.classList.remove('active'));
    document.querySelectorAll('.section').forEach((s) => s.classList.remove('active'));
    item.classList.add('active');
    const sec = document.getElementById(`section-${item.dataset.section}`);
    if (sec) sec.classList.add('active');
  });
});

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------
async function loadData() {
  settings = await storage.getSettings();
  const today = localDateStr();
  const sevenDaysAgo = daysAgo(6);
  weeklyUsage = await storage.getUsageRange(sevenDaysAgo, today);
}

// ---------------------------------------------------------------------------
// Overview section
// ---------------------------------------------------------------------------
async function renderOverview() {
  const today = localDateStr();
  const todayUsage = weeklyUsage[today] ?? {};
  const leisureSec = computeLeisureSeconds(todayUsage, settings.leisureDomains);
  const budgetSec = settings.dailyBudgetMinutes * 60;
  const remainSec = Math.max(0, budgetSec - leisureSec);

  // Weekly leisure total
  const weekLeisureSec = Object.values(weeklyUsage).reduce((sum, usage) => {
    return sum + computeLeisureSeconds(usage, settings.leisureDomains);
  }, 0);

  document.getElementById('stat-today').textContent = formatDuration(leisureSec);
  document.getElementById('stat-week').textContent = formatDuration(weekLeisureSec);
  document.getElementById('stat-remaining').textContent = formatDuration(remainSec);

  // Weekly bar chart
  const labels = [];
  const data = [];
  for (let i = 6; i >= 0; i--) {
    const d = daysAgo(i);
    const dayUsage = weeklyUsage[d] ?? {};
    labels.push(d.slice(5)); // MM-DD
    data.push(Math.round(computeLeisureSeconds(dayUsage, settings.leisureDomains) / 60));
  }

  const ctx = document.getElementById('weekly-chart').getContext('2d');
  if (window._weeklyChart) window._weeklyChart.destroy();
  window._weeklyChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Leisure (min)',
        data,
        backgroundColor: data.map((v) =>
          v > settings.dailyBudgetMinutes ? '#f87171' : '#a5b4fc'
        ),
        borderRadius: 4,
      }],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, title: { display: true, text: 'minutes' } } },
    },
  });

  // Today's site table
  const leisureSet = new Set(settings.leisureDomains);
  const sorted = Object.entries(todayUsage).sort(([, a], [, b]) => b - a);
  const tbody = document.getElementById('overview-site-tbody');
  tbody.innerHTML = sorted.map(([domain, sec]) => `
    <tr>
      <td>${domain}${leisureSet.has(domain) ? '<span class="leisure-badge">leisure</span>' : ''}</td>
      <td>${formatDuration(sec)}</td>
    </tr>
  `).join('') || '<tr><td colspan="2" style="color:#9ca3af;text-align:center;padding:16px">No data today</td></tr>';
}

// ---------------------------------------------------------------------------
// History section
// ---------------------------------------------------------------------------
async function renderHistory() {
  const container = document.getElementById('history-list');
  const leisureSet = new Set(settings.leisureDomains);

  const days = Object.keys(weeklyUsage).sort().reverse();
  if (days.length === 0) {
    container.innerHTML = '<p style="color:#9ca3af">No history yet.</p>';
    return;
  }

  container.innerHTML = days.map((dateStr) => {
    const usage = weeklyUsage[dateStr];
    const leisureSec = computeLeisureSeconds(usage, settings.leisureDomains);
    const sorted = Object.entries(usage).sort(([, a], [, b]) => b - a);
    const rows = sorted.map(([d, s]) =>
      `<tr><td style="padding:4px 8px;color:#6b7280;font-size:12px">${d}${leisureSet.has(d) ? '<span class="leisure-badge">leisure</span>' : ''}</td><td style="padding:4px 8px;font-size:12px">${formatDuration(s)}</td></tr>`
    ).join('');
    return `
      <div class="site-table" style="margin-bottom:12px">
        <table>
          <thead><tr>
            <th>${dateStr}</th>
            <th style="color:#dc2626">${formatDuration(leisureSec)} leisure</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }).join('');
}

// ---------------------------------------------------------------------------
// Sites section
// ---------------------------------------------------------------------------
async function renderSites() {
  const today = localDateStr();
  const sevenDaysAgo = daysAgo(6);
  const range = await storage.getUsageRange(sevenDaysAgo, today);

  // Sum per domain across week
  const weekTotals = {};
  for (const usage of Object.values(range)) {
    for (const [domain, sec] of Object.entries(usage)) {
      weekTotals[domain] = (weekTotals[domain] ?? 0) + sec;
    }
  }

  const sorted = [...settings.leisureDomains].sort();
  const tbody = document.getElementById('sites-tbody');
  tbody.innerHTML = sorted.map((domain) => `
    <tr>
      <td>${domain}</td>
      <td>${formatDuration(weekTotals[domain] ?? 0)}</td>
      <td><button class="btn btn-danger" style="padding:3px 8px;font-size:11px" data-domain="${domain}">Remove</button></td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-domain]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      settings.leisureDomains = settings.leisureDomains.filter((d) => d !== btn.dataset.domain);
      await storage.saveSettings(settings);
      await renderSites();
    });
  });
}

document.getElementById('add-domain-btn').addEventListener('click', async () => {
  const input = document.getElementById('add-domain-input');
  const domain = input.value.trim().replace(/^www\./, '').toLowerCase();
  if (!domain) return;
  if (!settings.leisureDomains.includes(domain)) {
    settings.leisureDomains.push(domain);
    await storage.saveSettings(settings);
  }
  input.value = '';
  await renderSites();
});

// ---------------------------------------------------------------------------
// Settings section
// ---------------------------------------------------------------------------
async function renderSettings() {
  document.getElementById('budget-input').value = settings.dailyBudgetMinutes;
}

document.getElementById('save-settings-btn').addEventListener('click', async () => {
  const budget = parseInt(document.getElementById('budget-input').value, 10);
  if (!budget || budget < 1) return;
  settings.dailyBudgetMinutes = budget;
  await storage.saveSettings(settings);
  alert('Settings saved.');
});

document.getElementById('reset-today-btn').addEventListener('click', async () => {
  if (!confirm('Reset all tracking data for today?')) return;
  await storage.saveUsageForDate(localDateStr(), {});
  await loadData();
  await renderOverview();
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function init() {
  await loadData();
  await Promise.all([renderOverview(), renderHistory(), renderSites(), renderSettings()]);
}

init();
```

- [ ] **Step 4: Load extension and verify dashboard**

1. Reload extension in `chrome://extensions`
2. Browse several sites including leisure ones for a few minutes
3. Click popup → "Full report →"
4. Verify: Overview shows budget stat cards and bar chart; History lists days; Sites shows leisure domain list; Settings shows budget input

- [ ] **Step 5: Commit**

```bash
git add dashboard/
git commit -m "feat: dashboard with overview, history, sites, and settings sections"
```

---

## Task 7: Smoke Test & Polish

**Files:**
- Modify: `background.js` (minor)

- [ ] **Step 1: Verify end-to-end notification flow**

1. Temporarily lower `dailyBudgetMinutes` to 1 in Settings
2. Browse YouTube for 90 seconds
3. Confirm 80% notification fires
4. Browse for another 30 seconds
5. Confirm 100% stern notification fires with site list and Snooze/Dismiss buttons
6. Click Snooze — confirm notification disappears
7. Restore budget to 120 in Settings

- [ ] **Step 2: Verify midnight reset alarm**

Open DevTools → Service Worker console and run:
```js
chrome.alarms.getAll(alarms => console.log(alarms))
```
Confirm `flush` (1-min period) and `midnight-reset` alarms are present.

- [ ] **Step 3: Verify storage pruning**

In DevTools console:
```js
chrome.storage.local.get(null, d => console.log(Object.keys(d)))
```
Confirm keys follow pattern: `settings`, `session`, `usage_YYYY-MM-DD`.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: smoke test complete, v1 ready"
```

---

## Out of Scope (v1)

- Per-site individual limits
- CSV/JSON export
- Site blocking (hard block overlay)
- Cross-device sync
- Auto-categorization of new domains
- IndexedDB migration (stub exists at `shared/storage/indexed-db-adapter.js`)
