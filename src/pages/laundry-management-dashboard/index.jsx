import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Icon from '../../components/AppIcon';
import Header from '../../components/navigation/Header';
import AddLaundryModal from './components/AddLaundryModal';
import LaundryItemRow from './components/LaundryItemRow';
import { LaundryStatus, getTodayViewItems, migrateLaundryItems, isNewDay, setLastLaundryDayKey, getTodayKey, manualResetDay } from './utils/laundryStorage';
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
  const [sortBy, setSortBy] = useState('newest');
  const [trip, setTrip] = useState(null);
  const [showResetModal, setShowResetModal] = useState(false);

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

  useEffect(() => {
    const { openItems, deliveredToday } = getTodayViewItems();
    setLaundryItems([...openItems, ...deliveredToday]);
  }, []);

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
  }, [laundryItems, statusFilter, ownerFilter, searchQuery, sortBy, tripId, trip]);

  const loadLaundryItems = () => {
    const { openItems, deliveredToday } = getTodayViewItems();
    setLaundryItems([...openItems, ...deliveredToday]);
  };

  const handleAddSuccess = () => { setShowAddModal(false); loadLaundryItems(); };
  const confirmResetDay = () => { if (manualResetDay()) loadLaundryItems(); setShowResetModal(false); };

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
  const isFiltered = !!searchQuery || statusFilter !== 'All' || ownerFilter !== 'All';
  const active = (counts.inProgress + counts.ready) > 0;
  const totalItems = laundryItems?.length || 0;

  return (
    <>
      <Header />
      <div className="lm-page">
        <div className="lm-wrap">
          {/* Header — canonical Cargo editorial (meta strip + big serif headline) */}
          <div className="lm-header">
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

          {/* Meta bar — figures on a hairline, no box */}
          <div className="lm-meta">
            <div className={`lm-s${counts.inProgress > 0 ? ' attn' : ''}`}><b>{counts.inProgress}</b><span>In progress</span></div>
            <div className="lm-vr" />
            <div className="lm-s"><b>{counts.ready}</b><span>Ready to deliver</span></div>
            <div className="lm-vr" />
            <div className="lm-s"><b>{counts.delivered}</b><span>Delivered today</span></div>
            {tripId && (
              <div className="lm-trip">
                Trip filter
                <button type="button" onClick={() => navigate('/laundry-management-dashboard')} aria-label="Clear trip filter">
                  <Icon name="X" size={13} />
                </button>
              </div>
            )}
          </div>

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
          </div>

          {/* List */}
          <div className="lm-list">
            {filteredItems?.length === 0 ? (
              <div className="lm-empty" role="status">
                <Icon name="Package" size={44} className="lm-empty-ic" />
                <div className="lm-empty-title">{isFiltered ? 'No matches' : 'Nothing in the wash'}</div>
                <div className="lm-empty-sub">
                  {isFiltered ? 'Try a different filter or clear your search.' : 'Add your first laundry item to get started.'}
                </div>
              </div>
            ) : (
              filteredItems?.map((item) => (
                <LaundryItemRow key={item?.id} item={item} onUpdate={loadLaundryItems} />
              ))
            )}
          </div>
        </div>
      </div>

      {showAddModal && (
        <AddLaundryModal onClose={() => setShowAddModal(false)} onSuccess={handleAddSuccess} />
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
