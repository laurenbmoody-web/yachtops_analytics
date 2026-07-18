// Laundry cases — vessel-scoped containers (`laundry_cases`) that hold laundry
// items so crew pack, send and receive them as one unit. Membership is the
// `case_id` FK on laundry_items (see laundryStorage.setLaundryItemsCase /
// loadLaundryItemsByCase). This module owns the cases table only.

import { supabase } from '../../../lib/supabaseClient';
import { getCurrentUser } from '../../../utils/authStorage';
import { showToast } from '../../../utils/toast';

const getTenantId = async () => {
  try {
    const { data, error } = await supabase?.rpc('get_my_context');
    if (error || !data?.[0]?.tenant_id) return null;
    return data[0].tenant_id;
  } catch (e) {
    console.error('[laundry-cases] get_my_context failed', e);
    return null;
  }
};

// Lifecycle a case moves through as it leaves and returns to the vessel.
export const CaseStatus = { OPEN: 'open', PACKED: 'packed', SENT: 'sent', RECEIVED: 'received', CLOSED: 'closed' };
export const CaseStatusLabels = { open: 'Open', packed: 'Packed', sent: 'Sent', received: 'Received', closed: 'Closed' };
export const CASE_FLOW = ['open', 'packed', 'sent', 'received', 'closed'];

const mapCase = (r) => ({
  id: r.id,
  name: r.name || 'Case',
  destination: r.destination || '',
  status: r.status || 'open',
  notes: r.notes || '',
  createdByName: r.created_by_name || '',
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const loadCases = async () => {
  const tenantId = await getTenantId();
  if (!tenantId) return [];
  const { data, error } = await supabase
    .from('laundry_cases')
    .select('*')
    .eq('tenant_id', tenantId)
    .is('archived_at', null)
    .order('created_at', { ascending: false });
  if (error) { console.error('[laundry-cases] load failed', error); return []; }
  return (data || []).map(mapCase);
};

export const getCaseById = async (id) => {
  if (!id) return null;
  const { data, error } = await supabase.from('laundry_cases').select('*').eq('id', id).is('archived_at', null).maybeSingle();
  if (error || !data) return null;
  return mapCase(data);
};

export const createCase = async ({ name, destination, notes } = {}) => {
  const tenantId = await getTenantId();
  if (!tenantId) return null;
  const u = getCurrentUser();
  const { data: auth } = await supabase.auth.getUser();
  const payload = {
    tenant_id: tenantId,
    name: (name || '').trim() || 'New case',
    destination: (destination || '').trim() || null,
    notes: (notes || '').trim() || null,
    created_by: auth?.user?.id || null,
    created_by_name: u?.fullName || u?.name || null,
  };
  const { data, error } = await supabase.from('laundry_cases').insert(payload).select('*').single();
  if (error) { console.error('[laundry-cases] create failed', error); showToast('Could not create case', 'error'); return null; }
  return mapCase(data);
};

export const updateCase = async (id, updates) => {
  const map = { name: 'name', destination: 'destination', status: 'status', notes: 'notes' };
  const patch = { updated_at: new Date().toISOString() };
  Object.entries(updates || {}).forEach(([k, v]) => { if (map[k]) patch[map[k]] = (typeof v === 'string' ? v.trim() : v) || null; });
  const { data, error } = await supabase.from('laundry_cases').update(patch).eq('id', id).select('*').single();
  if (error) { console.error('[laundry-cases] update failed', error); showToast('Could not update case', 'error'); return null; }
  return mapCase(data);
};

// Archive a case: unpack its items first (SET NULL would do this on delete, but
// archiving keeps the row) so the garments return to the loose list.
export const archiveCase = async (id) => {
  await supabase.from('laundry_items').update({ case_id: null }).eq('case_id', id);
  const { error } = await supabase.from('laundry_cases').update({ archived_at: new Date().toISOString() }).eq('id', id);
  if (error) { console.error('[laundry-cases] archive failed', error); showToast('Could not remove case', 'error'); return false; }
  return true;
};
