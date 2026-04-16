import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../components/AppIcon';
import Image from '../../components/AppImage';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import { useTheme } from '../../contexts/ThemeContext';
import { supabase } from '../../lib/supabaseClient';
import { ensureProfileExists } from '../../utils/profileHelpers';

const LoginAuthentication = () => {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);

  // Check if user is already logged in — redirect straight to dashboard if so
  useEffect(() => {
    const checkSession = async () => {
      try {
        const { data: { session } } = await supabase?.auth?.getSession();
        if (session?.user) {
          console.log('[LOGIN] Existing session found, redirecting to dashboard');
          navigate('/dashboard', { replace: true });
          return;
        }
      } catch (err) {
        console.error('[LOGIN] Error checking session:', err);
      } finally {
        setCheckingSession(false);
      }
    };
    checkSession();
  }, []);

  const handleSubmit = async (e) => {
    e?.preventDefault();
    setError('');
    setLoading(true);

    // Validate inputs
    if (!email || !password) {
      setError('Please enter both email and password');
      setLoading(false);
      return;
    }

    try {
      // Verify Supabase client is available
      if (!supabase) {
        throw new Error('Supabase client not initialized. Please check your configuration.');
      }

      console.log('[LOGIN] Attempting login for:', email?.trim());

      // Authenticate with Supabase with timeout and better error handling
      let authData, authError;
      
      try {
        const loginPromise = supabase?.auth?.signInWithPassword({
          email: email?.trim(),
          password: password
        });

        // Add 30 second timeout
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Login request timed out. Please check your internet connection.')), 30000)
        );

        const result = await Promise.race([loginPromise, timeoutPromise]);
        authData = result?.data;
        authError = result?.error;
      } catch (networkError) {
        // Handle network-level errors (Load failed, CORS, etc.)
        console.error('[LOGIN] Network error:', networkError);
        throw new Error('Unable to connect to authentication service. Please check your internet connection and try again.');
      }

      if (authError) {
        console.error('[LOGIN] Auth error:', authError);
        throw new Error(authError?.message || 'Authentication failed');
      }

      if (!authData?.user) {
        throw new Error('Login failed - no user data returned');
      }

      console.log('[LOGIN] Authentication successful for user:', authData?.user?.id);

      // Ensure profile exists after login
      const profileResult = await ensureProfileExists(authData?.user);
      
      // Check if profile creation failed
      if (!profileResult?.success) {
        // If it's a network error, still allow login (profile may already exist)
        if (profileResult?.error?.includes('Network error')) {
          console.warn('[LOGIN] Profile check failed with network error, continuing to dashboard');
          navigate('/dashboard', { replace: true });
          return;
        }
        throw new Error(profileResult?.error || 'Failed to create user profile');
      }

      console.log('[LOGIN] Profile verified, navigating to dashboard');
      // Navigate directly to dashboard
      navigate('/dashboard', { replace: true });

    } catch (err) {
      console.error('[LOGIN] Login error:', err);
      
      // Provide user-friendly error messages
      let errorMessage = 'Login failed. Please try again.';
      
      if (err?.message?.includes('Load failed')) {
        errorMessage = 'Unable to connect to the server. Please check your internet connection and try again.';
      } else if (err?.message?.includes('Network error') || err?.message?.includes('timed out')) {
        errorMessage = 'Network error. Please check your internet connection and try again.';
      } else if (err?.message?.includes('Invalid login credentials')) {
        errorMessage = 'Invalid email or password. Please try again.';
      } else if (err?.message) {
        errorMessage = err?.message;
      }
      
      setError(errorMessage);
      setLoading(false);
    }
  };

  // Show loading state while checking session
  if (checkingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background transition-colors duration-300">
        <div className="flex flex-col items-center gap-3">
          <Icon name="Loader2" size={32} className="animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

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
          <h1 className="text-2xl font-semibold text-foreground mb-2">Welcome to Cargo</h1>
          <p className="text-sm text-muted-foreground">Sign in to your account</p>
        </div>

        {/* Login Card */}
        <div className="bg-card border border-border rounded-2xl p-8 shadow-sm">
          {/* Error Message */}
          {error && (
            <div className="mb-6 bg-destructive/10 border border-destructive/20 rounded-lg p-3 flex items-start gap-2">
              <Icon name="AlertCircle" size={18} className="text-destructive mt-0.5 flex-shrink-0" />
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          {/* Login Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-foreground mb-1.5">
                Email
              </label>
              <Input
                id="email"
                type="email"
                placeholder="Enter your email"
                value={email}
                onChange={(e) => setEmail(e?.target?.value)}
                disabled={loading}
                required
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-foreground mb-1.5">
                Password
              </label>
              <Input
                id="password"
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e?.target?.value)}
                disabled={loading}
                required
              />
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={loading}
            >
              {loading ? (
                <>
                  <Icon name="Loader2" size={18} className="animate-spin mr-2" />
                  Signing in...
                </>
              ) : (
                'Sign In'
              )}
            </Button>
          </form>

          {/* Forgot Password Link */}
          <div className="mt-4 text-center">
            <button
              onClick={() => navigate('/forgot-password')}
              className="text-sm text-primary hover:underline"
              disabled={loading}
            >
              Forgot password?
            </button>
          </div>
        </div>

        {/* Sign Up Link */}
        <div className="mt-6 text-center">
          <p className="text-sm text-muted-foreground">
            Don't have an account?{' '}
            <button
              onClick={() => navigate('/public-landing-page')}
              className="text-primary hover:underline font-medium"
              disabled={loading}
            >
              Sign up
            </button>
          </p>
        </div>
      </div>
    </div>
  );
};

export default LoginAuthentication;