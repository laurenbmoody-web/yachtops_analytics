// The Chart — marketplace map popover.
//
// Opens off the "serves my area" field. The crew sets a point three
// ways — type an area and Search, click straight on the map, or pan and
// hit "Search this area". We light up the shops whose service radius
// reaches that point. Each shop is one labelled pin (at the centre of
// the ports it covers) with its combined reach drawn as dashed rings.
//
// Leaflet + OpenStreetMap raster tiles, warmed toward the Cargo paper
// palette (see map-popover.css). No API key; the map only mounts while
// the popover is open.

import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Search, X, Crosshair, MapPin } from 'lucide-react';
import { geocodeArea, supplierPortPoints, supplierReaches, centroidOf } from './geo';
import './map-popover.css';

const pinIcon = (reaches) => L.divIcon({
  className: 'mp-pin', iconSize: [18, 18], iconAnchor: [9, 9],
  html: `<span class="${reaches ? 'live' : 'dim'}"></span>`,
});
const youIcon = () => L.divIcon({
  className: 'mp-youpin', iconSize: [24, 24], iconAnchor: [12, 12], html: '<span></span>',
});

const MapPopover = ({
  open, onClose, suppliers, portCoords, theme,
  queryValue, onQueryChange, queryPoint, onSetPoint, onEnterShop,
}) => {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const setPointRef = useRef(onSetPoint);
  const programmaticMove = useRef(false);
  const [mapError, setMapError] = useState(false);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoErr, setGeoErr] = useState(null);
  const [canSearchArea, setCanSearchArea] = useState(false);

  useEffect(() => { setPointRef.current = onSetPoint; }, [onSetPoint]);

  // Mount the map once the popover is open and its container exists.
  useEffect(() => {
    if (!open) return undefined;
    const el = containerRef.current;
    if (!el) return undefined;
    let map;
    try {
      map = L.map(el, { zoomControl: true, attributionControl: true, scrollWheelZoom: true, worldCopyJump: true });
      map.setView([43.55, 7.1], 8);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18, minZoom: 3, attribution: '&copy; OpenStreetMap',
      }).addTo(map);
      layerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      // Click straight on the chart to drop your point.
      map.on('click', (e) => setPointRef.current({ lat: e.latlng.lat, lng: e.latlng.lng, label: 'Dropped pin' }));
      // Panning/zooming offers a "search this area" — but ignore the
      // programmatic fitBounds we trigger ourselves.
      map.on('moveend', () => {
        if (programmaticMove.current) { programmaticMove.current = false; return; }
        setCanSearchArea(true);
      });
      const t = setTimeout(() => map.invalidateSize(), 80);
      return () => { clearTimeout(t); map.remove(); mapRef.current = null; layerRef.current = null; };
    } catch (e) {
      setMapError(true);
      return undefined;
    }
  }, [open]);

  // Redraw shops (one pin each) + reach rings + the "you" marker.
  useEffect(() => {
    const map = mapRef.current;
    const lg = layerRef.current;
    if (!open || !map || !lg) return undefined;
    lg.clearLayers();
    const bounds = [];
    (suppliers || []).forEach((s) => {
      const pts = supplierPortPoints(s, portCoords);
      if (!pts.length) return;
      const reaches = queryPoint ? supplierReaches(s, portCoords, queryPoint) : true;
      const color = reaches ? '#C65A1A' : '#9AA0AE';
      const radiusM = (Number(s.service_radius_km) || 60) * 1000;
      // Combined reach: a ring around each covered port (no per-port pins).
      pts.forEach((p) => {
        L.circle([p.lat, p.lng], {
          radius: radiusM, color, weight: 1.2, opacity: reaches ? 0.6 : 0.22,
          fillColor: color, fillOpacity: reaches ? 0.07 : 0.03, dashArray: '5 5',
        }).addTo(lg);
        bounds.push([p.lat, p.lng]);
      });
      // One labelled pin per shop, at the centre of its ports.
      const c = centroidOf(pts);
      if (c) {
        L.marker([c.lat, c.lng], { icon: pinIcon(reaches) })
          .addTo(lg)
          .bindTooltip(`${s.name}${s.service_radius_km ? ` · ${s.service_radius_km} km reach` : ''}`, { direction: 'top', offset: [0, -8] });
      }
    });
    if (queryPoint) {
      L.marker([queryPoint.lat, queryPoint.lng], { icon: youIcon() })
        .addTo(lg).bindTooltip('Your area', { direction: 'top', offset: [0, -8] });
      bounds.push([queryPoint.lat, queryPoint.lng]);
    }
    if (bounds.length) {
      programmaticMove.current = true;
      try { map.fitBounds(bounds, { padding: [42, 42], maxZoom: 9 }); } catch (e) { programmaticMove.current = false; }
    }
    setCanSearchArea(false);
    const t = setTimeout(() => map.invalidateSize(), 60);
    return () => clearTimeout(t);
  }, [open, suppliers, portCoords, queryPoint]);

  const runSearch = async () => {
    const q = (queryValue || '').trim();
    setGeoErr(null);
    if (!q) { onSetPoint(null); return; }
    setGeoLoading(true);
    try {
      const pt = await geocodeArea(q);
      if (!pt) { setGeoErr('Couldn’t place that — try a port, city or country.'); onSetPoint(null); }
      else onSetPoint(pt);
    } catch (e) {
      setGeoErr('Location lookup is unavailable right now — filtering by name instead.');
      onSetPoint(null);
    } finally {
      setGeoLoading(false);
    }
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) { setGeoErr('This device can’t share its location.'); return; }
    setGeoLoading(true); setGeoErr(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => { onSetPoint({ lat: pos.coords.latitude, lng: pos.coords.longitude, label: 'Your current location' }); setGeoLoading(false); },
      () => { setGeoErr('Couldn’t get your location — type an area or click the map instead.'); setGeoLoading(false); },
      { enableHighAccuracy: false, timeout: 8000 },
    );
  };

  const searchThisArea = () => {
    const map = mapRef.current;
    if (!map) return;
    const c = map.getCenter();
    setGeoErr(null);
    onSetPoint({ lat: c.lat, lng: c.lng, label: 'Selected area' });
  };

  if (!open) return null;

  const reaching = queryPoint
    ? (suppliers || []).filter((s) => supplierReaches(s, portCoords, queryPoint))
    : (suppliers || []);

  return (
    <>
      <div className="mpm-backdrop" onClick={onClose} />
      <div className={`mpm-panel ${theme === 'dark' ? 'dark' : ''}`} role="dialog" aria-label="Shops near you">
        <div className="mpm-head">
          <div>
            <h3 className="mpm-title">Who reaches <em>you</em></h3>
            <p className="mpm-sub">Type an area, or click the chart, to see the shops that deliver there.</p>
          </div>
          <button className="mpm-x" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <div className="mpm-searchrow">
          <label className="mpm-field">
            <MapPin size={15} className="ic" />
            <input
              autoFocus
              placeholder="Port, city, country or postcode…"
              value={queryValue}
              onChange={(e) => { setGeoErr(null); onQueryChange(e.target.value); }}
              onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }}
            />
          </label>
          <button className="mpm-go" onClick={runSearch} disabled={geoLoading}>
            <Search size={14} /> {geoLoading ? 'Finding…' : 'Search'}
          </button>
          <button className="mpm-loc" onClick={useMyLocation} disabled={geoLoading} title="Use my location">
            <Crosshair size={15} />
          </button>
        </div>
        {geoErr && <div className="mpm-err">{geoErr}</div>}

        <div className="mpm-mapwrap">
          {mapError
            ? <div className="mpm-mapfail">Map couldn’t load — the shop list below still filters by area.</div>
            : <div ref={containerRef} className="mpm-map" />}
          {!mapError && canSearchArea && (
            <button className="mpm-searcharea" onClick={searchThisArea}>
              <Search size={13} /> Search this area
            </button>
          )}
        </div>

        <div className="mpm-result">
          <div className="mpm-count">
            {queryPoint
              ? <><b>{reaching.length}</b> shop{reaching.length === 1 ? '' : 's'} reach {queryPoint.label?.split(',')[0] || 'your area'}</>
              : <>Showing <b>{reaching.length}</b> shop{reaching.length === 1 ? '' : 's'}</>}
          </div>
          <div className="mpm-list">
            {reaching.map((s) => (
              <button key={s.id} className="mpm-shop" onClick={() => { onEnterShop(s); onClose(); }}>
                <span className="dot" />
                <span className="nm">{s.name}</span>
                <span className="rd">{s.service_radius_km || 60} km</span>
              </button>
            ))}
            {queryPoint && reaching.length === 0 && (
              <div className="mpm-none">No shops reach there yet — invite the ones you use and they’ll appear here.</div>
            )}
          </div>
        </div>

        <div className="mpm-foot">
          {queryPoint && (
            <button className="mpm-clear" onClick={() => { onQueryChange(''); onSetPoint(null); }}>Clear area</button>
          )}
          <button className="mpm-done" onClick={onClose}>Done</button>
        </div>
      </div>
    </>
  );
};

export default MapPopover;
