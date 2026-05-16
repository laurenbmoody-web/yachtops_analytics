// Crew display helpers for the rota — single source of truth so the
// role alias is never duplicated across grid / list / popover.

// Map the verbose `roles.name` (from tenant_members → roles) onto the
// compact rota label. Case-insensitive; unknown roles are truncated to
// 12 chars + ellipsis so the sticky column never blows out.
const ROLE_ALIASES = {
  'chief stewardess':  'Chief stew',
  'second stewardess': '2nd stew',
  '2nd stewardess':    '2nd stew',
  'third stewardess':  '3rd stew',
  '3rd stewardess':    '3rd stew',
  'laundry stewardess': 'Laundry',
  'bosun':             'Bosun',
  'deckhand':          'Deckhand',
  'head chef':         'Head chef',
  'captain':           'Captain',
  'chief engineer':    'Chief eng',
};

export function getRoleDisplayName(role) {
  if (!role) return '';
  const key = String(role).trim().toLowerCase();
  if (ROLE_ALIASES[key]) return ROLE_ALIASES[key];
  const raw = String(role).trim();
  return raw.length > 12 ? `${raw.slice(0, 12)}…` : raw;
}
