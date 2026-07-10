import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPyaPayload, mapCapacity, mapVesselType, mapAreas, cleanVesselName, parseRotationWeeks } from './pyaPayload.js';

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

test('propulsion + engine type fill when supplied, else manual', () => {
  const bare = buildPyaPayload({ dataset });
  assert.ok(!('Propulsion power (kW)' in bare.text));
  assert.ok(bare.manual.includes('Propulsion power (kW)'));
  assert.ok(bare.manual.includes('Type of Main Engine'));
  const p = buildPyaPayload({ dataset, propulsionKw: 2400, engineType: '2 x MTU 16V 2000 M96' });
  assert.equal(p.text['Propulsion power (kW)'], '2400');
  assert.equal(p.text['Type of Main Engine'], '2 x MTU 16V 2000 M96');
  assert.ok(!p.manual.includes('Propulsion power (kW)'));
  assert.ok(!p.manual.includes('Type of Main Engine'));
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
  assert.equal(p.text['Name'], 'Test');   // M/Y prefix stripped
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
  // Deck
  assert.equal(mapCapacity('Master'), 'Master');
  assert.equal(mapCapacity('Chief Officer'), 'Chief Mate');
  assert.equal(mapCapacity('Officer of the Watch'), 'OOW');
  assert.equal(mapCapacity('Bosun'), 'Bosun');
  assert.equal(mapCapacity('Chase Boat Captain'), 'Chase Boat Captain');
  assert.equal(mapCapacity('Deckhand'), 'Deckhand');
  // Engine — checked before deck so a watchkeeping engineer isn't read as deck OOW
  assert.equal(mapCapacity('Chief Engineer'), 'Chief Engineer');
  assert.equal(mapCapacity('2nd Engineer'), 'Second Engineer');
  assert.equal(mapCapacity('EOOW'), 'Engineer Watchkeeper');
  assert.equal(mapCapacity('Engineer Watchkeeper'), 'Engineer Watchkeeper');
  assert.equal(mapCapacity('Engineer'), 'Engineer');
  assert.equal(mapCapacity('ETO'), 'ETO');
  assert.equal(mapCapacity('Electro-Technical Officer'), 'ETO');
  // Interior / galley
  assert.equal(mapCapacity('Stewardess'), 'Steward / ess');
  assert.equal(mapCapacity('Chief Stewardess'), 'Chief steward / ess');
  assert.equal(mapCapacity('Purser'), 'Purser');
  assert.equal(mapCapacity('Chef'), 'Chef');
  assert.equal(mapCapacity('Cook'), 'Cook');
  assert.equal(mapCapacity('Random Role'), null);         // unknown → manual
});

test('vessel name drops the M/Y · S/Y prefix (type is its own field)', () => {
  assert.equal(cleanVesselName('M/Y Belongers'), 'Belongers');
  assert.equal(cleanVesselName('S/Y Tern'), 'Tern');
  assert.equal(cleanVesselName('MY Serenity'), 'Serenity');
  assert.equal(cleanVesselName('Belongers'), 'Belongers');      // no prefix, untouched
  assert.equal(cleanVesselName('Mystic'), 'Mystic');            // not a prefix (no space)
  assert.equal(buildPyaPayload({ dataset }).text['Name'], 'M/Y Test'.replace(/^M\/Y /, ''));
});

test('rotation pattern → PYA weeks (explicit unit wins; else infer months for small figures)', () => {
  assert.deepEqual(parseRotationWeeks('2:2'), { onWeeks: 9, offWeeks: 9 });         // ≤6 → months → ×4.345
  assert.deepEqual(parseRotationWeeks('3:3'), { onWeeks: 13, offWeeks: 13 });
  assert.deepEqual(parseRotationWeeks('2:1'), { onWeeks: 9, offWeeks: 4 });
  assert.deepEqual(parseRotationWeeks('10:10'), { onWeeks: 10, offWeeks: 10 });     // large → weeks
  assert.deepEqual(parseRotationWeeks('9:9 weeks'), { onWeeks: 9, offWeeks: 9 });   // explicit weeks
  assert.deepEqual(parseRotationWeeks('2:2 months'), { onWeeks: 9, offWeeks: 9 });  // explicit months
  assert.equal(parseRotationWeeks(''), null);
  assert.equal(parseRotationWeeks('permanent'), null);
});

test('rotation weeks flow into the payload service block', () => {
  const p = buildPyaPayload({ dataset, rotationOnWeeks: 9, rotationOffWeeks: 9 });
  assert.equal(p.service['Rotation program on'], 9);
  assert.equal(p.service['Rotation program off'], 9);
});

test('vessel type falls back to Motor', () => {
  assert.equal(mapVesselType('Sailing Yacht'), 'Sail Yacht');
  assert.equal(mapVesselType('Motor Yacht'), 'Motor Yacht');
  assert.equal(mapVesselType(''), 'Motor Yacht');
});

test('areas map from region text; blank stays manual', () => {
  assert.deepEqual(mapAreas('Med'), ['Mediterranean (East)', 'Mediterranean (West)']);
  assert.deepEqual(mapAreas('Caribbean & Bahamas'), ['Caribbean', 'Bahamas/Cayman Islands']);
  assert.deepEqual(mapAreas(''), []);
  // blank region → 'Areas cruised' listed as manual, no areas on the payload
  const p = buildPyaPayload({ dataset, operatingRegions: '' });
  assert.deepEqual(p.areas, []);
  assert.ok(p.manual.includes('Areas cruised'));
  const p2 = buildPyaPayload({ dataset, operatingRegions: 'West Mediterranean' });
  assert.ok(p2.areas.length > 0);
  assert.ok(!p2.manual.includes('Areas cruised'));
});
