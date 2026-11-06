// Voyages — the vessel's journey map.
//
// A standalone, Polarsteps-style view of where the boat has been: the AIS
// position trail from `vessel_positions` drawn as a track on the map, with a
// timeline of the stops (ports / anchorages) it rolled through. Reads the
// CURRENT tenant's vessel via RLS, so it shows whichever boat you're signed in
// to. One position lands per day (see the ais-sync edge function), so the track
// thickens over time — a single pin on day one, a real passage after a crossing.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Compass, MapPin, Navigation2, Anchor } from 'lucide-react';
import Header from '../../components/navigation/Header';
import { loadGoogleMaps, hasGoogleKey, MAP_STYLE_LIGHT, MAP_STYLE_DARK } from '../marketplace/gmaps';
import { fetchVoyageTrack, motionOf } from './utils/voyagesStorage';
import '../../styles/editorial.css';
import './vessel-voyages.css';

const TERRACOTTA = '#C65A1A';
const NAVY = '#1C1B3A';

// dd/mm/yyyy (zero-padded) — the Cargo date convention.
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

export default function VesselVoyages() {
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const gRef = useRef(null);
  const drawnRef = useRef(false);

  useEffect(() => {
    let alive = true;
    fetchVoyageTrack()
      .then((data) => { if (alive) setState({ loading: false, error: null, data }); })
      .catch((e) => { if (alive) setState({ loading: false, error: e?.message || 'Could not load positions', data: null }); });
    return () => { alive = false; };
  }, []);

  const data = state.data;
  const points = data?.points || [];
  const stops = data?.stops || [];
  const latest = data?.latest || null;
  const vesselName = (data?.vessel?.name || 'Vessel').trim();
  const stateWord = latest ? motionOf(latest) : 'no fixes';

  // Build + draw the map once we have points and the Maps key.
  useEffect(() => {
    if (!points.length || !hasGoogleKey() || drawnRef.current) return undefined;
    let alive = true;
    loadGoogleMaps().then((g) => {
      if (!alive || !containerRef.current) return;
      gRef.current = g;
      const center = { lat: latest.lat, lng: latest.lon };
      const map = new g.Map(containerRef.current, {
        center, zoom: points.length > 1 ? 6 : 9,
        styles: isDarkTheme() ? MAP_STYLE_DARK : MAP_STYLE_LIGHT,
        disableDefaultUI: true, zoomControl: true, gestureHandling: 'greedy',
        clickableIcons: false, backgroundColor: isDarkTheme() ? '#0F1720' : '#CDDFE3',
      });
      mapRef.current = map;
      drawnRef.current = true;

      const path = points.map((p) => ({ lat: p.lat, lng: p.lon }));

      // The track line.
      if (path.length > 1) {
        new g.Polyline({
          map, path, geodesic: true,
          strokeColor: TERRACOTTA, strokeOpacity: 0.85, strokeWeight: 3,
        });
      }

      // Start marker (where the record begins).
      if (path.length > 1) {
        new g.Marker({
          map, position: path[0], title: 'Start of track', zIndex: 2,
          icon: { path: g.SymbolPath.CIRCLE, scale: 5, fillColor: '#FFFFFF', fillOpacity: 1, strokeColor: NAVY, strokeWeight: 2 },
        });
      }

      // Stop markers (ports / anchorages the boat sat at).
      stops.forEach((s, i) => {
        const isLast = i === stops.length - 1;
        if (isLast) return; // the latest position gets its own vessel marker
        new g.Marker({
          map, position: { lat: s.lat, lng: s.lon },
          title: [s.place || s.country || 'Stop', `${fmtDate(s.from)}${s.to !== s.from ? ` – ${fmtDate(s.to)}` : ''}`].join(' · '),
          zIndex: 2,
          icon: { path: g.SymbolPath.CIRCLE, scale: 4.5, fillColor: NAVY, fillOpacity: 0.9, strokeColor: '#FFFFFF', strokeWeight: 1.5 },
        });
      });

      // Latest position — the vessel, in terracotta.
      new g.Marker({
        map, position: center,
        title: [vesselName, motionOf(latest), coordStr(latest.lat, latest.lon)].filter(Boolean).join(' · '),
        zIndex: 4,
        icon: { path: g.SymbolPath.CIRCLE, scale: 8, fillColor: TERRACOTTA, fillOpacity: 1, strokeColor: '#FFFFFF', strokeWeight: 3 },
      });

      if (path.length > 1) {
        const b = new g.LatLngBounds();
        path.forEach((pt) => b.extend(pt));
        map.fitBounds(b, 64);
      }
    }).catch(() => { /* key/load failure — the list still renders */ });
    return () => { alive = false; };
  }, [points, stops, latest, vesselName]);

  // Stops newest-first for the timeline rail.
  const timeline = useMemo(() => [...stops].reverse(), [stops]);
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
            <span className="bar" /> <span className="muted">{points.length} {points.length === 1 ? 'FIX' : 'FIXES'} LOGGED</span>
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
            <div className="vv-main">
              <div className="vv-mapwrap">
                {mapUnavailable ? (
                  <div className="vv-map-placeholder">
                    <MapPin size={28} strokeWidth={1.5} />
                    <p>Map needs a Google Maps key (<code>VITE_GOOGLE_MAPS_API_KEY</code>). The track is listed on the right.</p>
                  </div>
                ) : (
                  <div ref={containerRef} className="vv-map" />
                )}
                {latest && (
                  <div className="vv-latest">
                    <span className="vv-latest-eyebrow"><Navigation2 size={13} strokeWidth={2} /> Latest position</span>
                    <p className="vv-latest-place">{latest.place || latest.country || coordStr(latest.lat, latest.lon)}</p>
                    <p className="vv-latest-meta">
                      {motionOf(latest)}<span className="vv-sep">·</span>{coordStr(latest.lat, latest.lon)}
                      <span className="vv-sep">·</span>{fmtDate(latest.date)} ({daysAgo(latest.date)})
                    </p>
                  </div>
                )}
              </div>

              <aside className="vv-rail">
                <p className="vv-rail-h">The track</p>
                <ul className="vv-stops">
                  {timeline.map((s, i) => {
                    const current = i === 0;
                    const range = s.to !== s.from ? `${fmtDate(s.from)} – ${fmtDate(s.to)}` : fmtDate(s.from);
                    const nights = s.nights > 0 ? `${s.nights} ${s.nights === 1 ? 'night' : 'nights'}` : 'passing';
                    return (
                      <li key={`${s.from}-${s.lat}`} className={`vv-stop${current ? ' is-current' : ''}`}>
                        <span className="vv-stop-dot">{s.lastMotion === 'at anchor' ? <Anchor size={13} strokeWidth={2} /> : <MapPin size={13} strokeWidth={2} />}</span>
                        <div className="vv-stop-body">
                          <p className="vv-stop-place">{s.place || s.country || coordStr(s.lat, s.lon)}</p>
                          <p className="vv-stop-meta">{range}<span className="vv-sep">·</span>{nights}{current && <span className="vv-now">now</span>}</p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </aside>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
