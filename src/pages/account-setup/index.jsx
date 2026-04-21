import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Button from '../../components/ui/Button';
import Icon from '../../components/AppIcon';
import LogoSpinner from '../../components/LogoSpinner';
import { supabase } from '../../lib/supabaseClient';
import { normalizeAccountType } from '../../utils/accountTypeHelpers';

const AccountSetup = () => {
  const navigate = useNavigate();
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadAccountInfo();
  }, []);

  const loadAccountInfo = async () => {
    try {
      console.log('🔍 AccountSetup: Loading account information');
      
      // Fetch session
      const { data: { session: currentSession }, error: sessionError } = await supabase?.auth?.getSession();
      
      if (sessionError || !currentSession) {
        console.log('❌ AccountSetup: No session, redirecting to login');
        navigate('/login-authentication', { replace: true });
        return;
      }
      
      setSession(currentSession);
      const authUserId = currentSession?.user?.id;
      
      // Try to fetch profile
      const { data: profileData, error: profileError } = await supabase
        ?.from('profiles')
        ?.select('account_type, full_name, email')
        ?.eq('id', authUserId)
        ?.single();
      
      if (profileError) {
        console.error('❌ AccountSetup: Profile fetch error:', profileError);
        setError('Could not load profile information');
      } else {
        setProfile(profileData);
      }
      
      setLoading(false);
    } catch (err) {
      console.error('❌ AccountSetup: Error loading account:', err);
      setError('An unexpected error occurred');
      setLoading(false);
    }
  };

  const handleRefreshSession = async () => {
    setLoading(true);
    setError(null);
    
    try {
      // Force refresh session
      const { data: { session: refreshedSession }, error: refreshError } = await supabase?.auth?.refreshSession();
      
      if (refreshError) {
        throw refreshError;
      }
      
      console.log('✅ AccountSetup: Session refreshed, retrying post-auth');
      navigate('/post-auth', { replace: true });
    } catch (err) {
      console.error('❌ AccountSetup: Session refresh failed:', err);
      setError('Session refresh failed. Please log in again.');
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await supabase?.auth?.signOut();
    navigate('/login-authentication', { replace: true });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="text-center">
          <LogoSpinner size={48} className="mx-auto mb-4" />
          <p className="text-lg text-foreground">Loading account information...</p>
        </div>
      </div>
    );
  }

  const accountType = normalizeAccountType(profile?.account_type);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-yellow-100 dark:bg-yellow-900/20 rounded-full mb-4">
            <Icon name="AlertTriangle" size={32} className="text-yellow-600 dark:text-yellow-500" />
          </div>
          <h1 className="text-3xl font-semibold text-foreground mb-2">Account Setup Required</h1>
          <p className="text-base text-muted-foreground">We couldn't determine your workspace yet</p>
        </div>

        {/* Main Card */}
        <div className="bg-card border border-border rounded-2xl p-8 shadow-sm mb-6">
          {/* Session Info */}
          <div className="mb-6 p-4 bg-muted/50 rounded-lg">
            <h3 className="text-sm font-semibold text-foreground mb-2">Account Information</h3>
            <div className="space-y-1 text-xs text-muted-foreground font-mono">
              <div><span className="font-semibold">Email:</span> {session?.user?.email || 'Unknown'}</div>
              <div><span className="font-semibold">Account Type:</span> {profile?.account_type || 'Not set'}</div>
              <div><span className="font-semibold">Status:</span> {error ? 'Error' : 'Incomplete setup'}</div>
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <div className="flex items-start gap-3">
                <Icon name="AlertCircle" size={20} className="text-red-600 dark:text-red-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-red-900 dark:text-red-200 mb-1">Setup Error</p>
                  <p className="text-xs text-red-700 dark:text-red-300">{error}</p>
                </div>
              </div>
            </div>
          )}

          {/* Action Options */}
          <div className="space-y-3">
            <h3 className="text-base font-semibold text-foreground mb-3">Choose an option to continue:</h3>
            
            {/* Personal Dashboard Option */}
            {accountType === 'personal' && (
              <Button
                onClick={() => navigate('/dashboard-personal')}
                className="w-full h-12"
                iconName="User"
                iconPosition="left"
              >
                Go to Personal Dashboard
              </Button>
            )}

            {/* Join Vessel Option */}
            <Button
              onClick={() => navigate('/invite-accept')}
              variant="outline"
              className="w-full h-12"
              iconName="UserPlus"
              iconPosition="left"
            >
              Join Vessel via Invite
            </Button>

            {/* Create Vessel Option */}
            {(accountType === 'vessel' || !accountType) && (
              <Button
                onClick={() => navigate('/vessel-signup-flow-step-1')}
                variant="outline"
                className="w-full h-12"
                iconName="Ship"
                iconPosition="left"
              >
                Create Vessel Account
              </Button>
            )}

            {/* Refresh Session */}
            <Button
              onClick={handleRefreshSession}
              variant="ghost"
              className="w-full h-12"
              iconName="RefreshCw"
              iconPosition="left"
            >
              Refresh Session & Retry
            </Button>
          </div>
        </div>

        {/* Logout Option */}
        <div className="text-center">
          <Button
            onClick={handleLogout}
            variant="ghost"
            className="text-sm"
          >
            Log out and start over
          </Button>
        </div>

        {/* Help Text */}
        <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
          <div className="flex items-start gap-3">
            <Icon name="Info" size={20} className="text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-blue-900 dark:text-blue-200">
              <p className="font-semibold mb-1">Need Help?</p>
              <p>If you're experiencing issues, try refreshing your session or logging out and back in. If the problem persists, contact your vessel administrator or support.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AccountSetup;