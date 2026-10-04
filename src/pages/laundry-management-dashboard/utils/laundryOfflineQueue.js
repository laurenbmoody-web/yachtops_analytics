// Legacy laundry offline queue → app-wide outbox.
//
// Laundry used to keep its own IndexedDB queue ('cargo-laundry-offline') for
// new adds and status changes, used only when the device reported no network.
// All laundry writes now go through the app-wide outbox (lib/offline/outbox.js)
// — adds, edits, status, notes, bulk actions, wardrobes, cases and photos —
// whenever the network fails, including a satellite link that is "up" but
// dead. This module only moves anything still waiting in the old queue into
// the new path once, then empties it.

import { createLaundryItem, updateLaundryStatus } from './laundryStorage';

const DB_NAME = 'cargo-laundry-offline';
const STORE = 'pending';

function openDb() {
  return new Promise((resolve, reject) => {
    let req;
    try { req = indexedDB.open(DB_NAME, 1); } catch (e) { reject(e); return; }
    req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const tx = (db, mode, fn) => new Promise((resolve, reject) => {
  const t = db.transaction(STORE, mode);
  const req = fn(t.objectStore(STORE));
  t.oncomplete = () => resolve(req?.result);
  t.onerror = () => reject(t.error);
});

// → how many old records were handed over (each is then queued or written).
export async function migrateLegacyOfflineLaundry() {
  if (typeof indexedDB === 'undefined') return 0;
  const db = await openDb();
  const records = ((await tx(db, 'readonly', (s) => s.getAll())) || [])
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  let moved = 0;
  for (const rec of records) {
    try {
      if (rec.kind === 'status') await updateLaundryStatus(rec.itemId, rec.status);
      else await createLaundryItem(rec.itemData);
      moved += 1;
    } catch (err) {
      // A genuine rejection — same as the old queue: drop it so it can't wedge.
      console.error('[laundry] legacy offline item could not be saved, dropping', err);
    }
    await tx(db, 'readwrite', (s) => s.delete(rec.id));
  }
  return moved;
}
