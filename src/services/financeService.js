// Cargo Accounts — Phase 0. Data-access layer for financial_accounts + ledger_transactions.
//
// Conventions (matching src/pages/provisioning/supplier-detail/supplierMetricsQueries.js):
//   - every export returns { data, error }, never throws
//   - explicit column lists, never select('*')
//   - RLS-scoped (no service-role); every read/write is scoped by tenant_id, which
//     RLS also enforces via is_active_tenant_member(tenant_id, auth.uid())
//   - balance math lives in the pure, testable financeCalc.js
//
// The active tenant is resolved by the caller (useTenant().activeTenantId) and passed in.

import { supabase } from '../lib/supabaseClient';
import {
  computeAccountBalance,
  computeAccountBaseBalance,
  computeCashPosition,
  deriveAmountBase,
} from './financeCalc.js';

const ACCOUNT_SELECT =
  'id, tenant_id, name, kind, currency, opening_balance, is_active, notes, ' +
  'funds_type, holder_role, holder_user_id, card_last4, provider, ' +
  'created_by, created_at, updated_at';

const TXN_SELECT =
  'id, tenant_id, account_id, txn_date, amount, currency, fx_rate, amount_base, ' +
  'category, category_code, department, vat_amount, vat_rate, payee, ' +
  'description, source, status, supplier_order_id, supplier_invoice_id, ' +
  'provisioning_item_id, defect_id, trip_id, crew_id, posting_group_id, created_by, created_at';

const ATTACHMENT_SELECT =
  'id, tenant_id, ledger_transaction_id, storage_path, file_name, mime_type, size_bytes, uploaded_by, created_at';
const RECEIPT_BUCKET = 'ledger-receipts';

const currentUserId = async () => {
  try {
    const { data } = await supabase.auth.getUser();
    return data?.user?.id || null;
  } catch {
    return null;
  }
};

// ── Accounts ────────────────────────────────────────────────────────────────

// Accounts with computed balances (account currency + reporting/base) plus the
// tenant cash position. One overview fetch for the Accounts page.
export const getAccountsOverview = async (tenantId) => {
  if (!tenantId) return { data: null, error: new Error('No active tenant') };

  const { data: accounts, error } = await supabase
    .from('financial_accounts')
    .select(ACCOUNT_SELECT)
    .eq('tenant_id', tenantId)
    .order('is_active', { ascending: false })
    .order('created_at', { ascending: true });
  if (error) return { data: null, error };

  // Balance-affecting columns only; RLS scopes to this tenant.
  const { data: txns, error: txnErr } = await supabase
    .from('ledger_transactions')
    .select('account_id, amount, amount_base, status')
    .eq('tenant_id', tenantId);
  if (txnErr) return { data: null, error: txnErr };

  const withBalances = (accounts || []).map((a) => ({
    ...a,
    balance: computeAccountBalance(a, txns),
    base_balance: computeAccountBaseBalance(a, txns),
    // Ledger rows on this account not yet marked reconciled — drives the
    // per-account "to review / reconciled" indicator on the overview.
    unreconciled: (txns || []).filter((t) => t.account_id === a.id && t.status !== 'reconciled').length,
  }));

  return {
    data: {
      accounts: withBalances,
      cashPosition: computeCashPosition(accounts || [], txns),
    },
    error: null,
  };
};

export const listAccounts = async (tenantId) => {
  const { data, error } = await getAccountsOverview(tenantId);
  return { data: data?.accounts || null, error };
};

export const createAccount = async (payload) => {
  const created_by = await currentUserId();
  const { data, error } = await supabase
    .from('financial_accounts')
    .insert({
      tenant_id: payload.tenant_id,
      name: payload.name,
      kind: payload.kind || 'bank',
      currency: payload.currency || 'EUR',
      opening_balance: payload.opening_balance ?? 0,
      notes: payload.notes || null,
      funds_type: payload.funds_type || 'general',
      holder_role: payload.holder_role || null,
      holder_user_id: payload.holder_user_id || null,
      card_last4: payload.card_last4 || null,
      provider: payload.provider || null,
      created_by,
    })
    .select(ACCOUNT_SELECT)
    .single();
  return { data, error };
};

export const updateAccount = async (id, patch) => {
  const allowed = ['name', 'kind', 'currency', 'opening_balance', 'notes', 'is_active',
    'funds_type', 'holder_role', 'holder_user_id', 'card_last4', 'provider'];
  const clean = Object.fromEntries(Object.entries(patch || {}).filter(([k]) => allowed.includes(k)));
  const { data, error } = await supabase
    .from('financial_accounts')
    .update(clean)
    .eq('id', id)
    .select(ACCOUNT_SELECT)
    .single();
  return { data, error };
};

export const deactivateAccount = async (id) => updateAccount(id, { is_active: false });

// ── Transactions ──────────────────────────────────────────────────────────────

