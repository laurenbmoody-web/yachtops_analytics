// Cargo Accounts — Ledger Part B. Data access for statement import & reconciliation.
// { data, error } throughout; the pure matching lives in statementMatch.js and the
// pure parsing in statementParse.js (the UI turns the file into rows with SheetJS).

import { supabase } from '../lib/supabaseClient';
import { matchStatement } from './statementMatch.js';
import { createTransaction } from './financeService.js';

const STMT_SELECT =
  'id, tenant_id, account_id, source, period_start, period_end, file_path, file_name, status, uploaded_by, created_at, updated_at';
const LINE_SELECT =
  'id, tenant_id, statement_id, line_date, description, amount, currency, external_ref, match_status, matched_txn_id, created_at';
const CAND_SELECT =
  'id, account_id, txn_date, amount, currency, category, description, payee, status, reconciled_at';
const BUCKET = 'statement-imports';

const currentUserId = async () => {
  try { const { data } = await supabase.auth.getUser(); return data?.user?.id || null; } catch { return null; }
};
const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// ── Create / upload / ingest ────────────────────────────────────────────────

export const listStatements = async (tenantId) => {
  if (!tenantId) return { data: null, error: new Error('No active tenant') };
  const { data, error } = await supabase.from('imported_statements').select(STMT_SELECT)
    .eq('tenant_id', tenantId).order('created_at', { ascending: false });
  return { data, error };
};

export const createStatement = async ({ tenant_id, account_id, source, period_start, period_end, file_name }) => {
  const uploaded_by = await currentUserId();
  const { data, error } = await supabase.from('imported_statements').insert({
    tenant_id, account_id: account_id || null, source: source || 'bank',
    period_start: period_start || null, period_end: period_end || null,
    file_name: file_name || null, status: 'parsing', uploaded_by,
  }).select(STMT_SELECT).single();
  return { data, error };
};

export const uploadStatementFile = async (statementId, file, tenantId) => {
  if (!file) return { data: null, error: null };
  const ext = (file.name || '').split('.').pop() || 'bin';
  const file_path = `${tenantId}/${statementId}/${Date.now()}.${ext}`;
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(file_path, file, { upsert: false });
  if (upErr) return { data: null, error: upErr };
  const { data, error } = await supabase.from('imported_statements')
    .update({ file_path, file_name: file.name || null }).eq('id', statementId).select(STMT_SELECT).single();
  return { data, error };
};

// Bulk-insert parsed rows and flip the statement to 'ready'.
export const addStatementLines = async (statementId, tenantId, rows, currency = 'EUR') => {
  const payload = (rows || []).map((r) => ({
    tenant_id: tenantId, statement_id: statementId,
    line_date: r.line_date || null, description: r.description || null,
    amount: r.amount, currency: r.currency || currency,
    external_ref: r.external_ref || null, raw: r.raw || null,
    match_status: 'unmatched',
  }));
  if (payload.length) {
    const { error } = await supabase.from('statement_lines').insert(payload);
    if (error) return { data: null, error };
  }
  const { data, error } = await supabase.from('imported_statements')
    .update({ status: 'ready' }).eq('id', statementId).select(STMT_SELECT).single();
  return { data, error };
};

// ── Matching ────────────────────────────────────────────────────────────────

const candidateWindow = (stmt, lines) => {
  const dates = (lines || []).map((l) => l.line_date).filter(Boolean);
  const from = stmt.period_start || (dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : null);
  const to = stmt.period_end || (dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null);
  return { from: from ? addDays(from, -5) : null, to: to ? addDays(to, 5) : null };
};

const fetchCandidates = async (stmt, lines) => {
  const { from, to } = candidateWindow(stmt, lines);
  let q = supabase.from('ledger_transactions').select(CAND_SELECT)
    .eq('tenant_id', stmt.tenant_id).neq('status', 'void');
  if (stmt.account_id) q = q.eq('account_id', stmt.account_id);
  if (from) q = q.gte('txn_date', from);
  if (to) q = q.lte('txn_date', to);
  const { data, error } = await q;
  return { data, error };
};

// Run the matcher, persist each line's status + link, and stamp reconciled_at on the
// ledger rows that got matched. Returns the outcome counts.
export const runMatch = async (statementId) => {
  const { data: stmt, error: sErr } = await supabase.from('imported_statements').select(STMT_SELECT).eq('id', statementId).single();
  if (sErr) return { data: null, error: sErr };
  const { data: lines, error: lErr } = await supabase.from('statement_lines').select(LINE_SELECT).eq('statement_id', statementId);
  if (lErr) return { data: null, error: lErr };
  const active = (lines || []).filter((l) => l.match_status !== 'ignored');
  const candRes = await fetchCandidates(stmt, active);
  if (candRes.error) return { data: null, error: candRes.error };

  const result = matchStatement(active, candRes.data || []);
  // Persist per-line results.
  await Promise.all(result.lines.map((r) => supabase.from('statement_lines')
    .update({ match_status: r.match_status, matched_txn_id: r.matched_txn_id })
    .eq('id', r.id)));
  // Reconcile the matched ledger rows.
  const matchedTxnIds = result.lines.filter((r) => r.match_status === 'matched' && r.matched_txn_id).map((r) => r.matched_txn_id);
  if (matchedTxnIds.length) {
    await supabase.from('ledger_transactions').update({ reconciled_at: new Date().toISOString() }).in('id', matchedTxnIds);
  }
  return { data: { counts: result.counts, unconfirmed: result.unconfirmed }, error: null };
};

