// Remind me — the server-side kind.
//
// To Do's reminder is a timer on the handset that set it. This one is a row
// the database sweeps every five minutes, so it survives a flat battery, a
// closed app and a new phone, and it can be set on someone else.
//
// The time stored is a WALL CLOCK, not an instant: '2026-09-21T07:00:00'
// means seven in the morning on the vessel, and the sweep resolves it against
// vessels.timezone when it runs. That is the whole point — a phone-clock
// reminder set before a passage fires at the wrong moment after it.

import { supabase } from '../../../lib/supabaseClient';

const jobIdOf = (job) => job?.supabase_id || job?.id || null;

const pad = (n) => String(n)?.padStart(2, '0');

/** A Date → the 'YYYY-MM-DDTHH:mm:ss' wall clock Postgres `timestamp` wants. */
export const toWallClock = (d) =>
  `${d?.getFullYear()}-${pad(d?.getMonth() + 1)}-${pad(d?.getDate())}` +
  `T${pad(d?.getHours())}:${pad(d?.getMinutes())}:00`;

/** '2026-09-21T07:00:00' → a Date in the reader's own clock, for display. */
export const fromWallClock = (s) => {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/?.exec(String(s));
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0, 0);
};

/**
 * The vessel's own wall clock right now.
 *
 * Aboard, the browser is already on vessel time and this is a no-op. It
 * matters for anyone setting a reminder from shore — an owner's rep in London
 * choosing "tomorrow morning" means the boat's morning, not theirs.
 */
export const vesselNow = (timezone) => {
  if (!timezone) return new Date();
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    })?.formatToParts(new Date());
    const get = (t) => Number(parts?.find(p => p?.type === t)?.value);
    const h = get('hour') === 24 ? 0 : get('hour');
    return new Date(get('year'), get('month') - 1, get('day'), h, get('minute'), get('second'));
  } catch {
    return new Date();
  }
};

/** The vessel's timezone for this tenant, or null when none is recorded. */
export const loadVesselTimezone = async (tenantId) => {
  if (!tenantId) return null;
  const { data, error } = await supabase
    ?.from('vessels')
    ?.select('timezone, name')
    ?.eq('tenant_id', tenantId)
    ?.not('timezone', 'is', null)
    ?.order('name', { ascending: true })
    ?.limit(1);
  if (error) return null;
  return data?.[0]?.timezone || null;
};

const mapRow = (r) => ({
  id: r?.id,
  jobId: r?.job_id,
  userId: r?.user_id,
  createdBy: r?.created_by,
  remindLocal: r?.remind_local,
  originalLocal: r?.original_local,
  note: r?.note || '',
  state: r?.state,
  sentAt: r?.sent_at || null,
  cancelledReason: r?.cancelled_reason || null,
  snoozeCount: Number(r?.snooze_count) || 0,
});

/**
 * Every live reminder on this job — mine and anyone else's.
 *
 * Deliberately not filtered to the current user: if the chief has put a nudge
 * on you for 1400, you should be able to see that, and they should be able to
 * see it is still set. A reminder nobody can see is how two people set one.
 */
export const loadJobReminders = async ({ job, tenantId }) => {
  const jobId = jobIdOf(job);
  if (!jobId || !tenantId) return [];

  const { data, error } = await supabase
    ?.from('job_reminders')
    ?.select('id, job_id, user_id, created_by, remind_local, original_local, note, state, sent_at, cancelled_reason, snooze_count')
    ?.eq('job_id', jobId)
    ?.eq('tenant_id', tenantId)
    ?.in('state', ['pending', 'sent'])
    ?.order('remind_local', { ascending: true });
  if (error) throw error;
  return (data || [])?.map(mapRow);
};

/**
 * Set one.
 *
 * `forUserId` is who gets buzzed and defaults to whoever is setting it;
 * passing someone else is the nudge a chief puts on an assignee.
 */
export const setJobReminder = async ({
  job, tenantId, userId, forUserId, remindLocal, note = '',
}) => {
  const jobId = jobIdOf(job);
  if (!jobId || !tenantId || !remindLocal) return null;
  const recipient = forUserId || userId;
  if (!recipient) throw new Error('No one to remind — sign in again.');

  const { data, error } = await supabase
    ?.from('job_reminders')
    ?.insert({
      tenant_id: tenantId,
      job_id: jobId,
      user_id: recipient,
      created_by: userId || null,
      remind_local: remindLocal,
      original_local: remindLocal,
      note: note?.trim() || null,
    })
    ?.select('id, job_id, user_id, created_by, remind_local, original_local, note, state, sent_at, cancelled_reason, snooze_count')
    ?.single();
  if (error) throw error;
  return mapRow(data);
};

