// Adapts the Supabase sea-service rows (one row per day) into the engine's
// voyage-shaped entries (date ranges with a day count) + a vessels map, by
// grouping contiguous runs of the same vessel + service type + master + status.
// It also carries the route facts (Cargo-registration, master of record, whether
// that master is still aboard / on Cargo) so the dashboard can derive the
// stamp/virtual/external route and the change-of-command split from live data.

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

  // Build the vessels map from row snapshots (+ the Cargo-registration flag).
  for (const r of sorted) {
    const id = r.vesselImo || r.vesselName || 'unknown';
    if (!vessels[id]) {
      const lengthM = r.lengthM != null ? Number(r.lengthM) : null;
      vessels[id] = {
        id, name: r.vesselName || 'Vessel', flag: r.vesselFlag || '', imo: r.vesselImo || '',
        officialNo: r.vesselOfficialNo || '',
        gt: r.grossTonnage != null ? Number(r.grossTonnage) : null,
        lengthM, over15: lengthM != null ? lengthM >= 15 : false,
        type: r.vesselType || '',
        cargoRegistered: r.cargoRegistered == null ? false : !!r.cargoRegistered
      };
    }
  }

  // Group contiguous same-attribute days into voyage entries. Runs break at a
  // change of master of record or verification status, so each entry belongs to
  // exactly one command spell and carries a single status.
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
      masterName: cur.masterName, masterAboard: cur.masterAboard, masterOnCargo: cur.masterOnCargo,
      vstatus: cur.vstatus, rejectionReason: cur.rejectionReason || null, testimonialPath: cur.testimonialPath || null,
      dateMain: main, dateSub: `${yr} · ${cur.days}${cur.days === 1 ? ' day' : ' days'}`, excluded: false
    });
  };

  for (const r of sorted) {
    const id = r.vesselImo || r.vesselName || 'unknown';
    const src = SOURCE_MAP[r.source] || 'manual';
    const master = r.masterName || '';
    const vstatus = r.rawVerificationStatus || null;
    const sameRun = cur &&
      cur.vesselId === id && cur.type === r.serviceType && cur.capacity === (r.capacityServed || '') &&
      cur.watchHours === (r.watchHours || 0) && cur.source === src &&
      cur.masterName === master && cur.vstatus === vstatus && cur.to && nextDay(cur.to) === r.date;
    if (sameRun) {
      cur.to = r.date; cur.days += 1; cur.ids.push(r.id);
    } else {
      flush();
      cur = {
        vesselId: id, type: r.serviceType, watchHours: r.watchHours || 0, capacity: r.capacityServed || '',
        source: src, masterName: master, masterAboard: !!r.masterAboard, masterOnCargo: !!r.masterOnCargo,
        vstatus, rejectionReason: r.rejectionReason || null, testimonialPath: r.testimonialPath || null, from: r.date, to: r.date, days: 1, ids: [r.id],
        label: `${(vessels[id]?.name) || 'Vessel'} · ${r.serviceType}`
      };
    }
  }
  flush();

  // Build command spells per vessel from the masters of record, so a vessel
  // whose command changed mid-service splits into one signable unit per master.
  const byVessel = {};
  for (const e of entries) { (byVessel[e.vesselId] ||= []).push(e); }
  for (const [vid, es] of Object.entries(byVessel)) {
    const v = vessels[vid]; if (!v) continue;
    const masters = new Map();
    for (const e of es) {
      const key = e.masterName || '';
      if (!key) continue;
      if (!masters.has(key)) masters.set(key, { name: key, member: !!e.masterAboard, onCargo: !!e.masterOnCargo, from: e.from, to: e.to });
      else { const m = masters.get(key); if (e.from < m.from) m.from = e.from; if (e.to > m.to) m.to = e.to; }
    }
    const cmds = [...masters.values()].sort((a, b) => (a.from < b.from ? -1 : 1));
    if (cmds.length) {
      v.commands = cmds.map((m, i) => ({ id: `c${i}`, name: m.name, member: m.member, onCargo: m.onCargo, from: m.from, to: m.to, coc: '', cocGrade: '', email: '' }));
      const last = cmds[cmds.length - 1];
      v.captainName = last.name; v.captainMember = last.member; v.captainOnCargo = last.onCargo;
    }
  }

  return { vessels, entries };
};
