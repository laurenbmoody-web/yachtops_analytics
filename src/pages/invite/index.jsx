import React, { useEffect } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import Icon from '../../components/AppIcon';
import Image from '../../components/AppImage';
import { useTheme } from '../../contexts/ThemeContext';

const InvitePage = () => {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    // Try to get token from query string first
    let inviteToken = searchParams?.get('token');
    
    // If not in query string, try hash format: #/invite?token=...
    if (!inviteToken && location?.hash) {
      const hashParams = new URLSearchParams(location.hash.split('?')[1]);
      inviteToken = hashParams?.get('token');
    }
    
    if (inviteToken) {
      // Redirect to new /invite-accept route with token
      navigate(`/invite-accept?token=${inviteToken}`, { replace: true });
    } else {
      // No token - redirect to /invite-accept without token (will show error)
      navigate('/invite-accept', { replace: true });
    }
  }, [searchParams, location, navigate]);

  // Show loading state during redirect
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
        <p className="text-sm text-muted-foreground">Redirecting...</p>
      </div>
    </div>
  );
};

export default InvitePage;