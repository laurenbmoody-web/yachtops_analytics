import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Header from '../../components/navigation/Header';
import Button from '../../components/ui/Button';
import Icon from '../../components/AppIcon';
import EditPreferenceSectionModal from '../master-preferences-view/components/EditPreferenceSectionModal';
import { PreferenceCategory, getPreferencesByGuest, createPreference, updatePreference, deletePreference } from '../../utils/preferencesStorage';
import { loadGuests } from '../guest-management-dashboard/utils/guestStorage';
import { loadTrips, TripStatus } from '../trips-management-dashboard/utils/tripStorage';
import { getAuditLogsByEntity, EntityType } from '../../utils/auditLogger';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../contexts/TenantContext';
import { supabase } from '../../lib/supabaseClient';
import PreferenceAssistantWizard from './components/PreferenceAssistantWizard';
import AverageDayModal from './components/AverageDayModal';
import ExportPreferencesModal from './components/ExportPreferencesModal';

// ─── Utility: convert snake_case / raw values to readable text ───────────────
const formatDisplayValue = (str) => {
  if (!str) return str;
  return String(str)?.replace(/_/g, ' ')?.replace(/-/g, ' ')?.replace(/\b\w/g, c => c?.toUpperCase())?.trim();
};

// ─── Utility: parse dining service style stored value into { meal, style } ───
// Handles formats:
//   "Buffet (Breakfast)"  → { meal: 'Breakfast', style: 'Buffet' }
//   "american_plated (Dinner)" → { meal: 'Dinner', style: 'American Plated' }
//   "Breakfast — Buffet"  → { meal: 'Breakfast', style: 'Buffet' }
const parseDiningServiceStyle = (value) => {
  if (!value) return null;
  // Format: "Style (Meal)" e.g. "Buffet (Breakfast)" or "American (Plated) (Dinner)"
  // Use greedy match so the LAST parenthetical is always the meal context
  const parenMatch = value?.match(/^(.+)\s*\(([^)]+)\)$/);
  if (parenMatch) {
    return {
      meal: formatDisplayValue(parenMatch?.[2]?.trim()),
      style: formatDisplayValue(parenMatch?.[1]?.trim()),
    };
  }
  // Format: "Meal — Style" e.g. "Breakfast — Buffet"
  const dashMatch = value?.match(/^(.+?)\s*[\u2014\-]{1,2}\s*(.+)$/);
  if (dashMatch) {
    return {
      meal: formatDisplayValue(dashMatch?.[1]?.trim()),
      style: formatDisplayValue(dashMatch?.[2]?.trim()),
    };
  }
  // Format: "Meal • Style" e.g. "Breakfast • Buffet"
  const bulletMatch = value?.match(/^(.+?)\s*[\u2022]\s*(.+)$/);
  if (bulletMatch) {
    return {
      meal: formatDisplayValue(bulletMatch?.[1]?.trim()),
      style: formatDisplayValue(bulletMatch?.[2]?.trim()),
    };
  }
  return null;
};

const MEAL_ORDER = ['Breakfast', 'Brunch', 'Lunch', 'Dinner'];

