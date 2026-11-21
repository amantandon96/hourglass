// shared/storage/indexed-db-adapter.js

export class IndexedDbAdapter {
  constructor() {
    this._db = this._openDb();
  }

  _openDb() {
    return new Promise((resolve, reject) => {
      // DB name kept from the project's former name so existing installs keep their data.
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
