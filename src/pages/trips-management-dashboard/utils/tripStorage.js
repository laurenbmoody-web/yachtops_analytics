// Trip Management Storage Utility

import { showToast } from '../../../utils/toast';
import { normalizeTier } from './tripPermissions';
import { logActivity } from '../../../utils/activityStorage';

// Trip Status enum
export const TripStatus = {
  UPCOMING: 'upcoming',
  ACTIVE: 'active',
  COMPLETED: 'completed'
};

// Trip Type enum
export const TripType = {
  OWNER: 'Owner',
  CHARTER: 'Charter',
  FRIENDS_FAMILY: 'Friends/Family',
  OTHER: 'Other'
};

// Special Date Type enum
export const SpecialDateType = {
  BIRTHDAY: 'Birthday',
  ANNIVERSARY: 'Anniversary',
  CELEBRATION: 'Celebration',
  OTHER: 'Other'
};

// Special Request Status enum
export const SpecialRequestStatus = {
  PLANNED: 'Planned',
  IN_PROGRESS: 'In progress',
  DONE: 'Done'
};

// Trip Activity Type enum
export const TripActivityType = {
  GUEST_ADDED: 'GUEST_ADDED',
  GUEST_REMOVED: 'GUEST_REMOVED',
  GUEST_ACTIVATED: 'GUEST_ACTIVATED',
  GUEST_DEACTIVATED: 'GUEST_DEACTIVATED',
  PREFERENCE_ADDED: 'PREFERENCE_ADDED',
  PREFERENCE_UPDATED: 'PREFERENCE_UPDATED',
  REQUEST_CREATED: 'REQUEST_CREATED',
  REQUEST_UPDATED: 'REQUEST_UPDATED',
  REQUEST_COMPLETED: 'REQUEST_COMPLETED',
  OCCASION_CREATED: 'OCCASION_CREATED',
  OCCASION_UPDATED: 'OCCASION_UPDATED',
  ITINERARY_DAY_ADDED: 'ITINERARY_DAY_ADDED',
  ITINERARY_DAY_UPDATED: 'ITINERARY_DAY_UPDATED',
  ITINERARY_DAY_DELETED: 'ITINERARY_DAY_DELETED',
  TRIP_STATUS_CHANGED: 'TRIP_STATUS_CHANGED',
  TRIP_COMPLETED: 'TRIP_COMPLETED'
};

// Trip Actions for activity feed
export const TripActions = {
  TRIP_CREATED: 'TRIP_CREATED',
  TRIP_UPDATED: 'TRIP_UPDATED',
  TRIP_DELETED: 'TRIP_DELETED',
  TRIP_STATUS_CHANGED: 'TRIP_STATUS_CHANGED',
  TRIP_GUEST_ADDED: 'TRIP_GUEST_ADDED',
  TRIP_GUEST_REMOVED: 'TRIP_GUEST_REMOVED'
};

// Preference Category enum
export const PreferenceCategory = {
  FOOD_BEVERAGE: 'Food & Beverage',
  DIETARY: 'Dietary',
  WINE_SPIRITS: 'Wine/Spirits',
  ALLERGIES: 'Allergies',
  ACTIVITIES: 'Activities',
  CABIN: 'Cabin',
  SERVICE: 'Service',
  OTHER: 'Other'
};

// Preference Priority enum
export const PreferencePriority = {
  LOW: 'low',
  NORMAL: 'normal',
  HIGH: 'high'
};

// Storage keys
const TRIPS_KEY = 'cargo.trips.v1';
const PREFERENCES_KEY = 'cargo.preferences.v1';

// Generate unique ID
const generateId = () => {
  return `${Date.now()}-${Math.random()?.toString(36)?.substr(2, 9)}`;
};

// Get current user helpers
const getCurrentUserId = () => {
  try {
    const currentUser = JSON.parse(localStorage.getItem('cargo.currentUser.v1'));
    return currentUser?.id || 'system';
  } catch {
    return 'system';
  }
};

const getCurrentUserName = () => {
  try {
    const currentUser = JSON.parse(localStorage.getItem('cargo.currentUser.v1'));
    return currentUser?.name || currentUser?.username || 'System';
  } catch {
    return 'System';
  }
};

const getCurrentUser = () => {
  try {
    return JSON.parse(localStorage.getItem('cargo.currentUser.v1'));
  } catch {
    return null;
  }
};

