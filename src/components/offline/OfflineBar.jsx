// Network pill — bottom centre, only when something is off: offline / slow
// link (with how old the shown data is), offline changes waiting to sync, and
// a short "Back online" when the link returns. Driven by lib/offline/status.js.

import React, { useEffect, useState } from 'react';
import { getNetworkStatus, subscribeNetworkStatus } from '../../lib/offline/status';
import './offline-bar.css';

const pad = (n) => String(n).padStart(2, '0');

// 14:32 today, otherwise 03/10/2026 14:32 (house date format).
function savedAt(ms) {
  if (!ms) return null;
  const d = new Date(ms);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay ? time : `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${time}`;
}

const BACK_ONLINE_MS = 3500;

const OfflineBar = () => {
  const [status, setStatus] = useState(getNetworkStatus());
  const [, tick] = useState(0);

  useEffect(() => subscribeNetworkStatus(setStatus), []);

  // Hide "Back online" after a moment.
  useEffect(() => {
    if (!status.reconnectedAt) return undefined;
    const t = setTimeout(() => tick((n) => n + 1), BACK_ONLINE_MS + 50);
    return () => clearTimeout(t);
  }, [status.reconnectedAt]);

  const { mode, dataAt, reconnectedAt, pending } = status;
  const changes = `${pending} change${pending === 1 ? '' : 's'}`;
  let label = null;
  let detail = null;
  let tone = 'off';

  if (mode === 'offline') {
    label = 'Offline';
    if (pending) detail = `${changes} saved on this device · will sync when back online`;
    else if (dataAt) detail = `showing data saved ${savedAt(dataAt)}`;
    else detail = 'showing saved data where available';
  } else if (mode === 'slow') {
    label = 'Slow connection';
    if (pending) detail = `syncing ${changes}`;
    else if (dataAt) detail = `showing data saved ${savedAt(dataAt)}`;
  } else if (pending) {
    label = 'Syncing';
    detail = `${changes} made offline`;
  } else if (reconnectedAt && Date.now() - reconnectedAt < BACK_ONLINE_MS) {
    label = 'Back online';
    tone = 'on';
  }

  if (!label) return null;
  return (
    <div className={`ob-pill ob-${tone}`} role="status" aria-live="polite">
      <span className="ob-dot" aria-hidden="true" />
      <span className="ob-label">{label}</span>
      {detail && <><span className="ob-bar" aria-hidden="true" /><span className="ob-detail">{detail}</span></>}
    </div>
  );
};

export default OfflineBar;
