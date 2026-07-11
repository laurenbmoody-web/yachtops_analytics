import React, { useEffect, useState } from 'react';
import { Star } from 'lucide-react';
import { fetchMySupplierReviews, replyToReview } from '../utils/supplierStorage';
import EmptyState from '../components/EmptyState';
import './supplier-reviews.css';

// dd/mm/yyyy, zero-padded — Cargo date convention.
const fmtDate = (val) => {
  if (!val) return '';
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
};

const Stars = ({ value = 0 }) => (
  <span className="spr-stars" aria-label={`${value} out of 5`}>
    {[1, 2, 3, 4, 5].map(i => (
      <Star key={i} size={14} className={i <= Math.round(value) ? 'on' : ''}
        fill={i <= Math.round(value) ? 'currentColor' : 'none'} strokeWidth={1.6} />
    ))}
  </span>
);

// One review card — traceable to its vessel + delivery, with a public
// reply the supplier can post to offer support.
const ReviewCard = ({ review, onReplied }) => {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(review.reply || '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await replyToReview(review.id, text.trim());
      setEditing(false);
      onReplied?.();
    } catch (e) {
      // Surface inline; supplier portal has no global toast in this view.
      setText((t) => t);
      alert(e.message || 'Could not save your reply');
    } finally {
      setSaving(false);
    }
  };

  const low = review.rating <= 2;

  return (
    <article className={`spr-card${low ? ' low' : ''}`}>
      <div className="spr-card-top">
        <Stars value={review.rating} />
        <span className="spr-vessel">{review.vesselName}</span>
        <span className="spr-meta">
          {review.deliveryDate ? `Delivered ${fmtDate(review.deliveryDate)}` : `Reviewed ${fmtDate(review.createdAt)}`}
        </span>
      </div>

      {review.note
        ? <p className="spr-note">{review.note}</p>
        : <p className="spr-note spr-nonote">Rating only — no written note.</p>}

      {/* Reply / support loop */}
      {review.reply && !editing ? (
        <div className="spr-reply">
          <div className="spr-reply-head">
            <span className="spr-reply-who">Your reply</span>
            <button className="spr-link" onClick={() => { setText(review.reply); setEditing(true); }}>Edit</button>
          </div>
          <p className="spr-reply-body">{review.reply}</p>
        </div>
      ) : editing ? (
        <div className="spr-reply-edit">
          <textarea
            className="spr-reply-input"
            placeholder="Reply publicly — thank them, or explain how you'll put it right…"
            value={text}
            maxLength={600}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="spr-reply-actions">
            <span className="spr-reply-hint">Shown publicly under the review · your vessel client stays anonymous to others.</span>
            <span className="spr-reply-btns">
              <button className="spr-btn ghost" onClick={() => { setEditing(false); setText(review.reply || ''); }} disabled={saving}>Cancel</button>
              <button className="spr-btn primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : (review.reply ? 'Update reply' : 'Post reply')}</button>
            </span>
          </div>
        </div>
      ) : (
        <button className="spr-reply-cta" onClick={() => { setText(''); setEditing(true); }}>Reply{low ? ' — offer support' : ''}</button>
      )}
    </article>
  );
};

const SupplierReviews = () => {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = () => {
    setLoading(true);
    fetchMySupplierReviews()
      .then(setReviews)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const count = reviews.length;
  const avg = count ? (reviews.reduce((s, r) => s + r.rating, 0) / count) : null;
  const needsReply = reviews.filter(r => r.rating <= 2 && !r.reply).length;

  return (
    <div className="sp-page">
      <div className="sp-page-head">
        <div>
          <div className="sp-eyebrow">{loading ? '…' : (count ? `${avg.toFixed(1)} ★ · ${count} verified review${count === 1 ? '' : 's'}` : 'No reviews yet')}</div>
          <h1 className="sp-page-title">Yacht <em>reviews</em></h1>
          <p className="sp-page-sub">Verified reviews from vessels you've delivered to. Anonymous to other buyers — but you can see the vessel and reply to offer support.</p>
        </div>
      </div>

      {error && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: 'var(--red)' }}>
          {error}
        </div>
      )}

      {needsReply > 0 && (
        <div className="spr-banner">
          {needsReply} low review{needsReply === 1 ? '' : 's'} {needsReply === 1 ? 'is' : 'are'} waiting for a reply — a quick response is the best way to keep a client.
        </div>
      )}

      {!loading && count === 0 && (
        <EmptyState icon="★" title="No reviews yet" body="Once a vessel receives an order from you and reviews the delivery, it'll appear here." />
      )}

      {count > 0 && (
        <div className="spr-list">
          {reviews.map(r => <ReviewCard key={r.id} review={r} onReplied={load} />)}
        </div>
      )}

      {loading && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)', fontSize: 13 }}>Loading reviews…</div>
      )}
    </div>
  );
};

export default SupplierReviews;
