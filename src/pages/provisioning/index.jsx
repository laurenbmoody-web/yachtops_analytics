import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Icon from '../../components/AppIcon';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../contexts/TenantContext';
import StatusBadge, { STATUS_CONFIG } from './components/StatusBadge';
import {
  fetchProvisioningLists,
  deleteProvisioningList,
  PROVISIONING_STATUS,
  PROVISION_DEPARTMENTS,
  formatCurrency,
} from './utils/provisioningStorage';

const STATUS_ORDER = [
  PROVISIONING_STATUS.PENDING_APPROVAL,
  PROVISIONING_STATUS.SENT_TO_SUPPLIER,
  PROVISIONING_STATUS.PARTIALLY_DELIVERED,
  PROVISIONING_STATUS.DELIVERED_WITH_DISCREPANCIES,
  PROVISIONING_STATUS.DRAFT,
  PROVISIONING_STATUS.DELIVERED,
];

const ProvisioningListView = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeTenantId } = useTenant();

  const [lists, setLists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [deptFilter, setDeptFilter] = useState('all');
  const [deletingId, setDeletingId] = useState(null);

  const userTier = (user?.permission_tier || user?.effectiveTier || '').toUpperCase();
  const canCreate = ['COMMAND', 'CHIEF'].includes(userTier);

  useEffect(() => {
    if (!activeTenantId) return;
    loadLists();
  }, [activeTenantId]);

  const loadLists = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchProvisioningLists(activeTenantId);
      setLists(data);
    } catch (err) {
      setError('Could not load provisioning lists. Please try again.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (list) => {
    if (!window.confirm(`Delete "${list.title}"? This cannot be undone.`)) return;
    setDeletingId(list.id);
    try {
      await deleteProvisioningList(list.id);
      setLists(prev => prev.filter(l => l.id !== list.id));
    } catch (err) {
      alert('Failed to delete list.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleDuplicate = (list) => {
    navigate(`/provisioning/new?duplicate=${list.id}`);
  };

  // Filter and group
  const filtered = lists.filter(l => {
    if (statusFilter !== 'all' && l.status !== statusFilter) return false;
    if (deptFilter !== 'all' && l.department !== deptFilter) return false;
    return true;
  });

  const grouped = STATUS_ORDER.reduce((acc, status) => {
    const items = filtered.filter(l => l.status === status);
    if (items.length) acc[status] = items;
    return acc;
  }, {});

  if (loading) {
    return (
      <>
        <Header />
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </>
    );
  }

  return (
    <>
      <Header />
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Page header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Provisioning</h1>
            <p className="text-sm text-muted-foreground mt-1">Manage provisioning lists and supplier orders</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate('/provisioning/suppliers')}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-muted-foreground border border-border rounded-lg hover:bg-muted transition-colors"
            >
              <Icon name="Users" className="w-4 h-4" />
              Suppliers
            </button>
            {canCreate && (
              <button
                onClick={() => navigate('/provisioning/new')}
                className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors"
              >
                <Icon name="Plus" className="w-4 h-4" />
                New List
              </button>
            )}
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 mb-6">
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-muted-foreground">Status:</label>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="bg-card border border-border rounded-lg px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="all">All</option>
              {Object.entries(STATUS_CONFIG).map(([val, { label }]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-muted-foreground">Department:</label>
            <select
              value={deptFilter}
              onChange={e => setDeptFilter(e.target.value)}
              className="bg-card border border-border rounded-lg px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="all">All</option>
              {PROVISION_DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          {(statusFilter !== 'all' || deptFilter !== 'all') && (
            <button
              onClick={() => { setStatusFilter('all'); setDeptFilter('all'); }}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Clear filters
            </button>
          )}
        </div>

        {error && (
          <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-xl p-4 mb-6">
            <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
            <button onClick={loadLists} className="text-xs text-red-600 underline mt-1">Retry</button>
          </div>
        )}

        {!filtered.length ? (
          <div className="bg-card border border-border rounded-xl p-12 text-center">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
              <Icon name="ShoppingBag" className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="text-base font-semibold text-foreground mb-1">No provisioning lists yet</h3>
            <p className="text-sm text-muted-foreground mb-4">Create your first list to get started.</p>
            {canCreate && (
              <button
                onClick={() => navigate('/provisioning/new')}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors"
              >
                <Icon name="Plus" className="w-4 h-4" />
                New List
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-8">
            {Object.entries(grouped).map(([status, statusLists]) => (
              <div key={status}>
                <div className="flex items-center gap-2 mb-3">
                  <StatusBadge status={status} size="md" />
                  <span className="text-xs text-muted-foreground">({statusLists.length})</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {statusLists.map(list => (
                    <ListCard
                      key={list.id}
                      list={list}
                      canEdit={canCreate}
                      deleting={deletingId === list.id}
                      onView={() => navigate(`/provisioning/${list.id}`)}
                      onEdit={() => navigate(`/provisioning/${list.id}/edit`)}
                      onDuplicate={() => handleDuplicate(list)}
                      onDelete={() => handleDelete(list)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
};

// ── List Card ─────────────────────────────────────────────────────────────────

const ListCard = ({ list, canEdit, deleting, onView, onEdit, onDuplicate, onDelete }) => {
  const depts = list.department ? list.department.split(',').map(d => d.trim()).filter(Boolean) : [];
  const createdDate = list.created_at ? new Date(list.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

  return (
    <div className="bg-card border border-border rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground leading-snug flex-1">{list.title}</h3>
        <StatusBadge status={list.status} />
      </div>

      {list.trip_title && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Icon name="Map" className="w-3 h-3" />
          {list.trip_title}
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        {depts.slice(0, 3).map(d => (
          <span key={d} className="text-xs px-2 py-0.5 bg-muted rounded text-muted-foreground">{d}</span>
        ))}
        {depts.length > 3 && <span className="text-xs text-muted-foreground">+{depts.length - 3} more</span>}
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{list.item_count ?? 0} items</span>
        {list.estimated_cost ? <span className="font-medium text-foreground">{formatCurrency(list.estimated_cost)}</span> : null}
        <span>{createdDate}</span>
      </div>

      <div className="flex items-center gap-2 pt-1 border-t border-border">
        <button onClick={onView} className="flex-1 text-xs text-primary hover:underline text-center py-1">View</button>
        {canEdit && (
          <>
            <span className="text-border">|</span>
            <button onClick={onEdit} className="flex-1 text-xs text-muted-foreground hover:text-foreground text-center py-1">Edit</button>
            <span className="text-border">|</span>
            <button onClick={onDuplicate} className="flex-1 text-xs text-muted-foreground hover:text-foreground text-center py-1">Duplicate</button>
            <span className="text-border">|</span>
            <button onClick={onDelete} disabled={deleting} className="flex-1 text-xs text-red-500 hover:text-red-600 text-center py-1 disabled:opacity-50">
              {deleting ? '…' : 'Delete'}
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default ProvisioningListView;
