import React, { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useGuestDayNotes } from '../hooks/useGuestDayNotes';
import { formatDistanceToNow } from 'date-fns';
import { ALL_MOODS, QUICK_MOODS } from '../constants/moods';

const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

function splitPills(text) {
  if (!text) return [];
  return text.split(',').map(s => s.trim()).filter(Boolean);
}

function stateOptions(current) {
  const all = ['awake', 'asleep', 'ashore'];
  return all.map(s => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1), active: s === (current ?? 'awake') }));
}

export default function GuestDrawer({ guest, onClose, onUpdateState, onUpdateMood }) {
  const { notes, loading: notesLoading, addNote } = useGuestDayNotes(guest.id);
  const [moodExpanded, setMoodExpanded] = useState(false);
  const [noteInput, setNoteInput]       = useState('');
  const [addingNote, setAddingNote]     = useState(false);
  const [submitting, setSubmitting]     = useState(false);

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

        {/* Header */}
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
            <div style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: 13, color: 'var(--ink-muted)', marginTop: 2 }}>
              {localState === 'ashore'
                ? `Ashore${guest.ashore_context?.destination ? ` · ${guest.ashore_context.destination}` : ''}`
                : `${localState.charAt(0).toUpperCase() + localState.slice(1)} · onboard`
              }
            </div>
          </div>
          <button
            className="p-btn outline" style={{ flexShrink: 0 }}
            onClick={onClose}
            aria-label="Close guest details"
          >
            <X size={14} />
          </button>
        </div>

        {/* State block */}
        <div className="p-drawer-section">
          <div className="p-caps" style={{ marginBottom: 10 }}>State</div>
          <div className="p-state-grid">
            {stateOptions(localState).map(opt => (
              <motion.div
                key={opt.value}
                className={`p-state-card${opt.active ? ' active' : ''}`}
                role="button"
                tabIndex={0}
                whileTap={{ scale: 0.96 }}
                onClick={() => handleStateChange(opt.value)}
                onKeyDown={e => e.key === 'Enter' && handleStateChange(opt.value)}
                aria-pressed={opt.active}
                aria-label={`Mark as ${opt.label}`}
              >
                <div className="p-caps">{opt.label}</div>
              </motion.div>
            ))}
          </div>
        </div>

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

        {/* At a glance — preferences */}
        <div className="p-drawer-section">
          <div className="p-drawer-section-head">
            <div className="p-caps">At a glance</div>
            <button className="p-card-link" aria-label="Open full preferences">
              Full preferences →
            </button>
          </div>
          <div className="p-surface" style={{ padding: '12px 14px' }}>
            {guest.preferences_summary
              ? <p className="p-prefs-text">{guest.preferences_summary}</p>
              : <p className="p-prefs-empty">
                  No preferences saved yet. Tap 'Full preferences →' to add them, or dictate them with the mic.
                </p>
            }
          </div>
        </div>

        {/* Allergies & diet */}
        {(guest.allergies || guest.health_conditions) && (
          <div className="p-drawer-section">
            <div className="p-caps" style={{ marginBottom: 8 }}>Allergies & diet</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {splitPills(guest.allergies).map((pill, i) => (
                <span key={i} className="p-pill-allergy" aria-label={`Allergy: ${pill}`}>{pill}</span>
              ))}
              {splitPills(guest.health_conditions).map((pill, i) => (
                <span key={i} className="p-pill-diet" aria-label={`Health condition: ${pill}`}>{pill}</span>
              ))}
            </div>
          </div>
        )}

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
            aria-label="Open full preferences">
            Full preferences →
          </button>
          <button className="p-btn primary" style={{ padding: '11px 14px', borderRadius: 10 }}
            aria-label="View guest history">
            View history →
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
