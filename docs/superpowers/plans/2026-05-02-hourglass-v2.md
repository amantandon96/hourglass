# Hourglass v2 — Multi-Category Budgets & IndexedDB Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single leisure budget with user-defined per-category budgets, migrate storage from `chrome.storage.local` to IndexedDB, and update the UI to show stacked category cards in the popup and a full Categories management section in the dashboard.

**Architecture:** The `IndexedDbAdapter` replaces `ChromeStorageAdapter` as the active storage backend (same `StorageAdapter` interface — no callers change). On first launch after upgrade, a migration function detects v1 data in `chrome.storage.local` and converts it to v2 format in IndexedDB. The background worker iterates all categories on each flush and fires per-category notifications. UI is updated to show stacked category cards in the popup and a Categories section in the dashboard.

**Tech Stack:** Vanilla JS (ES modules), Chrome Extension Manifest V3, IndexedDB, Chart.js (CDN, stacked bar mode).

---

## File Map

```
hourglass/
├── background.js                           # MODIFY: per-category checks, migration call
├── shared/
│   ├── constants.js                        # MODIFY: remove v1 leisure defaults, add DEFAULT_CATEGORIES
│   ├── tracker.js                          # MODIFY: add 3 category helper functions
│   └── storage/
│       ├── index.js                        # MODIFY: switch active adapter to IndexedDbAdapter
│       ├── chrome-storage-adapter.js       # UNCHANGED (used during migration read)
│       └── indexed-db-adapter.js           # REWRITE: full implementation (was stub)
├── popup/
│   ├── popup.html                          # MODIFY: replace single budget card with #category-list container
│   ├── popup.js                            # REWRITE: stacked category cards + uncategorized list
│   └── popup.css                           # MODIFY: add category card styles
└── dashboard/
    ├── options.html                        # MODIFY: add Categories nav item + section markup
    ├── options.js                          # MODIFY: add renderCategories(), update Overview/History
    └── options.css                         # MODIFY: stacked chart styles, category table styles
```

---

## Task 1: Update `shared/constants.js`

Remove v1 leisure defaults. Add `DEFAULT_CATEGORIES`. Update `DEFAULT_SETTINGS` to v2 shape.

**Files:**
- Modify: `shared/constants.js`

- [ ] **Step 1: Replace contents of `shared/constants.js`**

```js
// shared/constants.js
export const DEFAULT_NOTIFY_AT = [80, 100];
export const FLUSH_ALARM_NAME = 'flush';
export const MIDNIGHT_ALARM_NAME = 'midnight-reset';
export const SNOOZE_MINUTES = 15;
export const PRUNE_DAYS = 90;

// v2: no pre-defined categories — user sets up their own from scratch
export const DEFAULT_CATEGORIES = [];

export const DEFAULT_SETTINGS = {
  notifyAt: DEFAULT_NOTIFY_AT,
  categories: DEFAULT_CATEGORIES,
};
```

- [ ] **Step 2: Verify no compilation errors**

