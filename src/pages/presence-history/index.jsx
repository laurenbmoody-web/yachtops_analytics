import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Header from '../../components/navigation/Header';
import Icon from '../../components/AppIcon';
import LogoSpinner from '../../components/LogoSpinner';
import { useAuth } from '../../contexts/AuthContext';
import { fetchPresenceEvents, fetchMusterRecords } from '../../services/presenceLog';
import '../../styles/editorial.css';
import './presence-history.css';

const SUBJECT_ICON = { crew: 'UserRound', guest: 'Users', visitor: 'UserPlus' };
const SOURCE_LABEL = { personal: 'Personal device', entryway: 'Entry-door iPad', board: 'Crew board', app: 'App' };

const dayKey = (iso) => { try { return new Date(iso).toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }); } catch { return ''; } };
const hhmm = (iso) => { try { return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
const dateTime = (iso) => { try { return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };

const PresenceHistory = () => {
  const { activeTenantId } = useAuth();
  const [tab, setTab] = useState('movements'); // movements | musters
  const [events, setEvents] = useState([]);
  const [musters, setMusters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);

  const load = useCallback(async () => {
    if (!activeTenantId) { setLoading(false); return; }
    setLoading(true);
    const [e, m] = await Promise.all([
      fetchPresenceEvents(activeTenantId, { limit: 300 }),
      fetchMusterRecords(activeTenantId, { limit: 100 }),
    ]);
    setEvents(e); setMusters(m); setLoading(false);
  }, [activeTenantId]);
  useEffect(() => { load(); }, [load]);

  // Group movement events by day for a scannable log.
  const grouped = useMemo(() => {
    const out = [];
    let cur = null;
    for (const ev of events) {
      const k = dayKey(ev.created_at);
      if (!cur || cur.day !== k) { cur = { day: k, items: [] }; out.push(cur); }
      cur.items.push(ev);
    }
    return out;
  }, [events]);

  return (
    <>
      <Header />
      <div className="ph">
        <header className="ph-head">
          <p className="editorial-meta">
            <span className="dot">●</span><span>Gangway</span>
            <span className="bar" /><span className="muted">{events.length} movements</span>
            <span className="bar" /><span className="muted">{musters.length} musters</span>
          </p>
          <h1 className="editorial-greeting">HISTORY<span className="period">,</span> <em>logged</em><span className="period">.</span></h1>
        </header>

        <div className="ph-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'movements'} className={`ph-tab ${tab === 'movements' ? 'active' : ''}`} onClick={() => setTab('movements')}>Sign in / out</button>
          <button type="button" role="tab" aria-selected={tab === 'musters'} className={`ph-tab ${tab === 'musters' ? 'active' : ''}`} onClick={() => setTab('musters')}>Musters</button>
        </div>

        {loading ? (
          <div className="ph-loading"><LogoSpinner size={40} /></div>
        ) : tab === 'movements' ? (
          grouped.length === 0 ? <p className="ph-empty">No sign in/out activity logged yet.</p> : (
            <div className="ph-log">
              {grouped.map((g) => (
                <section key={g.day} className="ph-day">
                  <h2 className="ph-day-h">{g.day}</h2>
                  {g.items.map((ev) => {
                    const aboard = ev.direction === 'aboard';
                    return (
                      <div key={ev.id} className="ph-row">
                        <span className="ph-ic"><Icon name={SUBJECT_ICON[ev.subject_type] || 'UserRound'} size={15} /></span>
                        <span className="ph-who">
                          <span className="ph-name">{ev.subject_name || 'Someone'}</span>
                          <span className="ph-src">{SOURCE_LABEL[ev.source] || ev.source}{ev.actor_name && ev.actor_name !== ev.subject_name ? ` · by ${ev.actor_name}` : ''}</span>
                        </span>
                        <span className={`ph-dir ${aboard ? 'in' : 'out'}`}>{aboard ? 'On board' : 'Ashore'}</span>
                        <span className="ph-time">{hhmm(ev.created_at)}</span>
                      </div>
                    );
                  })}
                </section>
              ))}
            </div>
          )
        ) : (
          musters.length === 0 ? <p className="ph-empty">No musters saved yet. Run a muster from the door board and tap “Save to log”.</p> : (
            <div className="ph-musters">
              {musters.map((m) => {
                const open = openId === m.id;
                const rc = Array.isArray(m.roll_calls) ? m.roll_calls : [];
                return (
                  <div key={m.id} className={`ph-mus${open ? ' open' : ''}`}>
                    <button type="button" className="ph-mus-head" onClick={() => setOpenId(open ? null : m.id)}>
                      <span className="ph-mus-l">
                        <span className="ph-mus-when">{dateTime(m.created_at)}</span>
                        <span className="ph-mus-sub">{rc.length} roll call{rc.length === 1 ? '' : 's'} · {m.expected ?? '—'} expected{m.created_by_name ? ` · ${m.created_by_name}` : ''}</span>
                      </span>
                      <span className="ph-mus-counts">
                        {rc.map((r, i) => <span key={i} className="ph-mus-chip">{r.name}: {r.count}/{m.expected ?? '—'}{r.at ? ` · ${hhmm(r.at)}` : ''}</span>)}
                        <Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={16} />
                      </span>
                    </button>
                    {open && (
                      <div className="ph-mus-body">
                        <table className="ph-mus-table">
                          <thead>
                            <tr><th>Name</th>{rc.map((r, i) => <th key={i}>{r.name}</th>)}</tr>
                          </thead>
                          <tbody>
                            {(Array.isArray(m.roster) ? m.roster : []).map((p) => (
                              <tr key={p.key} className={p.aboard ? '' : 'ashore'}>
                                <td className="nm">{p.name}{!p.aboard && <span className="ashore-tag">ashore</span>}</td>
                                {rc.map((r, i) => {
                                  const on = Array.isArray(r.marked) && r.marked.includes(p.name);
                                  return <td key={i} className={on ? 'on' : ''}>{on ? <Icon name="Check" size={15} /> : '—'}</td>;
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>
    </>
  );
};

export default PresenceHistory;
