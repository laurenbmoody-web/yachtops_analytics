import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fullName, personKey, cabinOf, contactOf, guestTypeLabel, initialsOf,
  groupGuestsByPerson, searchPeople, sortPeople, rosterStats, SORT_COLUMNS,
} from './guestRoster.js';

// The real Horizon rows that prompted this: one person, two records, two
// spellings of the same cabin.
const RAFAEL_OWNER = {
  id: 'r1', firstName: 'Rafael', lastName: 'Edry', guestType: 'Owner',
  cabinAllocated: 'Master Cabin', isDeleted: false, isActiveOnTrip: false,
};
const RAFAEL_CHARTER = {
  id: 'r2', firstName: 'Rafael', lastName: 'Edry', guestType: 'Charter',
  cabinAllocated: 'Master', isDeleted: false, isActiveOnTrip: false,
};
const JANE = {
  id: 'j1', firstName: 'Jane', lastName: 'Doh', guestType: 'Charter',
  cabinAllocated: 'Main Deck > Forward > Cabin 101',
  contactEmail: 'test@test.com', allergies: 'Shellfish, Peanuts, Soy',
  isDeleted: false, isActiveOnTrip: true,
};

test('the duplicated person collapses to one row that admits it', () => {
  const people = groupGuestsByPerson([RAFAEL_OWNER, RAFAEL_CHARTER]);
  assert.equal(people.length, 1);
  const [rafael] = people;
  assert.equal(rafael.name, 'Rafael Edry');
  assert.equal(rafael.recordCount, 2);
  assert.equal(rafael.hasDuplicates, true);
  assert.deepEqual(rafael.types, ['Owner', 'Charter']);
  // The disagreement is surfaced, not smoothed over.
  assert.deepEqual(rafael.cabins, ['Master Cabin', 'Master']);
  assert.equal(rafael.cabinsDisagree, true);
});

test('a person with one record is not flagged as duplicated', () => {
  const [jane] = groupGuestsByPerson([JANE]);
  assert.equal(jane.recordCount, 1);
  assert.equal(jane.hasDuplicates, false);
  assert.equal(jane.cabinsDisagree, false);
});

test('cabin shows the last path segment', () => {
  assert.equal(cabinOf(JANE), 'Cabin 101');
  assert.equal(cabinOf(RAFAEL_OWNER), 'Master Cabin');
  assert.equal(cabinOf({}), '');
  assert.equal(cabinOf({ cabinAllocated: '   ' }), '');
});

test('cabin reads the five columns in the old order', () => {
  // Behaviour preserved from the page this replaces, so nothing moves on screen.
  assert.equal(
    cabinOf({ cabinLocationPath: 'A > B', cabinLocationLabel: 'X', cabinAllocated: 'Y' }),
    'B',
  );
  assert.equal(cabinOf({ cabinLocationLabel: 'X', cabinAllocated: 'Y' }), 'X');
  assert.equal(cabinOf({ cabinAllocated: 'Y' }), 'Y');
});

test('legacy lowercase guest types are presented consistently', () => {
  assert.equal(guestTypeLabel('principal'), 'Principal');
  assert.equal(guestTypeLabel('guest'), 'Guest');
  assert.equal(guestTypeLabel('Owner'), 'Owner');
  assert.equal(guestTypeLabel('Unknown'), '');
  assert.equal(guestTypeLabel(null), '');
  assert.equal(guestTypeLabel(''), '');
});

test('a person is deleted only when every record of them is', () => {
  const half = groupGuestsByPerson([
    { ...RAFAEL_OWNER, isDeleted: true },
    RAFAEL_CHARTER,
  ]);
  assert.equal(half[0].isDeleted, false);
  // and the live record is the one the page acts on
  assert.equal(half[0].primaryId, 'r2');
  assert.deepEqual(half[0].types, ['Charter']);

  const all = groupGuestsByPerson([
    { ...RAFAEL_OWNER, isDeleted: true },
    { ...RAFAEL_CHARTER, isDeleted: true },
  ]);
  assert.equal(all[0].isDeleted, true);
  assert.equal(all[0].recordCount, 2);
});