Load `chrome://extensions`, click Reload on Hourglass, confirm no service worker errors in the console (the extension will still use `chrome.storage.local` until Task 4 — that's fine for now).

- [ ] **Step 3: Commit**

```bash
git add shared/constants.js
git commit -m "feat(v2): remove v1 leisure defaults, add DEFAULT_CATEGORIES"
```

---

## Task 2: Add category helper functions to `shared/tracker.js`

Three new pure functions. Existing functions (`computeLeisureSeconds`, `budgetPercent`, etc.) are kept — they are still used during migration.

**Files:**
- Modify: `shared/tracker.js`

- [ ] **Step 1: Append the three functions to the end of `shared/tracker.js`**

```js
/**
 * Returns the category object whose `domains` array includes `domain`, or null.
 * @param {string} domain
 * @param {Array<{id:string, name:string, budgetMinutes:number, domains:string[]}>} categories
 */
export function getCategoryForDomain(domain, categories) {
  for (const cat of categories) {
    if (cat.domains.includes(domain)) return cat;
  }
  return null;
}

/**
 * Sums seconds for all domains that belong to `category`.
 * @param {{ [domain: string]: number }} usage  — { domain: seconds }
 * @param {{ domains: string[] }} category
 * @returns {number}
 */
export function computeCategorySeconds(usage, category) {
  const set = new Set(category.domains);
  return Object.entries(usage).reduce((sum, [domain, seconds]) => {
    return set.has(domain) ? sum + seconds : sum;
  }, 0);
}

/**
 * Returns { categoryId: seconds } for every category.
 * @param {{ [domain: string]: number }} usage
 * @param {Array<{id:string, domains:string[]}>} categories
 * @returns {{ [categoryId: string]: number }}
 */
export function computeAllCategoryUsage(usage, categories) {
  const result = {};
  for (const cat of categories) {
    result[cat.id] = computeCategorySeconds(usage, cat);
  }
  return result;
}
```

- [ ] **Step 2: Manually verify the functions in the browser console**

Open `chrome://extensions`, open the service worker devtools console, paste:

```js
// These are pure functions — test inline
const usage = { 'youtube.com': 1800, 'twitter.com': 600, 'github.com': 3600 };
const cats = [
  { id: 'video', name: 'Video', budgetMinutes: 60, domains: ['youtube.com'] },
  { id: 'social', name: 'Social', budgetMinutes: 60, domains: ['twitter.com'] },
];
// Expected: { id: 'video', ... }
console.assert(getCategoryForDomain('youtube.com', cats).id === 'video');
// Expected: 1800
console.assert(computeCategorySeconds(usage, cats[0]) === 1800);
// Expected: { video: 1800, social: 600 }
const all = computeAllCategoryUsage(usage, cats);
console.assert(all.video === 1800 && all.social === 600);
console.log('tracker tests passed');
```

(You'll need to import these first or paste them as plain functions without `export` for quick console testing.)

- [ ] **Step 3: Commit**

```bash
git add shared/tracker.js
git commit -m "feat(v2): add getCategoryForDomain, computeCategorySeconds, computeAllCategoryUsage"
```

---

## Task 3: Implement `shared/storage/indexed-db-adapter.js`

Full replacement of the stub. Implements the same `StorageAdapter` interface as `ChromeStorageAdapter`.

**IndexedDB schema:**
- DB name: `panopticon`, version `1`
- Object store `settings` — fixed key `"settings"`
- Object store `session` — fixed key `"session"`
- Object store `usage` — key `"${date}_${domain}"`, index `date` (non-unique) on the `date` property of stored records

**Files:**
- Rewrite: `shared/storage/indexed-db-adapter.js`

- [ ] **Step 1: Replace the file with the full implementation**

```js
// shared/storage/indexed-db-adapter.js

export class IndexedDbAdapter {
  constructor() {
    this._db = this._openDb();
  }

  _openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('panopticon', 1);

      req.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings');
        }
        if (!db.objectStoreNames.contains('session')) {
          db.createObjectStore('session');
        }
        if (!db.objectStoreNames.contains('usage')) {
          const store = db.createObjectStore('usage');
          store.createIndex('date', 'date', { unique: false });
        }
      };

      req.onsuccess = (event) => resolve(event.target.result);
      req.onerror = (event) => reject(event.target.error);
    });
  }

  async _tx(storeName, mode, fn) {
    const db = await this._db;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      const req = fn(store);
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  // ---- Settings ----

  async getSettings() {
    const result = await this._tx('settings', 'readonly', (s) => s.get('settings'));
    return result ?? null;
  }

  async saveSettings(settings) {
    await this._tx('settings', 'readwrite', (s) => s.put(settings, 'settings'));
  }

  // ---- Session ----

  async getSession() {
    const result = await this._tx('session', 'readonly', (s) => s.get('session'));
    return result ?? null;
  }

  async saveSession(session) {
    await this._tx('session', 'readwrite', (s) => s.put(session, 'session'));
  }

  // ---- Usage ----

  async getUsageForDate(dateStr) {
    const db = await this._db;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('usage', 'readonly');
      const index = tx.objectStore('usage').index('date');
      const req = index.getAll(IDBKeyRange.only(dateStr));
      req.onsuccess = (e) => {
        const records = e.target.result; // [{ date, domain, seconds }, ...]
        const usage = {};
        for (const r of records) usage[r.domain] = r.seconds;
        resolve(usage);
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async saveUsageForDate(dateStr, usage) {
    const db = await this._db;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('usage', 'readwrite');
      const store = tx.objectStore('usage');
      for (const [domain, seconds] of Object.entries(usage)) {
        store.put({ date: dateStr, domain, seconds }, `${dateStr}_${domain}`);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  async getUsageRange(startDateStr, endDateStr) {
    const db = await this._db;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('usage', 'readonly');
      const index = tx.objectStore('usage').index('date');
      const range = IDBKeyRange.bound(startDateStr, endDateStr);
      const req = index.getAll(range);
      req.onsuccess = (e) => {
        const records = e.target.result;
        const out = {};
        for (const r of records) {
          if (!out[r.date]) out[r.date] = {};
          out[r.date][r.domain] = r.seconds;
        }
        resolve(out);
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async pruneOldData(beforeDateStr) {
    const db = await this._db;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('usage', 'readwrite');
      const index = tx.objectStore('usage').index('date');
      // upperBound exclusive: all dates strictly less than beforeDateStr
      const range = IDBKeyRange.upperBound(beforeDateStr, true);
      const req = index.openCursor(range);
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
      req.onerror = (e) => reject(e.target.error);
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  }
}
```

- [ ] **Step 2: Commit (still not the active adapter — safe)**

```bash
git add shared/storage/indexed-db-adapter.js
git commit -m "feat(v2): implement IndexedDbAdapter"
```

---

## Task 4: Switch active adapter to `IndexedDbAdapter`

One import change in `shared/storage/index.js`.

**Files:**
- Modify: `shared/storage/index.js`

- [ ] **Step 1: Read the current file to see what to change**

Current content of `shared/storage/index.js`:
```js
import { ChromeStorageAdapter } from './chrome-storage-adapter.js';
export const storage = new ChromeStorageAdapter();
```

- [ ] **Step 2: Replace with IndexedDbAdapter**

```js
// shared/storage/index.js
import { IndexedDbAdapter } from './indexed-db-adapter.js';
export const storage = new IndexedDbAdapter();
```

- [ ] **Step 3: Reload extension and verify IndexedDB works**

1. Go to `chrome://extensions`, click **Reload** on Hourglass
2. Open service worker devtools → Console
3. Confirm no errors on startup
4. Browse a couple websites for 30 seconds
5. Open Chrome DevTools → Application → IndexedDB → `panopticon`
6. Confirm the `usage` store is receiving records with `{ date, domain, seconds }` shape
7. Confirm `settings` store has a record at key `"settings"` with `{ notifyAt: [80, 100], categories: [] }`

- [ ] **Step 4: Commit**

```bash
git add shared/storage/index.js
git commit -m "feat(v2): switch active storage adapter to IndexedDB"
```

---

## Task 5: v1 → v2 Migration

Add a `runMigrationIfNeeded()` function to `background.js` that is called from `init()` before anything else. It reads v1 data from `chrome.storage.local`, writes v2 data to IndexedDB, then marks migration complete.

**Files:**
- Modify: `background.js`

- [ ] **Step 1: Add the migration function and call it from `init()`**

At the top of `background.js`, update the import from `tracker.js` to include `localDateStr` (already imported) — no change needed there.

Add the migration function **before** the `init()` function:

```js
// ---------------------------------------------------------------------------
// v1 → v2 Migration
// ---------------------------------------------------------------------------
async function runMigrationIfNeeded() {
  // Detect v1 data by presence of settings.leisureDomains in chrome.storage.local
  const { settings: v1Settings, migrated } = await chrome.storage.local.get(['settings', 'migrated']);

  if (migrated) return; // already done
  if (!v1Settings?.leisureDomains) return; // fresh install — no v1 data

  console.log('[hourglass] Migrating v1 data to IndexedDB...');

  // 1. Build v2 settings from v1
  const v2Settings = {
    notifyAt: v1Settings.notifyAt ?? [80, 100],
    categories: [
      {
        id: 'leisure',
        name: 'Leisure',
        budgetMinutes: v1Settings.dailyBudgetMinutes ?? 120,
        domains: v1Settings.leisureDomains ?? [],
      },
    ],
  };
  await storage.saveSettings(v2Settings);

  // 2. Migrate usage data — keys are "usage_YYYY-MM-DD"
  const allData = await chrome.storage.local.get(null);
  for (const [key, value] of Object.entries(allData)) {
    if (!key.startsWith('usage_')) continue;
    const dateStr = key.replace('usage_', '');
    if (typeof value === 'object' && value !== null) {
      await storage.saveUsageForDate(dateStr, value);
    }
  }

  // 3. Migrate session
  const { session: v1Session } = await chrome.storage.local.get('session');
  if (v1Session) {
    const v2Session = {
      snoozedUntil: v1Session.snoozedUntil
        ? { leisure: v1Session.snoozedUntil }
        : { leisure: null },
      dismissedToday: v1Session.dismissedToday ? ['leisure'] : [],
      notifiedThresholds: {
        leisure: v1Session.notifiedThresholds ?? [],
      },
    };
    await storage.saveSession(v2Session);
  }

  // 4. Mark complete and clean up chrome.storage.local
  await chrome.storage.local.set({ migrated: true });
  const keysToRemove = Object.keys(allData).filter((k) => k !== 'migrated');
  if (keysToRemove.length > 0) {
    await chrome.storage.local.remove(keysToRemove);
  }

  console.log('[hourglass] Migration complete.');
}
```

- [ ] **Step 2: Call `runMigrationIfNeeded()` at the start of `init()`**

Change the beginning of `init()` from:
```js
async function init() {
  settings = await storage.getSettings();
```

To:
```js
async function init() {
  await runMigrationIfNeeded();
  settings = await storage.getSettings();
```

- [ ] **Step 3: Verify on a fresh install**

1. Reload extension
2. Confirm `chrome.storage.local` is empty (DevTools → Application → Local Storage or Service Worker console: `await chrome.storage.local.get(null)`)
3. Confirm IndexedDB `settings` key `"settings"` = `{ notifyAt: [80,100], categories: [] }`
4. Service worker console should NOT log "Migrating v1 data"

- [ ] **Step 4: Commit**

```bash
git add background.js
git commit -m "feat(v2): add v1→v2 migration on first startup"
```

---

## Task 6: Update `background.js` for per-category budget checks

Replace the single-leisure `checkBudget` and `fireNotification` with per-category versions. Update in-memory session state from `dismissedToday: bool` to `dismissedToday: string[]` and `notifiedThresholds: {}` → `notifiedThresholds: { [catId]: number[] }`. Update `snoozedUntil` from `number|null` to `{ [catId]: number|null }`.

**Files:**
- Modify: `background.js`

- [ ] **Step 1: Update the import line at the top of `background.js`**

Replace:
```js
import { extractDomain, computeLeisureSeconds, budgetPercent, localDateStr, daysAgo, nextMidnight } from './shared/tracker.js';
```
With:
```js
import { extractDomain, budgetPercent, formatDuration, localDateStr, daysAgo, nextMidnight, computeAllCategoryUsage } from './shared/tracker.js';
```

- [ ] **Step 2: Replace in-memory session state declarations**

Replace:
```js
let snoozedUntil = null;       // epoch ms | null
let dismissedToday = false;    // bool — no more notifications today
let notifiedThresholds = [];   // array of percent thresholds already fired today
```
With:
```js
let snoozedUntil = {};         // { [categoryId]: epoch ms | null }
let dismissedToday = [];       // array of categoryIds dismissed today
let notifiedThresholds = {};   // { [categoryId]: number[] } thresholds already fired
```

- [ ] **Step 3: Update `init()` session restore**

Replace:
```js
  if (session) {
    snoozedUntil = session.snoozedUntil ?? null;
    dismissedToday = session.dismissedToday ?? false;
    notifiedThresholds = session.notifiedThresholds ?? [];
  }
```
With:
```js
  if (session) {
    snoozedUntil = session.snoozedUntil ?? {};
    dismissedToday = session.dismissedToday ?? [];
    notifiedThresholds = session.notifiedThresholds ?? {};
  }
```

- [ ] **Step 4: Replace `checkBudget` and `fireNotification`**

Replace the entire `// Budget notifications` block (lines 96–146 in the original file):

```js
// ---------------------------------------------------------------------------
// Budget notifications
// ---------------------------------------------------------------------------
async function checkBudget(usage) {
  // Re-read settings in case user changed them
  settings = await storage.getSettings();
  const categories = settings.categories ?? [];
  if (categories.length === 0) return;

  const categoryUsage = computeAllCategoryUsage(usage, categories);

  for (const cat of categories) {
    const catId = cat.id;
    if (dismissedToday.includes(catId)) continue;

    const now = Date.now();
    const snoozedUntilCat = snoozedUntil[catId] ?? null;
    if (snoozedUntilCat && now < snoozedUntilCat) continue;

    const seconds = categoryUsage[catId] ?? 0;
    const pct = budgetPercent(seconds, cat.budgetMinutes);
    const fired = notifiedThresholds[catId] ?? [];

    for (const threshold of settings.notifyAt) {
      if (pct >= threshold && !fired.includes(threshold)) {
        await fireNotification(cat, threshold, usage, pct, seconds);
        notifiedThresholds[catId] = [...fired, threshold];
        await persistSession();
      }
    }
  }
}

async function fireNotification(cat, threshold, usage, pct, catSeconds) {
  const topOffenders = Object.entries(usage)
    .filter(([d]) => cat.domains.includes(d))
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([d, s]) => `${d} (${formatDuration(s)})`)
    .join(', ');

  const budgetSec = cat.budgetMinutes * 60;
  const remainSec = Math.max(0, budgetSec - catSeconds);
  const remainMin = Math.floor(remainSec / 60);

  const is100 = threshold >= 100;

  const title = is100
    ? `${cat.name} budget exhausted`
    : `Heads up — ${remainMin}m of ${cat.name} budget left`;

  const message = is100
    ? `${topOffenders || 'no sites tracked'}. Snooze or stop?`
    : `You've used ${pct}% of your ${cat.budgetMinutes}m ${cat.name} budget.`;

  const notifId = `threshold-${cat.id}-${threshold}`;
  const notifOptions = {
    type: 'basic',
    iconUrl: 'icons/icon48.png',
    title,
    message,
    priority: is100 ? 2 : 0,
    ...(is100 ? { buttons: [{ title: 'Snooze 15 min' }, { title: 'Dismiss' }] } : {}),
  };

  await chrome.notifications.create(notifId, notifOptions);
}
```

- [ ] **Step 5: Update `chrome.notifications.onButtonClicked` listener**

Replace the entire listener:
```js
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
```
With:
```js
chrome.notifications.onButtonClicked.addListener(async (notifId, buttonIndex) => {
  // notifId format: threshold-{categoryId}-{threshold}
  if (!notifId.startsWith('threshold-')) return;

  // Parse categoryId from notifId — everything between first and last dash-separated segment
  // Format: "threshold-{catId}-{threshold}" where catId may contain hyphens
  const withoutPrefix = notifId.replace(/^threshold-/, '');
  const lastDashIdx = withoutPrefix.lastIndexOf('-');
  const catId = withoutPrefix.slice(0, lastDashIdx);

  if (buttonIndex === 0) {
    // Snooze this category
    const snoozeUntilMs = Date.now() + SNOOZE_MINUTES * 60 * 1000;
    snoozedUntil = { ...snoozedUntil, [catId]: snoozeUntilMs };
    // Remove threshold=100 from notifiedThresholds for this category so it re-fires after snooze
    notifiedThresholds[catId] = (notifiedThresholds[catId] ?? []).filter((t) => t < 100);
    chrome.alarms.create(`snooze-end-${catId}`, { when: snoozeUntilMs });
  } else if (buttonIndex === 1) {
    // Dismiss this category for today
    if (!dismissedToday.includes(catId)) {
      dismissedToday = [...dismissedToday, catId];
    }
  }
  await persistSession();
  chrome.notifications.clear(notifId);
});
```

- [ ] **Step 6: Update the snooze-end alarm handler**

Replace in `chrome.alarms.onAlarm.addListener`:
```js
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
```
With:
```js
  } else if (alarm.name.startsWith('snooze-end-')) {
    const catId = alarm.name.replace('snooze-end-', '');
    const now = Date.now();
    if (snoozedUntil[catId] && now >= snoozedUntil[catId]) {
      snoozedUntil = { ...snoozedUntil, [catId]: null };
      await persistSession();
      const dateStr = localDateStr();
      const usage = await storage.getUsageForDate(dateStr);
      await checkBudget(usage);
    }
  }
