// The one checklist behind a job, whatever raised it.
//
// A job is the primitive — a card. A checklist is something a card HAS, so this
// module is the single place items are materialised, read and written, for
// every origin:
//
//   duty    — generated from the duty set template for the job's own day
//   upkeep  — generated from an upkeep schedule's typed steps
//   manual  — typed by whoever made the card
//
// Everything lands in job_checklist_items with its wording FROZEN at
// materialisation. duty_task_progress stored only a task id and read the text
// live from the template, so editing a task rewrote what every past tick
// claimed to have covered; that is the hole this closes.
//
// Stock is deliberately NOT here. job_links already points a job at what it
// uses and consumes it on completion, multi-location aware and against the
// movements ledger. Two things allowed to move the same stock is a bug waiting.

import { supabase } from '../../../lib/supabaseClient';
import { groupDutyTasks } from './dutyTasks';

export const ORIGIN = { DUTY: 'duty', UPKEEP: 'upkeep', DEFECT: 'defect', MANUAL: 'manual' };
export const ITEM_TYPE = { CHECK: 'check', READING: 'reading', PHOTO: 'photo', NOTE: 'note' };
export const STATUS = { PENDING: 'pending', DONE: 'done', SKIPPED: 'skipped', FAILED: 'failed' };

export const SECTION_MONTHLY_DUE = 'Monthly — falling due';
export const SECTION_TODAY = 'Today';

const mapItem = (r) => r && ({
  id: r.id,
  jobId: r.job_id,
  section: r.section,
  position: r.position ?? 0,
  text: r.text,
  itemType: r.item_type || 'check',
  unit: r.unit,
  minNormal: r.min_normal != null ? Number(r.min_normal) : null,
  maxNormal: r.max_normal != null ? Number(r.max_normal) : null,
  isMandatory: !!r.is_mandatory,
  guidance: r.guidance,
  status: r.status,
  done: r.status === STATUS.DONE,
  valueNumeric: r.value_numeric != null ? Number(r.value_numeric) : null,
  valueText: r.value_text,
  note: r.note || '',
  photoUrl: r.photo_url,
  outOfRange: !!r.out_of_range,
  autoCompleted: !!r.auto_completed,
  doneAt: r.done_at,
  doneBy: r.done_by,
  doneByName: r.done_by_name,
  originKind: r.origin_kind,
  originRef: r.origin_ref,
  templateId: r.template_id,
  counterId: r.counter_id,
});

/** A reading outside its normal range is the point of typing the item. */
export const isOutOfRange = (value, min, max) => {
  if (value == null || value === '') return false;
  const v = Number(value);
  if (Number.isNaN(v)) return false;
  if (min != null && v < Number(min)) return true;
  if (max != null && v > Number(max)) return true;
  return false;
};

export const loadChecklist = async (jobId) => {
  if (!jobId) return [];
  const { data, error } = await supabase
    .from('job_checklist_items')
    .select('*')
    .eq('job_id', jobId)
    .order('position', { ascending: true });
  if (error) throw error;
  return (data || []).map(mapItem);
};

/**
 * When each duty task was last completed anywhere on this vessel.
 *
 * Drives the monthly falling-due rule, so it must span jobs and people — it is
 * "has this been done lately", not "did I do it". Reads the new table only;
 * the migration carried every duty_task_progress row across.
 */
export const loadLastDone = async ({ tenantId, templateId }) => {
  if (!tenantId || !templateId) return {};
  const { data, error } = await supabase
    .from('job_checklist_items')
    .select('origin_ref, done_at')
    .eq('tenant_id', tenantId)
    .eq('template_id', templateId)
    .eq('status', STATUS.DONE)
    .order('done_at', { ascending: false });
  if (error) return {};
  const lastDone = {};
  (data || []).forEach((r) => {
    if (r.origin_ref && !lastDone[r.origin_ref]) lastDone[r.origin_ref] = r.done_at;
  });
  return lastDone;
};

