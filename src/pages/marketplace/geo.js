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

/** Average of a set of {lat,lng} points — one pin to stand for a shop. */
export const centroidOf = (points) => {
  if (!points || !points.length) return null;
  const lat = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const lng = points.reduce((s, p) => s + p.lng, 0) / points.length;
  return { lat, lng };
};

const inBbox = (p, b) => p.lat >= b.south && p.lat <= b.north && p.lng >= b.west && p.lng <= b.east;

/**
 * Does the shop reach `point`? Two ways, so a precise pin and a broad
 * area both behave sensibly:
 *   • a covered port sits within the shop's service radius of the point
 *     (the right test for a berth, postcode or clicked spot), OR
 *   • a covered port falls inside the point's bounding box (the right
 *     test when the crew typed a whole country or region — "France"
 *     should match a Riviera shop even though its centroid is 600km off).
 * Shops whose ports we can't place are excluded — we can't claim reach.
 */
export const supplierReaches = (supplier, portCoords, point) => {
  const pts = supplierPortPoints(supplier, portCoords);
  if (!pts.length) return false;
  const radius = Number(supplier?.service_radius_km) || 60;
  if (pts.some((p) => haversineKm(point.lat, point.lng, p.lat, p.lng) <= radius)) return true;
  if (point.bbox) return pts.some((p) => inBbox(p, point.bbox));
  return false;
};

/** Is a geocoded point a broad area (country/region) rather than a spot? */
export const isBroadArea = (point) => {
  const b = point?.bbox;
  if (!b) return false;
  return Math.abs(b.north - b.south) > 0.6 || Math.abs(b.east - b.west) > 0.6;
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
  // boundingbox is [south, north, west, east] as strings.
  const bb = Array.isArray(r.boundingbox) && r.boundingbox.length === 4
    ? { south: +r.boundingbox[0], north: +r.boundingbox[1], west: +r.boundingbox[2], east: +r.boundingbox[3] }
    : null;
  return {
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lon),
    label: r.display_name || q,
    bbox: bb,
  };
}