```

- [ ] **Step 7: Update `midnightReset` to reset per-category state**

Replace:
```js
  snoozedUntil = null;
  dismissedToday = false;
  notifiedThresholds = [];
```
With:
```js
  snoozedUntil = {};
  dismissedToday = [];
  notifiedThresholds = {};
```

- [ ] **Step 8: Update `persistSession`**

The `persistSession` function body is already correct — it just saves whatever `snoozedUntil`, `dismissedToday`, `notifiedThresholds` are. No change needed.

- [ ] **Step 9: Reload and verify**

1. Reload extension
2. Open service worker devtools — confirm no errors
3. Browse YouTube for 30s, then check DevTools → IndexedDB → `usage` store — confirm records exist

- [ ] **Step 10: Commit**

```bash
git add background.js
git commit -m "feat(v2): per-category budget checks and notifications"
```

---

## Task 7: Update Popup UI

Replace the single budget bar with stacked category cards. Uncategorized domains appear below.

**Files:**
- Modify: `popup/popup.html`
- Rewrite: `popup/popup.js`
- Modify: `popup/popup.css`

- [ ] **Step 1: Update `popup/popup.html`**

Replace:
```html
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
```
With:
```html
  <div id="category-list"></div>

  <div class="site-list" id="site-list"></div>
