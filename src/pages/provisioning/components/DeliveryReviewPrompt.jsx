import React, { useState } from 'react';
import { X } from 'lucide-react';
import { submitOrderReview } from '../utils/marketplaceStorage';
import './delivery-review-prompt.css';

// A tap-to-rate star row with half-stars: each star has a left (½) and
// right (whole) hit zone; hovering previews.
const Stars = ({ value, onPick, size = 28 }) => {
  const [hover, setHover] = useState(null);
  const shown = hover != null ? hover : (value || 0);
  return (
    <span className="drp-stars" style={{ fontSize: size }} onMouseLeave={() => onPick && setHover(null)}>
      {[1, 2, 3, 4, 5].map(i => {
        const fill = shown >= i ? 100 : (shown >= i - 0.5 ? 50 : 0);
        return (
          <span key={i} className="drp-star">
            <span className="drp-star-base">★</span>
            <span className="drp-star-fill" style={{ width: `${fill}%` }}>★</span>
            {onPick && (
              <>
                <button type="button" className="drp-hit l" onMouseEnter={() => setHover(i - 0.5)} onClick={() => onPick(i - 0.5)} aria-label={`${i - 0.5} stars`} />
                <button type="button" className="drp-hit r" onMouseEnter={() => setHover(i)} onClick={() => onPick(i)} aria-label={`${i} star${i === 1 ? '' : 's'}`} />
              </>
            )}
          </span>
        );
      })}
    </span>
  );
};

const SubRow = ({ label, value, onPick }) => (
  <div className="drp-sub"><span className="l">{label}</span><Stars value={value} onPick={onPick} size={16} /></div>
);

// One supplier's delivery to rate. Overall (required) + Quality / Delivery
// / Service, all shown. Reviews are verified — this order was just received.
const OrderForm = ({ order, onDone }) => {
  const [star, setStar] = useState(order.rating || 0);
  const [note, setNote] = useState(order.note || '');
  const [q, setQ] = useState(order.quality || 0);
  const [d, setD] = useState(order.delivery || 0);
  const [s, setS] = useState(order.service || 0);
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
      onDone?.();
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
      <div className="drp-overall-row"><span className="l">Overall</span><Stars value={star} onPick={setStar} size={26} /></div>
      <div className="drp-detail-group">
        <div className="drp-detail-cap">In detail · optional</div>
        <SubRow label="Quality" value={q} onPick={setQ} />
        <SubRow label="Delivery" value={d} onPick={setD} />
        <SubRow label="Service" value={s} onPick={setS} />
      </div>
      <textarea
        className="drp-note"
        placeholder="Anything worth noting — quality, substitutions, timing, packing…"
        value={note}
        maxLength={600}
        onChange={(e) => setNote(e.target.value)}
      />
      <button className="drp-save" onClick={save} disabled={saving || !star}>{saving ? 'Saving…' : 'Post review'}</button>
    </div>
  );
};

// Fires when a board's delivery is received: nudges crew to rate the
// supplier(s) they just received from. Anonymous to other buyers.
const DeliveryReviewPrompt = ({ orders, onClose }) => {
  const [doneCount, setDoneCount] = useState(0);
  if (!orders?.length) return null;
  const allDone = doneCount >= orders.length;
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
        {orders.map(o => <OrderForm key={o.orderId} order={o} onDone={() => setDoneCount(c => c + 1)} />)}
        <div className="drp-foot">
          {allDone
            ? <button className="drp-done-btn" onClick={onClose}>Done</button>
            : <button className="drp-later" onClick={onClose}>Not now</button>}
        </div>
      </div>
    </>
  );
};

export default DeliveryReviewPrompt;
