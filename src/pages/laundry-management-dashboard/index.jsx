import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Icon from '../../components/AppIcon';
import Header from '../../components/navigation/Header';
import AddLaundryModal from './components/AddLaundryModal';
import LaundryItemRow from './components/LaundryItemRow';
import CabinView from './components/CabinView';
import LaundryDetailModal from './components/LaundryDetailModal';
import { LaundryStatus, LaundryPriority, getTodayViewItems, loadAllLaundryItems, updateLaundryStatus, migrateLaundryItems, isNewDay, setLastLaundryDayKey, getTodayKey, manualResetDay } from './utils/laundryStorage';
import { turnaroundStats, fmtDur } from './utils/laundryStats';
import { enrichWithAvatars } from './utils/laundryAvatars';
import { loadGuests } from '../guest-management-dashboard/utils/guestStorage';
import { getCurrentUser } from '../../utils/authStorage';
import { loadTrips } from '../trips-management-dashboard/utils/tripStorage';
import ModalShell from '../../components/ui/ModalShell';
import '../../styles/editorial.css';
import './laundry.css';

// ── Filters dropdown (Status + Owner facets in one menu) ──────────────────
function FiltersMenu({ status, setStatus, owner, setOwner }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const active = status !== 'All' || owner !== 'All';
  const Row = (val, cur, set) => (
    <button key={val} type="button" className={`lm-dd-opt${val === cur ? ' sel' : ''}`} onClick={() => set(val)}>
      <span>{val}</span>{val === cur && <Icon name="Check" size={15} className="lm-ck" />}
    </button>
  );
  return (
    <div className={`lm-dd${open ? ' open' : ''}`} ref={ref}>
      <button type="button" className="lm-dd-btn" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}>
        <Icon name="SlidersHorizontal" size={15} className="lm-dd-ic" />
        <span>Filters</span>
        {active && <span className="lm-dd-marker" aria-hidden="true" />}
        <Icon name="ChevronDown" size={14} className="lm-dd-ch" />
      </button>
      {open && (
        <div className="lm-dd-menu" role="listbox">
          <div className="lm-dd-sec">Status</div>
          {['All', 'In Progress', 'Ready', 'Delivered'].map((v) => Row(v, status, setStatus))}
          <div className="lm-dd-div" />
          <div className="lm-dd-sec">Owner</div>
          {['All', 'Guest', 'Crew', 'Unknown'].map((v) => Row(v, owner, setOwner))}
        </div>
      )}
    </div>
  );
}

const SORTS = [
  { val: 'newest', label: 'Newest first' },
  { val: 'oldest', label: 'Oldest first' },
  { val: 'owner', label: 'Owner A–Z' },
];

