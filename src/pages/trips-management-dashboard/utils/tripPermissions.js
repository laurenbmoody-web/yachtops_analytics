// Trip Management Permission Utility

import { getCurrentUser } from '../../../utils/authStorage';
import { isDevMode } from '../../../utils/devMode';

// Normalize tier to uppercase for case-insensitive comparison
export const normalizeTier = (user) => {
  if (!user) return 'CREW';
  const tierRaw = user?.effectiveTier || user?.permissionTier || user?.tier || '';
  return String(tierRaw)?.toUpperCase()?.trim();
};

// Get current user's normalized tier
export const getCurrentUserTier = () => {
  const user = getCurrentUser();
  if (!user) return null;
  return normalizeTier(user);
};

// Check if user can access Trips Management page at all
export const canAccessTrips = (user = null) => {
  if (isDevMode()) return true;
  const currentUser = user || getCurrentUser();
  if (!currentUser) return false;
  
  const tier = normalizeTier(currentUser);
  // CREW cannot access Trips Management
  return tier !== 'CREW' && tier !== 'OPTIONAL_CREW';
};

// Check if user can view trips (COMMAND, CHIEF, HOD can view)
export const canViewTrips = (user = null) => {
  if (isDevMode()) return true;
  const currentUser = user || getCurrentUser();
  if (!currentUser) return false;
  
  const tier = normalizeTier(currentUser);
  return tier === 'COMMAND' || tier === 'CHIEF' || tier === 'HOD';
};

// Check if user can add trips (COMMAND, CHIEF can add)
export const canAddTrip = (user = null) => {
  if (isDevMode()) return true;
  const currentUser = user || getCurrentUser();
  if (!currentUser) return false;
  
  const tier = normalizeTier(currentUser);
  return tier === 'COMMAND' || tier === 'CHIEF';
};

// Check if user can edit trips (COMMAND, CHIEF can edit)
export const canEditTrip = (user = null) => {
  if (isDevMode()) return true;
  const currentUser = user || getCurrentUser();
  if (!currentUser) return false;
  
  const tier = normalizeTier(currentUser);
  return tier === 'COMMAND' || tier === 'CHIEF';
};

// Check if user can delete trips (COMMAND, CHIEF can delete)
export const canDeleteTrip = (user = null) => {
  if (isDevMode()) return true;
  const currentUser = user || getCurrentUser();
  if (!currentUser) return false;
  
  const tier = normalizeTier(currentUser);
  return tier === 'COMMAND' || tier === 'CHIEF';
};

// Check if user can manage preferences (COMMAND, CHIEF can manage)
export const canManagePreferences = (user = null) => {
  if (isDevMode()) return true;
  const currentUser = user || getCurrentUser();
  if (!currentUser) return false;
  
  const tier = normalizeTier(currentUser);
  return tier === 'COMMAND' || tier === 'CHIEF';
};

// Get permission summary for current user
export const getTripPermissions = (user = null) => {
  const currentUser = user || getCurrentUser();
  if (!currentUser) {
    return {
      canAccess: false,
      canView: false,
      canAdd: false,
      canEdit: false,
      canDelete: false,
      canManagePreferences: false,
      tier: null
    };
  }
  
  const tier = normalizeTier(currentUser);
  
  return {
    canAccess: canAccessTrips(currentUser),
    canView: canViewTrips(currentUser),
    canAdd: canAddTrip(currentUser),
    canEdit: canEditTrip(currentUser),
    canDelete: canDeleteTrip(currentUser),
    canManagePreferences: canManagePreferences(currentUser),
    tier
  };
};
