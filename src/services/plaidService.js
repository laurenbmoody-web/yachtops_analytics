// Cargo Accounts — client for the Plaid bank feed. The `plaid` edge function keeps
// the client_id/secret and access_token server-side; the browser only opens Plaid
// Link and passes back the short-lived public_token. { data, error } like the rest.

import { supabase } from '../lib/supabaseClient';

async function invoke(action, body = {}) {
  const { data, error } = await supabase.functions.invoke('plaid', { body: { action, ...body } });
  if (error) {
    let msg = error.message || 'Request failed';
    try { const j = await error.context?.json?.(); if (j?.error) msg = j.error; } catch { /* ignore */ }
    return { data: null, error: new Error(msg) };
  }
  if (data?.error) return { data: null, error: new Error(data.error) };
  return { data, error: null };
}

export const pingPlaid = () => invoke('ping');
export const createLinkToken = ({ tenantId, userId, countryCodes } = {}) =>
  invoke('link_token', { tenantId, userId, countryCodes });
export const exchangePublicToken = ({ publicToken, tenantId, institution }) =>
  invoke('exchange', { publicToken, tenantId, institution });
export const syncConnection = (connectionId) => invoke('sync', { connectionId });

// ── Plaid Link (client widget) ───────────────────────────────────────────────
const PLAID_SRC = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
let scriptPromise = null;

function loadPlaid() {
  if (typeof window !== 'undefined' && window.Plaid) return Promise.resolve(window.Plaid);
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = PLAID_SRC; s.async = true;
      s.onload = () => resolve(window.Plaid);
      s.onerror = () => reject(new Error('Could not load Plaid Link — check your connection.'));
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}

// Opens the Plaid Link modal. onSuccess(public_token, metadata); onExit(err, metadata).
export async function openPlaidLink({ token, onSuccess, onExit }) {
  const Plaid = await loadPlaid();
  const handler = Plaid.create({
    token,
    onSuccess: (publicToken, metadata) => onSuccess && onSuccess(publicToken, metadata),
    onExit: (err, metadata) => onExit && onExit(err, metadata),
  });
  handler.open();
}
