// Promote a defect into a planned maintenance job. A fault that keeps recurring
// becomes preventive upkeep on the team-jobs board, tagged back to the defect.
// team_jobs has no storage layer of its own, so this is a single tenant-scoped
// insert (mirroring the app's inline creates) plus the two-way link + an event.
// All three writes go through the offline outbox, so it works at sea too.
import { outbox } from '../../../lib/offline/queue';
import { newId } from '../../../lib/offline/ids';
import { insertJobRow } from '../../team-jobs-management/utils/jobWrites';

export const RECURRENCE_OPTIONS = [
  { value: 'monthly', label: 'Every month' },
  { value: 'quarterly', label: 'Every 3 months' },
  { value: 'biannual', label: 'Every 6 months' },
  { value: 'annual', label: 'Every year' },
  { value: 'none', label: 'One-off (no repeat)' },
];
export const RECURRENCE_LABEL = Object.fromEntries(RECURRENCE_OPTIONS.map((o) => [o.value, o.label]));

export const promoteDefectToMaintenance = async (defect, { title, dueDate, recurrence }, actor) => {
  if (!defect?.id || !actor?.tenantId) throw new Error('Missing defect context.');
  const rec = recurrence && recurrence !== 'none' ? recurrence : null;

  const { data: job, error } = await insertJobRow({
    tenant_id: actor.tenantId,
    title: (title || defect.title || 'Planned maintenance').trim(),
    description: defect.description || null,
    department_id: defect.departmentId || null,
    assigned_to: defect.assignedToUserId || null,
    created_by: actor.userId || null,
    status: 'active',
    cross_dept_status: 'NONE',
    is_private: false,
    priority: defect.priority || null,
    due_date: dueDate || null,
    source: 'defect',
    source_defect_id: defect.id,
    recurrence: rec,
    metadata: [],
  });
  if (error || !job) throw error || new Error('Could not create the maintenance job.');

  // Two-way link + audit on the defect.
  await outbox.submit({
    key: `defects|${defect.id}`,
    table: 'defects',
    type: 'update',
    patch: { promoted_job_id: job.id, updated_at: new Date().toISOString() },
    match: { id: defect.id, tenant_id: actor.tenantId },
    label: 'Linking a defect to its maintenance job',
  });
  const eventId = newId();
  await outbox.submit({
    key: `defect_events|${eventId}`,
    table: 'defect_events',
    type: 'insert',
    row: {
      id: eventId, defect_id: defect.id, tenant_id: actor.tenantId, type: 'promoted_to_job',
      actor_id: actor.userId || null, actor_name: actor.userName || null,
      summary: `Planned maintenance created${rec ? ` — repeats ${rec}` : ''}`,
      meta: { job_id: job.id }, created_at: new Date().toISOString(),
    },
    match: { id: eventId },
    label: 'A defect history entry',
  }).catch(() => {});

  return job;
};
