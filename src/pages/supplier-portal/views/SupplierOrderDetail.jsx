import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchOrderById, updateOrderStatus, updateOrderItem } from '../utils/supplierStorage';
import { usePermission } from '../../../contexts/SupplierPermissionContext';

const NO_PERMISSION_TITLE = "Your role doesn't have permission for this action.";

// ─── Timeline state machine ──────────────────────────────────────────────────
// Server status → which timeline step is "current". Statuses past `confirmed`
// (picking, packed, dispatched, invoiced) may not exist as DB enum values yet —
// they're rendered as future steps until the data layer catches up.
const TIMELINE_STEPS = [
  { key: 'sent',       label: 'Sent' },
  { key: 'confirming', label: 'Confirming' },
  { key: 'picking',    label: 'Picking' },
  { key: 'packed',     label: 'Packed' },
  { key: 'dispatched', label: 'Dispatched' },
  { key: 'delivered',  label: 'Delivered' },
  { key: 'invoiced',   label: 'Invoiced' },
];

const STATUS_TO_STEP_INDEX = {
  draft: 0,
  sent: 1,
  pending: 1,
  partially_confirmed: 1,
  confirmed: 2,
  picking: 2,
  packed: 3,
  dispatched: 4,
  delivered: 5,
  invoiced: 6,
};

// ─── Date / number helpers ──────────────────────────────────────────────────

const safeDate = (d) => {
  if (!d) return null;
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? null : dt;
};

// "Thursday"
const fmtWeekday = (d) => {
  const dt = safeDate(d);
  return dt ? dt.toLocaleDateString('en-GB', { weekday: 'long' }) : null;
};

// "7"
const fmtDay = (d) => {
  const dt = safeDate(d);
  return dt ? dt.getDate() : null;
};

// "May"
const fmtMonth = (d) => {
  const dt = safeDate(d);
  return dt ? dt.toLocaleDateString('en-GB', { month: 'short' }) : null;
};

