// Activity Feed Storage - Supabase-backed Activity Events
// All reads/writes go to Supabase activity_events table
// logActivity is fire-and-forget (non-blocking)

import { supabase } from '../lib/supabaseClient';
import { getCurrentUser, hasCommandAccess, hasChiefAccess, hasHODAccess } from './authStorage';

// Action enums (unchanged - callers depend on these)
export const JobActions = {
  JOB_CREATED: 'JOB_CREATED',
  JOB_SENT_FOR_ACCEPTANCE: 'JOB_SENT_FOR_ACCEPTANCE',
  JOB_ACCEPTED: 'JOB_ACCEPTED',
  JOB_DECLINED: 'JOB_DECLINED',
  JOB_ASSIGNED: 'JOB_ASSIGNED',
  JOB_UNASSIGNED: 'JOB_UNASSIGNED',
  JOB_COMPLETED: 'JOB_COMPLETED',
  JOB_DELETED: 'JOB_DELETED',
  JOB_ARCHIVED_BY_SENDER: 'JOB_ARCHIVED_BY_SENDER',
  JOB_EDITED: 'JOB_EDITED',
  JOB_DUE_DATE_CHANGED: 'JOB_DUE_DATE_CHANGED',
  JOB_PRIORITY_CHANGED: 'JOB_PRIORITY_CHANGED'
};

export const InventoryActions = {
  ITEM_CREATED: 'ITEM_CREATED',
  ITEM_UPDATED: 'ITEM_UPDATED',
  STOCK_ADJUSTED: 'STOCK_ADJUSTED',
  IMPORT_COMPLETED: 'IMPORT_COMPLETED',
  STOCK_RECEIVED: 'STOCK_RECEIVED',
  STOCK_CONSUMED: 'STOCK_CONSUMED',
  STOCK_TRANSFERRED: 'STOCK_TRANSFERRED',
  RESTOCK_LEVEL_CHANGED: 'RESTOCK_LEVEL_CHANGED',
  ITEM_LOCATION_CHANGED: 'ITEM_LOCATION_CHANGED'
};

export const DefectActions = {
  DEFECT_CREATED: 'DEFECT_CREATED',
  DEFECT_ASSIGNED: 'DEFECT_ASSIGNED',
  DEFECT_STATUS_CHANGED: 'DEFECT_STATUS_CHANGED',
  DEFECT_CLOSED: 'DEFECT_CLOSED',
  DEFECT_COMMENT_ADDED: 'DEFECT_COMMENT_ADDED',
  DEFECT_PHOTO_ADDED: 'DEFECT_PHOTO_ADDED',
  DEFECT_EDITED: 'DEFECT_EDITED'
};

/**
 * Resolve actor display name using priority order
 */
export const resolveActorName = (user = null) => {
  const actor = user || getCurrentUser();
  if (!actor) return 'Unknown User';
  return actor?.roleTitle || actor?.fullName || actor?.name || 'Unknown User';
};

/**
 * Get the active tenant ID from localStorage
 */
const getActiveTenantId = () => {
  return localStorage.getItem('cargo_active_tenant_id') || null;
};

/**
 * Log a new activity event to Supabase (fire-and-forget, non-blocking)
 * Signature is identical to the old localStorage version.
 */
