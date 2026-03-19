// Guest Management Storage Utility
import { logActivity } from './activityStorage';

// Storage key
const GUESTS_KEY = 'cargo.guests.v1';

// Guest Actions for activity feed
export const GuestActions = {
  GUEST_CREATED: 'GUEST_CREATED',
  GUEST_UPDATED: 'GUEST_UPDATED',
  GUEST_DELETED: 'GUEST_DELETED'
};

// Marital Status enum
export const MaritalStatus = {
  SINGLE: 'single',
  MARRIED: 'married',
  PARTNERED: 'partnered',
  DIVORCED: 'divorced',
  WIDOWED: 'widowed',
  UNKNOWN: 'unknown'
};

// Load guests from localStorage
export const loadGuests = () => {
  try {
    const stored = localStorage.getItem(GUESTS_KEY);
    if (!stored) return [];
    return JSON.parse(stored);
  } catch (error) {
    console.error('Error loading guests:', error);
    return [];
  }
};

// Save guests to localStorage
export const saveGuests = (guests) => {
  try {
    localStorage.setItem(GUESTS_KEY, JSON.stringify(guests));
    return true;
  } catch (error) {
    console.error('Error saving guests:', error);
    return false;
  }
};

// Create new guest
export const createGuest = (guestData, currentUserId) => {
  try {
    const guests = loadGuests();
    const newGuest = {
      id: `guest-${Date.now()}-${Math.random()?.toString(36)?.substr(2, 9)}`,
      firstName: guestData?.firstName || '',
      lastName: guestData?.lastName || '',
      photo: guestData?.photo || null,
      dateOfBirth: guestData?.dateOfBirth || null,
      cakePreference: guestData?.cakePreference || '',
      maritalStatus: guestData?.maritalStatus || MaritalStatus?.UNKNOWN,
      spouseGuestId: guestData?.spouseGuestId || null,
      contactEmail: guestData?.contactEmail || '',
      contactPhone: guestData?.contactPhone || '',
      healthConditions: guestData?.healthConditions || '',
      allergies: guestData?.allergies || '',
      cabinAllocated: guestData?.cabinAllocated || '',
      preferencesSummary: guestData?.preferencesSummary || '',
      preferencesLinkEnabled: guestData?.preferencesLinkEnabled !== false,
      createdAt: new Date()?.toISOString(),
      createdByUserId: currentUserId || null,
      updatedAt: new Date()?.toISOString(),
      updatedByUserId: currentUserId || null
    };
    
    guests?.push(newGuest);
    saveGuests(guests);

    // Log to activity feed
    const guestName = `${guestData?.firstName || ''} ${guestData?.lastName || ''}`?.trim();
    logActivity({
      module: 'guests',
      action: GuestActions?.GUEST_CREATED,
      entityType: 'guest',
      entityId: newGuest?.id,
      summary: `Guest created: ${guestName}`,
      meta: { guestName }
    });

    return newGuest;
  } catch (error) {
    console.error('Error creating guest:', error);
    return null;
  }
};

