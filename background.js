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

  // Re-read settings in case user changed them
  settings = await storage.getSettings();
  const leisureSec = computeLeisureSeconds(usage, settings.leisureDomains);
  const pct = budgetPercent(leisureSec, settings.dailyBudgetMinutes);

  for (const threshold of settings.notifyAt) {
    if (pct >= threshold && !notifiedThresholds.includes(threshold)) {
      await fireNotification(threshold, usage, pct);
      notifiedThresholds.push(threshold);
      await persistSession();
    }
  }
}

async function fireNotification(threshold, usage, pct) {
  const topOffenders = Object.entries(usage)
    .filter(([d]) => settings.leisureDomains.includes(d))
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([d, s]) => `${d} (${Math.floor(s / 60)}m)`)
    .join(', ');

  const budgetSec = settings.dailyBudgetMinutes * 60;
  const leisureSec = computeLeisureSeconds(usage, settings.leisureDomains);
  const remainSec = Math.max(0, budgetSec - leisureSec);
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
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.url) await startTracking(tab.url);
  } catch {
    // Tab may have been closed already
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab?.id === tabId) await startTracking(tab.url);
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
      if (activeTab?.url) await startTracking(activeTab.url);
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
    snoozedUntil,
    dismissedToday,
    notifiedThresholds,
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
init();
