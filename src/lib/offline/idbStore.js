// IndexedDB backing for the offline read cache (readCache.js). Works the same in
// the browser and in the iOS / Android app's web view, where it persists with
// the app's data. Every call fails soft: no IndexedDB (private mode, quota)
// just means nothing is cached.

const DB_NAME = 'cargo-offline';
const STORE = 'reads';
const OUTBOX = 'outbox'; // offline writes waiting to sync (outbox.js)
const MAX_ENTRIES = 4000;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('no indexedDB')); return; }
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'k' });
        store.createIndex('at', 'at');
        store.createIndex('t', 't');
      }
      // Records are keyed by their `id`… but version-2 stores were created
      // keyed on `key`, so put() always writes `key` = the op id there (see
      // outboxStore) and `rowKey` carries the row identity.
      if (!db.objectStoreNames.contains(OUTBOX)) db.createObjectStore(OUTBOX, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

function run(mode, fn, storeName = STORE) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const result = fn(tx.objectStore(storeName));
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

// Offline writes waiting to sync. Unlike saved reads these are user data that
// exists nowhere else yet — never pruned, and not cleared on sign-out (they
// sync when that person signs in again).
export const outboxStore = {
  // In IndexedDB the record's primary key field is `key`; ops use `key` for the
  // row identity, so store them as { ...op, key: op.id, rowKey: op.key }.
  all: () => run('readonly', (store) => store.getAll(), OUTBOX)
    .then((r) => (r || []).map((rec) => (rec.rowKey ? { ...rec, id: rec.key, key: rec.rowKey } : rec)))
    .catch(() => []),
  put: (op) => run('readwrite', (store) => store.put({ ...op, key: op.id, rowKey: op.key }), OUTBOX).catch(() => {}),
  delete: (id) => run('readwrite', (store) => store.delete(id), OUTBOX).catch(() => {}),
};
