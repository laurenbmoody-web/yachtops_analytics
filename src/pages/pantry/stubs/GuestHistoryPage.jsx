import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import Header from '../../../components/navigation/Header';
import StandbyLayoutHeader from '../widgets/StandbyLayoutHeader';
import { supabase } from '../../../lib/supabaseClient';
import '../pantry.css';

const FILTER_TABS = [
  { key: 'all',         label: 'All'           },
  { key: 'preferences', label: 'Preferences'   },
  { key: 'state',       label: 'State changes' },
  { key: 'moods',       label: 'Moods'         },
  { key: 'notes',       label: 'Notes'         },
  { key: 'meals',       label: 'Meals'         },
  { key: 'allergies',   label: 'Allergies'     },
];

function formatEventTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// Classify a history_log entry by inspecting its `changes` keys.
function classifyHistoryEntry(entry) {
  const keys = entry?.changes ? Object.keys(entry.changes) : [];
  if (keys.some(k => k === 'preferences_summary' || k.startsWith('preference'))) return 'preferences';
  if (keys.some(k => k === 'current_state' || k === 'ashore_context')) return 'state';
  if (keys.some(k => k === 'current_mood' || k === 'current_mood_emoji')) return 'moods';
  if (keys.some(k => k === 'allergies' || k === 'health_conditions'))    return 'allergies';
  return 'profile'; // generic create/update, no specific category
}

// Render a readable headline from the structured `changes` payload. Falls back
// to `entry.message` (legacy) or a capitalised action word.
function titleFor(entry) {
  if (entry?.message) return entry.message;
  const { action, changes } = entry ?? {};
  if (action === 'mood_changed' && changes?.current_mood) {
    const { from, to } = changes.current_mood;
    if (!from && to) return `Mood set to ${to}`;
    if (from && !to) return 'Mood cleared';
    return `Mood changed · ${from} → ${to}`;
  }
  if (action === 'state_changed' && changes?.current_state) {
    const { from, to } = changes.current_state;
    return `State changed · ${from} → ${to}`;
  }
  if (action === 'ashore_set') {
    const ctx = changes?.ashore_context?.to;
    const dest = ctx?.destination;
    return dest ? `Marked ashore · ${dest}` : 'Marked ashore';
  }
  if (action === 'ashore_cleared') return 'Ashore context cleared';
  if (action === 'allergies_changed')         return 'Allergies updated';
  if (action === 'health_conditions_changed') return 'Health conditions updated';
  if (action === 'preferences_changed')       return 'Preferences updated';
  return action ? `${action[0].toUpperCase()}${action.slice(1).replace(/_/g, ' ')}` : 'Updated';
}

