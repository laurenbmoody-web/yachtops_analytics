import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, useLocation, useSearchParams } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Button from '../../components/ui/Button';
import Icon from '../../components/AppIcon';
import AddTripModal from '../trips-management-dashboard/components/AddTripModal';
import CompleteTripModal from './components/CompleteTripModal';
import AddItineraryDayModal from './components/AddItineraryDayModal';
import AddSpecialDateModal from './components/AddSpecialDateModal';
import AddSpecialRequestModal from './components/AddSpecialRequestModal';
import EditCharterDetailsModal from './components/EditCharterDetailsModal';
import TripLaundryDrawer from './components/TripLaundryDrawer';
import { getTripById, deleteTrip, TripStatus, TripType, getPreferencesByTrip, getActiveGuestCount, getPreferencesCoveragePct, getOpenRequestsCount, getUpcomingSpecialDatesCount, getProvisioningStatus, getLaundryStatus, updateTrip } from '../trips-management-dashboard/utils/tripStorage';
import { loadGuests, updateGuest } from '../guest-management-dashboard/utils/guestStorage';
import { createGuest } from '../guest-management-dashboard/utils/guestStorage';
import { getCurrentUser } from '../../utils/authStorage';
import { showToast } from '../../utils/toast';
import { canAccessTrips, canEditTrip, canDeleteTrip } from '../trips-management-dashboard/utils/tripPermissions';


import AddOrSelectGuestModal from './components/AddOrSelectGuestModal';
import Select from '../../components/ui/Select';


