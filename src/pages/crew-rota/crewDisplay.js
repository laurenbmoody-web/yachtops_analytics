// Crew display helpers for the rota — single source of truth so the
// role alias is never duplicated across grid / list / popover.
//
// Resolution order:
//   1. Normalisation pipeline → canonical key map (handles gender-
//      neutral "Steward/ess", word forms "Second/Third", "Engineer",
//      etc. without an entry per spelling).
//   2. Enumerated exact-string map (explicit known spellings).
//   3. Pass through UNCHANGED (no truncation — adaptive column widens).

// ── 2. Enumerated exact-string fallback (lowercased keys) ───────────
const ROLE_ALIASES = {
  'chief stewardess':    'Chief stew',
  'chief steward/ess':   'Chief stew',
  'chief stew/ess':      'Chief stew',
  'chief stew':          'Chief stew',
  'second stewardess':   '2nd stew',
  'second steward/ess':  '2nd stew',
  'second stew/ess':     '2nd stew',
  'second stew':         '2nd stew',
  '2nd stewardess':      '2nd stew',
  '2nd steward/ess':     '2nd stew',
  '2nd stew/ess':        '2nd stew',
  '2nd stew':            '2nd stew',
  'third stewardess':    '3rd stew',
  'third steward/ess':   '3rd stew',
  'third stew/ess':      '3rd stew',
  'third stew':          '3rd stew',
  '3rd stewardess':      '3rd stew',
  '3rd steward/ess':     '3rd stew',
  '3rd stew/ess':        '3rd stew',
  '3rd stew':            '3rd stew',
  'laundry stewardess':  'Laundry',
  'laundry steward/ess': 'Laundry',
  'laundry stew/ess':    'Laundry',
  'laundry stew':        'Laundry',
  'laundry':             'Laundry',
  'junior stewardess':   'Junior stew',
  'junior steward/ess':  'Junior stew',
  'junior stew/ess':     'Junior stew',
  'junior stew':         'Junior stew',
  'sole stewardess':     'Sole stew',
  'sole steward/ess':    'Sole stew',
  'sole stew/ess':       'Sole stew',
  'sole stew':           'Sole stew',
  'service stewardess':  'Service stew',
  'service steward/ess': 'Service stew',
  'service stew/ess':    'Service stew',
  'service stew':        'Service stew',
  'head housekeeper':    'Housekeeper',
  'housekeeper':         'Housekeeper',
  'bosun':               'Bosun',
  'deckhand':            'Deckhand',
  'head chef':           'Head chef',
  'sous chef':           'Sous chef',
  'captain':             'Captain',
  'chief engineer':      'Chief eng',
  'chief eng':           'Chief eng',
  'second engineer':     '2nd eng',
  '2nd engineer':        '2nd eng',
  'eng2':                '2nd eng',
  'third engineer':      '3rd eng',
  '3rd engineer':        '3rd eng',
  'eng3':                '3rd eng',
};

// ── 1. Canonical key map (post-normalisation) ──────────────────────
const CANONICAL = {
  'chief stew':    'Chief stew',
  '2nd stew':      '2nd stew',
  '3rd stew':      '3rd stew',
  'laundry stew':  'Laundry',
  'laundry':       'Laundry',
  'junior stew':   'Junior stew',
  'sole stew':     'Sole stew',
  'service stew':  'Service stew',
  'chief eng':     'Chief eng',
  '2nd eng':       '2nd eng',
  '3rd eng':       '3rd eng',
  'head chef':     'Head chef',
  'sous chef':     'Sous chef',
  'captain':       'Captain',
  'bosun':         'Bosun',
  'deckhand':      'Deckhand',
  'housekeeper':   'Housekeeper',
};

// Lowercase, strip the gender-neutral "/ess", collapse steward(ess)→
// stew, second/third→2nd/3rd, engineer→eng. Order matters: drop "/ess"
// before the steward collapse; "stewardess" before "steward".
function normaliseRole(role) {
  return String(role)
    .trim()
    .toLowerCase()
    .replace(/\/ess/g, '')
    .replace(/ stewardess/g, ' stew')
    .replace(/ steward/g, ' stew')
    .replace(/^second /, '2nd ')
    .replace(/^third /, '3rd ')
    .replace(/ engineer/g, ' eng')
    .replace(/\s+/g, ' ')
    .trim();
}

// TODO(remove-after-role-audit): temporary production audit. Logs each
// distinct role string the first time it's seen (raw → normalised →
// result) so we can decide whether the maps need more entries or a
// DB-side role_aliases table. Remove this Set + console.info once done.
const seenRoles = new Set();

export function getRoleDisplayName(role) {
  if (!role) return '';
  const raw = String(role).trim();
  const normalised = normaliseRole(raw);

  let result;
  if (CANONICAL[normalised]) {
    result = CANONICAL[normalised];
  } else if (ROLE_ALIASES[raw.toLowerCase()]) {
    result = ROLE_ALIASES[raw.toLowerCase()];
  } else {
    result = raw; // unknown — pass through unchanged, no truncation
  }

  if (!seenRoles.has(role)) {
    seenRoles.add(role);
    // eslint-disable-next-line no-console
    console.info(
      `[getRoleDisplayName] new role: "${role}" → normalised "${normalised}" → "${result}"`
    );
  }
  return result;
}

// Pick black/white text for a given hex background by perceived
// luminance (0..1). > 0.5 → black, else white. Tolerates #rgb, #rrggbb,
// missing '#'. Falls back to white on unparseable input.
export function getContrastText(hex) {
  if (!hex) return '#fff';
  let h = String(hex).trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (h.length !== 6) return '#fff';
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return '#fff';
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '#000' : '#fff';
}