test('name matching ignores case and stray whitespace', () => {
  assert.equal(personKey({ firstName: ' Rafael ', lastName: 'EDRY' }), 'rafael edry');
  assert.equal(fullName({ firstName: 'Rafael', lastName: '  Edry' }), 'Rafael Edry');
  const people = groupGuestsByPerson([
    RAFAEL_OWNER,
    { ...RAFAEL_CHARTER, firstName: '  rafael', lastName: 'edry  ' },
  ]);
  assert.equal(people.length, 1);
});

test('rows without a usable name are dropped rather than grouped together', () => {
  // Otherwise every nameless row collapses into one bogus person.
  const people = groupGuestsByPerson([
    { id: 'x', firstName: '', lastName: '' },
    { id: 'y', firstName: '   ', lastName: '' },
    JANE,
  ]);
  assert.equal(people.length, 1);
  assert.equal(people[0].name, 'Jane Doh');
});

test('contact and allergies come from whichever record has them', () => {
  const [rafael] = groupGuestsByPerson([
    RAFAEL_OWNER,
    { ...RAFAEL_CHARTER, contactEmail: 'r@example.com', allergies: 'Gluten' },
  ]);
  assert.equal(rafael.contact, 'r@example.com');
  assert.equal(rafael.allergies, 'Gluten');
  assert.equal(contactOf({ contactPhone: '+1234' }), '+1234');
  assert.equal(contactOf({}), '');
});

test('search covers allergies, cabin and type, not just the name', () => {
  const people = groupGuestsByPerson([JANE, RAFAEL_OWNER, RAFAEL_CHARTER]);
  assert.deepEqual(searchPeople(people, 'shellfish').map((p) => p.name), ['Jane Doh']);
  assert.deepEqual(searchPeople(people, 'cabin 101').map((p) => p.name), ['Jane Doh']);
  assert.deepEqual(searchPeople(people, 'owner').map((p) => p.name), ['Rafael Edry']);
  assert.equal(searchPeople(people, '').length, 2);
  assert.equal(searchPeople(people, '   ').length, 2);
  assert.equal(searchPeople(people, 'nobody').length, 0);
});

test('sorting puts blanks last in both directions', () => {
  const people = groupGuestsByPerson([JANE, RAFAEL_OWNER]);
  // Jane has a contact, Rafael does not.
  assert.deepEqual(sortPeople(people, 'contact', 'asc').map((p) => p.name),
    ['Jane Doh', 'Rafael Edry']);
  assert.deepEqual(sortPeople(people, 'contact', 'desc').map((p) => p.name),
    ['Jane Doh', 'Rafael Edry']);
});

test('sorting by name works both ways and is stable on ties', () => {
  const people = groupGuestsByPerson([RAFAEL_OWNER, JANE]);
  assert.deepEqual(sortPeople(people, 'name', 'asc').map((p) => p.name),
    ['Jane Doh', 'Rafael Edry']);
  assert.deepEqual(sortPeople(people, 'name', 'desc').map((p) => p.name),
    ['Rafael Edry', 'Jane Doh']);
});

test('an unsorted or unknown column returns the list unchanged', () => {
  const people = groupGuestsByPerson([RAFAEL_OWNER, JANE]);
  const order = people.map((p) => p.name);
  assert.deepEqual(sortPeople(people, null, null).map((p) => p.name), order);
  assert.deepEqual(sortPeople(people, 'passport', 'asc').map((p) => p.name), order);
  assert.deepEqual(SORT_COLUMNS, ['name', 'cabin', 'contact', 'type']);
});

test('sorting does not mutate the input', () => {
  const people = groupGuestsByPerson([RAFAEL_OWNER, JANE]);
  const before = people.map((p) => p.name);
  sortPeople(people, 'name', 'desc');
  assert.deepEqual(people.map((p) => p.name), before);
});

