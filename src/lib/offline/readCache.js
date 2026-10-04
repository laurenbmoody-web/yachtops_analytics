// Offline reads — layer 1 of offline Cargo. Wraps the Supabase client's fetch:
//
//   • Online, nothing changes: every read goes to the network, and each
//     successful answer is saved on the device.
//   • When the network fails (offline, gateway 5xx) — or stalls past STALL_MS
//     on a slow satellite link — the last saved answer for that exact query is
//     served instead, so every screen a crew member has opened before still
//     works at sea. A stalled request keeps going and refreshes the copy.
//
// Only reads are cached: PostgREST GET/HEAD, read-only RPCs, and storage
// signed-URL / list calls. Auth, edge functions and every write pass straight
// through (offline writes are layer 2). A successful write to a table marks
// that table's saved reads stale: still shown when offline, but a merely slow
// link waits for the network rather than show pre-edit data.
//
// Pure module (no browser globals at import) so it is unit-tested in Node —
// see readCache.test.mjs. The IndexedDB store lives in idbStore.js.

import { applyOverlay } from './overlay.js';

export const STALL_MS = 6000;
const MAX_BODY_CHARS = 4_000_000;

// RPCs that only read. Name prefixes cover almost all; the exceptions list
// catches the "get_or_create" style that writes.
const READ_RPC = /^(get_|fetch_|list_|is_|my_|crew_emails$|supplier_vessel_logos$|management_(team|periods|month|fleet|company_profile)$)/;
const WRITE_RPC = new Set(['get_or_create_dm_thread']);

const KEY_HEADERS = ['accept', 'prefer', 'range', 'accept-profile', 'content-profile'];
const SAVED_HEADERS = ['content-type', 'content-range', 'preference-applied'];

function readHeaders(input, init) {
  const h = new Headers(init?.headers || (typeof input === 'object' && input?.headers) || undefined);
  return h;
}

// Which signed-in user a request belongs to (cached reads are per user).
function userOf(headers) {
  const auth = headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  const payload = token.split('.')[1];
  if (!payload) return 'anon';
  try {
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return json.sub || 'anon';
  } catch { return 'anon'; }
}

