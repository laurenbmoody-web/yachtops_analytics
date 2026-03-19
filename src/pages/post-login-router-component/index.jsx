import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../components/AppIcon';
import Image from '../../components/AppImage';
import { supabase } from '../../lib/supabaseClient';
import { useTheme } from '../../contexts/ThemeContext';

const PostLoginRouter = () => {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [routingComplete, setRoutingComplete] = useState(false);

  useEffect(() => {
    if (!routingComplete) {
      routeUser();
    }
  }, [routingComplete]);

  const routeUser = async () => {
    try {
      setLoading(true);
      setError('');

      // Get authenticated user
      const { data: { user }, error: authError } = await supabase?.auth?.getUser();

      if (authError || !user) {
        console.error('PostLoginRouter: No authenticated user', authError);
        // DO NOT redirect here - ProtectedRoute handles this
        return;
      }

      console.log('PostLoginRouter: User authenticated', user?.id);

      // Fetch profile
      const { data: profile, error: profileError } = await supabase
        ?.from('profiles')
        ?.select('id, account_type, last_active_tenant_id')
        ?.eq('id', user?.id)
        ?.single();

      if (profileError) {
        console.error('PostLoginRouter: Profile fetch error', profileError);
        setError('Unable to load your profile. Please try again.');
        setLoading(false);
        return;
      }

      if (!profile) {
        console.error('PostLoginRouter: Profile not found');
        setError('Profile not found. Please contact support.');
        setLoading(false);
        return;
      }

      console.log('PostLoginRouter: Profile loaded', profile);

      // Routing logic based on account_type
      if (profile?.account_type === 'personal') {
        console.log('PostLoginRouter: Personal account detected, routing to /dashboard-personal');
        setRoutingComplete(true);
        navigate('/dashboard-personal');
        return;
      }

      if (profile?.account_type === 'vessel') {
        // Check if user has any active tenant membership
        const { data: tenantMemberships, error: membershipError } = await supabase
          ?.from('tenant_members')
          ?.select('tenant_id, role, active')
          ?.eq('user_id', user?.id)
          ?.eq('active', true)
          ?.limit(1);

        if (membershipError) {
          console.error('PostLoginRouter: Membership check error', membershipError);
          setError('Unable to verify vessel membership. Please try again.');
          setLoading(false);
          return;
        }

        if (tenantMemberships && tenantMemberships?.length > 0) {
          console.log('PostLoginRouter: Vessel account with tenant membership, routing to /dashboard');
          setRoutingComplete(true);
          navigate('/dashboard');
          return;
        } else {
          console.log('PostLoginRouter: Vessel account without tenant, routing to /create-vessel');
          setRoutingComplete(true);
          navigate('/vessel-signup-flow-step-1');
          return;
        }
      }

      // Fallback: if account_type is null or unknown, default to dashboard
      console.log('PostLoginRouter: Unknown account type, defaulting to /dashboard');
      setRoutingComplete(true);
      navigate('/dashboard');
    } catch (err) {
      console.error('PostLoginRouter: Routing error', err);
      setError('An unexpected error occurred. Please try again.');
      setLoading(false);
    }
  };

  const handleRetry = () => {
    setRoutingComplete(false);
    setError('');
    routeUser();
  };

  if (loading && !error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-4">
            <Image
              src={theme === 'night' ? '/assets/images/Cargo_20logo_20solid_20beige-1767558154320.svg' : '/assets/images/Cargo_20logo_20solid_20navy-1767558047979.svg'}
              alt="Cargo Logo"
              className="w-10 h-10"
            />
          </div>
          <div className="flex items-center justify-center gap-3 mb-2">
            <Icon name="Loader2" size={24} className="text-primary animate-spin" />
            <p className="text-lg font-medium text-foreground">Loading your workspace...</p>
          </div>
          <p className="text-sm text-muted-foreground">Please wait while we set things up</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-4">
              <Image
                src={theme === 'night' ? '/assets/images/Cargo_20logo_20solid_20beige-1767558154320.svg' : '/assets/images/Cargo_20logo_20solid_20navy-1767558047979.svg'}
                alt="Cargo Logo"
                className="w-10 h-10"
              />
            </div>
            <h1 className="text-2xl font-semibold text-foreground mb-2">Unable to Continue</h1>
          </div>

          <div className="bg-card border border-border rounded-2xl p-8 shadow-sm">
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 flex items-start gap-3 mb-6">
              <Icon name="AlertCircle" size={20} className="text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-red-800 dark:text-red-200 mb-1">{error}</p>
                <p className="text-xs text-red-700 dark:text-red-300">If this problem persists, please contact support.</p>
              </div>
            </div>

            <button
              onClick={handleRetry}
              className="w-full px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
            >
              <Icon name="RefreshCw" size={16} />
              Retry
            </button>

            <button
              onClick={() => navigate('/login-authentication')}
              className="w-full mt-3 px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Back to Login
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
};

export default PostLoginRouter;