test('stats count people and exclude the deleted', () => {
  const people = groupGuestsByPerson([
    JANE, RAFAEL_OWNER, RAFAEL_CHARTER,
    { id: 'd', firstName: 'Gone', lastName: 'Away', isDeleted: true },
  ]);
  assert.deepEqual(rosterStats(people), {
    people: 2, aboard: 1, withAllergies: 1, duplicates: 1,
  });
});

test('survives junk input without throwing', () => {
  assert.deepEqual(groupGuestsByPerson(null), []);
  assert.deepEqual(groupGuestsByPerson(undefined), []);
  assert.deepEqual(groupGuestsByPerson([null, undefined]), []);
  assert.deepEqual(searchPeople(null, 'x'), []);
  assert.deepEqual(sortPeople(null, 'name', 'asc'), []);
  assert.deepEqual(rosterStats(null), { people: 0, aboard: 0, withAllergies: 0, duplicates: 0 });
});

// ── the role comes from the trip ────────────────────────────────────────────
import { rolesOf, isAboard } from './guestRoster.js';

const onTrip = (tripType, { from, to, active = true } = {}) => ({
  tripId: `${tripType}-1`, tripType, isActiveOnTrip: active, startDate: from, endDate: to,
});

test('one person on two trips holds both roles without being cloned', () => {
  // The thing the duplicate records were standing in for.
  const [person] = groupGuestsByPerson([{
    id: 'g1', firstName: 'Rafael', lastName: 'Edry', guestType: 'Owner',
    trips: [onTrip('Owner'), onTrip('Charter')],
  }]);
  assert.equal(person.recordCount, 1);
  assert.equal(person.hasDuplicates, false);
  assert.deepEqual(person.types, ['Owner', 'Charter']);
});

test('the trip wins over the legacy guest_type', () => {
  const [person] = groupGuestsByPerson([{
    id: 'g1', firstName: 'A', lastName: 'B', guestType: 'Owner',
    trips: [onTrip('Charter')],
  }]);
  assert.deepEqual(person.types, ['Charter']);
});

test('guest_type is still used when there are no trips', () => {
  assert.deepEqual(rolesOf([{ guestType: 'Owner', trips: [] }]), ['Owner']);
  assert.deepEqual(rolesOf([{ guestType: 'Charter' }]), ['Charter']);
  assert.deepEqual(rolesOf([{ guestType: 'principal', trips: [] }]), ['Principal']);
  assert.deepEqual(rolesOf([{}]), []);
});

test('aboard is read from a trip that is actually running', () => {
  const asOf = new Date('2026-06-20T00:00:00Z');
  assert.equal(isAboard([{ trips: [onTrip('Owner', { from: '2026-06-18', to: '2026-06-25' })] }], asOf), true);
  // finished
  assert.equal(isAboard([{ trips: [onTrip('Owner', { from: '2026-05-01', to: '2026-05-08' })] }], asOf), false);
  // not started
  assert.equal(isAboard([{ trips: [onTrip('Owner', { from: '2026-07-01', to: '2026-07-08' })] }], asOf), false);
  // on the boundary days, inclusive
  assert.equal(isAboard([{ trips: [onTrip('Owner', { from: '2026-06-20', to: '2026-06-20' })] }], asOf), true);
});

test('a trip link explicitly marked inactive does not count', () => {
  const asOf = new Date('2026-06-20T00:00:00Z');
  assert.equal(
    isAboard([{ trips: [onTrip('Owner', { from: '2026-06-18', to: '2026-06-25', active: false })] }], asOf),
    false,
  );
});

test('with no trips, aboard falls back to the stored flag', () => {
  assert.equal(isAboard([{ isActiveOnTrip: true, trips: [] }]), true);
  assert.equal(isAboard([{ isActiveOnTrip: false, trips: [] }]), false);
  assert.equal(isAboard([{ isActiveOnTrip: true }]), true);
});

