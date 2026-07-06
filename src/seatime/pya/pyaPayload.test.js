import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPyaPayload, mapCapacity, mapVesselType } from './pyaPayload.js';

const dataset = {
  vessels: [{ name: 'M/Y Test', flag: 'Cayman Islands', imo: '9601234', grossTonnage: 499, registeredLengthM: 45, vesselType: 'Motor Yacht' }],
  service: {
    capacity: 'Deckhand',
    periodFrom: '2026-01-01',
    periodTo: '2026-06-30',
    totals: { seagoing: 80, watchkeeping: 30, standby: 20, yard: 16 },
  },
};

test('Actual days at Sea = seagoing + watchkeeping; watchkeeping is the subset', () => {
  const p = buildPyaPayload({ dataset });
  assert.equal(p.service['Actual days at Sea'], 110);      // 80 + 30
  assert.equal(p.service['Deck Watchkeeping'], 30);        // subset, not additive
  assert.equal(p.service['Stand-by Service'], 20);
  assert.equal(p.service['Shipyard Service'], 16);
});

test('optional boxes only appear when supplied', () => {
  const bare = buildPyaPayload({ dataset });
  assert.ok(!('Leave of absence' in bare.service));
  assert.ok(!('Days with guests' in bare.service));
  const full = buildPyaPayload({ dataset, leaveDays: 24, guestDays: 12 });
  assert.equal(full.service['Leave of absence'], 24);
  assert.equal(full.service['Days with guests'], 12);
  // zero guest days is omitted (nothing to say)
  const noGuests = buildPyaPayload({ dataset, guestDays: 0 });
  assert.ok(!('Days with guests' in noGuests.service));
});

test('vessel + dates + radios map across', () => {
  const p = buildPyaPayload({ dataset, signatoryEmail: 'cap@x.com' });
  assert.equal(p.text['Name'], 'M/Y Test');
  assert.equal(p.text['IMO'], '9601234');
  assert.equal(p.text['Gross tonnage (GT)'], '499');
  assert.equal(p.text['Load Line Length (m)'], '45');
  assert.deepEqual(p.dates, { from: '2026-01-01', to: '2026-06-30' });
  assert.equal(p.capacity, 'Deckhand');
  assert.equal(p.vesselType, 'Motor Yacht');
  assert.equal(p.signatoryEmail, 'cap@x.com');
  assert.deepEqual(p.radios, [{ label: 'New Digital SST' }, { label: 'Deck Testimonial' }]);
});

test('capacity mapping covers the PYA options', () => {
  assert.equal(mapCapacity('Master'), 'Master');
  assert.equal(mapCapacity('Chief Officer'), 'Chief Mate');
  assert.equal(mapCapacity('Officer of the Watch'), 'OOW');
  assert.equal(mapCapacity('Bosun'), 'Bosun');
  assert.equal(mapCapacity('Chase Boat Captain'), 'Chase Boat Captain');
  assert.equal(mapCapacity('Deckhand'), 'Deckhand');
  assert.equal(mapCapacity('Stewardess'), null);          // unknown → manual
});

test('vessel type falls back to Motor', () => {
  assert.equal(mapVesselType('Sailing Yacht'), 'Sail Yacht');
  assert.equal(mapVesselType('Motor Yacht'), 'Motor Yacht');
  assert.equal(mapVesselType(''), 'Motor Yacht');
});
