// ─────────────────────────────────────────────────────────────────────────────
// Delivery History — editorial redesign.
// Sits inside the .di scope so all the shared design tokens and primitives
// from delivery-inbox.css (--di-rust / --di-sand / .di-card / .di-card-band /
// .di-chip / .di-btn) apply directly. Page-specific compositions live in
// delivery-history.css.
//
// PURELY VISUAL apart from one named data fix: the Top-supplier spend stat
// is now rendered with the same per-currency aware logic as the left-hand
// total (matches `summarySpendDisplay`). Previously it summed total_amount
// across currencies and labelled the result USD — wrong under mixed
// currency. All other data paths — fetch, filter, currency conversion,
// CSV export, delete, permission gating — are bit-for-bit unchanged.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../contexts/TenantContext';
import Header from '../../components/navigation/Header';
import Icon from '../../components/AppIcon';
import DeliveryBatchCard from './components/DeliveryBatchCard';
import { EditorialDatePicker } from '../../components/editorial';
import { useCountUp } from './components/SummaryGauges';
import './delivery-inbox.css';
import '../../styles/editorial.css';
import './delivery-history.css';

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtDate = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return '—'; }
};

const fmtTime = (iso) => {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
};

const fmtMoney = (amount, currency) => {
  if (amount == null || isNaN(parseFloat(amount))) return null;
  const sym = currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '$';
  return `${sym}${parseFloat(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const dayKey = (iso) => (iso ? iso.slice(0, 10) : 'unknown');

// Source-type → label + bottom-edge accent colour (rust / amber / sage /
// sand). Same conceptual mapping as before but now exposed as raw hex
// values so DeliveryBatchCard can apply them directly via inline style
// (no longer routes through the .dh-entry-{rust,amber,sage,sand} CSS).
const SOURCE_CFG = {
  delivery:      { label: 'Delivery', accentBorder: '#C65A1A', chipBg: 'rgba(198,90,26,0.12)',  chipFg: '#9B4615' },
  receipt:       { label: 'Receipt',  accentBorder: '#D97706', chipBg: 'rgba(217,119,6,0.12)',  chipFg: '#92400E' },
  shopping_trip: { label: 'Shopping', accentBorder: '#1D9E75', chipBg: 'rgba(30,158,117,0.12)', chipFg: '#0F6E56' },
  manual:        { label: 'Manual',   accentBorder: '#94A3B8', chipBg: 'rgba(148,163,184,0.16)', chipFg: '#475569' },
};

const CLAIM_CFG = {
  claimed:   { label: 'Claimed',   className: 'dh-claim dh-claim-claimed'   },
  unclaimed: { label: 'Unclaimed', className: 'dh-claim dh-claim-unclaimed' },
  returned:  { label: 'Returned',  className: 'dh-claim dh-claim-returned'  },
};

// Frankfurter v2 returns an array of {base, quote, rate} objects.
// Convert to a simple { QUOTE: rate } map, with rates[toCurrency] = 1 (self).
const fetchFxRates = async (toCurrency) => {
  const res = await fetch(`https://api.frankfurter.dev/v2/rates?base=${toCurrency}&quotes=USD,EUR,GBP`);
  if (!res.ok) throw new Error(`FX fetch failed: ${res.status}`);
  const json = await res.json();
  const rates = {};
  if (Array.isArray(json)) {
    json.forEach(r => { if (r.quote) rates[r.quote] = r.rate; });
  } else if (json?.rates && typeof json.rates === 'object') {
    Object.assign(rates, json.rates); // fallback: old object shape
  }
  rates[toCurrency] = 1;
  return rates;
};

// ── Sub-components ────────────────────────────────────────────────────────────

const SourceChip = ({ type }) => {
  const cfg = SOURCE_CFG[type] || SOURCE_CFG.manual;
  return <span className={`dh-source-chip ${cfg.chipClass}`}>{cfg.label}</span>;
};

const ClaimBadge = ({ status }) => {
  const cfg = CLAIM_CFG[status] || CLAIM_CFG.unclaimed;
  return <span className={cfg.className}>{cfg.label}</span>;
};

