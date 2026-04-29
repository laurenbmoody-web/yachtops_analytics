import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Icon from '../../components/AppIcon';
import { loadGuests } from '../guest-management-dashboard/utils/guestStorage';
import { loadTrips, TripStatus, TripType } from '../trips-management-dashboard/utils/tripStorage';
import { getPreferencesByGuest } from '../../utils/preferencesStorage';

import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../contexts/TenantContext';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';

// DEV_MODE constant
const DEV_MODE = true;

const GuestType = {
  OWNER: 'Owner',
  CHARTER: 'Charter',
  UNKNOWN: 'Unknown'
};

// Permission tier constants
const FULL_ACCESS_TIERS = ['COMMAND', 'CHIEF'];
const LIMITED_ACCESS_TIERS = ['HOD', 'CREW'];
const BLOCKED_TIERS = ['VIEW_ONLY'];

const PreferencesDirectory = () => {
  const navigate = useNavigate();
  const { session, loading: authLoading } = useAuth();
  const { activeTenantId, currentTenantMember } = useTenant();
  
  const [guests, setGuests] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [dietFilter, setDietFilter] = useState('All');
  const [allergyFilter, setAllergyFilter] = useState('All');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [timedOut, setTimedOut] = useState(false);
  const timeoutRef = useRef(null);
  const mountedRef = useRef(true);

  const permissionTier = currentTenantMember?.permission_tier || null;
  const isFullAccess = FULL_ACCESS_TIERS?.includes(permissionTier);
  const isLimitedAccess = LIMITED_ACCESS_TIERS?.includes(permissionTier);
  const isBlocked = BLOCKED_TIERS?.includes(permissionTier);

  // Redirect VIEW_ONLY users away
  useEffect(() => {
    if (!authLoading && isBlocked) {
      navigate('/dashboard', { replace: true });
    }
  }, [authLoading, isBlocked, navigate]);

  // Fetch preferences data
  const fetchPreferences = async () => {
    setLoading(true);
    setError(null);
    setTimedOut(false);
    
    // Clear existing timeout
    if (timeoutRef?.current) {
      clearTimeout(timeoutRef?.current);
    }
    
    // Set 5-second hard timeout
    timeoutRef.current = setTimeout(() => {
      if (mountedRef?.current) {
        console.log('[preferences] 15s timeout reached');
        setTimedOut(true);
        setLoading(false);
        setError("Couldn't load preferences. Please retry.");
      }
    }, 15000);
    
    try {
      // Check session
      if (!session) {
        clearTimeout(timeoutRef?.current);
        setLoading(false);
        setError('Please log in to view preferences.');
        console.log('[preferences] loaded', { tenantId: null, count: 0, error: 'no session' });
        return;
      }
      
      // Check tenant (allow if DEV_MODE is true)
      if (!activeTenantId && !DEV_MODE) {
        clearTimeout(timeoutRef?.current);
        setLoading(false);
        setError('No active vessel access.');
        console.log('[preferences] loaded', { tenantId: null, count: 0, error: 'no tenant' });
        return;
      }
      
      // Load data
      const allGuests = await loadGuests(activeTenantId);
      const activeGuests = allGuests?.filter(g => !g?.isDeleted) || [];
      const allTrips = await loadTrips();

      // For HOD/CREW: only show guests on active trips
      const activeTrips = allTrips?.filter(t => t?.status === TripStatus?.ACTIVE && !t?.isDeleted) || [];
      const guestIdsOnActiveTrips = new Set(
        activeTrips?.flatMap(t => t?.guestIds || [])
      );

      const visibleGuests = isLimitedAccess
        ? activeGuests?.filter(g => guestIdsOnActiveTrips?.has(g?.id))
        : activeGuests;
      
      // Enrich guests with preference data from Supabase
      const enrichedGuests = await Promise.all(
        visibleGuests?.map(async (guest) => {
          const preferences = await getPreferencesByGuest(guest?.id, activeTenantId);
          const masterPreferences = preferences?.filter(p => p?.tripId === null) || [];
          const guestType = determineGuestType(guest?.id, allTrips);
          
          return {
            ...guest,
            preferences: masterPreferences,
            guestType,
            lastPreferenceUpdatedAt: getLastPreferenceUpdate(masterPreferences),
            hasPreferences: masterPreferences?.length > 0
          };
        })
      );
      
      // Clear timeout on success
      if (timeoutRef?.current) {
        clearTimeout(timeoutRef?.current);
      }
      
      if (mountedRef?.current) {
        setGuests(enrichedGuests);
        setError(null);
        setTimedOut(false);
        setLoading(false);
        console.log('[preferences] loaded', { tenantId: activeTenantId, count: enrichedGuests?.length, error: null });
      }
    } catch (err) {
      console.error('[preferences] fetch error:', err);
      
      // Clear timeout on error
      if (timeoutRef?.current) {
        clearTimeout(timeoutRef?.current);
      }
      
      if (mountedRef?.current) {
        setError(err?.message || 'Failed to load preferences data');
        setLoading(false);
        console.log('[preferences] loaded', { tenantId: activeTenantId, count: 0, error: err?.message });
      }
    }
  };

  // Initial load
  useEffect(() => {
    mountedRef.current = true;
    
    // Wait for auth to be ready
    if (!authLoading && !isBlocked) {
      fetchPreferences();
    }
    
    return () => {
      mountedRef.current = false;
      if (timeoutRef?.current) {
        clearTimeout(timeoutRef?.current);
      }
    };
  }, [authLoading, session, activeTenantId, permissionTier]);

  // Helper functions
  const determineGuestType = (guestId, trips) => {
    const guestTrips = trips?.filter(trip => 
      trip?.guestIds?.includes(guestId) && !trip?.isDeleted
    );
    
    if (!guestTrips || guestTrips?.length === 0) {
      return GuestType?.UNKNOWN;
    }
    
    const hasOwnerTrips = guestTrips?.some(trip => trip?.tripType === TripType?.OWNER);
    if (hasOwnerTrips) {
      return GuestType?.OWNER;
    }
    
    const hasCharterTrips = guestTrips?.some(trip => trip?.tripType === TripType?.CHARTER);
    if (hasCharterTrips) {
      return GuestType?.CHARTER;
    }
    
    return GuestType?.UNKNOWN;
  };

  const getLastPreferenceUpdate = (preferences) => {
    if (!preferences || preferences?.length === 0) return null;
    const sorted = [...preferences]?.sort((a, b) => new Date(b?.updatedAt) - new Date(a?.updatedAt));
    return sorted?.[0]?.updatedAt;
  };

  const formatTimestamp = (timestamp) => {
    if (!timestamp) return 'Never updated';
    const date = new Date(timestamp);
    const now = new Date();
    const diffTime = Math.abs(now - date);
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Updated today';
    if (diffDays === 1) return 'Updated 1 day ago';
    if (diffDays < 7) return `Updated ${diffDays} days ago`;
    if (diffDays < 30) return `Updated ${Math.floor(diffDays / 7)} weeks ago`;
    
    return `Updated ${date?.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  };

  // Filter guests based on search and filters
  const getFilteredGuests = () => {
    let filtered = guests;
    
    // Search filter
    if (searchQuery?.trim()) {
      const query = searchQuery?.toLowerCase();
      filtered = filtered?.filter(guest => {
        const fullName = `${guest?.firstName} ${guest?.lastName}`?.toLowerCase();
        // Search in name, tags, diet, allergies
        const tags = guest?.tags?.join(' ')?.toLowerCase() || '';
        const diet = guest?.dietaryPreferences?.join(' ')?.toLowerCase() || '';
        const allergies = guest?.allergies?.toLowerCase() || '';
        
        return fullName?.includes(query) || tags?.includes(query) || diet?.includes(query) || allergies?.includes(query);
      });
    }
    
    // Diet filter
    if (dietFilter !== 'All') {
      filtered = filtered?.filter(guest => {
        const diets = guest?.dietaryPreferences || [];
        if (dietFilter === 'Vegan') return diets?.includes('Vegan');
        if (dietFilter === 'Vegetarian') return diets?.includes('Vegetarian');
        if (dietFilter === 'Gluten-free') return diets?.includes('Gluten-free');
        return true;
      });
    }
    
    // Allergy filter
    if (allergyFilter !== 'All') {
      filtered = filtered?.filter(guest => {
        const allergies = guest?.allergies || '';
        if (allergyFilter === 'Any allergy') return allergies?.length > 0;
        if (allergyFilter === 'Nut') return allergies?.toLowerCase()?.includes('nut');
        if (allergyFilter === 'Gluten') return allergies?.toLowerCase()?.includes('gluten');
        if (allergyFilter === 'Dairy') return allergies?.toLowerCase()?.includes('dairy');
        return true;
      });
    }
    
    return filtered;
  };

  const handleGuestClick = (guestId) => {
    if (guestId) {
      navigate(`/guest/${guestId}/preferences`);
    }
  };

  const handleRetry = () => {
    fetchPreferences();
  };

  const filteredGuests = getFilteredGuests();

  // Blocked: VIEW_ONLY (redirect handled by useEffect, show nothing while redirecting)
  if (isBlocked) {
    return null;
  }

  // ALWAYS render UI shell immediately
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        {/* Page Header - Always visible */}
        <div>
          <h1 className="text-3xl font-bold text-foreground">Preferences</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isLimitedAccess
              ? 'Showing guests currently on an active trip.' :'Search and open a guest to view or update their preference profile.'}
          </p>
        </div>

        {/* Search and Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <Input
              placeholder="Search guests by name, diet, allergies..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e?.target?.value)}
              className="w-full"
            />
          </div>
          <div className="flex gap-2">
            <select
              value={dietFilter}
              onChange={(e) => setDietFilter(e?.target?.value)}
              className="px-3 py-2 bg-card border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="All">All Diets</option>
              <option value="Vegan">Vegan</option>
              <option value="Vegetarian">Vegetarian</option>
              <option value="Gluten-free">Gluten-free</option>
            </select>
            <select
              value={allergyFilter}
              onChange={(e) => setAllergyFilter(e?.target?.value)}
              className="px-3 py-2 bg-card border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="All">All Allergies</option>
              <option value="Any allergy">Any Allergy</option>
              <option value="Nut">Nut</option>
              <option value="Gluten">Gluten</option>
              <option value="Dairy">Dairy</option>
            </select>
          </div>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        )}

        {/* Error State */}
        {!loading && error && (
          <div className="bg-card border border-border rounded-xl p-8 text-center">
            <Icon name="AlertCircle" size={32} className="mx-auto text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground mb-4">{error}</p>
            <Button variant="outline" onClick={handleRetry} iconName="RefreshCw">
              Retry
            </Button>
          </div>
        )}

        {/* Guest List */}
        {!loading && !error && (
          <>
            {filteredGuests?.length === 0 ? (
              <div className="bg-card border border-border rounded-xl p-8 text-center">
                <Icon name="Users" size={32} className="mx-auto text-muted-foreground mb-3" />
                <p className="text-sm text-muted-foreground">
                  {guests?.length === 0
                    ? isLimitedAccess
                      ? 'No guests are currently on an active trip.' :'No guests found. Add guests in Guest Management.' :'No guests match your search.'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredGuests?.map(guest => (
                  <div
                    key={guest?.id}
                    onClick={() => handleGuestClick(guest?.id)}
                    className="bg-card border border-border rounded-xl p-5 cursor-pointer hover:border-primary/50 hover:shadow-md transition-all"
                  >
                    <div className="flex items-start gap-3 mb-3">
                      <div className="w-10 h-10 rounded-full overflow-hidden bg-primary/10 flex items-center justify-center flex-shrink-0">
                        {guest?.photo?.dataUrl || guest?.photo ? (
                          <img
                            src={guest?.photo?.dataUrl || guest?.photo}
                            alt={`${guest?.firstName} ${guest?.lastName}`}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <span className="text-sm font-bold text-primary">
                            {`${guest?.firstName?.[0] || ''}${guest?.lastName?.[0] || ''}`?.toUpperCase() || '?'}
                          </span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-foreground truncate">
                          {guest?.firstName} {guest?.lastName}
                        </h3>
                        <p className="text-xs text-muted-foreground">{guest?.guestType || 'Guest'}</p>
                      </div>
                      <Icon name="ChevronRight" size={16} className="text-muted-foreground flex-shrink-0" />
                    </div>

                    {/* Preference count */}
                    <div className="flex items-center gap-2 mb-2">
                      <Icon name="Star" size={14} className="text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">
                        {guest?.preferences?.length > 0
                          ? `${guest?.preferences?.length} preference${guest?.preferences?.length > 1 ? 's' : ''}`
                          : 'No preferences yet'
                        }
                      </span>
                    </div>

                    {/* Allergies badge */}
                    {guest?.allergies && (
                      <div className="flex items-center gap-1 mb-2">
                        <span className="px-2 py-0.5 bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 rounded-full text-xs font-medium">
                          Allergies
                        </span>
                      </div>
                    )}

                    {/* Last updated */}
                    <p className="text-xs text-muted-foreground mt-2">
                      {formatTimestamp(guest?.lastPreferenceUpdatedAt)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default PreferencesDirectory;