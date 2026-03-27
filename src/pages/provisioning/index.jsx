import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors, closestCenter,
} from '@dnd-kit/core';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import Header from '../../components/navigation/Header';
import Icon from '../../components/AppIcon';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../contexts/TenantContext';
import StatusBadge, { STATUS_CONFIG } from './components/StatusBadge';
import {
  fetchProvisioningLists,
  deleteProvisioningList,
  updateListStatus,
  duplicateList,
  PROVISIONING_STATUS,
  PROVISION_DEPARTMENTS,
  formatCurrency,
} from './utils/provisioningStorage';
import { showToast } from '../../utils/toast';

// ── Constants ─────────────────────────────────────────────────────────────────

const KANBAN_COLUMNS = [
  { id: PROVISIONING_STATUS.DRAFT,                     label: 'Draft' },
  { id: PROVISIONING_STATUS.PENDING_APPROVAL,          label: 'Pending Approval' },
  { id: PROVISIONING_STATUS.SENT_TO_SUPPLIER,          label: 'Sent to Supplier' },
  { id: PROVISIONING_STATUS.PARTIALLY_DELIVERED,       label: 'Partially Delivered' },
  { id: PROVISIONING_STATUS.DELIVERED_WITH_DISCREPANCIES, label: 'Discrepancies' },
  { id: PROVISIONING_STATUS.DELIVERED,                 label: 'Delivered' },
];

const VIEW_KEY = 'cargo_provisioning_view_v1';

const CURRENCY_SYMBOLS = { GBP: '£', USD: '$', EUR: '€' };

// ── Order-by date badge ────────────────────────────────────────────────────────

const OrderByBadge = ({ date }) => {
  if (!date) return null;
  const today = new Date(); today.setHours(0,0,0,0);
  const d = new Date(date); d.setHours(0,0,0,0);
  const diff = Math.round((d - today) / 86400000);
  let cls, label;
  if (diff < 0) {
    cls = 'bg-red-500/20 text-red-400 border border-red-500/30';
    label = `Overdue ${Math.abs(diff)}d`;
  } else if (diff === 0) {
    cls = 'bg-red-500/20 text-red-400 border border-red-500/30';
    label = 'Due today';
  } else if (diff <= 3) {
    cls = 'bg-amber-500/20 text-amber-400 border border-amber-500/30';
    label = `Due in ${diff}d`;
  } else {
    cls = 'bg-white/10 text-slate-400 border border-white/10';
    label = new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      <Icon name="Calendar" className="w-3 h-3 mr-1" />
      {label}
    </span>
  );
};

// ── Draggable Kanban Card ─────────────────────────────────────────────────────

