import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { dateLocale } from '../../utils/dateFormat';
import { supabase } from '../../lib/supabaseClient';
import Icon from '../../components/AppIcon';
import ModalShell from '../../components/ui/ModalShell';

// OrderSignoffRightPane — decision pane for a chat-accepted order that's over
// the vessel spend limit and awaiting sign-off. The approver decides on the
// ORDER (supplier, held lines, total, who requested it) — no chat access needed.

const CURR = { GBP: '£', USD: '$', EUR: '€' };

function timeAgo(iso) {
  if (!iso) return '';
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short' });
}

export default function OrderSignoffRightPane({ request, onResolved, onToast }) {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState(null); // 'approve' | 'decline' | null
  const [note, setNote] = useState('');

  const symbol = CURR[request?.currency] || '€';
  const fmt = (n) => `${symbol}${(Number(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  const fmt2 = (n) => `${symbol}${(Number(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  useEffect(() => {
    if (!request?.order_id) { setItems([]); return undefined; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data } = await supabase
        .from('supplier_order_items')
        .select('id, item_name, quantity, unit, quoted_price, estimated_price')
        .eq('order_id', request.order_id)
        .eq('status', 'pending');
      if (!cancelled) { setItems(data || []); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [request?.order_id]);

  const total = useMemo(() => {
    if (items.length) {
      return items.reduce((s, it) => s + (Number(it.quoted_price ?? it.estimated_price) || 0) * (Number(it.quantity) || 1), 0);
    }
    return Number(request?.total) || 0;
  }, [items, request?.total]);

  const decide = async (approved) => {
    if (!request?.order_id || busy) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc('decide_supplier_order_approval', {
        p_order_id: request.order_id, p_approved: approved, p_note: note.trim() || null,
      });
      if (error) throw error;
      setModal(null); setNote('');
      onToast?.(approved ? 'Order signed off' : 'Order declined');
      onResolved?.();
    } catch (err) {
      onToast?.(err?.message || 'Couldn’t submit the decision', { error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pv-dashboard ord-rp">
      <header className="ord-rp-head">
        <div className="ord-rp-head-top">
          <div className="ord-rp-eyebrow">SUPPLY · ORDER SIGN-OFF</div>
          {request?.board_id && (
            <button type="button" className="ord-rp-deeplink" onClick={() => navigate(`/provisioning/${request.board_id}`)} title="Open the board">
              <Icon name="ExternalLink" size={12} /> Open board
            </button>
          )}
        </div>
        <h1 className="ord-rp-title">{request?.board_title || 'Supplier order'}</h1>
        <div className="ord-rp-submeta">
          <span>Requested by <strong>{request?.submitter_name || 'Someone'}</strong></span>
          <span aria-hidden="true" className="ord-rp-dot">·</span>
          <span>{timeAgo(request?.created_at)}</span>
        </div>
      </header>

      <div className="ord-rp-body">
        <div className="ord-rp-note" style={{ borderLeftColor: '#C65A1A' }}>
          <div>
            <div className="ord-rp-note-eyebrow">Why this needs you</div>
            <p className="ord-rp-note-body">This order is over the vessel’s spend limit, so it’s held until you sign it off. Approving places it with the supplier; declining leaves it unplaced.</p>
          </div>
        </div>

        <div className="ord-rp-stats">
          <div className="ord-rp-stat">
            <div className="ord-rp-stat-label">Items awaiting</div>
            <div className="ord-rp-stat-val">{request?.item_count ?? items.length}</div>
          </div>
          <div className="ord-rp-stat">
            <div className="ord-rp-stat-label">Total to authorise</div>
            <div className="ord-rp-stat-val">{fmt(total)}</div>
          </div>
        </div>

        <div className="ord-rp-section-head">
          <h2 className="ord-rp-section-h">Items<span style={{ color: 'var(--d-muted-soft)' }}>.</span></h2>
        </div>
        {loading ? (
          <p className="ord-rp-loading">Loading items…</p>
        ) : items.length === 0 ? (
          <p className="ord-rp-loading">No held items on this order.</p>
        ) : (
          <table className="ord-rp-table">
            <thead>
              <tr><th>Item</th><th className="num">Qty</th><th>Unit</th><th className="num">Unit price</th><th className="num">Subtotal</th></tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const qty = Number(it.quantity) || 0;
                const px = Number(it.quoted_price ?? it.estimated_price) || 0;
                return (
                  <tr key={it.id}>
                    <td><div className="ord-rp-name">{it.item_name || '—'}</div></td>
                    <td className="num">{qty || '—'}</td>
                    <td>{it.unit || '—'}</td>
                    <td className="num">{px > 0 ? fmt2(px) : '—'}</td>
                    <td className="num">{px > 0 ? fmt2(qty * px) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <footer className="ord-rp-foot">
        <div className="ord-rp-foot-eta" />
        <div className="ord-rp-foot-actions">
          <button type="button" className="ord-rp-btn ord-rp-btn-ghost" onClick={() => { setNote(''); setModal('decline'); }} disabled={busy}>
            <Icon name="X" size={14} /> Decline
          </button>
          <button type="button" className="ord-rp-btn ord-rp-btn-primary" onClick={() => { setNote(''); setModal('approve'); }} disabled={busy}>
            <Icon name="Check" size={14} /> {busy ? 'Working…' : 'Approve & place'}
          </button>
        </div>
      </footer>

      {modal && (
        <ModalShell onClose={() => { if (!busy) { setModal(null); setNote(''); } }} isDirty={!!note.trim()} isBusy={busy} panelClassName="pv-edit-modal pv-dashboard">
          <div className="pv-edit-modal-head">
            <div>
              <span className="pv-edit-modal-eyebrow">Spend sign-off</span>
              <h2 className="pv-edit-modal-title">{modal === 'approve' ? <>Approve, <em>order</em>.</> : <>Decline, <em>order</em>.</>}</h2>
            </div>
            <button onClick={() => { setModal(null); setNote(''); }} className="pv-edit-modal-close" aria-label="Close" disabled={busy}><Icon name="X" size={16} /></button>
          </div>
          <div className="pv-edit-modal-body">
            <p style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--d-muted)', margin: '0 0 14px', lineHeight: 1.5 }}>
              {modal === 'approve'
                ? <>Approving authorises <strong style={{ color: 'var(--d-navy-deep)' }}>{fmt(total)}</strong> with {request?.board_title || 'the supplier'} and places the held items on the order.</>
                : <>Declining leaves the order unplaced. The requester will see it wasn’t signed off.</>}
            </p>
            <div className="pv-edit-modal-field">
              <label className="pv-edit-modal-label" htmlFor="ord-signoff-note">Note <span style={{ fontWeight: 500, color: 'var(--d-muted-soft)', textTransform: 'none', letterSpacing: 0 }}>(optional)</span></label>
              <textarea id="ord-signoff-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} className="pv-edit-modal-textarea" placeholder={modal === 'approve' ? 'Any conditions for the requester…' : 'e.g. Over budget this month — hold until next trip.'} />
            </div>
          </div>
          <div className="pv-edit-modal-foot">
            <div className="pv-edit-modal-actions">
              <button type="button" onClick={() => { setModal(null); setNote(''); }} className="pv-edit-modal-btn pv-edit-modal-btn-ghost" disabled={busy}>Cancel</button>
              <button type="button" onClick={() => decide(modal === 'approve')} disabled={busy} className="pv-edit-modal-btn pv-edit-modal-btn-primary">
                {busy ? 'Working…' : (modal === 'approve' ? 'Approve & place' : 'Decline order')}
              </button>
            </div>
          </div>
        </ModalShell>
      )}
    </div>
  );
}
