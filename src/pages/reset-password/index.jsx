import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Icon from '../../components/AppIcon';
import Image from '../../components/AppImage';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import { supabase } from '../../lib/supabaseClient';
import { useTheme } from '../../contexts/ThemeContext';
import { showToast } from '../../utils/toast';

const ResetPassword = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { theme } = useTheme();
  const [firstName, setFirstName] = useState('');
  const [surname, setSurname] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [sessionValid, setSessionValid] = useState(null);
  const [checkingSession, setCheckingSession] = useState(true);

  // Check for recovery session on mount (implicit flow - NO exchangeCodeForSession)
  useEffect(() => {
    checkRecoverySession();
  }, []);

  const checkRecoverySession = async () => {
    try {
      console.log('RESET_PASSWORD: Checking for recovery session (implicit flow)');
      
      // Call getSession - Supabase auto-handles token exchange in implicit flow
      const { data: { session }, error: sessionError } = await supabase?.auth?.getSession();
      
      if (sessionError) {
        console.error('RESET_PASSWORD: Error getting session:', sessionError);
        setSessionValid(false);
        setCheckingSession(false);
        return;
      }
      
      // Session must exist for reset to work
      if (session) {
        console.log('RESET_PASSWORD: Valid recovery session found');
        setSessionValid(true);
      } else {
        console.log('RESET_PASSWORD: No valid recovery session');
        setSessionValid(false);
      }
      
    } catch (err) {
      console.error('RESET_PASSWORD: Error checking session:', err);
      setSessionValid(false);
    } finally {
      setCheckingSession(false);
    }
  };

  const handleSubmit = async (e) => {
    e?.preventDefault();
    setError('');
    setLoading(true);

    // Validate all fields
    if (!firstName?.trim() || !surname?.trim() || !newPassword || !confirmPassword) {
      setError('Please fill in all fields');
      setLoading(false);
      return;
    }

    // Validate password minimum 8 characters
    if (newPassword?.length < 8) {
      setError('Password must be at least 8 characters long');
      setLoading(false);
      return;
    }

    // Validate password match
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      setLoading(false);
      return;
    }

    try {
      console.log('RESET_PASSWORD: Updating password via updateUser');
      
      // Update password
      const { error: updateError } = await supabase?.auth?.updateUser({
        password: newPassword
      });

      if (updateError) {
        console.error('RESET_PASSWORD: Update error', updateError);
        throw updateError;
      }

      // Get current user ID
      const { data: { user }, error: userError } = await supabase?.auth?.getUser();
      
      if (userError || !user) {
        console.error('RESET_PASSWORD: Error getting user:', userError);
        throw new Error('Failed to get user information');
      }

      // Update profiles.full_name
      const fullName = `${firstName?.trim()} ${surname?.trim()}`;
      const { error: profileError } = await supabase?.from('profiles')?.update({ full_name: fullName })?.eq('id', user?.id);

      if (profileError) {
        console.error('RESET_PASSWORD: Profile update error', profileError);
        // Don't throw - password was updated successfully
        console.warn('Password updated but profile update failed');
      }

      console.log('RESET_PASSWORD: Password and profile updated successfully');
      setSuccess(true);
      showToast('Password updated successfully', 'success');
      
      // Redirect to login after 2 seconds
      setTimeout(() => {
        navigate('/login-authentication');
      }, 2000);
    } catch (err) {
      console.error('RESET_PASSWORD: Error', err);
      setError(err?.message || 'Failed to update password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Loading state while checking session
  if (checkingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background transition-colors duration-300">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Verifying reset link...</p>
        </div>
      </div>
    );
  }

  // Invalid or expired link state
  if (sessionValid === false) {
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
            <h1 className="text-2xl font-semibold text-foreground mb-2">Reset Password</h1>
          </div>

          {/* Error Card */}
          <div className="bg-card border border-border rounded-2xl p-8 shadow-sm">
            <div className="text-center">
              <div className="w-16 h-16 bg-error/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <Icon name="AlertCircle" size={32} className="text-error" />
              </div>
              <h2 className="text-xl font-semibold text-foreground mb-2">Reset link invalid or expired</h2>
              <p className="text-sm text-muted-foreground mb-6">
                This reset link is invalid or has expired. Please request a new reset email.
              </p>
              
              <Button
                onClick={() => navigate('/forgot-password')}
                className="w-full mb-3 bg-gray-900 hover:bg-gray-800 text-white"
              >
                Request new reset email
              </Button>
              <button
                onClick={() => navigate('/login-authentication')}
                className="text-sm text-blue-600 hover:text-blue-800 transition-colors duration-200"
              >
                Back to login
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Success state
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
            <h1 className="text-2xl font-semibold text-foreground mb-2">Password Updated</h1>
          </div>

          {/* Success Card */}
          <div className="bg-card border border-border rounded-2xl p-8 shadow-sm">
            <div className="text-center">
              <div className="w-16 h-16 bg-success/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <Icon name="CheckCircle" size={32} className="text-success" />
              </div>
              <h2 className="text-xl font-semibold text-foreground mb-2">Success!</h2>
              <p className="text-sm text-muted-foreground mb-6">
                Your password has been updated successfully. Redirecting to login...
              </p>
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Password reset form (only shown when session is valid)
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
          <h1 className="text-2xl font-semibold text-foreground mb-2">Reset Your Password</h1>
          <p className="text-sm text-muted-foreground">
            Enter your details and new password below
          </p>
        </div>

        {/* Form Card */}
        <div className="bg-card border border-border rounded-2xl p-8 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* First Name */}
            <div>
              <label htmlFor="firstName" className="block text-sm font-medium text-foreground mb-2">
                First name
              </label>
              <Input
                id="firstName"
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e?.target?.value)}
                placeholder="Enter your first name"
                className="w-full"
                disabled={loading}
                required
              />
            </div>

            {/* Surname */}
            <div>
              <label htmlFor="surname" className="block text-sm font-medium text-foreground mb-2">
                Surname
              </label>
              <Input
                id="surname"
                type="text"
                value={surname}
                onChange={(e) => setSurname(e?.target?.value)}
                placeholder="Enter your surname"
                className="w-full"
                disabled={loading}
                required
              />
            </div>

            {/* New Password */}
            <div>
              <label htmlFor="newPassword" className="block text-sm font-medium text-foreground mb-2">
                New password
              </label>
              <Input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e?.target?.value)}
                placeholder="Enter new password (min 8 characters)"
                className="w-full"
                disabled={loading}
                required
              />
            </div>

            {/* Confirm Password */}
            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-foreground mb-2">
                Confirm password
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

            {/* Submit Button - High Contrast */}
            <Button
              type="submit"
              className="w-full bg-gray-900 hover:bg-gray-800 text-white font-medium"
              disabled={loading}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <Icon name="Loader2" size={18} className="animate-spin" />
                  Resetting password...
                </span>
              ) : (
                'Reset Password'
              )}
            </Button>
          </form>

          {/* Back to Login */}
          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={() => navigate('/login-authentication')}
              className="text-sm text-blue-600 hover:text-blue-800 transition-colors duration-200"
            >
              Back to login
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 text-center">
          <p className="text-xs text-muted-foreground">
            Secure yacht operations management • Role-based access control
          </p>
        </div>
      </div>
    </div>
  );
};

export default ResetPassword;