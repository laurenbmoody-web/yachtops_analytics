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
import {
  groupGuestsByPerson, searchPeople, sortPeople, rosterStats, initialsOf,
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
  const [expandedId, setExpandedId] = useState(null);
  const [query, setQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingGuest, setEditingGuest] = useState(null);
  const [sort, setSort] = useState({ column: 'name', direction: 'asc' });
  const [showDeleted, setShowDeleted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const tier = String(currentTenantMember?.permission_tier || '').toUpperCase().trim();
  const isCommand = tier === 'COMMAND';
  const isCommandOrChief = isCommand || tier === 'CHIEF';

  // Writing a guest record is Command and Chief. Deleting is Command alone.
  const canEdit = isCommandOrChief;
  const canDelete = isCommand;
  // Expanding opens the full dossier — passport, visa notes, emergency contacts,
  // APA and payment notes. Crew get the roster line (name, cabin, allergies),
  // which is what they need for service, and not the documents.
  const canExpand = isCommandOrChief;

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

  const people = useMemo(() => {
    const visible = showDeleted ? guests : guests.filter((g) => !g?.isDeleted);
    const grouped = groupGuestsByPerson(visible);
    return sortPeople(searchPeople(grouped, query), sort.column, sort.direction);
  }, [guests, showDeleted, query, sort]);

  const stats = useMemo(() => rosterStats(groupGuestsByPerson(guests)), [guests]);

  const toggleSort = (column) => {
    setSort((prev) => {
      if (prev.column !== column) return { column, direction: 'asc' };
      return { column, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
    });
  };

  const sortIcon = (column) => {
    const active = sort.column === column;
    return (
      <Icon
        name={active && sort.direction === 'desc' ? 'ChevronDown' : 'ChevronUp'}
        size={11}
      />
    );
  };

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

  const afterPanelAction = () => { setExpandedId(null); fetchGuests(); };

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
      <div className="gm-page">
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

        <div className="gm-controls">
          <div className="gm-search">
            <Icon name="Search" size={16} />
            <input
              type="text"
              value={query}
              placeholder="Search a name, cabin, allergy or contact…"
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>

        <div className="gm-head">
          <button type="button" className="gm-th" data-sorted={sort.column === 'name' ? 'y' : undefined}
            onClick={() => toggleSort('name')}>
            Guest {sortIcon('name')}
          </button>
          <button type="button" className="gm-th" data-sorted={sort.column === 'cabin' ? 'y' : undefined}
            onClick={() => toggleSort('cabin')}>
            Cabin {sortIcon('cabin')}
          </button>
          <button type="button" className="gm-th" data-sorted={sort.column === 'contact' ? 'y' : undefined}
            onClick={() => toggleSort('contact')}>
            Contact {sortIcon('contact')}
          </button>
          <span className="gm-th static">Dietary</span>
          <span className="gm-th static right">&nbsp;</span>
        </div>

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
        ) : (
          people.map((person) => {
            const open = expandedId === person.primaryId;
            return (
              <React.Fragment key={person.key}>
                <div className="gm-row" data-deleted={person.isDeleted ? 'y' : undefined}>
                  <div className="gm-person">
                    {person.photo ? (
                      <img className="gm-avatar" src={person.photo} alt="" />
                    ) : (
                      <span className="gm-avatar">{initialsOf(person.name)}</span>
                    )}
                    <span className="gm-ident">
                      <span className="gm-name">{person.name}</span>
                      <span className="gm-chips">
                        {person.types.map((t) => (
                          <span key={t} className="gm-pill accent">{t}</span>
                        ))}
                        {person.isDeleted && <span className="gm-pill warn">Deleted</span>}
                        {person.hasDuplicates && (
                          <span className="gm-pill flag" title="This person has more than one guest record">
                            <Icon name="Copy" size={10} /> {person.recordCount} records
                          </span>
                        )}
                      </span>
                    </span>
                  </div>

                  <span className="gm-cell ink">
                    {person.cabins.length ? person.cabins.join(' · ') : <span className="gm-cell faint">Not assigned</span>}
                    {person.cabinsDisagree && (
                      <span className="gm-cell-sub">records disagree</span>
                    )}
                  </span>

                  <span className="gm-cell">
                    {person.contact || <span className="gm-cell faint">—</span>}
                  </span>

                  <span className="gm-cell">
                    {person.allergies
                      ? <span className="gm-pill accent">{person.allergies}</span>
                      : <span className="gm-cell faint">None recorded</span>}
                  </span>

                  <span className="gm-rowactions">
                    {canExpand && (
                      <button
                        type="button"
                        className="gm-iconbtn"
                        data-open={open ? 'y' : undefined}
                        title={open ? 'Close' : 'Open guest details'}
                        onClick={() => setExpandedId(open ? null : person.primaryId)}
                      >
                        <Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={16} />
                      </button>
                    )}
                    {canEdit && !person.isDeleted && (
                      <button
                        type="button"
                        className="gm-iconbtn"
                        title="Edit guest"
                        onClick={() => {
                          const record = person.records.find((r) => r.id === person.primaryId);
                          setEditingGuest(record || person.records[0]);
                          setShowAddModal(true);
                        }}
                      >
                        <Icon name="Edit2" size={15} />
                      </button>
                    )}
                  </span>
                </div>

                {canExpand && open && (
                  <div className="gm-detail">
                    {person.hasDuplicates && (
                      <p className="gm-dupe">
                        <Icon name="AlertTriangle" size={14} />
                        <span>
                          <b>{person.name} has {person.recordCount} separate guest records</b> —
                          usually because owner and charter trips were recorded as different
                          people. Preferences and documents attach to one record at a time, so
                          some may be filed under the other. You are looking at one of them.
                        </span>
                      </p>
                    )}
                    <GuestDetailPanel
                      guest={person.records.find((r) => r.id === person.primaryId) || person.records[0]}
                      onEdit={afterPanelAction}
                      onDelete={afterPanelAction}
                      onReinstate={afterPanelAction}
                      onClose={() => setExpandedId(null)}
                      permissions={{ canEdit, canDelete }}
                    />
                  </div>
                )}
              </React.Fragment>
            );
          })
        )}
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
