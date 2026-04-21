import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Icon from '../../components/AppIcon';
import Image from '../../components/AppImage';
import LogoSpinner from '../../components/LogoSpinner';
import Button from '../../components/ui/Button';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { showToast } from '../../utils/toast';

const CrewInviteAcceptancePage = () => {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const { currentUser } = useAuth();
  const [searchParams] = useSearchParams();
  const [token, setToken] = useState('');
  const [status, setStatus] = useState('loading'); // loading, no-token, auth-required, processing, success, error
  const [errorMessage, setErrorMessage] = useState('');
  const [vesselName, setVesselName] = useState('');

  // A) STORE TOKEN IMMEDIATELY ON PAGE LOAD
  useEffect(() => {
    const inviteToken = searchParams?.get('token');
    
    console.log('INVITE: token detected:', inviteToken ? 'YES' : 'NO');
    
    if (!inviteToken) {
      console.log('INVITE: no token in URL');
      // Check localStorage for pending token
      const storedToken = localStorage.getItem('pending_invite_token');
      if (storedToken) {
        console.log('INVITE: found stored token');
        setToken(storedToken);
      } else {
        setStatus('no-token');
        return;
      }
    } else {
      // Store token immediately
      localStorage.setItem('pending_invite_token', inviteToken);
      console.log('INVITE: stored token');
      setToken(inviteToken);
    }
  }, [searchParams]);

  // C) AUTH GATE - Check authentication status
  useEffect(() => {
    if (!token) return;

    const checkAuth = async () => {
      try {
        const { data: { session }, error } = await supabase?.auth?.getSession();
        
        if (error) {
          console.error('INVITE: session check error:', error);
        }

        if (session?.user) {
          console.log('INVITE: user authed');
          // User is authenticated, process invite
          processInvite(token, session?.user?.id);
        } else {
          console.log('INVITE: user not authed');
          // User not authenticated, show auth options
          setStatus('auth-required');
        }
      } catch (err) {
        console.error('INVITE: auth check error:', err);
        setStatus('auth-required');
      }
    };

    checkAuth();
  }, [token]);

  // E) ACCEPT INVITE AFTER AUTH
  const processInvite = async (inviteToken, userId) => {
    setStatus('processing');
    console.log('INVITE: calling accept_crew_invite_v2');

    try {
      // Call accept_crew_invite_v2 RPC
      const { data: rpcResult, error: inviteError } = await supabase?.rpc('accept_crew_invite_v2', { 
        p_token: inviteToken 
      });

      if (inviteError) {
        console.error('INVITE: error:', inviteError);
        const errorMsg = inviteError?.message || 'Unknown error';
        
        if (errorMsg?.includes('expired') || errorMsg?.includes('invalid')) {
          setErrorMessage('This invite link is invalid or expired. Ask COMMAND to resend.');
        } else if (errorMsg?.includes('email') || errorMsg?.includes('wrong')) {
          setErrorMessage('This invite is for a different email address.');
        } else if (errorMsg?.includes('already') || errorMsg?.includes('used')) {
          setErrorMessage('This invite has already been used.');
        } else {
          setErrorMessage('Unable to accept invite. Please contact your administrator.');
        }
        
        setStatus('error');
        localStorage.removeItem('pending_invite_token');
        return;
      }

      console.log('INVITE: success', rpcResult);

      if (rpcResult && rpcResult?.length > 0) {
        const result = rpcResult?.[0];
        
        if (!result?.success) {
          console.error('INVITE: RPC returned failure:', result?.error_message);
          setErrorMessage(result?.error_message || 'Failed to accept invite');
          setStatus('error');
          localStorage.removeItem('pending_invite_token');
          return;
        }
        
        const returnedTenantId = result?.tenant_id;
        const returnedVesselName = result?.vessel_name || 'the vessel';
        
        console.log('INVITE: joined tenant_id:', returnedTenantId);
        
        // Update profiles.last_active_tenant_id
        if (returnedTenantId) {
          await supabase
            ?.from('profiles')
            ?.update({ last_active_tenant_id: returnedTenantId })
            ?.eq('id', userId);
        }
        
        // Clear localStorage
        localStorage.removeItem('pending_invite_token');
        
        setVesselName(returnedVesselName);
        setStatus('success');
        
        // Show success toast
        showToast(`Invite accepted — you've joined ${returnedVesselName}`, 'success');
        
        // Redirect to dashboard after 800ms
        setTimeout(() => {
          navigate('/dashboard');
        }, 800);
      }
    } catch (err) {
      console.error('INVITE: unexpected error:', err);
      setErrorMessage('An unexpected error occurred. Please try again.');
      setStatus('error');
      localStorage.removeItem('pending_invite_token');
    }
  };

  // D) PRESERVE INVITE THROUGH LOGIN/SIGNUP
  const handleLoginClick = () => {
    console.log('INVITE: navigating to login with token preserved');
    // Token already stored in localStorage, just navigate
    navigate('/login-authentication');
  };

  const handleSignupClick = () => {
    console.log('INVITE: navigating to signup with token preserved');
    // Token already stored in localStorage, just navigate
    navigate('/vessel-signup-flow-step-1');
  };

  const handleBackToLogin = () => {
    navigate('/login-authentication');
  };

  return (
    <div className={`min-h-screen flex items-center justify-center p-4 ${
      theme === 'night' ? 'bg-gray-900' : 'bg-gray-50'
    }`}>
      <div className={`w-full max-w-md rounded-2xl shadow-lg p-8 ${
        theme === 'night' ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
      }`}>
        {/* Logo */}
        <div className="flex justify-center mb-6">
          <Image
            src={theme === 'night' ? '/assets/images/Cargo_20logo_20solid_20beige-1767558154320.svg' : '/assets/images/Cargo_20logo_20solid_20navy-1767558047979.svg'}
            alt="Cargo Logo"
            className="h-12"
          />
        </div>

        {/* Loading State */}
        {status === 'loading' && (
          <div className="text-center">
            <LogoSpinner size={64} className="mx-auto mb-4" />
            <h1 className="text-2xl font-semibold mb-2">Loading...</h1>
          </div>
        )}

        {/* No Token */}
        {status === 'no-token' && (
          <>
            <div className="text-center mb-6">
              <Icon name="AlertCircle" className="w-16 h-16 mx-auto mb-4 text-red-500" />
              <h1 className="text-2xl font-semibold mb-2">Invalid Invite Link</h1>
              <p className={theme === 'night' ? 'text-gray-400' : 'text-gray-600'}>
                This invite link is invalid or expired.
              </p>
            </div>
            <Button
              onClick={handleBackToLogin}
              className="w-full"
            >
              Back to Login
            </Button>
          </>
        )}

        {/* Auth Required */}
        {status === 'auth-required' && (
          <>
            <div className="text-center mb-6">
              <Icon name="Mail" className="w-16 h-16 mx-auto mb-4 text-blue-500" />
              <h1 className="text-2xl font-semibold mb-2">You've Been Invited!</h1>
              <p className={`mb-4 ${
                theme === 'night' ? 'text-gray-400' : 'text-gray-600'
              }`}>
                You've been invited to join a vessel crew on Cargo.
              </p>
              <p className={theme === 'night' ? 'text-gray-400' : 'text-gray-600'}>
                Please log in or create an account to accept your invitation.
              </p>
            </div>
            <div className="space-y-3">
              <Button
                onClick={handleLoginClick}
                className="w-full"
              >
                Log in to accept invite
              </Button>
              <Button
                onClick={handleSignupClick}
                variant="outline"
                className="w-full"
              >
                Create account to accept invite
              </Button>
            </div>
          </>
        )}

        {/* Processing */}
        {status === 'processing' && (
          <div className="text-center">
            <LogoSpinner size={64} className="mx-auto mb-4" />
            <h1 className="text-2xl font-semibold mb-2">Joining vessel…</h1>
            <p className={theme === 'night' ? 'text-gray-400' : 'text-gray-600'}>
              Please wait while we process your invitation.
            </p>
          </div>
        )}

        {/* Success */}
        {status === 'success' && (
          <div className="text-center">
            <Icon name="CheckCircle" className="w-16 h-16 mx-auto mb-4 text-green-500" />
            <h1 className="text-2xl font-semibold mb-2">Welcome Aboard!</h1>
            <p className={theme === 'night' ? 'text-gray-400' : 'text-gray-600'}>
              You've successfully joined {vesselName}. Redirecting to dashboard...
            </p>
          </div>
        )}

        {/* Error */}
        {status === 'error' && (
          <>
            <div className="text-center mb-6">
              <Icon name="XCircle" className="w-16 h-16 mx-auto mb-4 text-red-500" />
              <h1 className="text-2xl font-semibold mb-2">Unable to Accept Invite</h1>
              <p className={`mb-4 ${
                theme === 'night' ? 'text-gray-400' : 'text-gray-600'
              }`}>
                {errorMessage}
              </p>
            </div>
            <Button
              onClick={handleBackToLogin}
              className="w-full"
            >
              Back to Login
            </Button>
          </>
        )}
      </div>
    </div>
  );
};

export default CrewInviteAcceptancePage;