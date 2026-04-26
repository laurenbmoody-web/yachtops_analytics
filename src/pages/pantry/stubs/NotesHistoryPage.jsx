import React, { useEffect, useMemo, useState } from 'react';
import { Mic, Check, Pencil, Trash2, Sparkles, Keyboard, Search as SearchIcon, X } from 'lucide-react';
import Header from '../../../components/navigation/Header';
import StandbyLayoutHeader from '../widgets/StandbyLayoutHeader';
import { supabase } from '../../../lib/supabaseClient';
import { useStewNotes } from '../hooks/useStewNotes';
import { useGuests } from '../hooks/useGuests';
import { useAuth } from '../../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import '../pantry.css';

const FILTER_TABS = [
  { key: 'all',       label: 'All'       },
  { key: 'pending',   label: 'Pending'   },
  { key: 'done',      label: 'Done'      },
  { key: 'by_me',     label: 'By me'     },
  { key: 'by_others', label: 'By others' },
  { key: 'voice',     label: 'Voice'     },
  { key: 'typed',     label: 'Typed'     },
];

const PAGE_STEP = 50;

function startOfLocalDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function groupLabelFor(created) {
  const now = startOfLocalDay();
  const today = now.getTime();
  const oneDay = 86400_000;
  const noteDay = startOfLocalDay(new Date(created)).getTime();

  if (noteDay === today)              return 'Today';
  if (noteDay === today - oneDay)     return 'Yesterday';
  if (noteDay >= today - 6 * oneDay)  return 'This week';
  if (noteDay >= today - 13 * oneDay) return 'Last week';
  return 'Earlier';
}

const GROUP_ORDER = ['Today', 'Yesterday', 'This week', 'Last week', 'Earlier'];

function SourceIcon({ source }) {
  if (source === 'voice') return <Mic size={11} aria-label="voice" />;
  if (source === 'auto')  return <Sparkles size={11} aria-label="auto" />;
  return <Keyboard size={11} aria-label="typed" />;
}

const CONVERT_TYPE_LABEL = {
  preference: 'a preference for',
  day_note:   'a day note for',
};

