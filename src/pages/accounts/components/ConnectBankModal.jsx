// Cargo Accounts — Connect a bank via Plaid. The button opens Plaid Link (the
// bank's own secure login runs inside Plaid's widget — we never see credentials),
// then we exchange the public token, create the accounts and pull the first batch
// of transactions into the ledger.
import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import Icon from '../../../components/AppIcon';
import { useTenant } from '../../../contexts/TenantContext';
import { useAuth } from '../../../contexts/AuthContext';
import { createLinkToken, exchangePublicToken, syncConnection, openPlaidLink } from '../../../services/plaidService';
import './connect-bank.css';

export default function ConnectBankModal({ open, onClose }) {
  const navigate = useNavigate();
  const { activeTenantId } = useTenant();
  const { user } = useAuth();
  const [phase, setPhase] = useState('intro'); // intro | working | done | error
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [accounts, setAccounts] = useState(0);
  const [posted, setPosted] = useState(0);

  if (!open) return null;

  const start = async () => {
    setError(''); setPhase('working'); setStatus('Opening Plaid…');
    const { data, error: e } = await createLinkToken({ tenantId: activeTenantId, userId: user?.id, countryCodes: ['GB'] });
    if (e || !data?.link_token) { setError(e?.message || 'Could not start Plaid.'); setPhase('error'); return; }
    try {
      await openPlaidLink({
        token: data.link_token,
        onSuccess: async (publicToken, metadata) => {
          setPhase('working'); setStatus('Linking your accounts…');
          const inst = metadata?.institution?.name;
          const { data: ex, error: xe } = await exchangePublicToken({ publicToken, tenantId: activeTenantId, institution: inst });
          if (xe || !ex?.connectionId) { setError(xe?.message || 'Could not link your accounts.'); setPhase('error'); return; }
          setAccounts(ex.accounts || 0);
          setStatus('Pulling your transactions…');
          const { data: sy, error: se } = await syncConnection(ex.connectionId);
          if (se) { setError(se.message); setPhase('error'); return; }
          setPosted(sy?.posted || 0);
          setPhase('done');
        },
        onExit: (err) => {
          if (err) { setError(err.display_message || err.error_message || 'Connection cancelled.'); setPhase('error'); }
          else setPhase('intro'); // closed without finishing
        },
      });
    } catch (e2) { setError(String(e2?.message || e2)); setPhase('error'); }
  };

  return createPortal(
    <div className="cb-overlay" onClick={onClose}>
      <div className="cb-panel" onClick={(e) => e.stopPropagation()}>
        <div className="cb-head">
          <div>
            <p className="cb-eyebrow">Accounts</p>
            <h2 className="cb-title">Connect a bank</h2>
          </div>
          <button type="button" className="cb-x" onClick={onClose} aria-label="Close"><Icon name="X" size={18} /></button>
        </div>

        {phase === 'intro' && (
          <>
            <p className="cb-lede">
              Connect your bank through <b>Plaid</b> and approve <b>read-only</b> access on your bank’s own secure page.
              Cargo never sees your login or card number — transactions flow straight into the ledger.
            </p>
            <button type="button" className="cb-load cb-full" onClick={start}>Choose your bank</button>
          </>
        )}

        {phase === 'working' && (
          <div className="cb-working"><span className="cb-spin" /> {status}</div>
        )}

        {phase === 'done' && (
          <>
            <div className="cb-done">
              <Icon name="CheckCircle" size={40} />
              <p className="cb-donet">Connected</p>
              <p className="cb-donesub">{accounts} {accounts === 1 ? 'account' : 'accounts'} linked · {posted} {posted === 1 ? 'transaction' : 'transactions'} pulled in. New spend keeps flowing on each sync.</p>
            </div>
            <button type="button" className="cb-load cb-full" onClick={() => { onClose(); navigate('/accounts/ledger'); }}>See spending</button>
          </>
        )}

        {phase === 'error' && (
          <>
            <div className="cb-error"><Icon name="AlertCircle" size={15} /> {error}</div>
            <button type="button" className="cb-load cb-full" style={{ marginTop: 12 }} onClick={() => setPhase('intro')}>Try again</button>
          </>
        )}

        <p className="cb-foot"><Icon name="ShieldCheck" size={13} /> Read-only · powered by Plaid · you can disconnect any time</p>
      </div>
    </div>,
    document.body,
  );
}
