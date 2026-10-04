import React, { useEffect, useRef, useState } from 'react';
import Icon from '../../../components/AppIcon';
import { showToast } from '../../../utils/toast';
import { publicOrigin } from '../../../lib/native/platform';
import { fetchKioskDeviceIds, setKioskDevice } from '../../../services/presenceLog';
import './device-setup.css';

// Command-only: pick which account the wall-mounted entry-door iPad is signed in
// as. A device account may sign ANY crew / guest / visitor in or out, so the
// shared board works without logging in as each person.
export default function DeviceSetupModal({ tenantId, crew = [], onClose }) {
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

  const toggle = async (userId, on) => {
    setBusy(userId);
    try {
      await setKioskDevice(userId, on);
      setDeviceIds((ids) => (on ? [...new Set([...ids, userId])] : ids.filter((x) => x !== userId)));
      showToast(on ? 'Marked as door device' : 'Removed door device', 'success');
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

        <p className="dsu-intro">
          Choose the account the entry-door iPad is signed in as. A <b>door device</b> can sign
          anyone in or out, so crew just tap their own name — no personal login needed. Use a
          dedicated account (e.g. an invited “Gangway iPad” crew member).
        </p>

        <div className="dsu-url">
          <span className="dsu-url-l">Open this on the iPad</span>
          <div className="dsu-url-row">
            <input ref={inputRef} className="dsu-url-in" value={standbyUrl} readOnly onFocus={(e) => e.target.select()} />
            <button type="button" className="dsu-copy" onClick={copyUrl}>{copied ? 'Copied' : 'Copy'}</button>
          </div>
          <span className="dsu-url-tip">Add to Home Screen, then lock it with iOS Guided Access.</span>
        </div>

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
  );
}