/**
 * Snooze — the kind that comes back.
 *
 * The row is reused rather than replaced, so snooze_count keeps counting and
 * original_local still says what you first asked for. A reminder you have
 * pushed three times is worth knowing about; To Do's forgets each time.
 */
export const snoozeJobReminder = async ({ reminder, remindLocal }) => {
  if (!reminder?.id || !remindLocal) return null;

  const { data, error } = await supabase
    ?.from('job_reminders')
    ?.update({
      remind_local: remindLocal,
      original_local: reminder?.originalLocal || reminder?.remindLocal,
      state: 'pending',
      sent_at: null,
      snooze_count: (Number(reminder?.snoozeCount) || 0) + 1,
      updated_at: new Date()?.toISOString(),
    })
    ?.eq('id', reminder?.id)
    ?.select('id, job_id, user_id, created_by, remind_local, original_local, note, state, sent_at, cancelled_reason, snooze_count')
    ?.single();
  if (error) throw error;
  return mapRow(data);
};

export const cancelJobReminder = async ({ reminderId }) => {
  if (!reminderId) return;
  const { error } = await supabase
    ?.from('job_reminders')
    ?.update({ state: 'cancelled', cancelled_reason: 'user', updated_at: new Date()?.toISOString() })
    ?.eq('id', reminderId);
  if (error) throw error;
};

// ── presets ───────────────────────────────────────────────────────────────
// Computed from the VESSEL's clock, not the reader's, so "tomorrow morning"
// is the boat's morning. Each returns a wall-clock string or null.

const atTime = (base, days, hour, minute = 0) => {
  const d = new Date(base?.getTime());
  d?.setDate(d?.getDate() + days);
  d?.setHours(hour, minute, 0, 0);
  return d;
};

/**
 * The offered times, in the order a day actually runs.
 *
 * "On the due date" is the one To Do has no equivalent for: it is the reminder
 * people actually want and currently set by hand, getting the date wrong.
 */
export const reminderPresets = ({ timezone, dueDate }) => {
  const now = vesselNow(timezone);
  const out = [];

  // In three hours, rounded up to the next half hour so it reads as a time
  // rather than as 14:37.
  const later = new Date(now?.getTime() + 3 * 60 * 60 * 1000);
  later?.setMinutes(later?.getMinutes() > 30 ? 60 : 30, 0, 0);
  if (later?.getDate() === now?.getDate()) {
    out?.push({ key: 'later', label: 'Later today', at: later });
  }

  const evening = atTime(now, 0, 18);
  if (evening > now) out?.push({ key: 'evening', label: 'This evening', at: evening });

  out?.push({ key: 'tomorrow', label: 'Tomorrow morning', at: atTime(now, 1, 8) });

  if (dueDate) {
    const due = fromWallClock(`${String(dueDate)?.split('T')?.[0]}T08:00`);
    if (due && due > now) {
      out?.push({ key: 'due', label: 'Morning of the due date', at: due });
    }
  }

  return out?.map(p => ({ ...p, wall: toWallClock(p?.at) }));
};

/** What "not now" can mean, once a reminder has already gone off. */
export const snoozePresets = ({ timezone }) => {
  const now = vesselNow(timezone);
  const out = [
    { key: '15m', label: '15 minutes', at: new Date(now?.getTime() + 15 * 60 * 1000) },
    { key: '1h', label: 'An hour', at: new Date(now?.getTime() + 60 * 60 * 1000) },
  ];
  const evening = atTime(now, 0, 18);
  if (evening > now) out?.push({ key: 'evening', label: 'This evening', at: evening });
  out?.push({ key: 'tomorrow', label: 'Tomorrow morning', at: atTime(now, 1, 8) });
  return out?.map(p => ({ ...p, wall: toWallClock(p?.at) }));
};

/** '21/09/2026, 07:00' — dd/mm/yyyy, the way the rest of Cargo reads dates. */
export const formatReminder = (wall) => {
  const d = fromWallClock(wall);
  if (!d) return '';
  return `${pad(d?.getDate())}/${pad(d?.getMonth() + 1)}/${d?.getFullYear()}, ${pad(d?.getHours())}:${pad(d?.getMinutes())}`;
};
