import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import { Loader2, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import Button from '../../components/ui/Button';

const LightweightInviteAcceptancePage = () => {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState('loading'); // loading, needs-auth, processing, success, error
  const [errorMessage, setErrorMessage] = useState('');
  const [inviteToken, setInviteToken] = useState('');

  // Extract token from URL on mount
  useEffect(() => {
    const token = searchParams?.get('token');
    
    if (!token) {
      setStatus('error');
      setErrorMessage('Invalid invite link. No token provided.');
      return;
    }

    setInviteToken(token);
  }, [searchParams]);

  // Process invite when token is available
  useEffect(() => {
    if (!inviteToken) return;

    const processInvite = async () => {
      // Check if user is authenticated
      if (!currentUser) {
        setStatus('needs-auth');
        return;
      }

      // User is authenticated, process invite
      setStatus('processing');

      try {
        // Call accept_crew_invite_v2 RPC (no get_my_context needed)
        const { data: rpcResult, error: inviteError } = await supabase?.rpc('accept_crew_invite_v2', {
          p_token: inviteToken
        });

        if (inviteError) {
          console.error('Invite acceptance error:', inviteError);
          const errorMsg = inviteError?.message || 'Unknown error';

          if (errorMsg?.includes('expired') || errorMsg?.includes('invalid')) {
            setErrorMessage('This invite link is invalid or expired. Please contact your administrator.');
          } else if (errorMsg?.includes('email') || errorMsg?.includes('wrong')) {
            setErrorMessage('This invite is for a different email address.');
          } else if (errorMsg?.includes('already') || errorMsg?.includes('used')) {
            setErrorMessage('This invite has already been used.');
          } else {
            setErrorMessage('Unable to accept invite. Please contact your administrator.');
          }

          setStatus('error');
          return;
        }

        // Check RPC result
        if (rpcResult && rpcResult?.length > 0) {
          const result = rpcResult?.[0];

          if (!result?.success) {
            console.error('RPC returned failure:', result?.error_message);
            setErrorMessage(result?.error_message || 'Failed to accept invite');
            setStatus('error');
            return;
          }

          // Success!
          setStatus('success');
          
          // Redirect to dashboard after 2 seconds
          setTimeout(() => {
            navigate('/dashboard', { replace: true });
          }, 2000);
        } else {
          setErrorMessage('Unexpected response from server.');
          setStatus('error');
        }
      } catch (err) {
        console.error('Unexpected error processing invite:', err);
        setErrorMessage('An unexpected error occurred. Please try again.');
        setStatus('error');
      }
    };

    processInvite();
  }, [inviteToken, currentUser, navigate]);

  // Handle authentication actions
  const handleLogin = () => {
    // Store token in localStorage to return after login
    localStorage.setItem('pending_invite_token', inviteToken);
    navigate('/login-authentication');
  };

  const handleSignup = () => {
    // Store token in localStorage to return after signup
    localStorage.setItem('pending_invite_token', inviteToken);
    navigate('/signup-personal');
  };

  const handleBackToLogin = () => {
    navigate('/login-authentication');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full">
        {/* Loading State */}
        {status === 'loading' && (
          <div className="text-center">
            <Loader2 className="w-16 h-16 mx-auto mb-4 text-blue-600 animate-spin" />
            <h1 className="text-2xl font-semibold mb-2">Processing Invite</h1>
            <p className="text-gray-600">Please wait while we load your invitation...</p>
          </div>
        )}

        {/* Needs Authentication */}
        {status === 'needs-auth' && (
          <>
            <div className="text-center mb-6">
              <div className="w-16 h-16 mx-auto mb-4 bg-blue-100 rounded-full flex items-center justify-center">
                <AlertCircle className="w-10 h-10 text-blue-600" />
              </div>
              <h1 className="text-2xl font-semibold mb-2">Crew Invitation</h1>
              <p className="text-gray-600">
                You've been invited to join a vessel crew on Cargo.
              </p>
            </div>

            <div className="space-y-3">
              <Button
                onClick={handleLogin}
                className="w-full"
              >
                Log In
              </Button>
              <Button
                onClick={handleSignup}
                variant="outline"
                className="w-full"
              >
                Create Account
              </Button>
            </div>

            <p className="text-xs text-gray-500 text-center mt-4">
              You'll be redirected back to accept the invite after authentication.
            </p>
          </>
        )}

        {/* Processing */}
        {status === 'processing' && (
          <div className="text-center">
            <Loader2 className="w-16 h-16 mx-auto mb-4 text-blue-600 animate-spin" />
            <h1 className="text-2xl font-semibold mb-2">Accepting Invite</h1>
            <p className="text-gray-600">Adding you to the crew...</p>
          </div>
        )}

        {/* Success */}
        {status === 'success' && (
          <div className="text-center">
            <CheckCircle className="w-16 h-16 mx-auto mb-4 text-green-500" />
            <h1 className="text-2xl font-semibold mb-2">Welcome Aboard!</h1>
            <p className="text-gray-600 mb-4">
              You've successfully joined the crew.
            </p>
            <p className="text-sm text-gray-500">
              Redirecting to dashboard...
            </p>
          </div>
        )}

        {/* Error */}
        {status === 'error' && (
          <>
            <div className="text-center mb-6">
              <XCircle className="w-16 h-16 mx-auto mb-4 text-red-500" />
              <h1 className="text-2xl font-semibold mb-2">Unable to Accept Invite</h1>
              <p className="text-gray-600 mb-4">
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

export default LightweightInviteAcceptancePage;