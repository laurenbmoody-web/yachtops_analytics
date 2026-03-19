import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../components/AppIcon';
import Image from '../../components/AppImage';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import { useTheme } from '../../contexts/ThemeContext';
import { supabase } from '../../lib/supabaseClient';
import { showToast } from '../../utils/toast';

const ForgotPasswordRequest = () => {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e?.preventDefault();
    setError('');
    setSuccess(false);
    setLoading(true);

    // Validate email
    if (!email || !email?.trim()) {
      setError('Please enter your email address');
      setLoading(false);
      return;
    }

    try {
      // Use window.location.origin for redirectTo URL
      const redirectTo = `${window.location?.origin}/reset-password`;

      console.log('Sending password reset email with redirectTo:', redirectTo);

      const { error: resetError } = await supabase?.auth?.resetPasswordForEmail(
        email?.trim(),
        {
          redirectTo
        }
      );

      if (resetError) {
        throw resetError;
      }

      // Show success message (no account enumeration)
      setSuccess(true);
      setEmail('');
      showToast('If an account exists, we\'ve sent a reset link.', 'success');
    } catch (err) {
      console.error('Password reset error:', err);
      setError(err?.message || 'Failed to send reset link. Please try again.');
      showToast(err?.message || 'Failed to send reset link', 'error');
    } finally {
      setLoading(false);
    }
  };

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
          <h1 className="text-2xl font-semibold text-foreground mb-2">Reset your password</h1>
          <p className="text-sm text-muted-foreground">
            Enter your email address and we'll send you a reset link
          </p>
        </div>

        {/* Success Banner */}
        {success && (
          <div className="mb-4 bg-success/10 border border-success/20 rounded-lg p-3 flex items-start gap-2">
            <Icon name="CheckCircle" size={18} className="text-success mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-success mb-1">
                Check your email for a reset link.
              </p>
              <p className="text-xs text-success/80">
                Open the link on THIS device/browser to reset your password.
              </p>
            </div>
          </div>
        )}

        {/* Form Card */}
        <div className="bg-card border border-border rounded-2xl p-8 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-foreground mb-2">
                Email
              </label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e?.target?.value)}
                placeholder="captain@cargo.local"
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
                  Sending...
                </span>
              ) : (
                'Send reset link'
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

export default ForgotPasswordRequest;