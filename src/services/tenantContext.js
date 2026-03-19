import { supabase } from '../lib/supabaseClient';

/**
 * Bootstrap query sequence after login
 * Fetches profile, memberships, auto-sets last_active_tenant_id if null
 * @param {string} userId - The user's ID
 * @returns {Promise<Object>} { success, profile, memberships, activeTenantId, error }
 */
export const bootstrapUserTenant = async (userId) => {
  if (!userId) {
    return {
      success: false,
      error: 'User ID is required',
      profile: null,
      memberships: [],
      activeTenantId: null
    };
  }

  try {
    // Step 1: Fetch current user's profile
    const { data: profile, error: profileError } = await supabase
      ?.from('profiles')
      ?.select('id, full_name, email, last_active_tenant_id')
      ?.eq('id', userId)
      ?.single();

    if (profileError) {
      console.error('Error fetching profile:', profileError);
      return {
        success: false,
        error: `Failed to fetch profile: ${profileError?.message}`,
        profile: null,
        memberships: [],
        activeTenantId: null
      };
    }

    // Step 2: Fetch tenant membership rows
    const { data: memberships, error: membershipsError } = await supabase
      ?.from('tenant_members')
      ?.select(`
        id,
        tenant_id,
        user_id,
        role,
        active,
        joined_at,
        tenants:tenant_id (
          id,
          name,
          type,
          status
        )
      `)
      ?.eq('user_id', userId)
      ?.eq('active', true)
      ?.eq('status', 'ACTIVE')
      ?.order('joined_at', { ascending: true });

    if (membershipsError) {
      console.error('Error fetching memberships:', membershipsError);
      return {
        success: false,
        error: `Failed to fetch memberships: ${membershipsError?.message}`,
        profile,
        memberships: [],
        activeTenantId: null
      };
    }

    // Step 3: If no memberships exist, return early
    if (!memberships || memberships?.length === 0) {
      return {
        success: true,
        profile,
        memberships: [],
        activeTenantId: null,
        noMemberships: true
      };
    }

    // Step 4: Auto-set last_active_tenant_id if null
    let activeTenantId = profile?.last_active_tenant_id;

    if (!activeTenantId) {
      // Find COMMAND role membership first, otherwise use first membership
      const commandMembership = memberships?.find(m => m?.role?.toUpperCase() === 'COMMAND');
      const tenantIdToSet = commandMembership?.tenant_id || memberships?.[0]?.tenant_id;

      if (tenantIdToSet) {
        // Update profile with last_active_tenant_id
        const { error: updateError } = await supabase
          ?.from('profiles')
          ?.update({ last_active_tenant_id: tenantIdToSet })
          ?.eq('id', userId);

        if (updateError) {
          console.error('Error updating last_active_tenant_id:', updateError);
          return {
            success: false,
            error: `Failed to set active tenant: ${updateError?.message}`,
            profile,
            memberships,
            activeTenantId: null
          };
        }

        activeTenantId = tenantIdToSet;
      }
    }

    return {
      success: true,
      profile: { ...profile, last_active_tenant_id: activeTenantId },
      memberships,
      activeTenantId
    };
  } catch (err) {
    console.error('Bootstrap error:', err);
    return {
      success: false,
      error: err?.message || 'Unknown error during bootstrap',
      profile: null,
      memberships: [],
      activeTenantId: null
    };
  }
};

/**
 * Fetch all tenant memberships for a user
 * @param {string} userId - The user's ID
 * @returns {Promise<Array>} Array of tenant membership records
 */
export const fetchUserTenantMemberships = async (userId) => {
  if (!userId) {
    throw new Error('User ID is required');
  }

  const { data, error } = await supabase
    ?.from('tenant_members')
    ?.select(`
      id,
      tenant_id,
      user_id,
      role,
      active,
      joined_at,
      tenants:tenant_id (
        id,
        name,
        type,
        status
      )
    `)
    ?.eq('user_id', userId)
    ?.eq('active', true)
    ?.eq('status', 'ACTIVE')
    ?.order('joined_at', { ascending: true });

  if (error) {
    console.error('Error fetching tenant memberships:', error);
    throw error;
  }

  return data || [];
};

