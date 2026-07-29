// Cargo Accounts — live bank feed edge function (Enable Banking / Open Banking).
//
// The provider access is authorised by a short-lived JWT signed server-side with
// the app's RSA private key — the browser never sees a token or bank credential.
// Actions:
//   ping      — validate credentials (lists sandbox banks; no DB, no user)
//   list_banks{country}                 — banks (ASPSPs) for a country
//   connect  {tenantId,country,aspsp,psuType} — start consent, return the bank URL
//   finalize {code,state}               — exchange the consent, store accounts
//   sync     {connectionId}             — pull transactions into the ledger (deduped)
//
// DB writes go through the CALLER's auth header so RLS applies (bank_connections
// writes are COMMAND-only; ledger inserts require tenant membership).
//
// Secrets (Supabase → Edge Functions → Secrets):
//   ENABLEBANKING_APP_ID, ENABLEBANKING_PRIVATE_KEY   (required)
//   ACCOUNTS_REDIRECT_URL                             (optional; defaults below)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EB_BASE = 'https://api.enablebanking.com';
const APP_ID = Deno.env.get('ENABLEBANKING_APP_ID') || '';
const PRIVATE_KEY = Deno.env.get('ENABLEBANKING_PRIVATE_KEY') || '';
const REDIRECT_URL = Deno.env.get('ACCOUNTS_REDIRECT_URL')
  || 'https://cargotechnology.netlify.app/accounts/connect/callback';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// ── JWT (RS256) signed with the app private key ──────────────────────────────
function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const b64urlStr = (s: string) => b64url(new TextEncoder().encode(s));

function pemToDer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----BEGIN [^-]+-----/, '').replace(/-----END [^-]+-----/, '').replace(/\s+/g, '');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

let keyPromise: Promise<CryptoKey> | null = null;
const getKey = () => (keyPromise ||= crypto.subtle.importKey(
  'pkcs8', pemToDer(PRIVATE_KEY), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'],
));

async function signJwt(): Promise<string> {
  const header = { typ: 'JWT', alg: 'RS256', kid: APP_ID };
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat: now, exp: now + 3600 };
  const input = `${b64urlStr(JSON.stringify(header))}.${b64urlStr(JSON.stringify(payload))}`;
  const sig = await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, await getKey(), new TextEncoder().encode(input));
  return `${input}.${b64url(new Uint8Array(sig))}`;
}

