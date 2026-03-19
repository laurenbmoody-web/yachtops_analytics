import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../../lib/supabaseClient';
import Icon from '../../components/AppIcon';
import { normalizeAccountType } from '../../utils/accountTypeHelpers';

const PostLoginRouter = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [routingComplete, setRoutingComplete] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const timeoutRef = useRef(null);

  useEffect(() => {
    if (!routingComplete) {
      // Start 8-second timeout
      timeoutRef.current = setTimeout(() => {
        if (loading && !routingComplete) {
          console.error('⏱️ PostLoginRouter: 8-second timeout reached');
          setTimedOut(true);
          setLoading(false);
          setError('Unable to load permissions. This may be due to a network issue or missing access.');
        }
      }, 8000);

      performRouting();
    }

    return () => {
      if (timeoutRef?.current) {
        clearTimeout(timeoutRef?.current);
      }
    };
  }, []);

  const performRouting = async () => {
    try {
      setLoading(true);
      setError(null);
      setTimedOut(false);

      console.log('🔄 PostLoginRouter: Starting routing decision...');

      // Get authenticated user
      const { data: { user }, error: authError } = await supabase?.auth?.getUser();
      
      if (authError || !user) {
        console.error('❌ PostLoginRouter: No authenticated user', authError);
        clearTimeout(timeoutRef?.current);
        // DO NOT redirect here - ProtectedRoute handles this
        return;
      }

      console.log('✅ PostLoginRouter: User authenticated', { uid: user?.id });

      // Fetch profile with account_type and last_active_tenant_id
      const { data: profile, error: profileError } = await supabase
        ?.from('profiles')
        ?.select('id, account_type, last_active_tenant_id')
        ?.eq('id', user?.id)
        ?.single();

      if (profileError) {
        console.error('❌ PostLoginRouter: Profile fetch error', profileError);
        clearTimeout(timeoutRef?.current);
        setError('Unable to load your profile. Please try again.');
        setLoading(false);
        return;
      }

      if (!profile) {
        console.error('❌ PostLoginRouter: Profile not found');
        clearTimeout(timeoutRef?.current);
        setError('Profile not found. Please contact support.');
        setLoading(false);
        return;
      }

      const rawAccountType = profile?.account_type;
      const normalizedAccountType = normalizeAccountType(rawAccountType);

      console.log('📋 PostLoginRouter: Profile loaded', {
        uid: user?.id,
        account_type_raw: rawAccountType,
        account_type_normalized: normalizedAccountType,
        last_active_tenant_id: profile?.last_active_tenant_id
      });

      // Check tenant memberships for ALL users (not just vessel)
      const { data: memberships, error: membershipsError } = await supabase
        ?.from('tenant_members')
        ?.select('tenant_id, role, active')
        ?.eq('user_id', user?.id)
        ?.eq('active', true);

      if (membershipsError) {
        console.error('⚠️ PostLoginRouter: Tenant memberships query error', membershipsError);
        clearTimeout(timeoutRef?.current);
        setError('Unable to verify vessel access. Please try again.');
        setLoading(false);
        return;
      }

      // CRITICAL: Stop if zero rows returned from tenant_members
      const hasTenantMembership = memberships && memberships?.length > 0;

      console.log('🔍 PostLoginRouter: Tenant memberships check', {
        memberships_count: memberships?.length || 0,
        has_membership: hasTenantMembership
      });

      // If no memberships found, stop checking immediately
      if (!hasTenantMembership) {
        console.log('⚠️ PostLoginRouter: No tenant memberships found, stopping checks');
      }

      // ROUTING DECISION LOGIC
      let destinationRoute = null;

      // Priority 1: Users with tenant memberships go to main dashboard
      if (hasTenantMembership) {
        destinationRoute = '/dashboard';
        console.log('✅ PostLoginRouter: User has tenant membership → /dashboard');
      }
      // Priority 2: Personal users without membership go to personal dashboard
      else if (normalizedAccountType === 'personal') {
        destinationRoute = '/dashboard-personal';
        console.log('✅ PostLoginRouter: Personal user without membership → /dashboard-personal');
      }
      // Priority 3: Vessel users without membership go to create vessel
      else if (normalizedAccountType === 'vessel') {
        destinationRoute = '/create-vessel';
        console.log('✅ PostLoginRouter: Vessel user without membership → /create-vessel');
      }
      // Priority 4: Crew users without membership (edge case)
      else if (normalizedAccountType === 'crew') {
        destinationRoute = '/dashboard-personal';
        console.log('⚠️ PostLoginRouter: Crew user without membership → /dashboard-personal (fallback)');
      }
      // Priority 5: Unknown account type - redirect to get started
      else {
        destinationRoute = '/get-started';
        console.log('⚠️ PostLoginRouter: Unknown account type → /get-started', { normalizedAccountType });
      }

      // Prevent redirect loop: check if already on destination
      if (location?.pathname === destinationRoute) {
        console.log('🔁 PostLoginRouter: Already on destination route, stopping to prevent loop');
        clearTimeout(timeoutRef?.current);
        setRoutingComplete(true);
        setLoading(false);
        return;
      }

      console.log('🚀 PostLoginRouter: Navigating to:', destinationRoute);
      clearTimeout(timeoutRef?.current);
      setRoutingComplete(true);
      navigate(destinationRoute, { replace: true });

    } catch (err) {
      console.error('❌ PostLoginRouter: Unexpected error', err);
      clearTimeout(timeoutRef?.current);
      setError('An unexpected error occurred. Please try again.');
      setLoading(false);
    }
  };

  const handleRetry = () => {
    setRoutingComplete(false);
    setTimedOut(false);
    performRouting();
  };

  const handleGoToLogin = () => {
    navigate('/login-authentication', { replace: true });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Icon name="Loader2" size={48} className="text-primary animate-spin mx-auto mb-4" />
          <p className="text-lg text-foreground">Loading your vessel access...</p>
          <p className="text-sm text-muted-foreground mt-2">Checking permissions</p>
        </div>
      </div>
    );
  }

  if (error || timedOut) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-card border border-border rounded-lg p-6 text-center">
          <Icon name="AlertCircle" size={48} className="text-error mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-foreground mb-2">
            {timedOut ? 'Request Timed Out' : 'Unable to Load Profile'}
          </h2>
          <p className="text-muted-foreground mb-6">{error}</p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={handleRetry}
              className="px-6 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-smooth"
            >
              Retry
            </button>
            <button
              onClick={handleGoToLogin}
              className="px-6 py-2 bg-secondary text-secondary-foreground border border-border rounded-lg hover:bg-secondary/80 transition-smooth"
            >
              Go to Login
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
};

export default PostLoginRouter;