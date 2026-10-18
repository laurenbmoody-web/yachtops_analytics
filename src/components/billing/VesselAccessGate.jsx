import React from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useVesselAccess } from '../../lib/vesselAccess';
import MembershipEnded from './MembershipEnded';

// Wraps vessel pages (ProtectedRoute / CommandRoute / …). Once the vessel's plan
// has ended, every vessel page shows the "membership ended" screen instead —
// except Membership itself (to resubscribe). Pages that don't need a vessel
// (settings, crew profile) aren't wrapped, so crew keep their own records.
const ALWAYS_OPEN = ['/membership'];

const VesselAccessGate = ({ children }) => {
  const { activeTenantId } = useAuth();
  const { pathname } = useLocation();
  const access = useVesselAccess(activeTenantId);
  if (!access.loading && access.ended && !ALWAYS_OPEN.includes(pathname)) {
    return <MembershipEnded access={access} />;
  }
  return children;
};

export default VesselAccessGate;
