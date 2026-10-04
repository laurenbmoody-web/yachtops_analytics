// Offline writes — layer 2 of offline Cargo. A persistent outbox of table
// writes (upsert / delete) for workflows crew must be able to record at sea.
//
//   submit(op)  Online: runs the write now; a real rejection (RLS, locked
//               month, bad data) still throws, exactly as before. If the
//               network is the problem, the op is saved on the device and
//               submit resolves { queued: true } — the change counts as made.
//   flush()     Replays saved ops (oldest first) when the link returns: on
//               reconnect, app resume, sign-in and a timer while any wait.
//
// Ops carry a `key` (table + row identity); a newer op for the same key is
// folded into the waiting one (combine()), so only the latest version of each
// row is synced.
// Ops are per user: only the signed-in user's ops are replayed or shown.
// While waiting, pending ops are laid over every read of their table
// (overlay.js), so the edit stays visible across reloads.
//
// Pure (storage, executor, clock injected) — tested in outbox.test.mjs.

const isTransient = (res) => {
  if (res?.thrown) return true;                      // fetch threw: offline
  const e = res?.error;
  if (!e) return false;
  if (res.status >= 500 || res.status === 0) return true;
  if (!e.code && /fetch|network|load failed|abort|timed? ?out/i.test(`${e.message} ${e.details}`)) return true;
  return false;
};

// A newer op for a row that already has one waiting → the single op to keep
// (null = nothing left to send). Ops: insert (new row, client id) · upsert ·
// update (partial patch) · delete.
export function combine(prev, next) {
  const keep = { ...next, createdAt: prev.createdAt }; // keep its place in line
  if (next.type === 'delete') {
    // Never reached the server → cancel out entirely.
    return prev.type === 'insert' ? null : keep;
  }
  if (next.type === 'update') {
    if (prev.type === 'delete') return { ...prev, seq: next.seq };   // gone stays gone
    if (prev.type === 'insert' || prev.type === 'upsert') {
      return { ...prev, seq: next.seq, row: { ...prev.row, ...next.patch }, label: prev.label };
    }
    if (prev.type === 'update') return { ...keep, patch: { ...prev.patch, ...next.patch } };
  }
  return keep; // insert / upsert replace whatever was waiting
}

export function createOutbox({ store, execute, userId = () => null, now = () => Date.now(), onChange = () => {}, onRejected = () => {} }) {
  let ops = [];          // in-memory mirror of the store, oldest first
  let flushing = null;
  let dirty = false;     // ops changed while a flush was running
  let rerun = false;     // flush() asked for again while one was running
  let seq = 0;
  const ready = store.all().then((saved) => {
    ops = saved.sort((a, b) => a.createdAt - b.createdAt || a.seq - b.seq);
    seq = ops.reduce((m, o) => Math.max(m, o.seq || 0), 0);
    onChange();
  });

  const mine = () => { const u = userId(); return ops.filter((o) => o.user === u); };

  async function save(op) {
    ops = ops.filter((o) => o.key !== op.key).concat(op);
    if (flushing) dirty = true;
    await store.put(op);
    onChange();
  }

  // Remove a synced/rejected op — unless a newer edit of the same row replaced
  // it meanwhile (that one still has to go up).
  async function drop(op) {
    const current = ops.find((o) => o.key === op.key);
    if (!current || current.seq !== op.seq) return;
    ops = ops.filter((o) => o.key !== op.key);
    await store.delete(op.key);
    onChange();
  }

  async function submit(input) {
    await ready;
    const op = { ...input, user: userId(), createdAt: now(), seq: ++seq };
    // An older edit of the same row is still waiting: fold this one into it
    // (or queue behind it) rather than racing it, so the server ends on the
    // latest version.
    const prev = ops.find((o) => o.key === op.key && o.user === op.user);
    if (prev) {
      const merged = combine(prev, op);
      if (merged) await save(merged);
      else await drop(prev); // created and deleted offline: nothing to send
      flush();
      return { queued: true };
    }
    let res;
    try { res = await execute(op); } catch (e) { res = { thrown: e }; }
    if (!res?.error && !res?.thrown) return { queued: false, data: res?.data ?? null };
    if (isTransient(res)) {
      await save(op);
      return { queued: true };
    }
    throw res.error;
  }

  // → true if it stopped because the link is still down.
  async function runFlush() {
    await ready;
    for (const op of mine()) {
      let res;
      try { res = await execute(op); } catch (e) { res = { thrown: e }; }
      if (!res?.error && !res?.thrown) { await drop(op); continue; }
      if (isTransient(res)) return true; // still offline — try again later
      await drop(op);
      onRejected(op, res.error);
    }
    return false;
  }

  function flush() {
    if (flushing) { rerun = true; return flushing; }
    dirty = false;
    rerun = false;
    flushing = runFlush().then((offline) => {
      flushing = null;
      // Asked again mid-run (e.g. "back online" arrived during an offline
      // attempt), or edits queued mid-run: go again now, not on the timer.
      const again = rerun || (dirty && !offline);
      if (again && mine().length) return flush();
      return undefined;
    }, () => { flushing = null; });
    return flushing;
  }

  return {
    ready,
    submit,
    flush,
    // Pending ops of the signed-in user for one table (for the read overlay).
    pendingFor: (table) => mine().filter((o) => o.table === table),
    pendingCount: () => mine().length,
  };
}
