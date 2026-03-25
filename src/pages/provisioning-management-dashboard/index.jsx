import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useTenant } from '../../contexts/TenantContext';
import { showToast } from '../../utils/toast';
import CreateProvisioningListModal from './components/CreateProvisioningListModal';

// ─── Status config ────────────────────────────────────────────────────────────
const STATUS_CONFIG = {
  draft:                       { label: 'Draft',                bg: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.5)' },
  pending_approval:            { label: 'Pending Approval',      bg: 'rgba(234,179,8,0.15)',   color: '#eab308' },
  sent_to_supplier:            { label: 'Sent to Supplier',      bg: 'rgba(74,144,226,0.15)',  color: '#4A90E2' },
  partially_delivered:         { label: 'Part. Delivered',       bg: 'rgba(168,85,247,0.15)',  color: '#a855f7' },
  delivered_with_discrepancies:{ label: 'Discrepancies',         bg: 'rgba(239,68,68,0.15)',   color: '#ef4444' },
  delivered:                   { label: 'Delivered',             bg: 'rgba(34,197,94,0.15)',   color: '#22c55e' },
};

const StatusBadge = ({ status }) => {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.draft;
  return (
    <span style={{
      fontFamily: 'Inter, sans-serif',
      fontSize: 10,
      fontWeight: 600,
      color: cfg.color,
      backgroundColor: cfg.bg,
      borderRadius: 20,
      padding: '3px 10px',
      whiteSpace: 'nowrap',
      display: 'inline-block',
    }}>
      {cfg.label}
    </span>
  );
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmtDate = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

const fmtCost = (val) => {
  if (val == null) return '—';
  return `£${Number(val).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

// Load trips from localStorage (trips are not yet in Supabase)
const loadLocalTrips = () => {
  try {
    return JSON.parse(localStorage.getItem('cargo.trips.v1') || '[]');
  } catch {
    return [];
  }
};

// ─── Page ─────────────────────────────────────────────────────────────────────
const ProvisioningManagementDashboard = () => {
  const { activeTenantId } = useTenant();

  const [lists, setLists] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [itemCounts, setItemCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [suppliersLoading, setSuppliersLoading] = useState(true);
  const [error, setError] = useState(null);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // ─── Load lists ─────────────────────────────────────────────────────────────
  const loadLists = useCallback(async () => {
    if (!activeTenantId) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        ?.from('provisioning_lists')
        ?.select('*')
        ?.eq('tenant_id', activeTenantId)
        ?.order('created_at', { ascending: false });

      if (err) throw err;
      setLists(data || []);

      // Fetch item counts per list
      if (data?.length) {
        const listIds = data.map(l => l.id);
        const { data: items } = await supabase
          ?.from('provisioning_items')
          ?.select('list_id')
          ?.in('list_id', listIds);

        const counts = {};
        (items || []).forEach(item => {
          counts[item.list_id] = (counts[item.list_id] || 0) + 1;
        });
        setItemCounts(counts);
      }
    } catch (err) {
      console.error('[Provisioning] loadLists error:', err?.message);
      setError('Could not load provisioning lists');
    } finally {
      setLoading(false);
    }
  }, [activeTenantId]);

  // ─── Load suppliers ──────────────────────────────────────────────────────────
  const loadSuppliers = useCallback(async () => {
    if (!activeTenantId) return;
    setSuppliersLoading(true);
    try {
      const { data, error: err } = await supabase
        ?.from('provisioning_suppliers')
        ?.select('*')
        ?.eq('tenant_id', activeTenantId)
        ?.order('name', { ascending: true });

      if (err) throw err;
      setSuppliers(data || []);
    } catch (err) {
      console.error('[Provisioning] loadSuppliers error:', err?.message);
      // Suppress — suppliers loading failure is non-critical
    } finally {
      setSuppliersLoading(false);
    }
  }, [activeTenantId]);

  useEffect(() => {
    loadLists();
    loadSuppliers();
  }, [loadLists, loadSuppliers]);

  // ─── Filtered lists ──────────────────────────────────────────────────────────
  const localTrips = loadLocalTrips();
  const tripMap = Object.fromEntries(localTrips.map(t => [t.id, t]));
  const supplierMap = Object.fromEntries(suppliers.map(s => [s.id, s]));

  const filtered = lists.filter(l => {
    if (statusFilter !== 'all' && l.status !== statusFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchTitle = l.title?.toLowerCase().includes(q);
      const matchPort = l.port_location?.toLowerCase().includes(q);
      const matchSupplier = supplierMap[l.supplier_id]?.name?.toLowerCase().includes(q);
      if (!matchTitle && !matchPort && !matchSupplier) return false;
    }
    return true;
  });

  // ─── Styles ─────────────────────────────────────────────────────────────────
  const s = {
    page: {
      minHeight: '100vh',
      backgroundColor: '#0b1628',
      fontFamily: 'Inter, sans-serif',
      color: 'white',
      padding: '28px 32px',
    },
    header: {
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      marginBottom: 24,
      gap: 16,
      flexWrap: 'wrap',
    },
    title: { fontSize: 20, fontWeight: 700, color: 'white', margin: 0, lineHeight: 1.2 },
    subtitle: { fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 4 },
    toolbar: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      marginBottom: 20,
      flexWrap: 'wrap',
    },
    searchInput: {
      backgroundColor: 'rgba(255,255,255,0.05)',
      border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: 7,
      padding: '7px 12px',
      fontSize: 12,
      color: 'white',
      outline: 'none',
      width: 220,
    },
    select: {
      backgroundColor: 'rgba(255,255,255,0.05)',
      border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: 7,
      padding: '7px 10px',
      fontSize: 12,
      color: 'rgba(255,255,255,0.7)',
      outline: 'none',
      cursor: 'pointer',
    },
    btnGhost: {
      backgroundColor: 'rgba(255,255,255,0.05)',
      border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: 7,
      padding: '7px 12px',
      fontSize: 12,
      color: 'rgba(255,255,255,0.6)',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
    },
    btnBlue: {
      backgroundColor: '#3B82F6',
      border: 'none',
      borderRadius: 7,
      padding: '7px 14px',
      fontSize: 12,
      fontWeight: 600,
      color: 'white',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
    },
    spacer: { flex: 1 },
    table: {
      width: '100%',
      borderCollapse: 'collapse',
    },
    th: {
      fontSize: 10,
      fontWeight: 600,
      color: 'rgba(255,255,255,0.35)',
      textTransform: 'uppercase',
      letterSpacing: '0.07em',
      padding: '0 12px 10px',
      textAlign: 'left',
      borderBottom: '1px solid rgba(255,255,255,0.06)',
    },
    tr: {
      borderBottom: '1px solid rgba(255,255,255,0.04)',
      cursor: 'default',
      transition: 'background 0.1s',
    },
    td: {
      fontSize: 12,
      color: 'rgba(255,255,255,0.8)',
      padding: '11px 12px',
      verticalAlign: 'middle',
    },
    tdMuted: {
      fontSize: 11,
      color: 'rgba(255,255,255,0.35)',
      padding: '11px 12px',
      verticalAlign: 'middle',
    },
    emptyState: {
      textAlign: 'center',
      padding: '60px 24px',
    },
    emptyTitle: { fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.4)', marginBottom: 6 },
    emptyBody:  { fontSize: 12, color: 'rgba(255,255,255,0.2)' },
    errorBox: {
      backgroundColor: 'rgba(239,68,68,0.1)',
      border: '1px solid rgba(239,68,68,0.25)',
      borderRadius: 8,
      padding: '12px 16px',
      fontSize: 13,
      color: '#ef4444',
      marginBottom: 20,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
  };

  return (
    <div style={s.page}>
      {/* Header */}
      <div style={s.header}>
        <div>
          <h1 style={s.title}>Provisioning</h1>
          <p style={s.subtitle}>Manage provisioning lists, suppliers and deliveries</p>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={s.errorBox}>
          <span>{error}</span>
          <button
            onClick={loadLists}
            style={{ ...s.btnGhost, fontSize: 11, padding: '4px 10px' }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Toolbar */}
      <div style={s.toolbar}>
        <input
          style={s.searchInput}
          placeholder="Search lists..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
        />
        <select
          style={s.select}
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
        >
          <option value="all">All statuses</option>
          {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
            <option key={key} value={key}>{cfg.label}</option>
          ))}
        </select>
        <div style={s.spacer} />
        <button style={s.btnBlue} onClick={() => setShowCreateModal(true)}>
          + New List
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ ...s.emptyState }}>
          <p style={s.emptyBody}>Loading provisioning lists...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div style={s.emptyState}>
          <p style={s.emptyTitle}>
            {lists.length === 0 ? 'No provisioning lists yet' : 'No lists match your filters'}
          </p>
          <p style={s.emptyBody}>
            {lists.length === 0
              ? 'Create your first provisioning list to get started.'
              : 'Try adjusting your search or status filter.'}
          </p>
          {lists.length === 0 && (
            <button
              style={{ ...s.btnBlue, marginTop: 16, display: 'inline-block' }}
              onClick={() => setShowCreateModal(true)}
            >
              + New List
            </button>
          )}
        </div>
      ) : (
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>Title</th>
              <th style={s.th}>Status</th>
              <th style={s.th}>Trip</th>
              <th style={s.th}>Departments</th>
              <th style={s.th}>Port / Location</th>
              <th style={s.th}>Supplier</th>
              <th style={s.th}>Est. Cost</th>
              <th style={s.th}>Items</th>
              <th style={s.th}>Created</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(list => {
              const trip = tripMap[list.trip_id];
              const supplier = supplierMap[list.supplier_id];
              return (
                <tr
                  key={list.id}
                  style={s.tr}
                  onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.03)'; }}
                  onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                >
                  <td style={{ ...s.td, fontWeight: 600, color: 'white' }}>{list.title}</td>
                  <td style={s.td}><StatusBadge status={list.status} /></td>
                  <td style={s.tdMuted}>
                    {trip
                      ? <span style={{ color: 'rgba(255,255,255,0.6)' }}>{trip.name}</span>
                      : '—'}
                  </td>
                  <td style={s.tdMuted}>
                    {list.department?.length
                      ? list.department.join(', ')
                      : '—'}
                  </td>
                  <td style={s.tdMuted}>{list.port_location || '—'}</td>
                  <td style={s.tdMuted}>{supplier?.name || '—'}</td>
                  <td style={s.tdMuted}>{fmtCost(list.estimated_cost)}</td>
                  <td style={{ ...s.td, color: 'rgba(255,255,255,0.5)' }}>
                    {itemCounts[list.id] ?? 0}
                  </td>
                  <td style={s.tdMuted}>{fmtDate(list.created_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* Create modal */}
      {showCreateModal && (
        <CreateProvisioningListModal
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => {
            setShowCreateModal(false);
            showToast('Provisioning list created', 'success');
            loadLists();
          }}
          suppliers={suppliers}
          onSuppliersChange={loadSuppliers}
        />
      )}
    </div>
  );
};

export default ProvisioningManagementDashboard;
