// Sample data from the design handoff (the mock's seed). Used to drive the
// dashboard before the live store is wired, and by the unit tests.

export const SEED_VESSELS = {
  v1: { id: 'v1', name: 'M/Y Aurora Borealis', flag: 'Cayman Is.', imo: '9123456', gt: 380,  lengthM: 42, over15: true,  type: 'Motor' },
  v2: { id: 'v2', name: 'S/Y Tern',            flag: 'Malta',      imo: '9234567', gt: 18,   lengthM: 12, over15: false, type: 'Sail'  },
  v3: { id: 'v3', name: 'M/Y Pelorus II',      flag: 'Marshall Is.', imo: '9345678', gt: 1450, lengthM: 68, over15: true,  type: 'Motor' }
};

// Prior (lifetime) accrual baseline added to the current period for the bars.
export const SEED_PRIOR = { onboard: 590, seagoing: 284, watchkeeping: 95, total: 590 };

export const SEED_SEAFARER = {
  fullName: 'Lauren Moody',
  rankLine: 'Captain · Bridge · Command',
  dob: '1992-10-03',
  nationality: 'British',
  dischargeBookNo: 'GBR-DB-208841',
  cocHeld: 'Master (Yachts) <500GT',
  periodFrom: '2026-01-04',
  periodTo: '2026-04-22'
};

export const SEED_ENTRIES = [
  { id: 'e1', vesselId: 'v3', label: 'Caribbean season',   from: '2026-01-04', to: '2026-01-28', dateMain: '04 – 28 Jan', dateSub: '2026 · 24 days', days: 24, type: 'watchkeeping', watchHours: 8, capacity: 'Master', source: 'rota' },
  { id: 'e2', vesselId: 'v3', label: 'Atlantic crossing',  from: '2026-02-01', to: '2026-02-14', dateMain: '01 – 14 Feb', dateSub: '2026 · 14 days', days: 14, type: 'seagoing',     watchHours: 0, capacity: 'Master', source: 'rota' },
  { id: 'e5', vesselId: 'v2', label: "Côte d'Azur coastal", from: '2026-02-20', to: '2026-02-24', dateMain: '20 – 24 Feb', dateSub: '2026 · 5 days',  days: 5,  type: 'seagoing',     watchHours: 0, capacity: 'Master', source: 'manual', excluded: false },
  { id: 'e3', vesselId: 'v1', label: 'Genoa harbour day',  from: '2026-03-02', to: '2026-03-02', dateMain: '02 Mar',      dateSub: '2026 · 1 day',  days: 1,  type: 'watchkeeping', watchHours: 3, capacity: 'Master', source: 'manual', excluded: false },
  { id: 'e4', vesselId: 'v1', label: 'Tyrrhenian passage', from: '2026-03-12', to: '2026-03-18', dateMain: '12 – 18 Mar', dateSub: '2026 · 7 days',  days: 7,  type: 'watchkeeping', watchHours: 6, capacity: 'Master', source: 'ais' },
  { id: 'e6', vesselId: 'v1', label: 'Standby — Port Vauban', from: '2026-04-03', to: '2026-04-10', dateMain: '03 – 10 Apr', dateSub: '2026 · 8 days', days: 8, type: 'standby', watchHours: 0, capacity: 'Master', source: 'manual' },
  { id: 'e7', vesselId: 'v1', label: 'Antibes refit period', from: '2026-04-15', to: '2026-04-22', dateMain: '15 – 22 Apr', dateSub: '2026 · 8 days', days: 8, type: 'yard', watchHours: 0, capacity: 'Master', source: 'manual' }
];
