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

// Room outline traced on its deck plan — { closed, nodes:[{x,y,h1?,h2?}] } in
// 0..1 deck-crop space, or null to clear the shape (keeping the point).
export const setSpaceShape = async (spaceId, shape) => {
  const { error } = await supabase.from('vessel_locations')
    .update({ plan_shape: shape }).eq('id', spaceId);
  if (error) throw error;
};

// Room's plan zoning category (guest/crew/technical/…), or null to fall back to
// the name-based default. Drives the colour the room is drawn in on the plan.
export const setSpaceCategory = async (spaceId, category) => {
  const { error } = await supabase.from('vessel_locations')
    .update({ plan_category: category }).eq('id', spaceId);
  if (error) throw error;
};

// AI room detection — hand one framed deck image (base64 JPEG of the deck crop)
// to the deck-plan-autotrace edge function, which reads it with Claude vision
// and returns the rooms it can identify, each with a name and a rough polygon
// (normalized 0..1 to the image). Nothing is written; the client matches names
// and lands the outlines as editable proposals.
export const autotraceDeck = async ({ imageBase64, deckName, roomNames }) => {
  const { data, error } = await supabase.functions.invoke('deck-plan-autotrace', {
    body: { imageBase64, mediaType: 'image/jpeg', deckName, roomNames },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return Array.isArray(data?.rooms) ? data.rooms : [];
};

// SAM (Segment Anything 2) point-prompted segmentation — hand one deck image and
// a single point (pixels) to the deck-plan-sam edge function; get back a mask
// (base64 PNG) of the room at that point. The client traces the mask boundary.
export const samSegment = async ({ imageBase64, x, y }) => {
  const { data, error } = await supabase.functions.invoke('deck-plan-sam', {
    body: { imageBase64, x, y, mediaType: 'image/jpeg' },
  });
  if (error) {
    // supabase-js hides the response body on a non-2xx — dig out the function's
    // {error, detail} (which carries fal's actual message) so it surfaces.
    let msg = error.message;
    try { const b = await error.context?.json?.(); if (b?.detail || b?.error) msg = b.detail || b.error; } catch { /* keep msg */ }
    throw new Error(msg || 'segmentation failed');
  }
  if (data?.error) throw new Error(data.detail || data.error);
  if (!data?.maskUrl) throw new Error('No mask returned.');
  return data; // { maskUrl, width, height }
};

// Doorway links between rooms (undirected). Stored canonically a < b.
const orderPair = (a, b) => (a < b ? [a, b] : [b, a]);

export const getSpaceLinks = async () => {
  const tenantId = await getTenantId();
  if (!tenantId) return [];
  let { data, error } = await supabase
    .from('vessel_space_links').select('id, a_space_id, b_space_id, link_kind').eq('tenant_id', tenantId);
  // Resilient to the link_kind column not being live yet (migration pending):
  // fall back to the base columns and treat every link as a doorway.
  if (error?.code === '42703') {
    ({ data, error } = await supabase
      .from('vessel_space_links').select('id, a_space_id, b_space_id').eq('tenant_id', tenantId));
  }
  if (error) { console.error('[layout] links fetch error:', error); return []; }
  return (data || []).map((r) => ({ id: r.id, a: r.a_space_id, b: r.b_space_id, kind: r.link_kind || 'door' }));
};

// Create a link between two rooms; returns the row (new or already-existing).
// kind: 'door' (same deck) or 'stairs' (across decks). The pair is stored
// canonically, so re-linking an existing pair just updates its kind.
export const addSpaceLink = async (spaceId1, spaceId2, kind = 'door') => {
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error('No vessel context.');
  const [a, b] = orderPair(spaceId1, spaceId2);
  const payload = { tenant_id: tenantId, a_space_id: a, b_space_id: b, link_kind: kind };
  let { data, error } = await supabase
    .from('vessel_space_links')
    .upsert(payload, { onConflict: 'a_space_id,b_space_id' })
    .select('id, a_space_id, b_space_id, link_kind')
    .single();
  // Column not live yet — insert the doorway without the discriminator.
  if (error?.code === '42703') {
    delete payload.link_kind;
    ({ data, error } = await supabase
      .from('vessel_space_links')
      .upsert(payload, { onConflict: 'a_space_id,b_space_id' })
      .select('id, a_space_id, b_space_id')
      .single());
  }
  if (error) throw error;
  return { id: data.id, a: data.a_space_id, b: data.b_space_id, kind: data.link_kind || 'door' };
};

export const removeSpaceLink = async (linkId) => {
  const { error } = await supabase.from('vessel_space_links').delete().eq('id', linkId);
  if (error) throw error;
};
