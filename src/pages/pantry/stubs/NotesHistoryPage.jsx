import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Mic, Trash2, X } from 'lucide-react';
import Header from '../../../components/navigation/Header';
import StandbyLayoutHeader from '../widgets/StandbyLayoutHeader';
import { useStewNotes, vesselToday6amISO } from '../hooks/useStewNotes';
import { useGuests } from '../hooks/useGuests';
import { useCrewNames } from '../hooks/useCrewNames';
import { useAuth } from '../../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import TripGuestPicker from '../widgets/TripGuestPicker';
import '../pantry.css';

const PAGE_STEP = 50;

const TIME_FMT = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit', minute: '2-digit', hour12: false,
});
const formatHHMM = (iso) => iso ? TIME_FMT.format(new Date(iso)) : '';

// "This week" = within 7 days of today's 06:00 threshold (and not in
// today's bucket). Anything older falls into EARLIER.
function isThisWeek(iso, today6amMs) {
  const t = new Date(iso).getTime();
  const sevenDays = 7 * 86_400_000;
  return t >= (today6amMs - sevenDays);
}

// AND across groups, OR within group. Empty group = no filter on that
// dimension. Mirror logic in the SOURCE prop accepts only 'voice'/'typed'
// — 'auto' (parsed-action notes) is intentionally not surfaced as a
// filter dimension; users either care about voice vs typed or they don't.
function noteMatches(note, search, filters, currentUserId) {
  const q = search.trim().toLowerCase();
  if (q && !(note.content ?? '').toLowerCase().includes(q)) return false;

  const status = filters.status;
  if (status.length > 0) {
    const isDone = !!note.completed_at;
    const matchOpen = status.includes('open') && !isDone;
    const matchDone = status.includes('done') &&  isDone;
    if (!matchOpen && !matchDone) return false;
  }

  const author = filters.author;
  if (author.length > 0) {
    const isMine = note.author_id === currentUserId;
    const matchMine = author.includes('mine') &&  isMine;
    const matchCrew = author.includes('crew') && !isMine;
    if (!matchMine && !matchCrew) return false;
  }

  const source = filters.source;
  if (source.length > 0) {
    if (!source.includes(note.source)) return false;
  }

  return true;
}

// ─── Filter group ──────────────────────────────────────────────────────────