export const logActivity = (eventData) => {
  // Fire-and-forget: do not await, do not throw
  (async () => {
    try {
      const currentUser = getCurrentUser();
      const tenantId = getActiveTenantId();
      if (!tenantId) return; // No tenant context, skip silently

      // Use Supabase auth.uid() as actor_user_id so RLS INSERT policy passes
      let supabaseUserId = eventData?.actorUserId || null;
      try {
        const { data: { session } } = await supabase?.auth?.getSession();
        if (session?.user?.id) {
          supabaseUserId = session?.user?.id;
        }
      } catch (_) {
        // fallback to provided actorUserId
      }

      const row = {
        tenant_id: tenantId,
        actor_user_id: supabaseUserId,
        actor_name: eventData?.actorName || currentUser?.name || currentUser?.fullName || 'Unknown User',
        actor_department: eventData?.actorDepartment || currentUser?.department || null,
        actor_role_tier: eventData?.actorRoleTier || currentUser?.tier || null,
        department_scope: eventData?.departmentScope || null,
        module: eventData?.module || 'unknown',
        action: eventData?.action || 'UNKNOWN',
        entity_type: eventData?.entityType || null,
        entity_id: eventData?.entityId ? String(eventData?.entityId) : null,
        summary: eventData?.summary || '',
        meta: eventData?.meta || {}
      };

      const { error } = await supabase?.from('activity_events')?.insert(row);
      if (error) {
        console.warn('[activityStorage] logActivity insert error:', error?.message, error?.code);
      }
    } catch (err) {
      // Non-blocking: swallow all errors
      console.warn('[activityStorage] logActivity error (non-blocking):', err?.message);
    }
  })();
};

/**
 * Fetch activity events from Supabase with role-based visibility.
 * Returns a Promise<Array> — callers must await.
 * Filters: { module, departmentScope, timeFrom, timeTo }
 */
export const getActivityEvents = async (user = null, filters = {}) => {
  try {
    const currentUser = user || getCurrentUser();
    const tenantId = getActiveTenantId();
    if (!currentUser || !tenantId) return [];

    let query = supabase?.from('activity_events')?.select('*')?.eq('tenant_id', tenantId)?.order('created_at', { ascending: false })?.limit(500);

    // Role-based visibility
    if (hasCommandAccess(currentUser)) {
      // Command sees all; optionally filter by department
      if (filters?.departmentScope && filters?.departmentScope !== 'ALL') {
        query = query?.ilike('department_scope', filters?.departmentScope);
      }
    } else if (hasChiefAccess(currentUser) || hasHODAccess(currentUser)) {
      // Chief/HOD: own department only
      const dept = currentUser?.department;
      if (dept) {
        query = query?.ilike('department_scope', dept);
      }
    } else {
      // Crew: own activity only
      if (currentUser?.id) {
        query = query?.eq('actor_user_id', currentUser?.id);
      } else {
        return [];
      }
    }

    // Module filter
    if (filters?.module) {
      query = query?.eq('module', filters?.module?.toLowerCase());
    }

    // Time range filter
    if (filters?.timeFrom) {
      query = query?.gte('created_at', filters?.timeFrom);
    }
    if (filters?.timeTo) {
      query = query?.lte('created_at', filters?.timeTo);
    }

    const { data, error } = await query;
    if (error) {
      console.error('[activityStorage] getActivityEvents error:', error?.message);
      return [];
    }

    // Map snake_case DB columns to camelCase for UI compatibility
    return (data || [])?.map(row => ({
      id: row?.id,
      createdAt: row?.created_at,
      actorUserId: row?.actor_user_id,
      actorName: row?.actor_name,
      actorDepartment: row?.actor_department,
      actorRoleTier: row?.actor_role_tier,
      departmentScope: row?.department_scope,
      module: row?.module,
      action: row?.action,
      entityType: row?.entity_type,
      entityId: row?.entity_id,
      summary: row?.summary,
      meta: row?.meta || {}
    }));
  } catch (err) {
    console.error('[activityStorage] getActivityEvents exception:', err?.message);
    return [];
  }
};

/**
 * Get activity events for the last 24 hours with optional deduplication.
 * Returns a Promise<Array>.
 */
export const getActivityLast24Hours = async (user = null, filters = {}, dedupe = true) => {
  const now = new Date();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  let events = await getActivityEvents(user, {
    ...filters,
    timeFrom: twentyFourHoursAgo?.toISOString(),
    timeTo: now?.toISOString()
  });

  if (dedupe) {
    const seen = new Map();
    const deduped = [];
    for (const event of events) {
      const key = `${event?.entityType}:${event?.entityId}`;
      if (!seen?.has(key)) {
        seen?.set(key, true);
        deduped?.push(event);
      }
    }
    return deduped;
  }

  return events;
};

