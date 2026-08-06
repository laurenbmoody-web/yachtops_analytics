// Cargo Accounts — shaping a month for the management company's screen.
//
// The office is not doing the crew's job. They are answering one question per
// account — does this month hang together well enough to post against the
// owner's funds — and then either signing it off or sending it back. So what
// this builds is a verdict per account, not an editable ledger.
//
// The period rule is deliberately NOT reimplemented here: a line entered after
// its month was closed reconciles into the next month, and that rule lives in
// monthEnd.reconcilePeriod with its own tests. Postgres hands over a window of
// lines and the vessel's closes; this applies the one implementation to them.

import { reconcilePeriod } from './monthEnd.js';

export const monthKeyOf = (value) => (value ? String(value).slice(0, 7) : '');

// The RPC returns closes as rows; reconcilePeriod wants { '2026-07': iso }.
export const closesMap = (closes = []) => {
  const out = {};
  (closes || []).forEach((c) => {
    const key = monthKeyOf(c?.period_month);
    if (key && c?.submitted_at) out[key] = c.submitted_at;
  });
  return out;
};

// A line's own month, before the close rule moves it. The vessel reconciles on
// the statement date where it has one — that's the date the bank used.
export const naturalMonthOf = (line) =>
  monthKeyOf(line?.statement_date || line?.txn_date);

export const linesForPeriod = (lines = [], period, closes = {}) => {
  const key = monthKeyOf(period);
  if (!key) return [];
  return (lines || []).filter((l) => reconcilePeriod(l, naturalMonthOf(l), closes) === key);
};

// ── one account's month, as a verdict ────────────────────────────────────────
const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? 0 : Number(v));

// Where the office's own eye goes: is every line coded, is every line evidenced,
// and does what the vessel typed off the statement agree with what Cargo holds.
// Anything unanswered is a reason to query rather than sign, so it's counted
// rather than summarised into a score.
export const accountMonth = (account, lines = [], reconciliation = null) => {
  const mine = (lines || []).filter((l) => l.account_id === account?.id);
  const moneyIn = mine.filter((l) => num(l.amount) > 0).reduce((s, l) => s + num(l.amount), 0);
  const moneyOut = mine.filter((l) => num(l.amount) < 0).reduce((s, l) => s + num(l.amount), 0);

  const uncoded = mine.filter((l) => !l.category_code && !l.category).length;
  const unevidenced = mine.filter((l) => !l.has_receipt).length;

  const stated = (v) => v != null && v !== '';
  const off = [];
  if (reconciliation) {
    const pairs = [
      ['Total in', reconciliation.stmt_money_in, moneyIn],
      ['Total out', reconciliation.stmt_money_out, Math.abs(moneyOut)],
      ['Closing balance', reconciliation.stmt_closing, reconciliation.closing_balance],
    ];
    pairs.forEach(([label, theirs, ours]) => {
      if (!stated(theirs) || !stated(ours)) return;
      const gap = Math.round((num(ours) - num(theirs)) * 100) / 100;
      if (Math.abs(gap) > 0.005) off.push({ label, ours: num(ours), theirs: num(theirs), gap });
    });
  }

  return {
    account,
    reconciliation,
    lines: mine,
    count: mine.length,
    moneyIn: Math.round(moneyIn * 100) / 100,
    moneyOut: Math.round(moneyOut * 100) / 100,
    net: Math.round((moneyIn + moneyOut) * 100) / 100,
    uncoded,
    unevidenced,
    mismatches: off,
    state: reconciliationState(reconciliation),
  };
};

// ── where a month stands ─────────────────────────────────────────────────────
// 'queried' is not a status in the database — it's an open month that the office
// sent back, which reads very differently from one the vessel simply hasn't
// finished. Telling them apart is the whole point of the queried_at stamp.
export const reconciliationState = (r) => {
  if (!r) return 'not started';
  if (r.status === 'approved') return 'signed off';
  if (r.status === 'submitted') return 'awaiting sign-off';
  if (r.queried_at) return 'queried';
  return 'with the vessel';
};

// Only a month the vessel has closed can be signed off — the office approves
// figures, it does not produce them. Kept here so the button and the function
// that refuses the write agree about when it should be offered.
export const canSignOff = (r) => r?.status === 'submitted';
export const canQuery = (r) => r?.status === 'submitted' || r?.status === 'approved';

