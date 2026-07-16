import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../components/AppIcon';
import Header from '../../components/navigation/Header';
import { loadAllLaundryItems } from '../laundry-management-dashboard/utils/laundryStorage';
import { loadTrips } from '../trips-management-dashboard/utils/tripStorage';
import { enrichWithAvatars } from '../laundry-management-dashboard/utils/laundryAvatars';
import { buildLogbook, initials } from '../laundry-management-dashboard/utils/laundryLogbook';
import { downloadLaundryCsv } from '../laundry-management-dashboard/utils/laundryExport';
import { LaundryStatus } from '../laundry-management-dashboard/utils/laundryStorage';
import '../../styles/editorial.css';
import '../laundry-management-dashboard/laundry.css';

const dayKeyOf = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const ownerKindC = (t) => { const k = (t || 'unknown').toLowerCase(); return k === 'guest' ? 'guest' : k === 'crew' ? 'crew' : 'unknown'; };

const AvatarChip = ({ p }) => (
  <span className={`lr-av ${p.kind === 'guest' ? 'guest' : p.kind === 'crew' ? 'crew' : 'unk'}`}>
    {p.avatarUrl ? <img src={p.avatarUrl} alt="" /> : (p.kind === 'unknown' ? '?' : initials(p.name))}
  </span>
);

const Chapter = ({ p, active, onClick }) => {
  const icon = p.type === 'voyage' ? 'Ship' : p.type === 'offcharter' ? 'Anchor' : 'Users';
  return (
    <button type="button" className={`lb-ch ${p.type}${active ? ' on' : ''}`} onClick={onClick}>
      <div className="lb-ch-nm"><Icon name={icon} size={14} />{p.name}</div>
      <div className="lb-ch-dt">{p.dates}</div>
      <div className="lb-ch-row">
        <span className="lb-ct tnum">{p.cleaned} cleaned</span>
        {p.live && <span className="lb-live">live</span>}
      </div>
    </button>
  );
};

const Detail = ({ p, onExport }) => {
  if (!p) return null;
  const tag = p.type === 'voyage' ? 'Voyage' : p.type === 'offcharter' ? 'Off-charter' : 'Crew ledger';
  const peopleLbl = p.type === 'crew' ? 'Crew — every period' : p.type === 'offcharter' ? 'Crew & vessel — this period' : 'Per guest & crew — this voyage';
  return (
    <div className="lb-trip">
      <div className={`lb-hero ${p.type}`}>
        <div className="lb-hero-row">
          <div>
            <div className={`lb-tag ${p.type}`}>{tag}</div>
            <div className="lb-nm">{p.type === 'voyage' ? <>{p.name} <em>voyage</em></> : p.name}</div>
            <div className="lb-dt">{p.dates}{p.hero ? ` · ${p.hero}` : ''}</div>
          </div>
          {(p.items || []).length > 0 && (
            <button type="button" className="lb-export" onClick={() => onExport(p)}>
              <Icon name="Download" size={14} /> Export
            </button>
          )}
        </div>
        <div className="lb-kpis">
          <div className="lb-k"><b className="tnum">{p.cleaned}</b><span>Items cleaned</span></div>
          <div className="lb-k"><b className="tnum">{p.avg}</b><span>Avg turnaround</span></div>
          <div className="lb-k"><b className="tnum">{p.kpiA[0]}</b><span>{p.kpiA[1]}</span></div>
          <div className="lb-k"><b>{p.kpiB[0]}</b><span>{p.kpiB[1]}</span></div>
        </div>
      </div>

      <div className="lb-sec">
        <span className="lb-sl">{peopleLbl}</span>
        {p.people.map((per) => (
          <div className="lb-dos" key={per.key}>
            <AvatarChip p={per} />
            <div className="lb-dos-main">
              <div className="lb-dos-nm">{per.name}</div>
              <div className="lb-dos-sub">{per.sub || '—'}</div>
            </div>
            <div className="lb-dos-ct"><b className="tnum">{per.count}</b><span>pieces</span></div>
          </div>
        ))}
      </div>

      {p.type === 'crew' ? (
        <div className="lb-sec">
          <span className="lb-sl">Where it happened</span>
          {(p.byPeriod || []).length === 0 ? <div className="lb-dos-sub">No crew laundry recorded yet.</div>
            : p.byPeriod.map((b, i) => (
              <div className="lb-pm" key={i}><span>{b.label}</span><b className="tnum">{b.n} pieces</b></div>
            ))}
        </div>
      ) : (
        <div className="lb-sec">
          <span className="lb-sl">Returned — day by day</span>
          {p.days.length === 0 ? <div className="lb-dos-sub">Nothing delivered in this period yet.</div>
            : p.days.map((d) => (
              <div className="lb-rday" key={d.key}>
                <div className="lb-rh">{d.label}<span className="rule" />{d.items.length} returned</div>
                {d.items.map((it, i) => (
                  <div className="lb-ri" key={i}>
                    <span className="lb-th"><Icon name="Shirt" size={15} /></span>
                    <span className="lb-ri-nm">{it.desc}{it.sub ? <span className="lb-ri-sub"> · {it.sub}</span> : null}</span>
                    <span className="lb-ri-tag">Returned</span>
                    <span className="lb-ri-t">{it.time}</span>
                  </div>
                ))}
              </div>
            ))}
        </div>
      )}
    </div>
  );
};

