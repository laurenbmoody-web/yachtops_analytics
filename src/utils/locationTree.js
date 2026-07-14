// The vessel's ONE physical-location tree (public.vessel_locations).
//
// Nodes nest to any depth via parent_id — a deck holds zones, a zone holds
// spaces, a space can hold sub-spaces (room > cupboard > shelf > …). The
// `level` column is a freeform display label only; depth comes from the
// parent_id chain (the depth-3 CHECK was lifted in
// 20260712100000_vessel_locations_infinite_depth.sql).
//
// This module is the single source of truth for resolving/reading nodes, shared
// by the vessel map (pins), the inventory location picker, and Location
// Management — so "Galley › Shelf 1" is ONE row everywhere, and stock placed
// against it lines up no matter which surface placed it.
//
// RLS note: vessel_locations INSERT/UPDATE is COMMAND/CHIEF only. Reads are open
// to all tenant members. Callers that can't create nodes (crew) must pass
// `createIfMissing:false` so find-or-create degrades to find-or-null instead of
// throwing an RLS error.
import { supabase } from '../lib/supabaseClient';

// Find-or-create one node by (tenant, name, parent) within the tenant. Returns
// { id } on success, { id: null, missing: true } when not found and creation is
// disabled, or { error } on failure.
export async function findOrCreateNode({ tenantId, userId, parentId, name, level = 'space', createIfMissing = true }) {
  const label = (name || 'Untitled').trim();
  let q = supabase
    .from('vessel_locations')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('name', label)
    .eq('is_archived', false)
    .limit(1);
  q = parentId ? q.eq('parent_id', parentId) : q.is('parent_id', null);
  const { data: found, error: findErr } = await q;
  if (findErr) return { error: findErr.message || 'Could not read locations.' };
  if (found && found.length) return { id: found[0].id };

  if (!createIfMissing) return { id: null, missing: true };

  const { data: made, error: makeErr } = await supabase
    .from('vessel_locations')
    .insert({ tenant_id: tenantId, level, name: label, parent_id: parentId || null, created_by: userId || null })
    .select('id')
    .single();
  if (makeErr) return { error: makeErr.message || 'Could not create the location.' };
  return { id: made.id, created: true };
}

// Direct children of a node (or the tree roots when parentId is null), ordered
// for display. Powers the generic location picker and the manager's nested view.
export async function getChildren(tenantId, parentId = null) {
  if (!tenantId) return { children: [] };
  let q = supabase
    .from('vessel_locations')
    .select('id, name, level, parent_id')
    .eq('tenant_id', tenantId)
    .eq('is_archived', false)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  q = parentId ? q.eq('parent_id', parentId) : q.is('parent_id', null);
  const { data, error } = await q;
  if (error) return { error: error.message || 'Could not load locations.', children: [] };
  return { children: data || [] };
}

// Resolve (creating if needed) the pin's location node. `trail` is the pin's
// container ancestry (outermost first) as { id, label, location_node_id }; `pin`
// is the pin itself. Nodes are cached on each hotspot's location_node_id.
// Returns { nodeId, patched: [{hotspotId, nodeId}] } so the caller can sync page
// state, or { error }.
export async function resolvePinNode({ tenantId, userId, rootSpaceId, rootName, trail = [], pin }) {
  const patched = [];
  let parentId = rootSpaceId || null;
  // If the scan isn't tied to a space, root the tree at a node named for it.
  if (!parentId && rootName) {
    const r = await findOrCreateNode({ tenantId, userId, parentId: null, name: rootName });
    if (r.error) return { error: r.error };
    parentId = r.id;
  }
  // Walk the container chain, caching each node id on its hotspot.
  for (const c of trail) {
    if (c.location_node_id) { parentId = c.location_node_id; continue; }
    const r = await findOrCreateNode({ tenantId, userId, parentId, name: c.label });
    if (r.error) return { error: r.error };
    parentId = r.id;
    patched.push({ hotspotId: c.id, nodeId: r.id });
  }
  // The pin's own node.
  if (pin.location_node_id) return { nodeId: pin.location_node_id, patched };
  const leaf = await findOrCreateNode({ tenantId, userId, parentId, name: pin.label });
  if (leaf.error) return { error: leaf.error };
  patched.push({ hotspotId: pin.id, nodeId: leaf.id });
  // Persist the node ids on the hotspots so we never recreate them.
  for (const p of patched) {
    await supabase.from('scan_hotspots').update({ location_node_id: p.nodeId }).eq('id', p.hotspotId);
  }
  return { nodeId: leaf.id, patched };
}

// Human-readable path of a node ("Main Galley › test › Dry Store › Shelf 1").
export async function getNodePath(nodeId) {
  if (!nodeId) return { path: '' };
  const names = [];
  let cur = nodeId;
  for (let i = 0; i < 12 && cur; i++) {
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await supabase.from('vessel_locations').select('name, parent_id').eq('id', cur).single();
    if (error || !data) break;
    names.unshift(data.name);
    cur = data.parent_id;
  }
  return { path: names.join(' › ') };
}