// ── the fleet list ───────────────────────────────────────────────────────────
// A management company opens Cargo to find out which boats need them today, so
// the list sorts by that rather than alphabetically — vessels waiting on a
// signature first, then ones they've queried and are waiting on, then the quiet
// ones. Within a group, by name, because that's how they're spoken about.
export const sortFleet = (fleet = []) => {
  const rank = (v) => {
    if ((v?.awaiting_signoff || 0) > 0) return 0;
    if ((v?.queried || 0) > 0) return 1;
    return 2;
  };
  return (fleet || []).slice().sort((a, b) => {
    const d = rank(a) - rank(b);
    if (d) return d;
    return String(a?.vessel_name || '').localeCompare(String(b?.vessel_name || ''), undefined, { sensitivity: 'base' });
  });
};

export const fleetHeadline = (fleet = []) => {
  const waiting = (fleet || []).reduce((n, v) => n + (v?.awaiting_signoff || 0), 0);
  const boats = (fleet || []).filter((v) => (v?.awaiting_signoff || 0) > 0).length;
  if (!fleet?.length) return 'No vessels on your books yet.';
  if (!waiting) return 'Nothing waiting on you.';
  return `${waiting} ${waiting === 1 ? 'month' : 'months'} waiting on you across ${boats} ${boats === 1 ? 'vessel' : 'vessels'}.`;
};

// ── the vessel's side: which firms can see this boat ────────────────────────
// COMMAND reads this list on /month-end. It's the same relationship from the
// other end, so it lives beside the rest of the management shaping rather than
// in managementAccess.js, which imports the database client and so can't be
// tested on its own.
//
// A row here is an ENGAGEMENT — vessel ←→ firm — not a person. The people at the
// firm come with it, because the boat gave access to a company and is entitled
// to see which humans that turned out to be.

export const accessState = (row) => {
  if (!row) return 'none';
  if (!row.active) return 'ended';
  // A firm whose people have all been added but none have signed up yet can see
  // nothing, and a captain should not read that as live access.
  return (row.people || []).some((p) => p.has_login) ? 'active' : 'awaiting sign-up';
};

export const accessLabel = (row) => row?.company_name || 'A management company';

// Who that firm actually is, right now — the reason a captain trusts a company
// grant at all. Named, up to a point, then counted.
export const accessPeople = (row, max = 3) => {
  const people = row?.people || [];
  if (!people.length) return 'Nobody added yet';
  const names = people.slice(0, max).map((p) => p.name || p.email);
  const rest = people.length - names.length;
  return rest > 0 ? `${names.join(', ')} +${rest} more` : names.join(', ');
};

// Ended engagements stay on file — months the firm signed off name their people,
// and the vessel keeps that after the relationship ends — but they sort below
// the firms that currently have access.
export const sortAccess = (rows = []) =>
  (rows || []).slice().sort((a, b) => {
    if (!!a?.active !== !!b?.active) return a?.active ? -1 : 1;
    return String(accessLabel(a)).localeCompare(String(accessLabel(b)), undefined, { sensitivity: 'base' });
  });

// ── the firm's own team ──────────────────────────────────────────────────────
// Mirrors the supplier workspace tiers. A VIEWER reads a month but does not sign
// it off — juniors preparing the file for a director to approve is the normal
// shape of an accounts office.
export const TEAM_TIERS = [
  { key: 'OWNER', label: 'Owner', note: 'Runs the company and its team' },
  { key: 'ADMIN', label: 'Admin', note: 'Can add and remove people' },
  { key: 'MEMBER', label: 'Member', note: 'Reads vessels and signs months off' },
  { key: 'VIEWER', label: 'Viewer', note: 'Reads only — cannot sign anything off' },
];

export const tierLabel = (key) => TEAM_TIERS.find((t) => t.key === key)?.label || key;
export const canRunTeam = (tier) => tier === 'OWNER' || tier === 'ADMIN';
export const canSignOffAs = (tier) => tier === 'OWNER' || tier === 'ADMIN' || tier === 'MEMBER';

// ── what a grant covers ──────────────────────────────────────────────────────
// The shore office reads more than the money. /month-end already models the
// vessel's monthly close-off as packs — Hours of Rest live, the rest planned —
// and the office is the recipient of all of it, so a grant names which parts.
//
// Keys match the database's check constraint. Adding an area is a value here and
// a value there; it is deliberately not a column, because the pack list grows.
export const SCOPES = [
  { key: 'accounts', label: 'Month-end spending', note: 'Closed months, the lines under them, and signing them off' },
  { key: 'hor', label: 'Hours of Rest', note: 'The signed monthly rest-hours pack' },
  { key: 'month_end', label: 'Monthly checks', note: 'The rest of the month-end close-off packs' },
];