// Auto-calculate trip status based on dates
const calculateTripStatus = (startDate, endDate) => {
  const today = new Date();
  today?.setHours(0, 0, 0, 0);
  
  const start = new Date(startDate);
  start?.setHours(0, 0, 0, 0);
  
  const end = new Date(endDate);
  end?.setHours(0, 0, 0, 0);
  
  if (today < start) return TripStatus?.UPCOMING;
  if (today > end) return TripStatus?.COMPLETED;
  return TripStatus?.ACTIVE;
};

// Migrate old trip structure to new guests array format
const migrateTripGuestsStructure = (trip) => {
  // If trip already has guests array, return as-is
  if (trip?.guests && Array.isArray(trip?.guests)) {
    return trip;
  }
  
  // Migrate from old guestIds array to new guests array
  const guests = [];
  
  // Handle old guestIds array
  if (trip?.guestIds && Array.isArray(trip?.guestIds)) {
    trip?.guestIds?.forEach(guestId => {
      // Check if this guest was in activeGuestIds (old structure)
      const wasActive = trip?.activeGuestIds?.includes(guestId);
      guests?.push({
        guestId: guestId,
        isActive: wasActive || false,
        activatedAt: wasActive ? trip?.updatedAt || trip?.createdAt : null,
        activatedByUserId: wasActive ? trip?.updatedByUserId || trip?.createdByUserId : null
      });
    });
  }
  
  return {
    ...trip,
    guests: guests,
    // Keep guestIds for backward compatibility but mark as deprecated
    guestIds: trip?.guestIds || []
  };
};

// ============ TRIP OPERATIONS ============

// Load all trips
export const loadTrips = () => {
  try {
    const data = localStorage.getItem(TRIPS_KEY);
    const trips = data ? JSON.parse(data) : [];
    
    // Migrate all trips to new structure
    const migratedTrips = trips?.map(trip => migrateTripGuestsStructure(trip));
    
    // Save migrated trips if any migration occurred
    const needsSave = migratedTrips?.some((trip, index) => 
      !trips?.[index]?.guests || !Array.isArray(trips?.[index]?.guests)
    );
    
    if (needsSave) {
      saveTrips(migratedTrips);
    }
    
    return migratedTrips;
  } catch (error) {
    console.error('Error loading trips:', error);
    return [];
  }
};

// Save trips
const saveTrips = (trips) => {
  try {
    localStorage.setItem(TRIPS_KEY, JSON.stringify(trips));
    return true;
  } catch (error) {
    console.error('Error saving trips:', error);
    return false;
  }
};

// Create new trip
export const createTrip = (tripData) => {
  try {
    const currentUser = getCurrentUser();
    const userId = getCurrentUserId();
    const userTier = normalizeTier(currentUser);
    
    // Permission check
    if (userTier !== 'COMMAND' && userTier !== 'CHIEF') {
      showToast("You don't have permission to create trips.", 'error');
      return null;
    }
    
    const trips = loadTrips();
    let status = calculateTripStatus(tripData?.startDate, tripData?.endDate);
    
    // Convert guestIds to new guests array structure
    const guests = [];
    if (tripData?.guestIds && Array.isArray(tripData?.guestIds)) {
      tripData?.guestIds?.forEach(guestId => {
        guests?.push({
          guestId: guestId,
          isActive: false,
          activatedAt: null,
          activatedByUserId: null
        });
      });
    }
    
    const newTrip = {
      id: `trip-${generateId()}`,
      vesselId: 'default',
      name: tripData?.name,
      startDate: tripData?.startDate,
      endDate: tripData?.endDate,
      status: status,
      notes: tripData?.notes || '',
      guests: guests,
      guestIds: tripData?.guestIds || [], // Keep for backward compatibility
      // NEW FIELDS
      tripType: tripData?.tripType || TripType?.OWNER,
      itinerarySummary: tripData?.itinerarySummary || '',
      heroImageUrl: tripData?.heroImageUrl || null,
      heroImageUpdatedAt: tripData?.heroImageUpdatedAt || null,
      heroImageUpdatedBy: tripData?.heroImageUpdatedBy || null,
      brokerDetails: tripData?.brokerDetails || null,
      charterDocs: tripData?.charterDocs || [],
      specialDates: tripData?.specialDates || [],
      specialRequests: tripData?.specialRequests || [],
      itineraryDays: tripData?.itineraryDays || [],
      tripActivityLog: tripData?.tripActivityLog || [],
      photos: tripData?.photos || [],
      createdAt: new Date()?.toISOString(),
      createdByUserId: userId,
      updatedAt: new Date()?.toISOString(),
      updatedByUserId: userId
    };
    
    trips?.push(newTrip);
    saveTrips(trips);

    // Log to Supabase activity feed
    logActivity({
      module: 'trips',
      action: TripActions?.TRIP_CREATED,
      entityType: 'trip',
      entityId: newTrip?.id,
      summary: `Trip created: ${newTrip?.name}`,
      meta: { tripName: newTrip?.name, tripType: newTrip?.tripType, status: newTrip?.status }
    });

    return newTrip;
  } catch (error) {
    console.error('Error creating trip:', error);
    return null;
  }
};

