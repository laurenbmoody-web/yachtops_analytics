import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import {
  fetchSupplierReviews,
  fetchReviewableOrders,
  submitOrderReview,
} from '../../pages/provisioning/utils/marketplaceStorage';
import { showToast } from '../../utils/toast';
import './reviews-modal.css';

// Shared, self-contained supplier-reviews modal. Used from the marketplace
// storefront AND the provisioning supplier-detail page — one source of
// truth. Reviews are VERIFIED (they hang off a delivered order), anonymous
// to other buyers, traceable + replyable by the supplier.

// Five stars filled on the half (4.5 → four-and-a-half). With onPick, each
// star has two hit zones — left = ½, right = whole — with a hover preview.
const Stars = ({ value = 0, size = 12, onPick }) => {
  const [hover, setHover] = useState(null);
  const shown = hover != null ? hover : (value || 0);
  return (
    <span
      className={`rvw-stars ${onPick ? 'pick' : ''}`}
      style={{ fontSize: size }}
      onMouseLeave={() => onPick && setHover(null)}
    >
      {[1, 2, 3, 4, 5].map(i => {
        const fill = shown >= i ? 100 : (shown >= i - 0.5 ? 50 : 0);
        return (
          <span key={i} className="rvw-star">
            <span className="rvw-star-base">★</span>
            <span className="rvw-star-fill" style={{ width: `${fill}%` }}>★</span>
            {onPick && (
              <>
                <button type="button" className="rvw-star-hit l"
                  onMouseEnter={() => setHover(i - 0.5)}
                  onClick={(e) => { e.stopPropagation(); onPick(i - 0.5); }}
                  aria-label={`${i - 0.5} stars`} />
                <button type="button" className="rvw-star-hit r"
                  onMouseEnter={() => setHover(i)}
                  onClick={(e) => { e.stopPropagation(); onPick(i); }}
                  aria-label={`${i} star${i === 1 ? '' : 's'}`} />
              </>
            )}
          </span>
        );
      })}
    </span>
  );
};

// dd/mm/yyyy, zero-padded — Cargo date convention.
const fmtReviewDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
};

const SubRatingRow = ({ label, value, onPick }) => (
  <div className="rvw-sub-row">
    <span className="rvw-sub-label">{label}</span>
    <Stars value={value || 0} size={16} onPick={onPick} />
  </div>
);

// Aggregate sub-score breakdown (read-only) — shown where there's data.
const RatingBreakdown = ({ rating }) => {
  const items = [
    ['Quality', rating?.quality],
    ['Delivery', rating?.delivery],
    ['Service', rating?.service],
  ].filter(([, v]) => v != null);
  if (!items.length) return null;
  return (
    <div className="rvw-breakdown">
      {items.map(([l, v]) => (
        <span className="rvw-bd" key={l}><span className="l">{l}</span><span className="v">{v.toFixed(1)}</span></span>
      ))}
    </div>
  );
};

