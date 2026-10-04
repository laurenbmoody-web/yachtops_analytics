// IndexedDB backing for the offline read cache (readCache.js). Works the same in
// the browser and in the iOS / Android app's web view, where it persists with
// the app's data. Every call fails soft: no IndexedDB (private mode, quota)
// just means nothing is cached.

const DB_NAME = 'cargo-offline';
const STORE = 'reads';
const MAX_ENTRIES = 4000;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('no indexedDB')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE, { keyPath: 'k' });
      store.createIndex('at', 'at');
      store.createIndex('t', 't');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

function run(mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const result = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(result?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

let writesSincePrune = 0;

async function prune() {
  await run('readwrite', (store) => {
    const countReq = store.count();
    countReq.onsuccess = () => {
      let excess = countReq.result - MAX_ENTRIES;
      if (excess <= 0) return;
      // Oldest first.
      store.index('at').openCursor().onsuccess = (e) => {
        const cursor = e.target.result;
        if (!cursor || excess <= 0) return;
        cursor.delete();
        excess -= 1;
        cursor.continue();
      };
    };
  });
}

export const idbStore = {
  get: (k) => run('readonly', (store) => store.get(k)).catch(() => undefined),

  put: async (entry) => {
    await run('readwrite', (store) => store.put(entry)).catch(() => {});
    writesSincePrune += 1;
    if (writesSincePrune >= 200) { writesSincePrune = 0; prune().catch(() => {}); }
  },

  // A write to a table succeeded: flag its saved reads as pre-edit. They are
  // still served when offline (old beats blank), never for a merely slow link.
  markTableStale: (t) => run('readwrite', (store) => {
    store.index('t').openCursor(IDBKeyRange.only(t)).onsuccess = (e) => {
      const cursor = e.target.result;
      if (!cursor) return;
      if (!cursor.value.stale) cursor.update({ ...cursor.value, stale: true });
      cursor.continue();
    };
  }).catch(() => {}),

  clear: () => run('readwrite', (store) => store.clear()).catch(() => {}),
};
