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
import { Search, X, Crosshair, MapPin, ChevronRight } from 'lucide-react';
import { supplierPortPoints, supplierReaches, centroidOf, isBroadArea } from './geo';
import { loadGoogleMaps, hasGoogleKey, MAP_STYLE_LIGHT, MAP_STYLE_DARK } from './gmaps';
import './map-popover.css';

const MapPopover = ({
  open, onClose, suppliers, portCoords, theme,
  queryValue, onQueryChange, queryPoint, onSetPoint, onEnterShop,
}) => {
  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const gRef = useRef(null);       // google.maps namespace
  const mapRef = useRef(null);
  const geocoderRef = useRef(null);
  const overlaysRef = useRef([]);
  const setPointRef = useRef(onSetPoint);
  const programmatic = useRef(false);
  const [mapError, setMapError] = useState(false);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoErr, setGeoErr] = useState(null);
  const [canSearchArea, setCanSearchArea] = useState(false);

  useEffect(() => { setPointRef.current = onSetPoint; }, [onSetPoint]);

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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Re-style on theme change.
  useEffect(() => {
    if (mapRef.current) mapRef.current.setOptions({ styles: theme === 'dark' ? MAP_STYLE_DARK : MAP_STYLE_LIGHT });
  }, [theme]);

  // Draw shops (one pin each) + reach rings + the "you" marker / area box.
  useEffect(() => {
    const g = gRef.current;
    const map = mapRef.current;
    if (!open || !g || !map) return;
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

    overlaysRef.current = overlays;
    if (any) { programmatic.current = true; map.fitBounds(bounds, 48); }
    setCanSearchArea(false);
  }, [open, suppliers, portCoords, queryPoint]);

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
                ? <><b>{reaching.length}</b> supplier{reaching.length === 1 ? '' : 's'} reach {queryPoint.label?.split(',')[0] || 'your area'}</>
                : <><b>{reaching.length}</b> supplier{reaching.length === 1 ? '' : 's'} on Cargo</>}
            </div>
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
