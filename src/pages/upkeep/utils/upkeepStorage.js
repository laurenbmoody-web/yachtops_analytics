// Upkeep data layer — Supabase-backed, tenant-scoped (RLS via tenant_members).
//
// Tables (20260830101926_upkeep_schema.sql):
//   equipment / equipment_counters / equipment_counter_readings
//   upkeep_schedules / upkeep_steps / upkeep_step_results
//
// Occurrences are NOT a table of their own: a schedule generates a row in
// team_jobs with source='upkeep' + upkeep_schedule_id, exactly as rotations
// (rotation_assignment_id) and defects (source_defect_id) already do. All work
// lands in the one crew list.
//
// Callers pass an `actor` resolved from useAuth()/useTenant():
//   actor = { tenantId, userId, userName, tier, departmentId, departmentName }
// matching the defects data layer.

import { supabase } from '../../../lib/supabaseClient';
import { nextDue, stepsForOccurrence, toISODate, isOutOfRange } from './recurrence';

// ── row ⇄ view mapping ───────────────────────────────────────────────────────
const mapSchedule = (r) => r && ({
  id: r.id,
  tenantId: r.tenant_id,
  departmentId: r.department_id,
  name: r.name,
  category: r.category,
  description: r.description,
  equipmentId: r.equipment_id,
  estimatedMinutes: r.estimated_minutes,
  triggerType: r.trigger_type,
  calendarRule: r.calendar_rule,
  counterId: r.counter_id,
  counterInterval: r.counter_interval != null ? Number(r.counter_interval) : null,
  leadTimeDays: r.lead_time_days,
  criticality: r.criticality,
  isClassItem: r.is_class_item,
  active: r.active,
  lastCompletedAt: r.last_completed_at,
  lastCompletedCounter: r.last_completed_counter != null ? Number(r.last_completed_counter) : null,
  nextDueDate: r.next_due_date,
  sourceDutySetId: r.source_duty_set_id,
  createdAt: r.created_at,
  steps: (r.upkeep_steps || []).map(mapStep).sort((a, b) => a.position - b.position),
});

const mapStep = (r) => r && ({
  id: r.id,
  scheduleId: r.schedule_id,
  position: r.position ?? 0,
  text: r.text,
  stepType: r.step_type || 'check',
  frequency: r.frequency,
  unit: r.unit,
  minNormal: r.min_normal != null ? Number(r.min_normal) : null,
  maxNormal: r.max_normal != null ? Number(r.max_normal) : null,
  counterId: r.counter_id,
  equipmentId: r.equipment_id,
  inventoryItemId: r.inventory_item_id,
  quantityUsed: r.quantity_used != null ? Number(r.quantity_used) : null,
  isMandatory: !!r.is_mandatory,
  guidance: r.guidance,
});

const mapEquipment = (r) => r && ({
  id: r.id,
  tenantId: r.tenant_id,
  departmentId: r.department_id,
  parentId: r.parent_id,
  name: r.name,
  code: r.code,
  description: r.description,
  vesselLocationId: r.vessel_location_id,
  locationLabel: r.location_label,
  manufacturer: r.manufacturer,
  model: r.model,
  serialNumber: r.serial_number,
  commissionedOn: r.commissioned_on,
  criticality: r.criticality,
  isClassItem: r.is_class_item,
  externalSource: r.external_source,
  externalRef: r.external_ref,
  active: r.active,
  counters: (r.equipment_counters || []).map(mapCounter),
});

const mapCounter = (r) => r && ({
  id: r.id,
  equipmentId: r.equipment_id,
  name: r.name,
  unit: r.unit,
  currentValue: r.current_value != null ? Number(r.current_value) : null,
  currentAsOf: r.current_as_of,
  externalRef: r.external_ref,
});

const mapResult = (r) => r && ({
  id: r.id,
  jobId: r.job_id,
  stepId: r.step_id,
  position: r.position ?? 0,
  stepText: r.step_text,
  stepType: r.step_type || 'check',
  unit: r.unit,
  minNormal: r.min_normal != null ? Number(r.min_normal) : null,
  maxNormal: r.max_normal != null ? Number(r.max_normal) : null,
  status: r.status,
  valueNumeric: r.value_numeric != null ? Number(r.value_numeric) : null,
  valueText: r.value_text,
  comment: r.comment,
  photoUrl: r.photo_url,
  outOfRange: !!r.out_of_range,
  isMandatory: !!r.is_mandatory,
  counterId: r.counter_id,
  inventoryItemId: r.inventory_item_id,
  quantityUsed: r.quantity_used != null ? Number(r.quantity_used) : null,
  completedBy: r.completed_by,
  completedByName: r.completed_by_name,
  completedAt: r.completed_at,
});

