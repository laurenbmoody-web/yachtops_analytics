// Voyages — the vessel's journey map.
//
// A standalone, Polarsteps-style view of where the boat has been: the AIS
// position trail from `vessel_positions` drawn as a track on a Google map, a
// clickable timeline of the stops (ports / anchorages) it rolled through, a
// "play" control that runs the vessel along the passage, and a per-stop detail
// panel carrying the real voyage facts plus any trip that covers those dates —
// the bridge to the crew / guests / papers that live on the trip page.
//
// Reads the CURRENT tenant's vessel via RLS, so it shows whichever boat you're
// signed in to. One position lands per day (see the ais-sync edge function), so
// the track thickens over time — a single pin on day one, a passage once moving.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Compass, MapPin, Navigation2, Anchor, Play, Pause, Route, Ship, CalendarDays, ArrowUpRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import { loadGoogleMaps, hasGoogleKey, MAP_STYLE_LIGHT, MAP_STYLE_DARK } from '../marketplace/gmaps';
import { fetchVoyageTrack, motionOf } from './utils/voyagesStorage';
import '../../styles/editorial.css';
import './vessel-voyages.css';

const TERRACOTTA = '#C65A1A';
const NAVY = '#1C1B3A';

function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(`${d}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return String(d);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(dt.getDate())}/${p(dt.getMonth() + 1)}/${dt.getFullYear()}`;
}
function daysAgo(d) {
  if (!d) return '';
  const dt = new Date(`${d}T00:00:00`);
  const days = Math.round((Date.now() - dt.getTime()) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return 'last week';
  return `${Math.round(days / 7)} weeks ago`;
}
function coordStr(lat, lon) {
  if (lat == null || lon == null) return '';
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(3)}°${ns}, ${Math.abs(lon).toFixed(3)}°${ew}`;
}
const isDarkTheme = () => {
  try {
    const r = document.documentElement;
    return r.getAttribute('data-theme') === 'night' || r.classList.contains('dark');
  } catch { return false; }
};
const titleCase = (s) => (s || '').replace(/\b\w/g, (c) => c.toUpperCase());

export default function VesselVoyages() {
  const navigate = useNavigate();
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [sel, setSel] = useState(0);
  const [playing, setPlaying] = useState(false);

  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const gRef = useRef(null);
  const markersRef = useRef([]);     // stop markers, by index
  const boatRef = useRef(null);      // moving vessel marker during playback
  const rafRef = useRef(null);
  const drawnRef = useRef(false);

  useEffect(() => {
    let alive = true;
    fetchVoyageTrack()
      .then((data) => { if (alive) { setState({ loading: false, error: null, data }); setSel(Math.max(0, (data.stops?.length || 1) - 1)); } })
      .catch((e) => { if (alive) setState({ loading: false, error: e?.message || 'Could not load positions', data: null }); });
    return () => { alive = false; };
  }, []);

  const data = state.data;
  const points = data?.points || [];
  const stops = data?.stops || [];
  const latest = data?.latest || null;
  const vesselName = (data?.vessel?.name || 'Vessel').trim();
  const stateWord = latest ? motionOf(latest) : 'no fixes';
  const selStop = stops[sel] || null;

  // Restyle stop markers to reflect the current selection.
  const paintMarkers = useCallback(() => {
    const g = gRef.current;
    if (!g) return;
    markersRef.current.forEach((mk, i) => {
      if (!mk) return;
      const isSel = i === sel;
      const isLatest = i === stops.length - 1;
      mk.setIcon({
        path: g.SymbolPath.CIRCLE,
        scale: isSel ? 8.5 : (isLatest ? 7 : 5),
        fillColor: isSel ? TERRACOTTA : (isLatest ? TERRACOTTA : NAVY),
        fillOpacity: isLatest || isSel ? 1 : 0.9,
        strokeColor: '#FFFFFF',
        strokeWeight: isSel ? 3 : 2,
      });
      mk.setZIndex(isSel ? 6 : (isLatest ? 5 : 3));
    });
  }, [sel, stops.length]);

  // Build + draw the map once we have points and the Maps key.
  useEffect(() => {
    if (!points.length || !hasGoogleKey() || drawnRef.current) return undefined;
    let alive = true;
    loadGoogleMaps().then((g) => {
      if (!alive || !containerRef.current) return;
      gRef.current = g;
      const map = new g.Map(containerRef.current, {
        center: { lat: latest.lat, lng: latest.lon },
        zoom: points.length > 1 ? 6 : 9,
        styles: isDarkTheme() ? MAP_STYLE_DARK : MAP_STYLE_LIGHT,
        disableDefaultUI: true, zoomControl: true, gestureHandling: 'greedy',
        clickableIcons: false, backgroundColor: isDarkTheme() ? '#0F1720' : '#CDDFE3',
      });
      mapRef.current = map;
      drawnRef.current = true;

      const path = points.map((p) => ({ lat: p.lat, lng: p.lon }));
      if (path.length > 1) {
        new g.Polyline({ map, path, geodesic: true, strokeColor: TERRACOTTA, strokeOpacity: 0.85, strokeWeight: 3 });
      }

      // One marker per stop; click selects it.
      markersRef.current = stops.map((s, i) => {
        const mk = new g.Marker({
          map, position: { lat: s.lat, lng: s.lon },
          title: [s.place || s.country || 'Stop', `${fmtDate(s.from)}${s.to !== s.from ? ` – ${fmtDate(s.to)}` : ''}`].join(' · '),
          icon: { path: g.SymbolPath.CIRCLE, scale: 5, fillColor: NAVY, fillOpacity: 0.9, strokeColor: '#FFFFFF', strokeWeight: 2 },
        });
        mk.addListener('click', () => { setPlaying(false); setSel(i); });
        return mk;
      });

      if (path.length > 1) {
        const b = new g.LatLngBounds();
        path.forEach((pt) => b.extend(pt));
        map.fitBounds(b, 64);
      }
      paintMarkers();
    }).catch(() => { /* key/load failure — list still renders */ });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, stops, latest]);

  // Re-skin markers + pan to the selected stop when selection changes.
  useEffect(() => {
    paintMarkers();
    const map = mapRef.current;
    if (map && selStop && !playing) map.panTo({ lat: selStop.lat, lng: selStop.lon });
  }, [sel, selStop, playing, paintMarkers]);

  // "Play" the passage: run a marker along the real track, stepping the
  // selection to each stop as it's passed. Linear interpolation per segment.
  const togglePlay = useCallback(() => {
    const g = gRef.current, map = mapRef.current;
    if (!g || !map || points.length < 2) return;
    if (playing) { setPlaying(false); cancelAnimationFrame(rafRef.current); return; }
    setPlaying(true);

    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const segs = [];
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      const d = Math.hypot(points[i].lat - points[i - 1].lat, points[i].lon - points[i - 1].lon);
      segs.push(d); total += d;
    }
    // date of each point → map a point index back to its stop index
    const stopIndexForPoint = points.map((p) => {
      let idx = 0;
      stops.forEach((s, si) => { if (p.date >= s.from) idx = si; });
      return idx;
    });

    if (!boatRef.current) {
      boatRef.current = new g.Marker({
        map, zIndex: 9,
        icon: { path: g.SymbolPath.CIRCLE, scale: 7, fillColor: TERRACOTTA, fillOpacity: 1, strokeColor: '#FFFFFF', strokeWeight: 3 },
      });
    }
    boatRef.current.setMap(map);

    const DUR = reduce ? 0 : 6500;
    const t0 = performance.now();
    const step = (now) => {
      const u = DUR ? Math.min(1, (now - t0) / DUR) : 1;
      const want = u * total;
      let acc = 0, i = 0;
      while (i < segs.length && acc + segs[i] < want) { acc += segs[i]; i++; }
      const segU = segs[i] ? (want - acc) / segs[i] : 0;
      const a = points[Math.min(i, points.length - 1)];
      const b = points[Math.min(i + 1, points.length - 1)];
      const lat = a.lat + (b.lat - a.lat) * segU;
      const lon = a.lon + (b.lon - a.lon) * segU;
      boatRef.current.setPosition({ lat, lng: lon });
      const si = stopIndexForPoint[Math.min(i + 1, points.length - 1)];
      setSel((prev) => (prev === si ? prev : si));
      if (u < 1) rafRef.current = requestAnimationFrame(step);
      else { setPlaying(false); if (boatRef.current) boatRef.current.setMap(null); }
    };
    rafRef.current = requestAnimationFrame(step);
  }, [playing, points, stops]);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const timeline = useMemo(() => stops.map((s, i) => ({ s, i })).reverse(), [stops]);
  const mapUnavailable = !hasGoogleKey();

  return (
    <>
      <Header />
      <div className="vv-page">
        <div className="vv-wrap">
          <p className="editorial-meta">
            <span className="dot">●</span> VOYAGES
            <span className="bar" /> <span className="muted">{vesselName.toUpperCase()}</span>
            {data?.vessel?.mmsi && (<><span className="bar" /> <span className="muted">MMSI {data.vessel.mmsi}</span></>)}
            <span className="bar" /> <span className="muted">{points.length} {points.length === 1 ? 'FIX' : 'FIXES'}</span>
            {data?.totalNm > 0 && (<><span className="bar" /> <span className="muted">{data.totalNm} NM LOGGED</span></>)}
          </p>
          <h1 className="editorial-greeting">
            {vesselName.toUpperCase()}<span className="period">,</span> <em>{stateWord}</em><span className="period">.</span>
          </h1>

          {state.loading && <p className="vv-empty">Charting the track…</p>}

          {!state.loading && !points.length && (
            <div className="vv-blank">
              <Compass size={40} strokeWidth={1.4} />
              <h2>No positions logged yet.</h2>
              <p>
                Once the vessel has an MMSI and the daily AIS sync has a fix, each day's
                position lands here and the track draws itself. A single pin to start, a
                full passage once she's moving.
              </p>
            </div>
          )}

          {!state.loading && points.length > 0 && (
            <>
              <div className="vv-main">
                <div className="vv-mapwrap">
                  {mapUnavailable ? (
                    <div className="vv-map-placeholder">
                      <MapPin size={28} strokeWidth={1.5} />
                      <p>Map needs a Google Maps key (<code>VITE_GOOGLE_MAPS_API_KEY</code>). The track is listed on the right.</p>
                    </div>
                  ) : (
                    <>
                      <div ref={containerRef} className="vv-map" />
                      {selStop && (
                        <div className="vv-capbar">
                          <span className="vv-capbar-mt">{titleCase(selStop.lastMotion)}</span>
                          <span className="vv-capbar-loc">{selStop.place || selStop.country || coordStr(selStop.lat, selStop.lon)}</span>
                        </div>
                      )}
                      {points.length > 1 && (
                        <div className="vv-mapctrl">
                          <button type="button" onClick={togglePlay} aria-label={playing ? 'Pause the passage' : 'Play the passage'}>
                            {playing ? <Pause size={18} strokeWidth={2.2} fill="currentColor" /> : <Play size={18} strokeWidth={2.2} fill="currentColor" />}
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>

                <aside className="vv-rail">
                  <p className="vv-rail-h">The track</p>
                  <ul className="vv-stops">
                    {timeline.map(({ s, i }) => {
                      const current = i === stops.length - 1;
                      const isSel = i === sel;
                      const range = s.to !== s.from ? `${fmtDate(s.from)} – ${fmtDate(s.to)}` : fmtDate(s.from);
                      const nights = s.nights > 0 ? `${s.nights} ${s.nights === 1 ? 'night' : 'nights'}` : 'passing';
                      return (
                        <li key={`${s.from}-${s.lat}`} className={`vv-stop${isSel ? ' is-sel' : ''}`}
                            onClick={() => { setPlaying(false); setSel(i); }}>
                          <span className="vv-stop-dot">{s.lastMotion === 'at anchor' ? <Anchor size={13} strokeWidth={2} /> : <MapPin size={13} strokeWidth={2} />}</span>
                          <div className="vv-stop-body">
                            <p className="vv-stop-place">{s.place || s.country || coordStr(s.lat, s.lon)}{current && <span className="vv-now">now</span>}</p>
                            <p className="vv-stop-meta">{range}<span className="vv-sep">·</span>{nights}</p>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </aside>
              </div>

              {selStop && (
                <div className="vv-detail">
                  <div className="vv-dhead">
                    <h2 className="vv-dtitle">{selStop.place || selStop.country || 'At sea'}</h2>
                    <span className="vv-dsub">
                      {fmtDate(selStop.from)}{selStop.to !== selStop.from ? ` – ${fmtDate(selStop.to)}` : ''}
                      <span className="vv-sep">·</span>{titleCase(selStop.lastMotion)}
                      {sel === stops.length - 1 && <span className="vv-sep">·</span>}{sel === stops.length - 1 && daysAgo(selStop.to)}
                    </span>
                  </div>

                  <div className="vv-facts">
                    <div className="vv-fact">
                      <p className="vv-fl"><Anchor size={12} strokeWidth={2} /> Time here</p>
                      <p className="vv-fv">{selStop.nights > 0 ? `${selStop.nights} ${selStop.nights === 1 ? 'night' : 'nights'}` : 'Passing through'}</p>
                      <p className="vv-fs">{selStop.to !== selStop.from ? `${fmtDate(selStop.from)} – ${fmtDate(selStop.to)}` : fmtDate(selStop.from)}</p>
                    </div>
                    <div className="vv-fact">
                      <p className="vv-fl"><Route size={12} strokeWidth={2} /> Leg in</p>
                      <p className="vv-fv">{sel === 0 ? 'Start of track' : `${selStop.legNm} NM`}</p>
                      <p className="vv-fs">{sel === 0 ? 'First recorded fix' : `${selStop.legKm} km · ${selStop.legDays} ${selStop.legDays === 1 ? 'day' : 'days'} underway`}</p>
                    </div>
                    <div className="vv-fact">
                      <p className="vv-fl"><Navigation2 size={12} strokeWidth={2} /> Position</p>
                      <p className="vv-fv">{coordStr(selStop.lat, selStop.lon)}</p>
                      <p className="vv-fs">{selStop.zone ? titleCase(selStop.zone.replace(/_/g, ' ')) : 'Position fix'}{selStop.source ? ` · ${selStop.source.toUpperCase()}` : ''}</p>
                    </div>
                    <div className="vv-fact">
                      <p className="vv-fl"><MapPin size={12} strokeWidth={2} /> Waters</p>
                      <p className="vv-fv">{selStop.country || '—'}</p>
                      <p className="vv-fs">
                        {selStop.schengen === true ? 'Counts as Schengen presence'
                          : selStop.schengen === false ? 'Outside Schengen'
                          : 'Country unresolved (offshore)'}
                      </p>
                    </div>
                  </div>

                  <div className={`vv-trip${selStop.trip ? '' : ' is-empty'}`}>
                    {selStop.trip ? (
                      <>
                        <div className="vv-trip-body">
                          <p className="vv-trip-eyebrow"><Ship size={12} strokeWidth={2} /> On this leg</p>
                          <p className="vv-trip-name">{selStop.trip.name}</p>
                          <p className="vv-trip-meta">
                            {titleCase(selStop.trip.trip_type || 'Trip')}
                            <span className="vv-sep">·</span>{fmtDate(selStop.trip.start_date)} – {fmtDate(selStop.trip.end_date)}
                          </p>
                          {selStop.trip.itinerary_summary && <p className="vv-trip-sum">{selStop.trip.itinerary_summary}</p>}
                          <p className="vv-trip-hint">Guests aboard, crew on watch, port papers and provisioning for this leg live on the trip.</p>
                        </div>
                        <button type="button" className="vv-trip-link" onClick={() => navigate('/trips-management-dashboard')}>
                          <CalendarDays size={15} strokeWidth={2} /> View trip <ArrowUpRight size={14} strokeWidth={2} />
                        </button>
                      </>
                    ) : (
                      <div className="vv-trip-body">
                        <p className="vv-trip-eyebrow"><Ship size={12} strokeWidth={2} /> On this leg</p>
                        <p className="vv-trip-empty">No trip logged for these dates. Create a trip over this period and its crew, guests and paperwork link here.</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
