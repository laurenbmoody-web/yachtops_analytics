import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Image from '../../components/AppImage';
import Icon from '../../components/AppIcon';
import { useTheme } from '../../contexts/ThemeContext';
import { supabase } from '../../lib/supabaseClient';
import { setCurrentUser } from '../../utils/authStorage';
import { ensureProfileExists } from '../../utils/profileHelpers';
import { useAuth } from '../../contexts/AuthContext';


const VesselSignupFlowStep1 = () => {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const { setCurrentTenant } = useAuth();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Step 1 fields
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Step 2 fields
  const [vesselName, setVesselName] = useState('');
  const [willBeAdmin, setWillBeAdmin] = useState(true); // Locked design: default Yes
  const [showAdminTip, setShowAdminTip] = useState(false);

  // Temporary storage for user data between steps
  const [userData, setUserData] = useState(null);

  const handleStep1Submit = async (e) => {
    e?.preventDefault();
    setError('');

    // Validation
    if (!fullName?.trim()) {
      setError('Please enter your full name');
      return;
    }
    if (!email?.trim()) {
      setError('Please enter your email');
      return;
    }
    if (!password) {
      setError('Please enter a password');
      return;
    }
    if (password?.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    // Store data and move to step 2
    setUserData({ fullName, email, password });
    setStep(2);
  };

  const handleStep2Submit = async (e) => {
    e?.preventDefault();
    setError('');
    setLoading(true);

    // Validation
    if (!vesselName?.trim()) {
      setError('Please enter vessel/organisation name');
      setLoading(false);
      return;
    }

    try {
      // ACTION 1: Create user account with Supabase Auth
      const { data: authData, error: authError } = await supabase?.auth?.signUp({
        email: userData?.email,
        password: userData?.password,
        options: {
          data: {
            full_name: userData?.fullName,
          }
        }
      });

      if (authError) {
        throw new Error(authError?.message || 'Failed to create account');
      }

      if (!authData?.user) {
        throw new Error('Account creation failed');
      }

      const userId = authData?.user?.id;

      // Ensure profile exists after signup
      await ensureProfileExists(authData?.user);

      // ACTION 2: Create tenant row
      const { data: tenantData, error: tenantError } = await supabase?.from('tenants')?.insert({
          name: vesselName?.trim(),
          type: 'VESSEL',
          status: 'TRIAL',
          // Locked design 2026-04-14: if the signer-up said they won't be
          // the vessel admin, flag the tenant so the reminder banner + the
          // onboarding "transfer admin" step surface until resolved.
          admin_transfer_reminder_active: !willBeAdmin,
        })?.select()?.single();

      if (tenantError) {
        throw new Error(tenantError?.message || 'Failed to create vessel organisation');
      }

      const tenantId = tenantData?.id;

      // ACTION 3: Upsert profile row with account_type='VESSEL_ADMIN'
      const { error: profileError } = await supabase?.from('profiles')?.upsert({
          id: userId,
          full_name: userData?.fullName?.trim(),
          email: userData?.email?.trim(),
          account_type: 'VESSEL_ADMIN',
          last_active_tenant_id: tenantId
        });

      if (profileError) {
        throw new Error(profileError?.message || 'Failed to create profile');
      }

      // ACTION 4: Create membership with COMMAND role
      const { error: memberError } = await supabase?.from('tenant_members')?.insert({
          tenant_id: tenantId,
          user_id: userId,
          role: 'COMMAND',
          permission_tier: 'COMMAND',
          role_legacy: 'COMMAND',
          active: true,
          status: 'active',
        });

      if (memberError) {
        throw new Error(memberError?.message || 'Failed to create membership');
      }

      // Set current tenant in session
      setCurrentTenant(tenantId);

      // Store user in localStorage for compatibility with existing auth system
      const userObject = {
        id: userId,
        fullName: userData?.fullName,
        email: userData?.email,
        roleTitle: 'Captain',
        tier: 'COMMAND',
        status: 'ACTIVE',
        tenantId: tenantId
      };
      setCurrentUser(userObject);

      // F) OVERRIDE: Check for pending invite token after signup
      const pendingInviteToken = localStorage.getItem('pending_invite_token');
      if (pendingInviteToken) {
        console.log('INVITE: pending token detected after signup, redirecting to /invite-accept');
        // Don't clear token - let invite-accept page handle it
        navigate('/invite-accept');
        return;
      }

      // Route to post-login router for account-type based routing
      console.log('VESSEL_SIGNUP: Routing to /post-login for account-type check');
      navigate('/post-login');
    } catch (err) {
      console.error('Signup error:', err);
      setError(err?.message || 'An error occurred during signup. Please try again.');
      setLoading(false);
    }
  };

  const handleBack = () => {
    setStep(1);
    setError('');
  };

  return (
    <div className="min-h-screen bg-background transition-colors duration-300 flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center mb-4">
            <Image
              src={theme === 'day' ? '/assets/images/Cargo_20logo_20solid_20navy-1767558047979.svg' : '/assets/images/Cargo_20logo_20solid_20beige-1767558154320.svg'}
              alt="Cargo Logo"
              className="h-12 w-auto"
            />
          </div>
          <h1 className="text-2xl font-semibold text-foreground mb-2">Create Vessel Account</h1>
          <p className="text-sm text-muted-foreground">Step {step} of 2</p>
        </div>

        {/* Progress Indicator */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <span className={`text-xs font-medium ${step >= 1 ? 'text-primary' : 'text-muted-foreground'}`}>
              Account
            </span>
            <span className={`text-xs font-medium ${step >= 2 ? 'text-primary' : 'text-muted-foreground'}`}>
              Vessel Details
            </span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${(step / 2) * 100}%` }}
            />
          </div>
        </div>

        {/* Form Card */}
        <div className="bg-card border border-border rounded-2xl p-8 shadow-sm">
          {step === 1 && (
            <form onSubmit={handleStep1Submit} className="space-y-5">
              <h2 className="text-xl font-semibold text-foreground mb-6">Create Account</h2>

              {/* Full Name */}
              <Input
                label="Full Name"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e?.target?.value)}
                placeholder="John Smith"
                required
                disabled={loading}
              />

              {/* Email */}
              <Input
                label="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e?.target?.value)}
                placeholder="captain@vessel.com"
                required
                disabled={loading}
              />

              {/* Password */}
              <Input
                label="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e?.target?.value)}
                placeholder="Minimum 6 characters"
                required
                disabled={loading}
              />

              {/* Confirm Password */}
              <Input
                label="Confirm Password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e?.target?.value)}
                placeholder="Re-enter password"
                required
                disabled={loading}
              />

              {/* Error Message */}
              {error && (
                <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3 flex items-start gap-2">
                  <Icon name="AlertCircle" size={18} className="text-destructive flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-destructive">{error}</p>
                </div>
              )}

              {/* Submit Button */}
              <Button type="submit" className="w-full" disabled={loading}>
                Continue to Vessel Details
                <Icon name="ArrowRight" size={18} />
              </Button>
            </form>
          )}

          {step === 2 && (
            <form onSubmit={handleStep2Submit} className="space-y-5">
              <h2 className="text-xl font-semibold text-foreground mb-6">Vessel Details</h2>

              {/* Vessel Name */}
              <Input
                label="Vessel/Organisation Name"
                type="text"
                value={vesselName}
                onChange={(e) => setVesselName(e?.target?.value)}
                placeholder="M/Y Serenity"
                required
                disabled={loading}
              />

              {/* Vessel Admin Y/N (locked design 2026-04-14) */}
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <label className="text-sm font-medium text-foreground">
                    Will you be Cargo's vessel administrator?
                  </label>
                  <div className="relative">
                    <button
                      type="button"
                      onMouseEnter={() => setShowAdminTip(true)}
                      onMouseLeave={() => setShowAdminTip(false)}
                      onFocus={() => setShowAdminTip(true)}
                      onBlur={() => setShowAdminTip(false)}
                      className="w-4 h-4 rounded-full border border-muted-foreground/50 text-muted-foreground text-[10px] flex items-center justify-center hover:bg-muted"
                      aria-label="What is the vessel admin?"
                    >
                      ?
                    </button>
                    {showAdminTip && (
                      <div className="absolute z-10 left-6 top-0 w-60 p-2 text-xs bg-popover text-popover-foreground border border-border rounded shadow-md">
                        The vessel admin handles invites, billing, and vessel-level settings.
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setWillBeAdmin(true)}
                    disabled={loading}
                    className={`flex-1 py-2 px-4 rounded-lg border text-sm font-medium transition-colors ${
                      willBeAdmin
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-card text-foreground border-border hover:bg-muted'
                    }`}
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    onClick={() => setWillBeAdmin(false)}
                    disabled={loading}
                    className={`flex-1 py-2 px-4 rounded-lg border text-sm font-medium transition-colors ${
                      !willBeAdmin
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-card text-foreground border-border hover:bg-muted'
                    }`}
                  >
                    No
                  </button>
                </div>
                {!willBeAdmin && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    No problem — you'll be set as admin to get started, and we'll remind you to transfer it to the right person.
                  </p>
                )}
              </div>

              {/* Error Message */}
              {error && (
                <div className="bg-error/10 border border-error/20 rounded-lg p-3 flex items-start gap-2">
                  <Icon name="AlertCircle" size={18} className="text-error mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-error">{error}</p>
                </div>
              )}

              {/* Submit Button */}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <Icon name="Loader2" size={18} className="animate-spin" />
                    Creating account...
                  </span>
                ) : (
                  'Create Vessel Account'
                )}
              </Button>

              {/* Back Button */}
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={handleBack}
                disabled={loading}
              >
                Back
              </Button>
            </form>
          )}
        </div>

        {/* Footer */}
        <div className="mt-6 text-center">
          <p className="text-xs text-muted-foreground">
            By creating an account, you agree to Cargo's terms of service
          </p>
        </div>
      </div>
    </div>
  );
};

export default VesselSignupFlowStep1;