// Guest Management Permission Utility

import { getCurrentUser } from '../../../utils/authStorage';
import { isDevMode } from '../../../utils/devMode';

// Normalize tier to uppercase for case-insensitive comparison
// Uses consistent resolution: effectiveTier || permissionTier || tier
export const normalizeTier = (user) => {
  if (!user) return 'CREW';
  const tierRaw = user?.effectiveTier || user?.permissionTier || user?.tier || user?.permission_tier || '';
  return String(tierRaw)?.toUpperCase()?.trim();
};

// Get current user's normalized tier
export const getCurrentUserTier = () => {
  const user = getCurrentUser();
  if (!user) return null;
  return normalizeTier(user);
};

// Check if user can access Guest Management page at all
export const canAccessGuestManagement = (user = null) => {
  if (isDevMode()) return true;
  const currentUser = user || getCurrentUser();
  if (!currentUser) return false;
  
  const tier = normalizeTier(currentUser);
  // COMMAND users always have access
  if (tier === 'COMMAND') return true;
  // CREW cannot access Guest Management
  return tier !== 'CREW' && tier !== 'OPTIONAL_CREW';
};

// Check if user can view guests (COMMAND, CHIEF, HOD can view)
export const canViewGuests = (user = null) => {
  if (isDevMode()) return true;
  const currentUser = user || getCurrentUser();
  if (!currentUser) return false;
  
  const tier = normalizeTier(currentUser);
  return tier === 'COMMAND' || tier === 'CHIEF' || tier === 'HOD';
};

// Check if user can see ALL guests (not just active-on-trip)
// COMMAND and CHIEF see all; HOD and CREW see only active-on-trip guests
export const canSeeAllGuests = (user = null) => {
  const currentUser = user || getCurrentUser();
  if (!currentUser) return false;
  const tier = normalizeTier(currentUser);
  return tier === 'COMMAND' || tier === 'CHIEF';
};

// Check if user can expand guest detail panel
// Only COMMAND and CHIEF can expand to see full guest profile
export const canExpandGuest = (user = null) => {
  const currentUser = user || getCurrentUser();
  if (!currentUser) return false;
  const tier = normalizeTier(currentUser);
  return tier === 'COMMAND' || tier === 'CHIEF';
};

// Check if user can add guests (COMMAND, CHIEF can add)
export const canAddGuest = (user = null) => {
  if (isDevMode()) return true;
  const currentUser = user || getCurrentUser();
  if (!currentUser) return false;
  
  const tier = normalizeTier(currentUser);
  return tier === 'COMMAND' || tier === 'CHIEF';
};

// Check if user can edit guests (COMMAND, CHIEF can edit)
export const canEditGuest = (user = null) => {
  if (isDevMode()) return true;
  const currentUser = user || getCurrentUser();
  if (!currentUser) return false;
  
  const tier = normalizeTier(currentUser);
  return tier === 'COMMAND' || tier === 'CHIEF';
};

// Check if user can delete guests (COMMAND can delete)
export const canDeleteGuest = (user = null) => {
  if (isDevMode()) return true;
  const currentUser = user || getCurrentUser();
  if (!currentUser) return false;
  
  const tier = normalizeTier(currentUser);
  return tier === 'COMMAND';
};

// Get permission summary for current user
export const getGuestPermissions = (user = null) => {
  const currentUser = user || getCurrentUser();
  if (!currentUser) {
    return {
      canAccess: false,
      canView: false,
      canAdd: false,
      canEdit: false,
      canDelete: false,
      canExpand: false,
      canSeeAll: false,
      tier: null
    };
  }
  
  const tier = normalizeTier(currentUser);
  
  // COMMAND tier gets full access to everything
  if (tier === 'COMMAND') {
    return {
      canAccess: true,
      canView: true,
      canAdd: true,
      canEdit: true,
      canDelete: true,
      canExpand: true,
      canSeeAll: true,
      tier
    };
  }

  // CHIEF tier gets full access except delete
  if (tier === 'CHIEF') {
    return {
      canAccess: true,
      canView: true,
      canAdd: true,
      canEdit: true,
      canDelete: false,
      canExpand: true,
      canSeeAll: true,
      tier
    };
  }
  
  return {
    canAccess: canAccessGuestManagement(currentUser),
    canView: canViewGuests(currentUser),
    canAdd: false,
    canEdit: false,
    canDelete: false,
    canExpand: false,
    canSeeAll: false,
    tier
  };
};
