import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useDragControls } from 'framer-motion';
import { X } from 'lucide-react';
import { useGuestDayNotes } from '../hooks/useGuestDayNotes';
import { useGuestDrawerPrefs } from '../hooks/useGuestDrawerPrefs';
import { formatDistanceToNow } from 'date-fns';
import { ALL_MOODS, QUICK_MOODS } from '../constants/moods';
import DrawerAllergiesBlock from './DrawerAllergiesBlock';
import DrawerAtAGlance from './DrawerAtAGlance';
import DrawerRightNow from './DrawerRightNow';

// Swipe-down dismissal thresholds. On release the drawer dismisses if the
// user has dragged past 50% of the drawer's own height OR flicked down
// faster than the velocity cutoff. Otherwise framer-motion's
// dragSnapToOrigin returns the sheet to y:0.
const DRAG_DISMISS_RATIO    = 0.5;  // fraction of drawer height
const DRAG_DISMISS_VELOCITY = 500;  // px/s on release (flick dismissal)

const DAY_NAMES   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const STATE_PILLS = ['awake', 'asleep', 'ashore'];

// Ashore "returning_at" converters.
//   - Form input is an HH:MM <input type="time"> in vessel-local time.
//   - Storage is a full ISO timestamp (timestamptz in the DB schema).
// Compose picks today at the given time, bumping to tomorrow if the time
// has already passed — a user typing 01:00 at 23:30 means 01:00 next day.
function hhmmToIso(hhmm) {
  if (!hhmm) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const h = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  const min = Math.min(59, Math.max(0, parseInt(m[2], 10)));
  const now = new Date();
  const candidate = new Date(now);
  candidate.setHours(h, min, 0, 0);
  if (candidate.getTime() <= now.getTime()) {
    candidate.setDate(candidate.getDate() + 1);
  }
  return candidate.toISOString();
}