test('an open-ended trip counts as aboard', () => {
  const asOf = new Date('2026-06-20T00:00:00Z');
  assert.equal(isAboard([{ trips: [onTrip('Owner', { from: '2026-06-01', to: null })] }], asOf), true);
  assert.equal(isAboard([{ trips: [onTrip('Owner', { from: null, to: null })] }], asOf), true);
});

// ── filters and the sort control ────────────────────────────────────────────
import {
  SORT_OPTIONS, DIETARY_OPTIONS, ABOARD_OPTIONS,
  parseSort, toSortValue, roleOptions, filterPeople,
} from './guestRoster.js';

const ROSTER = () => groupGuestsByPerson([JANE, RAFAEL_OWNER, {
  id: 'p1', firstName: 'Ines', lastName: 'Moreau', guestType: 'principal',
  cabinAllocated: 'VIP', isActiveOnTrip: true,
}]);

test('role options are built from the roster, not hardcoded', () => {
  assert.deepEqual(roleOptions(ROSTER()).map((o) => o.value),
    ['all', 'Charter', 'Owner', 'Principal']);
  // Nobody is offered a role that matches nothing.
  assert.deepEqual(roleOptions([]).map((o) => o.value), ['all']);
  assert.deepEqual(roleOptions(null).map((o) => o.value), ['all']);
});

test('filtering by role, dietary and aboard', () => {
  const people = ROSTER();
  assert.deepEqual(filterPeople(people, { role: 'Owner' }).map((p) => p.name), ['Rafael Edry']);
  assert.deepEqual(filterPeople(people, { dietary: 'has' }).map((p) => p.name), ['Jane Doh']);
  assert.deepEqual(filterPeople(people, { dietary: 'none' }).map((p) => p.name),
    ['Rafael Edry', 'Ines Moreau']);
  assert.deepEqual(filterPeople(people, { aboard: 'aboard' }).map((p) => p.name),
    ['Jane Doh', 'Ines Moreau']);
});

test('role matching ignores case', () => {
  assert.deepEqual(filterPeople(ROSTER(), { role: 'owner' }).map((p) => p.name), ['Rafael Edry']);
});

test('filters combine, and "all" is a no-op', () => {
  const people = ROSTER();
  assert.deepEqual(filterPeople(people, { role: 'Charter', dietary: 'has' }).map((p) => p.name),
    ['Jane Doh']);
  assert.deepEqual(filterPeople(people, { role: 'Charter', dietary: 'none' }), []);
  assert.equal(filterPeople(people, {}).length, 3);
  assert.equal(filterPeople(people).length, 3);
  assert.deepEqual(filterPeople(null, { role: 'Owner' }), []);
});

test('the sort control round-trips', () => {
  for (const opt of SORT_OPTIONS) {
    assert.equal(toSortValue(parseSort(opt.value)), opt.value, opt.value);
  }
});

test('an unknown or missing sort falls back to name ascending', () => {
  assert.deepEqual(parseSort('passport_desc'), { column: 'name', direction: 'asc' });
  assert.deepEqual(parseSort(''), { column: 'name', direction: 'asc' });
  assert.deepEqual(parseSort(null), { column: 'name', direction: 'asc' });
  assert.deepEqual(parseSort('name_sideways'), { column: 'name', direction: 'asc' });
  assert.equal(toSortValue({}), 'name_asc');
  assert.equal(toSortValue(), 'name_asc');
});

test('every sort option names a real column', () => {
  for (const opt of SORT_OPTIONS) {
    assert.ok(SORT_COLUMNS.includes(parseSort(opt.value).column), opt.value);
  }
  assert.deepEqual(DIETARY_OPTIONS.map((o) => o.value), ['all', 'has', 'none']);
  assert.deepEqual(ABOARD_OPTIONS.map((o) => o.value), ['all', 'aboard']);
});

test('initials fall back sensibly', () => {
  assert.equal(initialsOf('Rafael Edry'), 'RE');
  assert.equal(initialsOf('Cher'), 'CH');
  assert.equal(initialsOf(''), '?');
  assert.equal(initialsOf('  Mary  Jane  Watson '), 'MW');
});
