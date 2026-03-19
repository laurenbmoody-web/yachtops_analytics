import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Icon from '../../components/AppIcon';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import { supabase } from '../../lib/supabaseClient';
import { showToast } from '../../utils/toast';

const InviteAcceptPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [token, setToken] = useState('');
  const [activeTab, setActiveTab] = useState('signup'); // 'signup' or 'login'
  
  // PAGE STATE MACHINE: 'create' or 'join'
  // - 'create': Show Create Account form (even if session appears mid-flow)
  // - 'join': Show Join Vessel button (only for users who were already logged in)
  const [step, setStep] = useState('create'); // Initialize as 'create'
  const [status, setStatus] = useState('loading'); // loading, ready, error
  
  // Invite data from RPC
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRoleName, setInviteRoleName] = useState('');
  const [vesselName, setVesselName] = useState('');
  const [departmentName, setDepartmentName] = useState('');
  const [inviteDetailsLoading, setInviteDetailsLoading] = useState(true);
  
  // Form fields
  const [firstName, setFirstName] = useState('');
  const [surname, setSurname] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showLoginPassword, setShowLoginPassword] = useState(false);

  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [emailConfirmationRequired, setEmailConfirmationRequired] = useState(false);
  const [infoBanner, setInfoBanner] = useState('');
  
  // Track if we've checked initial session (to prevent re-checking)
  const hasCheckedInitialSession = useRef(false);

  // Track if logged-in user email mismatches invite email
  const [sessionEmailMismatch, setSessionEmailMismatch] = useState(false);
  const [loggedInEmail, setLoggedInEmail] = useState('');

  // Helper to determine why button is disabled - ONLY check required inputs, NOT department/role
  const getDisabledReason = () => {
    if (isSubmitting) return 'Processing...';
    if (inviteDetailsLoading) return 'Loading invite details...';
    if (activeTab === 'signup') {
      if (!firstName?.trim()) return 'First name is required';
      if (!surname?.trim()) return 'Surname is required';
      if (!password || password?.length < 6) return 'Password must be at least 6 characters';
      if (password !== confirmPassword) return 'Passwords do not match';
    }
    if (activeTab === 'login') {
      if (!loginPassword?.trim()) return 'Password is required';
    }
    return null;
  };

  // Button disabled ONLY based on required inputs (first name, surname, password) - NOT department/role
  const isButtonDisabled = isSubmitting || inviteDetailsLoading || 
    (activeTab === 'signup' && (!firstName?.trim() || !surname?.trim() || !password || password?.length < 6 || password !== confirmPassword)) ||
    (activeTab === 'login' && !loginPassword?.trim());

  const disabledReason = getDisabledReason();

  // Load invite data on mount
  useEffect(() => {
    const inviteToken = searchParams?.get('token') || searchParams?.get('invite') || searchParams?.get('t');
    
    console.log('INVITE_ACCEPT: token=', inviteToken);
    
    if (!inviteToken) {
      setStatus('error');
      setError('Invite link is missing or invalid');
      return;
    }
    
    setToken(inviteToken);
    loadInviteData(inviteToken);
  }, [searchParams]);

  // Check if user is already authenticated on mount ONLY ONCE
  // DO NOT auto-run accept or change step on auth changes
  useEffect(() => {
    if (hasCheckedInitialSession?.current) return;
    if (status !== 'ready') return;
    
    const checkExistingSession = async () => {
      try {
        const { data: { session }, error: sessionError } = await supabase?.auth?.getSession();
        
        if (sessionError) {
          console.error('INVITE_ACCEPT: Session check error:', sessionError);
          return;
        }
        
        if (session?.user) {
          const sessionEmail = session?.user?.email?.toLowerCase()?.trim();
          const inviteEmailNorm = inviteEmail?.toLowerCase()?.trim();
          
          console.log('INVITE_ACCEPT: Existing session found on mount', { sessionEmail, inviteEmail: inviteEmailNorm });
          
          if (sessionEmail && inviteEmailNorm && sessionEmail !== inviteEmailNorm) {
            // Logged-in user email does NOT match invite email
            // Show signup/login form with a mismatch warning
            console.log('INVITE_ACCEPT: Session email mismatch - keeping step as "create" with warning');
            setSessionEmailMismatch(true);
            setLoggedInEmail(session?.user?.email || '');
            setStep('create');
          } else {
            // Emails match (or invite email not yet loaded) - show Join Vessel
            console.log('INVITE_ACCEPT: Session email matches invite, setting step to "join"');
            setStep('join');
          }
        } else {
          console.log('INVITE_ACCEPT: No existing session, keeping step as "create"');
          setStep('create');
        }
        
        hasCheckedInitialSession.current = true;
      } catch (err) {
        console.error('INVITE_ACCEPT: Error checking session:', err);
      }
    };
    
    checkExistingSession();
  }, [status, inviteEmail]);

  const loadInviteData = async (inviteToken) => {
    try {
      setStatus('loading');
      setInviteDetailsLoading(true);
      
      console.log('INVITE_ACCEPT: Loading invite data for token:', inviteToken);
      
      // Call get_invite_public RPC (no auth required)
      const { data, error: rpcError } = await supabase?.rpc('get_invite_public', {
        p_token: inviteToken
      });

      console.log('INVITE_ACCEPT: get_invite_public result', { data, error: rpcError });

      if (rpcError) {
        console.error('INVITE_ACCEPT: get_invite_public ERROR:', rpcError);
        const errorMsg = rpcError?.message || rpcError?.error_message || JSON.stringify(rpcError);
        setError(errorMsg);
        setStatus('error');
        setInviteDetailsLoading(false);
        return;
      }

      if (!data || data?.length === 0) {
        console.error('INVITE_ACCEPT: get_invite_public ERROR - No data returned');
        setError('Invite not found or has expired');
        setStatus('error');
        setInviteDetailsLoading(false);
        return;
      }

      // RPC returns array with single row
      const inviteData = data?.[0];
      
      console.log('INVITE_ACCEPT: get_invite_public success:', inviteData);
      
      if (!inviteData?.success) {
        console.error('INVITE_ACCEPT: get_invite_public failed:', inviteData?.error_message);
        setError(inviteData?.error_message || 'Invite has expired or is no longer valid');
        setStatus('error');
        setInviteDetailsLoading(false);
        return;
      }

      // Store invite data with proper fallback chain
      setInviteEmail(inviteData?.email || '');
      setVesselName(inviteData?.vessel_name || '');
      setInviteRoleName(inviteData?.job_title_label || 'Not set');
      setDepartmentName(inviteData?.department || 'Not set');
      
      setInviteDetailsLoading(false);
      setStatus('ready');
    } catch (err) {
      console.error('INVITE_ACCEPT: get_invite_public EXCEPTION:', err);
      const errorMsg = err?.message || err?.error_message || JSON.stringify(err);
      setError(errorMsg);
      setStatus('error');
      setInviteDetailsLoading(false);
    }
  };

  // Poll tenant_members for up to 10 seconds to verify membership was created
  const pollTenantMembership = async (tenantId, maxAttempts = 10, delayMs = 1000) => {
    console.log('INVITE_ACCEPT: Starting tenant_members polling', { tenantId, maxAttempts });
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      console.log(`INVITE_ACCEPT: Polling attempt ${attempt}/${maxAttempts}`);
      
      try {
        const { data, error } = await supabase
          ?.from('tenant_members')
          ?.select('id')
          ?.eq('tenant_id', tenantId)
          ?.eq('user_id', (await supabase?.auth?.getUser())?.data?.user?.id)
          ?.limit(1)
          ?.single();
        
        if (error && error?.code !== 'PGRST116') { // PGRST116 = no rows returned
          console.error(`INVITE_ACCEPT: Polling error on attempt ${attempt}:`, error);
        }
        
        if (data?.id) {
          console.log(`INVITE_ACCEPT: Membership found on attempt ${attempt}:`, data);
          return { success: true, membershipId: data?.id };
        }
        
        // Wait before next attempt (except on last attempt)
        if (attempt < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      } catch (err) {
        console.error(`INVITE_ACCEPT: Polling exception on attempt ${attempt}:`, err);
      }
    }
    
    console.error('INVITE_ACCEPT: Polling timeout - membership not found after max attempts');
    return { success: false, timeout: true };
  };

  // Handle Join Vessel for logged-in users (step === 'join')
  const handleJoinVessel = async () => {
    try {
      setIsSubmitting(true);
      setError('');
      
      console.log('INVITE_ACCEPT: Join Vessel clicked for existing session');

      // Get current user
      const { data: { user } } = await supabase?.auth?.getUser();
      
      if (!user) {
        throw new Error('No authenticated user found');
      }

      // Construct full_name from existing profile
      const { data: profile } = await supabase
        ?.from('profiles')
        ?.select('first_name, last_name, full_name')
        ?.eq('id', user?.id)
        ?.single();

      const fullName = profile?.full_name || 
        `${profile?.first_name || ''} ${profile?.last_name || ''}`?.trim() || 
        user?.user_metadata?.full_name || 
        inviteEmail?.split('@')?.[0] || 
        '';

      console.log('INVITE_ACCEPT: Calling accept_crew_invite_v3', { token, fullName });

      // Call accept_crew_invite_v3 with p_token and p_full_name
      const { data: acceptData, error: acceptError } = await supabase?.rpc('accept_crew_invite_v3', {
        p_token: token,
        p_full_name: fullName
      });

      console.log('INVITE_ACCEPT: accept_crew_invite_v3 result', { data: acceptData, error: acceptError });

      if (acceptError) {
        console.error('INVITE_ACCEPT: accept_crew_invite_v3 ERROR:', acceptError);
        const errorMsg = acceptError?.message || acceptError?.error_message || JSON.stringify(acceptError);
        setError(errorMsg);
        setIsSubmitting(false);
        return;
      }

      if (!acceptData || acceptData?.length === 0) {
        console.error('INVITE_ACCEPT: accept_crew_invite_v3 ERROR - No data returned');
        setError('Failed to accept invite - no response from server');
        setIsSubmitting(false);
        return;
      }

      const acceptResult = acceptData?.[0];
      
      // Check if success=false
      if (!acceptResult?.success) {
        console.error('INVITE_ACCEPT: accept_crew_invite_v3 failed:', acceptResult?.message);
        setError(acceptResult?.message || 'Failed to accept invite');
        setIsSubmitting(false);
        return;
      }

      // Success - extract tenant_id from response
      const tenantId = acceptResult?.tenant_id;
      console.log('INVITE_ACCEPT: Invite accepted successfully, tenant_id:', tenantId);
      
      if (!tenantId) {
        console.error('INVITE_ACCEPT: No tenant_id in response');
        setError('Failed to get vessel information from invite');
        setIsSubmitting(false);
        return;
      }

      // Poll tenant_members for up to 10 seconds
      const pollResult = await pollTenantMembership(tenantId, 10, 1000);
      
      if (pollResult?.success) {
        // Membership found - set activeTenantId and navigate to dashboard
        console.log('INVITE_ACCEPT: Membership verified, setting activeTenantId and redirecting');
        
        // Update last_active_tenant_id in profiles
        await supabase
          ?.from('profiles')
          ?.update({ last_active_tenant_id: tenantId })
          ?.eq('id', user?.id);
        
        showToast(`Welcome to ${vesselName}!`, 'success');
        
        // ONLY NOW allow step to become 'join' on future visits
        // (but we're navigating away, so this doesn't matter)
        
        // Stop loader and navigate
        setIsSubmitting(false);
        navigate('/dashboard');
      } else {
        // Timeout - show error message and stop loader
        console.error('INVITE_ACCEPT: Membership polling timeout');
        setError('Account created but access not ready—refresh or contact admin');
        setIsSubmitting(false);
      }
      
    } catch (err) {
      console.error('INVITE_ACCEPT: handleJoinVessel EXCEPTION:', err);
      const errorMsg = err?.message || err?.error_message || JSON.stringify(err);
      setError(errorMsg);
      setIsSubmitting(false);
    }
  };

  const handleCreateAccount = async (e) => {
    e?.preventDefault();
    setError('');
    setInfoBanner('');
    setEmailConfirmationRequired(false);
    setIsSubmitting(true);

    try {
      // Validate inputs
      if (!firstName?.trim()) {
        throw new Error('Please enter your first name');
      }
      if (!surname?.trim()) {
        throw new Error('Please enter your surname');
      }
      if (!password) {
        throw new Error('Please enter a password');
      }
      if (password?.length < 6) {
        throw new Error('Password must be at least 6 characters');
      }
      if (password !== confirmPassword) {
        throw new Error('Passwords do not match');
      }

      // Construct full_name as "{first_name} {surname}" with proper trimming
      const fullName = `${firstName?.trim() || ''} ${surname?.trim() || ''}`?.trim();

      console.log('INVITE_ACCEPT: signUp start', { email: inviteEmail, fullName });

      // STEP 1: Create account with supabase.auth.signUp
      const { data: signUpData, error: signUpError } = await supabase?.auth?.signUp({
        email: inviteEmail,
        password: password,
        options: {
          data: {
            full_name: fullName
          }
        }
      });

      console.log('INVITE_ACCEPT: signUp result', { 
        data: signUpData, 
        error: signUpError,
        hasSession: !!signUpData?.session,
        userId: signUpData?.user?.id
      });

      // Handle signUp errors - detect existing user
      if (signUpError) {
        console.error('INVITE_ACCEPT: signUp ERROR:', signUpError);
        
        // Check if user already exists
        if (signUpError?.message?.toLowerCase()?.includes('already registered') || 
            signUpError?.message?.toLowerCase()?.includes('already exists')) {
          setError('An account with this email already exists. Please use the Login tab instead.');
          setActiveTab('login');
          setIsSubmitting(false);
          return;
        }
        
        throw new Error(signUpError?.message || 'Failed to create account');
      }

      if (!signUpData?.user) {
        throw new Error('Account creation failed - no user returned');
      }

      // CRITICAL: Wait for auth response and get user.id
      const userId = signUpData?.user?.id;
      console.log('INVITE_ACCEPT: User created with ID:', userId);

      // STEP 2: Check if session was created (email confirmation may be required)
      if (!signUpData?.session) {
        console.log('INVITE_ACCEPT: No session - email confirmation may be required');
        
        // STEP 2b: Try to sign in immediately
        console.log('INVITE_ACCEPT: Attempting signInWithPassword after signUp');
        const { data: signInData, error: signInError } = await supabase?.auth?.signInWithPassword({
          email: inviteEmail,
          password: password
        });
        
        if (signInError || !signInData?.session) {
          console.log('INVITE_ACCEPT: signInWithPassword failed, email confirmation required');
          setEmailConfirmationRequired(true);
          setInfoBanner('Please check your email to confirm your account, then return to accept the invite.');
          setIsSubmitting(false);
          return;
        }
        
        console.log('INVITE_ACCEPT: signInWithPassword successful');
      }

      // STEP 3: UPDATE profile with first_name, last_name, updated_at ONLY
      console.log('INVITE_ACCEPT: Updating profile with first_name, last_name, updated_at using auth.uid()');
      
      const { error: profileError } = await supabase
        ?.from('profiles')
        ?.update({
          first_name: firstName?.trim(),
          last_name: surname?.trim(),
          updated_at: new Date()?.toISOString()
        })
        ?.eq('id', userId);

      if (profileError) {
        console.error('INVITE_ACCEPT: profile update ERROR:', profileError);
        
        // Check for schema cache errors and show user-friendly message
        if (profileError?.message?.toLowerCase()?.includes('schema cache') || 
            profileError?.message?.toLowerCase()?.includes('cache lookup')) {
          setError('Unable to save profile details at this time. Please try again in a few moments or contact support if the issue persists.');
          setIsSubmitting(false);
          return;
        }
        
        // For other errors, show the actual error message
        setError(profileError?.message || 'Failed to update profile');
        setIsSubmitting(false);
        return;
      }

      console.log('INVITE_ACCEPT: Profile updated successfully');

      // STEP 4: Call accept_crew_invite_v3 with p_token and p_full_name
      console.log('INVITE_ACCEPT: Calling accept_crew_invite_v3', { token, fullName });

      const { data: acceptData, error: acceptError } = await supabase?.rpc('accept_crew_invite_v3', {
        p_token: token,
        p_full_name: fullName
      });

      console.log('INVITE_ACCEPT: accept_crew_invite_v3 result', { data: acceptData, error: acceptError });

      if (acceptError) {
        console.error('INVITE_ACCEPT: accept_crew_invite_v3 ERROR:', acceptError);
        const errorMsg = acceptError?.message || acceptError?.error_message || JSON.stringify(acceptError);
        setError(errorMsg);
        setIsSubmitting(false);
        return;
      }

      if (!acceptData || acceptData?.length === 0) {
        console.error('INVITE_ACCEPT: accept_crew_invite_v3 ERROR - No data returned');
        setError('Failed to accept invite - no response from server');
        setIsSubmitting(false);
        return;
      }

      const acceptResult = acceptData?.[0];
      
      // Check if success=false
      if (!acceptResult?.success) {
        console.error('INVITE_ACCEPT: accept_crew_invite_v3 failed:', acceptResult?.message);
        setError(acceptResult?.message || 'Failed to accept invite');
        setIsSubmitting(false);
        return;
      }

      // Success - extract tenant_id from response
      const tenantId = acceptResult?.tenant_id;
      console.log('INVITE_ACCEPT: Invite accepted successfully, tenant_id:', tenantId);
      
      if (!tenantId) {
        console.error('INVITE_ACCEPT: No tenant_id in response');
        setError('Failed to get vessel information from invite');
        setIsSubmitting(false);
        return;
      }

      // STEP 5: Poll tenant_members for up to 10 seconds
      const pollResult = await pollTenantMembership(tenantId, 10, 1000);
      
      if (pollResult?.success) {
        // Membership found - set activeTenantId and navigate to dashboard
        console.log('INVITE_ACCEPT: Membership verified, setting activeTenantId and redirecting');
        
        // Update last_active_tenant_id in profiles
        await supabase
          ?.from('profiles')
          ?.update({ last_active_tenant_id: tenantId })
          ?.eq('id', userId);
        
        showToast(`Welcome to ${vesselName}!`, 'success');
        
        // ONLY NOW allow step to become 'join' on future visits
        // (but we're navigating away, so this doesn't matter)
        
        // Stop loader and navigate
        setIsSubmitting(false);
        navigate('/dashboard');
      } else {
        // Timeout - show error message and stop loader
        console.error('INVITE_ACCEPT: Membership polling timeout');
        setError('Account created but access not ready—refresh or contact admin');
        setIsSubmitting(false);
      }
      
    } catch (err) {
      console.error('INVITE_ACCEPT: handleCreateAccount EXCEPTION:', err);
      const errorMsg = err?.message || err?.error_message || JSON.stringify(err);
      setError(errorMsg);
      setIsSubmitting(false);
    }
  };

  const handleLogin = async (e) => {
    e?.preventDefault();
    setError('');
    setInfoBanner('');
    setIsSubmitting(true);

    try {
      // Validate inputs
      if (!loginPassword) {
        throw new Error('Please enter your password');
      }

      console.log('INVITE_ACCEPT: signIn start', { email: inviteEmail });

      // STEP 1: Sign in with password
      const { data: loginData, error: loginError } = await supabase?.auth?.signInWithPassword({
        email: inviteEmail,
        password: loginPassword
      });

      console.log('INVITE_ACCEPT: signIn result', { 
        data: loginData, 
        error: loginError,
        hasSession: !!loginData?.session 
      });

      if (loginError) {
        console.error('INVITE_ACCEPT: signIn ERROR:', loginError);
        const errorMsg = loginError?.message || loginError?.error_message || JSON.stringify(loginError);
        setError(errorMsg);
        setIsSubmitting(false);
        return;
      }

      if (!loginData?.session) {
        console.error('INVITE_ACCEPT: signIn returned no session');
        setError('Login failed - no session returned');
        setIsSubmitting(false);
        return;
      }

      console.log('INVITE_ACCEPT: signIn successful, proceeding to accept invite');

      // STEP 2: Get user's full_name from profile
      const { data: profile } = await supabase
        ?.from('profiles')
        ?.select('first_name, last_name, full_name')
        ?.eq('id', loginData?.user?.id)
        ?.single();

      const fullName = profile?.full_name || 
        `${profile?.first_name || ''} ${profile?.last_name || ''}`?.trim() || 
        loginData?.user?.user_metadata?.full_name || 
        inviteEmail?.split('@')?.[0] || 
        '';

      // STEP 3: Call accept_crew_invite_v3 with p_token and p_full_name
      console.log('INVITE_ACCEPT: Calling accept_crew_invite_v3', { token, fullName });

      const { data: acceptData, error: acceptError } = await supabase?.rpc('accept_crew_invite_v3', {
        p_token: token,
        p_full_name: fullName
      });

      console.log('INVITE_ACCEPT: accept_crew_invite_v3 result', { data: acceptData, error: acceptError });

      if (acceptError) {
        console.error('INVITE_ACCEPT: accept_crew_invite_v3 ERROR:', acceptError);
        const errorMsg = acceptError?.message || acceptError?.error_message || JSON.stringify(acceptError);
        setError(errorMsg);
        setIsSubmitting(false);
        return;
      }

      if (!acceptData || acceptData?.length === 0) {
        console.error('INVITE_ACCEPT: accept_crew_invite_v3 ERROR - No data returned');
        setError('Failed to accept invite - no response from server');
        setIsSubmitting(false);
        return;
      }

      const acceptResult = acceptData?.[0];
      
      // Check if success=false
      if (!acceptResult?.success) {
        console.error('INVITE_ACCEPT: accept_crew_invite_v3 failed:', acceptResult?.message);
        setError(acceptResult?.message || 'Failed to accept invite');
        setIsSubmitting(false);
        return;
      }

      // Success - extract tenant_id from response
      const tenantId = acceptResult?.tenant_id;
      console.log('INVITE_ACCEPT: Invite accepted successfully, tenant_id:', tenantId);
      
      if (!tenantId) {
        console.error('INVITE_ACCEPT: No tenant_id in response');
        setError('Failed to get vessel information from invite');
        setIsSubmitting(false);
        return;
      }

      // Poll tenant_members for up to 10 seconds
      const pollResult = await pollTenantMembership(tenantId, 10, 1000);
      
      if (pollResult?.success) {
        // Membership found - set activeTenantId and navigate to dashboard
        console.log('INVITE_ACCEPT: Membership verified, setting activeTenantId and redirecting');
        
        // Update last_active_tenant_id in profiles
        await supabase
          ?.from('profiles')
          ?.update({ last_active_tenant_id: tenantId })
          ?.eq('id', loginData?.user?.id);
        
        showToast(`Welcome to ${vesselName}!`, 'success');
        
        // Stop loader and navigate
        setIsSubmitting(false);
        navigate('/dashboard');
      } else {
        // Timeout - show error message and stop loader
        console.error('INVITE_ACCEPT: Membership polling timeout');
        setError('Account created but access not ready—refresh or contact admin');
        setIsSubmitting(false);
      }
      
    } catch (err) {
      console.error('INVITE_ACCEPT: handleLogin EXCEPTION:', err);
      setError(err?.message || 'An unexpected error occurred');
      setIsSubmitting(false);
    }
  };

  // Loading state
  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#0A1628] via-[#132337] to-[#1E3A5F] flex items-center justify-center">
        <div className="text-center">
          <Icon name="Loader2" size={48} className="text-white animate-spin mx-auto mb-4" />
          <p className="text-lg text-white">Loading invite details...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (status === 'error') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#0A1628] via-[#132337] to-[#1E3A5F] flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-xl p-8 text-center">
          <Icon name="AlertCircle" size={48} className="text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Invalid Invite</h2>
          <p className="text-gray-600 mb-6">{error}</p>
          <Button onClick={() => navigate('/login-authentication')} className="w-full">
            Go to Login
          </Button>
        </div>
      </div>
    );
  }

  // STEP === 'join': Show Join Vessel button only (for users who were already logged in)
  if (step === 'join') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#0A1628] via-[#132337] to-[#1E3A5F] flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-xl p-8">
          <div className="text-center mb-6">
            <Icon name="Ship" size={48} className="text-[#1E3A5F] mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Join Vessel</h1>
            <p className="text-gray-600">You're already logged in. Click below to join the vessel.</p>
          </div>

          {/* Invite Details */}
          <div className="space-y-4 mb-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Vessel</label>
              <Input value={vesselName} disabled className="bg-gray-50" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <Input value={inviteEmail} disabled className="bg-gray-50" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Department</label>
              <Input value={departmentName} disabled className="bg-gray-50" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
              <Input value={inviteRoleName} disabled className="bg-gray-50" />
            </div>
          </div>

          {/* Error Display */}
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
              <Icon name="AlertCircle" size={20} className="text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {/* Join Vessel Button */}
          <Button
            onClick={handleJoinVessel}
            disabled={isSubmitting}
            className="w-full bg-[#1E3A5F] hover:bg-[#2A4A6F] text-white font-semibold py-3 rounded-lg transition-smooth"
          >
            {isSubmitting ? (
              <>
                <Icon name="Loader2" size={20} className="animate-spin mr-2" />
                Joining...
              </>
            ) : (
              'Join Vessel'
            )}
          </Button>
        </div>
      </div>
    );
  }

  // STEP === 'create': Show signup/login forms (ALWAYS render this when step is 'create', even if session appears)
  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0A1628] via-[#132337] to-[#1E3A5F] flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-xl p-8">
        {/* Header */}
        <div className="text-center mb-6">
          <Icon name="Ship" size={48} className="text-[#1E3A5F] mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Join Your Vessel</h1>
          <p className="text-gray-600">You've been invited to join {vesselName}</p>
        </div>

        {/* Invite Details - Read-only, normal height */}
        <div className="space-y-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Vessel</label>
            <Input value={vesselName} disabled className="bg-gray-50" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <Input value={inviteEmail} disabled className="bg-gray-50" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Department</label>
            <Input value={departmentName} disabled className="bg-gray-50" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
            <Input value={inviteRoleName} disabled className="bg-gray-50" />
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 mb-6">
          <button
            onClick={() => setActiveTab('signup')}
            className={`flex-1 py-2 text-sm font-medium transition-smooth ${
              activeTab === 'signup' ?'border-b-2 border-[#1E3A5F] text-[#1E3A5F]' :'text-gray-500 hover:text-gray-700'
            }`}
          >
            Create Account
          </button>
          <button
            onClick={() => setActiveTab('login')}
            className={`flex-1 py-2 text-sm font-medium transition-smooth ${
              activeTab === 'login' ?'border-b-2 border-[#1E3A5F] text-[#1E3A5F]' :'text-gray-500 hover:text-gray-700'
            }`}
          >
            Login
          </button>
        </div>

        {/* Error Display */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
            <Icon name="AlertCircle" size={20} className="text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Session Email Mismatch Warning */}
        {sessionEmailMismatch && (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <div className="flex items-start gap-2 mb-2">
              <Icon name="AlertTriangle" size={20} className="text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-800">Different account logged in</p>
                <p className="text-sm text-amber-700 mt-1">
                  You're currently logged in as <strong>{loggedInEmail}</strong>, but this invite is for <strong>{inviteEmail}</strong>.
                </p>
                <p className="text-sm text-amber-700 mt-1">
                  Please create a new account or log in with the invited email address below.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={async () => {
                await supabase?.auth?.signOut();
                setSessionEmailMismatch(false);
                setLoggedInEmail('');
              }}
              className="text-xs text-amber-700 underline hover:text-amber-900 mt-1"
            >
              Sign out of {loggedInEmail}
            </button>
          </div>
        )}

        {/* Info Banner */}
        {infoBanner && (
          <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-start gap-2">
            <Icon name="Info" size={20} className="text-blue-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-blue-700">{infoBanner}</p>
          </div>
        )}

        {/* Email Confirmation Required */}
        {emailConfirmationRequired && (
          <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <div className="flex items-start gap-2 mb-2">
              <Icon name="Mail" size={20} className="text-yellow-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-yellow-800">Email Confirmation Required</p>
                <p className="text-sm text-yellow-700 mt-1">
                  Please check your email and click the confirmation link to activate your account.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Signup Form */}
        {activeTab === 'signup' && (
          <form onSubmit={handleCreateAccount} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">First Name *</label>
              <Input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e?.target?.value)}
                placeholder="Enter your first name"
                disabled={isSubmitting}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Surname *</label>
              <Input
                type="text"
                value={surname}
                onChange={(e) => setSurname(e?.target?.value)}
                placeholder="Enter your surname"
                disabled={isSubmitting}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password *</label>
              <div className="relative">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e?.target?.value)}
                  placeholder="At least 6 characters"
                  disabled={isSubmitting}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                  disabled={isSubmitting}
                >
                  <Icon name={showPassword ? 'EyeOff' : 'Eye'} size={20} />
                </button>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Confirm Password *</label>
              <div className="relative">
                <Input
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e?.target?.value)}
                  placeholder="Re-enter password"
                  disabled={isSubmitting}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                  disabled={isSubmitting}
                >
                  <Icon name={showConfirmPassword ? 'EyeOff' : 'Eye'} size={20} />
                </button>
              </div>
            </div>

            {/* Disabled reason hint */}
            {disabledReason && (
              <p className="text-xs text-gray-500 italic">{disabledReason}</p>
            )}

            <Button
              type="submit"
              disabled={isButtonDisabled}
              className="w-full bg-[#1E3A5F] hover:bg-[#2A4A6F] text-white font-semibold py-3 rounded-lg transition-smooth disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <Icon name="Loader2" size={20} className="animate-spin mr-2" />
                  Creating Account...
                </>
              ) : (
                'Create Account & Join Vessel'
              )}
            </Button>
          </form>
        )}

        {/* Login Form */}
        {activeTab === 'login' && (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password *</label>
              <div className="relative">
                <Input
                  type={showLoginPassword ? 'text' : 'password'}
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e?.target?.value)}
                  placeholder="Enter your password"
                  disabled={isSubmitting}
                />
                <button
                  type="button"
                  onClick={() => setShowLoginPassword(!showLoginPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                  disabled={isSubmitting}
                >
                  <Icon name={showLoginPassword ? 'EyeOff' : 'Eye'} size={20} />
                </button>
              </div>
            </div>

            {/* Disabled reason hint */}
            {disabledReason && (
              <p className="text-xs text-gray-500 italic">{disabledReason}</p>
            )}

            <Button
              type="submit"
              disabled={isButtonDisabled}
              className="w-full bg-[#1E3A5F] hover:bg-[#2A4A6F] text-white font-semibold py-3 rounded-lg transition-smooth disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <Icon name="Loader2" size={20} className="animate-spin mr-2" />
                  Logging In...
                </>
              ) : (
                'Login & Join Vessel'
              )}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
};

export default InviteAcceptPage;