import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../components/AppIcon';
import Header from '../../components/navigation/Header';
import { loadAllLaundryItems, getDeliveryCredits, getPhotoRetentionDays, setPhotoRetentionDays } from '../laundry-management-dashboard/utils/laundryStorage';
import { getCurrentUser } from '../../utils/authStorage';
import { loadTrips } from '../trips-management-dashboard/utils/tripStorage';
import { enrichWithAvatars, attachHandlers } from '../laundry-management-dashboard/utils/laundryAvatars';
import { resolveLaundryPhotos } from '../laundry-management-dashboard/utils/laundryPhotos';
import { buildLogbook, initials } from '../laundry-management-dashboard/utils/laundryLogbook';
import { downloadLaundryCsv } from '../laundry-management-dashboard/utils/laundryExport';
import { openTripReport } from '../laundry-management-dashboard/utils/laundryReport';
import LaundryDetailModal from '../laundry-management-dashboard/components/LaundryDetailModal';
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
const ItemLine = ({ it, hideOwner, onOpen }) => {
  const st = STATUS_TAG[it.status] || { t: 'Logged', c: '' };
  const parts = [];
  if (!hideOwner) parts.push(ownerKindC(it.ownerType) === 'unknown' ? 'Unknown' : it.ownerName);
  parts.push(it.area, (it.tags || [])[0]);
  const sub = parts.filter(Boolean).join(' · ');
  const clickable = typeof onOpen === 'function';
  return (
    <div
      className={`lb-ri${clickable ? ' click' : ''}`}
      onClick={clickable ? () => onOpen(it) : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(it); } } : undefined}
    >
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

// clock hand endpoints for an average duration in minutes (12h face, up = 12)
const clockHands = (min) => {
  if (min == null || !isFinite(min)) return null;
  const pt = (ang, L) => [(50 + L * Math.sin(ang * Math.PI / 180)).toFixed(1), (50 - L * Math.cos(ang * Math.PI / 180)).toFixed(1)];
  const [mx, my] = pt((min % 60) / 60 * 360, 30);
  const [hx, hy] = pt(((min / 60) % 12) / 12 * 360, 20);
  return { mx, my, hx, hy };
};

