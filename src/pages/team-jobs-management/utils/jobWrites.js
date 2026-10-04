// Offline-capable writes for team_jobs (lib/offline/outbox.js). Jobs are
// ticked off and created at sea, so these go through the outbox: online they
// run immediately (a real rejection still comes back as `error`); with no
// network they are saved on the device, show in every read of team_jobs
// (lists, widgets, the board), and sync when the link returns. Several
// offline edits of one job fold into a single write.

import { outbox } from '../../../lib/offline/queue';
import { newId } from '../../../lib/offline/ids';

const jobKey = (id) => `team_jobs|${id}`;

/** update(patch).eq('id').eq('tenant_id') → { error } */
export async function updateJobRow(jobId, tenantId, patch, label = 'A job update') {
  try {
    const res = await outbox.submit({
      key: jobKey(jobId),
      table: 'team_jobs',
      type: 'update',
      patch,
      match: { id: jobId, tenant_id: tenantId },
      label,
    });
    return { error: null, queued: res.queued };
  } catch (error) {
    return { error };
  }
}

/** insert(row) with a device-made id → { data: the full row, error } */
export async function insertJobRow(row) {
  const nowIso = new Date().toISOString();
  const full = { id: newId(), created_at: nowIso, updated_at: nowIso, ...row };
  try {
    const res = await outbox.submit({
      key: jobKey(full.id),
      table: 'team_jobs',
      type: 'insert',
      row: full,
      match: { id: full.id },
      label: `Job “${full.title || 'untitled'}”`,
    });
    return { data: full, error: null, queued: res.queued };
  } catch (error) {
    return { data: null, error };
  }
}

/** A note on a job (job_notes), offline-capable like the rest. */
export async function insertJobNote(row) {
  const full = { id: newId(), created_at: new Date().toISOString(), ...row };
  try {
    await outbox.submit({ key: `job_notes|${full.id}`, table: 'job_notes', type: 'insert', row: full, match: { id: full.id }, label: 'A job note' });
    return { error: null };
  } catch (error) {
    return { error };
  }
}
