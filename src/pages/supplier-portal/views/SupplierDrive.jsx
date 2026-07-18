import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import DriverShare from '../../driver/DriverShare';
import { postDriverPing } from '../../driver/driverStorage';
import { fetchOrderById, setDriverStatus } from '../utils/supplierStorage';

// Logged-in internal driver's page (/supplier/drive/:orderId). Inherits the
// supplier auth guard; RLS lets the assigned driver post pings + advance status.
export default function SupplierDrive() {
  const { orderId } = useParams();
  const [order, setOrder] = useState(null);
  const [state, setState] = useState('loading'); // loading | ready | not_found

  useEffect(() => {
    let alive = true;
    fetchOrderById(orderId)
      .then((o) => { if (!alive) return; if (!o) { setState('not_found'); return; } setOrder(o); setState('ready'); })
      .catch(() => { if (alive) setState('not_found'); });
    return () => { alive = false; };
  }, [orderId]);

  const onPing = (coords) => postDriverPing(orderId, coords);
  const onStatus = (status) => setDriverStatus(orderId, status).then((u) => setOrder(u));

  if (state === 'loading') {
    return <div className="drv-wrap"><div className="drv-card"><div className="drv-plain">Loading…</div></div></div>;
  }
  if (state === 'not_found') {
    return (
      <div className="drv-wrap">
        <div className="drv-card">
          <div className="drv-eyebrow">Delivery</div>
          <h1 className="drv-title">Order not found</h1>
          <div className="drv-sub">This order isn’t available on your account.</div>
        </div>
      </div>
    );
  }
  return <DriverShare order={order} onPing={onPing} onStatus={onStatus} />;
}
