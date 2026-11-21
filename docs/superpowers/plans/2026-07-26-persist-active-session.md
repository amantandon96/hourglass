# Persist Active Tracking Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve active website timing across Manifest V3 service-worker restarts and resume tracking against the currently focused tab.

**Architecture:** Persist `activeDomain`, `activeStart`, and `activeDate` in the existing IndexedDB session record. On startup, restore and flush the durable interval, then reconcile with Chrome's focused window and active tab. Keep interval ownership in `background.js`; the storage adapter remains a generic record store.

**Tech Stack:** Chrome Manifest V3 service worker, JavaScript ES modules, IndexedDB adapter, Node.js syntax checks.

---

### Task 1: Add pure session interval helpers and tests

**Files:**
- Modify: `shared/tracker.js`
- Create: `test/tracker.test.js`
- Create: `package.json`

- [ ] **Step 1: Add a minimal Node test command and test module configuration**

Create `package.json` with ESM support and a test script:

```json
{
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test"
  }
}
```

- [ ] **Step 2: Write failing tests for interval date attribution**

Create `test/tracker.test.js` covering a session beginning before midnight and a
session beginning today. The helper should split elapsed seconds at the local
midnight boundary and return `{ dateStr: seconds }` entries without relying on
the current wall clock:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { splitElapsedByLocalDate } from '../shared/tracker.js';

test('splits an interval that crosses local midnight', () => {
  const start = new Date(2026, 6, 26, 23, 59, 30).getTime();
  const end = new Date(2026, 6, 27, 0, 0, 30).getTime();

  assert.deepEqual(splitElapsedByLocalDate(start, end), {
    '2026-07-26': 30,
    '2026-07-27': 30,
  });
});