export default function GuestHistoryPage() {
  const { id } = useParams();
  const [guest, setGuest]       = useState(null);
  const [events, setEvents]     = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [activeFilter, setActiveFilter] = useState('all');

  useEffect(() => {
    const prev = document.body.style.background;
    document.body.style.background = '#F5F1EA';
    return () => { document.body.style.background = prev; };
  }, []);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [guestRes, dayNotesRes, stewNotesRes] = await Promise.all([
          supabase.from('guests')
            .select('id, first_name, last_name, history_log')
            .eq('id', id)
            .single(),
          supabase.from('guest_day_notes')
            .select('id, content, author_id, status, created_at, note_date')
            .eq('guest_id', id)
            .order('created_at', { ascending: false }),
          supabase.from('stew_notes')
            .select('id, content, author_id, status, source, created_at, saved_to_preferences')
            .eq('related_guest_id', id)
            .order('created_at', { ascending: false }),
        ]);

        if (guestRes.error)     throw guestRes.error;
        if (dayNotesRes.error)  throw dayNotesRes.error;
        if (stewNotesRes.error) throw stewNotesRes.error;

        const guestRow = guestRes.data;
        const dayNotes = dayNotesRes.data ?? [];
        const stewNotes = stewNotesRes.data ?? [];
        const historyLog = Array.isArray(guestRow?.history_log) ? guestRow.history_log : [];

        // Collect author IDs to resolve names in one query
        const authorIds = new Set();
        dayNotes.forEach(n => n.author_id && authorIds.add(n.author_id));
        stewNotes.forEach(n => n.author_id && authorIds.add(n.author_id));
        historyLog.forEach(h => h?.actorUserId && authorIds.add(h.actorUserId));

        let authorMap = {};
        if (authorIds.size > 0) {
          const { data: profiles } = await supabase
            .from('profiles')
            .select('id, full_name')
            .in('id', Array.from(authorIds));
          authorMap = Object.fromEntries((profiles ?? []).map(p => [p.id, p.full_name]));
        }
        const resolveAuthor = (uid) => (uid && authorMap[uid]) ? authorMap[uid] : 'Interior team';

        const merged = [];

        for (const h of historyLog) {
          merged.push({
            id: `h-${h.id}`,
            at: h.at,
            type: classifyHistoryEntry(h),
            title: titleFor(h),
            subtitle: null,
            author: h.actorName || resolveAuthor(h.actorUserId),
            source: null,
          });
        }

        for (const n of dayNotes) {
          merged.push({
            id: `d-${n.id}`,
            at: n.created_at,
            type: 'notes',
            title: n.content,
            subtitle: n.status ? `Day note · ${n.status}` : 'Day note',
            author: resolveAuthor(n.author_id),
            source: null,
          });
        }

        for (const n of stewNotes) {
          merged.push({
            id: `s-${n.id}`,
            at: n.created_at,
            type: 'notes',
            title: n.content,
            subtitle: n.saved_to_preferences
              ? `Stew note · saved to preferences`
              : (n.status ? `Stew note · ${n.status}` : 'Stew note'),
            author: resolveAuthor(n.author_id),
            source: n.source,
          });
        }

        merged.sort((a, b) => new Date(b.at) - new Date(a.at));

        if (!cancelled) {
          setGuest(guestRow);
          setEvents(merged);
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [id]);

  const displayName = guest ? `${guest.first_name ?? ''} ${guest.last_name ?? ''}`.trim() : '';
  const firstName   = guest?.first_name ?? '';

  const visibleEvents = useMemo(() => {
    if (activeFilter === 'all') return events;
    return events.filter(e => e.type === activeFilter);
  }, [events, activeFilter]);

  return (
    <>
      <Header />
      <div id="pantry-root" className="pantry-page">
        <StandbyLayoutHeader
          title="History"
          subtitle={firstName ? `Everything logged about ${firstName}.` : 'Guest history.'}
          backTo="/pantry/standby"
        />

        <div className="p-card top-navy">
          {/* Filter tabs */}
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: 6,
            marginBottom: 16,
            paddingBottom: 12,
            borderBottom: '0.5px solid var(--p-border)',
          }}>
            {FILTER_TABS.map(tab => (
              <button
                key={tab.key}
                className={`p-pill-mood${activeFilter === tab.key ? ' active' : ''}`}
                onClick={() => setActiveFilter(tab.key)}
                aria-pressed={activeFilter === tab.key}
              >
                <span>{tab.label}</span>
              </button>
            ))}
          </div>

          {loading && (
            <div style={{ color: 'var(--ink-tertiary)', fontSize: 13 }}>Loading…</div>
          )}
          {error && (
            <div style={{ color: 'var(--accent)', fontSize: 12 }}>Failed: {error}</div>
          )}

          {!loading && !error && visibleEvents.length === 0 && (
            <p style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: 14, color: 'var(--ink-muted)' }}>
              {activeFilter === 'all'
                ? `No history logged yet${displayName ? ` for ${displayName}` : ''}.`
                : `No ${FILTER_TABS.find(t => t.key === activeFilter)?.label.toLowerCase()} events logged yet.`}
            </p>
          )}

          {!loading && !error && visibleEvents.length > 0 && (
            <div className="p-timeline">
              <div className="p-timeline-rule" />
              {visibleEvents.map(ev => (
                <div key={ev.id} className="p-timeline-entry">
                  <div className="p-tl-time">{formatEventTime(ev.at)}</div>
                  <div className="p-tl-dot" />
                  <div className="p-tl-title">{ev.title}</div>
                  <div className="p-tl-sub">
                    {ev.author}
                    {ev.subtitle && <> · {ev.subtitle}</>}
                    {ev.source && <> · {ev.source}</>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
