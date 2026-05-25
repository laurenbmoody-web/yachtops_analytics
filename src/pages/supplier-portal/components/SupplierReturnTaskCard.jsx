// Reusable building blocks for a supplier_return_tasks row.
//
// Split into TaskRow (compact summary, collapsed by default) and
// TaskDetail (the expanded body — vessel band, items table, vessel
// authorisation block with signature, footer actions).
//
// Both /supplier/returns and /supplier/orders/:id (returns drawer)
// render these the same way so the visual language is consistent
// across the portal.

import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

const fmtDate = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric',
    });
  } catch { return String(iso); }
};

const STATUS_PILL = {
  sent:         { label: 'New',         className: 'sp-return-pill sp-return-pill-new' },
  acknowledged: { label: 'In progress', className: 'sp-return-pill sp-return-pill-prog' },
  completed:    { label: 'Completed',   className: 'sp-return-pill sp-return-pill-done' },
};

// Compact row — vessel name, item summary, date, status pill, optional
// "From order" badge. Whole row is the toggle for expansion.
export const TaskRow = ({ task, expanded, onToggle, onOpenOrder, hideOrderBadge = false }) => {
  const md = task.slip_metadata || {};
  const items = Array.isArray(task.items) ? task.items : [];
  const firstItem = items[0]?.raw_name || '—';
  const moreCount = Math.max(0, items.length - 1);
  const itemSummary = moreCount > 0 ? `${firstItem} +${moreCount} other${moreCount === 1 ? '' : 's'}` : firstItem;
  const pill = STATUS_PILL[task.status] || STATUS_PILL.sent;
  const shortOrderId = task.order_id ? task.order_id.slice(0, 8).toUpperCase() : null;

  return (
    <button
      type="button"
      className={`sp-return-row${expanded ? ' is-expanded' : ''}`}
      onClick={onToggle}
      aria-expanded={expanded}
    >
      <div className="sp-return-row-caret">
        {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      </div>
      <div className="sp-return-row-text">
        <div className="sp-return-row-vessel">{md.vessel_name || 'Vessel'}</div>
        <div className="sp-return-row-items">
          {items.length} item{items.length === 1 ? '' : 's'} · {itemSummary}
        </div>
      </div>
      {shortOrderId && !hideOrderBadge && (
        <span
          className="sp-return-from-order-badge"
          onClick={(e) => { e.stopPropagation(); onOpenOrder?.(task.order_id); }}
          role="link"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onOpenOrder?.(task.order_id); } }}
          title={`Open order ${shortOrderId}`}
        >
          From order #{shortOrderId}
        </span>
      )}
      <div className="sp-return-row-meta">
        <div className="sp-return-row-date">{fmtDate(task.created_at)}</div>
        <span className={pill.className}>{pill.label}</span>
      </div>
    </button>
  );
};

// Expanded body — vessel band, items table, vessel authorisation block,
// footer actions. Mounted only when the row is expanded.
export const TaskDetail = ({ task, onAcknowledge, onComplete, busy }) => {
  const md = task.slip_metadata || {};
  const items = Array.isArray(task.items) ? task.items : [];
  const [showAckNote, setShowAckNote] = useState(false);
  const [note, setNote] = useState('');

  const vesselSubtitle = [
    md.vessel_imo && `IMO ${md.vessel_imo}`,
    md.vessel_flag,
  ].filter(Boolean).join(' · ');

  return (
    <div className="sp-return-detail">
      {/* Vessel band */}
      <div className="sp-return-vessel">
        <div className="sp-return-vessel-text">
          <div className="sp-return-vessel-name">{md.vessel_name || 'Vessel'}</div>
          {vesselSubtitle && <div className="sp-return-vessel-sub">{vesselSubtitle}</div>}
        </div>
        <div className="sp-return-meta">Received {fmtDate(task.created_at)}</div>
      </div>

      {/* Items */}
      <div className="sp-return-items">
        <table className="sp-table">
          <thead>
            <tr>
              <th>Item</th>
              <th className="num">Qty</th>
              <th>Reason</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={4} style={{ color: 'var(--muted-s)', fontStyle: 'italic' }}>No item detail recorded.</td></tr>
            ) : items.map((it, idx) => (
              <tr key={idx}>
                <td>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{it.raw_name || '—'}</div>
                  {it.item_reference && <div className="sp-return-ref">{it.item_reference}</div>}
                </td>
                <td className="num">
                  {it.return_qty ?? it.quantity ?? '—'}{it.unit ? ` ${it.unit}` : ''}
                </td>
                <td>{it.return_reason || '—'}</td>
                <td>{it.return_notes || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Vessel authorisation — the audit-artefact piece */}
      <div className="sp-return-auth">
        <div className="sp-return-auth-label">Vessel authorisation</div>
        <div className="sp-return-auth-body">
          <div className="sp-return-sig-wrap">
            {md.vessel_signature ? (
              <img src={md.vessel_signature} alt="Vessel signature" className="sp-return-sig" />
            ) : (
              <div className="sp-return-sig-empty">No signature on file</div>
            )}
          </div>
          <div className="sp-return-auth-meta">
            <div className="sp-return-auth-name">{md.signer_name || '—'}</div>
            {md.signer_job_title && <div className="sp-return-auth-title">{md.signer_job_title}</div>}
            {md.slip_date && <div className="sp-return-auth-date">{md.slip_date}</div>}
          </div>
        </div>
      </div>

      {/* Footer — status-aware actions */}
      {task.status === 'sent' && (
        <div className="sp-return-footer">
          {showAckNote ? (
            <div className="sp-return-ack-form">
              <textarea
                className="sp-return-note-input"
                placeholder="Note to the vessel (optional) — e.g. ‘Refund will follow within 5 working days.’"
                value={note}
                onChange={e => setNote(e.target.value)}
                rows={2}
                disabled={busy}
              />
              <div className="sp-return-footer-row">
                <button
                  className="sp-pill ghost"
                  onClick={() => { setShowAckNote(false); setNote(''); }}
                  disabled={busy}
                >Cancel</button>
                <button
                  className="sp-pill primary"
                  onClick={() => onAcknowledge(task.id, note.trim() || null)}
                  disabled={busy}
                >{busy ? 'Acknowledging…' : 'Acknowledge return'}</button>
              </div>
            </div>
          ) : (
            <div className="sp-return-footer-row">
              <button
                className="sp-pill primary"
                onClick={() => setShowAckNote(true)}
                disabled={busy}
              >Acknowledge return</button>
            </div>
          )}
        </div>
      )}

      {task.status === 'acknowledged' && (
        <div className="sp-return-footer">
          {task.supplier_note && (
            <div className="sp-return-supplier-note">
              <span className="sp-return-supplier-note-label">Your note to the vessel:</span> {task.supplier_note}
            </div>
          )}
          <div className="sp-return-footer-row">
            <div className="sp-return-meta">Acknowledged {fmtDate(task.acknowledged_at)}</div>
            <button
              className="sp-pill primary"
              onClick={() => onComplete(task.id)}
              disabled={busy}
            >{busy ? 'Saving…' : 'Mark completed'}</button>
          </div>
        </div>
      )}

      {task.status === 'completed' && (
        <div className="sp-return-footer">
          {task.supplier_note && (
            <div className="sp-return-supplier-note">
              <span className="sp-return-supplier-note-label">Your note to the vessel:</span> {task.supplier_note}
            </div>
          )}
          <div className="sp-return-meta">
            Acknowledged {fmtDate(task.acknowledged_at)} · Completed {fmtDate(task.completed_at)}
          </div>
        </div>
      )}
    </div>
  );
};
