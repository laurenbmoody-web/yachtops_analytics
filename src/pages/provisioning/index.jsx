import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Icon from '../../components/AppIcon';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../contexts/TenantContext';
import { ITEM_STATUS_CONFIG } from './components/StatusBadge';
import BoardColumn from './components/BoardColumn';
import BoardDrawer from './components/BoardDrawer';
import ItemDrawer from './components/ItemDrawer';
import DeliveryModal from './components/DeliveryModal';
import {
  fetchProvisioningLists,
  fetchListItems,
  createProvisioningList,
  deleteProvisioningList,
  duplicateList,
  upsertItems,
  fetchSuppliers,
  PROVISIONING_STATUS,
  PROVISION_DEPARTMENTS,
} from './utils/provisioningStorage';
import { loadTrips } from '../trips-management-dashboard/utils/tripStorage';
import { showToast } from '../../utils/toast';

// ── New Board inline form ────────────────────────────────────────────────────

const NewBoardColumn = ({ trips, onCreated, onCancel }) => {
  const [title, setTitle] = useState('');
  const [tripId, setTripId] = useState('');
  const [orderByDate, setOrderByDate] = useState('');

  const inputCls = 'w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 outline-none focus:border-[#4A90E2] transition-colors';

  const handleCreate = () => {
    if (!title.trim()) return;
    onCreated({ title: title.trim(), trip_id: tripId || null, order_by_date: orderByDate || null });
  };

  return (
    <div className="flex flex-col w-[280px] min-w-[280px] flex-shrink-0 bg-[rgba(255,255,255,0.03)] border-2 border-dashed border-[rgba(255,255,255,0.15)] rounded-xl p-4 space-y-3">
      <h3 className="text-sm font-bold text-white">New Board</h3>
      <input
        autoFocus
        value={title}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') onCancel(); }}
        placeholder="Board name *"
        className={inputCls}
      />
      <select value={tripId} onChange={e => setTripId(e.target.value)} className={inputCls}>
        <option value="">Link to trip (optional)</option>
        {(trips || []).map(t => <option key={t.id} value={t.id}>{t.title || t.name}</option>)}
      </select>
      <input
        type="date"
        value={orderByDate}
        onChange={e => setOrderByDate(e.target.value)}
        className={inputCls}
        placeholder="Order by date"
      />
      <div className="flex gap-2">
        <button
          onClick={handleCreate}
          disabled={!title.trim()}
          className="flex-1 py-2 bg-[#4A90E2] text-white text-sm font-medium rounded-lg hover:bg-[#4A90E2]/80 disabled:opacity-40 transition-colors"
        >
          Create
        </button>
        <button onClick={onCancel} className="px-3 py-2 text-sm text-slate-400 hover:text-white transition-colors">
          Cancel
        </button>
      </div>
    </div>
  );
};

// ── Main Workspace ───────────────────────────────────────────────────────────

