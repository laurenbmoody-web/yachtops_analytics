// Cargo Accounts — return from the bank's consent screen
// (/accounts/connect/callback?code=…&state=…). Exchanges the one-time code, then
// lets Command map each exposed account to a holder account (or create it fresh)
// and pulls the first batch of transactions into the ledger.
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Icon from '../../../components/AppIcon';
import '../../../styles/editorial.css';
import { useTenant } from '../../../contexts/TenantContext';
import { getAccountsOverview, createAccount } from '../../../services/financeService';
import { finalizeConnection, syncConnection, mapConnectionAccount } from '../../../services/bankFeedService';
import { formatMoney } from '../../../services/financeCalc';
import AccountsShell from '../components/AccountsShell';
import '../accounts.css';

const NEW = '__new__';

export default function ConnectCallback() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { activeTenantId } = useTenant();
  const code = params.get('code') || '';
  const state = params.get('state') || '';
  const providerError = params.get('error') || '';

  const [phase, setPhase] = useState('finalizing'); // finalizing | map | syncing | done | error
  const [error, setError] = useState('');
  const [accounts, setAccounts] = useState([]);      // exposed bank accounts
  const [existing, setExisting] = useState([]);      // our financial_accounts
  const [map, setMap] = useState({});                // connAccountId → NEW | accountId
  const [posted, setPosted] = useState(0);

  const finalize = useCallback(async () => {
    if (providerError) { setError(`The bank returned: ${providerError}`); setPhase('error'); return; }
    if (!code || !state) { setError('Missing consent details in the return URL.'); setPhase('error'); return; }
    const [{ data, error: e }, ov] = await Promise.all([
      finalizeConnection({ code, state }),
      getAccountsOverview(activeTenantId),
    ]);
    if (e) { setError(e.message); setPhase('error'); return; }
    const accs = data?.accounts || [];
    setAccounts(accs);
    setExisting((ov.data?.accounts || []).filter((a) => a.is_active !== false));
    setMap(Object.fromEntries(accs.map((a) => [a.id, a.account_id || NEW])));
    setPhase('map');
  }, [code, state, providerError, activeTenantId]);

  useEffect(() => { finalize(); }, [finalize]);

  const finish = async () => {
    setPhase('syncing'); setError('');
    for (const a of accounts) {
      let accountId = map[a.id];
      if (accountId === NEW) {
        const { data: created, error: e } = await createAccount({
          tenant_id: activeTenantId, name: a.display_name || 'Bank account', kind: 'bank',
          currency: a.currency || 'EUR', provider: 'Open Banking', card_last4: a.iban_last4 || null,
        });
        if (e || !created) { setError(`Could not create account: ${e?.message || 'unknown'}`); setPhase('error'); return; }
        accountId = created.id;
      }
      await mapConnectionAccount(a.id, accountId);
    }
    const { data, error: e } = await syncConnection(state);
    if (e) { setError(e.message); setPhase('error'); return; }
    setPosted(data?.posted || 0);
    setPhase('done');
  };

  return (
    <AccountsShell active="cards">
      <div className="ca-page">
        <div className="ca-wrap" style={{ maxWidth: 720 }}>
          <div className="ca-head">
            <p className="editorial-meta">
              <span className="dot">●</span><span>Connect a bank</span>
              <span className="bar" /><span className="muted">Open Banking</span>
            </p>
            <div className="ca-titlerow"><h1 className="ca-title">Linking <em>your bank</em>.</h1></div>
          </div>

          {phase === 'finalizing' && <div className="ca-empty"><p>Confirming with your bank…</p></div>}

          {phase === 'error' && (
            <div className="ca-empty">
              <Icon name="AlertCircle" size={40} />
              <p>Couldn’t finish connecting</p>
              <p className="ca-empty-sub">{error}</p>
              <button type="button" className="ca-btn ca-btn-primary" style={{ marginTop: 14 }} onClick={() => navigate('/accounts/cards')}>Back to Cards &amp; cash</button>
            </div>
          )}

          {phase === 'map' && (
            <div style={{ marginTop: 12 }}>
              <p style={{ fontSize: 13.5, color: '#4B4A66', marginBottom: 14 }}>
                Your bank shared {accounts.length} {accounts.length === 1 ? 'account' : 'accounts'}. Choose where each one lands — a new account, or link it to one you already track.
              </p>
              {accounts.map((a) => (
                <div key={a.id} className="cb-maprow" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 4px', borderBottom: '1px solid #F0F1F5' }}>
                  <span className="ca-aico bank"><Icon name="Landmark" size={17} /></span>
                  <span style={{ flex: 1 }}>
                    <span style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>{a.display_name}{a.iban_last4 ? ` ····${a.iban_last4}` : ''}</span>
                    <span style={{ fontSize: 12, color: '#8B8478' }}>{a.currency || ''}</span>
                  </span>
                  <select className="ca-field" value={map[a.id]} onChange={(e) => setMap((m) => ({ ...m, [a.id]: e.target.value }))} style={{ minWidth: 220 }}>
                    <option value={NEW}>＋ Create as a new account</option>
                    {existing.map((ex) => <option key={ex.id} value={ex.id}>Link to: {ex.name}</option>)}
                  </select>
                </div>
              ))}
              <button type="button" className="ca-btn ca-btn-primary" style={{ marginTop: 18 }} onClick={finish}>
                <Icon name="Check" size={16} /> Finish &amp; pull transactions
              </button>
            </div>
          )}

          {phase === 'syncing' && <div className="ca-empty"><p>Pulling your transactions…</p></div>}

          {phase === 'done' && (
            <div className="ca-empty">
              <Icon name="CheckCircle" size={44} />
              <p>Connected</p>
              <p className="ca-empty-sub">{posted} {posted === 1 ? 'transaction' : 'transactions'} pulled into the ledger. New spend will keep flowing in on each sync.</p>
              <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                <button type="button" className="ca-btn ca-btn-primary" onClick={() => navigate('/accounts/ledger')}>See spending</button>
                <button type="button" className="ca-btn ca-btn-ghost" onClick={() => navigate('/accounts/cards')}>Cards &amp; cash</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </AccountsShell>
  );
}
