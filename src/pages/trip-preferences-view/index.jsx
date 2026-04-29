import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Button from '../../components/ui/Button';
import Icon from '../../components/AppIcon';
import AddPreferenceModal from './components/AddPreferenceModal';
import { getTripById, getPreferencesByTripAndGuest, deletePreference, PreferenceCategory } from '../trips-management-dashboard/utils/tripStorage';
import { loadGuests } from '../guest-management-dashboard/utils/guestStorage';
import { getCurrentUser } from '../../utils/authStorage';
import { showToast } from '../../utils/toast';
import { canAccessTrips, canManagePreferences } from '../trips-management-dashboard/utils/tripPermissions';


const TripPreferencesView = () => {
  const navigate = useNavigate();
  const { tripId } = useParams();
  const [currentUser, setCurrentUser] = useState(null);
  const [trip, setTrip] = useState(null);
  const [guests, setGuests] = useState([]);
  const [selectedGuestId, setSelectedGuestId] = useState(null);
  const [preferences, setPreferences] = useState([]);
  const [guestSearchQuery, setGuestSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingPreference, setEditingPreference] = useState(null);
  const [guestFilter, setGuestFilter] = useState('all'); // 'all' or 'active'

  const permissions = {
    canManage: canManagePreferences(currentUser)
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
    }
  }, [tripId]);

  // Load preferences when guest is selected
  useEffect(() => {
    if (selectedGuestId && tripId) {
      loadPreferencesData();
    }
  }, [selectedGuestId, tripId]);

  const loadTripData = async () => {
    const tripData = await getTripById(tripId);
    if (!tripData) {
      showToast('Trip not found', 'error');
      navigate('/trips-management-dashboard');
      return;
    }
    setTrip(tripData);
  };

  const loadGuestsData = async () => {
    try {
      const data = await loadGuests();
      const allGuests = data || [];
      const tripData = await getTripById(tripId);
      if (tripData) {
        const tripGuests = allGuests.filter(g =>
          !g?.isDeleted && tripData?.guestIds?.includes(g?.id)
        );
        setGuests(tripGuests);
        if (tripGuests.length > 0 && !selectedGuestId) {
          setSelectedGuestId(tripGuests[0]?.id);
        }
      }
    } catch (err) {
      console.error('[trip-preferences-view] loadGuestsData failed:', err);
      setGuests([]);
    }
  };

  const loadPreferencesData = () => {
    const prefs = getPreferencesByTripAndGuest(tripId, selectedGuestId);
    setPreferences(prefs);
  };

  const handleAddPreference = () => {
    setEditingPreference(null);
    setShowAddModal(true);
  };

  const handleEditPreference = (preference) => {
    setEditingPreference(preference);
    setShowAddModal(true);
  };

  const handleDeletePreference = (preferenceId) => {
    if (window.confirm('Are you sure you want to delete this preference?')) {
      const success = deletePreference(preferenceId);
      if (success) {
        showToast('Preference deleted successfully', 'success');
        loadPreferencesData();
      } else {
        showToast('Failed to delete preference', 'error');
      }
    }
  };

  const handleModalSave = () => {
    setShowAddModal(false);
    loadPreferencesData();
  };

  const formatCabinLevel3 = (cabinValue) => {
    if (!cabinValue) return '';
    const raw = String(cabinValue)?.trim();
    if (!raw) return '';
    const parts = raw?.split('>')?.map(p => p?.trim())?.filter(Boolean);
    if (parts?.length === 0) return '';
    return parts?.[parts?.length - 1];
  };

  const formatTimestamp = (timestamp) => {
    const date = new Date(timestamp);
    return date?.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'high':
        return 'bg-red-100 text-red-800';
      case 'normal':
        return 'bg-blue-100 text-blue-800';
      case 'low':
        return 'bg-gray-100 text-gray-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const filteredGuests = guests?.filter(guest => {
    // Apply active filter
    if (guestFilter === 'active') {
      const guestData = trip?.guests?.find(g => g?.guestId === guest?.id);
      if (!guestData?.isActive) return false;
    }
    
    // Apply search filter
    if (!guestSearchQuery?.trim()) return true;
    const query = guestSearchQuery?.toLowerCase();
    const fullName = `${guest?.firstName} ${guest?.lastName}`?.toLowerCase();
    return fullName?.includes(query);
  });

  const filteredPreferences = preferences?.filter(pref => {
    if (categoryFilter === 'all') return true;
    return pref?.category === categoryFilter;
  });

  const selectedGuest = guests?.find(g => g?.id === selectedGuestId);

  const categoryOptions = [
    { value: 'all', label: 'All' },
    { value: PreferenceCategory?.FOOD_BEVERAGE, label: 'Food & Beverage' },
    { value: PreferenceCategory?.DIETARY, label: 'Dietary' },
    { value: PreferenceCategory?.ALLERGIES, label: 'Allergies' },
    { value: PreferenceCategory?.SERVICE, label: 'Service' },
    { value: PreferenceCategory?.CABIN, label: 'Cabin' },
    { value: PreferenceCategory?.ACTIVITIES, label: 'Activities' },
    { value: PreferenceCategory?.OTHER, label: 'Other' }
  ];

  if (!currentUser || !trip) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background transition-colors duration-300">
      <Header />
      <main className="p-6 max-w-[1800px] mx-auto">
        {/* Back Button */}
        <button
          onClick={() => navigate(`/trips/${tripId}`)}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4 transition-smooth"
        >
          <Icon name="ChevronLeft" size={16} />
          Back to Trip Detail
        </button>

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-foreground mb-1">Trip Preferences</h1>
          <p className="text-sm text-muted-foreground">{trip?.name}</p>
        </div>

        {/* Main Layout: Left Panel (Guests) + Right Panel (Preferences) */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Panel: Guest List */}
          <div className="lg:col-span-1">
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              {/* Guest Search */}
              <div className="p-4 border-b border-border">
                {/* Filter Toggle */}
                <div className="flex items-center gap-2 mb-3">
                  <button
                    onClick={() => setGuestFilter('all')}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-smooth ${
                      guestFilter === 'all' ?'bg-primary text-primary-foreground' :'bg-muted text-muted-foreground hover:bg-muted/80'
                    }`}
                  >
                    All assigned
                  </button>
                  <button
                    onClick={() => setGuestFilter('active')}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-smooth ${
                      guestFilter === 'active' ?'bg-primary text-primary-foreground' :'bg-muted text-muted-foreground hover:bg-muted/80'
                    }`}
                  >
                    Active only
                  </button>
                </div>
                
                <div className="relative">
                  <Icon
                    name="Search"
                    size={16}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  />
                  <input
                    type="text"
                    placeholder="Search guests..."
                    value={guestSearchQuery}
                    onChange={(e) => setGuestSearchQuery(e?.target?.value)}
                    className="w-full pl-9 pr-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              </div>

              {/* Guest List */}
              <div className="max-h-[600px] overflow-y-auto">
                {filteredGuests?.length === 0 ? (
                  <div className="p-4 text-center text-sm text-muted-foreground">
                    No guests found
                  </div>
                ) : (
                  filteredGuests?.map((guest) => {
                    const isSelected = guest?.id === selectedGuestId;
                    const cabin = formatCabinLevel3(guest?.cabinLocationPath);
                    const guestData = trip?.guests?.find(g => g?.guestId === guest?.id);
                    const isActive = guestData?.isActive || false;
                    
                    return (
                      <button
                        key={guest?.id}
                        onClick={() => setSelectedGuestId(guest?.id)}
                        className={`w-full p-4 flex items-center gap-3 border-b border-border hover:bg-muted/50 transition-smooth text-left ${
                          isSelected ? 'bg-muted border-l-4 border-l-primary' : ''
                        }`}
                      >
                        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <Icon name="User" size={20} className="text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-foreground truncate">
                              {guest?.firstName} {guest?.lastName}
                            </p>
                            {isActive && (
                              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-success/10 text-success">
                                Active
                              </span>
                            )}
                          </div>
                          {cabin && (
                            <p className="text-xs text-muted-foreground truncate">{cabin}</p>
                          )}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* Right Panel: Preferences */}
          <div className="lg:col-span-2">
            {selectedGuest ? (
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                {/* Preferences Header */}
                <div className="p-6 border-b border-border">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h2 className="text-lg font-semibold text-foreground">
                        {selectedGuest?.firstName} {selectedGuest?.lastName}
                      </h2>
                      <p className="text-sm text-muted-foreground">Guest Preferences</p>
                    </div>
                    {permissions?.canManage && (
                      <Button onClick={handleAddPreference} className="flex items-center gap-2">
                        <Icon name="Plus" size={16} />
                        Add Preference
                      </Button>
                    )}
                  </div>

                  {/* Category Filter Chips */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {categoryOptions?.map((cat) => (
                      <button
                        key={cat?.value}
                        onClick={() => setCategoryFilter(cat?.value)}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium transition-smooth ${
                          categoryFilter === cat?.value
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground hover:bg-muted/80'
                        }`}
                      >
                        {cat?.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Preferences List */}
                <div className="p-6 space-y-4 max-h-[600px] overflow-y-auto">
                  {filteredPreferences?.length === 0 ? (
                    <div className="text-center py-12">
                      <Icon name="FileText" size={48} className="mx-auto mb-4 text-muted-foreground opacity-50" />
                      <p className="text-muted-foreground mb-2">No preferences found</p>
                      {permissions?.canManage && (
                        <Button onClick={handleAddPreference} variant="outline" className="mt-4">
                          Add first preference
                        </Button>
                      )}
                    </div>
                  ) : (
                    filteredPreferences?.map((pref) => (
                      <div
                        key={pref?.id}
                        className="bg-background border border-border rounded-lg p-4 hover:shadow-md transition-smooth"
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <h3 className="text-sm font-semibold text-foreground">{pref?.key}</h3>
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getPriorityColor(pref?.priority)}`}>
                                {pref?.priority}
                              </span>
                            </div>
                            <p className="text-sm text-muted-foreground mb-2">{pref?.value}</p>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
                                {pref?.category}
                              </span>
                              {pref?.tags?.map((tag, idx) => (
                                <span key={idx} className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
                                  {tag}
                                </span>
                              ))}
                            </div>
                          </div>
                          {permissions?.canManage && (
                            <div className="flex items-center gap-1 ml-4">
                              <button
                                onClick={() => handleEditPreference(pref)}
                                className="p-2 hover:bg-muted rounded-lg transition-smooth"
                                title="Edit preference"
                              >
                                <Icon name="Edit" size={16} className="text-muted-foreground" />
                              </button>
                              <button
                                onClick={() => handleDeletePreference(pref?.id)}
                                className="p-2 hover:bg-destructive/10 rounded-lg transition-smooth"
                                title="Delete preference"
                              >
                                <Icon name="Trash2" size={16} className="text-destructive" />
                              </button>
                            </div>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Last updated {formatTimestamp(pref?.updatedAt)} by {pref?.updatedByUserName}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : (
              <div className="bg-card border border-border rounded-xl p-12 text-center">
                <Icon name="Users" size={48} className="mx-auto mb-4 text-muted-foreground opacity-50" />
                <p className="text-muted-foreground">Select a guest to view preferences</p>
              </div>
            )}
          </div>
        </div>
      </main>
      {/* Add/Edit Preference Modal */}
      {showAddModal && (
        <AddPreferenceModal
          isOpen={showAddModal}
          onClose={() => setShowAddModal(false)}
          onSave={handleModalSave}
          tripId={tripId}
          guestId={selectedGuestId}
          editingPreference={editingPreference}
        />
      )}
    </div>
  );
};

export default TripPreferencesView;