/**
 * Auto-set last_active_tenant_id on user profile
 * Logic:
 * - If last_active_tenant_id is NULL:
 *   - Set to tenant where user has role = 'COMMAND'
 *   - If no COMMAND role exists, use first active tenant_members record
 * @param {string} userId - The user's ID
 * @returns {Promise<string|null>} The tenant ID that was set, or null if no memberships
 */
export const autoSetActiveTenant = async (userId) => {
  if (!userId) {
    throw new Error('User ID is required');
  }

  // Fetch current profile to check if last_active_tenant_id is NULL
  const { data: profile, error: profileError } = await supabase
    ?.from('profiles')
    ?.select('last_active_tenant_id')
    ?.eq('id', userId)
    ?.single();

  if (profileError) {
    console.error('Error fetching profile:', profileError);
    throw profileError;
  }

  // If last_active_tenant_id is already set, return it
  if (profile?.last_active_tenant_id) {
    return profile?.last_active_tenant_id;
  }

  // Fetch user's tenant memberships
  const memberships = await fetchUserTenantMemberships(userId);

  if (!memberships || memberships?.length === 0) {
    console.warn('No active tenant memberships found for user');
    return null;
  }

  // Find tenant where user has COMMAND role
  const commandMembership = memberships?.find(m => m?.role?.toUpperCase() === 'COMMAND');
  const tenantIdToSet = commandMembership?.tenant_id || memberships?.[0]?.tenant_id;

  if (!tenantIdToSet) {
    console.warn('No valid tenant ID found to set');
    return null;
  }

  // Update profile with last_active_tenant_id
  const { error: updateError } = await supabase
    ?.from('profiles')
    ?.update({ last_active_tenant_id: tenantIdToSet })
    ?.eq('id', userId);

  if (updateError) {
    console.error('Error updating last_active_tenant_id:', updateError);
    throw updateError;
  }

  return tenantIdToSet;
};

/**
 * Switch active tenant for a user
 * Updates profiles.last_active_tenant_id
 * @param {string} userId - The user's ID
 * @param {string} tenantId - The tenant ID to switch to
 * @returns {Promise<boolean>} Success status
 */
export const switchActiveTenant = async (userId, tenantId) => {
  if (!userId || !tenantId) {
    throw new Error('User ID and Tenant ID are required');
  }

  // Verify user is a member of the tenant
  const { data: membership, error: membershipError } = await supabase
    ?.from('tenant_members')
    ?.select('id')
    ?.eq('user_id', userId)
    ?.eq('tenant_id', tenantId)
    ?.eq('active', true)
    ?.eq('status', 'ACTIVE')
    ?.single();

  if (membershipError || !membership) {
    throw new Error('User is not an active member of this tenant');
  }

  // Update profile with new last_active_tenant_id
  const { error: updateError } = await supabase
    ?.from('profiles')
    ?.update({ last_active_tenant_id: tenantId })
    ?.eq('id', userId);

  if (updateError) {
    console.error('Error switching active tenant:', updateError);
    throw updateError;
  }

  return true;
};

/**
 * Get current active tenant ID from profile
 * @param {string} userId - The user's ID
 * @returns {Promise<string|null>} The active tenant ID or null
 */
