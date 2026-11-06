// Read the vessel's AIS/position history and shape it into a journey — the data
// behind the Voyages map. Positions land in `vessel_positions` (one row per day
// per source; see the ais-sync edge function), so reading them back in date
// order gives the breadcrumb trail. We roll runs of near-identical daily points
// into "stops" (a port/anchorage the boat sat at) so the timeline reads like a
// voyage, not a list of dots.
import { supabase } from '../../../lib/supabaseClient';

const getTenantId = async () => {
  try {
    const { data, error } = await supabase?.rpc('get_my_context');
    if (error || !data?.[0]?.tenant_id) return null;
    return data[0].tenant_id;
  } catch { return null; }
};

// Metres between two lat/lon points (haversine).
const R = 6371000;
const toRad = (d) => (d * Math.PI) / 180;
export function distanceM(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// A position's note is "<navStatus> · <place>" (e.g. "Moored · Perama Greece")
// or just a status ("Underway using Engine"). Pull out a human place label and
// a short motion state so the UI doesn't have to parse it.
const STATUS_RE = /moor|anchor|berth|under\s?way|sailing|engine|fishing|aground|restricted|not under command/i;
function readNote(note) {
  const parts = String(note || '').split('·').map((s) => s.trim()).filter(Boolean);
  let status = '';
  let place = '';
  for (const p of parts) {
    if (STATUS_RE.test(p) && !status) status = p;
    else if (!place) place = p;
  }
  return { status, place };
}

// Short motion word for a point, used in the headline + badges.
export function motionOf(point) {
  const { status } = readNote(point?.note);
  const s = (status || '').toLowerCase();
  if (/under\s?way|sailing|engine/.test(s)) return 'underway';
  if (/anchor/.test(s)) return 'at anchor';
  if (/moor|berth/.test(s)) return 'alongside';
  if (point?.maritime_zone === 'in_port') return 'in port';
  if (point?.maritime_zone === 'offshore') return 'at sea';
  return 'last seen';
}

// Fetch the whole track for the current tenant's vessel.
// Returns { vessel, points, stops, latest } — points oldest→newest.
export async function fetchVoyageTrack() {
  const tenantId = await getTenantId();
  if (!tenantId) return { vessel: null, points: [], stops: [], latest: null };

  const [vesRes, posRes] = await Promise.all([
    supabase.from('vessels').select('name, mmsi').eq('tenant_id', tenantId).order('mmsi', { ascending: false, nullsFirst: false }).limit(1),
    supabase.from('vessel_positions')
      .select('observed_on, observed_at, latitude, longitude, country_code, maritime_zone, schengen, note, source')
      .eq('tenant_id', tenantId)
      .not('latitude', 'is', null)
      .not('longitude', 'is', null)
      .order('observed_on', { ascending: true }),
  ]);

  const vessel = vesRes.data?.[0] || null;
  const rows = posRes.data || [];
  const points = rows.map((r) => {
    const { status, place } = readNote(r.note);
    return {
      date: r.observed_on,
      at: r.observed_at || null,
      lat: Number(r.latitude),
      lon: Number(r.longitude),
      country: r.country_code || null,
      zone: r.maritime_zone || null,
      schengen: r.schengen,
      note: r.note || null,
      status,
      place,
      source: r.source || null,
    };
  }).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));

  // Roll consecutive near-identical points (< ~4km apart) into one stop.
  const STOP_M = 4000;
  const stops = [];
  for (const p of points) {
    const cur = stops[stops.length - 1];
    if (cur && distanceM(cur, p) < STOP_M) {
      cur.to = p.date;
      cur.nights = (cur.nights || 0) + 1;
      // keep the most descriptive place/motion we've seen for this stop
      if (!cur.place && p.place) cur.place = p.place;
      cur.lastMotion = motionOf(p);
      cur.lastPoint = p;
    } else {
      stops.push({
        lat: p.lat, lon: p.lon,
        from: p.date, to: p.date, nights: 0,
        place: p.place || null,
        country: p.country || null,
        zone: p.zone || null,
        lastMotion: motionOf(p),
        firstPoint: p, lastPoint: p,
      });
    }
  }

  const latest = points[points.length - 1] || null;
  return { vessel, points, stops, latest };
}
