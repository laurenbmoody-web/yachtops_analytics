// The Chart — marketplace map popover.
//
// Opens off the "serves my area" field. The crew types a port, city or
// postcode; we geocode it in the browser, drop a marker, and light up
// the shops whose service radius reaches it. Pins sit on each shop's
// covered ports; dashed rings show how far they'll travel. Selecting a
// lit shop enters its aisles.
//
// Leaflet + OpenStreetMap raster tiles, warmed toward the Cargo paper
// palette with a CSS filter (see map-popover.css). No API key, no build
// step — the map only mounts while the popover is open.

import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Search, X, Crosshair, MapPin } from 'lucide-react';
import { geocodeArea, supplierPortPoints, supplierReaches } from './geo';
import './map-popover.css';

const pinIcon = (reaches) => L.divIcon({
  className: 'mp-pin', iconSize: [16, 16], iconAnchor: [8, 8],
  html: `<span class="${reaches ? 'live' : 'dim'}"></span>`,
});
const youIcon = () => L.divIcon({
  className: 'mp-youpin', iconSize: [24, 24], iconAnchor: [12, 12],
  html: '<span></span>',
});

const MapPopover = ({
  open, onClose, suppliers, portCoords, theme,
  queryValue, onQueryChange, queryPoint, onSetPoint, onEnterShop,
}) => {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const [mapError, setMapError] = useState(false);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoErr, setGeoErr] = useState(null);

  // Mount the map once the popover is open and its container exists.
  useEffect(() => {
    if (!open) return undefined;
    const el = containerRef.current;
    if (!el) return undefined;
    let map;
    try {
      map = L.map(el, { zoomControl: true, attributionControl: true, scrollWheelZoom: true, worldCopyJump: true });
      map.setView([43.55, 7.1], 8); // Riviera default
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18, minZoom: 3, attribution: '&copy; OpenStreetMap',
      }).addTo(map);
      layerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      const t = setTimeout(() => map.invalidateSize(), 80);
      return () => { clearTimeout(t); map.remove(); mapRef.current = null; layerRef.current = null; };
    } catch (e) {
      setMapError(true);
      return undefined;
    }
  }, [open]);

  // Redraw pins, rings and the "you" marker whenever the inputs change.
  useEffect(() => {
    const map = mapRef.current;
    const lg = layerRef.current;
    if (!open || !map || !lg) return;
    lg.clearLayers();
    const bounds = [];
    (suppliers || []).forEach((s) => {
      const pts = supplierPortPoints(s, portCoords);
      const reaches = queryPoint ? supplierReaches(s, portCoords, queryPoint) : true;
      const color = reaches ? '#C65A1A' : '#9AA0AE';
      const radiusM = (Number(s.service_radius_km) || 60) * 1000;
      pts.forEach((p) => {
        L.circle([p.lat, p.lng], {
          radius: radiusM, color, weight: 1.2, opacity: reaches ? 0.7 : 0.25,
          fillColor: color, fillOpacity: reaches ? 0.08 : 0.03, dashArray: '5 5',
        }).addTo(lg);
        L.marker([p.lat, p.lng], { icon: pinIcon(reaches) })
          .addTo(lg)
          .bindTooltip(`${s.name} · ${p.name}`, { direction: 'top', offset: [0, -6] });
        bounds.push([p.lat, p.lng]);
      });
    });
    if (queryPoint) {
      L.marker([queryPoint.lat, queryPoint.lng], { icon: youIcon() })
        .addTo(lg).bindTooltip('Your area', { direction: 'top', offset: [0, -8] });
      bounds.push([queryPoint.lat, queryPoint.lng]);
    }
    if (bounds.length) {
      try { map.fitBounds(bounds, { padding: [42, 42], maxZoom: 9 }); } catch (e) { /* single point */ }
    }
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
      () => { setGeoErr('Couldn’t get your location — type an area instead.'); setGeoLoading(false); },
      { enableHighAccuracy: false, timeout: 8000 },
    );
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
            <p className="mpm-sub">Type your berth, port or postcode — see the shops that deliver there.</p>
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
              onChange={(e) => onQueryChange(e.target.value)}
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
