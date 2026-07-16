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

const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '');
const STATUS_TAG = {
  [LaundryStatus.DELIVERED]: { t: 'Returned', c: 'ok' },
  [LaundryStatus.READY_TO_DELIVER]: { t: 'Ready', c: 'ready' },
  [LaundryStatus.IN_PROGRESS]: { t: 'Washing', c: 'wash' },
};

// one returned/actioned item line, reused in the logbook + calendar
const ItemLine = ({ it, hideOwner }) => {
  const st = STATUS_TAG[it.status] || { t: 'Logged', c: '' };
  const parts = [];
  if (!hideOwner) parts.push(ownerKindC(it.ownerType) === 'unknown' ? 'Unknown' : it.ownerName);
  parts.push(it.area, (it.tags || [])[0]);
  const sub = parts.filter(Boolean).join(' · ');
  return (
    <div className="lb-ri">
      <span className="lb-th"><Icon name="Shirt" size={15} /></span>
      <span className="lb-ri-nm">{it.description || 'Laundry item'}{sub ? <span className="lb-ri-sub"> · {sub}</span> : null}</span>
      <span className={`lb-ri-tag ${st.c}`}>{st.t}</span>
      <span className="lb-ri-t">{clock(it.deliveredAt || it.createdAt)}</span>
    </div>
  );
};

