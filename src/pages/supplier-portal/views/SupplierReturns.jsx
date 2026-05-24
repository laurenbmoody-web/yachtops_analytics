// ─────────────────────────────────────────────────────────────────────────────
// Supplier portal — Returns page.
//
// Renders supplier_return_tasks routed to the logged-in supplier by yacht
// clients on Cargo. Each task is the portal equivalent of receiving a
// signed return slip by email — the vessel authorisation (signer + job
// title + slip date + signature) comes from the slip_metadata snapshot
// frozen at routing time, so it reads as an audit artefact.
//
// Lifecycle:
//   sent          → supplier clicks "Acknowledge return" (optional note)
//   acknowledged  → supplier clicks "Mark completed" (refund/replacement dispatched)
//   completed     → archive view, no further action
//
// Supplier-side RLS (migration 20260523120000) gates both the read and
// the UPDATEs by supplier_id = get_user_supplier_id(). The UPDATE
// policy is verified naturally on first Acknowledge click — if it's
// wrong, the action surfaces an error.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useState, useCallback } from 'react';
import { useSupplier } from '../../../contexts/SupplierContext';
import { useAuth } from '../../../contexts/AuthContext';
import EmptyState from '../components/EmptyState';
import {
  fetchSupplierReturnTasks,
  acknowledgeSupplierReturnTask,
  completeSupplierReturnTask,
} from '../utils/supplierReturnTasks';

const STATUS_SECTION_LABEL = {
  sent:         'New',
  acknowledged: 'In progress',
  completed:    'Completed',
};

const fmtDate = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric',
    });
  } catch { return String(iso); }
};

const TaskCard = ({ task, onAcknowledge, onComplete, busy }) => {
  const md = task.slip_metadata || {};
  const items = Array.isArray(task.items) ? task.items : [];
  const [showAckNote, setShowAckNote] = useState(false);
  const [note, setNote] = useState('');

  const vesselSubtitle = [
    md.vessel_imo && `IMO ${md.vessel_imo}`,
    md.vessel_flag,
  ].filter(Boolean).join(' · ');

  return (
    <div className="sp-return-card">
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

      {/* Vessel authorisation — the audit-artefact piece. */}
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

const SupplierReturns = () => {
  const { supplier } = useSupplier();
  const { user } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actingId, setActingId] = useState(null);

  const load = useCallback(async () => {
    if (!supplier?.id) return;
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchSupplierReturnTasks(supplier.id);
      setTasks(rows);
    } catch (e) {
      console.error('[SupplierReturns load]', e);
      setError(e.message || 'Failed to load returns');
    } finally {
      setLoading(false);
    }
  }, [supplier?.id]);

  useEffect(() => { load(); }, [load]);

  const handleAcknowledge = async (taskId, note) => {
    setActingId(taskId);
    setError(null);
    try {
      await acknowledgeSupplierReturnTask(taskId, {
        acknowledgedBy: user?.id || null,
        supplierNote:   note,
      });
      await load();
      // Tell SupplierLayout to refresh the nav badge.
      window.dispatchEvent(new CustomEvent('supplier-return-tasks-changed'));
    } catch (e) {
      console.error('[SupplierReturns acknowledge]', e);
      setError(e.message || 'Failed to acknowledge return');
    } finally {
      setActingId(null);
    }
  };

  const handleComplete = async (taskId) => {
    setActingId(taskId);
    setError(null);
    try {
      await completeSupplierReturnTask(taskId);
      await load();
      window.dispatchEvent(new CustomEvent('supplier-return-tasks-changed'));
    } catch (e) {
      console.error('[SupplierReturns complete]', e);
      setError(e.message || 'Failed to mark completed');
    } finally {
      setActingId(null);
    }
  };

  const byStatus = {
    sent:         tasks.filter(t => t.status === 'sent'),
    acknowledged: tasks.filter(t => t.status === 'acknowledged'),
    completed:    tasks.filter(t => t.status === 'completed'),
  };
  const totalActive = byStatus.sent.length + byStatus.acknowledged.length;

  return (
    <div className="sp-page">
      <div className="sp-page-head">
        <div>
          <div className="sp-eyebrow">
            {loading
              ? '…'
              : totalActive === 0 && byStatus.completed.length === 0
                ? 'No returns yet'
                : `${totalActive} open · ${byStatus.completed.length} completed`}
          </div>
          <h1 className="sp-page-title">Your <em>returns</em></h1>
          <p className="sp-page-sub">
            Signed returns routed to your portal by yacht clients on Cargo.
            Acknowledge to confirm receipt; mark completed once the refund or
            replacement is dispatched.
          </p>
        </div>
      </div>

      {error && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: 'var(--red)' }}>
          {error}
        </div>
      )}

      {!loading && tasks.length === 0 && !error && (
        <EmptyState
          icon="↩️"
          title="No returns yet"
          body="Signed returns from your yacht clients on Cargo will appear here."
        />
      )}

      {!loading && tasks.length > 0 && (
        <div className="sp-return-sections">
          {['sent', 'acknowledged', 'completed'].map(status => {
            const list = byStatus[status];
            if (list.length === 0) return null;
            return (
              <section key={status} className="sp-return-section">
                <p className="sp-return-section-label">
                  {STATUS_SECTION_LABEL[status]}
                  <span className="sp-return-section-count">{list.length}</span>
                </p>
                {list.map(t => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    onAcknowledge={handleAcknowledge}
                    onComplete={handleComplete}
                    busy={actingId === t.id}
                  />
                ))}
              </section>
            );
          })}
        </div>
      )}

      {loading && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)', fontSize: 13 }}>Loading returns…</div>
      )}

      {/* TODO(notification): once the sendReturnTaskNotification edge function
          exists, the slip page's Cargo path invokes it on RPC success. Nothing
          to do on this page — the email is push-only; the portal is pull. */}
    </div>
  );
};

export default SupplierReturns;
