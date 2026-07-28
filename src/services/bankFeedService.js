// Cargo Accounts — client for the live bank feed (Enable Banking via the
// `bank-feed` edge function). The function signs the provider JWT server-side, so
// the browser only ever sees banks, a consent URL, and transactions. Every call
// returns { data, error } like the rest of the finance services.

import { supabase } from '../lib/supabaseClient';

async function invoke(action, body = {}) {
  const { data, error } = await supabase.functions.invoke('bank-feed', { body: { action, ...body } });
  if (error) {
    // Surface the function's JSON error body when present.
    let msg = error.message || 'Request failed';
    try { const j = await error.context?.json?.(); if (j?.error) msg = j.error; } catch { /* ignore */ }
    return { data: null, error: new Error(msg) };
  }
  if (data?.error) return { data: null, error: new Error(data.error) };
  return { data, error: null };
}

// Prove the app credentials work (no bank consent needed).
export const pingBankFeed = () => invoke('ping');

// Banks (ASPSPs) available for a country, e.g. 'GB', 'FR', 'ES'.
export const listBanks = (country) => invoke('list_banks', { country });

// Start a consent: returns { url } to send the user to their bank.
export const connectBank = ({ tenantId, country, aspsp, psuType }) =>
  invoke('connect', { tenantId, country, aspsp, psuType });

// After the bank redirects back: exchange the code, store the exposed accounts.
export const finalizeConnection = ({ code, state }) => invoke('finalize', { code, state });

// Pull new transactions for a connection's mapped accounts into the ledger.
export const syncConnection = (connectionId) => invoke('sync', { connectionId });

// ── plain table reads/writes (RLS-scoped) ────────────────────────────────────
export async function listConnections(tenantId) {
  return supabase.from('bank_connections')
    .select('id, provider, institution_name, status, error_detail, created_at')
    .eq('tenant_id', tenantId).order('created_at', { ascending: false });
}

export async function listConnectionAccounts(connectionId) {
  return supabase.from('bank_connection_accounts')
    .select('id, external_account_id, display_name, iban_last4, currency, account_id, last_synced_at')
    .eq('connection_id', connectionId);
}

// Map (or re-map) a connected external account to one of our financial_accounts.
export async function mapConnectionAccount(id, accountId) {
  return supabase.from('bank_connection_accounts').update({ account_id: accountId }).eq('id', id);
}
