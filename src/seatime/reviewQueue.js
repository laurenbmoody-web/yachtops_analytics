// Sample queue of sea-service sign-offs awaiting a master's decision, shown in
// the reviews inbox (/reviews/seatime). Each item is one COMMAND SPELL on one
// vessel for one seafarer — the same unit shape the crew-profile dashboard
// builds — so <CaptainSignoff/> renders it unchanged. Mirrors the sample data
// in src/seatime/seed.js; live wiring (pending submitted entries scoped to the
// signing master) is a follow-up.

export const SEATIME_REVIEW_QUEUE = [
  {
    id: 'rq1',
    requestedAt: '2026-04-22',
    seafarer: { fullName: 'Lauren Moody', rank: 'Master' },
    unit: {
      name: 'M/Y Pelorus II', flag: 'Marshall Is.', imo: '9345678', officialNo: 'MI-23117', gt: 1450, lengthM: 68, kw: 5600,
      mode: 'stamp', multi: false, cmdLabel: null,
      captainName: 'Capt. Henrik Sörensen', captainCoc: 'GBR-CoC-447120', captainCocGrade: 'Master (Yachts) <3000GT', captainEmail: 'h.sorensen@example.com',
      cmdFrom: null, cmdTo: null,
      periods: [
        { id: 'e1', dateMain: '04 – 28 Jan', days: 24, type: 'watchkeeping', watchHours: 8, capacity: 'Master', from: '2026-01-04', to: '2026-01-28' },
        { id: 'e2', dateMain: '01 – 14 Feb', days: 14, type: 'seagoing', watchHours: 0, capacity: 'Master', from: '2026-02-01', to: '2026-02-14' }
      ]
    }
  },
  {
    id: 'rq2',
    requestedAt: '2026-04-20',
    seafarer: { fullName: 'Daniel Roux', rank: 'Chief Officer' },
    unit: {
      name: 'M/Y Aurora Borealis', flag: 'Cayman Is.', imo: '9123456', officialNo: '745210', gt: 380, lengthM: 42, kw: 2240,
      mode: 'virtual', multi: true, cmdLabel: 'In command — – 31/03/2026',
      captainName: 'Capt. Maria Lindqvist', captainCoc: 'CEC-204417', captainCocGrade: 'Master (Yachts) <3000GT', captainEmail: 'm.lindqvist@example.com',
      cmdFrom: null, cmdTo: '2026-03-31',
      periods: [
        { id: 'e3', dateMain: '02 Mar', days: 1, type: 'watchkeeping', watchHours: 3, capacity: 'Chief Officer', detailOverride: 'Reclassified from watchkeeping', from: '2026-03-02', to: '2026-03-02' },
        { id: 'e4', dateMain: '12 – 18 Mar', days: 7, type: 'watchkeeping', watchHours: 6, capacity: 'Chief Officer', from: '2026-03-12', to: '2026-03-18' }
      ]
    }
  },
  {
    id: 'rq3',
    requestedAt: '2026-04-20',
    seafarer: { fullName: 'Daniel Roux', rank: 'Chief Officer' },
    unit: {
      name: 'M/Y Aurora Borealis', flag: 'Cayman Is.', imo: '9123456', officialNo: '745210', gt: 380, lengthM: 42, kw: 2240,
      mode: 'stamp', multi: true, cmdLabel: 'In command 01/04/2026 – present',
      captainName: 'Capt. James Okafor', captainCoc: 'GBR-CoC-559302', captainCocGrade: 'Master (Yachts) <500GT', captainEmail: 'j.okafor@example.com',
      cmdFrom: '2026-04-01', cmdTo: null,
      periods: [
        { id: 'e6', dateMain: '03 – 10 Apr', days: 8, type: 'standby', watchHours: 0, capacity: 'Chief Officer', detailOverride: 'Counts up to your sea-service days', from: '2026-04-03', to: '2026-04-10' },
        { id: 'e7', dateMain: '15 – 22 Apr', days: 8, type: 'yard', watchHours: 0, capacity: 'Chief Officer', detailOverride: 'Shipyard / refit service', from: '2026-04-15', to: '2026-04-22' }
      ]
    }
  }
];
