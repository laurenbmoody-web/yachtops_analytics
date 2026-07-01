import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../components/AppIcon';
import { supabase } from '../../lib/supabaseClient';
import { setCurrentUser } from '../../utils/authStorage';
import { ensureProfileExists } from '../../utils/profileHelpers';
import { useAuth } from '../../contexts/AuthContext';
import './vessel-signup.css';


const VesselSignupFlowStep1 = () => {
  const navigate = useNavigate();
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
    <div className="vs-page">
      <div className="vs-wrap">
        <img
          className="vs-logo"
          src="/assets/images/cargo_merged_originalmark_syne800_true.png"
          alt="Cargo"
        />
        <h1 className="vs-heading">Create your vessel account</h1>
        <p className="vs-step-label">Step {step} of 2</p>

        <div className="vs-progress">
          <span className={`bar ${step >= 1 ? 'done' : ''}`} />
          <span className={`bar ${step >= 2 ? 'done' : ''}`} />
        </div>

        <div className="vs-panel">
          {step === 1 && (
            <form onSubmit={handleStep1Submit}>
              <h2>Your account</h2>

              <div className="vs-field">
                <label htmlFor="fullName">Full name</label>
                <input
                  id="fullName"
                  className="vs-input"
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e?.target?.value)}
                  placeholder="John Smith"
                  required
                  disabled={loading}
                />
              </div>

              <div className="vs-field">
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  className="vs-input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e?.target?.value)}
                  placeholder="captain@vessel.com"
                  required
                  disabled={loading}
                />
              </div>

              <div className="vs-field">
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  className="vs-input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e?.target?.value)}
                  placeholder="Minimum 6 characters"
                  required
                  disabled={loading}
                />
              </div>

              <div className="vs-field">
                <label htmlFor="confirmPassword">Confirm password</label>
                <input
                  id="confirmPassword"
                  className="vs-input"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e?.target?.value)}
                  placeholder="Re-enter password"
                  required
                  disabled={loading}
                />
              </div>

              {error && (
                <div className="vs-error">
                  <Icon name="AlertCircle" size={16} />
                  <span>{error}</span>
                </div>
              )}

              <button type="submit" className="vs-btn-primary" disabled={loading}>
                Continue to vessel details
                <Icon name="ArrowRight" size={16} />
              </button>
            </form>
          )}

          {step === 2 && (
            <form onSubmit={handleStep2Submit}>
              <h2>Vessel details</h2>

              <div className="vs-field">
                <label htmlFor="vesselName">Vessel / organisation name</label>
                <input
                  id="vesselName"
                  className="vs-input"
                  type="text"
                  value={vesselName}
                  onChange={(e) => setVesselName(e?.target?.value)}
                  placeholder="M/Y Serenity"
                  required
                  disabled={loading}
                />
              </div>

              <div className="vs-field">
                <label style={{ display: 'flex', alignItems: 'center', position: 'relative' }}>
                  Will you be Cargo's vessel administrator?
                  <button
                    type="button"
                    className="vs-tip-btn"
                    onMouseEnter={() => setShowAdminTip(true)}
                    onMouseLeave={() => setShowAdminTip(false)}
                    onFocus={() => setShowAdminTip(true)}
                    onBlur={() => setShowAdminTip(false)}
                    aria-label="What is the vessel admin?"
                  >
                    ?
                  </button>
                  {showAdminTip && (
                    <span className="vs-tip-pop">
                      The vessel admin handles invites, billing, and vessel-level settings.
                    </span>
                  )}
                </label>
                <div className="vs-toggle-row">
                  <button
                    type="button"
                    onClick={() => setWillBeAdmin(true)}
                    disabled={loading}
                    className={`vs-toggle ${willBeAdmin ? 'active' : ''}`}
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    onClick={() => setWillBeAdmin(false)}
                    disabled={loading}
                    className={`vs-toggle ${!willBeAdmin ? 'active' : ''}`}
                  >
                    No
                  </button>
                </div>
                {!willBeAdmin && (
                  <p className="vs-hint">
                    No problem — you'll be set as admin to get started, and we'll remind you to transfer it to the right person.
                  </p>
                )}
              </div>

              {error && (
                <div className="vs-error">
                  <Icon name="AlertCircle" size={16} />
                  <span>{error}</span>
                </div>
              )}

              <button type="submit" className="vs-btn-primary" disabled={loading}>
                {loading ? (
                  <>
                    <Icon name="Loader2" size={16} className="animate-spin" />
                    Creating account…
                  </>
                ) : (
                  'Create vessel account'
                )}
              </button>

              <button
                type="button"
                className="vs-btn-ghost"
                onClick={handleBack}
                disabled={loading}
              >
                Back
              </button>
            </form>
          )}
        </div>

        <p className="vs-footer">By creating an account, you agree to Cargo's terms of service</p>
      </div>
    </div>
  );
};

export default VesselSignupFlowStep1;
