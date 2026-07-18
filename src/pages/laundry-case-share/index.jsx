import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { fetchCaseShare } from '../laundry-management-dashboard/utils/laundryCaseShare';
import './caseShare.css';

// Public, no-login page a guest opens from a case QR / link. Gated: they must
// enter the surname the crew set when sharing. All data comes from the
// fetch_laundry_case_share RPC — nothing is exposed without token + surname.

const CARE_LABELS = { DryClean: 'Dry clean', HandWash: 'Hand wash', Iron: 'Iron', StainTreat: 'Stain treat', Delicate: 'Delicate', Express: 'Express' };
const careLabel = (t) => CARE_LABELS[t] || t;
const STATUS_LABEL = { InProgress: 'In laundry', ReadyToDeliver: 'Ready', Delivered: 'Delivered' };
const statusLabel = (s) => STATUS_LABEL[s] || s;
const statusClass = (s) => (s === 'Delivered' ? 'done' : s === 'ReadyToDeliver' ? 'ready' : 'prog');

const REASONS = {
  secret: 'That surname doesn’t match this link. Check the spelling and try again.',
  not_found: 'This link isn’t valid. Ask the crew for a new one.',
  expired: 'This link has expired. Ask the crew for a new one.',
  revoked: 'This link has been turned off. Ask the crew for a new one.',
  error: 'Something went wrong. Please try again in a moment.',
};

const CaseShare = () => {
  const { token } = useParams();
  const [secret, setSecret] = useState('');
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!secret.trim() || busy) return;
    setBusy(true); setReason('');
    const res = await fetchCaseShare(token, secret.trim());
    setBusy(false);
    if (res?.ok) setData(res);
    else setReason(REASONS[res?.reason] || REASONS.error);
  };

  return (
    <div className="csh-page">
      <div className="csh-card">
        <div className="csh-brand">CARGO</div>

        {!data ? (
          <form className="csh-gate" onSubmit={submit}>
            <span className="csh-eyebrow">Laundry</span>
            <h1 className="csh-title">Your case</h1>
            <p className="csh-lede">Enter your surname to see what’s in this case and where it is.</p>
            <label className="csh-label" htmlFor="csh-secret">Surname</label>
            <input id="csh-secret" className="csh-input" autoFocus autoComplete="family-name"
              value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="e.g. Moody" />
            {reason && <div className="csh-err">{reason}</div>}
            <button type="submit" className="csh-btn" disabled={busy || !secret.trim()}>{busy ? 'Checking…' : 'View my case'}</button>
          </form>
        ) : (
          <div className="csh-contents">
            <span className="csh-eyebrow">Laundry case</span>
            <h1 className="csh-title">{data.case?.name || 'Your case'}</h1>
            <div className="csh-meta">
              <span className={`csh-status ${statusClass(data.case?.status)}`}>{statusLabel(data.case?.status)}</span>
              {data.case?.destination && <span>Bound for <b>{data.case.destination}</b></span>}
              <span><b>{(data.items || []).length}</b> item{(data.items || []).length === 1 ? '' : 's'}</span>
            </div>

            {(data.items || []).length === 0 ? (
              <div className="csh-empty">Nothing in this case yet.</div>
            ) : (
              <ul className="csh-list">
                {data.items.map((it, i) => (
                  <li className="csh-item" key={i}>
                    <div className="csh-item-main">
                      <span className="csh-item-nm">{it.description || 'Item'}{it.colour ? ` · ${it.colour}` : ''}</span>
                      {Array.isArray(it.tags) && it.tags.length > 0 && (
                        <span className="csh-tags">{it.tags.map((t, j) => <span className="csh-tag" key={j}>{careLabel(t)}</span>)}</span>
                      )}
                    </div>
                    <span className={`csh-status ${statusClass(it.status)}`}>{statusLabel(it.status)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="csh-foot">Shown to you by the interior team · Cargo</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default CaseShare;
