import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Icon from '../../components/AppIcon';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../contexts/TenantContext';
import { ITEM_STATUS_CONFIG, ITEM_STATUS_FILTER_ORDER, deriveDisplayStatus } from './data/statusConfig';
import BoardColumn from './components/BoardColumn';
import BoardDrawer from './components/BoardDrawer';
import ItemDrawer from './components/ItemDrawer';
import ReceiveDeliveryModal from './components/ReceiveDeliveryModal';
import ShareModal from './components/ShareModal';
import SummaryGauges from './components/SummaryGauges';
import PastActivityPicker from './components/PastActivityPicker';
import {
  fetchProvisioningLists,
  fetchListItems,
  fetchSupplierOrdersForLists,
  createProvisioningList,
  deleteProvisioningList,
  updateProvisioningList,
  duplicateList,
  saveAsTemplate,
  upsertItems,
  updateProvisioningItem,
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
import './provisioning-board.css';
import './provisioning-dashboard.css';
import './board-creation-wizard.css';
import '../../styles/editorial.css';

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

const GhostBoardColumn = ({ onClick }) => (
  <div onClick={onClick} className="pv-ghost-column">
    <Icon name="Plus" className="w-6 h-6" />
    <p style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>New Board</p>
    <p style={{ fontSize: 11, margin: 0, opacity: 0.7 }}>Click to add a board</p>
  </div>
);

// ── New Board inline form ────────────────────────────────────────────────────

const NewBoardColumn = ({ trips, tenantId, userId, userDept, onCreated, onCancel }) => {
  // Source-first flow: step 1 picks HOW you start (fresh / build from),
  // step 2 collects the basics (name / type / trip / privacy). The
  // Build-from picker opens after step 2 so it still has the trip +
  // board type + guest count it needs to scale quantities.
  const [step, setStep] = useState(1);            // 1 = source, 2 = basics
  const [startMode, setStartMode] = useState(null); // 'blank' | 'build'
  // Build-from path stages the picked items here while the chief fills
  // in the basics, then triggerCreate sends them with the new board.
  const [stagedItems, setStagedItems] = useState([]);
  const [stagedSource, setStagedSource] = useState('past');
  const [title, setTitle] = useState('');
  const [boardType, setBoardType] = useState('');
  const [tripId, setTripId] = useState('');
  const [isPrivate, setIsPrivate] = useState(true);
  const [localError, setLocalError] = useState('');
  const [showPast, setShowPast] = useState(false);
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

  const triggerCreate = async (startFrom, extraItems = [], openMarketplace = false) => {
    if (!tenantId) { setLocalError('No vessel selected — cannot create board.'); return; }
    setCreating(true);
    setLocalError('');
    try {
      // tripId state holds the merged trip's legacy id (display + dropdown
      // value). Provisioning_lists.trip_id is uuid; resolve to the
      // canonical Supabase UUID via selectedTrip.supabaseId before
      // crossing the wire.
      await onCreated({
        title: title.trim(),
        board_type: boardType || null,
        trip_id: selectedTrip?.supabaseId || null,
        is_private: isPrivate,
        startFrom,
        preloadedItems: extraItems,
        openMarketplace,
      });
    } catch (err) {
      setLocalError(err?.message || 'Failed to create board');
      setCreating(false);
    }
  };

  const tripDateRange = selectedTrip?.startDate && selectedTrip?.endDate
    ? `${new Date(selectedTrip.startDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${new Date(selectedTrip.endDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
    : null;

  // ── Render sub-picker (overlaid inside the card) ─────────────────────────
  // Build-from path: the picker opens straight from the step-1 tile, so
  // onUse STAGES the chosen items and advances to the basics step rather
  // than creating immediately (the board still needs a name / type /
  // trip). Guest-count scaling inside the picker no-ops until a trip is
  // set — the chief picks the trip on the next step, and can re-open the
  // picker via the back arrow to re-scale if they want.
  if (showPast) {
    return (
      <div className="pv-wizard pv-dashboard is-subview">
        <PastActivityPicker
          tenantId={tenantId}
          tripId={selectedTrip?.supabaseId || selectedTrip?.id || null}
          newGuestCount={guestCount}
          boardType={boardType}
          currentDepartment={userDept || null}
          onUse={(items, source) => {
            setStagedItems(items || []);
            setStagedSource(source || 'past');
            setShowPast(false);
            setStep(2);
          }}
          onBack={() => { setShowPast(false); setStep(1); }}
        />
      </div>
    );
  }

  return (
    <div className="pv-wizard pv-dashboard">

      {/* ── Step 2: Board basics ────────────────────────────────────────── */}
      {step === 2 && !creating && (
        <>
          <div className="pv-wizard-header">
            {/* Back: build-mode reopens the picker (re-pick / re-scale);
                blank-mode returns to the source choice. */}
            <button
              onClick={() => { if (startMode === 'build') setShowPast(true); else setStep(1); }}
              className="pv-wizard-back"
              aria-label="Back"
            >←</button>
            <h3 className="pv-wizard-title">
              <span className="pv-wizard-title-dot" aria-hidden="true" />
              New board
            </h3>
          </div>
          <p className="pv-wizard-context">
            {startMode === 'build'
              ? <>Build from… · <strong>{stagedItems.length} item{stagedItems.length === 1 ? '' : 's'}</strong></>
              : 'Start fresh'}
          </p>

          {/* Board name */}
          <input
            autoFocus
            value={title}
            onChange={e => setTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') onCancel(); }}
            placeholder="Board name *"
            className="pv-wizard-input"
          />

          {/* Board type pills */}
          <div>
            <p className="pv-wizard-label">Board type</p>
            <div className="pv-wizard-pill-row">
              {BOARD_TYPES.map(bt => (
                <button
                  key={bt.value}
                  onClick={() => setBoardType(prev => prev === bt.value ? '' : bt.value)}
                  className={`pv-wizard-pill${boardType === bt.value ? ' is-active' : ''}`}
                >
                  {bt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Link to trip */}
          <div>
            <p className="pv-wizard-label">Link to trip</p>
            <div className="pv-wizard-select-wrap">
              <select
                value={tripId}
                onChange={e => handleTripChange(e.target.value)}
                className="pv-wizard-select"
              >
                <option value="">No trip linked</option>
                {(trips || []).map(t => (
                  <option key={t.id} value={t.id}>{t.name || t.title}</option>
                ))}
              </select>
              <svg className="pv-wizard-select-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </div>

            {/* Trip details inline */}
            {selectedTrip && (
              <div className="pv-wizard-trip-strip">
                {tripDateRange && <span>{tripDateRange}</span>}
                {guestCount > 0 && <span>· {guestCount} guests</span>}
                {selectedTrip.tripType && <span>· {selectedTrip.tripType}</span>}
              </div>
            )}
          </div>

          {/* Privacy toggle */}
          <button
            type="button"
            onClick={() => setIsPrivate(p => !p)}
            className="pv-wizard-toggle"
          >
            <span className="pv-wizard-toggle-label">
              <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" className="pv-wizard-toggle-icon">
                {isPrivate
                  ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                }
              </svg>
              {isPrivate ? 'Private board' : 'Department board'}
            </span>
            <div className={`pv-wizard-toggle-track${isPrivate ? ' is-on' : ''}`}>
              <div className="pv-wizard-toggle-knob" />
            </div>
          </button>

          {localError && <p className="pv-wizard-error">{localError}</p>}

          {/* Step 2 CTA — both paths create here. Build from… sends
              the items staged from the picker; Start fresh sends an
              empty board. */}
          <div className="pv-wizard-cta-row">
            <button
              onClick={() => {
                if (!title.trim()) return;
                if (startMode === 'build') triggerCreate(stagedSource, stagedItems);
                else triggerCreate('blank', []);
              }}
              disabled={!title.trim()}
              className="pv-wizard-btn pv-wizard-btn-primary"
            >
              Create board
            </button>
            <button
              onClick={() => {
                if (!title.trim()) return;
                if (startMode === 'build') triggerCreate(stagedSource, stagedItems, true);
                else triggerCreate('blank', [], true);
              }}
              disabled={!title.trim()}
              className="pv-wizard-btn pv-wizard-btn-ghost"
              title="Create the board and start filling it from supplier catalogues"
            >
              Create &amp; browse marketplace
            </button>
            <button onClick={onCancel} className="pv-wizard-btn pv-wizard-btn-ghost">
              Cancel
            </button>
          </div>
        </>
      )}

      {/* ── Step 1: How do you want to start? ───────────────────────────── */}
      {/* Twin magazine tiles (editorial Option C): a terracotta top-rule,
          serif title, muted descriptor. Picking a tile sets the source
          mode and advances to the basics step. Source-first so the
          fork leads the flow rather than trailing a long form. */}
      {step === 1 && !creating && (
        <>
          {/* Editorial headline carries the prompt itself — the plain
              "New board" eyebrow is dropped. Serif with an italic
              terracotta accent on "start?", echoing the page
              headlines. */}
          <h3 className="pv-wizard-start-head">
            How do you want to <em>start?</em>
          </h3>

          <div className="pv-wizard-tile-grid">
            {[
              { key: 'blank', title: 'Start fresh', desc: 'Empty board, add items as you go' },
              { key: 'build', title: 'Build from…', desc: 'Boards · Past orders · Catalogue · Suggestions' },
            ].map(opt => (
              <button
                key={opt.key}
                onClick={() => {
                  setStartMode(opt.key);
                  // Build from… jumps straight to the picker
                  // (templates / past orders / catalogue /
                  // suggestions). Start fresh goes to the basics.
                  if (opt.key === 'build') setShowPast(true);
                  else setStep(2);
                }}
                className="pv-wizard-tile"
              >
                <span className="pv-wizard-tile-body">
                  <span className="pv-wizard-tile-title">{opt.title}</span>
                  <span className="pv-wizard-tile-desc">{opt.desc}</span>
                </span>
              </button>
            ))}
          </div>

          {localError && <p className="pv-wizard-error">{localError}</p>}

          <div className="pv-wizard-cta-row">
            <button onClick={onCancel} className="pv-wizard-btn pv-wizard-btn-ghost">
              Cancel
            </button>
          </div>
        </>
      )}

      {creating && (
        <div className="pv-wizard-loading">
          <p className="pv-wizard-loading-text">Creating board…</p>
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
  // supplier_orders keyed by list_id. Fed to the kanban so each ItemCard
  // can run deriveDisplayStatus and surface confirmed/unavailable/
  // substituted/invoiced/paid the same way the items table does.
  const [supplierOrdersByList, setSupplierOrdersByList] = useState({});
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
  const [itemDrawer, setItemDrawer] = useState({ open: false, item: null, listId: null, readOnly: false });
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
    // Invited collaborator with edit / approve permission — honours the
    // same access the RLS grants (20260627090000), so the UI doesn't
    // present a read-only board to someone the DB lets write.
    const myCollab = (collaboratorsByList[list.id] || []).find(c => c.user_id === userId);
    if (myCollab && ['edit', 'approve'].includes(myCollab.permission)) return true;
    if (['CHIEF', 'HOD'].includes(userTier)) {
      const listDepts = Array.isArray(list.department)
        ? list.department.filter(Boolean)
        : (list.department ? list.department.split(',').map(d => d.trim()) : []);
      return !listDepts.length || listDepts.some(d => d === userDept);
    }
    return false;
  }, [userId, userTier, userDept, isOwner, collaboratorsByList]);

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

  // Refresh the lists when the user navigates back to the kanban
  // from a board that just changed status (confirmed via quote
  // approval, etc.) — otherwise the tile shows stale "QUOTE IN".
  // Two triggers: window focus + a custom event the board fires
  // after approveAllQuotes lands.
  useEffect(() => {
    if (!activeTenantId || !userId) return undefined;
    const refresh = () => { loadAll(userDeptId); };
    window.addEventListener('focus', refresh);
    window.addEventListener('provisioning-list-status-changed', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('provisioning-list-status-changed', refresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTenantId, userId, userDeptId]);

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
          const ts = d.date ? new Date(d.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
          setSummaryFxLabel(ts ? `Rates as of ${ts}` : '');
        }
      })
      .catch(() => {});
  }, []);

  const loadAll = async (deptId = userDeptId) => {
    setLoading(true);
    setError(null);
    try {
      // loadTrips is async (Supabase + localStorage merge post-A3.1)
      let fetchedTrips = [];
      try { fetchedTrips = (await loadTrips()) || []; } catch { fetchedTrips = []; }

      const fetchedLists = await fetchProvisioningLists(activeTenantId, userId, deptId, userTier);
      setLists(fetchedLists || []);
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

  const handleCreateBoard = async ({ title, board_type, trip_id, is_private = true, preloadedItems = [], openMarketplace = false }) => {
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
        status: PROVISIONING_STATUS.DRAFT,
        created_by: userId,
        owner_id: userId,
        department_id: userDeptId || null,
        visibility: is_private ? 'private' : 'department',
        department: resolvedDeptName ? [resolvedDeptName] : [],
        notes: '',
        currency: 'USD',
        estimated_cost: null,
        actual_cost: null,
        is_private: is_private,
        is_template: false,
      });

      let initialItems = [];
      if (preloadedItems.length > 0) {
        const itemPayload = preloadedItems.map(({ tenant_id: _drop, ...item }) => ({
          ...item,
          list_id: newList.id,
          status: 'draft',
        }));
        initialItems = await upsertItems(itemPayload);
      }

      setLists(prev => [newList, ...prev]);
      setItemsByList(prev => ({ ...prev, [newList.id]: initialItems }));
      setShowNewBoard(false);
      if (openMarketplace) {
        navigate(`/provisioning/marketplace?board=${newList.id}`);
        return;
      }
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

  // Fire-and-toast: flip is_template=true on the board. Source board
  // stays untouched (template is the same row, just flagged). The
  // Quick Add panel's Templates tab picks it up on next open.
  const handleSaveAsTemplate = async (list) => {
    try {
      await saveAsTemplate(list.id, true);
      showToast(`"${list.title}" saved as template`, 'success');
    } catch (err) {
      console.error('[provisioning] handleSaveAsTemplate error:', err);
      showToast('Failed to save as template', 'error');
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

  // Per-list itemStatusMap (keyed by lowered item.name → supplier entry +
  // parentOrder ref). Built once whenever supplierOrdersByList changes;
  // consumed by getFilteredItems for derive-aware filtering and threaded
  // to BoardColumn for derive-aware pill rendering.
  const itemStatusMapByList = useMemo(() => {
    const result = {};
    Object.entries(supplierOrdersByList).forEach(([listId, orders]) => {
      const map = {};
      (orders || []).forEach((order) => {
        (order.supplier_order_items || []).forEach((oi) => {
          const key = (oi.item_name || '').toLowerCase().trim();
          if (!map[key]) {
            // Detect any supplier-side override of the crew's original
            // ask (qty/unit/size) so the ItemCard can pip the change at
            // a glance without the chief drilling into the order.
            const qtyChanged  = oi.requested_quantity != null && String(oi.requested_quantity) !== String(oi.quantity);
            const unitChanged = !!oi.requested_unit && String(oi.requested_unit).toLowerCase() !== String(oi.unit || '').toLowerCase();
            const sizeChanged = !!oi.requested_size && String(oi.requested_size).toLowerCase() !== String(oi.size || '').toLowerCase();
            map[key] = {
              status: oi.status,
              quoteStatus: oi.quote_status,
              substitution: oi.substitute_description,
              subPrice: oi.substitution_price,
              supplierNote: oi.supplier_item_note,
              // Best price the supplier has settled — agreed > quoted.
              // Estimated stays vessel-side (we don't surface it).
              supplierPrice: oi.agreed_price ?? oi.quoted_price ?? null,
              supplierCurrency: oi.agreed_currency || oi.quoted_currency || null,
              // qty/unit/size deltas — frozen requested_* vs live.
              requestedQuantity: oi.requested_quantity,
              quantity: oi.quantity,
              requestedUnit: oi.requested_unit,
              unit: oi.unit,
              requestedSize: oi.requested_size,
              size: oi.size,
              qtyChanged, unitChanged, sizeChanged,
              hasChanges: qtyChanged || unitChanged || sizeChanged,
              hasNote: !!(oi.supplier_item_note && String(oi.supplier_item_note).trim()),
              parentOrder: order,
            };
          }
        });
      });
      result[listId] = map;
    });
    return result;
  }, [supplierOrdersByList]);

  // Fetch supplier_orders for visible lists. Refreshes whenever the list
  // set changes (board added/deleted, navigation between tenants, etc).
  useEffect(() => {
    const listIds = lists.map(l => l.id).filter(Boolean);
    if (listIds.length === 0) {
      setSupplierOrdersByList({});
      return;
    }
    let cancelled = false;
    fetchSupplierOrdersForLists(listIds)
      .then(data => { if (!cancelled) setSupplierOrdersByList(data); })
      .catch(err => console.error('[provisioning workspace] fetchSupplierOrdersForLists error:', err));
    return () => { cancelled = true; };
  }, [lists]);

  const getFilteredItems = useCallback((listId) => {
    const items = itemsByList[listId] || [];
    const supplierMap = itemStatusMapByList[listId] || {};
    return items.filter(item => {
      // Received items are never shown on kanban cards
      if (item.status === 'received') return false;
      if (statusFilter !== 'all') {
        // Filter against the DERIVED status — picking "Confirmed" matches
        // items where the supplier's response set that state even when
        // raw item.status is still 'ordered'.
        const supplierEntry = supplierMap[(item.name || '').toLowerCase().trim()];
        const derived = deriveDisplayStatus(item, supplierEntry, supplierEntry?.parentOrder);
        if (derived !== statusFilter) return false;
      }
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
  }, [itemsByList, itemStatusMapByList, statusFilter, deptFilter, searchQuery]);

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
    // If the item is already inside a supplier_order, the kanban-side
    // drawer drops to read-only — the chief should never silently edit
    // qty / unit / size / brand on a sent line behind the supplier's
    // back. To make changes after send, open the board detail and
    // either edit the still-pending lines inline or use the ↺ Reopen
    // flow on a committed line. Matches the inline qty-stepper lock
    // landed in #1205.
    const supplierEntry = (itemStatusMapByList[listId] || {})[(item?.name || '').toLowerCase().trim()];
    const readOnly = !!supplierEntry;
    setItemDrawer({ open: true, item, listId, readOnly });
    setBoardDrawer({ open: false, listId: null, mode: 'edit' });
  };

  const activeBoardList = boardDrawer.listId ? lists.find(l => l.id === boardDrawer.listId) : null;

  // ── Render ───────────────────────────────────────────────────────────────

  // Editorial meta-strip counts derived from existing state.
  const boardCount = visibleLists.length;
  const awaitingDeliveryCount = visibleLists.filter(l => l.status === 'sent_to_supplier').length;
  const itemCount = visibleLists.reduce((sum, l) => sum + (itemsByList[l.id]?.length || 0), 0);

  if (loading) {
    return (
      <>
        <Header />
        <div className="pv-board pv-dashboard" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </>
    );
  }

  return (
    <>
      <Header />
      <div className="pv-board pv-dashboard">
        {/* Editorial header — meta strip + headline + action buttons */}
        <div className="pv-board-headblock">
          <div className="pv-board-headblock-left">
            <p className="editorial-meta">
              <span className="dot">●</span>
              <span>Provisioning</span>
              <span className="bar" />
              <span className="muted">{boardCount} board{boardCount === 1 ? '' : 's'}</span>
              <span className="bar" />
              <span className="muted">{awaitingDeliveryCount} awaiting delivery</span>
              <span className="bar" />
              <span className="muted">{itemCount} item{itemCount === 1 ? '' : 's'}</span>
            </p>
            <h1 className="editorial-greeting">
              BOARDS<span className="period">,</span> <em>in progress</em><span className="period">.</span>
            </h1>
          </div>
          <div className="pv-board-headblock-actions">
            {canCreate && (
              <button
                onClick={() => setShowNewBoard(true)}
                className="pv-btn pv-btn-primary"
              >
                <Icon name="Plus" className="w-4 h-4" />
                New board
              </button>
            )}
            <button
              onClick={handleOpenWorkspaceReceive}
              disabled={workspaceItemsLoading || loading}
              className="pv-btn pv-btn-secondary"
            >
              <Icon name="PackageOpen" className="w-4 h-4" />
              {workspaceItemsLoading ? 'Loading…' : 'Receive items'}
            </button>
            <button
              onClick={() => navigate('/provisioning/marketplace')}
              className="pv-btn pv-btn-secondary"
            >
              <Icon name="Store" className="w-4 h-4" />
              Marketplace
            </button>
          </div>
        </div>

        {/* Toolbar row: search + filters + spacer + hairline + quiet nav links */}
        <div className="pv-toolbar">
          <div className="pv-toolbar-search">
            <span className="pv-toolbar-search-icon"><Icon name="Search" className="w-4 h-4" /></span>
            <input
              type="text"
              placeholder="Search items"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pv-toolbar-search-input"
            />
          </div>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="pv-toolbar-select"
          >
            <option value="all">All statuses</option>
            {ITEM_STATUS_FILTER_ORDER.map(val => {
              const cfg = ITEM_STATUS_CONFIG[val];
              return <option key={val} value={val}>{cfg.label}</option>;
            })}
          </select>
          <select
            value={deptFilter}
            onChange={e => setDeptFilter(e.target.value)}
            className="pv-toolbar-select"
          >
            <option value="all">All depts</option>
            {departments.map(d => <option key={d.id || d.name} value={d.name}>{d.name}</option>)}
          </select>
          {hasActiveFilters && (
            <button
              onClick={() => { setSearchQuery(''); setStatusFilter('all'); setDeptFilter('all'); }}
              className="pv-toolbar-clear"
            >
              Clear filters
            </button>
          )}

          <div className="pv-toolbar-spacer" />
          <div className="pv-toolbar-divider" />

          {userTier !== 'CREW' && (
            <button onClick={() => navigate('/provisioning/inbox')} className="pv-toolbar-link">
              <Icon name="Inbox" className="w-4 h-4" />
              Delivery inbox
              {inboxCount > 0 && (
                <span className="pv-toolbar-link-badge">{inboxCount > 99 ? '99+' : inboxCount}</span>
              )}
            </button>
          )}
          {/* Orders entry collapses the prior standalone "Delivery history"
              toolbar button — both are sides of supplier activity, surfaced
              together inside the Orders page. canViewDeliveryHistory gate
              is moot here: Orders is visible to anyone with provisioning
              access (RLS dept-scopes the rows). The Delivery history link
              inside the Orders page can still tier-gate if needed. */}
          <button onClick={() => navigate('/provisioning/orders')} className="pv-toolbar-link">
            <Icon name="Truck" className="w-4 h-4" />
            Orders
          </button>
          <button onClick={() => navigate('/provisioning/suppliers')} className="pv-toolbar-link">
            <Icon name="Users" className="w-4 h-4" />
            Suppliers
          </button>
          <button onClick={() => navigate('/provisioning/marketplace')} className="pv-toolbar-link">
            <Icon name="Store" className="w-4 h-4" />
            Marketplace
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="pv-error">
            <p style={{ fontSize: 13, margin: 0 }}>{error}</p>
            <button onClick={loadAll} className="pv-error-retry">Retry</button>
          </div>
        )}

        {/* Shared with me */}
        {sharedWithMe.length > 0 && (
          <div className="pv-shared">
            <h2 className="pv-shared-title">Shared with me</h2>
            <div className="pv-shared-cards">
              {sharedWithMe.map(list => (
                <button
                  key={list.id}
                  onClick={() => navigate('/provisioning/' + list.id)}
                  className="pv-shared-card"
                >
                  <div style={{ minWidth: 0 }}>
                    <div className="pv-shared-card-name">{list.title}</div>
                    <div className="pv-shared-card-perm">{list.myPermission || 'view'} access</div>
                  </div>
                  <Icon name="ChevronRight" className="w-3.5 h-3.5" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Empty state — only for users who cannot create boards */}
        {!error && visibleLists.length === 0 && !showNewBoard && !canCreate && (
          <div className="pv-empty" style={{ minHeight: 'calc(100vh - 240px)', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
            <div className="pv-empty-title">No provisioning boards yet</div>
            <div className="pv-empty-body">Create your first board to get started.</div>
            {canCreate && (
              <button onClick={() => setShowNewBoard(true)} className="pv-btn pv-btn-primary">
                <Icon name="Plus" className="w-4 h-4" /> New board
              </button>
            )}
          </div>
        )}

        {/* Board workspace — horizontal scroll */}
        {(visibleLists.length > 0 || showNewBoard || canCreate) && (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <div className="pv-lanes">
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
                      itemStatusMap={itemStatusMapByList[list.id] || {}}
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
                      onDuplicate={() => handleDuplicate(list)}
                      onSaveAsTemplate={() => handleSaveAsTemplate(list)}
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
                  userDept={userDept}
                  onCreated={handleCreateBoard}
                  onCancel={() => setShowNewBoard(false)}
                />
              )}
            </div>
          </DndContext>
        )}

        {/* ── Cross-board summary gauges — below kanban boards ─────────────── */}
        {!loading && crossBoardTotals.totalItems > 0 && (
          <div style={{ padding: '0 32px 32px' }}>
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
        items={boardDrawer.listId ? (itemsByList[boardDrawer.listId] || []) : []}
        trips={trips}
        tenantId={activeTenantId}
        departments={departments.map(d => d.name)}
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
        departments={departments.map(d => d.name)}
        theme="light"
        readOnly={itemDrawer.readOnly}
        onSaved={handleItemSaved}
        onDeleted={handleItemDeleted}
        onClose={() => setItemDrawer({ open: false, item: null, listId: null, readOnly: false })}
      />

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