// Update existing trip
export const updateTrip = (tripId, updates) => {
  try {
    const currentUser = getCurrentUser();
    const userId = getCurrentUserId();
    const userTier = normalizeTier(currentUser);
    
    // Permission check
    if (userTier !== 'COMMAND' && userTier !== 'CHIEF') {
      showToast("You don't have permission to update trips.", 'error');
      return null;
    }
    
    const trips = loadTrips();
    const index = trips?.findIndex(t => t?.id === tripId);
    if (index === -1) return null;

    const oldTrip = trips?.[index];
    
    // Recalculate status if dates changed
    let status = oldTrip?.status;
    if (updates?.startDate || updates?.endDate) {
      const startDate = updates?.startDate || oldTrip?.startDate;
      const endDate = updates?.endDate || oldTrip?.endDate;
      status = calculateTripStatus(startDate, endDate);
    }

    const newStatus = updates?.status || status;
    const statusChanged = newStatus !== oldTrip?.status;
    
    trips[index] = {
      ...oldTrip,
      ...updates,
      status: newStatus,
      updatedAt: new Date()?.toISOString(),
      updatedByUserId: userId
    };
    
    saveTrips(trips);

    // Log status change separately if it changed
    if (statusChanged) {
      logActivity({
        module: 'trips',
        action: TripActions?.TRIP_STATUS_CHANGED,
        entityType: 'trip',
        entityId: tripId,
        summary: `Trip status changed to ${newStatus}: ${oldTrip?.name}`,
        meta: { tripName: oldTrip?.name, oldStatus: oldTrip?.status, newStatus }
      });
    } else {
      logActivity({
        module: 'trips',
        action: TripActions?.TRIP_UPDATED,
        entityType: 'trip',
        entityId: tripId,
        summary: `Trip updated: ${oldTrip?.name}`,
        meta: { tripName: oldTrip?.name }
      });
    }

    return trips?.[index];
  } catch (error) {
    console.error('Error updating trip:', error);
    return null;
  }
};

// Delete trip
export const deleteTrip = (tripId) => {
  try {
    const currentUser = getCurrentUser();
    const userTier = normalizeTier(currentUser);
    
    // Permission check
    if (userTier !== 'COMMAND' && userTier !== 'CHIEF') {
      showToast("You don't have permission to delete trips.", 'error');
      return false;
    }
    
    const trips = loadTrips();
    const tripToDelete = trips?.find(t => t?.id === tripId);
    const filtered = trips?.filter(t => t?.id !== tripId);
    
    // Also delete associated preferences
    const preferences = loadPreferences();
    const filteredPrefs = preferences?.filter(p => p?.tripId !== tripId);
    savePreferences(filteredPrefs);
    
    const result = saveTrips(filtered);

    if (result && tripToDelete) {
      logActivity({
        module: 'trips',
        action: TripActions?.TRIP_DELETED,
        entityType: 'trip',
        entityId: tripId,
        summary: `Trip deleted: ${tripToDelete?.name}`,
        meta: { tripName: tripToDelete?.name }
      });
    }

    return result;
  } catch (error) {
    console.error('Error deleting trip:', error);
    return false;
  }
};

// Get trip by ID
export const getTripById = (tripId) => {
  const trips = loadTrips();
  return trips?.find(t => t?.id === tripId) || null;
};

// Get active trip (if any)
export const getActiveTrip = () => {
  const trips = loadTrips();
  return trips?.find(t => t?.status === TripStatus?.ACTIVE) || null;
};

