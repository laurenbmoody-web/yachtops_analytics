// Locations Hierarchy Storage - Deck → Zone → Space Management
// Backed by Supabase: public.vessel_locations table

import { supabase } from '../../../lib/supabaseClient';
import { logAudit, EntityType, AuditAction } from '../../../utils/auditLogger';

// ============================================
// HELPERS
// ============================================

const getTenantId = async () => {
  try {
    const { data, error } = await supabase?.rpc('get_my_context');
    if (error || !data?.[0]?.tenant_id) return null;
    return data?.[0]?.tenant_id;
  } catch {
    return null;
  }
};

// ============================================
// DECK OPERATIONS
// ============================================

export const getAllDecks = async (includeArchived = false) => {
  try {
    const tenantId = await getTenantId();
    if (!tenantId) return [];

    let query = supabase?.from('vessel_locations')?.select('*')?.eq('tenant_id', tenantId)?.eq('level', 'deck')?.is('parent_id', null)?.order('sort_order', { ascending: true })?.order('name', { ascending: true });

    if (!includeArchived) {
      query = query?.eq('is_archived', false);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data || [])?.map(row => ({
      id: row?.id,
      name: row?.name,
      sortOrder: row?.sort_order,
      isArchived: row?.is_archived,
      createdAt: row?.created_at,
      updatedAt: row?.updated_at,
    }));
  } catch (error) {
    console.error('Error loading decks:', error);
    return [];
  }
};

export const getDeckById = async (deckId) => {
  try {
    const { data, error } = await supabase?.from('vessel_locations')?.select('*')?.eq('id', deckId)?.single();
    if (error) return null;
    return { id: data?.id, name: data?.name, sortOrder: data?.sort_order, isArchived: data?.is_archived };
  } catch {
    return null;
  }
};

export const createDeck = async (name) => {
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error('No tenant context');

  const { data: session } = await supabase?.auth?.getSession();
  const userId = session?.session?.user?.id;

  const { data, error } = await supabase?.from('vessel_locations')?.insert({
      tenant_id: tenantId,
      level: 'deck',
      name: name?.trim(),
      parent_id: null,
      sort_order: 0,
      is_archived: false,
      created_by: userId || null,
    })?.select()?.single();

  if (error) throw error;

  logAudit({
    entityType: EntityType?.LOCATION,
    entityId: data?.id,
    entityName: `Deck: ${data?.name}`,
    action: AuditAction?.CREATED,
    changes: [],
  });

  return { id: data?.id, name: data?.name, sortOrder: data?.sort_order, isArchived: data?.is_archived, createdAt: data?.created_at, updatedAt: data?.updated_at };
};

export const updateDeck = async (deckId, name) => {
  const { data, error } = await supabase?.from('vessel_locations')?.update({ name: name?.trim(), updated_at: new Date()?.toISOString() })?.eq('id', deckId)?.select()?.single();

  if (error) throw error;

  logAudit({
    entityType: EntityType?.LOCATION,
    entityId: deckId,
    entityName: `Deck: ${name?.trim()}`,
    action: AuditAction?.UPDATED,
    changes: [{ field: 'name', after: name?.trim() }],
  });

  return { id: data?.id, name: data?.name, sortOrder: data?.sort_order, isArchived: data?.is_archived };
};

export const archiveDeck = async (deckId) => {
  const { data, error } = await supabase?.from('vessel_locations')?.update({ is_archived: true, updated_at: new Date()?.toISOString() })?.eq('id', deckId)?.select()?.single();

  if (error) throw error;

  logAudit({
    entityType: EntityType?.LOCATION,
    entityId: deckId,
    entityName: `Deck: ${data?.name}`,
    action: AuditAction?.ARCHIVED,
    changes: [],
  });

  return { id: data?.id, name: data?.name, isArchived: data?.is_archived };
};

export const unarchiveDeck = async (deckId) => {
  const { data, error } = await supabase?.from('vessel_locations')?.update({ is_archived: false, updated_at: new Date()?.toISOString() })?.eq('id', deckId)?.select()?.single();

  if (error) throw error;

  logAudit({
    entityType: EntityType?.LOCATION,
    entityId: deckId,
    entityName: `Deck: ${data?.name}`,
    action: AuditAction?.UNARCHIVED,
    changes: [],
  });

  return { id: data?.id, name: data?.name, isArchived: data?.is_archived };
};

// ============================================
// ZONE OPERATIONS
// ============================================

