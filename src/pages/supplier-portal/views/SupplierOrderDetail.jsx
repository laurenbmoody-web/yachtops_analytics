import React, { useEffect, useState, useMemo, useRef } from 'react';
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

// ─── Page ───────────────────────────────────────────────────────────────────

const SupplierOrderDetail = () => {
  const { orderId } = useParams();
  const navigate = useNavigate();
  const { allowed: canEdit } = usePermission('orders:edit');

  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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

      {/*
        ── TEMPORARY rendering until Runs 3–7 land. Items still get the
        existing confirm/sub/unavailable behaviour against updateOrderItem,
        gated by canEdit; this block is replaced wholesale in Run 5.
      */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 'var(--r-card)', padding: '20px 22px', marginTop: 18 }}>
        <div style={{ fontSize: 13, color: 'var(--muted-strong)', fontFamily: 'Outfit', fontWeight: 500, marginBottom: 8 }}>
          {items.length} item{items.length === 1 ? '' : 's'} · status: {order.status}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', fontFamily: 'JetBrains Mono' }}>
          Hero, timeline, items table, footer cards and drawers land in subsequent runs.
        </div>
      </div>
    </div>
  );
};

export default SupplierOrderDetail;