// Get active guests from current active trip
export const getActiveGuestsFromCurrentTrip = () => {
  const activeTrip = getActiveTrip();
  if (!activeTrip || !activeTrip?.guests) {
    return [];
  }
  
  // Return only guests where isActive === true
  return activeTrip?.guests
    ?.filter(g => g?.isActive === true)
    ?.map(g => g?.guestId) || [];
};

// Toggle guest active status for a specific trip
export const toggleGuestActiveStatus = (tripId, guestId) => {
  try {
    const currentUser = getCurrentUser();
    const userId = getCurrentUserId();
    const userTier = normalizeTier(currentUser);
    
    // Permission check
    if (userTier !== 'COMMAND' && userTier !== 'CHIEF') {
      showToast("You don't have permission to update guest status.", 'error');
      return null;
    }
    
    const trips = loadTrips();
    const index = trips?.findIndex(t => t?.id === tripId);
    if (index === -1) return null;
    
    const trip = trips?.[index];
    const guests = trip?.guests || [];
    
    // Find the guest in the guests array
    const guestIndex = guests?.findIndex(g => g?.guestId === guestId);
    if (guestIndex === -1) return null;
    
    const currentStatus = guests?.[guestIndex]?.isActive;
    
    // Toggle the status
    guests[guestIndex] = {
      ...guests?.[guestIndex],
      isActive: !currentStatus,
      activatedAt: !currentStatus ? new Date()?.toISOString() : guests?.[guestIndex]?.activatedAt,
      activatedByUserId: !currentStatus ? userId : guests?.[guestIndex]?.activatedByUserId
    };
    
    trips[index] = {
      ...trip,
      guests: guests,
      updatedAt: new Date()?.toISOString(),
      updatedByUserId: userId
    };
    
    saveTrips(trips);

    // Log guest added/removed to activity feed
    const action = !currentStatus ? TripActions?.TRIP_GUEST_ADDED : TripActions?.TRIP_GUEST_REMOVED;
    logActivity({
      module: 'trips',
      action,
      entityType: 'trip',
      entityId: tripId,
      summary: `Guest ${!currentStatus ? 'activated' : 'deactivated'} on trip: ${trip?.name}`,
      meta: { tripName: trip?.name, guestId }
    });

    return trips?.[index];
  } catch (error) {
    console.error('Error toggling guest active status:', error);
    return null;
  }
};

// ============ COMPUTED FIELDS ============

// Get active guest count
export const getActiveGuestCount = (trip) => {
  if (!trip?.guests) return 0;
  return trip?.guests?.filter(g => g?.isActive)?.length;
};

// Get preferences coverage percentage (placeholder)
export const getPreferencesCoveragePct = (tripId) => {
  const prefs = getPreferencesByTrip(tripId);
  const trip = getTripById(tripId);
  if (!trip?.guests || trip?.guests?.length === 0) return 0;
  
  const activeGuests = trip?.guests?.filter(g => g?.isActive);
  if (activeGuests?.length === 0) return 0;
  
  const guestsWithPrefs = new Set(prefs?.map(p => p?.guestId))?.size;
  return Math.round((guestsWithPrefs / activeGuests?.length) * 100);
};

// Get open requests count
export const getOpenRequestsCount = (trip) => {
  if (!trip?.specialRequests) return 0;
  return trip?.specialRequests?.filter(r => r?.status !== SpecialRequestStatus?.DONE)?.length;
};

// Get upcoming special dates count (next 7 days)
export const getUpcomingSpecialDatesCount = (trip) => {
  if (!trip?.specialDates) return 0;
  const today = new Date();
  const sevenDaysLater = new Date(today);
  sevenDaysLater?.setDate(today?.getDate() + 7);
  
  return trip?.specialDates?.filter(d => {
    const date = new Date(d?.date);
    return date >= today && date <= sevenDaysLater;
  })?.length;
};

// Get provisioning status (placeholder)
export const getProvisioningStatus = (trip) => {
  return '—';
};

// Get laundry status (placeholder)
export const getLaundryStatus = (trip) => {
  return '—';
};

// ============ ITINERARY DAY OPERATIONS ============