// group a day's items by the person (guest / crew) who owns them, so a day
// reads person-by-person instead of one long time-sorted list
function groupByPerson(items) {
  const map = new Map();
  for (const it of items) {
    const kind = ownerKindC(it.ownerType);
    const key = kind === 'guest' ? (it.ownerGuestId || it.ownerName || 'guest')
      : kind === 'crew' ? (it.ownerCrewUserId || it.ownerName || 'crew') : 'unknown';
    if (!map.has(key)) {
      map.set(key, { key, kind, name: kind === 'unknown' ? 'Found & unclaimed' : (it.ownerName || 'Unassigned'), avatarUrl: it.avatarUrl || null, items: [] });
    }
    const g = map.get(key);
    g.items.push(it);
    if (!g.avatarUrl && it.avatarUrl) g.avatarUrl = it.avatarUrl;
  }
  const rank = { guest: 0, crew: 1, unknown: 2 };
  return [...map.values()].sort((a, b) => (rank[a.kind] - rank[b.kind]) || b.items.length - a.items.length);
}

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
  const [open, setOpen] = useState(null);
  const [openDay, setOpenDay] = useState(null);
  useEffect(() => { setOpen(null); setOpenDay(p?.days?.[0]?.key || null); }, [p?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!p) return null;
  // metabar sits above the title: status · dates · guests (voyage); category · descriptor (off-charter); crew has none
  const meta = p.type === 'voyage'
    ? [p.live ? 'In progress' : 'Completed', p.dates, `${p.kpiA[0]} ${p.kpiA[1].toLowerCase()}`]
    : p.type === 'offcharter' ? ['Off-charter', 'No guests aboard'] : [];
  const title = p.type === 'offcharter' ? p.dates : p.name; // voyage → bare trip name
  const peopleLbl = p.type === 'crew' ? 'Crew — every period' : p.type === 'offcharter' ? 'Crew & vessel — this period' : 'Per guest — this voyage';
  const metrics = [
    { v: p.cleaned, l: 'Cleaned' },
    { v: p.avg, l: 'Avg turnaround' },
    { v: p.kpiA[0], l: p.kpiA[1] },
    { v: p.kpiB[0], l: p.kpiB[1] },
  ];
  return (
    <div className="lb-trip">
      <div className="lb-hero">
        <div className="lb-hero-row">
          <div>
            {meta.length > 0 && (
              <div className="lb-meta">
                {p.type === 'voyage' && <span className={`lb-meta-dot ${p.live ? 'live' : 'done'}`} />}
                {meta.map((m, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && <span className="lb-meta-sep" />}
                    <span>{m}</span>
                  </React.Fragment>
                ))}
              </div>
            )}
            <div className="lb-nm">{title}</div>
          </div>
          {(p.items || []).length > 0 && (
            <button type="button" className="lb-export" onClick={() => onExport(p)}>
              <Icon name="Download" size={14} /> Export
            </button>
          )}
        </div>
        <div className="lb-figs">
          {metrics.map((k, i) => (
            <div className={`lb-fig${i === 0 ? ' lede' : ''}`} key={i}>
              <b className="tnum">{k.v}</b>
              <span className="lb-fig-l">{k.l}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="lb-sec">
        <span className="lb-sl">{peopleLbl}<span className="lb-sl-hint">tap a name to see their items</span></span>
        {p.people.map((per) => {
          const isOpen = open === per.key;
          const its = (per.items || []).slice().sort((a, b) => new Date(b.deliveredAt || b.createdAt) - new Date(a.deliveredAt || a.createdAt));
          return (
            <div className={`lb-dos-wrap${isOpen ? ' open' : ''}`} key={per.key}>
              <button type="button" className="lb-dos" onClick={() => setOpen(isOpen ? null : per.key)} aria-expanded={isOpen}>
                <AvatarChip p={per} />
                <div className="lb-dos-main">
                  <div className="lb-dos-nm">{per.name}</div>
                  <div className="lb-dos-sub">{per.sub || '—'}</div>
                </div>
                <div className="lb-dos-ct"><b className="tnum">{per.count}</b><span>pieces</span></div>
                <Icon name="ChevronDown" size={16} className="lb-dos-chev" />
              </button>
              {isOpen && (
                <div className="lb-dos-items">
                  {its.map((it, i) => <ItemLine key={it.id || it.supabaseId || i} it={it} hideOwner />)}
                </div>
              )}
            </div>
          );
        })}
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
          <span className="lb-sl">Returned — day by day<span className="lb-sl-hint">{p.days.length} day{p.days.length === 1 ? '' : 's'} · tap to open</span></span>
          {p.days.length === 0 ? <div className="lb-dos-sub">Nothing delivered in this period yet.</div>
            : p.days.map((d) => {
              const dOpen = openDay === d.key;
              return (
                <div className={`lb-rday${dOpen ? ' open' : ''}`} key={d.key}>
                  <button type="button" className="lb-rh" onClick={() => setOpenDay(dOpen ? null : d.key)} aria-expanded={dOpen}>
                    <Icon name="ChevronRight" size={14} className="lb-rh-chev" />
                    <span className="lb-rh-d">{d.label}</span>
                    <span className="rule" />
                    <span className="lb-rh-ct">{d.items.length} returned</span>
                  </button>
                  {dOpen && (
                    <div className="lb-rday-items">
                      {d.items.map((it, i) => (
                        <div className="lb-ri" key={i}>
                          <span className="lb-th"><Icon name="Shirt" size={15} /></span>
                          <span className="lb-ri-nm">{it.desc}{it.sub ? <span className="lb-ri-sub"> · {it.sub}</span> : null}</span>
                          <span className="lb-ri-tag">Returned</span>
                          <span className="lb-ri-t">{it.time}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
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
            {groupByPerson(dayItems).map((g) => (
              <div className="lb-pg" key={g.key}>
                <div className="lb-pg-h">
                  <span className={`lr-av ${g.kind === 'guest' ? 'guest' : g.kind === 'crew' ? 'crew' : 'unk'}`}>
                    {g.avatarUrl ? <img src={g.avatarUrl} alt="" /> : (g.kind === 'unknown' ? '?' : initials(g.name))}
                  </span>
                  <span className="lb-pg-nm">{g.name}</span>
                  <span className="lb-pg-ct tnum">{g.items.length}</span>
                </div>
                {g.items.map((it, i) => <ItemLine key={it.id || i} it={it} hideOwner />)}
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
