import React, { useEffect, useRef, useState } from 'react';
import './driver.css';

const DRV_LABELS = { assigned: 'Assigned', on_the_way: 'On the way', arrived: 'Arrived', delivered: 'Delivered' };
const DRV_FLOW = ['on_the_way', 'arrived', 'delivered'];
const SEND_EVERY_MS = 15000;

function fmtEta(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function fmtAgo(d) {
  if (!d) return null;
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  return `${Math.round(s / 60)}m ago`;
}

// Shared driver capture UI — used by both the logged-in teammate page and the
// tokenised temp-driver page. Parent supplies onPing (a location fix) and
// onStatus (advance the delivery status). Nothing here knows how those persist.
export default function DriverShare({ order, onPing, onStatus }) {
  const [sharing, setSharing] = useState(false);
  const [lastPos, setLastPos] = useState(null);
  const [lastSentAt, setLastSentAt] = useState(null);
  const [error, setError] = useState(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [, forceTick] = useState(0);
  const watchRef = useRef(null);
  const lastSentRef = useRef(0);

  const eta = fmtEta(order?.delivery_eta);
  const status = order?.driver_status || 'assigned';

  // Re-render the "sent Xs ago" line every 10s while sharing.
  useEffect(() => {
    if (!sharing) return undefined;
    const t = setInterval(() => forceTick((n) => n + 1), 10000);
    return () => clearInterval(t);
  }, [sharing]);

  useEffect(() => () => {
    if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
  }, []);

  const onPos = (pos) => {
    const c = {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: pos.coords.accuracy ?? null,
      heading: Number.isFinite(pos.coords.heading) ? pos.coords.heading : null,
      speed: Number.isFinite(pos.coords.speed) ? pos.coords.speed : null,
    };
    setLastPos(c);
    const now = Date.now();
    if (now - lastSentRef.current < SEND_EVERY_MS) return;
    lastSentRef.current = now;
    Promise.resolve(onPing(c)).then(() => { setLastSentAt(new Date()); setError(null); })
      .catch((e) => setError(e?.message || 'Couldn’t send your location.'));
  };

  const startShare = () => {
    if (!('geolocation' in navigator)) { setError('Location isn’t available on this device.'); return; }
    setError(null);
    setSharing(true);
    lastSentRef.current = 0;
    watchRef.current = navigator.geolocation.watchPosition(
      onPos,
      (e) => setError(e.code === 1 ? 'Location permission was blocked. Allow it in your browser to share.' : 'Couldn’t get a location fix.'),
      { enableHighAccuracy: true, maximumAge: 8000, timeout: 20000 },
    );
  };
  const stopShare = () => {
    if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
    watchRef.current = null;
    setSharing(false);
  };

  const setStatus = async (s) => {
    if (statusBusy || s === status) return;
    setStatusBusy(true);
    try { await onStatus(s, lastPos); setError(null); }
    catch (e) { setError(e?.message || 'Couldn’t update the status.'); }
    finally { setStatusBusy(false); }
  };

  return (
    <div className="drv-wrap">
      <div className="drv-card">
        <div className="drv-eyebrow">{order?.supplier_name || 'Delivery'}</div>
        <h1 className="drv-title">Delivering to <em>{order?.delivery_port || 'the vessel'}</em></h1>
        <div className="drv-sub">
          {order?.driver_name ? `Driver: ${order.driver_name}` : 'Driver'}
          {eta ? ` · ETA ${eta}` : ''}
        </div>

        <div className={`drv-share${sharing ? ' is-on' : ''}`}>
          {sharing ? (
            <>
              <div className="drv-pulse" aria-hidden="true"><span /></div>
              <div className="drv-share-body">
                <div className="drv-share-title">Sharing your location</div>
                <div className="drv-share-meta">
                  {lastSentAt ? `Sent ${fmtAgo(lastSentAt)}` : 'Getting a fix…'}
                  {lastPos?.accuracy ? ` · ±${Math.round(lastPos.accuracy)}m` : ''}
                </div>
              </div>
              <button type="button" className="drv-btn ghost" onClick={stopShare}>Stop</button>
            </>
          ) : (
            <>
              <div className="drv-share-body">
                <div className="drv-share-title">Share your location</div>
                <div className="drv-share-meta">The vessel can then watch you arrive. Keep this page open while driving.</div>
              </div>
              <button type="button" className="drv-btn" onClick={startShare}>Start</button>
            </>
          )}
        </div>

        <div className="drv-steps-label">Update the vessel</div>
        <div className="drv-steps">
          {DRV_FLOW.map((s) => (
            <button key={s} type="button"
              className={`drv-step${status === s ? ' is-on' : ''}`}
              disabled={statusBusy} onClick={() => setStatus(s)}>{DRV_LABELS[s]}</button>
          ))}
        </div>

        {error && <div className="drv-error">{error}</div>}

        <div className="drv-note">
          Your location is only shared with this vessel, only while this page is open.
        </div>
      </div>
    </div>
  );
}
