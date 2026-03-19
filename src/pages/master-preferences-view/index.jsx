import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Button from '../../components/ui/Button';
import Icon from '../../components/AppIcon';
import EditPreferenceSectionModal from './components/EditPreferenceSectionModal';
import { PreferenceCategory, getPreferencesByGuest } from '../../utils/preferencesStorage';
import { loadGuests } from '../guest-management-dashboard/utils/guestStorage';
import { loadTrips, TripStatus } from '../trips-management-dashboard/utils/tripStorage';
import { getAuditLogsByEntity, EntityType } from '../../utils/auditLogger';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../contexts/TenantContext';


const MasterPreferencesView = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const guestIdFromUrl = searchParams?.get('guestId');
  const { session } = useAuth();
  const { activeTenantId, currentTenantMember } = useTenant();
  
  const [guests, setGuests] = useState([]);
  const [selectedGuestId, setSelectedGuestId] = useState(guestIdFromUrl || null);
  const [preferences, setPreferences] = useState([]);
  const [activeTab, setActiveTab] = useState('preferences');
  const [expandedSections, setExpandedSections] = useState({});
  const [editingSection, setEditingSection] = useState(null);
  const [auditLogs, setAuditLogs] = useState([]);
  const [activeTripsGuestIds, setActiveTripsGuestIds] = useState(new Set());

  const permissionTier = currentTenantMember?.permission_tier || null;
  const isFullAccess = ['COMMAND', 'CHIEF']?.includes(permissionTier);
  const isLimitedAccess = ['HOD', 'CREW']?.includes(permissionTier);
  const isBlocked = permissionTier === 'VIEW_ONLY';

  // Redirect VIEW_ONLY users
  useEffect(() => {
    if (isBlocked) {
      navigate('/dashboard', { replace: true });
    }
  }, [isBlocked, navigate]);

  // Load active trip guest IDs for HOD/CREW permission check
  useEffect(() => {
    if (isLimitedAccess) {
      try {
        const allTrips = loadTrips();
        const activeTrips = allTrips?.filter(t => t?.status === TripStatus?.ACTIVE && !t?.isDeleted) || [];
        const ids = new Set(activeTrips?.flatMap(t => t?.guestIds || []));
        setActiveTripsGuestIds(ids);
      } catch (err) {
        console.error('[MasterPreferencesView] loadActiveTrips error:', err);
      }
    }
  }, [isLimitedAccess]);

  // Load guests
  useEffect(() => {
    loadGuestsData();
  }, [activeTenantId]);

  // Load preferences and audit logs when guest is selected
  useEffect(() => {
    if (selectedGuestId) {
      loadPreferencesData();
      loadAuditLogsData();
    }
  }, [selectedGuestId, activeTenantId]);

  const loadGuestsData = async () => {
    try {
      const allGuests = await loadGuests(activeTenantId);
      const activeGuests = Array.isArray(allGuests) ? allGuests?.filter(g => !g?.isDeleted) : [];

      // For HOD/CREW: only show guests on active trips in the guest selector
      const visibleGuests = isLimitedAccess
        ? activeGuests?.filter(g => activeTripsGuestIds?.has(g?.id))
        : activeGuests;

      setGuests(visibleGuests);
      if (visibleGuests?.length > 0 && !selectedGuestId) {
        setSelectedGuestId(visibleGuests?.[0]?.id);
      }
    } catch (err) {
      console.error('[MasterPreferencesView] loadGuestsData error:', err);
      setGuests([]);
    }
  };

  const loadPreferencesData = async () => {
    try {
      const prefs = await getPreferencesByGuest(selectedGuestId, activeTenantId);
      setPreferences(prefs || []);
    } catch (err) {
      console.error('[MasterPreferencesView] loadPreferencesData error:', err);
      setPreferences([]);
    }
  };

  const loadAuditLogsData = () => {
    const logs = getAuditLogsByEntity(EntityType?.GUEST, selectedGuestId);
    setAuditLogs(logs);
  };

  const selectedGuest = guests?.find(g => g?.id === selectedGuestId);

  // For HOD/CREW: check if selected guest is on an active trip
  const selectedGuestIsOnActiveTrip = isFullAccess || activeTripsGuestIds?.has(selectedGuestId);
  // HOD/CREW can only edit if guest is on active trip
  const canEdit = isFullAccess || (isLimitedAccess && selectedGuestIsOnActiveTrip);

  const toggleSection = (sectionKey) => {
    setExpandedSections(prev => ({
      ...prev,
      [sectionKey]: !prev?.[sectionKey]
    }));
  };

  const handleEditSection = (sectionKey) => {
    if (!canEdit) return;
    setEditingSection(sectionKey);
  };

  const handleSaveSection = () => {
    setEditingSection(null);
    loadPreferencesData();
    loadAuditLogsData();
  };

  const formatTimestamp = (timestamp) => {
    const date = new Date(timestamp);
    return date?.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const getPriorityBadgeColor = (priority) => {
    switch (priority) {
      case 'high':
        return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400';
      case 'normal':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400';
      case 'low':
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400';
    }
  };

  // Define preference sections
  const preferenceSections = [
    {
      key: 'allergies_medical',
      title: 'Allergies & Medical',
      icon: 'Shield',
      category: PreferenceCategory?.ALLERGIES,
    },
    {
      key: 'food_drink',
      title: 'Food & Drink',
      icon: 'Coffee',
      category: PreferenceCategory?.FOOD_BEVERAGE
    },
    {
      key: 'cooking_instructions',
      title: 'Cooking Instructions',
      icon: 'ChefHat',
      category: PreferenceCategory?.DIETARY
    },
    {
      key: 'service_style',
      title: 'Service Information',
      icon: 'Users',
      category: PreferenceCategory?.SERVICE
    },
    {
      key: 'cabin_comfort',
      title: 'Cabin & Comfort',
      icon: 'Home',
      category: PreferenceCategory?.CABIN
    },
    {
      key: 'activities_lifestyle',
      title: 'Activities & Lifestyle',
      icon: 'Activity',
      category: PreferenceCategory?.ACTIVITIES
    },
    {
      key: 'routine',
      title: 'Routine',
      icon: 'Clock',
      category: PreferenceCategory?.ROUTINE
    },
    {
      key: 'notes',
      title: 'Notes',
      icon: 'FileText',
      category: PreferenceCategory?.OTHER
    }
  ];

  const getSectionPreferences = (category) => {
    return preferences?.filter(p => p?.category === category);
  };

  const getSectionSummary = (sectionPrefs) => {
    if (!sectionPrefs || sectionPrefs?.length === 0) return 'No preferences recorded';
    const firstPref = sectionPrefs?.[0];
    return `${sectionPrefs?.length} preference${sectionPrefs?.length > 1 ? 's' : ''} • ${firstPref?.key || 'Various'}`;
  };

  const getLastUpdated = (sectionPrefs) => {
    if (!sectionPrefs || sectionPrefs?.length === 0) return null;
    const sorted = [...sectionPrefs]?.sort((a, b) => new Date(b?.updatedAt) - new Date(a?.updatedAt));
    return sorted?.[0];
  };

  const renderGuestHeader = () => {
    if (!selectedGuest) return null;

    const badges = [];
    if (selectedGuest?.allergies) badges?.push({ label: 'Allergies', color: 'bg-red-100 text-red-800' });
    if (selectedGuest?.healthConditions) badges?.push({ label: 'Medical', color: 'bg-orange-100 text-orange-800' });
    if (selectedGuest?.nationality) badges?.push({ label: selectedGuest?.nationality, color: 'bg-blue-100 text-blue-800' });

    return (
      <div className="bg-card border border-border rounded-xl p-6 mb-6">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Icon name="User" size={32} className="text-primary" />
            </div>
            <div>
              <h2 className="text-2xl font-semibold text-foreground mb-2">
                {selectedGuest?.firstName} {selectedGuest?.lastName}
              </h2>
              <div className="flex flex-wrap gap-2 mb-3">
                {badges?.map((badge, idx) => (
                  <span key={idx} className={`px-3 py-1 rounded-full text-xs font-medium ${badge?.color}`}>
                    {badge?.label}
                  </span>
                ))}
              </div>
              {selectedGuest?.cabinLocationPath && (
                <p className="text-sm text-muted-foreground">
                  Cabin: {selectedGuest?.cabinLocationPath?.split('>')?.pop()?.trim()}
                </p>
              )}
            </div>
          </div>
          {isFullAccess && (
            <Button variant="outline" iconName="Edit" onClick={() => navigate(`/guest-management?guestId=${selectedGuestId}`)}>
              Edit Profile
            </Button>
          )}
        </div>
      </div>
    );
  };

  const renderTabs = () => {
    const tabs = [
      { key: 'preferences', label: 'Preferences', icon: 'Star' },
      { key: 'trips', label: 'Trips', icon: 'Ship' },
      { key: 'comments', label: 'Comments', icon: 'MessageSquare' },
      { key: 'history', label: 'History', icon: 'Clock' }
    ];

    return (
      <div className="flex gap-2 mb-6 border-b border-border">
        {tabs?.map(tab => (
          <button
            key={tab?.key}
            onClick={() => setActiveTab(tab?.key)}
            className={`flex items-center gap-2 px-4 py-3 font-medium transition-colors border-b-2 ${
              activeTab === tab?.key
                ? 'border-primary text-primary' :'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon name={tab?.icon} size={16} />
            {tab?.label}
          </button>
        ))}
      </div>
    );
  };

  const renderPreferenceSection = (section) => {
    const sectionPrefs = getSectionPreferences(section?.category);
    const isExpanded = expandedSections?.[section?.key];
    const lastUpdated = getLastUpdated(sectionPrefs);

    return (
      <div
        key={section?.key}
        className={`bg-card border rounded-xl overflow-hidden ${
          section?.isPriority ? 'border-red-500 shadow-lg' : 'border-border'
        }`}
      >
        {/* Collapsed Header */}
        <div className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 flex-1">
              <button
                onClick={() => toggleSection(section?.key)}
                className="p-2 hover:bg-muted rounded-lg transition-colors"
              >
                <Icon
                  name={isExpanded ? 'ChevronDown' : 'ChevronRight'}
                  size={20}
                  className="text-muted-foreground"
                />
              </button>
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                section?.isPriority ? 'bg-red-100 dark:bg-red-900/30' : 'bg-primary/10'
              }`}>
                <Icon
                  name={section?.icon}
                  size={20}
                  className={section?.isPriority ? 'text-red-600 dark:text-red-400' : 'text-primary'}
                />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-foreground">{section?.title}</h3>
                <p className="text-sm text-muted-foreground">{getSectionSummary(sectionPrefs)}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {lastUpdated && (
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Last updated</p>
                  <p className="text-xs font-medium text-foreground">{formatTimestamp(lastUpdated?.updatedAt)}</p>
                  <p className="text-xs text-muted-foreground">by {lastUpdated?.updatedByUserName}</p>
                </div>
              )}
              {canEdit && (
                <Button
                  variant="outline"
                  size="sm"
                  iconName="Edit"
                  onClick={() => handleEditSection(section?.key)}
                >
                  Edit
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Expanded Content */}
        {isExpanded && (
          <div className="px-4 pb-4 border-t border-border pt-4">
            {sectionPrefs?.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">No preferences recorded for this section</p>
            ) : (
              <div className="space-y-3">
                {sectionPrefs?.map((pref) => (
                  <div key={pref?.id} className="flex items-start gap-3 p-3 bg-muted/30 rounded-lg">
                    <Icon name="Circle" size={8} className="text-primary mt-1.5" />
                    <div className="flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium text-foreground">{pref?.key}</p>
                          <p className="text-sm text-muted-foreground mt-1">{pref?.value}</p>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {pref?.priority && pref?.priority !== 'normal' && (
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getPriorityBadgeColor(pref?.priority)}`}>
                              {pref?.priority?.toUpperCase()}
                            </span>
                          )}
                          {pref?.tags?.map((tag, idx) => (
                            <span key={idx} className="px-2 py-0.5 bg-primary/10 text-primary rounded-full text-xs font-medium">
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderPreferencesTab = () => {
    // Sort sections to ensure Allergies & Medical is always first
    const sortedSections = [...preferenceSections]?.sort((a, b) => {
      if (a?.isPriority) return -1;
      if (b?.isPriority) return 1;
      return 0;
    });

    return (
      <div className="space-y-4">
        {sortedSections?.map(section => renderPreferenceSection(section))}
      </div>
    );
  };

  const renderTripsTab = () => {
    return (
      <div className="bg-card border border-border rounded-xl p-6">
        <p className="text-sm text-muted-foreground">Trip history for this guest will be displayed here.</p>
      </div>
    );
  };

  const renderCommentsTab = () => {
    return (
      <div className="bg-card border border-border rounded-xl p-6">
        <p className="text-sm text-muted-foreground">Comments and notes for this guest will be displayed here.</p>
      </div>
    );
  };

  const renderHistoryTab = () => {
    return (
      <div className="bg-card border border-border rounded-xl p-6">
        <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
          <Icon name="Clock" size={18} />
          Preference Change History
        </h3>
        {auditLogs?.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No history available</p>
        ) : (
          <div className="space-y-3">
            {auditLogs?.map((log) => (
              <div key={log?.id} className="p-4 bg-muted/30 rounded-lg border border-border">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 text-xs font-medium rounded ${
                      log?.action === 'CREATED' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' :
                      log?.action === 'UPDATED' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' :
                      log?.action === 'DELETED'? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' : 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400'
                    }`}>
                      {log?.action}
                    </span>
                    <span className="text-sm font-medium text-foreground">{log?.userName}</span>
                    <span className="text-xs text-muted-foreground">({log?.userRole})</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {formatTimestamp(log?.timestamp)}
                  </span>
                </div>
                {log?.changes && log?.changes?.length > 0 && (
                  <div className="space-y-1">
                    {log?.changes?.map((change, idx) => (
                      <div key={idx} className="text-sm">
                        <span className="font-medium text-foreground">{change?.field}:</span>
                        <span className="text-muted-foreground ml-2">
                          {change?.before ? `"${change?.before}"` : 'empty'} → {change?.after ? `"${change?.after}"` : 'empty'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // VIEW_ONLY: blocked (redirect handled by useEffect)
  if (isBlocked) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background transition-colors duration-300">
      <Header />
      <main className="p-6 max-w-[1400px] mx-auto pt-24">
        {/* Page Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-foreground mb-1">Guest Preferences</h1>
          <p className="text-sm text-muted-foreground">Master preference system - single source of truth across all trips</p>
        </div>

        {/* Guest Header */}
        {renderGuestHeader()}

        {/* Tabs */}
        {renderTabs()}

        {/* Tab Content */}
        {activeTab === 'preferences' && renderPreferencesTab()}
        {activeTab === 'trips' && renderTripsTab()}
        {activeTab === 'comments' && renderCommentsTab()}
        {activeTab === 'history' && renderHistoryTab()}
      </main>

      {/* Edit Section Modal */}
      {editingSection && (
        <EditPreferenceSectionModal
          isOpen={!!editingSection}
          onClose={() => setEditingSection(null)}
          onSave={handleSaveSection}
          guestId={selectedGuestId}
          tenantId={activeTenantId}
          section={preferenceSections?.find(s => s?.key === editingSection)}
          existingPreferences={getSectionPreferences(
            preferenceSections?.find(s => s?.key === editingSection)?.category
          )}
          initialEditPrefId={null}
          initialPrefType={null}
        />
      )}
    </div>
  );
};

export default MasterPreferencesView;