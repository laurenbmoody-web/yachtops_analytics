import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Button from '../../components/ui/Button';
import Image from '../../components/AppImage';
import Icon from '../../components/AppIcon';
import { useTheme } from '../../contexts/ThemeContext';
import { supabase } from '../../lib/supabaseClient';

const PublicLandingPage = () => {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Check if user is already logged in
  useEffect(() => {
    checkAuthAndRedirect();
  }, []);

  const checkAuthAndRedirect = async () => {
    try {
      const { data: { session } } = await supabase?.auth?.getSession();
      
      if (session) {
        // User is logged in, redirect to dashboard
        navigate('/dashboard', { replace: true });
        return;
      }
      
      setCheckingAuth(false);
    } catch (err) {
      console.error('Error checking auth:', err);
      setCheckingAuth(false);
    }
  };

  // Show loading state while checking auth
  if (checkingAuth) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Icon name="Loader2" size={48} className="text-primary animate-spin mx-auto mb-4" />
          <p className="text-lg text-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background transition-colors duration-300 flex items-center justify-center p-6">
      <div className="w-full max-w-2xl">
        {/* Logo */}
        <div className="text-center mb-12">
          <div className="flex items-center justify-center mb-6">
            <Image
              src={theme === 'day' ? '/assets/images/cargo_merged_originalmark_syne800_true.png' : '/assets/images/cargo_merged_reverse_navy.png'}
              alt="Cargo Logo"
              className="h-16 w-auto"
            />
          </div>
          <h1 className="text-4xl font-semibold text-foreground mb-4">Welcome to Cargo</h1>
          <p className="text-lg text-muted-foreground">Professional yacht operations management system</p>
        </div>

        {/* Main Card */}
        <div className="bg-card border border-border rounded-2xl p-10 shadow-sm">
          <h2 className="text-2xl font-semibold text-foreground mb-3 text-center">Get Started</h2>
          <p className="text-sm text-muted-foreground mb-8 text-center">Sign up or log in to manage your vessel</p>
          
          <div className="space-y-4">
            {/* Sign up as Vessel */}
            <Button
              onClick={() => navigate('/vessel-signup-flow-step-1')}
              className="w-full h-14 text-base"
              iconName="Ship"
              iconPosition="left"
            >
              Sign up as Vessel
            </Button>
          </div>

          {/* Divider */}
          <div className="relative my-8">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border"></div>
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">Already have an account?</span>
            </div>
          </div>

          {/* Login Link */}
          <Button
            onClick={() => navigate('/login-authentication')}
            variant="ghost"
            className="w-full"
          >
            Log in
          </Button>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center">
          <p className="text-xs text-muted-foreground">
            Secure operations management • Role-based access control • Real-time collaboration
          </p>
        </div>
      </div>
    </div>
  );
};

export default PublicLandingPage;