```

- [ ] **Step 2: Rewrite `popup/popup.js`**

```js
// popup/popup.js
import { storage } from '../shared/storage/index.js';
import {
  getCategoryForDomain,
  computeCategorySeconds,
  budgetPercent,
  formatDuration,
  localDateStr,
} from '../shared/tracker.js';

// Fixed colour palette for categories (assigned by index)
const CATEGORY_COLORS = [
  '#818cf8', // indigo
  '#34d399', // emerald
  '#fb923c', // orange
  '#f472b6', // pink
  '#60a5fa', // blue
  '#a78bfa', // violet
  '#facc15', // yellow
];

async function render() {
  const settings = await storage.getSettings();
  const today = localDateStr();
  const usage = await storage.getUsageForDate(today);

  const categories = settings?.categories ?? [];
  const categoryList = document.getElementById('category-list');
  const siteList = document.getElementById('site-list');

  if (categories.length === 0) {
    categoryList.innerHTML =
      '<div class="empty" style="padding:12px 16px;color:#9ca3af;font-size:12px">No categories yet — set them up in the dashboard.</div>';
  } else {
    // Sort by % used descending (most urgent first)
    const sorted = categories
      .map((cat, i) => {
        const sec = computeCategorySeconds(usage, cat);
        const pct = budgetPercent(sec, cat.budgetMinutes);
        return { cat, sec, pct, color: CATEGORY_COLORS[i % CATEGORY_COLORS.length] };
      })
      .sort((a, b) => b.pct - a.pct);

    categoryList.innerHTML = sorted.map(({ cat, sec, pct, color }) => {
      const budgetSec = cat.budgetMinutes * 60;
      const remainSec = Math.max(0, budgetSec - sec);
      const fillPct = Math.min(pct, 100);
      return `
        <div class="category-card">
          <div class="category-name">${cat.name.toUpperCase()}</div>
          <div class="bar-wrap">
            <div class="bar-fill" style="width:${fillPct}%;background:${color}"></div>
          </div>
          <div class="category-meta">
            <span>${formatDuration(sec)} used of ${cat.budgetMinutes}m</span>
            <span class="remaining">${formatDuration(remainSec)} left</span>
          </div>
        </div>
      `;
    }).join('');
  }

  // Uncategorized domains — sorted by time desc, no budget bar
  const uncategorized = Object.entries(usage)
    .filter(([domain]) => getCategoryForDomain(domain, categories) === null)
    .sort(([, a], [, b]) => b - a);

  if (uncategorized.length === 0 && categories.length === 0) {
    siteList.innerHTML = '<div class="empty">No activity tracked today.</div>';
  } else {
    siteList.innerHTML = uncategorized.map(([domain, seconds]) => `
      <div class="site-card">
        <span class="domain">${domain}</span>
        <span class="time">${formatDuration(seconds)}</span>
      </div>
    `).join('');
  }
}

// Dashboard link
document.getElementById('dashboard-link').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

