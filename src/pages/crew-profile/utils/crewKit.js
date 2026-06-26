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
// return the stored object path (re-signed on display, never baked in).
export const uploadKitSignature = async (userId, dataUrl) => {
  const blob = await (await fetch(dataUrl)).blob();
  const path = `${userId}/${Date.now()}-kit-ack.png`;
  const { error } = await supabase?.storage?.from(BUCKET)?.upload(path, blob, {
    cacheControl: '3600', upsert: false, contentType: 'image/png',
  });
  if (error) throw error;
  return path;
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