const Calendar = ({ month, setMonth, sel, setSel, deliveredByDay, dayItems, todayKey, onExport }) => {
  const y = month.getFullYear();
  const m = month.getMonth();
  const first = new Date(y, m, 1);
  const daysIn = new Date(y, m + 1, 0).getDate();
  const lead = first.getDay();
  const monthName = month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const todayD = new Date();
  const selDate = new Date(`${sel}T00:00:00`);
  const selLabel = selDate.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const key = (d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const step = (delta) => setMonth(new Date(y, m + delta, 1));
  return (
    <div className="lb-cal-cols">
      <div className="lb-cal">
        <div className="lb-cal-top">
          <span className="lb-cal-mo">{monthName}</span>
          <div className="lb-cal-nav">
            <button type="button" aria-label="Previous month" onClick={() => step(-1)}><Icon name="ChevronLeft" size={15} /></button>
            <button type="button" aria-label="Next month" onClick={() => step(1)}><Icon name="ChevronRight" size={15} /></button>
          </div>
        </div>
        <div className="lb-cal-grid">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <div key={i} className="lb-cal-dow">{d}</div>)}
          {Array.from({ length: lead }).map((_, i) => <div key={`e${i}`} className="lb-cal-day empty" />)}
          {Array.from({ length: daysIn }).map((_, i) => {
            const d = i + 1;
            const k = key(d);
            const cellDate = new Date(y, m, d);
            const future = cellDate > todayD && k !== todayKey;
            const count = deliveredByDay[k] || 0;
            return (
              <button
                key={d} type="button"
                className={`lb-cal-day${k === sel ? ' sel' : ''}${k === todayKey ? ' today' : ''}${future ? ' future' : ''}`}
                onClick={() => !future && setSel(k)} disabled={future}
              >
                {d}{count > 0 && <span className="c tnum">{count}</span>}
              </button>
            );
          })}
        </div>
      </div>
      <div className="lb-arch">
        <div className="lb-arch-h">
          <div>
            <div className="lb-arch-d">{selLabel}</div>
            <div className="lb-arch-s">{dayItems.length} returned</div>
          </div>
          {dayItems.length > 0 && <button type="button" className="lb-export" onClick={onExport}><Icon name="Download" size={14} /> Export</button>}
        </div>
        {dayItems.length === 0 ? (
          <div className="lb-arch-empty">Nothing returned on this day.</div>
        ) : (
          <div className="lb-arch-list">
            {dayItems.map((it) => (
              <div className="lb-ri" key={it.id}>
                <span className="lb-th"><Icon name="Shirt" size={15} /></span>
                <span className="lb-ri-nm">{it.description || 'Laundry item'}<span className="lb-ri-sub"> · {[ownerKindC(it.ownerType) === 'unknown' ? 'Unknown' : it.ownerName, it.area, (it.tags || [])[0]].filter(Boolean).join(' · ')}</span></span>
                <span className="lb-ri-tag">Returned</span>
                <span className="lb-ri-t">{it.deliveredAt ? new Date(it.deliveredAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const LaundryHistoryView = () => {
  const navigate = useNavigate();
  const [book, setBook] = useState({ periods: [], crew: null, hasAny: false });
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selId, setSelId] = useState(null);
  const [view, setView] = useState('logbook'); // logbook | calendar
  const [calMonth, setCalMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [calSel, setCalSel] = useState(() => dayKeyOf(new Date()));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [raw, trips] = await Promise.all([loadAllLaundryItems(), loadTrips().catch(() => [])]);
        const enriched = await enrichWithAvatars(raw);
        if (cancelled) return;
        const b = buildLogbook(trips, enriched, new Date());
        setBook(b); setItems(enriched);
        setSelId(b.periods[0]?.id || (b.crew ? 'crew' : null));
      } catch (e) {
        if (!cancelled) { setBook({ periods: [], crew: null, hasAny: false }); setItems([]); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const totalCleaned = useMemo(() => book.periods.reduce((s, p) => s + p.cleaned, 0), [book.periods]);
  const selected = selId === 'crew' ? book.crew : book.periods.find((p) => p.id === selId);
  const live = book.periods.filter((p) => p.live);
  const past = book.periods.filter((p) => !p.live);

  const onExport = (p) => downloadLaundryCsv(p.items, `laundry-${p.name}-${p.dates}`);

  // calendar: delivered-per-day for the shown month + the selected day's returned items
  const deliveredByDay = useMemo(() => {
    const m = {};
    items.forEach((i) => { if (i.status === LaundryStatus?.DELIVERED && i.deliveredAt) { const k = dayKeyOf(i.deliveredAt); m[k] = (m[k] || 0) + 1; } });
    return m;
  }, [items]);
  const dayItems = useMemo(() => items
    .filter((i) => i.status === LaundryStatus?.DELIVERED && i.deliveredAt && dayKeyOf(i.deliveredAt) === calSel)
    .sort((a, b) => new Date(b.deliveredAt) - new Date(a.deliveredAt)), [items, calSel]);
  const todayKey = dayKeyOf(new Date());

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
              <span className="dot">●</span><span>Housekeeping</span>
              <span className="bar" /><span className="muted">History</span>
              <span className="bar" /><span className="muted">{totalCleaned} cleaned</span>
            </p>
            <div className="lm-titlerow">
              <h1 className="editorial-greeting">
                LAUNDRY<span className="period">,</span> <em>{view === 'calendar' ? 'archive' : 'logbook'}</em><span className="period">.</span>
              </h1>
              <div className="lm-seg" role="tablist" aria-label="History view" style={{ marginLeft: 'auto' }}>
                <button type="button" className={view === 'logbook' ? 'on' : ''} onClick={() => setView('logbook')}><Icon name="BookOpen" size={15} /> Logbook</button>
                <button type="button" className={view === 'calendar' ? 'on' : ''} onClick={() => setView('calendar')}><Icon name="Calendar" size={15} /> Calendar</button>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="lm-empty" role="status" style={{ paddingTop: 40 }}><div className="lm-empty-sub">Loading the logbook…</div></div>
          ) : !book.hasAny ? (
            <div className="lm-empty" role="status">
              <Icon name="BookOpen" size={44} className="lm-empty-ic" />
              <div className="lm-empty-title">Nothing logged yet</div>
              <div className="lm-empty-sub">As laundry is cleaned it’s filed here by voyage and off-charter period — who, what and when.</div>
            </div>
          ) : view === 'calendar' ? (
            <Calendar
              month={calMonth} setMonth={setCalMonth} sel={calSel} setSel={setCalSel}
              deliveredByDay={deliveredByDay} dayItems={dayItems} todayKey={todayKey}
              onExport={() => downloadLaundryCsv(dayItems, `laundry-${calSel}`)}
            />
          ) : (
            <div className="lb-cols">
              <div className="lb-rail">
                {book.crew && <Chapter p={book.crew} active={selId === 'crew'} onClick={() => setSelId('crew')} />}
                {live.length > 0 && <div className="lb-lbl">Current voyage</div>}
                {live.map((p) => <Chapter key={p.id} p={p} active={selId === p.id} onClick={() => setSelId(p.id)} />)}
                {past.length > 0 && <div className="lb-lbl">Timeline</div>}
                {past.map((p) => <Chapter key={p.id} p={p} active={selId === p.id} onClick={() => setSelId(p.id)} />)}
              </div>
              <Detail p={selected} onExport={onExport} />
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default LaundryHistoryView;