render();
```

- [ ] **Step 3: Add category card styles to `popup/popup.css`**

Read the current popup.css first to find the right place to add new rules. Append the following to the end of `popup/popup.css`:

```css
/* Category cards */
.category-card {
  padding: 10px 16px 8px;
  border-bottom: 1px solid #1e293b;
}

.category-card:last-child {
  border-bottom: none;
}

.category-name {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #94a3b8;
  margin-bottom: 6px;
}

.category-meta {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: #94a3b8;
  margin-top: 4px;
}
```

- [ ] **Step 4: Verify in browser**

1. Reload extension
2. Click the extension icon
3. If no categories: confirm the "No categories yet" message appears
4. Open the dashboard → Settings (Task 8 not yet done, so use DevTools to add a test category directly to IndexedDB `settings` store), then re-open popup — confirm category card appears with bar
5. Uncategorized domains appear below as plain site cards

- [ ] **Step 5: Commit**

```bash
git add popup/popup.html popup/popup.js popup/popup.css
git commit -m "feat(v2): popup stacked category cards"
```

---

## Task 8: Dashboard — Categories Section

Add a new "Categories" sidebar section with inline CRUD table.

**Files:**
- Modify: `dashboard/options.html`
- Modify: `dashboard/options.js`
- Modify: `dashboard/options.css`

- [ ] **Step 1: Add Categories nav item and section to `dashboard/options.html`**

In the `<nav id="sidebar">` block, add after the Sites nav item:
```html
    <div class="nav-item" data-section="categories">🗂 Categories</div>
```

After the closing `</section>` tag of `section-sites`, add the new section:
```html
    <!-- Categories -->
    <section id="section-categories" class="section">
      <h2>Categories</h2>
      <div class="settings-form" id="add-category-form">
        <h3>Add a category</h3>
        <div class="form-row">
          <label>Name</label>
          <input type="text" id="add-cat-name" placeholder="e.g. Social">
        </div>
        <div class="form-row">
          <label>Daily budget (minutes)</label>
          <input type="number" id="add-cat-budget" min="1" max="1440" placeholder="60">
        </div>
        <button class="btn btn-primary" id="add-cat-btn">Add Category</button>
      </div>
      <div id="categories-table-container"></div>
    </section>
```

- [ ] **Step 2: Add `renderCategories()` and its helpers to `dashboard/options.js`**

Update the import at the top of `options.js` to add `getCategoryForDomain` and `computeCategorySeconds`:

```js
import {
  computeLeisureSeconds,
  getCategoryForDomain,
  computeCategorySeconds,
  budgetPercent,
  formatDuration,
  localDateStr,
  daysAgo,
} from '../shared/tracker.js';
```

Add this function after `renderSettings()`:

```js
// ---------------------------------------------------------------------------
// Categories section
// ---------------------------------------------------------------------------
async function renderCategories() {
  const container = document.getElementById('categories-table-container');
  const categories = settings.categories ?? [];

  if (categories.length === 0) {
    container.innerHTML = '<p style="color:#9ca3af;padding:8px 0">No categories yet. Add one above.</p>';
    return;
  }

  container.innerHTML = categories.map((cat, i) => `
    <div class="cat-row" id="cat-row-${cat.id}">
      <div class="cat-row-header">
        <span class="cat-row-name">${cat.name}</span>
        <span class="cat-row-meta">${cat.budgetMinutes}m/day · ${cat.domains.length} sites</span>
        <div class="cat-row-actions">
          <button class="btn btn-sm cat-toggle-btn" data-cat="${cat.id}">▼ Domains</button>
          <button class="btn btn-danger btn-sm cat-delete-btn" data-cat="${cat.id}">✕</button>
        </div>
      </div>
      <div class="cat-domains" id="cat-domains-${cat.id}" style="display:none">
        <div class="cat-domain-list" id="cat-domain-list-${cat.id}">
          ${cat.domains.map((d) => `
            <div class="cat-domain-row">
              <span>${d}</span>
              <button class="btn btn-danger btn-sm cat-remove-domain-btn" data-cat="${cat.id}" data-domain="${d}">✕</button>
            </div>
          `).join('') || '<div style="color:#9ca3af;font-size:12px;padding:4px 0">No domains.</div>'}
        </div>
        <div class="cat-add-domain-row">
          <input type="text" class="cat-add-domain-input" id="cat-add-domain-input-${cat.id}" placeholder="example.com">
          <button class="btn btn-primary btn-sm cat-add-domain-btn" data-cat="${cat.id}">Add</button>
        </div>
        <div class="cat-conflict-msg" id="cat-conflict-${cat.id}" style="display:none"></div>
      </div>
    </div>
  `).join('');

  // Wire up toggle buttons
  container.querySelectorAll('.cat-toggle-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const domainsEl = document.getElementById(`cat-domains-${btn.dataset.cat}`);
      const isHidden = domainsEl.style.display === 'none';
      domainsEl.style.display = isHidden ? 'block' : 'none';
      btn.textContent = isHidden ? '▲ Domains' : '▼ Domains';
    });
  });

  // Wire up delete category buttons
  container.querySelectorAll('.cat-delete-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const cat = settings.categories.find((c) => c.id === btn.dataset.cat);
      if (!cat) return;
      const msg = cat.domains.length > 0
        ? `Delete ${cat.name}? Its ${cat.domains.length} domain(s) will become uncategorized.`
        : `Delete ${cat.name}?`;
      if (!confirm(msg)) return;
      settings.categories = settings.categories.filter((c) => c.id !== btn.dataset.cat);
      await storage.saveSettings(settings);
      showToast(`Deleted ${cat.name}`);
      await renderCategories();
    });
  });

  // Wire up remove domain buttons
  container.querySelectorAll('.cat-remove-domain-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const cat = settings.categories.find((c) => c.id === btn.dataset.cat);
      if (!cat) return;
      cat.domains = cat.domains.filter((d) => d !== btn.dataset.domain);
      await storage.saveSettings(settings);
      showToast(`Removed ${btn.dataset.domain}`);
      await renderCategories();
    });
  });

  // Wire up add domain buttons
  container.querySelectorAll('.cat-add-domain-btn').forEach((btn) => {
    btn.addEventListener('click', () => addDomainToCategory(btn.dataset.cat));
  });
  container.querySelectorAll('.cat-add-domain-input').forEach((input) => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addDomainToCategory(input.id.replace('cat-add-domain-input-', ''));
    });
  });
}

