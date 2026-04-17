import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { fetchOrderByToken, updateOrderItemStatus, confirmSupplierOrder } from './utils/provisioningStorage';
import Icon from '../../components/AppIcon';

const ITEM_STATUS_OPTIONS = [
  { value: 'confirmed',    label: 'Confirm',     color: 'bg-green-100 text-green-700 border-green-300 dark:bg-green-900/30 dark:text-green-400' },
  { value: 'unavailable',  label: 'Unavailable', color: 'bg-red-100 text-red-700 border-red-300 dark:bg-red-900/30 dark:text-red-400' },
  { value: 'substituted',  label: 'Substitute',  color: 'bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/30 dark:text-amber-400' },
];

function StatusToggle({ itemId, current, onUpdate }) {
  const [saving, setSaving] = useState(false);

  const handle = async (newStatus) => {
    if (newStatus === current || saving) return;
    setSaving(true);
    await onUpdate(itemId, { status: newStatus });
    setSaving(false);
  };

  return (
    <div className="flex gap-1 flex-wrap">
      {ITEM_STATUS_OPTIONS.map(opt => (
        <button
          key={opt.value}
          type="button"
          onClick={() => handle(opt.value)}
          disabled={saving}
          className={`px-2.5 py-1 text-xs font-medium rounded-full border transition-all ${
            current === opt.value
              ? opt.color
              : 'bg-transparent border-border text-muted-foreground hover:bg-muted/50'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function SubstituteInput({ itemId, value, onUpdate }) {
  const [text, setText] = useState(value || '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (text === value || saving) return;
    setSaving(true);
    await onUpdate(itemId, { substitute_description: text });
    setSaving(false);
  };

  return (
    <input
      value={text}
      onChange={e => setText(e.target.value)}
      onBlur={save}
      placeholder="Describe substitute item…"
      className="mt-1.5 w-full px-2.5 py-1.5 text-xs bg-white border border-amber-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-400 placeholder:text-amber-400/70"
    />
  );
}

const SupplierConfirmOrder = () => {
  const { token } = useParams();
  const [order,   setOrder]   = useState(null);
  const [items,   setItems]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [message, setMessage] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!token) { setNotFound(true); setLoading(false); return; }
    fetchOrderByToken(token)
      .then(data => {
        if (!data) { setNotFound(true); return; }
        setOrder(data);
        setItems(data.supplier_order_items || []);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [token]);

  const handleItemUpdate = async (itemId, updates) => {
    await updateOrderItemStatus(itemId, updates);
    setItems(prev => prev.map(it => it.id === itemId ? { ...it, ...updates } : it));
  };

  const handleConfirmOrder = async () => {
    setConfirming(true);
    try {
      await confirmSupplierOrder(order.id, message);
      setSuccess(true);
    } catch (err) {
      alert(`Error confirming order: ${err.message || err}`);
    } finally {
      setConfirming(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow p-8 max-w-sm w-full text-center">
          <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
            <Icon name="AlertCircle" size={24} className="text-red-500" />
          </div>
          <h2 className="text-lg font-semibold text-slate-900 mb-2">Order not found</h2>
          <p className="text-sm text-slate-500">This link may be invalid or the order has been removed.</p>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow p-8 max-w-sm w-full text-center">
          <div className="w-14 h-14 rounded-full bg-teal-100 flex items-center justify-center mx-auto mb-4">
            <Icon name="CheckCircle" size={28} className="text-teal-600" />
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">Order Confirmed!</h2>
          <p className="text-sm text-slate-500 mb-1">Thank you for your response.</p>
          <p className="text-sm text-slate-500">The vessel team has been notified.</p>
        </div>
      </div>
    );
  }

  const pendingCount    = items.filter(it => it.status === 'pending').length;
  const confirmedCount  = items.filter(it => it.status === 'confirmed').length;
  const unavailableCount = items.filter(it => it.status === 'unavailable').length;
  const substitutedCount = items.filter(it => it.status === 'substituted').length;
  const allReviewed     = pendingCount === 0;

  const formatDate = (d, t) => {
    if (!d) return null;
    return `${d}${t ? ` at ${t}` : ''}`;
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top bar */}
      <div style={{ background: '#0F172A' }} className="px-4 py-3 flex items-center gap-3">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: '#0D9488' }}>
          <Icon name="Package" size={16} className="text-white" />
        </div>
        <span className="text-white font-semibold text-sm">Cargo Technology</span>
      </div>

      {/* Claim banner */}
      <div style={{ background: '#0D9488' }} className="px-4 py-2.5 text-center">
        <p className="text-white text-sm font-medium">
          Order Request from <strong>{order.supplier_name || 'Unknown Vessel'}</strong> — please review and confirm below
        </p>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">
        {/* Order header */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-lg font-bold text-slate-900">
                {order.supplier_name || 'Order Request'}
              </h1>
              <p className="text-sm text-slate-500 mt-0.5">
                Sent {order.sent_at ? new Date(order.sent_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
              </p>
            </div>
            <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
              order.status === 'confirmed'             ? 'bg-green-100 text-green-700' :
              order.status === 'partially_confirmed'   ? 'bg-amber-100 text-amber-700' :
              order.status === 'sent'                  ? 'bg-blue-100 text-blue-700' :
              'bg-slate-100 text-slate-600'
            }`}>
              {order.status === 'sent' ? 'Awaiting confirmation' : order.status?.replace('_', ' ')}
            </span>
          </div>

          {/* Delivery details */}
          {(order.delivery_port || order.delivery_date) && (
            <div className="mt-4 p-3 bg-teal-50 border-l-4 border-teal-500 rounded-r-lg space-y-0.5">
              <p className="text-xs font-semibold text-teal-700 uppercase tracking-wide mb-1">Delivery</p>
              {order.delivery_port    && <p className="text-sm text-slate-700">Port: <strong>{order.delivery_port}</strong></p>}
              {(order.delivery_date || order.delivery_time) && (
                <p className="text-sm text-slate-700">
                  Date: <strong>{formatDate(order.delivery_date, order.delivery_time)}</strong>
                </p>
              )}
              {order.delivery_contact && <p className="text-sm text-slate-700">Contact: <strong>{order.delivery_contact}</strong></p>}
            </div>
          )}

          {/* Special instructions */}
          {order.special_instructions && (
            <div className="mt-3 p-3 bg-amber-50 border-l-4 border-amber-400 rounded-r-lg">
              <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-1">Special Instructions</p>
              <p className="text-sm text-amber-900 leading-relaxed">{order.special_instructions}</p>
            </div>
          )}
        </div>

        {/* Progress summary */}
        {items.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4">
            <div className="flex gap-4 text-center">
              {[
                { n: confirmedCount,   label: 'Confirmed',   color: 'text-green-600' },
                { n: unavailableCount, label: 'Unavailable', color: 'text-red-500'   },
                { n: substitutedCount, label: 'Substitute',  color: 'text-amber-600' },
                { n: pendingCount,     label: 'Pending',     color: 'text-slate-400' },
              ].map(({ n, label, color }) => (
                <div key={label} className="flex-1">
                  <p className={`text-xl font-bold ${color}`}>{n}</p>
                  <p className="text-xs text-slate-500">{label}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Items list */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-900">Items ({items.length})</h2>
          </div>
          <div className="divide-y divide-slate-100">
            {items.map(item => (
              <div key={item.id} className="px-5 py-4">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div>
                    <p className="text-sm font-medium text-slate-900">{item.item_name}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {item.quantity} {item.unit || 'unit'}{item.notes ? ` · ${item.notes}` : ''}
                    </p>
                  </div>
                </div>
                <StatusToggle itemId={item.id} current={item.status} onUpdate={handleItemUpdate} />
                {item.status === 'substituted' && (
                  <SubstituteInput
                    itemId={item.id}
                    value={item.substitute_description}
                    onUpdate={handleItemUpdate}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Message + confirm */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 space-y-4">
          <div>
            <label className="text-sm font-medium text-slate-900 mb-1 block">
              Message to vessel <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              rows={3}
              placeholder="e.g. Items will be delivered on Monday morning. Please confirm berthing location."
              className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-teal-400/40 focus:border-teal-400 placeholder:text-slate-300"
            />
          </div>

          {!allReviewed && (
            <p className="text-xs text-amber-600 flex items-center gap-1.5">
              <Icon name="AlertTriangle" size={13} />
              {pendingCount} item{pendingCount !== 1 ? 's' : ''} still pending — please confirm, mark unavailable, or offer a substitute.
            </p>
          )}

          <button
            type="button"
            onClick={handleConfirmOrder}
            disabled={confirming || !allReviewed}
            className="w-full py-3 rounded-xl text-sm font-bold text-white transition-opacity disabled:opacity-50"
            style={{ background: '#0D9488' }}
          >
            {confirming ? 'Confirming…' : 'Confirm Order'}
          </button>
        </div>

        <p className="text-center text-xs text-slate-400 pb-4">
          Powered by <strong className="text-slate-500">Cargo Technology</strong>
        </p>
      </div>
    </div>
  );
};

export default SupplierConfirmOrder;
