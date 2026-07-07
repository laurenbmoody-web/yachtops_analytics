// The Chart — marketplace map popover (Google Maps).
//
// Opens off the "serves my area" field. Set a point four ways: pick a
// Places autocomplete suggestion, press Search, click the map, or pan
// and hit "Search this area". Shops whose service radius reaches that
// point light up; each shop is one labelled pin at the centre of the
// ports it covers, with its reach drawn as rings. Broad areas (a whole
// country) draw the searched region as a rectangle.
//
// Google Maps JS + Places, styled to the Cargo paper palette. The key
// is a build-time env var; if it's absent or the API fails to load, the
// list below still filters by area.

import React, { useEffect, useRef, useState } from 'react';
import { Search, X, Crosshair, MapPin, ChevronRight, Plus } from 'lucide-react';
import { supplierPortPoints, supplierReaches, centroidOf, isBroadArea, haversineKm } from './geo';
import { loadGoogleMaps, hasGoogleKey, MAP_STYLE_LIGHT, MAP_STYLE_DARK } from './gmaps';
import './map-popover.css';

const MapPopover = ({
  open, onClose, suppliers, portCoords, theme,
  queryValue, onQueryChange, queryPoint, onSetPoint, onEnterShop,
  inviteSuppliers = [], onInvite,
}) => {
  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const gRef = useRef(null);       // google.maps namespace
  const mapRef = useRef(null);
  const geocoderRef = useRef(null);
  const overlaysRef = useRef([]);
  const setPointRef = useRef(onSetPoint);
  const programmatic = useRef(false);
  const inviteCacheRef = useRef(new Map()); // supplier id → {lat,lng} | null
  const [mapError, setMapError] = useState(false);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoErr, setGeoErr] = useState(null);
  const [canSearchArea, setCanSearchArea] = useState(false);
  const [inviteCoords, setInviteCoords] = useState(() => new Map());
  const [mapReady, setMapReady] = useState(false);

  const onInviteRef = useRef(onInvite);
  useEffect(() => { setPointRef.current = onSetPoint; }, [onSetPoint]);
  useEffect(() => { onInviteRef.current = onInvite; }, [onInvite]);

  const bboxOf = (vp) => (vp ? {
    south: vp.getSouthWest().lat(), north: vp.getNorthEast().lat(),
    west: vp.getSouthWest().lng(), east: vp.getNorthEast().lng(),
  } : null);

  // Mount the Google map once the popover is open.
  useEffect(() => {
    if (!open) return undefined;
    if (!hasGoogleKey()) { setMapError(true); return undefined; }
    let cancelled = false;
    loadGoogleMaps().then((g) => {
      if (cancelled || !containerRef.current) return;
      gRef.current = g;
      const map = new g.Map(containerRef.current, {
        center: { lat: 43.55, lng: 7.1 }, zoom: 8,
        styles: theme === 'dark' ? MAP_STYLE_DARK : MAP_STYLE_LIGHT,
        mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
        clickableIcons: false, gestureHandling: 'greedy',
      });
      mapRef.current = map;
      geocoderRef.current = new g.Geocoder();
      setMapReady(true);

      map.addListener('click', (e) => setPointRef.current({ lat: e.latLng.lat(), lng: e.latLng.lng(), label: 'Dropped pin' }));
      map.addListener('dragend', () => setCanSearchArea(true));
      map.addListener('zoom_changed', () => { if (programmatic.current) return; setCanSearchArea(true); });
      map.addListener('idle', () => { programmatic.current = false; });
    }).catch(() => { if (!cancelled) setMapError(true); });

    return () => {
      cancelled = true;
      const g = gRef.current;
      overlaysRef.current.forEach((o) => o.setMap && o.setMap(null));
      overlaysRef.current = [];
      if (g && mapRef.current) g.event.clearInstanceListeners(mapRef.current);
      mapRef.current = null;
      geocoderRef.current = null;
      setMapReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Re-style on theme change.
  useEffect(() => {
    if (mapRef.current) mapRef.current.setOptions({ styles: theme === 'dark' ? MAP_STYLE_DARK : MAP_STYLE_LIGHT });
  }, [theme]);

  // Resolve a coordinate for each invite (directory) supplier: a covered
  // port we know, else geocode its city. Cached so we never re-geocode.
  useEffect(() => {
    if (!open || !mapReady || !inviteSuppliers.length) return undefined;
    let cancelled = false;
    const cache = inviteCacheRef.current;
    const geocodeCity = (q) => new Promise((resolve) => {
      const gc = geocoderRef.current;
      if (!gc) { resolve(null); return; }
      gc.geocode({ address: q }, (res, status) => {
        if (status === 'OK' && res && res[0]) {
          const l = res[0].geometry.location;
          resolve({ lat: l.lat(), lng: l.lng() });
        } else resolve(null);
      });
    });
    (async () => {
      let changed = false;
      for (const s of inviteSuppliers) {
        if (cache.has(s.id)) continue;
        const port = (s.coverage_ports || []).map((n) => portCoords.get(String(n).toLowerCase())).find(Boolean);
        if (port) { cache.set(s.id, { lat: port.lat, lng: port.lng }); changed = true; continue; }
        const city = (s.business_city || '').trim();
        if (!city || !geocoderRef.current) { cache.set(s.id, null); changed = true; continue; }
        // eslint-disable-next-line no-await-in-loop
        const pt = await geocodeCity(`${city}${s.business_country ? `, ${s.business_country}` : ''}`);
        if (cancelled) return;
        cache.set(s.id, pt); changed = true;
      }
      if (changed && !cancelled) setInviteCoords(new Map(cache));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mapReady, inviteSuppliers, portCoords]);

  // Draw shops (one pin each) + reach rings + the "you" marker / area box.
  useEffect(() => {
    const g = gRef.current;
    const map = mapRef.current;
    if (!open || !mapReady || !g || !map) return;
    overlaysRef.current.forEach((o) => o.setMap && o.setMap(null));
    const overlays = [];
    const bounds = new g.LatLngBounds();
    let any = false;

    (suppliers || []).forEach((s) => {
      const pts = supplierPortPoints(s, portCoords);
      if (!pts.length) return;
      const reaches = queryPoint ? supplierReaches(s, portCoords, queryPoint) : true;
      const color = reaches ? '#C65A1A' : '#9AA0AE';
      const radiusM = (Number(s.service_radius_km) || 60) * 1000;
      pts.forEach((p) => {
        overlays.push(new g.Circle({
          map, center: { lat: p.lat, lng: p.lng }, radius: radiusM,
          strokeColor: color, strokeOpacity: reaches ? 0.55 : 0.2, strokeWeight: 1.2,
          fillColor: color, fillOpacity: reaches ? 0.07 : 0.03, clickable: false,
        }));
        bounds.extend({ lat: p.lat, lng: p.lng }); any = true;
      });
      const c = centroidOf(pts);
      if (c) {
        overlays.push(new g.Marker({
          map, position: { lat: c.lat, lng: c.lng },
          title: `${s.name}${s.service_radius_km ? ` · ${s.service_radius_km} km reach` : ''}`,
          icon: { path: g.SymbolPath.CIRCLE, scale: 7, fillColor: color, fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 2 },
        }));
      }
    });

    if (queryPoint) {
      if (isBroadArea(queryPoint)) {
        const b = queryPoint.bbox;
        overlays.push(new g.Rectangle({
          map, bounds: { north: b.north, south: b.south, east: b.east, west: b.west },
          strokeColor: '#1C1B3A', strokeOpacity: 0.45, strokeWeight: 1.2, fillColor: '#1C1B3A', fillOpacity: 0.05, clickable: false,
        }));
        bounds.extend({ lat: b.north, lng: b.east }); bounds.extend({ lat: b.south, lng: b.west }); any = true;
      } else {
        overlays.push(new g.Marker({
          map, position: { lat: queryPoint.lat, lng: queryPoint.lng }, title: 'Your area',
          icon: { path: g.SymbolPath.CIRCLE, scale: 8, fillColor: '#1C1B3A', fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 3 },
        }));
        bounds.extend({ lat: queryPoint.lat, lng: queryPoint.lng }); any = true;
      }
    }

    // Invite (directory) suppliers not yet on Cargo — faint ghost pins.
    inviteSuppliers.forEach((s) => {
      const c = inviteCoords.get(s.id);
      if (!c) return;
      const m = new g.Marker({
        map, position: { lat: c.lat, lng: c.lng }, title: `${s.name} — invite to Cargo`,
        icon: { path: g.SymbolPath.CIRCLE, scale: 6, fillColor: '#B8B3A8', fillOpacity: 0.5, strokeColor: '#8B8478', strokeWeight: 1.5 },
        zIndex: 1,
      });
      m.addListener('click', () => onInviteRef.current && onInviteRef.current(s));
      overlays.push(m);
    });

    overlaysRef.current = overlays;
    if (any) { programmatic.current = true; map.fitBounds(bounds, 48); }
    setCanSearchArea(false);
  }, [open, mapReady, suppliers, portCoords, queryPoint, inviteSuppliers, inviteCoords]);

  const runSearch = () => {
    const q = (queryValue || '').trim();
    setGeoErr(null);
    if (!q) { onSetPoint(null); return; }
    const gc = geocoderRef.current;
    if (!gc) { setGeoErr('Map isn’t ready yet — one moment.'); return; }
    setGeoLoading(true);
    gc.geocode({ address: q }, (res, status) => {
      setGeoLoading(false);
      if (status === 'OK' && res && res[0]) {
        const r = res[0];
        const loc = r.geometry.location;
        onSetPoint({ lat: loc.lat(), lng: loc.lng(), label: r.formatted_address, bbox: bboxOf(r.geometry.viewport) });
      } else {
        setGeoErr('Couldn’t place that — try a port, city or country.');
        onSetPoint(null);
      }
    });
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
    onSetPoint({ lat: c.lat(), lng: c.lng(), label: 'Selected area' });
  };

  if (!open) return null;

  const reaching = queryPoint
    ? (suppliers || []).filter((s) => supplierReaches(s, portCoords, queryPoint))
    : (suppliers || []);

  // When an area is set, narrow the invite list to saved suppliers near
  // it — "the supply for this area" — so a long directory doesn't dump
  // everything. Located-elsewhere and location-less ones are summarised.
  const inBox = (c, b) => c.lat >= b.south && c.lat <= b.north && c.lng >= b.west && c.lng <= b.east;
  const nearInvites = queryPoint
    ? inviteSuppliers.filter((s) => {
        const c = inviteCoords.get(s.id);
        if (!c) return false;
        return isBroadArea(queryPoint) ? inBox(c, queryPoint.bbox)
          : haversineKm(queryPoint.lat, queryPoint.lng, c.lat, c.lng) <= 250;
      })
    : inviteSuppliers;
  const invitesElsewhere = inviteSuppliers.length - nearInvites.length;

  return (
    <>
      <div className="mpm-backdrop" onClick={onClose} />
      <div className={`mpm-panel ${theme === 'dark' ? 'dark' : ''}`} role="dialog" aria-label="Shops near you">
        <div className="mpm-head">
          <div>
            <h3 className="mpm-title">Who reaches <em>you</em></h3>
            <p className="mpm-sub">Type an area, or click the chart, to see the suppliers that deliver there.</p>
          </div>
          <button className="mpm-x" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <div className="mpm-searchrow">
          <label className="mpm-field">
            <MapPin size={15} className="ic" />
            {queryPoint && (
              <span className="mpm-chip">
                {queryPoint.label?.split(',')[0] || 'Area'}
                <button type="button" onClick={() => { onSetPoint(null); onQueryChange(''); }} aria-label="Clear area">×</button>
              </span>
            )}
            <input
              ref={inputRef}
              autoFocus
              placeholder={queryPoint ? 'Search another area…' : 'Port, city, country or postcode…'}
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

        <div className="mpm-body">
          <div className="mpm-mapwrap">
            {mapError
              ? <div className="mpm-mapfail">Map couldn’t load — the shop list still filters by area.</div>
              : <div ref={containerRef} className="mpm-map" />}
            {!mapError && canSearchArea && (
              <button className="mpm-searcharea" onClick={searchThisArea}>
                <Search size={13} /> Search this area
              </button>
            )}
          </div>

          <div className="mpm-side">
            <div className="mpm-count">
              {queryPoint
                ? <>{reaching.length} supplier{reaching.length === 1 ? '' : 's'} reach {queryPoint.label?.split(',')[0] || 'your area'}</>
                : <>{reaching.length} supplier{reaching.length === 1 ? '' : 's'} on Cargo</>}
            </div>
            <div className="mpm-scroll">
              <div className="mpm-list">
                {reaching.map((s) => (
                  <button key={s.id} className="mpm-shop" onClick={() => { onEnterShop(s); onClose(); }}>
                    <span className="mpm-shop-main">
                      <span className="nm">{s.name}</span>
                      <span className="rd">{s.service_radius_km || 60} km reach</span>
                    </span>
                    <span className="go"><ChevronRight size={16} /></span>
                  </button>
                ))}
                {queryPoint && reaching.length === 0 && (
                  <div className="mpm-none">No suppliers reach there yet — invite the ones you use and they’ll appear here.</div>
                )}
              </div>

              {inviteSuppliers.length > 0 && (
                <div className="mpm-invite">
                  <div className="mpm-invite-h">Not on Cargo yet{queryPoint && nearInvites.length > 0 ? ` · near ${queryPoint.label?.split(',')[0]}` : ''}</div>
                  <div className="mpm-invite-list">
                    {nearInvites.map((s) => (
                      <button key={s.id} className="mpm-inviterow" onClick={() => onInvite && onInvite(s)} title={`Invite ${s.name} to Cargo`}>
                        <span className="mpm-inv-main">
                          <span className="nm">{s.name}</span>
                          {s.business_city && <span className="where">{s.business_city}</span>}
                        </span>
                        <span className="add"><Plus size={14} /></span>
                      </button>
                    ))}
                  </div>
                  {queryPoint && invitesElsewhere > 0 && (
                    <div className="mpm-invite-more">
                      {nearInvites.length === 0
                        ? `None of your saved suppliers reach here — ${invitesElsewhere} elsewhere.`
                        : `+${invitesElsewhere} more elsewhere.`}
                    </div>
                  )}
                </div>
              )}
            </div>
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
