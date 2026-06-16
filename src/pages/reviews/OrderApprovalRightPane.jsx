import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabaseClient';
import Icon from '../../components/AppIcon';
import ModalShell from '../../components/ui/ModalShell';
import { decideProvisioningApproval } from '../provisioning/utils/provisioningStorage';

// OrderApprovalRightPane — split-view right column for the provisioning
// approval inbox. Renders the selected request's board summary with a
// compact items table and Approve / Request changes footer buttons.
// "Open full board" deep-links to /provisioning/<list_id> for when the
// approver wants the real layout (large boards, scrolling depts,
// supplier orders tab, etc.).

const CURR_SYMBOLS = { GBP: '£', USD: '$', EUR: '€' };

function timeAgo(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

const tidyBoardType = (t) => {
  const upper = String(t || '').toUpperCase();
  if (upper === 'GENERAL') return 'BOARD';
  return upper;
};

export default function OrderApprovalRightPane({ request, onResolved, onToast }) {
  const navigate = useNavigate();
  const [items, setItems]       = useState([]);
  const [itemsLoading, setItemsLoading] = useState(true);
  const [decisionModal, setDecisionModal] = useState(null); // 'request_changes' | null
  const [comment, setComment]   = useState('');
  const [busy, setBusy]         = useState(false);

  // Load the board's items when a different request is selected.
  useEffect(() => {
    if (!request?.list_id) { setItems([]); return; }
    let cancelled = false;
    setItemsLoading(true);
    (async () => {
      const { data } = await supabase
        .from('provisioning_items')
        .select('id, name, quantity, unit, unit_price, category, department, status, brand')
        .eq('list_id', request.list_id)
        .order('department', { ascending: true })
        .order('category', { ascending: true })
        .order('name', { ascending: true });
      if (cancelled) return;
      setItems(data || []);
      setItemsLoading(false);
    })();
    return () => { cancelled = true; };
  }, [request?.list_id]);

  const currency = request?.currency || 'GBP';
  const symbol = CURR_SYMBOLS[currency] || '£';

  const totals = useMemo(() => {
    let est = 0;
    items.forEach(it => {
      const qty = Number(it.quantity) || 0;
      const px  = Number(it.unit_price) || 0;
      est += qty * px;
    });
    return { est, count: items.length };
  }, [items]);

  // Group items by department for the table.
  const byDept = useMemo(() => {
    const map = new Map();
    items.forEach(it => {
      const d = it.department || 'Uncategorised';
      if (!map.has(d)) map.set(d, []);
      map.get(d).push(it);
    });
    return Array.from(map.entries()).map(([dept, rows]) => ({ dept, rows }));
  }, [items]);

  const handleDecide = async (decision) => {
    if (!request?.id) return;
    if (decision === 'request_changes' && !comment.trim()) {
      onToast?.('Add a comment so the submitter knows what to fix.', { error: true });
      return;
    }
    setBusy(true);
    try {
      await decideProvisioningApproval(
        request.id,
        decision,
        decision === 'request_changes' ? comment.trim() : null,
      );
      setDecisionModal(null);
      setComment('');
      onToast?.(decision === 'approve' ? 'Approved' : 'Changes requested');
      onResolved?.();
    } catch (err) {
      const code = err?.code;
      if (code === 'P0005') onToast?.('A comment is required.', { error: true });
      else if (code === 'P0006') onToast?.('Only the assigned approver can decide.', { error: true });
      else if (code === 'P0007') onToast?.('Already decided.', { error: true });
      else onToast?.('Failed to submit decision', { error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pv-dashboard ord-rp">
      <header className="ord-rp-head">
        <div className="ord-rp-eyebrow">
          PROVISIONING · {tidyBoardType(request?.board_type)}
          {request?.is_re_approval && (
            <span className="ord-rp-rebadge">QUOTE REVIEW</span>
          )}
        </div>
        <h1 className="ord-rp-title">{request?.board_title || 'Untitled board'}</h1>
        <div className="ord-rp-meta">
          <span>Submitted by <strong>{request?.submitter_name || 'Someone'}</strong></span>
          <span aria-hidden="true" className="ord-rp-meta-dot">·</span>
          <span>{timeAgo(request?.created_at)}</span>
          {request?.primary_dept && (
            <>
              <span aria-hidden="true" className="ord-rp-meta-dot">·</span>
              <span>{request.primary_dept}</span>
            </>
          )}
        </div>
        <div className="ord-rp-stats">
          <span><strong>{totals.count}</strong> item{totals.count === 1 ? '' : 's'}</span>
          <span aria-hidden="true" className="ord-rp-meta-dot">·</span>
          <span>Estimated <strong>{symbol}{totals.est.toFixed(2)}</strong></span>
          <button
            type="button"
            className="ord-rp-deeplink"
            onClick={() => navigate(`/provisioning/${request?.list_id}`)}
            title="Open the full board"
          >
            <Icon name="ExternalLink" size={12} /> Open full board
          </button>
        </div>
      </header>

      {/* Items table — grouped by department, compact rendering. */}
      <div className="ord-rp-body">
        {itemsLoading ? (
          <p className="ord-rp-loading">Loading items…</p>
        ) : items.length === 0 ? (
          <p className="ord-rp-loading">No items on this board.</p>
        ) : (
          byDept.map(({ dept, rows }) => (
            <div key={dept} className="ord-rp-deptgroup">
              <div className="ord-rp-deptgroup-head">
                <span className="ord-rp-deptgroup-name">{dept}</span>
                <span className="ord-rp-deptgroup-count">
                  {rows.length} item{rows.length === 1 ? '' : 's'}
                </span>
              </div>
              <table className="ord-rp-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th className="num">Qty</th>
                    <th>Unit</th>
                    <th className="num">Unit price</th>
                    <th className="num">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(it => {
                    const qty = Number(it.quantity) || 0;
                    const px  = Number(it.unit_price) || 0;
                    const sub = qty * px;
                    return (
                      <tr key={it.id}>
                        <td>
                          <div className="ord-rp-name">{it.name || '—'}</div>
                          {it.brand && <div className="ord-rp-brand">{it.brand}</div>}
                          {it.category && <div className="ord-rp-cat">{it.category}</div>}
                        </td>
                        <td className="num">{qty || '—'}</td>
                        <td>{it.unit || '—'}</td>
                        <td className="num">{px > 0 ? `${symbol}${px.toFixed(2)}` : '—'}</td>
                        <td className="num">{sub > 0 ? `${symbol}${sub.toFixed(2)}` : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))
        )}
      </div>

      {/* Decision footer */}
      <footer className="ord-rp-foot">
        <button
          type="button"
          className="ord-rp-btn ord-rp-btn-ghost"
          onClick={() => { setComment(''); setDecisionModal('request_changes'); }}
          disabled={busy}
        >
          <Icon name="AlertTriangle" size={14} /> Request changes
        </button>
        <button
          type="button"
          className="ord-rp-btn ord-rp-btn-primary"
          onClick={() => handleDecide('approve')}
          disabled={busy}
        >
          <Icon name="Check" size={14} /> {busy ? 'Working…' : 'Approve'}
        </button>
      </footer>

      {/* Request changes modal — reuses the pv-edit-modal palette. */}
      {decisionModal === 'request_changes' && (
        <ModalShell
          onClose={() => { if (!busy) { setDecisionModal(null); setComment(''); } }}
          isDirty={!!comment.trim()}
          isBusy={busy}
          panelClassName="pv-edit-modal pv-dashboard"
        >
          <div className="pv-edit-modal-head">
            <div>
              <span className="pv-edit-modal-eyebrow">Reviewer decision</span>
              <h2 className="pv-edit-modal-title">Request, <em>changes</em>.</h2>
            </div>
            <button
              onClick={() => { setDecisionModal(null); setComment(''); }}
              className="pv-edit-modal-close"
              aria-label="Close"
              disabled={busy}
            >
              <Icon name="X" size={16} />
            </button>
          </div>
          <div className="pv-edit-modal-body">
            <div className="pv-edit-modal-field">
              <label className="pv-edit-modal-label" htmlFor="ord-rp-comment">What needs to change?</label>
              <textarea
                id="ord-rp-comment"
                value={comment}
                onChange={e => setComment(e.target.value)}
                rows={4}
                autoFocus
                className="pv-edit-modal-textarea"
                placeholder="Be specific so the submitter can act on it — quantities, missing items, supplier swap, etc."
              />
            </div>
          </div>
          <div className="pv-edit-modal-foot">
            <div className="pv-edit-modal-actions">
              <button
                type="button"
                onClick={() => { setDecisionModal(null); setComment(''); }}
                className="pv-edit-modal-btn pv-edit-modal-btn-ghost"
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleDecide('request_changes')}
                disabled={busy || !comment.trim()}
                className="pv-edit-modal-btn pv-edit-modal-btn-primary"
              >
                {busy ? 'Sending…' : 'Send to submitter'}
              </button>
            </div>
          </div>
        </ModalShell>
      )}
    </div>
  );
}