// Update existing guest
export const updateGuest = (guestId, updates, currentUserId) => {
  try {
    const guests = loadGuests();
    const index = guests?.findIndex(g => g?.id === guestId);
    
    if (index === -1) {
      console.error('Guest not found:', guestId);
      return null;
    }
    
    const oldGuest = guests?.[index];
    const oldSpouseId = oldGuest?.spouseGuestId;
    const newSpouseId = updates?.spouseGuestId !== undefined ? updates?.spouseGuestId : oldSpouseId;
    const newMaritalStatus = updates?.maritalStatus !== undefined ? updates?.maritalStatus : oldGuest?.maritalStatus;
    
    // Update the guest
    guests[index] = {
      ...oldGuest,
      ...updates,
      updatedAt: new Date()?.toISOString(),
      updatedByUserId: currentUserId || null
    };
    
    // Handle spouse linking changes
    if (oldSpouseId !== newSpouseId) {
      // Clear old spouse link (if exists)
      if (oldSpouseId) {
        const oldSpouseIndex = guests?.findIndex(g => g?.id === oldSpouseId);
        if (oldSpouseIndex !== -1) {
          guests[oldSpouseIndex] = {
            ...guests?.[oldSpouseIndex],
            spouseGuestId: null,
            updatedAt: new Date()?.toISOString(),
            updatedByUserId: currentUserId || null
          };
        }
      }
      
      // Set new spouse link (if exists)
      if (newSpouseId) {
        const newSpouseIndex = guests?.findIndex(g => g?.id === newSpouseId);
        if (newSpouseIndex !== -1) {
          const spouse = guests?.[newSpouseIndex];
          // Auto-set spouse's maritalStatus to partnered if not already married/partnered
          const shouldUpdateSpouseStatus = 
            spouse?.maritalStatus !== MaritalStatus?.MARRIED && 
            spouse?.maritalStatus !== MaritalStatus?.PARTNERED;
          
          guests[newSpouseIndex] = {
            ...spouse,
            spouseGuestId: guestId,
            maritalStatus: shouldUpdateSpouseStatus ? MaritalStatus?.PARTNERED : spouse?.maritalStatus,
            updatedAt: new Date()?.toISOString(),
            updatedByUserId: currentUserId || null
          };
        }
      }
    }
    
    // If maritalStatus changed to single/divorced/widowed, clear spouse link
    if (
      newMaritalStatus !== MaritalStatus?.MARRIED && 
      newMaritalStatus !== MaritalStatus?.PARTNERED && 
      guests?.[index]?.spouseGuestId
    ) {
      const spouseId = guests?.[index]?.spouseGuestId;
      guests[index].spouseGuestId = null;
      
      // Clear reciprocal link
      const spouseIndex = guests?.findIndex(g => g?.id === spouseId);
      if (spouseIndex !== -1) {
        guests[spouseIndex] = {
          ...guests?.[spouseIndex],
          spouseGuestId: null,
          updatedAt: new Date()?.toISOString(),
          updatedByUserId: currentUserId || null
        };
      }
    }
    
    saveGuests(guests);

    // Log to activity feed
    const guestName = `${oldGuest?.firstName || ''} ${oldGuest?.lastName || ''}`?.trim();
    logActivity({
      module: 'guests',
      action: GuestActions?.GUEST_UPDATED,
      entityType: 'guest',
      entityId: guestId,
      summary: `Guest updated: ${guestName}`,
      meta: { guestName }
    });

    return guests?.[index];
  } catch (error) {
    console.error('Error updating guest:', error);
    return null;
  }
};

// Delete guest
export const deleteGuest = (guestId, currentUserId) => {
  try {
    const guests = loadGuests();
    const guestToDelete = guests?.find(g => g?.id === guestId);
    
    if (!guestToDelete) {
      console.error('Guest not found:', guestId);
      return false;
    }
    
    // Clear spouse link from linked guest
    if (guestToDelete?.spouseGuestId) {
      const spouseIndex = guests?.findIndex(g => g?.id === guestToDelete?.spouseGuestId);
      if (spouseIndex !== -1) {
        guests[spouseIndex] = {
          ...guests?.[spouseIndex],
          spouseGuestId: null,
          updatedAt: new Date()?.toISOString(),
          updatedByUserId: currentUserId || null
        };
      }
    }
    
    // Remove the guest
    const filtered = guests?.filter(g => g?.id !== guestId);
    saveGuests(filtered);

    // Log to activity feed
    const guestName = `${guestToDelete?.firstName || ''} ${guestToDelete?.lastName || ''}`?.trim();
    logActivity({
      module: 'guests',
      action: GuestActions?.GUEST_DELETED,
      entityType: 'guest',
      entityId: guestId,
      summary: `Guest deleted: ${guestName}`,
      meta: { guestName }
    });

    return true;
  } catch (error) {
    console.error('Error deleting guest:', error);
    return false;
  }
};

// Get guest by ID
export const getGuestById = (guestId) => {
  const guests = loadGuests();
  return guests?.find(g => g?.id === guestId) || null;
};

// Get marital status display name
export const getMaritalStatusDisplay = (status) => {
  const displayMap = {
    [MaritalStatus?.SINGLE]: 'Single',
    [MaritalStatus?.MARRIED]: 'Married',
    [MaritalStatus?.PARTNERED]: 'Partnered',
    [MaritalStatus?.DIVORCED]: 'Divorced',
    [MaritalStatus?.WIDOWED]: 'Widowed',
    [MaritalStatus?.UNKNOWN]: 'Unknown'
  };
  return displayMap?.[status] || 'Unknown';
};