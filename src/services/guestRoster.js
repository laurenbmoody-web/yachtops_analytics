// Turning guest ROWS into the PEOPLE the page shows.
//
// The two are not the same thing, and that is the whole point of this module.
// guest_type ('Owner' / 'Charter') is stored on the person, but owner-vs-charter
// is really a property of the TRIP — trips.trip_type and trip_guests already
// model it properly. On a vessel with no trips there was nowhere to put the
// distinction, so people were cloned instead: Rafael Edry exists twice on
// Horizon, once as Owner in "Master Cabin" and once as Charter in "Master".
//
// So the list groups records back into people. This is PRESENTATIONAL ONLY — it
// does not merge anything in the database, and it is deliberately not silent
// about what it did: a grouped person carries `recordCount` and `hasDuplicates`
// so the page can say "2 records" rather than quietly hiding that the data is
// wrong. The real merge is a separate migration.
//
// Grouping is by name, not by email: every duplicated guest on this project has
// a null contact_email, so email would group nothing. Name is crude — two real
// people who share a name would be merged — hence `hasDuplicates` surfacing it
// for a human to confirm rather than the UI acting on it.

const squash = (value) => String(value ?? '').trim().replace(/\s+/g, ' ');
const norm = (value) => squash(value).toLowerCase();

export const fullName = (guest) =>
  squash(`${guest?.firstName ?? ''} ${guest?.lastName ?? ''}`);

// What counts as "the same person". Exported so a merge tool can agree with the
// list about which records it is about to combine.
export const personKey = (guest) => norm(fullName(guest));