// "25 Apr · 09:14"
const fmtTimestamp = (d) => {
  const dt = safeDate(d);
  if (!dt) return null;
  const date = dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const time = dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${date} · ${time}`;
};

// "2 hours ago" / "5d ago"
const fmtRelative = (d) => {
  const dt = safeDate(d);
  if (!dt) return null;
  const diffMs = Date.now() - dt.getTime();
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
};

// Whole days from today (00:00 local) to delivery date. Negative if past.
const daysUntil = (d) => {
  const dt = safeDate(d);
  if (!dt) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dt);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
};

const formatCurrency = (amount, currency = 'USD') => {
  if (amount == null || isNaN(Number(amount))) return '—';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(amount));
  } catch {
    return `${currency} ${Number(amount).toFixed(2)}`;
  }
};

const initialsOf = (name) => {
  if (!name) return '—';
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const firstNameOf = (name) => {
  if (!name) return null;
  return String(name).trim().split(/\s+/)[0] || null;
};

// ─── Hero + action dropdowns ────────────────────────────────────────────────

const ActionDropdown = ({ open, top, children }) => {
  if (!open) return null;
  return (
    <div className="sod-action-dropdown" role="menu" style={{ top }}>
      {children}
    </div>
  );
};

const DropdownRow = ({ icon, name, sub, link, empty, disabled, onClick }) => (
  <button
    type="button"
    role="menuitem"
    className={`sod-dd-row${empty ? ' sod-dd-empty' : ''}${disabled ? ' sod-dd-disabled' : ''}`}
    onClick={disabled ? undefined : onClick}
    disabled={disabled}
  >
    <span className="sod-dd-ico" aria-hidden="true">{icon}</span>
    <span className="sod-dd-info">
      <span className="sod-dd-name">{name}</span>
      {sub && <span className="sod-dd-sub">{sub}</span>}
    </span>
    {link && <span className="sod-dd-link">{link}</span>}
  </button>
);

const HeroActions = ({
  documentsCount,
  openMenu,
  onToggle,
  onOpenDock,
  onOpenReturns,
}) => {
  const isOpen = (id) => openMenu === id;
  return (
    <div className="sod-hero-actions">
      <button
        type="button"
        className={isOpen('docs') ? 'sod-menu-open' : ''}
        onClick={(e) => { e.stopPropagation(); onToggle('docs'); }}
        aria-haspopup="menu"
        aria-expanded={isOpen('docs')}
      >
        <span className="sod-left">Documents</span>
        <span className="sod-left" style={{ gap: 0 }}>
          {documentsCount > 0 && <span className="sod-count-badge">{documentsCount}</span>}
          <span className="sod-caret" style={{ marginLeft: 6 }}>›</span>
        </span>
      </button>

      <button
        type="button"
        className={isOpen('actions') ? 'sod-menu-open' : ''}
        onClick={(e) => { e.stopPropagation(); onToggle('actions'); }}
        aria-haspopup="menu"
        aria-expanded={isOpen('actions')}
      >
        <span className="sod-left">Actions</span>
        <span className="sod-caret">›</span>
      </button>

      <button
        type="button"
        className={isOpen('returns') ? 'sod-menu-open' : ''}
        onClick={(e) => { e.stopPropagation(); onToggle('returns'); }}
        aria-haspopup="menu"
        aria-expanded={isOpen('returns')}
      >
        <span className="sod-left">Returns</span>
        <span className="sod-caret">›</span>
      </button>

      {/* Dropdowns positioned to the left of the action stack */}
      <ActionDropdown open={isOpen('docs')} top={0}>
        <DropdownRow
          icon="📄"
          name="Order PDF"
          sub="Generated on send"
          link="Open"
          onClick={() => { /* TODO(out-of-scope): wire up Order PDF */ }}
        />
        <DropdownRow
          icon="🧾"
          name="Invoice"
          sub="Not yet attached"
          link="Attach"
          empty
          onClick={() => { /* TODO(out-of-scope): wire up Invoice attach */ }}
        />
        <DropdownRow
          icon="🚚"
          name="Delivery note"
          sub="Generates on dispatch"
          empty
          disabled
        />
      </ActionDropdown>

      <ActionDropdown open={isOpen('actions')} top={42}>
        <DropdownRow icon="✎" name="Edit delivery"   sub="Date, time, location" />
        <DropdownRow icon="👤" name="Reassign"        sub="Change order owner" />
        <DropdownRow icon="⚓" name="Dock access notes" sub="Marina rules · gangway · contact" onClick={onOpenDock} />
        <div className="sod-dd-divider" role="separator" />
        <DropdownRow icon="⎘" name="Duplicate order" sub="Create a copy with same items" />
        <DropdownRow icon="✉" name="Message vessel"  sub="Send a note to the crew" />
      </ActionDropdown>

      <ActionDropdown open={isOpen('returns')} top={84}>
        <DropdownRow icon="+" name="Add return" sub="File a return for confirmed items" onClick={onOpenReturns} />
        <DropdownRow icon="⮌" name="No returns yet" sub="Returns appear here once filed" empty disabled />
      </ActionDropdown>
    </div>
  );
};

const Hero = ({
  order,
  orderShortId,
  documentsCount,
  openMenu,
  onToggleMenu,
  onOpenDock,
  onOpenReturns,
}) => {
  const days = daysUntil(order.delivery_date);
  const showDays = days != null && days >= 0;

  const weekday = fmtWeekday(order.delivery_date);
  const day = fmtDay(order.delivery_date);
  const month = fmtMonth(order.delivery_date);
  const time = order.delivery_time
    ? String(order.delivery_time).slice(0, 5) // HH:mm
    : null;
  const portText = order.delivery_port || null;

  return (
    <div className="sod-hero">
      <div className="sod-hero-id">
        <div className="sod-hero-l">Order</div>
        <div className="sod-hero-id-n">#{orderShortId}</div>
      </div>

      <div className="sod-hero-countdown">
        <div className="sod-hero-l">Countdown</div>
        <div className="sod-hero-countdown-n">{showDays ? days : '—'}</div>
        <div className="sod-hero-countdown-u">{showDays ? (days === 1 ? 'day' : 'days') : 'no date'}</div>
      </div>

      <div className="sod-hero-when-block">
        <div className="sod-hero-when-eyebrow">
          Delivery{weekday ? ` · ${weekday}` : ''}
        </div>
        <div className="sod-hero-when">
          {day != null ? (
            <>
              <span className="sod-day">{day}</span>
              <span className="sod-month">{month}</span>
            </>
          ) : (
            <span className="sod-day" style={{ color: 'var(--muted)' }}>TBC</span>
          )}
        </div>
        <div className="sod-hero-where">
          {time && <span className="sod-mtag">{time}</span>}
          {portText ? <strong>{portText}</strong> : <span style={{ color: 'var(--muted)' }}>Port TBC</span>}
          {order.delivery_contact && (
            <>
              {' · '}
              {order.delivery_contact}
            </>
          )}
        </div>
      </div>

      <div className="sod-hero-right">
        <HeroActions
          documentsCount={documentsCount}
          openMenu={openMenu}
          onToggle={onToggleMenu}
          onOpenDock={onOpenDock}
          onOpenReturns={onOpenReturns}
        />
      </div>
    </div>
  );
};

// ─── Timeline ───────────────────────────────────────────────────────────────

// Map order status to the index of the "current" step in TIMELINE_STEPS.
// Anything before the current index is "done"; anything after is "future".
const currentStepIndexFor = (status) => {
  const idx = STATUS_TO_STEP_INDEX[status];
  return typeof idx === 'number' ? idx : 1;  // fallback to "Confirming"
};

const Timeline = ({ order, items, canEdit, onAdvance }) => {
  const currentIdx = currentStepIndexFor(order.status);
  const pendingCount = items.filter((i) => i.status === 'pending').length;
  const totalCount = items.length;

  // Progress bar width as a fraction of the full track between dots. The
  // track sits inside 9px-from-each-edge (matches the CSS `left:9px;right:9px`),
  // so we scale by (currentIdx / (steps-1)).
  const progressFraction = currentIdx > 0
    ? Math.min(1, currentIdx / (TIMELINE_STEPS.length - 1))
    : 0;

  const stepWhen = (idx) => {
    if (idx === 0) {
      return fmtTimestamp(order.sent_at || order.created_at) || 'Sent';
    }
    if (idx === currentIdx) {
      // "Confirming" gets the X of Y progress hint.
      if (TIMELINE_STEPS[idx].key === 'confirming' && totalCount > 0) {
        return `Now · ${totalCount - pendingCount} of ${totalCount}`;
      }
      return 'Now';
    }
    if (idx < currentIdx) {
      // TODO(schema): per-step timestamps (picking_at, packed_at, …) need columns.
      return '✓';
    }
    // Future delivery step gets the planned date if we have one.
    if (TIMELINE_STEPS[idx].key === 'delivered' && order.delivery_date) {
      const dt = safeDate(order.delivery_date);
      return dt ? dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : '—';
    }
    return '—';
  };

  const handleStepClick = (idx) => {
    if (idx === currentIdx) return;             // no-op on current
    if (idx < currentIdx) {
      // Walking backward isn't supported via the UI — flag intent in console
      // and bail. Future work: an explicit "revert" affordance.
      console.warn('[SupplierOrderDetail] Backward step click ignored:', TIMELINE_STEPS[idx].key);
      return;
    }
    if (idx > currentIdx + 1) {
      window.alert(`Advance one step at a time. Next step: ${TIMELINE_STEPS[currentIdx + 1].label}.`);
      return;
    }
    if (!canEdit) {
      window.alert(NO_PERMISSION_TITLE);
      return;
    }
    const target = TIMELINE_STEPS[idx];
    const ok = window.confirm(`Advance order to "${target.label}"? This is logged on the order.`);
    if (!ok) return;
    onAdvance(target.key);
  };

  return (
    <div className="sod-timeline-card">
      <div className="sod-stepper-line">
        <div className="sod-stepper-progress" style={{ width: `calc((100% - 18px) * ${progressFraction})` }} />
        {TIMELINE_STEPS.map((step, idx) => {
          const isDone = idx < currentIdx;
          const isCurrent = idx === currentIdx;
          const cls = `sod-step${isDone ? ' sod-done' : ''}${isCurrent ? ' sod-current' : ''}`;
          return (
            <button
              key={step.key}
              type="button"
              className={cls}
              onClick={() => handleStepClick(idx)}
              aria-current={isCurrent ? 'step' : undefined}
              title={isCurrent ? 'Current step' : (idx > currentIdx ? `Advance to ${step.label}` : 'Already completed')}
            >
              <div className="sod-step-dot" />
              <div className="sod-step-name">{step.label}</div>
              <div className="sod-step-when">{stepWhen(idx)}</div>
            </button>
          );
        })}
      </div>
      <div className="sod-timeline-meta">
        Click a step to advance — confirmation required before any state change.
      </div>
    </div>
  );
};

// ─── Page ───────────────────────────────────────────────────────────────────

const SupplierOrderDetail = () => {
  const { orderId } = useParams();
  const navigate = useNavigate();
  const { allowed: canEdit } = usePermission('orders:edit');

  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [openMenu, setOpenMenu] = useState(null);          // 'docs' | 'actions' | 'returns' | null
  const [returnsDrawerOpen, setReturnsDrawerOpen] = useState(false);
  const [dockDrawerOpen, setDockDrawerOpen] = useState(false);
  const heroRef = useRef(null);

  const toggleMenu = useCallback((id) => {
    setOpenMenu((prev) => (prev === id ? null : id));
  }, []);

  // Click-outside on the hero closes any open dropdown.
  useEffect(() => {
    if (!openMenu) return;
    const onDocClick = (e) => {
      if (heroRef.current && !heroRef.current.contains(e.target)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [openMenu]);

  const handleOpenDock = useCallback(() => {
    setOpenMenu(null);
    setDockDrawerOpen(true);
  }, []);

  const handleOpenReturns = useCallback(() => {
    setOpenMenu(null);
    setReturnsDrawerOpen(true);
  }, []);

  const handleStatusAdvance = useCallback(async (newStatus) => {
    try {
      await updateOrderStatus(orderId, newStatus);
      setOrder((prev) => prev ? { ...prev, status: newStatus } : prev);
    } catch (e) {
      window.alert(`Failed to advance status: ${e.message}`);
    }
  }, [orderId]);

  const load = () => {
    setLoading(true);
    setError(null);
    fetchOrderById(orderId)
      .then(setOrder)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, [orderId]);

  if (loading) {
    return (
      <div className="sod-page">
        <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--muted)' }}>
          Loading order…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="sod-page">
        <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--red)' }}>
          {error}
        </div>
      </div>
    );
  }

  if (!order) return null;

  const items = order.supplier_order_items ?? [];
  const orderShortId = order.id.slice(0, 8).toUpperCase();
  // TODO(schema): order.assigned_to_name — needs schema addition
  const assigneeName = order.assigned_to_name || null;
  // TODO(schema): order.created_by_name / sender role — for now we lean on
  // supplier_orders.vessel_name + the implicit "chief stew" role.
  const senderName = order.created_by_name || null;
  const senderRole = order.created_by_role || 'Chief stew';
  const sentRelative = fmtRelative(order.sent_at || order.created_at);
  const yachtDisplayName = order.vessel_name || order.yacht_name || 'the yacht';

  return (
    <div className="sod-page">

      {/* ── Crumb ── */}
      <div className="sod-crumb">
        <a onClick={() => navigate('/supplier/orders')}>Orders</a>
        <span className="sep">›</span>
        #{orderShortId}
      </div>

      {/* ── Page header: title + assignee chip ── */}
      <header className="sod-order-header">
        <div>
          <h1 className="sod-order-title">
            FROM{' '}
            <button
              type="button"
              className="sod-yacht-link"
              onClick={() => { /* TODO(schema): yacht client page link */ }}
            >
              {yachtDisplayName}.
            </button>
          </h1>
          <div className="sod-order-sub">
            {senderName ? <strong>{senderName}</strong> : <strong>{order.supplier_name || 'Vessel crew'}</strong>}
            {senderRole && <>, {senderRole}</>}
            {sentRelative && (
              <>
                <span className="sep">·</span>
                sent {sentRelative}
              </>
            )}
          </div>
        </div>

        <button
          type="button"
          className={`sod-header-assignee${assigneeName ? '' : ' sod-unassigned'}`}
          title={assigneeName ? `Assigned to ${assigneeName}` : 'Unassigned'}
          onClick={() => { /* TODO(schema): reassign action */ }}
        >
          <span className="sod-av">{assigneeName ? initialsOf(assigneeName) : '—'}</span>
          <span className="sod-info">
            <span className="sod-label-tiny">{assigneeName ? 'Assigned' : 'Status'}</span>
            <span className="sod-name">{assigneeName ? firstNameOf(assigneeName) : 'Unassigned'}</span>
          </span>
        </button>
      </header>

      {/* ── Delivery hero with action dropdowns ── */}
      <div ref={heroRef}>
        <Hero
          order={order}
          orderShortId={orderShortId}
          documentsCount={1}
          openMenu={openMenu}
          onToggleMenu={toggleMenu}
          onOpenDock={handleOpenDock}
          onOpenReturns={handleOpenReturns}
        />
      </div>

      {/* ── 7-state timeline ── */}
      <Timeline
        order={order}
        items={items}
        canEdit={canEdit}
        onAdvance={handleStatusAdvance}
      />

      {/*
        ── TEMPORARY rendering until Runs 4–7 land. Items still get the
        existing confirm/sub/unavailable behaviour against updateOrderItem,
        gated by canEdit; this block is replaced wholesale in Run 5.
      */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 'var(--r-card)', padding: '20px 22px', marginTop: 18 }}>
        <div style={{ fontSize: 13, color: 'var(--muted-strong)', fontFamily: 'Outfit', fontWeight: 500, marginBottom: 8 }}>
          {items.length} item{items.length === 1 ? '' : 's'} · status: {order.status}
          {returnsDrawerOpen && ' · returns drawer requested'}
          {dockDrawerOpen && ' · dock drawer requested'}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', fontFamily: 'JetBrains Mono' }}>
          Timeline, items table, footer cards and drawers land in subsequent runs.
        </div>
      </div>
    </div>
  );
};

export default SupplierOrderDetail;