// Classify a request: is it a cacheable read, a write to a known table, or
// neither? Returns { read: bool, table: string|null }.
export function classify(url, method) {
  let u;
  try { u = new URL(url); } catch { return { read: false, table: null }; }
  const m = (method || 'GET').toUpperCase();
  const rest = u.pathname.match(/\/rest\/v1\/(.+)$/);
  if (rest) {
    const rpc = rest[1].match(/^rpc\/([^/?]+)/);
    if (rpc) {
      const name = rpc[1];
      return { read: (m === 'POST' || m === 'GET') && READ_RPC.test(name) && !WRITE_RPC.has(name), table: null };
    }
    const table = rest[1].split('/')[0];
    return { read: m === 'GET' || m === 'HEAD', table };
  }
  if (/\/storage\/v1\/object\/(sign|list)\//.test(u.pathname) && m === 'POST') return { read: true, table: null };
  return { read: false, table: null };
}

const isNetworkError = (e) => e && (e.name === 'TypeError' || e.name === 'AbortError' || /network|fetch|load failed/i.test(String(e.message || e)));

// userId(): the signed-in user, if the caller can say. Offline with an expired
// token, supabase-js sends the anon key instead of the user's JWT, so the
// request alone can't identify them; the stored session still can.
// pendingFor(table): offline edits waiting to sync for that table (outbox);
// they are laid over every GET of it so a change made at sea stays visible.
export function createReadCache({ store, now = () => Date.now(), stallMs = STALL_MS, isOffline = () => false, report = () => {}, userId = () => null, pendingFor = () => [] }) {
  const fromEntry = (entry) => new Response(entry.status === 204 ? null : entry.body, {
    status: entry.status,
    headers: { ...entry.headers, 'x-cargo-cached-at': String(entry.at) },
  });

  // Lay pending offline edits over a table read (JSON array bodies only).
  async function withPending(res, table, url) {
    const ops = table ? pendingFor(table) : [];
    if (!ops.length || !res.ok) return res;
    try {
      const rows = JSON.parse(await res.clone().text());
      if (!Array.isArray(rows)) return res;
      const headers = {};
      res.headers.forEach((v, k) => { headers[k] = v; });
      return new Response(JSON.stringify(applyOverlay(url, rows, ops)), { status: res.status, headers });
    } catch { return res; }
  }

  return function wrap(baseFetch) {
    const cachedFetch = coreFetch(baseFetch);
    return async function overlaidFetch(input, init = {}) {
      const res = await cachedFetch(input, init);
      const method = (init.method || (typeof input === 'object' && input?.method) || 'GET').toUpperCase();
      if (method !== 'GET') return res;
      const url = typeof input === 'string' ? input : input?.url || String(input);
      return withPending(res, classify(url, method).table, url);
    };
  };

  function coreFetch(baseFetch) {
    return async function cachedFetch(input, init = {}) {
      const url = typeof input === 'string' ? input : input?.url || String(input);
      const method = (init.method || (typeof input === 'object' && input?.method) || 'GET').toUpperCase();
      const { read, table } = classify(url, method);

      if (!read) {
        // Writes and everything else: straight through. Note outcomes so the
        // status bar can say saving is unavailable, and invalidate the table.
        try {
          const res = await baseFetch(input, init);
          if (res.status >= 500) report({ type: 'degraded' });
          else report({ type: 'online' });
          if (res.ok && table) store.markTableStale(table);
          return res;
        } catch (e) {
          if (isNetworkError(e) && !init.signal?.aborted) {
            // A failed save of data is worth telling the crew; auth / function
            // calls just mean we're offline.
            report({ type: /\/(rest|storage)\/v1\//.test(url) ? 'write-failed' : 'offline' });
          }
          throw e;
        }
      }

      const headers = readHeaders(input, init);
      const key = [userId() || userOf(headers), method, url, typeof init.body === 'string' ? init.body : '', ...KEY_HEADERS.map((h) => headers.get(h) || '')].join('|');
      const cachedP = store.get(key);

      const save = async (res) => {
        if (!res.ok) return;
        try {
          const body = method === 'HEAD' || res.status === 204 ? '' : await res.clone().text();
          if (body.length > MAX_BODY_CHARS) return;
          const saved = {};
          SAVED_HEADERS.forEach((h) => { const v = res.headers.get(h); if (v) saved[h] = v; });
          await store.put({ k: key, t: table, at: now(), status: res.status, headers: saved, body });
        } catch { /* body unreadable — skip */ }
      };

      const serveCached = async (why) => {
        const entry = await cachedP;
        if (!entry || (why === 'slow' && entry.stale)) return null;
        report({ type: why, at: entry.at });
        return fromEntry(entry);
      };

      // Known offline: answer from the device straight away when we can.
      if (isOffline()) {
        const hit = await serveCached('offline');
        if (hit) return hit;
      }

      const network = baseFetch(input, init).then(async (res) => {
        if (res.status >= 500) return { res, failed: true };
        save(res);
        return { res, failed: false };
      });

      let stallTimer;
      const stall = new Promise((resolve) => { stallTimer = setTimeout(() => resolve('stall'), stallMs); });

      try {
        const first = await Promise.race([network, stall]);
        if (first === 'stall') {
          const hit = await serveCached('slow');
          if (hit) { network.catch(() => {}); return hit; }
          const { res, failed } = await network;
          if (failed) { const fallback = await serveCached('offline'); if (fallback) return fallback; }
          if (!failed) report({ type: 'online' });
          return res;
        }
        if (first.failed) {
          const hit = await serveCached('offline');
          if (hit) return hit;
          return first.res;
        }
        report({ type: 'online' });
        return first.res;
      } catch (e) {
        if (init.signal?.aborted || !isNetworkError(e)) throw e;
        const hit = await serveCached('offline');
        if (hit) return hit;
        report({ type: 'offline' });
        throw e;
      } finally {
        clearTimeout(stallTimer);
      }
    };
  };
}
