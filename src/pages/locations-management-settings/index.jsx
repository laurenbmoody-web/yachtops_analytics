// Location Management — Vessel Hub surface. The vessel's decks → zones → spaces
// rendered as the Gallery: every space shows its scan (or invites one), with a
// flow ↔ static toggle and scan-coverage at a glance. Renders standalone (its
// own Header + breadcrumb) or embedded inside the Vessel Hub tabs.
import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Icon from '../../components/AppIcon';
import { useAuth } from '../../contexts/AuthContext';
import { getCurrentUser, hasCommandAccess, hasChiefAccess } from '../../utils/authStorage';
import LocationGallery from './components/LocationGallery';

const LocationsManagementSettings = ({ embedded = false, onStats, hideStats = false }) => {
  const navigate = useNavigate();
  const { bootstrapComplete, tenantRole } = useAuth();
  const currentUser = getCurrentUser();

  // Access — Command and Chief only.
  const normalizedRole = (tenantRole || '').toUpperCase().trim();
  const canAccess = normalizedRole === 'COMMAND' || normalizedRole === 'CHIEF'
    || hasCommandAccess(currentUser) || hasChiefAccess(currentUser);

  useEffect(() => {
    if (!embedded && bootstrapComplete && !canAccess) navigate('/dashboard');
  }, [canAccess, bootstrapComplete, navigate, embedded]);

  if (!bootstrapComplete) {
    return embedded ? (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    ) : (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
        </div>
      </div>
    );
  }

  if (!canAccess) {
    return embedded ? (
      <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
        Access restricted to Command and Chief only.
      </div>
    ) : null;
  }

  return (
    <div className={embedded ? '' : 'min-h-screen bg-gray-50'}>
      {!embedded && <Header />}
      <div className={embedded ? '' : 'max-w-7xl mx-auto px-4 py-6'}>
        {!embedded && (
          <div className="mb-6">
            <div className="flex items-center gap-2 text-sm text-gray-600 mb-2">
              <button onClick={() => navigate('/dashboard')} className="hover:text-gray-900">Dashboard</button>
              <Icon name="ChevronRight" size={14} />
              <button onClick={() => navigate('/settings/vessel')} className="hover:text-gray-900">Vessel Hub</button>
              <Icon name="ChevronRight" size={14} />
              <span className="text-gray-900 font-medium">Locations</span>
            </div>
          </div>
        )}
        <LocationGallery onStats={onStats} hideStats={hideStats} />
      </div>
    </div>
  );
};

export default LocationsManagementSettings;