async function addDomainToCategory(catId) {
  const input = document.getElementById(`cat-add-domain-input-${catId}`);
  const conflictEl = document.getElementById(`cat-conflict-${catId}`);
  const domain = input.value.trim().replace(/^www\./, '').toLowerCase();
  if (!domain) return;

  conflictEl.style.display = 'none';

  // Check if domain already belongs to another category
  const existingCat = settings.categories.find(
    (c) => c.id !== catId && c.domains.includes(domain)
  );

  if (existingCat) {
    conflictEl.style.display = 'block';
    conflictEl.innerHTML = `
      <span>"${domain}" is in ${existingCat.name} — move it here?</span>
      <button class="btn btn-primary btn-sm" id="cat-conflict-confirm-${catId}">Confirm</button>
    `;
    document.getElementById(`cat-conflict-confirm-${catId}`).addEventListener('click', async () => {
      // Remove from existing category
      existingCat.domains = existingCat.domains.filter((d) => d !== domain);
      // Add to this category
      const thisCat = settings.categories.find((c) => c.id === catId);
      if (thisCat && !thisCat.domains.includes(domain)) thisCat.domains.push(domain);
      await storage.saveSettings(settings);
      input.value = '';
      conflictEl.style.display = 'none';
      showToast(`Moved ${domain} to ${thisCat.name}`);
      await renderCategories();
    });
    return;
  }

  const thisCat = settings.categories.find((c) => c.id === catId);
  if (!thisCat) return;
  if (!thisCat.domains.includes(domain)) {
    thisCat.domains.push(domain);
    await storage.saveSettings(settings);
    showToast(`Added ${domain}`);
  }
  input.value = '';
  await renderCategories();
}
```

- [ ] **Step 3: Wire up the Add Category button**

Add this event listener near the other button listeners in `options.js`:

```js
document.getElementById('add-cat-btn').addEventListener('click', async () => {
  const nameInput = document.getElementById('add-cat-name');
  const budgetInput = document.getElementById('add-cat-budget');
  const name = nameInput.value.trim();
  const budget = parseInt(budgetInput.value, 10);
  if (!name) return;
  if (!budget || budget < 1) return;

  // Generate stable slug id
  const id = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  if (!id) return;

  // Avoid duplicate IDs
  if (settings.categories.find((c) => c.id === id)) {
    showToast(`Category "${name}" already exists`);
    return;
  }

  settings.categories.push({ id, name, budgetMinutes: budget, domains: [] });
  await storage.saveSettings(settings);
  nameInput.value = '';
  budgetInput.value = '';
  showToast(`Added category ${name}`);
  await renderCategories();
});
```

- [ ] **Step 4: Update `init()` in `options.js` to render Categories**

Change:
```js
  await Promise.all([
    renderOverview(),
    renderHistory(),
    renderSites(),
    renderSettings(),
  ]);
```
To:
```js
  await Promise.all([
    renderOverview(),
    renderHistory(),
    renderSites(),
    renderSettings(),
    renderCategories(),
  ]);
```

- [ ] **Step 5: Add Categories CSS to `dashboard/options.css`**

Append to the end of `dashboard/options.css`:

```css
/* Categories section */
.cat-row {
  border: 1px solid #1e293b;
  border-radius: 8px;
  margin-bottom: 8px;
  overflow: hidden;
}

.cat-row-header {
  display: flex;
  align-items: center;
  padding: 10px 14px;
  background: #0f172a;
  gap: 10px;
}

.cat-row-name {
  font-weight: 600;
  font-size: 14px;
  flex: 1;
}

.cat-row-meta {
  font-size: 12px;
  color: #64748b;
}

.cat-row-actions {
  display: flex;
  gap: 6px;
}

.btn-sm {
  padding: 3px 8px;
  font-size: 11px;
}

.cat-domains {
  padding: 10px 14px;
  background: #1e293b;
}

.cat-domain-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 3px 0;
  font-size: 13px;
}

.cat-add-domain-row {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}

.cat-add-domain-row input {
  flex: 1;
}

.cat-conflict-msg {
  margin-top: 6px;
  font-size: 12px;
  color: #fbbf24;
  display: flex;
  align-items: center;
  gap: 8px;
}
```

- [ ] **Step 6: Verify in browser**

1. Reload extension, open Options page
2. Click "Categories" in sidebar
3. Add a category "Social" with budget 60
4. Confirm it appears in the table
5. Click "▼ Domains", add "twitter.com" — confirm it appears
6. Add "twitter.com" to a second category — confirm conflict warning + Confirm button appears
7. Click Confirm — confirm domain moved
8. Delete a category — confirm deletion warning appears

- [ ] **Step 7: Commit**

```bash
git add dashboard/options.html dashboard/options.js dashboard/options.css
git commit -m "feat(v2): add Categories section to dashboard"
```

---

## Task 9: Dashboard — Update Overview to Stacked Bar Chart

Replace the single-dataset bar chart with a stacked chart (one dataset per category). Update stat cards to show per-category totals. Add "Category" column to today's site table.

**Files:**
- Modify: `dashboard/options.js`
- Modify: `dashboard/options.css`

- [ ] **Step 1: Replace `renderOverview()` in `dashboard/options.js`**

Update the imports at the top to ensure `computeCategorySeconds` is imported (already added in Task 8).

Replace the entire `renderOverview()` function:

```js
const CATEGORY_COLORS = [
  '#818cf8', '#34d399', '#fb923c', '#f472b6', '#60a5fa', '#a78bfa', '#facc15',
];

