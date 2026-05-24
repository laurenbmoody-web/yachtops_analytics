// Storage helpers for supplier_return_tasks on the supplier-portal side.
//
// Reads + writes go through supplier-side RLS on the table (defined in
// migration 20260523120000):
//   - SELECT: supplier_id = get_user_supplier_id()
//   - UPDATE: supplier_id = get_user_supplier_id()  (USING + WITH CHECK)
//   - INSERT / DELETE: not allowed for suppliers (crew create, no deletes)
//
// Including `.eq('supplier_id', supplierId)` on every query is defence-
// in-depth — RLS already scopes the result, but adding it lets the
// (supplier_id, status) index do its job and keeps the query correct if
// a future policy change relaxes the scoping.

import { supabase } from '../../../lib/supabaseClient';

export const fetchSupplierReturnTasks = async (supplierId) => {
  if (!supplierId) return [];
  const { data, error } = await supabase
    ?.from('supplier_return_tasks')
    ?.select('id, supplier_id, status, items, slip_metadata, created_at, acknowledged_at, completed_at, supplier_note')
    ?.eq('supplier_id', supplierId)
    ?.order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
};

// Count of 'sent' tasks for the nav badge. 'sent' is the unread state
// (an unactioned task — naturally cleared by Acknowledge).
export const fetchUnactionedReturnsCount = async (supplierId) => {
  if (!supplierId) return 0;
  const { count, error } = await supabase
    ?.from('supplier_return_tasks')
    ?.select('id', { count: 'exact', head: true })
    ?.eq('supplier_id', supplierId)
    ?.eq('status', 'sent');
  if (error) throw error;
  return count || 0;
};

export const acknowledgeSupplierReturnTask = async (taskId, { acknowledgedBy, supplierNote = null }) => {
  const { error } = await supabase
    ?.from('supplier_return_tasks')
    ?.update({
      status:          'acknowledged',
      acknowledged_at: new Date().toISOString(),
      acknowledged_by: acknowledgedBy || null,
      supplier_note:   supplierNote || null,
    })
    ?.eq('id', taskId);
  if (error) throw error;
};

export const completeSupplierReturnTask = async (taskId) => {
  const { error } = await supabase
    ?.from('supplier_return_tasks')
    ?.update({
      status:       'completed',
      completed_at: new Date().toISOString(),
    })
    ?.eq('id', taskId);
  if (error) throw error;
};
