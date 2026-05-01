import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Button from '../../components/ui/Button';
import Icon from '../../components/AppIcon';
import AddEditDayModal from './components/AddEditDayModal';
import AddActivityModal from './components/AddActivityModal';
import { getTripById, resolveSupabaseTripId } from '../trips-management-dashboard/utils/tripStorage';
import { loadGuests } from '../guest-management-dashboard/utils/guestStorage';
import { getCurrentUser } from '../../utils/authStorage';
import { showToast } from '../../utils/toast';
import { canAccessTrips, canEditTrip } from '../trips-management-dashboard/utils/tripPermissions';
import { useItinerary } from './hooks/useItinerary';


const TripItineraryTimeline = () => {
  const navigate = useNavigate();
  const { tripId } = useParams();
  const [currentUser, setCurrentUser] = useState(null);
  const [trip, setTrip] = useState(null);
  // Lazily resolved Supabase uuid for the trip — pre-A3.5 LS trips
  // and post-A3.5 trips whose merge layer didn't stamp supabaseId need
  // this lookup before useItinerary can fire its query / mutations.
  // Mirrors the resolver pattern updateTrip / deleteTrip use internally
  // (commit a0efbe1).
  const [tripUuid, setTripUuid] = useState(null);
  const [guests, setGuests] = useState([]);
  const [showAddEditModal, setShowAddEditModal] = useState(false);
  const [editingDay, setEditingDay] = useState(null);
  const [showActivityModal, setShowActivityModal] = useState(false);
  const [activityDayId, setActivityDayId] = useState(null);
  const [editingActivity, setEditingActivity] = useState(null);
  const [selectedDayId, setSelectedDayId] = useState(null);
  const dayRefs = useRef({});

  const permissions = {
    canEdit: canEditTrip(currentUser)
  };

  // Hook canonical for days+activities once we have the trip's UUID.
  // Falls back to trip.supabaseId synchronously when the merge layer
  // happened to stamp it; the resolver effect below covers the case
  // where it didn't.
  const {
    days,
    loading: itineraryLoading,
    addDay,
    updateDay,
    deleteDay,
    addActivity,
    updateActivity,
    deleteActivity,
  } = useItinerary(tripUuid || trip?.supabaseId);

  useEffect(() => {
    const user = getCurrentUser();
    if (!user) return;
    if (!canAccessTrips(user)) {
      showToast('Access restricted', 'error');
      navigate('/dashboard');
      return;
    }
    setCurrentUser(user);
  }, [navigate]);

  useEffect(() => {
    if (tripId) loadTripData();
  }, [tripId]);

  // Resolve Supabase uuid lazily when the merge layer didn't stamp it
  // (pre-A3.5 LS trips, pending-sync trips). Returns the cached
  // supabaseId or queries by legacy_local_id; result also stamps the
  // LS row in-place so subsequent calls in the session no-op.
  useEffect(() => {
    if (!trip || trip?.supabaseId) return;
    let cancelled = false;
    resolveSupabaseTripId(trip).then(uuid => {
      if (cancelled) return;
      if (uuid) setTripUuid(uuid);
      else      console.warn('[itinerary-timeline] resolveSupabaseTripId returned null — trip has no Supabase counterpart yet.');
    });
    return () => { cancelled = true; };
  }, [trip]);

  const loadTripData = async () => {
    const tripData = await getTripById(tripId);
    if (tripData) {
      setTrip(tripData);
      try {
        const tenantGuests = await loadGuests();
        // Filter to guests actually on this trip — match by both legacy
        // and Supabase id since trip.guests carries either form.
        const onTripIds = new Set(
          (tripData?.guests || [])
            .filter(g => g?.isActive !== false)
            .map(g => g?.guestId)
        );
        setGuests((tenantGuests || []).filter(g => !g?.isDeleted && onTripIds.has(g?.id)));
      } catch (err) {
        console.error('[itinerary-timeline] loadGuests failed:', err);
        setGuests([]);
      }
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

  const handleDeleteDay = async (dayId) => {
    if (!window.confirm('Are you sure you want to delete this itinerary day? This will also delete its activities.')) return;
    const ok = await deleteDay(dayId);
    if (ok) showToast('Itinerary day deleted', 'success');
    else    showToast('Failed to delete itinerary day', 'error');
  };

  const handleModalClose = () => {
    setShowAddEditModal(false);
    setEditingDay(null);
  };

  const handleAddActivity = (dayId) => {
    setActivityDayId(dayId);
    setEditingActivity(null);
    setShowActivityModal(true);
  };

  const handleEditActivity = (dayId, activity) => {
    setActivityDayId(dayId);
    setEditingActivity(activity);
    setShowActivityModal(true);
  };

  const handleDeleteActivity = async (activityId) => {
    if (!window.confirm('Delete this activity?')) return;
    const ok = await deleteActivity(activityId);
    if (ok) showToast('Activity deleted', 'success');
    else    showToast('Failed to delete activity', 'error');
  };

  const handleActivityModalClose = () => {
    setShowActivityModal(false);
    setActivityDayId(null);
    setEditingActivity(null);
  };

  const handleDayPillClick = (dayId) => {
    setSelectedDayId(dayId);
    if (dayRefs?.current?.[dayId]) {
      dayRefs.current[dayId].scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => setSelectedDayId(null), 1500);
    }
  };

  const sortedDays = [...(days || [])].sort((a, b) => {
    const ad = a?.event_date ?? '';
    const bd = b?.event_date ?? '';
    return ad.localeCompare(bd);
  });

  const todayDate = new Date()?.toISOString()?.split('T')?.[0];

  const suggestNextDate = () => {
    if (sortedDays.length === 0) return trip?.startDate || todayDate;
    const lastDay = sortedDays[sortedDays.length - 1];
    const nextDate = new Date(lastDay?.event_date);
    nextDate.setDate(nextDate.getDate() + 1);
    return nextDate.toISOString().split('T')[0];
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

        <div className="flex-1 overflow-y-auto h-[calc(100vh-5rem)] px-6 pt-6">
          <div className="py-4 max-w-7xl mx-auto">
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

            {sortedDays.length > 0 && (
              <div className="mb-8 overflow-x-auto pb-2">
                <div className="flex gap-2 min-w-max">
                  {sortedDays.map((day) => {
                    const isToday = day?.event_date === todayDate;
                    const dayDate = new Date(day?.event_date);
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
                        {isToday && <span className="text-[10px] font-bold mt-0.5">TODAY</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {itineraryLoading && sortedDays.length === 0 ? (
              <div className="bg-card border border-border rounded-xl p-12 text-center">
                <p className="text-muted-foreground">Loading itinerary...</p>
              </div>
            ) : sortedDays.length > 0 ? (
              <div className="relative">
                <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-border" />
                <div className="space-y-6">
                  {sortedDays.map((day, index) => {
                    const isToday = day?.event_date === todayDate;
                    return (
                      <DayCard
                        key={day?.id}
                        day={day}
                        dayNumber={index + 1}
                        isToday={isToday}
                        permissions={permissions}
                        guests={guests}
                        onEdit={handleEditDay}
                        onDelete={handleDeleteDay}
                        onAddActivity={handleAddActivity}
                        onEditActivity={handleEditActivity}
                        onDeleteActivity={handleDeleteActivity}
                        ref={(el) => (dayRefs.current[day?.id] = el)}
                      />
                    );
                  })}
                </div>
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

      {showAddEditModal && (
        <AddEditDayModal
          isOpen={showAddEditModal}
          onClose={handleModalClose}
          editingDay={editingDay}
          suggestedDate={suggestNextDate()}
          guests={guests}
          addDay={addDay}
          updateDay={updateDay}
        />
      )}

      {showActivityModal && (
        <AddActivityModal
          isOpen={showActivityModal}
          onClose={handleActivityModalClose}
          dayId={activityDayId}
          editingActivity={editingActivity}
          guests={guests}
          addActivity={addActivity}
          updateActivity={updateActivity}
        />
      )}
    </div>
  );
};

const guestNameById = (guests, id) => {
  const g = guests.find(x => x?.id === id);
  if (!g) return null;
  return g?.firstName || g?.first_name || g?.name || 'Guest';
};

const getStopTypeConfig = (type) => {
  switch (type) {
    case 'Dock':     return { icon: 'Anchor', label: 'Dock',     color: 'text-blue-600' };
    case 'Anchor':   return { icon: 'Anchor', label: 'Anchor',   color: 'text-teal-600' };
    case 'Underway': return { icon: 'Ship',   label: 'Underway', color: 'text-purple-600' };
    default:         return null;
  }
};

const DayCard = React.forwardRef(({
  day, dayNumber, isToday, permissions, guests,
  onEdit, onDelete, onAddActivity, onEditActivity, onDeleteActivity,
}, ref) => {
  const dayDate = new Date(day?.event_date);
  const formattedDate = dayDate?.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const stopConfig = getStopTypeConfig(day?.stop_type);
  const aboardIds = Array.isArray(day?.aboard_guest_ids) ? day.aboard_guest_ids : [];
  const activities = Array.isArray(day?.activities) ? day.activities : [];

  return (
    <div ref={ref} className="flex items-start gap-4">
      <div className={`w-3 h-3 rounded-full flex-shrink-0 mt-6 z-10 ${
        isToday ? 'bg-primary ring-4 ring-primary/20' : 'bg-border'
      }`} />

      <div className={`flex-1 bg-card border rounded-xl transition-smooth ${
        isToday ? 'border-primary shadow-lg p-6' : 'border-border hover:border-primary/30 p-5'
      }`}>
        <div className="flex items-start gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-xs font-semibold text-muted-foreground ${isToday ? 'text-sm' : ''}`}>
                DAY {dayNumber}
              </span>
              {isToday && (
                <span className="px-2 py-0.5 bg-primary text-primary-foreground text-[10px] font-bold rounded-full">
                  TODAY
                </span>
              )}
            </div>

            <h3 className={`font-semibold text-foreground uppercase tracking-wide mb-1 ${
              isToday ? 'text-xl' : 'text-lg'
            }`}>
              {day?.location}
            </h3>

            <p className="text-sm text-muted-foreground mb-3">{formattedDate}</p>

            <div className="flex items-center gap-2 flex-wrap mb-2">
              {stopConfig && (
                <div className="flex items-center gap-1.5 px-2.5 py-1 bg-muted rounded-full">
                  <Icon name={stopConfig.icon} size={12} className={stopConfig.color} />
                  <span className="text-xs font-medium text-foreground">{stopConfig.label}</span>
                </div>
              )}
              {day?.stop_detail && (
                <div className="px-2.5 py-1 bg-muted rounded-full">
                  <span className="text-xs text-foreground">{day.stop_detail}</span>
                </div>
              )}
            </div>

            {day?.notes && (
              <div className="flex items-start gap-1.5 text-sm text-muted-foreground mb-2">
                <Icon name="FileText" size={14} className="mt-0.5 flex-shrink-0" />
                <span>{day.notes}</span>
              </div>
            )}

            {/* Aboard guests */}
            <div className="mb-3">
              {aboardIds.length === 0 ? (
                <p className="text-xs text-muted-foreground">All guests aboard</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {aboardIds.map(id => {
                    const name = guestNameById(guests, id);
                    if (!name) return null;
                    return (
                      <span key={id} className="px-2 py-0.5 bg-primary/10 text-primary text-[11px] font-medium rounded-full">
                        {name}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Activities */}
            <div className="border-t border-border pt-3 mt-3">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Activities
                </h4>
                {permissions?.canEdit && (
                  <button
                    onClick={() => onAddActivity(day?.id)}
                    className="flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <Icon name="Plus" size={12} />
                    Add activity
                  </button>
                )}
              </div>
              {activities.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">No activities yet.</p>
              ) : (
                <ul className="space-y-2">
                  {activities.map(act => (
                    <li key={act?.id} className="flex items-start gap-3 p-2 bg-muted/30 rounded-lg">
                      <div className="flex-shrink-0 w-16 text-xs font-medium text-foreground pt-0.5">
                        {act?.start_time
                          ? act.start_time.slice(0, 5)
                          : <span className="text-muted-foreground">—</span>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-foreground">{act?.title}</div>
                        {act?.description && (
                          <div className="text-xs text-muted-foreground mt-0.5">{act.description}</div>
                        )}
                        {act?.location && (
                          <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                            <Icon name="MapPin" size={10} />
                            <span>{act.location}</span>
                          </div>
                        )}
                        {Array.isArray(act?.linked_guest_ids) && act.linked_guest_ids.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {act.linked_guest_ids.map(id => {
                              const name = guestNameById(guests, id);
                              if (!name) return null;
                              return (
                                <span key={id} className="px-1.5 py-0.5 bg-primary/10 text-primary text-[10px] font-medium rounded-full">
                                  {name}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      {permissions?.canEdit && (
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            onClick={() => onEditActivity(day?.id, act)}
                            className="p-1 hover:bg-muted rounded transition-smooth"
                            title="Edit activity"
                          >
                            <Icon name="Edit" size={14} className="text-muted-foreground" />
                          </button>
                          <button
                            onClick={() => onDeleteActivity(act?.id)}
                            className="p-1 hover:bg-red-50 rounded transition-smooth"
                            title="Delete activity"
                          >
                            <Icon name="Trash2" size={14} className="text-red-600" />
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

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
          </div>
        </div>
      </div>
    </div>
  );
});

export default TripItineraryTimeline;
