import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Icon from '../../components/AppIcon';
import { supabase } from '../../lib/supabaseClient';
import { showToast } from '../../utils/toast';
import EditorialDatePicker from '../../components/editorial/EditorialDatePicker';
import { NATIONALITIES } from '../../data/nationalities';
// This IS the vessel-onboarding "Wrapped" shell (full-bleed per-screen
// theme, giant numeral, marquee ticker, circular glyph badge, confetti
// finale) — see src/pages/onboarding/index.jsx / onboarding.css, the
// canonical source. Reused directly rather than re-implemented so the
// crew-invite flow is visually the same system, not a lookalike.
import '../onboarding/onboarding.css';
import './invite-accept.css';

// Design-review preview — lets anyone click through the invite wizard with
// mock data and no Supabase reads/writes/session checks. Mirrors the
// /onboarding-preview pattern (see src/pages/onboarding/index.jsx).
const PREVIEW_INVITE = {
  email: 'jamie.taylor@example.com',
  vessel_name: 'Preview',
  vessel_type_label: 'Motor Yacht',
  loa_m: 67,
  crew_count: 11,
  department_count: 5,
  job_title_label: 'Second Officer',
  department: 'Bridge',
};

// Same abbreviation the vessel-onboarding welcome screen implies with its
// "M/Y {name}" placeholder — only for the two types with an unambiguous
// nautical abbreviation; anything else (Catamaran, Explorer, …) shows the
// bare vessel name rather than guess.
const VESSEL_PREFIX = { 'Motor Yacht': 'M/Y', 'Sailing Yacht': 'S/Y' };

// Same options as the crew-profile Personal Details section (Prefix/Sex),
// so an invite-created record and a page-edited one speak the same
// vocabulary. See src/pages/crew-profile/index.jsx.
const PREFIX_OPTIONS = ['Mr', 'Mrs', 'Ms', 'Miss', 'Mx', 'Dr', 'Capt', 'Chief', 'Sir', 'Dame'];
const SEX_OPTIONS = ['Female', 'Male', 'Prefer not to say'];

// Compulsory strong-password rule set — every check must pass, not just a
// "good enough" score.
const PASSWORD_CHECKS = [
  { key: 'length', label: '8+ characters', test: (v) => v.length >= 8 },
  { key: 'case', label: 'Upper & lowercase', test: (v) => /[a-z]/.test(v) && /[A-Z]/.test(v) },
  { key: 'number', label: 'A number', test: (v) => /[0-9]/.test(v) },
  { key: 'symbol', label: 'A symbol', test: (v) => /[^A-Za-z0-9]/.test(v) },
];
const isStrongPassword = (v) => PASSWORD_CHECKS.every((c) => c.test(v || ''));

// Per-screen full-bleed theme — same palette/roles as onboarding's THEMES.
const THEMES = {
  invite:   { bg: '#F7F2E9', fg: '#1C1B3A', ac: '#C65A1A' },
  details:  { bg: '#1C1B3A', fg: '#F4F1EC', ac: '#E8915A' },
  password: { bg: '#F4F1EC', fg: '#1C1B3A', ac: '#C65A1A' },
  login:    { bg: '#F4F1EC', fg: '#1C1B3A', ac: '#C65A1A' },
  join:     { bg: '#F7F2E9', fg: '#1C1B3A', ac: '#C65A1A' },
  loading:  { bg: '#F7F2E9', fg: '#1C1B3A', ac: '#C65A1A' },
  error:    { bg: '#F7F2E9', fg: '#1C1B3A', ac: '#C65A1A' },
  done:     { bg: '#F7F2E9', fg: '#1C1B3A', ac: '#C65A1A' },
};
const DARK_SCREENS = ['details']; // needs the inverted (white) logo

