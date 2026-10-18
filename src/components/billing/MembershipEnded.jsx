import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../navigation/Header';
import Icon from '../AppIcon';
import { useAuth } from '../../contexts/AuthContext';
import { exportVesselData } from '../../lib/vesselAccess';
import { isNative } from '../../lib/native/platform';
import '../../styles/editorial.css';
import './membership-ended.css';

// Shown in place of vessel pages once the vessel's plan has ended. Crew keep
// their own profile and settings; Command can resubscribe or export; the data
// is deleted 90 days after the plan ended.

const fmtDate = (d) => {
  if (!d) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
};

const MembershipEnded = ({ access }) => {
  const navigate = useNavigate();
  const { tenantRole, activeTenantId } = useAuth();
  const isCommand = (tenantRole || '').toUpperCase() === 'COMMAND';
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const doExport = async () => {
    if (busy) return;
    setBusy(true); setMsg('');
    try {
      await exportVesselData(activeTenantId);
      setMsg('Export downloaded. File links inside it work for 7 days.');
    } catch (e) {
      setMsg(e?.message || 'Export failed — please try again.');
    } finally {
      setBusy(false);
    }
  };

  const vessel = access?.vesselName || 'This vessel';
  const ended = fmtDate(access?.endedAt);
  const deleteOn = fmtDate(access?.deleteOn);

  return (
    <>
      <Header />
      <div className="mex-page">
        <p className="editorial-meta">
          <span className="dot">●</span>
          <span>{vessel}</span>
          {ended && <><span className="bar" /><span className="muted">Plan ended {ended}</span></>}
          {deleteOn && !access?.deleted && <><span className="bar" /><span className="muted">Data kept until {deleteOn}</span></>}
        </p>
        <h1 className="editorial-greeting">
          Membership<span className="period">,</span> <em>ended</em><span className="period">.</span>
        </h1>

        <div className="mex-card">
          {access?.deleted ? (
            <p className="mex-lede">
              {vessel}’s Cargo plan ended and its vessel records have been deleted. Your own profile, documents and
              sea-service records are still in your account.
            </p>
          ) : (
            <p className="mex-lede">
              {vessel}’s Cargo plan ended{ended ? ` on ${ended}` : ''}, so its pages are closed. Everything is kept
              until <b>{deleteOn || '90 days after the plan ended'}</b> — after that the vessel’s records and files are
              permanently deleted.
            </p>
          )}

          {isCommand && !access?.deleted ? (
            <>
              <div className="mex-caps">What you can do</div>
              <ul className="mex-list">
                <li><Icon name="RotateCcw" size={15} /> Resubscribe — everything comes back exactly as it was.</li>
                <li><Icon name="Download" size={15} /> Export the vessel’s data — one file with all its records and links to its files.</li>
              </ul>
              <div className="mex-actions">
                {!isNative() && (
                  <button type="button" className="mex-btn mex-btn-primary" onClick={() => navigate('/membership')}>
                    Resubscribe
                  </button>
                )}
                <button type="button" className="mex-btn mex-btn-ghost" onClick={doExport} disabled={busy}>
                  {busy ? 'Preparing export…' : 'Export vessel data'}
                </button>
              </div>
              {isNative() && <p className="mex-note">Plans are managed from Cargo on the web.</p>}
              {msg && <p className="mex-note">{msg}</p>}
            </>
          ) : (
            <>
              <div className="mex-caps">Your account</div>
              <p className="mex-body">
                Your Cargo account is yours — your profile, personal documents and sea-service records stay with you.
                {!access?.deleted && ' Ask your vessel admin if you think the plan should be renewed.'}
              </p>
              <div className="mex-actions">
                <button type="button" className="mex-btn mex-btn-primary" onClick={() => navigate('/my-profile')}>
                  Go to my profile
                </button>
                <button type="button" className="mex-btn mex-btn-ghost" onClick={() => navigate('/settings')}>
                  Settings
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
};

export default MembershipEnded;