// One delivered order in "review your deliveries" — overall (required) plus
// optional Quality/Delivery/Service and a note. Editable in place.
const OrderReviewRow = ({ order, onSaved }) => {
  const hasReview = order.rating != null;
  const [editing, setEditing] = useState(!hasReview);
  const [star, setStar] = useState(order.rating || 0);
  const [note, setNote] = useState(order.note || '');
  const [quality, setQuality] = useState(order.quality || 0);
  const [delivery, setDelivery] = useState(order.delivery || 0);
  const [service, setService] = useState(order.service || 0);
  const [saving, setSaving] = useState(false);

  // Identify the delivery by date (+ port) — never the board name, which
  // is the vessel's own internal working title.
  const orderLabel = order.deliveryDate ? `Delivered ${fmtReviewDate(order.deliveryDate)}` : 'This delivery';

  const resetFromOrder = () => {
    setStar(order.rating || 0); setNote(order.note || '');
    setQuality(order.quality || 0); setDelivery(order.delivery || 0); setService(order.service || 0);
  };

  const save = async () => {
    if (!star) { showToast('Pick an overall rating first', 'error'); return; }
    setSaving(true);
    try {
      await submitOrderReview(order.orderId, star, note.trim() || null, {
        quality: quality || null, delivery: delivery || null, service: service || null,
      });
      showToast('Your review is saved — thanks', 'success');
      setEditing(false);
      onSaved?.();
    } catch (e) {
      showToast(e.message || 'Could not save your review', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rvw-order">
      <div className="rvw-order-head">
        <span className="rvw-order-title">{orderLabel}</span>
        {order.deliveryPort && <span className="rvw-order-meta">{order.deliveryPort}</span>}
      </div>

      {hasReview && !editing ? (
        <div className="rvw-order-saved">
          <div className="rvw-saved-row">
            <Stars value={star} size={14} />
            <button className="rvw-edit" onClick={() => setEditing(true)}>Edit</button>
          </div>
          {note ? <p className="rvw-order-note">“{note}”</p> : <span className="rvw-nonote">Rating only</span>}
        </div>
      ) : (
        <>
          <div className="rvw-overall">
            <span className="rvw-overall-l">Overall</span>
            <Stars value={star} size={24} onPick={setStar} />
          </div>
          <div className="rvw-detail-group">
            <div className="rvw-detail-cap">In detail · optional</div>
            <SubRatingRow label="Quality" value={quality} onPick={setQuality} />
            <SubRatingRow label="Delivery" value={delivery} onPick={setDelivery} />
            <SubRatingRow label="Service" value={service} onPick={setService} />
          </div>
          <textarea
            className="rvw-note"
            placeholder="How was this delivery — quality, substitutions, timing, packing…"
            value={note}
            maxLength={600}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="rvw-yours-foot">
            <span className="rvw-priv">Anonymous to other yachts · your supplier can see it to help.</span>
            <span className="rvw-yours-btns">
              {hasReview && (
                <button className="rvw-cancel" onClick={() => { setEditing(false); resetFromOrder(); }} disabled={saving}>Cancel</button>
              )}
              <button className="rvw-save" onClick={save} disabled={saving || !star}>
                {saving ? 'Saving…' : (hasReview ? 'Update' : 'Post review')}
              </button>
            </span>
          </div>
        </>
      )}
    </div>
  );
};

const ReviewsModal = ({ supplier, rating, onClose, onRated }) => {
  const [reviews, setReviews] = useState([]);
  const [orders, setOrders] = useState([]);
  const [busy, setBusy] = useState(true);

  const load = async () => {
    setBusy(true);
    const [revs, ords] = await Promise.all([
      fetchSupplierReviews(supplier.id),
      fetchReviewableOrders(supplier.id),
    ]);
    setReviews(revs);
    setOrders(ords);
    setBusy(false);
  };

  const refresh = async () => { onRated?.(); await load(); };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [supplier.id]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const avg = rating?.avg;
  const count = rating?.count || 0;

  return (
    <div className="rvw-scope">
      <div className="rvw-backdrop" onClick={onClose} />
      <div className="rvw" role="dialog" aria-modal="true" aria-label={`Reviews for ${supplier.name}`}>
        <button className="rvw-x" onClick={onClose} aria-label="Close"><X size={18} /></button>

        <header className="rvw-head">
          <div className="rvw-supplier">{supplier.name}</div>
          <div className="rvw-avg">
            <span className="rvw-avg-n">{avg ? avg.toFixed(1) : '—'}</span>
            <span className="rvw-avg-stars"><Stars value={avg || 0} size={17} /></span>
            <span className="rvw-avg-c">
              {count ? `${count} verified review${count === 1 ? '' : 's'}` : 'No reviews yet'}
            </span>
          </div>
          <RatingBreakdown rating={rating} />
        </header>

        <section className="rvw-yours">
          <div className="rvw-label">Review your deliveries</div>
          {busy ? (
            <div className="rvw-empty">Loading…</div>
          ) : orders.length === 0 ? (
            <div className="rvw-empty">You can review this supplier once you’ve received an order from them through Cargo.</div>
          ) : (
            orders.map(o => <OrderReviewRow key={o.orderId} order={o} onSaved={refresh} />)
          )}
        </section>

        <section className="rvw-list">
          <div className="rvw-label">
            {reviews.length ? `${reviews.length} verified review${reviews.length === 1 ? '' : 's'}` : 'Verified reviews'}
          </div>
          {busy ? (
            <div className="rvw-empty">Loading…</div>
          ) : reviews.length === 0 ? (
            <div className="rvw-empty">No written reviews yet.</div>
          ) : (
            reviews.map(r => (
              <article className={`rvw-item${r.mine ? ' is-mine' : ''}`} key={r.id}>
                <div className="rvw-item-top">
                  <Stars value={r.rating} size={12} />
                  <span className="rvw-who">{r.mine ? 'Your vessel' : 'Verified crew'}</span>
                  <span className="rvw-when">{fmtReviewDate(r.createdAt)}</span>
                </div>
                <p className="rvw-body">{r.note}</p>
                {r.supplierReply && (
                  <div className="rvw-reply">
                    <span className="rvw-reply-who">{supplier.name} replied</span>
                    <p className="rvw-reply-body">{r.supplierReply}</p>
                  </div>
                )}
              </article>
            ))
          )}
        </section>
      </div>
    </div>
  );
};

export default ReviewsModal;
export { Stars, fmtReviewDate };
