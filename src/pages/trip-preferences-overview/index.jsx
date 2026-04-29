import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Icon from '../../components/AppIcon';
import { getTripById, getPreferencesByTripAndGuest } from '../trips-management-dashboard/utils/tripStorage';
import { loadGuests } from '../guest-management-dashboard/utils/guestStorage';
import { getCurrentUser } from '../../utils/authStorage';
import { showToast } from '../../utils/toast';
import { canAccessTrips } from '../trips-management-dashboard/utils/tripPermissions';


const TripPreferencesOverview = () => {
  const navigate = useNavigate();
  const { tripId } = useParams();
  const [currentUser, setCurrentUser] = useState(null);
  const [trip, setTrip] = useState(null);
  const [guests, setGuests] = useState([]);
  const [selectedGuest, setSelectedGuest] = useState(null);
  const [expandedSections, setExpandedSections] = useState({
    dietary: true,
    beverages: true,
    housekeeping: true,
    activities: true,
    health: true
  });

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

  const loadTripData = async () => {
    const tripData = await getTripById(tripId);
    if (!tripData) {
      showToast('Trip not found', 'error');
      navigate('/trips-management-dashboard');
      return;
    }
    setTrip(tripData);
  };

  // loadGuests + getTripById are both async — this file was not in the
  // earlier loadGuests await sweep (320c59a). Fixed during the A3.1
  // pass; matches the pattern used in trip-preferences-view.
  const loadGuestsData = async () => {
    const allGuests = (await loadGuests()) || [];
    const tripData = await getTripById(tripId);
    if (tripData) {
      const tripGuests = allGuests?.filter(g => 
        !g?.isDeleted && tripData?.guestIds?.includes(g?.id)
      );
      
      // Enrich guests with preference data
      const enrichedGuests = tripGuests?.map(guest => {
        const preferences = getPreferencesByTripAndGuest(tripId, guest?.id);
        
        return {
          ...guest,
          preferences,
          hasPreferences: preferences?.length > 0
        };
      });
      
      setGuests(enrichedGuests);
      // Auto-select first guest
      if (enrichedGuests?.length > 0) {
        setSelectedGuest(enrichedGuests?.[0]);
      }
    }
  };

  const toggleSection = (section) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev?.[section]
    }));
  };

  const getPreferenceValue = (preferences, key) => {
    const pref = preferences?.find(p => p?.key?.toLowerCase()?.includes(key?.toLowerCase()));
    return pref?.value || null;
  };

  const renderPreferenceSection = (title, icon, sectionKey, content) => {
    const isExpanded = expandedSections?.[sectionKey];
    
    return (
      <div className="bg-white dark:bg-card border border-border rounded-lg mb-3">
        {/* Section Header */}
        <div className="flex items-center justify-between p-4 cursor-pointer" onClick={() => toggleSection(sectionKey)}>
          <div className="flex items-center gap-2">
            <Icon name={icon} size={18} className="text-foreground" />
            <span className="text-sm font-semibold text-foreground">{title}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={(e) => {
                e?.stopPropagation();
                showToast('Edit functionality coming soon', 'info');
              }}
              className="text-xs text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-md hover:bg-muted/50 transition-smooth"
            >
              Edit
            </button>
            <Icon 
              name={isExpanded ? "ChevronUp" : "ChevronDown"} 
              size={16} 
              className="text-muted-foreground" 
            />
          </div>
        </div>
        {/* Section Content */}
        {isExpanded && (
          <div className="px-4 pb-4 space-y-3 border-t border-border pt-4">
            {content}
          </div>
        )}
      </div>
    );
  };

  const renderDietarySection = () => {
    if (!selectedGuest?.preferences) return <p className="text-sm text-muted-foreground">No dietary preferences</p>;
    
    const dietaryType = getPreferenceValue(selectedGuest?.preferences, 'dietary type') || 'Not specified';
    const dineOut = getPreferenceValue(selectedGuest?.preferences, 'dine-out') || getPreferenceValue(selectedGuest?.preferences, 'restaurant');
    const foodLikes = getPreferenceValue(selectedGuest?.preferences, 'food likes') || getPreferenceValue(selectedGuest?.preferences, 'likes');
    const foodDislikes = getPreferenceValue(selectedGuest?.preferences, 'food dislikes') || getPreferenceValue(selectedGuest?.preferences, 'dislikes');
    
    return (
      <>
        <div className="flex items-start gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground mt-2 flex-shrink-0"></div>
          <div className="flex-1">
            <span className="text-sm text-muted-foreground">Dietary type: </span>
            <span className="text-sm font-medium text-foreground">{dietaryType}</span>
          </div>
        </div>
        {dineOut && (
          <div className="flex items-start gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground mt-2 flex-shrink-0"></div>
            <div className="flex-1">
              <span className="text-sm text-muted-foreground">Dine-out preference: </span>
              <span className="text-sm text-foreground">{dineOut}</span>
            </div>
          </div>
        )}
        {foodLikes && (
          <div className="flex items-start gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground mt-2 flex-shrink-0"></div>
            <div className="flex-1">
              <span className="text-sm text-muted-foreground">Food likes: </span>
              <span className="text-sm text-foreground">{foodLikes}</span>
            </div>
          </div>
        )}
        {foodDislikes && (
          <div className="flex items-start gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground mt-2 flex-shrink-0"></div>
            <div className="flex-1">
              <span className="text-sm text-muted-foreground">Food dislikes: </span>
              <span className="text-sm text-foreground">{foodDislikes}</span>
            </div>
          </div>
        )}
      </>
    );
  };

  const renderBeveragesSection = () => {
    if (!selectedGuest?.preferences) return <p className="text-sm text-muted-foreground">No beverage preferences</p>;
    
    const waterPref = getPreferenceValue(selectedGuest?.preferences, 'water');
    const teaPref = getPreferenceValue(selectedGuest?.preferences, 'tea');
    const coffeePref = getPreferenceValue(selectedGuest?.preferences, 'coffee');
    const winePref = getPreferenceValue(selectedGuest?.preferences, 'wine');
    const alcoholPref = getPreferenceValue(selectedGuest?.preferences, 'alcohol');
    
    return (
      <>
        {waterPref && (
          <div className="flex items-start gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground mt-2 flex-shrink-0"></div>
            <div className="flex-1">
              <span className="text-sm text-muted-foreground">Likes: </span>
              <span className="text-sm text-foreground">{waterPref}</span>
            </div>
          </div>
        )}
        {(teaPref || coffeePref) && (
          <div className="flex items-start gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground mt-2 flex-shrink-0"></div>
            <div className="flex-1">
              <span className="text-sm text-foreground">
                {teaPref && `Herbal tea — ${teaPref}`}
                {teaPref && coffeePref && ', '}
                {coffeePref}
              </span>
            </div>
          </div>
        )}
        {(winePref || alcoholPref) && (
          <div className="flex items-start gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground mt-2 flex-shrink-0"></div>
            <div className="flex-1">
              <span className="text-sm text-muted-foreground">Wine: </span>
              <span className="text-sm text-foreground">{winePref || alcoholPref}</span>
            </div>
          </div>
        )}
        {!waterPref && !teaPref && !coffeePref && !winePref && !alcoholPref && (
          <p className="text-sm text-muted-foreground">No beverage preferences</p>
        )}
      </>
    );
  };

  const renderHousekeepingSection = () => {
    if (!selectedGuest?.preferences) return <p className="text-sm text-muted-foreground">No housekeeping preferences</p>;
    
    const pillowPref = getPreferenceValue(selectedGuest?.preferences, 'pillow');
    const sheetPref = getPreferenceValue(selectedGuest?.preferences, 'sheet');
    const ambiancePref = getPreferenceValue(selectedGuest?.preferences, 'ambiance') || getPreferenceValue(selectedGuest?.preferences, 'cabin');
    const otherNotes = getPreferenceValue(selectedGuest?.preferences, 'other notes');
    
    return (
      <>
        {pillowPref && (
          <div className="flex items-start gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground mt-2 flex-shrink-0"></div>
            <div className="flex-1">
              <span className="text-sm text-muted-foreground">Pillows: </span>
              <span className="text-sm text-foreground">{pillowPref}</span>
            </div>
          </div>
        )}
        {sheetPref && (
          <div className="flex items-start gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground mt-2 flex-shrink-0"></div>
            <div className="flex-1">
              <span className="text-sm text-muted-foreground">Sheet change: </span>
              <span className="text-sm text-foreground">{sheetPref}</span>
            </div>
          </div>
        )}
        {ambiancePref && (
          <div className="flex items-start gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground mt-2 flex-shrink-0"></div>
            <div className="flex-1">
              <span className="text-sm text-muted-foreground">Cabin ambiance: </span>
              <span className="text-sm text-foreground">{ambiancePref}</span>
            </div>
          </div>
        )}
        {otherNotes && (
          <div className="flex items-start gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground mt-2 flex-shrink-0"></div>
            <div className="flex-1">
              <span className="text-sm text-muted-foreground">Other notes: </span>
              <span className="text-sm text-foreground">{otherNotes}</span>
            </div>
          </div>
        )}
        {!pillowPref && !sheetPref && !ambiancePref && !otherNotes && (
          <p className="text-sm text-muted-foreground">No housekeeping preferences</p>
        )}
      </>
    );
  };

  const renderActivitiesSection = () => {
    if (!selectedGuest?.preferences) return <p className="text-sm text-muted-foreground">No activity preferences</p>;
    
    const interests = getPreferenceValue(selectedGuest?.preferences, 'interests') || getPreferenceValue(selectedGuest?.preferences, 'activities');
    const restrictions = getPreferenceValue(selectedGuest?.preferences, 'restrictions') || getPreferenceValue(selectedGuest?.preferences, 'other');
    
    return (
      <>
        {interests && (
          <div className="flex items-start gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground mt-2 flex-shrink-0"></div>
            <div className="flex-1">
              <span className="text-sm text-muted-foreground">Interests: </span>
              <span className="text-sm text-foreground">{interests}</span>
            </div>
          </div>
        )}
        {restrictions && (
          <div className="flex items-start gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground mt-2 flex-shrink-0"></div>
            <div className="flex-1">
              <span className="text-sm text-muted-foreground">Other: </span>
              <span className="text-sm text-foreground">{restrictions}</span>
            </div>
          </div>
        )}
        {!interests && !restrictions && (
          <p className="text-sm text-muted-foreground">No activity preferences</p>
        )}
      </>
    );
  };

  const renderHealthSection = () => {
    if (!selectedGuest?.preferences) return <p className="text-sm text-muted-foreground">No health information</p>;
    
    const allergies = selectedGuest?.allergies || getPreferenceValue(selectedGuest?.preferences, 'allergies');
    const healthNotes = getPreferenceValue(selectedGuest?.preferences, 'health notes') || getPreferenceValue(selectedGuest?.preferences, 'medical');
    const productSensitivity = getPreferenceValue(selectedGuest?.preferences, 'product') || getPreferenceValue(selectedGuest?.preferences, 'sensitivity');
    
    return (
      <>
        {allergies && (
          <div className="flex items-start gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground mt-2 flex-shrink-0"></div>
            <div className="flex-1">
              <span className="text-sm text-muted-foreground">Allergies: </span>
              <span className="text-sm text-foreground">{allergies}</span>
            </div>
          </div>
        )}
        {healthNotes && (
          <div className="flex items-start gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground mt-2 flex-shrink-0"></div>
            <div className="flex-1">
              <span className="text-sm text-muted-foreground">Health notes: </span>
              <span className="text-sm text-foreground">{healthNotes}</span>
            </div>
          </div>
        )}
        {productSensitivity && (
          <div className="flex items-start gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground mt-2 flex-shrink-0"></div>
            <div className="flex-1">
              <span className="text-sm text-muted-foreground">Prefers: </span>
              <span className="text-sm text-foreground">{productSensitivity}</span>
            </div>
          </div>
        )}
        {!allergies && !healthNotes && !productSensitivity && (
          <p className="text-sm text-muted-foreground">No health information</p>
        )}
      </>
    );
  };

  if (!currentUser || !trip) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background transition-colors duration-300">
      <Header />
      <main className="p-6 max-w-[1000px] mx-auto">
        {/* Back Button */}
        <button
          onClick={() => navigate(`/trips/${tripId}`)}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4 transition-smooth"
        >
          <Icon name="ChevronLeft" size={16} />
          Back to Trip
        </button>

        {/* Guest Header */}
        {selectedGuest && (
          <div className="bg-card border border-border rounded-xl p-6 mb-6">
            <div className="flex items-start gap-4">
              {/* Avatar */}
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <span className="text-xl font-semibold text-primary">
                  {selectedGuest?.firstName?.[0]}{selectedGuest?.lastName?.[0]}
                </span>
              </div>
              
              {/* Name and Badges */}
              <div className="flex-1">
                <h1 className="text-2xl font-semibold text-foreground mb-2">
                  {selectedGuest?.firstName} {selectedGuest?.lastName}
                </h1>
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Dietary Badge */}
                  {getPreferenceValue(selectedGuest?.preferences, 'dietary type') && (
                    <span className="inline-flex items-center gap-1.5 text-xs bg-primary/10 text-primary px-3 py-1 rounded-full font-medium">
                      <Icon name="Utensils" size={12} />
                      {getPreferenceValue(selectedGuest?.preferences, 'dietary type')}
                    </span>
                  )}
                  {/* Nationality Badge */}
                  {selectedGuest?.nationality && (
                    <span className="inline-flex items-center gap-1.5 text-xs bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 px-3 py-1 rounded-full font-medium">
                      <Icon name="Flag" size={12} />
                      {selectedGuest?.nationality}
                    </span>
                  )}
                  {/* Allergy Badge */}
                  {selectedGuest?.allergies && (
                    <span className="inline-flex items-center gap-1.5 text-xs bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 px-3 py-1 rounded-full font-medium">
                      <Icon name="AlertTriangle" size={12} />
                      {selectedGuest?.allergies}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Guest Selector (if multiple guests) */}
            {guests?.length > 1 && (
              <div className="mt-4 pt-4 border-t border-border">
                <div className="flex items-center gap-2 flex-wrap">
                  {guests?.map(guest => (
                    <button
                      key={guest?.id}
                      onClick={() => setSelectedGuest(guest)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-smooth ${
                        selectedGuest?.id === guest?.id
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground hover:bg-muted/80'
                      }`}
                    >
                      {guest?.firstName} {guest?.lastName}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Navigation Tabs */}
        <div className="flex items-center gap-1 mb-6 border-b border-border">
          <button className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-smooth">
            Overview
          </button>
          <button className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-smooth">
            Itinerary
          </button>
          <button className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-smooth">
            Calendar
          </button>
          <button className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-smooth">
            Special
          </button>
          <button className="px-4 py-2 text-sm font-medium text-foreground border-b-2 border-primary">
            Preferences
          </button>
          <button className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-smooth">
            Guests
          </button>
          <button className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-smooth">
            •••
          </button>
        </div>

        {/* Preference Sections */}
        {selectedGuest ? (
          <div className="space-y-3">
            {/* Dietary */}
            {renderPreferenceSection(
              'Dietary',
              'Utensils',
              'dietary',
              renderDietarySection()
            )}

            {/* Beverages */}
            {renderPreferenceSection(
              'Beverages',
              'Coffee',
              'beverages',
              renderBeveragesSection()
            )}

            {/* Housekeeping & Cabin */}
            {renderPreferenceSection(
              'Housekeeping & Cabin',
              'Home',
              'housekeeping',
              renderHousekeepingSection()
            )}

            {/* Activities */}
            {renderPreferenceSection(
              'Activities',
              'Activity',
              'activities',
              renderActivitiesSection()
            )}

            {/* Health & Allergies */}
            {renderPreferenceSection(
              'Health & Allergies',
              'Heart',
              'health',
              renderHealthSection()
            )}
          </div>
        ) : (
          <div className="bg-card border border-border rounded-xl p-8 text-center">
            <Icon name="Users" size={48} className="mx-auto mb-3 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No guests on this trip</p>
          </div>
        )}
      </main>
    </div>
  );
};

export default TripPreferencesOverview;