// ─── Preference Card (individual item) ───────────────────────────────────────
const PreferenceCard = ({ pref, sectionKey, getConfidenceBadgeStyle, formatTimestamp, onEdit, canEdit, canDelete, onDelete, forceExpanded }) => {
  const [isExpanded, setExpanded] = useState(forceExpanded || false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isAvoid = pref?.prefType === 'avoid';
  const visibleTags = pref?.tags?.filter(t => t !== 'auto_synced' && t !== 'auto synced') || [];
  const confidenceStyle = getConfidenceBadgeStyle(pref?.confidence);
  const hasImage = !!pref?.preferenceImageUrl;

  // Format display value based on key type
  const getDisplayValue = (key, value) => {
    if (key === 'Dining Service Style' && value) {
      const parsed = parseDiningServiceStyle(value);
      if (parsed) return `${parsed?.meal} \u2014 ${parsed?.style}`;
    }
    return formatDisplayValue(value);
  };

  const displayValue = getDisplayValue(pref?.key, pref?.value);
  const displayKey = formatDisplayValue(pref?.key);

  return (
    <div className={`border rounded-lg overflow-hidden ${
      isAvoid
        ? 'bg-muted/40 border-border/60 border-l-2 border-l-red-400 dark:border-l-red-500' :'bg-muted/40 border-border/60'
    }`}>
      {/* Collapsed row */}
      <div className="flex items-center gap-2 px-3 py-2.5">
        {/* Left: name + instruction — clicking expands */}
        <button
          onClick={() => setExpanded(prev => !prev)}
          className="flex-1 min-w-0 text-left"
        >
          <div className="flex items-center gap-1.5">
            {isAvoid && (
              <span className="text-xs font-medium text-red-500/80 dark:text-red-400/70 flex-shrink-0">Avoid —</span>
            )}
            <span className="text-sm font-semibold text-foreground">{displayKey}</span>
          </div>
          {displayValue && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{displayValue}</p>
          )}
        </button>

        {/* Right: tags + confidence + image indicator + pen icon + chevron */}
        <div className="flex items-center gap-1 flex-shrink-0 flex-wrap justify-end">
          {visibleTags?.map((tag, idx) => (
            <span
              key={idx}
              className="px-1.5 py-0.5 rounded-full text-xs bg-primary/10 text-primary font-medium"
            >
              {tag}
            </span>
          ))}
          {pref?.confidence && confidenceStyle && (
            <span className={`px-1.5 py-0.5 rounded-full text-xs font-medium ${confidenceStyle}`}>
              {pref?.confidence}
            </span>
          )}

          {/* Image indicator icon (collapsed view only) */}
          {hasImage && !isExpanded && (
            <span title="Has image" className="flex-shrink-0 text-muted-foreground/60">
              <Icon name="Image" size={13} />
            </span>
          )}

          {/* Pen icon — to the right of tags, next to chevron */}
          {canEdit && (
            <button
              onClick={(e) => {
                e?.stopPropagation();
                onEdit && onEdit(sectionKey, pref?.id);
              }}
              className="flex-shrink-0 p-1 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
              title="Edit preference"
            >
              <Icon name="Pencil" size={13} />
            </button>
          )}

          {/* Trash icon — COMMAND/CHIEF only */}
          {canDelete && !confirmDelete && (
            <button
              onClick={(e) => {
                e?.stopPropagation();
                setConfirmDelete(true);
              }}
              className="flex-shrink-0 p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-colors"
              title="Delete preference"
            >
              <Icon name="Trash2" size={13} />
            </button>
          )}

          {/* Inline delete confirm */}
          {canDelete && confirmDelete && (
            <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e?.stopPropagation()}>
              <span className="text-xs text-muted-foreground">Delete?</span>
              <button
                onClick={async (e) => {
                  e?.stopPropagation();
                  await onDelete?.(pref?.id);
                  setConfirmDelete(false);
                }}
                className="px-1.5 py-0.5 text-xs rounded bg-red-500 text-white hover:bg-red-600 transition-colors"
              >
                Yes
              </button>
              <button
                onClick={(e) => {
                  e?.stopPropagation();
                  setConfirmDelete(false);
                }}
                className="px-1.5 py-0.5 text-xs rounded bg-muted text-foreground hover:bg-muted/80 transition-colors"
              >
                No
              </button>
            </div>
          )}

          <button
            onClick={() => setExpanded(prev => !prev)}
            className="p-0.5"
          >
            <Icon
              name={isExpanded ? 'ChevronUp' : 'ChevronDown'}
              size={14}
              className="text-muted-foreground ml-0.5"
            />
          </button>
        </div>
      </div>
      {/* Expanded detail */}
      {isExpanded && (
        <div className="px-3 pb-3 border-t border-border/60 pt-2.5 space-y-3">
          {/* Further Information */}
          {displayValue && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Further Information</p>
              <p className="text-sm text-foreground">{displayValue}</p>
            </div>
          )}

          {/* Tags */}
          {visibleTags?.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Tags</p>
              <div className="flex flex-wrap gap-1">
                {visibleTags?.map((tag, idx) => (
                  <span
                    key={idx}
                    className="px-2 py-0.5 rounded-full text-xs bg-primary/10 text-primary font-medium"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Confidence */}
          {pref?.confidence && confidenceStyle && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Confidence</p>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${confidenceStyle}`}>
                {pref?.confidence}
              </span>
            </div>
          )}

          {/* Time of Day */}
          {pref?.timeOfDay && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Time of Day</p>
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 capitalize">
                {pref?.timeOfDay}
              </span>
            </div>
          )}

          {/* Preference Image */}
          {pref?.preferenceImageUrl && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Image</p>
              <img
                src={pref?.preferenceImageUrl}
                alt="Preference reference image"
                className="w-full max-h-48 object-cover rounded-lg border border-border"
              />
            </div>
          )}

          {/* History */}
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">History</p>
            <div className="space-y-0.5">
              {pref?.createdAt && (
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium">Created:</span>{' '}
                  {formatTimestamp(pref?.createdAt)}
                  {pref?.createdBy && <span> &bull; {pref?.updatedByUserName || 'Unknown'}</span>}
                </p>
              )}
              {pref?.updatedAt && (
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium">Updated:</span>{' '}
                  {formatTimestamp(pref?.updatedAt)}
                  {pref?.updatedByUserName && <span> &bull; {pref?.updatedByUserName}</span>}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Dining Service Style Grouped Card ───────────────────────────────────────
// Groups all dining_service_style prefs into ONE card with meal-order rows
const DiningServiceStyleGroupCard = ({ prefs, sectionKey, getConfidenceBadgeStyle, onEdit, canEdit, canDelete, onDelete }) => {
  const [expanded, setExpanded] = useState(false);

  // Parse each pref and sort by meal order
  const rows = prefs?.map(pref => {
      const parsed = parseDiningServiceStyle(pref?.value);
      return { pref, parsed };
    })?.filter(r => r?.parsed)?.sort((a, b) => {
      const ai = MEAL_ORDER?.indexOf(a?.parsed?.meal);
      const bi = MEAL_ORDER?.indexOf(b?.parsed?.meal);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

  // Also include any prefs that couldn't be parsed (show raw formatted value)
  const unparsedRows = prefs?.map(pref => ({ pref, parsed: parseDiningServiceStyle(pref?.value) }))?.filter(r => !r?.parsed);

  const allRows = [...rows, ...unparsedRows];

  if (allRows?.length === 0) return null;

  // Summary line for collapsed view
  const summaryText = rows?.map(r => `${r?.parsed?.meal} \u2014 ${r?.parsed?.style}`)?.join(', ');

  return (
    <div className="border rounded-lg overflow-hidden bg-muted/40 border-border/60">
      {/* Collapsed header row */}
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          onClick={() => setExpanded(prev => !prev)}
          className="flex-1 min-w-0 text-left"
        >
          <span className="text-sm font-semibold text-foreground">Dining Service Style</span>
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{summaryText}</p>
        </button>
        <div className="flex items-center gap-1 flex-shrink-0">
          {canEdit && (
            <button
              onClick={(e) => {
                e?.stopPropagation();
                onEdit && onEdit(sectionKey, prefs?.[0]?.id);
              }}
              className="flex-shrink-0 p-1 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
              title="Edit preference"
            >
              <Icon name="Pencil" size={13} />
            </button>
          )}
          <button onClick={() => setExpanded(prev => !prev)} className="p-0.5">
            <Icon name={expanded ? 'ChevronUp' : 'ChevronDown'} size={14} className="text-muted-foreground ml-0.5" />
          </button>
        </div>
      </div>
      {/* Expanded: one line per meal */}
      {expanded && (
        <div className="px-3 pb-3 border-t border-border/60 pt-2.5 space-y-1">
          {rows?.map(({ pref, parsed }, idx) => (
            <div key={pref?.id || idx} className="flex items-center justify-between gap-2">
              <span className="text-sm text-foreground">
                <span className="font-medium">{parsed?.meal}</span>
                <span className="text-muted-foreground mx-1.5">\u2014</span>
                <span>{parsed?.style}</span>
              </span>
              <div className="flex items-center gap-1">
                {pref?.confidence && getConfidenceBadgeStyle(pref?.confidence) && (
                  <span className={`px-1.5 py-0.5 rounded-full text-xs font-medium ${getConfidenceBadgeStyle(pref?.confidence)}`}>
                    {pref?.confidence}
                  </span>
                )}
                {canDelete && (
                  <DiningRowDeleteButton prefId={pref?.id} onDelete={onDelete} />
                )}
              </div>
            </div>
          ))}
          {unparsedRows?.map(({ pref }, idx) => (
            <div key={pref?.id || idx} className="flex items-center justify-between gap-2">
              <span className="text-sm text-foreground">{formatDisplayValue(pref?.value)}</span>
              {canDelete && (
                <DiningRowDeleteButton prefId={pref?.id} onDelete={onDelete} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// Small inline delete button for dining rows
const DiningRowDeleteButton = ({ prefId, onDelete }) => {
  const [confirm, setConfirm] = useState(false);
  if (confirm) {
    return (
      <div className="flex items-center gap-1" onClick={e => e?.stopPropagation()}>
        <span className="text-xs text-muted-foreground">Delete?</span>
        <button
          onClick={async (e) => { e?.stopPropagation(); await onDelete?.(prefId); setConfirm(false); }}
          className="px-1.5 py-0.5 text-xs rounded bg-red-500 text-white hover:bg-red-600 transition-colors"
        >Yes</button>
        <button
          onClick={(e) => { e?.stopPropagation(); setConfirm(false); }}
          className="px-1.5 py-0.5 text-xs rounded bg-muted text-foreground hover:bg-muted/80 transition-colors"
        >No</button>
      </div>
    );
  }
  return (
    <button
      onClick={(e) => { e?.stopPropagation(); setConfirm(true); }}
      className="flex-shrink-0 p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-colors"
      title="Delete preference"
    >
      <Icon name="Trash2" size={13} />
    </button>
  );
};

// ─── Main Page ────────────────────────────────────────────────────────────────
const GuestPreferenceProfile = () => {
  const navigate = useNavigate();
  const { guestId } = useParams();
  const { session, user } = useAuth();
  const { activeTenantId, currentTenantMember, loadingTenant } = useTenant();
  
  const [guests, setGuests] = useState([]);
  const [preferences, setPreferences] = useState([]);
  const [activeTab, setActiveTab] = useState('preferences');
  const [expandedSections, setExpandedSections] = useState({});
  const [editingSection, setEditingSection] = useState(null);
  const [editingPreference, setEditingPreference] = useState(null);
  const [editingPrefType, setEditingPrefType] = useState('preference');
  const [auditLogs, setAuditLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTripsGuestIds, setActiveTripsGuestIds] = useState(new Set());
  const [wizardCompletionPct, setWizardCompletionPct] = useState(0);
  const [showWizard, setShowWizard] = useState(false);
  const [showAverageDay, setShowAverageDay] = useState(false);
  const [showExport, setShowExport] = useState(false);

  // Filter / sort state
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTags, setFilterTags] = useState([]);
  const [filterConfidence, setFilterConfidence] = useState([]);
  const [filterType, setFilterType] = useState('both'); // 'both' | 'preference' | 'avoid'
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false);
  const [sortOption, setSortOption] = useState('default');

  const permissionTier = currentTenantMember?.permission_tier || null;
  const isFullAccess = ['COMMAND', 'CHIEF']?.includes(permissionTier);
  const isLimitedAccess = ['HOD', 'CREW']?.includes(permissionTier);
  const isBlocked = permissionTier === 'VIEW_ONLY';

  // Redirect VIEW_ONLY users
  useEffect(() => {
    if (!loading && isBlocked) {
      navigate('/dashboard', { replace: true });
    }
  }, [loading, isBlocked, navigate]);

  // Load active trip guest IDs for HOD/CREW permission check
  useEffect(() => {
    if (isLimitedAccess) {
      try {
        const allTrips = loadTrips();
        const activeTrips = allTrips?.filter(t => t?.status === TripStatus?.ACTIVE && !t?.isDeleted) || [];
        const ids = new Set(activeTrips?.flatMap(t => t?.guestIds || []));
        setActiveTripsGuestIds(ids);
      } catch (err) {
        console.error('[GuestPreferenceProfile] loadActiveTrips error:', err);
      }
    }
  }, [isLimitedAccess]);

  // Load guests
  useEffect(() => {
    loadGuestsData();
  }, [activeTenantId]);

  // Load preferences and audit logs when guest is selected
  useEffect(() => {
    if (guestId) {
      loadPreferencesData();
      loadAuditLogsData();
      loadWizardCompletion();
    }
  }, [guestId, activeTenantId]);

  const loadGuestsData = async () => {
    try {
      const allGuests = await loadGuests(activeTenantId);
      const activeGuests = Array.isArray(allGuests) ? allGuests?.filter(g => !g?.isDeleted) : [];
      setGuests(activeGuests);
    } catch (err) {
      console.error('[GuestPreferenceProfile] loadGuestsData error:', err);
      setGuests([]);
    } finally {
      setLoading(false);
    }
  };

  const loadPreferencesData = async () => {
    try {
      const prefs = await getPreferencesByGuest(guestId, activeTenantId);
      setPreferences(prefs || []);
    } catch (err) {
      console.error('[GuestPreferenceProfile] loadPreferencesData error:', err);
      setPreferences([]);
    }
  };

  const loadAuditLogsData = () => {
    const logs = getAuditLogsByEntity(EntityType?.GUEST, guestId);
    setAuditLogs(logs);
  };

  // Load wizard completion percentage
  const loadWizardCompletion = async () => {
    if (!guestId || !activeTenantId) return;
    try {
      const { data } = await supabase
        ?.from('guest_preference_wizard_progress')
        ?.select('answers')
        ?.eq('guest_id', guestId)
        ?.eq('tenant_id', activeTenantId)
        ?.single();

      if (data?.answers) {
        const KEY_QUESTION_FIELDS = [
          'roleInGroup', 'charterStatus', 'crewFamiliarity', 'personalityProfile',
          'crewInteractionStyle', 'communicationStyle',
          'crewPresence', 'diningBreakfast', 'diningLunch', 'diningDinner', 'diningPace',
          'morningRoutine', 'breakfastTime', 'lateNightBehaviour',
          'coffeeMilkPref', 'coffeeFrequency',
          'favouriteMeals', 'foodPresentation', 'portionSize', 'spiceTolerance',
          'cabinTidiness', 'laundryExpectations', 'musicVolume',
          'energyLevel',
          'thingsToPrep',
          'overallGuestType', 'topThingOne'
        ];
        const pct = Math.round(
          (KEY_QUESTION_FIELDS?.filter(f => {
            const v = data?.answers?.[f];
            return v && (Array.isArray(v) ? v?.length > 0 : String(v)?.trim() !== '');
          })?.length / KEY_QUESTION_FIELDS?.length) * 100
        );
        setWizardCompletionPct(pct);
      } else {
        setWizardCompletionPct(0);
      }
    } catch {
      setWizardCompletionPct(0);
    }
  };

  const selectedGuest = guests?.find(g => g?.id === guestId);

  // For HOD/CREW: check if this guest is on an active trip
  const guestIsOnActiveTrip = isFullAccess || activeTripsGuestIds?.has(guestId);

  // Sync guest profile allergies/health conditions into the Allergies & Medical preferences section
  useEffect(() => {
    if (!selectedGuest || !guestId || !activeTenantId) return;
    const hasAllergies = selectedGuest?.allergies && selectedGuest?.allergies?.trim() !== '';
    const hasHealth = selectedGuest?.healthConditions && selectedGuest?.healthConditions?.trim() !== '';
    if (!hasAllergies && !hasHealth) return;

    const syncProfileData = async () => {
      try {
        const currentPrefs = await getPreferencesByGuest(guestId, activeTenantId);
        const allergyPrefs = currentPrefs?.filter(p => p?.category === PreferenceCategory?.ALLERGIES) || [];

        const syncEntry = async (key, value) => {
          if (!value || value?.trim() === '') return;
          const existing = allergyPrefs?.find(p => p?.key === key && p?.source === 'guest_profile');
          if (existing) {
            // Update if value changed
            if (existing?.value !== value?.trim()) {
              await updatePreference(existing?.id, { value: value?.trim() }, activeTenantId);
            }
          } else {
            // Check if a manually-entered entry with same key exists — don't overwrite it
            const manualEntry = allergyPrefs?.find(p => p?.key === key && p?.source !== 'guest_profile');
            if (!manualEntry) {
              await createPreference({
                guestId,
                category: PreferenceCategory?.ALLERGIES,
                key,
                value: value?.trim(),
                priority: 'high',
                tags: ['auto-synced'],
                source: 'guest_profile',
              }, activeTenantId);
            }
          }
        };

        if (hasAllergies) await syncEntry('Allergies', selectedGuest?.allergies);
        if (hasHealth) await syncEntry('Health Conditions', selectedGuest?.healthConditions);

        // Reload preferences after sync
        const updated = await getPreferencesByGuest(guestId, activeTenantId);
        setPreferences(updated || []);
      } catch (err) {
        console.error('[GuestPreferenceProfile] syncProfileData error:', err);
      }
    };

    syncProfileData();
  }, [selectedGuest?.id, selectedGuest?.allergies, selectedGuest?.healthConditions, activeTenantId]);

  const toggleSection = (sectionKey) => {
    setExpandedSections(prev => ({
      ...prev,
      [sectionKey]: !prev?.[sectionKey]
    }));
  };

  const handleEditSection = (sectionKey, prefType = 'preference') => {
    setEditingSection(sectionKey);
    setEditingPreference(null);
    setEditingPrefType(prefType);
  };

  const handleEditPreferenceCard = (sectionKey, prefId) => {
    setEditingSection(sectionKey);
    setEditingPreference({ sectionKey, prefId });
    setEditingPrefType(null); // will be derived from the pref itself
  };

  const handleDeletePreference = async (prefId) => {
    // Find the preference to check for an image
    const pref = preferences?.find(p => p?.id === prefId);
    if (pref?.preferenceImageUrl) {
      try {
        const match = pref?.preferenceImageUrl?.match(/preference-images\/(.+)$/);
        if (match?.[1]) {
          await supabase?.storage?.from('preference-images')?.remove([decodeURIComponent(match?.[1])]);
        }
      } catch (err) {
        console.error('[GuestPreferenceProfile] delete image error:', err);
      }
    }
    const success = await deletePreference(prefId, activeTenantId);
    if (success) {
      loadPreferencesData();
    }
  };

  // Back-sync to guests.* structured columns + history_log is handled at the
  // preferencesStorage mutation layer (syncPreferencesForGuest). This handler
  // just refreshes local state after the modal closes.
  const handleSaveSection = () => {
    loadPreferencesData();
    loadAuditLogsData();
    loadWizardCompletion();
  };

  const formatTimestamp = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date?.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const getConfidenceBadgeStyle = (confidence) => {
    switch (confidence) {
      case 'confirmed':
        return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400';
      case 'observed':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400';
      case 'suggested':
        return 'bg-gray-100 text-gray-600 dark:bg-gray-800/50 dark:text-gray-400';
      default:
        return null;
    }
  };

  // Confidence sort order
  const confidenceOrder = { confirmed: 0, observed: 1, suggested: 2 };

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
      key: 'service_style',
      title: 'Service Style',
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

  // Collect all unique tags across all preferences (excluding auto_synced)
  const allTags = useMemo(() => {
    const tagSet = new Set();
    preferences?.forEach(p => p?.tags?.forEach(t => {
      if (t !== 'auto_synced' && t !== 'auto synced') tagSet?.add(t);
    }));
    return Array.from(tagSet)?.sort();
  }, [preferences]);

  // Apply sort to a list of preferences
  const applySortToPrefs = (prefs) => {
    if (!prefs) return [];
    const sorted = [...prefs];

    // Base sort: preferences first, avoids last (applied before user-selected sort)
    sorted?.sort((a, b) => {
      const aIsAvoid = a?.prefType === 'avoid' ? 1 : 0;
      const bIsAvoid = b?.prefType === 'avoid' ? 1 : 0;
      return aIsAvoid - bIsAvoid;
    });

    switch (sortOption) {
      case 'az':
        sorted?.sort((a, b) => (a?.key || '')?.localeCompare(b?.key || ''));
        break;
      case 'za':
        sorted?.sort((a, b) => (b?.key || '')?.localeCompare(a?.key || ''));
        break;
      case 'recently_updated':
        sorted?.sort((a, b) => {
          const aTime = new Date(a?.updatedAt || a?.createdAt || 0)?.getTime();
          const bTime = new Date(b?.updatedAt || b?.createdAt || 0)?.getTime();
          return bTime - aTime;
        });
        break;
      case 'confidence':
        sorted?.sort((a, b) => {
          const aOrder = confidenceOrder?.[a?.confidence] ?? 99;
          const bOrder = confidenceOrder?.[b?.confidence] ?? 99;
          return aOrder - bOrder;
        });
        break;
      default:
        break;
    }
    return sorted;
  };

  // Check if a preference matches the current search/filter
  const prefMatchesFilters = (pref) => {
    const q = searchQuery?.trim()?.toLowerCase();
    const matchesSearch = !q ||
      pref?.key?.toLowerCase()?.includes(q) ||
      pref?.value?.toLowerCase()?.includes(q) ||
      pref?.tags?.some(t => t?.toLowerCase()?.includes(q));

    const matchesTag = filterTags?.length === 0 ||
      pref?.tags?.some(t => filterTags?.includes(t));

    const matchesConfidence = filterConfidence?.length === 0 ||
      filterConfidence?.includes(pref?.confidence);

    const matchesType =
      filterType === 'both' ||
      (filterType === 'preference' && pref?.prefType !== 'avoid') ||
      (filterType === 'avoid' && pref?.prefType === 'avoid');

    return matchesSearch && matchesTag && matchesConfidence && matchesType;
  };

  const isFilterActive = searchQuery?.trim() !== '' || filterTags?.length > 0 || filterConfidence?.length > 0 || filterType !== 'both';

  const getSectionSummary = (sectionPrefs) => {
    if (!sectionPrefs || sectionPrefs?.length === 0) return 'No preferences recorded';
    const firstPref = sectionPrefs?.[0];
    return `${sectionPrefs?.length} preference${sectionPrefs?.length > 1 ? 's' : ''} • ${firstPref?.key || 'Various'}`;
  };

  const renderGuestHeader = () => {
    if (!selectedGuest) return null;

    const badges = [];
    if (selectedGuest?.allergies) badges?.push({ label: 'Allergies', color: 'bg-red-100 text-red-800' });
    if (selectedGuest?.healthConditions) badges?.push({ label: 'Medical', color: 'bg-orange-100 text-orange-800' });
    if (selectedGuest?.nationality) badges?.push({ label: selectedGuest?.nationality, color: 'bg-blue-100 text-blue-800' });

    const guestPhotoUrl = selectedGuest?.photo?.dataUrl || selectedGuest?.photo || null;
    const initials = `${selectedGuest?.firstName?.[0] || ''}${selectedGuest?.lastName?.[0] || ''}`?.toUpperCase() || '?';

    return (
      <div className="bg-card border border-border rounded-xl p-6 mb-6">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4">
            <div className="w-16 h-16 rounded-full overflow-hidden bg-primary/10 flex items-center justify-center flex-shrink-0">
              {guestPhotoUrl ? (
                <img
                  src={guestPhotoUrl}
                  alt={`${selectedGuest?.firstName} ${selectedGuest?.lastName}`}
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-xl font-bold text-primary">{initials}</span>
              )}
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
            <div className="flex items-center gap-2">
              <Button variant="outline" iconName="Download" onClick={() => setShowExport(true)}>
                Export Preferences
              </Button>
              <Button variant="outline" iconName="CalendarDays" onClick={() => setShowAverageDay(true)}>
                Average Day
              </Button>
              <Button variant="outline" iconName="Sparkles" onClick={() => setShowWizard(true)}>
                Preference Assistant
                {wizardCompletionPct > 0 && (
                  <span className="ml-2 inline-flex items-center justify-center px-1.5 py-0.5 rounded-full text-xs font-semibold bg-primary text-primary-foreground">
                    {wizardCompletionPct}%
                  </span>
                )}
              </Button>
            </div>
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

  // ─── Filter/Sort Controls Bar ─────────────────────────────────────────────
  const renderFilterBar = () => {
    const activeFilterCount = filterTags?.length + filterConfidence?.length + (filterType !== 'both' ? 1 : 0);
    return (
      <div className="flex flex-wrap items-center gap-2 mb-4 p-3 bg-card border border-border rounded-xl">
        {/* Search */}
        <div className="relative flex-1 min-w-[160px]">
          <Icon name="Search" size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Search preferences..."
            value={searchQuery}
            onChange={e => setSearchQuery(e?.target?.value)}
            className="w-full pl-8 pr-3 py-1.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground placeholder:text-muted-foreground"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <Icon name="X" size={12} />
            </button>
          )}
        </div>
        {/* Broad Filter dropdown */}
        <div className="relative">
          <button
            onClick={() => setTagDropdownOpen(prev => !prev)}
            className="flex items-center gap-1.5 pl-3 pr-2.5 py-1.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground cursor-pointer hover:bg-muted/50 transition-colors"
          >
            <Icon name="SlidersHorizontal" size={13} className="text-muted-foreground" />
            <span>Filter</span>
            {activeFilterCount > 0 && (
              <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-primary text-primary-foreground text-[10px] font-bold">
                {activeFilterCount}
              </span>
            )}
            <Icon name="ChevronDown" size={12} className="text-muted-foreground" />
          </button>

          {tagDropdownOpen && (
            <>
              {/* Backdrop to close dropdown */}
              <div
                className="fixed inset-0 z-10"
                onClick={() => setTagDropdownOpen(false)}
              />
              <div className="absolute top-full left-0 mt-1 z-20 bg-card border border-border rounded-lg shadow-lg w-56 py-2">

                {/* ── Tags group ── */}
                <div className="px-3 pb-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Tags</p>
                  {allTags?.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-1">No tags available</p>
                  ) : (
                    <div className="max-h-[140px] overflow-y-auto space-y-0.5">
                      {allTags?.map(tag => {
                        const isChecked = filterTags?.includes(tag);
                        return (
                          <label
                            key={tag}
                            className="flex items-center gap-2 py-1 text-sm text-foreground hover:bg-muted/50 cursor-pointer rounded px-1"
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {
                                setFilterTags(prev =>
                                  isChecked
                                    ? prev?.filter(t => t !== tag)
                                    : [...prev, tag]
                                );
                              }}
                              className="w-3.5 h-3.5 rounded border-border accent-primary cursor-pointer"
                            />
                            <span>{tag}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="border-t border-border my-2" />

                {/* ── Confidence Status group ── */}
                <div className="px-3 pb-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Confidence Status</p>
                  <div className="space-y-0.5">
                    {['confirmed', 'observed', 'suggested']?.map(conf => {
                      const isChecked = filterConfidence?.includes(conf);
                      return (
                        <label
                          key={conf}
                          className="flex items-center gap-2 py-1 text-sm text-foreground hover:bg-muted/50 cursor-pointer rounded px-1"
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {
                              setFilterConfidence(prev =>
                                isChecked
                                  ? prev?.filter(c => c !== conf)
                                  : [...prev, conf]
                              );
                            }}
                            className="w-3.5 h-3.5 rounded border-border accent-primary cursor-pointer"
                          />
                          <span className="capitalize">{conf}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="border-t border-border my-2" />

                {/* ── Type group ── */}
                <div className="px-3 pb-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Type</p>
                  <div className="space-y-0.5">
                    {[{ value: 'both', label: 'Both' }, { value: 'preference', label: 'Preferences' }, { value: 'avoid', label: 'Avoids' }]?.map(opt => (
                      <label
                        key={opt?.value}
                        className="flex items-center gap-2 py-1 text-sm text-foreground hover:bg-muted/50 cursor-pointer rounded px-1"
                      >
                        <input
                          type="radio"
                          name="filterType"
                          value={opt?.value}
                          checked={filterType === opt?.value}
                          onChange={() => setFilterType(opt?.value)}
                          className="w-3.5 h-3.5 rounded border-border accent-primary cursor-pointer"
                        />
                        <span>{opt?.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

              </div>
            </>
          )}
        </div>
        {/* Sort */}
        <div className="relative">
          <select
            value={sortOption}
            onChange={e => setSortOption(e?.target?.value)}
            className="appearance-none pl-3 pr-7 py-1.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary text-foreground cursor-pointer"
          >
            <option value="default">Sort: Default</option>
            <option value="az">A – Z</option>
            <option value="za">Z – A</option>
            <option value="recently_updated">Recently Updated</option>
            <option value="confidence">Confidence</option>
          </select>
          <Icon name="ChevronDown" size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        </div>
        {/* Clear filters */}
        {(isFilterActive) && (
          <button
            onClick={() => { setSearchQuery(''); setFilterTags([]); setFilterConfidence([]); setFilterType('both'); }}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg hover:bg-muted/50 transition-colors"
          >
            <Icon name="X" size={12} />
            Clear
          </button>
        )}
      </div>
    );
  };

  const renderPreferenceSection = (section) => {
    const sectionPrefs = getSectionPreferences(section?.category);

    // Apply search/tag filter
    const matchingPrefs = isFilterActive
      ? sectionPrefs?.filter(prefMatchesFilters)
      : sectionPrefs;

    // If filter is active and no prefs match, hide section entirely
    if (isFilterActive && matchingPrefs?.length === 0) return null;

    // Sort the matching prefs
    const displayPrefs = applySortToPrefs(matchingPrefs);

    // Auto-expand when filter is active and there are matches
    const isExpanded = isFilterActive ? true : expandedSections?.[section?.key];
    const canEdit = isFullAccess || (isLimitedAccess && guestIsOnActiveTrip);

    return (
      <div
        key={section?.key}
        className={`bg-card border rounded-xl overflow-hidden transition-smooth border-border`}
      >
        {/* Section Header */}
        <div className="p-4 flex items-center justify-between">
          <button
            onClick={() => !isFilterActive && toggleSection(section?.key)}
            className="flex items-center gap-3 flex-1 text-left"
          >
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 bg-primary/10`}>
              <Icon
                name={section?.icon}
                size={20}
                className={`text-primary`}
              />
            </div>
            <div className="flex-1">
              <h3 className="text-base font-semibold text-foreground mb-1">{section?.title}</h3>
              <p className="text-xs text-muted-foreground">{getSectionSummary(sectionPrefs)}</p>
            </div>
            <Icon 
              name={isExpanded ? 'ChevronUp' : 'ChevronDown'} 
              size={20} 
              className="text-muted-foreground" 
            />
          </button>
          {canEdit && (
            <Button
              variant="ghost"
              size="sm"
              iconName="Edit"
              onClick={() => handleEditSection(section?.key)}
              className="ml-2"
            >
              Edit
            </Button>
          )}
        </div>

        {/* Expanded Content: individual preference cards */}
        {isExpanded && (
          <div className="px-4 pb-4 border-t border-border">
            {displayPrefs?.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No preferences recorded for this section.</p>
            ) : (
              <div className="space-y-2 mt-3">
                {displayPrefs?.map((pref) => (
                  <PreferenceCard
                    key={pref?.id}
                    pref={pref}
                    sectionKey={section?.key}
                    getConfidenceBadgeStyle={getConfidenceBadgeStyle}
                    formatTimestamp={formatTimestamp}
                    onEdit={handleEditPreferenceCard}
                    canEdit={canEdit}
                    canDelete={isFullAccess}
                    onDelete={handleDeletePreference}
                    forceExpanded={false}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderPreferencesTab = () => {
    const renderedSections = preferenceSections?.map(section => renderPreferenceSection(section))?.filter(Boolean);
    return (
      <div className="space-y-4">
        {renderFilterBar()}
        {renderedSections?.length === 0 && isFilterActive ? (
          <div className="bg-card border border-border rounded-xl p-8 text-center">
            <Icon name="SearchX" size={32} className="mx-auto text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">No preferences match your search or filter.</p>
          </div>
        ) : (
          renderedSections
        )}
      </div>
    );
  };

  const renderTripsTab = () => {
    return (
      <div className="bg-card border border-border rounded-xl p-6">
        <p className="text-sm text-muted-foreground">Trip history for this guest will appear here.</p>
      </div>
    );
  };

  const renderCommentsTab = () => {
    return (
      <div className="bg-card border border-border rounded-xl p-6">
        <p className="text-sm text-muted-foreground">Comments and notes for this guest will appear here.</p>
      </div>
    );
  };

  const renderHistoryTab = () => {
    return (
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {auditLogs?.length === 0 ? (
          <div className="p-6">
            <p className="text-sm text-muted-foreground">No history available.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {auditLogs?.map((log) => (
              <div key={log?.id} className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Icon name="Clock" size={16} className="text-muted-foreground" />
                    <span className="text-sm font-medium text-foreground">{log?.action}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{formatTimestamp(log?.timestamp)}</span>
                </div>
                <p className="text-sm text-muted-foreground mb-2">By {log?.userName}</p>
                {log?.changes?.length > 0 && (
                  <div className="space-y-1">
                    {log?.changes?.map((change, idx) => (
                      <div key={idx} className="text-xs text-muted-foreground">
                        <span className="font-medium">{change?.field}:</span>{' '}
                        <span className="line-through">{change?.before || 'none'}</span>
                        {' → '}
                        <span className="text-foreground">{change?.after}</span>
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

  if (loading || loadingTenant) {
    return (
      <div className="min-h-screen bg-background transition-colors duration-300">
        <Header />
        <main className="p-6 max-w-[1800px] mx-auto">
          <div className="flex items-center justify-center py-24">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        </main>
      </div>
    );
  }

  if (isBlocked) return null;

  if (isLimitedAccess && !guestIsOnActiveTrip && guests?.length > 0) {
    return (
      <div className="min-h-screen bg-background transition-colors duration-300">
        <Header />
        <main className="p-6 max-w-[1800px] mx-auto">
          <button
            onClick={() => navigate('/preferences')}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
          >
            <Icon name="ArrowLeft" size={16} />
            Back to Preferences
          </button>
          <div className="bg-card border border-border rounded-xl p-12 text-center">
            <Icon name="Lock" size={48} className="mx-auto text-muted-foreground mb-4" />
            <h2 className="text-xl font-semibold text-foreground mb-2">Access Restricted</h2>
            <p className="text-muted-foreground">You can only view preferences for guests on an active trip.</p>
          </div>
        </main>
      </div>
    );
  }

  if (!loading && !selectedGuest) {
    return (
      <div className="min-h-screen bg-background transition-colors duration-300">
        <Header />
        <main className="p-6 max-w-[1800px] mx-auto">
          <button
            onClick={() => navigate('/preferences')}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
          >
            <Icon name="ArrowLeft" size={16} />
            Back to Preferences
          </button>
          <div className="bg-card border border-border rounded-xl p-12 text-center">
            <Icon name="User" size={48} className="mx-auto text-muted-foreground mb-4" />
            <h2 className="text-xl font-semibold text-foreground mb-2">Guest not found</h2>
            <p className="text-muted-foreground">This guest profile could not be loaded.</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background transition-colors duration-300">
      <Header />
      <main className="p-6 max-w-[1800px] mx-auto">
        <button
          onClick={() => navigate('/preferences')}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <Icon name="ArrowLeft" size={16} />
          Back to Preferences
        </button>

        {renderGuestHeader()}
        {renderTabs()}

        {activeTab === 'preferences' && renderPreferencesTab()}
        {activeTab === 'trips' && renderTripsTab()}
        {activeTab === 'comments' && renderCommentsTab()}
        {activeTab === 'history' && renderHistoryTab()}

        {showWizard && (
          <PreferenceAssistantWizard
            isOpen={showWizard}
            guestId={guestId}
            tenantId={activeTenantId}
            onClose={() => {
              setShowWizard(false);
              loadWizardCompletion();
              loadPreferencesData();
            }}
            onComplete={() => {
              loadWizardCompletion();
              loadPreferencesData();
            }}
          />
        )}

        {showAverageDay && (
          <AverageDayModal
            isOpen={showAverageDay}
            onClose={() => setShowAverageDay(false)}
            preferences={preferences}
            guestName={selectedGuest ? `${selectedGuest?.firstName} ${selectedGuest?.lastName}` : ''}
          />
        )}

        {showExport && (
          <ExportPreferencesModal
            isOpen={showExport}
            onClose={() => setShowExport(false)}
            guest={selectedGuest}
            preferences={preferences}
          />
        )}
      </main>

      {editingSection && (
        <EditPreferenceSectionModal
          isOpen={!!editingSection}
          onClose={() => setEditingSection(null)}
          onSave={handleSaveSection}
          guestId={guestId}
          tenantId={activeTenantId}
          section={preferenceSections?.find(s => s?.key === editingSection)}
          existingPreferences={getSectionPreferences(
            preferenceSections?.find(s => s?.key === editingSection)?.category
          )}
          initialEditPrefId={editingPreference?.prefId}
          initialPrefType={editingPrefType}
        />
      )}
    </div>
  );
};

export default GuestPreferenceProfile;