// Add itinerary day
export const addItineraryDay = (tripId, dayData) => {
  try {
    const currentUser = getCurrentUser();
    const userId = getCurrentUserId();
    const userName = getCurrentUserName();
    const userTier = normalizeTier(currentUser);
    
    if (userTier !== 'COMMAND' && userTier !== 'CHIEF') {
      showToast("You don't have permission to add itinerary days.", 'error');
      return null;
    }
    
    const trips = loadTrips();
    const index = trips?.findIndex(t => t?.id === tripId);
    if (index === -1) return null;
    
    const newDay = {
      id: `day-${generateId()}`,
      date: dayData?.date,
      locationTitle: dayData?.locationTitle || '',
      keyEvents: dayData?.keyEvents || [],
      guestMovements: dayData?.guestMovements || [],
      notes: dayData?.notes || '',
      // NEW FIELDS for timeline view
      stopType: dayData?.stopType || 'ANCHOR', // DOCK | ANCHOR | UNDERWAY
      stopDetail: dayData?.stopDetail || '',
      mapImageUrl: dayData?.mapImageUrl || null,
      createdAt: new Date()?.toISOString(),
      createdByUserId: userId
    };
    
    trips[index].itineraryDays = [...(trips?.[index]?.itineraryDays || []), newDay];
    trips[index].updatedAt = new Date()?.toISOString();
    trips[index].updatedByUserId = userId;
    
    // Log activity
    logTripActivity(tripId, TripActivityType?.ITINERARY_DAY_ADDED, 
      `${userName} added itinerary day for ${dayData?.locationTitle}`);
    
    saveTrips(trips);
    return trips?.[index];
  } catch (error) {
    console.error('Error adding itinerary day:', error);
    return null;
  }
};

// Update itinerary day
export const updateItineraryDay = (tripId, dayId, updates) => {
  try {
    const currentUser = getCurrentUser();
    const userId = getCurrentUserId();
    const userName = getCurrentUserName();
    const userTier = normalizeTier(currentUser);
    
    if (userTier !== 'COMMAND' && userTier !== 'CHIEF') {
      showToast("You don't have permission to update itinerary days.", 'error');
      return null;
    }
    
    const trips = loadTrips();
    const tripIndex = trips?.findIndex(t => t?.id === tripId);
    if (tripIndex === -1) return null;
    
    const dayIndex = trips?.[tripIndex]?.itineraryDays?.findIndex(d => d?.id === dayId);
    if (dayIndex === -1) return null;
    
    trips[tripIndex].itineraryDays[dayIndex] = {
      ...trips?.[tripIndex]?.itineraryDays?.[dayIndex],
      ...updates,
      updatedAt: new Date()?.toISOString(),
      updatedByUserId: userId
    };
    
    trips[tripIndex].updatedAt = new Date()?.toISOString();
    trips[tripIndex].updatedByUserId = userId;
    
    // Log activity
    logTripActivity(tripId, TripActivityType?.ITINERARY_DAY_UPDATED, 
      `${userName} updated itinerary day`);
    
    saveTrips(trips);
    return trips?.[tripIndex];
  } catch (error) {
    console.error('Error updating itinerary day:', error);
    return null;
  }
};

// Delete itinerary day
export const deleteItineraryDay = (tripId, dayId) => {
  try {
    const currentUser = getCurrentUser();
    const userId = getCurrentUserId();
    const userName = getCurrentUserName();
    const userTier = normalizeTier(currentUser);
    
    if (userTier !== 'COMMAND' && userTier !== 'CHIEF') {
      showToast("You don't have permission to delete itinerary days.", 'error');
      return null;
    }
    
    const trips = loadTrips();
    const tripIndex = trips?.findIndex(t => t?.id === tripId);
    if (tripIndex === -1) return null;
    
    trips[tripIndex].itineraryDays = trips?.[tripIndex]?.itineraryDays?.filter(d => d?.id !== dayId);
    trips[tripIndex].updatedAt = new Date()?.toISOString();
    trips[tripIndex].updatedByUserId = userId;
    
    // Log activity
    logTripActivity(tripId, TripActivityType?.ITINERARY_DAY_DELETED, 
      `${userName} deleted itinerary day`);
    
    saveTrips(trips);
    return trips?.[tripIndex];
  } catch (error) {
    console.error('Error deleting itinerary day:', error);
    return null;
  }
};

// ============ SPECIAL DATE OPERATIONS ============

