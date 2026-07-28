// Cargo Accounts — pure month-end reconciliation state helpers (no Supabase), so
// they are unit-testable. Period keys and the submit/approve gating live here.

// First-of-month ISO date for a given year/month (month is 1-12).
export function periodMonthISO(year, month) {
  const mm = String(month).padStart(2, '0');
  return `${year}-${mm}-01`;
}

// Whether a holder can submit this month for sign-off: everything sorted and the
// statement matched. counts = { toSort, matched, total }.
export function canSubmit(counts) {
  if (!counts) return false;
  return (counts.toSort || 0) === 0 && (counts.matched || 0) >= (counts.total || 0) && (counts.total || 0) > 0;
}

// The one-line status message the footer shows, mirroring the approved mock.
export function reconcileMessage(counts, status) {
  if (status === 'submitted') return { text: 'Sent — the Purser will check it off', tone: 'sent' };
  if (status === 'approved') return { text: 'Checked off', tone: 'ok' };
  const toSort = counts?.toSort || 0;
  if (toSort > 0) return { text: `${toSort} to sort first`, tone: 'due' };
  if ((counts?.matched || 0) < (counts?.total || 0)) return { text: 'Sorted — import your statement to finish', tone: 'due' };
  return { text: 'All done — ready to send', tone: 'ok' };
}

// Closing = opening + sum(signed amounts). Kept here so the equation the UI shows
// and the snapshot the service writes agree.
export function closingBalance(opening, txns) {
  return (Number(opening) || 0) + (txns || []).reduce((s, t) => s + (Number(t.amount) || 0), 0);
}
