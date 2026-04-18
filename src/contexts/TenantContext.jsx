import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';
import { isDevMode } from '../utils/devMode';

// DEV_MODE fallback for tenant resolution
const DEV_MODE = true;

const TenantContext = createContext();

export const useTenant = () => {
  const context = useContext(TenantContext);
  if (!context) {
    throw new Error('useTenant must be used within TenantProvider');
  }
  return context;
};

// ─── Vessel Chooser UI ───────────────────────────────────────────────────────
const VesselChooserModal = ({ options, onSelect }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60 p-4">
    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
          <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
          </svg>
        </div>
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Select Vessel</h2>
          <p className="text-sm text-gray-500">Choose the vessel you want to access</p>
        </div>
      </div>
      <div className="space-y-2">
        {options?.map((m) => (
          <button
            key={m?.tenant_id}
            onClick={() => onSelect(m?.tenant_id)}
            className="w-full text-left px-4 py-3 rounded-xl border border-gray-200 hover:border-blue-400 hover:bg-blue-50 transition-all group"
          >
            <div className="font-medium text-gray-900 group-hover:text-blue-700">
              {m?.tenants?.name || m?.tenant_id}
            </div>
            {m?.tenants?.type && (
              <div className="text-xs text-gray-400 mt-0.5 capitalize">{m?.tenants?.type}</div>
            )}
          </button>
        ))}
      </div>
    </div>
  </div>
);

