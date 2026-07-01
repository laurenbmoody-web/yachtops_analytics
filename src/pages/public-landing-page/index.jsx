import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../components/AppIcon';
import { supabase } from '../../lib/supabaseClient';
import './public-landing.css';

const PublicLandingPage = () => {
  const navigate = useNavigate();
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
      <div className="pl-loading">
        <Icon name="Loader2" size={28} className="animate-spin" />
        <span>Loading…</span>
      </div>
    );
  }

  return (
    <div className="pl-page">
      <span className="pl-blob one" aria-hidden="true" />
      <span className="pl-blob two" aria-hidden="true" />

      <div className="pl-card">
        <img
          className="pl-logo"
          src="/assets/images/cargo_merged_originalmark_syne800_true.png"
          alt="Cargo"
        />

        <p className="pl-eyebrow">Yacht operations, run properly</p>
        <h1 className="pl-heading">
          Welcome aboard, <em>Belongers</em>.
        </h1>
        <p className="pl-sub">
          Crew, provisioning, defects, and jobs — all in one vessel operating system.
          Set up your vessel in minutes.
        </p>

        <div className="pl-actions">
          <button
            type="button"
            className="pl-btn-primary"
            onClick={() => navigate('/pricing')}
          >
            <Icon name="Ship" size={18} />
            Start your vessel
          </button>
        </div>

        <div className="pl-divider">
          <span className="line" />
          <span>Already have an account?</span>
          <span className="line" />
        </div>

        <button
          type="button"
          className="pl-btn-ghost"
          style={{ width: '100%', marginTop: 16, marginBottom: 28 }}
          onClick={() => navigate('/login-authentication')}
        >
          Log in
        </button>

        <p className="pl-footer">
          Secure operations management · Role-based access · Real-time collaboration
        </p>
      </div>
    </div>
  );
};

export default PublicLandingPage;
