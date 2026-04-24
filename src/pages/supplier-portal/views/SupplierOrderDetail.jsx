import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, X, RefreshCw } from 'lucide-react';
import { fetchOrderById, updateOrderStatus, updateOrderItem } from '../utils/supplierStorage';
import { usePermission } from '../../../contexts/SupplierPermissionContext';
import StatusBadge from '../components/StatusBadge';

const NO_PERMISSION_TITLE = "Your role doesn't have permission for this action.";

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

const ItemRow = ({ item, onUpdate, canEdit }) => {
  const [saving, setSaving] = useState(false);
  const [subNote, setSubNote] = useState(item.substitute_description ?? '');
  const [showSubInput, setShowSubInput] = useState(item.status === 'substituted');

  const act = async (status) => {
    setSaving(true);
    try {
      const updates = { status };
      if (status === 'substituted') updates.substitute_description = subNote;
      await onUpdate(item.id, updates);
    } finally {
      setSaving(false);
    }
  };

  return (
    <tr>
      <td>
        <div className="sp-line-name">{item.item_name}</div>
        {item.notes && <div className="sp-line-sku">{item.notes}</div>}
        {showSubInput && (
          <input
            value={subNote}
            onChange={e => setSubNote(e.target.value)}
            placeholder="Substitute description…"
            style={{ marginTop: 6, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--line)', fontSize: 12, width: '100%', maxWidth: 280 }}
          />
        )}
      </td>
      <td style={{ fontSize: 13 }}>{item.quantity} {item.unit}</td>
      <td><StatusBadge status={item.status} /></td>
      <td>
        {item.status === 'pending' && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              className="sp-rb primary"
              style={{ fontSize: 11, opacity: canEdit ? 1 : 0.5 }}
              disabled={saving || !canEdit}
              title={canEdit ? undefined : NO_PERMISSION_TITLE}
              onClick={() => act('confirmed')}
            ><Check size={11} /> Confirm</button>
            <button
              className="sp-rb"
              style={{ fontSize: 11, opacity: canEdit ? 1 : 0.5 }}
              disabled={saving || !canEdit}
              title={canEdit ? undefined : NO_PERMISSION_TITLE}
              onClick={() => { setShowSubInput(true); act('substituted'); }}
            ><RefreshCw size={11} /> Sub</button>
            <button
              className="sp-rb"
              style={{ fontSize: 11, color: 'var(--red)', opacity: canEdit ? 1 : 0.5 }}
              disabled={saving || !canEdit}
              title={canEdit ? undefined : NO_PERMISSION_TITLE}
              onClick={() => act('unavailable')}
            ><X size={11} /> N/A</button>
          </div>
        )}
        {item.status !== 'pending' && item.substitute_description && (
          <div style={{ fontSize: 11.5, color: 'var(--muted-s)' }}>→ {item.substitute_description}</div>
        )}
      </td>
    </tr>
  );
};

const SupplierOrderDetail = () => {
  const { orderId } = useParams();
  const navigate = useNavigate();
  const { allowed: canEdit } = usePermission('orders:edit');
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [confirming, setConfirming] = useState(false);

  const load = () => {
    setLoading(true);
    fetchOrderById(orderId)
      .then(setOrder)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, [orderId]);

  const handleItemUpdate = async (itemId, updates) => {
    const updated = await updateOrderItem(itemId, updates);
    setOrder(prev => ({
      ...prev,
      supplier_order_items: prev.supplier_order_items.map(i => i.id === itemId ? { ...i, ...updated } : i),
    }));
  };

  const handleConfirmAll = async () => {
    setConfirming(true);
    try {
      await updateOrderStatus(orderId, 'confirmed');
      setOrder(prev => ({ ...prev, status: 'confirmed' }));
    } finally {
      setConfirming(false);
    }
  };

  if (loading) return <div className="sp-page"><div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--muted)' }}>Loading order…</div></div>;
  if (error)   return <div className="sp-page"><div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--red)' }}>{error}</div></div>;
  if (!order)  return null;

  const items = order.supplier_order_items ?? [];
  const pendingCount = items.filter(i => i.status === 'pending').length;

  return (
    <div className="sp-page">
      <button className="sp-back" onClick={() => navigate('/supplier/orders')}>
        <ArrowLeft size={14} /> Back to orders
      </button>

      <div className="sp-page-head">
        <div>
          <div className="sp-eyebrow">Order · {order.supplier_name}</div>
          <h1 className="sp-page-title" style={{ fontSize: 22 }}>#{order.id.slice(0, 8).toUpperCase()}</h1>
          <p className="sp-page-sub">
            Delivery {fmtDate(order.delivery_date)} · {order.delivery_port ?? 'Port TBC'} · {items.length} items
          </p>
        </div>
        <StatusBadge status={order.status} style={{ fontSize: 13 }} />
      </div>

      {order.special_instructions && (
        <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 10, padding: '12px 16px', marginBottom: 20, fontSize: 13, color: '#92400E' }}>
          <b>Special instructions:</b> {order.special_instructions}
        </div>
      )}

      <div className="sp-table-wrap" style={{ marginBottom: 24 }}>
        <table className="sp-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Qty</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map(item => (
              <ItemRow key={item.id} item={item} onUpdate={handleItemUpdate} canEdit={canEdit} />
            ))}
          </tbody>
        </table>
      </div>

      {pendingCount > 0 && (
        <div className="sp-confirm-bar">
          <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg)' }}>
            {pendingCount} item{pendingCount > 1 ? 's' : ''} still pending
          </div>
          <button
            className="sp-pill primary"
            style={{ padding: '9px 20px', opacity: canEdit ? 1 : 0.5 }}
            disabled={confirming || !canEdit}
            title={canEdit ? undefined : NO_PERMISSION_TITLE}
            onClick={handleConfirmAll}
          >
            {confirming ? 'Confirming…' : 'Confirm all & send'}
          </button>
        </div>
      )}
    </div>
  );
};

export default SupplierOrderDetail;
