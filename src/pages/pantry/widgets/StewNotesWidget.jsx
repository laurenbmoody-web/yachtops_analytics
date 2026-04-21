import React, { useState } from 'react';
import { useStewNotes } from '../hooks/useStewNotes';
import { formatDistanceToNow } from 'date-fns';

export default function StewNotesWidget() {
  const { notes, loading, error, addNote } = useStewNotes({ limit: 3 });
  const [expanded, setExpanded] = useState(null);

  return (
    <div className="p-card top-navy">
      <div className="p-card-head">
        <div>
          <div className="p-caps">
            {loading ? '…' : `${notes.length} note${notes.length !== 1 ? 's' : ''}`} · newest first
          </div>
          <div className="p-card-headline">
            Worth <em>noting</em>.
          </div>
        </div>
        <button className="p-card-link" style={{ color: 'var(--brass)' }}
          aria-label="View all stew notes">
          View all →
        </button>
      </div>

      {loading && (
        <div style={{ color: 'var(--ink-tertiary)', fontSize: 13 }}>Loading…</div>
      )}
      {error && (
        <div style={{ color: 'var(--accent)', fontSize: 12 }}>Failed to load: {error}</div>
      )}

      {!loading && !error && notes.length === 0 && (
        <p style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: 14, color: 'var(--ink-muted)' }}>
          No notes yet. Add one below or hold to dictate.
        </p>
      )}

      {!loading && !error && notes.map(note => (
        <div key={note.id} className="p-note-entry"
          role="button" tabIndex={0}
          onClick={() => setExpanded(expanded === note.id ? null : note.id)}
          onKeyDown={e => e.key === 'Enter' && setExpanded(expanded === note.id ? null : note.id)}
          aria-expanded={expanded === note.id}
        >
          <div className="p-note-text"
            style={expanded !== note.id ? {
              display: '-webkit-box', WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical', overflow: 'hidden',
            } : {}}>
            {note.content}
          </div>
          <div className="p-note-meta">
            <span>{formatDistanceToNow(new Date(note.created_at), { addSuffix: true })}</span>
            {note.status && (
              <span className={note.status === 'done' ? 'p-note-status-done' : ''}>
                {note.status === 'done' ? 'done ✓' : note.status}
              </span>
            )}
            {note.saved_to_preferences && (
              <span style={{ color: 'var(--confirm)' }}>saved to preferences</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