// Cabin is stored five ways (free text, path, label, ids, id) and they disagree
// — "Master Cabin" vs "Master" for the same cabin. Read them in the order the
// old page did so nothing changes on screen, then show the last path segment.
export const cabinOf = (guest) => {
  const raw = squash(
    guest?.cabinLocationPath || guest?.cabinLocationLabel || guest?.cabinAllocated || '',
  );
  if (!raw) return '';
  const parts = raw.split('>').map((p) => p.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
};

export const contactOf = (guest) =>
  squash(guest?.contactEmail || guest?.contactPhone || '');

// Legacy rows carry lowercase 'principal' / 'guest' from an older seed alongside
// the current 'Owner' / 'Charter'. Present them consistently rather than showing
// a user two chips that differ only in case.
export const guestTypeLabel = (type) => {
  const t = norm(type);
  if (!t || t === 'unknown') return '';
  return t.charAt(0).toUpperCase() + t.slice(1);
};

const uniq = (values) => [...new Set(values.filter(Boolean))];

// The roles a person holds, read from the TRIPS they are on. trips.trip_type
// already says whether a trip is an owner trip or a charter, so a person on
// both is simply on two trips — which is the thing cloning them was standing
// in for. guest_type is consulted ONLY when a guest has no trips at all, so
// the legacy value stops mattering the moment a trip exists.
export const rolesOf = (records) => {
  const links = records.flatMap((r) => (Array.isArray(r?.trips) ? r.trips : []));
  if (links.length) return uniq(links.map((l) => guestTypeLabel(l?.tripType)));
  return uniq(records.map((r) => guestTypeLabel(r?.guestType)));
};

// Aboard means on a trip that is running, not a boolean somebody remembered to
// set. Falls back to the stored flag for a guest with no trips, because that
// is all there is to go on.
export const isAboard = (records, asOf = new Date()) => {
  const links = records.flatMap((r) => (Array.isArray(r?.trips) ? r.trips : []));
  if (!links.length) return records.some((r) => r?.isActiveOnTrip === true);
  const today = String(asOf.toISOString()).slice(0, 10);
  return links.some((l) => {
    if (l?.isActiveOnTrip === false) return false;
    const from = l?.startDate ? String(l.startDate).slice(0, 10) : null;
    const to = l?.endDate ? String(l.endDate).slice(0, 10) : null;
    if (from && today < from) return false;
    if (to && today > to) return false;
    return true;
  });
};

// One entry per person, each carrying the records behind it.
export const groupGuestsByPerson = (guests) => {
  const list = (Array.isArray(guests) ? guests : []).filter(Boolean);
  const byKey = new Map();

  for (const guest of list) {
    const key = personKey(guest);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(guest);
  }

  return [...byKey.entries()].map(([key, records]) => {
    // A person is only deleted when every record of them is. One live record
    // means they are still a guest, whatever happened to the other.
    const live = records.filter((r) => !r?.isDeleted);
    const shown = live.length ? live : records;

    return {
      key,
      name: fullName(shown[0]),
      records,
      // The id the page acts on: expanding and editing still work on one
      // record, because that is what the database and every other page have.
      primaryId: shown[0]?.id ?? null,
      recordCount: records.length,
      hasDuplicates: records.length > 1,
      types: rolesOf(shown),
      cabins: uniq(shown.map(cabinOf)),
      contact: contactOf(shown.find((r) => contactOf(r)) || {}),
      allergies: uniq(shown.map((r) => squash(r?.allergies))).join(', '),
      photo: shown.find((r) => r?.photo?.dataUrl)?.photo?.dataUrl || null,
      isDeleted: live.length === 0,
      isActiveOnTrip: isAboard(shown),
      // Two records disagreeing about the cabin is itself worth showing — it is
      // how the duplicate was noticed in the first place.
      cabinsDisagree: uniq(shown.map(cabinOf)).length > 1,
    };
  });
};

export const initialsOf = (name) => {
  const parts = squash(name).split(' ').filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

// Search across what a person actually is, not just their name — a stew looking
// for "shellfish" before service should find the right guest.
export const searchPeople = (people, query) => {
  const q = norm(query);
  if (!q) return people;
  return (people || []).filter((p) => {
    const haystack = [
      p?.name,
      p?.contact,
      p?.allergies,
      ...(p?.cabins || []),
      ...(p?.types || []),
      ...(p?.records || []).map((r) => r?.healthConditions),
    ];
    return haystack.some((value) => norm(value).includes(q));
  });
};

export const SORT_COLUMNS = ['name', 'cabin', 'contact', 'type'];

const sortValue = (person, column) => {
  switch (column) {
    case 'cabin': return norm((person?.cabins || [])[0]);
    case 'contact': return norm(person?.contact);
    case 'type': return norm((person?.types || [])[0]);
    case 'name':
    default: return norm(person?.name);
  }
};

export const sortPeople = (people, column, direction) => {
  const list = [...(people || [])];
  if (!column || !direction || !SORT_COLUMNS.includes(column)) return list;
  const flip = direction === 'desc' ? -1 : 1;
  return list.sort((a, b) => {
    const av = sortValue(a, column);
    const bv = sortValue(b, column);
    // Blanks sort last in both directions: a column of empty contacts should
    // not push everyone useful off the top of the page.
    if (av && !bv) return -1;
    if (!av && bv) return 1;
    if (av < bv) return -1 * flip;
    if (av > bv) return 1 * flip;
    return norm(a?.name) < norm(b?.name) ? -1 : 1;
  });
};

// ── filtering and sorting the roster ────────────────────────────────────────
// Offered as real named controls rather than a row of filter pills: a chip row
// cannot express "sorted by cabin, descending" and falls apart the moment there
// is more than one axis.

export const SORT_OPTIONS = [
  { value: 'name_asc', label: 'Name (A → Z)' },
  { value: 'name_desc', label: 'Name (Z → A)' },
  { value: 'cabin_asc', label: 'Cabin (A → Z)' },
  { value: 'cabin_desc', label: 'Cabin (Z → A)' },
  { value: 'type_asc', label: 'Role (A → Z)' },
  { value: 'contact_asc', label: 'Contact (A → Z)' },
];

export const parseSort = (value) => {
  const [column, direction] = String(value || '').split('_');
  if (!SORT_COLUMNS.includes(column)) return { column: 'name', direction: 'asc' };
  return { column, direction: direction === 'desc' ? 'desc' : 'asc' };
};

export const toSortValue = ({ column, direction } = {}) =>
  `${SORT_COLUMNS.includes(column) ? column : 'name'}_${direction === 'desc' ? 'desc' : 'asc'}`;

// Built from the roster rather than hardcoded, so a vessel using 'Principal'
// gets 'Principal' and nobody is offered a role that matches nothing.
export const roleOptions = (people) => [
  { value: 'all', label: 'Every role' },
  ...uniq((people || []).flatMap((p) => p?.types || []))
    .sort((a, b) => (norm(a) < norm(b) ? -1 : 1))
    .map((role) => ({ value: role, label: role })),
];

export const DIETARY_OPTIONS = [
  { value: 'all', label: 'Anything' },
  { value: 'has', label: 'Has allergies' },
  { value: 'none', label: 'None recorded' },
];

export const ABOARD_OPTIONS = [
  { value: 'all', label: 'Everyone' },
  { value: 'aboard', label: 'Aboard now' },
];

export const filterPeople = (people, { role = 'all', dietary = 'all', aboard = 'all' } = {}) =>
  (people || []).filter((p) => {
    if (role !== 'all' && !(p?.types || []).some((t) => norm(t) === norm(role))) return false;
    if (dietary === 'has' && !squash(p?.allergies)) return false;
    if (dietary === 'none' && squash(p?.allergies)) return false;
    if (aboard === 'aboard' && !p?.isActiveOnTrip) return false;
    return true;
  });

// The quick stats in the meta strip. Only facts the page can stand behind —
// no "status" invented out of nothing, which is what the column this replaces did.
export const rosterStats = (people) => {
  const list = (people || []).filter((p) => !p?.isDeleted);
  return {
    people: list.length,
    aboard: list.filter((p) => p.isActiveOnTrip).length,
    withAllergies: list.filter((p) => squash(p.allergies)).length,
    duplicates: list.filter((p) => p.hasDuplicates).length,
  };
};
