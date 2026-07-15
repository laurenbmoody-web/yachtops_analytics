import { useMemo } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { useTenant } from '../../../contexts/TenantContext';

// The identity/context every defect read & write needs, resolved from the real
// Supabase login + active tenant (NOT the localStorage user cache). Returned as a
// superset object so it doubles as the legacy `currentUser` shape — `id`,
// `effectiveTier`, `department`, `fullName` aliases keep hasCommandAccess() and
// defectPermissions working unchanged.
export function useDefectActor() {
  const { user, currentUser, tenantRole } = useAuth() || {};
  const { activeTenantId, currentTenantMember, userDisplayName } = useTenant() || {};

  return useMemo(() => {
    const userId = user?.id || null;
    const userName = userDisplayName || currentUser?.fullName || currentUser?.name || null;
    const tier = (tenantRole || currentTenantMember?.permission_tier || currentUser?.effectiveTier || '')
      .toString().trim().toUpperCase();
    const departmentId = currentTenantMember?.department_id || null;
    const departmentName = currentUser?.department || null;

    return {
      // canonical actor fields
      tenantId: activeTenantId || null,
      userId,
      userName,
      tier,
      departmentId,
      departmentName,
      // legacy currentUser aliases (so existing permission/id checks keep working)
      id: userId,
      fullName: userName,
      name: userName,
      effectiveTier: tier,
      permissionTier: tier,
      department: departmentName,
    };
  }, [user?.id, userDisplayName, currentUser, tenantRole, currentTenantMember, activeTenantId]);
}
