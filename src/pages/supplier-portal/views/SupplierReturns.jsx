// ─────────────────────────────────────────────────────────────────────────────
// Supplier portal — Returns page.
//
// Renders supplier_return_tasks routed to the logged-in supplier by yacht
// clients on Cargo. Three status sections (New / In progress / Completed)
// with each task as a compact row by default; click a row to expand into
// the full signed-slip-equivalent detail (vessel band, items table,
// vessel-authorisation block with signature, status-aware actions).
//
// Tasks with order_id render a "From order #XXXX" badge — clicking opens
// the order detail page. Tasks without order_id render no badge and no
// empty space.
//
// Supplier-side RLS gates the read; the UPDATE policy is verified live
// on first Acknowledge click.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSupplier } from '../../../contexts/SupplierContext';
import { useAuth } from '../../../contexts/AuthContext';
import EmptyState from '../components/EmptyState';
import { TaskRow, TaskDetail } from '../components/SupplierReturnTaskCard';
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

const SupplierReturns = () => {
  const { supplier } = useSupplier();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actingId, setActingId] = useState(null);
  // Set<task.id> of rows currently expanded. Multiple may be open at
  // once — accordion-style, not radio-style — which suits triaging.
  const [expandedIds, setExpandedIds] = useState(() => new Set());

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

  const toggleExpanded = (taskId) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else                  next.add(taskId);
      return next;
    });
  };

  const handleAcknowledge = async (taskId, note) => {
    setActingId(taskId);
    setError(null);
    try {
      await acknowledgeSupplierReturnTask(taskId, {
        acknowledgedBy: user?.id || null,
        supplierNote:   note,
      });
      await load();
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

  const handleOpenOrder = (orderId) => {
    if (orderId) navigate(`/supplier/orders/${orderId}`);
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
                <div className="sp-return-rows">
                  {list.map(t => (
                    <div key={t.id} className="sp-return-row-wrap">
                      <TaskRow
                        task={t}
                        expanded={expandedIds.has(t.id)}
                        onToggle={() => toggleExpanded(t.id)}
                        onOpenOrder={handleOpenOrder}
                      />
                      {expandedIds.has(t.id) && (
                        <TaskDetail
                          task={t}
                          onAcknowledge={handleAcknowledge}
                          onComplete={handleComplete}
                          busy={actingId === t.id}
                        />
                      )}
                    </div>
                  ))}
                </div>
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
