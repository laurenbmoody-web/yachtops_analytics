import React, { useEffect, useRef, useState } from 'react';
import { loadGoogleMaps, hasGoogleKey, MAP_STYLE_LIGHT, MAP_STYLE_DARK } from '../marketplace/gmaps';
import { fetchPortLocations } from '../provisioning/utils/marketplaceStorage';
import { fetchLatestDriverPing } from './driverStorage';
import { supabase } from '../../lib/supabaseClient';

function fmtAgo(iso) {
  if (!iso) return null;
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

// Crew-facing live driver map. Resolves the destination port from
// port_locations, draws the driver's latest pin, and subscribes to new pings
// in realtime so the pin moves toward the port. Renders a graceful fallback
// when there's no location yet or no Google key.
export default function DriverMap({ order, theme = 'light' }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const gRef = useRef(null);
  const driverMarkerRef = useRef(null);
  const destMarkerRef = useRef(null);
  const destRef = useRef(null);
  const [ping, setPing] = useState(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  // Initial ping + destination coords.
  useEffect(() => {
    let alive = true;
    fetchLatestDriverPing(order.id).then((p) => { if (alive && p) setPing(p); }).catch(() => {});
    fetchPortLocations().then((m) => {
      if (!alive) return;
      const key = String(order.delivery_port || '').toLowerCase();
      destRef.current = m.get(key) || null;
    }).catch(() => {});
    return () => { alive = false; };
  }, [order.id, order.delivery_port]);

  // Realtime: new pings for this order.
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

  // Init the map once we have a first position and a key.
  useEffect(() => {
    if (!ping || mapRef.current || !hasGoogleKey()) return undefined;
    let alive = true;
    loadGoogleMaps().then((g) => {
      if (!alive || !containerRef.current) return;
      gRef.current = g;
      const map = new g.Map(containerRef.current, {
        center: { lat: ping.lat, lng: ping.lng }, zoom: 12,
        styles: theme === 'dark' ? MAP_STYLE_DARK : MAP_STYLE_LIGHT,
        mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
        clickableIcons: false, gestureHandling: 'greedy', disableDefaultUI: true, zoomControl: true,
      });
      mapRef.current = map;
      setReady(true);
    }).catch(() => setFailed(true));
    return () => { alive = false; };
  }, [ping, theme]);

  // Draw / move markers whenever the ping (or map) updates.
  useEffect(() => {
    const g = gRef.current, map = mapRef.current;
    if (!g || !map || !ping) return;
    const driverPos = { lat: ping.lat, lng: ping.lng };

    if (!driverMarkerRef.current) {
      driverMarkerRef.current = new g.Marker({
        map, position: driverPos, title: order.driver_name || 'Driver',
        icon: { path: g.SymbolPath.CIRCLE, scale: 8, fillColor: '#C65A1A', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 3 },
        zIndex: 3,
      });
    } else {
      driverMarkerRef.current.setPosition(driverPos);
    }

    const dest = destRef.current;
    if (dest && !destMarkerRef.current) {
      destMarkerRef.current = new g.Marker({
        map, position: { lat: dest.lat, lng: dest.lng }, title: dest.name,
        icon: { path: g.SymbolPath.BACKWARD_CLOSED_ARROW, scale: 5, fillColor: '#1C1B3A', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 1.5 },
        zIndex: 2,
      });
    }

    // Keep both in view.
    if (dest) {
      const b = new g.LatLngBounds();
      b.extend(driverPos); b.extend({ lat: dest.lat, lng: dest.lng });
      map.fitBounds(b, 64);
    } else {
      map.panTo(driverPos);
    }
  }, [ping, ready, order.driver_name]);

  if (failed || !hasGoogleKey()) {
    // No map available — still show the last-known coords line if we have one.
    return ping ? (
      <div className="cargo-od-track-maploc">Live location updating · {fmtAgo(ping.captured_at)}</div>
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
      <div ref={containerRef} className="cargo-od-track-map-canvas" />
      <div className="cargo-od-track-map-cap">Live · updated {fmtAgo(ping.captured_at)}</div>
    </div>
  );
}
