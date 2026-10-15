// Leave balance — data access. Conventions as elsewhere in services/: every
// export returns { data, error } and never throws, explicit column lists, never
// select('*').
//
// Two reads and a pure calculation. The arithmetic all lives in leaveBalance.js
// so it can be tested without a database; this file only fetches the inputs.

import { supabase } from '../lib/supabaseClient';
import { computeLeaveBalance } from './leaveBalance';

const EMPLOYMENT_SELECT =
  'user_id, start_date, end_date, contract_type, rotation_pattern, rotation_unit, leave_entitlement_days';

// Everything needed to show one crew member's balance.
//
// `source: 'calendar'` rows are excluded for the same reason the Status History
// tab and the rota hook exclude them: they are projections written by the crew
// calendar rather than records of a status actually having changed, and counting
// them would double up against the real transitions.
export async function getLeaveBalance(tenantId, userId, { asOf } = {}) {
  if (!tenantId || !userId) {
    return { data: null, error: new Error('getLeaveBalance: tenant and user required') };
  }

  const [empRes, histRes] = await Promise.all([
    supabase
      .from('crew_employment')
      .select(EMPLOYMENT_SELECT)
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('crew_status_history')
      .select('new_status, changed_at')
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)
      .neq('source', 'calendar')
      .order('changed_at', { ascending: true }),
  ]);

  if (empRes.error) return { data: null, error: empRes.error };
  if (histRes.error) return { data: null, error: histRes.error };

  return {
    data: computeLeaveBalance({
      employment: empRes.data || {},
      changes: histRes.data || [],
      asOf,
    }),
    error: null,
  };
}
