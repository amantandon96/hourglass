# Hourglass v2 — Multi-Category Budgets & IndexedDB Design Spec

**Date:** 2026-05-02  
**Status:** Approved  
**Builds on:** `docs/superpowers/specs/2026-05-01-hourglass-design.md` (v1)

---

## Overview

V2 replaces the single "leisure" budget with user-defined categories (e.g. Social, Video, News), each with its own daily time budget and domain list. It also migrates the storage backend from `chrome.storage.local` to IndexedDB, removing the 5MB cap and enabling efficient date-range queries.

**Goals:**
1. Per-category independent budgets with per-category notifications
2. User can create, rename, and delete categories; add/remove domains per category
3. IndexedDB as the active storage backend
4. Auto-migrate v1 settings (flat `leisureDomains` + `dailyBudgetMinutes`) to v2 category format on first launch

---

## Data Model

### Settings (stored in IndexedDB `settings` store)

```json
{
  "notifyAt": [80, 100],
  "categories": [
    {
      "id": "social",
      "name": "Social",
      "budgetMinutes": 60,
      "domains": ["twitter.com", "x.com", "reddit.com", "instagram.com", "facebook.com", "discord.com"]
    },
    {
      "id": "video",
      "name": "Video",
      "budgetMinutes": 60,
      "domains": ["youtube.com", "twitch.tv", "netflix.com", "hulu.com", "tiktok.com"]
    }
  ]
}
```

**Rules:**
- Each domain belongs to at most one category (exclusive)
- `id` is a stable slug generated at category creation time (lowercased name, spaces → hyphens). Never changes even if the user renames the category.
- `notifyAt` is global — applies to all categories

### Usage (stored in IndexedDB `usage` store)

Shape is **unchanged** from v1 — still `{ domain: seconds }` per day. The `StorageAdapter` interface requires no changes.

Each record in the `usage` object store:
- **Key:** `"${dateStr}_${domain}"` (e.g. `"2026-05-01_youtube.com"`)
- **Value:** `{ date: "2026-05-01", domain: "youtube.com", seconds: 1920 }`
- **Index:** `date` — enables efficient `getUsageRange` via `IDBKeyRange`

### Session (stored in IndexedDB `session` store)

```json
{
  "snoozedUntil": { "social": 1746123456789, "video": null },
  "dismissedToday": ["social"],
  "notifiedThresholds": { "social": [80], "video": [] }
}
```

`dismissedToday` is now an array of category IDs. `notifiedThresholds` is a map from category ID to array of already-fired thresholds. `snoozedUntil` is a map from category ID to epoch ms (or null).

---

## IndexedDB Schema

**Database name:** `panopticon`  **Version:** `1`

| Object Store | Key type | Indexes |
|---|---|---|
| `settings` | Fixed key `"settings"` | — |
| `session` | Fixed key `"session"` | — |
| `usage` | `"${date}_${domain}"` | `date` (non-unique) |

The `date` index on `usage` makes `getUsageRange(start, end)` a single `IDBKeyRange.bound(start, end)` query on the index — no full-table scan.

---

## Migration: v1 → v2

Runs once on first background worker startup after upgrade. Detection: `chrome.storage.local` has `settings.leisureDomains` (v1 format).

**Steps:**
1. Read v1 settings from `chrome.storage.local`
2. Create a single category: `{ id: "leisure", name: "Leisure", budgetMinutes: <v1 dailyBudgetMinutes>, domains: <v1 leisureDomains> }`
3. Write new v2 settings to IndexedDB
4. Read all `usage_*` keys from `chrome.storage.local`, write each day's data to IndexedDB `usage` store
5. Read `session` from `chrome.storage.local`, adapt to v2 session format, write to IndexedDB
6. Write a `migrated: true` flag to `chrome.storage.local` to prevent re-running
7. Clear migrated data from `chrome.storage.local`

If `chrome.storage.local` has no v1 data (fresh install), skip migration and write default settings directly to IndexedDB with no pre-defined categories (user sets up their own).

---

## Storage Layer Changes

### `shared/storage/indexed-db-adapter.js` — full implementation

Implements the existing `StorageAdapter` interface exactly. Key implementation details:

