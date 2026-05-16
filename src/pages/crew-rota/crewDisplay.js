// Crew display helpers for the rota — single source of truth so the
// role alias is never duplicated across grid / list / popover.

// Map the verbose `roles.name` (from tenant_members → roles) onto the
// compact rota label. Case-insensitive, whitespace-trimmed. The DB
// stores both full-word ("Second Stewardess") and short ("2nd Stew")
// forms for the same role, so every variant maps explicitly. Unknown
// roles pass through UNCHANGED (no truncation — the adaptive column
// widens to fit).
const ROLE_ALIASES = {
  'chief stewardess':   'Chief stew',
  'chief stew':         'Chief stew',
  'second stewardess':  '2nd stew',
  'second stew':        '2nd stew',
  '2nd stewardess':     '2nd stew',
  '2nd stew':           '2nd stew',
  'third stewardess':   '3rd stew',
  'third stew':         '3rd stew',
  '3rd stewardess':     '3rd stew',
  '3rd stew':           '3rd stew',
  'laundry stewardess': 'Laundry',
  'laundry stew':       'Laundry',
  'laundry':            'Laundry',
  'bosun':              'Bosun',
  'deckhand':           'Deckhand',
  'head chef':          'Head chef',
  'sous chef':          'Sous chef',
  'captain':            'Captain',
  'chief engineer':     'Chief eng',
  'chief eng':          'Chief eng',
  'second engineer':    '2nd eng',
  '2nd engineer':       '2nd eng',
  'eng2':               '2nd eng',
  'third engineer':     '3rd eng',
  '3rd engineer':       '3rd eng',
  'eng3':               '3rd eng',
};

// TODO(remove-after-role-audit): temporary production audit. Logs each
// distinct role string the first time it's seen so we can decide
// whether the alias map needs more entries or a DB-side role_aliases
// table. Remove this Set + console.info once the audit is complete.
const seenRoles = new Set();

export function getRoleDisplayName(role) {
  if (!role) return '';
  const key = String(role).trim().toLowerCase();
  const aliased = ROLE_ALIASES[key] || String(role).trim();
  if (!seenRoles.has(role)) {
    seenRoles.add(role);
    // eslint-disable-next-line no-console
    console.info('[getRoleDisplayName] new role:', role, '→', aliased);
  }
  return aliased;
}
