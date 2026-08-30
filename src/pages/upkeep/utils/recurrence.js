// Upkeep recurrence — pure helpers, no I/O, so they can be unit-tested.
//
// A schedule fires on a calendar rule, a counter (running hours), or 'either'
// (whichever comes first — the standard marine rule, e.g. "250 h or 6 months").
//
// Steps carry their OWN cadence on top of the schedule's. This is the pattern the
// Interior duty sets already use and it is deliberately preserved: a weekly set
// spreads its work across the week ('weekly-monday' … 'weekly-saturday') rather
// than dumping every step on one day. A null step frequency means "every
// occurrence".

export const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export const TRIGGER_TYPES = { CALENDAR: 'calendar', COUNTER: 'counter', EITHER: 'either' };

export const STEP_TYPES = { CHECK: 'check', READING: 'reading', PHOTO: 'photo', NOTE: 'note' };

export const STEP_TYPE_LABELS = {
  check: 'Check',
  reading: 'Reading',
  photo: 'Photo',
  note: 'Note',
};

// What each step type is for, shown under the picker so the choice is obvious to
// someone who has never built a maintenance schedule before.
export const STEP_TYPE_HINTS = {
  check: 'Tick it off. Pass or fail.',
  reading: 'Record a number — a pressure, a temperature, running hours.',
  photo: 'Attach a picture as the evidence.',
  note: 'Guidance to read. Nothing to record.',
};

const pad2 = (n) => String(n).padStart(2, '0');

/** Local-date ISO (yyyy-mm-dd) — never toISOString(), which shifts across UTC. */
export const toISODate = (d) => {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
};

export const parseISODate = (iso) => {
  if (!iso) return null;
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
};

const addDays = (date, n) => {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() + n);
  return d;
};

const addMonths = (date, n) => {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const targetDay = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  // clamp: 31 Jan + 1 month → 28/29 Feb, not 2/3 Mar
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(targetDay, lastDay));
  return d;
};

/**
 * Next date this calendar rule fires, strictly after `from` (exclusive).
 * Rules: {kind:'daily'} | {kind:'weekly',days:[…]} | {kind:'monthly',day:N}
 *        | {kind:'interval',months:N}
 */
export const nextCalendarDate = (rule, from = new Date()) => {
  if (!rule || !rule.kind) return null;
  const base = new Date(from.getFullYear(), from.getMonth(), from.getDate());

  switch (rule.kind) {
    case 'daily':
      return addDays(base, 1);

    case 'weekly': {
      const wanted = (rule.days || [])
        .map((d) => WEEKDAYS.indexOf(String(d).toLowerCase()))
        .filter((i) => i >= 0)
        .sort((a, b) => a - b);
      if (!wanted.length) return addDays(base, 7);
      // walk forward at most a full week
      for (let i = 1; i <= 7; i += 1) {
        const candidate = addDays(base, i);
        if (wanted.includes(candidate.getDay())) return candidate;
      }
      return addDays(base, 7);
    }

    case 'monthly': {
      const day = Math.max(1, Math.min(31, Number(rule.day) || 1));
      const clampTo = (year, monthIdx) => {
        const last = new Date(year, monthIdx + 1, 0).getDate();
        return new Date(year, monthIdx, Math.min(day, last));
      };
      const thisMonth = clampTo(base.getFullYear(), base.getMonth());
      if (thisMonth > base) return thisMonth;
      return clampTo(base.getFullYear(), base.getMonth() + 1);
    }

    case 'interval':
      return addMonths(base, Math.max(1, Number(rule.months) || 1));

    default:
      return null;
  }
};

/** Human label for a calendar rule — used on cards and in the editor. */
export const describeCalendarRule = (rule) => {
  if (!rule || !rule.kind) return '—';
  switch (rule.kind) {
    case 'daily':
      return 'Every day';
    case 'weekly': {
      const days = (rule.days || []).map((d) => String(d));
      if (!days.length) return 'Weekly';
      if (days.length === 7) return 'Every day';
      const titled = days
        .slice()
        .sort((a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b))
        .map((d) => d.charAt(0).toUpperCase() + d.slice(1, 3));
      return `Weekly — ${titled.join(', ')}`;
    }
    case 'monthly':
      return `Monthly on day ${Number(rule.day) || 1}`;
    case 'interval': {
      const m = Number(rule.months) || 1;
      return m === 1 ? 'Every month' : `Every ${m} months`;
    }
    default:
      return '—';
  }
};