async function renderOverview() {
  const today = localDateStr();
  const todayUsage = weeklyUsage[today] ?? {};
  const categories = settings.categories ?? [];

  // Per-category seconds today
  const catSecondsToday = categories.map((cat) => computeCategorySeconds(todayUsage, cat));
  const totalLeisureSecToday = catSecondsToday.reduce((a, b) => a + b, 0);

  // Per-category seconds this week
  const catSecondsWeek = categories.map((cat) =>
    Object.values(weeklyUsage).reduce((sum, u) => sum + computeCategorySeconds(u, cat), 0)
  );

  // Stat cards — replace static leisure labels with per-category scrollable row
  const statsRow = document.getElementById('stat-today').closest('.stats-row');
  if (categories.length === 0) {
    document.getElementById('stat-today').textContent = formatDuration(0);
    document.getElementById('stat-week').textContent = formatDuration(0);
    document.getElementById('stat-remaining').textContent = '—';
  } else {
    // Show first category in the fixed stat cards, rest in a scrollable row
    document.getElementById('stat-today').textContent = formatDuration(catSecondsToday[0] ?? 0);
    document.getElementById('stat-week').textContent = formatDuration(catSecondsWeek[0] ?? 0);
    const remainSec0 = Math.max(0, (categories[0].budgetMinutes * 60) - (catSecondsToday[0] ?? 0));
    document.getElementById('stat-remaining').textContent = formatDuration(remainSec0);
    document.querySelector('#stat-today').closest('.stat-card').querySelector('.label').textContent =
      `${categories[0].name} today`;
    document.querySelector('#stat-week').closest('.stat-card').querySelector('.label').textContent =
      `${categories[0].name} this week`;
    document.querySelector('#stat-remaining').closest('.stat-card').querySelector('.label').textContent =
      `${categories[0].name} budget left`;
  }

  // Stacked weekly bar chart — one dataset per category
  const labels = [];
  for (let i = 6; i >= 0; i--) {
    labels.push(daysAgo(i).slice(5)); // MM-DD
  }

  const datasets = categories.map((cat, idx) => ({
    label: cat.name,
    data: Array.from({ length: 7 }, (_, i) => {
      const d = daysAgo(6 - i);
      const dayUsage = weeklyUsage[d] ?? {};
      return Math.round(computeCategorySeconds(dayUsage, cat) / 60);
    }),
    backgroundColor: CATEGORY_COLORS[idx % CATEGORY_COLORS.length],
    borderRadius: idx === categories.length - 1 ? 4 : 0,
    stack: 'stack',
  }));

  const ctx = document.getElementById('weekly-chart').getContext('2d');
  if (window._weeklyChart) window._weeklyChart.destroy();
  window._weeklyChart = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      plugins: { legend: { display: categories.length > 1 } },
      scales: {
        x: { stacked: true },
        y: {
          stacked: true,
          beginAtZero: true,
          title: { display: true, text: 'minutes' },
        },
      },
    },
  });

  // Today's site table — add Category column
  const sorted = Object.entries(todayUsage).sort(([, a], [, b]) => b - a);
  const tbody = document.getElementById('overview-site-tbody');

  // Update thead to have 3 columns
  const thead = tbody.closest('table').querySelector('thead tr');
  if (thead.children.length < 3) {
    thead.innerHTML = '<th>Site</th><th>Category</th><th>Today</th>';
  }

  tbody.innerHTML = sorted.map(([domain, sec]) => {
    const cat = getCategoryForDomain(domain, categories);
    const catLabel = cat
      ? `<span class="leisure-badge" style="background:${CATEGORY_COLORS[(categories.indexOf(cat)) % CATEGORY_COLORS.length]}22;color:${CATEGORY_COLORS[(categories.indexOf(cat)) % CATEGORY_COLORS.length]}">${cat.name}</span>`
      : '<span style="color:#475569;font-size:11px">—</span>';
    return `<tr><td>${domain}</td><td>${catLabel}</td><td>${formatDuration(sec)}</td></tr>`;
  }).join('') || '<tr><td colspan="3" style="color:#9ca3af;text-align:center;padding:16px">No data today</td></tr>';
}
```

- [ ] **Step 2: Verify stacked chart in browser**

1. Add at least 2 categories with some domains
2. Browse several of those domains for a few seconds each
3. Open dashboard → Overview
4. Confirm the bar chart shows stacked segments (one per category)
5. Confirm the site table has a Category column

- [ ] **Step 3: Commit**

```bash
git add dashboard/options.js
git commit -m "feat(v2): stacked category bar chart and category column in Overview"
```

---

## Task 10: Dashboard — Update History Section

Group sites under their category heading in the per-day breakdown.

**Files:**
- Modify: `dashboard/options.js`

- [ ] **Step 1: Replace `renderHistory()` in `dashboard/options.js`**

```js
async function renderHistory() {
  const container = document.getElementById('history-list');
  const categories = settings.categories ?? [];

  const days = Object.keys(weeklyUsage).sort().reverse();
  if (days.length === 0) {
    container.innerHTML = '<p style="color:#9ca3af">No history yet.</p>';
    return;
  }

  container.innerHTML = days.map((dateStr) => {
    const usage = weeklyUsage[dateStr];

    // Group domains by category
    const grouped = {}; // catId|'_uncategorized' -> { label, domains: [domain, sec][] }
    for (const [domain, sec] of Object.entries(usage)) {
      const cat = getCategoryForDomain(domain, categories);
      const key = cat ? cat.id : '_uncategorized';
      if (!grouped[key]) {
        grouped[key] = {
          label: cat ? cat.name : 'Uncategorized',
          entries: [],
        };
      }
      grouped[key].entries.push([domain, sec]);
    }

    const totalSec = Object.values(usage).reduce((a, b) => a + b, 0);

    // Build rows grouped by category
    const groupHtml = Object.values(grouped).map(({ label, entries }) => {
      const sortedEntries = entries.sort(([, a], [, b]) => b - a);
      const groupSec = entries.reduce((s, [, v]) => s + v, 0);
      return `
        <tr class="history-cat-header">
          <td style="padding:4px 16px;font-size:11px;color:#94a3b8;font-weight:600">${label}</td>
          <td style="padding:4px 16px;font-size:11px;color:#94a3b8">${formatDuration(groupSec)}</td>
        </tr>
        ${sortedEntries.map(([d, s]) => `
          <tr>
            <td style="padding:3px 24px;color:#6b7280;font-size:12px">${d}</td>
            <td style="padding:3px 16px;font-size:12px">${formatDuration(s)}</td>
          </tr>
        `).join('')}
      `;
    }).join('');

    return `
      <div class="site-table" style="margin-bottom:12px">
        <table>
          <thead><tr>
            <th>${dateStr}</th>
            <th style="color:#64748b">${formatDuration(totalSec)} total</th>
          </tr></thead>
          <tbody>${groupHtml || '<tr><td colspan="2" style="color:#9ca3af;padding:10px 16px;font-size:12px">No data</td></tr>'}</tbody>
        </table>
      </div>
    `;
  }).join('');
}
```

- [ ] **Step 2: Verify in browser**

1. Open dashboard → History
2. Confirm each day shows category group headings (e.g. "Social", "Video", "Uncategorized")
3. Sites appear under their respective category

- [ ] **Step 3: Commit**

```bash
git add dashboard/options.js
git commit -m "feat(v2): group sites by category in History section"
```

---

## Task 11: Update Dashboard — Remove / Update the Old Sites Section

The v1 Sites section managed the flat `leisureDomains` list. In v2, domains are managed per-category. The Sites section should be removed from the nav or repurposed to show all tracked domains with their category.

**Files:**
- Modify: `dashboard/options.html`
- Modify: `dashboard/options.js`

- [ ] **Step 1: Replace the Sites section in `options.html`**

Replace the entire `<!-- Sites -->` section:
```html
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
```
With:
```html
    <!-- Sites -->
    <section id="section-sites" class="section">
      <h2>All Sites</h2>
      <p style="color:#94a3b8;font-size:13px;margin-bottom:16px">
        All domains tracked this week. Assign them to categories in the Categories section.
      </p>
      <div class="site-table">
        <table>
          <thead><tr><th>Domain</th><th>Category</th><th>This week</th></tr></thead>
          <tbody id="sites-tbody"></tbody>
        </table>
      </div>
    </section>