// Add special date
export const addSpecialDate = (tripId, dateData) => {
  try {
    const currentUser = getCurrentUser();
    const userId = getCurrentUserId();
    const userName = getCurrentUserName();
    const userTier = normalizeTier(currentUser);
    
    if (userTier !== 'COMMAND' && userTier !== 'CHIEF') {
      showToast("You don't have permission to add special dates.", 'error');
      return null;
    }
    
    const trips = loadTrips();
    const index = trips?.findIndex(t => t?.id === tripId);
    if (index === -1) return null;
    
    const newDate = {
      id: `date-${generateId()}`,
      date: dateData?.date,
      type: dateData?.type || SpecialDateType?.OTHER,
      guestId: dateData?.guestId || null,
      title: dateData?.title || '',
      notes: dateData?.notes || '',
      createdAt: new Date()?.toISOString(),
      createdByUserId: userId
    };
    
    trips[index].specialDates = [...(trips?.[index]?.specialDates || []), newDate];
    trips[index].updatedAt = new Date()?.toISOString();
    trips[index].updatedByUserId = userId;
    
    // Log activity
    logTripActivity(tripId, TripActivityType?.OCCASION_CREATED, 
      `${userName} added special occasion: ${dateData?.title}`);
    
    saveTrips(trips);
    return trips?.[index];
  } catch (error) {
    console.error('Error adding special date:', error);
    return null;
  }
};

// Update special date
export const updateSpecialDate = (tripId, dateId, updates) => {
  try {
    const currentUser = getCurrentUser();
    const userId = getCurrentUserId();
    const userName = getCurrentUserName();
    const userTier = normalizeTier(currentUser);
    
    if (userTier !== 'COMMAND' && userTier !== 'CHIEF') {
      showToast("You don't have permission to update special dates.", 'error');
      return null;
    }
    
    const trips = loadTrips();
    const tripIndex = trips?.findIndex(t => t?.id === tripId);
    if (tripIndex === -1) return null;
    
    const dateIndex = trips?.[tripIndex]?.specialDates?.findIndex(d => d?.id === dateId);
    if (dateIndex === -1) return null;
    
    trips[tripIndex].specialDates[dateIndex] = {
      ...trips?.[tripIndex]?.specialDates?.[dateIndex],
      ...updates,
      updatedAt: new Date()?.toISOString(),
      updatedByUserId: userId
    };
    
    trips[tripIndex].updatedAt = new Date()?.toISOString();
    trips[tripIndex].updatedByUserId = userId;
    
    // Log activity
    logTripActivity(tripId, TripActivityType?.OCCASION_UPDATED, 
      `${userName} updated special occasion`);
    
    saveTrips(trips);
    return trips?.[tripIndex];
  } catch (error) {
    console.error('Error updating special date:', error);
    return null;
  }
};

// Delete special date
export const deleteSpecialDate = (tripId, dateId) => {
  try {
    const currentUser = getCurrentUser();
    const userId = getCurrentUserId();
    const userName = getCurrentUserName();
    const userTier = normalizeTier(currentUser);
    
    if (userTier !== 'COMMAND' && userTier !== 'CHIEF') {
      showToast("You don't have permission to delete special dates.", 'error');
      return null;
    }
    
    const trips = loadTrips();
    const tripIndex = trips?.findIndex(t => t?.id === tripId);
    if (tripIndex === -1) return null;
    
    trips[tripIndex].specialDates = trips?.[tripIndex]?.specialDates?.filter(d => d?.id !== dateId);
    trips[tripIndex].updatedAt = new Date()?.toISOString();
    trips[tripIndex].updatedByUserId = userId;
    
    saveTrips(trips);
    return trips?.[tripIndex];
  } catch (error) {
    console.error('Error deleting special date:', error);
    return null;
  }
};

// ============ SPECIAL REQUEST OPERATIONS ============

