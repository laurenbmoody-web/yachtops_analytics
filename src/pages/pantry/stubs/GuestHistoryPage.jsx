import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import Header from '../../../components/navigation/Header';
import StandbyLayoutHeader from '../widgets/StandbyLayoutHeader';
import { supabase } from '../../../lib/supabaseClient';
import '../pantry.css';

function formatEntryTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function GuestHistoryPage() {
  const { id } = useParams();
  const [guest, setGuest]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  useEffect(() => {
    const prev = document.body.style.background;
    document.body.style.background = '#F5F1EA';
    return () => { document.body.style.background = prev; };
  }, []);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    supabase
      .from('guests')
      .select('id, first_name, last_name, history_log')
      .eq('id', id)
      .single()
      .then(({ data, error: err }) => {
        if (err) setError(err.message);
        else setGuest(data);
        setLoading(false);
      });
  }, [id]);

  const displayName = guest ? `${guest.first_name ?? ''} ${guest.last_name ?? ''}`.trim() : '';
  const entries = Array.isArray(guest?.history_log) ? guest.history_log : [];

  return (
    <>
      <Header />
      <div id="pantry-root" className="pantry-page">
        <StandbyLayoutHeader
          title="History"
          subtitle={displayName ? `Everything we've logged about ${displayName}.` : 'Guest history.'}
          backTo="/pantry/standby"
        />

        <div className="p-card top-navy">
          {loading && (
            <div style={{ color: 'var(--ink-tertiary)', fontSize: 13 }}>Loading…</div>
          )}
          {error && (
            <div style={{ color: 'var(--accent)', fontSize: 12 }}>Failed: {error}</div>
          )}
          {!loading && !error && entries.length === 0 && (
            <p style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: 14, color: 'var(--ink-muted)' }}>
              No history entries on record yet.
            </p>
          )}
          {!loading && !error && entries.length > 0 && (
            <div className="p-timeline">
              <div className="p-timeline-rule" />
              {entries.map((ev, i) => (
                <div key={ev.id ?? i} className="p-timeline-entry">
                  <div className="p-tl-time">{formatEntryTime(ev.timestamp ?? ev.created_at)}</div>
                  <div className="p-tl-dot" />
                  <div className="p-tl-title">
                    {ev.content ?? ev.description ?? ev.label ?? 'Event'}
                  </div>
                  {ev.author && <div className="p-tl-sub">{ev.author}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