export const getAllZones = async (includeArchived = false) => {
  try {
    const tenantId = await getTenantId();
    if (!tenantId) return [];

    let query = supabase?.from('vessel_locations')?.select('*')?.eq('tenant_id', tenantId)?.eq('level', 'zone')?.order('sort_order', { ascending: true })?.order('name', { ascending: true });

    if (!includeArchived) {
      query = query?.eq('is_archived', false);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data || [])?.map(row => ({
      id: row?.id,
      deckId: row?.parent_id,
      name: row?.name,
      sortOrder: row?.sort_order,
      isArchived: row?.is_archived,
      createdAt: row?.created_at,
      updatedAt: row?.updated_at,
    }));
  } catch (error) {
    console.error('Error loading zones:', error);
    return [];
  }
};

export const getZonesByDeck = async (deckId, includeArchived = false) => {
  try {
    const tenantId = await getTenantId();
    if (!tenantId) return [];

    let query = supabase?.from('vessel_locations')?.select('*')?.eq('tenant_id', tenantId)?.eq('level', 'zone')?.eq('parent_id', deckId)?.order('sort_order', { ascending: true })?.order('name', { ascending: true });

    if (!includeArchived) {
      query = query?.eq('is_archived', false);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data || [])?.map(row => ({
      id: row?.id,
      deckId: row?.parent_id,
      name: row?.name,
      sortOrder: row?.sort_order,
      isArchived: row?.is_archived,
      createdAt: row?.created_at,
      updatedAt: row?.updated_at,
    }));
  } catch (error) {
    console.error('Error loading zones:', error);
    return [];
  }
};

export const getZoneById = async (zoneId) => {
  try {
    const { data, error } = await supabase?.from('vessel_locations')?.select('*')?.eq('id', zoneId)?.single();
    if (error) return null;
    return { id: data?.id, deckId: data?.parent_id, name: data?.name, sortOrder: data?.sort_order, isArchived: data?.is_archived };
  } catch {
    return null;
  }
};

export const createZone = async (deckId, name) => {
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error('No tenant context');

  const { data: session } = await supabase?.auth?.getSession();
  const userId = session?.session?.user?.id;

  const { data, error } = await supabase?.from('vessel_locations')?.insert({
      tenant_id: tenantId,
      level: 'zone',
      name: name?.trim(),
      parent_id: deckId,
      sort_order: 0,
      is_archived: false,
      created_by: userId || null,
    })?.select()?.single();

  if (error) throw error;

  logAudit({
    entityType: EntityType?.LOCATION,
    entityId: data?.id,
    entityName: `Zone: ${data?.name}`,
    action: AuditAction?.CREATED,
    changes: [],
  });

  return { id: data?.id, deckId: data?.parent_id, name: data?.name, sortOrder: data?.sort_order, isArchived: data?.is_archived, createdAt: data?.created_at, updatedAt: data?.updated_at };
};

export const updateZone = async (zoneId, name) => {
  const { data, error } = await supabase?.from('vessel_locations')?.update({ name: name?.trim(), updated_at: new Date()?.toISOString() })?.eq('id', zoneId)?.select()?.single();

  if (error) throw error;

  logAudit({
    entityType: EntityType?.LOCATION,
    entityId: zoneId,
    entityName: `Zone: ${name?.trim()}`,
    action: AuditAction?.UPDATED,
    changes: [{ field: 'name', after: name?.trim() }],
  });

  return { id: data?.id, deckId: data?.parent_id, name: data?.name, sortOrder: data?.sort_order, isArchived: data?.is_archived };
};

export const archiveZone = async (zoneId) => {
  const { data, error } = await supabase?.from('vessel_locations')?.update({ is_archived: true, updated_at: new Date()?.toISOString() })?.eq('id', zoneId)?.select()?.single();

  if (error) throw error;

  logAudit({
    entityType: EntityType?.LOCATION,
    entityId: zoneId,
    entityName: `Zone: ${data?.name}`,
    action: AuditAction?.ARCHIVED,
    changes: [],
  });

  return { id: data?.id, name: data?.name, isArchived: data?.is_archived };
};

export const unarchiveZone = async (zoneId) => {
  const { data, error } = await supabase?.from('vessel_locations')?.update({ is_archived: false, updated_at: new Date()?.toISOString() })?.eq('id', zoneId)?.select()?.single();

  if (error) throw error;

  logAudit({
    entityType: EntityType?.LOCATION,
    entityId: zoneId,
    entityName: `Zone: ${data?.name}`,
    action: AuditAction?.UNARCHIVED,
    changes: [],
  });

  return { id: data?.id, name: data?.name, isArchived: data?.is_archived };
};

// ============================================
// SPACE OPERATIONS
// ============================================

export const getAllSpaces = async (includeArchived = false) => {
  try {
    const tenantId = await getTenantId();
    if (!tenantId) return [];

    let query = supabase?.from('vessel_locations')?.select('*')?.eq('tenant_id', tenantId)?.eq('level', 'space')?.order('sort_order', { ascending: true })?.order('name', { ascending: true });

    if (!includeArchived) {
      query = query?.eq('is_archived', false);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data || [])?.map(row => ({
      id: row?.id,
      zoneId: row?.parent_id,
      name: row?.name,
      sortOrder: row?.sort_order,
      isArchived: row?.is_archived,
      createdAt: row?.created_at,
      updatedAt: row?.updated_at,
    }));
  } catch (error) {
    console.error('Error loading spaces:', error);
    return [];
  }
};