// Add special request
export const addSpecialRequest = (tripId, requestData) => {
  try {
    const currentUser = getCurrentUser();
    const userId = getCurrentUserId();
    const userName = getCurrentUserName();
    const userTier = normalizeTier(currentUser);
    
    if (userTier !== 'COMMAND' && userTier !== 'CHIEF') {
      showToast("You don't have permission to add special requests.", 'error');
      return null;
    }
    
    const trips = loadTrips();
    const index = trips?.findIndex(t => t?.id === tripId);
    if (index === -1) return null;
    
    const newRequest = {
      id: `request-${generateId()}`,
      title: requestData?.title || '',
      guestId: requestData?.guestId || null,
      status: requestData?.status || SpecialRequestStatus?.PLANNED,
      dueDate: requestData?.dueDate || null,
      notes: requestData?.notes || '',
      attachments: requestData?.attachments || [],
      createdAt: new Date()?.toISOString(),
      createdByUserId: userId
    };
    
    trips[index].specialRequests = [...(trips?.[index]?.specialRequests || []), newRequest];
    trips[index].updatedAt = new Date()?.toISOString();
    trips[index].updatedByUserId = userId;
    
    // Log activity
    logTripActivity(tripId, TripActivityType?.REQUEST_CREATED, 
      `${userName} created request: ${requestData?.title}`);
    
    saveTrips(trips);
    return trips?.[index];
  } catch (error) {
    console.error('Error adding special request:', error);
    return null;
  }
};

// Update special request
export const updateSpecialRequest = (tripId, requestId, updates) => {
  try {
    const currentUser = getCurrentUser();
    const userId = getCurrentUserId();
    const userName = getCurrentUserName();
    const userTier = normalizeTier(currentUser);
    
    if (userTier !== 'COMMAND' && userTier !== 'CHIEF') {
      showToast("You don't have permission to update special requests.", 'error');
      return null;
    }
    
    const trips = loadTrips();
    const tripIndex = trips?.findIndex(t => t?.id === tripId);
    if (tripIndex === -1) return null;
    
    const requestIndex = trips?.[tripIndex]?.specialRequests?.findIndex(r => r?.id === requestId);
    if (requestIndex === -1) return null;
    
    const oldStatus = trips?.[tripIndex]?.specialRequests?.[requestIndex]?.status;
    
    trips[tripIndex].specialRequests[requestIndex] = {
      ...trips?.[tripIndex]?.specialRequests?.[requestIndex],
      ...updates,
      updatedAt: new Date()?.toISOString(),
      updatedByUserId: userId
    };
    
    trips[tripIndex].updatedAt = new Date()?.toISOString();
    trips[tripIndex].updatedByUserId = userId;
    
    // Log activity
    const activityType = updates?.status === SpecialRequestStatus?.DONE ? 
      TripActivityType?.REQUEST_COMPLETED : TripActivityType?.REQUEST_UPDATED;
    logTripActivity(tripId, activityType, 
      `${userName} updated request status from ${oldStatus} to ${updates?.status || oldStatus}`);
    
    saveTrips(trips);
    return trips?.[tripIndex];
  } catch (error) {
    console.error('Error updating special request:', error);
    return null;
  }
};

// Delete special request
export const deleteSpecialRequest = (tripId, requestId) => {
  try {
    const currentUser = getCurrentUser();
    const userId = getCurrentUserId();
    const userTier = normalizeTier(currentUser);
    
    if (userTier !== 'COMMAND' && userTier !== 'CHIEF') {
      showToast("You don't have permission to delete special requests.", 'error');
      return null;
    }
    
    const trips = loadTrips();
    const tripIndex = trips?.findIndex(t => t?.id === tripId);
    if (tripIndex === -1) return null;
    
    trips[tripIndex].specialRequests = trips?.[tripIndex]?.specialRequests?.filter(r => r?.id !== requestId);
    trips[tripIndex].updatedAt = new Date()?.toISOString();
    trips[tripIndex].updatedByUserId = userId;
    
    saveTrips(trips);
    return trips?.[tripIndex];
  } catch (error) {
    console.error('Error deleting special request:', error);
    return null;
  }
};

// ============ TRIP ACTIVITY LOG ============

// Log trip activity — also fires to Supabase activity_events for the global feed
export const logTripActivity = (tripId, activityType, message) => {
  try {
    const trips = loadTrips();
    const index = trips?.findIndex(t => t?.id === tripId);
    if (index === -1) return;
    
    const userId = getCurrentUserId();
    const userName = getCurrentUserName();
    const trip = trips?.[index];
    
    const activityEntry = {
      id: `activity-${generateId()}`,
      at: new Date()?.toISOString(),
      actorUserId: userId,
      actorName: userName,
      message: message,
      type: activityType
    };
    
    trips[index].tripActivityLog = [...(trips?.[index]?.tripActivityLog || []), activityEntry];
    saveTrips(trips);

    // Also push to Supabase activity_events so it appears on the /activity feed
    logActivity({
      module: 'trips',
      action: activityType,
      entityType: 'trip',
      entityId: tripId,
      summary: message,
      meta: { tripName: trip?.name, activityType }
    });
  } catch (error) {
    console.error('Error logging trip activity:', error);
  }
};