const SCOPE_BY_KEY = SCOPES.reduce((m, s) => { m[s.key] = s; return m; }, {});

export const scopeLabel = (key) => SCOPE_BY_KEY[key]?.label || key;

// Drops anything the database wouldn't accept and orders it the way SCOPES is
// written, so two grants of the same areas always read identically.
export const cleanScopes = (scopes = []) =>
  SCOPES.map((s) => s.key).filter((k) => (scopes || []).includes(k));

// "Month-end spending and Hours of Rest" — a sentence fragment, because it sits
// inside a line of prose on the vessel's list rather than in a column.
export const describeScopes = (scopes = []) => {
  const names = cleanScopes(scopes).map(scopeLabel);
  if (!names.length) return 'nothing';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
};

// ── what each tier may actually do ───────────────────────────────────────────
// The office's first question about Cargo is "what can my staff do in here",
// and the honest answer is short. Written as data so the settings screen and
// the tier picker say the same thing, and so nothing claims a power the
// database wouldn't grant.
//
// The last column is the one that matters and is easy to miss: NOBODY here can
// change a line the crew entered. It isn't a permission that exists.
export const TIER_POWERS = [
  { key: 'read', label: 'Read a vessel’s closed months', tiers: ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] },
  { key: 'export', label: 'Export the month-end pack', tiers: ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] },
  { key: 'sign', label: 'Sign a month off', tiers: ['OWNER', 'ADMIN', 'MEMBER'] },
  { key: 'query', label: 'Send a month back with a question', tiers: ['OWNER', 'ADMIN', 'MEMBER'] },
  { key: 'team', label: 'Add and remove colleagues', tiers: ['OWNER', 'ADMIN'] },
  { key: 'company', label: 'Change the company’s details', tiers: ['OWNER', 'ADMIN'] },
  { key: 'edit', label: 'Change what the crew entered', tiers: [] },
];

export const tierCan = (tier, power) =>
  (TIER_POWERS.find((p) => p.key === power)?.tiers || []).includes(tier);

// A vessel decides what its engagement covers; the office cannot. Said plainly
// on the settings screen so nobody goes hunting for the control.
export const engagementNote = (engagements = []) => {
  const live = (engagements || []).filter((e) => e.active);
  if (!live.length) return 'No vessel has engaged you yet.';
  return `${live.length} ${live.length === 1 ? 'vessel has' : 'vessels have'} engaged you. Each decides what you can see — only their command can change or end it.`;
};

// ── the areas of a vessel, as the office sees them ───────────────────────────
// A vessel dashboard is a grid of these. Each says one of three things, and the
// difference matters more than the styling:
//
//   live        the vessel shared it AND Cargo serves it to management
//   not shared  the area exists, but this vessel left it out of the engagement.
//               Only their command can change that — so the widget says so
//               rather than offering a control that isn't the office's to use
//   planned     Cargo doesn't serve this to management yet. Named plainly, the
//               same way /month-end marks its own unbuilt packs, because a
//               widget that looks live and isn't is worse than an honest gap
//
// `scope` is the engagement scope that unlocks it (null = not scope-gated).
export const VESSEL_AREAS = [
  {
    key: 'accounts', scope: 'accounts', icon: 'Wallet', live: true,
    label: 'Month-end spending',
    note: 'Closed months, the lines under them, and signing them off',
  },
  {
    key: 'hor', scope: 'hor', icon: 'Clock', live: false,
    label: 'Hours of Rest',
    note: 'The signed monthly rest-hours pack. Not served to management yet.',
  },
  {
    key: 'month_end', scope: 'month_end', icon: 'CalendarCheck', live: false,
    label: 'Monthly checks',
    note: 'Sea time, drills and the rest of the close-off. Not served yet.',
  },
  {
    key: 'documents', scope: 'month_end', icon: 'FileText', live: false,
    label: 'Documents',
    note: 'Certificates, registrations and their expiries. Not served yet.',
  },
  {
    key: 'suppliers', scope: 'accounts', icon: 'ClipboardCheck', live: false,
    label: 'Quotes & supplier sign-offs',
    note: 'Orders awaiting an office approval. Not served yet.',
  },
  {
    key: 'safety', scope: 'month_end', icon: 'LifeBuoy', live: false,
    label: 'Safety',
    note: 'Drills, defects and the safety log. Not served yet.',
  },
];

// What a widget should say about itself, given what this vessel shared.
export const areaState = (area, scopes = []) => {
  if (area?.scope && !(scopes || []).includes(area.scope)) return 'not shared';
  return area?.live ? 'live' : 'planned';
};