const KanbanCard = ({ list, canEdit, canDelete, deleting, onView, onEdit, onDuplicate, onDelete, isDragOverlay }) => {
  const { attributes, listeners, setNodeRef, isDragging, transform } = useDraggable({ id: list.id, data: { list } });

  const depts = list.department ? list.department.split(',').map(d => d.trim()).filter(Boolean) : [];
  const currencySymbol = CURRENCY_SYMBOLS[list.currency] || '$';
  const showProgress = [PROVISIONING_STATUS.PARTIALLY_DELIVERED, PROVISIONING_STATUS.DELIVERED_WITH_DISCREPANCIES].includes(list.status);
  const receivedCount = list.received_count ?? 0;
  const totalCount = list.item_count ?? 0;
  const progressPct = totalCount > 0 ? Math.round((receivedCount / totalCount) * 100) : 0;

  const style = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: isDragOverlay ? 999 : undefined }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.06)] rounded-xl p-4 cursor-grab active:cursor-grabbing select-none transition-all
        ${isDragging && !isDragOverlay ? 'opacity-30' : 'hover:border-[rgba(255,255,255,0.12)] hover:bg-[rgba(255,255,255,0.07)]'}
        ${isDragOverlay ? 'shadow-2xl border-primary/40 bg-[rgba(74,144,226,0.08)]' : ''}
      `}
      {...listeners}
      {...attributes}
    >
      {/* Hover action bar */}
      {!isDragOverlay && (canEdit || canDelete) && (
        <div className="absolute top-2 right-2 hidden group-hover:flex items-center gap-1 bg-background/90 backdrop-blur-sm border border-border rounded-lg px-1.5 py-1 z-10">
          {canEdit && (
            <button
              onPointerDown={e => e.stopPropagation()}
              onClick={e => { e.stopPropagation(); onEdit(); }}
              className="p-1 text-muted-foreground hover:text-primary transition-colors"
              title="Edit"
            >
              <Icon name="Pencil" className="w-3.5 h-3.5" />
            </button>
          )}
          {canEdit && (
            <button
              onPointerDown={e => e.stopPropagation()}
              onClick={e => { e.stopPropagation(); onDuplicate(); }}
              className="p-1 text-muted-foreground hover:text-blue-400 transition-colors"
              title="Duplicate"
            >
              <Icon name="Copy" className="w-3.5 h-3.5" />
            </button>
          )}
          {canDelete && (
            <button
              onPointerDown={e => e.stopPropagation()}
              onClick={e => { e.stopPropagation(); onDelete(); }}
              disabled={deleting}
              className="p-1 text-muted-foreground hover:text-red-400 transition-colors disabled:opacity-50"
              title="Delete"
            >
              <Icon name="Trash2" className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Title */}
      <button
        onPointerDown={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); onView(); }}
        className="w-full text-left"
      >
        <div className="flex items-start gap-1.5 pr-16 mb-2">
          <p className="font-bold text-white text-sm leading-snug hover:text-primary transition-colors flex-1">{list.title}</p>
          {list.is_private && <Icon name="Lock" className="w-3 h-3 text-amber-400 flex-shrink-0 mt-0.5" title="Private" />}
        </div>
      </button>

      {/* Order by badge */}
      {list.order_by_date && <div className="mb-2"><OrderByBadge date={list.order_by_date} /></div>}

      {/* Dept tags */}
      {depts.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {depts.slice(0, 3).map(d => (
            <span key={d} className="text-xs px-2 py-0.5 bg-white/10 text-slate-300 rounded-full">{d}</span>
          ))}
          {depts.length > 3 && <span className="text-xs text-slate-500">+{depts.length - 3}</span>}
        </div>
      )}

      {/* Supplier */}
      {list.supplier_name && (
        <p className="text-xs text-slate-400 mb-1 truncate">{list.supplier_name}</p>
      )}

      {/* Trip */}
      {list.trip_title && (
        <div className="flex items-center gap-1 text-xs text-slate-400 mb-1">
          <Icon name="ExternalLink" className="w-3 h-3 flex-shrink-0" />
          <span className="truncate">{list.trip_title}</span>
        </div>
      )}

      {/* Port / Location */}
      {list.port_location && (
        <div className="flex items-center gap-1 text-xs text-slate-400 mb-2">
          <Icon name="MapPin" className="w-3 h-3 flex-shrink-0" />
          <span className="truncate">{list.port_location}</span>
        </div>
      )}

      {/* Delivery progress bar */}
      {showProgress && totalCount > 0 && (
        <div className="mb-2">
          <div className="flex justify-between text-xs text-slate-400 mb-1">
            <span>{receivedCount} / {totalCount} items received</span>
            <span>{progressPct}%</span>
          </div>
          <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${progressPct}%` }} />
          </div>
        </div>
      )}

      {/* Bottom row */}
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/5">
        <span className="text-sm font-medium text-white">
          {list.estimated_cost ? `${currencySymbol}${Math.round(list.estimated_cost).toLocaleString()}` : <span className="text-slate-500">—</span>}
        </span>
        <span className="text-xs text-slate-400">{list.item_count ?? 0} items</span>
      </div>
    </div>
  );
};

// ── Droppable Column ──────────────────────────────────────────────────────────