function FilterGroup({ label, options, value, onToggle }) {
  return (
    <div className="p-filter-group">
      <div className="p-caps p-filter-label">{label}</div>
      <div className="p-filter-pills">
        {options.map(opt => {
          const selected = value.includes(opt.key);
          return (
            <button
              key={opt.key}
              type="button"
              className={`p-note-chip${selected ? ' selected' : ''}`}
              aria-pressed={selected}
              onClick={() => onToggle(opt.key)}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Note row — page version (richer than widget; convert/delete) ──────────

function PageNoteRow({
  note, currentUserId, crewById, guestById, authorName,
  onComplete, onUncomplete, onEdit, onDelete,
  onOpenGuest, onOpenConvert,
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState(note.content);
  const taRef = useRef(null);

  useEffect(() => { if (!editing) setDraft(note.content); }, [note.content, editing]);
  useEffect(() => {
    if (editing && taRef.current) {
      taRef.current.focus();
      const len = taRef.current.value.length;
      taRef.current.setSelectionRange(len, len);
    }
  }, [editing]);

  const isDone = !!note.completed_at;

  const save = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== note.content) onEdit(note.id, trimmed);
    else setDraft(note.content);
    setEditing(false);
  };
  const cancel = () => { setDraft(note.content); setEditing(false); };
  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); }
    else if (e.key === 'Escape')          { e.preventDefault(); cancel(); }
  };

  const guest = note.related_guest_id ? guestById?.get(note.related_guest_id) : null;
  const completedByOther = isDone && note.completed_by && note.completed_by !== currentUserId;
  const completerFirst = completedByOther
    ? (crewById.get(note.completed_by)?.firstName ?? 'crew')
    : null;

  return (
    <div className={`p-note-entry p-note-row${isDone ? ' done' : ''}`}>
      <button
        type="button"
        className="p-note-checkbox"
        onClick={() => (isDone ? onUncomplete(note.id) : onComplete(note.id))}
        aria-label={isDone ? 'Mark note open' : 'Mark note complete'}
        title={isDone ? 'Tap to reopen' : 'Mark complete'}
      >
        <span className={`p-note-checkbox-box${isDone ? ' checked' : ''}`} />
      </button>
      <div className="p-note-row-body">
        {editing ? (
          <textarea
            ref={taRef}
            className="p-note-edit"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={save}
            onKeyDown={onKeyDown}
            rows={Math.max(1, Math.min(6, Math.ceil((draft?.length || 0) / 60)))}
            aria-label="Edit note"
          />
        ) : (
          <div
            className="p-note-text"
            role="button"
            tabIndex={0}
            onClick={() => setEditing(true)}
            onKeyDown={e => e.key === 'Enter' && setEditing(true)}
            aria-label="Edit note"
            title="Tap to edit"
          >
            {note.content}
          </div>
        )}
        <div className="p-note-meta">
          {!isDone && (
            <span title={new Date(note.created_at).toLocaleString()}>
              {formatDistanceToNow(new Date(note.created_at), { addSuffix: true })}
            </span>
          )}
          {completedByOther && (
            <span>completed {formatHHMM(note.completed_at)} by {completerFirst}</span>
          )}
          <span>by {authorName}</span>
          {guest && (
            <button
              type="button"
              className="p-note-guest-link"
              onClick={() => onOpenGuest(guest.id)}
              aria-label={`Open ${guest.first_name}'s drawer`}
            >
              for {guest.first_name}
            </button>
          )}
          {note.saved_to_preferences && (
            <span style={{ color: 'var(--confirm)' }}>saved to preferences</span>
          )}
          {!note.saved_to_preferences && (
            <button type="button" className="p-note-meta-link"
              onClick={() => onOpenConvert(note)}>
              convert →
            </button>
          )}
          <button type="button" className="p-note-meta-link p-note-meta-danger"
            onClick={() => onDelete(note.id)}
            aria-label="Delete note">
            <Trash2 size={11} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Convert modal (kept simple — preserves existing flow) ─────────────────

function ConvertSheet({ note, guests, onClose, onConvertToPreference, onConvertToDayNote }) {
  const [type, setType]               = useState(null);
  const [pickedGuestId, setPickedId]  = useState(note?.related_guest_id ?? '');

  if (!note) return null;

  const runConversion = async () => {
    if (!type || !pickedGuestId) return;
    if (type === 'preference') await onConvertToPreference(note.id, pickedGuestId);
    if (type === 'day_note')   await onConvertToDayNote(note.id, pickedGuestId);
    onClose();
  };

  return (
    <div className="p-convert-sheet">
      <div className="p-caps" style={{ marginBottom: 6 }}>Convert this note to…</div>
      <div className="p-convert-types">
        <button className={`p-note-chip${type === 'preference' ? ' selected' : ''}`}
          onClick={() => setType('preference')}>preference</button>
        <button className={`p-note-chip${type === 'day_note' ? ' selected' : ''}`}
          onClick={() => setType('day_note')}>day note</button>
      </div>
      {type && (
        <>
          <div className="p-caps" style={{ marginTop: 10, marginBottom: 6 }}>For which guest?</div>
          <select
            className="p-convert-picker"
            value={pickedGuestId}
            onChange={e => setPickedId(e.target.value)}
          >
            <option value="">— pick a guest —</option>
            {guests.map(g => (
              <option key={g.id} value={g.id}>{g.first_name} {g.last_name}</option>
            ))}
          </select>
        </>
      )}
      <div className="p-convert-actions">
        <button className="p-btn primary" onClick={runConversion}
          disabled={!type || !pickedGuestId}>Convert</button>
        <button className="p-btn ghost" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

// ─── Inline add row — same shape as widget but pills always visible ────────

function PageNoteAddRow({ onAdd, guests }) {
  const [body, setBody]       = useState('');
  const [guestId, setGuestId] = useState(null);
  const [pending, setPending] = useState(false);
  const inputRef = useRef(null);

  const submit = async () => {
    const trimmed = body.trim();
    if (!trimmed || pending) return;
    setPending(true);
    try {
      await onAdd({ body: trimmed, guest_ids: guestId ? [guestId] : [] });
      setBody('');
      setGuestId(null);
      inputRef.current?.focus();
    } finally {
      setPending(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    else if (e.key === 'Escape')          {
      e.preventDefault(); setBody(''); setGuestId(null); inputRef.current?.blur();
    }
  };

  return (
    <div className="p-note-add-row p-note-add-row-page">
      <input
        ref={inputRef}
        type="text"
        className="p-note-add p-note-add-page"
        placeholder="Add a note..."
        value={body}
        onChange={e => setBody(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => { if (body.trim()) submit(); }}
        aria-label="Add a stew note"
        disabled={pending}
      />
      {/* Page has the breathing room — pills always visible, no
          focus-gating like the widget. */}
      <TripGuestPicker
        selected={guestId}
        onChange={setGuestId}
        guests={guests}
      />
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function NotesHistoryPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [limit, setLimit] = useState(PAGE_STEP);

  const {
    notes, loading, error,
    addNote, completeNote, uncompleteNote, editNote, deleteNote,
    convertToPreference, convertToDayNote,
  } = useStewNotes({ limit });

  const { guests }  = useGuests();
  const crewById    = useCrewNames();

  const [search, setSearch]       = useState('');
  const [filters, setFilters]     = useState({ status: [], author: [], source: [] });
  const [showPrev, setShowPrev]   = useState(false);
  const [convertNote, setConvertNote] = useState(null);

  useEffect(() => {
    const prev = document.body.style.background;
    document.body.style.background = '#F5F1EA';
    return () => { document.body.style.background = prev; };
  }, []);

  const today6am   = useMemo(() => vesselToday6amISO(), []);
  const today6amMs = new Date(today6am).getTime();

  const guestById = useMemo(
    () => new Map((guests ?? []).map(g => [g.id, g])),
    [guests],
  );

  const authorById = crewById; // same Map shape

  const filtered = useMemo(
    () => notes.filter(n => noteMatches(n, search, filters, user?.id)),
    [notes, search, filters, user],
  );

  // TODAY = active OR completed today. PREVIOUS = completed before
  // today's 06:00 threshold. Open notes never fall into PREVIOUS — a
  // 3-day-old open note still belongs to the working set.
  const { todayNotes, previousNotes } = useMemo(() => {
    const t = [];
    const p = [];
    for (const n of filtered) {
      const inToday = !n.completed_at || n.completed_at >= today6am;
      if (inToday) t.push(n);
      else         p.push(n);
    }
    return { todayNotes: t, previousNotes: p };
  }, [filtered, today6am]);

  const todayOpen = todayNotes.filter(n => !n.completed_at);
  const todayDone = todayNotes
    .filter(n => !!n.completed_at)
    .sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at));

  const { thisWeek, earlier } = useMemo(() => {
    const w = [];
    const e = [];
    for (const n of previousNotes) {
      const t = new Date(n.completed_at ?? n.created_at).getTime();
      if (isThisWeek(n.completed_at ?? n.created_at, today6amMs)) w.push(n);
      else                                                         e.push(n);
    }
    return { thisWeek: w, earlier: e };
  }, [previousNotes, today6amMs]);

  // Empty-state copy. Three buckets per spec:
  //   1. No notes at all on the boat
  //   2. Notes exist but none match active filters
  //   3. Notes exist for previous but nothing today
  const filtersActive = !!search.trim()
    || filters.status.length > 0
    || filters.author.length > 0
    || filters.source.length > 0;

  const hasAnyNotes = notes.length > 0;
  const hasFilteredAny = filtered.length > 0;

  // Auto-expand previous when there's nothing today but previous has rows.
  useEffect(() => {
    if (!loading && todayNotes.length === 0 && previousNotes.length > 0) {
      setShowPrev(true);
    }
  }, [loading, todayNotes.length, previousNotes.length]);

  const toggleFilter = (group, key) => {
    setFilters(prev => {
      const set = new Set(prev[group]);
      if (set.has(key)) set.delete(key); else set.add(key);
      return { ...prev, [group]: Array.from(set) };
    });
  };

  const clearFilters = () => {
    setSearch('');
    setFilters({ status: [], author: [], source: [] });
  };

  const handleOpenGuest = (guestId) => {
    navigate('/pantry/standby', { state: { openDrawerForGuestId: guestId } });
  };

  const resolveAuthor = (uid) => authorById.get(uid)?.firstName ?? 'Crew';

  return (
    <>
      <Header />
      <div id="pantry-root" className="pantry-page">
        <StandbyLayoutHeader
          title="Notes"
          subtitle="What the team is tracking, today and prior."
          backTo="/pantry/standby"
        />

        {/* ── Search + filters ────────────────────────────────────── */}
        <div className="p-card top-navy" style={{ marginBottom: 12 }}>
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search notes..."
            className="p-note-search"
            aria-label="Search notes"
          />
          <FilterGroup
            label="Status"
            options={[{ key: 'open', label: 'Open' }, { key: 'done', label: 'Done' }]}
            value={filters.status}
            onToggle={k => toggleFilter('status', k)}
          />
          <FilterGroup
            label="Author"
            options={[{ key: 'mine', label: 'Mine' }, { key: 'crew', label: 'Crew' }]}
            value={filters.author}
            onToggle={k => toggleFilter('author', k)}
          />
          <FilterGroup
            label="Source"
            options={[{ key: 'voice', label: 'Voice' }, { key: 'typed', label: 'Typed' }]}
            value={filters.source}
            onToggle={k => toggleFilter('source', k)}
          />
          {filtersActive && (
            <button type="button" className="p-card-link p-clear-filters"
              onClick={clearFilters}>
              <X size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />
              Clear filters
            </button>
          )}
        </div>

        {/* ── TODAY ───────────────────────────────────────────────── */}
        <div className="p-card top-navy">
          <div className="p-card-head">
            <div>
              <div className="p-caps">Today</div>
              <div className="p-card-headline">
                <em>{todayOpen.length}</em> open · {todayDone.length} done
              </div>
            </div>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              fontFamily: 'var(--font-sans)', fontSize: 10, color: 'var(--ink-tertiary)',
            }}>
              <Mic size={11} /> voice dictation on Standby
            </span>
          </div>

          <PageNoteAddRow onAdd={addNote} guests={guests} />

          {loading && (
            <div style={{ color: 'var(--ink-tertiary)', fontSize: 13, padding: '12px 0' }}>
              Loading…
            </div>
          )}
          {error && !loading && (
            <div style={{ color: 'var(--accent)', fontSize: 12 }}>Failed to load: {error}</div>
          )}

          {/* Empty state branches (priority order)                       */}
          {!loading && !error && !hasAnyNotes && (
            <p className="p-note-empty">
              No notes yet. Add one above to get started.
            </p>
          )}
          {!loading && !error && hasAnyNotes && !hasFilteredAny && (
            <p className="p-note-empty">
              No notes match your filters.{' '}
              <button type="button" className="p-card-link"
                onClick={clearFilters}>Clear filters</button>
            </p>
          )}
          {!loading && !error && hasFilteredAny && todayNotes.length === 0 && (
            <p className="p-note-empty">
              No notes today. Previous notes below.
            </p>
          )}

          {/* TODAY rows */}
          {!loading && !error && todayOpen.map(note => (
            <PageNoteRow
              key={note.id}
              note={note}
              currentUserId={user?.id}
              crewById={crewById}
              guestById={guestById}
              authorName={resolveAuthor(note.author_id)}
              onComplete={completeNote}
              onUncomplete={uncompleteNote}
              onEdit={editNote}
              onDelete={deleteNote}
              onOpenGuest={handleOpenGuest}
              onOpenConvert={setConvertNote}
            />
          ))}
          {!loading && !error && todayDone.length > 0 && (
            <div className="p-note-done-divider" aria-hidden="true" />
          )}
          {!loading && !error && todayDone.map(note => (
            <PageNoteRow
              key={note.id}
              note={note}
              currentUserId={user?.id}
              crewById={crewById}
              guestById={guestById}
              authorName={resolveAuthor(note.author_id)}
              onComplete={completeNote}
              onUncomplete={uncompleteNote}
              onEdit={editNote}
              onDelete={deleteNote}
              onOpenGuest={handleOpenGuest}
              onOpenConvert={setConvertNote}
            />
          ))}

          {/* "View previous notes →" toggle */}
          {!loading && !error && previousNotes.length > 0 && (
            <div className="p-note-prev-toggle">
              <button type="button" className="p-card-link"
                style={{ color: 'var(--brass)' }}
                onClick={() => setShowPrev(s => !s)}
                aria-expanded={showPrev}>
                {showPrev ? 'Hide previous notes' : 'View previous notes'} →
              </button>
            </div>
          )}
        </div>

        {/* ── PREVIOUS (inline, expanded) ─────────────────────────── */}
        {!loading && !error && showPrev && previousNotes.length > 0 && (
          <div className="p-card top-navy" style={{ marginTop: 12 }}>
            {thisWeek.length > 0 && (
              <>
                <div className="p-card-head">
                  <div>
                    <div className="p-caps">This week</div>
                    <div className="p-card-headline">{thisWeek.length} note{thisWeek.length === 1 ? '' : 's'}</div>
                  </div>
                </div>
                {thisWeek.map(note => (
                  <PageNoteRow
                    key={note.id}
                    note={note}
                    currentUserId={user?.id}
                    crewById={crewById}
                    guestById={guestById}
                    authorName={resolveAuthor(note.author_id)}
                    onComplete={completeNote}
                    onUncomplete={uncompleteNote}
                    onEdit={editNote}
                    onDelete={deleteNote}
                    onOpenGuest={handleOpenGuest}
                    onOpenConvert={setConvertNote}
                  />
                ))}
              </>
            )}

            {earlier.length > 0 && (
              <>
                <div className="p-card-head" style={{ marginTop: thisWeek.length > 0 ? 18 : 0 }}>
                  <div>
                    <div className="p-caps">Earlier</div>
                    <div className="p-card-headline">{earlier.length} note{earlier.length === 1 ? '' : 's'}</div>
                  </div>
                </div>
                {earlier.map(note => (
                  <PageNoteRow
                    key={note.id}
                    note={note}
                    currentUserId={user?.id}
                    crewById={crewById}
                    guestById={guestById}
                    authorName={resolveAuthor(note.author_id)}
                    onComplete={completeNote}
                    onUncomplete={uncompleteNote}
                    onEdit={editNote}
                    onDelete={deleteNote}
                    onOpenGuest={handleOpenGuest}
                    onOpenConvert={setConvertNote}
                  />
                ))}
              </>
            )}

            {notes.length >= limit && (
              <div style={{ marginTop: 12, textAlign: 'center' }}>
                <button className="p-btn outline"
                  onClick={() => setLimit(l => l + PAGE_STEP)}>
                  Load more
                </button>
              </div>
            )}
          </div>
        )}

        {convertNote && (
          <ConvertSheet
            note={convertNote}
            guests={guests}
            onClose={() => setConvertNote(null)}
            onConvertToPreference={convertToPreference}
            onConvertToDayNote={convertToDayNote}
          />
        )}
      </div>
    </>
  );
}