function NoteRow({
  note, authorName, guests, currentUserId,
  onToggleDone, onStartEdit, onDelete,
  onConvertToPreference, onConvertToDayNote,
  onOpenGuest,
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing]   = useState(false);
  const [editValue, setEditValue] = useState(note.content);
  // convert.stage: 'closed' | 'menu' | 'picker'
  // convert.type: 'preference' | 'day_note' (only set when stage !== 'closed')
  const [convert, setConvert] = useState({ stage: 'closed', type: null });
  const [pickedGuestId, setPickedGuestId] = useState(note.related_guest_id ?? '');

  const isDone    = note.status === 'done' || note.saved_to_preferences;
  const isPending = note.status === 'pending' && !note.saved_to_preferences;
  const relatedGuest = note.related_guest_id
    ? guests.find(g => g.id === note.related_guest_id)
    : null;

  const handleSaveEdit = async () => {
    if (!editValue.trim() || editValue.trim() === note.content) { setEditing(false); return; }
    await onStartEdit(note.id, editValue.trim());
    setEditing(false);
  };

  const runConversion = async (type, guestId) => {
    if (type === 'preference') await onConvertToPreference(note.id, guestId);
    if (type === 'day_note')   await onConvertToDayNote(note.id, guestId);
  };

  const handlePickType = async (type) => {
    if (note.related_guest_id) {
      await runConversion(type, note.related_guest_id);
      setConvert({ stage: 'closed', type: null });
    } else {
      setConvert({ stage: 'picker', type });
    }
  };

  const handleConfirmPicked = async () => {
    if (!pickedGuestId || !convert.type) return;
    await runConversion(convert.type, pickedGuestId);
    setConvert({ stage: 'closed', type: null });
  };

  return (
    <div className="p-note-entry">
      {!editing ? (
        <div
          role="button"
          tabIndex={0}
          onClick={() => setExpanded(e => !e)}
          onKeyDown={e => e.key === 'Enter' && setExpanded(ex => !ex)}
          aria-expanded={expanded}
        >
          <div className="p-note-text"
            style={!expanded ? {
              display: '-webkit-box', WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical', overflow: 'hidden',
            } : {}}>
            {note.content}
          </div>
          <div className="p-note-meta">
            <span title={new Date(note.created_at).toLocaleString()}>
              {formatDistanceToNow(new Date(note.created_at), { addSuffix: true })}
            </span>
            <span>· {authorName}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              · <SourceIcon source={note.source} />
            </span>
            {note.saved_to_preferences && (
              <span style={{ color: 'var(--confirm)' }}>· saved to preferences</span>
            )}
            {!note.saved_to_preferences && note.status && (
              <span className={note.status === 'done' ? 'p-note-status-done' : ''}>
                · {note.status === 'done' ? 'done ✓' : note.status}
              </span>
            )}
            {relatedGuest && (
              <button
                className="p-pill-mood"
                style={{ padding: '2px 8px', fontSize: 11 }}
                onClick={(e) => { e.stopPropagation(); onOpenGuest(relatedGuest.id); }}
                aria-label={`Open ${relatedGuest.first_name}'s drawer`}
              >
                {relatedGuest.first_name}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div>
          <textarea
            autoFocus
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            rows={3}
            style={{
              width: '100%', padding: '9px 12px',
              border: '0.5px solid var(--p-border)',
              borderRadius: 8, resize: 'vertical',
              fontFamily: 'var(--font-sans)', fontSize: 13,
              color: 'var(--ink)', background: 'var(--bg-card)',
            }}
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <button className="p-btn primary" onClick={handleSaveEdit}>Save</button>
            <button className="p-btn outline" onClick={() => { setEditing(false); setEditValue(note.content); }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {expanded && !editing && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
          {!isDone && (
            <button className="p-btn outline" onClick={() => onToggleDone(note.id, 'done')}
              aria-label="Mark note as done">
              <Check size={12} style={{ marginRight: 4 }} />Mark done
            </button>
          )}
          {isDone && !note.saved_to_preferences && (
            <button className="p-btn outline" onClick={() => onToggleDone(note.id, 'pending')}
              aria-label="Mark note as pending">
              Reopen
            </button>
          )}
          <button className="p-btn outline" onClick={() => setEditing(true)} aria-label="Edit note">
            <Pencil size={12} style={{ marginRight: 4 }} />Edit
          </button>
          {!note.saved_to_preferences && (
            <button className="p-btn outline"
              onClick={() => setConvert({ stage: 'menu', type: null })}
              aria-label="Convert this note to a preference, day note, inventory update, or schedule event">
              Convert to… →
            </button>
          )}
          <button className="p-btn outline" onClick={() => onDelete(note.id)}
            style={{ color: 'var(--accent)', borderColor: 'var(--accent-soft)' }}
            aria-label="Delete note">
            <Trash2 size={12} style={{ marginRight: 4 }} />Delete
          </button>
        </div>
      )}

      {convert.stage === 'menu' && (
        <div style={{
          marginTop: 10, padding: 10,
          background: 'var(--bg-surface)', borderRadius: 8,
          border: '0.5px solid var(--p-border)',
        }}>
          <div className="p-caps" style={{ marginBottom: 8 }}>Convert this note to…</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button className="p-btn outline" style={{ justifyContent: 'flex-start', textAlign: 'left' }}
              onClick={() => handlePickType('preference')}>
              Preference <span style={{ color: 'var(--ink-muted)' }}>· for a guest</span>
            </button>
            <button className="p-btn outline" style={{ justifyContent: 'flex-start', textAlign: 'left' }}
              onClick={() => handlePickType('day_note')}>
              Day note <span style={{ color: 'var(--ink-muted)' }}>· for a guest today</span>
            </button>
            <button className="p-btn outline" disabled
              style={{ justifyContent: 'flex-start', textAlign: 'left', opacity: 0.5, cursor: 'not-allowed' }}
              title="Coming soon">
              Inventory update <span style={{ color: 'var(--ink-muted)' }}>· coming soon</span>
            </button>
            <button className="p-btn outline" disabled
              style={{ justifyContent: 'flex-start', textAlign: 'left', opacity: 0.5, cursor: 'not-allowed' }}
              title="Coming soon">
              Schedule event <span style={{ color: 'var(--ink-muted)' }}>· coming soon</span>
            </button>
            <button className="p-btn ghost" style={{ justifyContent: 'flex-start', textAlign: 'left' }}
              onClick={() => setConvert({ stage: 'closed', type: null })}>
              Keep as note
            </button>
          </div>
        </div>
      )}

      {convert.stage === 'picker' && (
        <div style={{
          marginTop: 10, padding: 10,
          background: 'var(--bg-surface)', borderRadius: 8,
          border: '0.5px solid var(--p-border)',
        }}>
          <div className="p-caps" style={{ marginBottom: 6 }}>
            Pick a guest for {CONVERT_TYPE_LABEL[convert.type]}
          </div>
          <select
            value={pickedGuestId}
            onChange={e => setPickedGuestId(e.target.value)}
            style={{
              width: '100%', padding: '8px 10px',
              border: '0.5px solid var(--p-border)', borderRadius: 6,
              fontFamily: 'var(--font-sans)', fontSize: 13, background: 'var(--bg-card)',
            }}
          >
            <option value="">— pick a guest —</option>
            {guests.map(g => (
              <option key={g.id} value={g.id}>
                {g.first_name} {g.last_name}
              </option>
            ))}
          </select>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button className="p-btn primary" onClick={handleConfirmPicked} disabled={!pickedGuestId}>
              Convert
            </button>
            <button className="p-btn outline"
              onClick={() => setConvert({ stage: 'menu', type: null })}>
              Back
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function NotesHistoryPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [limit, setLimit] = useState(PAGE_STEP);
  const { notes, loading, error, addNote, updateContent, updateStatus, deleteNote, convertToPreference, convertToDayNote } =
    useStewNotes({ limit });
  const { guests } = useGuests();

  const [authorMap, setAuthorMap] = useState({});
  const [newNote, setNewNote]     = useState('');
  const [adding, setAdding]       = useState(false);
  const [search, setSearch]       = useState('');
  const [filter, setFilter]       = useState('all');

  useEffect(() => {
    const prev = document.body.style.background;
    document.body.style.background = '#F5F1EA';
    return () => { document.body.style.background = prev; };
  }, []);

  // Resolve author names once per notes batch
  useEffect(() => {
    const ids = Array.from(new Set(notes.map(n => n.author_id).filter(Boolean)));
    if (ids.length === 0) { setAuthorMap({}); return; }
    supabase.from('profiles').select('id, full_name').in('id', ids).then(({ data }) => {
      setAuthorMap(Object.fromEntries((data ?? []).map(p => [p.id, p.full_name])));
    });
  }, [notes]);

  const resolveAuthor = (uid) => (uid && authorMap[uid]) ? authorMap[uid] : 'Interior team';

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return notes.filter(n => {
      if (q && !(n.content ?? '').toLowerCase().includes(q)) return false;
      switch (filter) {
        case 'pending':   return n.status === 'pending' && !n.saved_to_preferences;
        case 'done':      return n.status === 'done' || n.saved_to_preferences;
        case 'by_me':     return n.author_id === user?.id;
        case 'by_others': return n.author_id && n.author_id !== user?.id;
        case 'voice':     return n.source === 'voice';
        case 'typed':     return n.source === 'typed';
        default:          return true;
      }
    });
  }, [notes, search, filter, user]);

  const grouped = useMemo(() => {
    const buckets = {};
    for (const n of filtered) {
      const key = groupLabelFor(n.created_at);
      (buckets[key] ||= []).push(n);
    }
    return GROUP_ORDER
      .filter(k => buckets[k]?.length)
      .map(k => ({ label: k, notes: buckets[k] }));
  }, [filtered]);

  const handleAdd = async () => {
    if (!newNote.trim()) return;
    setAdding(true);
    try { await addNote(newNote.trim(), { source: 'typed', status: 'pending' }); setNewNote(''); }
    catch {/* surfaced by hook error */}
    finally { setAdding(false); }
  };

  const handleOpenGuest = (guestId) => {
    navigate('/pantry/standby', { state: { openDrawerForGuestId: guestId } });
  };

  return (
    <>
      <Header />
      <div id="pantry-root" className="pantry-page">
        <StandbyLayoutHeader
          title="Notes"
          subtitle="What the team is tracking, today and prior."
          backTo="/pantry/standby"
        />

        {/* Inline add */}
        <div className="p-card top-navy" style={{ marginBottom: 12 }}>
          <div className="p-caps" style={{ marginBottom: 8 }}>Add a note</div>
          <textarea
            value={newNote}
            onChange={e => setNewNote(e.target.value)}
            placeholder="Type a note… or hold the mic on the Standby page to dictate."
            rows={2}
            style={{
              width: '100%', padding: '10px 12px',
              border: '0.5px solid var(--p-border)',
              borderRadius: 8, resize: 'vertical',
              fontFamily: 'var(--font-sans)', fontSize: 13,
              color: 'var(--ink)', background: 'var(--bg-card)',
            }}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleAdd(); } }}
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
            <button className="p-btn primary" onClick={handleAdd} disabled={adding || !newNote.trim()}>
              {adding ? 'Saving…' : 'Save note'}
            </button>
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: 10, color: 'var(--ink-tertiary)', marginLeft: 4 }}>
              or ⌘/Ctrl + Enter
            </span>
            <span style={{ flex: 1 }} />
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              fontFamily: 'var(--font-sans)', fontSize: 10, color: 'var(--ink-tertiary)',
            }}>
              <Mic size={11} /> voice dictation on Standby
            </span>
          </div>
        </div>

        {/* Search + filter */}
        <div className="p-card top-navy" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <SearchIcon size={14} style={{ color: 'var(--ink-muted)', flexShrink: 0 }} />
            <input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search note content…"
              style={{
                flex: 1, padding: '8px 10px',
                border: '0.5px solid var(--p-border)',
                borderRadius: 6, background: 'var(--bg-card)',
                fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--ink)',
              }}
            />
            {search && (
              <button className="p-btn ghost" onClick={() => setSearch('')} aria-label="Clear search">
                <X size={12} />
              </button>
            )}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {FILTER_TABS.map(tab => (
              <button
                key={tab.key}
                className={`p-pill-mood${filter === tab.key ? ' active' : ''}`}
                onClick={() => setFilter(tab.key)}
                aria-pressed={filter === tab.key}
              >
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Notes list */}
        <div className="p-card top-navy">
          {loading && (
            <div style={{ color: 'var(--ink-tertiary)', fontSize: 13 }}>Loading…</div>
          )}
          {error && (
            <div style={{ color: 'var(--accent)', fontSize: 12 }}>Failed: {error}</div>
          )}
          {!loading && !error && grouped.length === 0 && (
            <p style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: 14, color: 'var(--ink-muted)' }}>
              {search || filter !== 'all'
                ? 'No notes match the current filters.'
                : 'No notes on record yet. Add one above.'}
            </p>
          )}

          {!loading && !error && grouped.map(group => (
            <div key={group.label} style={{ marginBottom: 18 }}>
              <div className="p-caps" style={{ marginBottom: 8 }}>{group.label}</div>
              {group.notes.map(note => (
                <NoteRow
                  key={note.id}
                  note={note}
                  authorName={resolveAuthor(note.author_id)}
                  guests={guests}
                  currentUserId={user?.id}
                  onToggleDone={updateStatus}
                  onStartEdit={updateContent}
                  onDelete={deleteNote}
                  onConvertToPreference={convertToPreference}
                  onConvertToDayNote={convertToDayNote}
                  onOpenGuest={handleOpenGuest}
                />
              ))}
            </div>
          ))}

          {/* Load more */}
          {!loading && !error && notes.length >= limit && (
            <div style={{ marginTop: 12, textAlign: 'center' }}>
              <button className="p-btn outline" onClick={() => setLimit(l => l + PAGE_STEP)}>
                Load more
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
