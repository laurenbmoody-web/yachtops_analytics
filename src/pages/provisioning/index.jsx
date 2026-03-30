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
import ShareModal from './components/ShareModal';
import {
  fetchProvisioningLists,
  fetchListItems,
  createProvisioningList,
  deleteProvisioningList,
  updateProvisioningList,
  duplicateList,
  upsertItems,
  fetchSuppliers,
  fetchVesselDepartments,
  fetchCrewMembers,
  fetchCollaborators,
  fetchSharedWithMe,
  PROVISIONING_STATUS,
} from './utils/provisioningStorage';
import { supabase } from '../../lib/supabaseClient';
import { loadTrips } from '../trips-management-dashboard/utils/tripStorage';
import { showToast } from '../../utils/toast';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  horizontalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// ── Sortable wrapper for each board column ───────────────────────────────────

const SortableBoardColumn = ({ list, ...props }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: list.id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <BoardColumn
        list={list}
        {...props}
        dragHandleProps={{ ...attributes, ...listeners }}
        isDragging={isDragging}
      />
    </div>
  );
};

// ── Ghost "add new board" column ─────────────────────────────────────────────

const GhostBoardColumn = ({ onClick }) => {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="flex flex-col w-[340px] min-w-[340px] flex-shrink-0 rounded-xl transition-colors"
      style={{
        height: 'calc(100vh - 160px)',
        border: `2px ${hovered ? 'solid' : 'dashed'} rgba(0,0,0,0.12)`,
        background: hovered ? 'rgba(0,0,0,0.03)' : 'transparent',
        cursor: 'pointer',
      }}
    >
      <div className="flex-1 flex flex-col items-center justify-center gap-2">
        <Icon name="Plus" className="w-6 h-6 text-muted-foreground" />
        <p className="text-sm font-semibold text-muted-foreground">New Board</p>
        <p className="text-xs text-muted-foreground/60">Click to add a board</p>
      </div>
    </div>
  );
};

// ── New Board inline form ────────────────────────────────────────────────────

