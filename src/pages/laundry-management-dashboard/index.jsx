import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Icon from '../../components/AppIcon';
import Header from '../../components/navigation/Header';
import AddLaundryModal from './components/AddLaundryModal';
import LaundryItemRow from './components/LaundryItemRow';
import CabinView from './components/CabinView';
import LaundryDetailModal from './components/LaundryDetailModal';
import LaundryScanModal from './components/LaundryScanModal';
import { FilterMenu, SortMenu } from './components/LaundryFilters';
import { printLaundryLabels } from './utils/laundryLabels';
import { subscribeOffline, pendingOfflineItems, drainOfflineLaundry, isLaundryOffline, enqueueOfflineStatus, pendingStatusMap } from './utils/laundryOfflineQueue';
import { attachBilling } from './utils/laundryBilling';
import { canViewCost } from '../../utils/costPermissions';
import { LaundryStatus, LaundryPriority, getTodayViewItems, loadAllLaundryItems, updateLaundryStatus, migrateLaundryItems, isNewDay, setLastLaundryDayKey, getTodayKey, manualResetDay, getLaundryBilling } from './utils/laundryStorage';
import { turnaroundStats, fmtDur } from './utils/laundryStats';
import { enrichWithAvatars } from './utils/laundryAvatars';
import { loadGuests } from '../guest-management-dashboard/utils/guestStorage';
import { getCurrentUser } from '../../utils/authStorage';
import { loadTrips } from '../trips-management-dashboard/utils/tripStorage';
import ModalShell from '../../components/ui/ModalShell';
import '../../styles/editorial.css';
import './laundry.css';

const SORTS = [
  { val: 'newest', label: 'Newest first' },
  { val: 'oldest', label: 'Oldest first' },
  { val: 'priority', label: 'Priority (needs attention)' },
  { val: 'due', label: 'Needed by (most overdue)' },
  { val: 'owner', label: 'Owner A–Z' },
];

// "Needs attention" = anything open that's urgent, overdue, or flagged.
const isAttentionItem = (i) => i?.status !== LaundryStatus?.DELIVERED && (
  i?.priority === LaundryPriority?.URGENT
  || (i?.neededBy && new Date(i.neededBy).getTime() < Date.now())
  || i?.flag === 'missing' || i?.flag === 'damaged'
);

// List / By cabin toggle
function ViewToggle({ view, onChange }) {
  return (
    <div className="lm-seg" role="tablist" aria-label="View">
      <button type="button" role="tab" aria-selected={view === 'list'} className={view === 'list' ? 'on' : ''} onClick={() => onChange('list')}>
        <Icon name="List" size={15} /> List
      </button>
      <button type="button" role="tab" aria-selected={view === 'cabin'} className={view === 'cabin' ? 'on' : ''} onClick={() => onChange('cabin')}>
        <Icon name="LayoutGrid" size={15} /> By cabin
      </button>
    </div>
  );
}

