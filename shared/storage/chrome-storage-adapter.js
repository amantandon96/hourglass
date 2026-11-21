// shared/storage/chrome-storage-adapter.js

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