/**
 * Build the rows a duty job should carry for its own day.
 *
 * The grouping rules are the existing ones — today's dailies, only this
 * weekday's weeklies, and the monthlies that have gone long enough to be
 * falling due — but the result is now stored rather than recomputed on every
 * render, which is what freezes the wording.
 */
const dutyRowsFor = ({ template, dueDate, lastDone, tenantId, jobId }) => {
  const grouped = groupDutyTasks(template?.tasks, dueDate, lastDone);
  const rows = [];
  let position = 0;

  const push = (task, section) => {
    // A task with no id cannot be tracked: the older duty sets stored tasks as
    // bare {title} with no identity at all, and a null origin_ref would collide
    // every one of them onto the same row. Fall back to its position, which is
    // stable for as long as the template is not reordered.
    const ref = task?.id || `pos-${position}`;
    rows.push({
      tenant_id: tenantId,
      job_id: jobId,
      section,
      position: position++,
      text: task?.text || task?.title || '(untitled task)',
      item_type: ITEM_TYPE.CHECK,
      status: STATUS.PENDING,
      origin_kind: ORIGIN.DUTY,
      origin_ref: ref,
      template_id: template?.id || null,
    });
  };

  (grouped?.today || []).forEach((t) => push(t, SECTION_TODAY));
  (grouped?.weekly?.tasks || []).forEach((t) => push(t, grouped?.weekly?.label || 'This week'));
  (grouped?.monthlyDue || []).forEach((t) => push(t, SECTION_MONTHLY_DUE));

  return rows;
};

/** Rows for an upkeep occurrence — typed steps, readings and all. */
const upkeepRowsFor = ({ steps, tenantId, jobId }) =>
  (steps || []).map((s, i) => ({
    tenant_id: tenantId,
    job_id: jobId,
    section: s.section || null,
    position: i,
    text: s.text,
    item_type: s.stepType || ITEM_TYPE.CHECK,
    unit: s.unit || null,
    min_normal: s.minNormal ?? null,
    max_normal: s.maxNormal ?? null,
    is_mandatory: !!s.isMandatory,
    guidance: s.guidance || null,
    status: STATUS.PENDING,
    origin_kind: ORIGIN.UPKEEP,
    origin_ref: s.id,
    counter_id: s.counterId || null,
  }));

/**
 * Make sure a job's checklist exists, and return it.
 *
 * Materialising is idempotent — the unique (job_id, origin_kind, origin_ref)
 * means a second open, or two devices opening at once, inserts nothing. Jobs
 * raised before this table existed get their list built the first time someone
 * opens them, so nothing needs a mass backfill and a missed job self-heals.
 */
export const ensureChecklist = async ({ jobId, tenantId, origin, template, dueDate, steps }) => {
  if (!jobId || !tenantId) return [];

  const existing = await loadChecklist(jobId);
  if (existing.length) return existing;

  let rows = [];
  if (origin === ORIGIN.DUTY && template) {
    const lastDone = await loadLastDone({ tenantId, templateId: template.id });
    rows = dutyRowsFor({ template, dueDate, lastDone, tenantId, jobId });
  } else if (origin === ORIGIN.UPKEEP && steps?.length) {
    rows = upkeepRowsFor({ steps, tenantId, jobId });
  }
  if (!rows.length) return [];

  const { error } = await supabase
    .from('job_checklist_items')
    .upsert(rows, { onConflict: 'job_id,origin_kind,origin_ref', ignoreDuplicates: true });
  if (error) throw error;

  return loadChecklist(jobId);
};

/** Record one item. Range-checking happens here so out_of_range is stored, not
 *  recomputed later against a range that may since have been edited. */
