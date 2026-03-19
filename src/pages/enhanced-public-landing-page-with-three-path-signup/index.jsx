import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Button from '../../components/ui/Button';
import Image from '../../components/AppImage';
import Icon from '../../components/AppIcon';
import { useTheme } from '../../contexts/ThemeContext';
import { supabase } from '../../lib/supabaseClient';

const EnhancedPublicLandingPageWithThreePathSignup = () => {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const [searchParams] = useSearchParams();
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Check for invite token in URL
  useEffect(() => {
    const inviteToken = searchParams?.get('token');
    if (inviteToken) {
      // Store token and redirect to invite-accept
      localStorage.setItem('pending_invite_token', inviteToken);
      navigate(`/invite-accept?token=${inviteToken}`);
      return;
    }
    
    // Check if user is already logged in
    checkAuthAndRedirect();
  }, [searchParams, navigate]);

  const checkAuthAndRedirect = async () => {
    try {
      console.log('🔍 Landing: Checking if user is logged in...');
      
      const { data: { session }, error: sessionError } = await supabase?.auth?.getSession();
      
      if (session && !sessionError) {
        console.log('✅ Landing: User is logged in, redirecting to /post-auth');
        // User is logged in, redirect to post-auth router
        navigate('/post-auth', { replace: true });
        return;
      }
      
      console.log('👤 Landing: No logged-in user, showing signup options');
      setCheckingAuth(false);
    } catch (err) {
      console.error('❌ Landing: Error checking auth:', err);
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
      <div className="w-full max-w-3xl">
        {/* Logo */}
        <div className="text-center mb-12">
          <div className="flex items-center justify-center mb-6">
            <Image
              src={theme === 'day' ? '/assets/images/Cargo_20logo_20solid_20navy-1767558047979.svg' : '/assets/images/Cargo_20logo_20solid_20beige-1767558154320.svg'}
              alt="Cargo Logo - Professional yacht operations management"
              className="h-16 w-auto"
            />
          </div>
          <h1 className="text-4xl font-semibold text-foreground mb-4">Welcome to Cargo</h1>
          <p className="text-lg text-muted-foreground">Professional yacht operations management system</p>
        </div>

        {/* Main Card */}
        <div className="bg-card border border-border rounded-2xl p-10 shadow-sm">
          <h2 className="text-2xl font-semibold text-foreground mb-3 text-center">Choose Your Path</h2>
          <p className="text-sm text-muted-foreground mb-8 text-center">Select the option that best describes your needs</p>
          
          <div className="space-y-4">
            {/* Create Vessel Account - Primary CTA */}
            <div className="bg-primary/5 border-2 border-primary rounded-xl p-6 hover:bg-primary/10 transition-colors cursor-pointer" onClick={() => navigate('/signup-vessel')}>
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-12 h-12 bg-primary rounded-lg flex items-center justify-center">
                  <Icon name="Ship" size={24} className="text-white" />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-foreground mb-2">Create Vessel Account</h3>
                  <p className="text-sm text-muted-foreground mb-4">For Captains and Vessel Admins establishing new fleet management systems</p>
                  <Button
                    onClick={(e) => {
                      e?.stopPropagation();
                      navigate('/signup-vessel');
                    }}
                    className="w-full"
                    iconName="ArrowRight"
                    iconPosition="right"
                  >
                    Create Vessel Account
                  </Button>
                </div>
              </div>
            </div>

            {/* Create Personal Account */}
            <div className="bg-card border border-border rounded-xl p-6 hover:bg-muted/50 transition-colors cursor-pointer" onClick={() => navigate('/signup-personal')}>
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-12 h-12 bg-muted rounded-lg flex items-center justify-center">
                  <Icon name="User" size={24} className="text-foreground" />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-foreground mb-2">Create Personal Account</h3>
                  <p className="text-sm text-muted-foreground mb-4">For individual maritime professionals seeking personal workspace access</p>
                  <Button
                    onClick={(e) => {
                      e?.stopPropagation();
                      navigate('/signup-personal');
                    }}
                    variant="outline"
                    className="w-full"
                    iconName="ArrowRight"
                    iconPosition="right"
                  >
                    Create Personal Account
                  </Button>
                </div>
              </div>
            </div>

            {/* Join a Vessel - Invite Only */}
            <div className="bg-card border border-border rounded-xl p-6">
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-12 h-12 bg-muted rounded-lg flex items-center justify-center">
                  <Icon name="Mail" size={24} className="text-foreground" />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-foreground mb-2">Join a Vessel</h3>
                  <p className="text-sm text-muted-foreground mb-2">For crew members with an invitation token</p>
                  <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 mt-3">
                    <div className="flex items-start gap-2">
                      <Icon name="Info" size={16} className="text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-amber-800 dark:text-amber-200">
                        You can only join a vessel via an invite link. If you have received an invitation email, click the link provided to accept.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
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
            iconName="LogIn"
            iconPosition="left"
          >
            Log in
          </Button>
        </div>

        {/* Feature Highlights */}
        <div className="mt-8 grid grid-cols-3 gap-4 text-center">
          <div>
            <Icon name="Shield" size={20} className="text-primary mx-auto mb-2" />
            <p className="text-xs text-muted-foreground">Secure operations</p>
          </div>
          <div>
            <Icon name="Users" size={20} className="text-primary mx-auto mb-2" />
            <p className="text-xs text-muted-foreground">Role-based access</p>
          </div>
          <div>
            <Icon name="Zap" size={20} className="text-primary mx-auto mb-2" />
            <p className="text-xs text-muted-foreground">Real-time collaboration</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EnhancedPublicLandingPageWithThreePathSignup;