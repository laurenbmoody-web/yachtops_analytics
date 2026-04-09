import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../contexts/TenantContext';
import Icon from '../../components/AppIcon';
import { useCountUp } from './components/SummaryGauges';

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

const SOURCE_LABELS = {
  delivery:      { label: 'Delivery',      bg: '#E6F1FB', text: '#185FA5', border: '#BFDBFE' },
  receipt:       { label: 'Receipt',       bg: '#FEF3E2', text: '#B45309', border: '#FDE68A' },
  shopping_trip: { label: 'Shopping',      bg: '#F0FDF4', text: '#065F46', border: '#BBF7D0' },
  manual:        { label: 'Manual',        bg: '#F8FAFC', text: '#475569', border: '#E2E8F0' },
};

const CLAIM_LABELS = {
  claimed:   { label: 'Claimed',   color: '#059669' },
  unclaimed: { label: 'Unclaimed', color: '#94A3B8' },
  returned:  { label: 'Returned',  color: '#DC2626' },
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

const SourceBadge = ({ type }) => {
  const cfg = SOURCE_LABELS[type] || SOURCE_LABELS.manual;
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
      background: cfg.bg, color: cfg.text, border: `1px solid ${cfg.border}`,
      whiteSpace: 'nowrap', flexShrink: 0,
    }}>
      {cfg.label}
    </span>
  );
};

const ClaimBadge = ({ status }) => {
  const cfg = CLAIM_LABELS[status] || CLAIM_LABELS.unclaimed;
  return (
    <span style={{ fontSize: 10, color: cfg.color, fontWeight: 600 }}>{cfg.label}</span>
  );
};