/** Human label for the whole recurrence, counter included. */
export const describeRecurrence = (schedule, counter = null) => {
  if (!schedule) return '—';
  const cal = describeCalendarRule(schedule.calendarRule);
  const hasCounter = schedule.counterId && schedule.counterInterval;
  const counterLabel = hasCounter
    ? `Every ${schedule.counterInterval} ${counter?.unit || 'h'}`
    : null;

  if (schedule.triggerType === TRIGGER_TYPES.COUNTER) return counterLabel || 'On counter';
  if (schedule.triggerType === TRIGGER_TYPES.EITHER && counterLabel) {
    return `${counterLabel} or ${cal.toLowerCase()} — whichever first`;
  }
  return cal;
};

/**
 * Does this step apply to an occurrence falling on `date`?
 * null / 'daily' → every occurrence. 'weekly-tuesday' → only on a Tuesday.
 * 'monthly-12' → only on the 12th.
 */
export const stepAppliesOn = (frequency, date) => {
  if (!frequency) return true;
  const f = String(frequency).toLowerCase().trim();
  if (f === 'daily' || f === 'every') return true;

  if (f.startsWith('weekly-')) {
    const want = WEEKDAYS.indexOf(f.slice(7));
    if (want < 0) return true; // unrecognised → don't silently drop the step
    return date.getDay() === want;
  }

  if (f.startsWith('monthly-')) {
    const want = Number(f.slice(8));
    if (!want) return true;
    return date.getDate() === want;
  }

  return true;
};

/** The steps that belong on an occurrence for `date`, in order. */
export const stepsForOccurrence = (steps, date) =>
  (steps || [])
    .filter((s) => stepAppliesOn(s.frequency, date))
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

/**
 * Next due for a schedule, honouring calendar / counter / either.
 * Returns { date, counterDue, basis } — basis names what drove it, which is
 * stamped onto the generated job so the crew can see WHY it came up.
 */
export const nextDue = (schedule, counter = null, now = new Date()) => {
  const from = schedule?.lastCompletedAt ? new Date(schedule.lastCompletedAt) : now;
  const calDate =
    schedule?.triggerType === TRIGGER_TYPES.COUNTER
      ? null
      : nextCalendarDate(schedule?.calendarRule, from);

  let counterDue = null;
  if (schedule?.triggerType !== TRIGGER_TYPES.CALENDAR && schedule?.counterInterval) {
    const base = Number(schedule.lastCompletedCounter ?? 0);
    counterDue = base + Number(schedule.counterInterval);
  }

  const counterReached =
    counterDue != null && counter?.currentValue != null && Number(counter.currentValue) >= counterDue;

  // 'either' = whichever comes first, so a counter already past its mark wins now
  const basis = counterReached ? 'counter' : calDate ? 'calendar' : counterDue != null ? 'counter' : null;

  return {
    date: counterReached ? toISODate(now) : toISODate(calDate),
    counterDue,
    basis,
  };
};

/** Overdue / due-soon classification for the list view. */
export const dueState = (isoDate, leadDays = 0, today = new Date()) => {
  const d = parseISODate(isoDate);
  if (!d) return { key: 'none', label: 'No date', days: null };
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.round((d - t) / 86400000);
  if (days < 0) return { key: 'overdue', label: days === -1 ? '1 day over' : `${Math.abs(days)} days over`, days };
  if (days === 0) return { key: 'today', label: 'Due today', days };
  if (days <= Math.max(leadDays, 7)) return { key: 'soon', label: `In ${days} day${days === 1 ? '' : 's'}`, days };
  return { key: 'ahead', label: `In ${days} days`, days };
};

/** A reading outside its normal range is the whole point of typing the step. */
export const isOutOfRange = (value, min, max) => {
  if (value == null || value === '') return false;
  const v = Number(value);
  if (Number.isNaN(v)) return false;
  if (min != null && v < Number(min)) return true;
  if (max != null && v > Number(max)) return true;
  return false;
};