async function eb(path: string, init: { method?: string; body?: unknown } = {}): Promise<any> {
  const token = await signJwt();
  const res = await fetch(`${EB_BASE}${path}`, {
    method: init.method || 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  let data: any; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error(`EnableBanking ${res.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  return data;
}

// Supabase client bound to the caller's JWT so RLS applies to every DB op.
function callerClient(req: Request) {
  return createClient(
    Deno.env.get('SUPABASE_URL') || '',
    Deno.env.get('SUPABASE_ANON_KEY') || '',
    { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } },
  );
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    if (!APP_ID || !PRIVATE_KEY) return json({ error: 'Enable Banking secrets not set' }, 500);
    const { action, ...p } = await req.json().catch(() => ({}));

    // ── ping: prove the credentials work (no DB) ─────────────────────────────
    if (action === 'ping') {
      const data = await eb('/aspsps');
      return json({ ok: true, banks: (data.aspsps || []).length });
    }

    // ── list_banks (country optional — omit to list every ASPSP) ─────────────
    if (action === 'list_banks') {
      const c = (p.country || '').trim();
      const data = await eb(c && c !== 'ALL' ? `/aspsps?country=${encodeURIComponent(c)}` : '/aspsps');
      const aspsps = (data.aspsps || []).map((a: any) => ({
        name: a.name, country: a.country, logo: a.logo || null, psu_types: a.psu_types || [],
      }));
      return json({ aspsps });
    }

    const supa = callerClient(req);

    // ── connect: create a pending connection + return the bank consent URL ─────
    if (action === 'connect') {
      const { tenantId, country = 'GB', aspsp, psuType = 'personal' } = p;
      if (!tenantId || !aspsp) return json({ error: 'tenantId and aspsp required' }, 400);
      const { data: conn, error } = await supa.from('bank_connections')
        .insert({ tenant_id: tenantId, provider: 'enablebanking', institution_name: aspsp, status: 'pending' })
        .select('id').single();
      if (error) return json({ error: error.message }, 403);
      const validUntil = new Date(Date.now() + 89 * 864e5).toISOString();
      const auth = await eb('/auth', { method: 'POST', body: {
        access: { valid_until: validUntil },
        aspsp: { name: aspsp, country },
        state: conn.id,
        redirect_url: REDIRECT_URL,
        psu_type: psuType,
      } });
      await supa.from('bank_connections').update({ requisition_id: auth.authorization_id ?? null }).eq('id', conn.id);
      return json({ url: auth.url, connectionId: conn.id });
    }

    // ── finalize: exchange the consent code, store the exposed accounts ────────
    if (action === 'finalize') {
      const { code, state } = p;
      if (!code || !state) return json({ error: 'code and state required' }, 400);
      const session = await eb('/sessions', { method: 'POST', body: { code } });
      const { data: conn } = await supa.from('bank_connections').select('id, tenant_id').eq('id', state).single();
      if (!conn) return json({ error: 'connection not found' }, 404);
      const rows: any[] = [];
      for (const a of (session.accounts || [])) {
        const uid = typeof a === 'string' ? a : a.uid;
        let name = typeof a === 'object' ? (a.name || a.account_id?.iban) : null;
        let iban = typeof a === 'object' ? a.account_id?.iban : null;
        let currency = typeof a === 'object' ? a.currency : null;
        if (!name || !currency) {
          try { const d = await eb(`/accounts/${uid}/details`); name = name || d.name || d.account_id?.iban; iban = iban || d.account_id?.iban; currency = currency || d.currency; } catch { /* keep what we have */ }
        }
        rows.push({ tenant_id: conn.tenant_id, connection_id: conn.id, external_account_id: uid,
          display_name: name || 'Account', iban_last4: iban ? String(iban).slice(-4) : null, currency: currency || null });
      }
      if (rows.length) await supa.from('bank_connection_accounts').upsert(rows, { onConflict: 'connection_id,external_account_id' });
      await supa.from('bank_connections').update({ status: 'linked', requisition_id: session.session_id ?? null }).eq('id', conn.id);
      const { data: linked } = await supa.from('bank_connection_accounts')
        .select('id, external_account_id, display_name, iban_last4, currency, account_id').eq('connection_id', conn.id);
      return json({ accounts: linked || [] });
    }

    // ── sync: pull transactions for every mapped account (deduped) ─────────────
    if (action === 'sync') {
      const { connectionId } = p;
      if (!connectionId) return json({ error: 'connectionId required' }, 400);
      const { data: cas } = await supa.from('bank_connection_accounts')
        .select('id, tenant_id, external_account_id, account_id, currency, last_synced_at')
        .eq('connection_id', connectionId).not('account_id', 'is', null);
      let posted = 0;
      for (const ca of (cas || [])) {
        const from = (ca.last_synced_at ? new Date(ca.last_synced_at) : new Date(Date.now() - 90 * 864e5)).toISOString().slice(0, 10);
        let data: any;
        try { data = await eb(`/accounts/${ca.external_account_id}/transactions?date_from=${from}`); }
        catch (e) { await supa.from('bank_connections').update({ status: 'expired', error_detail: String(e).slice(0, 300) }).eq('id', connectionId); continue; }
        const { data: existing } = await supa.from('ledger_transactions')
          .select('external_txn_id').eq('account_id', ca.account_id).eq('source', 'bank_feed');
        const seen = new Set((existing || []).map((r: any) => r.external_txn_id));
        const inserts: any[] = [];
        for (const t of (data.transactions || [])) {
          const amt = Math.abs(parseFloat(t.transaction_amount?.amount ?? '0')) || 0;
          const signed = (t.credit_debit_indicator === 'DBIT' ? -1 : 1) * amt;
          // Two dates: when the spend happened (accounting date) vs when the bank
          // booked it to the statement (reconciliation date). Prefer the real
          // transaction/value date for txn_date — booking_date can be days later.
          const date = (t.transaction_date || t.value_date || t.booking_date || '').slice(0, 10) || null;
          const stmtDate = (t.booking_date || t.value_date || t.transaction_date || '').slice(0, 10) || null;
          const desc = Array.isArray(t.remittance_information) ? t.remittance_information.join(' ')
            : (t.remittance_information || t.creditor?.name || t.debtor?.name || '');
          const payee = t.creditor?.name || t.debtor?.name || null;
          const ext = t.entry_reference || `${date}|${signed}|${String(desc).slice(0, 40)}`;
          if (seen.has(ext)) continue;
          seen.add(ext);
          const cur = t.transaction_amount?.currency || ca.currency || 'EUR';
          inserts.push({ tenant_id: ca.tenant_id, account_id: ca.account_id, txn_date: date,
            statement_date: stmtDate, amount: signed,
            currency: cur, fx_rate: 1, amount_base: signed, source: 'bank_feed', status: 'unreconciled',
            external_txn_id: ext, description: desc || null, payee });
        }
        if (inserts.length) {
          const { error } = await supa.from('ledger_transactions').insert(inserts);
          if (!error) posted += inserts.length;
        }
        await supa.from('bank_connection_accounts').update({ last_synced_at: new Date().toISOString() }).eq('id', ca.id);
      }
      return json({ posted });
    }

    return json({ error: `unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ error: String(e && (e as Error).message || e) }, 500);
  }
});
