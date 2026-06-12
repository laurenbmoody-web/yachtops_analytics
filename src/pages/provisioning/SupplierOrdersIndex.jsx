import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Icon from '../../components/AppIcon';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../contexts/TenantContext';
import { fetchAllSupplierOrders } from './utils/provisioningStorage';
import './provisioning-board.css';
import './provisioning-dashboard.css';
import '../../styles/editorial.css';

// ── SupplierOrdersIndex ────────────────────────────────────────────────────
// Tenant-wide supplier_orders index at /provisioning/orders. Lists every
// order regardless of board association — including orphans whose board
// was deleted (preserved by the supplier_orders_list_id_set_null
// migration, 20260612120000).
//
// Filters:
//   Search    — supplier name (case-insensitive)
//   Status    — 8-stage lifecycle (draft / sent / confirmed / dispatched /
//               out_for_delivery / received / invoiced / paid)
//   Dept      — COMMAND sees all; lower tiers see only orders where their
//               dept appears in supplier_orders.departments[]
//
// Click a row → navigate to /provisioning/orders/:orderId (board-agnostic
// detail route). The existing /provisioning/:boardId/orders/:orderId route
// stays available for board-context navigation; both render the same
// SupplierOrderPage component.

const STATUS_OPTIONS = [
  { value: 'all',              label: 'All statuses' },
  { value: 'draft',            label: 'Draft' },
  { value: 'sent',             label: 'Sent' },
  { value: 'confirmed',        label: 'Confirmed' },
  { value: 'dispatched',       label: 'Dispatched' },
  { value: 'out_for_delivery', label: 'Out for delivery' },
  { value: 'received',         label: 'Received' },
  { value: 'invoiced',         label: 'Invoiced' },
  { value: 'paid',             label: 'Paid' },
];

// Supplier_orders status → pill palette. Distinct from BOARD_STATUS_CONFIG
// (which is a different lifecycle on a different table). Could be promoted
// into the unified statusConfig.js as ORDER_STATUS_CONFIG in a follow-up;
// keeping local for now since this is the only consumer.
const STATUS_BADGE = {
  draft:            { bg: '#EEF0F4', fg: '#7C7E9B', label: 'Draft' },
  sent:             { bg: '#E0F2FE', fg: '#0369A1', label: 'Sent' },
  confirmed:        { bg: '#D1FAE5', fg: '#065F46', label: 'Confirmed' },
  dispatched:       { bg: '#FEF3C7', fg: '#92400E', label: 'Dispatched' },
  out_for_delivery: { bg: '#FFEDD5', fg: '#C2410C', label: 'Out for delivery' },
  received:         { bg: '#E8F5EE', fg: '#047857', label: 'Received' },
  invoiced:         { bg: '#EEF2FF', fg: '#4338CA', label: 'Invoiced' },
  paid:             { bg: '#ECFDF5', fg: '#047857', label: 'Paid' },
};

const fmtDate = (iso) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch { return '—'; }
};

