// Offline capture — when the device has no connectivity, new laundry adds are
// stored in IndexedDB (with their photos as base64) and replayed via
// createLaundryItem once the connection returns. Nothing is written to the
// server until it can actually succeed, so a queued item is never lost and the
// crew can keep logging with no signal.
//
// Scope: NEW adds only. Edits/status changes need the row to already exist on
// the server, so they aren't queued.

import { createLaundryItem, LaundryStatus, LaundryPriority } from './laundryStorage';
import { showToast } from '../../../utils/toast';

const DB_NAME = 'cargo-laundry-offline';
const STORE = 'pending';
const listeners = new Set();
let draining = false;

const uuid = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `q-${Date.now()}-${Math.floor(Math.random() * 1e9)}`);

function openDb() {
  return new Promise((resolve, reject) => {
    let req;
    try { req = indexedDB.open(DB_NAME, 1); } catch (e) { reject(e); return; }
    req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readAll() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    req.onsuccess = () => resolve((req.result || []).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)));
    req.onerror = () => reject(req.error);
  });
}

async function write(rec) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, 'readwrite');
    t.objectStore(STORE).put(rec);
    t.oncomplete = resolve; t.onerror = () => reject(t.error);
  });
}

async function remove(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, 'readwrite');
    t.objectStore(STORE).delete(id);
    t.oncomplete = resolve; t.onerror = () => reject(t.error);
  });
}

// in-memory mirror so the UI can render pending rows synchronously
let cache = [];
const refresh = async () => { try { cache = await readAll(); } catch { cache = []; } notify(); };
function notify() { listeners.forEach((fn) => { try { fn(cache); } catch { /* noop */ } }); }

export const isLaundryOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;
export function subscribeOffline(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function pendingOfflineCount() { return cache.length; }

// A queued record → a display item shaped like a laundry row (base64 photos
// render directly), tagged _pending so the UI shows it read-only.
function toDisplay(rec) {
  const d = rec.itemData || {};
  const photos = Array.isArray(d.photos) ? d.photos : (d.photo ? [d.photo] : []);
  return {
    id: rec.id,
    _pending: true,
    createdAt: rec.createdAt,
    status: LaundryStatus.IN_PROGRESS,
    ownerType: d.ownerType || 'unknown',
    ownerName: d.ownerName || '',
    ownerDisplayName: d.ownerDisplayName || d.ownerName || '',
    ownerGuestId: d.ownerGuestId || null,
    ownerCrewUserId: d.ownerCrewUserId || null,
    area: d.area || '',
    colour: d.colour || '',
    laundryNumber: d.laundryNumber || '',
    description: d.description || '',
    priority: d.priority || LaundryPriority.NORMAL,
    tags: d.tags || [],
    notes: d.notes || '',
    neededBy: d.neededBy || null,
    photos,
    photo: photos[0] || '',
  };
}

export function pendingOfflineItems() { return cache.map(toDisplay); }

// Queue a new add. Returns a synthetic pending item for optimistic display.
export async function enqueueOfflineLaundry(itemData) {
  const rec = { id: uuid(), createdAt: new Date().toISOString(), itemData };
  await write(rec);
  await refresh();
  showToast('Saved offline — it’ll sync when you’re back online', 'info');
  return toDisplay(rec);
}

// Replay everything queued, oldest first. Stops on the first failure so items
// keep their order and nothing is dropped; each success is removed immediately.
export async function drainOfflineLaundry() {
  if (draining || isLaundryOffline()) return { synced: 0, remaining: cache.length };
  draining = true;
  let synced = 0;
  try {
    const items = await readAll();
    for (const rec of items) {
      try {
        await createLaundryItem(rec.itemData);
        await remove(rec.id);
        synced += 1;
      } catch (err) {
        // still offline / server unreachable — leave this and the rest for later
        if (err?.code === 'OFFLINE' || isLaundryOffline()) break;
        // a genuine (non-network) failure: drop it so it can't wedge the queue
        console.error('[laundry] offline item failed to sync, dropping', err);
        await remove(rec.id);
      }
    }
  } finally {
    draining = false;
    await refresh();
  }
  if (synced > 0) showToast(`Synced ${synced} offline item${synced === 1 ? '' : 's'}`, 'success');
  return { synced, remaining: cache.length };
}

// Prime the cache once on load.
refresh();
