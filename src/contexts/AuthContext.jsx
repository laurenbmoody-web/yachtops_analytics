import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { getCurrentUser, hasCommandAccess, hasChiefAccess, hasHODAccess, setCurrentUser as saveCurrentUser } from '../utils/authStorage';
import { isDevMode } from '../utils/devMode';

import { supabase } from '../lib/supabaseClient';
import { useLocation } from 'react-router-dom';
import { TenantProvider, useTenant, VesselFallbackUI } from './TenantContext';

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

// Export useTenant for convenience
export { useTenant };

export const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(() => getCurrentUser());
  const [currentTenantId, setCurrentTenantId] = useState(() => {
    return localStorage.getItem('cargo.currentTenantId') || null;
  });
  const [activeTenantId, setActiveTenantId] = useState(() => {
    return localStorage.getItem('cargo_active_tenant_id') || null;
  });
  
  // Session state for ProtectedRoute
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tenantRole, setTenantRole] = useState(null);
  const [tenantError, setTenantError] = useState(null);
  const [tenantLoading, setTenantLoading] = useState(false); // Track tenant bootstrap separately
  const [hasTenant, setHasTenant] = useState(false); // Track if user has tenant membership
  const [bootstrapComplete, setBootstrapComplete] = useState(false); // Track bootstrap completion
  const [bootstrapStatus, setBootstrapStatus] = useState(''); // UI status message
  
  // Bootstrap tracking to prevent loops
  const lastBootstrappedUserId = useRef(null);
  const bootstrapInProgress = useRef(false);
  
  // Failsafe timeout state
  const [showFailsafeDebug, setShowFailsafeDebug] = useState(false);
  const [lastBootstrapStep, setLastBootstrapStep] = useState('initializing');
  const failsafeTimeoutRef = useRef(null);
  
  // Session debouncing to prevent treating temporary null sessions as logouts
  const sessionDebounceTimer = useRef(null);
  const lastValidSession = useRef(null);
  const isRestoringSession = useRef(false);
  const ignoreNextSignOut = useRef(false); // Flag to ignore false SIGNED_OUT events

  // Initialize session and listen for auth changes
  useEffect(() => {
    // DEV MODE: Skip auth loading, provide mock session
    if (isDevMode()) {
      console.log('[AUTH] 🔧 DEV MODE: Bypassing auth, providing mock session');
      const mockSession = {
        user: { id: 'dev-user', email: 'dev@example.com' }
      };
      setSession(mockSession);
      setUser(mockSession?.user);
      setLoading(false);
      setTenantLoading(false);
      setBootstrapComplete(true);
      return; // Skip normal auth flow
    }
    
    console.log('[AUTH] 🚀 auth: initializing auth context');
    setLastBootstrapStep('initializing');
    
    // Get initial session BEFORE setting up subscription
    const initializeAuth = async () => {
      try {
        console.log('[AUTH] 📡 auth: fetching initial session');
        setLastBootstrapStep('fetching_session');
        
        const { data: { session: initialSession }, error } = await supabase?.auth?.getSession();
        
        if (error) {
          console.error('[AUTH] ❌ auth: error loading session:', error);
          setTenantError(`Session load failed: ${error?.message}`);
          setLastBootstrapStep('session_error');
        } else {
          console.log('[AUTH] ✅ auth: session loaded', {
            hasSession: !!initialSession,
            userId: initialSession?.user?.id,
            email: initialSession?.user?.email
          });
          setLastBootstrapStep('session_loaded');
          
          // Store initial session
          setSession(initialSession);
          setUser(initialSession?.user || null);
          
          // Store as last valid session if it exists
          if (initialSession) {
            lastValidSession.current = initialSession;
            console.log('[AUTH] 💾 Stored initial session as last valid session');
          }
        }
      } catch (err) {
        console.error('[AUTH] ❌ auth: exception loading session:', err);
        setTenantError(`Session load failed: ${err?.message}`);
        setLastBootstrapStep('session_error');
      } finally {
        // CRITICAL: Always set loading to false in finally block
        console.log('[AUTH] 🏁 auth: session initialization complete, setting loading=false');
        setLoading(false);
      }
    };

    initializeAuth();

    // Listen for auth state changes (SINGLE SUBSCRIPTION)
    const { data: { subscription } } = supabase?.auth?.onAuthStateChange(async (event, newSession) => {
      console.log('[AUTH] 🔄 Auth state changed:', {
        event,
        hasSession: !!newSession,
        userId: newSession?.user?.id,
        email: newSession?.user?.email,
        timestamp: new Date()?.toISOString()
      });
      
      // Clear any pending debounce timer
      if (sessionDebounceTimer?.current) {
        clearTimeout(sessionDebounceTimer?.current);
        sessionDebounceTimer.current = null;
      }
      
      // Handle explicit SIGNED_OUT event
      if (event === 'SIGNED_OUT') {
        // CRITICAL: Ignore SIGNED_OUT if we're restoring session
        if (isRestoringSession?.current || ignoreNextSignOut?.current) {
          console.warn('[AUTH] ⚠️ Ignoring SIGNED_OUT event (session restoration in progress)');
          ignoreNextSignOut.current = false;
          return;
        }
        
        // Verify this is a real logout by checking storage
        const storageSession = localStorage.getItem('supabase.auth.token');
        if (storageSession && lastValidSession?.current) {
          console.warn('[AUTH] ⚠️ SIGNED_OUT event but session exists in storage, ignoring');
          return;
        }
        
        console.log('[AUTH] 🚪 User signed out, clearing session');
        setSession(null);
        setUser(null);
        setTenantRole(null);
        setTenantError(null);
        lastBootstrappedUserId.current = null;
        bootstrapInProgress.current = false;
        lastValidSession.current = null;
        setLastBootstrapStep('signed_out');
        setLoading(false);
        return;
      }
      
      // Handle session updates
      if (newSession) {
        console.log('[AUTH] ✅ Session updated, storing as valid session');
        // If this is a different user (fresh login), reset bootstrap so the
        // spinner shows while the new tenant context is loaded.
        if (lastBootstrappedUserId.current !== newSession?.user?.id) {
          setBootstrapComplete(false);
        }
        setSession(newSession);
        setUser(newSession?.user || null);
        lastValidSession.current = newSession;
        setLoading(false);
        return;
      }
      
      // Handle null session (potential navigation-induced drop)
      if (!newSession && lastValidSession?.current && !isRestoringSession?.current) {
        console.warn('[AUTH] ⚠️ Session became null during navigation, attempting restoration...');
        
        // Debounce: Wait 500ms before treating null session as logout
        sessionDebounceTimer.current = setTimeout(async () => {
          console.log('[AUTH] 🔍 Debounce timeout reached, checking if session can be restored');
          
          isRestoringSession.current = true;
          ignoreNextSignOut.current = true; // Ignore any SIGNED_OUT events during restoration
          
          try {
            // Attempt to restore session from storage
            const { data: { session: restoredSession }, error } = await supabase?.auth?.getSession();
            
            if (restoredSession) {
              console.log('[AUTH] ✅ Session restored successfully:', {
                userId: restoredSession?.user?.id,
                email: restoredSession?.user?.email
              });
              setSession(restoredSession);
              setUser(restoredSession?.user || null);
              lastValidSession.current = restoredSession;
            } else {
              console.warn('[AUTH] ⚠️ Could not restore session, using last valid session');
              // Use last valid session to prevent blank screen
              setSession(lastValidSession?.current);
              setUser(lastValidSession?.current?.user || null);
            }
          } catch (err) {
            console.error('[AUTH] ❌ Error restoring session:', err);
            // Fallback to last valid session
            console.log('[AUTH] 🔄 Falling back to last valid session');
            setSession(lastValidSession?.current);
            setUser(lastValidSession?.current?.user || null);
          } finally {
            isRestoringSession.current = false;
            ignoreNextSignOut.current = false;
            setLoading(false);
          }
        }, 500);
        
        return;
      }
      
      // Default: update loading state
      setLoading(false);
    });

    return () => {
      console.log('[AUTH] 🧹 Cleaning up auth subscription');
      subscription?.unsubscribe();
      if (failsafeTimeoutRef?.current) {
        clearTimeout(failsafeTimeoutRef?.current);
      }
      if (sessionDebounceTimer?.current) {
        clearTimeout(sessionDebounceTimer?.current);
      }
    };
  }, []);

  // Bootstrap: Fetch profile and tenant context
  useEffect(() => {
    const bootstrapTenant = async () => {
      // Check if we have a session (including last valid session)
      const currentSession = session || lastValidSession?.current;
      
      if (!currentSession?.user) {
        console.log('BOOTSTRAP: no session, skipping');
        setBootstrapComplete(true);
        setTenantLoading(false);
        setLoading(false);
        setBootstrapStatus('');
        return;
      }
      
      const currentUserId = currentSession?.user?.id;
      
      // Check if already bootstrapped for this user
      if (lastBootstrappedUserId?.current === currentUserId) {
        console.log('BOOTSTRAP: already completed for user', currentUserId);
        setBootstrapComplete(true);
        return;
      }
      
      // Check if bootstrap already in progress
      if (bootstrapInProgress?.current) {
        console.log('BOOTSTRAP: already in progress, skipping');
        return;
      }
      
      bootstrapInProgress.current = true;
      setTenantLoading(true);
      setBootstrapComplete(false);
      console.log('BOOTSTRAP: starting for user:', currentUserId);
      setLastBootstrapStep('bootstrap_start');
      setBootstrapStatus('Initializing...');
      
      try {
        // Step 1: Fetch user profile with current_tenant_id
        console.log('BOOTSTRAP: fetching profile (id, email, account_type, current_tenant_id)');
        setLastBootstrapStep('fetching_profile');
        setBootstrapStatus('Loading profile...');
        
        // Retry logic for network errors
        let profile = null;
        let profileError = null;
        const maxRetries = 3;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          console.log(`BOOTSTRAP: profile fetch attempt ${attempt}/${maxRetries}`);
          
          const { data, error } = await supabase
            ?.from('profiles')
            ?.select('id, email, account_type, current_tenant_id')
            ?.eq('id', currentUserId)
            ?.single();
          
          if (!error) {
            profile = data;
            profileError = null;
            console.log('BOOTSTRAP: ✅ profile fetch successful');
            break;
          }
          
          profileError = error;
          
          // CRITICAL: Handle PGRST116 (0 rows) - profile doesn't exist, create it
          if (error?.code === 'PGRST116') {
            console.log('BOOTSTRAP: Profile not found (PGRST116), creating new profile...');
            
            const { data: newProfile, error: insertError } = await supabase
              ?.from('profiles')
              ?.insert({
                id: currentUserId,
                email: currentSession?.user?.email,
                full_name: currentSession?.user?.user_metadata?.full_name || null,
                account_type: null,
                current_tenant_id: null
              })
              ?.select('id, email, account_type, current_tenant_id')
              ?.single();
            
            if (insertError) {
              console.error('BOOTSTRAP: ❌ Failed to create profile:', insertError);
              profileError = insertError;
              break;
            }
            
            console.log('BOOTSTRAP: ✅ Profile created successfully');
            profile = newProfile;
            profileError = null;
            break;
          }
          
          // Check if it's a network error (Load failed, fetch failed, etc.)
          const isNetworkError = 
            error?.message?.includes('Load failed') ||
            error?.message?.includes('fetch failed') ||
            error?.message?.includes('NetworkError') ||
            error?.message?.includes('Failed to fetch') ||
            !error?.code; // No error code usually means network issue
          
          if (isNetworkError && attempt < maxRetries) {
            const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 4000); // 1s, 2s, 4s
            console.warn(`BOOTSTRAP: ⚠️ Network error on attempt ${attempt}, retrying in ${delayMs}ms...`, error);
            await new Promise(resolve => setTimeout(resolve, delayMs));
            continue;
          }
          
          // If it's an RLS/permission error or max retries reached, stop
          console.error(`BOOTSTRAP: ❌ profile fetch failed on attempt ${attempt}:`, error);
          break;
        }
        
        // CRITICAL: If profile fetch fails due to RLS/permissions, show error and STOP
        if (profileError) {
          // Distinguish between network errors and permission errors
          const isNetworkError = 
            profileError?.message?.includes('Load failed') ||
            profileError?.message?.includes('fetch failed') ||
            profileError?.message?.includes('NetworkError') ||
            profileError?.message?.includes('Failed to fetch') ||
            !profileError?.code;
          
          const errorMessage = isNetworkError
            ? 'Network error: Unable to connect to server. Please check your internet connection and try again.'
            : `Profile access denied: ${profileError?.message || 'Permission error'}`;
          
          console.error('BOOTSTRAP: ❌ profile fetch failed (RLS/permission):', profileError);
          setTenantError(errorMessage);
          setBootstrapStatus('');
          setActiveTenantId(null);
          setTenantRole(null);
          setHasTenant(false);
          setBootstrapComplete(true); // CRITICAL: Set to true to stop spinner
          setTenantLoading(false);
          setLoading(false);
          lastBootstrappedUserId.current = currentUserId;
          bootstrapInProgress.current = false;
          return;
        }
        
        if (!profile) {
          console.error('BOOTSTRAP: ❌ profile not found');
          setTenantError('Profile not found');
          setBootstrapStatus('');
          setActiveTenantId(null);
          setTenantRole(null);
          setHasTenant(false);
          setBootstrapComplete(true); // CRITICAL: Set to true to stop spinner
          setTenantLoading(false);
          setLoading(false);
          lastBootstrappedUserId.current = currentUserId;
          bootstrapInProgress.current = false;
          return;
        }
        
        console.log('BOOTSTRAP: ✅ profile ok', {
          id: profile?.id,
          email: profile?.email,
          account_type: profile?.account_type,
          current_tenant_id: profile?.current_tenant_id
        });
        setLastBootstrapStep('profile_ok');
        setBootstrapStatus('Profile loaded');
        
        // Step 2: Check if current_tenant_id is set
        if (profile?.current_tenant_id) {
          // User already has a tenant set, fetch membership to get permission_tier
          console.log('BOOTSTRAP: current_tenant_id exists, fetching membership for permission_tier');
          setLastBootstrapStep('fetching_membership_for_permission_tier');
          setBootstrapStatus('Loading membership...');
          
          const { data: membership, error: membershipError } = await supabase
            ?.from('tenant_members')
            ?.select('tenant_id, permission_tier, role, department, active')
            ?.eq('user_id', currentUserId)
            ?.eq('tenant_id', profile?.current_tenant_id)
            ?.neq('active', false)
            ?.single();
          
          if (membershipError || !membership) {
            console.warn('BOOTSTRAP: ⚠️ membership not found for current_tenant_id, clearing tenant');
            // Clear invalid tenant_id from profile
            await supabase
              ?.from('profiles')
              ?.update({ current_tenant_id: null })
              ?.eq('id', currentUserId);
            
            setActiveTenantId(null);
            localStorage.removeItem('cargo_active_tenant_id');
            setTenantRole(null);
            setHasTenant(false);
            setTenantError(null);
            console.log('BOOTSTRAP: ✅ membership ok (none found, cleared)');
            setLastBootstrapStep('membership_cleared');
            setBootstrapStatus('No membership found');
          } else {
            const normalizedTier = (membership?.permission_tier || '')?.toUpperCase()?.trim();
            console.log('BOOTSTRAP: ✅ membership ok', {
              tenant_id: membership?.tenant_id,
              permission_tier: normalizedTier
            });
            setLastBootstrapStep('membership_ok');
            setBootstrapStatus('Membership loaded');
            
            setActiveTenantId(membership?.tenant_id);
            localStorage.setItem('cargo_active_tenant_id', membership?.tenant_id);
            setTenantRole(normalizedTier);
            setHasTenant(true);
            setTenantError(null);

            // ── Write permission fields to currentUser so permission helpers work ──
            const existingUser = getCurrentUser() || {};
            const enrichedUser = {
              ...existingUser,
              permission_tier: normalizedTier,
              role: membership?.role || existingUser?.role || null,
              department: membership?.department || existingUser?.department || null,
            };
            setCurrentUser(enrichedUser);
            saveCurrentUser(enrichedUser);
            console.log('[BOOTSTRAP] ✅ currentUser enriched with permission_tier/role/department:', {
              permission_tier: enrichedUser?.permission_tier,
              role: enrichedUser?.role,
              department: enrichedUser?.department,
            });

            console.log('BOOTSTRAP: ✅ tenant set');
            setLastBootstrapStep('tenant_set');
            setBootstrapStatus('Tenant context set');
          }
        } else {
          // current_tenant_id is null, fetch membership
          console.log('BOOTSTRAP: current_tenant_id is null, fetching membership');
          setLastBootstrapStep('fetching_membership');
          setBootstrapStatus('Finding membership...');
          
          const { data: memberships, error: membershipError } = await supabase
            ?.from('tenant_members')
            ?.select('tenant_id, role, active')
            ?.eq('user_id', currentUserId)
            ?.eq('active', true)
            ?.order('joined_at', { ascending: false })
            ?.limit(1);
          
          if (membershipError) {
            console.error('BOOTSTRAP: ❌ membership query error:', membershipError);
            setTenantError(`Membership query failed: ${membershipError?.message}`);
            setBootstrapStatus('');
          }
          
          if (memberships && memberships?.length > 0) {
            // Membership found, update profile.current_tenant_id
            const membership = memberships?.[0];
            const tenantId = membership?.tenant_id;
            const normalizedRole = (membership?.role || '')?.toUpperCase()?.trim();
            
            console.log('BOOTSTRAP: ✅ membership ok', {
              tenant_id: tenantId,
              role: normalizedRole
            });
            setLastBootstrapStep('membership_ok');
            setBootstrapStatus('Membership found');
            
            // Update profile with tenant_id
            console.log('BOOTSTRAP: updating profile.current_tenant_id');
            const { error: updateError } = await supabase
              ?.from('profiles')
              ?.update({ current_tenant_id: tenantId })
              ?.eq('id', currentUserId);
            
            if (updateError) {
              console.error('BOOTSTRAP: ⚠️ failed to update profile.current_tenant_id:', updateError);
              // Continue anyway, set tenant context
            } else {
              console.log('BOOTSTRAP: ✅ profile.current_tenant_id updated');
            }
            
            setActiveTenantId(tenantId);
            localStorage.setItem('cargo_active_tenant_id', tenantId);
            setTenantRole(normalizedRole);
            setHasTenant(true);
            setTenantError(null);
            console.log('BOOTSTRAP: ✅ tenant set');
            setLastBootstrapStep('tenant_set');
            setBootstrapStatus('Tenant context set');
          } else {
            // No membership found, route to /signup-vessel
            console.log('BOOTSTRAP: ⚠️ no membership found, will route to /signup-vessel');
            setActiveTenantId(null);
            localStorage.removeItem('cargo_active_tenant_id');
            setTenantRole(null);
            setHasTenant(false);
            setTenantError(null);
            console.log('BOOTSTRAP: ✅ membership ok (none found)');
            setLastBootstrapStep('no_membership');
            setBootstrapStatus('No membership');
          }
        }
        
        console.log('BOOTSTRAP: ✅ tenant context ready');
        setLastBootstrapStep('tenant_context_ready');
        setBootstrapStatus('Ready');
        
        // Mark this user as bootstrapped
        lastBootstrappedUserId.current = currentUserId;
        
      } catch (err) {
        console.error('BOOTSTRAP: ❌ exception:', err);
        setTenantError(`Bootstrap failed: ${err?.message || 'Unknown error'}`);
        setLastBootstrapStep('bootstrap_error');
        setBootstrapStatus('');
        
        // Set safe defaults on error
        setActiveTenantId(null);
        setTenantRole(null);
        setHasTenant(false);
        lastBootstrappedUserId.current = currentUserId;
      } finally {
        // CRITICAL: Always complete bootstrap
        bootstrapInProgress.current = false;
        setTenantLoading(false);
        setBootstrapComplete(true); // CRITICAL: Always set to true
        setLoading(false);
        
        // Clear failsafe timeout
        if (failsafeTimeoutRef?.current) {
          clearTimeout(failsafeTimeoutRef?.current);
          failsafeTimeoutRef.current = null;
        }
        
        console.log('BOOTSTRAP: ✅ completed (finally block)');
      }
    };

    bootstrapTenant();
  }, [session, loading]); // Depend on session and loading

  // Reload user from localStorage on mount and when storage changes
  useEffect(() => {
    const handleStorageChange = () => {
      setCurrentUser(getCurrentUser());
      setCurrentTenantId(localStorage.getItem('cargo.currentTenantId') || null);
      setActiveTenantId(localStorage.getItem('cargo_active_tenant_id') || null);
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  const refreshUser = () => {
    setCurrentUser(getCurrentUser());
    setCurrentTenantId(localStorage.getItem('cargo.currentTenantId') || null);
    setActiveTenantId(localStorage.getItem('cargo_active_tenant_id') || null);
  };

  const setCurrentTenant = (tenantId) => {
    if (tenantId) {
      localStorage.setItem('cargo.currentTenantId', tenantId);
    } else {
      localStorage.removeItem('cargo.currentTenantId');
    }
    setCurrentTenantId(tenantId);
  };

  const updateActiveTenantId = (tenantId) => {
    if (tenantId) {
      localStorage.setItem('cargo_active_tenant_id', tenantId);
      setActiveTenantId(tenantId);
    } else {
      localStorage.removeItem('cargo_active_tenant_id');
      setActiveTenantId(null);
    }
  };
  
  // Retry bootstrap function
  const retryBootstrap = () => {
    console.log('[AUTH] 🔄 Retry bootstrap requested');
    setShowFailsafeDebug(false);
    setLoading(true);
    setTenantError(null);
    lastBootstrappedUserId.current = null;
    bootstrapInProgress.current = false;
    setBootstrapComplete(false); // Reset completion flag
    setLastBootstrapStep('retry_requested');
    
    // Trigger bootstrap by updating session reference
    setSession(prev => ({ ...prev }));
  };

  // Add this function declaration
  const clearCurrentUser = () => {
    setCurrentUser(null);
    setCurrentTenantId(null);
    setActiveTenantId(null);
    localStorage.removeItem('cargo.currentTenantId');
    localStorage.removeItem('cargo_active_tenant_id');
  };

  // Authorization helpers
  const isCommand = currentUser && hasCommandAccess(currentUser);
  const isChief = currentUser && hasChiefAccess(currentUser);
  const isHOD = currentUser && hasHODAccess(currentUser);
  const isChiefStew = currentUser?.roleId === 'role-8';
  const isCrew = currentUser?.tier === 'CREW';

  const value = { 
    currentUser,
    setCurrentUser,
    currentTenantId,
    setCurrentTenantId,
    activeTenantId,
    setActiveTenantId: (id) => {
      setActiveTenantId(id);
      localStorage.setItem('cargo_active_tenant_id', id);
    },
    updateActiveTenantId: (id) => {
      setActiveTenantId(id);
      localStorage.setItem('cargo_active_tenant_id', id);
    },
    session,
    user,
    loading,
    tenantLoading,
    hasTenant,
    tenantRole,
    tenantError,
    bootstrapComplete,
    bootstrapStatus,
    refreshUser,
    setCurrentTenant,
    isCommand,
    isChief,
    isHOD,
    isChiefStew,
    isCrew,
    retryBootstrap: () => {
      console.log('[AUTH] Manual retry triggered');
      lastBootstrappedUserId.current = null;
      bootstrapInProgress.current = false;
      setBootstrapComplete(false);
      setTenantError(null);
      setLoading(true); // Triggers [session, loading] bootstrap effect
    },
    signOut: async () => {
      await supabase?.auth?.signOut();
      clearCurrentUser();
    }
  };
  
  // Log context value on every render (for debugging)
  console.log('[AUTH] 📊 Current auth context:', {
    hasSession: !!session,
    userId: user?.id,
    loading,
    tenantLoading,
    hasTenant,
    tenantId: activeTenantId,
    tenantRole,
    tenantError,
    bootstrapComplete,
    bootstrapStatus,
    lastBootstrapStep
  });

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        setCurrentUser,
        currentTenantId,
        setCurrentTenantId,
        activeTenantId,
        setActiveTenantId,
        updateActiveTenantId,
        session,
        user,
        loading,
        tenantRole,
        tenantError,
        tenantLoading,
        hasTenant,
        bootstrapComplete,
        bootstrapStatus,
        retryBootstrap,
        hasCommandAccess: () => hasCommandAccess(currentUser),
        hasChiefAccess: () => hasChiefAccess(currentUser),
        hasHODAccess: () => hasHODAccess(currentUser),
      }}
    >
      <TenantProvider authSession={session} authUser={user}>
        {tenantError && (
          <div className="fixed top-0 left-0 right-0 z-50 bg-red-50 border-b border-red-200 p-4">
            <div className="max-w-7xl mx-auto flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-red-900">Bootstrap Error</h3>
                  <p className="text-sm text-red-700">{tenantError}</p>
                </div>
              </div>
              <button
                onClick={() => setTenantError(null)}
                className="text-red-600 hover:text-red-800 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        )}
        {showFailsafeDebug && (
          <FailsafeDebugPanel
            session={session}
            user={user}
            tenantId={activeTenantId}
            tenantRole={tenantRole}
            lastBootstrapStep={lastBootstrapStep}
            tenantError={tenantError}
            onRetry={retryBootstrap}
          />
        )}
        <VesselFallbackUI />
        {children}
      </TenantProvider>
    </AuthContext.Provider>
  );
};

// Failsafe Debug Panel Component
const FailsafeDebugPanel = ({ session, user, tenantId, tenantRole, lastBootstrapStep, tenantError, onRetry }) => {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
            <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Bootstrap Timeout</h2>
            <p className="text-sm text-gray-600">Authentication bootstrap took longer than expected</p>
          </div>
        </div>
        
        <div className="bg-gray-50 rounded-lg p-4 mb-4 space-y-2">
          <h3 className="font-medium text-gray-900 mb-3">Debug Information</h3>
          
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-gray-600">Session exists:</span>
              <span className={`ml-2 font-medium ${session ? 'text-green-600' : 'text-red-600'}`}>
                {session ? '✓ Yes' : '✗ No'}
              </span>
            </div>
            
            <div>
              <span className="text-gray-600">User ID:</span>
              <span className="ml-2 font-mono text-xs">
                {user?.id ? user?.id?.substring(0, 8) + '...' : 'null'}
              </span>
            </div>
            
            <div>
              <span className="text-gray-600">Tenant ID:</span>
              <span className="ml-2 font-mono text-xs">
                {tenantId ? tenantId?.substring(0, 8) + '...' : 'null'}
              </span>
            </div>
            
            <div>
              <span className="text-gray-600">Role:</span>
              <span className="ml-2 font-medium">
                {tenantRole || 'null'}
              </span>
            </div>
            
            <div className="col-span-2">
              <span className="text-gray-600">Last bootstrap step:</span>
              <span className="ml-2 font-medium text-blue-600">
                {lastBootstrapStep}
              </span>
            </div>
            
            {tenantError && (
              <div className="col-span-2">
                <span className="text-gray-600">Last error:</span>
                <div className="mt-1 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-xs">
                  {tenantError}
                </div>
              </div>
            )}
          </div>
        </div>
        
        <div className="flex gap-3">
          <button
            onClick={onRetry}
            className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            Retry Bootstrap
          </button>
          <button
            onClick={() => window.location.href = '/login-authentication'}
            className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors font-medium text-gray-700"
          >
            Back to Login
          </button>
        </div>
        
        <p className="text-xs text-gray-500 mt-4 text-center">
          If this issue persists, please contact support with the debug information above.
        </p>
      </div>
    </div>
  );
};

// Route change logger component
export const RouteChangeLogger = () => {
  const location = useLocation();
  const { session, user, loading, activeTenantId, tenantRole } = useAuth();

  useEffect(() => {
    console.log('[ROUTE_CHANGE] 🧭 Navigation detected:', {
      path: location?.pathname,
      search: location?.search,
      authLoading: loading,
      hasSession: !!session,
      userId: user?.id,
      tenantId: activeTenantId,
      tenantRole: tenantRole,
      timestamp: new Date()?.toISOString()
    });
  }, [location, session, user, loading, activeTenantId, tenantRole]);

  return null;
};

export default AuthContext;