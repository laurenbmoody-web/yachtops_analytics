import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../../lib/supabaseClient';
import Icon from '../../components/AppIcon';
import { normalizeAccountType } from '../../utils/accountTypeHelpers';

const PostAuthenticationRouterSessionManager = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [debugInfo, setDebugInfo] = useState({
    session: null,
    accountType: null,
    memberships: 0,
    route: null
  });
  const [routingComplete, setRoutingComplete] = useState(false);

  useEffect(() => {
    if (!routingComplete) {
      performRouting();
    }
  }, []);

  const performRouting = async () => {
    try {
      setLoading(true);
      setError(null);

      console.log('🔄 POST-AUTH: Starting routing decision...');

      // Step 1: Get Supabase session
      const { data: { session }, error: sessionError } = await supabase?.auth?.getSession();
      
      if (sessionError || !session) {
        console.error('❌ POST-AUTH: No session found', sessionError);
        setDebugInfo({ session: 'no', accountType: null, memberships: 0, route: '/login-authentication' });
        navigate('/login-authentication', { replace: true });
        return;
      }

      const user = session?.user;
      console.log('✅ POST-AUTH: Session found', { uid: user?.id });

      // Step 2: Fetch profile
      const { data: profile, error: profileError } = await supabase
        ?.from('profiles')
        ?.select('id, account_type, full_name')
        ?.eq('id', user?.id)
        ?.single();

      if (profileError) {
        console.error('❌ POST-AUTH: Profile fetch error', profileError);
        setError('Unable to load your profile. Please try again.');
        setLoading(false);
        return;
      }

      if (!profile) {
        console.error('❌ POST-AUTH: Profile not found');
        setError('Profile not found. Please contact support.');
        setLoading(false);
        return;
      }

      const rawAccountType = profile?.account_type;
      const normalizedAccountType = normalizeAccountType(rawAccountType);

      console.log('📋 POST-AUTH: Profile loaded', {
        uid: user?.id,
        account_type_raw: rawAccountType,
        account_type_normalized: normalizedAccountType
      });

      // Step 3: Fetch active memberships
      const { data: memberships, error: membershipsError } = await supabase
        ?.from('tenant_members')
        ?.select('tenant_id, role, active')
        ?.eq('user_id', user?.id)
        ?.eq('active', true);

      if (membershipsError) {
        console.error('⚠️ POST-AUTH: Tenant memberships query error', membershipsError);
      }

      const membershipCount = memberships?.length || 0;
      const hasTenantMembership = membershipCount > 0;

      console.log('🔍 POST-AUTH: Memberships check', {
        count: membershipCount,
        has_membership: hasTenantMembership
      });

      // Step 4: Decide destination
      let destinationRoute = null;

      // Priority 1: Users with tenant memberships go to main dashboard
      if (hasTenantMembership) {
        destinationRoute = '/dashboard';
        console.log('✅ POST-AUTH: User has tenant membership → /dashboard');
      }
      // Priority 2: Personal users without membership go to personal dashboard
      else if (normalizedAccountType === 'personal') {
        destinationRoute = '/dashboard-personal';
        console.log('✅ POST-AUTH: Personal user without membership → /dashboard-personal');
      }
      // Priority 3: Vessel users without membership go to create vessel
      else if (normalizedAccountType === 'vessel') {
        destinationRoute = '/create-vessel-account';
        console.log('✅ POST-AUTH: Vessel user without membership → /create-vessel-account');
      }
      // Priority 4: Unknown account type - show banner on landing page (NO LOOP)
      else {
        destinationRoute = '/public-landing-page';
        console.log('⚠️ POST-AUTH: Unknown account type → landing with banner', { normalizedAccountType });
      }

      // Update debug info
      setDebugInfo({
        session: 'yes',
        accountType: normalizedAccountType || 'unknown',
        memberships: membershipCount,
        route: destinationRoute
      });

      // Guard: Prevent redirect loop - if already on destination, do nothing
      if (location?.pathname === destinationRoute) {
        console.log('🔁 POST-AUTH: Already on destination route, stopping to prevent loop');
        setRoutingComplete(true);
        setLoading(false);
        return;
      }

      console.log('🚀 POST-AUTH: Navigating to:', destinationRoute);
      setRoutingComplete(true);
      navigate(destinationRoute, { replace: true });

    } catch (err) {
      console.error('❌ POST-AUTH: Unexpected error', err);
      setError('An unexpected error occurred. Please try again.');
      setLoading(false);
    }
  };

  const handleRetry = () => {
    setRoutingComplete(false);
    performRouting();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          <Icon name="Loader2" size={48} className="text-primary animate-spin mx-auto mb-4" />
          <p className="text-lg text-foreground font-medium mb-2">Loading your account…</p>
          <p className="text-sm text-muted-foreground">Validating session and routing to your workspace</p>
          
          {/* Debug Info */}
          <div className="mt-6 p-4 bg-muted/30 rounded-lg text-left text-xs font-mono">
            <div className="text-muted-foreground mb-1">Debug Info:</div>
            <div>session: {debugInfo?.session || 'checking...'}</div>
            <div>account_type: {debugInfo?.accountType || 'loading...'}</div>
            <div>memberships: {debugInfo?.memberships}</div>
            <div>route: {debugInfo?.route || 'deciding...'}</div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-card border border-border rounded-lg p-6 text-center">
          <Icon name="AlertCircle" size={48} className="text-destructive mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-foreground mb-2">Unable to Load Profile</h2>
          <p className="text-muted-foreground mb-6">{error}</p>
          <button
            onClick={handleRetry}
            className="px-6 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return null;
};

export default PostAuthenticationRouterSessionManager;