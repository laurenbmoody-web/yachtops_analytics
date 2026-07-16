import React, { useState, useEffect, useMemo } from 'react';
import Icon from '../../../components/AppIcon';
import '../laundry.css';

import { createLaundryItem, OwnerType, LaundryPriority, availableLaundryTags, formatLaundryTag, getKnownCustomTags } from '../utils/laundryStorage';
import { showToast } from '../../../utils/toast';
import { loadGuests } from '../../guest-management-dashboard/utils/guestStorage';
import { getCurrentTripGuestIds } from '../../trips-management-dashboard/utils/tripStorage';
import { loadUsers, UserStatus } from '../../../utils/authStorage';
import { useTenant } from '../../../contexts/TenantContext';
import { loadOnboardCrew } from '../utils/onboardCrew';
import { getGuestLaundryNotes } from '../utils/laundryPrefs';
import ModalShell from '../../../components/ui/ModalShell';

// keep only the leaf of a "Deck → Zone → Cabin" path
const cabinLeaf = (s) => { const parts = String(s || '').split(/\s*(?:→|>|\/)\s*/).filter(Boolean); return parts[parts.length - 1] || ''; };
let ROW_SEQ = 0;
const blankRow = () => ({ id: `r${ROW_SEQ++}`, description: '', colour: '', tags: [], qty: 1 });

