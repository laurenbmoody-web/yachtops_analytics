import { supabase } from '../../../lib/supabaseClient';

// The kit register — company property issued to a crew member, who signs to
// acknowledge receipt and responsibility. See 20260626120000_crew_issued_kit.sql.

const BUCKET = 'kit-signatures';
const ONE_YEAR = 60 * 60 * 24 * 365;

export const KIT_CATEGORIES = [
  { id: 'uniform', label: 'Uniform' },
  { id: 'ppe', label: 'PPE' },
  { id: 'electronics', label: 'Electronics' },
  { id: 'equipment', label: 'Equipment' },
  { id: 'keys', label: 'Keys & access' },
  { id: 'other', label: 'Other' },
];

export const kitCategoryLabel = (id) =>
  KIT_CATEGORIES.find((c) => c.id === id)?.label || 'Other';

export const CONDITIONS = ['New', 'Good', 'Used'];

// dd/mm/yyyy, matching the editorial design system.
export const fmtKitDate = (d) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
};

export const fetchCrewKit = async (userId) => {
  if (!userId) return [];
  const { data, error } = await supabase
    ?.from('crew_issued_kit')
    ?.select('*')
    ?.eq('user_id', userId)
    ?.order('issued_date', { ascending: false, nullsFirst: false })
    ?.order('created_at', { ascending: false });
  if (error) {
    console.error('[kit] fetch failed', error);
    throw error;
  }
  return data || [];
};

export const saveKitItem = async (item) => {
  const payload = {
    user_id: item.userId,
    tenant_id: item.tenantId || null,
    category: item.category || 'other',
    item: item.item,
    size: item.size || null,
    quantity: Number(item.quantity) || 1,
    serial: item.serial || null,
    condition_issued: item.conditionIssued || null,
    issued_date: item.issuedDate || null,
    issued_by: item.issuedBy || null,
    issued_by_name: item.issuedByName || null,
    value: item.value ?? null,
    notes: item.notes || null,
    updated_at: new Date().toISOString(),
  };
  let res;
  if (item.id) {
    res = await supabase?.from('crew_issued_kit')?.update(payload)?.eq('id', item.id)?.select()?.single();
  } else {
    payload.created_by = item.createdBy || null;
    res = await supabase?.from('crew_issued_kit')?.insert(payload)?.select()?.single();
  }
  if (res?.error) throw res.error;
  return res?.data;
};

export const deleteKitItem = async (id) => {
  const { error } = await supabase?.from('crew_issued_kit')?.delete()?.eq('id', id);
  if (error) throw error;
};

// Upload a drawn signature PNG (data URL) to kit-signatures/{userId}/... and
// return the stored object path (re-signed on display, never baked in). `kind`
// distinguishes a crew acknowledgement from a captain's return sign-off.
export const uploadKitSignature = async (userId, dataUrl, kind = 'ack') => {
  const blob = await (await fetch(dataUrl)).blob();
  const path = `${userId}/${Date.now()}-kit-${kind}.png`;
  const { error } = await supabase?.storage?.from(BUCKET)?.upload(path, blob, {
    cacheControl: '3600', upsert: false, contentType: 'image/png',
  });
  if (error) throw error;
  return path;
};

// Fetch a stored signature as a PNG data URL (for embedding in the receipt PDF).
export const kitSignatureDataUrl = async (path) => {
  const url = await signedKitSignatureUrl(path);
  if (!url) return null;
  try {
    const blob = await (await fetch(url)).blob();
    return await new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(blob);
    });
  } catch { return null; }
};

export const signedKitSignatureUrl = async (path) => {
  if (!path) return null;
  const { data, error } = await supabase?.storage?.from(BUCKET)?.createSignedUrl(path, ONE_YEAR);
  if (error) { console.error('[kit] sign url failed', error); return null; }
  return data?.signedUrl || null;
};

/**
 * Crew member acknowledges receipt of a batch of items with one signature —
 * mirrors signing the bottom of the paper kit sheet. Stamps each item with the
 * shared signature path, signed name and server-ish timestamp.
 */
export const acknowledgeKitItems = async (ids, { signaturePath, signedName }) => {
  if (!ids?.length) return;
  const { error } = await supabase
    ?.from('crew_issued_kit')
    ?.update({
      acknowledged_at: new Date().toISOString(),
      ack_signature_path: signaturePath || null,
      ack_signed_name: signedName || null,
      ack_signed_ua: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      updated_at: new Date().toISOString(),
    })
    ?.in('id', ids);
  if (error) throw error;
};

