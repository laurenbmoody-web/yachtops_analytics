import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';
import { isDevMode } from '../utils/devMode';

import ModalShell from '../components/ui/ModalShell';
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
  <ModalShell onClose={onClose} panelClassName="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
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
  </ModalShell>
);

// ─── Personal (unberthed) mode ───────────────────────────────────────────────
// Shown when a user has left their last vessel. Their personal record stays;
// vessel features are gated. Full-screen (not the router's shell) so it doesn't
// depend on a tenant; links do a full navigation so the allowlist in
// VesselFallbackUI lets the personal pages render.
const PersonalModeScreen = ({ userName, userId }) => {
  const go = (path) => { window.location.href = path; };
  const handleSignOut = async () => {
    try {
      ['activeTenantId', 'currentTenantId', 'last_active_tenant_id', 'tenantId', 'cargo_active_tenant_id', 'cargo_unberthed']
        .forEach((k) => localStorage.removeItem(k));
      await supabase.auth.signOut();
    } catch (err) {
      console.error('[TENANT] Sign out error:', err);
    }
    window.location.href = '/login-authentication';
  };

  const initials = (userName || '').trim().split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || 'C';

  const ic = { width: 19, height: 19, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' };
  const UserIcon = () => (<svg viewBox="0 0 24 24" style={ic}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>);
  const GearIcon = () => (<svg viewBox="0 0 24 24" style={ic}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>);
  const Chevron = () => (<svg viewBox="0 0 24 24" style={{ width: 18, height: 18, fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }}><path d="M9 18l6-6-6-6" /></svg>);

  const ActionRow = ({ icon, title, sub, onClick }) => (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 14, width: '100%', textAlign: 'left',
      background: '#FCFCFD', border: '1px solid #E6EAEF', borderRadius: 12,
      padding: '13px 14px', cursor: 'pointer', font: 'inherit',
    }}>
      <span style={{ width: 38, height: 38, borderRadius: 10, background: '#FBEFE9', color: '#C65A1A', display: 'grid', placeItems: 'center', flex: '0 0 auto' }}>{icon}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: '#1C1B3A' }}>{title}</span>
        <span style={{ display: 'block', fontSize: 12, color: '#8B8478', marginTop: 1 }}>{sub}</span>
      </span>
      <span style={{ color: '#CFCABF', flex: '0 0 auto' }}><Chevron /></span>
    </button>
  );

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999, overflow: 'auto',
      background: 'radial-gradient(120% 120% at 50% 0%, #FFFFFF 0%, #EEF1F5 100%)',
      display: 'grid', placeItems: 'center', padding: 24,
      fontFamily: "'Inter', system-ui, sans-serif",
    }}>
      <div style={{ width: '100%', maxWidth: 452 }}>
        {/* Identity */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 22 }}>
          <div style={{ width: 54, height: 54, borderRadius: 999, background: '#1C1B3A', color: '#fff', display: 'grid', placeItems: 'center', fontFamily: "'DM Serif Display', Georgia, serif", fontSize: 21, letterSpacing: '0.02em' }}>
            {initials}
          </div>
        </div>

        {/* Card */}
        <div style={{ background: '#fff', border: '1px solid #E8ECF1', borderRadius: 18, boxShadow: '0 30px 60px -28px rgba(28,27,58,0.28)', padding: '30px 28px 24px' }}>
          <h1 style={{
            fontFamily: "'DM Serif Display', 'DM Serif Text', Georgia, serif", fontWeight: 500,
            fontSize: 34, lineHeight: 1.02, letterSpacing: '-0.5px', color: '#1C1B3A',
            textTransform: 'uppercase', margin: '0 0 12px', textAlign: 'center',
          }}>
            Between, <em style={{ fontStyle: 'italic', fontWeight: 400, color: '#C65A1A', textTransform: 'none' }}>vessels</em>
          </h1>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: '#6F7396', margin: '0 0 22px', textAlign: 'center' }}>
            You’re not on a vessel right now. Your profile, documents and sea service stay safe — vessel features unlock the moment you join or are added to one.
          </p>
          <div style={{ display: 'grid', gap: 10 }}>
            <ActionRow icon={<UserIcon />} title={'My profile & documents'} sub={'Details, certificates & sea service'} onClick={() => go(userId ? `/profile/${userId}` : '/my-profile')} />
            <ActionRow icon={<GearIcon />} title={'Settings'} sub={'Account, security & privacy'} onClick={() => go('/settings')} />
          </div>
        </div>

        {/* Footer */}
        <div style={{ marginTop: 20, textAlign: 'center' }}>
          <p style={{ fontSize: 12.5, color: '#8B8478', lineHeight: 1.5, margin: '0 0 12px' }}>
            Joining a vessel? Accept your invite link, or ask the vessel’s admin to add you.
          </p>
          <button onClick={handleSignOut} style={{ fontSize: 13, fontWeight: 600, color: '#6B7280', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3 }}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Exported helper so AuthContext can render fallback UI ───────────────────
// Personal pages that must stay reachable in unberthed mode — when the user is
// on one of these, the full-screen personal landing steps aside so the page
// renders. Anything else shows the landing.
const UNBERTHED_ALLOW = ['/my-profile', '/profile', '/settings', '/supplier', '/invite', '/invite-accept', '/reset-password', '/forgot-password', '/login'];

export const VesselFallbackUI = () => {
  const { vesselChooserOptions, noVesselAccess, selectVesselFromChooser, userDisplayName, userId } = useTenant();

  if (noVesselAccess) {
    const path = (typeof window !== 'undefined' && window.location?.pathname) || '';
    if (UNBERTHED_ALLOW.some((p) => path.startsWith(p))) return null;
    return <PersonalModeScreen userName={userDisplayName} userId={userId} />;
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

        // Suppliers legitimately have no vessel membership — they live in the
        // supplier portal, never in crew personal mode. Clear any stray
        // unberthed flag (it can leak across logins in the same browser) and
        // keep the existing behaviour.
        const isSupplier = authUser?.user_metadata?.user_type === 'supplier';
        if (isSupplier) {
          localStorage.removeItem('cargo_unberthed');
        }

        // Personal (unberthed) mode for a CREW user who has left or lost their
        // vessel — their personal record stays, vessel features are gated. The
        // signal is persistent (survives logout/login): the just-left flag OR
        // any INACTIVE membership on record. Brand-new signups have NO
        // memberships at all, so they still fall through to onboarding below.
        let unberthed = !isSupplier && localStorage.getItem('cargo_unberthed') === '1';
        if (!isSupplier && !unberthed && authUser?.id) {
          try {
            const { data: past } = await supabase
              .from('tenant_members').select('id')
              .eq('user_id', authUser.id).eq('active', false).limit(1);
            if (past && past.length > 0) unberthed = true;
          } catch (e) {
            console.warn('[TENANT] inactive-membership check failed', e);
          }
        }
        if (unberthed) {
          console.log('[TENANT] Unberthed → personal mode');
          setActiveTenantId(null);
          setCurrentTenantMember(null);
          setNoVesselAccess(true);
          setLoadingTenant(false);
          return;
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

      // Reaching here means the user has at least one active membership — clear
      // any stale unberthed flag so they don't drop back into personal mode.
      localStorage.removeItem('cargo_unberthed');

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
    userId: authUser?.id || null,
    userDisplayName: authUser?.user_metadata?.full_name || authUser?.email || '',
    setActiveTenantId,
    ensureTenantSelected,
    selectVesselFromChooser,
    clearStaleTenantKeys
  };

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
};