const KanbanColumn = ({ column, lists, getCanEdit, getCanDelete, deletingId, onView, onEdit, onDuplicate, onDelete }) => {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });

  return (
    <div className="flex flex-col min-w-[240px] w-[240px] flex-shrink-0">
      {/* Column header */}
      <div className="flex items-center justify-between mb-3 px-1">
        <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">{column.label}</span>
        <span className="text-xs font-medium bg-white/10 text-slate-300 rounded-full px-2 py-0.5">{lists.length}</span>
      </div>

      {/* Drop zone */}
      <div
        ref={setNodeRef}
        className={`flex-1 rounded-xl p-2 space-y-3 min-h-[120px] transition-colors
          ${isOver ? 'bg-primary/10 border border-primary/30' : 'bg-[rgba(255,255,255,0.02)] border border-transparent'}
        `}
      >
        {lists.length === 0 && !isOver && (
          <div className="flex items-center justify-center h-20">
            <p className="text-xs text-slate-600">Drop here</p>
          </div>
        )}
        {lists.map(list => (
          <KanbanCard
            key={list.id}
            list={list}
            canEdit={getCanEdit(list)}
            canDelete={getCanDelete(list)}
            deleting={deletingId === list.id}
            onView={() => onView(list)}
            onEdit={() => onEdit(list)}
            onDuplicate={() => onDuplicate(list)}
            onDelete={() => onDelete(list)}
          />
        ))}
      </div>
    </div>
  );
};

// ── List Row ──────────────────────────────────────────────────────────────────

