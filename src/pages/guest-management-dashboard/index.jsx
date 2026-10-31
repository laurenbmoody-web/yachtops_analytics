// Guest Management — the roster of people aboard.
//
// PEOPLE, NOT ROWS
// The list shows one line per PERSON, not per guests row. Those are different
// things today: guest_type ('Owner' / 'Charter') is stored on the person, while
// owner-vs-charter is really a property of the trip, so on a vessel with no
// trips people were cloned to carry the distinction — Rafael Edry exists twice
// on Horizon with two spellings of the same cabin. The grouping lives in
// src/services/guestRoster.js and is presentational only: it says "2 records"
// on the row rather than quietly hiding that the data is wrong. Merging them
// for real is a migration, not a render.
//
// WHAT HAPPENED TO THE STATUS COLUMN
// It rendered the literal string "Guest" on every row — a sortable header that
// sorted nothing and a pill that said the same thing about everybody. The meta
// strip now carries real counts instead, and anything the page cannot stand
// behind is not shown.
//
// PERMISSIONS
// The DEV_MODE flag that used to sit at the top of this file forced canEdit,
// canDelete, canExpand and canSeeAll all to true in production, so any crew
// member could edit and delete guest records. It is gone; the tier checks are
// real. Note that RLS on `guests` is still plain tenant membership, so the API
// remains open even though this page no longer is — that is its own fix.
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Header from '../../components/navigation/Header';
import Icon from '../../components/AppIcon';
import AddGuestModal from './components/AddGuestModal';
import GuestDetailPanel from './components/GuestDetailPanel';
// Deleting and reinstating are GuestDetailPanel's own business — it calls
// guestStorage directly — so they are deliberately not imported here.
import { loadGuests, createGuest, updateGuest, linkKid } from './utils/guestStorage';
import EditorialSelect from '../../components/editorial/EditorialSelect';
import {
  groupGuestsByPerson, searchPeople, sortPeople, filterPeople, rosterStats, initialsOf,
  SORT_OPTIONS, DIETARY_OPTIONS, ABOARD_OPTIONS, roleOptions, parseSort, toSortValue,
} from '../../services/guestRoster';
import { showToast } from '../../utils/toast';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../contexts/TenantContext';
import '../../styles/editorial.css';
import './guest-management.css';

