// Defect → parts requisition bridge. "Order parts to fix this defect" mints a
// provisioning list (the requisition/board) pre-filled with the parts, tagged
// with the defect it came from (provisioning_lists.source_defect_id). From there
// the crew uses the normal board → send-to-supplier flow to actually order.
//
// We reuse the provisioning data layer rather than re-implement it, so the
// requisition behaves exactly like any hand-made board (approval, quotes, send).
import { supabase } from '../../../lib/supabaseClient';
import {
  createProvisioningList, upsertItems, PROVISIONING_STATUS, searchInventoryItems,
} from '../../provisioning/utils/provisioningStorage';

export { searchInventoryItems };

// Create a draft requisition from a defect + its parts lines.
// items: [{ name, qty, unit }]. Returns the created list row (or null).
export const createDefectRequisition = async (defect, items, actor) => {
  if (!actor?.tenantId || !defect?.id) return null;
  const lines = (items || []).filter((i) => i?.name?.trim());
  if (!lines.length) throw new Error('Add at least one part.');

  const list = await createProvisioningList({
    tenant_id: actor.tenantId,
    title: `Parts — ${defect.ref}${defect.title ? ` · ${defect.title}` : ''}`.slice(0, 120),
    status: PROVISIONING_STATUS.DRAFT,
    created_by: actor.userId || null,
    owner_id: actor.userId || null,
    department_id: defect.departmentId || null,
    visibility: 'department',
    department: defect.departmentOwner ? [defect.departmentOwner] : [],
    notes: `Raised from defect ${defect.ref}${defect.title ? `: ${defect.title}` : ''}`,
    currency: 'USD',
    is_private: false,
    is_template: false,
    source_defect_id: defect.id,
  });
  if (!list?.id) throw new Error('Could not create the requisition.');

  await upsertItems(lines.map((i) => ({
    list_id: list.id,
    name: i.name.trim(),
    quantity_ordered: Number(i.qty) > 0 ? Number(i.qty) : 1,
    unit: i.unit?.trim() || null,
    department: defect.departmentOwner || null,
    source: 'manual',
    // Thread the contractor/supplier already linked on the defect, so the board
    // groups these lines to that vendor when it comes time to send.
    supplier_profile_id: defect.contractorSupplierId || null,
    notes: `For defect ${defect.ref}`,
  })));

  return list;
};

// Requisitions previously raised from this defect (newest first). RLS-scoped.
export const fetchDefectRequisitions = async (defectId) => {
  if (!defectId) return [];
  const { data, error } = (await supabase
    ?.from('provisioning_lists')
    ?.select('id, title, status, created_at')
    ?.eq('source_defect_id', defectId)
    ?.order('created_at', { ascending: false })) || {};
  if (error) { console.warn('[defects] fetchDefectRequisitions', error); return []; }
  return data || [];
};
