import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import DriverShare from './DriverShare';
import { fetchOrderForDriverToken, postDriverPingToken } from './driverStorage';
import './driver.css';

// Public, no-login driver page reached by a capability link /drive/:token.
// Possession of the token is the authorisation (same model as delivery-note
// signing). Used by temp drivers, or an internal driver on their phone.
export default function DriverTokenPage() {
  const { token } = useParams();
  const [order, setOrder] = useState(null);
  const [state, setState] = useState('loading'); // loading | ready | not_found

  useEffect(() => {
    let alive = true;
    fetchOrderForDriverToken(token)
      .then((data) => {
        if (!alive) return;
        if (!data) { setState('not_found'); return; }
        setOrder(data);
        setState('ready');
      })
      .catch(() => { if (alive) setState('not_found'); });
    return () => { alive = false; };
  }, [token]);

  const onPing = (coords) => postDriverPingToken(token, coords);
  const onStatus = (status, lastPos) =>
    postDriverPingToken(token, lastPos || {}, status).then(() =>
      setOrder((o) => (o ? { ...o, driver_status: status } : o)));

  if (state === 'loading') {
    return <div className="drv-wrap"><div className="drv-card"><div className="drv-plain">Loading…</div></div></div>;
  }
  if (state === 'not_found') {
    return (
      <div className="drv-wrap">
        <div className="drv-card">
          <div className="drv-eyebrow">Delivery</div>
          <h1 className="drv-title">Link not found</h1>
          <div className="drv-sub">This driver link is invalid or has expired. Ask the supplier for a fresh one.</div>
        </div>
      </div>
    );
  }
  return <DriverShare order={order} onPing={onPing} onStatus={onStatus} />;
}
