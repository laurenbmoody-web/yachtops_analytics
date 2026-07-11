import React, { useState } from 'react';
import { X } from 'lucide-react';
import { submitOrderReview } from '../utils/marketplaceStorage';
import './delivery-review-prompt.css';

// A tap-to-rate star row.
const Stars = ({ value, onPick, size = 28 }) => (
  <span className="drp-stars" style={{ fontSize: size }}>
    {[1, 2, 3, 4, 5].map(i => (
      <button key={i} type="button" className={i <= value ? 'on' : ''} onClick={() => onPick(i)} aria-label={`${i} star${i === 1 ? '' : 's'}`}>★</button>
    ))}
  </span>
);

const SubRow = ({ label, value, onPick }) => (
  <div className="drp-sub"><span className="l">{label}</span><Stars value={value} onPick={onPick} size={16} /></div>
);

// One supplier's delivery to rate. Overall required; Quality/Delivery/
// Service optional behind a toggle. Reviews are verified — this order was
// just received.
const OrderForm = ({ order }) => {
  const [star, setStar] = useState(order.rating || 0);
  const [note, setNote] = useState(order.note || '');
  const [q, setQ] = useState(order.quality || 0);
  const [d, setD] = useState(order.delivery || 0);
  const [s, setS] = useState(order.service || 0);
  const [detail, setDetail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const save = async () => {
    if (!star) return;
    setSaving(true);
    try {
      await submitOrderReview(order.orderId, star, note.trim() || null, {
        quality: q || null, delivery: d || null, service: s || null,
      });
      setDone(true);
    } catch (e) {
      alert(e.message || 'Could not save your review');
    } finally {
      setSaving(false);
    }
  };

  if (done) {
    return (
      <div className="drp-order drp-order-done">
        <span className="drp-order-sup">{order.supplierName}</span>
        <span className="drp-thanks">✓ Thanks — your review is in</span>
      </div>
    );
  }

  return (
    <div className="drp-order">
      <div className="drp-order-sup">{order.supplierName}</div>
      <div className="drp-overall"><span className="l">Overall</span><Stars value={star} onPick={setStar} /></div>
      <textarea
        className="drp-note"
        placeholder="Anything worth noting — quality, substitutions, timing, packing…"
        value={note}
        maxLength={600}
        onChange={(e) => setNote(e.target.value)}
      />
      {detail ? (
        <div className="drp-subs">
          <SubRow label="Quality" value={q} onPick={setQ} />
          <SubRow label="Delivery" value={d} onPick={setD} />
          <SubRow label="Service" value={s} onPick={setS} />
        </div>
      ) : (
        <button className="drp-detail" onClick={() => setDetail(true)}>+ Rate quality, delivery &amp; service</button>
      )}
      <button className="drp-save" onClick={save} disabled={saving || !star}>{saving ? 'Saving…' : 'Post review'}</button>
    </div>
  );
};

// Fires when a board's delivery is received: nudges crew to rate the
// supplier(s) they just received from. Anonymous to other buyers.
const DeliveryReviewPrompt = ({ orders, onClose }) => {
  if (!orders?.length) return null;
  return (
    <>
      <div className="drp-backdrop" onClick={onClose} />
      <div className="drp" role="dialog" aria-modal="true" aria-label="Rate this delivery">
        <button className="drp-x" onClick={onClose} aria-label="Close"><X size={18} /></button>
        <div className="drp-head">
          <h3 className="drp-title">How was this <em>delivery</em>?</h3>
          <p className="drp-sub">
            A quick rating helps other yachts — and lets {orders.length === 1 ? 'your supplier' : 'your suppliers'} know how they did. Anonymous to other buyers.
          </p>
        </div>
        {orders.map(o => <OrderForm key={o.orderId} order={o} />)}
        <div className="drp-foot">
          <button className="drp-later" onClick={onClose}>Not now</button>
        </div>
      </div>
    </>
  );
};

export default DeliveryReviewPrompt;