// ── Reconcile view (exceptions-first) ───────────────────────────────────────

export const getReconcileView = async (statementId) => {
  const { data: stmt, error: sErr } = await supabase.from('imported_statements').select(STMT_SELECT).eq('id', statementId).single();
  if (sErr) return { data: null, error: sErr };
  const { data: lines, error: lErr } = await supabase.from('statement_lines').select(LINE_SELECT)
    .eq('statement_id', statementId).order('line_date', { ascending: true });
  if (lErr) return { data: null, error: lErr };
  const candRes = await fetchCandidates(stmt, lines || []);
  if (candRes.error) return { data: null, error: candRes.error };
  const cands = candRes.data || [];
  const candById = Object.fromEntries(cands.map((t) => [t.id, t]));

  // Re-run the matcher (against fresh ledger) to surface review candidates + unconfirmed,
  // but keep any user-accepted/ignored statuses already persisted on the lines.
  const active = (lines || []).filter((l) => l.match_status !== 'ignored');
  const live = matchStatement(active, cands);
  const liveByLine = Object.fromEntries(live.lines.map((r) => [r.id, r]));

  const matchedTxnIds = new Set((lines || []).filter((l) => l.matched_txn_id).map((l) => l.matched_txn_id));
  const enrich = (l) => ({ ...l, candidates: (liveByLine[l.id]?.candidates || []).map((id) => candById[id]).filter(Boolean), matched: candById[l.matched_txn_id] || null });

  const grouped = { matched: [], missing: [], review: [], ignored: [] };
  (lines || []).forEach((l) => {
    const status = l.matched_txn_id ? 'matched' : (l.match_status === 'ignored' ? 'ignored' : (liveByLine[l.id]?.match_status || l.match_status));
    (grouped[status] || (grouped[status] = [])).push(enrich({ ...l, match_status: status }));
  });
  const unconfirmed = cands.filter((t) => live.unconfirmed.includes(t.id) && !matchedTxnIds.has(t.id));

  const counts = {
    total: (lines || []).length,
    matched: grouped.matched.length,
    missing: grouped.missing.length,
    review: grouped.review.length,
    ignored: grouped.ignored.length,
    unconfirmed: unconfirmed.length,
  };
  return { data: { statement: stmt, groups: grouped, unconfirmed, counts }, error: null };
};

// ── Resolve one exception ───────────────────────────────────────────────────

// action: 'accept' (link txnId + reconcile), 'ignore', 'add' (create ledger row from
// the line + link it). payload: { txnId?, accountId? }
export const resolveLine = async (line, action, payload = {}) => {
  if (action === 'ignore') {
    const { error } = await supabase.from('statement_lines').update({ match_status: 'ignored', matched_txn_id: null }).eq('id', line.id);
    return { data: null, error };
  }
  if (action === 'accept') {
    const txnId = payload.txnId;
    if (!txnId) return { data: null, error: new Error('No transaction chosen') };
    const { error } = await supabase.from('statement_lines').update({ match_status: 'matched', matched_txn_id: txnId }).eq('id', line.id);
    if (error) return { data: null, error };
    await supabase.from('ledger_transactions').update({ reconciled_at: new Date().toISOString() }).eq('id', txnId);
    return { data: null, error: null };
  }
  if (action === 'add') {
    const res = await createTransaction({
      tenant_id: line.tenant_id,
      account_id: payload.accountId || null,
      txn_date: line.line_date || undefined,
      amount: line.amount,
      currency: line.currency || 'EUR',
      description: line.description || 'Imported statement line',
      source: 'import',
    });
    if (res.error || !res.data) return { data: null, error: res.error || new Error('Could not add') };
    await supabase.from('ledger_transactions').update({ reconciled_at: new Date().toISOString() }).eq('id', res.data.id);
    const { error } = await supabase.from('statement_lines').update({ match_status: 'matched', matched_txn_id: res.data.id }).eq('id', line.id);
    return { data: res.data, error };
  }
  return { data: null, error: new Error('Unknown action') };
};

// Finalise: mark the statement reconciled.
export const finishReconcile = async (statementId) => {
  const { data, error } = await supabase.from('imported_statements')
    .update({ status: 'reconciled' }).eq('id', statementId).select(STMT_SELECT).single();
  return { data, error };
};
