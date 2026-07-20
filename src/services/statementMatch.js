// Cargo Accounts — statement reconciliation matcher (pure, no imports).
//
// Given the lines parsed from an uploaded statement + the candidate ledger
// transactions (same tenant/account, roughly the same period), assign each
// statement line a match status, and surface ledger rows that aren't on the
// statement. Deterministic and testable like budgetCalc/budgetClassify — the
// amount/tolerance/date-window logic lives here in one place.
//
//   matched      — exactly one unused ledger row, equal amount, date within ±window
//   review       — several equal candidates, or a near-amount (rounding/fee) candidate
//   missing      — nothing in the ledger → real spend nobody logged (one-click add)
//   unconfirmed  — a ledger row in the statement's span with no statement line
//   ignored      — set by the user (never computed here)
//
// Amounts are SIGNED and share the ledger convention (money out negative).

const r2 = (n) => Math.round(Number(n) * 100) / 100;
const dayNum = (iso) => {
  const s = String(iso ?? '').slice(0, 10);
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  return Date.UTC(y, m - 1, d) / 86400000;
};
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const tokens = (s) => new Set(norm(s).split(' ').filter((w) => w.length > 2));
const jaccard = (a, b) => { let i = 0; a.forEach((x) => { if (b.has(x)) i += 1; }); const u = a.size + b.size - i; return u ? i / u : 0; };

export const matchStatement = (statementLines, ledgerTxns, opts = {}) => {
  const { windowDays = 3, exactTol = 0.005, nearAbs = 5, nearPct = 0.02 } = opts;

  const txns = (ledgerTxns || []).map((t) => ({
    id: t.id,
    amount: r2(t.amount),
    day: dayNum(t.txn_date),
    tok: tokens(`${t.description || ''} ${t.category || ''} ${t.payee || ''}`),
  }));
  const used = new Set();

  const lines = (statementLines || []).map((ln, index) => {
    const amount = r2(ln.amount);
    const day = dayNum(ln.line_date);
    const ltok = tokens(ln.description || '');
    const inWindow = (t) => (t.day == null || day == null ? true : Math.abs(t.day - day) <= windowDays);
    const avail = txns.filter((t) => !used.has(t.id) && inWindow(t));
    const exact = avail.filter((t) => Math.abs(t.amount - amount) <= exactTol);

    let match_status; let matched_txn_id = null; let candidates = [];
    if (exact.length === 1) {
      match_status = 'matched'; matched_txn_id = exact[0].id; used.add(exact[0].id);
    } else if (exact.length > 1) {
      // Multiple equal-amount candidates — pick the best (description then date) as the
      // suggested link, but leave it for the user to confirm.
      match_status = 'review';
      const ranked = [...exact].sort((a, b) => (jaccard(b.tok, ltok) - jaccard(a.tok, ltok))
        || (Math.abs((a.day ?? day) - day) - Math.abs((b.day ?? day) - day)));
      candidates = ranked.map((t) => t.id);
    } else {
      const band = Math.max(nearAbs, Math.abs(amount) * nearPct);
      const near = avail.filter((t) => Math.abs(t.amount - amount) <= band);
      if (near.length) {
        match_status = 'review';
        candidates = near.sort((a, b) => Math.abs(a.amount - amount) - Math.abs(b.amount - amount)).map((t) => t.id);
      } else {
        match_status = 'missing';
      }
    }
    return { index, id: ln.id ?? null, amount, line_date: ln.line_date ?? null, description: ln.description ?? null, match_status, matched_txn_id, candidates };
  });

  // Ledger rows within the statement's span that no line matched → unconfirmed.
  const days = (statementLines || []).map((l) => dayNum(l.line_date)).filter((d) => d != null);
  const lo = days.length ? Math.min(...days) - windowDays : null;
  const hi = days.length ? Math.max(...days) + windowDays : null;
  const referenced = new Set(lines.flatMap((l) => [l.matched_txn_id, ...l.candidates]).filter(Boolean));
  const unconfirmed = txns
    .filter((t) => !used.has(t.id) && !referenced.has(t.id) && (lo == null || t.day == null || (t.day >= lo && t.day <= hi)))
    .map((t) => t.id);

  const counts = lines.reduce((c, l) => { c[l.match_status] = (c[l.match_status] || 0) + 1; return c; }, {});
  counts.unconfirmed = unconfirmed.length;
  return { lines, unconfirmed, counts };
};
