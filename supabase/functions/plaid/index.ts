// Cargo Accounts — Plaid bank-feed edge function (UK + EU Open Banking).
// Plaid Link handles bank selection + login in the browser; we never see credentials.
// The access_token is stored server-side only (bank_connection_secrets, service-role,
// RLS-denied to users). Tenant writes use the caller's JWT so RLS applies; the cron
// path (sync_all) uses the service role.
// Secrets: PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV (sandbox|production), CRON_SECRET.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CLIENT_ID = Deno.env.get('PLAID_CLIENT_ID') || '';
const SECRET = Deno.env.get('PLAID_SECRET') || '';
const ENV = (Deno.env.get('PLAID_ENV') || 'sandbox').toLowerCase();
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const HOST = ENV === 'production' ? 'https://production.plaid.com'
  : ENV === 'development' ? 'https://development.plaid.com'
  : 'https://sandbox.plaid.com';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

async function plaid(path, body) {
  const res = await fetch(HOST + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID, secret: SECRET, ...body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Plaid ${res.status}: ${data.error_code || ''} ${data.error_message || JSON.stringify(data)}`.trim());
  return data;
}

const callerClient = (req) => createClient(
  Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_ANON_KEY') || '',
  { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } });
const serviceClient = () => createClient(
  Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '');

const txnFields = (tx, acc) => {
  const signed = -Number(tx.amount || 0); // Plaid: +amount = outflow; our ledger: +amount = inflow
  const cur = tx.iso_currency_code || tx.unofficial_currency_code || acc.currency || 'GBP';
  return {
    tenant_id: acc.tenant_id, account_id: acc.account_id,
    // Two dates: `authorized_date` is when the card was actually used (the
    // accounting date, so month-end owns the cost in the right month); `date` is
    // when Plaid says the bank posted it (what we tie to a statement).
    txn_date: tx.authorized_date || tx.date || null,
    statement_date: tx.date || null,
    is_pending: Boolean(tx.pending),
    amount: signed, currency: cur, fx_rate: 1, amount_base: signed, source: 'bank_feed',
    status: 'unreconciled', external_txn_id: tx.transaction_id,
    description: tx.name || tx.merchant_name || null, payee: tx.merchant_name || tx.name || null,
  };
};

// Sync one connection. `data` handles tenant tables (caller JWT for users, service for
// cron); `svc` always handles the secrets table. Returns the number of new postings.
async function doSync(data, svc, connectionId) {
  const { data: secret } = await svc.from('bank_connection_secrets')
    .select('access_token, cursor').eq('connection_id', connectionId).single();
  if (!secret?.access_token) throw new Error('connection not found');
  const accessToken = secret.access_token;

  const { data: cas } = await data.from('bank_connection_accounts')
    .select('external_account_id, account_id, tenant_id, currency').eq('connection_id', connectionId);
  const map = {};
  (cas || []).forEach((c) => { if (c.account_id) map[c.external_account_id] = c; });
  const acctIds = [...new Set(Object.values(map).map((c) => c.account_id))];
  if (!acctIds.length) return 0;

  // Pull the transactions delta (cursor-paginated).
  let cursor = secret.cursor || undefined;
  const added = [], modified = [], removed = [];
  for (let guard = 0; guard < 40; guard++) {
    let r;
    try { r = await plaid('/transactions/sync', { access_token: accessToken, cursor }); }
    catch (e) {
      if (String(e).includes('PRODUCT_NOT_READY')) return 0; // Plaid still preparing; try later
      throw e;
    }
    added.push(...(r.added || []));
    modified.push(...(r.modified || []));
    removed.push(...(r.removed || []));
    cursor = r.next_cursor;
    if (!r.has_more) break;
  }

  // Existing postings for dedup.
  const seen = new Set();
  const { data: existing } = await data.from('ledger_transactions')
    .select('external_txn_id').in('account_id', acctIds).eq('source', 'bank_feed');
  (existing || []).forEach((r) => seen.add(r.external_txn_id));

  // Added → insert new only.
  const inserts = [];
  for (const tx of added) {
    const acc = map[tx.account_id]; if (!acc) continue;
    if (seen.has(tx.transaction_id)) continue;
    seen.add(tx.transaction_id);
    inserts.push(txnFields(tx, acc));
  }
  let posted = 0;
  if (inserts.length) {
    const { error } = await data.from('ledger_transactions').insert(inserts);
    if (!error) posted = inserts.length;
  }

  // Modified → update the matching posting in place.
  for (const tx of modified) {
    const acc = map[tx.account_id]; if (!acc) continue;
    const f = txnFields(tx, acc);
    await data.from('ledger_transactions')
      // A pending authorisation settling is the common "modified" case — it can move
      // the posted date and firm up the amount, so carry both dates + the flag over.
      .update({ amount: f.amount, amount_base: f.amount_base, txn_date: f.txn_date,
        statement_date: f.statement_date, is_pending: f.is_pending,
        currency: f.currency, description: f.description, payee: f.payee })
      .eq('account_id', acc.account_id).eq('external_txn_id', tx.transaction_id).eq('source', 'bank_feed');
  }

  // Removed → delete the posting (the bank reversed/removed it).
  const removedIds = removed.map((r) => r.transaction_id).filter(Boolean);
  if (removedIds.length) {
    await data.from('ledger_transactions').delete()
      .in('account_id', acctIds).eq('source', 'bank_feed').in('external_txn_id', removedIds);
  }

  // Reset opening_balance so displayed balance = the bank's current balance.
  try {
    const acc = await plaid('/accounts/get', { access_token: accessToken });
    const cur = {};
    (acc.accounts || []).forEach((a) => { cur[a.account_id] = a.balances?.current; });
    for (const [ext, c] of Object.entries(map)) {
      const current = cur[ext];
      if (current == null) continue;
      const { data: rows } = await data.from('ledger_transactions')
        .select('amount').eq('account_id', c.account_id).neq('status', 'void');
      const sum = (rows || []).reduce((s, r) => s + Number(r.amount || 0), 0);
      await data.from('financial_accounts').update({ opening_balance: Number(current) - sum }).eq('id', c.account_id);
    }
  } catch { /* balance is best-effort */ }

  await svc.from('bank_connection_secrets').update({ cursor }).eq('connection_id', connectionId);
  return posted;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    if (!CLIENT_ID || !SECRET) return json({ error: 'Plaid secrets not set' }, 500);
    const { action, ...p } = await req.json().catch(() => ({}));
    const svc = serviceClient();

    // ── cron: sync every linked connection (service role, shared-secret gated) ──
    if (action === 'sync_all') {
      if (!CRON_SECRET || req.headers.get('x-cron-secret') !== CRON_SECRET) return json({ error: 'unauthorized' }, 401);
      const { data: conns } = await svc.from('bank_connections').select('id').eq('provider', 'plaid').eq('status', 'linked');
      let posted = 0;
      for (const c of (conns || [])) { try { posted += await doSync(svc, svc, c.id); } catch { /* keep going */ } }
      return json({ synced: (conns || []).length, posted });
    }

    if (action === 'ping') {
      const data = await plaid('/institutions/get', { count: 1, offset: 0, country_codes: p.countryCodes || ['GB'] });
      return json({ ok: true, env: ENV, institutions: data.total ?? (data.institutions || []).length });
    }

    if (action === 'link_token') {
      const data = await plaid('/link/token/create', {
        user: { client_user_id: String(p.userId || p.tenantId || 'cargo') },
        client_name: 'Cargo', products: ['transactions'],
        country_codes: p.countryCodes || ['GB'], language: 'en',
      });
      return json({ link_token: data.link_token, expiration: data.expiration });
    }

    const supa = callerClient(req);

    if (action === 'exchange') {
      const { publicToken, tenantId, institution } = p;
      if (!publicToken || !tenantId) return json({ error: 'publicToken and tenantId required' }, 400);
      const ex = await plaid('/item/public_token/exchange', { public_token: publicToken });

      const { data: conn, error: cErr } = await supa.from('bank_connections')
        .insert({ tenant_id: tenantId, provider: 'plaid', institution_name: institution || 'Bank', status: 'linked' })
        .select('id').single();
      if (cErr) return json({ error: cErr.message }, 403);

      await svc.from('bank_connection_secrets')
        .insert({ connection_id: conn.id, provider: 'plaid', access_token: ex.access_token, item_id: ex.item_id });

      const acc = await plaid('/accounts/get', { access_token: ex.access_token });
      const { data: authData } = await supa.auth.getUser();
      const createdBy = authData?.user?.id || null;
      let created = 0;
      for (const a of (acc.accounts || [])) {
        const currency = a.balances?.iso_currency_code || a.balances?.unofficial_currency_code || 'GBP';
        const opening = a.balances?.current != null ? Number(a.balances.current) : 0; // pre-sync starting point
        const { data: fa } = await supa.from('financial_accounts')
          .insert({ tenant_id: tenantId, name: a.name || a.official_name || 'Account', kind: 'bank',
            currency, provider: 'Plaid', card_last4: a.mask || null, opening_balance: opening, created_by: createdBy })
          .select('id').single();
        if (fa) {
          await supa.from('bank_connection_accounts').insert({
            tenant_id: tenantId, connection_id: conn.id, external_account_id: a.account_id,
            account_id: fa.id, display_name: a.name || 'Account', iban_last4: a.mask || null, currency });
          created += 1;
        }
      }
      return json({ connectionId: conn.id, accounts: created });
    }

    if (action === 'sync') {
      const { connectionId } = p;
      if (!connectionId) return json({ error: 'connectionId required' }, 400);
      try { const posted = await doSync(supa, svc, connectionId); return json({ posted }); }
      catch (e) {
        await svc.from('bank_connections').update({ status: 'error', error_detail: String(e).slice(0, 300) }).eq('id', connectionId);
        return json({ error: String(e) }, 500);
      }
    }

    return json({ error: `unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ error: String(e && (e as Error).message || e) }, 500);
  }
});
