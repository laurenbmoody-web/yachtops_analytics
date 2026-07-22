import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../../components/AppIcon';
import { useAuth } from '../../../contexts/AuthContext';
import { supabase } from '../../../lib/supabaseClient';
import { getStatusLabel } from '../../../utils/crewStatus';
import './today-widget.css';

// Today widget — vessel-anchored. A weather hero (live conditions + sun times
// at the vessel's AIS position), an expandable 7-day → month date strip, and
// the selected day's agenda across three streams:
//   • group    — vessel trips (charters / owner trips), tenant-wide
//   • crew     — crew changes (leave, travel, joins) from crew_calendar_entries
//   • personal — the viewer's own personal_calendar_events
// Picking a date shows that day; the widget resets to today on return.

const HORIZON = 45; // days of events to hold (covers a month-forward view)
const BACK = 7;     // days back so an ongoing trip/leave is in range
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad2 = (n) => String(n).padStart(2, '0');
const toYmd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const addDays = (ymd, n) => { const [y, m, d] = ymd.split('-').map(Number); const dt = new Date(y, m - 1, d + n); return toYmd(dt); };
const parse = (ymd) => new Date(`${ymd}T00:00:00`);
const dm = (ymd) => { const d = parse(ymd); return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`; };
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'Crew';
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const cleanLoc = (l) => String(l || '').replace(/\s*\([A-Z]{3}\)\s*$/, '').trim();

// WMO weather code → [lucide icon, label].
const wx = (code) => {
  if (code == null) return ['CloudSun', ''];
  if (code === 0) return ['Sun', 'Clear'];
  if (code <= 2) return ['CloudSun', 'Partly cloudy'];
  if (code === 3) return ['Cloud', 'Overcast'];
  if (code <= 48) return ['CloudFog', 'Fog'];
  if (code <= 57) return ['CloudDrizzle', 'Drizzle'];
  if (code <= 67) return ['CloudRain', 'Rain'];
  if (code <= 77) return ['CloudSnow', 'Snow'];
  if (code <= 82) return ['CloudRain', 'Showers'];
  if (code <= 86) return ['CloudSnow', 'Snow showers'];
  return ['CloudLightning', 'Storm'];
};
const countryName = (cc) => {
  if (!cc) return null;
  try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(cc.toUpperCase()); } catch { return cc; }
};

// Great-circle distance (km) between two {lat, lon} — used to tell "aboard"
// (device near the vessel) from "ashore" (on leave in another region).
const distKm = (a, b) => {
  const R = 6371; const toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR; const dLon = (b.lon - a.lon) * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
};
// If the device is within this of the vessel's last fix, treat it as aboard and
// prefer the phone's live GPS. Generous, so a day's steaming since the daily AIS
// fix still counts as aboard, while on-leave (different region) does not.
const ABOARD_KM = 250;
// The browser's device position (like a phone's location services). Resolves
// null on denial / unavailable / timeout — never throws.
const getDevicePos = () => new Promise((resolve) => {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null);
  navigator.geolocation.getCurrentPosition(
    (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
    () => resolve(null),
    { timeout: 8000, maximumAge: 10 * 60 * 1000, enableHighAccuracy: false },
  );
});

// Monday-led matrix of the month containing `anchor` (6 weeks of YMD strings).
function monthMatrix(anchor) {
  const d = parse(anchor); const y = d.getFullYear(); const m = d.getMonth();
  const first = new Date(y, m, 1);
  const lead = (first.getDay() + 6) % 7; // Mon=0
  const startYmd = toYmd(new Date(y, m, 1 - lead));
  return { month: m, year: y, cells: Array.from({ length: 42 }, (_, i) => addDays(startYmd, i)) };
}

const TodayWidget = () => {
  const navigate = useNavigate();
  const { user, activeTenantId } = useAuth();

  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [weather, setWeather] = useState(null); // {temp, code, sunrise, sunset, place} | null
  const [wxLoading, setWxLoading] = useState(true);

  const todayStr = toYmd(new Date());
  const [selDate, setSelDate] = useState(todayStr);
  const [monthAnchor, setMonthAnchor] = useState(todayStr);
  const [expanded, setExpanded] = useState(false);

  const loadStart = addDays(todayStr, -BACK);
  const loadEnd = addDays(todayStr, HORIZON);

  const load = useCallback(async () => {
    if (!activeTenantId || !user?.id) { setEvents([]); setLoading(false); return; }
    setLoading(true); setError(false);
    try {
      const [membersRes, tripsRes, crewRes, persRes] = await Promise.all([
        supabase.from('tenant_members').select('user_id, display_name').eq('tenant_id', activeTenantId),
        supabase.from('trips').select('id, name, trip_type, start_date, end_date, is_deleted')
          .eq('tenant_id', activeTenantId).lte('start_date', loadEnd).gte('end_date', loadStart),
        supabase.from('crew_calendar_entries')
          .select('id, user_id, kind, note, from_location, to_location, start_date, end_date')
          .eq('tenant_id', activeTenantId).lte('start_date', loadEnd).gte('end_date', loadStart),
        supabase.from('personal_calendar_events').select('id, title, start_at, end_at, location')
          .eq('user_id', user.id).gte('start_at', `${loadStart}T00:00:00`).lte('start_at', `${loadEnd}T23:59:59`),
      ]);
      if (tripsRes.error) throw tripsRes.error;
      if (crewRes.error) throw crewRes.error;

      const nameByUser = new Map((membersRes.data || []).map((m) => [m.user_id, m.display_name]));
      const out = [];
      for (const t of (tripsRes.data || [])) {
        if (t.is_deleted) continue;
        out.push({
          id: `trip-${t.id}`, cat: 'group', to: '/trips-management-dashboard',
          start: t.start_date, end: t.end_date, tag: cap(t.trip_type) || null,
          title: (t.name || '').trim() || `${cap(t.trip_type) || 'Trip'}`,
          sub: t.end_date > t.start_date ? `${dm(t.start_date)} → ${dm(t.end_date)}` : (cap(t.trip_type) || 'Trip'),
        });
      }
      for (const c of (crewRes.data || [])) {
        const route = c.from_location && c.to_location ? `${cleanLoc(c.from_location)} → ${cleanLoc(c.to_location)}` : null;
        out.push({
          id: `crew-${c.id}`, cat: 'crew', to: '/crew-management',
          start: c.start_date, end: c.end_date || c.start_date,
          title: `${firstName(nameByUser.get(c.user_id))} · ${(c.note || '').trim() || getStatusLabel(c.kind)}`,
          sub: route || getStatusLabel(c.kind),
        });
      }
      for (const p of (persRes?.data || [])) {
        const day = String(p.start_at).slice(0, 10);
        const time = String(p.start_at).slice(11, 16);
        out.push({
          id: `pers-${p.id}`, cat: 'personal', to: '/ops-vessel-calendar',
          start: day, end: String(p.end_at || p.start_at).slice(0, 10),
          time: time && time !== '00:00' ? time : null,
          title: p.title || 'Personal event', sub: p.location || 'Personal',
        });
      }
      setEvents(out);
    } catch (err) {
      console.error('[TodayWidget] fetch error:', err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [activeTenantId, user?.id, loadStart, loadEnd]);

  // Weather + sun times at the vessel's latest AIS position. Client-side:
  // read the position (RLS-gated), then keyless Open-Meteo + a best-effort
  // reverse geocode for the place name. Cached 30 min per position.
  const loadWeather = useCallback(async () => {
    if (!activeTenantId) { setWxLoading(false); return; }
    setWxLoading(true);
    try {
      // The vessel's last AIS fix (daily) and the device's live GPS (like a
      // phone). Fetch both in parallel; getDevicePos never throws.
      const [posRes, device] = await Promise.all([
        supabase.from('vessel_positions')
          .select('latitude, longitude, country_code, observed_at')
          .eq('tenant_id', activeTenantId).order('observed_at', { ascending: false }).limit(1).maybeSingle(),
        getDevicePos(),
      ]);
      const pos = posRes?.data;
      const vessel = pos?.latitude && pos?.longitude ? { lat: pos.latitude, lon: pos.longitude } : null;

      // Prefer the device's live position when it's plausibly aboard (near the
      // vessel, or there's no vessel fix). Ashore on leave → fall back to the
      // vessel so the widget still shows the boat's weather.
      let coords = vessel;
      if (device && (!vessel || distKm(device, vessel) <= ABOARD_KM)) coords = device;
      if (!coords) { setWeather(null); setWxLoading(false); return; }
      const lat = coords.lat; const lon = coords.lon;
      const ccFallback = coords === vessel ? pos.country_code : null;

      const key = `cargo_wx_${lat.toFixed(2)}_${lon.toFixed(2)}`;
      const cached = (() => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } })();
      if (cached && Date.now() - cached.t < 30 * 60 * 1000) { setWeather(cached.w); setWxLoading(false); return; }

      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&daily=sunrise,sunset&timezone=auto&forecast_days=1`;
      const wxData = await fetch(url).then((r) => r.json());
      let place = countryName(ccFallback);
      try {
        const g = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`).then((r) => r.json());
        const local = g.locality || g.city || g.principalSubdivision;
        if (local) place = g.countryName && local !== g.countryName ? `${local}, ${g.countryName}` : local;
      } catch { /* keep country fallback */ }

      const w = {
        temp: Math.round(wxData?.current?.temperature_2m),
        code: wxData?.current?.weather_code,
        sunrise: String(wxData?.daily?.sunrise?.[0] || '').slice(11, 16) || null,
        sunset: String(wxData?.daily?.sunset?.[0] || '').slice(11, 16) || null,
        place,
      };
      try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), w })); } catch { /* ignore */ }
      setWeather(Number.isFinite(w.temp) ? w : null);
    } catch (err) {
      console.warn('[TodayWidget] weather failed:', err?.message);
      setWeather(null);
    } finally {
      setWxLoading(false);
    }
  }, [activeTenantId]);

  useEffect(() => { load(); loadWeather(); }, [load, loadWeather]);
  // On return to the page, refetch and snap back to today.
  useEffect(() => {
    const onFocus = () => { setSelDate(todayStr); setMonthAnchor(todayStr); setExpanded(false); load(); loadWeather(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load, loadWeather, todayStr]);

  // Events active on a given day (overlap), point/personal events first-in.
  const eventsOn = useCallback((day) => events
    .filter((e) => e.start <= day && e.end >= day)
    .sort((a, b) => (a.time || '99').localeCompare(b.time || '99') || a.cat.localeCompare(b.cat)), [events]);

  const catsOn = useCallback((day) => {
    const s = new Set();
    for (const e of events) if (e.start <= day && e.end >= day) s.add(e.cat);
    return [...s];
  }, [events]);

  const strip = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(todayStr, i)), [todayStr]);
  const month = useMemo(() => monthMatrix(monthAnchor), [monthAnchor]);
  const dayEvents = useMemo(() => eventsOn(selDate), [eventsOn, selDate]);

  const [wxIcon, wxLabel] = wx(weather?.code);

  const dayLabel = (() => {
    if (selDate === todayStr) return 'Today · ' + `${WD[parse(selDate).getDay()]} ${parse(selDate).getDate()}`;
    if (selDate === addDays(todayStr, 1)) return 'Tomorrow · ' + `${WD[parse(selDate).getDay()]} ${parse(selDate).getDate()}`;
    const d = parse(selDate);
    return `${WD[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()].slice(0, 3)}`;
  })();

  const whenFor = (e) => {
    if (e.time) return { text: e.time, now: false };
    if (e.start < selDate && e.end > selDate) return { text: 'ongoing', now: true };
    if (e.start <= todayStr && e.end >= todayStr && selDate === todayStr && e.end > e.start) return { text: 'now', now: true };
    if (e.end > e.start && e.start === selDate) return { text: `→ ${dm(e.end)}`, now: false };
    if (e.end > e.start && e.end === selDate) return { text: 'ends', now: false };
    return { text: '', now: false };
  };

  const Cell = ({ day, dow }) => {
    const inMonth = expanded ? parse(day).getMonth() === month.month : true;
    const d = parse(day);
    return (
      <button
        type="button"
        className={`td-cell${inMonth ? '' : ' out'}${day === todayStr ? ' is-today' : ''}${day === selDate ? ' is-sel' : ''}`}
        onClick={() => setSelDate(day)}
        aria-label={`${WD[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`}
      >
        {dow && <span className="dowm">{WD[d.getDay()][0]}</span>}
        <span className="n">{d.getDate()}</span>
        <span className="td-dots">{catsOn(day).map((c) => <i key={c} className={`td-dot is-${c}`} />)}</span>
      </button>
    );
  };

  return (
    <div className="ce-card td-cats rounded-xl p-5">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="ce-title">Today</h3>
          <p className="ce-status">{parse(todayStr).getDate()} {MON[parse(todayStr).getMonth()]} {parse(todayStr).getFullYear()}</p>
        </div>
        <button type="button" className="ce-link" onClick={() => navigate('/ops-vessel-calendar')}>Open calendar</button>
      </div>

      {/* Weather hero */}
      {wxLoading ? (
        <div className="td-wx-skel" style={{ marginBottom: 15 }} />
      ) : weather ? (
        <div className="td-wx">
          <div className="td-wx-l">
            <span className="td-wx-ic"><Icon name={wxIcon} size={20} /></span>
            <span className="td-wx-temp">{weather.temp}<span className="deg">°</span></span>
            <span className="td-wx-txt">{wxLabel}{weather.place ? <> · <b>{weather.place}</b></> : null}</span>
          </div>
          {(weather.sunrise || weather.sunset) && (
            <div className="td-wx-sun">
              <span className="td-wx-s"><Icon name="Sunrise" size={12} /> {weather.sunrise}</span>
              <span className="td-wx-s"><Icon name="Sunset" size={12} /> {weather.sunset}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="td-wx" style={{ paddingBottom: 12 }}>
          <span className="td-wx-off"><Icon name="MapPinOff" size={14} /> Location unavailable</span>
        </div>
      )}

      {/* Date strip / month */}
      <div className="td-strip-hd">
        <span className="td-strip-mo">{expanded ? `${MON[month.month]} ${month.year}` : 'This week'}</span>
        <div className="td-strip-nav">
          {expanded && (
            <>
              <button type="button" className="td-ex" onClick={() => setMonthAnchor(addDays(monthAnchor, -28))} aria-label="Previous month"><Icon name="ChevronLeft" size={15} /></button>
              <button type="button" className="td-ex" onClick={() => setMonthAnchor(addDays(monthAnchor, 35))} aria-label="Next month"><Icon name="ChevronRight" size={15} /></button>
            </>
          )}
          <button type="button" className="td-ex" onClick={() => { setExpanded((v) => !v); setMonthAnchor(selDate); }} aria-label={expanded ? 'Collapse to week' : 'Expand to month'}>
            <Icon name={expanded ? 'ChevronUp' : 'CalendarDays'} size={15} />
          </button>
        </div>
      </div>

      {expanded && <div className="td-dow">{DOW.map((d, i) => <span key={i}>{d}</span>)}</div>}
      <div className="td-grid" style={expanded ? undefined : { gridAutoFlow: 'column' }}>
        {(expanded ? month.cells : strip).map((day) => <Cell key={day} day={day} dow={!expanded} />)}
      </div>

      {/* Selected day's agenda */}
      <div className="td-divider" />
      <div className={`td-daylab${selDate === todayStr ? ' is-today' : ''}`}>{dayLabel}</div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <div className="td-skel" style={{ height: 34 }} /><div className="td-skel" style={{ height: 34 }} />
        </div>
      ) : error ? (
        <div className="td-err">
          <Icon name="AlertTriangle" size={16} /> Couldn’t load the day.
          <button type="button" className="td-retry" onClick={load}>Retry</button>
        </div>
      ) : dayEvents.length === 0 ? (
        <div className="td-none">Nothing on this day.</div>
      ) : (
        dayEvents.map((e) => {
          const w = whenFor(e);
          return (
            <div key={e.id} className={`td-ev is-${e.cat}`} onClick={() => navigate(e.to)} role="link" tabIndex={0} onKeyDown={(ev) => ev.key === 'Enter' && navigate(e.to)}>
              <span className="td-ev-rail" />
              <div className="td-ev-main">
                <div className="td-ev-t">{e.cat === 'group' && e.tag && <span className="tag">{e.tag}</span>}{e.title}</div>
                <div className="td-ev-s">{e.sub}</div>
              </div>
              {w.text && <span className={`td-ev-when${w.now ? ' is-now' : ''}`}>{w.text}</span>}
            </div>
          );
        })
      )}
    </div>
  );
};

export default TodayWidget;
