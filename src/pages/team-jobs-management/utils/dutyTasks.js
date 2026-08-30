// Grouping rules for a duty set job's task list.
//
// A duty set template carries every task for its area — the daily round, the
// weekday-specific weeklies, and the monthlies — because that is how the SOPs
// are written and how the work is actually done: if you are on crew mess today
// you also check that day's weekly and whatever monthly is falling due. But
// showing all 56 at once is useless. This splits one template into the three
// things the person on shift needs to see:
//
//   today    — the daily round, always
//   weekly   — only the tasks pinned to THIS day of the week
//   monthly  — split into what is falling due and what was done recently
//
// A monthly task is "falling due" when it has not been completed for longer
// than MONTHLY_DUE_AFTER_DAYS, or has never been completed at all. Three weeks
// is the trigger, so a monthly always surfaces with a week of the month left
// to actually do it.

export const MONTHLY_DUE_AFTER_DAYS = 21;

const DOW = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** 'weekly-monday' -> 'monday'; anything else -> null */
const weeklyDayOf = (frequency) => {
  const f = String(frequency || '').toLowerCase();
  if (!f.startsWith('weekly')) return null;
  const day = f.split('-')[1];
  return DOW.includes(day) ? day : null;
};

const isDaily = (f) => String(f || 'daily').toLowerCase().startsWith('daily');
const isMonthly = (f) => String(f || '').toLowerCase().startsWith('monthly');

/** Title-case a day key for a section header: 'monday' -> 'Monday'. */
export const dayLabel = (day) => (day ? day.charAt(0).toUpperCase() + day.slice(1) : '');

/** Day-of-week key for a yyyy-mm-dd string, read as a local date. */
export const dayKeyForDate = (dateISO) => {
  if (!dateISO) return DOW[new Date().getDay()];
  const [y, m, d] = String(dateISO).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return DOW[new Date().getDay()];
  return DOW[new Date(y, m - 1, d).getDay()];
};

export const daysSince = (iso, now = new Date()) => {
  if (!iso) return null;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;
  return Math.floor((now - then) / 86400000);
};

/**
 * Split a template's tasks into the sections a job should show for one day.
 *
 * @param tasks        duty_set_templates.tasks — [{ id, text, frequency }]
 * @param dateISO      the job's due date (yyyy-mm-dd); decides which weekly shows
 * @param lastDoneById { [taskId]: ISO timestamp } most recent completion, tenant-wide
 * @returns { today, weekly: { day, label, tasks }, monthlyDue, monthlyRecent }
 */
export const groupDutyTasks = (tasks, dateISO, lastDoneById = {}, now = new Date()) => {
  const all = Array.isArray(tasks) ? tasks : [];
  const day = dayKeyForDate(dateISO);

  const today = [];
  const weekly = [];
  const monthlyDue = [];
  const monthlyRecent = [];

  all.forEach((task) => {
    const f = task?.frequency;

    if (isMonthly(f)) {
      const since = daysSince(lastDoneById?.[task?.id], now);
      const due = since === null || since > MONTHLY_DUE_AFTER_DAYS;
      (due ? monthlyDue : monthlyRecent).push({ ...task, daysSinceDone: since });
      return;
    }

    const wd = weeklyDayOf(f);
    if (wd) {
      // Weeklies for other days belong to whoever has this area that day.
      if (wd === day) weekly.push(task);
      return;
    }

    if (isDaily(f)) today.push(task);
  });

  return {
    today,
    weekly: { day, label: dayLabel(day), tasks: weekly },
    monthlyDue,
    monthlyRecent,
  };
};
