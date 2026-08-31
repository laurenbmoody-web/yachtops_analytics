// Resolving a duty set job to its template, and the automatic ticks around
// completing one.
//
// The tick state itself now lives in job_checklist_items alongside every other
// kind of job's checklist — see ./jobChecklist. This module keeps the duty-set
// specific part: walking job -> rotation assignment -> template, and the
// complete/reopen behaviour the job card and the board rely on.
//
// The exported surface is unchanged so callers did not have to move.

import { supabase } from '../../../lib/supabaseClient';
import { groupDutyTasks } from './dutyTasks';
import {
  ORIGIN, SECTION_TODAY,
  ensureChecklist, loadChecklist, loadLastDone,
  autoTickDailies, clearAutoTicks,
} from './jobChecklist';

export const rotationAssignmentIdOf = (job) =>
  job?.rotation_assignment_id || job?.rotationAssignmentId || null;

export const jobIdOf = (job) => job?.supabase_id || job?.id || null;

const dueDateOf = (job) => job?.dueDate || job?.due_date || null;

/**
 * Everything the checklist needs for one job: the template behind it, the job's
 * materialised items, and when each task was last done anywhere on the vessel
 * (which is what decides whether a monthly is falling due).
 *
 * The item list is materialised on first open, so a job raised before
 * job_checklist_items existed builds its list the first time someone looks at
 * it rather than needing a mass backfill.
 *
 * @returns { template, items, lastDone } — template is null when the job's duty
 *          set has been deleted, which the caller should say out loud rather
 *          than rendering an empty list.
 */
export const loadDutySetForJob = async ({ job, tenantId }) => {
  const assignmentId = rotationAssignmentIdOf(job);
  const jobId = jobIdOf(job);
  if (!assignmentId || !tenantId) return { template: null, items: [], lastDone: {} };

  const { data: assignment, error: aErr } = await supabase
    ?.from('rotation_assignments')
    ?.select('duty_set_template_id')
    ?.eq('id', assignmentId)
    ?.single();
  if (aErr) throw aErr;

  const templateId = assignment?.duty_set_template_id;
  if (!templateId) return { template: null, items: [], lastDone: {} };

  const { data: tpl, error: tErr } = await supabase
    ?.from('duty_set_templates')?.select('id, name, tasks')?.eq('id', templateId)?.single();
  if (tErr) throw tErr;
  if (!tpl) return { template: null, items: [], lastDone: {} };

  const items = await ensureChecklist({
    jobId,
    tenantId,
    origin: ORIGIN.DUTY,
    template: tpl,
    dueDate: dueDateOf(job),
  });

  const lastDone = await loadLastDone({ tenantId, templateId });

  return { template: tpl, items, lastDone };
};

/**
 * The tasks a job's checklist shows for its day: the daily round, this
 * weekday's weeklies, and any monthly that has gone long enough to be falling
 * due. Monthlies done recently are deliberately excluded — ticking those would
 * claim they were redone today and push their clock out.
 *
 * Kept for callers that want the shape without materialising anything.
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
 * work that always happens, so ticking them off the back of a finished round is
 * a fair statement. The weeklies and the monthlies are not: they are the jobs
 * that get skipped, which is the whole reason they are surfaced separately, and
 * a monthly ticked by a machine claims it was done today and pushes its
 * three-week clock out — quietly burying the very task the "suggested before
 * month end" list exists to raise. Those stay a person's call, one box at a
 * time.
 */
export const dutyDailyTasks = (template) =>
  groupDutyTasks(template?.tasks, null, {})?.today || [];

/**
 * Tick the daily round.
 *
 * Deliberately the dailies only — see dutyDailyTasks. Items already ticked are
 * left exactly as they are, so a tick someone made themselves is never
 * rewritten as an automatic one and its note survives.
 *
 * @param auto true when this came from completing the whole job rather than
 *             from someone pressing "tick all" — it is what lets reopening the
 *             job undo these ticks and only these.
 * @returns the checklist item ids that were newly ticked
 */
export const tickAllDutyTasks = async ({ job, tenantId, userId, userName, auto = false }) => {
  const jobId = jobIdOf(job);
  if (!jobId || !tenantId || !rotationAssignmentIdOf(job)) return [];

  // The job may never have been opened, so its list may not exist yet.
  let items = await loadChecklist(jobId);
  if (!items.length) {
    const loaded = await loadDutySetForJob({ job, tenantId });
    items = loaded?.items || [];
  }
  if (!items.length) return [];

  if (!auto) {
    // "Tick all" pressed by a person still only covers the daily round: the
    // weeklies and monthlies on the list are exactly the ones worth a
    // deliberate box each.
    const outstanding = items.filter(
      (i) => i.section === SECTION_TODAY && i.status === 'pending',
    );
    if (!outstanding.length) return [];
  }

  return autoTickDailies({ jobId, tenantId, userId, userName });
};

/**
 * Undo the ticks that completing the job made, and nothing else.
 *
 * Reopening a job means the round was not finished after all, so the automatic
 * ticks have to go — but a task the person ticked on the round is still done,
 * and their notes are theirs. Only rows flagged auto_completed are cleared.
 *
 * @returns the checklist item ids that were cleared
 */
export const clearAutoDutyTasks = async ({ job }) => clearAutoTicks(jobIdOf(job));
