import React, { useEffect, useMemo, useState } from 'react';
import {formatTime, dateLocale } from '../../utils/dateFormat';
import { useNavigate } from 'react-router-dom';
import Icon from '../../components/AppIcon';
import Header from '../../components/navigation/Header';
import { getRecentLaundryActivity } from '../laundry-management-dashboard/utils/laundryStorage';
import '../../styles/editorial.css';
import '../laundry-management-dashboard/laundry.css';

const EVENT_LABEL = { created: 'Added', ready: 'Marked ready', delivered: 'Delivered', reopened: 'Reopened', edited: 'Edited', updated: 'Updated' };
const EVENT_DOT = { created: '#B7791F', ready: '#2F6E8F', delivered: '#2F7D5A', reopened: '#8B8478', edited: '#8B8478', updated: '#8B8478' };
const ownerKind = (t) => { const k = (t || 'unknown').toLowerCase(); return k === 'guest' ? 'guest' : k === 'crew' ? 'crew' : 'unknown'; };
const fmtClock = (iso) => (iso ? formatTime(iso) : '');
const dayKey = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const dayLabel = (iso) => {
  const d = new Date(iso);
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return d.toLocaleDateString(dateLocale(), { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
};

const LaundryHistoryView = () => {
  const navigate = useNavigate();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // all | delivered

  useEffect(() => {
    let cancelled = false;
    getRecentLaundryActivity(300)
      .then((rows) => { if (!cancelled) setEvents(rows); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const shown = useMemo(() => (filter === 'delivered' ? events.filter((e) => e.action === 'delivered') : events), [events, filter]);

  const groups = useMemo(() => {
    const map = new Map();
    for (const e of shown) {
      const k = dayKey(e.at);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(e);
    }
    return [...map.entries()].map(([k, list]) => ({ k, label: dayLabel(list[0].at), list }));
  }, [shown]);

  const photoOf = (it) => (Array.isArray(it?.photos) && it.photos.length ? it.photos[0] : (it?.photo || null));

  return (
    <>
      <Header />
      <div className="lm-page">
        <div className="lm-wrap">
          <button type="button" className="lm-back" onClick={() => navigate('/laundry-management-dashboard')}>
            <Icon name="ArrowLeft" size={16} /> Back to laundry
          </button>

          <div className="lm-header">
            <p className="editorial-meta">
              <span className="dot">●</span>
              <span>Housekeeping</span>
              <span className="bar" />
              <span className="muted">Activity log</span>
              <span className="bar" />
              <span className="muted">{events.length} event{events.length === 1 ? '' : 's'}</span>
            </p>
            <div className="lm-titlerow">
              <h1 className="editorial-greeting">
                LAUNDRY<span className="period">,</span> <em>history</em><span className="period">.</span>
              </h1>
              <div className="lm-seg" role="tablist" aria-label="Filter" style={{ marginLeft: 'auto' }}>
                <button type="button" className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>All activity</button>
                <button type="button" className={filter === 'delivered' ? 'on' : ''} onClick={() => setFilter('delivered')}>Delivered</button>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="lm-empty" role="status" style={{ paddingTop: 40 }}>
              <div className="lm-empty-sub">Loading activity…</div>
            </div>
          ) : groups.length === 0 ? (
            <div className="lm-empty" role="status">
              <Icon name="Clock" size={44} className="lm-empty-ic" />
              <div className="lm-empty-title">No activity yet</div>
              <div className="lm-empty-sub">Every add, status change and edit will appear here — who did it and when.</div>
            </div>
          ) : (
            <div className="hist-feed">
              {groups.map((g) => (
                <div key={g.k} className="hist-day">
                  <div className="hist-dayhead">{g.label}<span className="hist-daycount">{g.list.length}</span></div>
                  {g.list.map((e) => {
                    const it = e.item || {};
                    const kind = ownerKind(it.ownerType);
                    const src = photoOf(it);
                    return (
                      <div className="hist-row" key={e.id}>
                        <span className="hist-thumb">
                          {src ? <img src={src} alt="" /> : <Icon name="Shirt" size={20} className="lr-ph-ic" />}
                        </span>
                        <div className="hist-main">
                          <div className="hist-desc">{it.description || 'Laundry item'}</div>
                          <div className="hist-sub">
                            {kind === 'unknown' ? 'Unknown' : (it.ownerName || '—')}
                            {it.area && <> · {it.area}</>}
                          </div>
                        </div>
                        <div className="hist-act">
                          <span className="hist-dot" style={{ background: EVENT_DOT[e.action] || '#8B8478' }} />
                          <span className="hist-actlbl">{EVENT_LABEL[e.action] || e.action}</span>
                          {e.actorName && <span className="hist-actby">by {e.actorName}</span>}
                        </div>
                        <span className="hist-time">{fmtClock(e.at)}</span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default LaundryHistoryView;
