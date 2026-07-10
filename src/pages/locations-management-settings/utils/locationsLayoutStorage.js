// Deck-plan layout — read/write layer for the General Arrangement backdrop and
// the deck frames / room positions placed on it. The GA image lives in the
// vessel-scans bucket under <tenant>/layout/; deck crops and room positions are
// stored on vessel_locations (plan_crop / plan_x / plan_y).
import { supabase } from '../../../lib/supabaseClient';

const getTenantId = async () => {
  try {
    const { data, error } = await supabase?.rpc('get_my_context');
    if (error || !data?.[0]?.tenant_id) return null;
    return data[0].tenant_id;
  } catch {
    return null;
  }
};

const signGa = async (path) => {
  if (!path) return null;
  const { data, error } = await supabase.storage.from('vessel-scans').createSignedUrl(path, 3600);
  if (error) { console.error('[layout] ga sign error:', error); return null; }
  return data?.signedUrl || null;
};

// The vessel's GA image (or null if not uploaded yet), with a signed URL.
export const getVesselLayout = async () => {
  const tenantId = await getTenantId();
  if (!tenantId) return { tenantId: null, gaImagePath: null, gaImageUrl: null };
  const { data, error } = await supabase
    .from('vessel_layout').select('ga_image_path').eq('tenant_id', tenantId).maybeSingle();
  if (error) { console.error('[layout] fetch error:', error); return { tenantId, gaImagePath: null, gaImageUrl: null }; }
  const path = data?.ga_image_path || null;
  return { tenantId, gaImagePath: path, gaImageUrl: await signGa(path) };
};

// Upload (or replace) the GA image. Old object is removed only after the row
// repoints, mirroring the scan replace discipline.
export const uploadGaImage = async (file) => {
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error('No vessel context.');
  const ext = (file.name?.split('.').pop() || 'png').toLowerCase();
  const path = `${tenantId}/layout/ga-${crypto.randomUUID().slice(0, 8)}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from('vessel-scans').upload(path, file, { contentType: file.type || 'image/png', cacheControl: '3600' });
  if (upErr) throw upErr;

  const { data: existing } = await supabase
    .from('vessel_layout').select('ga_image_path').eq('tenant_id', tenantId).maybeSingle();

  const { error: rowErr } = await supabase.from('vessel_layout')
    .upsert({ tenant_id: tenantId, ga_image_path: path, updated_at: new Date().toISOString() });
  if (rowErr) { await supabase.storage.from('vessel-scans').remove([path]).catch(() => {}); throw rowErr; }

  if (existing?.ga_image_path && existing.ga_image_path !== path) {
    await supabase.storage.from('vessel-scans').remove([existing.ga_image_path]).catch(() => {});
  }
  return { gaImagePath: path, gaImageUrl: await signGa(path) };
};

// Deck frame on the GA image — {x,y,w,h} in 0..1, or null to clear.
export const setDeckCrop = async (deckId, crop) => {
  const { error } = await supabase.from('vessel_locations').update({ plan_crop: crop }).eq('id', deckId);
  if (error) throw error;
};

// Room position within its deck crop — 0..1, or nulls to send back to the tray.
export const setSpacePosition = async (spaceId, x, y) => {
  const { error } = await supabase.from('vessel_locations')
    .update({ plan_x: x, plan_y: y }).eq('id', spaceId);
  if (error) throw error;
};

// Doorway links between rooms (undirected). Stored canonically a < b.
const orderPair = (a, b) => (a < b ? [a, b] : [b, a]);

export const getSpaceLinks = async () => {
  const tenantId = await getTenantId();
  if (!tenantId) return [];
  const { data, error } = await supabase
    .from('vessel_space_links').select('id, a_space_id, b_space_id').eq('tenant_id', tenantId);
  if (error) { console.error('[layout] links fetch error:', error); return []; }
  return (data || []).map((r) => ({ id: r.id, a: r.a_space_id, b: r.b_space_id }));
};

// Create a doorway between two rooms; returns the row (new or already-existing).
export const addSpaceLink = async (spaceId1, spaceId2) => {
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error('No vessel context.');
  const [a, b] = orderPair(spaceId1, spaceId2);
  const { data, error } = await supabase
    .from('vessel_space_links')
    .upsert({ tenant_id: tenantId, a_space_id: a, b_space_id: b }, { onConflict: 'a_space_id,b_space_id' })
    .select('id, a_space_id, b_space_id')
    .single();
  if (error) throw error;
  return { id: data.id, a: data.a_space_id, b: data.b_space_id };
};

export const removeSpaceLink = async (linkId) => {
  const { error } = await supabase.from('vessel_space_links').delete().eq('id', linkId);
  if (error) throw error;
};
