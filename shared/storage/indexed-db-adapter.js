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
