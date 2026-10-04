// Network status for the offline bar. Fed by the read cache (what actually
// happened to Supabase requests) and the browser's online/offline events —
// navigator.onLine alone can't see a satellite link that is "up" but dead.

const listeners = new Set();

let state = {
  mode: 'online',      // 'online' | 'offline' | 'slow'
  dataAt: null,        // oldest saved copy shown during this offline spell (ms)
  reconnectedAt: null, // when we last came back online (for "Back online")
  pending: 0,          // offline changes waiting to sync (outbox)
};

const emit = () => listeners.forEach((fn) => fn(state));

function set(next) {
  state = { ...state, ...next };
  emit();
}

export function reportNetwork(event) {
  switch (event.type) {
    case 'online':
      if (state.mode !== 'online') set({ mode: 'online', dataAt: null, reconnectedAt: Date.now() });
      break;
    case 'write-failed':
    case 'offline':
    case 'slow': {
      const mode = event.type === 'slow' && state.mode !== 'offline' ? 'slow' : 'offline';
      const dataAt = event.at ? Math.min(state.dataAt ?? event.at, event.at) : state.dataAt;
      if (mode !== state.mode || dataAt !== state.dataAt) set({ mode, dataAt });
      break;
    }
    case 'pending':
      if (event.count !== state.pending) set({ pending: event.count });
      break;
    default:
      break;
  }
}

export const isKnownOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

export function getNetworkStatus() { return state; }

export function subscribeNetworkStatus(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

if (typeof window !== 'undefined') {
  window.addEventListener('offline', () => reportNetwork({ type: 'offline' }));
  // The OS saying "online" isn't proof the link works; the next successful
  // request flips us back. Nudge the bar so it stops claiming a dead link.
  window.addEventListener('online', () => { if (state.mode === 'offline') set({ mode: 'slow' }); });
}