export const saveItem = async (itemId, patch, actor) => {
  if (!itemId) throw new Error('No checklist item to save.');
  const row = {};

  if ('status' in patch) {
    row.status = patch.status;
    if (patch.status === STATUS.PENDING) {
      row.done_at = null; row.done_by = null; row.done_by_name = null; row.auto_completed = false;
    } else {
      row.done_at = new Date().toISOString();
      row.done_by = actor?.userId || null;
      row.done_by_name = actor?.userName || null;
      // a tick someone made themselves is never an automatic one
      row.auto_completed = false;
    }
  }
  if ('note' in patch) row.note = patch.note || null;
  if ('valueText' in patch) row.value_text = patch.valueText || null;
  if ('photoUrl' in patch) row.photo_url = patch.photoUrl || null;
  if ('valueNumeric' in patch) {
    const v = patch.valueNumeric === '' || patch.valueNumeric == null ? null : Number(patch.valueNumeric);
    row.value_numeric = v;
    row.out_of_range = isOutOfRange(v, patch.minNormal, patch.maxNormal);
  }

  const { data, error } = await supabase
    .from('job_checklist_items')
    .update(row)
    .eq('id', itemId)
    .select('*')
    .single();
  if (error) throw error;
  return mapItem(data);
};

/** Add an item by hand — a manual card's own checklist, or a one-off note on a
 *  generated round. Manual items carry no origin_ref, so they may repeat. */
export const addManualItem = async ({ jobId, tenantId, text, section = null, position = null }) => {
  if (!jobId || !tenantId || !text?.trim()) return null;
  const { data, error } = await supabase
    .from('job_checklist_items')
    .insert({
      tenant_id: tenantId,
      job_id: jobId,
      section,
      position: position ?? 9999,
      text: text.trim(),
      item_type: ITEM_TYPE.CHECK,
      status: STATUS.PENDING,
      origin_kind: ORIGIN.MANUAL,
    })
    .select('*')
    .single();
  if (error) throw error;
  return mapItem(data);
};

export const removeItem = async (itemId) => {
  const { error } = await supabase.from('job_checklist_items').delete().eq('id', itemId);
  if (error) throw error;
};

/**
 * Tick the items an automatic action is allowed to tick.
 *
 * Deliberately the 'Today' section only. The dailies are the work that always
 * happens, so ticking them off the back of a finished round is a fair
 * statement. Weeklies and monthlies are not: they are the jobs that get
 * skipped, which is why they are surfaced separately, and a monthly ticked by a
 * machine claims it was done today and pushes its three-week clock out —
 * burying the very task the falling-due list exists to raise.
 */
export const autoTickDailies = async ({ jobId, tenantId, userId, userName }) => {
  if (!jobId || !tenantId) return [];
  const items = await loadChecklist(jobId);
  const outstanding = items.filter(
    (i) => i.section === SECTION_TODAY && i.status === STATUS.PENDING,
  );
  if (!outstanding.length) return [];

  const now = new Date().toISOString();
  const { error } = await supabase
    .from('job_checklist_items')
    .update({
      status: STATUS.DONE,
      done_at: now,
      done_by: userId || null,
      done_by_name: userName || null,
      auto_completed: true,
    })
    .in('id', outstanding.map((i) => i.id));
  if (error) throw error;
  return outstanding.map((i) => i.id);
};

/**
 * Undo the ticks that completing the job made, and nothing else.
 *
 * Reopening means the round was not finished after all, so the automatic ticks
 * go — but a task the person ticked is still done, and their notes are theirs.
 * Only auto_completed rows are cleared, and a note is never discarded.
 */
export const clearAutoTicks = async (jobId) => {
  if (!jobId) return [];
  const { data, error } = await supabase
    .from('job_checklist_items')
    .update({ status: STATUS.PENDING, done_at: null, done_by: null, done_by_name: null, auto_completed: false })
    .eq('job_id', jobId)
    .eq('auto_completed', true)
    .select('id');
  if (error) throw error;
  return (data || []).map((r) => r.id);
};

/** Group loaded items back into their sections, in stored order. */
export const bySection = (items) => {
  const order = [];
  const map = new Map();
  (items || []).forEach((i) => {
    const key = i.section || '';
    if (!map.has(key)) { map.set(key, []); order.push(key); }
    map.get(key).push(i);
  });
  return order.map((key) => ({ section: key, items: map.get(key) }));
};