```

- [ ] **Step 2: Replace `renderSites()` in `options.js`**

Remove the old `add-domain-btn` and `add-domain-input` event listeners (lines 193–209 in the original). Replace `renderSites()` with:

```js
async function renderSites() {
  const today = localDateStr();
  const sevenDaysAgo = daysAgo(6);
  const range = await storage.getUsageRange(sevenDaysAgo, today);
  const categories = settings.categories ?? [];

  const weekTotals = {};
  for (const usage of Object.values(range)) {
    for (const [domain, sec] of Object.entries(usage)) {
      weekTotals[domain] = (weekTotals[domain] ?? 0) + sec;
    }
  }

  const sorted = Object.entries(weekTotals).sort(([, a], [, b]) => b - a);
  const tbody = document.getElementById('sites-tbody');
  tbody.innerHTML = sorted.map(([domain, sec]) => {
    const cat = getCategoryForDomain(domain, categories);
    const catLabel = cat
      ? `<span class="leisure-badge">${cat.name}</span>`
      : '<span style="color:#475569;font-size:11px">—</span>';
    return `<tr><td>${domain}</td><td>${catLabel}</td><td>${formatDuration(sec)}</td></tr>`;
  }).join('') || '<tr><td colspan="3" style="color:#9ca3af;text-align:center;padding:16px;font-size:12px">No sites tracked this week.</td></tr>';
}
```

- [ ] **Step 3: Remove the old add-domain event listeners**

Delete these lines from `options.js` (they were for the v1 Sites form that no longer exists):

```js
document.getElementById('add-domain-btn').addEventListener('click', async () => {
  // ... entire block
});

document.getElementById('add-domain-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('add-domain-btn').click();
});
```

- [ ] **Step 4: Update the Settings section in `options.html` and `options.js`**

The v1 Settings section has a "Daily Leisure Budget" input (`budget-input`) — this is now per-category, so remove it. Settings section should only show "Danger Zone" (reset today) and the `notifyAt` thresholds.

Replace the Settings section in `options.html`:
```html
    <!-- Settings -->
    <section id="section-settings" class="section">
      <h2>Settings</h2>
      <div class="settings-form">
        <h3>Notification Thresholds</h3>
        <p style="color:#94a3b8;font-size:13px">Notify when category budget reaches these percentages (comma-separated).</p>
        <div class="form-row">
          <label>Thresholds (%)</label>
          <input type="text" id="notify-at-input" placeholder="80, 100">
        </div>
        <button class="btn btn-primary" id="save-settings-btn">Save</button>
      </div>
      <div class="settings-form">
        <h3>Danger Zone</h3>
        <button class="btn btn-danger" id="reset-today-btn">Reset today's data</button>
      </div>
    </section>
```

Replace `renderSettings()` in `options.js`:
```js
async function renderSettings() {
  document.getElementById('notify-at-input').value = (settings.notifyAt ?? [80, 100]).join(', ');
}
```

Replace the save settings listener:
```js
document.getElementById('save-settings-btn').addEventListener('click', async () => {
  const raw = document.getElementById('notify-at-input').value;
  const notifyAt = raw
    .split(',')
    .map((v) => parseInt(v.trim(), 10))
    .filter((v) => !isNaN(v) && v > 0 && v <= 100);
  if (notifyAt.length === 0) return;
  settings.notifyAt = notifyAt;
  await storage.saveSettings(settings);
  showToast('Settings saved.');
});
```

- [ ] **Step 5: Verify in browser**

1. Reload extension, open Options page
2. Sites section shows all tracked domains with category column
3. Settings section shows Notification Thresholds input (pre-filled with `80, 100`)
4. Save settings → toast appears

- [ ] **Step 6: Commit**

```bash
git add dashboard/options.html dashboard/options.js
git commit -m "feat(v2): update Sites section to all-domains view, update Settings for v2"
```

---

## Self-Review Checklist

After all tasks complete, verify against the spec:

- [ ] `indexed-db-adapter.js` — full implementation with `date` index, all 8 methods ✓
- [ ] `shared/storage/index.js` — active adapter is `IndexedDbAdapter` ✓
- [ ] `shared/tracker.js` — `getCategoryForDomain`, `computeCategorySeconds`, `computeAllCategoryUsage` added ✓
- [ ] `shared/constants.js` — `DEFAULT_LEISURE_DOMAINS` and `DEFAULT_BUDGET_MINUTES` removed, `DEFAULT_CATEGORIES = []` added ✓
- [ ] `background.js` — per-category `checkBudget`, `fireNotification`, snooze/dismiss, migration ✓
- [ ] Popup — stacked category cards sorted by % used descending; uncategorized below ✓
- [ ] Dashboard Categories — add/delete category, add/remove domain, conflict warning ✓
- [ ] Dashboard Overview — stacked bar chart, Category column in site table ✓
- [ ] Dashboard History — sites grouped under category headings ✓
- [ ] Dashboard Sites — shows all tracked domains with category column ✓
- [ ] Dashboard Settings — `notifyAt` thresholds (no per-category budget here — that's in Categories) ✓
- [ ] Migration — detects v1 `leisureDomains`, creates "Leisure" category, copies usage, marks `migrated: true` ✓
- [ ] Fresh install — no default categories, empty `categories: []` ✓
