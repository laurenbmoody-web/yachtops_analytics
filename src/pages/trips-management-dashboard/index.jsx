import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Button from '../../components/ui/Button';
import Icon from '../../components/AppIcon';
import AddTripModal from './components/AddTripModal';
import { loadTrips, TripStatus, updateTrip, getPreferencesByTrip } from './utils/tripStorage';
import { getCurrentUser } from '../../utils/authStorage';
import { showToast } from '../../utils/toast';
import { canAccessTrips, canAddTrip, canEditTrip, canDeleteTrip } from './utils/tripPermissions';
import { loadGuests } from '../guest-management-dashboard/utils/guestStorage';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../contexts/TenantContext';

const DEV_MODE = true;

const TripsManagementDashboard = () => {
  const navigate = useNavigate();
  const { session, loading: authLoading } = useAuth();
  const { activeTenantId } = useTenant();
  const [currentUser, setCurrentUser] = useState(null);
  const [trips, setTrips] = useState([]);
  const [guests, setGuests] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingTrip, setEditingTrip] = useState(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [isUploadingHero, setIsUploadingHero] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadTimeout, setLoadTimeout] = useState(false);
  const timeoutRef = useRef(null);
  
  // Remove duplicate state declarations (lines 34-35)
  // const [pageLoading, setPageLoading] = useState(true);
  // const [loadTimeout, setLoadTimeout] = useState(false);

  useEffect(() => {
  if (DEV_MODE) {
    setPageLoading(false);
  }
  },[]);

  // Add this block - missing state declarations
  const [timedOut, setTimedOut] = useState(false);
  const [error, setError] = useState(null);
  
  // New state for modals and panels
  const [showEndTripModal, setShowEndTripModal] = useState(false);
  const [showMarkCompletedModal, setShowMarkCompletedModal] = useState(false);
  const [tripToComplete, setTripToComplete] = useState(null);
  const [showSummaryPanel, setShowSummaryPanel] = useState(false);
  const [summaryTrip, setSummaryTrip] = useState(null);
  const [showPhotosModal, setShowPhotosModal] = useState(false);
  const [photosTrip, setPhotosTrip] = useState(null);
  const [showLaundryDrawer, setShowLaundryDrawer] = useState(false);
  const [laundryTrip, setLaundryTrip] = useState(null);
  const [laundryFilter, setLaundryFilter] = useState('all'); // 'all', 'outstanding', 'delivered'

  // Refs for timeline alignment
  const activeSectionRef = useRef(null);
  const upcomingSectionRef = useRef(null);
  const completedSectionRef = useRef(null);

  const permissions = {
    canAdd: DEV_MODE ? true : canAddTrip(currentUser),
    canEdit: DEV_MODE ? true : canEditTrip(currentUser),
    canDelete: DEV_MODE ? true : canDeleteTrip(currentUser)
  };

  // Check authentication and authorization
  useEffect(() => {
    const user = getCurrentUser();
    if (!user) {
      // DO NOT redirect here - ProtectedRoute handles this
      return;
    }
    if (!canAccessTrips(user) && !DEV_MODE) {
      showToast('Access restricted', 'error');
      navigate('/dashboard');
      return;
    }
    setCurrentUser(user);
  }, [navigate]);

  // Load trips and guests
  useEffect(() => {
    console.log('[PAGE] Mounted /trips-management-dashboard');
    if (activeTenantId) {
      fetchTrips();
    } else {
      setError('No tenant context (currentTenantId missing)');
      setLoading(false);
    }
    
    return () => {
      if (timeoutRef?.current) {
        clearTimeout(timeoutRef?.current);
      }
    };
  }, [activeTenantId]);

  const fetchTrips = async () => {
    console.log('[TRIPS] start fetch');
    setLoading(true);
    setTimedOut(false);
    setError(null);
    
    // Start 8-second timeout
    if (timeoutRef?.current) {
      clearTimeout(timeoutRef?.current);
    }
    timeoutRef.current = setTimeout(() => {
      console.log('[TRIPS] 8s timeout reached');
      setTimedOut(true);
    }, 8000);
    
    try {
      if (!activeTenantId && !DEV_MODE) {
        setError('No tenant context (currentTenantId missing)');
        setTrips([]);
        setGuests([]);
        return;
      }

      if (!activeTenantId && DEV_MODE) {
        console.log("DEV MODE - skipping tenant requirement")
        setTrips ([]);
        setGuests ([]);
      }
      
      const data = await loadTrips();
      console.log('[TRIPS] fetch success, rows:', data?.length || 0);
      setTrips(data);
      const guestData = await loadGuests();
      setGuests((guestData || []).filter(g => !g?.isDeleted));
    } catch (err) {
      console.error('[TRIPS] fetch error:', err);
      
      // Surface specific error types
      if (err?.code === '401' || err?.code === 'PGRST301') {
        setError('Authentication error: ' + (err?.message || 'Unauthorized'));
      } else if (err?.code === '403' || err?.code === 'PGRST302') {
        setError('Permission denied: ' + (err?.message || 'Forbidden'));
      } else if (err?.code === '406' || err?.code === 'PGRST106') {
        setError('Query error: ' + (err?.message || 'Not Acceptable'));
      } else if (err?.code === '400' || err?.code === 'PGRST100') {
        setError('Bad request: ' + (err?.message || 'Invalid query'));
      } else {
        setError(err?.message || 'Failed to load trips data');
      }
      
      console.log(`[TRIPS] Error: ${err?.code} - ${err?.message}`);
      setTrips([]);
      setGuests([]);
    } finally {
      if (timeoutRef?.current) {
        clearTimeout(timeoutRef?.current);
      }
      setLoading(false);
      console.log('[TRIPS] end fetch');
    }
  };

  const loadTripsData = async () => {
    setPageLoading(true);
    try {
      const data = await loadTrips();
      setTrips(data);
    } catch (err) {
      console.warn('[trips-dashboard] loadTrips failed:', err);
    } finally {
      setPageLoading(false);
    }
  };

  const loadGuestsData = async () => {
    try {
      const data = await loadGuests();
      setGuests((data || []).filter(g => !g?.isDeleted));
    } catch (err) {
      console.error('[trips dashboard] loadGuestsData failed:', err);
      setGuests([]);
    }
  };

  // Separate trips by status
  const categorizeTrips = () => {
    let filtered = trips;
    
    // Search filter
    if (searchQuery?.trim()) {
      const query = searchQuery?.toLowerCase()?.trim();
      filtered = filtered?.filter(trip => {
        const tripName = trip?.name?.toLowerCase() || '';
        const tripNotes = trip?.notes?.toLowerCase() || '';
        const guestNames = trip?.guestIds?.map(gId => {
          const guest = guests?.find(g => g?.id === gId);
          return guest ? `${guest?.firstName} ${guest?.lastName}`?.toLowerCase() : '';
        })?.join(' ');

        return tripName?.includes(query) || tripNotes?.includes(query) || guestNames?.includes(query);
      });
    }
    
    const active = filtered?.filter(t => t?.status === TripStatus?.ACTIVE)?.[0] || null;
    const upcoming = filtered?.filter(t => t?.status === TripStatus?.UPCOMING)
      ?.sort((a, b) => new Date(a?.startDate) - new Date(b?.startDate));
    const completed = filtered?.filter(t => t?.status === TripStatus?.COMPLETED)
      ?.sort((a, b) => new Date(b?.endDate) - new Date(a?.endDate));

    return { active, upcoming, completed };
  };

  const handleAddTrip = () => {
    setEditingTrip(null);
    setShowAddModal(true);
  };

  const handleMarkCompleted = (trip) => {
    setTripToComplete(trip);
    setShowMarkCompletedModal(true);
  };

  const confirmMarkCompleted = () => {
    if (!tripToComplete) return;
    const updated = { ...tripToComplete, status: TripStatus?.COMPLETED, endedAt: new Date()?.toISOString() };
    const success = updateTrip(tripToComplete?.id, updated);
    if (success) {
      showToast('Trip marked as completed', 'success');
      loadTripsData();
    } else {
      showToast('Failed to update trip', 'error');
    }
    setShowMarkCompletedModal(false);
    setTripToComplete(null);
  };

  const handleEndTrip = (trip) => {
    setTripToComplete(trip);
    setShowEndTripModal(true);
  };

  const confirmEndTrip = () => {
    if (!tripToComplete) return;
    const updated = { ...tripToComplete, status: TripStatus?.COMPLETED, endedAt: new Date()?.toISOString() };
    const success = updateTrip(tripToComplete?.id, updated);
    if (success) {
      showToast('Trip ended successfully', 'success');
      loadTripsData();
    } else {
      showToast('Failed to end trip', 'error');
    }
    setShowEndTripModal(false);
    setTripToComplete(null);
  };

  const handleOpenTrip = (tripId) => {
    navigate(`/trips/${tripId}`);
  };

  const handleViewSummary = (tripId) => {
    const trip = trips?.find(t => t?.id === tripId);
    if (trip) {
      setSummaryTrip(trip);
      setShowSummaryPanel(true);
    }
  };
  
  const handlePillClick = (trip, pill) => {
    switch(pill) {
      case 'guests':
        navigate(`/trips/${trip?.id}?tab=guests`);
        break;
      case 'preferences':
        navigate(`/trips/${trip?.id}?tab=preferences`);
        break;
      case 'photos':
        setPhotosTrip(trip);
        setShowPhotosModal(true);
        break;
      case 'laundry':
        setLaundryTrip(trip);
        setShowLaundryDrawer(true);
        break;
      default:
        break;
    }
  };
  
  const handleCardClick = (tripId, e) => {
    // Prevent navigation if clicking on buttons or interactive elements
    if (e?.target?.closest('button') || e?.target?.closest('a')) {
      return;
    }
    handleOpenTrip(tripId);
  };

  const formatDateRange = (startDate, endDate) => {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const startOptions = { month: 'short', day: 'numeric' };
    const endOptions = { month: 'short', day: 'numeric', year: 'numeric' };
    return `${start?.toLocaleDateString('en-US', startOptions)} — ${end?.toLocaleDateString('en-US', endOptions)}`;
  };

  // Calculate derived metrics
  const getGuestsCount = (trip) => {
    return trip?.guestIds?.length || 0;
  };

  const getPreferencesCoverage = (trip) => {
    const prefs = getPreferencesByTrip(trip?.id);
    if (!trip?.guestIds?.length) return 0;
    
    const guestsWithPrefs = new Set(prefs?.map(p => p?.guestId));
    return Math.round((guestsWithPrefs?.size / trip?.guestIds?.length) * 100);
  };

  const getLaundryStatus = (trip) => {
    try {
      const laundryItems = JSON.parse(localStorage.getItem('cargo_laundry_v1') || '[]');
      const tripLaundry = laundryItems?.filter(item => {
        if (item?.ownerType?.toLowerCase() === 'guest' && item?.ownerGuestId) {
          const isActiveGuest = trip?.guests?.some(tg => tg?.guestId === item?.ownerGuestId && tg?.isActive);
          return isActiveGuest;
        }
        return false;
      });
      const outstanding = tripLaundry?.filter(item => item?.status !== 'Delivered')?.length || 0;
      return outstanding > 0 ? `${outstanding} outstanding` : '✓ All returned';
    } catch {
      return '—';
    }
  };

  const getPhotosCount = (trip) => {
    return trip?.photos?.length || 0;
  };
  
  // Get timeline badge date
  const getTimelineBadgeDate = () => {
    const { active, upcoming } = categorizeTrips();
    
    if (active) {
      return new Date(); // Today's date
    }
    
    if (upcoming?.length > 0) {
      // Get earliest upcoming trip
      const nextTrip = upcoming?.sort((a, b) => new Date(a?.startDate) - new Date(b?.startDate))?.[0];
      return new Date(nextTrip?.startDate);
    }
    
    return null;
  };
  
  const formatBadgeDate = (date) => {
    if (!date) return null;
    const day = date?.getDate();
    const month = date?.toLocaleDateString('en-US', { month: 'short' })?.toUpperCase();
    return { day, month };
  };
  
  // Get filtered laundry items for trip
  const getTripLaundryItems = (trip) => {
    try {
      const laundryItems = JSON.parse(localStorage.getItem('cargo_laundry_v1') || '[]');
      const tripLaundry = laundryItems?.filter(item => {
        if (item?.tripId === trip?.id) return true;
        if (item?.ownerType?.toLowerCase() === 'guest' && item?.ownerGuestId) {
          const isActiveGuest = trip?.guests?.some(tg => tg?.guestId === item?.ownerGuestId && tg?.isActive);
          return isActiveGuest;
        }
        return false;
      });
      
      if (laundryFilter === 'outstanding') {
        return tripLaundry?.filter(item => item?.status !== 'Delivered');
      } else if (laundryFilter === 'delivered') {
        return tripLaundry?.filter(item => item?.status === 'Delivered');
      }
      
      return tripLaundry;
    } catch {
      return [];
    }
  };

  // Handle hero image upload
  const handleUploadHeroImage = (trip) => {
    if (!permissions?.canEdit) {
      showToast('You do not have permission to upload images', 'error');
      return;
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    
    input.onchange = async (e) => {
      const file = e?.target?.files?.[0];
      if (!file) return;
      
      // Validate file size (max 5MB)
      if (file?.size > 5 * 1024 * 1024) {
        showToast('Image size must be less than 5MB', 'error');
        return;
      }
      
      // Validate file type
      if (!file?.type?.startsWith('image/')) {
        showToast('Please select a valid image file', 'error');
        return;
      }
      
      setIsUploadingHero(true);
      
      try {
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64String = reader?.result;
          
          const updated = {
            heroImageUrl: base64String,
            heroImageUpdatedAt: new Date()?.toISOString(),
            heroImageUpdatedBy: currentUser?.id
          };
          
          const success = updateTrip(trip?.id, updated);
          if (success) {
            showToast('Hero image updated', 'success');
            loadTripsData();
          } else {
            showToast('Failed to update hero image', 'error');
          }
          setIsUploadingHero(false);
        };
        
        reader.onerror = () => {
          showToast('Failed to read image file', 'error');
          setIsUploadingHero(false);
        };
        
        reader?.readAsDataURL(file);
      } catch (error) {
        showToast('Failed to upload hero image', 'error');
        setIsUploadingHero(false);
      }
    };
    
    input?.click();
  };

  const { active, upcoming, completed } = categorizeTrips();

  if (!currentUser && !DEV_MODE) {
    return null;
  }

  // Show loading state while auth or page data is loading
  if (!DEV_MODE && (authLoading || (pageLoading && !loadTimeout))) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      </div>
    );
  }

  // Show timeout UI if loading takes too long
  if (loadTimeout) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="flex flex-col items-center justify-center py-20 gap-4 px-4">
          <div className="w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center">
            <Icon name="AlertTriangle" size={32} className="text-yellow-600" />
          </div>
          <div className="text-center max-w-md">
            <h2 className="text-xl font-semibold text-foreground mb-2">Still Loading</h2>
            <p className="text-muted-foreground mb-6">
              Trips data is taking longer than expected to load.
            </p>
            <button
              onClick={fetchTrips}
              className="px-6 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background transition-colors duration-300">
      <Header />
      <main className="p-6 max-w-[1400px] mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-foreground mb-1">Trips</h1>
            <p className="text-sm text-muted-foreground">Manage guest trips and preferences</p>
          </div>
          {permissions?.canAdd && (
            <Button onClick={handleAddTrip} className="flex items-center gap-2">
              <Icon name="Plus" size={18} />
              Add Trip
            </Button>
          )}
        </div>

        {/* Search Bar */}
        <div className="mb-6">
          <div className="relative">
            <Icon
              name="Search"
              size={18}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="text"
              placeholder="Search trips by name, date range, or guest name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e?.target?.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-card border border-border rounded-lg text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>

        {/* 2-COLUMN LAYOUT: Timeline Rail + Content */}
        <div className="flex gap-6">
          {/* LEFT: Timeline Rail Gutter */}
          <div className="hidden lg:block w-16 flex-shrink-0 relative">
            {/* Vertical Line */}
            <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-border" />
            
            {/* Timeline Badge */}
            {(() => {
              const badgeDate = getTimelineBadgeDate();
              const formatted = formatBadgeDate(badgeDate);
              
              if (!formatted) return null;
              
              return (
                <div 
                  className="absolute left-1/2 -translate-x-1/2 bg-primary text-white rounded-lg shadow-md px-2 py-1.5 text-center min-w-[48px] z-10"
                  style={{ top: '-8px' }}
                >
                  <div className="text-lg font-bold leading-none">{formatted?.day}</div>
                  <div className="text-[10px] font-semibold leading-none mt-0.5">{formatted?.month}</div>
                </div>
              );
            })()}
            
            {/* Timeline Nodes */}
            <div className="relative h-full">
              {/* Active Node */}
              <div 
                ref={activeSectionRef}
                className="absolute left-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-primary border-2 border-background shadow-sm"
                style={{ top: '0px' }}
              />
              
              {/* Upcoming Node */}
              {upcoming?.length > 0 && (
                <div 
                  ref={upcomingSectionRef}
                  className="absolute left-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-blue-500 border-2 border-background shadow-sm"
                  style={{ top: active ? '320px' : '0px' }}
                />
              )}
              
              {/* Completed Node */}
              {completed?.length > 0 && (
                <div 
                  ref={completedSectionRef}
                  className="absolute left-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-gray-400 border-2 border-background shadow-sm"
                  style={{ 
                    top: active && upcoming?.length > 0 ? `${320 + (upcoming?.length * 80) + 80}px` : 
                         active ? '320px' : 
                         upcoming?.length > 0 ? `${upcoming?.length * 80 + 80}px` : '0px'
                  }}
                />
              )}
            </div>
          </div>

          {/* RIGHT: Content Area */}
          <div className="flex-1">
            {/* ACTIVE TRIP SECTION */}
            <div className="mb-8">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-1 h-5 bg-primary rounded-full" />
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Active Trip</h2>
              </div>
              
              {active ? (
                <div 
                  className="bg-card border border-border rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow cursor-pointer"
                  onClick={(e) => handleCardClick(active?.id, e)}
                >
                  <div className="flex flex-col lg:flex-row">
                    {/* Left: Content */}
                    <div className="flex-1 p-6">
                      {/* Title and Date */}
                      <div className="mb-4">
                        <h3 className="text-2xl font-semibold text-foreground mb-2">{active?.name}</h3>
                        <p className="text-sm text-muted-foreground mb-1">{formatDateRange(active?.startDate, active?.endDate)}</p>
                        {active?.itinerarySummary && (
                          <p className="text-sm text-muted-foreground italic">{active?.itinerarySummary}</p>
                        )}
                      </div>

                      {/* Quick Info Lines */}
                      <div className="grid grid-cols-2 gap-3 mb-6">
                        <button
                          onClick={(e) => {
                            e?.stopPropagation();
                            handlePillClick(active, 'guests');
                          }}
                          className="flex items-center gap-2 hover:bg-accent p-2 rounded-lg transition-colors text-left"
                        >
                          <Icon name="Users" size={16} className="text-muted-foreground" />
                          <span className="text-sm text-foreground">Guests: <span className="font-medium">{getGuestsCount(active)}</span></span>
                        </button>
                        <button
                          onClick={(e) => {
                            e?.stopPropagation();
                            handlePillClick(active, 'preferences');
                          }}
                          className="flex items-center gap-2 hover:bg-accent p-2 rounded-lg transition-colors text-left"
                        >
                          <Icon name="Heart" size={16} className="text-muted-foreground" />
                          <span className="text-sm text-foreground">Preferences: <span className="font-medium">{getPreferencesCoverage(active)}% coverage</span></span>
                        </button>
                        <button
                          onClick={(e) => {
                            e?.stopPropagation();
                            handlePillClick(active, 'laundry');
                          }}
                          className="flex items-center gap-2 hover:bg-accent p-2 rounded-lg transition-colors text-left"
                        >
                          <Icon name="Shirt" size={16} className="text-muted-foreground" />
                          <span className="text-sm text-foreground">Laundry: <span className="font-medium">{getLaundryStatus(active)}</span></span>
                        </button>
                        <button
                          onClick={(e) => {
                            e?.stopPropagation();
                            handlePillClick(active, 'photos');
                          }}
                          className="flex items-center gap-2 hover:bg-accent p-2 rounded-lg transition-colors text-left"
                        >
                          <Icon name="Camera" size={16} className="text-muted-foreground" />
                          <span className="text-sm text-foreground">Photos: <span className="font-medium">{getPhotosCount(active)}</span></span>
                        </button>
                      </div>

                      {/* Action Row */}
                      <div className="flex flex-wrap items-center gap-3">
                        <Button onClick={(e) => { e?.stopPropagation(); handleOpenTrip(active?.id); }} size="sm">
                          Open Trip Workspace
                        </Button>
                        {permissions?.canEdit && (
                          <>
                            <Button onClick={(e) => { e?.stopPropagation(); handleEndTrip(active); }} variant="outline" size="sm">
                              End Trip
                            </Button>
                            <Button onClick={(e) => { e?.stopPropagation(); handleMarkCompleted(active); }} variant="ghost" size="sm">
                              Mark as completed
                            </Button>
                          </>
                        )}
                        <button
                          onClick={(e) => { e?.stopPropagation(); handleViewSummary(active?.id); }}
                          className="ml-auto text-sm text-primary hover:underline flex items-center gap-1"
                        >
                          View summary
                          <Icon name="ChevronRight" size={14} />
                        </button>
                      </div>
                    </div>

                    {/* Right: Hero Image */}
                    <div className="lg:w-[400px] h-[280px] lg:h-auto relative group">
                      {active?.heroImageUrl ? (
                        <>
                          <img
                            src={active?.heroImageUrl}
                            alt={`${active?.name} hero image`}
                            className="w-full h-full object-cover"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
                        </>
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center">
                          <Icon name="Ship" size={64} className="text-primary/30" />
                        </div>
                      )}
                      
                      {/* Upload button (visible on hover for COMMAND/CHIEF) */}
                      {permissions?.canEdit && (
                        <button
                          onClick={() => handleUploadHeroImage(active)}
                          disabled={isUploadingHero}
                          className="absolute top-3 right-3 bg-black/60 hover:bg-black/80 text-white p-2 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
                          title="Upload hero image"
                        >
                          {isUploadingHero ? (
                            <Icon name="Loader2" size={18} className="animate-spin" />
                          ) : (
                            <Icon name="Upload" size={18} />
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-card border border-border rounded-xl p-8 text-center">
                  <Icon name="Ship" size={48} className="text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-muted-foreground mb-4">No active trip</p>
                  {permissions?.canAdd && (
                    <Button onClick={handleAddTrip} variant="outline" size="sm">
                      Start / Activate a trip
                    </Button>
                  )}
                </div>
              )}
            </div>

            {/* UPCOMING SECTION */}
            {upcoming?.length > 0 && (
              <div className="mb-8">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-1 h-5 bg-blue-500 rounded-full" />
                  <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Upcoming</h2>
                </div>
                
                <div className="space-y-2">
                  {upcoming?.map(trip => (
                    <button
                      key={trip?.id}
                      onClick={() => handleOpenTrip(trip?.id)}
                      className="w-full bg-card border border-border rounded-lg p-4 hover:bg-accent transition-colors text-left flex items-center justify-between group"
                    >
                      <div className="flex-1">
                        <h3 className="text-base font-medium text-foreground mb-1 group-hover:text-primary transition-colors">{trip?.name}</h3>
                        <p className="text-xs text-muted-foreground">Guests: {getGuestsCount(trip)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-foreground font-medium">{formatDateRange(trip?.startDate, trip?.endDate)}</p>
                      </div>
                      <Icon name="ChevronRight" size={18} className="text-muted-foreground ml-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* COMPLETED SECTION (Collapsible) */}
            {completed?.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-1 h-5 bg-gray-400 rounded-full" />
                  <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Completed</h2>
                </div>
                
                {/* Collapsible Row */}
                <button
                  onClick={() => setShowCompleted(!showCompleted)}
                  className="w-full bg-card border border-border rounded-lg p-4 hover:bg-accent transition-colors text-left flex items-center justify-between group mb-2"
                >
                  <div className="flex items-center gap-2">
                    <Icon
                      name={showCompleted ? 'ChevronDown' : 'ChevronRight'}
                      size={18}
                      className="text-muted-foreground"
                    />
                    <span className="text-sm font-medium text-foreground">Completed trips ({completed?.length})</span>
                  </div>
                </button>

                {/* Expanded Completed Rows */}
                {showCompleted && (
                  <div className="space-y-2 ml-6">
                    {completed?.map(trip => (
                      <button
                        key={trip?.id}
                        onClick={() => navigate(`/trips/${trip?.id}?mode=readonly`)}
                        className="w-full bg-card border border-border rounded-lg p-4 hover:bg-accent transition-colors text-left flex items-center justify-between group"
                      >
                        <div className="flex-1">
                          <h3 className="text-base font-medium text-foreground mb-1 group-hover:text-primary transition-colors">{trip?.name}</h3>
                          <p className="text-xs text-muted-foreground">Guests: {getGuestsCount(trip)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm text-foreground font-medium">{formatDateRange(trip?.startDate, trip?.endDate)}</p>
                        </div>
                        <Icon name="ChevronRight" size={18} className="text-muted-foreground ml-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Empty State */}
            {!active && upcoming?.length === 0 && completed?.length === 0 && (
              <div className="bg-card border border-border rounded-xl p-12 text-center">
                <Icon name="Ship" size={64} className="text-muted-foreground/20 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-foreground mb-2">No trips yet</h3>
                <p className="text-sm text-muted-foreground mb-6">Create your first trip to get started</p>
                {permissions?.canAdd && (
                  <Button onClick={handleAddTrip}>
                    <Icon name="Plus" size={18} />
                    Add Trip
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </main>
      {/* Add Trip Modal */}
      {showAddModal && (
        <AddTripModal
          isOpen={showAddModal}
          onClose={() => {
            setShowAddModal(false);
            setEditingTrip(null);
          }}
          onSuccess={() => {
            loadTripsData();
            setShowAddModal(false);
            setEditingTrip(null);
          }}
          onSave={() => {
            loadTripsData();
            setShowAddModal(false);
            setEditingTrip(null);
          }}
          guests={guests}
          editTrip={editingTrip}
        />
      )}
      {/* End Trip Confirmation Modal */}
      {showEndTripModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-foreground mb-2">End this trip?</h3>
            <p className="text-sm text-muted-foreground mb-6">
              This will set the trip status to Completed and lock the trip workspace as read-only.
            </p>
            <div className="flex gap-3 justify-end">
              <Button 
                variant="outline" 
                onClick={() => {
                  setShowEndTripModal(false);
                  setTripToComplete(null);
                }}
              >
                Cancel
              </Button>
              <Button onClick={confirmEndTrip}>
                End Trip
              </Button>
            </div>
          </div>
        </div>
      )}
      {/* Mark as Completed Confirmation Modal */}
      {showMarkCompletedModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-foreground mb-2">Mark trip as completed?</h3>
            <p className="text-sm text-muted-foreground mb-6">
              This will set the trip status to Completed and lock the trip workspace as read-only.
            </p>
            <div className="flex gap-3 justify-end">
              <Button 
                variant="outline" 
                onClick={() => {
                  setShowMarkCompletedModal(false);
                  setTripToComplete(null);
                }}
              >
                Cancel
              </Button>
              <Button onClick={confirmMarkCompleted}>
                Mark as Completed
              </Button>
            </div>
          </div>
        </div>
      )}
      {/* View Summary Slide-over Panel */}
      {showSummaryPanel && summaryTrip && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-end z-50" onClick={() => setShowSummaryPanel(false)}>
          <div 
            className="bg-card border-l border-border w-full sm:w-[480px] h-[80vh] sm:h-full shadow-2xl overflow-y-auto"
            onClick={(e) => e?.stopPropagation()}
          >
            <div className="sticky top-0 bg-card border-b border-border p-6 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-foreground">Trip Summary</h2>
              <button onClick={() => setShowSummaryPanel(false)} className="text-muted-foreground hover:text-foreground">
                <Icon name="X" size={20} />
              </button>
            </div>
            
            <div className="p-6 space-y-6">
              {/* Trip Info */}
              <div>
                <h3 className="text-lg font-semibold text-foreground mb-2">{summaryTrip?.name}</h3>
                <p className="text-sm text-muted-foreground mb-1">{formatDateRange(summaryTrip?.startDate, summaryTrip?.endDate)}</p>
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium mt-2"
                  style={{
                    backgroundColor: summaryTrip?.status === TripStatus?.ACTIVE ? 'rgb(var(--primary) / 0.1)' : 
                                     summaryTrip?.status === TripStatus?.UPCOMING ? 'rgb(59 130 246 / 0.1)': 'rgb(156 163 175 / 0.1)',
                    color: summaryTrip?.status === TripStatus?.ACTIVE ? 'rgb(var(--primary))' : 
                           summaryTrip?.status === TripStatus?.UPCOMING ? 'rgb(59 130 246)': 'rgb(107 114 128)'
                  }}
                >
                  {summaryTrip?.status}
                </div>
              </div>
              
              {/* Quick Stats */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-accent/50 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Icon name="Users" size={16} className="text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">Guests</span>
                  </div>
                  <p className="text-2xl font-semibold text-foreground">{getGuestsCount(summaryTrip)}</p>
                </div>
                <div className="bg-accent/50 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Icon name="Heart" size={16} className="text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">Preferences</span>
                  </div>
                  <p className="text-2xl font-semibold text-foreground">{getPreferencesCoverage(summaryTrip)}%</p>
                </div>
                <div className="bg-accent/50 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Icon name="Camera" size={16} className="text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">Photos</span>
                  </div>
                  <p className="text-2xl font-semibold text-foreground">{getPhotosCount(summaryTrip)}</p>
                </div>
                <div className="bg-accent/50 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Icon name="Shirt" size={16} className="text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">Laundry</span>
                  </div>
                  <p className="text-sm font-medium text-foreground">{getLaundryStatus(summaryTrip)}</p>
                </div>
              </div>
              
              {/* Assigned Guests */}
              <div>
                <h4 className="text-sm font-semibold text-foreground mb-3">Assigned Guests</h4>
                {summaryTrip?.guests?.length > 0 ? (
                  <div className="space-y-2">
                    {summaryTrip?.guests?.map(tg => {
                      const guest = guests?.find(g => g?.id === tg?.guestId);
                      if (!guest) return null;
                      return (
                        <div key={tg?.guestId} className="flex items-center gap-3 p-3 bg-accent/30 rounded-lg">
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                            <span className="text-sm font-medium text-primary">
                              {guest?.firstName?.[0]}{guest?.lastName?.[0]}
                            </span>
                          </div>
                          <div>
                            <p className="text-sm font-medium text-foreground">{guest?.firstName} {guest?.lastName}</p>
                            {!tg?.isActive && <span className="text-xs text-muted-foreground">(Inactive)</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No guests assigned</p>
                )}
              </div>
              
              {/* Action Button */}
              <Button 
                onClick={() => {
                  setShowSummaryPanel(false);
                  handleOpenTrip(summaryTrip?.id);
                }}
                className="w-full"
              >
                Open full trip
              </Button>
            </div>
          </div>
        </div>
      )}
      {/* Trip Photos Modal */}
      {showPhotosModal && photosTrip && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowPhotosModal(false)}>
          <div 
            className="bg-card border border-border rounded-xl shadow-xl max-w-3xl w-full max-h-[80vh] overflow-hidden flex flex-col"
            onClick={(e) => e?.stopPropagation()}
          >
            <div className="p-6 border-b border-border flex items-center justify-between">
              <h2 className="text-xl font-semibold text-foreground">Trip Photos - {photosTrip?.name}</h2>
              <button onClick={() => setShowPhotosModal(false)} className="text-muted-foreground hover:text-foreground">
                <Icon name="X" size={20} />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1">
              {photosTrip?.photos?.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  {photosTrip?.photos?.map((photo, idx) => (
                    <div key={idx} className="aspect-square bg-accent rounded-lg overflow-hidden">
                      <img src={photo?.url} alt={photo?.caption || `Trip photo ${idx + 1}`} className="w-full h-full object-cover" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12">
                  <Icon name="Camera" size={48} className="text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-muted-foreground mb-4">No photos uploaded yet</p>
                </div>
              )}
            </div>
            
            <div className="p-6 border-t border-border">
              <Button 
                onClick={() => {
                  setShowPhotosModal(false);
                  navigate(`/trips/${photosTrip?.id}?tab=photos`);
                }}
                className="w-full"
              >
                <Icon name="Upload" size={18} />
                Upload Photos
              </Button>
            </div>
          </div>
        </div>
      )}
      {/* Trip Laundry Slide-over Drawer */}
      {showLaundryDrawer && laundryTrip && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-end z-50" onClick={() => setShowLaundryDrawer(false)}>
          <div 
            className="bg-card border-l border-border w-full sm:w-[480px] h-[80vh] sm:h-full shadow-2xl overflow-y-auto"
            onClick={(e) => e?.stopPropagation()}
          >
            <div className="sticky top-0 bg-card border-b border-border p-6 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-foreground">Trip Laundry</h2>
                <p className="text-sm text-muted-foreground mt-1">{laundryTrip?.name}</p>
              </div>
              <button onClick={() => setShowLaundryDrawer(false)} className="text-muted-foreground hover:text-foreground">
                <Icon name="X" size={20} />
              </button>
            </div>
            
            <div className="p-6">
              {/* Status Summary */}
              <div className="bg-accent/50 rounded-lg p-4 mb-6">
                {(() => {
                  const allItems = getTripLaundryItems(laundryTrip);
                  const outstanding = allItems?.filter(item => item?.status !== 'Delivered')?.length || 0;
                  
                  return outstanding > 0 ? (
                    <div className="flex items-center gap-2">
                      <Icon name="AlertCircle" size={20} className="text-orange-500" />
                      <span className="text-sm font-medium text-foreground">{outstanding} outstanding item{outstanding !== 1 ? 's' : ''}</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Icon name="CheckCircle2" size={20} className="text-green-500" />
                      <span className="text-sm font-medium text-foreground">All returned</span>
                    </div>
                  );
                })()}
              </div>
              
              {/* Filter Buttons */}
              <div className="flex gap-2 mb-4">
                <button
                  onClick={() => setLaundryFilter('all')}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    laundryFilter === 'all' ? 'bg-primary text-white' : 'bg-accent text-foreground hover:bg-accent/80'
                  }`}
                >
                  All
                </button>
                <button
                  onClick={() => setLaundryFilter('outstanding')}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    laundryFilter === 'outstanding' ? 'bg-primary text-white' : 'bg-accent text-foreground hover:bg-accent/80'
                  }`}
                >
                  Outstanding
                </button>
                <button
                  onClick={() => setLaundryFilter('delivered')}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    laundryFilter === 'delivered' ? 'bg-primary text-white' : 'bg-accent text-foreground hover:bg-accent/80'
                  }`}
                >
                  Delivered
                </button>
              </div>
              
              {/* Laundry Items List */}
              <div className="space-y-2">
                {(() => {
                  const items = getTripLaundryItems(laundryTrip);
                  
                  if (items?.length === 0) {
                    return (
                      <div className="text-center py-8">
                        <Icon name="Shirt" size={48} className="text-muted-foreground/30 mx-auto mb-3" />
                        <p className="text-sm text-muted-foreground">No laundry items found</p>
                      </div>
                    );
                  }
                  
                  return items?.map(item => {
                    const guest = guests?.find(g => g?.id === item?.ownerGuestId);
                    return (
                      <div key={item?.id} className="bg-accent/30 rounded-lg p-3">
                        <div className="flex items-start justify-between mb-1">
                          <div>
                            <p className="text-sm font-medium text-foreground">{item?.itemName || 'Unnamed item'}</p>
                            {guest && (
                              <p className="text-xs text-muted-foreground">{guest?.firstName} {guest?.lastName}</p>
                            )}
                          </div>
                          <span className={`text-xs px-2 py-1 rounded-full ${
                            item?.status === 'Delivered' ? 'bg-green-500/10 text-green-600' : 'bg-orange-500/10 text-orange-600'
                          }`}>
                            {item?.status || 'Pending'}
                          </span>
                        </div>
                        {item?.notes && (
                          <p className="text-xs text-muted-foreground mt-1">{item?.notes}</p>
                        )}
                      </div>
                    );
                  });
                })()}
              </div>
              
              {/* Open Full Laundry Log Button */}
              <div className="mt-6">
                <Button 
                  onClick={() => {
                    setShowLaundryDrawer(false);
                    navigate(`/laundry-management-dashboard?tripId=${laundryTrip?.id}`);
                  }}
                  variant="outline"
                  className="w-full"
                >
                  Open full Laundry Log
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TripsManagementDashboard;