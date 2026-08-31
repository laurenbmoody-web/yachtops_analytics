// Upkeep data layer — Supabase-backed, tenant-scoped (RLS via tenant_members).
//
// Tables (20260830101926_upkeep_schema.sql):
//   equipment / equipment_counters / equipment_counter_readings
//   upkeep_schedules / upkeep_steps
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
import { nextDue, stepsForOccurrence, toISODate } from './recurrence';

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
// keeps ordering honest. Past sign-offs are unaffected — job_checklist_items
// carries its own frozen copy of the text, so a step deleted here never
// rewrites what an occurrence already recorded.

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

  // The steps that apply to this occurrence become checklist items on the job,
  // in the same table a duty round and a hand-typed card use. Wording is frozen
  // by the copy, so editing the schedule later cannot rewrite what this job was
  // signed off against.
  const applicable = stepsForOccurrence(schedule.steps, new Date(targetDate));
  if (applicable.length) {
    const rows = applicable.map((s, i) => ({
      tenant_id: actor.tenantId,
      job_id: job.id,
      position: i,
      text: s.text,
      item_type: s.stepType || 'check',
      unit: s.unit,
      min_normal: s.minNormal,
      max_normal: s.maxNormal,
      is_mandatory: !!s.isMandatory,
      guidance: s.guidance || null,
      status: 'pending',
      origin_kind: 'upkeep',
      origin_ref: s.id,
      counter_id: s.counterId || null,
    }));
    const { error: itemErr } = await supabase
      .from('job_checklist_items')
      .upsert(rows, { onConflict: 'job_id,origin_kind,origin_ref', ignoreDuplicates: true });
    if (itemErr) throw itemErr;
  }

  // Parts a step consumes become job_links, which is what actually moves stock:
  // it deducts on completion against the movements ledger, takes from the
  // fullest location, and puts it back exactly on reopen. Doing our own
  // decrement as well would move the same stock twice.
  const parts = applicable.filter((s) => s.inventoryItemId && s.quantityUsed > 0);
  if (parts.length) {
    const links = parts.map((s) => ({
      tenant_id: actor.tenantId,
      job_id: job.id,
      kind: 'inventory',
      inventory_item_id: s.inventoryItemId,
      qty: s.quantityUsed,
      purpose: 'uses',
      note: s.text,
      created_by: actor.userId || null,
    }));
    const { error: linkErr } = await supabase
      .from('job_links')
      .upsert(links, { onConflict: 'job_id,inventory_item_id', ignoreDuplicates: true });
    // Non-blocking: a job without its part link is recoverable by hand; a job
    // that failed to exist is not.
    if (linkErr) console.warn('[upkeep] could not link parts for job', job.id, linkErr);
  }

  // The equipment the schedule services, so the job shows up in that asset's
  // history alongside anything else done to it.
  if (schedule.equipmentId) {
    const { error: eqErr } = await supabase
      .from('job_links')
      .upsert([{
        tenant_id: actor.tenantId,
        job_id: job.id,
        kind: 'equipment',
        equipment_id: schedule.equipmentId,
        purpose: 'about',
        created_by: actor.userId || null,
      }], { onConflict: 'job_id,equipment_id', ignoreDuplicates: true });
    if (eqErr) console.warn('[upkeep] could not link equipment for job', job.id, eqErr);
  }

  return job.id;
};

/**
 * Close out an occurrence: stamp the schedule so the next due date can be
 * calculated from it.
 *
 * Stock is NOT touched here. The parts an occurrence uses are job_links rows,
 * and completing the job consumes them through consumeJobLinks — multi-location
 * aware, against the movements ledger, exactly-once, and reversible on reopen.
 * A second decrement from this side would double every part used.
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
