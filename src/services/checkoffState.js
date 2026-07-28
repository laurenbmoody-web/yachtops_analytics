// Cargo Accounts — pure helpers for Command's month-end Check-off queue (no
// Supabase), so they are unit-testable. Merge each account with its
// reconciliation row for the period and bucket them by where they sit in the
// flow, in the plain voice the rest of the module uses.

// The four lanes, in the order Command works them. `waiting` is what needs
// their eyes; `done` is finished; the middle two are the holder's court.
export const CHECKOFF_LANES = [
  { key: 'waiting', label: 'Waiting on you', tone: 'due' },
  { key: 'progress', label: 'Being tidied', tone: 'work' },
  { key: 'notStarted', label: 'Not started', tone: 'idle' },
  { key: 'done', label: 'Checked off', tone: 'ok' },
];

// Map a reconciliation status (or its absence) to a lane key.
export function laneFor(status) {
  if (status === 'submitted') return 'waiting';
  if (status === 'approved') return 'done';
  if (status === 'open') return 'progress';
  return 'notStarted';
}

// Merge accounts with the period's reconciliation rows into one row per account.
// accounts: [{ id, name, holder_role, currency, balance, kind, funds_type }]
// recons:   [{ account_id, status, closing_balance, submitted_at, submitted_by }]
export function buildCheckoffRows(accounts, recons) {
  const byAccount = new Map();
  (recons || []).forEach((r) => { if (r?.account_id) byAccount.set(r.account_id, r); });
  return (accounts || [])
    .filter((a) => a.is_active !== false && a.kind !== 'bank')
    .map((a) => {
      const recon = byAccount.get(a.id) || null;
      const status = recon?.status || 'not_started';
      return { account: a, recon, status, lane: laneFor(status) };
    });
}

// Group rows into the ordered lanes, dropping any that end up empty.
export function groupByLane(rows) {
  return CHECKOFF_LANES
    .map((lane) => ({ ...lane, rows: (rows || []).filter((r) => r.lane === lane.key) }))
    .filter((lane) => lane.rows.length > 0);
}

// Headline counts for the queue's meta strip.
export function checkoffCounts(rows) {
  const c = { waiting: 0, progress: 0, notStarted: 0, done: 0, total: (rows || []).length };
  (rows || []).forEach((r) => { c[r.lane] = (c[r.lane] || 0) + 1; });
  return c;
}