const STEP_META = {
  invite:   { numeral: '01', label: 'Invite',   icon: 'Ship' },
  details:  { numeral: '02', label: 'About You', icon: 'User' },
  password: { numeral: '03', label: 'Password', icon: 'Lock' },
};
const STEP_KEYS = ['invite', 'details', 'password'];
const MARQUEE_LABELS = {
  invite: 'You’re Invited', details: 'About You', password: 'Set Password',
  login: 'Log In', join: 'Join Vessel', loading: 'Loading', error: 'Invalid Invite', done: 'Welcome Aboard',
};

// Confetti burst — success screen only. Duplicated (not imported) from
// onboarding/index.jsx's Confetti since that component isn't exported;
// same mechanics (46 bits, randomised delay/duration/colour/size).
const Confetti = () => {
  const bits = useRef(
    Array.from({ length: 46 }, (_, i) => ({
      left: Math.random() * 100, delay: Math.random() * 1.2, dur: 2.2 + Math.random() * 1.6,
      rot: Math.random() * 360, color: ['var(--wac)', '#1C1B3A', '#E0823F', '#3E6491'][i % 4],
      w: 5 + Math.random() * 6, round: Math.random() > 0.5,
    }))
  ).current;
  return (
    <div className="onb-confetti" aria-hidden="true">
      {bits.map((b, i) => (
        <span
          key={i}
          className="bit"
          style={{
            left: b.left + '%', animationDelay: b.delay + 's', animationDuration: b.dur + 's',
            background: b.color, width: b.w, height: b.w, borderRadius: b.round ? '50%' : 2,
            transform: `rotate(${b.rot}deg)`,
          }}
        />
      ))}
    </div>
  );
};

