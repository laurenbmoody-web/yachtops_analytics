import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { useStewNotesToday } from '../hooks/useStewNotes';
import { useGuests } from '../hooks/useGuests';
import { useCrewNames } from '../hooks/useCrewNames';
import { useAuth } from '../../../contexts/AuthContext';
import TripGuestPicker from './TripGuestPicker';

// HH:MM in vessel-local time. The browser TZ is the vessel-TZ proxy on
// Cargo (per vesselLocalTime.js), so a default Intl.DateTimeFormat
// resolves to the right window without an explicit timeZone.
const TIME_FMT = new Intl.DateTimeFormat('en-GB', {
  hour:   '2-digit',
  minute: '2-digit',
  hour12: false,
});

function formatHHMM(iso) {
  if (!iso) return '';
  return TIME_FMT.format(new Date(iso));
}

// ─── Note row — open OR done, checkbox left, body italic ───────────────────

function NoteRow({ note, currentUserId, crewById, guestById,
                  onComplete, onUncomplete, onEdit }) {
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
    if (trimmed && trimmed !== note.content) {
      onEdit(note.id, trimmed);
    } else {
      setDraft(note.content);
    }
    setEditing(false);
  };
  const cancel = () => { setDraft(note.content); setEditing(false); };
  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); }
    else if (e.key === 'Escape')          { e.preventDefault(); cancel(); }
  };

  const onCheckboxClick = () => {
    if (isDone) onUncomplete(note.id);
    else        onComplete(note.id);
  };

  const guest = note.related_guest_id ? guestById?.get(note.related_guest_id) : null;

  // Done-by-other meta line — strict spec: only render the by-line when
  // the completer is a different user. Self-completes show strike alone.
  const completedByOther = isDone
    && note.completed_by
    && note.completed_by !== currentUserId;
  const completerFirst = completedByOther
    ? (crewById.get(note.completed_by)?.firstName ?? 'crew')
    : null;

  return (
    <div className={`p-note-entry p-note-row${isDone ? ' done' : ''}`}>
      <button
        type="button"
        className="p-note-checkbox"
        onClick={onCheckboxClick}
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
            <span>{formatDistanceToNow(new Date(note.created_at), { addSuffix: true })}</span>
          )}
          {completedByOther && (
            <span>completed {formatHHMM(note.completed_at)} by {completerFirst}</span>
          )}
          {guest && <span className="p-note-guest-tag">for {guest.first_name}</span>}
          {note.saved_to_preferences && (
            <span style={{ color: 'var(--confirm)' }}>saved to preferences</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Inline add row ────────────────────────────────────────────────────────
//
// Editorial baseline-border input. Pills only appear when the input has
// focus — taps on pills don't take focus from the input
// (onMouseDown.preventDefault inside TripGuestPicker), so pills stay
// visible while the stew picks a guest. Blur to outside the row submits
// any non-empty body and collapses the pill row.

function NoteAddRow({ onAdd, guests }) {
  const [body, setBody]       = useState('');
  const [guestId, setGuestId] = useState(null);
  const [focused, setFocused] = useState(false);
  const [pending, setPending] = useState(false);
  const inputRef     = useRef(null);
  const containerRef = useRef(null);

  const submit = async () => {
    const trimmed = body.trim();
    if (!trimmed || pending) return;
    setPending(true);
    try {
      await onAdd({ body: trimmed, guest_ids: guestId ? [guestId] : [] });
      setBody('');
      setGuestId(null);
      // Keep focus so the stew can keep typing without re-tapping.
      // Pill row stays visible because focus remains.
      inputRef.current?.focus();
    } finally {
      setPending(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setBody('');
      setGuestId(null);
      inputRef.current?.blur();
    }
  };

  const onInputFocus = () => setFocused(true);
  const onInputBlur = (e) => {
    // If the next focus target is inside our container (defensive — chips
    // don't actually take focus thanks to mousedown preventDefault), stay.
    const next = e.relatedTarget;
    if (next && containerRef.current?.contains(next)) return;
    setFocused(false);
    if (body.trim()) submit();
  };

  return (
    <div ref={containerRef} className="p-note-add-row">
      <input
        ref={inputRef}
        type="text"
        className="p-note-add"
        placeholder="Add a note..."
        value={body}
        onChange={e => setBody(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={onInputFocus}
        onBlur={onInputBlur}
        aria-label="Add a stew note"
        disabled={pending}
      />
      {/* Mount unconditionally so guest data is ready the moment the
          input gets focus — toggling hidden via prop avoids the
          focus-time fetch lag the conditional mount caused. */}
      <TripGuestPicker
        selected={guestId}
        onChange={setGuestId}
        guests={guests}
        hidden={!focused}
      />
    </div>
  );
}

// ─── Widget ────────────────────────────────────────────────────────────────

export default function StewNotesWidget() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const {
    notes, loading, error,
    addNote, completeNote, uncompleteNote, editNote,
  } = useStewNotesToday();
  const { guests } = useGuests();
  const crewById = useCrewNames();

  const guestById = useMemo(
    () => new Map((guests ?? []).map(g => [g.id, g])),
    [guests],
  );

  // Open at top, done at bottom. Open keeps newest-first (DB sort);
  // done sorts by completed_at desc so the most-recently-ticked sits
  // at the top of the done block — easiest to undo on mistap.
  const { open, done } = useMemo(() => {
    const o = [];
    const d = [];
    for (const n of notes) (n.completed_at ? d : o).push(n);
    d.sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at));
    return { open: o, done: d };
  }, [notes]);

  const totalCount = open.length + done.length;
  const headerLabel = loading
    ? '…'
    : `${open.length} open · ${done.length} done`;

  return (
    <div className="p-card top-navy">
      <div className="p-card-head">
        <div>
          <div className="p-caps">{headerLabel}</div>
          <div className="p-card-headline">
            Worth <em>noting</em>.
          </div>
        </div>
        <button className="p-card-link" style={{ color: 'var(--brass)' }}
          onClick={() => navigate('/pantry/notes')}
          aria-label="View all stew notes">
          Open →
        </button>
      </div>

      {loading && (
        <div style={{ color: 'var(--ink-tertiary)', fontSize: 13 }}>Loading…</div>
      )}
      {error && !loading && (
        <div style={{ color: 'var(--accent)', fontSize: 12 }}>Failed to load: {error}</div>
      )}

      {!loading && !error && totalCount === 0 && (
        <p className="p-note-empty">No notes today.</p>
      )}

      {!loading && !error && open.map(note => (
        <NoteRow
          key={note.id}
          note={note}
          currentUserId={user?.id ?? null}
          crewById={crewById}
          guestById={guestById}
          onComplete={completeNote}
          onUncomplete={uncompleteNote}
          onEdit={editNote}
        />
      ))}

      {!loading && !error && done.length > 0 && (
        <div className="p-note-done-divider" aria-hidden="true" />
      )}

      {!loading && !error && done.map(note => (
        <NoteRow
          key={note.id}
          note={note}
          currentUserId={user?.id ?? null}
          crewById={crewById}
          guestById={guestById}
          onComplete={completeNote}
          onUncomplete={uncompleteNote}
          onEdit={editNote}
        />
      ))}

      {!loading && !error && (
        <NoteAddRow onAdd={addNote} guests={guests} />
      )}
    </div>
  );
}
