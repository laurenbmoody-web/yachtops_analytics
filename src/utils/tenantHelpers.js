import { supabase } from '../lib/supabaseClient';

/**
 * Normalize role to uppercase for consistent comparison
 * @param {string|null} role - Role from database (may be lowercase, mixed case, etc.)
 * @returns {string|null} Normalized uppercase role (COMMAND, CHIEF, HOD, CREW) or null
 */
export const normalizeRole = (role) => {
  if (!role) return null;
  return role?.toUpperCase()?.trim();
};

/**
 * Get user role from tenant_members for active tenant
 * @param {string} userId - User ID
 * @param {string} tenantId - Tenant ID
 * @returns {Promise<string|null>} Normalized uppercase role or null
 */
export const getUserRole = async (userId, tenantId) => {
  if (!userId || !tenantId) return null;
  
  try {
    const { data, error } = await supabase
      ?.from('tenant_members')
      ?.select('role')
      ?.eq('user_id', userId)
      ?.eq('tenant_id', tenantId)
      ?.eq('active', true)
      ?.single();
    
    if (error) {
      console.error('Error fetching user role:', error);
      return null;
    }
    
    return normalizeRole(data?.role);
  } catch (err) {
    console.error('Error in getUserRole:', err);
    return null;
  }
};

/**
 * Single source of truth for resolving active tenant_id
 * Resolution order:
 * 1) URL query parameter ?tenant_id=...
 * 2) App state (TenantContext activeTenantId)
 * 3) profiles.last_active_tenant_id for current user
 * 4) First active membership from tenant_members
 * 
 * @param {string|null} stateActiveTenantId - Current activeTenantId from TenantContext state
 * @returns {Promise<{tenantId: string|null, source: string}>}
 */
export const getActiveTenantId = async (stateActiveTenantId = null) => {
  try {
    // 1) Check URL query parameter
    const urlParams = new URLSearchParams(window.location.search);
    const urlTenantId = urlParams?.get('tenant_id');
    
    if (urlTenantId) {
      console.log('ACTIVE TENANT RESOLVED:', urlTenantId);
      console.log('ACTIVE TENANT SOURCE:', 'url');
      return { tenantId: urlTenantId, source: 'url' };
    }

    // 2) Check app state (TenantContext)
    if (stateActiveTenantId) {
      console.log('ACTIVE TENANT RESOLVED:', stateActiveTenantId);
      console.log('ACTIVE TENANT SOURCE:', 'state');
      return { tenantId: stateActiveTenantId, source: 'state' };
    }

    // 3) Get current authenticated user
    const { data: { user: authUser }, error: authError } = await supabase?.auth?.getUser();
    
    if (authError || !authUser) {
      console.error('No authenticated user found:', authError);
      console.log('ACTIVE TENANT RESOLVED:', null);
      console.log('ACTIVE TENANT SOURCE:', 'none');
      return { tenantId: null, source: 'none' };
    }

    // 4) Check profiles.last_active_tenant_id
    const { data: profileData, error: profileError } = await supabase
      ?.from('profiles')
      ?.select('last_active_tenant_id')
      ?.eq('id', authUser?.id)
      ?.single();

    if (profileError) {
      console.error('Error fetching profile:', profileError);
    }

    if (profileData?.last_active_tenant_id) {
      console.log('ACTIVE TENANT RESOLVED:', profileData?.last_active_tenant_id);
      console.log('ACTIVE TENANT SOURCE:', 'profile');
      return { tenantId: profileData?.last_active_tenant_id, source: 'profile' };
    }

    // 5) Fallback: Get first active membership from tenant_members
    const { data: memberships, error: membershipsError } = await supabase
      ?.from('tenant_members')
      ?.select('tenant_id')
      ?.eq('user_id', authUser?.id)
      ?.eq('active', true)
      ?.order('joined_at', { ascending: true })
      ?.limit(1);

    if (membershipsError) {
      console.error('Error fetching memberships:', membershipsError);
      console.log('ACTIVE TENANT RESOLVED:', null);
      console.log('ACTIVE TENANT SOURCE:', 'none');
      return { tenantId: null, source: 'none' };
    }

    if (memberships && memberships?.length > 0) {
      const tenantId = memberships?.[0]?.tenant_id;
      console.log('ACTIVE TENANT RESOLVED:', tenantId);
      console.log('ACTIVE TENANT SOURCE:', 'membership_fallback');
      return { tenantId, source: 'membership_fallback' };
    }

    // No tenant found
    console.log('ACTIVE TENANT RESOLVED:', null);
    console.log('ACTIVE TENANT SOURCE:', 'none');
    return { tenantId: null, source: 'none' };
  } catch (err) {
    console.error('Error in getActiveTenantId:', err);
    console.log('ACTIVE TENANT RESOLVED:', null);
    console.log('ACTIVE TENANT SOURCE:', 'error');
    return { tenantId: null, source: 'error' };
  }
};

/**
 * Ensure last_active_tenant_id is set for logged-in users
 * Called on app bootstrap after session load
 * @returns {Promise<{success: boolean, tenantId: string|null, role: string|null}>}
 */
export const ensureLastActiveTenantId = async () => {
  try {
    // Get current authenticated user
    const { data: { user: authUser }, error: authError } = await supabase?.auth?.getUser();
    
    if (authError || !authUser) {
      console.log('No authenticated user for tenant bootstrap');
      return { success: false, tenantId: null, role: null };
    }

    // Check if last_active_tenant_id is already set
    const { data: profileData, error: profileError } = await supabase
      ?.from('profiles')
      ?.select('last_active_tenant_id')
      ?.eq('id', authUser?.id)
      ?.single();

    if (profileError) {
      console.error('Error fetching profile for tenant bootstrap:', profileError);
      return { success: false, tenantId: null, role: null };
    }

    // If already set, fetch role and return
    if (profileData?.last_active_tenant_id) {
      console.log('last_active_tenant_id already set:', profileData?.last_active_tenant_id);
      
      // Fetch role for this tenant
      const role = await getUserRole(authUser?.id, profileData?.last_active_tenant_id);
      
      return { success: true, tenantId: profileData?.last_active_tenant_id, role };
    }

    // Fetch first active membership
    const { data: memberships, error: membershipsError } = await supabase
      ?.from('tenant_members')
      ?.select('tenant_id, role')
      ?.eq('user_id', authUser?.id)
      ?.eq('active', true)
      ?.order('joined_at', { ascending: true })
      ?.limit(1);

    if (membershipsError) {
      console.error('Error fetching memberships for tenant bootstrap:', membershipsError);
      return { success: false, tenantId: null, role: null };
    }

    if (!memberships || memberships?.length === 0) {
      console.log('No active memberships found for user');
      return { success: false, tenantId: null, role: null };
    }

    const tenantIdToSet = memberships?.[0]?.tenant_id;
    const roleToReturn = normalizeRole(memberships?.[0]?.role);

    // Update profile with last_active_tenant_id
    const { error: updateError } = await supabase
      ?.from('profiles')
      ?.update({ last_active_tenant_id: tenantIdToSet })
      ?.eq('id', authUser?.id);

    if (updateError) {
      console.error('Error setting last_active_tenant_id:', updateError);
      return { success: false, tenantId: null, role: null };
    }

    console.log('SET last_active_tenant_id ->', tenantIdToSet, 'with role ->', roleToReturn);
    return { success: true, tenantId: tenantIdToSet, role: roleToReturn };
  } catch (err) {
    console.error('Error in ensureLastActiveTenantId:', err);
    return { success: false, tenantId: null, role: null };
  }
};