import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabaseClient';
import { normalizeAccountType } from '../../utils/accountTypeHelpers';

const PostAuth = () => {
  const navigate = useNavigate();

  useEffect(() => {
    routeUser();
  }, []);

  const routeUser = async () => {
    try {
      console.log('🔐 POST-AUTH: Starting routing decision');
      
      // Step 1: Fetch Supabase session
      const { data: { session }, error: sessionError } = await supabase?.auth?.getSession();
      
      if (sessionError || !session) {
        console.log('❌ POST-AUTH: No session found, redirecting to login');
        navigate('/login-authentication', { replace: true });
        return;
      }
      
      const authUserId = session?.user?.id;
      
      if (!authUserId) {
        console.error('❌ POST-AUTH: No user ID in session');
        navigate('/login-authentication', { replace: true });
        return;
      }
      
      console.log('✅ POST-AUTH: Session found for user:', authUserId);
      
      // Step 2: Fetch profile with fail-safe
      const { data: profile, error: profileError } = await supabase
        ?.from('profiles')
        ?.select('account_type, last_active_tenant_id')
        ?.eq('id', authUserId)
        ?.single();
      
      if (profileError) {
        console.error('❌ POST-AUTH: Error fetching profile:', profileError);
        console.log('🛡️ POST-AUTH: Profile fetch failed → /account-setup');
        navigate('/account-setup', { replace: true });
        return;
      }
      
      const rawAccountType = profile?.account_type || null;
      const normalized = normalizeAccountType(rawAccountType);
      
      console.log('📋 POST-AUTH: Profile account_type:', rawAccountType, '→ normalized:', normalized);
      
      // Step 3: Fetch active memberships with fail-safe
      const { data: memberships, error: membershipsError } = await supabase
        ?.from('tenant_members')
        ?.select('tenant_id')
        ?.eq('user_id', authUserId)
        ?.eq('active', true);
      
      if (membershipsError) {
        console.error('❌ POST-AUTH: Error fetching memberships:', membershipsError);
        console.log('🛡️ POST-AUTH: Memberships query failed → /account-setup');
        navigate('/account-setup', { replace: true });
        return;
      }
      
      const membershipCount = memberships?.length || 0;
      console.log('🏢 POST-AUTH: Active memberships:', membershipCount);
      
      // Step 4: Decide destination based on routing rules
      let destination = null;
      
      // Rule A: Personal account → /dashboard-personal
      if (normalized === 'personal') {
        destination = '/dashboard-personal';
        console.log('🎯 POST-AUTH: Personal account → /dashboard-personal');
      }
      // Rule B: Vessel/Crew with active tenant membership
      else if (membershipCount > 0) {
        destination = '/dashboard';
        console.log('🎯 POST-AUTH: User has memberships → /dashboard');
      }
      // Rule C: Vessel account without tenant → /create-vessel-account
      else if (normalized === 'vessel') {
        destination = '/create-vessel-account';
        console.log('🎯 POST-AUTH: Vessel account without tenant → /create-vessel-account');
      }
      // Rule D: Crew account without tenant → /invite-accept
      else if (normalized === 'crew') {
        destination = '/invite-accept';
        console.log('🎯 POST-AUTH: Crew account without tenant → /invite-accept');
      }
      // Rule E: Unknown/null account type → fail-safe to account-setup
      else {
        destination = '/account-setup';
        console.log('⚠️ POST-AUTH: Unknown account type → /account-setup (fail-safe)');
      }
      
      // Guard: if already on destination, do nothing
      if (window.location?.pathname === destination) {
        console.log('✅ POST-AUTH: Already on destination, stopping');
        return;
      }
      
      // Navigate to destination immediately (no delay)
      console.log('🚀 POST-AUTH: Navigating to:', destination);
      navigate(destination, { replace: true });
      
    } catch (err) {
      console.error('❌ POST-AUTH: Routing error:', err);
      navigate('/account-setup', { replace: true });
    }
  };

  // Return null - no visible UI, routing happens in background
  return null;
};

export default PostAuth;