import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Button from '../../components/ui/Button';
import Icon from '../../components/AppIcon';
import AddEditDayModal from './components/AddEditDayModal';
import { getTripById, deleteItineraryDay } from '../trips-management-dashboard/utils/tripStorage';
import { getCurrentUser } from '../../utils/authStorage';
import { showToast } from '../../utils/toast';
import { canAccessTrips, canEditTrip } from '../trips-management-dashboard/utils/tripPermissions';


const TripItineraryTimeline = () => {
  const navigate = useNavigate();
  const { tripId } = useParams();
  const [currentUser, setCurrentUser] = useState(null);
  const [trip, setTrip] = useState(null);
  const [showAddEditModal, setShowAddEditModal] = useState(false);
  const [editingDay, setEditingDay] = useState(null);
  const [selectedDayId, setSelectedDayId] = useState(null);
  const dayRefs = useRef({});

  const permissions = {
    canEdit: canEditTrip(currentUser)
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

  // Load trip data
  useEffect(() => {
    if (tripId) {
      loadTripData();
    }
  }, [tripId]);

  const loadTripData = () => {
    const tripData = getTripById(tripId);
    if (tripData) {
      setTrip(tripData);
    } else {
      showToast('Trip not found', 'error');
      navigate('/trips-management-dashboard');
    }
  };

  const handleAddDay = () => {
    setEditingDay(null);
    setShowAddEditModal(true);
  };

  const handleEditDay = (day) => {
    setEditingDay(day);
    setShowAddEditModal(true);
  };

  const handleDeleteDay = (dayId) => {
    if (window.confirm('Are you sure you want to delete this itinerary day?')) {
      const result = deleteItineraryDay(tripId, dayId);
      if (result) {
        showToast('Itinerary day deleted', 'success');
        loadTripData();
      } else {
        showToast('Failed to delete itinerary day', 'error');
      }
    }
  };

  const handleModalClose = () => {
    setShowAddEditModal(false);
    setEditingDay(null);
    loadTripData();
  };

  const handleDayPillClick = (dayId) => {
    setSelectedDayId(dayId);
    // Scroll to the day card
    if (dayRefs?.current?.[dayId]) {
      dayRefs?.current?.[dayId]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Brief highlight effect
      setTimeout(() => setSelectedDayId(null), 1500);
    }
  };

  // Sort itinerary days by date
  const sortedDays = trip?.itineraryDays?.sort((a, b) => new Date(a?.date) - new Date(b?.date)) || [];

  // Determine today's date (YYYY-MM-DD)
  const todayDate = new Date()?.toISOString()?.split('T')?.[0];

  // Find today's day
  const todayDay = sortedDays?.find(day => day?.date === todayDate);

  // Suggest default date for new day
  const suggestNextDate = () => {
    if (sortedDays?.length === 0) {
      return trip?.startDate || todayDate;
    }
    const lastDay = sortedDays?.[sortedDays?.length - 1];
    const nextDate = new Date(lastDay?.date);
    nextDate?.setDate(nextDate?.getDate() + 1);
    return nextDate?.toISOString()?.split('T')?.[0];
  };

  if (!trip) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="flex items-center justify-center h-96">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background transition-colors duration-300">
      <Header />
      <main className="flex h-[calc(100vh-4rem)] overflow-hidden">
        {/* LEFT SIDEBAR NAVIGATION - FIXED WIDTH, FLUSH LEFT, NO SHRINK */}
        <aside className="w-60 border-r border-border bg-card flex-shrink-0 overflow-y-auto pl-0">
          <div className="py-0 px-4">
            <button
              onClick={() => navigate(`/trips/${tripId}?tab=overview`)}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4 transition-smooth"
            >
              <Icon name="ArrowLeft" size={16} />
              Back to overview
            </button>

            <nav className="flex flex-col gap-1 mb-8">
              <button
                onClick={() => navigate(`/trips/${tripId}?tab=overview`)}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-smooth text-left bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                Overview
              </button>
              <button
                onClick={() => navigate(`/trips/${tripId}?tab=guests`)}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-smooth text-left bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                Guests
              </button>
              <button
                onClick={() => navigate(`/trips/${tripId}?tab=preferences`)}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-smooth text-left bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                Preferences
              </button>
              <button
                onClick={() => navigate(`/trips/${tripId}/itinerary`)}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-smooth text-left bg-primary text-primary-foreground"
              >
                Itinerary
              </button>
              <button
                onClick={() => navigate(`/trips/${tripId}?tab=special`)}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-smooth text-left bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                Special
              </button>
              <button
                onClick={() => navigate(`/trips/${tripId}?tab=reminders`)}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-smooth text-left bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                Reminders
              </button>
              <button
                onClick={() => navigate(`/trips/${tripId}?tab=activity`)}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-smooth text-left bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                Activity
              </button>
            </nav>
          </div>
        </aside>

        {/* MAIN CONTENT AREA - FLEXIBLE, WITH PROPER PADDING */}
        <div className="flex-1 overflow-y-auto h-[calc(100vh-5rem)] px-6 pt-6">
          <div className="py-4 max-w-7xl mx-auto">
            {/* Page Header */}
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-3xl font-semibold text-foreground">Itinerary</h1>
                <p className="text-sm text-muted-foreground mt-1">{trip?.name}</p>
              </div>
              {permissions?.canEdit && (
                <Button onClick={handleAddDay} className="flex items-center gap-2">
                  <Icon name="Plus" size={16} />
                  Add Day
                </Button>
              )}
            </div>

            {/* Horizontal Day Strip */}
            {sortedDays?.length > 0 && (
              <div className="mb-8 overflow-x-auto pb-2">
                <div className="flex gap-2 min-w-max">
                  {sortedDays?.map((day, index) => {
                    const isToday = day?.date === todayDate;
                    const dayDate = new Date(day?.date);
                    const dayOfWeek = dayDate?.toLocaleDateString('en-US', { weekday: 'short' });
                    const dayNum = dayDate?.getDate();
                    const month = dayDate?.toLocaleDateString('en-US', { month: 'short' });

                    return (
                      <button
                        key={day?.id}
                        onClick={() => handleDayPillClick(day?.id)}
                        className={`flex flex-col items-center justify-center px-4 py-2 rounded-full border transition-smooth ${
                          isToday
                            ? 'bg-primary text-primary-foreground border-primary shadow-md'
                            : 'bg-card border-border hover:border-primary/50 hover:bg-muted'
                        } ${selectedDayId === day?.id ? 'ring-2 ring-primary' : ''}`}
                      >
                        <span className="text-xs font-medium">{dayOfWeek}</span>
                        <span className="text-lg font-semibold">{dayNum}</span>
                        <span className="text-xs">{month}</span>
                        {isToday && (
                          <span className="text-[10px] font-bold mt-0.5">TODAY</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Timeline */}
            {sortedDays?.length > 0 ? (
              <div className="relative">
                {/* Timeline vertical line */}
                <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-border" />

                {/* Day cards */}
                <div className="space-y-6">
                  {sortedDays?.map((day, index) => {
                    const isToday = day?.date === todayDate;
                    return (
                      <DayCard
                        key={day?.id}
                        day={day}
                        dayNumber={index + 1}
                        isToday={isToday}
                        permissions={permissions}
                        onEdit={handleEditDay}
                        onDelete={handleDeleteDay}
                        ref={(el) => (dayRefs.current[day?.id] = el)}
                      />
                    );
                  })}
                </div>

                {/* Add Day at bottom */}
                {permissions?.canEdit && (
                  <div className="flex items-center gap-4 mt-6 ml-6">
                    <div className="w-3 h-3 rounded-full bg-border flex-shrink-0" />
                    <button
                      onClick={handleAddDay}
                      className="flex-1 bg-card border border-dashed border-border rounded-xl p-6 hover:border-primary hover:bg-muted transition-smooth flex items-center justify-center gap-2 text-muted-foreground hover:text-foreground"
                    >
                      <Icon name="Plus" size={20} />
                      <span className="font-medium">Add day</span>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-card border border-border rounded-xl p-12 text-center">
                <Icon name="Map" size={48} className="text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground mb-4">No itinerary days added yet.</p>
                {permissions?.canEdit && (
                  <Button onClick={handleAddDay} className="flex items-center gap-2 mx-auto">
                    <Icon name="Plus" size={16} />
                    Add First Day
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </main>
      {/* Add/Edit Day Modal */}
      {showAddEditModal && (
        <AddEditDayModal
          isOpen={showAddEditModal}
          onClose={handleModalClose}
          tripId={tripId}
          editingDay={editingDay}
          suggestedDate={suggestNextDate()}
        />
      )}
    </div>
  );
};

// Day Card Component
const DayCard = React.forwardRef(({ day, dayNumber, isToday, permissions, onEdit, onDelete }, ref) => {
  const dayDate = new Date(day?.date);
  const formattedDate = dayDate?.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  // Map thumbnail placeholder
  const mapThumbnail = day?.mapImageUrl || '/assets/images/no_image.png';

  // Stop type icon and label
  const getStopTypeConfig = (type) => {
    switch (type) {
      case 'DOCK':
        return { icon: 'Anchor', label: 'Dock', color: 'text-blue-600' };
      case 'ANCHOR':
        return { icon: 'Anchor', label: 'Anchor', color: 'text-teal-600' };
      case 'UNDERWAY':
        return { icon: 'Ship', label: 'Underway', color: 'text-purple-600' };
      default:
        return { icon: 'MapPin', label: 'Location', color: 'text-gray-600' };
    }
  };

  const stopConfig = getStopTypeConfig(day?.stopType);

  return (
    <div ref={ref} className="flex items-start gap-4">
      {/* Timeline dot */}
      <div className={`w-3 h-3 rounded-full flex-shrink-0 mt-6 z-10 ${
        isToday ? 'bg-primary ring-4 ring-primary/20' : 'bg-border'
      }`} />

      {/* Card */}
      <div
        className={`flex-1 bg-card border rounded-xl transition-smooth ${
          isToday
            ? 'border-primary shadow-lg p-6'
            : 'border-border hover:border-primary/30 p-5'
        }`}
      >
        <div className="flex items-start gap-4">
          {/* Map Thumbnail */}
          <div className={`flex-shrink-0 rounded-lg overflow-hidden ${
            isToday ? 'w-36 h-24' : 'w-24 h-16'
          }`}>
            <img
              src={mapThumbnail}
              alt={`Map of ${day?.locationTitle}`}
              className="w-full h-full object-cover"
            />
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            {/* Day number and TODAY badge */}
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-xs font-semibold text-muted-foreground ${
                isToday ? 'text-sm' : ''
              }`}>
                DAY {dayNumber}
              </span>
              {isToday && (
                <span className="px-2 py-0.5 bg-primary text-primary-foreground text-[10px] font-bold rounded-full">
                  TODAY
                </span>
              )}
            </div>

            {/* Location name */}
            <h3 className={`font-semibold text-foreground uppercase tracking-wide mb-1 ${
              isToday ? 'text-xl' : 'text-lg'
            }`}>
              {day?.locationTitle}
            </h3>

            {/* Date */}
            <p className="text-sm text-muted-foreground mb-3">{formattedDate}</p>

            {/* Chips row */}
            <div className="flex items-center gap-2 flex-wrap mb-2">
              {/* Stop type chip */}
              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-muted rounded-full">
                <Icon name={stopConfig?.icon} size={12} className={stopConfig?.color} />
                <span className="text-xs font-medium text-foreground">{stopConfig?.label}</span>
              </div>

              {/* Stop detail chip */}
              {day?.stopDetail && (
                <div className="px-2.5 py-1 bg-muted rounded-full">
                  <span className="text-xs text-foreground">{day?.stopDetail}</span>
                </div>
              )}
            </div>

            {/* Note */}
            {day?.notes && (
              <div className="flex items-start gap-1.5 text-sm text-muted-foreground">
                <Icon name="FileText" size={14} className="mt-0.5 flex-shrink-0" />
                <span>{day?.notes}</span>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-start gap-2 flex-shrink-0">
            {permissions?.canEdit && (
              <>
                <button
                  onClick={() => onEdit(day)}
                  className="p-2 hover:bg-muted rounded-lg transition-smooth"
                  title="Edit day"
                >
                  <Icon name="Edit" size={16} className="text-muted-foreground" />
                </button>
                <button
                  onClick={() => onDelete(day?.id)}
                  className="p-2 hover:bg-red-50 rounded-lg transition-smooth"
                  title="Delete day"
                >
                  <Icon name="Trash2" size={16} className="text-red-600" />
                </button>
              </>
            )}
            <button
              onClick={() => onEdit(day)}
              className="p-2 hover:bg-muted rounded-lg transition-smooth"
              title="View details"
            >
              <Icon name="ChevronRight" size={20} className="text-muted-foreground" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

export default TripItineraryTimeline;