const SupplierOrdersIndex = () => {
  const navigate = useNavigate();
  const { user, tenantRole } = useAuth();
  const { activeTenantId } = useTenant();

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const userTier = (tenantRole || '').toUpperCase();
  const isCommand = userTier === 'COMMAND';
  const userDept = (user?.department || '').trim();

  useEffect(() => {
    if (!activeTenantId) return;
    let cancelled = false;
    setLoading(true);
    fetchAllSupplierOrders(activeTenantId)
      .then(data => { if (!cancelled) setOrders(data || []); })
      .catch(err => {
        console.error('[SupplierOrdersIndex] fetch error:', err);
        if (!cancelled) setOrders([]);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [activeTenantId]);

  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return orders.filter(o => {
      // Dept-scope: COMMAND sees all; lower tiers see only orders where
      // their dept appears in the denormalised departments[] array.
      if (!isCommand && userDept) {
        const depts = Array.isArray(o.departments) ? o.departments : [];
        if (!depts.includes(userDept)) return false;
      }
      if (statusFilter !== 'all' && o.status !== statusFilter) return false;
      if (q && !(o.supplier_name || '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [orders, searchQuery, statusFilter, isCommand, userDept]);

  const handleRowClick = (orderId) => {
    navigate(`/provisioning/orders/${orderId}`);
  };

  return (
    <>
      <Header />
      <main className="pv-dashboard" style={{ minHeight: 'calc(100vh - 64px)' }}>
        {/* Centered max-width column — matches .dh-topbar-inner on the
            Delivered tab (max-width: 1240px in delivery-history.css) so
            the Sent/Delivered tab toggle is a swap of content within the
            same column, not a layout reflow. */}
        <div style={{ maxWidth: 1240, margin: '0 auto', padding: '24px 32px' }}>
        {/* Back to boards — nav chunk above the editorial header. The
            22px marginBottom matches the gap on the Delivered page (where
            .dh-topbar-inner padding-top provides the same rhythm). */}
        <button
          onClick={() => navigate('/provisioning')}
          style={{
            background: 'none', border: 0, padding: 0, cursor: 'pointer',
            fontSize: 12, fontWeight: 600, color: 'var(--d-muted)',
            letterSpacing: '0.08em', textTransform: 'uppercase',
            display: 'inline-flex', alignItems: 'center', gap: 6,
            marginBottom: 22, fontFamily: 'inherit',
          }}
        >
          <Icon name="ChevronLeft" size={14} strokeWidth={1.5} />
          Back to boards
        </button>

        {/* Editorial header — meta strip + serif headline. Matches the
            Delivered page's .di-headblock (marginBottom: 22 from
            delivery-inbox.css). */}
        <div style={{ marginBottom: 22 }}>
          <p className="editorial-meta">
            <span className="dot">●</span>
            <span>Orders</span>
            <span className="bar" />
            <span className="muted">All supplier orders</span>
            {!loading && filtered.length > 0 && (
              <>
                <span className="bar" />
                <span className="muted">{filtered.length} order{filtered.length === 1 ? '' : 's'}</span>
                <span className="bar" />
                <span className="muted">
                  {filtered.reduce((sum, o) => sum + (o.item_count || 0), 0)} item
                  {filtered.reduce((sum, o) => sum + (o.item_count || 0), 0) === 1 ? '' : 's'}
                </span>
              </>
            )}
          </p>
          <h1 className="editorial-greeting">
            ORDERS<span className="period">,</span> <em>all of them</em><span className="period">.</span>
          </h1>
        </div>

        {/* Tab strip — sits BETWEEN the editorial header and the filter
            row. Acts as the boundary between editorial chrome (back / meta
            / headline) and content controls (filters / table). Same
            position as the Delivered page. */}
        <div style={{
          display: 'flex', gap: 4, marginBottom: 18,
          borderBottom: '1px solid var(--d-border)',
        }}>
          <button
            className="pv-orders-tab pv-orders-tab-active"
            style={{
              padding: '10px 18px', background: 'none', border: 0, borderBottom: '2px solid var(--d-orange)',
              fontFamily: 'inherit', fontSize: 13.5, fontWeight: 600, color: 'var(--d-navy-deep)',
              cursor: 'default', marginBottom: -1,
            }}
            aria-current="page"
          >Sent</button>
          <button
            onClick={() => navigate('/provisioning/history')}
            style={{
              padding: '10px 18px', background: 'none', border: 0, borderBottom: '2px solid transparent',
              fontFamily: 'inherit', fontSize: 13.5, fontWeight: 500, color: 'var(--d-muted)',
              cursor: 'pointer', marginBottom: -1,
              transition: 'color 120ms ease, border-color 120ms ease',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--d-navy-deep)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--d-muted)'; }}
          >Delivered</button>
        </div>

        {/* Filter row — no enclosing card, just standalone inputs with their
            own hairline borders. Matches the Delivered page's .dh-filter-bar
            shape (flex row, no surrounding card, separator beneath). */}
        <div style={{
          display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
          paddingBottom: 16, marginBottom: 18,
          borderBottom: '0.5px solid var(--d-border)',
        }}>
          <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 180 }}>
            <Icon
              name="Search" size={14} strokeWidth={1.5}
              style={{
                position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
                color: 'var(--d-muted-soft)', pointerEvents: 'none',
              }}
            />
            <input
              type="text"
              placeholder="Search supplier…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{
                width: '100%', padding: '9px 12px 9px 34px',
                fontFamily: 'inherit', fontSize: 13, color: 'var(--d-navy)',
                background: 'var(--d-card)', border: '0.5px solid var(--d-border)',
                borderRadius: 10, outline: 'none',
              }}
            />
          </div>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            style={{
              padding: '9px 12px', fontFamily: 'inherit', fontSize: 13,
              color: 'var(--d-navy)', background: 'var(--d-card)',
              border: '0.5px solid var(--d-border)', borderRadius: 10,
              outline: 'none', cursor: 'pointer',
            }}
          >
            {STATUS_OPTIONS.map(s => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>

        {/* Orders table */}
        <div style={{
          background: 'var(--d-card)', border: '1px solid var(--d-border)',
          borderRadius: 12, overflow: 'hidden',
        }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 130px 90px 130px 130px 110px',
            gap: 0, padding: '12px 16px',
            background: 'var(--d-card-edge-soft, #F8F7F1)',
            borderBottom: '1px solid var(--d-border)',
            fontSize: 10, fontWeight: 700, letterSpacing: '0.12em',
            textTransform: 'uppercase', color: 'var(--d-muted)',
          }}>
            <div>Supplier</div>
            <div>Sent</div>
            <div>Items</div>
            <div>Board</div>
            <div>Departments</div>
            <div style={{ textAlign: 'right' }}>Status</div>
          </div>

          {loading && (
            <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--d-muted)', fontSize: 13 }}>
              Loading orders…
            </div>
          )}

          {!loading && filtered.length === 0 && (
            <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--d-muted)', fontSize: 13 }}>
              {orders.length === 0
                ? 'No orders yet. Send one from a provisioning board and it will appear here.'
                : 'No orders match the current filters.'}
            </div>
          )}

          {!loading && filtered.map((order, idx) => {
            const badge = STATUS_BADGE[order.status] || STATUS_BADGE.draft;
            const depts = Array.isArray(order.departments) ? order.departments.filter(Boolean) : [];
            const boardTitle = order.provisioning_list?.title;
            return (
              <button
                key={order.id}
                onClick={() => handleRowClick(order.id)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 130px 90px 130px 130px 110px',
                  gap: 0, padding: '14px 16px',
                  width: '100%',
                  background: 'transparent', border: 0,
                  borderBottom: idx < filtered.length - 1 ? '1px solid var(--d-border-soft, #F1EEE5)' : 'none',
                  cursor: 'pointer', textAlign: 'left',
                  fontFamily: 'inherit', alignItems: 'center',
                  transition: 'background 100ms ease',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--d-card-edge-soft, #FAFCFF)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
              >
                <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--d-navy)' }}>
                  {order.supplier_name || 'Unnamed supplier'}
                </div>
                <div style={{ fontSize: 13, color: 'var(--d-muted)' }}>
                  {fmtDate(order.sent_at || order.created_at)}
                </div>
                <div style={{ fontSize: 13, color: 'var(--d-muted)' }}>
                  {order.item_count || 0}
                </div>
                <div style={{ fontSize: 13, color: boardTitle ? 'var(--d-muted)' : 'var(--d-muted-soft)' }}>
                  {boardTitle || <em style={{ fontSize: 12 }}>board deleted</em>}
                </div>
                <div style={{ fontSize: 12, color: 'var(--d-muted)' }}>
                  {depts.length > 0 ? depts.join(', ') : '—'}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span style={{
                    display: 'inline-block', padding: '3px 10px',
                    fontSize: 11, fontWeight: 600, borderRadius: 6,
                    background: badge.bg, color: badge.fg,
                  }}>{badge.label}</span>
                </div>
              </button>
            );
          })}
        </div>
        </div>
      </main>
    </>
  );
};

export default SupplierOrdersIndex;