const TripDetailView = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { tripId } = useParams();
  const [currentUser, setCurrentUser] = useState(null);
  const [trip, setTrip] = useState(null);
  const [guests, setGuests] = useState([]);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [preferences, setPreferences] = useState([]);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [activeSection, setActiveSection] = useState('overview');

  // Modals for sections
  const [showAddItineraryModal, setShowAddItineraryModal] = useState(false);
  const [showAddSpecialDateModal, setShowAddSpecialDateModal] = useState(false);
  const [showAddSpecialRequestModal, setShowAddSpecialRequestModal] = useState(false);
  const [showEditCharterModal, setShowEditCharterModal] = useState(false);
  const [editingItineraryDay, setEditingItineraryDay] = useState(null);
  const [editingSpecialDate, setEditingSpecialDate] = useState(null);
  const [editingSpecialRequest, setEditingSpecialRequest] = useState(null);
  
  // New state for modals
  const [showAddSpecialModal, setShowAddSpecialModal] = useState(false);
  const [showAddReminderModal, setShowAddReminderModal] = useState(false);
  const [showEventDetailPopover, setShowEventDetailPopover] = useState(null);
  const [showSpecialDetailPopover, setShowSpecialDetailPopover] = useState(null);
  const [showReminderDetailPopover, setShowReminderDetailPopover] = useState(null);
  const [editingSpecial, setEditingSpecial] = useState(null);
  const [editingReminder, setEditingReminder] = useState(null);
  const [showLaundryDrawer, setShowLaundryDrawer] = useState(false);

  // Photo upload state
  const [photos, setPhotos] = useState([]);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);

  const permissions = {
    canEdit: canEditTrip(currentUser),
    canDelete: canDeleteTrip(currentUser)
  };

  // Check authentication and authorization
  useEffect(() => {
    const user = getCurrentUser();
    if (!user) {
      // DO NOT redirect here - ProtectedRoute handles this
      return;
    }
    if (!canAccessTrips(user)) {
      showToast('Access restricted', 'error');
      navigate('/dashboard');
      return;
    }
    setCurrentUser(user);
  }, [navigate]);

  // Load trip and guests
  useEffect(() => {
    if (tripId) {
      loadTripData();
      loadGuestsData();
      loadPreferencesData();
    }
  }, [tripId]);

  // Load photos from trip data
  useEffect(() => {
    if (trip?.photos) {
      setPhotos(trip?.photos);
    }
  }, [trip]);

  // Determine active section from URL
  useEffect(() => {
    const searchParams = new URLSearchParams(location?.search);
    const tab = searchParams?.get('tab');
    if (tab) {
      setActiveSection(tab);
    } else {
      setActiveSection('overview');
    }
  }, [location]);

  const loadTripData = () => {
    const tripData = getTripById(tripId);
    if (!tripData) {
      showToast('Trip not found', 'error');
      navigate('/trips-management-dashboard');
      return;
    }
    setTrip(tripData);
  };

  const loadGuestsData = () => {
    const data = loadGuests();
    setGuests(data?.filter(g => !g?.isDeleted));
  };

  const loadPreferencesData = () => {
    const prefs = getPreferencesByTrip(tripId);
    setPreferences(prefs);
  };

  // Sorted activity log for display
  const sortedActivity = trip?.tripActivityLog?.sort((a, b) => new Date(b?.at) - new Date(a?.at));

  const handleEditTrip = () => {
    setShowEditModal(true);
  };

  const handleMarkCompleted = () => {
    setShowCompleteModal(true);
  };

  const handleDeleteTrip = () => {
    if (window.confirm('Are you sure you want to delete this trip? This will also delete all associated preferences.')) {
      const success = deleteTrip(tripId);
      if (success) {
        showToast('Trip deleted successfully', 'success');
        navigate('/trips-management-dashboard');
      } else {
        showToast('Failed to delete trip', 'error');
      }
    }
  };

  const handleOpenWorkspace = () => {
    navigate(`/trips/${tripId}/guests`);
  };

  const handleEndTrip = () => {
    if (window.confirm('End this trip? This will change the status to completed.')) {
      handleMarkCompleted();
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case TripStatus?.ACTIVE:
        return 'bg-green-100 text-green-800';
      case TripStatus?.UPCOMING:
        return 'bg-blue-100 text-blue-800';
      case TripStatus?.COMPLETED:
        return 'bg-gray-100 text-gray-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getTripTypeColor = (type) => {
    switch (type) {
      case TripType?.CHARTER:
        return 'bg-purple-100 text-purple-800';
      case TripType?.OWNER:
        return 'bg-amber-100 text-amber-800';
      case TripType?.FRIENDS_FAMILY:
        return 'bg-pink-100 text-pink-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const formatDateRange = (startDate, endDate) => {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const options = { month: 'short', day: 'numeric', year: 'numeric' };
    return `${start?.toLocaleDateString('en-US', options)} - ${end?.toLocaleDateString('en-US', options)}`;
  };

  // Get laundry count for this trip
  const getLaundryCount = () => {
    try {
      const laundryItems = JSON.parse(localStorage.getItem('cargo_laundry_v1') || '[]');
      const tripLaundry = laundryItems?.filter(item => {
        // Filter guest laundry for active guests on this trip
        if (item?.ownerType?.toLowerCase() === 'guest' && item?.ownerGuestId) {
          const isActiveGuest = trip?.guests?.some(tg => tg?.guestId === item?.ownerGuestId && tg?.isActive);
          return isActiveGuest;
        }
        return false;
      });
      const outstanding = tripLaundry?.filter(item => item?.status !== 'Delivered')?.length || 0;
      return { total: tripLaundry?.length || 0, outstanding };
    } catch {
      return { total: 0, outstanding: 0 };
    }
  };

  // Get photos count (placeholder)
  const getPhotosCount = () => {
    return trip?.photos?.length || 0;
  };
  
  // Handle adding guest through trip overview
  const handleAddGuest = (guestData) => {
    // Create guest with isActiveOnTrip set to true
    const newGuest = createGuest({ ...guestData, isActiveOnTrip: true });
    if (newGuest) {
      // Add guest to trip's guests array
      const updatedGuests = [
        ...(trip?.guests || []),
        {
          guestId: newGuest?.id,
          isActive: true,
          activatedAt: new Date()?.toISOString(),
          activatedByUserId: currentUser?.id
        }
      ];
      
      // Update trip
      const success = updateTrip(trip?.id, { guests: updatedGuests });
      if (success) {
        showToast('Guest added and activated on trip', 'success');
        loadTripData();
        loadGuestsData();
      } else {
        showToast('Failed to add guest to trip', 'error');
      }
    } else {
      showToast('Failed to create guest', 'error');
    }
  };
  
  // Log trip activity
  const logTripActivity = (actionType, message, entityId = null) => {
    const activity = {
      id: `activity-${Date.now()}-${Math.random()?.toString(36)?.substr(2, 9)}`,
      at: new Date()?.toISOString(),
      actorName: currentUser?.fullName || currentUser?.name || 'Unknown',
      actionType,
      message,
      entityId
    };
    
    const updatedTrip = {
      ...trip,
      tripActivityLog: [...(trip?.tripActivityLog || []), activity]
    };
    
    updateTrip(trip?.id, updatedTrip);
  };

  // Get hero image URL (single source of truth with backward compatibility)
  const heroImageUrl = trip?.heroImageUrl || trip?.heroImage || trip?.coverImageUrl || trip?.coverImage || null;

  if (!currentUser || !trip) {
    return null;
  }

  // Computed indicators
  const activeGuestCount = getActiveGuestCount(trip);
  const preferencesCoverage = getPreferencesCoveragePct(tripId);
  const openRequestsCount = getOpenRequestsCount(trip);
  const upcomingDatesCount = getUpcomingSpecialDatesCount(trip);
  const provisioningStatus = getProvisioningStatus(trip);
  const laundryStatus = getLaundryStatus(trip);
  const laundryCount = getLaundryCount();
  const photosCount = getPhotosCount();

  return (
    <div className="min-h-screen bg-background transition-colors duration-300">
      <Header />
      <main className="flex h-[calc(100vh-4rem)] overflow-hidden">
        {/* LEFT SIDEBAR NAVIGATION - FIXED WIDTH, FLUSH LEFT, NO SHRINK */}
        <aside className="w-60 border-r border-border bg-card flex-shrink-0 overflow-y-auto pl-0">
          <div className="py-0 px-4">
            <button
              onClick={() => navigate('/trips-management-dashboard')}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4 transition-smooth"
            >
              <Icon name="ArrowLeft" size={16} />
              Back to overview
            </button>

            <nav className="flex flex-col gap-1 mb-8">
              <button
                onClick={() => navigate(`/trips/${tripId}?tab=overview`)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-smooth text-left ${
                  activeSection === 'overview' ?'bg-primary text-primary-foreground' :'bg-card text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                Overview
              </button>
              <button
                onClick={() => navigate(`/trips/${tripId}?tab=guests`)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-smooth text-left ${
                  activeSection === 'guests' ?'bg-primary text-primary-foreground' :'bg-card text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                Guests
              </button>
              <button
                onClick={() => navigate(`/trips/${tripId}?tab=preferences`)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-smooth text-left ${
                  activeSection === 'preferences' ?'bg-primary text-primary-foreground' :'bg-card text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                Preferences
              </button>
              <button
                onClick={() => navigate(`/trips/${tripId}/itinerary`)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-smooth text-left ${
                  activeSection === 'itinerary' ?'bg-primary text-primary-foreground' :'bg-card text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                Itinerary
              </button>
              <button
                onClick={() => navigate(`/trips/${tripId}?tab=special`)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-smooth text-left ${
                  activeSection === 'special' ?'bg-primary text-primary-foreground' :'bg-card text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                Special
              </button>
              <button
                onClick={() => navigate(`/trips/${tripId}?tab=reminders`)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-smooth text-left ${
                  activeSection === 'reminders' ?'bg-primary text-primary-foreground' :'bg-card text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                Reminders
              </button>
              <button
                onClick={() => navigate(`/trips/${tripId}?tab=activity`)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-smooth text-left ${
                  activeSection === 'activity' ?'bg-primary text-primary-foreground' :'bg-card text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                Activity
              </button>
            </nav>
          </div>
        </aside>

        {/* MAIN CONTENT AREA - FLEXIBLE, WITH PROPER PADDING */}
        <div className="flex-1 overflow-y-auto h-[calc(100vh-5rem)] px-6 pt-16">
          <div className="py-4 max-w-7xl mx-auto">
          {activeSection === 'overview' && (
            <>
              {/* TRIP HERO HEADER - COMPACT */}
              <div className="bg-card border border-border rounded-xl overflow-hidden mb-4">
                {/* Hero Image with Overlay - DISPLAY ONLY (NO UPLOAD UI) */}
                <div className="relative h-48 bg-gradient-to-br from-blue-500 to-blue-700">
                  {heroImageUrl ? (
                    <>
                      <img src={heroImageUrl} alt={`${trip?.name} cover`} className="w-full h-full object-cover" />
                      {/* Gradient overlay for text readability */}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
                    </>
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Icon name="Ship" size={48} className="text-white/30" />
                    </div>
                  )}
                  
                  {/* Trip Title and Status Overlay */}
                  <div className="absolute bottom-0 left-0 right-0 p-6">
                    <div className="flex items-center gap-3 mb-1">
                      <h1 className="text-2xl font-bold text-white">{trip?.name}</h1>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${
                        trip?.status === TripStatus?.ACTIVE ? 'bg-green-500 text-white' :
                        trip?.status === TripStatus?.UPCOMING ? 'bg-blue-500 text-white': 'bg-gray-500 text-white'
                      }`}>
                        {trip?.status}
                      </span>
                    </div>
                    <p className="text-white/90 text-xs mb-0.5">
                      {formatDateRange(trip?.startDate, trip?.endDate)}
                    </p>
                    {trip?.itinerarySummary && (
                      <p className="text-white/80 text-xs italic">{trip?.itinerarySummary}</p>
                    )}
                  </div>
                </div>

                {/* Info Pills Row - COMPACT */}
                <div className="p-3 bg-muted/30 border-t border-border">
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Guests Pill - CLICKABLE */}
                    <button
                      onClick={() => navigate(`/trips/${tripId}?tab=guests`)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-border rounded-full hover:bg-primary/10 hover:border-primary transition-smooth"
                    >
                      <Icon name="Users" size={14} className="text-primary" />
                      <span className="text-xs font-medium text-foreground">Guests: {activeGuestCount}</span>
                    </button>

                    {/* Preferences Pill - CLICKABLE */}
                    <button
                      onClick={() => navigate(`/trips/${tripId}?tab=preferences`)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-border rounded-full hover:bg-primary/10 hover:border-primary transition-smooth"
                    >
                      <Icon name="FileText" size={14} className="text-primary" />
                      <span className="text-xs font-medium text-foreground">Preferences: {preferencesCoverage}%</span>
                    </button>

                    {/* Laundry Pill - CLICKABLE, TRIP-FILTERED */}
                    <button
                      onClick={() => setShowLaundryDrawer(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-border rounded-full hover:bg-primary/10 hover:border-primary transition-smooth"
                    >
                      <Icon name="Shirt" size={14} className="text-primary" />
                      <span className="text-xs font-medium text-foreground">
                        Laundry: {laundryCount?.outstanding > 0 ? `${laundryCount?.outstanding} outstanding` : '✓ All returned'}
                      </span>
                    </button>

                    {/* Photos Pill - CLICKABLE */}
                    <button
                      onClick={() => navigate(`/trips/${tripId}?tab=photos`)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-border rounded-full hover:bg-primary/10 hover:border-primary transition-smooth"
                    >
                      <Icon name="Camera" size={14} className="text-primary" />
                      <span className="text-xs font-medium text-foreground">Photos: {photosCount}</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* TWO-COLUMN TOP ROW: Today's Overview + Tomorrow Snapshot - COMPACT */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
                {/* LEFT COLUMN: Today's Overview */}
                <TodayOverviewSection 
                  trip={trip} 
                  guests={guests} 
                  selectedDate={selectedDate} 
                  onEventClick={(event) => setShowEventDetailPopover(event)}
                  onSpecialClick={(special) => setShowSpecialDetailPopover(special)}
                />

                {/* RIGHT COLUMN: Tomorrow Snapshot */}
                <TomorrowSnapshotSection 
                  trip={trip} 
                  guests={guests} 
                  selectedDate={selectedDate}
                  onEventClick={(event) => setShowEventDetailPopover(event)}
                  onSpecialClick={(special) => setShowSpecialDetailPopover(special)}
                />
              </div>

              {/* FULL-WIDTH CALENDAR ROW - HORIZONTAL SCROLL ONLY */}
              <div className="mb-4">
                <TripCalendarSection 
                  trip={trip} 
                  selectedDate={selectedDate} 
                  onSelectDate={(date) => {
                    setSelectedDate(date);
                    // Activity log for date selection is optional
                  }} 
                />
              </div>

              {/* TWO-COLUMN BOTTOM ROW: Special + Reminders - COMPACT */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* LEFT COLUMN: Special Section */}
                <SpecialOccasionsCard 
                  trip={trip} 
                  guests={guests} 
                  permissions={permissions}
                  onAdd={() => setShowAddSpecialDateModal(true)}
                  onItemClick={(special) => setShowSpecialDetailPopover(special)}
                />

                {/* RIGHT COLUMN: Reminders / To Do */}
                <RemindersCard 
                  trip={trip} 
                  permissions={permissions}
                  onAdd={() => setShowAddReminderModal(true)}
                  onItemClick={(reminder) => setShowReminderDetailPopover(reminder)}
                  onToggleComplete={(reminderId) => {
                    const reminders = trip?.reminders || [];
                    let updatedReminders = reminders?.map(r => 
                      r?.id === reminderId ? { 
                        ...r, 
                        completed: !r?.completed,
                        completedAt: !r?.completed ? new Date()?.toISOString() : null,
                        completedBy: !r?.completed ? getCurrentUser()?.id : null
                      } : r
                    );
                    const updatedTrip = { ...trip, reminders: updatedReminders };
                    updateTrip(trip?.id, updatedTrip);
                    loadTripData();
                    logTripActivity('REMINDER_COMPLETED', `Reminder "${reminders?.find(r => r?.id === reminderId)?.title}" marked as ${!reminders?.find(r => r?.id === reminderId)?.completed ? 'completed' : 'incomplete'}`);
                  }}
                />
              </div>
            </>
          )}

          {activeSection === 'guests' && (
            <GuestsSection
              trip={trip}
              guests={guests}
              permissions={permissions}
              onUpdate={loadTripData}
              navigate={navigate}
              setActiveSection={setActiveSection}
            />
          )}

          {activeSection === 'preferences' && (
            <PreferencesSection
              trip={trip}
              tripId={tripId}
              permissions={permissions}
              onUpdate={loadTripData}
              navigate={navigate}
            />
          )}

          {activeSection === 'reminders' && (
            <RemindersSection
              trip={trip}
              tripId={tripId}
              navigate={navigate}
              permissions={permissions}
              onUpdate={loadTripData}
              setActiveSection={setActiveSection}
            />
          )}

          {activeSection === 'charterDetails' && (
            <>
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-semibold text-foreground">Charter / Agent Details</h2>
                {permissions?.canEdit && (
                  <Button
                    onClick={() => document.getElementById('photo-upload-input')?.click()}
                    disabled={isUploadingPhoto}
                    className="flex items-center gap-2"
                  >
                    <Icon name="Upload" size={16} />
                    {isUploadingPhoto ? 'Uploading...' : 'Upload Photo'}
                  </Button>
                )}
              </div>
              <input
                id="photo-upload-input"
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e?.target?.files || []);
                  if (files?.length === 0) return;

                  setIsUploadingPhoto(true);
                  
                  // Simulate upload and create photo objects
                  const newPhotos = files?.map(file => ({
                    id: `photo-${Date.now()}-${Math.random()?.toString(36)?.substr(2, 9)}`,
                    url: URL.createObjectURL(file),
                    fileName: file?.name,
                    uploadedAt: new Date()?.toISOString(),
                    uploadedBy: currentUser?.name || 'Unknown',
                    size: file?.size
                  }));

                  const updatedPhotos = [...photos, ...newPhotos];
                  setPhotos(updatedPhotos);

                  // Update trip with new photos
                  const updated = {
                    ...trip,
                    photos: updatedPhotos
                  };
                  updateTrip(trip?.id, updated);
                  loadTripData();
                  
                  setIsUploadingPhoto(false);
                  showToast(`${files?.length} photo(s) uploaded successfully`, 'success');
                  
                  // Reset input
                  e.target.value = '';
                }}
              />
              
              {photos?.length > 0 ? (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {photos?.map(photo => (
                    <div key={photo?.id} className="relative group bg-card border border-border rounded-lg overflow-hidden hover:shadow-lg transition-smooth">
                      <div className="aspect-square">
                        <img
                          src={photo?.url}
                          alt={photo?.fileName}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-smooth flex flex-col items-center justify-center gap-2 p-3">
                        <p className="text-white text-xs font-medium text-center truncate w-full">{photo?.fileName}</p>
                        <p className="text-white/80 text-xs">By {photo?.uploadedBy}</p>
                        <p className="text-white/60 text-xs">{new Date(photo.uploadedAt)?.toLocaleDateString()}</p>
                        {permissions?.canEdit && (
                          <button
                            onClick={() => {
                              if (window.confirm('Delete this photo?')) {
                                const updatedPhotos = photos?.filter(p => p?.id !== photo?.id);
                                setPhotos(updatedPhotos);
                                const updated = {
                                  ...trip,
                                  photos: updatedPhotos
                                };
                                updateTrip(trip?.id, updated);
                                loadTripData();
                                showToast('Photo deleted', 'success');
                              }
                            }}
                            className="mt-2 px-3 py-1 bg-red-500 hover:bg-red-600 text-white text-xs rounded transition-smooth"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="bg-card border border-border rounded-xl p-12 text-center">
                  <Icon name="Camera" size={48} className="text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">No photos uploaded yet.</p>
                  {permissions?.canEdit && (
                    <Button
                      onClick={() => document.getElementById('photo-upload-input')?.click()}
                      className="flex items-center gap-2 mx-auto"
                    >
                      <Icon name="Upload" size={16} />
                      Upload First Photo
                    </Button>
                  )}
                </div>
              )}
            </>
          )}

          {activeSection === 'special' && (
            <>
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-semibold text-foreground">Special Occasions</h2>
                {permissions?.canEdit && (
                  <Button
                    onClick={() => setShowAddSpecialDateModal(true)}
                    className="flex items-center gap-2"
                  >
                    <Icon name="Plus" size={16} />
                    Add Special
                  </Button>
                )}
              </div>
              
              {trip?.specialDates?.length > 0 ? (
                <div className="space-y-3">
                  {trip?.specialDates?.sort((a, b) => new Date(a?.date) - new Date(b?.date))?.map(date => {
                    const guest = guests?.find(g => g?.id === date?.guestId);
                    return (
                      <div key={date?.id} className="bg-card border border-border rounded-xl p-4 flex items-start justify-between">
                        <div className="flex items-center gap-1.5 flex-1">
                          <Icon name="Calendar" size={20} className="text-primary mt-1" />
                          <div>
                            <p className="font-medium text-foreground">{date?.title}</p>
                            <p className="text-sm text-muted-foreground mt-1">
                              {new Date(date?.date)?.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} • {date?.type}
                              {guest && ` • ${guest?.firstName} ${guest?.lastName}`}
                            </p>
                            {date?.notes && (
                              <p className="text-sm text-muted-foreground italic mt-2">{date?.notes}</p>
                            )}
                          </div>
                        </div>
                        {permissions?.canEdit && (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => {
                                setEditingSpecialDate(date);
                                setShowAddSpecialDateModal(true);
                              }}
                              className="p-2 hover:bg-muted rounded-lg transition-smooth"
                            >
                              <Icon name="Edit" size={16} />
                            </button>
                            <button
                              onClick={() => {
                                if (window.confirm('Delete this special occasion?')) {
                                  const updated = {
                                    ...trip,
                                    specialDates: trip?.specialDates?.filter(s => s?.id !== date?.id)
                                  };
                                  updateTrip(trip?.id, updated);
                                  loadTripData();
                                  showToast('Special occasion deleted', 'success');
                                }
                              }}
                              className="p-2 hover:bg-red-50 text-red-600 rounded-lg transition-smooth"
                            >
                              <Icon name="Trash2" size={16} />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="bg-card border border-border rounded-xl p-12 text-center">
                  <Icon name="Calendar" size={48} className="text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">No special occasions added yet.</p>
                </div>
              )}
            </>
          )}

          {activeSection === 'charterDetails' && (
            <>
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-semibold text-foreground">Charter / Agent Details</h2>
                {permissions?.canEdit && (
                  <Button
                    onClick={() => document.getElementById('photo-upload-input')?.click()}
                    disabled={isUploadingPhoto}
                    className="flex items-center gap-2"
                  >
                    <Icon name="Upload" size={16} />
                    {isUploadingPhoto ? 'Uploading...' : 'Upload Photo'}
                  </Button>
                )}
              </div>
              <input
                id="photo-upload-input"
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e?.target?.files || []);
                  if (files?.length === 0) return;

                  setIsUploadingPhoto(true);
                  
                  // Simulate upload and create photo objects
                  const newPhotos = files?.map(file => ({
                    id: `photo-${Date.now()}-${Math.random()?.toString(36)?.substr(2, 9)}`,
                    url: URL.createObjectURL(file),
                    fileName: file?.name,
                    uploadedAt: new Date()?.toISOString(),
                    uploadedBy: currentUser?.name || 'Unknown',
                    size: file?.size
                  }));

                  const updatedPhotos = [...photos, ...newPhotos];
                  setPhotos(updatedPhotos);

                  // Update trip with new photos
                  const updated = {
                    ...trip,
                    photos: updatedPhotos
                  };
                  updateTrip(trip?.id, updated);
                  loadTripData();
                  
                  setIsUploadingPhoto(false);
                  showToast(`${files?.length} photo(s) uploaded successfully`, 'success');
                  
                  // Reset input
                  e.target.value = '';
                }}
              />
              
              {photos?.length > 0 ? (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {photos?.map(photo => (
                    <div key={photo?.id} className="relative group bg-card border border-border rounded-lg overflow-hidden hover:shadow-lg transition-smooth">
                      <div className="aspect-square">
                        <img
                          src={photo?.url}
                          alt={photo?.fileName}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-smooth flex flex-col items-center justify-center gap-2 p-3">
                        <p className="text-white text-xs font-medium text-center truncate w-full">{photo?.fileName}</p>
                        <p className="text-white/80 text-xs">By {photo?.uploadedBy}</p>
                        <p className="text-white/60 text-xs">{new Date(photo.uploadedAt)?.toLocaleDateString()}</p>
                        {permissions?.canEdit && (
                          <button
                            onClick={() => {
                              if (window.confirm('Delete this photo?')) {
                                const updatedPhotos = photos?.filter(p => p?.id !== photo?.id);
                                setPhotos(updatedPhotos);
                                const updated = {
                                  ...trip,
                                  photos: updatedPhotos
                                };
                                updateTrip(trip?.id, updated);
                                loadTripData();
                                showToast('Photo deleted', 'success');
                              }
                            }}
                            className="mt-2 px-3 py-1 bg-red-500 hover:bg-red-600 text-white text-xs rounded transition-smooth"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="bg-card border border-border rounded-xl p-12 text-center">
                  <Icon name="Camera" size={48} className="text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">No photos uploaded yet.</p>
                  {permissions?.canEdit && (
                    <Button
                      onClick={() => document.getElementById('photo-upload-input')?.click()}
                      className="flex items-center gap-2 mx-auto"
                    >
                      <Icon name="Upload" size={16} />
                      Upload First Photo
                    </Button>
                  )}
                </div>
              )}
            </>
          )}

          {activeSection === 'activity' && (
            <>
              <h2 className="text-2xl font-semibold text-foreground mb-6">Trip Activity Log</h2>
              {sortedActivity?.length > 0 ? (
                <div className="space-y-3">
                  {sortedActivity?.map(entry => (
                    <div key={entry?.id} className="bg-card border border-border rounded-xl p-4">
                      <div className="flex items-start gap-3">
                        <Icon name="Activity" size={18} className="text-primary mt-1" />
                        <div className="flex-1">
                          <p className="text-sm text-foreground">{entry?.message}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {entry?.actorName} • {new Date(entry?.at)?.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="bg-card border border-border rounded-xl p-12 text-center">
                  <Icon name="Activity" size={48} className="text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">No activity recorded yet.</p>
                </div>
              )}
            </>
          )}
          </div>
        </div>
      </main>
      {/* Modals */}
      {showEditModal && (
        <AddTripModal
          isOpen={showEditModal}
          onClose={() => setShowEditModal(false)}
          onSave={() => {
            setShowEditModal(false);
            loadTripData();
          }}
          editingTrip={trip}
          guests={guests}
        />
      )}
      {showCompleteModal && (
        <CompleteTripModal
          isOpen={showCompleteModal}
          onClose={() => setShowCompleteModal(false)}
          trip={trip}
          tripId={tripId}
          onComplete={() => {
            setShowCompleteModal(false);
            loadTripData();
          }}
        />
      )}
      {showAddItineraryModal && (
        <AddItineraryDayModal
          isOpen={showAddItineraryModal}
          onClose={() => {
            setShowAddItineraryModal(false);
            setEditingItineraryDay(null);
          }}
          trip={trip}
          tripId={tripId}
          editingDay={editingItineraryDay}
          onSave={() => {
            setShowAddItineraryModal(false);
            setEditingItineraryDay(null);
            loadTripData();
          }}
        />
      )}
      {showAddSpecialDateModal && (
        <AddSpecialDateModal
          isOpen={showAddSpecialDateModal}
          onClose={() => {
            setShowAddSpecialDateModal(false);
            setEditingSpecialDate(null);
          }}
          trip={trip}
          tripId={tripId}
          guests={guests}
          editingDate={editingSpecialDate}
          onSave={() => {
            setShowAddSpecialDateModal(false);
            setEditingSpecialDate(null);
            loadTripData();
          }}
        />
      )}
      {showAddSpecialRequestModal && (
        <AddSpecialRequestModal
          isOpen={showAddSpecialRequestModal}
          onClose={() => {
            setShowAddSpecialRequestModal(false);
            setEditingSpecialRequest(null);
          }}
          trip={trip}
          tripId={tripId}
          guests={guests}
          editingRequest={editingSpecialRequest}
          onSave={() => {
            setShowAddSpecialRequestModal(false);
            setEditingSpecialRequest(null);
            loadTripData();
          }}
        />
      )}
      {showEditCharterModal && (
        <EditCharterDetailsModal
          isOpen={showEditCharterModal}
          onClose={() => setShowEditCharterModal(false)}
          trip={trip}
          tripId={tripId}
          onSave={() => {
            setShowEditCharterModal(false);
            loadTripData();
          }}
        />
      )}
      {/* Trip Laundry Drawer */}
      {showLaundryDrawer && (
        <TripLaundryDrawer
          isOpen={showLaundryDrawer}
          onClose={() => setShowLaundryDrawer(false)}
          trip={trip}
        />
      )}
      {/* Add Special Modal */}
      {showAddSpecialModal && (
        <AddSpecialModal
          isOpen={showAddSpecialModal}
          onClose={() => {
            setShowAddSpecialModal(false);
            setEditingSpecial(null);
          }}
          trip={trip}
          guests={guests}
          editingSpecial={editingSpecial}
          onSave={() => {
            setShowAddSpecialModal(false);
            setEditingSpecial(null);
            loadTripData();
          }}
          onLogActivity={logTripActivity}
        />
      )}
      {/* Add Reminder Modal */}
      {showAddReminderModal && (
        <AddReminderModal
          isOpen={showAddReminderModal}
          onClose={() => {
            setShowAddReminderModal(false);
            setEditingReminder(null);
          }}
          trip={trip}
          editingReminder={editingReminder}
          onSave={() => {
            setShowAddReminderModal(false);
            setEditingReminder(null);
            loadTripData();
          }}
        />
      )}
      {/* Event Detail Popover */}
      {showEventDetailPopover && (
        <EventDetailPopover
          event={showEventDetailPopover}
          onClose={() => setShowEventDetailPopover(null)}
        />
      )}
      {/* Special Detail Popover */}
      {showSpecialDetailPopover && (
        <SpecialDetailPopover
          special={showSpecialDetailPopover}
          guests={guests}
          permissions={permissions}
          onClose={() => setShowSpecialDetailPopover(null)}
          onEdit={() => {
            setEditingSpecial(showSpecialDetailPopover);
            setShowSpecialDetailPopover(null);
            setShowAddSpecialModal(true);
          }}
          onDelete={(specialId) => {
            if (window.confirm('Delete this special occasion?')) {
              const updated = {
                ...trip,
                specialDates: trip?.specialDates?.filter(s => s?.id !== specialId)
              };
              updateTrip(trip?.id, updated);
              loadTripData();
              showToast('Special occasion deleted', 'success');
              logTripActivity('SPECIAL_DELETED', `Special occasion "${showSpecialDetailPopover?.title}" deleted`);
              setShowSpecialDetailPopover(null);
            }
          }}
        />
      )}
      {/* Reminder Detail Popover */}
      {showReminderDetailPopover && (
        <ReminderDetailPopover
          reminder={showReminderDetailPopover}
          guests={guests}
          permissions={permissions}
          onClose={() => setShowReminderDetailPopover(null)}
          onEdit={() => {
            setEditingReminder(showReminderDetailPopover);
            setShowReminderDetailPopover(null);
            setShowAddReminderModal(true);
          }}
          onDelete={(reminderId) => {
            if (window.confirm('Delete this reminder?')) {
              const updated = {
                ...trip,
                reminders: trip?.reminders?.filter(r => r?.id !== reminderId)
              };
              updateTrip(trip?.id, updated);
              loadTripData();
              logTripActivity('REMINDER_DELETED', `Reminder "${showReminderDetailPopover?.title}" deleted`);
              showToast('Reminder deleted', 'success');
              setShowReminderDetailPopover(null);
            }
          }}
        />
      )}
    </div>
  );
};

// Today's Overview Section - COMPACT
const TodayOverviewSection = ({ trip, guests, selectedDate, onEventClick, onSpecialClick }) => {
  const targetDate = new Date(selectedDate);
  targetDate?.setHours(0, 0, 0, 0);
  
  const today = new Date();
  today?.setHours(0, 0, 0, 0);
  const isToday = targetDate?.getTime() === today?.getTime();
  
  const dateLabel = isToday ? "Today's Overview" : `Schedule for ${targetDate?.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`;

  // Find itinerary for selected date
  const dayItinerary = trip?.itineraryDays?.find(day => {
    const dayDate = new Date(day?.date);
    dayDate?.setHours(0, 0, 0, 0);
    return dayDate?.getTime() === targetDate?.getTime();
  });

  // Find special dates for selected date
  const daySpecialDates = trip?.specialDates?.filter(d => {
    const date = new Date(d?.date);
    date?.setHours(0, 0, 0, 0);
    return date?.getTime() === targetDate?.getTime();
  });

  const hasContent = dayItinerary || daySpecialDates?.length > 0;

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <h2 className="text-base font-semibold text-foreground mb-2">{dateLabel}</h2>
      {dayItinerary?.locationTitle && (
        <p className="text-xs text-muted-foreground mb-3">{dayItinerary?.locationTitle}</p>
      )}
      {!hasContent ? (
        <p className="text-xs text-muted-foreground">No scheduled items for this date.</p>
      ) : (
        <div className="space-y-2 max-h-32 overflow-y-auto">
          {/* Key Events - CLICKABLE */}
          {dayItinerary?.keyEvents?.slice(0, 4)?.map((event, idx) => {
            const timeMatch = event?.match(/^(\d{1,2}:\d{2})/);
            const time = timeMatch ? timeMatch?.[1] : null;
            const label = time ? event?.replace(time, '')?.trim()?.replace(/^-\s*/, '') : event;
            
            return (
              <button
                key={idx}
                onClick={() => onEventClick({ event, time, location: dayItinerary?.locationTitle, date: dayItinerary?.date, notes: dayItinerary?.notes })}
                className="flex items-start gap-2 w-full text-left hover:bg-muted/50 p-1 rounded transition-smooth"
              >
                {time && (
                  <span className="text-xs font-medium text-muted-foreground min-w-[45px]">{time}</span>
                )}
                <p className="text-xs text-foreground line-clamp-1">{label}</p>
              </button>
            );
          })}

          {/* Special Occasions - CLICKABLE */}
          {daySpecialDates?.map(date => {
            const guest = guests?.find(g => g?.id === date?.guestId);
            return (
              <button
                key={date?.id}
                onClick={() => onSpecialClick(date)}
                className="flex items-center gap-1.5 p-1.5 bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100 transition-smooth w-full text-left"
              >
                <Icon name="Star" size={12} className="text-purple-600" />
                <p className="text-xs font-medium text-foreground line-clamp-1">{date?.title}</p>
                {guest && (
                  <span className="text-xs text-muted-foreground">• {guest?.firstName}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
      {dayItinerary && (
        <button
          onClick={() => {}} 
          className="text-xs text-primary hover:underline mt-2"
        >
          View all
        </button>
      )}
    </div>
  );
};

// Tomorrow Snapshot Section - COMPACT
const TomorrowSnapshotSection = ({ trip, guests, selectedDate, onEventClick, onSpecialClick }) => {
  const tomorrow = new Date(selectedDate);
  tomorrow?.setDate(tomorrow?.getDate() + 1);
  tomorrow?.setHours(0, 0, 0, 0);
  
  const dateLabel = `${tomorrow?.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} Snapshot`;

  // Find itinerary for tomorrow
  const tomorrowItinerary = trip?.itineraryDays?.find(day => {
    const dayDate = new Date(day?.date);
    dayDate?.setHours(0, 0, 0, 0);
    return dayDate?.getTime() === tomorrow?.getTime();
  });

  // Find special dates for tomorrow
  const tomorrowSpecialDates = trip?.specialDates?.filter(d => {
    const date = new Date(d?.date);
    date?.setHours(0, 0, 0, 0);
    return date?.getTime() === tomorrow?.getTime();
  });

  const hasContent = tomorrowItinerary || tomorrowSpecialDates?.length > 0;

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <h2 className="text-base font-semibold text-foreground mb-2">{dateLabel}</h2>
      {!hasContent ? (
        <p className="text-xs text-muted-foreground">No scheduled items.</p>
      ) : (
        <div className="space-y-2 max-h-32 overflow-y-auto">
          {/* Key Events - CLICKABLE */}
          {tomorrowItinerary?.keyEvents?.slice(0, 4)?.map((event, idx) => {
            const timeMatch = event?.match(/^(\d{1,2}:\d{2})/);
            const time = timeMatch ? timeMatch?.[1] : null;
            const label = time ? event?.replace(time, '')?.trim()?.replace(/^-\s*/, '') : event;
            
            return (
              <button
                key={idx}
                onClick={() => onEventClick({ event, time, location: tomorrowItinerary?.locationTitle, date: tomorrowItinerary?.date, notes: tomorrowItinerary?.notes })}
                className="flex items-start gap-2 w-full text-left hover:bg-muted/50 p-1 rounded transition-smooth"
              >
                {time && (
                  <span className="text-xs font-medium text-muted-foreground min-w-[45px]">{time}</span>
                )}
                <p className="text-xs text-foreground line-clamp-1">{label}</p>
              </button>
            );
          })}

          {/* Special Occasions - CLICKABLE */}
          {tomorrowSpecialDates?.map(date => {
            const guest = guests?.find(g => g?.id === date?.guestId);
            return (
              <button
                key={date?.id}
                onClick={() => onSpecialClick(date)}
                className="flex items-center gap-1.5 p-1.5 bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100 transition-smooth w-full text-left"
              >
                <Icon name="Star" size={12} className="text-purple-600" />
                <p className="text-xs font-medium text-foreground line-clamp-1">{date?.title}</p>
                {guest && (
                  <span className="text-xs text-muted-foreground">• {guest?.firstName}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

// Special Occasions Card (compact)
const SpecialOccasionsCard = ({ trip, guests, permissions, onAdd, onItemClick }) => {
  const today = new Date();
  today?.setHours(0, 0, 0, 0);
  const sevenDaysLater = new Date(today);
  sevenDaysLater?.setDate(today?.getDate() + 7);

  const upcomingDates = trip?.specialDates?.filter(d => {
    const date = new Date(d?.date);
    return date >= today && date <= sevenDaysLater;
  })?.sort((a, b) => new Date(a?.date) - new Date(b?.date))?.slice(0, 3);

  return (
    <div className="bg-card border border-border rounded-xl p-4 h-full">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-base font-semibold text-foreground">Special</h3>
        {permissions?.canEdit && (
          <button onClick={onAdd} className="text-xs text-primary hover:underline">Add</button>
        )}
      </div>
      {upcomingDates?.length > 0 ? (
        <div className="space-y-1.5 max-h-32 overflow-y-auto">
          {upcomingDates?.map(date => {
            const guest = guests?.find(g => g?.id === date?.guestId);
            return (
              <button
                key={date?.id}
                onClick={() => onItemClick(date)}
                className="flex items-center gap-1.5 p-1.5 bg-muted/30 rounded-lg hover:bg-muted transition-smooth w-full text-left"
              >
                <Icon name="Calendar" size={12} className="text-primary" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground line-clamp-1">{date?.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(date?.date)?.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    {guest && ` • ${guest?.firstName}`}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No upcoming occasions.</p>
      )}
    </div>
  );
};
// Reminders Card - COMPACT
const RemindersCard = ({ trip, permissions, onAdd, onItemClick, onToggleComplete }) => {
  const reminders = trip?.reminders || [];
  const upcomingReminders = reminders?.filter(r => !r?.completed)?.slice(0, 3);

  return (
    <div className="bg-card border border-border rounded-xl p-4 h-full">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-base font-semibold text-foreground">Reminders / To Do</h3>
        {permissions?.canEdit && (
          <button onClick={onAdd} className="text-xs text-primary hover:underline">Add</button>
        )}
      </div>
      {upcomingReminders?.length > 0 ? (
        <div className="space-y-1.5 max-h-32 overflow-y-auto">
          {upcomingReminders?.map(reminder => (
            <div key={reminder?.id} className={`flex items-start gap-1.5 p-1.5 bg-muted/30 rounded-lg ${
              reminder?.completed ? 'opacity-60' : ''
            }`}>
              <input
                type="checkbox"
                checked={reminder?.completed}
                onChange={() => onToggleComplete(reminder?.id)}
                disabled={!permissions?.canEdit}
                className="mt-1 cursor-pointer"
              />
              <div className="flex-1 min-w-0">
                <p className={`text-xs text-foreground line-clamp-1 ${
                  reminder?.completed ? 'line-through' : ''
                }`}>{reminder?.title}</p>
                {reminder?.dueDate && (
                  <p className="text-xs text-muted-foreground">
                    Due: {new Date(reminder?.dueDate)?.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </p>
                )}
                {reminder?.notes && (
                  <p className="text-xs text-muted-foreground mt-2 italic">{reminder?.notes}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No reminders yet. {permissions?.canEdit && <button onClick={onAdd} className="text-primary hover:underline">Add reminder</button>}</p>
      )}
    </div>
  );
};

// Itinerary Section
const ItinerarySection = ({ trip, tripId, navigate, permissions, onAddDay, onEditDay, onDeleteDay }) => {
  const sortedDays = trip?.itineraryDays?.sort((a, b) => new Date(a?.date) - new Date(b?.date));

  return (
    <div>
      <button
        onClick={() => navigate(`/trips/${tripId}?tab=overview`)}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-smooth mb-4"
      >
        <Icon name="ArrowLeft" size={16} />
        Back to overview
      </button>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-semibold text-foreground">Itinerary</h2>
        {permissions?.canEdit && (
          <Button onClick={onAddDay} className="flex items-center gap-2">
            <Icon name="Plus" size={16} />
            Add Day
          </Button>
        )}
      </div>
      {sortedDays?.length > 0 ? (
        <div className="space-y-4">
          {sortedDays?.map(day => (
            <div key={day?.id} className="bg-card border border-border rounded-xl p-6">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="text-sm text-muted-foreground">
                    {new Date(day?.date)?.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                  </p>
                  <h3 className="text-lg font-semibold text-foreground mt-1">{day?.locationTitle}</h3>
                </div>
                {permissions?.canEdit && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onEditDay(day)}
                      className="p-2 hover:bg-muted rounded-lg transition-smooth"
                    >
                      <Icon name="Edit" size={16} />
                    </button>
                    <button
                      onClick={() => onDeleteDay(day?.id)}
                      className="p-2 hover:bg-red-50 text-red-600 rounded-lg transition-smooth"
                    >
                      <Icon name="Trash2" size={16} />
                    </button>
                  </div>
                )}
              </div>

              {day?.keyEvents?.length > 0 && (
                <div className="mb-3">
                  <p className="text-xs font-medium text-muted-foreground mb-2">Key Events:</p>
                  <ul className="space-y-1">
                    {day?.keyEvents?.map((event, idx) => (
                      <li key={idx} className="text-sm text-foreground flex items-start gap-2">
                        <span className="text-muted-foreground mt-1">•</span>
                        {event}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {day?.guestMovements?.length > 0 && (
                <div className="mb-3">
                  <p className="text-xs font-medium text-muted-foreground mb-2">Guest Movements:</p>
                  <ul className="space-y-1">
                    {day?.guestMovements?.map((movement, idx) => (
                      <li key={idx} className="text-sm text-foreground">{movement}</li>
                    ))}
                  </ul>
                </div>
              )}

              {day?.notes && (
                <p className="text-sm text-muted-foreground italic">{day?.notes}</p>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl p-12 text-center">
          <Icon name="Map" size={48} className="text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">No itinerary days added yet.</p>
        </div>
      )}
    </div>
  );
};

// Special Section (Requests + Occasions)
const SpecialSection = ({ trip, tripId, navigate, guests, permissions, onAddDate, onEditDate, onDeleteDate, onAddRequest, onEditRequest, onDeleteRequest }) => {
  const sortedDates = trip?.specialDates?.sort((a, b) => new Date(a?.date) - new Date(b?.date));
  const sortedRequests = trip?.specialRequests?.sort((a, b) => {
    const statusOrder = { 'Planned': 1, 'In progress': 2, 'Done': 3 };
    return statusOrder?.[a?.status] - statusOrder?.[b?.status];
  });

  return (
    <div className="space-y-8">
      <button
        onClick={() => navigate(`/trips/${tripId}?tab=overview`)}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-smooth mb-4"
      >
        <Icon name="ArrowLeft" size={16} />
        Back to overview
      </button>
      {/* Occasions */}
      <div>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-semibold text-foreground">Occasions</h2>
          {permissions?.canEdit && (
            <Button onClick={onAddDate} className="flex items-center gap-2">
              <Icon name="Plus" size={16} />
              Add Occasion
            </Button>
          )}
        </div>

        {sortedDates?.length > 0 ? (
          <div className="space-y-3">
            {sortedDates?.map(date => {
              const guest = guests?.find(g => g?.id === date?.guestId);
              return (
                <div key={date?.id} className="bg-card border border-border rounded-xl p-4 flex items-start justify-between">
                  <div className="flex items-center gap-1.5 flex-1">
                    <Icon name="Calendar" size={20} className="text-primary mt-1" />
                    <div>
                      <p className="font-medium text-foreground">{date?.title}</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        {new Date(date?.date)?.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} • {date?.type}
                        {guest && ` • ${guest?.firstName} ${guest?.lastName}`}
                      </p>
                      {date?.notes && (
                        <p className="text-sm text-muted-foreground italic mt-2">{date?.notes}</p>
                      )}
                    </div>
                  </div>
                  {permissions?.canEdit && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => onEditDate(date)}
                        className="p-2 hover:bg-muted rounded-lg transition-smooth"
                      >
                        <Icon name="Edit" size={16} />
                      </button>
                      <button
                        onClick={() => onDeleteDate(date?.id)}
                        className="p-2 hover:bg-red-50 text-red-600 rounded-lg transition-smooth"
                      >
                        <Icon name="Trash2" size={16} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="bg-card border border-border rounded-xl p-12 text-center">
            <Icon name="Calendar" size={48} className="text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">No special occasions added yet.</p>
          </div>
        )}
      </div>
      {/* Requests */}
      <div>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-semibold text-foreground">Requests</h2>
          {permissions?.canEdit && (
            <Button onClick={onAddRequest} className="flex items-center gap-2">
              <Icon name="Plus" size={16} />
              Add Request
            </Button>
          )}
        </div>

        {sortedRequests?.length > 0 ? (
          <div className="space-y-3">
            {sortedRequests?.map(request => {
              const guest = guests?.find(g => g?.id === request?.guestId);
              const statusColor = 
                request?.status === 'Done' ? 'bg-green-100 text-green-800' :
                request?.status === 'In progress' ? 'bg-yellow-100 text-yellow-800' : 'bg-blue-100 text-blue-800';
              return (
                <div key={request?.id} className="bg-card border border-border rounded-xl p-4 flex items-start justify-between">
                  <div className="flex items-start gap-1.5 flex-1">
                    <Icon name="AlertCircle" size={20} className="text-primary mt-1" />
                    <div className="flex-1">
                      <p className="font-medium text-foreground">{request?.title}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColor}`}>
                          {request?.status}
                        </span>
                        {request?.dueDate && (
                          <span className="text-xs text-muted-foreground">
                            Due: {new Date(request?.dueDate)?.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          </span>
                        )}
                        {guest && (
                          <span className="text-xs text-muted-foreground">
                            • {guest?.firstName} {guest?.lastName}
                          </span>
                        )}
                      </div>
                      {request?.notes && (
                        <p className="text-sm text-muted-foreground mt-2">{request?.notes}</p>
                      )}
                    </div>
                  </div>
                  {permissions?.canEdit && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => onEditRequest(request)}
                        className="p-2 hover:bg-muted rounded-lg transition-smooth"
                      >
                        <Icon name="Edit" size={16} />
                      </button>
                      <button
                        onClick={() => onDeleteRequest(request?.id)}
                        className="p-2 hover:bg-red-50 text-red-600 rounded-lg transition-smooth"
                      >
                        <Icon name="Trash2" size={16} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="bg-card border border-border rounded-xl p-12 text-center">
            <Icon name="AlertCircle" size={48} className="text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">No special requests added yet.</p>
          </div>
        )}
      </div>
    </div>
  );
};

// Charter Section
const CharterSection = ({ trip, tripId, navigate, permissions, onEdit }) => {
  const broker = trip?.brokerDetails;

  return (
    <div>
      <button
        onClick={() => navigate(`/trips/${tripId}?tab=overview`)}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-smooth mb-4"
      >
        <Icon name="ArrowLeft" size={16} />
        Back to overview
      </button>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-semibold text-foreground">Charter / Agent Details</h2>
        {permissions?.canEdit && (
          <Button onClick={onEdit} className="flex items-center gap-2">
            <Icon name="Edit" size={16} />
            Edit Details
          </Button>
        )}
      </div>

      <div className="bg-card border border-border rounded-xl p-6 space-y-6">
        {/* Broker Details */}
        <div>
          <h3 className="text-lg font-semibold text-foreground mb-3">Broker / Agency</h3>
          <div className="space-y-2">
            <div>
              <p className="text-xs text-muted-foreground">Agency Name</p>
              <p className="text-sm text-foreground">{broker?.agencyName || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Broker Name</p>
              <p className="text-sm text-foreground">{broker?.brokerName || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Email</p>
              <p className="text-sm text-foreground">{broker?.email || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Phone</p>
              <p className="text-sm text-foreground">{broker?.phone || '—'}</p>
            </div>
          </div>
        </div>

        {/* Central Agent */}
        <div>
          <h3 className="text-lg font-semibold text-foreground mb-3">Central Agent</h3>
          <div className="space-y-2">
            <div>
              <p className="text-xs text-muted-foreground">Name</p>
              <p className="text-sm text-foreground">{broker?.centralAgentName || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Email</p>
              <p className="text-sm text-foreground">{broker?.centralAgentEmail || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Phone</p>
              <p className="text-sm text-foreground">{broker?.centralAgentPhone || '—'}</p>
            </div>
          </div>
        </div>

        {/* Notes */}
        {broker?.notes && (
          <div>
            <h3 className="text-lg font-semibold text-foreground mb-3">Notes</h3>
            <p className="text-sm text-muted-foreground">{broker?.notes}</p>
          </div>
        )}

        {/* Documents */}
        <div>
          <h3 className="text-lg font-semibold text-foreground mb-3">Documents</h3>
          <p className="text-sm text-muted-foreground">Document upload placeholder (to be implemented)</p>
        </div>
      </div>
    </div>
  );
};

// Activity Section
const ActivitySection = ({ trip, tripId, navigate, currentUser }) => {
  const sortedActivity = trip?.tripActivityLog?.sort((a, b) => new Date(b?.at) - new Date(a?.at));

  return (
    <div>
      <button
        onClick={() => navigate(`/trips/${tripId}?tab=overview`)}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-smooth mb-4"
      >
        <Icon name="ArrowLeft" size={16} />
        Back to overview
      </button>
      <h2 className="text-2xl font-semibold text-foreground mb-6">Trip Activity Log</h2>
      {sortedActivity?.length > 0 ? (
        <div className="space-y-3">
          {sortedActivity?.map(entry => (
            <div key={entry?.id} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-start gap-3">
                <Icon name="Activity" size={18} className="text-primary mt-1" />
                <div className="flex-1">
                  <p className="text-sm text-foreground">{entry?.message}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {entry?.actorName} • {new Date(entry?.at)?.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl p-12 text-center">
          <Icon name="Activity" size={48} className="text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">No activity recorded yet.</p>
        </div>
      )}
    </div>
  );
};

// Trip Calendar Section - FIXED HEIGHT, HORIZONTAL SCROLL ONLY
const TripCalendarSection = ({ trip, selectedDate, onSelectDate, fullView = false }) => {
  const [currentMonth, setCurrentMonth] = useState(new Date(selectedDate));

  const tripStart = new Date(trip?.startDate);
  const tripEnd = new Date(trip?.endDate);

  // Get days in current month view
  const getDaysInMonth = () => {
    const year = currentMonth?.getFullYear();
    const month = currentMonth?.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay?.getDate();
    const startingDayOfWeek = firstDay?.getDay();

    const days = [];
    // Add empty cells for days before month starts
    for (let i = 0; i < startingDayOfWeek; i++) {
      days?.push(null);
    }
    // Add days of month
    for (let day = 1; day <= daysInMonth; day++) {
      days?.push(new Date(year, month, day));
    }
    return days;
  };

  const days = getDaysInMonth();
  const today = new Date();
  today?.setHours(0, 0, 0, 0);

  const isDateInTrip = (date) => {
    if (!date) return false;
    const checkDate = new Date(date);
    checkDate?.setHours(0, 0, 0, 0);
    return checkDate >= tripStart && checkDate <= tripEnd;
  };

  const hasGuestMovement = (date) => {
    if (!date) return false;
    const checkDate = new Date(date);
    checkDate?.setHours(0, 0, 0, 0);
    return trip?.itineraryDays?.some(day => {
      const dayDate = new Date(day?.date);
      dayDate?.setHours(0, 0, 0, 0);
      return dayDate?.getTime() === checkDate?.getTime() && day?.guestMovements?.length > 0;
    });
  };

  const hasSpecialDate = (date) => {
    if (!date) return false;
    const checkDate = new Date(date);
    checkDate?.setHours(0, 0, 0, 0);
    return trip?.specialDates?.some(d => {
      const specialDate = new Date(d?.date);
      specialDate?.setHours(0, 0, 0, 0);
      return specialDate?.getTime() === checkDate?.getTime();
    });
  };

  const isSelected = (date) => {
    if (!date) return false;
    const checkDate = new Date(date);
    checkDate?.setHours(0, 0, 0, 0);
    const selected = new Date(selectedDate);
    selected?.setHours(0, 0, 0, 0);
    return checkDate?.getTime() === selected?.getTime();
  };

  const isToday = (date) => {
    if (!date) return false;
    const checkDate = new Date(date);
    checkDate?.setHours(0, 0, 0, 0);
    return checkDate?.getTime() === today?.getTime();
  };

  const goToPreviousMonth = () => {
    setCurrentMonth(new Date(currentMonth?.getFullYear(), currentMonth?.getMonth() - 1, 1));
  };

  const goToNextMonth = () => {
    setCurrentMonth(new Date(currentMonth?.getFullYear(), currentMonth?.getMonth() + 1, 1));
  };

  // Compact calendar strip view (for Overview) - FULL WIDTH, MAX 10 VISIBLE, FIXED HEIGHT
  if (!fullView) {
    // Generate all trip days from start to end
    const allTripDays = [];
    let currentDate = new Date(tripStart);
    const endDate = new Date(tripEnd);
    
    while (currentDate <= endDate) {
      allTripDays?.push(new Date(currentDate));
      currentDate?.setDate(currentDate?.getDate() + 1);
    }

    const tripLength = allTripDays?.length;
    const maxVisible = 10;
    const needsScroll = tripLength > maxVisible;

    return (
      <div className="bg-card border border-border rounded-xl p-3">
        <div 
          className="flex items-center gap-2 overflow-x-auto overflow-y-hidden"
          style={{
            maxHeight: '90px',
            scrollbarWidth: 'thin',
            scrollbarColor: 'rgba(0,0,0,0.2) transparent',
            WebkitOverflowScrolling: 'touch'
          }}
        >
          {allTripDays?.map((date, idx) => {
            const selected = isSelected(date);
            const todayDate = isToday(date);
            const guestMovement = hasGuestMovement(date);
            const specialDate = hasSpecialDate(date);

            return (
              <button
                key={idx}
                onClick={() => onSelectDate(date)}
                className={`flex-shrink-0 flex flex-col items-center justify-center rounded-lg transition-smooth w-20 h-20 ${
                  selected ? 'bg-primary text-primary-foreground font-semibold' :
                  todayDate ? 'bg-blue-100 text-blue-900 font-semibold border-2 border-blue-500': 'hover:bg-muted text-foreground border border-border'
                }`}
              >
                <span className="text-xs">{date?.toLocaleDateString('en-US', { weekday: 'short' })}</span>
                <span className="text-base font-semibold">{date?.getDate()}</span>
                <span className="text-xs opacity-70">{date?.toLocaleDateString('en-US', { month: 'short' })}</span>
                {(guestMovement || specialDate) && (
                  <div className="flex gap-0.5 mt-0.5">
                    {guestMovement && (
                      <div className="w-1.5 h-1.5 rounded-full bg-green-500" title="Guest movement" />
                    )}
                    {specialDate && (
                      <div className="w-1.5 h-1.5 rounded-full bg-purple-500" title="Special occasion" />
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>
        {needsScroll && (
          <p className="text-xs text-muted-foreground text-center mt-2">
            Scroll to view all {tripLength} days
          </p>
        )}
      </div>
    );
  }

  // Full calendar view
  return (
    <div className="bg-card border border-border rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={goToPreviousMonth}
          className="p-2 hover:bg-muted rounded-lg transition-smooth"
        >
          <Icon name="ChevronLeft" size={18} />
        </button>
        <span className="text-sm font-medium text-foreground min-w-[140px] text-center">
          {currentMonth?.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </span>
        <button
          onClick={goToNextMonth}
          className="p-2 hover:bg-muted rounded-lg transition-smooth"
        >
          <Icon name="ChevronRight" size={18} />
        </button>
      </div>
      {/* Calendar Grid */}
      <div className="grid grid-cols-7 gap-1">
        {/* Day headers */}
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']?.map(day => (
          <div key={day} className="text-center text-xs font-medium text-muted-foreground py-2">
            {day}
          </div>
        ))}

        {/* Calendar days */}
        {days?.map((date, idx) => {
          if (!date) {
            return <div key={`empty-${idx}`} className="aspect-square" />;
          }

          const inTrip = isDateInTrip(date);
          const selected = isSelected(date);
          const todayDate = isToday(date);
          const guestMovement = hasGuestMovement(date);
          const specialDate = hasSpecialDate(date);

          return (
            <button
              key={idx}
              onClick={() => inTrip && onSelectDate(date)}
              disabled={!inTrip}
              className={`aspect-square p-1 rounded-lg text-sm transition-smooth relative ${
                !inTrip ? 'text-muted-foreground/30 cursor-not-allowed' :
                selected ? 'bg-primary text-primary-foreground font-semibold': todayDate ?'bg-blue-100 text-blue-900 font-semibold border-2 border-blue-500': 'hover:bg-muted text-foreground'
              }`}
            >
              <div className="flex flex-col items-center justify-center h-full">
                <span>{date?.getDate()}</span>
                {inTrip && (guestMovement || specialDate) && (
                  <div className="flex gap-0.5 mt-0.5">
                    {guestMovement && (
                      <div className="w-1 h-1 rounded-full bg-green-500" title="Guest movement" />
                    )}
                    {specialDate && (
                      <div className="w-1 h-1 rounded-full bg-purple-500" title="Special occasion" />
                    )}
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

// Guests Section Component
const GuestsSection = ({ trip, guests, permissions, onUpdate, navigate, setActiveSection }) => {
  const [showAddGuestModal, setShowAddGuestModal] = useState(false);
  const currentUser = getCurrentUser();
  
  const tripGuests = trip?.guests || [];
  // Filter for active guests only
  const activeGuests = tripGuests?.filter(tg => tg?.isActive);
  const guestDetails = activeGuests?.map(tg => {
    const guest = guests?.find(g => g?.id === tg?.guestId);
    return { ...guest, ...tg };
  })?.filter(g => g?.id); // Filter out any undefined guests

  const handleSelectExistingGuest = (guest) => {
    // Add existing guest to trip's guests array
    const updatedGuests = [
      ...(trip?.guests || []),
      {
        guestId: guest?.id,
        isActive: true,
        activatedAt: new Date()?.toISOString(),
        activatedByUserId: currentUser?.id
      }
    ];
    
    // Update trip
    const success = updateTrip(trip?.id, { guests: updatedGuests });
    if (success) {
      // Also update the guest's isActiveOnTrip flag
      updateGuest(guest?.id, { isActiveOnTrip: true });
      showToast('Guest added to trip', 'success');
      loadTripData();
      loadGuestsData();
      setShowAddGuestModal(false);
    } else {
      showToast('Failed to add guest to trip', 'error');
    }
  };

  const handleCreateNewGuest = (guestData) => {
    // Create guest with isActiveOnTrip set to true
    const newGuest = createGuest({ ...guestData, isActiveOnTrip: true });
    if (newGuest) {
      // Add guest to trip's guests array
      const updatedGuests = [
        ...(trip?.guests || []),
        {
          guestId: newGuest?.id,
          isActive: true,
          activatedAt: new Date()?.toISOString(),
          activatedByUserId: currentUser?.id
        }
      ];
      
      // Update trip
      const success = updateTrip(trip?.id, { guests: updatedGuests });
      if (success) {
        showToast('Guest created and added to trip', 'success');
        onUpdate();
        setShowAddGuestModal(false);
      } else {
        showToast('Failed to add guest to trip', 'error');
      }
    } else {
      showToast('Failed to create guest', 'error');
    }
  };
  
  // Get hero image URL (single source of truth with backward compatibility)
  const heroImageUrl = trip?.heroImageUrl || trip?.heroImage || trip?.coverImageUrl || trip?.coverImage || null;

  return (
    <div>
      <button
        onClick={() => setActiveSection('overview')}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6 transition-smooth"
      >
        <Icon name="ArrowLeft" size={16} />
        Back to overview
      </button>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-semibold text-foreground">Active Guests on Trip</h2>
        {permissions?.canEdit && (
          <Button onClick={() => setShowAddGuestModal(true)} className="flex items-center gap-2">
            <Icon name="Plus" size={16} />
            Add Guest
          </Button>
        )}
      </div>
      {guestDetails?.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {guestDetails?.map(guest => (
            <div
              key={guest?.id}
              onClick={() => navigate(`/preferences/${guest?.id}`)}
              className="bg-card border border-border rounded-xl p-4 hover:shadow-lg transition-smooth cursor-pointer"
            >
              <div className="flex items-start gap-3">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold">
                  {guest?.firstName?.[0]}{guest?.lastName?.[0]}
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-foreground">{guest?.firstName} {guest?.lastName}</h3>
                  <p className="text-sm text-muted-foreground">{guest?.cabinNumber ? `Cabin ${guest?.cabinNumber}` : 'No cabin assigned'}</p>
                  {guest?.dietaryRestrictions && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {guest?.dietaryRestrictions?.split(',')?.slice(0, 2)?.map((diet, idx) => (
                        <span key={idx} className="px-2 py-0.5 bg-accent/50 text-accent-foreground text-xs rounded">
                          {diet?.trim()}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl p-12 text-center">
          <Icon name="Users" size={48} className="text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground mb-4">No active guests on this trip yet.</p>
          {permissions?.canEdit && (
            <Button onClick={() => setShowAddGuestModal(true)} className="flex items-center gap-2 mx-auto">
              <Icon name="Plus" size={16} />
              Add Guest
            </Button>
          )}
        </div>
      )}
      
      {showAddGuestModal && (
        <AddOrSelectGuestModal
          isOpen={showAddGuestModal}
          onClose={() => setShowAddGuestModal(false)}
          onSelectExisting={handleSelectExistingGuest}
          onCreateNew={handleCreateNewGuest}
          currentTripGuests={trip?.guests || []}
        />
      )}
    </div>
  );
};

// Reminders Section (full page)
const RemindersSection = ({ trip, tripId, navigate, permissions, onUpdate, setActiveSection }) => {
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingReminder, setEditingReminder] = useState(null);
  const currentUser = getCurrentUser();
  
  const logTripActivity = (actionType, message, entityId = null) => {
    const activity = {
      id: `activity-${Date.now()}-${Math.random()?.toString(36)?.substr(2, 9)}`,
      at: new Date()?.toISOString(),
      actorName: currentUser?.fullName || currentUser?.name || 'Unknown',
      actionType,
      message,
      entityId
    };
    
    const updatedTrip = {
      ...trip,
      tripActivityLog: [...(trip?.tripActivityLog || []), activity]
    };
    
    updateTrip(trip?.id, updatedTrip);
  };

  const reminders = trip?.reminders || [];
  const sortedReminders = reminders?.sort((a, b) => {
    if (a?.completed !== b?.completed) return a?.completed ? 1 : -1;
    if (a?.dueDate && b?.dueDate) return new Date(a?.dueDate) - new Date(b?.dueDate);
    return 0;
  });

  const handleToggleComplete = (reminderId) => {
    let updatedReminders = reminders?.map(r => 
      r?.id === reminderId ? { 
        ...r, 
        completed: !r?.completed,
        completedAt: !r?.completed ? new Date()?.toISOString() : null,
        completedBy: !r?.completed ? getCurrentUser()?.id : null
      } : r
    );
    const updatedTrip = { ...trip, reminders: updatedReminders };
    updateTrip(trip?.id, updatedTrip);
    showToast('Reminder updated', 'success');
    onUpdate();
  };

  const handleDelete = (reminderId) => {
    if (window.confirm('Delete this reminder?')) {
      let updatedReminders = reminders?.filter(r => r?.id !== reminderId);
      const updatedTrip = { ...trip, reminders: updatedReminders };
      updateTrip(trip?.id, updatedTrip);
      showToast('Reminder deleted', 'success');
      onUpdate();
    }
  };

  return (
    <div>
      <button
        onClick={() => navigate(`/trips/${tripId}?tab=overview`)}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-smooth mb-4"
      >
        <Icon name="ArrowLeft" size={16} />
        Back to overview
      </button>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-semibold text-foreground">Reminders / To Do</h2>
        {permissions?.canEdit && (
          <Button onClick={() => setShowAddModal(true)} className="flex items-center gap-2">
            <Icon name="Plus" size={16} />
            Add Reminder
          </Button>
        )}
      </div>
      {sortedReminders?.length > 0 ? (
        <div className="space-y-3">
          {sortedReminders?.map(reminder => (
            <div key={reminder?.id} className={`bg-card border border-border rounded-xl p-4 flex items-start gap-3 ${
              reminder?.completed ? 'opacity-60' : ''
            }`}>
              <input
                type="checkbox"
                checked={reminder?.completed}
                onChange={() => handleToggleComplete(reminder?.id)}
                disabled={!permissions?.canEdit}
                className="mt-1 cursor-pointer"
              />
              <div className="flex-1">
                <p className={`text-sm font-medium text-foreground ${
                  reminder?.completed ? 'line-through' : ''
                }`}>{reminder?.title}</p>
                {reminder?.dueDate && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Due: {new Date(reminder?.dueDate)?.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                  </p>
                )}
                {reminder?.notes && (
                  <p className="text-xs text-muted-foreground mt-2 italic">{reminder?.notes}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl p-12 text-center">
          <Icon name="Bell" size={48} className="text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">No reminders yet.</p>
          {permissions?.canEdit && (
            <Button onClick={() => setShowAddModal(true)} className="mt-4">
              Add First Reminder
            </Button>
          )}
        </div>
      )}
      {showAddModal && (
        <AddReminderModal
          isOpen={showAddModal}
          onClose={() => {
            setShowAddModal(false);
            setEditingReminder(null);
          }}
          trip={trip}
          editingReminder={editingReminder}
          onSave={() => {
            setShowAddModal(false);
            setEditingReminder(null);
            onUpdate();
          }}
        />
      )}
    </div>
  );
};

// Add Reminder Modal (simple implementation)
const AddReminderModal = ({ isOpen, onClose, trip, editingReminder, onSave }) => {
  const [title, setTitle] = useState(editingReminder?.title || '');
  const [dueDate, setDueDate] = useState(editingReminder?.dueDate || '');

  const handleSave = () => {
    if (!title?.trim()) {
      showToast('Please enter a title', 'error');
      return;
    }
    if (!dueDate) {
      showToast('Please select a due date', 'error');
      return;
    }

    const reminders = trip?.reminders || [];
    let updatedReminders;

    if (editingReminder) {
      updatedReminders = reminders?.map(r => 
        r?.id === editingReminder?.id ? { ...r, title, dueDate } : r
      );
    } else {
      const newReminder = {
        id: `reminder-${Date.now()}-${Math.random()?.toString(36)?.substr(2, 9)}`,
        title,
        dueDate,
        completed: false,
        createdAt: new Date()?.toISOString()
      };
      updatedReminders = [...reminders, newReminder];
    }

    const updatedTrip = { ...trip, reminders: updatedReminders };
    updateTrip(trip?.id, updatedTrip);
    showToast(editingReminder ? 'Reminder updated' : 'Reminder added', 'success');
    onSave();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card rounded-xl shadow-xl max-w-md w-full p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-foreground">
            {editingReminder ? 'Edit Reminder' : 'Add Reminder'}
          </h3>
          <button onClick={onClose} className="p-2 hover:bg-muted rounded-lg transition-smooth">
            <Icon name="X" size={18} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">Title *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e?.target?.value)}
              className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="Enter reminder title"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-2">Due Date (optional)</label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e?.target?.value)}
              className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>

        <div className="flex items-center gap-3 mt-6">
          <Button onClick={handleSave} className="flex-1">
            {editingReminder ? 'Update' : 'Add'} Reminder
          </Button>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
};

// Add Special Modal
const AddSpecialModal = ({ isOpen, onClose, trip, guests, editingSpecial, onSave, onLogActivity }) => {
  const [title, setTitle] = useState(editingSpecial?.title || '');
  const [date, setDate] = useState(editingSpecial?.date || '');
  const [guestId, setGuestId] = useState(editingSpecial?.guestId || '');
  const [notes, setNotes] = useState(editingSpecial?.notes || '');
  const [type, setType] = useState(editingSpecial?.type || 'Birthday');

  const handleSave = () => {
    if (!title?.trim()) {
      showToast('Please enter a title', 'error');
      return;
    }
    if (!date) {
      showToast('Please select a date', 'error');
      return;
    }

    const specialDates = trip?.specialDates || [];
    let updatedSpecialDates;

    if (editingSpecial) {
      updatedSpecialDates = specialDates?.map(s => 
        s?.id === editingSpecial?.id ? { ...s, title, date, guestId, notes, type } : s
      );
      onLogActivity('SPECIAL_UPDATED', `Special occasion "${title}" updated`);
    } else {
      const newSpecial = {
        id: `special-${Date.now()}-${Math.random()?.toString(36)?.substr(2, 9)}`,
        title,
        date,
        guestId,
        notes,
        type,
        createdAt: new Date()?.toISOString()
      };
      updatedSpecialDates = [...specialDates, newSpecial];
      onLogActivity('SPECIAL_CREATED', `Special occasion "${title}" created`);
    }

    const updatedTrip = { ...trip, specialDates: updatedSpecialDates };
    updateTrip(trip?.id, updatedTrip);
    showToast(editingSpecial ? 'Special occasion updated' : 'Special occasion added', 'success');
    onSave();
  };

  if (!isOpen) return null;

  const tripGuests = guests?.filter(g => trip?.guests?.some(tg => tg?.guestId === g?.id && tg?.isActive));

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card rounded-xl shadow-xl max-w-md w-full p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-foreground">
            {editingSpecial ? 'Edit Special Occasion' : 'Add Special Occasion'}
          </h3>
          <button onClick={onClose} className="p-2 hover:bg-muted rounded-lg transition-smooth">
            <Icon name="X" size={18} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">Title *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e?.target?.value)}
              className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="e.g., John's Birthday"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-2">Date *</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e?.target?.value)}
              className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">Type</label>
            <select
              value={type}
              onChange={(e) => setType(e?.target?.value)}
              className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="Birthday">Birthday</option>
              <option value="Anniversary">Anniversary</option>
              <option value="Celebration">Celebration</option>
              <option value="Other">Other</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-2">Linked Guest (optional)</label>
            <select
              value={guestId}
              onChange={(e) => setGuestId(e?.target?.value)}
              className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">None</option>
              {tripGuests?.map(guest => (
                <option key={guest?.id} value={guest?.id}>
                  {guest?.firstName} {guest?.lastName}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-2">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e?.target?.value)}
              className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              rows={3}
              placeholder="Additional details..."
            />
          </div>
        </div>

        <div className="flex items-center gap-3 mt-6">
          <Button onClick={handleSave} className="flex-1">
            {editingSpecial ? 'Update' : 'Add'} Special
          </Button>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
};

// Event Detail Popover
const EventDetailPopover = ({ event, onClose }) => {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-card rounded-xl shadow-xl max-w-md w-full p-6" onClick={(e) => e?.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-foreground">Event Details</h3>
          <button onClick={onClose} className="p-2 hover:bg-muted rounded-lg transition-smooth">
            <Icon name="X" size={18} />
          </button>
        </div>

        <div className="space-y-3">
          {event?.time && (
            <div>
              <p className="text-xs text-muted-foreground">Time</p>
              <p className="text-sm text-foreground font-medium">{event?.time}</p>
            </div>
          )}
          <div>
            <p className="text-xs text-muted-foreground">Event</p>
            <p className="text-sm text-foreground">{event?.event}</p>
          </div>
          {event?.location && (
            <div>
              <p className="text-xs text-muted-foreground">Location</p>
              <p className="text-sm text-foreground">{event?.location}</p>
            </div>
          )}
          {event?.date && (
            <div>
              <p className="text-xs text-muted-foreground">Date</p>
              <p className="text-sm text-foreground">{new Date(event?.date)?.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
            </div>
          )}
          {event?.notes && (
            <div>
              <p className="text-xs text-muted-foreground">Notes</p>
              <p className="text-sm text-foreground italic">{event?.notes}</p>
            </div>
          )}
        </div>

        <div className="mt-6">
          <Button onClick={onClose} className="w-full">
            Close
          </Button>
        </div>
      </div>
    </div>
  );
};

// Special Detail Popover
const SpecialDetailPopover = ({ special, guests, permissions, onClose, onEdit, onDelete }) => {
  const guest = guests?.find(g => g?.id === special?.guestId);
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-card rounded-xl shadow-xl max-w-md w-full p-6" onClick={(e) => e?.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-foreground">Special Occasion</h3>
          <button onClick={onClose} className="p-2 hover:bg-muted rounded-lg transition-smooth">
            <Icon name="X" size={18} />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <p className="text-xs text-muted-foreground">Title</p>
            <p className="text-sm text-foreground font-medium">{special?.title}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Date</p>
            <p className="text-sm text-foreground">{new Date(special?.date)?.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
          </div>
          {special?.type && (
            <div>
              <p className="text-xs text-muted-foreground">Type</p>
              <p className="text-sm text-foreground">{special?.type}</p>
            </div>
          )}
          {guest && (
            <div>
              <p className="text-xs text-muted-foreground">Linked Guest</p>
              <p className="text-sm text-foreground">{guest?.firstName} {guest?.lastName}</p>
            </div>
          )}
          {special?.notes && (
            <div>
              <p className="text-xs text-muted-foreground">Notes</p>
              <p className="text-sm text-foreground italic">{special?.notes}</p>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 mt-6">
          {permissions?.canEdit && (
            <>
              <Button onClick={onEdit} className="flex-1">
                Edit
              </Button>
              <Button variant="outline" onClick={() => onDelete(special?.id)} className="text-red-600 hover:bg-red-50">
                Delete
              </Button>
            </>
          )}
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
};

// Reminder Detail Popover
const ReminderDetailPopover = ({ reminder, guests, permissions, onClose, onEdit, onDelete }) => {
  const guest = guests?.find(g => g?.id === reminder?.guestId);
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-card rounded-xl shadow-xl max-w-md w-full p-6" onClick={(e) => e?.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-foreground">Reminder Details</h3>
          <button onClick={onClose} className="p-2 hover:bg-muted rounded-lg transition-smooth">
            <Icon name="X" size={18} />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <p className="text-xs text-muted-foreground">Title</p>
            <p className="text-sm text-foreground font-medium">{reminder?.title}</p>
          </div>
          {reminder?.dueDate && (
            <div>
              <p className="text-xs text-muted-foreground">Due Date</p>
              <p className="text-sm text-foreground">{new Date(reminder?.dueDate)?.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
            </div>
          )}
          {guest && (
            <div>
              <p className="text-xs text-muted-foreground">Linked Guest</p>
              <p className="text-sm text-foreground">{guest?.firstName} {guest?.lastName}</p>
            </div>
          )}
          {reminder?.notes && (
            <div>
              <p className="text-xs text-muted-foreground">Notes</p>
              <p className="text-sm text-foreground italic">{reminder?.notes}</p>
            </div>
          )}
          <div>
            <p className="text-xs text-muted-foreground">Status</p>
            <p className="text-sm text-foreground">{reminder?.completed ? 'Completed' : 'Pending'}</p>
          </div>
        </div>

        <div className="flex items-center gap-3 mt-6">
          {permissions?.canEdit && (
            <>
              <Button onClick={onEdit} className="flex-1">
                Edit
              </Button>
              <Button variant="outline" onClick={() => onDelete(reminder?.id)} className="text-red-600 hover:bg-red-50">
                Delete
              </Button>
            </>
          )}
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
};

// Preferences Section Component
const PreferencesSection = ({ trip, tripId, permissions, onUpdate, navigate }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const guestIdFromUrl = searchParams?.get('guestId');
  
  // Get active guests for this trip
  const allGuests = loadGuests();
  const activeGuests = allGuests?.filter(g => 
    trip?.guests?.some(tg => tg?.guestId === g?.id && tg?.isActive)
  ) || [];

  // Current guest selection with URL param support
  const [currentGuestIndex, setCurrentGuestIndex] = useState(0);
  
  useEffect(() => {
    if (guestIdFromUrl && activeGuests?.length > 0) {
      const index = activeGuests?.findIndex(g => g?.id === guestIdFromUrl);
      if (index !== -1) {
        setCurrentGuestIndex(index);
      }
    }
  }, [guestIdFromUrl, activeGuests]);

  const currentGuest = activeGuests?.[currentGuestIndex];

  const handleGuestChange = (newIndex) => {
    setCurrentGuestIndex(newIndex);
    const newGuest = activeGuests?.[newIndex];
    if (newGuest) {
      setSearchParams({ tab: 'preferences', guestId: newGuest?.id });
    }
  };

  const handlePrevGuest = () => {
    if (currentGuestIndex > 0) {
      handleGuestChange(currentGuestIndex - 1);
    }
  };

  const handleNextGuest = () => {
    if (currentGuestIndex < activeGuests?.length - 1) {
      handleGuestChange(currentGuestIndex + 1);
    }
  };

  const handleGuestSelect = (guestId) => {
    const index = activeGuests?.findIndex(g => g?.id === guestId);
    if (index !== -1) {
      handleGuestChange(index);
    }
  };

  if (!currentGuest) {
    return (
      <div className="bg-card border border-border rounded-xl p-12 text-center">
        <Icon name="Users" size={48} className="text-muted-foreground mx-auto mb-4" />
        <p className="text-muted-foreground">No active guests on this trip.</p>
        <p className="text-sm text-muted-foreground mt-2">Add guests to view their preferences.</p>
      </div>
    );
  }

  // Mock preference data (in real app, this would come from guest preferences)
  const guestPreferences = {
    dietary: {
      type: currentGuest?.dietaryType || 'Not specified',
      dineOut: 'High-end restaurants',
      likes: 'Fresh vegetables, Italian, Asian',
      dislikes: 'Meat, dairy, eggs, mushrooms, bell peppers'
    },
    beverages: {
      water: 'Sparkling water — Perrier',
      tea: 'Green tea, Chamomile',
      wine: 'Dry white wine, Sauvignon Blanc'
    },
    housekeeping: {
      pillows: '2x Feather',
      sheetChange: 'Every 2 days',
      ambiance: 'Fresh flowers',
      notes: 'No high-adrenaline sports'
    },
    activities: {
      interests: 'Snorkeling, Kayaking, Spa treatments',
      other: 'No high-adrenaline sports'
    },
    health: {
      allergies: currentGuest?.allergies || 'Gluten',
      notes: 'Carries EpiPen',
      prefers: 'Hypoallergenic products',
      avoids: 'Avoids gluten & dairy'
    },
    crewNotes: [
      {
        content: 'Guest prefers morning activities and quiet evenings. Very particular about dietary requirements.',
        author: 'Sarah Mitchell',
        role: 'Commander',
        date: '2024-01-15'
      }
    ]
  };

  // Widget component for consistent styling
  const PreferenceWidget = ({ icon, title, children, fullWidth = false }) => (
    <div className={`bg-card border border-border rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow ${
      fullWidth ? 'col-span-1 lg:col-span-2' : ''
    }`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Icon name={icon} size={20} className="text-muted-foreground" />
          <h3 className="text-base font-semibold text-foreground">{title}</h3>
        </div>
        <Button size="sm" variant="outline">
          Edit
        </Button>
      </div>
      <div className="space-y-3">
        {children}
      </div>
    </div>
  );

  const PreferenceItem = ({ label, value, badge = false, badgeColor = 'bg-gray-100 text-gray-800' }) => (
      <div className="flex items-start gap-2">
        <Icon name="Circle" size={6} className="text-muted-foreground mt-2 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-foreground">{label}: </span>
          {badge ? (
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 ${badgeColor} rounded text-xs font-medium ml-1`}>
              {value}
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">{value}</span>
          )}
        </div>
      </div>
    );

  const EmptyState = () => (
    <p className="text-sm text-muted-foreground">No preferences recorded</p>
  );

  return (
    <div className="max-w-6xl">
      {/* Guest Header with Switcher */}
      <div className="bg-card border border-border rounded-xl p-6 mb-6">
        <div className="flex items-start gap-4">
          {/* Avatar */}
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white text-xl font-semibold flex-shrink-0">
            {currentGuest?.firstName?.[0]}{currentGuest?.lastName?.[0]}
          </div>
          
          {/* Guest Info */}
          <div className="flex-1 min-w-0">
            <h2 className="text-2xl font-semibold text-foreground mb-2">
              {currentGuest?.firstName} {currentGuest?.lastName}
            </h2>
            
            {/* Badges */}
            <div className="flex flex-wrap gap-2 mb-4">
              {currentGuest?.dietaryType && (
                <span className="inline-flex items-center gap-1 px-3 py-1 bg-green-100 text-green-800 rounded-full text-xs font-medium">
                  <Icon name="Leaf" size={12} />
                  {currentGuest?.dietaryType}
                </span>
              )}
              {currentGuest?.nationality && (
                <span className="inline-flex items-center gap-1 px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-medium">
                  <Icon name="Flag" size={12} />
                  {currentGuest?.nationality}
                </span>
              )}
              {currentGuest?.allergies && (
                <span className="inline-flex items-center gap-1 px-3 py-1 bg-red-100 text-red-800 rounded-full text-xs font-medium">
                  <Icon name="AlertCircle" size={12} />
                  {currentGuest?.allergies} allergy
                </span>
              )}
            </div>

            {/* Guest Switcher */}
            {activeGuests?.length > 1 && (
              <div className="flex items-center gap-3">
                <button
                  onClick={handlePrevGuest}
                  disabled={currentGuestIndex === 0}
                  className="p-2 rounded-lg border border-border hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Icon name="ChevronLeft" size={16} />
                </button>
                
                <Select
                  options={activeGuests?.map(g => ({
                    value: g?.id,
                    label: `${g?.firstName} ${g?.lastName}`
                  }))}
                  value={currentGuest?.id}
                  onChange={handleGuestSelect}
                  className="min-w-[200px]"
                />
                
                <button
                  onClick={handleNextGuest}
                  disabled={currentGuestIndex === activeGuests?.length - 1}
                  className="p-2 rounded-lg border border-border hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Icon name="ChevronRight" size={16} />
                </button>
                
                <span className="text-sm text-muted-foreground ml-2">
                  {currentGuestIndex + 1} of {activeGuests?.length}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Widget Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Dietary Widget */}
        <PreferenceWidget icon="Utensils" title="Dietary">
          {guestPreferences?.dietary?.type ? (
            <>
              <PreferenceItem 
                label="Dietary type" 
                value={guestPreferences?.dietary?.type}
                badge
                badgeColor="bg-green-100 text-green-800"
              />
              <PreferenceItem 
                label="Dine-out preference" 
                value={guestPreferences?.dietary?.dineOut}
              />
              <PreferenceItem 
                label="Food likes" 
                value={guestPreferences?.dietary?.likes}
              />
              <PreferenceItem 
                label="Food dislikes" 
                value={guestPreferences?.dietary?.dislikes}
              />
            </>
          ) : (
            <EmptyState />
          )}
        </PreferenceWidget>

        {/* Beverages Widget */}
        <PreferenceWidget icon="Coffee" title="Beverages">
          {guestPreferences?.beverages?.water ? (
            <>
              <PreferenceItem 
                label="Water preferences" 
                value={guestPreferences?.beverages?.water}
              />
              <PreferenceItem 
                label="Tea / coffee preferences" 
                value={guestPreferences?.beverages?.tea}
              />
              <PreferenceItem 
                label="Wine / spirits preferences" 
                value={guestPreferences?.beverages?.wine}
              />
            </>
          ) : (
            <EmptyState />
          )}
        </PreferenceWidget>

        {/* Housekeeping & Cabin Widget */}
        <PreferenceWidget icon="Home" title="Housekeeping & Cabin">
          {guestPreferences?.housekeeping?.pillows ? (
            <>
              <PreferenceItem 
                label="Pillows" 
                value={guestPreferences?.housekeeping?.pillows}
              />
              <PreferenceItem 
                label="Sheet change cadence" 
                value={guestPreferences?.housekeeping?.sheetChange}
              />
              <PreferenceItem 
                label="Cabin ambience" 
                value={guestPreferences?.housekeeping?.ambiance}
              />
              <PreferenceItem 
                label="Other cabin notes" 
                value={guestPreferences?.housekeeping?.notes}
              />
            </>
          ) : (
            <EmptyState />
          )}
        </PreferenceWidget>

        {/* Activities Widget */}
        <PreferenceWidget icon="Activity" title="Activities">
          {guestPreferences?.activities?.interests ? (
            <>
              <PreferenceItem 
                label="Interests" 
                value={guestPreferences?.activities?.interests}
              />
              <PreferenceItem 
                label="Other activity notes" 
                value={guestPreferences?.activities?.other}
              />
            </>
          ) : (
            <EmptyState />
          )}
        </PreferenceWidget>

        {/* Health & Allergies Widget */}
        <PreferenceWidget icon="Heart" title="Health & Allergies">
          {guestPreferences?.health?.allergies ? (
            <>
              <PreferenceItem 
                label="Allergies" 
                value={guestPreferences?.health?.allergies}
              />
              <PreferenceItem 
                label="Health notes" 
                value={guestPreferences?.health?.notes}
              />
              <PreferenceItem 
                label="Product sensitivities" 
                value={guestPreferences?.health?.prefers}
              />
              <PreferenceItem 
                label="Avoidances" 
                value={guestPreferences?.health?.avoids}
              />
            </>
          ) : (
            <EmptyState />
          )}
        </PreferenceWidget>

        {/* Crew Notes Widget (Full Width) */}
        <PreferenceWidget icon="FileText" title="Crew Notes" fullWidth>
          {guestPreferences?.crewNotes?.length > 0 ? (
            <div className="space-y-4">
              {guestPreferences?.crewNotes?.slice(0, 3)?.map((note, idx) => (
                <div key={idx} className={`${idx > 0 ? 'pt-4 border-t border-border' : ''}`}>
                  <p className="text-sm text-foreground mb-2">{note?.content}</p>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="font-medium">{note?.author}</span>
                    <span>•</span>
                    <span>{note?.role}</span>
                    <span>•</span>
                    <span>{note?.date}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState />
          )}
        </PreferenceWidget>
      </div>
    </div>
  );
};

export default TripDetailView;