const GuestManagementDashboard = () => {
  const { session, loading: authLoading } = useAuth();
  const { activeTenantId, currentTenantMember } = useTenant();

  const [guests, setGuests] = useState([]);
  // Keyed by PERSON, not by record id: the selection has to survive a refetch,
  // and a person can be backed by more than one guests row.
  const [selectedKey, setSelectedKey] = useState(null);
  const [query, setQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingGuest, setEditingGuest] = useState(null);
  const [sort, setSort] = useState({ column: 'name', direction: 'asc' });
  const [filters, setFilters] = useState({ role: 'all', dietary: 'all', aboard: 'all' });
  const [showDeleted, setShowDeleted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const tier = String(currentTenantMember?.permission_tier || '').toUpperCase().trim();
  const isCommand = tier === 'COMMAND';
  const isCommandOrChief = isCommand || tier === 'CHIEF';

  // Writing a guest record is Command and Chief. Deleting is Command alone.
  const canEdit = isCommandOrChief;
  const canDelete = isCommand;
  // The detail pane is open to everyone who can see the roster. What differs by
  // tier is WHAT it holds: the Confidential tab (passport, visa, APA, NDA) is
  // not offered below Chief, and guest_confidential would refuse those rows
  // anyway, so there is nothing to gate twice.

  const fetchGuests = useCallback(async () => {
    if (!activeTenantId) {
      setError('No vessel selected.');
      setGuests([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await loadGuests(activeTenantId);
      setGuests(data || []);
    } catch (err) {
      setError(err?.message || 'Could not load the guest list.');
      setGuests([]);
    } finally {
      setLoading(false);
    }
  }, [activeTenantId]);

  useEffect(() => {
    if (authLoading) return;
    fetchGuests();
  }, [authLoading, fetchGuests]);

  // Grouped once, so the role dropdown can offer the roles this vessel actually
  // uses rather than a hardcoded list.
  const grouped = useMemo(() => {
    const visible = showDeleted ? guests : guests.filter((g) => !g?.isDeleted);
    return groupGuestsByPerson(visible);
  }, [guests, showDeleted]);

  const people = useMemo(
    () => sortPeople(filterPeople(searchPeople(grouped, query), filters), sort.column, sort.direction),
    [grouped, query, filters, sort],
  );

  const roles = useMemo(() => roleOptions(grouped), [grouped]);
  const stats = useMemo(() => rosterStats(groupGuestsByPerson(guests)), [guests]);

  const selected = people.find((p) => p.key === selectedKey) || null;

  // Open the first guest so the pane is never pointlessly blank, and re-open
  // the top one when a filter or search drops the current selection out of the
  // list. Without the second half the pane would sit empty next to a list full
  // of guests, which looks broken.
  useEffect(() => {
    if (!people.length) {
      if (selectedKey) setSelectedKey(null);
      return;
    }
    if (!people.some((p) => p.key === selectedKey)) setSelectedKey(people[0].key);
  }, [people, selectedKey]);



  const handleAdd = async (guestData) => {
    const { _linkedKidIds, ...clean } = guestData;
    const created = await createGuest(clean, activeTenantId);
    if (!created) { showToast('Could not add that guest', 'error'); return; }
    if (Array.isArray(_linkedKidIds) && _linkedKidIds.length) {
      await Promise.all(_linkedKidIds.map((kidId) => linkKid(created.id, kidId, activeTenantId)));
    }
    showToast('Guest added', 'success');
    fetchGuests();
  };

  const handleUpdate = async (guestId, updates) => {
    const updated = await updateGuest(guestId, updates, activeTenantId);
    showToast(updated ? 'Guest updated' : 'Could not save that', updated ? 'success' : 'error');
    if (updated) fetchGuests();
  };

  const afterPanelAction = () => { fetchGuests(); };

  if (authLoading || loading) {
    return (
      <>
        <Header />
        <div className="gm-page">
          <div className="gm-loading">
            <Icon name="Loader" size={16} /> Fetching the guest list…
          </div>
        </div>
      </>
    );
  }

  if (!session) return null;

  const hasAnyGuests = guests.length > 0;

  return (
    <>
      <Header />
      <div className="gm-page is-split">
      <div className="gm-wrap">
        <div className="gm-titlerow">
          <div>
            <p className="editorial-meta">
              <span className="dot">●</span>
              <span>GUESTS</span>
              <span className="bar" />
              <span className="muted">{stats.people} ON THE BOOKS</span>
              {stats.withAllergies > 0 && (
                <>
                  <span className="bar" />
                  <span className="muted">{stats.withAllergies} WITH ALLERGIES</span>
                </>
              )}
              {stats.duplicates > 0 && (
                <>
                  <span className="bar" />
                  <span className="muted">{stats.duplicates} DUPLICATED</span>
                </>
              )}
            </p>
            <h1 className="editorial-greeting">
              GUESTS<span className="period">,</span> <em>looked after</em><span className="period">.</span>
            </h1>
          </div>

          <div className="gm-actions">
            {canEdit && (
              <button
                type="button"
                className="gm-btn primary"
                onClick={() => { setEditingGuest(null); setShowAddModal(true); }}
              >
                <Icon name="UserPlus" size={15} /> Add guest
              </button>
            )}
          </div>
        </div>

        {error && (
          <p className="gm-error">
            <Icon name="AlertCircle" size={15} />
            <span>{error}</span>
          </p>
        )}

        {/* Named controls, not a row of filter pills — a chip row cannot say
            "sorted by cabin, descending", and goes to pieces once there is more
            than one axis to filter on. */}
        <div className="gm-filters">
          <div className="gm-search">
            <Icon name="Search" size={16} />
            <input
              type="text"
              value={query}
              placeholder="Search a name, cabin, allergy or contact…"
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <label className="gm-field">
            <span>Sort by</span>
            <EditorialSelect
              ariaLabel="Sort guests"
              value={toSortValue(sort)}
              options={SORT_OPTIONS}
              onChange={(v) => setSort(parseSort(v))}
            />
          </label>

          <label className="gm-field">
            <span>Role</span>
            <EditorialSelect
              ariaLabel="Filter by role"
              value={filters.role}
              options={roles}
              onChange={(v) => setFilters((f) => ({ ...f, role: v }))}
            />
          </label>

          <label className="gm-field">
            <span>Dietary</span>
            <EditorialSelect
              ariaLabel="Filter by dietary requirement"
              value={filters.dietary}
              options={DIETARY_OPTIONS}
              onChange={(v) => setFilters((f) => ({ ...f, dietary: v }))}
            />
          </label>

          <label className="gm-field">
            <span>Aboard</span>
            <EditorialSelect
              ariaLabel="Filter by who is aboard"
              value={filters.aboard}
              options={ABOARD_OPTIONS}
              onChange={(v) => setFilters((f) => ({ ...f, aboard: v }))}
            />
          </label>


          {canDelete && (
            <label className="gm-toggle">
              <input
                type="checkbox"
                checked={showDeleted}
                onChange={(e) => setShowDeleted(e.target.checked)}
              />
              Show deleted
            </label>
          )}
        </div>

        <div className="gm-split">

          {/* the roster */}
          <div className="gm-list">
            <p className="gm-list-count">
              {people.length === grouped.length
                ? `${people.length} guest${people.length === 1 ? '' : 's'}`
                : `${people.length} of ${grouped.length}`}
            </p>

            {people.length === 0 ? (
              <div className="gm-empty">
                {!hasAnyGuests ? (
                  <>
                    <b>No guests yet</b>
                    {canEdit ? 'Add the first one and their preferences will follow.'
                      : 'Nobody has been added to this vessel yet.'}
                  </>
                ) : (
                  <>
                    <b>Nothing matches that</b>
                    Try a name, a cabin, or an allergy.
                  </>
                )}
              </div>
            ) : people.map((person) => (
              <button
                key={person.key}
                type="button"
                className={person.key === selectedKey ? 'gm-pick is-on' : 'gm-pick'}
                data-deleted={person.isDeleted ? 'y' : undefined}
                aria-current={person.key === selectedKey}
                onClick={() => setSelectedKey(person.key)}
              >
                {person.photo
                  ? <img className="gm-pick-av" src={person.photo} alt="" />
                  : <span className="gm-pick-av">{initialsOf(person.name)}</span>}
                <span className="gm-pick-txt">
                  <span className="gm-pick-name">{person.name}</span>
                  <span className="gm-pick-sub">
                    {[person.types.join(' / '), person.cabins[0]].filter(Boolean).join(' · ') || 'No cabin'}
                  </span>
                </span>
                {/* An allergy is the one thing worth flagging before you open
                    anyone — the galley should not have to click to find it. */}
                {person.allergies && (
                  <Icon name="AlertTriangle" size={14} className="gm-pick-flag" />
                )}
              </button>
            ))}
          </div>

          {/* the open guest */}
          <div className="gm-pane">
            {selected ? (
              <>
                {selected.hasDuplicates && (
                  <p className="gm-dupe">
                    <Icon name="AlertTriangle" size={14} />
                    <span>
                      <b>{selected.name} has {selected.recordCount} separate guest records</b> —
                      usually because owner and charter trips were recorded as different
                      people. Preferences and documents attach to one record at a time, so
                      some may be filed under the other. You are looking at one of them.
                    </span>
                  </p>
                )}
                <div className="gm-detail">
                  <GuestDetailPanel
                    key={selected.primaryId}
                    guest={selected.records.find((r) => r.id === selected.primaryId) || selected.records[0]}
                    onEdit={afterPanelAction}
                    onDelete={afterPanelAction}
                    onReinstate={afterPanelAction}
                    onClose={() => setSelectedKey(null)}
                    permissions={{ canEdit, canDelete }}
                  />
                </div>
              </>
            ) : (
              <div className="gm-pane-empty">
                <Icon name="Users" size={22} color="#AEB4C2" />
                <b>Pick a guest</b>
                <span>Their cabin, dietary needs and preferences open here.</span>
              </div>
            )}
          </div>
        </div>
        </div>
      </div>

      {showAddModal && (
        <AddGuestModal
          isOpen={showAddModal}
          onClose={() => { setShowAddModal(false); setEditingGuest(null); }}
          onSave={editingGuest ? (data) => handleUpdate(editingGuest.id, data) : handleAdd}
          editingGuest={editingGuest}
        />
      )}
    </>
  );
};

export default GuestManagementDashboard;