const LedgerItemRow = ({ item, currency }) => (
  <div className="dh-item-row">
    <div>
      <p className="dh-item-name">{item.name}</p>
      {item.original_name && item.original_name !== item.name && (
        <p className="dh-item-original">{item.original_name}</p>
      )}
      {item.item_reference && (
        <p className="dh-item-ref">Ref: {item.item_reference}</p>
      )}
    </div>
    <p className="dh-item-cell num">
      {item.quantity ?? '—'}{item.unit ? ` ${item.unit}` : ''}
    </p>
    <p className="dh-item-cell num">
      {fmtMoney(item.unit_price, currency || 'USD') || '—'}
    </p>
    <p className="dh-item-cell num total">
      {fmtMoney(item.total_price, currency || 'USD') || '—'}
    </p>
    <div style={{ textAlign: 'right' }}>
      <ClaimBadge status={item.claim_status} />
    </div>
  </div>
);

const LedgerEntry = ({ entry, userNames, boardNames, expanded, onToggle, onDelete, onNavigate }) => {
  const cfg = SOURCE_CFG[entry.source_type] || SOURCE_CFG.manual;
  const receivedByName = userNames[entry.received_by] || null;
  const currency = entry.currency || 'USD';
  const boardName = entry.source_board_id ? boardNames[entry.source_board_id] : null;
  const displayTotal = fmtMoney(entry.total_amount, currency);
  const itemCount = entry._itemCount ?? 0;

  const metaParts = [
    fmtTime(entry.created_at),
    entry.order_ref ? `Ref ${entry.order_ref}` : null,
    receivedByName,
    boardName,
    `${itemCount} item${itemCount !== 1 ? 's' : ''}`,
    displayTotal,
  ].filter(Boolean);

  return (
    <DeliveryBatchCard
      supplierName={entry.supplier_name || 'Manual receive'}
      sourceLabel={cfg.label}
      sourceChipBg={cfg.chipBg}
      sourceChipFg={cfg.chipFg}
      accentBorder={cfg.accentBorder}
      metaParts={metaParts}
      chevron={expanded}
      onClick={onToggle}
      rightSlot={
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {entry.source_board_id && (
            <button
              onClick={e => { e.stopPropagation(); onNavigate(entry.source_board_id); }}
              style={{
                background: 'none', border: 0, padding: 0, cursor: 'pointer',
                fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
                fontSize: 11, fontWeight: 600,
                color: '#C65A1A', whiteSpace: 'nowrap',
              }}
            >View board →</button>
          )}
          {entry.document_url && (
            <a
              href={entry.document_url}
              target="_blank"
              rel="noreferrer"
              onClick={e => e.stopPropagation()}
              title="View document"
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 28, height: 28, borderRadius: 6, color: '#94A3B8',
                textDecoration: 'none',
              }}
            >
              <Icon name="FileText" style={{ width: 14, height: 14 }} />
            </a>
          )}
          {itemCount === 0 && (
            <button
              onClick={e => { e.stopPropagation(); onDelete(entry.id); }}
              title="Delete empty entry"
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 28, height: 28, borderRadius: 6, color: '#94A3B8',
                background: 'none', border: 0, cursor: 'pointer',
              }}
            >
              <Icon name="Trash2" style={{ width: 13, height: 13 }} />
            </button>
          )}
        </div>
      }
    >
      {expanded && (
        <div onClick={e => e.stopPropagation()}>
          <div className="dh-items-header">
            <p className="dh-items-header-cell">Item</p>
            <p className="dh-items-header-cell num">Qty</p>
            <p className="dh-items-header-cell num">Unit Price</p>
            <p className="dh-items-header-cell num">Total</p>
            <p className="dh-items-header-cell num">Status</p>
          </div>

          {entry._items?.length > 0
            ? entry._items.map(item => (
                <LedgerItemRow
                  key={item.id}
                  item={item}
                  currency={currency}
                />
              ))
            : <p className="dh-item-empty">No items recorded</p>
          }
        </div>
      )}
    </DeliveryBatchCard>
  );
};

// ── Spend hero ────────────────────────────────────────────────────────────────
// summarySpendDisplay is built upstream (per-currency segments string OR a
// single converted figure). topSupplierSpendDisplay follows the SAME pattern
// for currency correctness — see derivation in the page component below.