// ── schedules ────────────────────────────────────────────────────────────────

export const fetchSchedules = async (tenantId, { departmentId = null, includeInactive = false } = {}) => {
  if (!tenantId) return [];
  let q = supabase
    .from('upkeep_schedules')
    .select('*, upkeep_steps(*)')
    .eq('tenant_id', tenantId);
  if (departmentId) q = q.eq('department_id', departmentId);
  if (!includeInactive) q = q.eq('active', true);

  const { data, error } = await q.order('name', { ascending: true });
  if (error) throw error;
  return (data || []).map(mapSchedule);
};

export const fetchSchedule = async (scheduleId) => {
  if (!scheduleId) return null;
  const { data, error } = await supabase
    .from('upkeep_schedules')
    .select('*, upkeep_steps(*)')
    .eq('id', scheduleId)
    .maybeSingle();
  if (error) throw error;
  return mapSchedule(data);
};

const scheduleToRow = (s, actor) => ({
  tenant_id: actor.tenantId,
  department_id: s.departmentId ?? actor.departmentId ?? null,
  name: (s.name || '').trim(),
  category: s.category?.trim() || null,
  description: s.description || null,
  equipment_id: s.equipmentId || null,
  estimated_minutes: s.estimatedMinutes ?? null,
  trigger_type: s.triggerType || 'calendar',
  calendar_rule: s.triggerType === 'counter' ? (s.calendarRule || null) : (s.calendarRule || { kind: 'daily' }),
  counter_id: s.triggerType === 'calendar' ? null : (s.counterId || null),
  counter_interval: s.triggerType === 'calendar' ? null : (s.counterInterval ?? null),
  lead_time_days: s.leadTimeDays ?? 0,
  criticality: s.criticality || null,
  is_class_item: !!s.isClassItem,
  active: s.active !== false,
});

export const createSchedule = async (schedule, actor) => {
  if (!actor?.tenantId) throw new Error('No active vessel — cannot create a schedule.');
  if (!schedule?.name?.trim()) throw new Error('A schedule needs a name.');

  const { data, error } = await supabase
    .from('upkeep_schedules')
    .insert({ ...scheduleToRow(schedule, actor), created_by: actor.userId || null })
    .select('id')
    .single();
  if (error) throw error;

  if (schedule.steps?.length) await replaceSteps(data.id, schedule.steps, actor);
  return fetchSchedule(data.id);
};

export const updateSchedule = async (scheduleId, schedule, actor) => {
  if (!scheduleId) throw new Error('No schedule to update.');
  const { error } = await supabase
    .from('upkeep_schedules')
    .update(scheduleToRow(schedule, actor))
    .eq('id', scheduleId);
  if (error) throw error;

  if (schedule.steps) await replaceSteps(scheduleId, schedule.steps, actor);
  return fetchSchedule(scheduleId);
};

export const setScheduleActive = async (scheduleId, active) => {
  const { error } = await supabase.from('upkeep_schedules').update({ active }).eq('id', scheduleId);
  if (error) throw error;
};

export const deleteSchedule = async (scheduleId) => {
  const { error } = await supabase.from('upkeep_schedules').delete().eq('id', scheduleId);
  if (error) throw error;
};

// ── steps ────────────────────────────────────────────────────────────────────
// Replace-the-set: the editor owns the whole list, so deleting and re-inserting
// keeps ordering honest. Past sign-offs are unaffected — upkeep_step_results
// carries its own frozen copy of the text (step_id is ON DELETE SET NULL).

