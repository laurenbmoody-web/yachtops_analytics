import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import Icon from '../../components/AppIcon';
import Image from '../../components/AppImage';
import Button from '../../components/ui/Button';
import { supabase } from '../../lib/supabaseClient';
import { useTheme } from '../../contexts/ThemeContext';
import { showToast } from '../../utils/toast';

const CrewInviteAcceptanceLandingV2 = () => {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [token, setToken] = useState('');
  const [mode, setMode] = useState('signup'); // 'signup' or 'login'
  const [status, setStatus] = useState('loading'); // loading, ready, error
  
  // Invite data from RPC
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteJobTitleLabel, setInviteJobTitleLabel] = useState('');
  const [vesselName, setVesselName] = useState('');
  const [departmentLabel, setDepartmentLabel] = useState('');
  
  // Form fields - SEPARATE firstName and surname
  const [firstName, setFirstName] = useState('');
  const [surname, setSurname] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Load invite data on mount
  useEffect(() => {
    // Try to get token from query string first
    let inviteToken = searchParams?.get('token');
    
    // If not in query string, try hash format: #/invite-accept?token=...
    if (!inviteToken && location?.hash) {
      const hashParams = new URLSearchParams(location.hash.split('?')[1]);
      inviteToken = hashParams?.get('token');
    }
    
    if (!inviteToken) {
      setStatus('error');
      setError('Invite link is missing or invalid. Please contact your vessel administrator.');
      return;
    }
    
    // Store token in localStorage immediately
    localStorage.setItem('pending_invite_token', inviteToken);
    
    setToken(inviteToken);
    loadInviteData(inviteToken);
  }, [searchParams, location]);

  const loadInviteData = async (inviteToken) => {
    try {
      setStatus('loading');
      
      // Call get_invite_public RPC (no auth required)
      const { data, error: rpcError } = await supabase?.rpc('get_invite_public', {
        p_token: inviteToken
      });

      if (rpcError) {
        console.error('RPC error:', rpcError);
        setError('Failed to load invite details');
        setStatus('error');
        return;
      }

      if (!data) {
        setError('Invite not found or expired');
        setStatus('error');
        return;
      }

      // RPC returns single row directly, not array
      if (!data?.success) {
        setError(data?.error_message || 'Invite expired or invalid');
        setStatus('error');
        return;
      }

      // Store invite data in state
      const email = data?.email || '';
      const jobTitle = data?.job_title_label || '';
      const vessel = data?.vessel_name || '';
      const dept = data?.department || '';

      setInviteEmail(email);
      setInviteJobTitleLabel(jobTitle);
      setVesselName(vessel);
      setDepartmentLabel(dept);
      setStatus('ready');
    } catch (err) {
      console.error('Error loading invite:', err);
      setError('Failed to load invite details');
      setStatus('error');
    }
  };

  const handleCreateAccount = async (e) => {
    e?.preventDefault();
    setError('');
    setLoading(true);

    try {
      // Validate inputs
      if (!firstName?.trim()) {
        throw new Error('Please enter your first name');
      }
      if (!surname?.trim()) {
        throw new Error('Please enter your surname');
      }
      if (!password || password?.length < 6) {
        throw new Error('Password must be at least 6 characters');
      }
      if (password !== confirmPassword) {
        throw new Error('Passwords do not match');
      }

      // Step 1: Create Supabase auth user
      const { data: authData, error: signupError } = await supabase?.auth?.signUp({
        email: inviteEmail,
        password: password,
        options: {
          data: {
            first_name: firstName?.trim(),
            surname: surname?.trim()
          }
        }
      });

      if (signupError) throw signupError;
      if (!authData?.user) throw new Error('Signup failed');

      // Step 2: If no session created, sign in explicitly
      let currentSession = authData?.session;
      if (!currentSession) {
        const { data: signInData, error: signInError } = await supabase?.auth?.signInWithPassword({
          email: inviteEmail,
          password: password
        });
        
        if (signInError) throw signInError;
        currentSession = signInData?.session;
      }

      if (!currentSession) {
        throw new Error('Failed to create session. Please try logging in.');
      }

      // Step 3: Call ensure_profile RPC to create/update profile
      const { data: profileData, error: profileError } = await supabase?.rpc('ensure_profile', {
        p_first_name: firstName?.trim(),
        p_surname: surname?.trim()
      });

      if (profileError) {
        console.error('ensure_profile error:', profileError);
        throw new Error('Failed to create profile: ' + (profileError?.message || 'Unknown error'));
      }

      if (!profileData?.success) {
        throw new Error(profileData?.error_message || 'Failed to create profile');
      }

      // Step 4: Accept the invite using accept_crew_invite_v2
      const fullName = firstName?.trim() + ' ' + surname?.trim();
      const { data: acceptData, error: acceptError } = await supabase?.rpc('accept_crew_invite_v2', {
        p_token: token,
        p_full_name: fullName
      });

      if (acceptError) {
        console.error('Accept invite error:', acceptError);
        throw new Error('Failed to accept invite: ' + (acceptError?.message || 'Unknown error'));
      }

      if (!acceptData?.success) {
        throw new Error(acceptData?.error_message || 'Failed to accept invite. Please try again.');
      }

      // Clear pending invite token
      localStorage.removeItem('pending_invite_token');

      showToast('Account created successfully! Welcome aboard.', 'success');
      
      // Navigate to dashboard
      navigate('/dashboard');
    } catch (err) {
      console.error('Create account error:', err);
      setError(err?.message || 'Failed to create account');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e) => {
    e?.preventDefault();
    setError('');
    setLoading(true);

    try {
      // Validate password
      if (!password) {
        throw new Error('Please enter your password');
      }

      // Step 1: Sign in with Supabase
      const { data: authData, error: loginError } = await supabase?.auth?.signInWithPassword({
        email: inviteEmail,
        password: password
      });

      if (loginError) throw loginError;
      if (!authData?.user) throw new Error('Login failed');

      // Step 2: Fetch existing profile by auth.uid() (not by email)
      const { data: profileData, error: profileFetchError } = await supabase
        ?.from('profiles')
        ?.select('first_name, surname, full_name')
        ?.eq('id', authData?.user?.id)
        ?.single();

      if (profileFetchError && profileFetchError?.code !== 'PGRST116') {
        console.error('Profile fetch error:', profileFetchError);
      }

      // Use existing full_name or construct from profile, or use invitee name as fallback
      let fullNameForInvite = profileData?.full_name;
      if (!fullNameForInvite && profileData?.first_name && profileData?.surname) {
        fullNameForInvite = profileData?.first_name + ' ' + profileData?.surname;
      }
      if (!fullNameForInvite) {
        fullNameForInvite = inviteEmail?.split('@')?.[0]; // Fallback to email username
      }

      // Step 3: Accept the invite using accept_crew_invite_v2
      const { data: acceptData, error: acceptError } = await supabase?.rpc('accept_crew_invite_v2', {
        p_token: token,
        p_full_name: fullNameForInvite
      });

      if (acceptError) {
        console.error('Accept invite error:', acceptError);
        throw new Error('Failed to accept invite: ' + (acceptError?.message || 'Unknown error'));
      }

      if (!acceptData?.success) {
        throw new Error(acceptData?.error_message || 'Failed to accept invite. Please try again.');
      }

      // Clear pending invite token
      localStorage.removeItem('pending_invite_token');

      showToast('Welcome back! Invite accepted.', 'success');
      
      // Navigate to dashboard
      navigate('/dashboard');
    } catch (err) {
      console.error('Login error:', err);
      setError(err?.message || 'Failed to log in');
    } finally {
      setLoading(false);
    }
  };

  // Loading state
  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="text-center">
          <div className="flex items-center justify-center mb-4">
            <Image
              src={theme === 'day' ? '/assets/images/Cargo_20logo_20solid_20navy-1767558047979.svg' : '/assets/images/Cargo_20logo_20solid_20beige-1767558154320.svg'}
              alt="Cargo Logo"
              className="h-12 w-auto"
            />
          </div>
          <div className="inline-flex items-center justify-center w-16 h-16 bg-primary/10 rounded-full mb-4">
            <Icon name="Loader" size={32} className="text-primary animate-spin" />
          </div>
          <p className="text-sm text-muted-foreground">Loading invite details...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (status === 'error') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="flex items-center justify-center mb-6">
            <Image
              src={theme === 'day' ? '/assets/images/Cargo_20logo_20solid_20navy-1767558047979.svg' : '/assets/images/Cargo_20logo_20solid_20beige-1767558154320.svg'}
              alt="Cargo Logo"
              className="h-12 w-auto"
            />
          </div>
          <div className="bg-card rounded-2xl shadow-lg p-8 border border-border">
            <div className="flex items-center justify-center w-16 h-16 bg-destructive/10 rounded-full mb-4 mx-auto">
              <Icon name="AlertCircle" size={32} className="text-destructive" />
            </div>
            <h2 className="text-xl font-semibold text-center mb-2">Invalid Invite</h2>
            <p className="text-sm text-muted-foreground text-center mb-6">{error}</p>
            <Button
              fullWidth
              variant="outline"
              onClick={() => navigate('/login-authentication')}
            >
              Go to Login
            </Button>
          </div>
          <div className="text-center mt-6">
            <p className="text-xs text-muted-foreground">Invite build v2</p>
          </div>
        </div>
      </div>
    );
  }

  // Ready state - show invite acceptance form
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex items-center justify-center mb-6">
          <Image
            src={theme === 'day' ? '/assets/images/Cargo_20logo_20solid_20navy-1767558047979.svg' : '/assets/images/Cargo_20logo_20solid_20beige-1767558154320.svg'}
            alt="Cargo Logo"
            className="h-12 w-auto"
          />
        </div>

        {/* Invite Card */}
        <div className="bg-card rounded-2xl shadow-lg p-8 border border-border">
          {/* Header */}
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-primary/10 rounded-full mb-4">
              <Icon name="Mail" size={32} className="text-primary" />
            </div>
            <h1 className="text-2xl font-bold mb-2">You've been invited</h1>
            <p className="text-sm text-muted-foreground">
              Join <span className="font-semibold text-foreground">{vesselName}</span> as {inviteJobTitleLabel}
              {departmentLabel && ` in ${departmentLabel}`}
            </p>
          </div>

          {/* Tab Selector */}
          <div className="flex gap-2 mb-6 p-1 bg-muted rounded-lg">
            <button
              onClick={() => setMode('signup')}
              className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                mode === 'signup' ?'bg-background text-foreground shadow-sm' :'text-muted-foreground hover:text-foreground'
              }`}
            >
              Create Account
            </button>
            <button
              onClick={() => setMode('login')}
              className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                mode === 'login' ?'bg-background text-foreground shadow-sm' :'text-muted-foreground hover:text-foreground'
              }`}
            >
              Log In
            </button>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg flex items-start gap-2">
              <Icon name="AlertCircle" size={16} className="text-destructive mt-0.5 flex-shrink-0" />
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          {/* Create Account Form */}
          {mode === 'signup' && (
            <form onSubmit={handleCreateAccount} className="space-y-4">
              {/* Email - READ ONLY with inline styles */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Email</label>
                <input
                  type="email"
                  value={inviteEmail}
                  readOnly
                  disabled
                  aria-readOnly="true"
                  style={{
                    backgroundColor: '#E5E7EB',
                    color: '#111827',
                    WebkitTextFillColor: '#111827',
                    opacity: 1,
                    border: '1px solid #9CA3AF',
                    cursor: 'not-allowed'
                  }}
                  className="flex h-10 w-full rounded-md px-3 py-2 text-sm font-medium"
                />
              </div>

              {/* Department - READ ONLY with high contrast */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Department</label>
                <input
                  type="text"
                  value={departmentLabel}
                  readOnly
                  disabled
                  aria-readOnly="true"
                  style={{
                    backgroundColor: '#E5E7EB',
                    color: '#111827',
                    WebkitTextFillColor: '#111827',
                    opacity: 1,
                    border: '1px solid #9CA3AF',
                    cursor: 'not-allowed'
                  }}
                  className="flex h-10 w-full rounded-md px-3 py-2 text-sm font-medium"
                />
              </div>

              {/* Job Title - READ ONLY with high contrast */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Job Title</label>
                <input
                  type="text"
                  value={inviteJobTitleLabel}
                  readOnly
                  disabled
                  aria-readOnly="true"
                  style={{
                    backgroundColor: '#E5E7EB',
                    color: '#111827',
                    WebkitTextFillColor: '#111827',
                    opacity: 1,
                    border: '1px solid #9CA3AF',
                    cursor: 'not-allowed'
                  }}
                  className="flex h-10 w-full rounded-md px-3 py-2 text-sm font-medium"
                />
              </div>

              {/* First Name - Editable */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">
                  First Name <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e?.target?.value)}
                  placeholder="Enter your first name"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  required
                  disabled={loading}
                />
              </div>

              {/* Surname - Editable */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">
                  Surname <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  value={surname}
                  onChange={(e) => setSurname(e?.target?.value)}
                  placeholder="Enter your surname"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  required
                  disabled={loading}
                />
              </div>

              {/* Password - Editable with iOS autofill support */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">
                  Password <span className="text-destructive">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e?.target?.value)}
                    placeholder="Create a password (min 6 characters)"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 pr-10"
                    required
                    disabled={loading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    disabled={loading}
                  >
                    <Icon name={showPassword ? 'EyeOff' : 'Eye'} size={16} />
                  </button>
                </div>
              </div>

              {/* Confirm Password - Editable with iOS autofill support */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">
                  Confirm Password <span className="text-destructive">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    name="confirm_password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e?.target?.value)}
                    placeholder="Confirm your password"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 pr-10"
                    required
                    disabled={loading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    disabled={loading}
                  >
                    <Icon name={showConfirmPassword ? 'EyeOff' : 'Eye'} size={16} />
                  </button>
                </div>
              </div>

              {/* Submit Button */}
              <Button
                type="submit"
                fullWidth
                loading={loading}
                disabled={loading}
                className="mt-6"
              >
                Create Account & Join Vessel
              </Button>
            </form>
          )}

          {/* Login Form */}
          {mode === 'login' && (
            <form onSubmit={handleLogin} className="space-y-4">
              {/* Email - READ ONLY with inline styles */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Email</label>
                <input
                  type="email"
                  value={inviteEmail}
                  readOnly
                  disabled
                  aria-readOnly="true"
                  style={{
                    backgroundColor: '#E5E7EB',
                    color: '#111827',
                    WebkitTextFillColor: '#111827',
                    opacity: 1,
                    border: '1px solid #9CA3AF',
                    cursor: 'not-allowed'
                  }}
                  className="flex h-10 w-full rounded-md px-3 py-2 text-sm font-medium"
                />
              </div>

              {/* Department - READ ONLY with high contrast */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Department</label>
                <input
                  type="text"
                  value={departmentLabel}
                  readOnly
                  disabled
                  aria-readOnly="true"
                  style={{
                    backgroundColor: '#E5E7EB',
                    color: '#111827',
                    WebkitTextFillColor: '#111827',
                    opacity: 1,
                    border: '1px solid #9CA3AF',
                    cursor: 'not-allowed'
                  }}
                  className="flex h-10 w-full rounded-md px-3 py-2 text-sm font-medium"
                />
              </div>

              {/* Job Title - READ ONLY with high contrast */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Job Title</label>
                <input
                  type="text"
                  value={inviteJobTitleLabel}
                  readOnly
                  disabled
                  aria-readOnly="true"
                  style={{
                    backgroundColor: '#E5E7EB',
                    color: '#111827',
                    WebkitTextFillColor: '#111827',
                    opacity: 1,
                    border: '1px solid #9CA3AF',
                    cursor: 'not-allowed'
                  }}
                  className="flex h-10 w-full rounded-md px-3 py-2 text-sm font-medium"
                />
              </div>

              {/* Password - Editable with iOS autofill support */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">
                  Password <span className="text-destructive">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e?.target?.value)}
                    placeholder="Enter your password"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 pr-10"
                    required
                    disabled={loading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    disabled={loading}
                  >
                    <Icon name={showPassword ? 'EyeOff' : 'Eye'} size={16} />
                  </button>
                </div>
              </div>

              {/* Submit Button */}
              <Button
                type="submit"
                fullWidth
                loading={loading}
                disabled={loading}
                className="mt-6"
              >
                Log In & Accept Invite
              </Button>
            </form>
          )}
        </div>

        {/* Version Label */}
        <div className="text-center mt-6">
          <p className="text-xs text-muted-foreground">Invite build v2</p>
        </div>
      </div>
    </div>
  );
};

export default CrewInviteAcceptanceLandingV2;