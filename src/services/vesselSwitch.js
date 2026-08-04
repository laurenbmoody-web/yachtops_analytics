// Cargo — moving between vessels without signing out.
//
// A crew member usually has one boat, so the app has always resolved a tenant
// once at bootstrap and never revisited it. A management company doesn't work
// that way: one login, a dozen boats on the books, and they move between them
// all morning. Signing out and back in to change vessel is not a switcher.
//
// The switch itself is three writes (profile, localStorage, context) and then a
// reload — the whole app is tenant-scoped and caches per page, so re-entering
// rather than diffing state is the honest way to change which boat you're on.
// The only real decision is WHERE you land, which is what this file is for.

// A path that names a specific record — /crew/8f2a…, /provisioning/orders/412 —
// means nothing on another vessel: that row belongs to the boat you just left,
// and RLS will hand back an empty page under a heading for a person who isn't
// there. Anything that identifies a record gets dropped back to its section.
const ID_SEG = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+)$/i;

const isIdSegment = (seg) => ID_SEG.test(seg);

export const landingAfterSwitch = (path, fallback = '/dashboard') => {
  if (!path || typeof path !== 'string') return fallback;
  const clean = path.split(/[?#]/)[0];
  const segs = clean.split('/').filter(Boolean);
  if (!segs.length) return fallback;

  const cut = segs.findIndex(isIdSegment);
  // No record in the path — the section itself is vessel-agnostic, so stay put.
  // Management switching boats on the Spending page wants Spending, not home.
  if (cut === -1) return `/${segs.join('/')}`;
  // The section above the record. /crew/<id> -> /crew; a bare /<id> has no
  // section to fall back to, so it goes home.
  return cut === 0 ? fallback : `/${segs.slice(0, cut).join('/')}`;
};

// The switcher lists boats by name, not by whenever the membership row happened
// to be written — a management company reads down a list of vessels the way they
// read a fleet list. The active one still sorts first so it's never hunted for.
export const sortVessels = (memberships = [], activeTenantId = null) => {
  const rows = (memberships || []).filter((m) => m && m.tenant_id);
  return rows.slice().sort((a, b) => {
    if (a.tenant_id === activeTenantId) return -1;
    if (b.tenant_id === activeTenantId) return 1;
    return vesselName(a).localeCompare(vesselName(b), undefined, { sensitivity: 'base' });
  });
};

// The join may be absent (the fallback query shape differs from the bootstrap
// one), and an unnamed vessel is still a vessel you have to be able to click.
export const vesselName = (membership) =>
  membership?.tenants?.name || membership?.name || 'Unnamed vessel';

// Two boats called "Serenity" is not a hypothetical in this industry, and the
// tier is what tells a management user which hat they're wearing on this boat.
export const vesselSub = (membership) => {
  const bits = [];
  const type = membership?.tenants?.type || membership?.type;
  if (type) bits.push(String(type).replace(/_/g, ' '));
  const tier = membership?.permission_tier;
  if (tier) bits.push(String(tier).toLowerCase());
  return bits.join(' · ');
};

// Only worth drawing when there is somewhere to go. One vessel is the crew case,
// and a chooser with a single row on it is furniture.
export const canSwitchVessel = (memberships = []) => (memberships || []).length > 1;