/**
 * Record kit handed back at offboarding — the manager/captain counter-signs to
 * confirm the items returned, with their condition. (Phase 2.)
 */
export const recordKitReturn = async (ids, { returnedDate, condition, signaturePath, signedName, returnedTo }) => {
  if (!ids?.length) return;
  const { error } = await supabase
    ?.from('crew_issued_kit')
    ?.update({
      status: 'returned',
      returned_date: returnedDate || new Date().toISOString().slice(0, 10),
      return_condition: condition || null,
      return_signature_path: signaturePath || null,
      return_signed_name: signedName || null,
      returned_to: returnedTo || null,
      updated_at: new Date().toISOString(),
    })
    ?.in('id', ids);
  if (error) throw error;
};

// Mark an item lost / damaged (no hand-back signature).
export const markKitLost = async (id) => {
  const { error } = await supabase
    ?.from('crew_issued_kit')
    ?.update({ status: 'lost', updated_at: new Date().toISOString() })
    ?.eq('id', id);
  if (error) throw error;
};

// Reinstate a returned/lost item back into service (undo).
export const reinstateKitItem = async (id) => {
  const { error } = await supabase
    ?.from('crew_issued_kit')
    ?.update({
      status: 'in_service', returned_date: null, return_condition: null,
      return_signature_path: null, return_signed_name: null, returned_to: null,
      updated_at: new Date().toISOString(),
    })
    ?.eq('id', id);
  if (error) throw error;
};

// ── History — append-only audit log of issued-kit changes ────────────────────
export const logKitEvent = async ({ kitId, userId, tenantId, action, detail, actorId, actorName }) => {
  if (!userId || !action || !actorId) return;
  const { error } = await supabase?.from('crew_kit_events')?.insert({
    kit_id: kitId || null,
    user_id: userId,
    tenant_id: tenantId || null,
    action,
    detail: detail || {},
    actor_id: actorId,
    actor_name: actorName || null,
  });
  if (error) console.error('[kit] event log failed', error); // non-blocking
};

export const fetchKitEvents = async (userId) => {
  if (!userId) return [];
  const { data, error } = await supabase
    ?.from('crew_kit_events')
    ?.select('*')
    ?.eq('user_id', userId)
    ?.order('created_at', { ascending: false });
  if (error) { console.error('[kit] events fetch failed', error); return []; }
  return data || [];
};

// ── Uniform sizes — live in crew_personal_details.preferences.uniformSizes;
// surfaced on the Issued Kit tab (moved off Preferences) without disturbing
// other prefs. Gender-aware: a `fit` profile drives which garments show, since
// men's/women's bottoms size differently (waist 30/32 vs dress 8/10, skorts,
// dresses). All keys are strings stored in the jsonb blob — no schema change.
export const UNIFORM_SIZE_KEYS = [
  'fit', 'region', 'top', 'trousers', 'shorts', 'skort', 'dress', 'jacket', 'fleece',
  'belt', 'shoe', 'cap', 'gloves', 'foulies', 'boardshorts', 'rashVest', 'notes',
];
const blankSizes = () => UNIFORM_SIZE_KEYS.reduce((o, k) => { o[k] = ''; return o; }, {});

export const fetchUniformSizes = async (userId) => {
  if (!userId) return blankSizes();
  const { data, error } = await supabase
    ?.from('crew_personal_details')?.select('preferences')?.eq('user_id', userId)?.maybeSingle();
  if (error) { console.error('[kit] uniform fetch failed', error); return blankSizes(); }
  const u = data?.preferences?.uniformSizes || {};
  const out = blankSizes();
  UNIFORM_SIZE_KEYS.forEach((k) => { out[k] = u[k] || ''; });
  // Back-compat: the original model stored trousers/shorts together as `bottom`.
  if (!out.trousers && u.bottom) out.trousers = u.bottom;
  return out;
};

export const saveUniformSizes = async (userId, sizes) => {
  // Read-merge-write so we don't clobber the rest of the preferences blob.
  const { data, error: readErr } = await supabase
    ?.from('crew_personal_details')?.select('preferences')?.eq('user_id', userId)?.maybeSingle();
  if (readErr) throw readErr;
  const uniformSizes = UNIFORM_SIZE_KEYS.reduce((o, k) => { o[k] = sizes[k] || ''; return o; }, {});
  const preferences = { ...(data?.preferences || {}), uniformSizes };
  const { error } = await supabase
    ?.from('crew_personal_details')
    ?.upsert({ user_id: userId, preferences, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw error;
};
