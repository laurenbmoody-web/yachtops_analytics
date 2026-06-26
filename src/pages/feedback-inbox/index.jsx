// Feedback inbox — the product owner's private view of beta feedback.
//
// Reads public.feedback (RLS restricts SELECT to the owner email) newest-first,
// plays back voice notes via signed URLs from the private feedback-audio bucket,
// and lets the owner mark notes read / archived. Anyone else who reaches the
// route sees nothing (the query returns empty under RLS, and we gate the UI too).

import React, { useEffect, useState, useCallback } from 'react';
import Header from '../../components/navigation/Header';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabaseClient';
import './feedback-inbox.css';

const OWNER_EMAIL = 'lauren.moody@hotmail.co.uk';

const fmtDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const fmtMs = (ms) => {
  if (!ms) return '';
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export default function FeedbackInbox() {
  const { user } = useAuth();
  const isOwner = (user?.email || '').toLowerCase() === OWNER_EMAIL;

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('active'); // active | all | voice
  const [audioUrls, setAudioUrls] = useState({}); // id -> signed url

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      ?.from('feedback')
      ?.select('*')
      ?.order('created_at', { ascending: false })
      ?.limit(500) || {};
    setRows(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { if (isOwner) load(); }, [isOwner, load]);

  const ensureAudio = useCallback(async (row) => {
    if (!row.audio_path || audioUrls[row.id]) return;
    const { data } = await supabase
      ?.storage?.from('feedback-audio')
      ?.createSignedUrl(row.audio_path, 60 * 60) || {};
    if (data?.signedUrl) setAudioUrls((p) => ({ ...p, [row.id]: data.signedUrl }));
  }, [audioUrls]);

  const setStatus = async (id, status) => {
    setRows((p) => p.map((r) => (r.id === id ? { ...r, status } : r)));
    await supabase?.from('feedback')?.update({ status })?.eq('id', id);
  };

  if (!isOwner) {
    return (
      <div className="fbi-page">
        <Header />
        <div className="fbi-wrap"><p className="fbi-empty">Not found.</p></div>
      </div>
    );
  }

  const visible = rows.filter((r) => {
    if (filter === 'all') return true;
    if (filter === 'voice') return r.kind === 'voice';
    return r.status !== 'archived'; // active
  });
  const newCount = rows.filter((r) => r.status === 'new').length;

  return (
    <div className="fbi-page">
      <Header />
      <div className="fbi-wrap">
        <div className="fbi-head">
          <div>
            <span className="fbi-kicker">Beta</span>
            <h1 className="fbi-title">Feedback <em>inbox</em></h1>
          </div>
          <div className="fbi-filters">
            {['active', 'voice', 'all'].map((f) => (
              <button
                key={f}
                type="button"
                className={`fbi-chip${filter === f ? ' is-on' : ''}`}
                onClick={() => setFilter(f)}
              >
                {f === 'active' ? 'Active' : f === 'voice' ? 'Voice notes' : 'All'}
              </button>
            ))}
          </div>
        </div>
        <p className="fbi-sub">{newCount} new · {rows.length} total</p>

        {loading ? (
          <p className="fbi-empty">Loading…</p>
        ) : visible.length === 0 ? (
          <p className="fbi-empty">Nothing here yet.</p>
        ) : (
          <ul className="fbi-list">
            {visible.map((r) => (
              <li key={r.id} className={`fbi-item${r.status === 'new' ? ' is-new' : ''}`}>
                <div className="fbi-item-top">
                  <div className="fbi-who">
                    <span className="fbi-name">{r.user_name || 'Unknown'}</span>
                    {r.user_email && <span className="fbi-email">{r.user_email}</span>}
                  </div>
                  <span className="fbi-when">{fmtDate(r.created_at)}</span>
                </div>

                {r.message && <p className="fbi-msg">{r.message}</p>}

                {r.audio_path && (
                  <div className="fbi-audio">
                    {audioUrls[r.id] ? (
                      <audio src={audioUrls[r.id]} controls className="fbi-player" />
                    ) : (
                      <button type="button" className="fbi-load-audio" onClick={() => ensureAudio(r)}>
                        ▶ Load voice note{r.audio_ms ? ` · ${fmtMs(r.audio_ms)}` : ''}
                      </button>
                    )}
                  </div>
                )}

                <div className="fbi-meta">
                  {r.page_title || r.page_path ? (
                    <span className="fbi-tag">{r.page_title || r.page_path}</span>
                  ) : null}
                  {r.viewport && <span className="fbi-tag soft">{r.viewport}</span>}
                  {r.app_version && <span className="fbi-tag soft">v{r.app_version}</span>}
                </div>

                <div className="fbi-item-actions">
                  {r.status === 'new' && (
                    <button type="button" className="fbi-act" onClick={() => setStatus(r.id, 'read')}>Mark read</button>
                  )}
                  {r.status !== 'archived' ? (
                    <button type="button" className="fbi-act ghost" onClick={() => setStatus(r.id, 'archived')}>Archive</button>
                  ) : (
                    <button type="button" className="fbi-act ghost" onClick={() => setStatus(r.id, 'read')}>Restore</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