export const replaceSteps = async (scheduleId, steps, actor) => {
  if (!scheduleId) return;
  const { error: delErr } = await supabase.from('upkeep_steps').delete().eq('schedule_id', scheduleId);
  if (delErr) throw delErr;

  const rows = (steps || [])
    .filter((s) => (s.text || '').trim())
    .map((s, i) => ({
      tenant_id: actor.tenantId,
      schedule_id: scheduleId,
      position: i,
      text: s.text.trim(),
      step_type: s.stepType || 'check',
      frequency: s.frequency || null,
      unit: s.stepType === 'reading' ? (s.unit || null) : null,
      min_normal: s.stepType === 'reading' && s.minNormal !== '' ? (s.minNormal ?? null) : null,
      max_normal: s.stepType === 'reading' && s.maxNormal !== '' ? (s.maxNormal ?? null) : null,
      counter_id: s.counterId || null,
      equipment_id: s.equipmentId || null,
      inventory_item_id: s.inventoryItemId || null,
      quantity_used: s.quantityUsed ?? null,
      is_mandatory: !!s.isMandatory,
      guidance: s.guidance || null,
    }));

  if (!rows.length) return;
  const { error } = await supabase.from('upkeep_steps').insert(rows);
  if (error) throw error;
};

// ── equipment & counters ─────────────────────────────────────────────────────

export const fetchEquipment = async (tenantId, { includeInactive = false } = {}) => {
  if (!tenantId) return [];
  let q = supabase
    .from('equipment')
    .select('*, equipment_counters(*)')
    .eq('tenant_id', tenantId);
  if (!includeInactive) q = q.eq('active', true);
  const { data, error } = await q.order('name', { ascending: true });
  if (error) throw error;
  return (data || []).map(mapEquipment);
};

export const createEquipment = async (equipment, actor) => {
  if (!actor?.tenantId) throw new Error('No active vessel — cannot add equipment.');
  if (!equipment?.name?.trim()) throw new Error('Equipment needs a name.');
  const { data, error } = await supabase
    .from('equipment')
    .insert({
      tenant_id: actor.tenantId,
      department_id: equipment.departmentId ?? actor.departmentId ?? null,
      parent_id: equipment.parentId || null,
      name: equipment.name.trim(),
      code: equipment.code || null,
      description: equipment.description || null,
      vessel_location_id: equipment.vesselLocationId || null,
      location_label: equipment.locationLabel || null,
      manufacturer: equipment.manufacturer || null,
      model: equipment.model || null,
      serial_number: equipment.serialNumber || null,
      commissioned_on: equipment.commissionedOn || null,
      criticality: equipment.criticality || 'routine',
      is_class_item: !!equipment.isClassItem,
      external_source: equipment.externalSource || null,
      external_ref: equipment.externalRef || null,
      created_by: actor.userId || null,
    })
    .select('*, equipment_counters(*)')
    .single();
  if (error) throw error;
  return mapEquipment(data);
};

export const updateEquipment = async (equipmentId, patch) => {
  const row = {};
  if ('name' in patch) row.name = patch.name?.trim();
  if ('code' in patch) row.code = patch.code || null;
  if ('description' in patch) row.description = patch.description || null;
  if ('vesselLocationId' in patch) row.vessel_location_id = patch.vesselLocationId || null;
  if ('locationLabel' in patch) row.location_label = patch.locationLabel || null;
  if ('manufacturer' in patch) row.manufacturer = patch.manufacturer || null;
  if ('model' in patch) row.model = patch.model || null;
  if ('serialNumber' in patch) row.serial_number = patch.serialNumber || null;
  if ('commissionedOn' in patch) row.commissioned_on = patch.commissionedOn || null;
  if ('criticality' in patch) row.criticality = patch.criticality;
  if ('isClassItem' in patch) row.is_class_item = !!patch.isClassItem;
  if ('externalSource' in patch) row.external_source = patch.externalSource || null;
  if ('externalRef' in patch) row.external_ref = patch.externalRef || null;
  if ('active' in patch) row.active = !!patch.active;
  if (!Object.keys(row).length) return;
  const { error } = await supabase.from('equipment').update(row).eq('id', equipmentId);
  if (error) throw error;
};