const Detail = ({ p, onExport, onOpenItem }) => {
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
  const hands = clockHands(p.avgMin);
  const care = p.care || { bars: [], other: null };
  const careMax = care.bars[0]?.count || 1;
  const [careOpen, setCareOpen] = useState(false);
  useEffect(() => { setCareOpen(false); }, [p?.id]);
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
            <div className="lb-exports">
              <button type="button" className="lb-export" onClick={() => openTripReport(p)}>
                <Icon name="Printer" size={14} /> Report
              </button>
              <button type="button" className="lb-export" onClick={() => onExport(p)}>
                <Icon name="Download" size={14} /> CSV
              </button>
            </div>
          )}
        </div>

        <div className="lb-info">
          <div className="lb-i">
            <span className="lb-il">Avg turnaround</span>
            <div className="lb-clockwrap">
              <div className="lb-clock">
                <svg viewBox="0 0 100 100" aria-label={`Average turnaround ${p.avg}`}>
                  <circle cx="50" cy="50" r="40" fill="#FDFCFA" stroke="#ECECEE" strokeWidth="2" />
                  <g stroke="#CFCFD6" strokeWidth="2" strokeLinecap="round">
                    <line x1="50" y1="13" x2="50" y2="19" /><line x1="87" y1="50" x2="81" y2="50" /><line x1="50" y1="87" x2="50" y2="81" /><line x1="13" y1="50" x2="19" y2="50" />
                  </g>
                  {hands && <>
                    <line x1="50" y1="50" x2={hands.hx} y2={hands.hy} stroke="#1C1B3A" strokeWidth="3.2" strokeLinecap="round" />
                    <line x1="50" y1="50" x2={hands.mx} y2={hands.my} stroke="#C65A1A" strokeWidth="2.6" strokeLinecap="round" />
                  </>}
                  <circle cx="50" cy="50" r="3.4" fill="#C65A1A" />
                </svg>
                <div><div className="lb-cv tnum">{p.avg}</div><div className="lb-cu">{hands ? 'overall' : 'no data yet'}</div></div>
              </div>
              {(p.carePace || []).length > 1 && (
                <div className="lb-pace">
                  {p.carePace.slice(0, 4).map((c, i) => (
                    <div className="lb-pace-r" key={i}><span className="lb-pace-l">{c.label}</span><b className="tnum">{c.avg}</b></div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {(p.team || []).length > 0 && (
            <div className="lb-i grow">
              <span className="lb-il">Interior team · who handled it</span>
              <div className="lb-team">
                {p.team.slice(0, 4).map((m) => (
                  <div className="lb-mem" key={m.key}>
                    <span className={`lr-av ${m.avatarUrl ? '' : 'crew'} lb-mav`}>{m.avatarUrl ? <img src={m.avatarUrl} alt="" /> : initials(m.name)}</span>
                    <span className="lb-mn">{m.name}</span>
                    <span className="lb-mc tnum">{m.count}<small>pcs</small></span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {care.bars.length > 0 && (
            <div className="lb-i grow">
              <span className="lb-il">By care type</span>
              <div className="lb-plot">
                {care.bars.map((c, i) => (
                  <div
                    className={`lb-col${c.other ? ' other' : ''}`}
                    key={i}
                    onClick={c.other ? () => setCareOpen((o) => !o) : undefined}
                    role={c.other ? 'button' : undefined}
                    tabIndex={c.other ? 0 : undefined}
                    onKeyDown={c.other ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCareOpen((o) => !o); } } : undefined}
                  >
                    <span className="lb-cvv tnum">{c.count}</span>
                    <span className="lb-trk"><span className="lb-fill" style={{ height: `${Math.max(8, Math.round((c.count / careMax) * 100))}%` }} /></span>
                  </div>
                ))}
              </div>
              <div className="lb-xrow">{care.bars.map((c, i) => <span key={i}>{c.label}</span>)}</div>
              {care.other && (
                <>
                  <button type="button" className={`lb-chint btn${careOpen ? ' open' : ''}`} onClick={() => setCareOpen((o) => !o)} aria-expanded={careOpen}>
                    <Icon name="ChevronRight" size={12} className="lb-chint-chev" />
                    <span><b>Other</b> · {care.other.count} across {care.other.items.length} type{care.other.items.length === 1 ? '' : 's'}</span>
                  </button>
                  {careOpen && (
                    <div className="lb-other-list">
                      {care.other.items.map((o, i) => (
                        <div className="lb-other-row" key={i}><span>{o.label}</span><b className="tnum">{o.count}</b></div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
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
                  {its.map((it, i) => <ItemLine key={it.id || it.supabaseId || i} it={it} hideOwner onOpen={onOpenItem} />)}
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

const Calendar = ({ month, setMonth, sel, setSel, deliveredByDay, dayItems, todayKey, onExport, onOpenItem }) => {
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
                {g.items.map((it, i) => <ItemLine key={it.id || i} it={it} hideOwner onOpen={onOpenItem} />)}
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
  const [detailItem, setDetailItem] = useState(null);
  const [q, setQ] = useState('');
  const [fOwner, setFOwner] = useState('all'); // all | guest | crew
  const [fStatus, setFStatus] = useState('all'); // all | progress | ready | delivered
  const [retention, setRetention] = useState(null);
  const canManage = useMemo(() => { const t = (getCurrentUser()?.effectiveTier || getCurrentUser()?.tier || '').toUpperCase(); return t === 'COMMAND' || t === 'CHIEF'; }, []);
  useEffect(() => { if (canManage) getPhotoRetentionDays().then(setRetention).catch(() => {}); }, [canManage]);
  const saveRetention = async (v) => { setRetention(v); await setPhotoRetentionDays(v); };

  // open a piece in the read view — sign its photos first so the hero renders
  const openItem = async (it) => {
    if (!it) return;
    try { const [resolved] = await resolveLaundryPhotos([it]); setDetailItem(resolved || it); }
    catch { setDetailItem(it); }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [raw, trips, credits] = await Promise.all([loadAllLaundryItems(), loadTrips().catch(() => []), getDeliveryCredits().catch(() => ({}))]);
        const enriched = await attachHandlers(await enrichWithAvatars(raw), credits);
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

  // search / filter across every logged piece (independent of the period views)
  const searchActive = !!q.trim() || fOwner !== 'all' || fStatus !== 'all';
  const STFILT = { progress: LaundryStatus?.IN_PROGRESS, ready: LaundryStatus?.READY_TO_DELIVER, delivered: LaundryStatus?.DELIVERED };
  const results = useMemo(() => {
    if (!searchActive) return [];
    const needle = q.trim().toLowerCase();
    return items
      .filter((it) => {
        if (fOwner !== 'all' && ownerKindC(it.ownerType) !== fOwner) return false;
        if (fStatus !== 'all' && it.status !== STFILT[fStatus]) return false;
        if (!needle) return true;
        const hay = `${it.description || ''} ${it.ownerName || ''} ${it.area || ''} ${(it.tags || []).join(' ')} ${it.colour || ''}`.toLowerCase();
        return hay.includes(needle);
      })
      .sort((a, b) => new Date(b.deliveredAt || b.createdAt) - new Date(a.deliveredAt || a.createdAt));
  }, [items, q, fOwner, fStatus, searchActive]);

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

          {book.hasAny && (
            <div className="hist-tools">
              <label className="lm-search">
                <Icon name="Search" size={16} className="lm-search-ic" />
                <input type="text" placeholder="Search items, guest, cabin, care…" value={q} onChange={(e) => setQ(e.target.value)} />
                {q && <button type="button" className="lm-search-x" onClick={() => setQ('')} aria-label="Clear search"><Icon name="X" size={14} /></button>}
              </label>
              <div className="hist-chips">
                {[['all', 'Everyone'], ['guest', 'Guests'], ['crew', 'Crew']].map(([v, l]) => (
                  <button key={v} type="button" className={`hist-chip${fOwner === v ? ' on' : ''}`} onClick={() => setFOwner(v)}>{l}</button>
                ))}
                <span className="hist-chip-sep" />
                {[['all', 'Any status'], ['progress', 'Washing'], ['ready', 'Ready'], ['delivered', 'Returned']].map(([v, l]) => (
                  <button key={v} type="button" className={`hist-chip${fStatus === v ? ' on' : ''}`} onClick={() => setFStatus(v)}>{l}</button>
                ))}
              </div>
              {canManage && (
                <label className="hist-retain" title="How long delivered-laundry photos are kept before housekeeping clears them">
                  <Icon name="ImageOff" size={14} />
                  <span>Keep photos</span>
                  <select value={retention == null ? '' : String(retention)} onChange={(e) => saveRetention(e.target.value === '' ? null : Number(e.target.value))}>
                    <option value="">Forever</option>
                    <option value="90">90 days</option>
                    <option value="180">6 months</option>
                    <option value="365">1 year</option>
                  </select>
                </label>
              )}
            </div>
          )}

          {loading ? (
            <div className="lm-empty" role="status" style={{ paddingTop: 40 }}><div className="lm-empty-sub">Loading the logbook…</div></div>
          ) : !book.hasAny ? (
            <div className="lm-empty" role="status">
              <Icon name="BookOpen" size={44} className="lm-empty-ic" />
              <div className="lm-empty-title">Nothing logged yet</div>
              <div className="lm-empty-sub">As laundry is cleaned it’s filed here by voyage and off-charter period — who, what and when.</div>
            </div>
          ) : searchActive ? (
            <div className="hist-results">
              <div className="hist-results-h">
                <span className="hist-results-n"><b className="tnum">{results.length}</b> {results.length === 1 ? 'match' : 'matches'}</span>
                <button type="button" className="hist-results-clear" onClick={() => { setQ(''); setFOwner('all'); setFStatus('all'); }}>Clear search</button>
              </div>
              {results.length === 0 ? (
                <div className="lm-empty" role="status" style={{ paddingTop: 30 }}><div className="lm-empty-sub">No pieces match that.</div></div>
              ) : (
                <div className="hist-results-list">
                  {results.map((it) => <ItemLine key={it.id} it={it} onOpen={openItem} />)}
                </div>
              )}
            </div>
          ) : view === 'calendar' ? (
            <Calendar
              month={calMonth} setMonth={setCalMonth} sel={calSel} setSel={setCalSel}
              deliveredByDay={deliveredByDay} dayItems={dayItems} todayKey={todayKey}
              onExport={() => downloadLaundryCsv(dayItems, `laundry-${calSel}`)}
              onOpenItem={openItem}
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
              <Detail p={selected} onExport={onExport} onOpenItem={openItem} />
            </div>
          )}
        </div>
      </div>
      {detailItem && <LaundryDetailModal item={detailItem} onClose={() => setDetailItem(null)} />}
    </>
  );
};

export default LaundryHistoryView;
