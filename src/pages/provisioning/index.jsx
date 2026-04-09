import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Icon from '../../components/AppIcon';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../contexts/TenantContext';
import { ITEM_STATUS_CONFIG } from './components/StatusBadge';
import BoardColumn from './components/BoardColumn';
import BoardDrawer from './components/BoardDrawer';
import ItemDrawer from './components/ItemDrawer';
import DeliveryModal from './components/DeliveryModal';
import ReceiveDeliveryModal from './components/ReceiveDeliveryModal';
import ShareModal from './components/ShareModal';
import SummaryGauges from './components/SummaryGauges';
import TemplatePicker from './components/TemplatePicker';
import CopyBoardPicker from './components/CopyBoardPicker';
import {
  fetchProvisioningLists,
  fetchListItems,
  createProvisioningList,
  deleteProvisioningList,
  updateProvisioningList,
  duplicateList,
  upsertItems,
  updateProvisioningItem,
  fetchSuppliers,
  fetchVesselDepartments,
  fetchCrewMembers,
  fetchCollaborators,
  fetchSharedWithMe,
  getSmartDeliveryCounts,
  PROVISIONING_STATUS,
} from './utils/provisioningStorage';
import { BOARD_TYPES, TRIP_TYPE_TO_BOARD_TYPE } from './data/templates';
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
  const [step, setStep] = useState(1);            // 1 = basics, 2 = start-from
  const [title, setTitle] = useState('');
  const [boardType, setBoardType] = useState('');
  const [tripId, setTripId] = useState('');
  const [isPrivate, setIsPrivate] = useState(true);
  const [localError, setLocalError] = useState('');
  const [showTemplate, setShowTemplate] = useState(false);
  const [showCopy, setShowCopy] = useState(false);
  const [creating, setCreating] = useState(false);

  const selectedTrip = (trips || []).find(t => t.id === tripId) || null;
  const guestCount = selectedTrip?.guests
    ? (selectedTrip.guests.filter(g => g.isActive).length || selectedTrip.guests.length)
    : 0;

  // Auto-set board type from trip type when not yet chosen
  const handleTripChange = (id) => {
    setTripId(id);
    if (!boardType) {
      const trip = (trips || []).find(t => t.id === id);
      if (trip?.tripType) {
        const mapped = TRIP_TYPE_TO_BOARD_TYPE[trip.tripType];
        if (mapped) setBoardType(mapped);
      }
    }
  };

  const triggerCreate = async (startFrom, extraItems = []) => {
    if (!tenantId) { setLocalError('No vessel selected — cannot create board.'); return; }
    setCreating(true);
    setLocalError('');
    try {
      await onCreated({
        title: title.trim(),
        board_type: boardType || null,
        trip_id: tripId || null,
        is_private: isPrivate,
        startFrom,
        preloadedItems: extraItems,
      });
    } catch (err) {
      setLocalError(err?.message || 'Failed to create board');
      setCreating(false);
    }
  };

  const inputStyle = {
    width: '100%', padding: '7px 10px', border: '1px solid var(--border, #E2E8F0)',
    borderRadius: 8, fontSize: 13, color: 'var(--foreground, #0F172A)',
    background: 'var(--muted, #F8FAFC)', outline: 'none', boxSizing: 'border-box',
  };

  const tripDateRange = selectedTrip?.startDate && selectedTrip?.endDate
    ? `${new Date(selectedTrip.startDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${new Date(selectedTrip.endDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
    : null;

  // ── Render sub-pickers (overlaid inside the card) ─────────────────────────
  if (showTemplate) {
    return (
      <div style={{ width: 340, minWidth: 340, flexShrink: 0, background: 'var(--card, white)', border: '2px dashed var(--border, #E2E8F0)', borderRadius: 14, padding: 16, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', minHeight: 420 }}>
        <TemplatePicker
          boardType={boardType}
          guestCount={guestCount}
          onUse={(items) => { setShowTemplate(false); triggerCreate('template', items); }}
          onBack={() => setShowTemplate(false)}
        />
      </div>
    );
  }

  if (showCopy) {
    return (
      <div style={{ width: 340, minWidth: 340, flexShrink: 0, background: 'var(--card, white)', border: '2px dashed var(--border, #E2E8F0)', borderRadius: 14, padding: 16, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', minHeight: 420 }}>
        <CopyBoardPicker
          tenantId={tenantId}
          department={null}
          newGuestCount={guestCount}
          onUse={(items) => { setShowCopy(false); triggerCreate('copy', items); }}
          onBack={() => setShowCopy(false)}
        />
      </div>
    );
  }

  return (
    <div style={{ width: 340, minWidth: 340, flexShrink: 0, background: 'var(--card, white)', border: '2px dashed var(--border, #E2E8F0)', borderRadius: 14, padding: 16, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* ── Step 1: Board basics ────────────────────────────────────────── */}
      {step === 1 && (
        <>
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--foreground, #0F172A)' }}>New Board</h3>

          {/* Board name */}
          <input
            autoFocus
            value={title}
            onChange={e => setTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') onCancel(); }}
            placeholder="Board name *"
            style={inputStyle}
          />

          {/* Board type pills */}
          <div>
            <p style={{ margin: '0 0 6px', fontSize: 10, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Board type</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {BOARD_TYPES.map(bt => (
                <button
                  key={bt.value}
                  onClick={() => setBoardType(prev => prev === bt.value ? '' : bt.value)}
                  style={{
                    padding: '4px 10px', borderRadius: 20, border: 'none', cursor: 'pointer',
                    fontSize: 11, fontWeight: 600,
                    background: boardType === bt.value ? '#1E3A5F' : '#F1F5F9',
                    color: boardType === bt.value ? 'white' : '#64748B',
                    transition: 'all 0.12s',
                  }}
                >
                  {bt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Link to trip */}
          <div>
            <p style={{ margin: '0 0 6px', fontSize: 10, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Link to trip</p>
            <select
              value={tripId}
              onChange={e => handleTripChange(e.target.value)}
              style={{ ...inputStyle, background: 'var(--muted, #F8FAFC)' }}
            >
              <option value="">No trip linked</option>
              {(trips || []).map(t => (
                <option key={t.id} value={t.id}>{t.name || t.title}</option>
              ))}
            </select>

            {/* Trip details inline */}
            {selectedTrip && (
              <div style={{ marginTop: 8, padding: '7px 10px', background: '#EFF6FF', borderRadius: 8, border: '1px solid #BFDBFE', fontSize: 11, color: '#1E3A5F' }}>
                {tripDateRange && <span>{tripDateRange}</span>}
                {guestCount > 0 && <span style={{ marginLeft: 8 }}>· {guestCount} guests</span>}
                {selectedTrip.tripType && <span style={{ marginLeft: 8 }}>· {selectedTrip.tripType}</span>}
              </div>
            )}
          </div>

          {/* Privacy toggle */}
          <button
            type="button"
            onClick={() => setIsPrivate(p => !p)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border, #E2E8F0)', background: 'var(--muted, #F8FAFC)', cursor: 'pointer' }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--foreground, #0F172A)' }}>
              <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: '#94A3B8' }}>
                {isPrivate
                  ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                }
              </svg>
              {isPrivate ? 'Private board' : 'Department board'}
            </span>
            <div style={{ width: 36, height: 20, borderRadius: 10, background: isPrivate ? '#1E3A5F' : '#CBD5E1', position: 'relative', transition: 'background 0.15s' }}>
              <div style={{ position: 'absolute', top: 2, left: isPrivate ? 18 : 2, width: 16, height: 16, borderRadius: '50%', background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transition: 'left 0.15s' }} />
            </div>
          </button>

          {localError && <p style={{ margin: 0, fontSize: 11, color: '#EF4444', background: '#FEF2F2', borderRadius: 6, padding: '6px 10px' }}>{localError}</p>}

          {/* Step 1 CTAs */}
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button
              onClick={() => { if (title.trim()) setStep(2); }}
              disabled={!title.trim()}
              style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: 'none', cursor: title.trim() ? 'pointer' : 'default', background: title.trim() ? '#1E3A5F' : '#E2E8F0', color: title.trim() ? 'white' : '#94A3B8', fontSize: 13, fontWeight: 600 }}
            >
              Next →
            </button>
            <button onClick={onCancel} style={{ padding: '8px 12px', borderRadius: 8, border: 'none', background: 'none', color: '#94A3B8', cursor: 'pointer', fontSize: 13 }}>
              Cancel
            </button>
          </div>
        </>
      )}

      {/* ── Step 2: Start from ──────────────────────────────────────────── */}
      {step === 2 && !creating && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={() => setStep(1)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B', padding: '2px 4px', fontSize: 13 }}>←</button>
            <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--foreground, #0F172A)' }}>Start from</h3>
          </div>
          <p style={{ margin: 0, fontSize: 11, color: '#94A3B8' }}>
            Creating: <strong style={{ color: '#1E3A5F' }}>{title}</strong>
            {boardType && <span> · {BOARD_TYPES.find(b => b.value === boardType)?.label}</span>}
          </p>

          {/* 3-card grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            {[
              { key: 'template', icon: '📋', title: 'Template',    desc: 'Pre-built lists' },
              { key: 'copy',     icon: '📂', title: 'Copy Board',  desc: 'From previous' },
              { key: 'blank',    icon: '✦',  title: 'Blank',       desc: 'Start empty' },
            ].map(opt => (
              <button
                key={opt.key}
                onClick={() => {
                  if (opt.key === 'template') setShowTemplate(true);
                  else if (opt.key === 'copy') setShowCopy(true);
                  else triggerCreate('blank', []);
                }}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  padding: '14px 8px', borderRadius: 10, border: '1px solid #E2E8F0',
                  background: 'white', cursor: 'pointer', gap: 4,
                  transition: 'all 0.12s',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = '#1E3A5F'; e.currentTarget.style.background = '#F8FAFF'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = '#E2E8F0'; e.currentTarget.style.background = 'white'; }}
              >
                <span style={{ fontSize: 18, lineHeight: 1 }}>{opt.icon}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#0F172A' }}>{opt.title}</span>
                <span style={{ fontSize: 10, color: '#94A3B8' }}>{opt.desc}</span>
              </button>
            ))}
          </div>

          {localError && <p style={{ margin: 0, fontSize: 11, color: '#EF4444', background: '#FEF2F2', borderRadius: 6, padding: '6px 10px' }}>{localError}</p>}
        </>
      )}

      {creating && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 0' }}>
          <p style={{ fontSize: 13, color: '#94A3B8' }}>Creating board…</p>
        </div>
      )}
    </div>
  );
};

// ── Main Workspace ───────────────────────────────────────────────────────────

const ProvisioningWorkspace = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, tenantRole } = useAuth();
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

  // Currency display for summary
  const [summaryDisplayCurrency, setSummaryDisplayCurrency] = useState('GBP');
  const [summaryFxRates, setSummaryFxRates] = useState({ GBP: 1, USD: 1.27, EUR: 1.17 });
  const [summaryFxLabel, setSummaryFxLabel] = useState('');

  // Smart Delivery
  const [inboxCount, setInboxCount] = useState(0);

  // UI state
  const [showNewBoard, setShowNewBoard] = useState(false);
  const [boardDrawer, setBoardDrawer] = useState({ open: false, listId: null, mode: 'edit' });
  const [itemDrawer, setItemDrawer] = useState({ open: false, item: null, listId: null });
  const [deliveryModal, setDeliveryModal] = useState({ open: false, list: null });
  const [sharingList, setSharingList] = useState(null);

  // Workspace-level receive delivery
  const [showWorkspaceReceiveModal, setShowWorkspaceReceiveModal] = useState(false);
  const [workspaceItems, setWorkspaceItems] = useState([]);
  const [workspaceItemsLoading, setWorkspaceItemsLoading] = useState(false);

  // RBAC
  const userTier = (tenantRole || '').toUpperCase();
  const userDept = (user?.department || '').trim();
  const userId = user?.id;
  const canCreate = userTier !== 'VIEW_ONLY';
  const isCommand = userTier === 'COMMAND';
  const canViewDeliveryHistory = userTier === 'COMMAND' || userTier === 'CHIEF';

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

  useEffect(() => {
    if (!userId || !activeTenantId) return;
    getSmartDeliveryCounts(userId, activeTenantId).then(c => setInboxCount((c.pendingMatches || 0) + (c.inboxItems || 0)));
  }, [userId, activeTenantId]);

  // Fetch live FX rates once on mount
  useEffect(() => {
    fetch('https://api.frankfurter.dev/v2/rates?base=GBP&quotes=USD,EUR')
      .then(r => r.json())
      .then(d => {
        if (d?.rates) {
          setSummaryFxRates({ GBP: 1, USD: d.rates.USD || 1.27, EUR: d.rates.EUR || 1.17 });
          const ts = d.date ? new Date(d.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '';
          setSummaryFxLabel(ts ? `Rates as of ${ts}` : '');
        }
      })
      .catch(() => {});
  }, []);

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

  // Auto-open workspace receive modal from URL param (?receive=true)
  useEffect(() => {
    if (searchParams.get('receive') === 'true') {
      window.history.replaceState({}, '', '/provisioning');
      // Wait for lists to load before opening
      if (!loading) handleOpenWorkspaceReceive();
    }
  }, [searchParams, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Collect all non-completed, non-template board items for workspace-level scan
  const handleOpenWorkspaceReceive = async () => {
    setWorkspaceItemsLoading(true);
    try {
      const activeBoards = lists.filter(l => l.status !== 'completed' && !l.is_template && canViewList(l));
      const allItems = [];
      await Promise.all(activeBoards.map(async (board) => {
        const boardItems = itemsByList[board.id] || await fetchListItems(board.id).catch(() => []);
        boardItems.forEach(item => {
          if (item.status !== 'received') {
            allItems.push({ ...item, _boardId: board.id, _boardTitle: board.title });
          }
        });
      }));
      setWorkspaceItems(allItems);
      setShowWorkspaceReceiveModal(true);
    } catch {
      showToast('Failed to load items', 'error');
    } finally {
      setWorkspaceItemsLoading(false);
    }
  };

  // ── Board actions ────────────────────────────────────────────────────────

  const handleCreateBoard = async ({ title, board_type, trip_id, order_by_date, is_private = true, preloadedItems = [] }) => {
    try {
      console.log('[Provisioning] createBoard — tenant_id:', activeTenantId, 'userId:', userId);

      // Resolve department name from userDeptId via departments table (most reliable source)
      let resolvedDeptName = '';
      if (userDeptId) {
        const { data: deptRow } = await supabase?.from('departments')?.select('name')?.eq('id', userDeptId)?.single();
        resolvedDeptName = deptRow?.name || '';
      }

      const newList = await createProvisioningList({
        tenant_id: activeTenantId,
        title,
        board_type: board_type || null,
        trip_id: trip_id || null,
        order_by_date: order_by_date || null,
        status: PROVISIONING_STATUS.DRAFT,
        created_by: userId,
        owner_id: userId,
        department_id: userDeptId || null,
        visibility: is_private ? 'private' : 'department',
        department: resolvedDeptName ? [resolvedDeptName] : [],
        port_location: '',
        notes: '',
        currency: 'USD',
        estimated_cost: null,
        actual_cost: null,
        supplier_id: null,
        is_private: is_private,
        is_template: false,
      });

      let initialItems = [];
      if (preloadedItems.length > 0) {
        const itemPayload = preloadedItems.map(({ tenant_id: _drop, ...item }) => ({
          ...item,
          list_id: newList.id,
          status: item.status || 'pending',
        }));
        initialItems = await upsertItems(itemPayload);
      }

      setLists(prev => [newList, ...prev]);
      setItemsByList(prev => ({ ...prev, [newList.id]: initialItems }));
      setShowNewBoard(false);
      showToast(
        preloadedItems.length > 0
          ? `Board created with ${initialItems.length} items`
          : 'Board created',
        'success'
      );
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
        status: 'draft',
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
      // Use plain UPDATE (not upsert) — upsert fires INSERT first which fails on partial payload
      await updateProvisioningItem(item.id, { quantity_ordered: newQty });
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
      // Received items are never shown on kanban cards
      if (item.status === 'received') return false;
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

  // ── Cross-board summary totals ───────────────────────────────────────────
  const crossBoardTotals = useMemo(() => {
    const disp = summaryDisplayCurrency;
    const rates = summaryFxRates;
    const CURR_SYMBOLS = { GBP: '£', USD: '$', EUR: '€' };
    const sym = CURR_SYMBOLS[disp] || '£';

    let totalItems = 0, receivedItems = 0, pendingItems = 0;
    let totalCost = 0, paidCost = 0, leftToPayCost = 0;
    let boardCount = 0;

    visibleLists.forEach(list => {
      const items = itemsByList[list.id] || [];
      if (items.length === 0) return;
      boardCount++;
      const listCurr = list.currency || 'GBP';

      items.forEach(item => {
        const cost = parseFloat(item.estimated_unit_cost) || 0;
        const qty = parseFloat(item.quantity_ordered) || 0;
        const iCurr = item.currency || listCurr;
        const converted = qty * ((cost / (rates[iCurr] || 1)) * (rates[disp] || 1));

        totalItems++;
        if (['received', 'partial'].includes(item.status)) receivedItems++;
        else pendingItems++;
        totalCost += converted;

        const ps = item.payment_status ?? 'awaiting_invoice';
        if (['paid', 'paid_upfront'].includes(ps)) paidCost += converted;
        else leftToPayCost += converted;
      });
    });

    return { totalItems, receivedItems, pendingItems, totalCost, paidCost, leftToPayCost, boardCount, sym, disp };
  }, [visibleLists, itemsByList, summaryDisplayCurrency, summaryFxRates]);

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
              {userTier !== 'CREW' && <button
                onClick={() => navigate('/provisioning/inbox')}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted-foreground border border-border rounded-lg hover:bg-muted transition-colors"
                style={{ position: 'relative' }}
              >
                <Icon name="Inbox" className="w-4 h-4" />
                Delivery Inbox
                {inboxCount > 0 && (
                  <span style={{
                    position: 'absolute', top: -6, right: -6,
                    minWidth: 16, height: 16, borderRadius: 8, background: '#DC2626',
                    color: 'white', fontSize: 9, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px',
                  }}>
                    {inboxCount > 99 ? '99+' : inboxCount}
                  </span>
                )}
              </button>}
              {canViewDeliveryHistory && (
                <button
                  onClick={() => navigate('/provisioning/history')}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted-foreground border border-border rounded-lg hover:bg-muted transition-colors"
                >
                  <Icon name="BookOpen" className="w-4 h-4" />
                  Delivery History
                </button>
              )}
              <button
                onClick={() => navigate('/provisioning/suppliers')}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted-foreground border border-border rounded-lg hover:bg-muted transition-colors"
              >
                <Icon name="Users" className="w-4 h-4" />
                Suppliers
              </button>
              <button
                onClick={handleOpenWorkspaceReceive}
                disabled={workspaceItemsLoading || loading}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors"
                style={{ border: '1px solid #1D9E75', color: '#1D9E75', background: 'transparent' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#F0FDF4'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
              >
                <Icon name="PackageOpen" className="w-4 h-4" />
                {workspaceItemsLoading ? 'Loading…' : 'Receive Items'}
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

        {/* ── Cross-board summary gauges — below kanban boards ─────────────── */}
        {!loading && crossBoardTotals.totalItems > 0 && (
          <div style={{ padding: '0 24px 32px' }}>
            <SummaryGauges
              leftToReceive={crossBoardTotals.pendingItems}
              totalCount={crossBoardTotals.totalItems}
              receivedCount={crossBoardTotals.receivedItems}
              totalValue={crossBoardTotals.totalCost}
              costSubtext={`${crossBoardTotals.totalItems} item${crossBoardTotals.totalItems !== 1 ? 's' : ''} across all boards`}
              leftToPayValue={crossBoardTotals.leftToPayCost}
              paidValue={crossBoardTotals.paidCost}
              dispSymbol={crossBoardTotals.sym}
              dispCurr={summaryDisplayCurrency}
              setDisplayCurrency={setSummaryDisplayCurrency}
              fxRatesLabel={summaryFxLabel}
            />
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
        theme="light"
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

      {/* Workspace-level Receive Delivery modal */}
      {showWorkspaceReceiveModal && (
        <ReceiveDeliveryModal
          list={null}
          items={workspaceItems}
          tenantId={activeTenantId}
          multiBoard={true}
          boards={lists.filter(l => l.status !== 'completed' && !l.is_template && canViewList(l))}
          onClose={() => setShowWorkspaceReceiveModal(false)}
          onComplete={() => {
            setShowWorkspaceReceiveModal(false);
            loadAll();
            showToast('Delivery received', 'success');
          }}
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