function isoToHHMM(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

export default function GuestDrawer({ guest, onClose, onUpdateState, onUpdateMood, onUpdateAshoreContext }) {
  const navigate = useNavigate();
  const dragControls = useDragControls();
  const sheetRef = useRef(null);
  const { notes, loading: notesLoading, addNote } = useGuestDayNotes(guest.id);
  const { data: drawerPrefs, loading: prefsLoading, error: prefsError } = useGuestDrawerPrefs(guest.id);
  const [moodExpanded, setMoodExpanded] = useState(false);
  const [noteInput, setNoteInput]       = useState('');
  const [addingNote, setAddingNote]     = useState(false);
  const [submitting, setSubmitting]     = useState(false);

  const goToPreferences = () => { onClose(); navigate(`/guest/${guest.id}/preferences`); };
  const goToHistory     = () => { onClose(); navigate(`/guests/${guest.id}/history`); };

  // Local optimistic state — initialised from the guest prop at open time
  const [localState, setLocalState] = useState(guest.current_state ?? 'awake');
  const [localMood, setLocalMood]   = useState(guest.current_mood ?? null);

  // Ashore context form state. Opens automatically when Ashore pill is
  // tapped (either switching TO ashore, or re-tapping while already ashore
  // to edit the context). Closes on Save or Cancel. Auto-closes + clears
  // context when state changes away from ashore.
  const [ashoreFormOpen, setAshoreFormOpen] = useState(false);
  const [ashoreDestination, setAshoreDestination] = useState(guest.ashore_context?.destination ?? '');
  const [ashoreReturningAt, setAshoreReturningAt] = useState(isoToHHMM(guest.ashore_context?.returning_at));

  const today     = DAY_NAMES[new Date().getDay()];
  const firstName = guest.first_name ?? '';
  const lastName  = guest.last_name  ?? '';
  const initials  = `${firstName[0] ?? ''}${lastName[0] ?? ''}`.toUpperCase();
  const imgSrc    = guest.photo?.dataUrl ?? null;
  const role      = [guest.guest_type, guest.cabin_location_label].filter(Boolean).join(' · ');

  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleStateChange = (newState) => {
    // Re-tap already-active Ashore pill reopens the context form so the
    // user can edit destination / returning_at without first toggling
    // to another state.
    if (newState === localState) {
      if (newState === 'ashore') setAshoreFormOpen(true);
      return;
    }

    setLocalState(newState); // optimistic
    onUpdateState?.(guest.id, newState);

    if (newState === 'ashore') {
      // Open the inline form; reset to current DB values so an edit flow
      // starts from truth (not leftover unsaved state from a prior open).
      setAshoreDestination(guest.ashore_context?.destination ?? '');
      setAshoreReturningAt(isoToHHMM(guest.ashore_context?.returning_at));
      setAshoreFormOpen(true);
    } else {
      // Leaving ashore — clear persisted context + collapse the form.
      setAshoreFormOpen(false);
      setAshoreDestination('');
      setAshoreReturningAt('');
      if (guest.ashore_context != null) {
        onUpdateAshoreContext?.(guest.id, null);
      }
    }
  };

  const handleAshoreSave = () => {
    const next = {
      destination:  ashoreDestination.trim() || null,
      returning_at: hhmmToIso(ashoreReturningAt),
    };
    onUpdateAshoreContext?.(guest.id, next);
    setAshoreFormOpen(false);
  };

  const handleAshoreCancel = () => {
    setAshoreFormOpen(false);
    // Don't clear state — guest remains ashore with whatever context was
    // saved before (or null). Spec: "incomplete context is still valid;
    // ashore without destination is fine."
  };

  // Re-tap the active mood pill to unset (mood becomes null). Otherwise
  // tapping a different pill switches the mood. Emoji arg dropped — the hook
  // stopped writing current_mood_emoji in Phase 2 (dead-write removal).
  const handleMoodChange = (key) => {
    const nextKey = key === localMood ? null : key;
    setLocalMood(nextKey); // optimistic
    onUpdateMood?.(guest.id, nextKey);
  };

  const handleAddNote = async () => {
    if (!noteInput.trim()) return;
    setSubmitting(true);
    try { await addNote(noteInput.trim()); setNoteInput(''); setAddingNote(false); }
    catch { /* leave input open */ }
    finally { setSubmitting(false); }
  };

  return (
    <AnimatePresence>
      {/* Backdrop — tap outside to close.
          TODO: drive opacity from the sheet's drag motion value so the
          backdrop fades as the sheet slides down. Attempted this pass but
          binding style.opacity to a motion value supersedes the
          initial/animate/exit transitions on the same prop — the backdrop
          loses its fade-in/out. Needs a different plumbing approach
          (manual useEffect + opacity state combined with drag) to land
          without breaking the existing animation. Left optional per the
          Phase 2 spec. */}
      <motion.div
        key="backdrop"
        className="p-drawer-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet — stopPropagation prevents backdrop click from firing.
          Drag-to-dismiss is scoped to the handle via dragControls + the
          handle's onPointerDown trigger. dragListener={false} stops the
          whole sheet from listening for drag — so the guest scrolls the
          drawer body normally without tripping the gesture. Dismiss
          threshold is 50% of the sheet's own height, measured via
          sheetRef, or a fast-flick velocity release. */}
      <motion.div
        ref={sheetRef}
        key="sheet"
        className="p-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`${firstName} ${lastName} details`}
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
        drag="y"
        dragControls={dragControls}
        dragListener={false}
        dragConstraints={{ top: 0 }}
        dragSnapToOrigin
        onDragEnd={(_, info) => {
          const height = sheetRef.current?.offsetHeight ?? 600;
          const threshold = height * DRAG_DISMISS_RATIO;
          if (info.offset.y > threshold || info.velocity.y > DRAG_DISMISS_VELOCITY) {
            onClose();
          }
        }}
        onClick={e => e.stopPropagation()}
      >
        <div
          className="p-drawer-handle"
          role="button"
          aria-label="Drag down to dismiss"
          onPointerDown={(e) => dragControls.start(e)}
          style={{ touchAction: 'none', cursor: 'grab' }}
        />

        {/* Header — identity + state pills. State pills replace the old
            mid-drawer STATE block; they're always-visible and live here so
            the stew sees current state at a glance alongside the name.
            Old italic "{State} · onboard" subtext removed — the filled pill
            already communicates the state. */}
        <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start' }}>
          <div className="p-drawer-avatar">
            {imgSrc
              ? <img src={imgSrc} alt={`${firstName} ${lastName}`} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
              : initials
            }
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            {role && <div className="p-caps-sm" style={{ marginBottom: 4 }}>{role}</div>}
            <div className="p-drawer-name">
              {firstName} <em>{lastName}.</em>
            </div>
            <div className="p-drawer-state-pills" role="group" aria-label="Guest state">
              {STATE_PILLS.map(s => {
                const isActive = s === localState;
                return (
                  <button
                    key={s}
                    type="button"
                    className={`p-pill-state${isActive ? ' active' : ''}`}
                    onClick={() => handleStateChange(s)}
                    aria-pressed={isActive}
                    aria-label={`Mark as ${s}`}
                  >
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                );
              })}
            </div>
            {ashoreFormOpen && localState === 'ashore' && (
              <div className="p-drawer-ashore-form" role="group" aria-label="Ashore context">
                <label className="p-drawer-ashore-field">
                  <span className="p-drawer-ashore-label">Off to</span>
                  <input
                    type="text"
                    className="p-drawer-ashore-input"
                    placeholder="Where to?"
                    value={ashoreDestination}
                    onChange={e => setAshoreDestination(e.target.value)}
                    aria-label="Destination"
                  />
                </label>
                <label className="p-drawer-ashore-field">
                  <span className="p-drawer-ashore-label">Back at</span>
                  {/* Plain text input forced to 24h. Native <input type="time">
                      honours OS locale — US locales show AM/PM, no reliable
                      way to force 24h from HTML. Stew/yacht context is
                      universally 24h, so a numeric text input with a clear
                      HH:MM pattern is both consistent and guaranteed. */}
                  <input
                    type="text"
                    inputMode="numeric"
                    className="p-drawer-ashore-input"
                    placeholder="21:30"
                    pattern="^\d{1,2}:\d{2}$"
                    maxLength={5}
                    value={ashoreReturningAt}
                    onChange={e => setAshoreReturningAt(e.target.value)}
                    aria-label="Returning at, 24-hour HH:MM"
                  />
                </label>
                <div className="p-drawer-ashore-actions">
                  <button type="button" className="p-btn primary" onClick={handleAshoreSave}>
                    Save
                  </button>
                  <button type="button" className="p-drawer-ashore-cancel" onClick={handleAshoreCancel}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
          <button
            className="p-btn outline" style={{ flexShrink: 0 }}
            onClick={onClose}
            aria-label="Close guest details"
          >
            <X size={14} />
          </button>
        </div>
        <hr className="p-drawer-header-divider" />

        {/* Allergies & Medical — top priority block, first thing visible
            after the guest header. Hidden entirely when both fields empty;
            we deliberately do NOT render a "no allergies" placeholder. */}
        <DrawerAllergiesBlock
          allergies={guest.allergies}
          healthConditions={guest.health_conditions}
        />

        {/* RIGHT NOW · context-aware strip for the current service moment.
            Renders above State/Mood (read-first, like Allergies) and above
            the full At-a-glance list. Self-hides when the guest is ashore,
            when the effective moment's rows have no data, or when the
            sleep-override places them in an empty window. */}
        <DrawerRightNow guest={guest} data={drawerPrefs} />

        {/* Mood block */}
        <div className="p-drawer-section">
          <div className="p-drawer-section-head">
            <div className="p-caps">Mood · right now</div>
            <button
              className="p-card-link"
              onClick={() => setMoodExpanded(v => !v)}
              aria-expanded={moodExpanded}
            >
              {moodExpanded ? 'Less ↑' : 'Full palette →'}
            </button>
          </div>
          <motion.div layout style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <AnimatePresence>
              {(moodExpanded ? ALL_MOODS : QUICK_MOODS).map(m => (
                <motion.button
                  key={m.key}
                  layout
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  whileTap={{ scale: 0.96 }}
                  transition={{ duration: 0.15 }}
                  className={`p-pill-mood${localMood === m.key ? ' active' : ''}`}
                  onClick={() => handleMoodChange(m.key)}
                  aria-label={m.label}
                  aria-pressed={localMood === m.key}
                >
                  <span role="img" aria-hidden="true">{m.emoji}</span>
                  <span>{m.label}</span>
                </motion.button>
              ))}
            </AnimatePresence>
          </motion.div>
        </div>

        {/* At a glance — 6 curated rows sourced directly from
            guest_preferences via useGuestDrawerPrefs. The prose
            rendering of guests.preferences_summary that used to live
            here has been removed: the structured view is the single
            source of truth for drawer body content. preferences_summary
            stays in the DB for export / search / the full preferences
            page, but is no longer read here. */}
        <div className="p-drawer-section">
          <div className="p-drawer-section-head">
            <div className="p-caps">At a glance</div>
            <button className="p-card-link" onClick={goToPreferences} aria-label="Open full preferences">
              Full preferences →
            </button>
          </div>
          <DrawerAtAGlance
            data={drawerPrefs}
            loading={prefsLoading}
            error={prefsError}
          />
        </div>

        {/* Allergies & diet previously rendered here — moved to the
            <DrawerAllergiesBlock /> at the top of the drawer body so it's
            the first thing visible after the guest header. */}

        {/* Today's notes */}
        <div className="p-drawer-section">
          <div className="p-drawer-section-head">
            <div className="p-caps">Today's notes · {today}</div>
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: 10, color: 'var(--ink-tertiary)' }}>
              {notesLoading ? '…' : `${notes.length} entr${notes.length === 1 ? 'y' : 'ies'}`}
            </span>
          </div>

          {notes.map(note => (
            <div key={note.id} className="p-note-entry">
              <div className="p-note-text">{note.content}</div>
              <div className="p-note-meta">
                <span>{formatDistanceToNow(new Date(note.created_at), { addSuffix: true })}</span>
                {note.status && <span className={note.status === 'done' ? 'p-note-status-done' : ''}>{note.status}</span>}
              </div>
            </div>
          ))}

          {addingNote ? (
            <div style={{ marginTop: 8 }}>
              <textarea
                autoFocus
                value={noteInput}
                onChange={e => setNoteInput(e.target.value)}
                placeholder="Add a note…"
                rows={2}
                style={{
                  width: '100%', padding: '9px 12px',
                  border: '0.5px solid var(--p-border)',
                  borderRadius: 8, resize: 'vertical',
                  fontFamily: 'var(--font-sans)', fontSize: 13,
                  color: 'var(--ink)', background: 'var(--bg-card)',
                }}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAddNote(); } }}
              />
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <button className="p-btn primary" onClick={handleAddNote} disabled={submitting}>
                  {submitting ? 'Saving…' : 'Save'}
                </button>
                <button className="p-btn outline" onClick={() => { setAddingNote(false); setNoteInput(''); }}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button className="p-add-note-btn" onClick={() => setAddingNote(true)}>
              + add note · or hold to dictate
            </button>
          )}
        </div>

        {/* Footer */}
        <div className="p-drawer-footer">
          <button className="p-btn primary" style={{ padding: '11px 14px', borderRadius: 10 }}
            onClick={goToPreferences} aria-label="Open full preferences">
            Full preferences →
          </button>
          <button className="p-btn primary" style={{ padding: '11px 14px', borderRadius: 10 }}
            onClick={goToHistory} aria-label="View guest history">
            View history →
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