const ProvisioningWorkspace = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeTenantId } = useTenant();

  // Data
  const [lists, setLists] = useState([]);
  const [itemsByList, setItemsByList] = useState({});
  const [suppliers, setSuppliers] = useState([]);
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [deptFilter, setDeptFilter] = useState('all');

  // UI state
  const [showNewBoard, setShowNewBoard] = useState(false);
  const [boardDrawer, setBoardDrawer] = useState({ open: false, listId: null, mode: 'edit' });
  const [itemDrawer, setItemDrawer] = useState({ open: false, item: null, listId: null });
  const [deliveryModal, setDeliveryModal] = useState({ open: false, list: null });

  // RBAC
  const userTier = (user?.permission_tier || user?.effectiveTier || '').toUpperCase();
  const userDept = (user?.department || '').trim();
  const userId = user?.id;
  const canCreate = userTier !== 'VIEW_ONLY';

  const canViewList = useCallback((list) => {
    if (list.is_private) return list.created_by === userId || userTier === 'COMMAND';
    return true;
  }, [userId, userTier]);

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

  // ── Load all data ────────────────────────────────────────────────────────

  useEffect(() => {
    if (!activeTenantId) return;
    loadAll();
  }, [activeTenantId]);

  const loadAll = async () => {
    setLoading(true);
    setError(null);
    try {
      // loadTrips is synchronous (localStorage) — wrap safely
      let fetchedTrips = [];
      try { fetchedTrips = loadTrips() || []; } catch { fetchedTrips = []; }

      const [fetchedLists, fetchedSuppliers] = await Promise.all([
        fetchProvisioningLists(activeTenantId),
        fetchSuppliers(activeTenantId).catch(() => []),
      ]);
      setLists(fetchedLists || []);
      setSuppliers(fetchedSuppliers || []);
      setTrips(Array.isArray(fetchedTrips) ? fetchedTrips : []);

      // Load items for all lists in parallel
      const itemsMap = {};
      if (fetchedLists?.length) {
        await Promise.all(
          fetchedLists.map(async (l) => {
            try {
              itemsMap[l.id] = await fetchListItems(l.id);
            } catch {
              itemsMap[l.id] = [];
            }
          })
        );
      }
      setItemsByList(itemsMap);
    } catch (err) {
      console.error('[ProvisioningWorkspace] loadAll error:', err);
      setError('Could not load provisioning boards. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // ── Board actions ────────────────────────────────────────────────────────

  const handleCreateBoard = async ({ title, trip_id, order_by_date }) => {
    try {
      const newList = await createProvisioningList({
        tenant_id: activeTenantId,
        title,
        trip_id,
        order_by_date,
        status: PROVISIONING_STATUS.DRAFT,
        created_by: userId,
        department: '',
        notes: '',
        is_private: false,
      });
      setLists(prev => [newList, ...prev]);
      setItemsByList(prev => ({ ...prev, [newList.id]: [] }));
      setShowNewBoard(false);
      showToast('Board created', 'success');
    } catch {
      showToast('Failed to create board', 'error');
    }
  };

  const handleBoardSaved = (updated) => {
    setLists(prev => prev.map(l => l.id === updated.id ? { ...l, ...updated } : l));
  };

  const handleBoardDeleted = (listId) => {
    setLists(prev => prev.filter(l => l.id !== listId));
    setItemsByList(prev => { const next = { ...prev }; delete next[listId]; return next; });
  };

  const handleDuplicate = async (list) => {
    try {
      const newList = await duplicateList(list.id, activeTenantId, userId);
      const items = await fetchListItems(newList.id);
      setLists(prev => [newList, ...prev]);
      setItemsByList(prev => ({ ...prev, [newList.id]: items }));
      showToast('Board duplicated', 'success');
    } catch {
      showToast('Failed to duplicate board', 'error');
    }
  };

  const handleDeleteBoard = async (list) => {
    if (!window.confirm(`Delete "${list.title}"? This cannot be undone.`)) return;
    try {
      await deleteProvisioningList(list.id);
      handleBoardDeleted(list.id);
      showToast('Board deleted', 'success');
    } catch {
      showToast('Failed to delete board', 'error');
    }
  };

  // ── Item actions ─────────────────────────────────────────────────────────

  const handleQuickAdd = async (listId, { name, department }) => {
    try {
      const newItem = {
        list_id: listId,
        name,
        department,
        quantity_ordered: 1,
        unit: 'each',
        status: 'pending',
        source: 'manual',
      };
      const saved = await upsertItems([newItem]);
      setItemsByList(prev => ({ ...prev, [listId]: [...(prev[listId] || []), ...saved] }));
    } catch {
      showToast('Failed to add item', 'error');
    }
  };

  const handleItemSaved = (listId, savedItems) => {
    setItemsByList(prev => {
      const existing = prev[listId] || [];
      const savedIds = new Set(savedItems.map(s => s.id));
      const updated = existing.map(e => {
        const match = savedItems.find(s => s.id === e.id);
        return match || e;
      });
      // Add any new items not in existing
      savedItems.forEach(s => {
        if (!existing.find(e => e.id === s.id)) updated.push(s);
      });
      return { ...prev, [listId]: updated };
    });
  };

  const handleItemDeleted = (listId, itemId) => {
    setItemsByList(prev => ({
      ...prev,
      [listId]: (prev[listId] || []).filter(i => i.id !== itemId),
    }));
  };

  const handleAddItemsFromDrawer = (listId, newItems) => {
    setItemsByList(prev => ({
      ...prev,
      [listId]: [...(prev[listId] || []), ...newItems],
    }));
  };

  // ── Filtering ────────────────────────────────────────────────────────────

  const getFilteredItems = useCallback((listId) => {
    const items = itemsByList[listId] || [];
    return items.filter(item => {
      if (statusFilter !== 'all' && item.status !== statusFilter) return false;
      if (deptFilter !== 'all' && item.department !== deptFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (
          !item.name?.toLowerCase().includes(q) &&
          !item.brand?.toLowerCase().includes(q) &&
          !item.category?.toLowerCase().includes(q)
        ) return false;
      }
      return true;
    });
  }, [itemsByList, statusFilter, deptFilter, searchQuery]);

  const visibleLists = useMemo(() => lists.filter(l => canViewList(l)), [lists, canViewList]);
  const hasActiveFilters = statusFilter !== 'all' || deptFilter !== 'all' || searchQuery;

  // ── Drawer helpers ───────────────────────────────────────────────────────

  const openBoardDrawer = (listId, mode) => {
    setBoardDrawer({ open: true, listId, mode });
    setItemDrawer({ open: false, item: null, listId: null });
  };

  const openItemDrawer = (item, listId) => {
    setItemDrawer({ open: true, item, listId });
    setBoardDrawer({ open: false, listId: null, mode: 'edit' });
  };

  const activeBoardList = boardDrawer.listId ? lists.find(l => l.id === boardDrawer.listId) : null;

  // ── Render ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <>
        <Header />
        <div className="min-h-screen bg-[#0d1a2e] flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-[#4A90E2] border-t-transparent rounded-full animate-spin" />
        </div>
      </>
    );
  }

  return (
    <>
      <Header />
      <div className="min-h-screen bg-[#0d1a2e]">
        {/* Toolbar */}
        <div className="sticky top-0 z-20 bg-[#0d1a2e] border-b border-[rgba(255,255,255,0.06)] px-6 py-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <h1 className="text-lg font-bold text-white">Provisioning</h1>
              {/* Search */}
              <div className="relative">
                <Icon name="Search" className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Search items..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="pl-8 pr-3 py-1.5 text-sm bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.08)] rounded-lg text-white placeholder:text-slate-500 focus:outline-none focus:border-[#4A90E2] w-48"
                />
              </div>
              {/* Status filter */}
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                className="bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.08)] rounded-lg px-2.5 py-1.5 text-sm text-slate-300 focus:outline-none focus:border-[#4A90E2]"
              >
                <option value="all">All statuses</option>
                {Object.entries(ITEM_STATUS_CONFIG).map(([val, cfg]) => (
                  <option key={val} value={val}>{cfg.label}</option>
                ))}
              </select>
              {/* Dept filter */}
              <select
                value={deptFilter}
                onChange={e => setDeptFilter(e.target.value)}
                className="bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.08)] rounded-lg px-2.5 py-1.5 text-sm text-slate-300 focus:outline-none focus:border-[#4A90E2]"
              >
                <option value="all">All depts</option>
                {PROVISION_DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              {hasActiveFilters && (
                <button
                  onClick={() => { setSearchQuery(''); setStatusFilter('all'); setDeptFilter('all'); }}
                  className="text-xs text-slate-500 hover:text-white transition-colors"
                >
                  Clear filters
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => navigate('/provisioning/suppliers')}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-400 border border-[rgba(255,255,255,0.1)] rounded-lg hover:bg-white/5 transition-colors"
              >
                <Icon name="Users" className="w-4 h-4" />
                Suppliers
              </button>
              {canCreate && (
                <button
                  onClick={() => setShowNewBoard(true)}
                  className="flex items-center gap-1.5 px-4 py-1.5 bg-[#4A90E2] text-white text-sm font-medium rounded-lg hover:bg-[#4A90E2]/80 transition-colors"
                >
                  <Icon name="Plus" className="w-4 h-4" />
                  New Board
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mx-6 mt-4 bg-red-500/10 border border-red-500/20 rounded-xl p-4">
            <p className="text-sm text-red-400">{error}</p>
            <button onClick={loadAll} className="text-xs text-red-400 underline mt-1">Retry</button>
          </div>
        )}

        {/* Empty state */}
        {!error && visibleLists.length === 0 && !showNewBoard && (
          <div className="flex items-center justify-center" style={{ minHeight: 'calc(100vh - 130px)' }}>
            <div className="text-center">
              <div className="w-16 h-16 bg-[rgba(255,255,255,0.05)] rounded-full flex items-center justify-center mx-auto mb-4">
                <Icon name="ShoppingBag" className="w-8 h-8 text-slate-500" />
              </div>
              <h3 className="text-base font-semibold text-white mb-1">No provisioning boards yet</h3>
              <p className="text-sm text-slate-500 mb-4">Create your first board to get started.</p>
              {canCreate && (
                <button
                  onClick={() => setShowNewBoard(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#4A90E2] text-white text-sm font-medium rounded-lg hover:bg-[#4A90E2]/80 transition-colors"
                >
                  <Icon name="Plus" className="w-4 h-4" />
                  New Board
                </button>
              )}
            </div>
          </div>
        )}

        {/* Board workspace — horizontal scroll */}
        {(visibleLists.length > 0 || showNewBoard) && (
          <div className="flex gap-4 overflow-x-auto px-6 py-4" style={{ minHeight: 'calc(100vh - 130px)' }}>
            {visibleLists.map(list => {
              const allItems = itemsByList[list.id] || [];
              const filtered = getFilteredItems(list.id);
              const hiddenCount = allItems.length - filtered.length;

              return (
                <BoardColumn
                  key={list.id}
                  list={list}
                  items={allItems}
                  filteredItems={filtered}
                  hiddenCount={hasActiveFilters ? hiddenCount : 0}
                  canEdit={canEditList(list)}
                  canDelete={canDeleteList(list)}
                  onItemClick={(item) => openItemDrawer(item, list.id)}
                  onQuickAdd={(data) => handleQuickAdd(list.id, data)}
                  onEditBoard={() => openBoardDrawer(list.id, 'edit')}
                  onSuggestions={() => openBoardDrawer(list.id, 'suggestions')}
                  onTemplates={() => openBoardDrawer(list.id, 'templates')}
                  onDuplicate={() => handleDuplicate(list)}
                  onDelete={() => handleDeleteBoard(list)}
                />
              );
            })}

            {/* New board column */}
            {showNewBoard && (
              <NewBoardColumn
                trips={trips}
                onCreated={handleCreateBoard}
                onCancel={() => setShowNewBoard(false)}
              />
            )}
          </div>
        )}
      </div>

      {/* Board Drawer */}
      <BoardDrawer
        open={boardDrawer.open}
        mode={boardDrawer.mode}
        list={activeBoardList}
        suppliers={suppliers}
        trips={trips}
        tenantId={activeTenantId}
        onSaved={handleBoardSaved}
        onDeleted={handleBoardDeleted}
        onAddItems={handleAddItemsFromDrawer}
        onClose={() => setBoardDrawer({ open: false, listId: null, mode: 'edit' })}
      />

      {/* Item Drawer */}
      <ItemDrawer
        open={itemDrawer.open}
        item={itemDrawer.item}
        listId={itemDrawer.listId}
        onSaved={handleItemSaved}
        onDeleted={handleItemDeleted}
        onClose={() => setItemDrawer({ open: false, item: null, listId: null })}
      />

      {/* Delivery Modal (kept as-is) */}
      {deliveryModal.open && deliveryModal.list && (
        <DeliveryModal
          list={deliveryModal.list}
          items={itemsByList[deliveryModal.list.id] || []}
          onClose={() => setDeliveryModal({ open: false, list: null })}
          onComplete={() => { setDeliveryModal({ open: false, list: null }); loadAll(); }}
        />
      )}
    </>
  );
};

export default ProvisioningWorkspace;
