// shared/storage/index.js
// To switch to IndexedDB in future: swap ChromeStorageAdapter for IndexedDbAdapter here.
import { ChromeStorageAdapter } from './chrome-storage-adapter.js';

export const storage = new ChromeStorageAdapter();
