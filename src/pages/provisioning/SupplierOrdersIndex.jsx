import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Icon from '../../components/AppIcon';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../contexts/TenantContext';
import { EditorialDatePicker } from '../../components/editorial';
import { fetchAllSupplierOrders } from './utils/provisioningStorage';
import OrderCard from './components/OrderCard';
import './provisioning-board.css';
import './provisioning-dashboard.css';
import '../../styles/editorial.css';
// OrderCard's .cargo-order-card-* class set lives in pantry.css. Loading
// it here so the standalone Orders index renders identically to the
// board-context Orders tab (which loads pantry.css via SupplierOrderPage).
import '../pantry/pantry.css';

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

const SupplierOrdersIndex = () => {
  const navigate = useNavigate();
  const { user, tenantRole } = useAuth();
  const { activeTenantId } = useTenant();

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  // From/To date filters — match the Delivered page's affordance. Compared
  // against sent_at (falling back to created_at for orders never dispatched).
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

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
      // Date range — compares against sent_at (or created_at if never sent).
      // dateFrom / dateTo arrive as 'YYYY-MM-DD' from EditorialDatePicker.
      const orderDateIso = (o.sent_at || o.created_at || '').slice(0, 10);
      if (dateFrom && orderDateIso < dateFrom) return false;
      if (dateTo && orderDateIso > dateTo) return false;
      return true;
    });
  }, [orders, searchQuery, statusFilter, dateFrom, dateTo, isCommand, userDept]);

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

        {/* Filter row — typography forced to Plus Jakarta Sans (same as
            .dh-filter-bar / .di scope on Delivered) so inherit chains
            inside the EditorialDatePicker children resolve identically.
            Without this, the picker inputs use `font-family: inherit` and
            pick up whatever .pv-dashboard / body declares — which has
            historically been Inter (from styles/index.css) rather than
            Plus Jakarta Sans. */}
        <div
          className="pv-orders-filter-row"
          style={{
            display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
            paddingBottom: 16, marginBottom: 18,
            borderBottom: '0.5px solid var(--d-border)',
            fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
          }}
        >
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
              className="pv-orders-filter-input"
              style={{
                width: '100%', padding: '9px 12px 9px 34px',
                fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
                fontSize: 13, fontWeight: 400,
                color: 'var(--d-navy)',
                background: 'var(--d-card)', border: '0.5px solid var(--d-border)',
                borderRadius: 10, outline: 'none',
              }}
            />
          </div>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            style={{
              padding: '9px 12px',
              fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
              fontSize: 13, fontWeight: 400,
              color: 'var(--d-navy)', background: 'var(--d-card)',
              border: '0.5px solid var(--d-border)', borderRadius: 10,
              outline: 'none', cursor: 'pointer',
            }}
          >
            {STATUS_OPTIONS.map(s => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          {/* Date range — wrapped in width-constrained divs that mirror
              .dh-filter-datepicker (flex: 0 1 170px, min-width: 150px) so
              the pickers sit inline next to the status select instead of
              wrapping to full-width rows. Same EditorialDatePicker chrome
              as the Delivered page. */}
          <div style={{ flex: '0 1 170px', minWidth: 150 }}>
            <EditorialDatePicker
              value={dateFrom}
              onChange={setDateFrom}
              placeholder="From date"
              ariaLabel="From date"
            />
          </div>
          <div style={{ flex: '0 1 170px', minWidth: 150 }}>
            <EditorialDatePicker
              value={dateTo}
              onChange={setDateTo}
              placeholder="To date"
              ariaLabel="To date"
            />
          </div>
        </div>

        {/* Orders list — uses the shared OrderCard component so the
            tenant-wide standalone view is pixel-identical with the
            board-context Orders tab inside ProvisioningBoardDetail. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {loading && (
            <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--d-muted)', fontSize: 13 }}>
              Loading orders…
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--d-muted)', fontSize: 13 }}>
              {orders.length === 0
                ? 'No orders yet. Send one from a provisioning board and it will appear here.'
                : 'No orders match the current filters.'}
            </div>
          )}
          {!loading && filtered.map(order => (
            <OrderCard
              key={order.id}
              order={order}
              onNavigate={(orderId) => navigate(`/provisioning/orders/${orderId}`)}
            />
          ))}
        </div>
        </div>
      </main>
    </>
  );
};

export default SupplierOrdersIndex;