// Tiny turnaround sparkline (nulls carried forward; higher time sits higher).
function MiniSpark({ values }) {
  const known = values.filter((v) => v != null);
  if (known.length < 2) return null;
  let last = known[0];
  const filled = values.map((v) => { if (v != null) { last = v; return v; } return last; });
  const min = Math.min(...filled); const max = Math.max(...filled);
  const span = max - min || 1;
  const H = 22; const top = 3; const bot = 19; const x = (i) => 4 + (i / (values.length - 1)) * 112;
  const y = (v) => top + (1 - (v - min) / span) * (bot - top);
  const line = filled.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' L');
  return (
    <svg className="lmk-spark" viewBox={`0 0 120 ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={`M${line} L116,${H} L4,${H} Z`} fill="#2F7D5A" fillOpacity="0.10" />
      <path d={`M${line}`} fill="none" stroke="#2F7D5A" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const LaundryManagementDashboard = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [currentUser, setCurrentUser] = useState(null);
  const [laundryItems, setLaundryItems] = useState([]);
  const [filteredItems, setFilteredItems] = useState([]);
  // Charter billing context — declared before the filter effect that reads them
  // (in its deps), so they're initialised when that runs.
  const [allTrips, setAllTrips] = useState([]);
  const [billingCfg, setBillingCfg] = useState(null);
  // Charges are commercial info: only load billing config for cost-authorised
  // users (Command / Chief / HOD). Crew never see charge pills.
  useEffect(() => { loadTrips().then((t) => setAllTrips(t || [])).catch(() => {}); if (canViewCost()) getLaundryBilling().then(setBillingCfg).catch(() => {}); }, []);
  const [, setGuests] = useState([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [tripId, setTripId] = useState(null);
  const [ownerFilter, setOwnerFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [handlingFilter, setHandlingFilter] = useState('All');
  const [sortBy, setSortBy] = useState('newest');
  const [trip, setTrip] = useState(null);
  const [showResetModal, setShowResetModal] = useState(false);
  const [allItems, setAllItems] = useState([]);
  const [detailItem, setDetailItem] = useState(null);
  const [showScan, setShowScan] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [showDeliveredList, setShowDeliveredList] = useState(false);
  const [viewMode, setViewMode] = useState(() => {
    try { return localStorage.getItem('laundryViewMode') === 'cabin' ? 'cabin' : 'list'; } catch { return 'list'; }
  });
  const changeView = (v) => { setViewMode(v); try { localStorage.setItem('laundryViewMode', v); } catch { /* noop */ } };

  useEffect(() => {
    const user = getCurrentUser();
    if (!user) return;
    setCurrentUser(user);
    const searchParams = new URLSearchParams(location?.search);
    const tripIdParam = searchParams?.get('tripId');
    if (tripIdParam) setTripId(tripIdParam);
    migrateLaundryItems();
    if (isNewDay()) setLastLaundryDayKey(getTodayKey());
  }, [navigate, location]);

  useEffect(() => { setGuests(loadGuests() || []); }, []);

  useEffect(() => { loadLaundryItems(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  useEffect(() => {
    if (!tripId) { setTrip(null); return undefined; }
    let cancelled = false;
    (async () => {
      try {
        const trips = await loadTrips();
        if (cancelled) return;
        setTrip(trips?.find((t) => t?.id === tripId) ?? null);
      } catch (err) {
        console.warn('[laundry-dashboard] loadTrips failed:', err);
        if (!cancelled) setTrip(null);
      }
    })();
    return () => { cancelled = true; };
  }, [tripId]);

  useEffect(() => {
    let filtered = attachBilling(laundryItems, allTrips, billingCfg);
    if (statusFilter !== 'All') {
      const statusMap = {
        'In Progress': LaundryStatus?.IN_PROGRESS,
        Ready: LaundryStatus?.READY_TO_DELIVER,
        Delivered: LaundryStatus?.DELIVERED,
      };
      filtered = filtered?.filter((item) => item?.status === statusMap?.[statusFilter]);
    }
    if (attentionOnly) {
      filtered = filtered?.filter(isAttentionItem);
    }
    if (ownerFilter !== 'All') {
      filtered = filtered?.filter((item) => item?.ownerType?.toLowerCase() === ownerFilter?.toLowerCase());
    }
    if (handlingFilter !== 'All') {
      filtered = filtered?.filter((item) => (handlingFilter === 'shore' ? item?.serviceLocation === 'shore' : item?.serviceLocation !== 'shore'));
    }
    if (searchQuery?.trim()) {
      const query = searchQuery?.toLowerCase();
      filtered = filtered?.filter((item) =>
        item?.ownerName?.toLowerCase()?.includes(query)
        || item?.description?.toLowerCase()?.includes(query)
        || item?.area?.toLowerCase()?.includes(query)
        || item?.id?.toLowerCase()?.includes(query)
        || (item?.tags || []).some((t) => t?.toLowerCase()?.includes(query)));
    }
    if (tripId && trip) {
      const activeGuestIds = trip?.guests?.filter((g) => g?.isActive)?.map((g) => g?.guestId) || [];
      filtered = filtered?.filter((item) => {
        if (item?.tripId) return item?.tripId === tripId;
        if (item?.ownerType?.toLowerCase() === 'guest' && item?.ownerGuestId) return activeGuestIds?.includes(item?.ownerGuestId);
        return false;
      });
    }
    // sort
    const ts = (x) => new Date(x?.createdAt || 0).getTime();
    const due = (x) => (x?.neededBy ? new Date(x.neededBy).getTime() : Infinity); // no deadline → sinks last
    // Priority rank: urgent → other attention (overdue/missing/damaged) → normal open → delivered.
    const prank = (x) => {
      if (x?.status === LaundryStatus?.DELIVERED) return 3;
      if (x?.priority === LaundryPriority?.URGENT) return 0;
      if (isAttentionItem(x)) return 1;
      return 2;
    };
    filtered = filtered.slice().sort((a, b) => {
      if (sortBy === 'owner') return (a?.ownerName || '').localeCompare(b?.ownerName || '');
      if (sortBy === 'priority') return (prank(a) - prank(b)) || (due(a) - due(b)) || (ts(b) - ts(a));
      if (sortBy === 'due') return (due(a) - due(b)) || (ts(b) - ts(a));
      return sortBy === 'oldest' ? ts(a) - ts(b) : ts(b) - ts(a);
    });
    setFilteredItems(filtered);
  }, [laundryItems, allTrips, billingCfg, statusFilter, ownerFilter, attentionOnly, handlingFilter, searchQuery, sortBy, tripId, trip]);

  const loadLaundryItems = async () => {
    const [{ openItems, deliveredToday }, all] = await Promise.all([getTodayViewItems(), loadAllLaundryItems()]);
    const today = await enrichWithAvatars([...openItems, ...deliveredToday]);
    // Keep any offline status change visible until it syncs.
    const over = pendingStatusMap();
    const apply = (arr) => (Object.keys(over).length ? arr.map((i) => (over[i.id] ? { ...i, status: over[i.id] } : i)) : arr);
    setLaundryItems(apply(today));
    setAllItems(apply(all));
  };

  // Resolve a scanned/deep-linked label to its item and open it. Looks in the
  // loaded set first, then falls back to a fresh fetch (the item may be from an
  // earlier day or already delivered, so not in the today view).
  const openScannedItem = async (id) => {
    if (!id) return;
    const local = [...laundryItems, ...allItems].find((i) => i && i.id === id);
    if (local) { setDetailItem(local); return; }
    try {
      const all = await loadAllLaundryItems();
      const found = (all || []).find((i) => i && i.id === id);
      if (found) setDetailItem(found);
      else window.alert('That label doesn’t match a laundry item on this vessel.');
    } catch { window.alert('Couldn’t open that label — try again.'); }
  };

  // Deep link from a phone-camera scan: /laundry-management-dashboard?scan=<id>.
  // Open the item once, then strip the param so it doesn't re-fire on refresh.
  const scanHandledRef = React.useRef(false);
  useEffect(() => {
    if (scanHandledRef.current) return;
    const params = new URLSearchParams(location.search);
    const id = params.get('scan');
    if (!id) return;
    scanHandledRef.current = true;
    openScannedItem(id);
    navigate('/laundry-management-dashboard', { replace: true });
  }, [location.search]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reflect a status change locally straight away (offline path — the server
  // write is queued, so we can't reload from it).
  const applyLocalStatus = (id, status) => {
    const patch = (arr) => arr.map((i) => (i.id === id
      ? { ...i, status, ...(status === LaundryStatus?.DELIVERED ? { deliveredAt: new Date().toISOString() } : {}) }
      : i));
    setLaundryItems((prev) => patch(prev));
    setAllItems((prev) => patch(prev));
  };

  // Keep the turnaround stats fed alongside the today view.
  useEffect(() => { loadAllLaundryItems().then(setAllItems).catch(() => {}); }, []);

  // Offline capture — show anything queued while offline, and replay it (then
  // refresh) the moment connectivity returns or the page loads with a backlog.
  const [pendingOffline, setPendingOffline] = useState(pendingOfflineItems());
  useEffect(() => {
    const unsub = subscribeOffline(() => {
      setPendingOffline(pendingOfflineItems());
      // Re-apply any offline status changes (e.g. queued from the detail modal).
      const over = pendingStatusMap();
      if (Object.keys(over).length) {
        const patch = (arr) => arr.map((i) => (over[i.id] ? { ...i, status: over[i.id] } : i));
        setLaundryItems((prev) => patch(prev));
        setAllItems((prev) => patch(prev));
      }
    });
    const sync = () => drainOfflineLaundry().then((r) => { if (r.synced) loadLaundryItems(); });
    window.addEventListener('online', sync);
    sync();
    return () => { unsub(); window.removeEventListener('online', sync); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const queueStatusOffline = async (items, status) => {
    for (const i of items) { await enqueueOfflineStatus(i.id, status); applyLocalStatus(i.id, status); }
  };
  const handleBulkDeliver = async (readyItems) => {
    const items = readyItems || [];
    if (isLaundryOffline()) { await queueStatusOffline(items, LaundryStatus?.DELIVERED); return; }
    try {
      await Promise.all(items.map((i) => updateLaundryStatus(i.id, LaundryStatus?.DELIVERED)));
      loadLaundryItems();
    } catch (e) {
      if (e?.code === 'OFFLINE') await queueStatusOffline(items, LaundryStatus?.DELIVERED);
      else console.error('[laundry] bulk deliver failed', e);
    }
  };

  const handleAddSuccess = () => { setShowAddModal(false); setEditItem(null); loadLaundryItems(); };
  const handleAdvance = async (item, status) => {
    if (isLaundryOffline()) { await enqueueOfflineStatus(item.id, status); applyLocalStatus(item.id, status); return; }
    try { await updateLaundryStatus(item.id, status); loadLaundryItems(); }
    catch (e) {
      if (e?.code === 'OFFLINE') { await enqueueOfflineStatus(item.id, status); applyLocalStatus(item.id, status); }
      else console.error('[laundry] advance failed', e);
    }
  };
  const openEdit = (it) => { setDetailItem(null); setEditItem(it); };
  const confirmResetDay = async () => { if (await manualResetDay()) await loadLaundryItems(); setShowResetModal(false); };

  const getStatusCounts = () => {
    let itemsToCount = laundryItems;
    if (tripId && trip) {
      const activeGuestIds = trip?.guests?.filter((g) => g?.isActive)?.map((g) => g?.guestId) || [];
      itemsToCount = laundryItems?.filter((item) => {
        if (item?.tripId) return item?.tripId === tripId;
        if (item?.ownerType?.toLowerCase() === 'guest' && item?.ownerGuestId) return activeGuestIds?.includes(item?.ownerGuestId);
        return false;
      });
    }
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    return {
      inProgress: itemsToCount?.filter((item) => item?.status === LaundryStatus?.IN_PROGRESS)?.length || 0,
      ready: itemsToCount?.filter((item) => item?.status === LaundryStatus?.READY_TO_DELIVER)?.length || 0,
      delivered: itemsToCount?.filter((item) => {
        if (item?.status !== LaundryStatus?.DELIVERED || !item?.deliveredAt) return false;
        const d = new Date(item.deliveredAt);
        return d >= todayStart && d <= todayEnd;
      })?.length || 0,
    };
  };

  const counts = getStatusCounts();
  const canReset = ['COMMAND', 'CHIEF'].includes(currentUser?.effectiveTier) || ['COMMAND', 'CHIEF'].includes(currentUser?.tier);
  const isFiltered = !!searchQuery || statusFilter !== 'All' || ownerFilter !== 'All' || handlingFilter !== 'All' || attentionOnly;

  // KPI cells act as filter shortcuts.
  const kpiToday = () => { setStatusFilter('All'); setAttentionOnly(false); };
  const kpiTurnaround = () => { setAttentionOnly(false); setStatusFilter((s) => (s === 'Delivered' ? 'All' : 'Delivered')); };
  const kpiAttention = () => { setStatusFilter('All'); setAttentionOnly((u) => !u); };
  const turnActive = statusFilter === 'Delivered' && !attentionOnly;
  const active = (counts.inProgress + counts.ready) > 0;
  const totalItems = laundryItems?.length || 0;

  // KPI strip
  const totalToday = counts.inProgress + counts.ready + counts.delivered;
  const attentionList = (laundryItems || []).filter(isAttentionItem);
  const oldestUrg = attentionList.reduce((a, i) => { const t = new Date(i?.createdAt || 0).getTime(); return !a || t < a.t ? { t, name: i?.ownerName } : a; }, null);
  const urgAge = oldestUrg ? Math.max(0, Math.floor((Date.now() - oldestUrg.t) / 60000)) : 0;
  const urgAgeStr = urgAge < 60 ? `${urgAge}m` : `${Math.floor(urgAge / 60)}h ${urgAge % 60}m`;
  const ta = turnaroundStats(allItems);

  // Status groups (workflow order) for the list, populated from the filtered set.
  const groups = [
    { key: LaundryStatus?.IN_PROGRESS, label: 'In progress' },
    { key: LaundryStatus?.READY_TO_DELIVER, label: 'Ready to deliver' },
    { key: LaundryStatus?.DELIVERED, label: 'Delivered' },
  ].map((g) => ({ ...g, items: filteredItems.filter((i) => i?.status === g.key) })).filter((g) => g.items.length);

  return (
    <>
      <Header />
      <div className="lm-page">
        <div className="lm-wrap">
          {/* Header — canonical Cargo editorial (meta strip + big serif headline) */}
          <div className="lm-header">
            <button type="button" className="lm-back" onClick={() => navigate('/dashboard')}>
              <Icon name="ArrowLeft" size={16} /> Back to dashboard
            </button>
            <p className="editorial-meta">
              <span className="dot">●</span>
              <span>Housekeeping</span>
              <span className="bar" />
              <span className="muted">Today</span>
              <span className="bar" />
              <span className="muted">{totalItems} in the wash</span>
            </p>
            <div className="lm-titlerow">
              <h1 className="editorial-greeting">
                LAUNDRY<span className="period">,</span> <em>{active ? 'in motion' : 'all clear'}</em><span className="period">.</span>
              </h1>
              <div className="lm-actions">
                {canReset && (
                  <button type="button" className="lm-btn ghost" onClick={() => setShowResetModal(true)}>
                    <Icon name="RotateCcw" size={16} /> Reset day
                  </button>
                )}
                <button type="button" className="lm-btn ghost" onClick={() => setShowScan(true)}>
                  <Icon name="QrCode" size={16} /> Scan
                </button>
                {filteredItems.length > 0 && (
                  <button type="button" className="lm-btn ghost" onClick={() => printLaundryLabels(filteredItems)} title="Print QR labels for the items shown">
                    <Icon name="Printer" size={16} /> Labels
                  </button>
                )}
                <button type="button" className="lm-btn ghost" onClick={() => navigate('/laundry-calendar-history-view')}>
                  <Icon name="Calendar" size={16} /> History
                </button>
                <button type="button" className="lm-btn primary" onClick={() => setShowAddModal(true)}>
                  <Icon name="Plus" size={16} /> Add laundry
                </button>
              </div>
            </div>
          </div>

          {/* KPI strip — Today lifecycle bar · turnaround · attention */}
          <div className="lmk">
            <button type="button" className="lmk-cell" onClick={kpiToday} title="Show everything today">
              <span className="lmk-l">Today</span>
              <span className="lmk-num">{totalToday}</span>
              <div className="lmk-bar">
                {counts.inProgress > 0 && <i style={{ flex: counts.inProgress, background: '#B7791F' }} />}
                {counts.ready > 0 && <i style={{ flex: counts.ready, background: '#2F6E8F' }} />}
                {counts.delivered > 0 && <i style={{ flex: counts.delivered, background: '#2F7D5A' }} />}
                {totalToday === 0 && <i style={{ flex: 1, background: '#E7E9EF' }} />}
              </div>
              <span className="lmk-sub">{counts.inProgress} washing · {counts.ready} ready · {counts.delivered} delivered</span>
            </button>

            <button type="button" className={`lmk-cell${turnActive ? ' active' : ''}`} onClick={kpiTurnaround} title="Show delivered">
              <span className="lmk-l">Avg turnaround</span>
              <div className="lmk-row">
                <span className="lmk-num sm">{fmtDur(ta.avg)}</span>
                {ta.delta != null && ta.delta !== 0 && (
                  <span className="lmk-trend" style={ta.delta > 0 ? { color: '#C24632', background: '#FBECE8' } : undefined}>
                    <Icon name={ta.delta > 0 ? 'ArrowUp' : 'ArrowDown'} size={10} />{Math.abs(ta.delta)}m
                  </span>
                )}
              </div>
              {ta.hasAny ? <MiniSpark values={ta.spark} /> : <span className="lmk-sub">No deliveries yet</span>}
            </button>

            <button type="button" className={`lmk-cell${attentionOnly ? ' active' : ''}`} onClick={kpiAttention} title="Urgent, overdue or flagged">
              <span className="lmk-l">Needs attention</span>
              <div className="lmk-row">
                <span className={`lmk-num${attentionList.length ? ' red' : ''}`}>{attentionList.length}</span>
                {attentionList.length > 0 && <span className="lmk-pulse" />}
              </div>
              <span className="lmk-sub">
                {attentionList.length === 0 ? 'all calm' : <>oldest <b style={{ color: '#1C1B3A' }}>{urgAgeStr}</b>{oldestUrg?.name ? ` — ${oldestUrg.name}` : ''}</>}
              </span>
            </button>
          </div>

          {tripId && (
            <div className="lm-trip" style={{ marginLeft: 0, marginBottom: 16, alignSelf: 'flex-start' }}>
              Trip filter
              <button type="button" onClick={() => navigate('/laundry-management-dashboard')} aria-label="Clear trip filter">
                <Icon name="X" size={13} />
              </button>
            </div>
          )}

          {/* Toolbar */}
          <div className="lm-tools">
            <label className="lm-search">
              <Icon name="Search" size={16} className="lm-search-ic" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e?.target?.value)}
                placeholder="Search by description, owner, area or tag…"
                aria-label="Search laundry"
              />
            </label>
            <FilterMenu groups={[
              { key: 'status', label: 'Status', value: statusFilter, onChange: setStatusFilter, neutral: 'All', options: [
                { value: 'All', label: 'All statuses' }, { value: 'In Progress', label: 'In progress' }, { value: 'Ready', label: 'Ready' }, { value: 'Delivered', label: 'Delivered' }] },
              { key: 'owner', label: 'Owner', value: ownerFilter, onChange: setOwnerFilter, neutral: 'All', options: [
                { value: 'All', label: 'Everyone' }, { value: 'Guest', label: 'Guests' }, { value: 'Crew', label: 'Crew' }, { value: 'Unknown', label: 'Unknown' }] },
              { key: 'handling', label: 'Handling', value: handlingFilter, onChange: setHandlingFilter, neutral: 'All', options: [
                { value: 'All', label: 'Anywhere' }, { value: 'onboard', label: 'Onboard' }, { value: 'shore', label: 'Ashore' }] },
            ]} />
            <SortMenu value={sortBy} onChange={setSortBy} options={SORTS} />
            <ViewToggle view={viewMode} onChange={changeView} />
          </div>

          {/* Offline capture — queued adds waiting to sync */}
          {pendingOffline.length > 0 && (
            <div className="lm-offline">
              <div className="lm-offline-h">
                <Icon name="CloudOff" size={15} />
                <span>{pendingOffline.length} logged offline · waiting to sync</span>
              </div>
              <div className="lm-offline-list">
                {pendingOffline.map((it) => (
                  <div className="lm-offline-row" key={it.id}>
                    <span className="lm-offline-thumb">{it.photo ? <img src={it.photo} alt="" loading="lazy" decoding="async" /> : <Icon name="Shirt" size={16} />}</span>
                    <span className="lm-offline-desc">{it.description || 'Laundry item'}</span>
                    <span className="lm-offline-who">{it.ownerName || (it.ownerType === 'other' ? 'Other' : 'Unassigned')}{it.area ? ` · ${it.area}` : ''}</span>
                    <span className="lm-offline-tag">Pending</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Views — List (status-grouped) or By cabin (cards) */}
          {filteredItems?.length === 0 && pendingOffline.length === 0 ? (
            <div className="lm-list">
              <div className="lm-empty" role="status">
                <Icon name="Package" size={44} className="lm-empty-ic" />
                <div className="lm-empty-title">{isFiltered ? 'No matches' : 'Nothing in the wash'}</div>
                <div className="lm-empty-sub">
                  {isFiltered ? 'Try a different filter or clear your search.' : 'Everything the crew adds shows here, from pickup to delivery.'}
                </div>
                {!isFiltered && (
                  <button type="button" className="lm-btn primary lm-empty-cta" onClick={() => setShowAddModal(true)}>
                    <Icon name="Plus" size={16} /> Add first item
                  </button>
                )}
              </div>
            </div>
          ) : viewMode === 'cabin' ? (
            <CabinView items={filteredItems} onBulkDeliver={handleBulkDeliver} onOpen={setDetailItem} onAdvance={handleAdvance} />
          ) : (
            <div className="lm-list">
              {groups.map((g) => {
                const isDelivered = g.key === LaundryStatus?.DELIVERED;
                const collapsed = isDelivered && !showDeliveredList;
                return (
                  <div key={g.key} className="lm-group">
                    {isDelivered ? (
                      <button type="button" className="lm-group-h as-btn" onClick={() => setShowDeliveredList((s) => !s)} aria-expanded={showDeliveredList}>
                        <Icon name="ChevronRight" size={13} className={`lm-group-chev${showDeliveredList ? ' open' : ''}`} />
                        <span className="lm-group-t">{g.label}</span>
                        <span className="lm-group-n">{g.items.length}</span>
                      </button>
                    ) : (
                      <div className="lm-group-h">
                        <span className="lm-group-t">{g.label}</span>
                        <span className="lm-group-n">{g.items.length}</span>
                        {g.key === LaundryStatus?.READY_TO_DELIVER && g.items.length > 0 && (
                          <button type="button" className="lm-group-deliver" onClick={() => handleBulkDeliver(g.items)}>
                            Deliver all <Icon name="ArrowRight" size={14} />
                          </button>
                        )}
                      </div>
                    )}
                    {!collapsed && g.items.map((item) => (
                      <LaundryItemRow key={item?.id} item={item} onAdvance={handleAdvance} onUpdate={loadLaundryItems} onOpen={setDetailItem} />
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {(showAddModal || editItem) && (
        <AddLaundryModal editItem={editItem} onClose={() => { setShowAddModal(false); setEditItem(null); }} onSuccess={handleAddSuccess} onSaved={() => loadLaundryItems()} />
      )}

      {showScan && (
        <LaundryScanModal
          onClose={() => setShowScan(false)}
          onDetect={(id) => { setShowScan(false); openScannedItem(id); }}
        />
      )}

      {detailItem && (
        <LaundryDetailModal item={detailItem} onClose={() => setDetailItem(null)} onUpdated={loadLaundryItems} onEdit={openEdit} />
      )}

      {showResetModal && (
        <ModalShell onClose={() => setShowResetModal(false)} panelClassName="alm-panel" panelStyle={{ maxWidth: 440 }}>
          <div className="alm-head">
            <div>
              <div className="alm-eyebrow">Operational view</div>
              <h2 className="alm-title">Reset day?</h2>
            </div>
            <button className="alm-x" onClick={() => setShowResetModal(false)} aria-label="Close"><Icon name="X" size={18} /></button>
          </div>
          <div className="alm-body">
            <p className="alm-q" style={{ marginBottom: 0 }}>
              This clears “Delivered today” from the operational view. Open items remain.
            </p>
          </div>
          <div className="alm-foot" style={{ justifyContent: 'flex-end', gap: 10 }}>
            <button className="alm-btn outline" onClick={() => setShowResetModal(false)}>Cancel</button>
            <button className="alm-btn primary" onClick={confirmResetDay}>Reset</button>
          </div>
        </ModalShell>
      )}
    </>
  );
};

export default LaundryManagementDashboard;