function SummaryCards({
  summarySpendDisplay,
  summaryCount,
  topSupplier,
  topSupplierSpendDisplay,   // string, already currency-aware (multi-segment if mixed)
  topSupplierItems,
  convCurrency,
  fxLoading,
  onConvChange,
}) {
  const animCount = useCountUp(summaryCount, 150);

  // Render the total as either:
  //   • a single big number (DM Serif), when convCurrency is set, OR
  //   • a flex row of per-currency segments separated by · (when 'original').
  // Both come in as one prepared string from the parent; split on ' · '
  // here just for visual segmentation so each currency reads as its own
  // unit instead of one runaway number.
  const totalIsMultiSegment = convCurrency === 'original' && summarySpendDisplay.includes(' · ');
  const totalSegments = totalIsMultiSegment ? summarySpendDisplay.split(' · ') : null;

  const supplierIsMultiSegment = topSupplierSpendDisplay && topSupplierSpendDisplay.includes(' · ');
  const supplierSegments = supplierIsMultiSegment ? topSupplierSpendDisplay.split(' · ') : null;

  return (
    <div className="dh-hero">
      {/* Left — Total Spend */}
      <div className="dh-hero-primary">
        <p className="dh-hero-label">Total spend</p>
        <p className="dh-hero-amount">
          {totalIsMultiSegment ? (
            <span className="dh-hero-amount-segments">
              {totalSegments.map((seg, i) => (
                <React.Fragment key={seg + i}>
                  {i > 0 && <span className="dh-hero-amount-sep">·</span>}
                  <span>{seg}</span>
                </React.Fragment>
              ))}
            </span>
          ) : (
            summarySpendDisplay
          )}
        </p>
        <div className="dh-currency-toggle">
          {['Original', 'EUR', 'USD', 'GBP'].map(opt => {
            const val = opt === 'Original' ? 'original' : opt;
            const active = convCurrency === val;
            return (
              <button
                key={opt}
                onClick={() => { if (!fxLoading) onConvChange(val); }}
                disabled={fxLoading && !active}
                className={`dh-currency-pill${active ? ' is-active' : ''}`}
              >{opt}</button>
            );
          })}
        </div>
      </div>

      {/* Right — stats row */}
      <div className="dh-hero-stats">
        {/* Received count */}
        <div className="dh-hero-stat">
          <p className="dh-hero-stat-count">{Math.round(animCount)}</p>
          <p className="dh-hero-stat-label">received</p>
        </div>

        <div className="dh-hero-divider" />

        {/* Top supplier — spend slot is multi-segment-capable from the start */}
        <div className="dh-hero-stat dh-hero-stat-supplier">
          <p className="dh-hero-stat-label">Top supplier</p>
          <p className="dh-hero-stat-supplier-name">{topSupplier || '—'}</p>
          {topSupplierSpendDisplay && (
            <p className="dh-hero-stat-supplier-spend">
              {supplierIsMultiSegment ? (
                supplierSegments.map((seg, i) => (
                  <React.Fragment key={seg + i}>
                    {i > 0 && <span className="dh-hero-stat-supplier-sep">·</span>}
                    <span>{seg}</span>
                  </React.Fragment>
                ))
              ) : (
                <span>{topSupplierSpendDisplay}</span>
              )}
            </p>
          )}
          {topSupplierItems > 0 && (
            <p className="dh-hero-stat-supplier-items">
              {topSupplierItems} item{topSupplierItems !== 1 ? 's' : ''}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DeliveryHistory() {
  const navigate = useNavigate();
  const { user, tenantRole } = useAuth();
  const { activeTenantId } = useTenant();

  const userTier = (tenantRole || '').toUpperCase();
  const hasAccess = userTier === 'COMMAND' || userTier === 'CHIEF';

  const params = new URLSearchParams(window.location.search);
  const boardParam = params.get('board') || '';

  // All hooks must be called unconditionally before any early return
  const [entries, setEntries]         = useState([]);
  const [loading, setLoading]         = useState(true);
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [userNames, setUserNames]     = useState({});
  const [boardNames, setBoardNames]   = useState({});

  // Filters
  const [search, setSearch]         = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [dateFrom, setDateFrom]     = useState('');
  const [dateTo, setDateTo]         = useState('');

  // Currency conversion
  const [convCurrency, setConvCurrency] = useState('original');
  const [fxLoading, setFxLoading]       = useState(false);
  const fxCacheRef = useRef({}); // { 'USD': { EUR: 0.92, GBP: 0.79 }, ... }

  const load = useCallback(async () => {
    if (!activeTenantId) return;
    setLoading(true);

    let query = supabase
      ?.from('delivery_ledger')
      ?.select('*, delivery_ledger_items(*)')
      ?.eq('tenant_id', activeTenantId)
      ?.order('created_at', { ascending: false });

    if (boardParam) query = query?.eq('source_board_id', boardParam);

    const { data, error } = await query;
    if (error) { console.error('[DeliveryHistory] fetch error:', error); setLoading(false); return; }

    const rows = (data || []).map(e => ({
      ...e,
      _items:     e.delivery_ledger_items || [],
      _itemCount: (e.delivery_ledger_items || []).length,
    }));

    setEntries(rows);

    const uids = [...new Set(rows.map(e => e.received_by).filter(Boolean))];
    if (uids.length > 0) {
      const { data: profiles } = await supabase?.from('profiles')?.select('id, full_name')?.in('id', uids);
      const map = {};
      (profiles || []).forEach(p => { map[p.id] = p.full_name; });
      setUserNames(map);
    }

    const bids = [...new Set(rows.map(e => e.source_board_id).filter(Boolean))];
    if (bids.length > 0) {
      const { data: boards } = await supabase?.from('provisioning_lists')?.select('id, title')?.in('id', bids);
      const map = {};
      (boards || []).forEach(b => { map[b.id] = b.title; });
      setBoardNames(map);
    }

    setLoading(false);
  }, [activeTenantId, boardParam]);

  useEffect(() => { load(); }, [load]);

  // Permission check after all hooks
  if (!hasAccess) {
    return (
      <div className="di dh-blocked">
        <div className="dh-blocked-card">
          <p className="dh-blocked-title">You don&rsquo;t have permission to view this page.</p>
          <p className="dh-blocked-body">Delivery History is available to Command and Chief officers only.</p>
          <button onClick={() => navigate('/provisioning')} className="dh-blocked-back">
            ← Back to Provisioning
          </button>
        </div>
      </div>
    );
  }

  const toggleEntry = (id) => setExpandedIds(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  // ── Currency conversion ────────────────────────────────────────────────────
  const handleConvCurrencyChange = async (toCurrency) => {
    setConvCurrency(toCurrency);
    if (toCurrency === 'original' || fxCacheRef.current[toCurrency]) return;
    setFxLoading(true);
    try {
      const rates = await fetchFxRates(toCurrency);
      fxCacheRef.current[toCurrency] = rates;
    } catch (err) {
      console.error('[DeliveryHistory] FX fetch error:', err);
    } finally {
      setFxLoading(false);
    }
  };


  // ── Delete empty entry ────────────────────────────────────────────────────
  const handleDelete = async (id) => {
    const { error, count } = await supabase
      ?.from('delivery_ledger')
      ?.delete({ count: 'exact' })
      ?.eq('id', id);
    if (error) { console.error('[DeliveryHistory] delete error:', error); return; }
    if (count === 0) {
      console.warn('[DeliveryHistory] delete blocked — check RLS policy. Run: CREATE POLICY "tenant members can delete delivery_ledger" ON delivery_ledger FOR DELETE USING (tenant_id IN (SELECT tenant_id FROM tenant_members WHERE user_id = auth.uid()));');
      return;
    }
    setEntries(prev => prev.filter(e => e.id !== id));
  };

  // ── Export CSV ────────────────────────────────────────────────────────────
  const exportCSV = () => {
    const COLS = ['Date', 'Time', 'Supplier', 'Type', 'Item Name', 'Original Name', 'Qty', 'Unit', 'Unit Price', 'Total Price', 'Currency', 'Claim Status', 'Received By'];
    const rows = [COLS];
    for (const entry of filtered) {
      const date      = entry.created_at ? new Date(entry.created_at).toLocaleDateString('en-GB') : '';
      const time      = fmtTime(entry.created_at);
      const supplier  = entry.supplier_name || 'Manual receive';
      const type      = SOURCE_CFG[entry.source_type]?.label || entry.source_type || '';
      const currency  = entry.currency || 'USD';
      const recvBy    = userNames[entry.received_by] || '';
      if (entry._items?.length > 0) {
        for (const item of entry._items) {
          rows.push([date, time, supplier, type, item.name || '', item.original_name || '',
            item.quantity ?? '', item.unit || '', item.unit_price ?? '', item.total_price ?? '',
            currency, item.claim_status || '', recvBy]);
        }
      } else {
        rows.push([date, time, supplier, type, '', '', '', '', '', '', currency, '', recvBy]);
      }
    }
    const csv = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `delivery-history-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Filtering + grouping ──────────────────────────────────────────────────
  const filtered = entries.filter(e => {
    if (typeFilter !== 'all' && e.source_type !== typeFilter) return false;
    if (search && !(e.supplier_name || '').toLowerCase().includes(search.toLowerCase())) return false;
    if (dateFrom && e.created_at < `${dateFrom}T00:00:00`) return false;
    if (dateTo   && e.created_at > `${dateTo}T23:59:59`)   return false;
    return true;
  });

  // ── Summary (always reflects current filtered results) ────────────────────
  const summaryCount = filtered.length;

  // Per-currency totals for Original display (e.g. "€59.80 · $45.00")
  const perCurrencyTotals = {};
  filtered.forEach(e => {
    const curr = e.currency || 'USD';
    const amt = parseFloat(e.total_amount) || 0;
    if (amt > 0) perCurrencyTotals[curr] = (perCurrencyTotals[curr] || 0) + amt;
  });

  // Converted total: sum each entry converted to the target currency
  const convRates = convCurrency !== 'original' ? (fxCacheRef.current[convCurrency] || null) : null;
  const summarySpendConverted = filtered.reduce((s, e) => {
    const amt = parseFloat(e.total_amount) || 0;
    if (!convRates) return s + amt;
    const fromCurr = e.currency || 'USD';
    const rate = convRates[fromCurr];
    return s + (rate ? amt / rate : amt);
  }, 0);

  // What to display in the Total Spend card
  const summarySpendDisplay = convCurrency !== 'original'
    ? (summarySpendConverted > 0 ? fmtMoney(summarySpendConverted, convCurrency) : '—')
    : (Object.entries(perCurrencyTotals)
        .sort((a, b) => b[1] - a[1])
        .map(([curr, amt]) => fmtMoney(amt, curr))
        .join(' · ') || '—');

  // ── Supplier totals + top supplier (CURRENCY-CORRECT) ──────────────────────
  // Per-supplier per-currency breakdown: { [supplier]: { [currency]: amt } }.
  // Replaces the old single-number-summed-across-currencies aggregation that
  // displayed the result as USD regardless of input currencies.
  const supplierTotalsByCurrency = {};
  const supplierItemCounts = {};
  filtered.forEach(e => {
    const n = e.supplier_name || 'Manual receive';
    const curr = e.currency || 'USD';
    const amt = parseFloat(e.total_amount) || 0;
    if (!supplierTotalsByCurrency[n]) supplierTotalsByCurrency[n] = {};
    if (amt > 0) supplierTotalsByCurrency[n][curr] = (supplierTotalsByCurrency[n][curr] || 0) + amt;
    supplierItemCounts[n] = (supplierItemCounts[n] || 0) + (e._itemCount || 0);
  });

  // Ranking score per supplier — converted when fx rates are loaded, sum-as-
  // if-same-units fallback when in 'original' mode (matches the pre-existing
  // ranking behaviour; only the display side changes).
  const supplierRankingScore = (name) => {
    const byCurr = supplierTotalsByCurrency[name] || {};
    if (convRates) {
      return Object.entries(byCurr).reduce((s, [curr, amt]) => {
        const rate = convRates[curr];
        return s + (rate ? amt / rate : amt);
      }, 0);
    }
    return Object.values(byCurr).reduce((s, amt) => s + amt, 0);
  };
  const topSupplier = Object.keys(supplierTotalsByCurrency)
    .sort((a, b) => supplierRankingScore(b) - supplierRankingScore(a))[0] || null;
  const topSupplierItems = topSupplier ? (supplierItemCounts[topSupplier] || 0) : 0;

  // Top supplier spend display — same currency logic as the left total.
  let topSupplierSpendDisplay = '';
  if (topSupplier) {
    const byCurr = supplierTotalsByCurrency[topSupplier];
    if (convCurrency !== 'original' && convRates) {
      const converted = Object.entries(byCurr).reduce((s, [curr, amt]) => {
        const rate = convRates[curr];
        return s + (rate ? amt / rate : amt);
      }, 0);
      topSupplierSpendDisplay = converted > 0 ? fmtMoney(converted, convCurrency) : '';
    } else {
      topSupplierSpendDisplay = Object.entries(byCurr)
        .sort((a, b) => b[1] - a[1])
        .map(([curr, amt]) => fmtMoney(amt, curr))
        .join(' · ');
    }
  }


  const grouped = filtered.reduce((acc, e) => {
    const key = dayKey(e.created_at);
    if (!acc[key]) acc[key] = { label: fmtDate(e.created_at), entries: [] };
    acc[key].entries.push(e);
    return acc;
  }, {});
  const days = Object.entries(grouped).sort((a, b) => b[0].localeCompare(a[0]));

  const totalItems = filtered.reduce((s, e) => s + (e._itemCount || 0), 0);

  return (
    <>
      <Header />
      {/* .di scope brings the delivery-inbox/history styling tokens (chips,
          cards, source-pill colours). Its underlying token block now resolves
          cool (--di-cream === --d-bg) post cool-surface migration, so the
          Sent/Delivered tab transition reads as one surface with no inline
          override required. */}
      <div className="di">
        {/* Back to boards — matches the Orders index's button. Sits above
            the editorial topbar so it's clearly nav, not content. */}
        {/* Same max-width as .dh-topbar-inner (1240px) so the back button
            aligns with the headline and table columns below. */}
        <div style={{ maxWidth: 1240, margin: '0 auto', padding: '24px 32px 0' }}>
          <button
            onClick={() => navigate('/provisioning')}
            style={{
              background: 'none', border: 0, padding: 0, cursor: 'pointer',
              fontSize: 12, fontWeight: 600, color: 'var(--d-muted)',
              letterSpacing: '0.08em', textTransform: 'uppercase',
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontFamily: 'inherit',
            }}
          >
            <Icon name="ChevronLeft" size={14} strokeWidth={1.5} />
            Back to boards
          </button>
        </div>
        {/* DH's dh-topbar-inner already provides 22px top padding (see
            delivery-history.css), so the back-button container above
            uses padding-bottom: 0 and 0 marginBottom — the 22px gap
            between back-to-boards and the tab strip lands identically
            to the Orders index (where back button has marginBottom:22
            instead). */}

        {/* ── Topbar (breadcrumb + editorial header + filters) ── */}
        {/* Inline-overriding .dh-topbar's border-bottom (which runs full
            viewport width) so the separator under the filter bar is short
            (within the 1240px column) — matches the Sent page. The
            actual hairline is added below as borderBottom on the
            filter row container. */}
        <div className="dh-topbar" style={{ borderBottom: 'none' }}>
          <div className="dh-topbar-inner">

          {/* Editorial header — meta strip + serif headline. Mirrors the
              Orders index: back / meta / headline above, tabs below. */}
          <div className="di-headblock">
            <p className="editorial-meta">
              <span className="dot">●</span>
              <span>Delivery History</span>
              <span className="bar" />
              <span className="muted">Permanent vessel record</span>
              {!loading && filtered.length > 0 && (
                <>
                  <span className="bar" />
                  <span className="muted">{filtered.length} deliver{filtered.length === 1 ? 'y' : 'ies'}</span>
                  <span className="bar" />
                  <span className="muted">{totalItems} item{totalItems === 1 ? '' : 's'}</span>
                </>
              )}
            </p>
            <h1 className="editorial-greeting">
              DELIVERIES<span className="period">,</span> <em>on record</em><span className="period">.</span>
            </h1>
          </div>

          {/* Tab strip — sits BETWEEN the editorial header and the filter
              row. Boundary between editorial chrome and content controls.
              Same position as the Sent tab so the toggle is a content swap. */}
          <div style={{
            display: 'flex', gap: 4, marginBottom: 18,
            borderBottom: '1px solid rgba(38, 42, 83, 0.10)',
          }}>
            <button
              onClick={() => navigate('/provisioning/orders')}
              style={{
                padding: '10px 18px', background: 'none', border: 0,
                borderBottom: '2px solid transparent',
                fontFamily: 'inherit', fontSize: 13.5, fontWeight: 500,
                color: 'rgba(38, 42, 83, 0.55)', cursor: 'pointer', marginBottom: -1,
                transition: 'color 120ms ease',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = '#262A53'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'rgba(38, 42, 83, 0.55)'; }}
            >Sent</button>
            <button
              style={{
                padding: '10px 18px', background: 'none', border: 0,
                borderBottom: '2px solid #C65A1A',
                fontFamily: 'inherit', fontSize: 13.5, fontWeight: 600,
                color: '#262A53', cursor: 'default', marginBottom: -1,
              }}
              aria-current="page"
            >Delivered</button>
          </div>

          {/* Filter bar — short hairline beneath matches the Sent page. */}
          <div
            className="dh-filter-bar"
            style={{ paddingBottom: 16, borderBottom: '0.5px solid var(--di-hairline)' }}
          >
            <div className="dh-filter-search">
              <Icon name="Search" className="dh-filter-search-icon" />
              <input
                type="text"
                placeholder="Search supplier…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="dh-filter-input"
              />
            </div>

            <select
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value)}
              className="dh-filter-select"
            >
              <option value="all">All types</option>
              <option value="delivery">Deliveries</option>
              <option value="receipt">Receipts</option>
              <option value="shopping_trip">Shopping trips</option>
              <option value="manual">Manual</option>
            </select>

            <div className="dh-filter-datepicker">
              <EditorialDatePicker
                value={dateFrom}
                onChange={setDateFrom}
                placeholder="From date"
                ariaLabel="From date"
              />
            </div>
            <div className="dh-filter-datepicker">
              <EditorialDatePicker
                value={dateTo}
                onChange={setDateTo}
                placeholder="To date"
                ariaLabel="To date"
              />
            </div>

            {(search || typeFilter !== 'all' || dateFrom || dateTo) && (
              <button
                onClick={() => { setSearch(''); setTypeFilter('all'); setDateFrom(''); setDateTo(''); }}
                className="dh-filter-clear"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Main column ── */}
      {/* .dh-main's default padding-top: 28px (delivery-history.css) was
          opening too wide a gap below the filter-row separator. Tightened
          to 4px so the "N deliveries · M items" toolbar sits close to the
          separator line — Lauren explicitly asked for the text to move
          UP, not the line down. */}
      <div className="dh-main" style={{ paddingTop: 4 }}>

        {/* Toolbar: count + Export CSV */}
        {!loading && filtered.length > 0 && (
          <div className="dh-toolbar">
            <p className="dh-toolbar-count">
              {filtered.length} {filtered.length === 1 ? 'delivery' : 'deliveries'} · {totalItems} items
            </p>
            <button onClick={exportCSV} className="di-btn di-btn-ghost">
              <Icon name="Download" style={{ width: 13, height: 13, marginRight: 6 }} />
              Export CSV
            </button>
          </div>
        )}

        {/* ── Summary cards (reflect current filter) ── */}
        {!loading && summaryCount > 0 && (
          <SummaryCards
            summarySpendDisplay={summarySpendDisplay}
            summaryCount={summaryCount}
            topSupplier={topSupplier}
            topSupplierSpendDisplay={topSupplierSpendDisplay}
            topSupplierItems={topSupplierItems}
            convCurrency={convCurrency}
            fxLoading={fxLoading}
            onConvChange={handleConvCurrencyChange}
          />
        )}

        {/* ── Entry list ── */}
        {loading ? (
          <div className="dh-loading">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="di-empty-card">
            <div className="di-empty-tile"><Icon name="BookOpen" style={{ width: 20, height: 20 }} /></div>
            <h2 className="di-empty-headline">
              No deliveries recorded<span className="di-empty-period">.</span>
            </h2>
            <p className="di-empty-text">
              {search || typeFilter !== 'all' || dateFrom || dateTo
                ? 'No deliveries match your filters.'
                : 'Deliveries will appear here when items are received.'}
            </p>
          </div>
        ) : (
          days.map(([day, { label, entries: dayEntries }]) => (
            <div key={day} className="dh-day-section">
              <p className="dh-day-label">{label}</p>
              {dayEntries.map(entry => (
                <LedgerEntry
                  key={entry.id}
                  entry={entry}
                  userNames={userNames}
                  boardNames={boardNames}
                  expanded={expandedIds.has(entry.id)}
                  onToggle={() => toggleEntry(entry.id)}
                  onDelete={handleDelete}
                  onNavigate={(boardId) => navigate(`/provisioning/${boardId}`)}
                />
              ))}
            </div>
          ))
        )}
      </div>
      </div>
    </>
  );
}