export const getSpacesByZone = async (zoneId, includeArchived = false) => {
  try {
    const tenantId = await getTenantId();
    if (!tenantId) return [];

    let query = supabase?.from('vessel_locations')?.select('*')?.eq('tenant_id', tenantId)?.eq('level', 'space')?.eq('parent_id', zoneId)?.order('sort_order', { ascending: true })?.order('name', { ascending: true });

    if (!includeArchived) {
      query = query?.eq('is_archived', false);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data || [])?.map(row => ({
      id: row?.id,
      zoneId: row?.parent_id,
      name: row?.name,
      sortOrder: row?.sort_order,
      isArchived: row?.is_archived,
      createdAt: row?.created_at,
      updatedAt: row?.updated_at,
    }));
  } catch (error) {
    console.error('Error loading spaces:', error);
    return [];
  }
};

export const getSpaceById = async (spaceId) => {
  try {
    const { data, error } = await supabase?.from('vessel_locations')?.select('*')?.eq('id', spaceId)?.single();
    if (error) return null;
    return { id: data?.id, zoneId: data?.parent_id, name: data?.name, sortOrder: data?.sort_order, isArchived: data?.is_archived };
  } catch {
    return null;
  }
};

export const createSpace = async (zoneId, name) => {
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error('No tenant context');

  const { data: session } = await supabase?.auth?.getSession();
  const userId = session?.session?.user?.id;

  const { data, error } = await supabase?.from('vessel_locations')?.insert({
      tenant_id: tenantId,
      level: 'space',
      name: name?.trim(),
      parent_id: zoneId,
      sort_order: 0,
      is_archived: false,
      created_by: userId || null,
    })?.select()?.single();

  if (error) throw error;

  logAudit({
    entityType: EntityType?.LOCATION,
    entityId: data?.id,
    entityName: `Space: ${data?.name}`,
    action: AuditAction?.CREATED,
    changes: [],
  });

  return { id: data?.id, zoneId: data?.parent_id, name: data?.name, sortOrder: data?.sort_order, isArchived: data?.is_archived, createdAt: data?.created_at, updatedAt: data?.updated_at };
};

export const updateSpace = async (spaceId, name) => {
  const { data, error } = await supabase?.from('vessel_locations')?.update({ name: name?.trim(), updated_at: new Date()?.toISOString() })?.eq('id', spaceId)?.select()?.single();

  if (error) throw error;

  logAudit({
    entityType: EntityType?.LOCATION,
    entityId: spaceId,
    entityName: `Space: ${name?.trim()}`,
    action: AuditAction?.UPDATED,
    changes: [{ field: 'name', after: name?.trim() }],
  });

  return { id: data?.id, zoneId: data?.parent_id, name: data?.name, sortOrder: data?.sort_order, isArchived: data?.is_archived };
};

export const archiveSpace = async (spaceId) => {
  const { data, error } = await supabase?.from('vessel_locations')?.update({ is_archived: true, updated_at: new Date()?.toISOString() })?.eq('id', spaceId)?.select()?.single();

  if (error) throw error;

  logAudit({
    entityType: EntityType?.LOCATION,
    entityId: spaceId,
    entityName: `Space: ${data?.name}`,
    action: AuditAction?.ARCHIVED,
    changes: [],
  });

  return { id: data?.id, name: data?.name, isArchived: data?.is_archived };
};

export const unarchiveSpace = async (spaceId) => {
  const { data, error } = await supabase?.from('vessel_locations')?.update({ is_archived: false, updated_at: new Date()?.toISOString() })?.eq('id', spaceId)?.select()?.single();

  if (error) throw error;

  logAudit({
    entityType: EntityType?.LOCATION,
    entityId: spaceId,
    entityName: `Space: ${data?.name}`,
    action: AuditAction?.UNARCHIVED,
    changes: [],
  });

  return { id: data?.id, name: data?.name, isArchived: data?.is_archived };
};

// ============================================
// REORDER OPERATIONS
// ============================================

/**
 * Persist a new sort order for a list of location IDs.
 * Each item in orderedIds gets sort_order = its index (0-based).
 */
export const reorderLocations = async (orderedIds) => {
  if (!orderedIds || orderedIds?.length === 0) return;

  const updates = orderedIds?.map((id, index) =>
    supabase
      ?.from('vessel_locations')
      ?.update({ sort_order: index, updated_at: new Date()?.toISOString() })
      ?.eq('id', id)
  );

  await Promise.all(updates);
};