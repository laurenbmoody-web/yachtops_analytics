import React, { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, ArrowRight, AlertTriangle, Search, Zap, Flag, Download, MessageSquare, SlidersHorizontal, ArrowUpDown, Check, ChevronDown } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useSupplier } from '../../../contexts/SupplierContext';
import { fetchSupplierOrders } from '../utils/supplierStorage';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
import '../../../styles/editorial.css'; // shared editorial meta strip + serif greeting (matches marketplace)

const TABS = [
  { key: 'all',                 label: 'All' },
  { key: 'sent',                label: 'New' },
  { key: 'confirmed',           label: 'Confirmed' },
  { key: 'partially_confirmed', label: 'Partial' },
  { key: 'draft',               label: 'Draft' },
];

const SORTS = [
  { key: 'received', label: 'Newest first' },
  { key: 'deliver',  label: 'Deliver by (soonest)' },
  { key: 'total',    label: 'Total (high → low)' },
  { key: 'yacht',    label: 'Yacht (A–Z)' },
];

// Orders still to fulfil — used for deliver-by urgency (a delivered order is
// never "overdue").
const OPEN_STATUSES = new Set([
  'draft', 'sent', 'confirmed', 'partially_confirmed', 'picking', 'packed',
  'dispatched', 'out_for_delivery',
]);

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
const fmtTime = (t) => (t ? String(t).slice(0, 5) : null);
const fmtAmt  = (a, cur = 'EUR') => (a == null ? '—' : new Intl.NumberFormat('fr-FR', { style: 'currency', currency: cur, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(a));
const fmtMoney0 = (a, cur = 'EUR') => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(a || 0);
const isToday = (d) => { if (!d) return false; const x = new Date(d), n = new Date(); return x.getFullYear() === n.getFullYear() && x.getMonth() === n.getMonth() && x.getDate() === n.getDate(); };

// The agreed price wins, then the supplier's quote, then the buyer's estimate.
// (unit_price is a legacy column that's empty on marketplace orders — summing
// it alone showed €0 totals.)
const itemPrice = (i) => i.agreed_price ?? i.quoted_price ?? i.estimated_price ?? i.unit_price ?? 0;
const orderTotal = (o) => (o.supplier_order_items ?? []).reduce((s, i) => s + itemPrice(i) * (i.quantity ?? 1), 0);

// The yacht that placed the order (mirrors the order-detail priority).
const yachtOf = (o) => o.yacht_client_name || o.vessel_name || o.yacht_name || 'Yacht client';
const initialsOf = (name) => (name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '—';
const TINTS = [
  { bg: '#EAF1FB', fg: '#3B6BA5' }, { bg: '#FBEFE9', fg: '#C65A1A' }, { bg: '#EAF6EF', fg: '#1D7A4D' },
  { bg: '#F3EEFB', fg: '#6D4BA5' }, { bg: '#FDF2E7', fg: '#B07A16' }, { bg: '#FBEAF0', fg: '#B23A6B' },
];
const tintOf = (name) => TINTS[[...(name || 'x')].reduce((h, c) => (h + c.charCodeAt(0)) | 0, 0) % TINTS.length];

const flaggedCount = (o) => (o.supplier_order_items ?? []).filter(i => i.status === 'unavailable' || i.status === 'substituted').length;

const deliverUrgency = (o) => {
  if (!o.delivery_date || !OPEN_STATUSES.has(o.status)) return null;
  const days = Math.ceil((new Date(o.delivery_date) - new Date()) / 86400000);
  if (days < 0)  return { tone: 'var(--red)',   label: 'overdue' };
  if (days === 0) return { tone: 'var(--red)',   label: 'today' };
  if (days <= 2) return { tone: 'var(--amber)', label: `in ${days}d` };
  return null;
};

// A standalone toggle pill (Rush / Flagged).
const TogglePill = ({ on, onClick, Icon, label, tone }) => (
  <button
    type="button"
    onClick={onClick}
    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 13px', borderRadius: 999, fontSize: 12.5, fontFamily: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap',
      border: `1px solid ${on ? tone : 'var(--line)'}`, background: on ? tone : 'var(--card)', color: on ? '#fff' : 'var(--muted-s)', fontWeight: on ? 600 : 500 }}
  ><Icon size={12} />{label}</button>
);

// A labelled single-select dropdown (Filter = status, Sort = order). The
// button just carries its own name, matching the Filter/Sort chrome.
const MenuSelect = ({ label, Icon, value, options, onChange }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const isDefault = value === options[0].key;

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8, fontSize: 12.5, fontFamily: 'inherit', cursor: 'pointer',
          border: `1px solid ${!isDefault ? '#C65A1A' : 'var(--line)'}`, background: 'var(--card)', color: !isDefault ? '#C65A1A' : 'var(--muted-s)', fontWeight: !isDefault ? 600 : 500 }}
      >
        <Icon size={13} />{label}
        {!isDefault && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#C65A1A' }} />}
        <ChevronDown size={12} />
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 20, minWidth: 190, background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12, boxShadow: '0 12px 32px -8px rgba(28,27,58,0.22)', padding: 6 }}>
          {options.map(o => (
            <button key={o.key} type="button" onClick={() => { onChange(o.key); setOpen(false); }}
              style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '8px 10px', border: 'none', background: o.key === value ? 'var(--bg-3)' : 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, color: 'var(--fg)', borderRadius: 8, textAlign: 'left', fontWeight: o.key === value ? 600 : 400 }}>
              <span style={{ width: 14, flexShrink: 0 }}>{o.key === value && <Check size={13} strokeWidth={3} style={{ color: '#C65A1A' }} />}</span>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const SupplierOrders = () => {
  const { supplier } = useSupplier();
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [tab, setTab] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Desk controls
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState('received');
  const [fRush, setFRush] = useState(false);
  const [fFlagged, setFFlagged] = useState(false);

  const load = () => {
    if (!supplier?.id) return;
    setLoading(true);
    setError(null);
    fetchSupplierOrders(supplier.id, { status: tab })
      .then(setOrders)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, [supplier?.id, tab]);

  // Filter + sort the loaded set (a supplier's own orders — cheap client-side).
  const view = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = orders.filter(o => {
      if (fRush && !deliverUrgency(o)) return false;
      if (fFlagged && flaggedCount(o) === 0) return false;
      if (!q) return true;
      return (
        o.id.toLowerCase().includes(q) ||
        yachtOf(o).toLowerCase().includes(q) ||
        (o.delivery_port || '').toLowerCase().includes(q)
      );
    });
    const cmp = {
      received: (a, b) => new Date(b.created_at) - new Date(a.created_at),
      deliver:  (a, b) => new Date(a.delivery_date || 8.64e15) - new Date(b.delivery_date || 8.64e15),
      total:    (a, b) => orderTotal(b) - orderTotal(a),
      yacht:    (a, b) => yachtOf(a).localeCompare(yachtOf(b)),
    }[sortKey];
    return [...rows].sort(cmp);
  }, [orders, query, fRush, fFlagged, sortKey]);

  // Subline reflects the loaded tab's actual actionable state — new to
  // confirm, rush deliveries, and open orders with flagged items.
  const newCount = orders.filter(o => o.status === 'sent').length;
  const rushCount = orders.filter(o => deliverUrgency(o)).length;
  const flaggedOpen = orders.filter(o => OPEN_STATUSES.has(o.status) && flaggedCount(o) > 0).length;

  // Live stats for the meta strip.
  const outstanding = orders.filter(o => OPEN_STATUSES.has(o.status)).length;
  const flaggedOrders = orders.filter(o => flaggedCount(o) > 0).length;
  const deliveriesToday = orders.filter(o => isToday(o.delivery_date)).length;
  const totalValue = orders.reduce((s, o) => s + orderTotal(o), 0);
  const totalCur = orders[0]?.currency || 'EUR';
  const sub = (() => {
    if (loading || orders.length === 0) return '';
    const parts = [];
    if (newCount) parts.push(`${newCount} new to confirm`);
    if (rushCount) parts.push(`${rushCount} rush`);
    if (flaggedOpen) parts.push(`${flaggedOpen} flagged to resolve`);
    return parts.join(' · '); // empty when nothing needs attention → no subline
  })();

  const openMessages = (o) => {
    const p = new URLSearchParams();
    p.set('orderId', o.id);
    const yachtId = o.yacht_id || o.yacht_client_id;
    if (yachtId) p.set('yachtId', yachtId);
    navigate(`/supplier/messages?${p.toString()}`);
  };

  const exportCsv = () => {
    const head = ['Order', 'Yacht', 'Port', 'Received', 'Deliver by', 'Items', 'Flagged', 'Total', 'Currency', 'Status'];
    const rows = view.map(o => [
      '#' + o.id.slice(0, 8).toUpperCase(), yachtOf(o), o.delivery_port || '', fmtDate(o.created_at),
      fmtDate(o.delivery_date), o.supplier_order_items?.length ?? 0, flaggedCount(o),
      orderTotal(o).toFixed(2), o.currency || 'EUR', o.status,
    ]);
    const csv = [head, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `cargo-orders-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };

  return (
    <div className="sp-page">
      <div className="sp-page-head">
        <div>
          <p className="editorial-meta" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
            <span className="dot">●</span>
            <span>{outstanding} outstanding</span>
            <span className="bar" />
            <span className="muted">{fmtMoney0(totalValue, totalCur)} total</span>
            <span className="bar" />
            <span className="muted">{deliveriesToday} deliveries today</span>
            {flaggedOrders > 0 && <><span className="bar" /><span className="muted" style={{ color: 'var(--amber)' }}>{flaggedOrders} flagged</span></>}
            {rushCount > 0 && <><span className="bar" /><span className="muted" style={{ color: '#C65A1A' }}>{rushCount} rush</span></>}
          </p>
          <h1 className="editorial-greeting" style={{ fontSize: 46, letterSpacing: '-1px', margin: 0 }}>
            YOUR ORDERS <em>inbox</em>
          </h1>
          {sub && <p className="sp-page-sub" style={{ marginTop: 10 }}>{sub}</p>}
        </div>
      </div>

      {/* Desk toolbar: search · Rush/Flagged pills · Filter (status) · Sort */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 240px', minWidth: 180 }}>
          <Search size={14} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search order, yacht or port…"
            style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 12px 8px 32px', fontSize: 13, background: 'var(--card)', color: 'var(--fg)', fontFamily: 'inherit', boxSizing: 'border-box' }}
          />
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <TogglePill on={fRush} onClick={() => setFRush(v => !v)} Icon={Zap} label="Rush" tone="#C65A1A" />
          <TogglePill on={fFlagged} onClick={() => setFFlagged(v => !v)} Icon={Flag} label="Flagged" tone="var(--amber)" />
          <MenuSelect label="Filter" Icon={SlidersHorizontal} value={tab} options={TABS} onChange={setTab} />
          <MenuSelect label="Sort" Icon={ArrowUpDown} value={sortKey} options={SORTS} onChange={setSortKey} />
          <span style={{ width: 1, height: 22, background: 'var(--line)', margin: '0 2px' }} />
          <button type="button" onClick={exportCsv} disabled={view.length === 0} title="Export current view to CSV"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8, fontSize: 12.5, fontFamily: 'inherit', cursor: view.length === 0 ? 'default' : 'pointer', border: '1px solid var(--line)', background: 'var(--card)', color: 'var(--muted-s)', opacity: view.length === 0 ? 0.5 : 1 }}>
            <Download size={13} />Export
          </button>
          <button type="button" onClick={load} title="Refresh" aria-label="Refresh"
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 33, height: 33, borderRadius: 8, border: '1px solid var(--line)', background: 'var(--card)', color: 'var(--muted-s)', cursor: 'pointer' }}>
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: 'var(--red)' }}>
          {error}
        </div>
      )}

      {!loading && orders.length === 0 && (
        <EmptyState icon="📦" title={tab === 'all' ? 'No orders yet' : 'Nothing in this list'} body={tab === 'all' ? 'Orders placed by your yacht clients will appear here.' : 'Try another tab — orders move through as you work them.'} />
      )}

      {!loading && orders.length > 0 && view.length === 0 && (
        <div style={{ textAlign: 'center', padding: '36px 0', color: 'var(--muted-s)', fontSize: 13 }}>
          No orders match your search or filters. <button onClick={() => { setQuery(''); setFRush(false); setFFlagged(false); }} style={{ background: 'none', border: 'none', color: '#C65A1A', cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit', fontSize: 13 }}>Clear</button>
        </div>
      )}

      {view.length > 0 && (
        <div className="sp-table-wrap">
          <table className="sp-table" style={{ tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '13%' }} /><col style={{ width: '24%' }} /><col style={{ width: '14%' }} />
              <col style={{ width: '13%' }} /><col style={{ width: '13%' }} /><col style={{ width: '12%' }} /><col style={{ width: '11%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>Order</th>
                <th>Yacht</th>
                <th>Deliver by</th>
                <th>Items</th>
                <th style={{ textAlign: 'right' }}>Total</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }} />
              </tr>
            </thead>
            <tbody>
              {view.map(o => {
                const yacht = yachtOf(o);
                const tint = tintOf(yacht);
                const flagged = flaggedCount(o);
                const urg = deliverUrgency(o);
                const isNew = o.status === 'sent';
                return (
                  <tr key={o.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/supplier/orders/${o.id}`)}>
                    <td>
                      <div className="sp-line-name" style={{ fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace", fontSize: 12 }}>#{o.id.slice(0, 8).toUpperCase()}</div>
                      <div className="sp-line-sku">{fmtDate(o.created_at)}</div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ width: 30, height: 30, flexShrink: 0, borderRadius: 8, background: tint.bg, color: tint.fg, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>{initialsOf(yacht)}</span>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{yacht}</div>
                          {o.delivery_port && <div style={{ fontSize: 11.5, color: 'var(--muted-s)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.delivery_port}</div>}
                        </div>
                      </div>
                    </td>
                    <td>
                      <div style={{ fontSize: 13, fontWeight: urg ? 700 : 400, color: urg ? urg.tone : 'var(--fg-2)' }}>{fmtDate(o.delivery_date)}</div>
                      {urg
                        ? <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase', color: urg.tone, marginTop: 2 }}>{urg.label}</div>
                        : fmtTime(o.delivery_time) && <div style={{ fontSize: 11.5, color: 'var(--muted-s)' }}>{fmtTime(o.delivery_time)}</div>}
                    </td>
                    <td style={{ fontSize: 13 }}>
                      <span style={{ fontWeight: 600 }}>{o.supplier_order_items?.length ?? 0}</span> <span style={{ color: 'var(--muted-s)' }}>items</span>
                      {flagged > 0 && (
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10.5, color: 'var(--amber)', marginTop: 2 }}>
                          <AlertTriangle size={10} /> {flagged} flagged
                        </div>
                      )}
                    </td>
                    <td className="sp-amount" style={{ textAlign: 'right' }}>{fmtAmt(orderTotal(o), o.currency || 'EUR')}</td>
                    <td><StatusBadge status={o.status} /></td>
                    <td onClick={e => e.stopPropagation()} style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button className="sp-rb" title="Message this yacht" aria-label="Message this yacht" style={{ marginRight: 6 }} onClick={() => openMessages(o)}>
                        <MessageSquare size={13} />
                      </button>
                      <button
                        className={isNew ? 'sp-pill primary' : 'sp-pill'}
                        style={{ padding: '6px 12px', fontSize: 12, whiteSpace: 'nowrap' }}
                        onClick={() => navigate(`/supplier/orders/${o.id}`)}
                      >{isNew ? <>Review <ArrowRight size={11} /></> : 'View →'}</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {loading && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)', fontSize: 13 }}>Loading orders…</div>
      )}
    </div>
  );
};

export default SupplierOrders;