// ─── No Vessel Access UI ─────────────────────────────────────────────────────
const NoVesselAccessScreen = () => {
  const handleSignOut = async () => {
    try {
      localStorage.removeItem('activeTenantId');
      localStorage.removeItem('currentTenantId');
      localStorage.removeItem('last_active_tenant_id');
      localStorage.removeItem('tenantId');
      await supabase.auth.signOut();
      window.location.href = '/login-authentication';
    } catch (err) {
      console.error('[TENANT] Sign out error:', err);
      window.location.href = '/login-authentication';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-8 text-center">
        <div className="w-14 h-14 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-7 h-7 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">No Active Vessel Access</h2>
        <p className="text-sm text-gray-500 leading-relaxed mb-6">
          You don't have an active membership on any vessel. Please contact your vessel administrator to be added.
        </p>
        <button
          onClick={handleSignOut}
          className="px-5 py-2.5 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/80 transition-colors"
        >
          Sign Out
        </button>
      </div>
    </div>
  );
};

// ─── Exported helper so AuthContext can render fallback UI ───────────────────
export const VesselFallbackUI = () => {
  const { vesselChooserOptions, noVesselAccess, selectVesselFromChooser } = useTenant();

  if (noVesselAccess) {
    return <NoVesselAccessScreen />;
  }

  if (vesselChooserOptions && vesselChooserOptions?.length > 0) {
    return <VesselChooserModal options={vesselChooserOptions} onSelect={selectVesselFromChooser} />;
  }

  return null;
};

export const TenantProvider = ({ children, authSession, authUser }) => {
  const [activeTenantId, setActiveTenantIdState] = useState(() => {
    return localStorage.getItem('activeTenantId') || null;
  });
  const [loadingTenant, setLoadingTenant] = useState(true);
  const [devNoTenant, setDevNoTenant] = useState(false);
  const [currentTenantMember, setCurrentTenantMember] = useState(null);
  const [vesselChooserOptions, setVesselChooserOptions] = useState(null);
  const [noVesselAccess, setNoVesselAccess] = useState(false);
  const bootstrapComplete = useRef(false);
  const lastUserId = useRef(null);
  const devFallbackApplied = useRef(false);

  // Public setter that also updates localStorage
  const setActiveTenantId = (tenantId) => {
    if (tenantId) {
      localStorage.setItem('activeTenantId', tenantId);
    } else {
      localStorage.removeItem('activeTenantId');
    }
    setActiveTenantIdState(tenantId);
  };

  // Clear all stale localStorage tenant keys
  const clearStaleTenantKeys = () => {
    console.log('[TENANT] Clearing stale localStorage tenant keys');
    localStorage.removeItem('activeTenantId');
    localStorage.removeItem('currentTenantId');
    localStorage.removeItem('last_active_tenant_id');
    localStorage.removeItem('tenantId');
    setActiveTenantIdState(null);
  };

  // Fallback query: fetch all active memberships for user without tenant filter
  const runFallbackMembershipQuery = async (userId) => {
    console.log('[TENANT] Running fallback membership query (no tenant filter) for user:', userId);
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
      ?.order('joined_at', { ascending: false, nullsLast: true });

    if (error) {
      console.error('[TENANT] Fallback query error:', error);
      return { data: null, error };
    }
    return { data: data || [], error: null };
  };

  // Handle fallback result: auto-set, show chooser, or show no-access
  const handleFallbackResult = async (fallbackMemberships, userId) => {
    if (!fallbackMemberships || fallbackMemberships?.length === 0) {
      console.log('[TENANT] Fallback: no active vessel access found');
      setNoVesselAccess(true);
      setVesselChooserOptions(null);
      setActiveTenantId(null);
      setLoadingTenant(false);
      return;
    }

    if (fallbackMemberships?.length === 1) {
      const tenantId = fallbackMemberships?.[0]?.tenant_id;
      console.log('[TENANT] Fallback: exactly one vessel found, auto-setting tenant:', tenantId);

      await supabase
        ?.from('profiles')
        ?.update({ last_active_tenant_id: tenantId })
        ?.eq('id', userId);

      setNoVesselAccess(false);
      setVesselChooserOptions(null);
      setActiveTenantId(tenantId);
      setLoadingTenant(false);
      return;
    }

    // Multiple rows — show vessel chooser
    console.log('[TENANT] Fallback: multiple vessels found, showing chooser');
    setNoVesselAccess(false);
    setVesselChooserOptions(fallbackMemberships);
    setActiveTenantId(null);
    setLoadingTenant(false);
  };

  // Core tenant selection logic with retry for network errors
  const ensureTenantSelected = async () => {
    console.log('[TENANT] ensureTenantSelected called');
    
    // DEV MODE: Handle tenant gracefully
    if (isDevMode()) {
      console.log('[TENANT] 🔧 DEV MODE: Bypassing tenant checks');
      
      const storedTenantId = localStorage.getItem('activeTenantId') || 
                             localStorage.getItem('currentTenantId') || 
                             localStorage.getItem('last_active_tenant_id');
      
      if (storedTenantId) {
        console.log('[TENANT] 🔧 DEV MODE: Using stored tenant:', storedTenantId);
        setActiveTenantId(storedTenantId);
        setDevNoTenant(false);
      } else {
        console.log('[TENANT] 🔧 DEV MODE: No tenant found, setting placeholder');
        setActiveTenantId(null);
        setDevNoTenant(true);
      }
      
      setLoadingTenant(false);
      return;
    }
    
    if (!authUser?.id) {
      console.log('[TENANT] No auth user, skipping');
      setActiveTenantId(null);
      setLoadingTenant(false);
      return;
    }

    try {
      setLoadingTenant(true);
      // Reset fallback states on each bootstrap attempt
      setNoVesselAccess(false);
      setVesselChooserOptions(null);

      // Retry logic for network errors
      let memberships = null;
      let error = null;
      const maxRetries = 3;
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        console.log(`[TENANT] Fetching memberships (attempt ${attempt}/${maxRetries})`);
        
        const result = await supabase
          ?.from('tenant_members')
          ?.select('tenant_id, joined_at, permission_tier, department_id')
          ?.eq('user_id', authUser?.id)
          ?.eq('active', true)
          ?.order('joined_at', { ascending: false, nullsLast: true });
        
        if (!result?.error) {
          memberships = result?.data;
          error = null;
          console.log(`[TENANT] ✅ Memberships fetched successfully on attempt ${attempt}`);
          break;
        }
        
        error = result?.error;
        
        const isNetworkError = 
          error?.message?.includes('Load failed') ||
          error?.message?.includes('fetch failed') ||
          error?.message?.includes('NetworkError') ||
          error?.message?.includes('Failed to fetch') ||
          error?.message?.includes('TypeError') ||
          !error?.code;
        
        if (isNetworkError && attempt < maxRetries) {
          const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 4000);
          console.warn(`[TENANT] ⚠️ Network error on attempt ${attempt}, retrying in ${delayMs}ms...`, {
            message: error?.message,
            code: error?.code
          });
          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue;
        }
        
        console.error(`[TENANT] ❌ Error on attempt ${attempt}:`, error);
        break;
      }

      if (error) {
        const isNetworkError = 
          error?.message?.includes('Load failed') ||
          error?.message?.includes('fetch failed') ||
          error?.message?.includes('NetworkError') ||
          error?.message?.includes('Failed to fetch') ||
          error?.message?.includes('TypeError') ||
          !error?.code;
        
        if (isNetworkError) {
          console.error('[TENANT] Network error fetching memberships after retries:', {
            message: error?.message,
            hint: 'Check internet connection or try again later'
          });
        } else {
          console.error('[TENANT] Error fetching memberships:', error);
        }
        
        if (DEV_MODE && !devFallbackApplied?.current) {
          console.log('🔧 DEV tenant fallback active');
          const mockTenantId = 'dev-mock-tenant-' + Date.now();
          setActiveTenantId(mockTenantId);
          devFallbackApplied.current = true;
          setLoadingTenant(false);
          return;
        }
        
        setActiveTenantId(null);
        setLoadingTenant(false);
        return;
      }

      if (!memberships || memberships?.length === 0) {
        console.log('[TENANT] No active memberships found');
        
        if (DEV_MODE && !devFallbackApplied?.current) {
          console.log('🔧 DEV tenant fallback active');
          const mockTenantId = 'dev-mock-tenant-' + Date.now();
          setActiveTenantId(mockTenantId);
          devFallbackApplied.current = true;
          setLoadingTenant(false);
          return;
        }
        
        setActiveTenantId(null);
        setLoadingTenant(false);
        return;
      }

      // Check if localStorage tenant is valid against fetched memberships
      const storedTenantId = localStorage.getItem('activeTenantId');
      const isStoredValid = memberships?.some(m => m?.tenant_id === storedTenantId);

      if (isStoredValid) {
        console.log('[TENANT] Using stored tenant:', storedTenantId);
        setActiveTenantId(storedTenantId);
        devFallbackApplied.current = false;
        const matchedMember = memberships?.find(m => m?.tenant_id === storedTenantId);
        setCurrentTenantMember(matchedMember || null);
        console.log('[BOOTSTRAP] ✅ membership ok, permission_tier:', matchedMember?.permission_tier);
        setLoadingTenant(false);
      } else if (storedTenantId && !isStoredValid) {
        // Stored tenant_id returned 0 matching rows — run fallback
        console.log('[TENANT] Stored tenant_id not found in memberships, running fallback for:', storedTenantId);
        clearStaleTenantKeys();
        const { data: fallbackMemberships, error: fallbackError } = await runFallbackMembershipQuery(authUser?.id);
        if (fallbackError) {
          console.error('[TENANT] Fallback query failed:', fallbackError);
          setActiveTenantId(null);
          setLoadingTenant(false);
          return;
        }
        await handleFallbackResult(fallbackMemberships, authUser?.id);
        devFallbackApplied.current = false;
      } else {
        // No stored tenant — auto-select most recent
        const selectedTenant = memberships?.[0]?.tenant_id;
        console.log('[TENANT] Selected most recent tenant:', selectedTenant);
        setActiveTenantId(selectedTenant);
        devFallbackApplied.current = false;
        setCurrentTenantMember(memberships?.[0] || null);
        console.log('[BOOTSTRAP] ✅ membership ok, permission_tier:', memberships?.[0]?.permission_tier);
        setLoadingTenant(false);
      }
    } catch (err) {
      console.error('[TENANT] Exception in ensureTenantSelected:', err);
      
      if (DEV_MODE && !devFallbackApplied?.current) {
        console.log('🔧 DEV tenant fallback active');
        const mockTenantId = 'dev-mock-tenant-' + Date.now();
        setActiveTenantId(mockTenantId);
        devFallbackApplied.current = true;
        setLoadingTenant(false);
        return;
      }
      
      setActiveTenantId(null);
      setLoadingTenant(false);
    }
  };

  // Allow external code to select a vessel from the chooser
  const selectVesselFromChooser = async (tenantId) => {
    if (!tenantId || !authUser?.id) return;
    console.log('[TENANT] Vessel selected from chooser:', tenantId);

    await supabase
      ?.from('profiles')
      ?.update({ last_active_tenant_id: tenantId })
      ?.eq('id', authUser?.id);

    setVesselChooserOptions(null);
    setNoVesselAccess(false);
    setActiveTenantId(tenantId);
  };

  // Bootstrap on auth session ready
  useEffect(() => {
    const currentUserId = authUser?.id;

    if (!authSession || !currentUserId) {
      console.log('[TENANT] No session, resetting tenant context');
      setActiveTenantId(null);
      setLoadingTenant(false);
      bootstrapComplete.current = false;
      lastUserId.current = null;
      devFallbackApplied.current = false;
      return;
    }

    if (bootstrapComplete?.current && lastUserId?.current === currentUserId) {
      console.log('[TENANT] Already bootstrapped for user:', currentUserId);
      return;
    }

    console.log('[TENANT] Bootstrapping tenant context for user:', currentUserId);
    bootstrapComplete.current = false;
    lastUserId.current = currentUserId;

    ensureTenantSelected()?.then(() => {
      bootstrapComplete.current = true;
      console.log('[TENANT] Bootstrap complete');
    });
  }, [authSession, authUser]);

  const value = {
    activeTenantId,
    loadingTenant,
    devNoTenant,
    vesselChooserOptions,
    noVesselAccess,
    currentTenantMember,
    setActiveTenantId,
    ensureTenantSelected,
    selectVesselFromChooser,
    clearStaleTenantKeys
  };

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
};