const LedgerItemRow = ({ item, currency }) => (
  <div style={{
    display: 'grid', gridTemplateColumns: '1fr 60px 80px 80px 90px',
    gap: 8, padding: '7px 0',
    borderBottom: '1px solid #F8FAFC', alignItems: 'start',
  }}>
    <div style={{ minWidth: 0 }}>
      <p style={{ margin: 0, fontSize: 12, fontWeight: 500, color: '#0F172A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {item.name}
      </p>
      {item.original_name && item.original_name !== item.name && (
        <p style={{ margin: '1px 0 0', fontSize: 10, color: '#94A3B8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.original_name}
        </p>
      )}
      {item.item_reference && (
        <p style={{ margin: '1px 0 0', fontSize: 10, color: '#CBD5E1' }}>Ref: {item.item_reference}</p>
      )}
    </div>
    <p style={{ margin: 0, fontSize: 12, color: '#475569', textAlign: 'center' }}>
      {item.quantity ?? '—'}{item.unit ? ` ${item.unit}` : ''}
    </p>
    <p style={{ margin: 0, fontSize: 12, color: '#475569', textAlign: 'right' }}>
      {fmtMoney(item.unit_price, currency || 'USD') || '—'}
    </p>
    <p style={{ margin: 0, fontSize: 12, fontWeight: 500, color: '#0F172A', textAlign: 'right' }}>
      {fmtMoney(item.total_price, currency || 'USD') || '—'}
    </p>
    <div style={{ textAlign: 'right' }}>
      <ClaimBadge status={item.claim_status} />
    </div>
  </div>
);

const LedgerEntry = ({ entry, userNames, boardNames, expanded, onToggle, onDelete, onNavigate }) => {
  const receivedByName = userNames[entry.received_by] || null;
  const sourceCfg = SOURCE_LABELS[entry.source_type] || SOURCE_LABELS.manual;
  const currency = entry.currency || 'USD';
  const boardName = entry.source_board_id ? boardNames[entry.source_board_id] : null;
  const displayTotal = fmtMoney(entry.total_amount, currency);

  return (
    <div style={{
      background: 'white', borderRadius: 10, border: '1px solid #E2E8F0',
      boxShadow: '0 1px 3px rgba(0,0,0,0.04)', overflow: 'hidden',
      marginBottom: 10,
    }}>
      {/* Header row */}
      <div
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
          cursor: 'pointer', userSelect: 'none',
          borderLeft: `3px solid ${sourceCfg.border}`,
        }}
      >
        <Icon name={expanded ? 'ChevronDown' : 'ChevronRight'} style={{ width: 14, height: 14, color: '#94A3B8', flexShrink: 0 }} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#0F172A' }}>
              {entry.supplier_name || 'Manual receive'}
            </p>
            <SourceBadge type={entry.source_type} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 2 }}>
            <p style={{ margin: 0, fontSize: 11, color: '#94A3B8' }}>
              {fmtTime(entry.created_at)}
              {entry.order_ref ? ` · Ref: ${entry.order_ref}` : ''}
              {receivedByName ? ` · ${receivedByName}` : ''}
              {boardName ? ` · ${boardName}` : ''}
            </p>
            {entry.source_board_id && (
              <button
                onClick={e => { e.stopPropagation(); onNavigate(entry.source_board_id); }}
                style={{ fontSize: 11, color: '#1E3A5F', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline', flexShrink: 0 }}
              >
                View board →
              </button>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <div style={{ textAlign: 'right' }}>
            <p style={{ margin: 0, fontSize: 12, color: '#475569' }}>
              {entry._itemCount ?? 0} item{(entry._itemCount ?? 0) !== 1 ? 's' : ''}
            </p>
            {displayTotal && (
              <p style={{ margin: '1px 0 0', fontSize: 12, fontWeight: 600, color: '#0F172A' }}>
                {displayTotal}
              </p>
            )}
          </div>

          {entry.document_url && (
            <a
              href={entry.document_url}
              target="_blank"
              rel="noreferrer"
              onClick={e => e.stopPropagation()}
              style={{ color: '#94A3B8', flexShrink: 0 }}
              title="View document"
            >
              <Icon name="FileText" style={{ width: 14, height: 14 }} />
            </a>
          )}

          {/* Delete only shown on 0-item entries */}
          {(entry._itemCount ?? 0) === 0 && (
            <button
              onClick={e => { e.stopPropagation(); onDelete(entry.id); }}
              title="Delete empty entry"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#CBD5E1', padding: '2px 4px', flexShrink: 0, lineHeight: 1 }}
              onMouseEnter={e => { e.currentTarget.style.color = '#EF4444'; }}
              onMouseLeave={e => { e.currentTarget.style.color = '#CBD5E1'; }}
            >
              <Icon name="Trash2" style={{ width: 13, height: 13 }} />
            </button>
          )}
        </div>
      </div>

      {/* Expanded: line items */}
      {expanded && (
        <div style={{ borderTop: '1px solid #F1F5F9', padding: '0 16px 12px' }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 60px 80px 80px 90px',
            gap: 8, padding: '8px 0 4px',
          }}>
            {['Item', 'Qty', 'Unit Price', 'Total', 'Status'].map(h => (
              <p key={h} style={{ margin: 0, fontSize: 9, fontWeight: 700, color: '#CBD5E1', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: h !== 'Item' ? 'right' : 'left' }}>
                {h}
              </p>
            ))}
          </div>

          {entry._items?.length > 0
            ? entry._items.map(item => (
                <LedgerItemRow
                  key={item.id}
                  item={item}
                  currency={currency}
                />
              ))
            : <p style={{ margin: '12px 0', fontSize: 12, color: '#94A3B8', textAlign: 'center' }}>No items recorded</p>
          }
        </div>
      )}
    </div>
  );
};

// ── Summary banner ────────────────────────────────────────────────────────────

function SummaryCards({
  summarySpendDisplay,
  summaryCount, topSupplier, topSupplierSpend, topSupplierItems,
  convCurrency, fxLoading, onConvChange,
}) {
  const animCount = useCountUp(summaryCount, 150);

  return (
    <div style={{
      background: '#1E3A5F', borderRadius: 16, padding: '28px 32px',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      marginBottom: 28,
    }}>

      {/* Left — Total Spend */}
      <div>
        <p style={{ margin: '0 0 6px', fontSize: 11, color: '#93C5FD', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 500 }}>
          Total spend
        </p>
        <p style={{ margin: 0, fontSize: 36, fontWeight: 500, color: 'white', letterSpacing: '-1px', lineHeight: 1 }}>
          {summarySpendDisplay}
        </p>
        <div style={{ display: 'inline-flex', background: 'rgba(255,255,255,0.1)', borderRadius: 20, padding: 2, marginTop: 14 }}>
          {['Original', 'EUR', 'USD', 'GBP'].map(opt => {
            const val = opt === 'Original' ? 'original' : opt;
            const active = convCurrency === val;
            return (
              <button key={opt} onClick={() => { if (!fxLoading) onConvChange(val); }} style={{
                padding: '5px 16px', borderRadius: 18, border: 'none',
                fontSize: 11, fontWeight: active ? 600 : 500,
                cursor: fxLoading ? 'default' : 'pointer',
                background: active ? 'white' : 'transparent',
                color: active ? '#1E3A5F' : '#93C5FD',
                transition: 'all 0.15s',
                opacity: fxLoading && !active ? 0.5 : 1,
              }}>{opt}</button>
            );
          })}
        </div>
      </div>

      {/* Right — stats row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>

        {/* Received count */}
        <div style={{ textAlign: 'center' }}>
          <p style={{ margin: 0, fontSize: 32, fontWeight: 500, color: 'white', lineHeight: 1 }}>
            {Math.round(animCount)}
          </p>
          <p style={{ margin: '5px 0 0', fontSize: 11, color: '#93C5FD' }}>received</p>
        </div>

        {/* Divider */}
        <div style={{ width: 1, background: 'rgba(255,255,255,0.15)', alignSelf: 'stretch' }} />

        {/* Top supplier */}
        <div style={{ textAlign: 'right' }}>
          <p style={{ margin: '0 0 4px', fontSize: 11, color: '#93C5FD' }}>Top supplier</p>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 500, color: 'white', lineHeight: 1.2 }}>
            {topSupplier || '—'}
          </p>
          {topSupplierSpend > 0 && (
            <p style={{ margin: '4px 0 0', fontSize: 12, color: '#C65A1A' }}>
              {fmtMoney(topSupplierSpend, 'USD')}
              {topSupplierItems > 0 && ` · ${topSupplierItems} item${topSupplierItems !== 1 ? 's' : ''}`}
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
  const { user } = useAuth();
  const { activeTenantId } = useTenant();

  const params = new URLSearchParams(window.location.search);
  const boardParam = params.get('board') || '';

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
      const type      = SOURCE_LABELS[entry.source_type]?.label || entry.source_type || '';
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
  // Supplier totals + top supplier
  const supplierTotals  = {};
  const supplierItemCounts = {};
  filtered.forEach(e => {
    const n = e.supplier_name || 'Manual receive';
    supplierTotals[n] = (supplierTotals[n] || 0) + (parseFloat(e.total_amount) || 0);
    supplierItemCounts[n] = (supplierItemCounts[n] || 0) + (e._itemCount || 0);
  });
  const topSupplier = Object.entries(supplierTotals).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const topSupplierSpend = topSupplier ? (supplierTotals[topSupplier] || 0) : 0;
  const topSupplierItems = topSupplier ? (supplierItemCounts[topSupplier] || 0) : 0;


  const grouped = filtered.reduce((acc, e) => {
    const key = dayKey(e.created_at);
    if (!acc[key]) acc[key] = { label: fmtDate(e.created_at), entries: [] };
    acc[key].entries.push(e);
    return acc;
  }, {});
  const days = Object.entries(grouped).sort((a, b) => b[0].localeCompare(a[0]));

  const totalItems = filtered.reduce((s, e) => s + (e._itemCount || 0), 0);

  return (
    <div style={{
      minHeight: '100vh', background: '#F8FAFC',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', color: '#0F172A',
    }}>
      {/* ── Top bar ── */}
      <div style={{ background: 'white', borderBottom: '1px solid #E2E8F0', padding: '0 24px' }}>
        <div style={{ maxWidth: 860, margin: '0 auto' }}>

          {/* Breadcrumb */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 0 0' }}>
            <button
              onClick={() => navigate('/provisioning')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B', padding: 0, display: 'flex', alignItems: 'center', gap: 3, fontSize: 13 }}
            >
              <Icon name="ChevronLeft" style={{ width: 14, height: 14 }} />
              Provisioning
            </button>
            <span style={{ color: '#CBD5E1', fontSize: 13 }}>›</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#0F172A' }}>
              Delivery History{boardParam && boardNames[boardParam] ? ` — ${boardNames[boardParam]}` : ''}
            </span>
          </div>

          {/* Title + Export */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0 14px' }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Delivery History</h1>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: '#94A3B8' }}>
                Permanent vessel-wide record of all deliveries and purchases
              </p>
            </div>
            {!loading && filtered.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <p style={{ margin: 0, fontSize: 12, color: '#94A3B8' }}>
                  {filtered.length} {filtered.length === 1 ? 'delivery' : 'deliveries'} · {totalItems} items
                </p>
                <button
                  onClick={exportCSV}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 12, color: '#475569', background: 'white', cursor: 'pointer' }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#F8FAFC'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'white'; }}
                >
                  <Icon name="Download" style={{ width: 13, height: 13 }} />
                  Export CSV
                </button>
              </div>
            )}
          </div>

          {/* Filter bar */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingBottom: 14 }}>
            <div style={{ position: 'relative', flex: '1 1 160px', minWidth: 130 }}>
              <Icon name="Search" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', width: 13, height: 13, color: '#CBD5E1', pointerEvents: 'none' }} />
              <input
                type="text"
                placeholder="Search supplier…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ width: '100%', padding: '7px 10px 7px 30px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 12, color: '#0F172A', boxSizing: 'border-box' }}
              />
            </div>

            <select
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value)}
              style={{ padding: '7px 10px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 12, color: '#475569', background: 'white', cursor: 'pointer' }}
            >
              <option value="all">All types</option>
              <option value="delivery">Deliveries</option>
              <option value="receipt">Receipts</option>
              <option value="shopping_trip">Shopping trips</option>
              <option value="manual">Manual</option>
            </select>

            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} title="From date"
              style={{ padding: '7px 10px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 12, color: '#475569', background: 'white' }} />
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} title="To date"
              style={{ padding: '7px 10px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 12, color: '#475569', background: 'white' }} />

            {(search || typeFilter !== 'all' || dateFrom || dateTo) && (
              <button
                onClick={() => { setSearch(''); setTypeFilter('all'); setDateFrom(''); setDateTo(''); }}
                style={{ padding: '7px 12px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 12, color: '#94A3B8', background: 'white', cursor: 'pointer' }}
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 860, margin: '0 auto', padding: '20px 24px 48px' }}>

        {/* ── Summary cards (reflect current filter) ── */}
        {!loading && summaryCount > 0 && (
          <SummaryCards
            summarySpendDisplay={summarySpendDisplay}
            summaryCount={summaryCount}
            topSupplier={topSupplier}
            topSupplierSpend={topSupplierSpend}
            topSupplierItems={topSupplierItems}
            convCurrency={convCurrency}
            fxLoading={fxLoading}
            onConvChange={handleConvCurrencyChange}
          />
        )}

        {/* ── Entry list ── */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '80px 0', color: '#94A3B8', fontSize: 14 }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '80px 0' }}>
            <div style={{ width: 48, height: 48, background: '#F1F5F9', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <Icon name="BookOpen" style={{ width: 22, height: 22, color: '#CBD5E1' }} />
            </div>
            <p style={{ fontSize: 14, fontWeight: 500, color: '#0F172A', marginBottom: 4 }}>No deliveries recorded</p>
            <p style={{ fontSize: 12, color: '#94A3B8' }}>
              {search || typeFilter !== 'all' || dateFrom || dateTo
                ? 'No deliveries match your filters.'
                : 'Deliveries will appear here when items are received.'}
            </p>
          </div>
        ) : (
          days.map(([day, { label, entries: dayEntries }]) => (
            <div key={day} style={{ marginBottom: 24 }}>
              <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {label}
              </p>
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
  );
}
