// Sample data from the design handoff (the mock's seed). Used to drive the
// dashboard before the live store is wired, and by the unit tests.

// `cargoRegistered` — the vessel keeps its records in Cargo. The STAMP (the
// strongest attestation) hinges on the MASTER OF RECORD still being aboard:
//   captainMember  — the master who commanded during this service is STILL
//                    aboard this vessel in Cargo → the ship can be stamped
//                    (valid even after the crew member has signed off).
//   captainOnCargo — that master still has a Cargo account even if they've left
//                    the vessel → they can sign VIRTUALLY in-app; if they've
//                    left Cargo too, they sign by emailed secure link, and only
//                    failing that does the crew upload an EXTERNAL testimonial.
//   crewMember     — whether THIS seafarer was on Cargo for the service (record
//                    provenance); the crew leaving never downgrades the route.
// `commands` (optional) — a vessel can change command mid-service. Each spell is
// the master and the dates they were active aboard (A ends on his leave date, B
// starts on his join date). A seafarer's service is split by which master was in
// command on each period, so each master signs only his own dates. When absent,
// the vessel has a single implied command from the captain* fields above.
export const SEED_VESSELS = {
  v1: { id: 'v1', name: 'M/Y Aurora Borealis', flag: 'Cayman Is.', portReg: 'George Town', imo: '9123456', officialNo: '745210', gt: 380,  lengthM: 42, over15: true,  maxPax: 12, type: 'Motor', kw: 2240, cargoRegistered: true,  crewMember: true,  captainMember: true,  captainOnCargo: true,  captainName: 'Capt. James Okafor', captainCoc: 'GBR-CoC-559302', captainCocGrade: 'Master (Yachts) <500GT', captainEmail: 'j.okafor@example.com',
       commands: [
         { id: 'lindqvist', name: 'Capt. Maria Lindqvist', coc: 'CEC-204417',    cocGrade: 'Master (Yachts) <3000GT', email: 'm.lindqvist@example.com', member: false, onCargo: true, from: null,         to: '2026-03-31' },
         { id: 'okafor',    name: 'Capt. James Okafor',    coc: 'GBR-CoC-559302', cocGrade: 'Master (Yachts) <500GT',  email: 'j.okafor@example.com',  member: true,  onCargo: true, from: '2026-04-01', to: null }
       ] },
  v2: { id: 'v2', name: 'S/Y Tern',            flag: 'Malta',      portReg: 'Valletta',    imo: '9234567', officialNo: 'MLT-11892', gt: 18,   lengthM: 12, over15: false, maxPax: 8, type: 'Sail',  kw: 75,   cargoRegistered: false, crewMember: false, captainMember: false, captainOnCargo: false, captainName: 'Capt. R. Owens', captainCoc: 'MCA-118803', captainCocGrade: 'Master (Yachts) <500GT', captainEmail: 'r.owens@example.com' },
  v3: { id: 'v3', name: 'M/Y Pelorus II',      flag: 'Marshall Is.', portReg: 'Majuro',    imo: '9345678', officialNo: 'MI-23117', gt: 1450, lengthM: 68, over15: true,  maxPax: 12, type: 'Motor', kw: 5600, cargoRegistered: true,  crewMember: true,  captainMember: true,  captainOnCargo: true,  captainName: 'Capt. Henrik Sõrensen', captainCoc: 'GBR-CoC-447120', captainCocGrade: 'Master (Yachts) <3000GT', captainEmail: 'h.sorensen@example.com' }
};

// Prior (lifetime) accrual baseline added to the current period for the bars.
export const SEED_PRIOR = { onboard: 590, seagoing: 284, watchkeeping: 95, total: 590 };

export const SEED_SEAFARER = {
  fullName: 'Lauren Moody',
  rankLine: 'Captain · Bridge · Command',
  dob: '1992-10-03',
  nationality: 'British',
  passportNo: '561204827',
  dischargeBookNo: 'GBR-DB-208841',
  cocHeld: 'Master (Yachts) <500GT',
  periodFrom: '2026-01-04',
  periodTo: '2026-04-22'
};

export const SEED_ENTRIES = [
  { id: 'e1', vesselId: 'v3', label: 'Caribbean season',   region: 'Caribbean',        from: '2026-01-04', to: '2026-01-28', dateMain: '04 – 28 Jan', dateSub: '2026 · 24 days', days: 24, type: 'watchkeeping', watchHours: 8, capacity: 'Master', source: 'rota' },
  { id: 'e2', vesselId: 'v3', label: 'Atlantic crossing',  region: 'Atlantic crossing', from: '2026-02-01', to: '2026-02-14', dateMain: '01 – 14 Feb', dateSub: '2026 · 14 days', days: 14, type: 'seagoing',     watchHours: 0, capacity: 'Master', source: 'rota' },
  { id: 'e5', vesselId: 'v2', label: "Côte d'Azur coastal", region: 'W. Mediterranean', from: '2026-02-20', to: '2026-02-24', dateMain: '20 – 24 Feb', dateSub: '2026 · 5 days',  days: 5,  type: 'seagoing',     watchHours: 0, capacity: 'Master', source: 'manual', excluded: false },
  { id: 'e3', vesselId: 'v1', label: 'Genoa harbour day',  region: 'W. Mediterranean', from: '2026-03-02', to: '2026-03-02', dateMain: '02 Mar',      dateSub: '2026 · 1 day',  days: 1,  type: 'watchkeeping', watchHours: 3, capacity: 'Master', source: 'manual', excluded: false },
  { id: 'e4', vesselId: 'v1', label: 'Tyrrhenian passage', region: 'W. Mediterranean', from: '2026-03-12', to: '2026-03-18', dateMain: '12 – 18 Mar', dateSub: '2026 · 7 days',  days: 7,  type: 'watchkeeping', watchHours: 6, capacity: 'Master', source: 'ais' },
  { id: 'e6', vesselId: 'v1', label: 'Standby — Port Vauban', region: 'W. Mediterranean', from: '2026-04-03', to: '2026-04-10', dateMain: '03 – 10 Apr', dateSub: '2026 · 8 days', days: 8, type: 'standby', watchHours: 0, capacity: 'Master', source: 'manual' },
  { id: 'e7', vesselId: 'v1', label: 'Antibes refit period', region: 'W. Mediterranean', from: '2026-04-15', to: '2026-04-22', dateMain: '15 – 22 Apr', dateSub: '2026 · 8 days', days: 8, type: 'yard', watchHours: 0, capacity: 'Master', source: 'manual' }
];