test('keeps an interval on one date when it does not cross midnight', () => {
  const start = new Date(2026, 6, 26, 12, 0, 0).getTime();
  const end = new Date(2026, 6, 26, 12, 2, 15).getTime();

  assert.deepEqual(splitElapsedByLocalDate(start, end), {
    '2026-07-26': 135,
  });
});
```

- [ ] **Step 3: Run the focused tests and verify they fail**

Run: `npm test -- --test-name-pattern='interval'`

Expected: FAIL because `splitElapsedByLocalDate` is not exported yet.

- [ ] **Step 4: Implement the smallest pure helper**

Add `splitElapsedByLocalDate(startMs, endMs)` to `shared/tracker.js`. It should
return an empty object for `endMs <= startMs`, repeatedly use `localDateStr`
for the current segment, and cap each segment at the next local midnight:

```js
export function splitElapsedByLocalDate(startMs, endMs) {
  if (endMs <= startMs) return {};

  const result = {};
  let cursor = startMs;
  while (cursor < endMs) {
    const current = new Date(cursor);
    const midnight = new Date(current);
    midnight.setHours(24, 0, 0, 0);
    const segmentEnd = Math.min(endMs, midnight.getTime());
    const seconds = Math.floor((segmentEnd - cursor) / 1000);
    if (seconds > 0) {
      const dateStr = localDateStr(current);
      result[dateStr] = (result[dateStr] ?? 0) + seconds;
    }
    cursor = segmentEnd;
  }
  return result;
}
```

- [ ] **Step 5: Run the focused tests and verify they pass**

Run: `npm test -- --test-name-pattern='interval'`

Expected: PASS with 2 tests passing.

### Task 2: Persist and restore the active session in the background worker

**Files:**
- Modify: `background.js:9-16,80-102,121-153,273-283,323-329`
- Modify: `shared/tracker.js:1-120`

- [ ] **Step 1: Extend background state and imports**

Import `splitElapsedByLocalDate` and add `activeDate` beside the existing
in-memory active state:

```js
let activeDomain = null;
let activeStart = null;
let activeDate = null;
```

- [ ] **Step 2: Make session persistence include active tracking state**

Change `persistSession()` to save:

```js
await storage.saveSession({
  activeDomain,
  activeStart,
  activeDate,
  snoozedUntil,
  dismissedToday,
  notifiedThresholds,
});
```

- [ ] **Step 3: Restore active state during initialization**

In `init()`, restore `activeDomain`, `activeStart`, and `activeDate` from the
session, accepting only a string domain and finite numeric timestamps. Keep the
existing notification-state defaults for missing fields.

- [ ] **Step 4: Replace single-date flushing with durable interval flushing**

Update `flushCurrent()` to:

1. Return when no valid active session exists.
2. Capture `activeDomain`, `activeStart`, and `Date.now()` in locals before any
   awaits.
3. Call `splitElapsedByLocalDate(startMs, nowMs)`.
4. For each returned date, read its usage, add the seconds for the active
   domain, and save it.
5. Set `activeStart = nowMs` and `activeDate = localDateStr(new Date(nowMs))`.
6. Persist the advanced active session before checking budgets.

When the interval is restored after a worker restart, this flush must attribute
the elapsed time to the original domain. The date splitter also handles a
midnight crossing correctly; the existing midnight alarm will then clear the
active state after flushing.

- [ ] **Step 5: Persist state whenever tracking starts or stops**

In `startTracking(url)`, flush the previous interval, then set the new domain,
`activeStart = Date.now()`, and `activeDate = localDateStr()`, followed by
`persistSession()`. For non-trackable URLs, clear all three fields and persist.

In `stopTracking()`, flush first, clear all three fields, and persist.

- [ ] **Step 6: Restore and reconcile the current focused tab on startup**

After settings/session restoration and alarm setup, call a new
`reconcileActiveTab()` function:

```js
async function reconcileActiveTab() {
  const [window] = await chrome.windows.getAll({ windowTypes: ['normal'] });
  const focusedWindow = window?.focused
    ? window
    : (await chrome.windows.getLastFocused({ windowTypes: ['normal'] }));
  if (!focusedWindow?.focused || focusedWindow.state === 'minimized') {
    await stopTracking();
    return;
  }

  const [activeTab] = await chrome.tabs.query({
    active: true,
    windowId: focusedWindow.id,
  });
  if (activeTab?.url) await startTracking(activeTab.url);
  else await stopTracking();
}
```

Use the focused-window query result, not an arbitrary normal window. If Chrome
has no focused window or the active tab has no URL, flush the restored interval
and leave tracking stopped. Catch unavailable-tab/window errors so startup does
not prevent the rest of the extension from initializing.

- [ ] **Step 7: Clear and persist active state during midnight reset**

After `flushCurrent()` in `midnightReset()`, set `activeDomain`, `activeStart`,
and `activeDate` to `null` before persisting the session. This preserves the
existing behavior of stopping the pre-midnight interval.

### Task 3: Verify lifecycle behavior and update documentation

**Files:**
- Modify: `docs/superpowers/specs/2026-05-01-panopticon-design.md:88-103,136-145`
- Modify: `docs/superpowers/specs/2026-07-26-persist-active-session-design.md`

- [ ] **Step 1: Run all automated tests**

Run: `npm test`

Expected: PASS, including the interval date-attribution tests.

- [ ] **Step 2: Run JavaScript syntax checks**

Run: `node --check background.js && node --check shared/tracker.js && node --check shared/storage/indexed-db-adapter.js`

Expected: no output and exit code 0.

- [ ] **Step 3: Inspect the final diff for lifecycle regressions**

Run: `git diff --check && git diff -- background.js shared/tracker.js test/tracker.test.js package.json`

Confirm the diff shows no duplicate flush, no clearing of restored state before
startup reconciliation, and no usage writes using only the current date.

- [ ] **Step 4: Update the original design documentation**

Change the original session notes to document that active tracking state is
durable and restored/reconciled on worker restart, replacing the old statement
that active state is reset. Keep the new focused design spec as the detailed
implementation record.

- [ ] **Step 5: Run the final verification suite**

Run: `npm test && node --check background.js && node --check shared/tracker.js && git diff --check`

Expected: all commands pass.