export const getActiveTenantId = async (userId) => {
  if (!userId) {
    throw new Error('User ID is required');
  }

  try {
    // Step 1: Query profiles.last_active_tenant_id
    const { data: profile, error: profileError } = await supabase
      ?.from('profiles')
      ?.select('last_active_tenant_id')
      ?.eq('id', userId)
      ?.maybeSingle();

    if (profileError) {
      console.error('Error fetching profile for active tenant:', profileError);
      throw profileError;
    }

    // If last_active_tenant_id exists, return it
    if (profile?.last_active_tenant_id) {
      return profile?.last_active_tenant_id;
    }

    // Step 2: If last_active_tenant_id is null, query tenant_members
    const { data: membershipRows, error: membershipError } = await supabase
      ?.from('tenant_members')
      ?.select('tenant_id')
      ?.eq('user_id', userId)
      ?.eq('active', true)
      ?.eq('status', 'ACTIVE')
      ?.order('joined_at', { ascending: true })
      ?.limit(1);

    if (membershipError) {
      console.error('Error fetching tenant membership:', membershipError);
      throw membershipError;
    }

    // If no active memberships found, return null
    if (!membershipRows || membershipRows?.length === 0) {
      return null;
    }

    const tenantId = membershipRows?.[0]?.tenant_id;

    // Step 3: Update profiles.last_active_tenant_id with the found tenant_id
    if (tenantId) {
      const { error: updateError } = await supabase
        ?.from('profiles')
        ?.update({ last_active_tenant_id: tenantId })
        ?.eq('id', userId);

      if (updateError) {
        console.error('Error updating last_active_tenant_id:', updateError);
        // Don't throw - we still have the tenant_id to return
      }
    }

    // Step 4: Return the active tenant id
    return tenantId || null;
  } catch (err) {
    console.error('Error in getActiveTenantId:', err);
    throw err;
  }
};

/**
 * Verify and get active tenant from profile (single source of truth)
 * This function ensures we ALWAYS use profiles.last_active_tenant_id
 * @param {string} userId - The user's ID
 * @returns {Promise<{tenantId: string|null, needsVesselCreation: boolean}>}
 */
export const verifyActiveTenant = async (userId) => {
  if (!userId) {
    return { tenantId: null, needsVesselCreation: true };
  }

  try {
    // Fetch profile to get last_active_tenant_id (single source of truth)
    const { data: profile, error: profileError } = await supabase
      ?.from('profiles')
      ?.select('last_active_tenant_id')
      ?.eq('id', userId)
      ?.single();

    if (profileError) {
      console.error('Error fetching profile for tenant verification:', profileError);
      return { tenantId: null, needsVesselCreation: true };
    }

    // If last_active_tenant_id is null, user needs to create/select vessel
    if (!profile?.last_active_tenant_id) {
      return { tenantId: null, needsVesselCreation: true };
    }

    // Verify user still has active membership in this tenant
    const { data: membership, error: membershipError } = await supabase
      ?.from('tenant_members')
      ?.select('id, role, active')
      ?.eq('user_id', userId)
      ?.eq('tenant_id', profile?.last_active_tenant_id)
      ?.eq('active', true)
      ?.eq('status', 'ACTIVE')
      ?.single();

    if (membershipError || !membership) {
      // Membership no longer valid, clear last_active_tenant_id
      await supabase
        ?.from('profiles')
        ?.update({ last_active_tenant_id: null })
        ?.eq('id', userId);
      
      return { tenantId: null, needsVesselCreation: true };
    }

    // Valid tenant found
    return { tenantId: profile?.last_active_tenant_id, needsVesselCreation: false };
  } catch (err) {
    console.error('Error verifying active tenant:', err);
    return { tenantId: null, needsVesselCreation: true };
  }
};

/**
 * Get current tenant context using get_my_context RPC
 * Returns user_id, tenant_id, and role from active session
 * @returns {Promise<{userId: string|null, tenantId: string|null, userRole: string|null}>}
 */
export const getTenantContext = async () => {
  try {
    // Call get_my_context RPC function
    const { data, error } = await supabase?.rpc('get_my_context');

    if (error) {
      console.error('Error fetching tenant context:', error);
      return { userId: null, tenantId: null, userRole: null };
    }

    // RPC returns array with single row
    if (!data || data?.length === 0) {
      return { userId: null, tenantId: null, userRole: null };
    }

    const context = data?.[0];
    
    return {
      userId: context?.user_id || null,
      tenantId: context?.tenant_id || null,
      userRole: context?.role || null
    };
  } catch (err) {
    console.error('Exception in getTenantContext:', err);
    return { userId: null, tenantId: null, userRole: null };
  }
};