/**
 * Get recent activity for dashboard widget (today only, deduped).
 * Returns a Promise<Array>.
 */
export const getRecentActivityDedupedToday = async (limit = 7, user = null) => {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  let events = await getActivityEvents(user, {
    timeFrom: sevenDaysAgo?.toISOString(),
    timeTo: now?.toISOString()
  });

  // Deduplicate by entityType + entityId
  const seen = new Map();
  const deduped = [];
  for (const event of events) {
    const key = `${event?.entityType}:${event?.entityId}`;
    if (!seen?.has(key)) {
      seen?.set(key, true);
      deduped?.push(event);
    }
  }

  return deduped?.slice(0, limit);
};

/**
 * Get recent activity (for dashboard widget, no dedup, no today filter).
 * Returns a Promise<Array>.
 */
export const getRecentActivity = async (limit = 5, user = null) => {
  const events = await getActivityEvents(user);
  return events?.slice(0, limit);
};

/**
 * Resolve user display name with fallback chain.
 */
export const resolveUserDisplayName = (actorUserId, actorDisplayName) => {
  const currentUser = getCurrentUser();
  if (actorUserId === currentUser?.id) {
    return resolveActorName(currentUser);
  }
  return actorDisplayName || 'Unknown User';
};

/**
 * Get all activity events for a specific entity (for ActivityHistoryModal).
 * Returns a Promise<Array> sorted newest-first.
 */
export const getActivityForEntity = async (entityType, entityId, user = null) => {
  try {
    const currentUser = user || getCurrentUser();
    const tenantId = getActiveTenantId();
    if (!currentUser || !tenantId || !entityType || !entityId) return [];

    const { data, error } = await supabase?.from('activity_events')?.select('*')?.eq('tenant_id', tenantId)?.eq('entity_type', entityType)?.eq('entity_id', String(entityId))?.order('created_at', { ascending: false })?.limit(200);

    if (error) {
      console.error('[activityStorage] getActivityForEntity error:', error?.message);
      return [];
    }

    return (data || [])?.map(row => ({
      id: row?.id,
      createdAt: row?.created_at,
      actorUserId: row?.actor_user_id,
      actorName: row?.actor_name,
      actorDepartment: row?.actor_department,
      actorRoleTier: row?.actor_role_tier,
      departmentScope: row?.department_scope,
      module: row?.module,
      action: row?.action,
      entityType: row?.entity_type,
      entityId: row?.entity_id,
      summary: row?.summary,
      meta: row?.meta || {}
    }));
  } catch (err) {
    console.error('[activityStorage] getActivityForEntity exception:', err?.message);
    return [];
  }
};

/**
 * Clear all activity events (no-op in Supabase mode — data lives in DB)
 */
export const clearAllActivity = () => {
  console.warn('[activityStorage] clearAllActivity is a no-op in Supabase mode.');
};

/**
 * createActivityEvent — kept for backward compat but not used internally
 */
export const createActivityEvent = (eventData) => {
  const currentUser = getCurrentUser();
  return {
    id: crypto.randomUUID(),
    createdAt: new Date()?.toISOString(),
    actorUserId: eventData?.actorUserId || currentUser?.id,
    actorName: eventData?.actorName || currentUser?.name || 'Unknown User',
    actorDepartment: eventData?.actorDepartment || currentUser?.department || 'UNKNOWN',
    actorRoleTier: eventData?.actorRoleTier || currentUser?.tier || 'CREW',
    departmentScope: eventData?.departmentScope,
    module: eventData?.module,
    action: eventData?.action,
    entityType: eventData?.entityType,
    entityId: eventData?.entityId,
    summary: eventData?.summary,
    meta: eventData?.meta || {}
  };
};