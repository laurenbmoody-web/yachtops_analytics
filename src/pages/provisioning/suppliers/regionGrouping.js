// Region grouping for the suppliers/vendors directory meta strip.
//
// Vendors carry a free-text `business_country`. For the header
// breakdown we bucket each country into a cruising region. Pure
// functions, no React — unit-testable in isolation.

// Canonical display/tie-break order. Used to keep equal-count
// regions in a stable, sensible sequence.
export const REGION_ORDER = ['MED', 'USA', 'CAR', 'NSEA', 'ASIA', 'PAC', 'OTHER', 'UNKNOWN'];

// country (lowercased, trimmed) → region. OTHER = has a country but
// not in any list; UNKNOWN = no country populated.
const COUNTRY_TO_REGION = {};
const register = (region, countries) => {
  for (const c of countries) COUNTRY_TO_REGION[c.toLowerCase()] = region;
};

register('MED', [
  'France', 'Spain', 'Italy', 'Greece', 'Monaco', 'Croatia',
  'Malta', 'Turkey', 'Cyprus', 'Montenegro',
]);
register('USA', ['United States', 'US', 'USA']);
register('CAR', [
  'Antigua', 'Barbados', 'Bahamas', 'BVI', 'St Vincent', 'St Lucia',
  'Cayman', 'St Maarten', 'St Barths', 'Sint Maarten', 'Saba',
  'Anguilla', 'Dominica', 'Dominican Republic', 'Trinidad', 'Grenada',
]);
register('NSEA', [
  'Netherlands', 'Germany', 'UK', 'United Kingdom', 'Norway',
  'Sweden', 'Denmark', 'Finland', 'Iceland', 'Ireland',
]);
register('ASIA', [
  'Thailand', 'Singapore', 'Hong Kong', 'Malaysia', 'Indonesia',
  'Vietnam', 'Philippines', 'Japan', 'China', 'UAE', 'Maldives',
]);
register('PAC', [
  'Australia', 'New Zealand', 'Fiji', 'French Polynesia', 'Tahiti',
]);

// Resolve a raw country string to a region key.
export const regionForCountry = (country) => {
  if (country == null) return 'UNKNOWN';
  const key = String(country).trim().toLowerCase();
  if (!key) return 'UNKNOWN';
  return COUNTRY_TO_REGION[key] || 'OTHER';
};

// Summarise a vendor list into { total, parts } where parts is an
// ordered [{ region, count }] list, descending by count (canonical
// order as the tie-break), zero buckets dropped.
//
// Edge case: if every vendor lacks a country (the only bucket is
// UNKNOWN), parts is empty — the caller shows just the total.
export const summariseRegions = (vendors = []) => {
  const counts = {};
  for (const v of vendors) {
    const r = regionForCountry(v && v.business_country);
    counts[r] = (counts[r] || 0) + 1;
  }

  const regions = Object.keys(counts);
  const onlyUnknown = regions.length === 1 && regions[0] === 'UNKNOWN';

  const parts = onlyUnknown
    ? []
    : regions
        .map((region) => ({ region, count: counts[region] }))
        .filter((p) => p.count > 0)
        .sort((a, b) =>
          b.count - a.count ||
          REGION_ORDER.indexOf(a.region) - REGION_ORDER.indexOf(b.region));

  return { total: vendors.length, parts };
};
