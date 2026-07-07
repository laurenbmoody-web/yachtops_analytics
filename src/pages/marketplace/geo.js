// Marketplace geography helpers — the maths behind "serves my area".
//
// Shops don't have a single point; they cover a set of ports and travel
// a service radius around each. A shop reaches a location if that
// location falls within the radius of any port it covers.

const R_KM = 6371;
const toRad = (d) => (d * Math.PI) / 180;

/** Great-circle distance between two lat/lng points, in kilometres. */
export const haversineKm = (lat1, lng1, lat2, lng2) => {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.sqrt(s));
};

/**
 * Resolve a shop's covered ports to coordinates via the port_locations
 * map (keyed lower-case), dropping any we don't have coords for.
 */
export const supplierPortPoints = (supplier, portCoords) =>
  (supplier?.coverage_ports || [])
    .map((n) => portCoords.get(String(n).toLowerCase()))
    .filter(Boolean);

/**
 * Does the shop reach `point` ({lat,lng})? True when any covered port is
 * within the shop's service radius. Shops whose ports we can't place are
 * excluded once a real point is in play — we can't honestly claim reach.
 */
export const supplierReaches = (supplier, portCoords, point) => {
  const pts = supplierPortPoints(supplier, portCoords);
  if (!pts.length) return false;
  const radius = Number(supplier?.service_radius_km) || 60;
  return pts.some((p) => haversineKm(point.lat, point.lng, p.lat, p.lng) <= radius);
};

/**
 * Geocode a free-text area (postcode, city, country) to a point using
 * OpenStreetMap's Nominatim. Runs in the crew member's browser; rate
 * limited to ~1 req/sec, so only call it on submit. Returns null when
 * nothing matches; throws only on network/HTTP failure so the caller can
 * fall back to a plain name match.
 */
export async function geocodeArea(query) {
  const q = String(query || '').trim();
  if (!q) return null;
  const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=0&limit=1&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Geocode failed (${res.status})`);
  const rows = await res.json();
  if (!Array.isArray(rows) || !rows.length) return null;
  const r = rows[0];
  return {
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lon),
    label: r.display_name || q,
  };
}
