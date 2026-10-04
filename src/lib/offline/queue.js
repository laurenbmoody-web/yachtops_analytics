// The app's one outbox (outbox.js) — offline writes for the workflows crew
// record at sea — plus when to sync it: on reconnect, when a request succeeds
// again, when the app comes back to the foreground, and every 30s while
// anything waits. The executor (the real Supabase write) is supplied by
// lib/supabaseClient.js, which imports this module, not the other way round.

import { createOutbox } from './outbox';
import { outboxStore } from './idbStore';
import { storedUserId } from './session';
import { reportNetwork, subscribeNetworkStatus } from './status';
import { showToast } from '../../utils/toast';

let executor = null;
export const setOutboxExecutor = (fn) => { executor = fn; };

export const outbox = createOutbox({
  store: outboxStore,
  userId: storedUserId,
  execute: (op) => {
    if (!executor) return Promise.resolve({ error: { message: 'Failed to fetch (not ready)', code: '' }, status: 0 });
    return executor(op);
  },
  onChange: () => reportNetwork({ type: 'pending', count: outbox.pendingCount() }),
  onRejected: (op, error) => {
    showToast(`${op.label || 'An offline change'} couldn’t be saved: ${error?.message || 'rejected by the server'}`, 'error', 9000);
  },
});

if (typeof window !== 'undefined') {
  const kick = () => { if (outbox.pendingCount()) outbox.flush(); };
  window.addEventListener('online', kick);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') kick(); });
  let lastMode = null;
  subscribeNetworkStatus((s) => { if (s.mode === 'online' && lastMode && lastMode !== 'online') kick(); lastMode = s.mode; });
  setInterval(kick, 30_000);
  outbox.ready.then(() => setTimeout(kick, 2000));
}

// A Storage file waiting in the outbox (type 'upload') → its data URL, so the
// photo shows on the device before it has been uploaded.
export const pendingUpload = (bucket, path) => outbox.pendingFor(`storage:${bucket}`).find((o) => o.path === path)?.dataUrl || null;
