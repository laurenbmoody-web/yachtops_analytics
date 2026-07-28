// Cargo Accounts — Connect a bank (Open Banking via Enable Banking). Pick a
// country + bank, then hand off to the bank's own consent screen. We never see
// the login or card number — the bank redirects back to /accounts/connect/callback
// with a one-time code the edge function exchanges server-side.
import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../../../components/AppIcon';
import { useTenant } from '../../../contexts/TenantContext';
import { listBanks, connectBank } from '../../../services/bankFeedService';
import './connect-bank.css';

const COUNTRIES = [
  ['GB', 'United Kingdom'], ['FR', 'France'], ['ES', 'Spain'], ['IT', 'Italy'],
  ['DE', 'Germany'], ['NL', 'Netherlands'], ['MC', 'Monaco'], ['MT', 'Malta'],
];

export default function ConnectBankModal({ open, onClose }) {
  const { activeTenantId } = useTenant();
  const [country, setCountry] = useState('GB');
  const [psuType, setPsuType] = useState('personal');
  const [banks, setBanks] = useState(null);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState('');
  const [error, setError] = useState('');

  if (!open) return null;

  const load = async () => {
    setLoading(true); setError(''); setBanks(null);
    const { data, error: e } = await listBanks(country);
    if (e) setError(e.message);
    else setBanks(data?.aspsps || []);
    setLoading(false);
  };

  const choose = async (aspsp) => {
    setConnecting(aspsp.name); setError('');
    const { data, error: e } = await connectBank({ tenantId: activeTenantId, country, aspsp: aspsp.name, psuType });
    if (e) { setError(e.message); setConnecting(''); return; }
    if (data?.url) window.location.href = data.url;  // hand off to the bank
    else { setError('No consent URL returned.'); setConnecting(''); }
  };

  const shown = (banks || []).filter((b) => !q || b.name.toLowerCase().includes(q.toLowerCase()));

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

        <p className="cb-lede">
          Pick your bank and approve <b>read-only</b> access on its own secure page. Cargo never sees your login or
          card number — transactions just start flowing into the ledger.
        </p>

        <div className="cb-controls">
          <label className="cb-field">
            <span>Country</span>
            <select value={country} onChange={(e) => { setCountry(e.target.value); setBanks(null); }}>
              {COUNTRIES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
            </select>
          </label>
          <label className="cb-field">
            <span>Account type</span>
            <select value={psuType} onChange={(e) => setPsuType(e.target.value)}>
              <option value="personal">Personal</option>
              <option value="business">Business</option>
            </select>
          </label>
          <button type="button" className="cb-load" onClick={load} disabled={loading}>
            {loading ? 'Loading…' : banks ? 'Reload banks' : 'Find banks'}
          </button>
        </div>

        {error && <div className="cb-error"><Icon name="AlertCircle" size={15} /> {error}</div>}

        {banks && (
          <>
            <div className="cb-search">
              <Icon name="Search" size={15} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search banks…" />
            </div>
            <div className="cb-list">
              {shown.length === 0 ? (
                <div className="cb-empty">No banks for {country}. Try another country.</div>
              ) : shown.map((b) => (
                <button key={b.name} type="button" className="cb-bank" disabled={!!connecting} onClick={() => choose(b)}>
                  {b.logo ? <img src={b.logo} alt="" className="cb-logo" /> : <span className="cb-logo cb-logo-ph"><Icon name="Landmark" size={16} /></span>}
                  <span className="cb-bname">{b.name}</span>
                  {connecting === b.name ? <span className="cb-going">Opening…</span> : <Icon name="ChevronRight" size={16} className="cb-chev" />}
                </button>
              ))}
            </div>
          </>
        )}

        <p className="cb-foot"><Icon name="ShieldCheck" size={13} /> Read-only · you can disconnect any time · consent renews every ~90 days</p>
      </div>
    </div>,
    document.body,
  );
}
