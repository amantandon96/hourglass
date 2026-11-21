// background.js
import { storage } from './shared/storage/index.js';
import { DEFAULT_SETTINGS, FLUSH_ALARM_NAME, MIDNIGHT_ALARM_NAME, SNOOZE_MINUTES, PRUNE_DAYS } from './shared/constants.js';
import { extractDomain, budgetPercent, formatDuration, localDateStr, daysAgo, nextMidnight, computeAllCategoryUsage, splitElapsedByLocalDate } from './shared/tracker.js';

// ---------------------------------------------------------------------------
// In-memory session state
// ---------------------------------------------------------------------------
let activeDomain = null;       // currently tracked domain (string | null)
let activeStart = null;        // epoch ms when tracking started (number | null)
let activeDate = null;         // local date when the current interval started
let settings = null;           // loaded settings object
let snoozedUntil = {};         // { [categoryId]: epoch ms | null }
let dismissedToday = [];       // array of categoryIds dismissed today
let notifiedThresholds = {};   // { [categoryId]: number[] } thresholds already fired

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

// ---------------------------------------------------------------------------
// Initialise on service worker startup
// ---------------------------------------------------------------------------
async function init() {
  await runMigrationIfNeeded();
  settings = await storage.getSettings();
  if (!settings) {
    settings = { ...DEFAULT_SETTINGS };
    await storage.saveSettings(settings);
  }

  // Restore session if present
  const session = await storage.getSession();
  if (session) {
    activeDomain = typeof session.activeDomain === 'string' ? session.activeDomain : null;
    activeStart = Number.isFinite(session.activeStart) ? session.activeStart : null;
    activeDate = typeof session.activeDate === 'string' ? session.activeDate : null;
    snoozedUntil = session.snoozedUntil ?? {};
    dismissedToday = session.dismissedToday ?? [];
    notifiedThresholds = session.notifiedThresholds ?? {};
  }

  // Prune old data
  const pruneDate = daysAgo(PRUNE_DAYS);
  await storage.pruneOldData(pruneDate);

  // Set up alarms
  await setupAlarms();
  await reconcileActiveTab();
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
    activeDate = localDateStr();
  } else {
    activeDomain = null;
    activeStart = null;
    activeDate = null;
  }
  await persistSession();
}

async function stopTracking() {
  await flushCurrent();
  activeDomain = null;
  activeStart = null;
  activeDate = null;
  await persistSession();
}

async function flushCurrent() {
  if (!activeDomain || !Number.isFinite(activeStart)) return;

  const domain = activeDomain;
  const startMs = activeStart;
  const nowMs = Date.now();
  const elapsedByDate = splitElapsedByLocalDate(startMs, nowMs);
  if (Object.keys(elapsedByDate).length === 0) return;

  let latestUsage = null;
  for (const [dateStr, elapsed] of Object.entries(elapsedByDate)) {
    const usage = await storage.getUsageForDate(dateStr);
    usage[domain] = (usage[domain] ?? 0) + elapsed;
    await storage.saveUsageForDate(dateStr, usage);
    latestUsage = usage;
  }

  // Reset start time so next flush doesn't double-count
  activeStart = nowMs;
  activeDate = localDateStr(new Date(nowMs));
  await persistSession();

  await checkBudget(latestUsage);
}

async function reconcileActiveTab() {
  try {
    const focusedWindow = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    if (!focusedWindow?.focused || focusedWindow.state === 'minimized') {
      await stopTracking();
      return;
    }

    const [activeTab] = await chrome.tabs.query({ active: true, windowId: focusedWindow.id });
    if (activeTab?.url) await startTracking(activeTab.url);
    else await stopTracking();
  } catch {
    // Chrome may close the focused window during startup reconciliation.
  }
}

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
    ? `${cat.name} budget used up`
    : `${remainMin}m of ${cat.name} left today`;

  const message = is100
    ? topOffenders ? `Most time on ${topOffenders}.` : `You have reached today's ${cat.name} budget.`
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

// ---------------------------------------------------------------------------
// Notification button clicks
// ---------------------------------------------------------------------------
chrome.notifications.onButtonClicked.addListener(async (notifId, buttonIndex) => {
  // notifId format: threshold-{categoryId}-{threshold}
  if (!notifId.startsWith('threshold-')) return;

  // Parse categoryId — everything between first and last dash-number segment
  const withoutPrefix = notifId.replace(/^threshold-/, '');
  const lastDashIdx = withoutPrefix.lastIndexOf('-');
  const catId = withoutPrefix.slice(0, lastDashIdx);

  if (buttonIndex === 0) {
    // Snooze this category
    const snoozeUntilMs = Date.now() + SNOOZE_MINUTES * 60 * 1000;
    snoozedUntil = { ...snoozedUntil, [catId]: snoozeUntilMs };
    // Remove threshold=100 from notifiedThresholds so it re-fires after snooze
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

// ---------------------------------------------------------------------------
// Alarms
// ---------------------------------------------------------------------------
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === FLUSH_ALARM_NAME) {
    await flushCurrent();
  } else if (alarm.name === MIDNIGHT_ALARM_NAME) {
    await midnightReset();
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
});

async function midnightReset() {
  await flushCurrent();
  activeDomain = null;
  activeStart = null;
  activeDate = null;
  snoozedUntil = {};
  dismissedToday = [];
  notifiedThresholds = {};
  await persistSession();
  // Reschedule for next midnight
  chrome.alarms.create(MIDNIGHT_ALARM_NAME, { when: nextMidnight().getTime() });
}

// ---------------------------------------------------------------------------
// Tab / window events
// ---------------------------------------------------------------------------
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    await startTracking(tab?.url);
  } catch {
    // Tab may have been closed already
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab?.id === tabId) await startTracking(activeTab.url);
  } catch {
    // Ignore
  }
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    await stopTracking();
  } else {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, windowId });
      await startTracking(activeTab?.url);
    } catch {
      // Ignore
    }
  }
});

// ---------------------------------------------------------------------------
// Session persistence helper
// ---------------------------------------------------------------------------
async function persistSession() {
  await storage.saveSession({
    activeDomain,
    activeStart,
    activeDate,
    snoozedUntil,
    dismissedToday,
    notifiedThresholds,
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
init();