// Get trip activity log
export const getTripActivityLog = (tripId) => {
  const trip = getTripById(tripId);
  if (!trip) return [];
  return trip?.tripActivityLog || [];
};

// ============ PREFERENCE OPERATIONS ============

// Load all preferences
export const loadPreferences = () => {
  try {
    const data = localStorage.getItem(PREFERENCES_KEY);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error('Error loading preferences:', error);
    return [];
  }
};

// Save preferences
const savePreferences = (preferences) => {
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
    return true;
  } catch (error) {
    console.error('Error saving preferences:', error);
    return false;
  }
};

// Create new preference entry
export const createPreference = (preferenceData) => {
  try {
    const currentUser = getCurrentUser();
    const userId = getCurrentUserId();
    const userName = getCurrentUserName();
    const userTier = normalizeTier(currentUser);
    
    // Permission check
    if (userTier !== 'COMMAND' && userTier !== 'CHIEF') {
      showToast("You don't have permission to add preferences.", 'error');
      return null;
    }
    
    const preferences = loadPreferences();
    
    const newPreference = {
      id: `pref-${generateId()}`,
      tripId: preferenceData?.tripId,
      guestId: preferenceData?.guestId,
      category: preferenceData?.category,
      key: preferenceData?.key,
      value: preferenceData?.value,
      priority: preferenceData?.priority || PreferencePriority?.NORMAL,
      tags: preferenceData?.tags || [],
      source: preferenceData?.source || 'trip',
      createdAt: new Date()?.toISOString(),
      createdByUserId: userId,
      createdByUserName: userName,
      updatedAt: new Date()?.toISOString(),
      updatedByUserId: userId,
      updatedByUserName: userName
    };
    
    preferences?.push(newPreference);
    savePreferences(preferences);
    return newPreference;
  } catch (error) {
    console.error('Error creating preference:', error);
    return null;
  }
};

// Update existing preference
export const updatePreference = (preferenceId, updates) => {
  try {
    const currentUser = getCurrentUser();
    const userId = getCurrentUserId();
    const userName = getCurrentUserName();
    const userTier = normalizeTier(currentUser);
    
    // Permission check
    if (userTier !== 'COMMAND' && userTier !== 'CHIEF') {
      showToast("You don't have permission to update preferences.", 'error');
      return null;
    }
    
    const preferences = loadPreferences();
    const index = preferences?.findIndex(p => p?.id === preferenceId);
    if (index === -1) return null;
    
    preferences[index] = {
      ...preferences?.[index],
      ...updates,
      updatedAt: new Date()?.toISOString(),
      updatedByUserId: userId,
      updatedByUserName: userName
    };
    
    savePreferences(preferences);
    return preferences?.[index];
  } catch (error) {
    console.error('Error updating preference:', error);
    return null;
  }
};

// Delete preference
export const deletePreference = (preferenceId) => {
  try {
    const currentUser = getCurrentUser();
    const userTier = normalizeTier(currentUser);
    
    // Permission check
    if (userTier !== 'COMMAND' && userTier !== 'CHIEF') {
      showToast("You don't have permission to delete preferences.", 'error');
      return false;
    }
    
    const preferences = loadPreferences();
    const filtered = preferences?.filter(p => p?.id !== preferenceId);
    return savePreferences(filtered);
  } catch (error) {
    console.error('Error deleting preference:', error);
    return false;
  }
};

// Get preferences by trip ID
export const getPreferencesByTrip = (tripId) => {
  const preferences = loadPreferences();
  return preferences?.filter(p => p?.tripId === tripId);
};

// Get preferences by guest ID
export const getPreferencesByGuest = (guestId) => {
  const preferences = loadPreferences();
  return preferences?.filter(p => p?.guestId === guestId)?.sort((a, b) => 
    new Date(b.updatedAt) - new Date(a.updatedAt)
  );
};

// Get preferences by trip and guest
export const getPreferencesByTripAndGuest = (tripId, guestId) => {
  const preferences = loadPreferences();
  return preferences?.filter(p => p?.tripId === tripId && p?.guestId === guestId);
};
