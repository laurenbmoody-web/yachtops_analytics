// Adapts the Supabase sea-service rows (one row per day) into the engine's
// voyage-shaped entries (date ranges with a day count) + a vessels map, by
// grouping contiguous runs of the same vessel + service type.

const SOURCE_MAP = { ais_proposed: 'ais', rota_derived: 'rota', vessel_auto: 'rota', manual: 'manual' };

const fmtDM = (iso) => { const d = new Date(iso); return String(d.getDate()).padStart(2, '0') + ' ' + d.toLocaleString('en-GB', { month: 'short' }); };
const nextDay = (iso) => { const d = new Date(iso); d.setDate(d.getDate() + 1); return d.toISOString().split('T')[0]; };

/**
 * @param {Array} rows  entries from seaTimeService.fetchEntriesForUser
 * @returns {{ vessels:Object, entries:Array }}
 */
export const adaptLiveEntries = (rows) => {
  const vessels = {};
  const sorted = [...rows].sort((a, b) => String(a.date).localeCompare(String(b.date)));

  // Build the vessels map from row snapshots.
  for (const r of sorted) {
    const id = r.vesselImo || r.vesselName || 'unknown';
    if (!vessels[id]) {
      const lengthM = r.lengthM != null ? Number(r.lengthM) : null;
      vessels[id] = {
        id, name: r.vesselName || 'Vessel', flag: r.vesselFlag || '', imo: r.vesselImo || '',
        gt: r.grossTonnage != null ? Number(r.grossTonnage) : null,
        lengthM, over15: lengthM != null ? lengthM >= 15 : false,
        type: r.vesselType || ''
      };
    }
  }

  // Group contiguous same-attribute days into voyage entries.
  const entries = [];
  let cur = null;
  const flush = () => {
    if (!cur) return;
    const yr = new Date(cur.from).getFullYear();
    const main = fmtDM(cur.from) + (cur.to !== cur.from ? ' – ' + fmtDM(cur.to) : '');
    entries.push({
      id: cur.ids[0], rowIds: cur.ids, vesselId: cur.vesselId,
      label: cur.label, from: cur.from, to: cur.to, days: cur.days,
      type: cur.type, watchHours: cur.watchHours, capacity: cur.capacity, source: cur.source,
      dateMain: main, dateSub: `${yr} · ${cur.days}${cur.days === 1 ? ' day' : ' days'}`, excluded: false
    });
  };

  for (const r of sorted) {
    const id = r.vesselImo || r.vesselName || 'unknown';
    const src = SOURCE_MAP[r.source] || 'manual';
    const sameRun = cur &&
      cur.vesselId === id && cur.type === r.serviceType && cur.capacity === (r.capacityServed || '') &&
      cur.watchHours === (r.watchHours || 0) && cur.source === src && cur.to && nextDay(cur.to) === r.date;
    if (sameRun) {
      cur.to = r.date; cur.days += 1; cur.ids.push(r.id);
    } else {
      flush();
      cur = {
        vesselId: id, type: r.serviceType, watchHours: r.watchHours || 0, capacity: r.capacityServed || '',
        source: src, from: r.date, to: r.date, days: 1, ids: [r.id],
        label: `${(vessels[id]?.name) || 'Vessel'} · ${r.serviceType}`
      };
    }
  }
  flush();

  return { vessels, entries };
};