const AddBagModal = ({ onClose, onSuccess }) => {
  const { activeTenantId } = useTenant() || {};

  const [ownerType, setOwnerType] = useState(OwnerType?.GUEST);
  const [ownerGuestId, setOwnerGuestId] = useState(null);
  const [ownerCrewUserId, setOwnerCrewUserId] = useState(null);
  const [ownerName, setOwnerName] = useState('');
  const [area, setArea] = useState('');
  const [areaLocationId, setAreaLocationId] = useState(null);

  const [guestSearch, setGuestSearch] = useState('');
  const [showGuestDrop, setShowGuestDrop] = useState(false);
  const [crewSearch, setCrewSearch] = useState('');
  const [showCrewDrop, setShowCrewDrop] = useState(false);
  const [activeGuests, setActiveGuests] = useState([]);
  const [activeCrew, setActiveCrew] = useState([]);

  const [urgent, setUrgent] = useState(false);
  const [neededBy, setNeededBy] = useState('');
  const [bagNote, setBagNote] = useState('');
  const [rows, setRows] = useState(() => [blankRow(), blankRow()]);
  const [knownCustomTags, setKnownCustomTags] = useState([]);
  const [guestNotes, setGuestNotes] = useState([]);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const isGuest = ownerType === OwnerType?.GUEST;

  useEffect(() => {
    if (!isGuest) return;
    (async () => {
      const tripGuestIds = await getCurrentTripGuestIds();
      const allGuests = await loadGuests();
      const filtered = (allGuests || []).filter((g) => !g?.isDeleted);
      setActiveGuests(filtered.filter((g) => tripGuestIds?.includes(g?.id)));
    })();
  }, [isGuest]);

  useEffect(() => {
    if (isGuest) return undefined;
    let cancelled = false;
    (async () => {
      if (activeTenantId) {
        const crew = await loadOnboardCrew(activeTenantId, new Date());
        if (!cancelled) setActiveCrew(crew);
      } else {
        const allUsers = loadUsers();
        const mapped = (allUsers?.filter((u) => u?.status === UserStatus?.ACTIVE) || [])
          .map((u) => ({ id: u.id, fullName: u.fullName, roleTitle: u.roleTitle, cabin: '' }));
        if (!cancelled) setActiveCrew(mapped);
      }
    })();
    return () => { cancelled = true; };
  }, [isGuest, activeTenantId]);

  useEffect(() => {
    let cancelled = false;
    getKnownCustomTags().then((t) => { if (!cancelled) setKnownCustomTags(t || []); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!isGuest || !ownerGuestId) { setGuestNotes([]); return undefined; }
    let cancelled = false;
    getGuestLaundryNotes(ownerGuestId).then((n) => { if (!cancelled) setGuestNotes(n); }).catch(() => { if (!cancelled) setGuestNotes([]); });
    return () => { cancelled = true; };
  }, [isGuest, ownerGuestId]);

  const tagOptions = useMemo(() => [...new Set([...availableLaundryTags, ...knownCustomTags])], [knownCustomTags]);

  const chooseOwner = (type) => {
    setOwnerType(type);
    setOwnerGuestId(null); setOwnerCrewUserId(null); setOwnerName(''); setArea(''); setAreaLocationId(null);
    setGuestSearch(''); setCrewSearch('');
  };
  const selectGuest = (g) => {
    const name = `${g?.firstName || ''} ${g?.lastName || ''}`.trim();
    setOwnerGuestId(g?.id); setOwnerName(name);
    setArea(cabinLeaf(g?.cabinLocationLabel || g?.cabinAllocated || '')); setAreaLocationId(g?.cabinLocationId || null);
    setGuestSearch(name); setShowGuestDrop(false);
    setErrors((e) => ({ ...e, owner: undefined }));
  };
  const selectCrew = (c) => {
    setOwnerCrewUserId(c?.id); setOwnerName(c?.fullName || ''); setArea(cabinLeaf(c?.cabin || '')); setAreaLocationId(null);
    setCrewSearch(c?.fullName || ''); setShowCrewDrop(false);
    setErrors((e) => ({ ...e, owner: undefined }));
  };

  const filteredGuests = useMemo(() => {
    const q = guestSearch?.toLowerCase()?.trim();
    return (activeGuests || []).filter((g) => !q || `${g?.firstName} ${g?.lastName}`.toLowerCase().includes(q));
  }, [activeGuests, guestSearch]);
  const filteredCrew = useMemo(() => {
    const q = crewSearch?.toLowerCase()?.trim();
    return (activeCrew || []).filter((c) => !q || (c?.fullName || '').toLowerCase().includes(q));
  }, [activeCrew, crewSearch]);

  const setRow = (id, patch) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const toggleRowTag = (id, tag) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, tags: r.tags.includes(tag) ? r.tags.filter((t) => t !== tag) : [...r.tags, tag] } : r)));
  const addRow = () => setRows((rs) => [...rs, blankRow()]);
  const removeRow = (id) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.id !== id) : rs));
  const setQty = (id, d) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, qty: Math.max(1, Math.min(99, r.qty + d)) } : r)));

  const filledRows = rows.filter((r) => r.description.trim());
  const totalPieces = filledRows.reduce((s, r) => s + r.qty, 0);

  const handleSubmit = async () => {
    const next = {};
    if (isGuest && !ownerGuestId) next.owner = 'Pick the guest whose bag this is.';
    if (!isGuest && !ownerCrewUserId) next.owner = 'Pick the crew member.';
    if (!filledRows.length) next.rows = 'Add at least one item with a description.';
    if (Object.keys(next).length) { setErrors(next); return; }
    setSubmitting(true);
    try {
      const base = {
        ownerType,
        ownerName,
        ownerDisplayName: ownerName,
        ownerGuestId: isGuest ? ownerGuestId : null,
        ownerCrewUserId: !isGuest ? ownerCrewUserId : null,
        area,
        areaLocationId,
        priority: urgent ? LaundryPriority?.URGENT : LaundryPriority?.NORMAL,
        notes: bagNote,
        neededBy: neededBy ? new Date(neededBy).toISOString() : null,
        photos: [],
        laundryNumber: '',
      };
      const jobs = [];
      for (const r of filledRows) {
        for (let i = 0; i < r.qty; i += 1) {
          jobs.push(createLaundryItem({ ...base, description: r.description.trim(), colour: r.colour.trim(), tags: r.tags }));
        }
      }
      await Promise.all(jobs);
      showToast(`Added ${jobs.length} item${jobs.length === 1 ? '' : 's'} to the wash.`, 'success');
      onSuccess?.();
      onClose?.();
    } catch (error) {
      console.error('Error adding bag:', error);
      showToast(error?.message === 'QUOTA_EXCEEDED'
        ? 'Storage limit reached. Remove old items or use smaller photos.'
        : 'Failed to add the bag. Please try again.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell onClose={onClose} panelClassName="alm-panel">
      <div className="alm-head">
        <h2 className="alm-title">LAUNDRY, <em>bag</em></h2>
        <button className="alm-x" onClick={onClose} aria-label="Close"><Icon name="X" size={18} /></button>
      </div>

      <div className="alm-body">
        {/* owner */}
        <div className="alm-section">
          <div className="alm-ownerbar">
            <div className="alm-seg" role="tablist">
              <button type="button" role="tab" aria-selected={isGuest} className={`alm-seg-btn${isGuest ? ' on' : ''}`} onClick={() => chooseOwner(OwnerType?.GUEST)}>Guest</button>
              <button type="button" role="tab" aria-selected={!isGuest} className={`alm-seg-btn${!isGuest ? ' on' : ''}`} onClick={() => chooseOwner(OwnerType?.CREW)}>Crew</button>
            </div>
            <button type="button" className={`alm-urgent-toggle${urgent ? ' on' : ''}`} onClick={() => setUrgent((u) => !u)}>
              <Icon name="Zap" size={13} /> Urgent
              <span className={`alm-switch sm${urgent ? ' on' : ''}`} />
            </button>
          </div>
        </div>

        {/* who */}
        <div className="alm-section">
          <label className="alm-label">{isGuest ? 'Guest' : 'Crew member'} <span className="alm-req">required</span></label>
          <div className="alm-combo">
            {isGuest ? (
              <>
                <input type="text" className={`alm-field${errors.owner ? ' invalid' : ''}`} placeholder="Search guest…"
                  value={guestSearch} onChange={(e) => { setGuestSearch(e.target.value); setShowGuestDrop(true); }}
                  onFocus={() => setShowGuestDrop(true)} onBlur={() => setTimeout(() => setShowGuestDrop(false), 150)} />
                {showGuestDrop && (
                  <div className="alm-combo-menu">
                    {filteredGuests.length ? filteredGuests.map((g) => (
                      <button key={g.id} type="button" className="alm-combo-opt" onMouseDown={(e) => e.preventDefault()} onClick={() => selectGuest(g)}>
                        <span style={{ minWidth: 0 }}>
                          <span className="alm-combo-name">{g.firstName} {g.lastName}</span>
                          {(g.cabinLocationLabel || g.cabinAllocated) && <span className="alm-combo-meta">{cabinLeaf(g.cabinLocationLabel || g.cabinAllocated)}</span>}
                        </span>
                        <span className="alm-combo-active">On trip</span>
                      </button>
                    )) : <div className="alm-combo-empty">No guests on the active trip</div>}
                  </div>
                )}
              </>
            ) : (
              <>
                <input type="text" className={`alm-field${errors.owner ? ' invalid' : ''}`} placeholder="Search crew member…"
                  value={crewSearch} onChange={(e) => { setCrewSearch(e.target.value); setShowCrewDrop(true); }}
                  onFocus={() => setShowCrewDrop(true)} onBlur={() => setTimeout(() => setShowCrewDrop(false), 150)} />
                {showCrewDrop && (
                  <div className="alm-combo-menu">
                    {filteredCrew.length ? filteredCrew.map((c) => (
                      <button key={c.id} type="button" className="alm-combo-opt" onMouseDown={(e) => e.preventDefault()} onClick={() => selectCrew(c)}>
                        <span style={{ minWidth: 0 }}>
                          <span className="alm-combo-name">{c.fullName}</span>
                          {c.roleTitle && <span className="alm-combo-meta">{c.roleTitle}</span>}
                        </span>
                      </button>
                    )) : <div className="alm-combo-empty">No crew on board</div>}
                  </div>
                )}
              </>
            )}
          </div>
          {errors.owner && <div className="alm-err">{errors.owner}</div>}
          {guestNotes.length > 0 && (
            <div className="alm-pref" role="note">
              <span className="alm-pref-ic"><Icon name="Sparkles" size={14} /></span>
              <div className="alm-pref-body">
                <span className="alm-pref-h">Laundry preferences on file</span>
                <div className="alm-pref-list">
                  {guestNotes.map((n, i) => <span key={i} className={`alm-pref-pill${n.priority === 'high' ? ' hi' : ''}`}>{n.text}</span>)}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* cabin / area */}
        <div className="alm-section">
          <label className="alm-label">{isGuest ? 'Cabin' : 'Area'} <span className="alm-opt">optional</span></label>
          <input className="alm-field" value={area} onChange={(e) => setArea(e.target.value)} placeholder={isGuest ? 'Cabin' : 'Where it came from'} />
        </div>

        {/* items */}
        <div className="alm-section">
          <div className="alb-itemhead">
            <label className="alm-label" style={{ margin: 0 }}>Items in the bag <span className="alm-req">required</span></label>
            <span className="alb-total">{totalPieces} piece{totalPieces === 1 ? '' : 's'}</span>
          </div>
          {errors.rows && <div className="alm-err" style={{ marginBottom: 8 }}>{errors.rows}</div>}

          <div className="alb-rows">
            {rows.map((r, idx) => (
              <div className="alb-row" key={r.id}>
                <div className="alb-row-top">
                  <span className="alb-row-n">{idx + 1}</span>
                  <input className="alm-field alb-desc" value={r.description} placeholder="Item — e.g. White linen shirt"
                    onChange={(e) => { setRow(r.id, { description: e.target.value }); if (errors.rows) setErrors((er) => ({ ...er, rows: undefined })); }} />
                  <div className="alb-qty">
                    <button type="button" onClick={() => setQty(r.id, -1)} aria-label="Fewer">−</button>
                    <span className="tnum">{r.qty}</span>
                    <button type="button" onClick={() => setQty(r.id, 1)} aria-label="More">+</button>
                  </div>
                  <button type="button" className="alb-row-x" onClick={() => removeRow(r.id)} aria-label="Remove item" disabled={rows.length === 1}><Icon name="Trash2" size={15} /></button>
                </div>
                <input className="alm-field alb-colour" value={r.colour} placeholder="Colour / detail (optional)" onChange={(e) => setRow(r.id, { colour: e.target.value })} />
                <div className="alb-tags">
                  {tagOptions.map((t) => (
                    <button key={t} type="button" className={`alb-tag${r.tags.includes(t) ? ' on' : ''}`} onClick={() => toggleRowTag(r.id, t)}>{formatLaundryTag(t)}</button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <button type="button" className="alb-addrow" onClick={addRow}><Icon name="Plus" size={15} /> Add another item</button>
        </div>

        {/* needed by (whole bag) */}
        <div className="alm-section">
          <label className="alm-label">Needed back by <span className="alm-opt">optional</span></label>
          <input type="datetime-local" className="alm-field" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} />
        </div>

        {/* bag note */}
        <div className="alm-section">
          <label className="alm-label">Note for the whole bag <span className="alm-opt">optional</span></label>
          <input className="alm-field" value={bagNote} onChange={(e) => setBagNote(e.target.value)} placeholder="e.g. Delivered to cabin by 6pm" />
        </div>
      </div>

      <div className="alm-foot">
        <button type="button" className="alm-linkbtn" onClick={onClose}>Cancel</button>
        <button type="button" className="alm-btn primary" onClick={handleSubmit} disabled={submitting}>
          {submitting ? 'Adding…' : `Add ${totalPieces || ''} to the wash`}
        </button>
      </div>
    </ModalShell>
  );
};

export default AddBagModal;
