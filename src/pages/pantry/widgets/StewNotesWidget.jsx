import React, { useEffect, useRef, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStewNotesActive } from '../hooks/useStewNotes';
import { useGuests } from '../hooks/useGuests';
import { formatDistanceToNow } from 'date-fns';

// ─── Note row with checkbox + inline edit ──────────────────────────────────

function NoteRow({ note, onComplete, onEdit, guestById }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState(note.content);
  const taRef = useRef(null);

  // Keep draft in sync when the note's content changes from elsewhere
  // (rollback on a failed edit, or a refetch landing fresh data).
  useEffect(() => { if (!editing) setDraft(note.content); }, [note.content, editing]);

  useEffect(() => {
    if (editing && taRef.current) {
      taRef.current.focus();
      const len = taRef.current.value.length;
      taRef.current.setSelectionRange(len, len);
    }
  }, [editing]);

  const save = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== note.content) {
      onEdit(note.id, trimmed);
    } else {
      setDraft(note.content);
    }
    setEditing(false);
  };

  const cancel = () => {
    setDraft(note.content);
    setEditing(false);
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      save();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  };

  const guest = note.related_guest_id ? guestById?.get(note.related_guest_id) : null;

  return (
    <div className="p-note-entry p-note-row">
      <button
        type="button"
        className="p-note-checkbox"
        onClick={() => onComplete(note.id)}
        aria-label="Mark note complete"
        title="Mark complete"
      >
        <span className="p-note-checkbox-box" />
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
          <span>{formatDistanceToNow(new Date(note.created_at), { addSuffix: true })}</span>
          {guest && <span className="p-note-guest-tag">for {guest.first_name}</span>}
          {note.saved_to_preferences && (
            <span style={{ color: 'var(--confirm)' }}>saved to preferences</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Inline add row (editorial baseline input + guest chips) ───────────────

function NoteAddRow({ onAdd, onboardGuests, autoFocusOnEmpty }) {
  const [body, setBody]       = useState('');
  const [guestId, setGuestId] = useState(null);
  const [pending, setPending] = useState(false);
  const inputRef = useRef(null);

  const submit = async () => {
    const trimmed = body.trim();
    if (!trimmed || pending) return;
    setPending(true);
    try {
      await onAdd({ body: trimmed, guest_id: guestId });
      setBody('');
      setGuestId(null);
      // Keep focus on the input so the stew can keep adding without
      // re-tapping. Phase 2 brief calls this out as critical for feel.
      inputRef.current?.focus();
    } finally {
      setPending(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  // Save when focus leaves the widget — but NOT when it shifts to a
  // guest chip in this row. relatedTarget lets us tell the difference
  // without a setTimeout race.
  const onBlur = (e) => {
    const next = e.relatedTarget;
    if (next && next.closest && next.closest('.p-note-add-row')) return;
    submit();
  };

  return (
    <div className="p-note-add-row">
      <input
        ref={inputRef}
        type="text"
        className="p-note-add"
        placeholder="Add a note..."
        value={body}
        onChange={e => setBody(e.target.value)}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        autoFocus={autoFocusOnEmpty}
        aria-label="Add a stew note"
        disabled={pending}
      />
      {onboardGuests.length > 0 && (
        <div className="p-note-chips" role="group" aria-label="Tag note for guest">
          {onboardGuests.map(g => {
            const selected = guestId === g.id;
            return (
              <button
                type="button"
                key={g.id}
                className={`p-note-chip${selected ? ' selected' : ''}`}
                // Don't steal focus from the input — keeps the keyboard
                // up on mobile and lets blur-to-save fire only when the
                // user genuinely taps off the widget.
                onMouseDown={e => e.preventDefault()}
                onClick={() => setGuestId(prev => prev === g.id ? null : g.id)}
                aria-pressed={selected}
                aria-label={`Tag note for ${g.first_name}`}
              >
                {g.first_name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Widget ────────────────────────────────────────────────────────────────

export default function StewNotesWidget() {
  const navigate = useNavigate();
  const {
    notes, loading, error,
    addNote, completeNote, editNote,
  } = useStewNotesActive();
  const { guests } = useGuests();

  const onboardGuests = useMemo(
    () => (guests ?? []).filter(g => (g.current_state ?? 'awake') !== 'ashore'),
    [guests],
  );
  const guestById = useMemo(
    () => new Map((guests ?? []).map(g => [g.id, g])),
    [guests],
  );

  const count = notes.length;

  return (
    <div className="p-card top-navy">
      <div className="p-card-head">
        <div>
          <div className="p-caps">
            {loading ? '…' : `${count} open · newest first`}
          </div>
          <div className="p-card-headline">
            Worth <em>noting</em>.
          </div>
        </div>
        <button className="p-card-link" style={{ color: 'var(--brass)' }}
          onClick={() => navigate('/pantry/notes')}
          aria-label="View all stew notes">
          View all →
        </button>
      </div>

      {loading && (
        <div style={{ color: 'var(--ink-tertiary)', fontSize: 13 }}>Loading…</div>
      )}
      {error && !loading && (
        <div style={{ color: 'var(--accent)', fontSize: 12 }}>Failed to load: {error}</div>
      )}

      {!loading && !error && count === 0 && (
        <p className="p-note-empty">No open notes.</p>
      )}

      {!loading && !error && notes.map(note => (
        <NoteRow
          key={note.id}
          note={note}
          onComplete={completeNote}
          onEdit={editNote}
          guestById={guestById}
        />
      ))}

      {!loading && !error && (
        <NoteAddRow
          onAdd={addNote}
          onboardGuests={onboardGuests}
        />
      )}
    </div>
  );
}
