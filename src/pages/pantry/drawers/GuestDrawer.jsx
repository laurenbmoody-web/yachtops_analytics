import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useGuestDayNotes } from '../hooks/useGuestDayNotes';
import { useGuestDrawerPrefs } from '../hooks/useGuestDrawerPrefs';
import { formatDistanceToNow } from 'date-fns';
import { ALL_MOODS, QUICK_MOODS } from '../constants/moods';
import DrawerAllergiesBlock from './DrawerAllergiesBlock';
import DrawerAtAGlance from './DrawerAtAGlance';
import DrawerRightNow from './DrawerRightNow';

const DAY_NAMES   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const STATE_PILLS = ['awake', 'asleep', 'ashore'];

export default function GuestDrawer({ guest, onClose, onUpdateState, onUpdateMood }) {
  const navigate = useNavigate();
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
    if (newState === localState) return;
    setLocalState(newState); // optimistic
    onUpdateState?.(guest.id, newState);
  };

  const handleMoodChange = (key, emoji) => {
    setLocalMood(key); // optimistic
    onUpdateMood?.(guest.id, key, emoji);
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
      {/* Backdrop — tap outside to close */}
      <motion.div
        key="backdrop"
        className="p-drawer-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet — stopPropagation prevents backdrop click from firing */}
      <motion.div
        key="sheet"
        className="p-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`${firstName} ${lastName} details`}
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
        onClick={e => e.stopPropagation()}
      >
        <div className="p-drawer-handle" />

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
            {/* TODO(phase-2): ashore context inputs (destination + returning_at)
                appear here when the Ashore pill is selected. handleStateChange
                will then pass an ashoreContext object through to
                onUpdateState, and the pantry/pantry.css row of inputs will
                render conditionally on localState === 'ashore'. */}
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
                  onClick={() => handleMoodChange(m.key, m.emoji)}
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
