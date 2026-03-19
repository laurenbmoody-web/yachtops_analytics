import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../components/AppIcon';
import Image from '../../components/AppImage';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import { useTheme } from '../../contexts/ThemeContext';
import { supabase } from '../../lib/supabaseClient';
import { ensureProfileExists } from '../../utils/profileHelpers';
import { showToast } from '../../utils/toast';

const PasswordResetCompletion = () => {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [validSession, setValidSession] = useState(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [noTokenProvided, setNoTokenProvided] = useState(false);

  // Check session on page load
  useEffect(() => {
    checkSession();
  }, []);

  const checkSession = async () => {
    try {
      // CASE A: Check for hash fragment with access_token (type=recovery)
      const hash = window.location?.hash;
      if (hash && hash?.includes('access_token') && hash?.includes('type=recovery')) {
        console.log('Detected hash fragment with access_token');
        const hashParams = new URLSearchParams(hash.substring(1));
        const accessToken = hashParams?.get('access_token');
        const refreshToken = hashParams?.get('refresh_token');

        if (accessToken) {
          try {
            const { data, error: sessionError } = await supabase?.auth?.setSession({
              access_token: accessToken,
              refresh_token: refreshToken
            });

            if (sessionError) {
              console.error('setSession error:', sessionError);
              setValidSession(false);
            } else if (data?.session) {
              console.log('Session established from hash');
              setValidSession(true);
            } else {
              setValidSession(false);
            }
            setCheckingSession(false);
            return;
          } catch (err) {
            console.error('Hash token processing error:', err);
            setValidSession(false);
            setCheckingSession(false);
            return;
          }
        }
      }

      // CASE B: Check for query param token_hash (type=recovery)
      const searchParams = new URLSearchParams(window.location.search);
      const tokenHash = searchParams?.get('token_hash');
      const type = searchParams?.get('type');

      if (tokenHash && type === 'recovery') {
        console.log('Detected query param token_hash');
        try {
          const { data, error: verifyError } = await supabase?.auth?.verifyOtp({
            type: 'recovery',
            token_hash: tokenHash
          });

          if (verifyError) {
            console.error('verifyOtp error:', verifyError);
            setValidSession(false);
          } else if (data?.session) {
            console.log('Session established from token_hash');
            setValidSession(true);
          } else {
            setValidSession(false);
          }
          setCheckingSession(false);
          return;
        } catch (err) {
          console.error('Token hash processing error:', err);
          setValidSession(false);
          setCheckingSession(false);
          return;
        }
      }

      // No token provided - show neutral state
      console.log('No recovery token detected in URL');
      setNoTokenProvided(true);
      setValidSession(false);
      setCheckingSession(false);
    } catch (err) {
      console.error('Session validation error:', err);
      setValidSession(false);
      setCheckingSession(false);
    }
  };

  const handleSubmit = async (e) => {
    e?.preventDefault();
    setError('');
    setSuccess(false);
    setLoading(true);

    // Validate passwords
    if (!newPassword || !confirmPassword) {
      setError('Please enter both password fields');
      setLoading(false);
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      setLoading(false);
      return;
    }

    if (newPassword?.length < 6) {
      setError('Password must be at least 6 characters');
      setLoading(false);
      return;
    }

    try {
      const { error: updateError } = await supabase?.auth?.updateUser({
        password: newPassword
      });

      if (updateError) {
        throw updateError;
      }

      // Ensure profile exists after password reset completion
      const { data: { session } } = await supabase?.auth?.getSession();
      if (session?.user) {
        await ensureProfileExists(session?.user);
      }

      // Show success message
      setSuccess(true);
      setNewPassword('');
      setConfirmPassword('');
      showToast('Password updated successfully!', 'success');

      // Navigate to login page after 2 seconds
      setTimeout(() => {
        navigate('/login-authentication');
      }, 2000);
    } catch (err) {
      console.error('Password update error:', err);
      setError(err?.message || 'Failed to update password. Please try again.');
      showToast('Failed to update password', 'error');
    } finally {
      setLoading(false);
    }
  };

  // Show loading state while checking session
  if (checkingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background transition-colors duration-300 p-4">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Icon name="Loader2" size={24} className="animate-spin" />
          <span>Verifying reset link...</span>
        </div>
      </div>
    );
  }

  // Show neutral state when no token provided
  if (noTokenProvided) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background transition-colors duration-300 px-4 py-8">
        <div className="w-full max-w-md">
          {/* Logo */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-4">
              <Image
                src={theme === 'dark' ? '/assets/images/Cargo_20logo_20solid_20beige-1767558154320.svg' : '/assets/images/Cargo_20logo_20solid_20navy-1767558047979.svg'}
                alt="Cargo Logo"
                className="w-10 h-10"
              />
            </div>
            <h1 className="text-2xl font-semibold text-foreground mb-2">Reset Password</h1>
          </div>

          {/* Neutral State Card */}
          <div className="bg-card border border-border rounded-2xl shadow-sm p-8 text-center">
            <div className="w-16 h-16 bg-blue-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <Icon name="Mail" size={32} className="text-blue-600" />
            </div>
            <h2 className="text-xl font-semibold text-foreground mb-2">Check Your Email</h2>
            <p className="text-muted-foreground mb-6">
              Please open the reset link from your email to continue.
            </p>
            <Button
              onClick={() => navigate('/forgot-password')}
              className="w-full mb-3"
            >
              Request New Link
            </Button>
            <button
              onClick={() => navigate('/login-authentication')}
              className="text-sm text-blue-600 hover:text-blue-800 transition-colors duration-200"
            >
              Back to Login
            </button>
          </div>

          {/* Footer */}
          <div className="text-center mt-6">
            <p className="text-xs text-muted-foreground">
              Secure yacht operations management • Role-based access control
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Show invalid session message (expired/invalid token)
  if (validSession === false && !noTokenProvided) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background transition-colors duration-300 px-4 py-8">
        <div className="w-full max-w-md">
          {/* Logo */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-4">
              <Image
                src={theme === 'dark' ? '/assets/images/Cargo_20logo_20solid_20beige-1767558154320.svg' : '/assets/images/Cargo_20logo_20solid_20navy-1767558047979.svg'}
                alt="Cargo Logo"
                className="w-10 h-10"
              />
            </div>
            <h1 className="text-2xl font-semibold text-foreground mb-2">Reset Password</h1>
          </div>

          {/* Error Card */}
          <div className="bg-card border border-border rounded-2xl shadow-sm p-8 text-center">
            <div className="w-16 h-16 bg-error/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <Icon name="AlertCircle" size={32} className="text-error" />
            </div>
            <h2 className="text-xl font-semibold text-foreground mb-2">Invalid or Expired Link</h2>
            <p className="text-muted-foreground mb-6">
              This reset link is invalid or has expired. Please request a new one.
            </p>
            <Button
              onClick={() => navigate('/forgot-password')}
              className="w-full mb-3"
            >
              Request New Link
            </Button>
            <button
              onClick={() => navigate('/login-authentication')}
              className="text-sm text-blue-600 hover:text-blue-800 transition-colors duration-200"
            >
              Back to Login
            </button>
          </div>

          {/* Footer */}
          <div className="text-center mt-6">
            <p className="text-xs text-muted-foreground">
              Secure yacht operations management • Role-based access control
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Show success state
  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background transition-colors duration-300 p-4">
        <div className="w-full max-w-md">
          {/* Logo */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-4">
              <Image
                src={theme === 'dark' ? '/assets/images/Cargo_20logo_20solid_20beige-1767558154320.svg' : '/assets/images/Cargo_20logo_20solid_20navy-1767558047979.svg'}
                alt="Cargo Logo"
                className="w-10 h-10"
              />
            </div>
            <h1 className="text-2xl font-semibold text-foreground mb-2">Password updated</h1>
          </div>

          {/* Success Card */}
          <div className="bg-card border border-border rounded-2xl p-8 shadow-sm">
            <div className="bg-success/10 border border-success/20 rounded-lg p-4 flex items-start gap-3 mb-6">
              <Icon name="CheckCircle" size={20} className="text-success mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-success mb-1">Your password has been updated successfully.</p>
                <p className="text-xs text-success/80">You can now log in with your new password.</p>
              </div>
            </div>

            <Button
              onClick={() => navigate('/login-authentication')}
              className="w-full"
            >
              Continue to login
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Show password reset form (valid session established)
  return (
    <div className="min-h-screen flex items-center justify-center bg-background transition-colors duration-300 px-4 py-8">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-4">
            <Image
              src={theme === 'dark' ? '/assets/images/Cargo_20logo_20solid_20beige-1767558154320.svg' : '/assets/images/Cargo_20logo_20solid_20navy-1767558047979.svg'}
              alt="Cargo Logo"
              className="w-10 h-10"
            />
          </div>
          <h1 className="text-2xl font-semibold text-foreground mb-2">Set New Password</h1>
          <p className="text-sm text-muted-foreground">
            Enter your new password below.
          </p>
        </div>

        {/* Main Card */}
        <div className="bg-card border border-border rounded-2xl shadow-sm p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* New Password */}
            <div>
              <label htmlFor="newPassword" className="block text-sm font-medium text-foreground mb-2">
                New Password
              </label>
              <Input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e?.target?.value)}
                placeholder="Enter new password"
                className="w-full"
                disabled={loading}
                required
              />
            </div>

            {/* Confirm Password */}
            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-foreground mb-2">
                Confirm Password
              </label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e?.target?.value)}
                placeholder="Confirm new password"
                className="w-full"
                disabled={loading}
                required
              />
            </div>

            {/* Error Message */}
            {error && (
              <div className="bg-error/10 border border-error/20 rounded-lg p-3 flex items-start gap-2">
                <Icon name="AlertCircle" size={18} className="text-error mt-0.5 flex-shrink-0" />
                <p className="text-sm text-error">{error}</p>
              </div>
            )}

            {/* Submit Button */}
            <Button
              type="submit"
              className="w-full"
              disabled={loading}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <Icon name="Loader2" size={18} className="animate-spin" />
                  Updating...
                </span>
              ) : (
                'Update Password'
              )}
            </Button>
          </form>
        </div>

        {/* Footer */}
        <div className="text-center mt-6">
          <p className="text-xs text-muted-foreground">
            Secure yacht operations management • Role-based access control
          </p>
        </div>
      </div>
    </div>
  );
};

export default PasswordResetCompletion;