export const createCounter = async (equipmentId, counter, actor) => {
  if (!actor?.tenantId) throw new Error('No active vessel.');
  const { data, error } = await supabase
    .from('equipment_counters')
    .insert({
      tenant_id: actor.tenantId,
      equipment_id: equipmentId,
      name: (counter?.name || 'Running hours').trim(),
      unit: counter?.unit || 'h',
      external_ref: counter?.externalRef || null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return mapCounter(data);
};

/**
 * Log a counter reading. `source` is the integration seam: 'manual' today,
 * 'job_step' when captured during a job, an automation system's name once that
 * integration lands — writing to this same table, changing nothing downstream.
 * A trigger keeps equipment_counters.current_value in step.
 */
export const addCounterReading = async (counterId, value, actor, { source = 'manual', jobId = null, note = null, readAt = null } = {}) => {
  if (!actor?.tenantId) throw new Error('No active vessel.');
  if (value == null || value === '' || Number.isNaN(Number(value))) throw new Error('A reading needs a number.');
  const { data, error } = await supabase
    .from('equipment_counter_readings')
    .insert({
      tenant_id: actor.tenantId,
      counter_id: counterId,
      value: Number(value),
      read_at: readAt || new Date().toISOString(),
      source,
      recorded_by: actor.userId || null,
      job_id: jobId,
      note,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
};

export const fetchCounterReadings = async (counterId, { limit = 100 } = {}) => {
  if (!counterId) return [];
  const { data, error } = await supabase
    .from('equipment_counter_readings')
    .select('*')
    .eq('counter_id', counterId)
    .order('read_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
};

// ── occurrences (team_jobs, source='upkeep') ─────────────────────────────────

/**
 * Generate the occurrence for a schedule: one team_jobs row plus a frozen copy
 * of every applicable step. step_text is copied, not referenced, so editing the
 * schedule later can never rewrite what was signed off.
 *
 * Idempotent: returns the existing open occurrence for the same due date rather
 * than creating a second one.
 */
export const generateOccurrence = async (schedule, actor, { dueDate = null, counter = null } = {}) => {
  if (!actor?.tenantId) throw new Error('No active vessel.');
  if (!schedule?.id) throw new Error('No schedule.');

  const due = nextDue(schedule, counter);
  const targetDate = dueDate || due.date || toISODate(new Date());

  const { data: existing, error: exErr } = await supabase
    .from('team_jobs')
    .select('id')
    .eq('tenant_id', actor.tenantId)
    .eq('upkeep_schedule_id', schedule.id)
    .eq('due_date', targetDate)
    .is('completed_at', null)
    .maybeSingle();
  if (exErr) throw exErr;
  if (existing?.id) return existing.id;

  const { data: job, error: jobErr } = await supabase
    .from('team_jobs')
    .insert({
      tenant_id: actor.tenantId,
      department_id: schedule.departmentId ?? actor.departmentId ?? null,
      title: schedule.name,
      description: schedule.description || null,
      status: 'OPEN',
      created_by: actor.userId,
      due_date: targetDate,
      source: 'upkeep',
      upkeep_schedule_id: schedule.id,
      recurrence: schedule.calendarRule?.kind || null,
      due_basis: {
        calendar: due.date,
        counter: due.counterDue,
        triggered_by: due.basis,
      },
    })
    .select('id')
    .single();
  if (jobErr) throw jobErr;

  const applicable = stepsForOccurrence(schedule.steps, new Date(targetDate));
  if (applicable.length) {
    const rows = applicable.map((s, i) => ({
      tenant_id: actor.tenantId,
      job_id: job.id,
      step_id: s.id,
      position: i,
      step_text: s.text,          // FROZEN — the audit answer
      step_type: s.stepType,
      unit: s.unit,
      min_normal: s.minNormal,
      max_normal: s.maxNormal,
      status: 'pending',
      inventory_item_id: s.inventoryItemId,
      quantity_used: s.quantityUsed,
      is_mandatory: s.isMandatory,
      counter_id: s.counterId,
    }));
    const { error: resErr } = await supabase.from('upkeep_step_results').insert(rows);
    if (resErr) throw resErr;
  }

  return job.id;
};

export const fetchStepResults = async (jobId) => {
  if (!jobId) return [];
  const { data, error } = await supabase
    .from('upkeep_step_results')
    .select('*')
    .eq('job_id', jobId)
    .order('position', { ascending: true });
  if (error) throw error;
  return (data || []).map(mapResult);
};

/**
 * Record one step. The reading is range-checked here so out_of_range is stored,
 * not recomputed at read time — a normal range edited later must not silently
 * reclassify a past reading.
 */
export const saveStepResult = async (resultId, patch, actor) => {
  if (!resultId) throw new Error('No step to save.');

  const row = {};
  if ('status' in patch) row.status = patch.status;
  if ('valueText' in patch) row.value_text = patch.valueText || null;
  if ('comment' in patch) row.comment = patch.comment || null;
  if ('photoUrl' in patch) row.photo_url = patch.photoUrl || null;

  if ('valueNumeric' in patch) {
    const v = patch.valueNumeric === '' || patch.valueNumeric == null ? null : Number(patch.valueNumeric);
    row.value_numeric = v;
    row.out_of_range = isOutOfRange(v, patch.minNormal, patch.maxNormal);
  }

  if (patch.status && patch.status !== 'pending') {
    row.completed_by = actor?.userId || null;
    row.completed_by_name = actor?.userName || null;
    row.completed_at = new Date().toISOString();
  } else if (patch.status === 'pending') {
    row.completed_by = null;
    row.completed_by_name = null;
    row.completed_at = null;
  }

  const { data, error } = await supabase
    .from('upkeep_step_results')
    .update(row)
    .eq('id', resultId)
    .select('*')
    .single();
  if (error) throw error;

  // A reading step that captured a counter value feeds the counter log too, so
  // running hours recorded during a job drive the next counter-based due date.
  if (patch.counterId && row.value_numeric != null) {
    await addCounterReading(patch.counterId, row.value_numeric, actor, {
      source: 'job_step',
      jobId: data.job_id,
    });
  }

  return mapResult(data);
};

/**
 * Close out an occurrence: stamp the schedule so the next due date can be
 * calculated from it, and decrement any stock the steps consumed.
 */
export const completeOccurrence = async (jobId, scheduleId, actor, { counter = null } = {}) => {
  if (!scheduleId) return;

  const { error } = await supabase
    .from('upkeep_schedules')
    .update({
      last_completed_at: new Date().toISOString(),
      last_completed_counter: counter?.currentValue ?? null,
    })
    .eq('id', scheduleId);
  if (error) throw error;

  await consumeStepParts(jobId, actor);
};

/**
 * Decrement inventory for every completed step that names a part.
 *
 * inventory_items keeps THREE views of stock and the app writes them together:
 *   quantity / total_qty  — the scalar the item card and provisioning read
 *   stock_locations       — the per-location breakdown (jsonb)
 * There is no DB trigger reconciling them, so both scalars must move here.
 *
 * The breakdown is only touched when the item sits in exactly one location.
 * With several, which one the part came out of is genuinely unknown — guessing
 * would put the breakdown out of step with reality, so the scalars move and the
 * step is reported back as needing a manual stock-location adjustment.
 *
 * Best-effort: a failure must never block a sign-off, so it is reported, not thrown.
 */
export const consumeStepParts = async (jobId, actor) => {
  const results = await fetchStepResults(jobId);
  const consuming = results.filter(
    (r) => r.status === 'done' && r.inventoryItemId && r.quantityUsed > 0,
  );
  const failures = [];
  const needsLocationCheck = [];
  let consumed = 0;

  for (const r of consuming) {
    try {
      const { data: item, error: readErr } = await supabase
        .from('inventory_items')
        .select('id, name, quantity, total_qty, stock_locations')
        .eq('id', r.inventoryItemId)
        .maybeSingle();
      if (readErr || !item) { failures.push(r.stepText); continue; }

      const before = Number(item.total_qty ?? item.quantity ?? 0);
      const used = Number(r.quantityUsed);
      const after = Math.max(0, before - used);

      const patch = { quantity: after, total_qty: after };

      const locs = Array.isArray(item.stock_locations) ? item.stock_locations : [];
      if (locs.length === 1) {
        patch.stock_locations = [
          { ...locs[0], qty: Math.max(0, Number(locs[0]?.qty ?? before) - used) },
        ];
      } else if (locs.length > 1) {
        needsLocationCheck.push({ step: r.stepText, item: item.name });
      }

      const { error: writeErr } = await supabase
        .from('inventory_items')
        .update(patch)
        .eq('id', r.inventoryItemId);
      if (writeErr) { failures.push(r.stepText); continue; }

      consumed += 1;
    } catch {
      failures.push(r.stepText);
    }
  }

  return { consumed, failures, needsLocationCheck };
};

/** Distinct categories in use, for the free-text category picker's suggestions. */
export const fetchCategories = async (tenantId, departmentId = null) => {
  if (!tenantId) return [];
  let q = supabase.from('upkeep_schedules').select('category').eq('tenant_id', tenantId);
  if (departmentId) q = q.eq('department_id', departmentId);
  const { data, error } = await q;
  if (error) return [];
  return [...new Set((data || []).map((r) => r.category).filter(Boolean))].sort();
};
