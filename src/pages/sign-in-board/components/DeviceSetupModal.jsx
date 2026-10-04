import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../../components/AppIcon';
import { showToast } from '../../../utils/toast';
import { publicOrigin } from '../../../lib/native/platform';
import { fetchKioskDeviceIds, setKioskDevice } from '../../../services/presenceLog';
import './device-setup.css';

// Command-only: pick which account the wall-mounted entry-door iPad is signed in
// as. A device account may sign ANY crew / guest / visitor in or out, so the
// shared board works without logging in as each person.
export default function DeviceSetupModal({ tenantId, crew = [], onClose }) {
  const navigate = useNavigate();
  const [deviceIds, setDeviceIds] = useState([]);
  const [busy, setBusy] = useState('');
  const [copied, setCopied] = useState(false);
  const inputRef = useRef(null);
  const standbyUrl = `${publicOrigin()}/sign-in-board?mode=standby`;

  useEffect(() => {
    let alive = true;
    fetchKioskDeviceIds(tenantId).then((ids) => { if (alive) setDeviceIds(ids); });
    return () => { alive = false; };
  }, [tenantId]);

  const current = useMemo(() => crew.filter((m) => deviceIds.includes(m.userId)), [crew, deviceIds]);

  const toggle = async (userId, on) => {
    setBusy(userId);
    try {
      await setKioskDevice(userId, on);
      setDeviceIds((ids) => (on ? [...new Set([...ids, userId])] : ids.filter((x) => x !== userId)));
      showToast(on ? 'Set as the door device' : 'Removed door device', 'success');
    } catch (e) { showToast(e?.message || 'Could not update', 'error'); }
    finally { setBusy(''); }
  };

  const copyUrl = async () => {
    try { await navigator.clipboard.writeText(standbyUrl); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    catch { inputRef.current?.select(); }
  };

  return (
    <div className="dsu-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dsu">
        <div className="dsu-head">
          <div>
            <p className="dsu-eyebrow">● Gangway device</p>
            <h3 className="dsu-title">Door iPad setup</h3>
          </div>
          <button type="button" className="dsu-x" onClick={onClose} aria-label="Close"><Icon name="X" size={18} /></button>
        </div>

        <div className="dsu-body">
          {/* Status */}
          <div className={`dsu-status${current.length ? ' on' : ''}`}>
            <Icon name={current.length ? 'CheckCircle2' : 'Tablet'} size={18} />
            <span>{current.length ? <>Door device: <b>{current.map((m) => m.name).join(', ')}</b></> : 'No door device set yet'}</span>
          </div>

          <p className="dsu-intro">
            Pick the account the entry-door iPad stays signed into. That account can sign
            <b> anyone</b> in or out, so crew just tap their own name — no personal login needed.
          </p>

          {/* Recommendation — don't use a personal account */}
          <div className="dsu-tip">
            <Icon name="Info" size={15} />
            <div>
              <b>Use a dedicated account</b>, not your own. The iPad is logged into this account
              24/7 in a public spot. Invite a “Gangway iPad” crew member first.
              <button type="button" className="dsu-link" onClick={() => { onClose(); navigate('/crew-management'); }}>Open Crew Management →</button>
            </div>
          </div>

          {/* URL */}
          <div className="dsu-url">
            <span className="dsu-url-l">Open this on the iPad</span>
            <div className="dsu-url-row">
              <input ref={inputRef} className="dsu-url-in" value={standbyUrl} readOnly onFocus={(e) => e.target.select()} />
              <button type="button" className="dsu-copy" onClick={copyUrl}>{copied ? 'Copied' : 'Copy'}</button>
            </div>
            <span className="dsu-url-tip">Add to Home Screen, then lock it with iOS Guided Access.</span>
          </div>

          {/* Pick the account */}
          <p className="dsu-list-l">Choose the device account</p>
          <div className="dsu-list">
            {crew.length === 0 ? (
              <p className="dsu-empty">No crew accounts found.</p>
            ) : crew.map((m) => {
              const on = deviceIds.includes(m.userId);
              return (
                <div key={m.userId} className={`dsu-row${on ? ' on' : ''}`}>
                  <span className="dsu-row-nm">
                    <span className="dsu-person">{m.name}</span>
                    {m.department && <span className="dsu-dept">{m.department}</span>}
                  </span>
                  <button
                    type="button"
                    className={`dsu-toggle${on ? ' on' : ''}`}
                    disabled={busy === m.userId}
                    onClick={() => toggle(m.userId, !on)}
                  >
                    {busy === m.userId ? '…' : on ? <><Icon name="Check" size={14} /> Device</> : 'Set as device'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