const ListRow = ({ list, canEdit, canDelete, deleting, onView, onEdit, onDuplicate, onDelete }) => {
  const depts = list.department ? list.department.split(',').map(d => d.trim()).filter(Boolean) : [];
  const currencySymbol = CURRENCY_SYMBOLS[list.currency] || '$';
  return (
    <tr className="border-b border-border hover:bg-muted/30 transition-colors group">
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5">
          <button onClick={onView} className="text-sm font-medium text-foreground hover:text-primary transition-colors text-left">
            {list.title}
          </button>
          {list.is_private && <Icon name="Lock" className="w-3 h-3 text-amber-400 flex-shrink-0" title="Private" />}
        </div>
      </td>
      <td className="px-4 py-3">
        <OrderByBadge date={list.order_by_date} />
        {!list.order_by_date && <span className="text-xs text-muted-foreground">—</span>}
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-1">
          {depts.slice(0,2).map(d => (
            <span key={d} className="text-xs px-2 py-0.5 bg-muted rounded text-muted-foreground">{d}</span>
          ))}
          {depts.length > 2 && <span className="text-xs text-muted-foreground">+{depts.length-2}</span>}
        </div>
      </td>
      <td className="px-4 py-3 text-sm text-muted-foreground">{list.supplier_name || '—'}</td>
      <td className="px-4 py-3 text-sm text-muted-foreground">{list.trip_title || '—'}</td>
      <td className="px-4 py-3 text-sm text-muted-foreground">{list.port_location || '—'}</td>
      <td className="px-4 py-3 text-sm font-medium text-foreground text-right">
        {list.estimated_cost ? `${currencySymbol}${Math.round(list.estimated_cost).toLocaleString()}` : '—'}
      </td>
      <td className="px-4 py-3"><StatusBadge status={list.status} /></td>
      <td className="px-4 py-3 text-sm text-muted-foreground text-center">{list.item_count ?? 0}</td>
      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
        {list.created_at ? new Date(list.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={onView} className="text-xs text-primary hover:underline">View</button>
          {canEdit && <button onClick={onEdit} className="text-xs text-muted-foreground hover:text-foreground">Edit</button>}
          {canEdit && (
            <button onClick={onDuplicate} className="text-xs text-muted-foreground hover:text-blue-400">
              <Icon name="Copy" className="w-3.5 h-3.5" />
            </button>
          )}
          {canDelete && (
            <button onClick={onDelete} disabled={deleting} className="text-xs text-red-500 hover:text-red-600 disabled:opacity-50">
              {deleting ? '…' : <Icon name="Trash2" className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
      </td>
    </tr>
  );
};

// ── Main view ─────────────────────────────────────────────────────────────────

const ProvisioningListView = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeTenantId } = useTenant();

  const [lists, setLists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [deptFilter, setDeptFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [deletingId, setDeletingId] = useState(null);
  const [view, setView] = useState(() => localStorage.getItem(VIEW_KEY) || 'kanban');
  const [sortBy, setSortBy] = useState('title');
  const [sortDir, setSortDir] = useState('asc');
  const [activeCard, setActiveCard] = useState(null);

  const userTier = (user?.permission_tier || user?.effectiveTier || '').toUpperCase();
  const userDept = (user?.department || '').trim();
  const userId = user?.id;

  // CREATE: everyone except VIEW_ONLY (and unknown tier defaults to allowed while loading)
  const canCreate = userTier !== 'VIEW_ONLY';

  // Visibility: private lists only shown to their creator (or COMMAND)
  const canViewList = useCallback((list) => {
    if (list.is_private) return list.created_by === userId || userTier === 'COMMAND';
    return true;
  }, [userId, userTier]);

  // Edit: COMMAND = all; CHIEF/HOD = their dept or created by them; others = only their own private lists
  const canEditList = useCallback((list) => {
    if (list.is_private) return list.created_by === userId;
    if (userTier === 'COMMAND') return true;
    if (['CHIEF', 'HOD'].includes(userTier)) {
      const listDepts = list.department ? list.department.split(',').map(d => d.trim()) : [];
      return !listDepts.length || listDepts.some(d => d === userDept) || list.created_by === userId;
    }
    return false;
  }, [userId, userTier, userDept]);

  const canDeleteList = canEditList;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  useEffect(() => {
    if (!activeTenantId) return;
    loadLists();
  }, [activeTenantId]);

  const setViewPersisted = (v) => {
    setView(v);
    localStorage.setItem(VIEW_KEY, v);
  };

  const loadLists = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchProvisioningLists(activeTenantId);
      setLists(data);
    } catch (err) {
      setError('Could not load provisioning lists. Please try again.');
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
    } catch {
      showToast('Failed to delete list.', 'error');
    } finally {
      setDeletingId(null);
    }
  };

  const handleDuplicate = async (list) => {
    try {
      const newList = await duplicateList(list.id, activeTenantId, user?.id);
      showToast('List duplicated as draft.', 'success');
      navigate(`/provisioning/${newList.id}/edit`);
    } catch {
      showToast('Failed to duplicate list.', 'error');
    }
  };

  // Kanban drag
  const handleDragStart = useCallback(({ active }) => {
    const list = lists.find(l => l.id === active.id);
    setActiveCard(list || null);
  }, [lists]);

  const handleDragEnd = useCallback(async ({ active, over }) => {
    setActiveCard(null);
    if (!over) return;
    const targetStatus = over.id;
    const list = lists.find(l => l.id === active.id);
    if (!list || list.status === targetStatus) return;
    if (!canEditList(list)) return; // Only users who can edit may change status via drag

    // Optimistic update
    setLists(prev => prev.map(l => l.id === list.id ? { ...l, status: targetStatus } : l));
    try {
      await updateListStatus(list.id, targetStatus);
    } catch {
      // Revert
      setLists(prev => prev.map(l => l.id === list.id ? { ...l, status: list.status } : l));
      showToast('Failed to update status.', 'error');
    }
  }, [lists, canEditList]);

  // List view sort
  const handleSort = (col) => {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('asc'); }
  };

  const SortIcon = ({ col }) => sortBy !== col ? null : (
    <Icon name={sortDir === 'asc' ? 'ChevronUp' : 'ChevronDown'} className="w-3 h-3 inline ml-1" />
  );

  const filtered = useMemo(() => lists.filter(l => {
    if (!canViewList(l)) return false;
    if (statusFilter !== 'all' && l.status !== statusFilter) return false;
    if (deptFilter !== 'all' && l.department !== deptFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (
        !l.title?.toLowerCase().includes(q) &&
        !l.port_location?.toLowerCase().includes(q) &&
        !l.supplier_name?.toLowerCase().includes(q) &&
        !l.trip_title?.toLowerCase().includes(q)
      ) return false;
    }
    return true;
  }), [lists, canViewList, statusFilter, deptFilter, searchQuery]);

  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    let aVal = a[sortBy] || '';
    let bVal = b[sortBy] || '';
    if (sortBy === 'order_by_date') {
      aVal = aVal ? new Date(aVal).getTime() : Infinity;
      bVal = bVal ? new Date(bVal).getTime() : Infinity;
    }
    const cmp = typeof aVal === 'number' ? aVal - bVal : String(aVal).localeCompare(String(bVal));
    return sortDir === 'asc' ? cmp : -cmp;
  }), [filtered, sortBy, sortDir]);

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
      <div className={`mx-auto px-4 sm:px-6 lg:px-8 py-8 ${view === 'kanban' ? 'max-w-none' : 'max-w-[1400px]'}`}>
        {/* Page header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Provisioning</h1>
            <p className="text-sm text-muted-foreground mt-1">Manage provisioning lists and supplier orders</p>
          </div>
          <div className="flex items-center gap-2">
            {/* View toggle */}
            <div className="flex items-center gap-0.5 bg-muted rounded-lg p-0.5">
              <button
                onClick={() => setViewPersisted('kanban')}
                title="Kanban view"
                className={`p-2 rounded-md transition-colors ${view === 'kanban' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              >
                <Icon name="LayoutGrid" className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewPersisted('list')}
                title="List view"
                className={`p-2 rounded-md transition-colors ${view === 'list' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              >
                <Icon name="List" className="w-4 h-4" />
              </button>
            </div>

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
        <div className="flex items-center gap-3 mb-6 flex-wrap">
          {/* Search */}
          <div className="relative">
            <Icon name="Search" className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              placeholder="Search lists..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-1.5 text-sm bg-card border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary w-48"
            />
          </div>
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
          {(statusFilter !== 'all' || deptFilter !== 'all' || searchQuery) && (
            <button
              onClick={() => { setStatusFilter('all'); setDeptFilter('all'); setSearchQuery(''); }}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Clear filters
            </button>
          )}
          <span className="ml-auto text-xs text-muted-foreground">{filtered.length} list{filtered.length !== 1 ? 's' : ''}</span>
        </div>

        {error && (
          <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-xl p-4 mb-6">
            <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
            <button onClick={loadLists} className="text-xs text-red-600 underline mt-1">Retry</button>
          </div>
        )}

        {!error && filtered.length === 0 ? (
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
        ) : view === 'kanban' ? (
          /* ── KANBAN VIEW ───────────────────────────────────────────────── */
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <div className="flex gap-4 overflow-x-auto pb-4" style={{ minHeight: '60vh' }}>
              {KANBAN_COLUMNS.map(col => {
                const colLists = filtered.filter(l => l.status === col.id);
                return (
                  <KanbanColumn
                    key={col.id}
                    column={col}
                    lists={colLists}
                    getCanEdit={canEditList}
                    getCanDelete={canDeleteList}
                    deletingId={deletingId}
                    onView={l => navigate(`/provisioning/${l.id}`)}
                    onEdit={l => navigate(`/provisioning/${l.id}/edit`)}
                    onDuplicate={handleDuplicate}
                    onDelete={handleDelete}
                  />
                );
              })}
            </div>

            <DragOverlay dropAnimation={null}>
              {activeCard ? (
                <KanbanCard
                  list={activeCard}
                  canEdit={canEditList(activeCard)}
                  canDelete={canDeleteList(activeCard)}
                  deleting={false}
                  onView={() => {}}
                  onEdit={() => {}}
                  onDuplicate={() => {}}
                  onDelete={() => {}}
                  isDragOverlay
                />
              ) : null}
            </DragOverlay>
          </DndContext>
        ) : (
          /* ── LIST VIEW ─────────────────────────────────────────────────── */
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  {[
                    { col: 'title', label: 'Title' },
                    { col: 'order_by_date', label: 'Order By' },
                    { col: null, label: 'Departments' },
                    { col: null, label: 'Supplier' },
                    { col: null, label: 'Trip' },
                    { col: null, label: 'Port / Location' },
                    { col: 'estimated_cost', label: 'Est. Cost' },
                    { col: 'status', label: 'Status' },
                    { col: 'item_count', label: 'Items' },
                    { col: 'created_at', label: 'Created' },
                    { col: null, label: '' },
                  ].map(({ col, label }, i) => (
                    <th
                      key={i}
                      onClick={col ? () => handleSort(col) : undefined}
                      className={`px-4 py-3 text-xs font-semibold text-muted-foreground text-left ${col ? 'cursor-pointer hover:text-foreground select-none' : ''} ${label === 'Est. Cost' ? 'text-right' : ''} ${label === 'Items' ? 'text-center' : ''}`}
                    >
                      {label}{col && <SortIcon col={col} />}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map(list => (
                  <ListRow
                    key={list.id}
                    list={list}
                    canEdit={canEditList(list)}
                    canDelete={canDeleteList(list)}
                    deleting={deletingId === list.id}
                    onView={() => navigate(`/provisioning/${list.id}`)}
                    onEdit={() => navigate(`/provisioning/${list.id}/edit`)}
                    onDuplicate={() => handleDuplicate(list)}
                    onDelete={() => handleDelete(list)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
};

export default ProvisioningListView;
