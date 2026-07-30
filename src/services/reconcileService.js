// Cargo Accounts — data access for month-end account reconciliations.
//
// A holder works their own card/float through the month, then submits it for
// Command sign-off. One row per (account, period_month). Conventions match
// financeService: { data, error }, explicit columns, RLS-scoped.

import { supabase } from '../lib/supabaseClient';
import { currentUserId } from './financeService.js';

const RECON_SELECT =
  'id, tenant_id, account_id, period_month, status, opening_balance, closing_balance, ' +
  'note, submitted_by, submitted_at, approved_by, approved_at, created_at, updated_at, ' +
  'stmt_opening, stmt_money_in, stmt_money_out, stmt_closing, funding_due';

// The reconciliation row for an account+month, or null if not started yet.
export async function getReconciliation(accountId, periodMonth) {
  if (!accountId || !periodMonth) return { data: null, error: null };
  const { data, error } = await supabase
    .from('account_reconciliations')
    .select(RECON_SELECT)
    .eq('account_id', accountId)
    .eq('period_month', periodMonth)
    .maybeSingle();
  return { data, error };
}

// All reconciliations for a tenant in a given month — Command's approval queue.
export async function listReconciliationsForMonth(tenantId, periodMonth) {
  if (!tenantId || !periodMonth) return { data: [], error: null };
  const { data, error } = await supabase
    .from('account_reconciliations')
    .select(RECON_SELECT)
    .eq('tenant_id', tenantId)
    .eq('period_month', periodMonth)
    .order('status', { ascending: true });
  return { data: data || [], error };
}

// Ensure a row exists for (account, month) so status can be tracked. Idempotent.
export async function ensureReconciliation({ tenantId, accountId, periodMonth }) {
  const existing = await getReconciliation(accountId, periodMonth);
  if (existing.data || existing.error) return existing;
  const created_by = await currentUserId();
  const { data, error } = await supabase
    .from('account_reconciliations')
    .insert({ tenant_id: tenantId, account_id: accountId, period_month: periodMonth, status: 'open', created_by })
    .select(RECON_SELECT)
    .single();
  return { data, error };
}

// Holder submits the month: snapshot balances, stamp submitter, lock to review.
export async function submitReconciliation({ tenantId, accountId, periodMonth, openingBalance, closingBalance, note }) {
  const ensured = await ensureReconciliation({ tenantId, accountId, periodMonth });
  if (ensured.error) return ensured;
  const submitted_by = await currentUserId();
  const { data, error } = await supabase
    .from('account_reconciliations')
    .update({
      status: 'submitted',
      opening_balance: openingBalance ?? null,
      closing_balance: closingBalance ?? null,
      note: note || null,
      submitted_by,
      submitted_at: new Date().toISOString(),
    })
    .eq('id', ensured.data.id)
    .select(RECON_SELECT)
    .single();
  return { data, error };
}

// Command signs off. RLS lets any member update, so the caller must gate this on
// COMMAND; we also only allow it from a 'submitted' row.
export async function approveReconciliation(id) {
  const approved_by = await currentUserId();
  const { data, error } = await supabase
    .from('account_reconciliations')
    .update({ status: 'approved', approved_by, approved_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'submitted')
    .select(RECON_SELECT)
    .single();
  return { data, error };
}

// Command bounces a submitted month back to the holder to fix.
export async function reopenReconciliation(id, note) {
  const { data, error } = await supabase
    .from('account_reconciliations')
    .update({ status: 'open', submitted_at: null, approved_by: null, approved_at: null, note: note || null })
    .eq('id', id)
    .select(RECON_SELECT)
    .single();
  return { data, error };
}

// ── Month-end close against the bank statement ────────────────────────────────
// The statement is the source document: we record what IT said for the period,
// alongside what Cargo computed, so the close is auditable. Nothing here forces a
// balance — the gate lives in the pure closeBlockers() in monthEnd.js.

// Save (or update) the figures read off the statement. Safe to call as they're typed.
export async function saveStatementFigures({ tenantId, accountId, periodMonth, statement }) {
  const created_by = await currentUserId();
  const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));
  const { data, error } = await supabase
    .from('account_reconciliations')
    .upsert({
      tenant_id: tenantId,
      account_id: accountId,
      period_month: periodMonth,
      stmt_opening: num(statement?.opening),
      stmt_money_in: num(statement?.moneyIn),
      // Stored as a magnitude — however the crew type it off the statement.
      stmt_money_out: statement?.moneyOut === '' || statement?.moneyOut == null
        ? null : Math.abs(Number(statement.moneyOut)),
      stmt_closing: num(statement?.closing),
      created_by,
    }, { onConflict: 'account_id,period_month' })
    .select(RECON_SELECT)
    .single();
  return { data, error };
}

// Close the month. `fundingDue` is the DERIVED outcome (the top-up that restores an
// imprest float, or the APA balance to return) — recorded, not used to balance.
export async function closeMonth({ tenantId, accountId, periodMonth, openingBalance, closingBalance, fundingDue, note }) {
  const submitted_by = await currentUserId();
  const { data, error } = await supabase
    .from('account_reconciliations')
    .upsert({
      tenant_id: tenantId,
      account_id: accountId,
      period_month: periodMonth,
      status: 'submitted',
      opening_balance: openingBalance ?? null,
      closing_balance: closingBalance ?? null,
      funding_due: fundingDue ?? null,
      note: note || null,
      submitted_by,
      submitted_at: new Date().toISOString(),
    }, { onConflict: 'account_id,period_month' })
    .select(RECON_SELECT)
    .single();
  return { data, error };
}
