// Loading and bulk-updating the tick state behind a duty set job.
//
// The checklist inside the job modal and the tick box on the job card both act
// on the same rows, so the resolution — job -> rotation assignment -> template
// -> the tasks that are actually on today's list — lives here once. The card
// checkbox in particular has no checklist mounted to ask, so it cannot borrow
// the component's copy.

import { supabase } from '../../../lib/supabaseClient';
import { outbox } from '../../../lib/offline/queue';
import { groupDutyTasks } from './dutyTasks';

/**
 * Save tick rows (duty_task_progress, one per job + task) through the offline
 * outbox. Duty rounds are ticked off at sea: online each row is written at
 * once and a real rejection still throws; with no signal the ticks queue on
 * the device, show on every read, and sync later. Edits of the same box fold
 * together while they wait.
 */
export const saveDutyProgressRows = async (rows, label = 'A duty checklist tick') => {
  for (const row of rows || []) {
    await outbox.submit({
      key: `duty_task_progress|${row.job_id}:${row.task_id}`,
      table: 'duty_task_progress',
      type: 'upsert',
      onConflict: 'job_id,task_id',
      row,
      match: { job_id: row.job_id, task_id: row.task_id },
      label,
    });
  }
};

export const rotationAssignmentIdOf = (job) =>
  job?.rotation_assignment_id || job?.rotationAssignmentId || null;

export const jobIdOf = (job) => job?.supabase_id || job?.id || null;

const dueDateOf = (job) => job?.dueDate || job?.due_date || null;

/**
 * Everything the checklist needs for one job: the template behind it, this
 * job's saved ticks and notes, and when each task was last done anywhere on
 * the vessel (which is what decides whether a monthly is falling due).
 *
 * @returns { template, progress, lastDone } — template is null when the job's
 *          duty set has been deleted, which the caller should say out loud
 *          rather than rendering an empty list.
 */
export const loadDutySetForJob = async ({ job, tenantId }) => {
  const assignmentId = rotationAssignmentIdOf(job);
  const jobId = jobIdOf(job);
  if (!assignmentId || !tenantId) return { template: null, progress: {}, lastDone: {} };

  const { data: assignment, error: aErr } = await supabase
    ?.from('rotation_assignments')
    ?.select('duty_set_template_id')
    ?.eq('id', assignmentId)
    ?.single();
  if (aErr) throw aErr;

  const templateId = assignment?.duty_set_template_id;
  if (!templateId) return { template: null, progress: {}, lastDone: {} };

  const [{ data: tpl, error: tErr }, { data: rows }] = await Promise.all([
    supabase?.from('duty_set_templates')?.select('id, name, tasks')?.eq('id', templateId)?.single(),
    jobId
      ? supabase?.from('duty_task_progress')
          ?.select('task_id, done, note, auto_completed')?.eq('job_id', jobId)
      : Promise.resolve({ data: [] }),
  ]);
  if (tErr) throw tErr;

  // Most recent completion per task across the vessel.
  const { data: history } = await supabase
    ?.from('duty_task_progress')
    ?.select('task_id, done_at')
    ?.eq('tenant_id', tenantId)
    ?.eq('template_id', templateId)
    ?.eq('done', true)
    ?.order('done_at', { ascending: false });

  const lastDone = {};
  (history || []).forEach(h => { if (!lastDone[h?.task_id]) lastDone[h.task_id] = h?.done_at; });

  const progress = {};
  (rows || []).forEach(r => {
    progress[r?.task_id] = {
      done: !!r?.done,
      note: r?.note || '',
      auto: !!r?.auto_completed,
    };
  });

  return { template: tpl || null, progress, lastDone };
};

/**
 * Everything a job's checklist shows for its day: the daily round, this
 * weekday's weeklies, and any monthly that has gone long enough to be falling
 * due. Monthlies done recently are excluded — they are not on today's list.
 */
export const dutyTasksForDay = (template, dueDate, lastDone) => {
  const grouped = groupDutyTasks(template?.tasks, dueDate, lastDone);
  return [
    ...(grouped?.today || []),
    ...(grouped?.weekly?.tasks || []),
    ...(grouped?.monthlyDue || []),
  ];
};

/**
 * The daily round, and only that.
 *
 * This is the set anything automatic is allowed to tick. The dailies are the
 * work that always happens, so ticking them off the back of a finished round
 * is a fair statement. The weeklies and the monthlies are not: they are the
 * jobs that get skipped, which is the whole reason they are surfaced
 * separately, and a monthly ticked by a machine claims it was done today and
 * pushes its three-week clock out — quietly burying the very task the
 * "suggested before month end" list exists to raise. Those stay a person's
 * call, one box at a time.
 */
export const dutyDailyTasks = (template) =>
  groupDutyTasks(template?.tasks, null, {})?.today || [];

/**
 * Tick the daily round.
 *
 * Deliberately the dailies only — see dutyDailyTasks. Tasks already ticked are
 * left exactly as they are, so a tick someone made themselves is never
 * rewritten as an automatic one and its note survives.
 *
 * @param auto true when this came from completing the whole job rather than
 *             from someone pressing "tick all" — it is what lets reopening the
 *             job undo these ticks and only these.
 * @returns the task ids that were newly ticked
 */
export const tickAllDutyTasks = async ({ job, tenantId, userId, auto = false }) => {
  const jobId = jobIdOf(job);
  if (!jobId || !tenantId || !rotationAssignmentIdOf(job)) return [];

  const { template, progress } = await loadDutySetForJob({ job, tenantId });
  if (!template) return [];

  const outstanding = dutyDailyTasks(template)
    ?.filter(t => t?.id && !progress?.[t?.id]?.done);
  if (!outstanding?.length) return [];

  const now = new Date()?.toISOString();
  await saveDutyProgressRows(
    outstanding?.map(t => ({
      tenant_id: tenantId,
      job_id: jobId,
      template_id: template?.id || null,
      task_id: t?.id,
      done: true,
      done_at: now,
      done_by: userId || null,
      auto_completed: auto,
      note: progress?.[t?.id]?.note || null,
      updated_at: now,
    })),
    'Ticking the daily round',
  );

  return outstanding?.map(t => t?.id);
};

/**
 * Undo the ticks that completing the job made, and nothing else.
 *
 * Reopening a job means the round was not finished after all, so the automatic
 * ticks have to go — but a task the person ticked on the round is still done,
 * and their notes are theirs. Only rows flagged auto_completed are cleared.
 *
 * @returns the task ids that were cleared
 */
export const clearAutoDutyTasks = async ({ job }) => {
  const jobId = jobIdOf(job);
  if (!jobId) return [];

  // Which ticks were automatic — read (works offline from the saved copy, with
  // any queued ticks laid over it), then clear exactly those rows.
  const { data, error } = await supabase
    ?.from('duty_task_progress')
    ?.select('task_id')
    ?.eq('job_id', jobId)
    ?.eq('auto_completed', true);
  if (error) throw error;
  const ids = (data || [])?.map(r => r?.task_id)?.filter(Boolean);

  const now = new Date()?.toISOString();
  for (const taskId of ids) {
    await outbox.submit({
      key: `duty_task_progress|${jobId}:${taskId}`,
      table: 'duty_task_progress',
      type: 'update',
      patch: { done: false, done_at: null, done_by: null, auto_completed: false, updated_at: now },
      match: { job_id: jobId, task_id: taskId, auto_completed: true },
      label: 'Reopening a duty round',
    });
  }
  return ids;
};
