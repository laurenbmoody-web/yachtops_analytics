// buildLogbook — turn the vessel's laundry records + trips into a retrospective
// "logbook": voyages (guests + crew), off-charter periods (crew & vessel between
// charters, bucketed by month), and a trip-independent Crew ledger.
//
// The history page loads this per-vessel; it never streams "every item" into a
// live view — periods are computed once and rendered on demand.

import { LaundryStatus, LaundryPriority, LaundryTagLabels } from './laundryStorage';

const MIN = 60000;
const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const monthLabel = (d) => d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
const dmy = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '');
const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '');
const dateOnly = (iso) => { const d = new Date(iso); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
const kindOf = (t) => { const k = (t || 'unknown').toLowerCase(); return k === 'guest' ? 'guest' : k === 'crew' ? 'crew' : (k === 'vessel' || k === 'other') ? 'vessel' : 'unknown'; };
const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';
export const fmtDur = (m) => { if (m == null || !isFinite(m)) return '—'; const h = Math.floor(m / 60); const mm = Math.round(m % 60); return h ? `${h}h ${mm}m` : `${mm}m`; };

const avgTurnaround = (items) => {
  const d = items.filter((i) => i.status === LaundryStatus.DELIVERED && i.deliveredAt && i.createdAt);
  if (!d.length) return null;
  return d.reduce((s, i) => s + (new Date(i.deliveredAt) - new Date(i.createdAt)) / MIN, 0) / d.length;
};

// people breakdown within a set of items (guests, crew, vessel/found)
function peopleFrom(items) {
  const map = new Map();
  for (const it of items) {
    const kind = kindOf(it.ownerType);
    const key = kind === 'guest' ? (it.ownerGuestId || it.ownerName || 'guest')
      : kind === 'crew' ? (it.ownerCrewUserId || it.ownerName || 'crew')
        : (kind === 'vessel' ? 'vessel' : 'found');
    if (!map.has(key)) map.set(key, { key, kind, name: '', sub: '', avatarUrl: null, items: [] });
    const p = map.get(key);
    p.items.push(it);
  }
  const out = [];
  for (const p of map.values()) {
    const first = p.items[0];
    p.name = p.kind === 'unknown' ? 'Found & unclaimed'
      : p.kind === 'vessel' ? 'Vessel & other'
        : (first.ownerName || 'Unassigned');
    const areas = [...new Set(p.items.map((i) => i.area).filter(Boolean))];
    const last = p.items.reduce((a, i) => { const t = i.deliveredAt || i.createdAt; return !a || t > a ? t : a; }, null);
    p.avatarUrl = p.items.find((i) => i.avatarUrl)?.avatarUrl || null;
    p.count = p.items.length;
    p.delivered = p.items.filter((i) => i.status === LaundryStatus.DELIVERED).length;
    p.sub = [areas[0], last ? `last ${dmy(last)}, ${clock(last)}` : null].filter(Boolean).join(' · ');
    out.push(p);
  }
  const rank = { guest: 0, crew: 1, vessel: 2, unknown: 3 };
  return out.sort((a, b) => (rank[a.kind] - rank[b.kind]) || b.count - a.count);
}

// day-by-day delivered record (newest day first)
function daysFrom(items) {
  const delivered = items.filter((i) => i.status === LaundryStatus.DELIVERED && i.deliveredAt);
  const map = new Map();
  for (const it of delivered) {
    const d = new Date(it.deliveredAt);
    const k = dayKey(d);
    if (!map.has(k)) map.set(k, { key: k, at: it.deliveredAt, label: d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' }), items: [] });
    map.get(k).items.push({
      desc: it.description || 'Laundry item',
      sub: [it.ownerName && kindOf(it.ownerType) !== 'unknown' ? it.ownerName : (kindOf(it.ownerType) === 'unknown' ? 'Unknown' : null), it.area, (it.tags || [])[0]].filter(Boolean).join(' · '),
      time: clock(it.deliveredAt),
    });
  }
  return [...map.values()].sort((a, b) => new Date(b.at) - new Date(a.at));
}

function summarise(items) {
  const delivered = items.filter((i) => i.status === LaundryStatus.DELIVERED).length;
  const cabins = new Set(items.map((i) => i.area).filter(Boolean)).size;
  return { total: items.length, cleaned: delivered, avg: fmtDur(avgTurnaround(items)), cabins };
}

// interior team — who took each delivered piece to "delivered", ranked by count
function teamFrom(items) {
  const map = new Map();
  for (const it of items) {
    if (it.status !== LaundryStatus.DELIVERED) continue;
    const key = it.handledById || it.handledByName;
    if (!key) continue;
    if (!map.has(key)) map.set(key, { key, name: it.handledByName || 'Crew', avatarUrl: it.handlerAvatarUrl || null, count: 0 });
    const m = map.get(key);
    m.count += 1;
    if (!m.avatarUrl && it.handlerAvatarUrl) m.avatarUrl = it.handlerAvatarUrl;
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

// average turnaround per care type (delivered items only), slowest first —
// so a 2-day shore dry-clean doesn't hide behind a 30-min onboard hand wash
function carePace(items) {
  const map = new Map();
  for (const it of items) {
    if (it.status !== LaundryStatus.DELIVERED || !it.deliveredAt || !it.createdAt) continue;
    const mins = (new Date(it.deliveredAt) - new Date(it.createdAt)) / MIN;
    for (const t of (it.tags || [])) {
      const label = LaundryTagLabels[t] || t;
      if (!label) continue;
      const e = map.get(label) || { sum: 0, n: 0 };
      e.sum += mins; e.n += 1; map.set(label, e);
    }
  }
  return [...map.entries()].map(([label, e]) => ({ label, avg: fmtDur(e.sum / e.n), avgMin: e.sum / e.n })).sort((a, b) => b.avgMin - a.avgMin);
}

// care-type tally → top 5 + hatched "Other" (never more than six bars)
function careFrom(items) {
  const map = new Map();
  for (const it of items) {
    for (const t of (it.tags || [])) {
      const label = LaundryTagLabels[t] || t;
      if (label) map.set(label, (map.get(label) || 0) + 1);
    }
  }
  const all = [...map.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
  if (all.length <= 6) return { bars: all, other: null };
  const top = all.slice(0, 5);
  const rest = all.slice(5);
  const other = { count: rest.reduce((s, x) => s + x.count, 0), items: rest };
  return { bars: [...top, { label: 'Other', count: other.count, other: true }], other };
}

export function buildLogbook(trips, items, now = new Date()) {
  const good = (trips || []).filter((t) => t && !t.isDeleted && t.startDate && t.endDate)
    .map((t) => ({ id: t.id || t.supabaseId, name: t.name || 'Voyage', start: dateOnly(t.startDate), end: dateOnly(t.endDate) }))
    .sort((a, b) => a.start - b.start);

  const findTrip = (d) => good.find((t) => d >= t.start && d <= t.end) || null;

  // bucket items → voyage (trip) or off-charter (by month)
  const voyageItems = new Map(); // tripId -> items
  const offItems = new Map();    // monthKey -> items
  for (const it of items || []) {
    if (!it.createdAt) continue;
    const d = dateOnly(it.createdAt);
    const trip = findTrip(d);
    if (trip) { (voyageItems.get(trip.id) || voyageItems.set(trip.id, []).get(trip.id)).push(it); }
    else { const k = monthKey(d); (offItems.get(k) || offItems.set(k, []).get(k)).push(it); }
  }

  const periods = [];
  for (const t of good) {
    // crew laundry never belongs to a guest voyage — it lives only in the Crew ledger
    const its = (voyageItems.get(t.id) || []).filter((i) => kindOf(i.ownerType) !== 'crew');
    if (!its.length) continue;
    const s = summarise(its);
    const live = now >= t.start && now <= t.end;
    const guests = new Set(its.filter((i) => kindOf(i.ownerType) === 'guest').map((i) => i.ownerGuestId || i.ownerName)).size;
    periods.push({
      id: `v-${t.id}`, type: 'voyage', name: t.name, dates: `${dmy(t.start)} – ${dmy(t.end)}`,
      hero: `${live ? 'In progress' : 'Completed'}${guests ? ` · ${guests} guest${guests === 1 ? '' : 's'}` : ''}`,
      live, ...s, kpiA: [String(guests || 0), guests === 1 ? 'Guest' : 'Guests'], kpiB: [String(s.cabins), s.cabins === 1 ? 'Cabin' : 'Cabins'],
      avgMin: avgTurnaround(its), team: teamFrom(its), care: careFrom(its), carePace: carePace(its),
      people: peopleFrom(its), days: daysFrom(its), items: its, sortAt: its.reduce((a, i) => { const v = i.deliveredAt || i.createdAt; return !a || v > a ? v : a; }, null),
    });
  }
  for (const [mk, its] of offItems) {
    const s = summarise(its);
    const [y, m] = mk.split('-');
    const d0 = new Date(Number(y), Number(m) - 1, 1);
    const crewN = new Set(its.filter((i) => kindOf(i.ownerType) === 'crew').map((i) => i.ownerCrewUserId || i.ownerName)).size;
    periods.push({
      id: `o-${mk}`, type: 'offcharter', name: 'Off-charter', dates: monthLabel(d0),
      hero: 'No guests aboard · crew & vessel linens',
      live: false, ...s, kpiA: [String(crewN || 0), crewN === 1 ? 'Crew' : 'Crew'], kpiB: [String(s.cabins), s.cabins === 1 ? 'Area' : 'Areas'],
      avgMin: avgTurnaround(its), team: teamFrom(its), care: careFrom(its), carePace: carePace(its),
      people: peopleFrom(its), days: daysFrom(its), items: its, sortAt: its.reduce((a, i) => { const v = i.deliveredAt || i.createdAt; return !a || v > a ? v : a; }, null),
    });
  }
  periods.sort((a, b) => (b.live - a.live) || (new Date(b.sortAt || 0) - new Date(a.sortAt || 0)));

  // Crew ledger — all crew items, trip-independent
  const crewItems = (items || []).filter((i) => kindOf(i.ownerType) === 'crew');
  const crewPeople = peopleFrom(crewItems);
  const crewS = summarise(crewItems);
  // where it happened — bucket crew items by the voyage / off-charter month they fell in
  const cbp = new Map();
  for (const it of crewItems) {
    if (!it.createdAt) continue;
    const d = dateOnly(it.createdAt);
    const trip = findTrip(d);
    const label = trip ? trip.name : `Off-charter · ${monthLabel(new Date(d.getFullYear(), d.getMonth(), 1))}`;
    cbp.set(label, (cbp.get(label) || 0) + 1);
  }
  const byPeriod = [...cbp.entries()].map(([label, n]) => ({ label, n }));
  const crew = crewItems.length ? {
    id: 'crew', type: 'crew', name: 'Crew', dates: 'Every voyage & off-charter',
    hero: 'Trip-independent · all crew laundry',
    ...crewS, kpiA: [String(crewPeople.length), crewPeople.length === 1 ? 'Member' : 'Members'], kpiB: [String(byPeriod.length), byPeriod.length === 1 ? 'Period' : 'Periods'],
    avgMin: avgTurnaround(crewItems), team: teamFrom(crewItems), care: careFrom(crewItems), carePace: carePace(crewItems),
    people: crewPeople, byPeriod, items: crewItems,
  } : null;

  return { periods, crew, hasAny: (items || []).length > 0 };
}

export { initials };
