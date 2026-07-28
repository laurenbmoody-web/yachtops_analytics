// Cargo Accounts — Plaid bank-feed edge function (UK + EU Open Banking).
//
// Plaid uses its own Link widget for the bank-selection + login UX, so the browser
// never sends credentials to us. Flow: link_token (server) -> Link (browser) ->
// public_token -> exchange (server: store access_token, create accounts) -> sync
// (server: pull transactions into the ledger).
//
// The Plaid access_token is stored server-side only in bank_connection_secrets
// (service-role, RLS-denied to users). Tenant data writes use the caller's JWT so
// RLS applies. Secrets: PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV (sandbox|production).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CLIENT_ID = Deno.env.get('PLAID_CLIENT_ID') || '';
const SECRET = Deno.env.get('PLAID_SECRET') || '';
const ENV = (Deno.env.get('PLAID_ENV') || 'sandbox').toLowerCase();
const HOST = ENV === 'production' ? 'https://production.plaid.com'
  : ENV === 'development' ? 'https://development.plaid.com'
  : 'https://sandbox.plaid.com';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

async function plaid(path: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(HOST + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID, secret: SECRET, ...body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Plaid ${res.status}: ${data.error_code || ''} ${data.error_message || JSON.stringify(data)}`.trim());
  return data;
}

const callerClient = (req: Request) => createClient(
  Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_ANON_KEY') || '',
  { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } });
const serviceClient = () => createClient(
  Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    if (!CLIENT_ID || !SECRET) return json({ error: 'Plaid secrets not set' }, 500);
    const { action, ...p } = await req.json().catch(() => ({}));

    // ── ping: validate credentials ───────────────────────────────────────────
    if (action === 'ping') {
      const data = await plaid('/institutions/get', { count: 1, offset: 0, country_codes: p.countryCodes || ['GB'] });
      return json({ ok: true, env: ENV, institutions: data.total ?? (data.institutions || []).length });
    }

    // ── link_token: create the token that opens Plaid Link in the browser ──────
    if (action === 'link_token') {
      const data = await plaid('/link/token/create', {
        user: { client_user_id: String(p.userId || p.tenantId || 'cargo') },
        client_name: 'Cargo',
        products: ['transactions'],
        country_codes: p.countryCodes || ['GB'],
        language: 'en',
      });
      return json({ link_token: data.link_token, expiration: data.expiration });
    }

    const supa = callerClient(req);
    const svc = serviceClient();

    // ── exchange: public_token -> access_token, create accounts ────────────────
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
      const { data: auth } = await supa.auth.getUser();
      const createdBy = auth?.user?.id || null;
      let created = 0;
      for (const a of (acc.accounts || [])) {
        const currency = a.balances?.iso_currency_code || a.balances?.unofficial_currency_code || 'GBP';
        const { data: fa } = await supa.from('financial_accounts')
          .insert({ tenant_id: tenantId, name: a.name || a.official_name || 'Account', kind: 'bank',
            currency, provider: 'Plaid', card_last4: a.mask || null, created_by: createdBy })
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

    // ── sync: pull transactions into the ledger (deduped) ──────────────────────
    if (action === 'sync') {
      const { connectionId } = p;
      if (!connectionId) return json({ error: 'connectionId required' }, 400);
      const { data: secret } = await svc.from('bank_connection_secrets')
        .select('access_token, cursor').eq('connection_id', connectionId).single();
      if (!secret?.access_token) return json({ error: 'connection not found' }, 404);

      const { data: cas } = await supa.from('bank_connection_accounts')
        .select('external_account_id, account_id, tenant_id, currency').eq('connection_id', connectionId);
      const map: Record<string, any> = {};
      (cas || []).forEach((c: any) => { if (c.account_id) map[c.external_account_id] = c; });

      // transactions/sync is cursor-paginated per item.
      let cursor = secret.cursor || undefined;
      const added: any[] = [];
      for (let guard = 0; guard < 20; guard++) {
        let r: any;
        try { r = await plaid('/transactions/sync', { access_token: secret.access_token, cursor }); }
        catch (e) {
          const msg = String(e);
          if (msg.includes('PRODUCT_NOT_READY')) return json({ posted: 0, pending: true });
          await svc.from('bank_connections').update({ status: 'error', error_detail: msg.slice(0, 300) }).eq('id', connectionId);
          return json({ error: msg }, 500);
        }
        added.push(...(r.added || []));
        cursor = r.next_cursor;
        if (!r.has_more) break;
      }

      // Dedup against what we've already posted for these accounts.
      const acctIds = [...new Set(Object.values(map).map((c: any) => c.account_id))];
      const seen = new Set<string>();
      if (acctIds.length) {
        const { data: existing } = await supa.from('ledger_transactions')
          .select('external_txn_id').in('account_id', acctIds).eq('source', 'bank_feed');
        (existing || []).forEach((r: any) => seen.add(r.external_txn_id));
      }

      const inserts: any[] = [];
      for (const tx of added) {
        const acc = map[tx.account_id];
        if (!acc) continue;                       // account not mapped
        if (seen.has(tx.transaction_id)) continue;
        seen.add(tx.transaction_id);
        // Plaid: positive amount = money OUT of the account. Our ledger: positive = IN.
        const signed = -Number(tx.amount || 0);
        const cur = tx.iso_currency_code || tx.unofficial_currency_code || acc.currency || 'GBP';
        inserts.push({ tenant_id: acc.tenant_id, account_id: acc.account_id, txn_date: tx.date || null,
          amount: signed, currency: cur, fx_rate: 1, amount_base: signed, source: 'bank_feed',
          status: 'unreconciled', external_txn_id: tx.transaction_id,
          description: tx.name || tx.merchant_name || null, payee: tx.merchant_name || tx.name || null });
      }
      let posted = 0;
      if (inserts.length) {
        const { error } = await supa.from('ledger_transactions').insert(inserts);
        if (!error) posted = inserts.length;
        else return json({ error: error.message }, 500);
      }
      await svc.from('bank_connection_secrets').update({ cursor }).eq('connection_id', connectionId);
      return json({ posted });
    }

    return json({ error: `unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ error: String(e && (e as Error).message || e) }, 500);
  }
});
