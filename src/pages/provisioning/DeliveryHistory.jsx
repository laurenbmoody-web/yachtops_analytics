import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../contexts/TenantContext';
import Icon from '../../components/AppIcon';

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

const LedgerItemRow = ({ item }) => (
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
      {fmtMoney(item.unit_price, null) || '—'}
    </p>
    <p style={{ margin: 0, fontSize: 12, fontWeight: 500, color: '#0F172A', textAlign: 'right' }}>
      {fmtMoney(item.total_price, null) || '—'}
    </p>
    <div style={{ textAlign: 'right' }}>
      <ClaimBadge status={item.claim_status} />
    </div>
  </div>
);

const LedgerEntry = ({ entry, userNames, boardNames, expanded, onToggle }) => {
  const receivedByName = userNames[entry.received_by] || null;
  const sourceCfg = SOURCE_LABELS[entry.source_type] || SOURCE_LABELS.manual;

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
          <p style={{ margin: '2px 0 0', fontSize: 11, color: '#94A3B8' }}>
            {fmtTime(entry.created_at)}
            {entry.order_ref ? ` · Ref: ${entry.order_ref}` : ''}
            {receivedByName ? ` · ${receivedByName}` : ''}
            {entry.source_board_id && boardNames[entry.source_board_id] ? ` · ${boardNames[entry.source_board_id]}` : ''}
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
          <div style={{ textAlign: 'right' }}>
            <p style={{ margin: 0, fontSize: 12, color: '#475569' }}>
              {entry._itemCount ?? 0} item{(entry._itemCount ?? 0) !== 1 ? 's' : ''}
            </p>
            {entry.total_amount && (
              <p style={{ margin: '1px 0 0', fontSize: 12, fontWeight: 600, color: '#0F172A' }}>
                {fmtMoney(entry.total_amount, entry.currency)}
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
        </div>
      </div>

      {/* Expanded: line items */}
      {expanded && (
        <div style={{ borderTop: '1px solid #F1F5F9', padding: '0 16px 12px' }}>
          {/* Column headers */}
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
            ? entry._items.map(item => <LedgerItemRow key={item.id} item={item} />)
            : <p style={{ margin: '12px 0', fontSize: 12, color: '#94A3B8', textAlign: 'center' }}>No items recorded</p>
          }
        </div>
      )}
    </div>
  );
};

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DeliveryHistory() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeTenantId } = useTenant();

  // Read ?board= from URL for pre-filter
  const params = new URLSearchParams(window.location.search);
  const boardParam = params.get('board') || '';

  const [entries, setEntries]         = useState([]);
  const [loading, setLoading]         = useState(true);
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [userNames, setUserNames]     = useState({});
  const [boardNames, setBoardNames]   = useState({});

  // Filters
  const [search, setSearch]       = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [dateFrom, setDateFrom]   = useState('');
  const [dateTo, setDateTo]       = useState('');

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

    // Resolve user names
    const uids = [...new Set(rows.map(e => e.received_by).filter(Boolean))];
    if (uids.length > 0) {
      const { data: profiles } = await supabase?.from('profiles')?.select('id, full_name')?.in('id', uids);
      const map = {};
      (profiles || []).forEach(p => { map[p.id] = p.full_name; });
      setUserNames(map);
    }

    // Resolve board names
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

  // Client-side filtering
  const filtered = entries.filter(e => {
    if (typeFilter !== 'all' && e.source_type !== typeFilter) return false;
    if (search && !(e.supplier_name || '').toLowerCase().includes(search.toLowerCase())) return false;
    if (dateFrom && e.created_at < `${dateFrom}T00:00:00`) return false;
    if (dateTo   && e.created_at > `${dateTo}T23:59:59`)   return false;
    return true;
  });

  // Group by day
  const grouped = filtered.reduce((acc, e) => {
    const key = dayKey(e.created_at);
    if (!acc[key]) acc[key] = { label: fmtDate(e.created_at), entries: [] };
    acc[key].entries.push(e);
    return acc;
  }, {});

  const days = Object.entries(grouped).sort((a, b) => b[0].localeCompare(a[0]));

  const totalItems    = filtered.reduce((s, e) => s + (e._itemCount || 0), 0);
  const totalSpend    = filtered.reduce((s, e) => s + (parseFloat(e.total_amount) || 0), 0);

  return (
    <div style={{
      minHeight: '100vh', background: '#F8FAFC',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', color: '#0F172A',
    }}>
      {/* Top bar */}
      <div style={{ background: 'white', borderBottom: '1px solid #E2E8F0', padding: '0 24px' }}>
        <div style={{ maxWidth: 800, margin: '0 auto' }}>

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

          {/* Title + summary */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0 16px' }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Delivery History</h1>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: '#94A3B8' }}>
                Permanent vessel-wide record of all deliveries and purchases
              </p>
            </div>
            {!loading && filtered.length > 0 && (
              <div style={{ textAlign: 'right' }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#0F172A' }}>
                  {filtered.length} {filtered.length === 1 ? 'delivery' : 'deliveries'} · {totalItems} items
                </p>
                {totalSpend > 0 && (
                  <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748B' }}>${totalSpend.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} total</p>
                )}
              </div>
            )}
          </div>

          {/* Filter bar */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', paddingBottom: 14 }}>
            <div style={{ position: 'relative', flex: '1 1 180px', minWidth: 140 }}>
              <Icon name="Search" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', width: 13, height: 13, color: '#CBD5E1', pointerEvents: 'none' }} />
              <input
                type="text"
                placeholder="Search supplier…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{
                  width: '100%', padding: '7px 10px 7px 30px', border: '1px solid #E2E8F0',
                  borderRadius: 8, fontSize: 12, color: '#0F172A', boxSizing: 'border-box',
                }}
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

            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              title="From date"
              style={{ padding: '7px 10px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 12, color: '#475569', background: 'white' }}
            />
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              title="To date"
              style={{ padding: '7px 10px', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 12, color: '#475569', background: 'white' }}
            />

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

      {/* Content */}
      <div style={{ maxWidth: 800, margin: '0 auto', padding: '20px 24px 48px' }}>
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
                />
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
