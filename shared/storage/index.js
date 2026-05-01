// shared/storage/index.js
import { IndexedDbAdapter } from './indexed-db-adapter.js';
export const storage = new IndexedDbAdapter();
