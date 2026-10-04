// The small pieces inside one job — To Do calls them Steps.
//
// Shared, the way the job is: anyone who can see the job sees its steps, and
// whoever is doing the work ticks them off. Until now these lived in React
// state and localStorage, and fetchJobsFromSupabase reset them to [] on every
// load, so they vanished for their author and never existed for the assignee.

// Writes go through the offline outbox (lib/offline/outbox.js) so steps can be
// added and ticked at sea; pending ones show in loadJobSteps until they sync.

import { supabase } from '../../../lib/supabaseClient';
import { outbox } from '../../../lib/offline/queue';
import { newId } from '../../../lib/offline/ids';

const stepKey = (id) => `job_steps|${id}`;

const jobIdOf = (job) => job?.supabase_id || job?.id || null;

/** Steps for a job, in the order they are meant to be worked. */
export const loadJobSteps = async ({ job, tenantId }) => {
  const jobId = jobIdOf(job);
  if (!jobId || !tenantId) return [];

  const { data, error } = await supabase
    ?.from('job_steps')
    ?.select('id, text, done, done_at, done_by, position')
    ?.eq('job_id', jobId)
    ?.eq('tenant_id', tenantId)
    ?.order('position', { ascending: true })
    ?.order('created_at', { ascending: true });
  if (error) throw error;

  return (data || [])?.map(r => ({
    id: r?.id,
    text: r?.text || '',
    done: !!r?.done,
    doneAt: r?.done_at || null,
    doneBy: r?.done_by || null,
    position: Number(r?.position) || 0,
  }));
};

/**
 * Add a step to the end of the list.
 *
 * Position is taken from the current last rather than the count, so a list
 * that has had steps deleted out of the middle still appends rather than
 * colliding with an existing position.
 */
export const addJobStep = async ({ job, tenantId, text, userId, after = [] }) => {
  const jobId = jobIdOf(job);
  const clean = String(text || '')?.trim();
  if (!jobId || !tenantId || !clean) return null;

  const lastPosition = (after || [])?.reduce((max, s) => Math.max(max, s?.position || 0), -1);

  const id = newId();
  const nowIso = new Date()?.toISOString();
  const row = {
    id,
    tenant_id: tenantId,
    job_id: jobId,
    text: clean,
    position: lastPosition + 1,
    created_by: userId || null,
    done: false,
    created_at: nowIso,
    updated_at: nowIso,
  };
  await outbox.submit({ key: stepKey(id), table: 'job_steps', type: 'insert', row, match: { id }, label: 'A job step' });

  return { id, text: clean, done: false, doneAt: null, doneBy: null, position: lastPosition + 1 };
};

const updateStep = (stepId, patch) => outbox.submit({
  key: stepKey(stepId), table: 'job_steps', type: 'update', patch, match: { id: stepId }, label: 'A job step',
});

export const setJobStepDone = async ({ stepId, done, userId }) => {
  await updateStep(stepId, {
    done: !!done,
    done_at: done ? new Date()?.toISOString() : null,
    done_by: done ? (userId || null) : null,
    updated_at: new Date()?.toISOString(),
  });
};

export const renameJobStep = async ({ stepId, text }) => {
  const clean = String(text || '')?.trim();
  if (!clean) return;
  await updateStep(stepId, { text: clean, updated_at: new Date()?.toISOString() });
};

export const removeJobStep = async ({ stepId }) => {
  await outbox.submit({ key: stepKey(stepId), table: 'job_steps', type: 'delete', match: { id: stepId }, label: 'Removing a job step' });
};
