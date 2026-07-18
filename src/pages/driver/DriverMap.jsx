import React, { useEffect, useRef, useState } from 'react';
import { loadGoogleMaps, hasGoogleKey } from '../marketplace/gmaps';
import { haversineKm } from '../marketplace/geo';
import { fetchPortLocations } from '../provisioning/utils/marketplaceStorage';
import { fetchLatestDriverPing } from './driverStorage';
import { supabase } from '../../lib/supabaseClient';

// Clean, low-clutter tracking style — near-white land, soft blue-grey water,
// white roads, labels + POIs dialled back so the terracotta driver pin and the
// route read at a glance. (Deliberately cooler/cleaner than the marketplace's
// warm-beige map.)
const DRIVER_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#F4F5F3' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#A2A6AD' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#FFFFFF' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#ECEEE9' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#FFFFFF' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#E9EAEC' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#F1F2F4' }] },
  { featureType: 'road', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#D6E2E8' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#9DB2BA' }] },
];

// Rough road-distance uplift over straight-line, and an urban average speed —
// enough for a live "≈ N min away" without a routing API.
const ROAD_FACTOR = 1.3;
const AVG_KMH = 32;

function fmtAgo(iso) {
  if (!iso) return null;
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}
function estimate(driver, dest) {
  if (!dest) return null;
  const km = haversineKm(driver.lat, driver.lng, dest.lat, dest.lng) * ROAD_FACTOR;
  const mins = Math.round((km / AVG_KMH) * 60);
  return { km, mins };
}

// Crew-facing live driver map. Resolves the destination port, draws the driver's
// latest pin + a route line to the port, and updates in realtime as pings land.
// Shows a live "≈ N min away · X km" estimate. Degrades gracefully with no
// location yet / no Google key.
export default function DriverMap({ order }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const gRef = useRef(null);
  const driverMarkerRef = useRef(null);
  const destMarkerRef = useRef(null);
  const routeRef = useRef(null);
  const destRef = useRef(null);
  const [ping, setPing] = useState(null);
  const [eta, setEta] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchLatestDriverPing(order.id).then((p) => { if (alive && p) setPing(p); }).catch(() => {});
    fetchPortLocations().then((m) => {
      if (!alive) return;
      destRef.current = m.get(String(order.delivery_port || '').toLowerCase()) || null;
      // recompute the estimate now that we have a destination
      setPing((p) => (p ? { ...p } : p));
    }).catch(() => {});
    return () => { alive = false; };
  }, [order.id, order.delivery_port]);

  useEffect(() => {
    const channel = supabase
      .channel(`driver-pings-${order.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'order_driver_pings',
        filter: `order_id=eq.${order.id}`,
      }, (payload) => { if (payload.new) setPing(payload.new); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [order.id]);

  // Init the map once we have a first position + a key.
  useEffect(() => {
    if (!ping || mapRef.current || !hasGoogleKey()) return undefined;
    let alive = true;
    loadGoogleMaps().then((g) => {
      if (!alive || !containerRef.current) return;
      gRef.current = g;
      mapRef.current = new g.Map(containerRef.current, {
        center: { lat: ping.lat, lng: ping.lng }, zoom: 12,
        styles: DRIVER_MAP_STYLE,
        disableDefaultUI: true, zoomControl: true, gestureHandling: 'greedy',
        clickableIcons: false, backgroundColor: '#F4F5F3',
      });
      setPing((p) => (p ? { ...p } : p)); // trigger the draw effect
    }).catch(() => setFailed(true));
    return () => { alive = false; };
  }, [ping, order.id]);

  // Draw / move markers + route + estimate on every ping.
  useEffect(() => {
    const g = gRef.current, map = mapRef.current;
    const dest = destRef.current;
    if (ping) setEta(estimate(ping, dest));
    if (!g || !map || !ping) return;
    const driverPos = { lat: ping.lat, lng: ping.lng };

    if (!driverMarkerRef.current) {
      driverMarkerRef.current = new g.Marker({
        map, position: driverPos, title: order.driver_name || 'Driver', zIndex: 3,
        icon: { path: g.SymbolPath.CIRCLE, scale: 8, fillColor: '#C65A1A', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 3 },
      });
    } else {
      driverMarkerRef.current.setPosition(driverPos);
    }

    if (dest) {
      const destPos = { lat: dest.lat, lng: dest.lng };
      if (!destMarkerRef.current) {
        destMarkerRef.current = new g.Marker({
          map, position: destPos, title: dest.name, zIndex: 2,
          icon: { path: 'M12 2C8.1 2 5 5.1 5 9c0 5.2 7 13 7 13s7-7.8 7-13c0-3.9-3.1-7-7-7z',
            fillColor: '#1C1B3A', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 1.5,
            scale: 1.5, anchor: new g.Point(12, 22) },
        });
      }
      if (!routeRef.current) {
        routeRef.current = new g.Polyline({
          map, geodesic: true, strokeColor: '#C65A1A', strokeOpacity: 0.55, strokeWeight: 3,
        });
      }
      routeRef.current.setPath([driverPos, destPos]);
      const b = new g.LatLngBounds();
      b.extend(driverPos); b.extend(destPos);
      map.fitBounds(b, 56);
    } else {
      map.panTo(driverPos);
    }
  }, [ping, order.driver_name]);

  const away = eta
    ? (eta.mins < 1 ? 'Arriving now' : `≈ ${eta.mins} min away`)
    : null;
  const distTxt = eta ? `${eta.km < 10 ? eta.km.toFixed(1) : Math.round(eta.km)} km` : null;

  if (failed || !hasGoogleKey()) {
    return ping ? (
      <div className="cargo-od-track-maploc">
        {away ? `${away} · ${distTxt} · ` : 'Live · '}updated {fmtAgo(ping.captured_at)}
      </div>
    ) : null;
  }
  if (!ping) {
    return (
      <div className="cargo-od-track-mapwait">
        Waiting for {order.driver_name || 'the driver'} to start sharing their location…
      </div>
    );
  }

  return (
    <div className="cargo-od-track-map">
      {away && (
        <div className="cargo-od-track-eta">
          <span className="cargo-od-track-eta-min">{away}</span>
          <span className="cargo-od-track-eta-dist">{distTxt} to {order.delivery_port || 'destination'}</span>
        </div>
      )}
      <div ref={containerRef} className="cargo-od-track-map-canvas" />
      <div className="cargo-od-track-map-cap">Live · updated {fmtAgo(ping.captured_at)}</div>
    </div>
  );
}