- DB opened via `indexedDB.open('panopticon', 1)` with `onupgradeneeded` creating the three stores and the `date` index on `usage`
- A single `db` promise is created at construction time; all methods await it before transacting
- `getUsageForDate(dateStr)` uses the `date` index to fetch all records for that date, then reduces to `{ domain: seconds }`
- `getUsageRange(start, end)` uses `IDBKeyRange.bound(start, end)` on the `date` index
- `saveUsageForDate(dateStr, usage)` opens a `readwrite` transaction, puts each `{ date, domain, seconds }` record individually
- `pruneOldData(beforeDateStr)` uses `IDBKeyRange.upperBound(beforeDateStr, true)` on the `date` index to delete old records

### `shared/storage/index.js`

Switches active adapter from `ChromeStorageAdapter` to `IndexedDbAdapter` — one import change.

---

## Tracker Logic Changes (`shared/tracker.js`)

Three new functions added. Existing functions retained for the migration path.

```js
// Returns the category object that owns this domain, or null
getCategoryForDomain(domain, categories)

// Returns seconds used today for a single category
computeCategorySeconds(usage, category)

// Returns { categoryId: seconds } for all categories
computeAllCategoryUsage(usage, categories)
```

---

## Background Worker Changes (`background.js`)

- On flush, calls `computeAllCategoryUsage` to get per-category seconds
- Iterates all categories; for each, checks `budgetPercent(seconds, category.budgetMinutes)` against `settings.notifyAt`
- Fires a notification per category when threshold crossed, keyed as `threshold-${categoryId}-${threshold}` (e.g. `threshold-social-100`)
- Notification message for 100%: `"Social budget exhausted — Twitter (22m), Reddit (18m). Snooze or stop?"`
- Notification message for 80%: `"Heads up — 17m of Social budget left today."`
- `notificationOnButtonClicked` parses `categoryId` from notification ID to snooze/dismiss the correct category
- `dismissedToday` check is per-category: only suppresses notifications for that category

---

## UI Changes

### Popup (`popup/popup.js`, `popup/popup.css`)

Replaces the single budget bar with **one stacked card per category**, sorted by % used descending (most urgent first):

```
┌─────────────────────────────────┐
│ HOURGLASS          Full report │
├─────────────────────────────────┤
│ SOCIAL                          │
│ [████████████░░░░░] 72%         │
│ 43m used of 60m · 17m left      │
├─────────────────────────────────┤
│ VIDEO                           │
│ [████░░░░░░░░░░░░░] 30%         │
│ 18m used of 60m · 42m left      │
├─────────────────────────────────┤
│ github.com              32m     │  ← uncategorized (no budget bar)
│ figma.com               14m     │
└─────────────────────────────────┘
```

Uncategorized domains still appear below the category cards as plain site cards (no progress bar, no tag).

### Dashboard — new "Categories" sidebar section

Inline table layout (Option A):

- **Add form at top:** name input + budget (minutes) input + Add button
- **Category rows:** name | budget | site count | delete (✕)
- **Expanded row** (click to toggle): shows domain list with remove (✕) per domain, plus an add-domain input. Adding a domain that already belongs to another category shows an inline warning: *"example.com is in Video — move it here?"* with a Confirm button.
- Deleting a category that has domains: shows a confirmation *"Delete Social? Its 5 domains will become uncategorized."*

### Dashboard — Overview section

- Weekly bar chart switches to **stacked bars** — each day's bar is divided by category, colour-coded
- Stat cards show per-category totals instead of a single leisure total (scrollable row if many categories)
- Today's site table gains a "Category" column

### Dashboard — History section

Per-day breakdowns now group sites under their category heading.

---

## Files Changed / Created

| File | Change |
|---|---|
| `shared/storage/indexed-db-adapter.js` | Full implementation (was stub) |
| `shared/storage/index.js` | Switch active adapter to IndexedDB |
| `shared/tracker.js` | Add 3 new category functions |
| `shared/constants.js` | Remove `DEFAULT_LEISURE_DOMAINS`, `DEFAULT_BUDGET_MINUTES`; add `DEFAULT_CATEGORIES = []` |
| `background.js` | Per-category budget check, notifications, snooze/dismiss |
| `popup/popup.js` | Stacked category cards |
| `popup/popup.css` | Category card styles |
| `dashboard/options.html` | Add Categories nav item |
| `dashboard/options.js` | Categories section, updated Overview/History |
| `dashboard/options.css` | Stacked bar chart styles, category expand/collapse |

---

## Out of Scope (v2)

- Global budget cap across all categories
- Multi-category domain membership
- Per-category notification thresholds (same `notifyAt` applies to all)
- Category colour customisation (colours auto-assigned from a fixed palette)
- Export / CSV