const NewBoardColumn = ({ trips, tenantId, userId, onCreated, onCancel }) => {
  const [title, setTitle] = useState('');
  const [tripId, setTripId] = useState('');
  const [orderByDate, setOrderByDate] = useState('');
  const [creating, setCreating] = useState(false);
  const [localError, setLocalError] = useState('');

  const inputCls = 'w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary transition-colors';

  const handleCreate = async () => {
    if (!title.trim()) return;
    if (!tenantId) { setLocalError('No vessel selected — cannot create board.'); return; }
    setCreating(true);
    setLocalError('');
    try {
      await onCreated({ title: title.trim(), trip_id: tripId || null, order_by_date: orderByDate || null });
    } catch (err) {
      setLocalError(err?.message || 'Failed to create board');
      setCreating(false);
    }
  };

  return (
    <div className="flex flex-col w-[340px] min-w-[340px] flex-shrink-0 bg-card border-2 border-dashed border-border rounded-xl p-4 space-y-3">
      <h3 className="text-sm font-bold text-foreground">New Board</h3>
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
      <div>
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
          Order by date
        </label>
        <input
          type="date"
          value={orderByDate}
          onChange={e => setOrderByDate(e.target.value)}
          className={inputCls}
        />
      </div>
      {localError && (
        <p className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{localError}</p>
      )}
      <div className="flex gap-2">
        <button
          onClick={handleCreate}
          disabled={!title.trim() || creating}
          className="flex-1 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/80 disabled:opacity-40 transition-colors"
        >
          {creating ? 'Creating...' : 'Create'}
        </button>
        <button onClick={onCancel} className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
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
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [crewMembers, setCrewMembers] = useState([]);
  const [collaboratorsByList, setCollaboratorsByList] = useState({});
  const [sharedWithMe, setSharedWithMe] = useState([]);
  const [userDeptId, setUserDeptId] = useState(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [deptFilter, setDeptFilter] = useState('all');

  // UI state
  const [showNewBoard, setShowNewBoard] = useState(false);
  const [boardDrawer, setBoardDrawer] = useState({ open: false, listId: null, mode: 'edit' });
  const [itemDrawer, setItemDrawer] = useState({ open: false, item: null, listId: null });
  const [deliveryModal, setDeliveryModal] = useState({ open: false, list: null });
  const [sharingList, setSharingList] = useState(null);

  // RBAC
  const userTier = (user?.permission_tier || user?.effectiveTier || '').toUpperCase();
  const userDept = (user?.department || '').trim();
  const userId = user?.id;
  const canCreate = userTier !== 'VIEW_ONLY';
  const isCommand = userTier === 'COMMAND';

  // DnD
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const isOwner = useCallback((list) => {
    return list.owner_id === userId || list.created_by === userId;
  }, [userId]);

  const canViewList = useCallback((list) => {
    // With RLS + JS-level filtering, the server already scopes what's returned.
    // This client-side check is a belt-and-suspenders guard for any rows that
    // slip through (e.g. legacy data without owner_id set yet).
    if (userTier === 'COMMAND') return true;
    if (isOwner(list)) return true;
    if (list.visibility === 'department' && userDeptId && list.department_id === userDeptId) return true;
    if (list.visibility === 'shared') return true; // collaborator check done server-side
    // Legacy: boards without visibility field fall back to is_private behaviour
    if (!list.visibility) return !list.is_private || isOwner(list);
    return false;
  }, [userId, userTier, userDeptId, isOwner]);

  const canEditList = useCallback((list) => {
    if (userTier === 'COMMAND') return true;
    if (isOwner(list)) return true;
    if (['CHIEF', 'HOD'].includes(userTier)) {
      const listDepts = Array.isArray(list.department)
        ? list.department.filter(Boolean)
        : (list.department ? list.department.split(',').map(d => d.trim()) : []);
      return !listDepts.length || listDepts.some(d => d === userDept);
    }
    return false;
  }, [userId, userTier, userDept, isOwner]);

  const canDeleteList = canEditList;

  // ── Load all data ────────────────────────────────────────────────────────

  useEffect(() => {
    if (!activeTenantId) return;
    fetchVesselDepartments(activeTenantId).then(setDepartments);
    fetchCrewMembers(activeTenantId).then(setCrewMembers);
  }, [activeTenantId]);

  // Load user's department_id from tenant_members, then fetch boards
  useEffect(() => {
    if (!activeTenantId || !userId) return;
    const init = async () => {
      try {
        const { data } = await supabase
          ?.from('tenant_members')
          ?.select('department_id')
          ?.eq('tenant_id', activeTenantId)
          ?.eq('user_id', userId)
          ?.maybeSingle();
        const deptId = data?.department_id || null;
        setUserDeptId(deptId);
        loadAll(deptId);
      } catch {
        loadAll(null);
      }
    };
    init();
  }, [activeTenantId, userId]);

  useEffect(() => {
    if (!userId) return;
    fetchSharedWithMe(userId).then(setSharedWithMe);
  }, [userId]);

  const loadAll = async (deptId = userDeptId) => {
    setLoading(true);
    setError(null);
    try {
      // loadTrips is synchronous (localStorage) — wrap safely
      let fetchedTrips = [];
      try { fetchedTrips = loadTrips() || []; } catch { fetchedTrips = []; }

      const [fetchedLists, fetchedSuppliers] = await Promise.all([
        fetchProvisioningLists(activeTenantId, userId, deptId),
        fetchSuppliers(activeTenantId).catch(() => []),
      ]);
      setLists(fetchedLists || []);
      setSuppliers(fetchedSuppliers || []);
      setTrips(Array.isArray(fetchedTrips) ? fetchedTrips : []);

      // Load items + collaborators for all lists in parallel
      const itemsMap = {};
      const collabMap = {};
      if (fetchedLists?.length) {
        await Promise.all(
          fetchedLists.map(async (l) => {
            try {
              [itemsMap[l.id], collabMap[l.id]] = await Promise.all([
                fetchListItems(l.id),
                fetchCollaborators(l.id).catch(() => []),
              ]);
            } catch {
              itemsMap[l.id] = [];
              collabMap[l.id] = [];
            }
          })
        );
      }
      setItemsByList(itemsMap);
      setCollaboratorsByList(collabMap);
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
      console.log('[Provisioning] createBoard — tenant_id:', activeTenantId, 'userId:', userId);
      const newList = await createProvisioningList({
        tenant_id: activeTenantId,
        title,
        trip_id: trip_id || null,
        order_by_date: order_by_date || null,
        status: PROVISIONING_STATUS.DRAFT,
        created_by: userId,
        owner_id: userId,
        department_id: userDeptId || null,
        visibility: 'private',
        department: [],
        port_location: '',
        notes: '',
        currency: 'USD',
        estimated_cost: null,
        actual_cost: null,
        supplier_id: null,
        is_private: true,
        is_template: false,
      });
      setLists(prev => [newList, ...prev]);
      setItemsByList(prev => ({ ...prev, [newList.id]: [] }));
      setShowNewBoard(false);
      showToast('Board created', 'success');
    } catch (err) {
      console.error('[Provisioning] createBoard error:', err);
      throw err; // re-throw so NewBoardColumn can display it inline
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
    try {
      await deleteProvisioningList(list.id);
      handleBoardDeleted(list.id);
      showToast('Board deleted', 'success');
    } catch {
      showToast('Failed to delete board', 'error');
    }
  };

  const handleTitleSave = async (listId, newTitle) => {
    setLists(prev => prev.map(l => l.id === listId ? { ...l, title: newTitle } : l));
    try {
      await updateProvisioningList(listId, { title: newTitle });
    } catch {
      loadAll();
      showToast('Failed to save title', 'error');
    }
  };

  const handleColourChange = async (listId, colour) => {
    setLists(prev => prev.map(l => l.id === listId ? { ...l, board_colour: colour } : l));
    try {
      await updateProvisioningList(listId, { board_colour: colour });
    } catch {
      showToast('Failed to save colour', 'error');
    }
  };

  const handleDragEnd = async ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const oldIdx = lists.findIndex(l => l.id === active.id);
    const newIdx = lists.findIndex(l => l.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    const reordered = arrayMove(lists, oldIdx, newIdx);
    setLists(reordered);
    try {
      await Promise.all(reordered.map((l, idx) => updateProvisioningList(l.id, { sort_order: idx })));
    } catch {
      showToast('Failed to save board order', 'error');
    }
  };

  // ── Item actions ─────────────────────────────────────────────────────────

  const handleQuickAdd = async (listId, { name }) => {
    try {
      const newItem = {
        list_id: listId,
        name,
        department: '',
        quantity_ordered: 1,
        unit: 'each',
        status: 'pending',
        source: 'manual',
      };
      const saved = await upsertItems([newItem]);
      // new items appear at top of column
      setItemsByList(prev => ({ ...prev, [listId]: [...saved, ...(prev[listId] || [])] }));
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

  const handleItemQuantityChange = async (listId, item, newQty) => {
    const prev = item.quantity_ordered ?? 0;
    // Optimistic update
    setItemsByList(prevMap => ({
      ...prevMap,
      [listId]: (prevMap[listId] || []).map(i => i.id === item.id ? { ...i, quantity_ordered: newQty } : i),
    }));
    try {
      await upsertItems([{ id: item.id, list_id: listId, quantity_ordered: newQty }]);
    } catch {
      // Revert on failure
      setItemsByList(prevMap => ({
        ...prevMap,
        [listId]: (prevMap[listId] || []).map(i => i.id === item.id ? { ...i, quantity_ordered: prev } : i),
      }));
    }
  };

  const handleItemStatusChange = async (listId, item, newStatus) => {
    // Optimistic update
    setItemsByList(prev => ({
      ...prev,
      [listId]: (prev[listId] || []).map(i => i.id === item.id ? { ...i, status: newStatus } : i),
    }));
    try {
      await upsertItems([{ id: item.id, list_id: listId, status: newStatus }]);
    } catch {
      // Revert on failure
      setItemsByList(prev => ({
        ...prev,
        [listId]: (prev[listId] || []).map(i => i.id === item.id ? { ...i, status: item.status } : i),
      }));
    }
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
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </>
    );
  }

  return (
    <>
      <Header />
      <div className="min-h-screen bg-background">
        {/* Toolbar */}
        <div className="sticky top-0 z-20 bg-background border-b border-border px-6 py-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <h1 className="text-lg font-bold text-foreground">Provisioning</h1>
              {/* Search */}
              <div className="relative">
                <Icon name="Search" className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                <input
                  type="text"
                  placeholder="Search items..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="pl-8 pr-3 py-1.5 text-sm bg-muted border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary w-48"
                />
              </div>
              {/* Status filter */}
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                className="bg-muted border border-border rounded-lg px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary"
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
                className="bg-muted border border-border rounded-lg px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary"
              >
                <option value="all">All depts</option>
                {departments.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              {hasActiveFilters && (
                <button
                  onClick={() => { setSearchQuery(''); setStatusFilter('all'); setDeptFilter('all'); }}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Clear filters
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => navigate('/provisioning/suppliers')}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted-foreground border border-border rounded-lg hover:bg-muted transition-colors"
              >
                <Icon name="Users" className="w-4 h-4" />
                Suppliers
              </button>
              {canCreate && (
                <button
                  onClick={() => setShowNewBoard(true)}
                  className="flex items-center gap-1.5 px-4 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/80 transition-colors"
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

        {/* Shared with me */}
        {sharedWithMe.length > 0 && (
          <div className="px-6 pt-4 pb-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Shared with me</h2>
            <div className="flex gap-3 flex-wrap">
              {sharedWithMe.map(list => (
                <button
                  key={list.id}
                  onClick={() => navigate('/provisioning/' + list.id)}
                  className="flex items-center gap-2.5 px-4 py-2.5 bg-card border border-border rounded-xl text-sm hover:bg-muted transition-colors text-left"
                  style={{ borderTop: list.board_colour ? `3px solid ${list.board_colour}` : undefined }}
                >
                  <div className="min-w-0">
                    <p className="font-medium text-foreground truncate">{list.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 capitalize">{list.myPermission || 'view'} access</p>
                  </div>
                  <Icon name="ChevronRight" className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Empty state — only for users who cannot create boards */}
        {!error && visibleLists.length === 0 && !showNewBoard && !canCreate && (
          <div className="flex items-center justify-center" style={{ minHeight: 'calc(100vh - 130px)' }}>
            <div className="text-center">
              <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
                <Icon name="ShoppingBag" className="w-8 h-8 text-muted-foreground" />
              </div>
              <h3 className="text-base font-semibold text-foreground mb-1">No provisioning boards yet</h3>
              <p className="text-sm text-muted-foreground mb-4">Create your first board to get started.</p>
              {canCreate && (
                <button
                  onClick={() => setShowNewBoard(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/80 transition-colors"
                >
                  <Icon name="Plus" className="w-4 h-4" />
                  New Board
                </button>
              )}
            </div>
          </div>
        )}

        {/* Board workspace — horizontal scroll */}
        {(visibleLists.length > 0 || showNewBoard || canCreate) && (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <div className="flex gap-4 overflow-x-auto px-6 py-4" style={{ minHeight: 'calc(100vh - 130px)' }}>
              <SortableContext items={visibleLists.map(l => l.id)} strategy={horizontalListSortingStrategy}>
                {visibleLists.map(list => {
                  const allItems = itemsByList[list.id] || [];
                  const filtered = getFilteredItems(list.id);
                  const hiddenCount = allItems.length - filtered.length;

                  return (
                    <SortableBoardColumn
                      key={list.id}
                      list={list}
                      items={allItems}
                      filteredItems={filtered}
                      hiddenCount={hasActiveFilters ? hiddenCount : 0}
                      canEdit={canEditList(list)}
                      canCommandDelete={isCommand}
                      collaborators={collaboratorsByList[list.id] || []}
                      onShare={() => setSharingList(list)}
                      onItemClick={(item) => openItemDrawer(item, list.id)}
                      onItemStatusChange={(item, status) => handleItemStatusChange(list.id, item, status)}
                      onItemQuantityChange={(item, qty) => handleItemQuantityChange(list.id, item, qty)}
                      onQuickAdd={(data) => handleQuickAdd(list.id, data)}
                      onNavigate={(id) => navigate('/provisioning/' + id)}
                      onEditBoard={() => openBoardDrawer(list.id, 'edit')}
                      onSuggestions={() => openBoardDrawer(list.id, 'suggestions')}
                      onTemplates={() => openBoardDrawer(list.id, 'templates')}
                      onDuplicate={() => handleDuplicate(list)}
                      onDelete={() => handleDeleteBoard(list)}
                      onTitleSave={handleTitleSave}
                      onColourChange={handleColourChange}
                    />
                  );
                })}
              </SortableContext>

              {/* Ghost column — always visible to creators, becomes the new board form when clicked */}
              {canCreate && !showNewBoard && (
                <GhostBoardColumn onClick={() => setShowNewBoard(true)} />
              )}
              {showNewBoard && (
                <NewBoardColumn
                  trips={trips}
                  tenantId={activeTenantId}
                  userId={userId}
                  onCreated={handleCreateBoard}
                  onCancel={() => setShowNewBoard(false)}
                />
              )}
            </div>
          </DndContext>
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
        departments={departments}
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
        tenantId={activeTenantId}
        departments={departments}
        suppliers={suppliers}
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

      {/* Share Modal */}
      {sharingList && (
        <ShareModal
          list={sharingList}
          crewMembers={crewMembers}
          currentUserId={userId}
          onClose={() => {
            // Refresh collaborators for this list after closing
            fetchCollaborators(sharingList.id).then(colls => {
              setCollaboratorsByList(prev => ({ ...prev, [sharingList.id]: colls }));
            });
            setSharingList(null);
          }}
        />
      )}
    </>
  );
};

export default ProvisioningWorkspace;