function SortMenu({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div className={`lm-dd${open ? ' open' : ''}`} ref={ref}>
      <button type="button" className="lm-dd-btn" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}>
        <Icon name="ArrowUpDown" size={15} className="lm-dd-ic" />
        <span>Sort</span>
        <Icon name="ChevronDown" size={14} className="lm-dd-ch" />
      </button>
      {open && (
        <div className="lm-dd-menu" role="listbox">
          {SORTS.map((o) => (
            <button key={o.val} type="button" className={`lm-dd-opt${o.val === value ? ' sel' : ''}`} onClick={() => { onChange(o.val); setOpen(false); }}>
              <span>{o.label}</span>{o.val === value && <Icon name="Check" size={15} className="lm-ck" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

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
      <path d={`M${line} L116,${H} L4,${H} Z`} fill="#2F7D5A" fillOpacity="0.12" />
      <path className="lmk-line" d={`M${line}`} pathLength="1" fill="none" stroke="#2F7D5A" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const LaundryManagementDashboard = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [currentUser, setCurrentUser] = useState(null);
  const [laundryItems, setLaundryItems] = useState([]);
  const [filteredItems, setFilteredItems] = useState([]);
  const [, setGuests] = useState([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [tripId, setTripId] = useState(null);
  const [ownerFilter, setOwnerFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [urgentOnly, setUrgentOnly] = useState(false);
  const [sortBy, setSortBy] = useState('newest');
  const [trip, setTrip] = useState(null);
  const [showResetModal, setShowResetModal] = useState(false);
  const [allItems, setAllItems] = useState([]);
  const [detailItem, setDetailItem] = useState(null);
  const [editItem, setEditItem] = useState(null);
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
    let filtered = [...laundryItems];
    if (statusFilter !== 'All') {
      const statusMap = {
        'In Progress': LaundryStatus?.IN_PROGRESS,
        Ready: LaundryStatus?.READY_TO_DELIVER,
        Delivered: LaundryStatus?.DELIVERED,
      };
      filtered = filtered?.filter((item) => item?.status === statusMap?.[statusFilter]);
    }
    if (urgentOnly) {
      filtered = filtered?.filter((item) => item?.priority === LaundryPriority?.URGENT && item?.status !== LaundryStatus?.DELIVERED);
    }
    if (ownerFilter !== 'All') {
      filtered = filtered?.filter((item) => item?.ownerType?.toLowerCase() === ownerFilter?.toLowerCase());
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
    filtered = filtered.slice().sort((a, b) => {
      if (sortBy === 'owner') return (a?.ownerName || '').localeCompare(b?.ownerName || '');
      return sortBy === 'oldest' ? ts(a) - ts(b) : ts(b) - ts(a);
    });
    setFilteredItems(filtered);
  }, [laundryItems, statusFilter, ownerFilter, urgentOnly, searchQuery, sortBy, tripId, trip]);

  const loadLaundryItems = async () => {
    const [{ openItems, deliveredToday }, all] = await Promise.all([getTodayViewItems(), loadAllLaundryItems()]);
    const today = await enrichWithAvatars([...openItems, ...deliveredToday]);
    setLaundryItems(today);
    setAllItems(all);
  };

  // Keep the turnaround stats fed alongside the today view.
  useEffect(() => { loadAllLaundryItems().then(setAllItems).catch(() => {}); }, []);

  const handleBulkDeliver = async (readyItems) => {
    await Promise.all((readyItems || []).map((i) => updateLaundryStatus(i.id, LaundryStatus?.DELIVERED)));
    loadLaundryItems();
  };

  const handleAddSuccess = () => { setShowAddModal(false); setEditItem(null); loadLaundryItems(); };
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
  const isFiltered = !!searchQuery || statusFilter !== 'All' || ownerFilter !== 'All' || urgentOnly;

  // KPI cells act as filter shortcuts.
  const kpiToday = () => { setStatusFilter('All'); setUrgentOnly(false); };
  const kpiTurnaround = () => { setUrgentOnly(false); setStatusFilter((s) => (s === 'Delivered' ? 'All' : 'Delivered')); };
  const kpiAttention = () => { setStatusFilter('All'); setUrgentOnly((u) => !u); };
  const turnActive = statusFilter === 'Delivered' && !urgentOnly;
  const active = (counts.inProgress + counts.ready) > 0;
  const totalItems = laundryItems?.length || 0;

  // KPI strip
  const totalToday = counts.inProgress + counts.ready + counts.delivered;
  const urgentList = (laundryItems || []).filter((i) => i?.priority === LaundryPriority?.URGENT && i?.status !== LaundryStatus?.DELIVERED);
  const oldestUrg = urgentList.reduce((a, i) => { const t = new Date(i?.createdAt || 0).getTime(); return !a || t < a.t ? { t, name: i?.ownerName } : a; }, null);
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

            <button type="button" className={`lmk-cell${urgentOnly ? ' active' : ''}`} onClick={kpiAttention} title="Show urgent">
              <span className="lmk-l">Needs attention</span>
              <div className="lmk-row">
                <span className={`lmk-num${urgentList.length ? ' red' : ''}`}>{urgentList.length}</span>
                {urgentList.length > 0 && <span className="lmk-pulse" />}
              </div>
              <span className="lmk-sub">
                {urgentList.length === 0 ? 'all calm' : <>oldest <b style={{ color: '#1C1B3A' }}>{urgAgeStr}</b>{oldestUrg?.name ? ` — ${oldestUrg.name}` : ''}</>}
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
            <FiltersMenu status={statusFilter} setStatus={setStatusFilter} owner={ownerFilter} setOwner={setOwnerFilter} />
            <SortMenu value={sortBy} onChange={setSortBy} />
            <ViewToggle view={viewMode} onChange={changeView} />
          </div>

          {/* Views — List (status-grouped) or By cabin (cards) */}
          {filteredItems?.length === 0 ? (
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
            <CabinView items={filteredItems} onBulkDeliver={handleBulkDeliver} onOpen={setDetailItem} />
          ) : (
            <div className="lm-list">
              {groups.length > 1 ? (
                groups.map((g) => (
                  <div key={g.key} className="lm-group">
                    <div className="lm-group-h">{g.label}<span className="lm-group-n">{g.items.length}</span></div>
                    {g.items.map((item) => (
                      <LaundryItemRow key={item?.id} item={item} onUpdate={loadLaundryItems} onOpen={setDetailItem} />
                    ))}
                  </div>
                ))
              ) : (
                filteredItems?.map((item) => (
                  <LaundryItemRow key={item?.id} item={item} onUpdate={loadLaundryItems} onOpen={setDetailItem} />
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {(showAddModal || editItem) && (
        <AddLaundryModal editItem={editItem} onClose={() => { setShowAddModal(false); setEditItem(null); }} onSuccess={handleAddSuccess} />
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