const InviteAcceptPage = ({ previewMode = false }) => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [token, setToken] = useState('');
  const [activeTab, setActiveTab] = useState('signup'); // 'signup' or 'login'
  const [wizStep, setWizStep] = useState(1); // create-account wizard: 1 invite · 2 details · 3 password

  // PAGE STATE MACHINE: 'create' or 'join'
  // - 'create': Show Create Account form (even if session appears mid-flow)
  // - 'join': Show Join Vessel button (only for users who were already logged in)
  const [step, setStep] = useState('create'); // Initialize as 'create'
  const [status, setStatus] = useState(previewMode ? 'ready' : 'loading'); // loading, ready, error
  const [flowComplete, setFlowComplete] = useState(false);
  
  // Invite data from RPC
  const [inviteEmail, setInviteEmail] = useState(previewMode ? PREVIEW_INVITE.email : '');
  const [inviteRoleName, setInviteRoleName] = useState(previewMode ? PREVIEW_INVITE.job_title_label : '');
  const [vesselName, setVesselName] = useState(previewMode ? PREVIEW_INVITE.vessel_name : '');
  const [vesselTypeLabel, setVesselTypeLabel] = useState(previewMode ? PREVIEW_INVITE.vessel_type_label : '');
  const [loaM, setLoaM] = useState(previewMode ? PREVIEW_INVITE.loa_m : null);
  const [crewCount, setCrewCount] = useState(previewMode ? PREVIEW_INVITE.crew_count : null);
  const [departmentCount, setDepartmentCount] = useState(previewMode ? PREVIEW_INVITE.department_count : null);
  const [departmentName, setDepartmentName] = useState(previewMode ? PREVIEW_INVITE.department : '');
  const [inviteDetailsLoading, setInviteDetailsLoading] = useState(!previewMode);

  // Form fields
  const [firstName, setFirstName] = useState('');
  const [surname, setSurname] = useState('');
  const [prefix, setPrefix] = useState('');
  const [sex, setSex] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [nationality, setNationality] = useState('');
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
      if (!password || !isStrongPassword(password)) return 'Password does not meet the requirements below';
      if (password !== confirmPassword) return 'Passwords do not match';
    }
    if (activeTab === 'login') {
      if (!loginPassword?.trim()) return 'Password is required';
    }
    return null;
  };

  // Button disabled ONLY based on required inputs (first name, surname, password) - NOT department/role
  const isButtonDisabled = isSubmitting || inviteDetailsLoading ||
    (activeTab === 'signup' && (!firstName?.trim() || !surname?.trim() || !password || !isStrongPassword(password) || password !== confirmPassword)) ||
    (activeTab === 'login' && !loginPassword?.trim());

  const disabledReason = getDisabledReason();

  // Load invite data on mount
  useEffect(() => {
    if (previewMode) return;
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
    if (previewMode) return;
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
      setVesselTypeLabel(inviteData?.vessel_type_label || '');
      setLoaM(inviteData?.loa_m ?? null);
      setCrewCount(inviteData?.crew_count ?? null);
      setDepartmentCount(inviteData?.department_count ?? null);
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
    if (previewMode) {
      setIsSubmitting(true);
      setTimeout(() => { setIsSubmitting(false); setFlowComplete(true); }, 500);
      return;
    }
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

        // Stop loader and show the done/confetti screen — the "Enter Cargo"
        // button there is what actually navigates to /dashboard.
        setIsSubmitting(false);
        setFlowComplete(true);
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
      if (!prefix || !sex || !dateOfBirth || !nationality) {
        throw new Error('Please complete your details on the previous step');
      }
      if (!password) {
        throw new Error('Please enter a password');
      }
      if (!isStrongPassword(password)) {
        throw new Error('Password does not meet the requirements below');
      }
      if (password !== confirmPassword) {
        throw new Error('Passwords do not match');
      }

      // Preview mode: client-side validation above still runs (so error
      // states are demoable), but nothing after this touches Supabase.
      if (previewMode) {
        setTimeout(() => { setIsSubmitting(false); setFlowComplete(true); }, 500);
        return;
      }

      // Construct full_name as "{first_name} {surname}" with proper trimming
      const fullName = `${firstName?.trim() || ''} ${surname?.trim() || ''}`?.trim();

      // Never create a new account on top of a *different* active session — sign
      // it out first so signUp / signInWithPassword operate on a clean slate and
      // can never mutate whoever was previously logged in.
      const { data: { session: existingSession } } = await supabase.auth.getSession();
      if (existingSession?.user && existingSession.user.email?.toLowerCase() !== inviteEmail?.toLowerCase()) {
        console.log('INVITE_ACCEPT: signing out mismatched session before signUp', existingSession.user.email);
        await supabase.auth.signOut();
      }

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

      // STEP 3b: UPSERT crew_personal_details with prefix, sex, date_of_birth, nationality
      console.log('INVITE_ACCEPT: Upserting crew_personal_details');

      const { error: personalDetailsError } = await supabase
        ?.from('crew_personal_details')
        ?.upsert({
          user_id: userId,
          prefix,
          sex,
          date_of_birth: dateOfBirth,
          nationality,
          updated_at: new Date()?.toISOString()
        }, { onConflict: 'user_id' });

      if (personalDetailsError) {
        console.error('INVITE_ACCEPT: crew_personal_details upsert ERROR:', personalDetailsError);
        setError(personalDetailsError?.message || 'Failed to save your details');
        setIsSubmitting(false);
        return;
      }

      console.log('INVITE_ACCEPT: crew_personal_details upserted successfully');

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

        // Stop loader and show the done/confetti screen — the "Enter Cargo"
        // button there is what actually navigates to /dashboard.
        setIsSubmitting(false);
        setFlowComplete(true);
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

      if (previewMode) {
        setTimeout(() => { setIsSubmitting(false); setFlowComplete(true); }, 500);
        return;
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

        // Stop loader and show the done/confetti screen — the "Enter Cargo"
        // button there is what actually navigates to /dashboard.
        setIsSubmitting(false);
        setFlowComplete(true);
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

  // ── Screen key drives theme/marquee/numeral — the same shell as
  // onboarding, just with a crew-invite screen sequence instead of a
  // vessel-setup one.
  const isLogin = activeTab === 'login';
  const screenKey = status === 'loading' ? 'loading'
    : status === 'error' ? 'error'
    : flowComplete ? 'done'
    : step === 'join' ? 'join'
    : isLogin ? 'login'
    : wizStep === 1 ? 'invite' : wizStep === 2 ? 'details' : 'password';

  const theme = THEMES[screenKey] || THEMES.invite;
  const isStepScreen = STEP_KEYS.includes(screenKey);
  const meta = STEP_META[screenKey] || STEP_META.invite;
  const logoSrc = '/assets/images/cargo_merged_originalmark_syne800_true.png';

  const marqueeText = (MARQUEE_LABELS[screenKey] || 'Crew').toUpperCase();
  const marqueeUnit = marqueeText + ' · ';
  const marqueeReps = Math.max(24, Math.ceil(950 / marqueeUnit.length));

  const goBack = () => {
    setError('');
    if (screenKey === 'login') { setActiveTab('signup'); return; }
    if (screenKey === 'details') { setWizStep(1); return; }
    if (screenKey === 'password') { setWizStep(2); return; }
  };
  const showBack = ['login', 'details', 'password'].includes(screenKey);

  const step2Valid = !!(firstName?.trim() && surname?.trim() && prefix && sex && dateOfBirth && nationality);
  const goStep = (n) => { setError(''); setWizStep(n); };

  const alerts = (
    <>
      {error && <div className="ia-alert err"><Icon name="AlertCircle" size={16} /> <span>{error}</span></div>}
      {sessionEmailMismatch && (
        <div className="ia-alert warn">
          <Icon name="AlertTriangle" size={16} />
          <div>
            <b>Different account logged in</b>
            You're signed in as <strong>{loggedInEmail}</strong>, but this invite is for <strong>{inviteEmail}</strong>. Sign out, then create an account or log in with the invited address.
            <button type="button" className="ia-link" onClick={async () => { await supabase?.auth?.signOut(); setSessionEmailMismatch(false); setLoggedInEmail(''); }}>Sign out of {loggedInEmail}</button>
          </div>
        </div>
      )}
      {infoBanner && <div className="ia-alert info"><Icon name="Info" size={16} /> <span>{infoBanner}</span></div>}
      {emailConfirmationRequired && (
        <div className="ia-alert warn">
          <Icon name="Mail" size={16} />
          <div><b>Confirm your email</b>Check your inbox and click the confirmation link to activate your account.</div>
        </div>
      )}
    </>
  );

  return (
    <div className="onb-shell" style={{ '--wbg': theme.bg, '--wfg': theme.fg, '--wac': theme.ac }}>
      {screenKey === 'invite' && (
        <>
          <span className="onb-blob one" />
          <span className="onb-blob two" />
          <span className="onb-blob three" />
        </>
      )}
      {screenKey === 'done' && <Confetti />}

      <header className="onb-bar">
        <div className="onb-bar-left">
          {showBack && (
            <button className="onb-back" onClick={goBack} aria-label="Back">
              <Icon name="ChevronLeft" size={18} />
            </button>
          )}
          <img className={`onb-logo${DARK_SCREENS.includes(screenKey) ? ' invert' : ''}`} src={logoSrc} alt="Cargo" />
        </div>
        {isStepScreen && (
          <div className="onb-bar-right">
            <span className="onb-ticks">
              {STEP_KEYS.map((k) => (
                <i key={k} className={STEP_KEYS.indexOf(k) < STEP_KEYS.indexOf(screenKey) ? 'on' : k === screenKey ? 'cur' : ''} />
              ))}
            </span>
            <span className="onb-count">{meta.numeral} <em>/ 03</em></span>
          </div>
        )}
      </header>

      <div className="onb-marquee">
        <span>{marqueeUnit.repeat(marqueeReps)}</span>
      </div>

      <main className="onb-main" key={screenKey}>
        {/* ---------- LOADING ---------- */}
        {screenKey === 'loading' && (
          <div className="ia-solo">
            <div className="onb-panel onb-panel--narrow ia-loading">
              <Icon name="Loader2" size={28} className="ia-spin" color="#C65A1A" />
              <p>Loading your invite…</p>
            </div>
          </div>
        )}

        {/* ---------- ERROR ---------- */}
        {screenKey === 'error' && (
          <div className="ia-solo">
            <div className="onb-panel onb-panel--narrow ia-center">
              <span className="ia-erricon"><Icon name="AlertCircle" size={26} color="#B14E16" /></span>
              <h1 className="onb-head">Invalid <em>invite</em>.</h1>
              <p className="ia-errbody">{error}</p>
              <div className="onb-ctarow center">
                <button type="button" className="onb-cta" onClick={() => navigate('/login-authentication')}>Go to login</button>
              </div>
            </div>
          </div>
        )}

        {/* ---------- DONE (real success or preview) ---------- */}
        {screenKey === 'done' && (
          <div className="onb-split">
            <div className="onb-left"><div className="onb-giant word">ABOARD</div></div>
            <div className="onb-right ia-center-mobile">
              <span className="onb-glyph done"><Icon name="Check" size={30} color="white" strokeWidth={2.4} /></span>
              <h1 className="onb-head">Welcome aboard, <em>{firstName || 'Captain'}</em>.</h1>
              <div className="onb-chips">
                <span className="onb-chip" style={{ pointerEvents: 'none' }}><Icon name="Users" size={15} color="var(--wac)" strokeWidth={1.9} /> Crew rota</span>
                <span className="onb-chip" style={{ pointerEvents: 'none' }}><Icon name="FileText" size={15} color="var(--wac)" strokeWidth={1.9} /> Documents</span>
                <span className="onb-chip" style={{ pointerEvents: 'none' }}><Icon name="ClipboardList" size={15} color="var(--wac)" strokeWidth={1.9} /> Handover notes</span>
              </div>
              <div className="onb-ctarow">
                <button
                  type="button"
                  className="onb-cta welcome"
                  onClick={() => {
                    if (previewMode) {
                      setFlowComplete(false); setStep('create'); setActiveTab('signup'); setWizStep(1);
                      setFirstName(''); setSurname(''); setPassword(''); setConfirmPassword(''); setLoginPassword(''); setError('');
                    } else {
                      navigate('/dashboard', { replace: true });
                    }
                  }}
                >
                  {previewMode ? 'Restart preview' : 'Enter Cargo'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ---------- JOIN (already logged in, matching email) ---------- */}
        {screenKey === 'join' && (
          <div className="onb-split">
            <div className="onb-left"><div className="onb-giant">01</div></div>
            <div className="onb-right ia-center-mobile">
              <span className="onb-glyph"><Icon name="Ship" size={30} color="white" strokeWidth={2} /></span>
              <div className="onb-panel onb-panel--narrow">
                <h1 className="onb-head">Welcome <em>back</em>.</h1>
                {alerts}
                <div className="ia-summary">
                  <div className="ia-ro"><span className="k">Vessel</span><span className="v">{vesselName}</span></div>
                  <div className="ia-ro"><span className="k">Role</span><span className="v">{inviteRoleName}</span></div>
                  <div className="ia-ro"><span className="k">Department</span><span className="v">{departmentName}</span></div>
                  <div className="ia-ro"><span className="k">Email</span><span className="v">{inviteEmail}</span></div>
                </div>
                <div className="onb-ctarow">
                  <button type="button" className="onb-cta" onClick={handleJoinVessel} disabled={isSubmitting}>
                    {isSubmitting ? 'Joining…' : 'Join vessel'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ---------- LOGIN ---------- */}
        {screenKey === 'login' && (
          <div className="onb-split">
            <div className="onb-left"><div className="onb-giant">01</div></div>
            <div className="onb-right ia-center-mobile">
              <span className="onb-glyph"><Icon name="LogIn" size={30} color="white" strokeWidth={2} /></span>
              <form onSubmit={handleLogin} className="onb-panel onb-panel--narrow">
                <h1 className="onb-head">Welcome <em>back</em>.</h1>
                {alerts}
                <div className="ia-field ro"><span className="ia-label">Email</span><div className="ia-static">{inviteEmail}</div></div>
                <label className="ia-field">
                  <span className="ia-label">Password <span className="req">*</span></span>
                  <div className="ia-pw">
                    <input className="ia-input" type={showLoginPassword ? 'text' : 'password'} name="password" autoComplete="current-password" value={loginPassword} onChange={(e) => setLoginPassword(e?.target?.value)} placeholder="Enter your password" disabled={isSubmitting} />
                    <button type="button" className="ia-eye" onClick={() => setShowLoginPassword(!showLoginPassword)} disabled={isSubmitting} aria-label={showLoginPassword ? 'Hide password' : 'Show password'}><Icon name={showLoginPassword ? 'EyeOff' : 'Eye'} size={17} /></button>
                  </div>
                </label>
                <div className="onb-ctarow">
                  <button type="submit" className="onb-cta" disabled={isButtonDisabled}>{isSubmitting ? 'Logging in…' : 'Log in & join'}</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ---------- STEP 1 · INVITE ---------- */}
        {screenKey === 'invite' && (
          <div className="onb-split">
            <div className="onb-left"><div className="onb-giant">01</div></div>
            <div className="onb-right ia-center-mobile">
              <span className="onb-glyph"><Icon name="Ship" size={30} color="white" strokeWidth={2} /></span>
              <div className="onb-panel onb-panel--narrow">
                <h1 className="onb-head">You're <em>invited</em>.</h1>
                <p className="ia-sub">to join {VESSEL_PREFIX[vesselTypeLabel] ? `${VESSEL_PREFIX[vesselTypeLabel]} ` : ''}{vesselName}.</p>
                {alerts}
                <div className="ia-stats">
                  <div className="ia-stat"><span className="v">{loaM != null ? `${loaM}m` : '—'}</span><span className="k">LOA</span></div>
                  <div className="ia-stat"><span className="v">{crewCount ?? '—'}</span><span className="k">Crew</span></div>
                  <div className="ia-stat"><span className="v">{departmentCount ?? '—'}</span><span className="k">Departments</span></div>
                </div>
                <div className="ia-summary">
                  <div className="ia-ro"><span className="k">Role</span><span className="v">{inviteRoleName}</span></div>
                  <div className="ia-ro"><span className="k">Department</span><span className="v">{departmentName}</span></div>
                </div>
                <div className="onb-ctarow">
                  <button type="button" className="onb-cta" onClick={() => goStep(2)} disabled={inviteDetailsLoading}>Get started</button>
                </div>
                <button type="button" className="ia-loginlink" onClick={() => { setActiveTab('login'); setError(''); }}>Already have an account? <span>Log in</span></button>
              </div>
            </div>
          </div>
        )}

        {/* ---------- STEP 2 · DETAILS ---------- */}
        {screenKey === 'details' && (
          <div className="onb-split">
            <div className="onb-left"><div className="onb-giant">02</div></div>
            <div className="onb-right ia-center-mobile">
              <span className="onb-glyph"><Icon name="User" size={30} color="white" strokeWidth={2} /></span>
              <form className="onb-panel onb-panel--narrow ia-panel-wide" autoComplete="off" onSubmit={(e) => { e.preventDefault(); if (step2Valid) goStep(3); }}>
                <h1 className="onb-head">About, <em>you</em>.</h1>
                {alerts}
                <div className="ia-row">
                  <label className="ia-field ia-field--sm"><span className="ia-label">Prefix <span className="req">*</span></span>
                    <select className="ia-input" name="ia-prefix" value={prefix} onChange={(e) => setPrefix(e?.target?.value)}>
                      <option value="">Select…</option>
                      {PREFIX_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select></label>
                  <label className="ia-field"><span className="ia-label">First name <span className="req">*</span></span>
                    <input className="ia-input" type="text" name="ia-first-name" autoComplete="given-name" value={firstName} onChange={(e) => setFirstName(e?.target?.value)} placeholder="Julia" /></label>
                </div>
                <div className="ia-row">
                  <label className="ia-field"><span className="ia-label">Surname <span className="req">*</span></span>
                    <input className="ia-input" type="text" name="ia-surname" autoComplete="family-name" value={surname} onChange={(e) => setSurname(e?.target?.value)} placeholder="Smith" /></label>
                  <label className="ia-field"><span className="ia-label">Sex <span className="req">*</span></span>
                    <select className="ia-input" name="ia-sex" value={sex} onChange={(e) => setSex(e?.target?.value)}>
                      <option value="">Select…</option>
                      {SEX_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select></label>
                </div>
                <div className="ia-row">
                  <label className="ia-field"><span className="ia-label">Date of birth <span className="req">*</span></span>
                    <EditorialDatePicker value={dateOfBirth} onChange={setDateOfBirth} placeholder="dd/mm/yyyy" /></label>
                  <label className="ia-field"><span className="ia-label">Nationality <span className="req">*</span></span>
                    <select className="ia-input" name="ia-nationality" value={nationality} onChange={(e) => setNationality(e?.target?.value)}>
                      <option value="">Select…</option>
                      {NATIONALITIES.map((n) => <option key={n} value={n}>{n}</option>)}
                    </select></label>
                </div>
                <div className="onb-ctarow">
                  <button type="submit" className="onb-cta" disabled={!step2Valid}>Continue</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ---------- STEP 3 · PASSWORD ---------- */}
        {screenKey === 'password' && (
          <div className="onb-split">
            <div className="onb-left"><div className="onb-giant">03</div></div>
            <div className="onb-right ia-center-mobile">
              <span className="onb-glyph"><Icon name="Lock" size={28} color="white" strokeWidth={2} /></span>
              <form className="onb-panel onb-panel--narrow" autoComplete="off" onSubmit={handleCreateAccount}>
                <h1 className="onb-head">Set <em>password</em>.</h1>
                <p className="ia-sub">You'll use this to log in to Cargo from now on.</p>
                {alerts}
                <div className="ia-summary">
                  <div className="ia-ro"><span className="k">Email</span><span className="v">{inviteEmail}</span></div>
                </div>
                <label className="ia-field"><span className="ia-label">Password <span className="req">*</span></span>
                  <div className="ia-pw">
                    <input className="ia-input" type={showPassword ? 'text' : 'password'} name="ia-new-password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e?.target?.value)} placeholder="Create a password" disabled={isSubmitting} />
                    <button type="button" className="ia-eye" onClick={() => setShowPassword(!showPassword)} disabled={isSubmitting} aria-label={showPassword ? 'Hide password' : 'Show password'}><Icon name={showPassword ? 'EyeOff' : 'Eye'} size={17} /></button>
                  </div></label>
                <div className="pwmeter">
                  <div className="pwmeter-bar"><div className={`pwmeter-fill s${PASSWORD_CHECKS.filter((c) => c.test(password || '')).length}`} /></div>
                  <ul className="pwreqs">
                    {PASSWORD_CHECKS.map((c) => (
                      <li key={c.key} className={c.test(password || '') ? 'ok' : ''}>{c.label}</li>
                    ))}
                  </ul>
                </div>
                <label className="ia-field"><span className="ia-label">Confirm password <span className="req">*</span></span>
                  <div className="ia-pw">
                    <input className="ia-input" type={showConfirmPassword ? 'text' : 'password'} name="ia-confirm-password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e?.target?.value)} placeholder="Re-enter password" disabled={isSubmitting} />
                    <button type="button" className="ia-eye" onClick={() => setShowConfirmPassword(!showConfirmPassword)} disabled={isSubmitting} aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}><Icon name={showConfirmPassword ? 'EyeOff' : 'Eye'} size={17} /></button>
                  </div></label>
                {disabledReason && <p className="ia-hint">{disabledReason}</p>}
                <div className="onb-ctarow">
                  <button type="submit" className="onb-cta" disabled={isButtonDisabled}>{isSubmitting ? 'Creating account…' : 'Create account & join'}</button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default InviteAcceptPage;