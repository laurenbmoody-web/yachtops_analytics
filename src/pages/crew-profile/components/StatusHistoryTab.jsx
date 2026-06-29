import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';
import { supabase } from '../../../lib/supabaseClient';
import LogoSpinner from '../../../components/LogoSpinner';
import { showToast } from '../../../utils/toast';
import {
  CREW_STATUSES, getStatusLabel,
  buildStatusPeriods, getStatusForDay,
} from '../../../utils/crewStatus';
import { fetchProfileActivity, ACTIVITY_CATEGORIES, activityCat } from '../utils/profileActivity';
import {
  TRANSPORTS, travelSummary,
  fetchCalendarEntries, saveCalendarEntry, deleteCalendarEntry, entryForDay,
} from '../utils/crewCalendar';
import { computeResidency, visaForCountry, normIso, countryName, SCHENGEN } from '../utils/residency';
import { fetchStamps, saveStamp, deleteStamp, isStampedOn, stampOnDay } from '../utils/crewStamps';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const fmtDay = (d) => {
  const x = new Date(d);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(x.getDate())}/${p(x.getMonth() + 1)}/${x.getFullYear()}`;
};
const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
const today0 = () => { const t = new Date(); t.setHours(0, 0, 0, 0); return t; };
const todayIso = () => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };

// Soft, low-saturation status tints — gentler than the shared cell classes.
const SOFT = {
  active: { bg: '#E7F6EC', ink: '#2E7D52' },
  on_leave: { bg: '#FBF1E1', ink: '#9A6A00' },
  rotational_leave: { bg: '#F1ECF9', ink: '#6E5B97' },
  medical_leave: { bg: '#FBECEB', ink: '#B23B3B' },
  training_leave: { bg: '#E9EFF8', ink: '#3E6A8E' },
  travelling: { bg: '#E5F0ED', ink: '#2E7D6B' },
  invited: { bg: '#F0F1F4', ink: '#6B7280' },
};
const soft = (s) => SOFT[s] || { bg: '#F6F5F1', ink: '#8B8478' };
const sameDay = (a, b) => a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

// Short labels for the bottom status tab (active = no tab; it's the default).
const SHORT_STATUS = {
  active: 'Active', on_leave: 'Leave', rotational_leave: 'Rotational leave', medical_leave: 'Medical',
  training_leave: 'Training', travelling: 'Travel', invited: 'Invited',
};


const blankEntry = () => ({
  kind: 'on_leave', startDate: todayIso(), endDate: todayIso(),
  fromLocation: '', toLocation: '', location: '', locationCountry: '',
  transport: '', transportNo: '', departTime: '', arriveTime: '', note: '',
});

const prefersReducedMotion = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Counts from 0 → value on an ease-out curve when `run` is true; otherwise shows
// the final value immediately (also the reduced-motion path).
const CountUp = ({ value, run }) => {
  const [n, setN] = useState(run ? 0 : value);
  useEffect(() => {
    if (!run) { setN(value); return undefined; }
    let raf;
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const t0 = now();
    const dur = 620;
    const tick = () => {
      const p = Math.min(1, (now() - t0) / dur);
      setN(Math.round(value * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, run]);
  return <>{n}</>;
};

const StatusHistoryTab = ({ userId, tenantId, canManage, currentUserId, currentUserName }) => {
  const [activity, setActivity] = useState([]);
  const [statusRows, setStatusRows] = useState([]);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('timeline');
  const [filter, setFilter] = useState('all');

  const [entryOpen, setEntryOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blankEntry());
  const [busy, setBusy] = useState(false);
  const [selectedDay, setSelectedDay] = useState(today0());
  const [calYear, setCalYear] = useState(today0().getFullYear());
  const [calMonth, setCalMonth] = useState(today0().getMonth());
  const [statFilter, setStatFilter] = useState(null);
  const [animReady, setAnimReady] = useState(false);
  const [vesselPos, setVesselPos] = useState([]);
  const [crewNat, setCrewNat] = useState([]);
  const [stamps, setStamps] = useState([]);
  const reduced = prefersReducedMotion();
  const calPrev = () => { if (calMonth === 0) { setCalYear((y) => y - 1); setCalMonth(11); } else setCalMonth((m) => m - 1); };
  const calNext = () => { if (calMonth === 11) { setCalYear((y) => y + 1); setCalMonth(0); } else setCalMonth((m) => m + 1); };
  const calToday = () => { const t = today0(); setCalYear(t.getFullYear()); setCalMonth(t.getMonth()); setSelectedDay(t); };

  const load = useCallback(async () => {
    if (!userId) { setLoading(false); return; }
    setLoading(true);
    const [acts, sh, ents, vp, pd, st] = await Promise.all([
      fetchProfileActivity(userId),
      supabase.from('crew_status_history').select('*').eq('user_id', userId).neq('source', 'calendar').order('changed_at', { ascending: true }),
      fetchCalendarEntries(userId),
      tenantId
        ? supabase.from('vessel_positions').select('observed_on, country_code').eq('tenant_id', tenantId)
        : Promise.resolve({ data: [] }),
      supabase.from('crew_personal_details').select('nationality, second_nationality').eq('user_id', userId).maybeSingle(),
      fetchStamps(userId),
    ]);
    setActivity(acts);
    setStatusRows(sh.data || []);
    setEntries(ents);
    setVesselPos(vp?.data || []);
    setCrewNat([pd?.data?.nationality, pd?.data?.second_nationality].map(normIso).filter(Boolean));
    setStamps(st);
    setLoading(false);
  }, [userId, tenantId]);
  useEffect(() => { load(); }, [load, tenantId]);

  // Trigger the load-in animation once the calendar view is mounted with data.
  useEffect(() => {
    if (view !== 'calendar' || loading) { setAnimReady(false); return undefined; }
    if (reduced) { setAnimReady(true); return undefined; }
    setAnimReady(false);
    const id = setTimeout(() => setAnimReady(true), 40);
    return () => clearTimeout(id);
  }, [view, loading, reduced]);

  const periods = buildStatusPeriods(statusRows);
  const presentCats = ACTIVITY_CATEGORIES.filter((c) => activity.some((e) => e.category === c.id));
  const shown = filter === 'all' ? activity : activity.filter((e) => e.category === filter);

  // Day-count per status for the displayed month (calendar entry wins, else the
  // status timeline). Drives the KPI strip under the grid.
  const monthCounts = () => {
    const counts = {};
    const dim = daysInMonth(calYear, calMonth);
    for (let d = 1; d <= dim; d++) {
      const day = new Date(calYear, calMonth, d);
      const entry = entryForDay(entries, day);
      const stat = entry ? entry.kind : getStatusForDay(periods, day);
      if (stat) counts[stat] = (counts[stat] || 0) + 1;
    }
    return counts;
  };
  // Day-count per status across the trailing 365 days — drives the KPI card.
  const yearCounts = () => {
    const counts = {};
    const end = today0();
    for (let i = 0; i < 365; i++) {
      const day = new Date(end);
      day.setDate(end.getDate() - i);
      const entry = entryForDay(entries, day);
      const stat = entry ? entry.kind : getStatusForDay(periods, day);
      if (stat) counts[stat] = (counts[stat] || 0) + 1;
    }
    return counts;
  };
  const kpiLabel = (v) => SHORT_STATUS[v] || getStatusLabel(v);

  const setF = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const dateIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const openAdd = (iso) => { setEditing(null); setForm({ ...blankEntry(), ...(iso ? { startDate: iso, endDate: iso } : {}) }); setEntryOpen(true); };
  const openEdit = (e) => {
    setEditing(e);
    setForm({
      kind: e.kind || 'on_leave', startDate: String(e.start_date).slice(0, 10), endDate: String(e.end_date).slice(0, 10),
      fromLocation: e.from_location || '', toLocation: e.to_location || '',
      location: e.location || '', locationCountry: e.location_country || '', transport: e.transport || '',
      transportNo: e.transport_no || '', departTime: e.depart_time || '', arriveTime: e.arrive_time || '', note: e.note || '',
    });
    setEntryOpen(true);
  };

  const saveEntry = async () => {
    if (!form.startDate) { showToast('Pick a start date', 'error'); return; }
    if (form.endDate && form.endDate < form.startDate) { showToast('End date is before the start date', 'error'); return; }
    setBusy(true);
    try {
      await saveCalendarEntry({
        id: editing?.id, userId, tenantId, actorId: currentUserId, actorName: currentUserName, ...form,
      });
      showToast(editing ? 'Entry updated' : 'Entry added', 'success');
      setEntryOpen(false);
      load();
    } catch (e) { showToast(e.message || 'Could not save entry', 'error'); }
    finally { setBusy(false); }
  };

  const removeEntry = async (e) => {
    if (!window.confirm(`Remove this ${getStatusLabel(e.kind).toLowerCase()} entry?`)) return;
    try { await deleteCalendarEntry(e.id); showToast('Entry removed', 'success'); load(); }
    catch { showToast('Delete failed', 'error'); }
  };

  const addStamp = async (kind, day) => {
    try {
      await saveStamp({ userId, tenantId, kind, stampDate: dateIso(day), actorId: currentUserId, actorName: currentUserName });
      showToast(kind === 'on' ? 'Stamped onto vessel' : 'Stamped off vessel', 'success');
      load();
    } catch (e) { showToast(e.message || 'Could not save stamp', 'error'); }
  };
  const removeStamp = async (s) => {
    try { await deleteStamp(s.id); showToast('Stamp removed', 'success'); load(); }
    catch { showToast('Delete failed', 'error'); }
  };

  return (
    <div>
      <div className="cp-tab-head">
        <div className="cp-section-head">
          <span className="cp-section-num">11 /</span>
          <h3>Activity</h3>
        </div>
        <div className="cp-tab-actions">
          <div className="cd-seg">
            <button type="button" className={view === 'timeline' ? 'on' : ''} onClick={() => setView('timeline')}>Timeline</button>
            <button type="button" className={view === 'calendar' ? 'on' : ''} onClick={() => setView('calendar')}>Status calendar</button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><LogoSpinner size={32} /></div>
      ) : view === 'calendar' ? (
        <>
        <div className="cp-group-head"><span className="dia">◆</span><span className="t">Status calendar</span><span className="line" /></div>
        <div className="act-calwrap">
          {/* Column 1 — month calendar */}
          <div className="act-col-cal">
            <div className="act-cal-nav">
              <button type="button" onClick={calPrev} aria-label="Previous month"><Icon name="ChevronLeft" size={16} /></button>
              <span>{MONTHS[calMonth]} {calYear}</span>
              <button type="button" onClick={calNext} aria-label="Next month"><Icon name="ChevronRight" size={16} /></button>
              <button type="button" className="act-cal-today" onClick={calToday}>Today</button>
            </div>
            <div className="act-mgrid act-mhead">{WEEKDAYS.map((w) => <div key={w} className="act-mwd">{w}</div>)}</div>
            <div className="act-mgrid">
              {[...Array((new Date(calYear, calMonth, 1).getDay() + 6) % 7).fill(null), ...Array.from({ length: daysInMonth(calYear, calMonth) }, (_, i) => i + 1)].map((d, i) => {
                if (d === null) return <div key={`b${i}`} className="act-mcell is-blank" />;
                const day = new Date(calYear, calMonth, d);
                const entry = entryForDay(entries, day);
                const stat = entry ? entry.kind : getStatusForDay(periods, day);
                const showTab = !!stat;
                const tabLabel = SHORT_STATUS[stat] || getStatusLabel(stat);
                const dim = statFilter && stat !== statFilter;
                const hot = statFilter && stat === statFilter;
                const onboard = isStampedOn(stamps, day);
                return (
                  <button
                    key={d}
                    type="button"
                    className={`act-mcell ${stat === 'active' ? 'is-active' : ''} ${day > today0() ? 'is-future' : ''} ${sameDay(day, today0()) ? 'is-today' : ''} ${sameDay(day, selectedDay) && !statFilter ? 'is-sel' : ''} ${dim ? 'is-dim' : ''} ${hot ? 'is-hot' : ''}`}
                    style={hot ? { boxShadow: `inset 0 0 0 2px ${soft(stat).ink}` } : undefined}
                    onClick={() => setSelectedDay(day)}
                    title={`${stat ? getStatusLabel(stat) : 'No data'}${onboard ? ' · signed on (clock paused)' : ''}${entry && travelSummary(entry) ? ` — ${travelSummary(entry)}` : ''}`}
                  >
                    <span className="act-mnum">{d}</span>
                    {onboard && <span className="act-mstamp" title="Signed onto vessel — clock paused"><Icon name="Stamp" size={14} /></span>}
                    {showTab && <span className="act-mtab" style={{ background: soft(stat).ink }}>{tabLabel}</span>}
                  </button>
                );
              })}
            </div>
            {statFilter && (
              <button type="button" className="act-filterpill" onClick={() => setStatFilter(null)}>
                Showing <b style={{ color: soft(statFilter).ink }}>{kpiLabel(statFilter)}</b> days · clear
              </button>
            )}
            <div className="act-kpis">
              {(() => {
                const counts = monthCounts();
                const present = CREW_STATUSES.filter((s) => counts[s.value]);
                if (!present.length) return <span className="act-kpi-empty">No status data for {MONTHS[calMonth]}.</span>;
                return present.map(({ value }) => (
                  <span key={value} className="act-kpi">
                    <i style={{ background: soft(value).ink }} />
                    <b>{counts[value]}</b><span>{kpiLabel(value)}</span>
                  </span>
                ));
              })()}
            </div>
          </div>

          {/* Column 2 — day detail + last-365-days KPIs */}
          <div className="act-col-mid">
            {(() => {
              const day = selectedDay;
              const entry = entryForDay(entries, day);
              const stat = entry ? entry.kind : getStatusForDay(periods, day);
              const wd = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][day.getDay()];
              const oneDay = String(entry?.end_date).slice(0, 10) === String(entry?.start_date).slice(0, 10);
              return (
                <div className="act-daypanel">
                  <div className="act-dp-date">{wd}<span>{fmtDay(day)}</span></div>
                  <div className="act-dp-status">
                    <i className="act-dp-dot" style={{ background: soft(stat).ink }} />
                    {stat ? getStatusLabel(stat) : 'No status recorded'}
                  </div>
                  {entry ? (
                    <div className="act-dp-entry">
                      <div className="act-dp-kind">{getStatusLabel(entry.kind)}</div>
                      <div className="act-dp-line">{fmtDay(entry.start_date)}{oneDay ? '' : ` – ${fmtDay(entry.end_date)}`}</div>
                      {entry.location && <div className="act-dp-line">{entry.location}{entry.location_country ? ` · ${entry.location_country}` : ''}</div>}
                      {travelSummary(entry) && <div className="act-dp-line">{travelSummary(entry)}</div>}
                      {(entry.depart_time || entry.arrive_time) && <div className="act-dp-line">Dep {entry.depart_time || '—'} · Arr {entry.arrive_time || '—'}</div>}
                      {entry.note && <div className="act-dp-note">{entry.note}</div>}
                      {canManage && (
                        <div className="act-dp-actions">
                          <button type="button" onClick={() => openEdit(entry)}><Icon name="Pencil" size={13} /> Edit</button>
                          <button type="button" className="rm" onClick={() => removeEntry(entry)}><Icon name="Trash2" size={13} /> Remove</button>
                        </div>
                      )}
                    </div>
                  ) : canManage ? (
                    <button type="button" className="act-dp-add" onClick={() => openAdd(dateIso(day))}>
                      <Icon name="Plus" size={14} /> Add leave / travel
                    </button>
                  ) : (
                    <p className="act-dp-empty">No leave or travel logged for this day.</p>
                  )}
                  {(() => {
                    const dayStamp = stampOnDay(stamps, day);
                    const onboardNow = isStampedOn(stamps, day);
                    return (
                      <div className="act-dp-stamp">
                        <div className="act-dp-kind">Vessel crew list</div>
                        {dayStamp ? (
                          <div className="act-dp-line act-stamp-row">
                            <Icon name="Stamp" size={13} />
                            {dayStamp.kind === 'on' ? 'Stamped onto vessel' : 'Stamped off vessel'}
                            {canManage && <button type="button" className="act-stamp-rm" onClick={() => removeStamp(dayStamp)} title="Remove stamp"><Icon name="X" size={12} /></button>}
                          </div>
                        ) : canManage ? (
                          <div className="act-stamp-actions">
                            {onboardNow
                              ? <button type="button" onClick={() => addStamp('off', day)}><Icon name="Stamp" size={12} /> Stamp off vessel</button>
                              : <button type="button" onClick={() => addStamp('on', day)}><Icon name="Stamp" size={12} /> Stamp onto vessel</button>}
                          </div>
                        ) : null}
                        {onboardNow && (
                          <div className="act-dp-note" style={{ marginTop: 6 }}>Signed on — Schengen / visa clock paused.</div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              );
            })()}
            {(() => {
              const yc = yearCounts();
              const total = Object.values(yc).reduce((a, b) => a + b, 0) || 1;
              const present = CREW_STATUSES.filter((s) => yc[s.value]);
              return (
                <div className="act-statcard">
                  <div className="act-statcard-h">Last 365 days <em>· tap a row to filter</em></div>
                  {present.length ? present.map(({ value }, i) => {
                    const v = yc[value];
                    const pct = Math.round((v / total) * 100);
                    const on = statFilter === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        className={`act-kpirow ${on ? 'on' : ''} ${statFilter && !on ? 'is-mute' : ''}`}
                        onClick={() => setStatFilter(on ? null : value)}
                      >
                        <i className="act-kpidot" style={{ background: soft(value).ink }} />
                        <span className="act-kpilab">{kpiLabel(value)}</span>
                        <span className="act-kpibar"><i style={{ width: animReady ? `${pct}%` : 0, background: soft(value).ink, transitionDelay: animReady ? `${i * 45}ms` : '0ms' }} /></span>
                        <span className="act-kpival"><CountUp value={v} run={animReady && !reduced} /></span>
                      </button>
                    );
                  }) : <p className="act-dp-empty" style={{ marginTop: 4 }}>No status data yet.</p>}
                </div>
              );
            })()}
          </div>

          {/* Column 3 — residency & visas */}
          <div className="act-col-res">
            {(() => {
              const vmap = {};
              vesselPos.forEach((p) => { if (p.country_code) vmap[String(p.observed_on).slice(0, 10)] = p.country_code; });
              const res = computeResidency({ today: today0(), periods, entries, vesselByDate: vmap, stampedOn: (day) => isStampedOn(stamps, day) });
              const visa = visaForCountry(res.vesselCountry, crewNat);
              const schPct = Math.min(100, Math.round((res.schengenUsed / 90) * 100));
              const visaInk = { free: '#2E7D52', limited: '#9A6A00', visa: '#B23B3B', unknown: '#6B7280' };
              if (!res.hasData) {
                return (
                  <div className="act-rescard">
                    <div className="act-res-h"><Icon name="Globe" size={13} /> Residency &amp; visas</div>
                    <div className="act-res-soon">No location data yet. Days fill in automatically as the vessel’s AIS position is logged each day, plus any travel/training locations.</div>
                  </div>
                );
              }
              return (
                <>
                  <div className="act-rescard">
                    <div className="act-res-h"><Icon name="Plane" size={13} /> Schengen · rolling 180 days</div>
                    <div className="act-res-figure">
                      <span className="act-res-num">{res.schengenUsed}<span className="act-res-den"> / 90</span></span>
                      <span>days used · {res.schengenUsed > 90
                        ? <b style={{ color: '#B23B3B' }}>{res.schengenUsed - 90} over limit</b>
                        : <b style={{ color: '#2E7D52' }}>{res.schengenRemaining} left today</b>}</span>
                    </div>
                    <div className="act-res-gauge"><i style={{ width: animReady ? `${schPct}%` : 0, background: res.schengenUsed >= 90 ? '#B23B3B' : (schPct >= 80 ? '#C65A1A' : '#C65A1A') }} /></div>
                    <div className="act-res-soon">Rolling window, so it eases over time{res.schengenEasesOn ? ` — the earliest counted day ages out on ${fmtDay(`${res.schengenEasesOn}T00:00:00`)}` : ''}.</div>
                  </div>

                  <div className="act-rescard">
                    <div className="act-res-h"><Icon name="Globe" size={13} /> Days by country · last 365</div>
                    <div style={{ marginTop: 10 }}>
                      {res.byCountry.slice(0, 5).map(({ code, days }) => (
                        <div key={code} className="act-taxrow">
                          <span>{countryName(code)}{SCHENGEN.has(code) ? <em> · Schengen</em> : null}</span>
                          <b>{days}</b>
                        </div>
                      ))}
                    </div>
                    <div className="act-res-soon">Located from the vessel's position aboard and logged travel ashore. Days we can't place aren't counted.</div>
                  </div>

                  <div className="act-rescard">
                    <div className="act-res-h"><Icon name="ShieldCheck" size={13} /> Visa — current vessel location</div>
                    {visa ? (
                      <>
                        <div className="act-visa-region">{visa.region === 'Schengen' ? `${countryName(res.vesselCountry)} · Schengen` : visa.region}</div>
                        <div className="act-visa-line"><i style={{ background: visaInk[visa.level] }} />{visa.text}</div>
                      </>
                    ) : <div className="act-res-soon">Vessel at sea / location unknown — no country to assess.</div>}
                    <div className="act-res-soon" style={{ marginTop: 10 }}>Guidance only — confirm entry requirements before travel.</div>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
        </>
      ) : (
        <>
          <div className="cp-group-head"><span className="dia">◆</span><span className="t">Activity log</span><span className="line" /></div>
          {presentCats.length > 0 && (
            <div className="act-pills">
              <button type="button" className={`act-pill ${filter === 'all' ? 'on' : ''}`} onClick={() => setFilter('all')}>All</button>
              {presentCats.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`act-pill ${filter === c.id ? 'on' : ''}`}
                  onClick={() => setFilter(c.id)}
                  style={filter === c.id ? { borderColor: c.color, color: c.color, background: c.bg } : undefined}
                >{c.label}</button>
              ))}
            </div>
          )}
          {shown.length === 0 ? (
            <p className="cd-muted">No activity recorded yet.</p>
          ) : (
            <div className="act-list">
              {shown.map((e) => {
                const c = activityCat(e.category);
                return (
                  <div key={e.id} className="act-item">
                    <span className="act-ic" style={{ background: c.bg }}><Icon name={c.icon} size={15} style={{ color: c.color }} /></span>
                    <div className="act-body">
                      <div className="act-title">{e.title}</div>
                      {e.detail && <div className="act-detail">{e.detail}</div>}
                      {e.actor && <div className="act-actor">by {e.actor}</div>}
                    </div>
                    <div className="act-when">{fmtDay(e.at)}</div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Add / edit leave-travel modal */}
      {entryOpen && (
        <div className="kit-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setEntryOpen(false); }}>
          <div className="kit-panel">
            <div className="kit-panel-head">
              <h4>{editing ? 'Edit entry' : 'Add leave / travel'}</h4>
              <button onClick={() => setEntryOpen(false)} className="kit-x" title="Close"><Icon name="X" size={18} /></button>
            </div>
            <div className="kit-form">
              <label className="kit-field"><span>Status</span>
                <select value={form.kind} onChange={(e) => setF('kind', e.target.value)}>
                  {CREW_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </label>
              <label className="kit-field"><span>Start date <em>required</em></span>
                <input type="date" value={form.startDate} onChange={(e) => setF('startDate', e.target.value)} />
              </label>
              <label className="kit-field"><span>End date</span>
                <input type="date" value={form.endDate} onChange={(e) => setF('endDate', e.target.value)} />
              </label>
              {form.kind === 'travelling' && (
                <>
                  <label className="kit-field"><span>Transport</span>
                    <select value={form.transport} onChange={(e) => setF('transport', e.target.value)}>
                      <option value="">—</option>
                      {TRANSPORTS.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </label>
                  <label className="kit-field"><span>Flight / transport no.</span>
                    <input value={form.transportNo} onChange={(e) => setF('transportNo', e.target.value)} placeholder="e.g. BA342" />
                  </label>
                  <label className="kit-field"><span>From</span>
                    <input value={form.fromLocation} onChange={(e) => setF('fromLocation', e.target.value)} placeholder="e.g. London (LHR)" />
                  </label>
                  <label className="kit-field"><span>To</span>
                    <input value={form.toLocation} onChange={(e) => setF('toLocation', e.target.value)} placeholder="e.g. Nice (NCE)" />
                  </label>
                  <label className="kit-field"><span>Depart</span>
                    <input value={form.departTime} onChange={(e) => setF('departTime', e.target.value)} placeholder="e.g. 09:40" />
                  </label>
                  <label className="kit-field"><span>Arrive</span>
                    <input value={form.arriveTime} onChange={(e) => setF('arriveTime', e.target.value)} placeholder="e.g. 12:55" />
                  </label>
                </>
              )}
              {form.kind === 'training_leave' && (
                <>
                  <label className="kit-field"><span>Location</span>
                    <input value={form.location} onChange={(e) => setF('location', e.target.value)} placeholder="e.g. Antibes, France" />
                  </label>
                  <label className="kit-field"><span>Country <em>residency</em></span>
                    <input value={form.locationCountry} onChange={(e) => setF('locationCountry', e.target.value)} placeholder="e.g. France" />
                  </label>
                </>
              )}
              <label className="kit-field kit-col-2"><span>Note <em>optional</em></span>
                <input value={form.note} onChange={(e) => setF('note', e.target.value)} placeholder="anything worth recording" />
              </label>
            </div>
            <div className="kit-panel-foot">
              <Button variant="outline" size="sm" onClick={() => setEntryOpen(false)}>Cancel</Button>
              <Button size="sm" onClick={saveEntry} disabled={busy}>{editing ? 'Save' : 'Add entry'}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StatusHistoryTab;