// filters: { accountId, source, category, from, to, search, needsAttention }
export const listTransactions = async (tenantId, filters = {}) => {
  if (!tenantId) return { data: null, error: new Error('No active tenant') };

  let q = supabase
    .from('ledger_transactions')
    .select(TXN_SELECT)
    .eq('tenant_id', tenantId);

  if (filters.accountId) q = q.eq('account_id', filters.accountId);
  if (filters.source) q = q.eq('source', filters.source);
  if (filters.category) q = q.eq('category', filters.category);
  if (filters.from) q = q.gte('txn_date', filters.from);
  if (filters.to) q = q.lte('txn_date', filters.to);
  if (filters.search) q = q.ilike('description', `%${filters.search}%`);
  if (filters.needsAttention) q = q.or('account_id.is.null,status.eq.unreconciled');

  // Newest first for display; the page reverses per-account to compute running balance.
  q = q.order('txn_date', { ascending: false }).order('created_at', { ascending: false });

  const { data, error } = await q;
  return { data, error };
};

export const createTransaction = async (payload) => {
  const created_by = await currentUserId();
  const fx_rate = payload.fx_rate ?? 1;
  const amount = Number(payload.amount);
  const hasAccount = Boolean(payload.account_id);

  const { data, error } = await supabase
    .from('ledger_transactions')
    .insert({
      tenant_id: payload.tenant_id,
      account_id: payload.account_id || null,
      txn_date: payload.txn_date || new Date().toISOString().slice(0, 10),
      amount,
      currency: payload.currency || 'EUR',
      fx_rate,
      amount_base: payload.amount_base ?? deriveAmountBase(amount, fx_rate),
      category: payload.category || null,
      category_code: payload.category_code || null,
      department: payload.department || null,
      vat_amount: payload.vat_amount ?? null,
      vat_rate: payload.vat_rate ?? null,
      payee: payload.payee || null,
      description: payload.description || null,
      source: payload.source || 'manual',
      // A manual row booked straight into an account is reconciled; an unassigned
      // one lands in the "Needs attention" queue.
      status: hasAccount ? 'reconciled' : 'unreconciled',
      supplier_order_id: payload.supplier_order_id || null,
      supplier_invoice_id: payload.supplier_invoice_id || null,
      provisioning_item_id: payload.provisioning_item_id || null,
      defect_id: payload.defect_id || null,
      trip_id: payload.trip_id || null,
      crew_id: payload.crew_id || null,
      created_by,
    })
    .select(TXN_SELECT)
    .single();
  return { data, error };
};

// Void instead of hard-delete (hard delete is COMMAND-only at the RLS layer and
// never exposed in the UI).
export const voidTransaction = async (id) => {
  const { data, error } = await supabase
    .from('ledger_transactions')
    .update({ status: 'void' })
    .eq('id', id)
    .select(TXN_SELECT)
    .single();
  return { data, error };
};

// Assign an unreconciled/unassigned row (e.g. an auto-posted supplier invoice) to
// an account and mark it reconciled, clearing it from the "Needs attention" queue.
export const assignTransactionAccount = async (id, accountId) => {
  const { data, error } = await supabase
    .from('ledger_transactions')
    .update({ account_id: accountId, status: 'reconciled' })
    .eq('id', id)
    .select(TXN_SELECT)
    .single();
  return { data, error };
};

// ── Receipts / attachments ──────────────────────────────────────────────────

// Upload a receipt file for a ledger row into the private ledger-receipts bucket
// (path: <tenant>/<txn>/<ts>.<ext>) and record it in ledger_transaction_attachments.
export const uploadReceipt = async (txnId, file, { tenantId }) => {
  if (!txnId || !file || !tenantId) return { data: null, error: new Error('Missing receipt, transaction, or tenant') };
  const uploaded_by = await currentUserId();
  const ext = (file.name || '').split('.').pop() || 'bin';
  const storage_path = `${tenantId}/${txnId}/${Date.now()}.${ext}`;
  const { error: upErr } = await supabase.storage.from(RECEIPT_BUCKET).upload(storage_path, file, { upsert: false });
  if (upErr) return { data: null, error: upErr };
  const { data, error } = await supabase
    .from('ledger_transaction_attachments')
    .insert({
      tenant_id: tenantId,
      ledger_transaction_id: txnId,
      storage_path,
      file_name: file.name || null,
      mime_type: file.type || null,
      size_bytes: file.size ?? null,
      uploaded_by,
    })
    .select(ATTACHMENT_SELECT)
    .single();
  return { data, error };
};

// Attachments for one (or many) ledger rows, each with a short-lived signed URL.
export const listAttachments = async (txnIds) => {
  const ids = Array.isArray(txnIds) ? txnIds : [txnIds];
  if (!ids.length) return { data: [], error: null };
  const { data, error } = await supabase
    .from('ledger_transaction_attachments')
    .select(ATTACHMENT_SELECT)
    .in('ledger_transaction_id', ids)
    .order('created_at', { ascending: true });
  if (error) return { data: null, error };
  const withUrls = await Promise.all((data || []).map(async (a) => {
    const { data: signed } = await supabase.storage.from(RECEIPT_BUCKET).createSignedUrl(a.storage_path, 3600);
    return { ...a, url: signed?.signedUrl || null };
  }));
  return { data: withUrls, error: null };
};

export const deleteAttachment = async (id, storagePath) => {
  if (storagePath) await supabase.storage.from(RECEIPT_BUCKET).remove([storagePath]);
  const { error } = await supabase.from('ledger_transaction_attachments').delete().eq('id', id);
  return { error };
};
