import { supabase } from '../lib/supabaseClient';

/**
 * Get authenticated user ID using Supabase session (SAFE METHOD)
 * @returns {Promise<string|null>} User ID or null if not authenticated
 */
export const getAuthedUserId = async () => {
  try {
    const { data: { session }, error } = await supabase?.auth?.getSession();
    
    if (error) {
      console.error('Error getting session:', error);
      return null;
    }
    
    return session?.user?.id || null;
  } catch (err) {
    console.error('Error in getAuthedUserId:', err);
    return null;
  }
};

/**
 * SAFE BOOT FLOW: Get user context (user_id, tenant_id, role) from Supabase RPC
 * Single source of truth for tenant and role information
 * 
 * CRITICAL: This function implements the safe boot flow:
 * 1. Checks Supabase session is loaded BEFORE calling RPC
 * 2. Only calls get_my_context() if session exists
 * 3. Wraps RPC call in try/catch with readable error messages
 * 4. Returns structured error info instead of throwing
 * 
 * @returns {Promise<{userId: string|null, tenantId: string|null, role: string|null, error: string|null}>}
 */
export const getMyContext = async () => {
  try {
    // STEP 1: Wait for Supabase session to be confirmed loaded
    const { data: { session }, error: sessionError } = await supabase?.auth?.getSession();
    
    if (sessionError) {
      const errorMsg = `Session check failed: ${sessionError?.message || 'Unknown error'}`;
      if (process.env.NODE_ENV === 'development') {
        console.error('[AUTH] Session error:', sessionError);
      }
      return { userId: null, tenantId: null, role: null, error: errorMsg };
    }
    
    // STEP 2: If session is null, do NOT call RPC
    if (!session) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[AUTH] No active session - skipping get_my_context() RPC call');
      }
      return { userId: null, tenantId: null, role: null, error: null };
    }
    
    // STEP 3: Session exists, safe to call RPC
    if (process.env.NODE_ENV === 'development') {
      console.log('[AUTH] Session confirmed, calling get_my_context() RPC...');
    }
    
    const { data, error: rpcError } = await supabase?.rpc('get_my_context');
    
    if (rpcError) {
      const errorMsg = `Failed to load vessel context: ${rpcError?.message || 'Unknown error'}`;
      if (process.env.NODE_ENV === 'development') {
        console.error('[AUTH] RPC error in get_my_context():', rpcError);
      }
      // Do NOT throw - return error info and continue rendering
      return { userId: null, tenantId: null, role: null, error: errorMsg };
    }
    
    // RPC returns array with single row
    const context = data?.[0] || {};
    
    // CRITICAL: Normalize role to UPPERCASE for consistent comparison
    const normalizedRole = context?.role ? context?.role?.toUpperCase() : null;
    
    if (process.env.NODE_ENV === 'development') {
      console.log('[AUTH] Context loaded:', {
        userId: context?.user_id || 'null',
        tenantId: context?.tenant_id || 'null',
        role: normalizedRole || 'null',
        originalRole: context?.role || 'null'
      });
    }
    
    return {
      userId: context?.user_id || null,
      tenantId: context?.tenant_id || null,
      role: normalizedRole,
      error: null
    };
  } catch (err) {
    const errorMsg = `Unexpected error loading context: ${err?.message || 'Unknown error'}`;
    if (process.env.NODE_ENV === 'development') {
      console.error('[AUTH] Unexpected error in getMyContext():', err);
    }
    // Do NOT throw - return error info and continue rendering
    return { userId: null, tenantId: null, role: null, error: errorMsg };
  }
};