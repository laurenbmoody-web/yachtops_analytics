// Sea Time Tracker Storage Utility
// Implements MCA OOW (Yachts) V1 with extensible path architecture
// CORE PRINCIPLES:
// - Vessel Service Log is command-owned source of truth
// - Personal Sea Service Days auto-populated from vessel logs for ACTIVE crew
// - Path selection changes qualification logic, not underlying data
// - Verification workflow: NOT_SUBMITTED → SUBMITTED → VERIFIED/REJECTED

const VESSELS_KEY = 'cargo_seatime_vessels_v1';
const CREW_ONBOARD_KEY = 'cargo_seatime_crew_onboard_v1';
const VESSEL_SERVICE_LOG_KEY = 'cargo_seatime_vessel_log_v1';
const PERSONAL_SEA_SERVICE_KEY = 'cargo_seatime_personal_v1';
// Phase 0: config-driven rules engine. Bumped to v2 so the old single-target
// (1095 ring) path config is superseded by the four-service-type model below.
const RULES_CONFIG_KEY = 'cargo_seatime_rules_v2';
const SAVED_VESSELS_KEY = 'cargo_seatime_saved_vessels_v1';

// ============================================
// CONSTANTS
// ============================================

export const CREW_STATUS = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE'
};

export const VESSEL_STATUS = {
  UNDERWAY: 'UNDERWAY',
  ANCHOR: 'ANCHOR',
  IN_PORT: 'IN_PORT',
  IN_YARD: 'IN_YARD'
};

export const VESSEL_TYPE = {
  MOTOR_YACHT: 'Motor Yacht',
  SAILING_YACHT: 'Sailing Yacht',
  WORKBOAT_SUPPORT: 'Workboat / Support',
  OTHER: 'Other'
};

export const COMMERCIAL_STATUS = {
  COMMERCIAL_YACHT: 'Commercial Yacht',
  PRIVATE_YACHT: 'Private Yacht',
  MERCHANT: 'Merchant',
  OTHER: 'Other'
};

export const PROPULSION_TYPE = {
  DIESEL: 'Diesel',
  DIESEL_ELECTRIC: 'Diesel-electric',
  HYBRID: 'Hybrid',
  OTHER: 'Other'
};

export const SEA_SERVICE_SOURCE = {
  VESSEL_AUTO: 'VESSEL_AUTO',
  MANUAL: 'MANUAL'
};

export const SEA_SERVICE_STATE = {
  VERIFIED: 'VERIFIED',
  PENDING: 'PENDING',
  MANUAL: 'MANUAL',
  NON_QUALIFYING: 'NON_QUALIFYING'
};

export const VERIFICATION_STATUS = {
  NOT_SUBMITTED: 'NOT_SUBMITTED',
  SUBMITTED: 'SUBMITTED',
  VERIFIED: 'VERIFIED',
  REJECTED: 'REJECTED'
};

// ============================================
// MCA SERVICE TYPES (Phase 0)
// The four service types that MCA testimonials (MIN 642) record separately.
// Every sea-service day resolves to exactly ONE primary type so the four
// buckets reconcile to the total day count. Requirement bars then decide which
// of these primary types contribute toward each threshold.
// ============================================

export const SEA_SERVICE_TYPE = {
  SEAGOING: 'seagoing',       // Actual seagoing service (vessel underway)
  WATCHKEEPING: 'watchkeeping', // Seagoing day with a recorded navigational watch >= min hours
  STANDBY: 'standby',         // At anchor / in port / standby
  YARD: 'yard'               // Shipyard / refit service
};

export const SEA_SERVICE_TYPE_LABELS = {
  seagoing: 'Seagoing',
  watchkeeping: 'Watchkeeping',
  standby: 'Standby',
  yard: 'Shipyard'
};

// ============================================
// RULES ENGINE CONFIGURATION (Phase 0)
// ============================================
// EVERY numeric threshold here is a CONFIG VALUE, not a hard-coded constant,
// because the MCA rules changed in 2026 and will change again. Edit the config
// (or override via localStorage) rather than touching qualification logic.
//
// ⚠️ COMPLIANCE: all figures below are TO BE CONFIRMED against the live notices
// (MSN 1858 Amendment 2 for OOW day thresholds + size gates; MIN 642 for the
// testimonial field layout; standby cap + watchkeeping daily minimum). Do NOT
// surface a "MCA-compliant" claim until these are verified. See
// docs/sea-time-tracker-deep-dive.md.

/**
 * Default rules configuration. Returned when nothing is stored yet.
 */
export const getDefaultRulesConfig = () => ({
  version: '2026.06-draft',
  lastReviewed: '2026-06-16',
  reviewStatus: 'UNVERIFIED', // until diffed against live MCA notices
  thresholds: {
    // A day counts as watchkeeping only if recorded watch >= this many hours.
    watchkeepingMinHours: 4,
    // Seagoing service for the OOW pathway only counts on vessels >= this length.
    seagoingMinLengthM: 15,
    // Standby has NO flat cap: total standby may not exceed total actual sea
    // service (seagoing + watchkeeping). (MSN 1858 §5.2 / MIN 498). Substitution
    // into the bars is deferred — standby is logged, not counted in the primaries.
    standbyNeverExceedsSeaService: true
  },
  paths: [
    {
      id: 'mca-oow-yachts',
      name: 'MCA OOW (Yachts)',
      reference: 'MSN 1858 Amendment 2',
      color: '#3b82f6',
      // Multiple requirement bars per pathway instead of one 1095 ring.
      requirements: [
        {
          id: 'seagoing-15m',
          label: 'Seagoing service (≥15m)',
          // Which primary service types contribute. Watchkeeping days happen at
          // sea, so they also count as seagoing service.
          countsTypes: ['seagoing', 'watchkeeping'],
          targetDays: 365,
          gates: { minLengthM: 15, minGT: 80 },
          note: 'Actual seagoing days on a vessel ≥15m load-line / registered length.'
        },
        {
          id: 'watchkeeping',
          label: 'Watchkeeping service',
          countsTypes: ['watchkeeping'],
          targetDays: 120,
          gates: { minLengthM: 15, minGT: 80 },
          note: 'Days with a recorded navigational watch ≥4 hours.'
        }
      ]
    }
  ]
});

/**
 * Load the rules config (config-driven thresholds).
 */
export const getRulesConfig = () => {
  try {
    const stored = localStorage.getItem(RULES_CONFIG_KEY);
    if (stored) return JSON.parse(stored);
    const def = getDefaultRulesConfig();
    localStorage.setItem(RULES_CONFIG_KEY, JSON.stringify(def));
    return def;
  } catch (error) {
    console.error('Error loading rules config:', error);
    return getDefaultRulesConfig();
  }
};

/**
 * Persist the rules config.
 */
export const saveRulesConfig = (config) => {
  try {
    localStorage.setItem(RULES_CONFIG_KEY, JSON.stringify(config));
    return true;
  } catch (error) {
    console.error('Error saving rules config:', error);
    return false;
  }
};

/**
 * Get all available qualification paths (for the path selector).
 * Architecture allows adding more paths via config.
 */
export const getQualificationPaths = () => {
  const config = getRulesConfig();
  return config?.paths || [];
};

/**
 * Get specific path by ID
 */
export const getPathById = (pathId) => {
  const paths = getQualificationPaths();
  return paths?.find(p => p?.id === pathId);
};

// ============================================
// VESSEL MANAGEMENT
// ============================================

/**
 * Load all vessels
 */
export const loadVessels = () => {
  try {
    const data = localStorage.getItem(VESSELS_KEY);
    if (data) {
      return JSON.parse(data);
    }
    
    // Initialize with current vessel
    const defaultVessels = [
      {
        id: 'vessel-1',
        name: 'M/Y Serenity',
        imoNumber: 'IMO1234567',
        officialNumber: 'OFF789',
        flag: 'Cayman Islands',
        grossTonnage: 499,
        lengthM: 42, // registered / load-line length (m) — gates seagoing service
        engineKW: 2400,
        vesselType: 'Motor Yacht',
        commercialStatus: 'COMMERCIAL',
        timezoneOffset: 0, // UTC offset in minutes
        createdAt: new Date()?.toISOString()
      }
    ];
    
    localStorage.setItem(VESSELS_KEY, JSON.stringify(defaultVessels));
    return defaultVessels;
  } catch (error) {
    console.error('Error loading vessels:', error);
    return [];
  }
};

/**
 * Save vessels
 */
export const saveVessels = (vessels) => {
  try {
    localStorage.setItem(VESSELS_KEY, JSON.stringify(vessels));
    return true;
  } catch (error) {
    console.error('Error saving vessels:', error);
    return false;
  }
};

/**
 * Get vessel by ID
 */
export const getVesselById = (vesselId) => {
  const vessels = loadVessels();
  return vessels?.find(v => v?.id === vesselId);
};

/**
 * Get current vessel (first vessel for V1)
 */
export const getCurrentVessel = () => {
  const vessels = loadVessels();
  return vessels?.[0] || null;
};

// ============================================
// SAVED VESSELS (FOR MANUAL ENTRIES)
// ============================================

/**
 * Load saved vessels for user
 */
export const loadSavedVessels = (userId) => {
  try {
    const data = localStorage.getItem(SAVED_VESSELS_KEY);
    const allSaved = data ? JSON.parse(data) : [];
    return allSaved?.filter(v => v?.userId === userId);
  } catch (error) {
    console.error('Error loading saved vessels:', error);
    return [];
  }
};

/**
 * Save a vessel for future use
 */
export const saveSavedVessel = (userId, vesselData) => {
  try {
    const data = localStorage.getItem(SAVED_VESSELS_KEY);
    const allSaved = data ? JSON.parse(data) : [];
    
    const newVessel = {
      id: `saved-vessel-${Date.now()}`,
      userId,
      vesselName: vesselData?.vesselName,
      flag: vesselData?.flag,
      imoNumber: vesselData?.imoNumber || null,
      officialNumber: vesselData?.officialNumber || null,
      vesselStatusType: vesselData?.vesselStatusType,
      grossTonnage: vesselData?.grossTonnage,
      propulsionPowerKW: vesselData?.propulsionPowerKW,
      vesselType: vesselData?.vesselType,
      // Optional fields
      loa: vesselData?.loa || null,
      breadth: vesselData?.breadth || null,
      depth: vesselData?.depth || null,
      propulsionType: vesselData?.propulsionType || null,
      engineMakeModel: vesselData?.engineMakeModel || null,
      numberOfEngines: vesselData?.numberOfEngines || null,
      callSign: vesselData?.callSign || null,
      mmsi: vesselData?.mmsi || null,
      portOfRegistry: vesselData?.portOfRegistry || null,
      tradingArea: vesselData?.tradingArea || null,
      companyOperator: vesselData?.companyOperator || null,
      createdAt: new Date()?.toISOString()
    };
    
    allSaved?.push(newVessel);
    localStorage.setItem(SAVED_VESSELS_KEY, JSON.stringify(allSaved));
    return newVessel;
  } catch (error) {
    console.error('Error saving vessel:', error);
    return null;
  }
};

/**
 * Get saved vessel by ID
 */
export const getSavedVesselById = (vesselId) => {
  try {
    const data = localStorage.getItem(SAVED_VESSELS_KEY);
    const allSaved = data ? JSON.parse(data) : [];
    return allSaved?.find(v => v?.id === vesselId);
  } catch (error) {
    console.error('Error getting saved vessel:', error);
    return null;
  }
};

/**
 * Delete saved vessel
 */
export const deleteSavedVessel = (vesselId) => {
  try {
    const data = localStorage.getItem(SAVED_VESSELS_KEY);
    const allSaved = data ? JSON.parse(data) : [];
    const filtered = allSaved?.filter(v => v?.id !== vesselId);
    localStorage.setItem(SAVED_VESSELS_KEY, JSON.stringify(filtered));
    return true;
  } catch (error) {
    console.error('Error deleting saved vessel:', error);
    return false;
  }
};

// ============================================
// CREW ONBOARD STATUS
// ============================================

/**
 * Load crew onboard status records
 */
export const loadCrewOnboardStatus = () => {
  try {
    const data = localStorage.getItem(CREW_ONBOARD_KEY);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error('Error loading crew onboard status:', error);
    return [];
  }
};

/**
 * Save crew onboard status
 */
export const saveCrewOnboardStatus = (records) => {
  try {
    localStorage.setItem(CREW_ONBOARD_KEY, JSON.stringify(records));
    return true;
  } catch (error) {
    console.error('Error saving crew onboard status:', error);
    return false;
  }
};

/**
 * Get crew onboard status for specific user and vessel
 */
export const getCrewOnboardStatus = (userId, vesselId) => {
  const records = loadCrewOnboardStatus();
  return records?.find(r => r?.userId === userId && r?.vesselId === vesselId);
};

/**
 * Get all active crew for a vessel
 */
export const getActiveCrewForVessel = (vesselId) => {
  const records = loadCrewOnboardStatus();
  return records?.filter(r => r?.vesselId === vesselId && r?.status === CREW_STATUS?.ACTIVE);
};

/**
 * Update crew onboard status
 */
export const updateCrewOnboardStatus = (userId, vesselId, updates) => {
  const records = loadCrewOnboardStatus();
  const index = records?.findIndex(r => r?.userId === userId && r?.vesselId === vesselId);
  
  if (index !== -1) {
    records[index] = { ...records?.[index], ...updates };
  } else {
    // Create new record
    records?.push({
      id: `crew-onboard-${Date.now()}`,
      userId,
      vesselId,
      status: CREW_STATUS?.ACTIVE,
      fromDate: new Date()?.toISOString()?.split('T')?.[0],
      toDate: null,
      capacityServed: updates?.capacityServed || 'Crew',
      watchEligible: updates?.watchEligible || false,
      ...updates
    });
  }
  
  saveCrewOnboardStatus(records);
  return records?.[index !== -1 ? index : records?.length - 1];
};

// ============================================
// VESSEL SERVICE LOG (COMMAND-OWNED)
// ============================================

/**
 * Load vessel service log entries
 */
export const loadVesselServiceLog = () => {
  try {
    const data = localStorage.getItem(VESSEL_SERVICE_LOG_KEY);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error('Error loading vessel service log:', error);
    return [];
  }
};

/**
 * Save vessel service log
 */
export const saveVesselServiceLog = (entries) => {
  try {
    localStorage.setItem(VESSEL_SERVICE_LOG_KEY, JSON.stringify(entries));
    return true;
  } catch (error) {
    console.error('Error saving vessel service log:', error);
    return false;
  }
};

/**
 * Get vessel service log for specific vessel
 */
export const getVesselServiceLogForVessel = (vesselId) => {
  const entries = loadVesselServiceLog();
  return entries?.filter(e => e?.vesselId === vesselId)?.sort((a, b) => 
    new Date(a.fromDateTime) - new Date(b.fromDateTime)
  );
};

/**
 * Add vessel service log entry
 */
export const addVesselServiceLogEntry = (vesselId, entry, createdBy) => {
  const entries = loadVesselServiceLog();
  
  const newEntry = {
    id: `vessel-log-${Date.now()}`,
    vesselId,
    fromDateTime: entry?.fromDateTime,
    toDateTime: entry?.toDateTime,
    status: entry?.status,
    miles: entry?.miles || null,
    notes: entry?.notes || '',
    createdBy,
    createdAt: new Date()?.toISOString()
  };
  
  entries?.push(newEntry);
  saveVesselServiceLog(entries);
  
  // Trigger auto-population for active crew
  autoPopulatePersonalSeaService(vesselId);
  
  return newEntry;
};

/**
 * Update vessel service log entry
 */
export const updateVesselServiceLogEntry = (entryId, updates) => {
  const entries = loadVesselServiceLog();
  const index = entries?.findIndex(e => e?.id === entryId);
  
  if (index !== -1) {
    entries[index] = { ...entries?.[index], ...updates };
    saveVesselServiceLog(entries);
    
    // Re-trigger auto-population
    autoPopulatePersonalSeaService(entries?.[index]?.vesselId);
    
    return entries?.[index];
  }
  
  return null;
};

/**
 * Delete vessel service log entry
 */
export const deleteVesselServiceLogEntry = (entryId) => {
  const entries = loadVesselServiceLog();
  const entry = entries?.find(e => e?.id === entryId);
  
  if (entry) {
    const filtered = entries?.filter(e => e?.id !== entryId);
    saveVesselServiceLog(filtered);
    
    // Re-trigger auto-population to remove orphaned days
    autoPopulatePersonalSeaService(entry?.vesselId);
    
    return true;
  }
  
  return false;
};

// ============================================
// PERSONAL SEA SERVICE (CREW-OWNED)
// ============================================

/**
 * Load personal sea service days
 */
export const loadPersonalSeaService = () => {
  try {
    const data = localStorage.getItem(PERSONAL_SEA_SERVICE_KEY);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error('Error loading personal sea service:', error);
    return [];
  }
};

/**
 * Save personal sea service
 */
export const savePersonalSeaService = (records) => {
  try {
    localStorage.setItem(PERSONAL_SEA_SERVICE_KEY, JSON.stringify(records));
    return true;
  } catch (error) {
    console.error('Error saving personal sea service:', error);
    return false;
  }
};

/**
 * Get personal sea service for specific user
 */
export const getPersonalSeaServiceForUser = (userId) => {
  const records = loadPersonalSeaService();
  return records?.filter(r => r?.userId === userId)?.sort((a, b) => 
    new Date(a.date) - new Date(b.date)
  );
};

/**
 * Get personal sea service for user in date range
 */
export const getPersonalSeaServiceForUserInRange = (userId, startDate, endDate) => {
  const records = getPersonalSeaServiceForUser(userId);
  return records?.filter(r => {
    const date = new Date(r.date);
    return date >= new Date(startDate) && date <= new Date(endDate);
  });
};

/**
 * Add manual sea service entry
 */
export const addManualSeaServiceEntry = (userId, entry) => {
  const records = loadPersonalSeaService();
  
  const newEntry = {
    // Randomised suffix: a multi-day range creates entries in a tight loop, so
    // Date.now() alone collides and breaks later edit/delete-by-id.
    id: `sea-service-${Date.now()}-${Math.random()?.toString(36)?.substr(2, 9)}`,
    userId,
    vesselId: entry?.vesselId || null,
    vesselName: entry?.vesselName || '',
    savedVesselId: entry?.savedVesselId || null,
    // Vessel facts snapshotted onto the entry so it can be evaluated even
    // though manual entries don't reference a managed vessel record.
    grossTonnage: entry?.grossTonnage != null ? Number(entry?.grossTonnage) : null,
    lengthM: entry?.lengthM != null ? Number(entry?.lengthM) : null,
    vesselStatusType: entry?.vesselStatusType || null,
    vesselType: entry?.vesselType || null,
    date: entry?.date,
    source: SEA_SERVICE_SOURCE?.MANUAL,
    vesselStatus: entry?.vesselStatus || null,
    capacityServed: entry?.capacityServed || '',
    watchkeepingRole: entry?.watchkeepingRole || false,
    watchHours: entry?.watchHours != null ? Number(entry?.watchHours) : 0,
    locationTradingArea: entry?.locationTradingArea || '',
    seaServiceType: entry?.seaServiceType || 'Underway',
    serviceType: null, // primary MCA type, computed by recompute
    qualifiesForSelectedPath: false, // Will be computed
    qualificationReason: '',
    state: SEA_SERVICE_STATE?.MANUAL,
    verificationStatus: VERIFICATION_STATUS?.NOT_SUBMITTED,
    verifiedBy: null,
    verifiedAt: null,
    submittedAt: null,
    noteReason: entry?.noteReason || '',
    documents: entry?.documents || [],
    markedForVerification: entry?.markedForVerification || false,
    createdAt: new Date()?.toISOString()
  };
  
  records?.push(newEntry);
  savePersonalSeaService(records);

  // Log to activity feed
  logActivity({
    module: 'sea_time',
    action: 'SEA_TIME_ADDED',
    entityType: 'sea_service_entry',
    entityId: newEntry?.id,
    summary: `Sea time entry added: ${entry?.vesselName || 'vessel'} on ${entry?.date}`,
    meta: { vesselName: entry?.vesselName, date: entry?.date, capacityServed: entry?.capacityServed }
  });
  
  return newEntry;
};

/**
 * Update personal sea service entry
 */
export const updatePersonalSeaServiceEntry = (entryId, updates) => {
  const records = loadPersonalSeaService();
  const index = records?.findIndex(r => r?.id === entryId);
  
  if (index !== -1) {
    records[index] = { ...records?.[index], ...updates };
    savePersonalSeaService(records);

    // Log to activity feed
    logActivity({
      module: 'sea_time',
      action: 'SEA_TIME_UPDATED',
      entityType: 'sea_service_entry',
      entityId: entryId,
      summary: `Sea time entry updated`,
      meta: { entryId }
    });

    return records?.[index];
  }
  
  return null;
};

/**
 * Delete personal sea service entry (manual only)
 */
export const deletePersonalSeaServiceEntry = (entryId) => {
  const records = loadPersonalSeaService();
  const entry = records?.find(r => r?.id === entryId);
  
  // Only allow deletion of manual entries
  if (entry && entry?.source === SEA_SERVICE_SOURCE?.MANUAL) {
    const filtered = records?.filter(r => r?.id !== entryId);
    savePersonalSeaService(filtered);
    return true;
  }
  
  return false;
};

// ============================================
// AUTO-POPULATION LOGIC
// ============================================

/**
 * Auto-populate personal sea service from vessel logs
 * Called when vessel service log changes
 */
export const autoPopulatePersonalSeaService = (vesselId) => {
  const vesselLogs = getVesselServiceLogForVessel(vesselId);
  const activeCrew = getActiveCrewForVessel(vesselId);
  const vessel = getVesselById(vesselId);
  
  if (!vessel) return;
  
  const personalRecords = loadPersonalSeaService();
  
  // For each active crew member
  activeCrew?.forEach(crewStatus => {
    const { userId, capacityServed, watchEligible } = crewStatus;
    
    // Get all dates covered by vessel logs
    const coveredDates = new Set();
    
    vesselLogs?.forEach(log => {
      const startDate = new Date(log.fromDateTime.split('T')[0]);
      const endDate = new Date(log.toDateTime.split('T')[0]);
      
      // Generate all dates in range
      for (let d = new Date(startDate); d <= endDate; d?.setDate(d?.getDate() + 1)) {
        const dateStr = d?.toISOString()?.split('T')?.[0];
        coveredDates?.add(dateStr);
        
        // Check if record already exists
        const existingIndex = personalRecords?.findIndex(r => 
          r?.userId === userId && r?.date === dateStr && r?.source === SEA_SERVICE_SOURCE?.VESSEL_AUTO
        );
        
        if (existingIndex === -1) {
          // Create new auto-populated record
          const newRecord = {
            id: `sea-service-${Date.now()}-${Math.random()?.toString(36)?.substr(2, 9)}`,
            userId,
            vesselId,
            vesselName: vessel?.name,
            date: dateStr,
            source: SEA_SERVICE_SOURCE?.VESSEL_AUTO,
            vesselStatus: log?.status,
            capacityServed,
            watchHours: log?.watchHours != null ? Number(log?.watchHours) : 0,
            serviceType: null, // primary MCA type, computed by recompute
            qualifiesForSelectedPath: false, // Will be computed by qualification check
            qualificationReason: '',
            state: SEA_SERVICE_STATE?.PENDING,
            verificationStatus: VERIFICATION_STATUS?.NOT_SUBMITTED,
            verifiedBy: null,
            verifiedAt: null,
            submittedAt: null,
            noteReason: '',
            createdAt: new Date()?.toISOString()
          };
          
          personalRecords?.push(newRecord);
        } else {
          // Update existing record with latest vessel status
          personalRecords[existingIndex].vesselStatus = log?.status;
          personalRecords[existingIndex].capacityServed = capacityServed;
        }
      }
    });
    
    // Remove auto-populated records that are no longer covered by vessel logs
    const userAutoRecords = personalRecords?.filter(r => 
      r?.userId === userId && r?.source === SEA_SERVICE_SOURCE?.VESSEL_AUTO
    );
    
    userAutoRecords?.forEach(record => {
      if (!coveredDates?.has(record?.date)) {
        const index = personalRecords?.findIndex(r => r?.id === record?.id);
        if (index !== -1) {
          personalRecords?.splice(index, 1);
        }
      }
    });
  });
  
  savePersonalSeaService(personalRecords);
};

// ============================================
// QUALIFICATION LOGIC (Phase 0 — config-driven rules engine)
// ============================================

/**
 * Resolve the vessel facts that gate qualification for a given entry.
 * - Auto entries reference a managed vessel record.
 * - Manual entries carry a snapshot of the facts (GT / length / type), falling
 *   back to a saved vessel if one is linked.
 * Returns { grossTonnage, lengthM, vesselType }.
 */
export const getEntryVesselFacts = (entry) => {
  // If the entry already carries its own vessel facts (manual entries, and
  // rows fetched from Supabase), use them directly — keeps this pure / IO-free.
  if (entry?.grossTonnage != null || entry?.lengthM != null) {
    return {
      grossTonnage: entry?.grossTonnage ?? null,
      lengthM: entry?.lengthM ?? null,
      vesselType: entry?.vesselType ?? null
    };
  }

  if (entry?.source === SEA_SERVICE_SOURCE?.VESSEL_AUTO) {
    const vessel = getVesselById(entry?.vesselId);
    return {
      grossTonnage: vessel?.grossTonnage ?? null,
      lengthM: vessel?.lengthM ?? vessel?.loa ?? null,
      vesselType: vessel?.vesselType ?? null
    };
  }

  // Manual entry: prefer the snapshot stored on the entry, then a saved vessel.
  const saved = entry?.savedVesselId ? getSavedVesselById(entry?.savedVesselId) : null;
  return {
    grossTonnage: entry?.grossTonnage ?? saved?.grossTonnage ?? null,
    lengthM: entry?.lengthM ?? saved?.loa ?? null,
    vesselType: entry?.vesselType ?? saved?.vesselType ?? null
  };
};

/**
 * Classify the single primary MCA service type for a day.
 * Exactly one of: yard | watchkeeping | standby | seagoing — so the four
 * buckets reconcile to the total day count.
 */
export const classifyServiceType = (entry, config = getRulesConfig()) => {
  const minWatch = config?.thresholds?.watchkeepingMinHours ?? 4;
  const status = entry?.vesselStatus;
  const typeText = (entry?.seaServiceType || '').toLowerCase();

  // 1) Shipyard / refit always takes precedence.
  if (status === VESSEL_STATUS?.IN_YARD || typeText?.includes('yard')) {
    return SEA_SERVICE_TYPE?.YARD;
  }

  // 2) A recorded watch >= the configured minimum makes it a watchkeeping day.
  if (Number(entry?.watchHours) >= minWatch) {
    return SEA_SERVICE_TYPE?.WATCHKEEPING;
  }

  // 3) At anchor / in port / explicit standby → standby.
  if (
    status === VESSEL_STATUS?.ANCHOR ||
    status === VESSEL_STATUS?.IN_PORT ||
    typeText?.includes('standby') ||
    typeText?.includes('port')
  ) {
    return SEA_SERVICE_TYPE?.STANDBY;
  }

  // 4) Otherwise underway at sea → seagoing.
  return SEA_SERVICE_TYPE?.SEAGOING;
};

/**
 * Evaluate an entry against a path's requirement bars.
 * Returns:
 *   serviceType   — primary MCA type
 *   countsToward  — { [requirementId]: boolean }
 *   qualifies     — counts toward at least one requirement
 *   reason        — human-readable headline (why it counts / doesn't)
 *   reasons       — detailed human-readable list (gate failures etc.)
 */
export const evaluateEntryQualification = (entry, pathId, config = getRulesConfig()) => {
  // Resolve the path from the supplied config first (pure path), falling back
  // to the stored config for legacy callers.
  const path = (config?.paths || []).find(p => p?.id === pathId) || getPathById(pathId);
  const serviceType = classifyServiceType(entry, config);
  const facts = getEntryVesselFacts(entry);
  const labels = SEA_SERVICE_TYPE_LABELS;

  const result = { serviceType, countsToward: {}, qualifies: false, reason: '', reasons: [] };

  if (!path) {
    result.reason = 'No qualification path selected.';
    return result;
  }

  // Gate failures shared across requirements (collected once for messaging).
  const gateReasons = new Set();
  const matchedRequirements = [];

  (path?.requirements || []).forEach(req => {
    const typeMatches = (req?.countsTypes || []).includes(serviceType);
    if (!typeMatches) {
      result.countsToward[req.id] = false;
      return;
    }

    const gates = req?.gates || {};
    let passes = true;

    if (gates?.minLengthM != null) {
      if (facts?.lengthM == null) {
        passes = false;
        gateReasons.add(`Vessel length is missing — ${gates.minLengthM} m minimum can't be confirmed.`);
      } else if (Number(facts.lengthM) < gates.minLengthM) {
        passes = false;
        gateReasons.add(`Vessel length (${facts.lengthM} m) is below the ${gates.minLengthM} m minimum for ${req.label}.`);
      }
    }

    if (gates?.minGT != null) {
      if (facts?.grossTonnage == null) {
        passes = false;
        gateReasons.add(`Vessel GT is missing — ${gates.minGT} GT minimum can't be confirmed.`);
      } else if (Number(facts.grossTonnage) < gates.minGT) {
        passes = false;
        gateReasons.add(`Vessel GT (${facts.grossTonnage}) is below the ${gates.minGT} GT minimum.`);
      }
    }

    result.countsToward[req.id] = passes;
    if (passes) matchedRequirements.push(req.label);
  });

  result.qualifies = Object.values(result.countsToward).some(Boolean);

  if (result.qualifies) {
    result.reason = `Counts as ${matchedRequirements.join(' + ')}.`;
  } else if (serviceType === SEA_SERVICE_TYPE?.YARD) {
    result.reason = 'Shipyard service — does not count toward seagoing or watchkeeping days.';
    result.reasons = [result.reason];
  } else if (serviceType === SEA_SERVICE_TYPE?.STANDBY) {
    // No flat cap: standby counts only up to your actual sea-service total
    // (MSN 1858 §5.2 / MIN 498). Shown here as context; not in the primary bars.
    result.reason = 'Standby service — counts only up to your actual sea-service days (MSN 1858 §5.2); not counted in the primary bars.';
    result.reasons = [result.reason];
  } else {
    // Seagoing/watchkeeping day that failed the vessel-size gates.
    result.reasons = Array.from(gateReasons);
    result.reason = result.reasons[0] || `${labels[serviceType]} service does not meet the requirements for this path.`;
  }

  return result;
};

/**
 * Back-compat shim: returns { qualifies, reasons } for a day on a path.
 */
export const checkQualificationForPath = (seaServiceDay, pathId) => {
  const { qualifies, reasons, reason } = evaluateEntryQualification(seaServiceDay, pathId);
  return { qualifies, reasons: reasons?.length ? reasons : (qualifies ? [] : [reason]) };
};

/**
 * Recompute qualification status for all of a user's sea service days.
 * Loads once, mutates, saves the SAME array (fixes the prior no-op persist).
 */
export const recomputeQualificationForUser = (userId, pathId) => {
  const all = loadPersonalSeaService();
  const config = getRulesConfig();

  all?.forEach(record => {
    if (record?.userId !== userId) return;

    const evalRes = evaluateEntryQualification(record, pathId, config);

    record.serviceType = evalRes.serviceType;
    record.countsToward = evalRes.countsToward;
    record.qualifiesForSelectedPath = evalRes.qualifies;
    record.qualificationReason = evalRes.reason;

    // Update state based on qualification and verification.
    if (record?.source === SEA_SERVICE_SOURCE?.MANUAL) {
      record.state = SEA_SERVICE_STATE?.MANUAL;
    } else if (evalRes.qualifies && record?.verificationStatus === VERIFICATION_STATUS?.VERIFIED) {
      record.state = SEA_SERVICE_STATE?.VERIFIED;
    } else if (evalRes.qualifies) {
      record.state = SEA_SERVICE_STATE?.PENDING;
    } else {
      record.state = SEA_SERVICE_STATE?.NON_QUALIFYING;
    }

    if (evalRes.reasons?.length > 0) {
      record.nonQualifyingReasons = evalRes.reasons;
    } else {
      delete record.nonQualifyingReasons;
    }
  });

  savePersonalSeaService(all);
};

// ============================================
// PROGRESS CALCULATION (Phase 0 — multi-requirement)
// ============================================

const isVerified = (r) => r?.verificationStatus === VERIFICATION_STATUS?.VERIFIED;
const isPendingVerification = (r) =>
  r?.verificationStatus === VERIFICATION_STATUS?.NOT_SUBMITTED ||
  r?.verificationStatus === VERIFICATION_STATUS?.SUBMITTED;

/**
 * Pure progress summariser. `records` must already carry `serviceType` and
 * `countsToward` (set by recompute / evaluateEntryQualification) plus a
 * `verificationStatus`. Shared by the localStorage and Supabase code paths.
 */
export const summariseProgress = (path, records) => {
  if (!path) return null;

  // Per-requirement progress bars.
  const requirements = (path?.requirements || []).map(req => {
    const counted = records?.filter(r => r?.countsToward?.[req.id]) || [];
    const verified = counted.filter(isVerified).length;
    const pending = counted.filter(isPendingVerification).length;
    const target = req?.targetDays || 0;
    const gateLabel = [
      req?.gates?.minLengthM != null ? `≥${req.gates.minLengthM}m` : null,
      req?.gates?.minGT != null ? `≥${req.gates.minGT}GT` : null
    ].filter(Boolean).join(' · ');

    return {
      id: req.id,
      label: req.label,
      note: req.note,
      gateLabel,
      target,
      verified,
      pending,
      total: verified + pending,
      remaining: Math.max(0, target - verified),
      percentComplete: target ? Math.min(100, Math.round((verified / target) * 100)) : 0,
      percentLogged: target ? Math.min(100, Math.round(((verified + pending) / target) * 100)) : 0
    };
  });

  // Four-bucket breakdown — every day has exactly one primary type, so these
  // reconcile to the total day count.
  const buckets = {
    [SEA_SERVICE_TYPE.SEAGOING]: 0,
    [SEA_SERVICE_TYPE.WATCHKEEPING]: 0,
    [SEA_SERVICE_TYPE.STANDBY]: 0,
    [SEA_SERVICE_TYPE.YARD]: 0
  };
  records?.forEach(r => {
    const t = r?.serviceType || SEA_SERVICE_TYPE.SEAGOING;
    if (buckets[t] != null) buckets[t] += 1;
  });

  return {
    pathName: path?.name,
    reference: path?.reference,
    requirements,
    buckets,
    totalDays: records?.length || 0
  };
};

/**
 * Get progress summary for user on selected path (localStorage path).
 * Returns multiple requirement bars plus the four-bucket day breakdown.
 */
export const getProgressSummary = (userId, pathId) => {
  const path = getPathById(pathId);
  if (!path) return null;
  // Recompute first so countsToward / serviceType are persisted, then read back.
  recomputeQualificationForUser(userId, pathId);
  const records = getPersonalSeaServiceForUser(userId);
  return summariseProgress(path, records);
};

// ============================================
// VERIFICATION WORKFLOW
// ============================================

/**
 * Submit sea service days for verification
 */
export const submitForVerification = (userId, startDate, endDate) => {
  const records = getPersonalSeaServiceForUserInRange(userId, startDate, endDate);
  const submittedAt = new Date()?.toISOString();
  
  records?.forEach(record => {
    if (record?.verificationStatus === VERIFICATION_STATUS?.NOT_SUBMITTED) {
      updatePersonalSeaServiceEntry(record?.id, {
        verificationStatus: VERIFICATION_STATUS?.SUBMITTED,
        submittedAt
      });
    }
  });
  
  return records?.length;
};

/**
 * Verify sea service days (Command only)
 */
export const verifySeaServiceDays = (userId, startDate, endDate, verifiedBy) => {
  const records = getPersonalSeaServiceForUserInRange(userId, startDate, endDate);
  const verifiedAt = new Date()?.toISOString();
  
  records?.forEach(record => {
    if (record?.verificationStatus === VERIFICATION_STATUS?.SUBMITTED) {
      updatePersonalSeaServiceEntry(record?.id, {
        verificationStatus: VERIFICATION_STATUS?.VERIFIED,
        verifiedBy,
        verifiedAt
      });
    }
  });
  
  return records?.length;
};

/**
 * Reject sea service days (Command only)
 */
export const rejectSeaServiceDays = (userId, startDate, endDate, rejectionReason) => {
  const records = getPersonalSeaServiceForUserInRange(userId, startDate, endDate);
  
  records?.forEach(record => {
    if (record?.verificationStatus === VERIFICATION_STATUS?.SUBMITTED) {
      updatePersonalSeaServiceEntry(record?.id, {
        verificationStatus: VERIFICATION_STATUS?.REJECTED,
        rejectionReason
      });
    }
  });
  
  return records?.length;
};

// ============================================
// CALENDAR DATA
// ============================================

/**
 * Get calendar data for a specific month
 */
export const getMonthCalendarData = (userId, year, month) => {
  const startDate = new Date(year, month, 1);
  const endDate = new Date(year, month + 1, 0);
  
  const records = getPersonalSeaServiceForUserInRange(
    userId,
    startDate?.toISOString()?.split('T')?.[0],
    endDate?.toISOString()?.split('T')?.[0]
  );
  
  // Group by date
  const calendarData = {};
  
  records?.forEach(record => {
    calendarData[record.date] = {
      ...record,
      colorState: getColorStateForRecord(record)
    };
  });
  
  return calendarData;
};

/**
 * Get color state for a sea service record
 */
const getColorStateForRecord = (record) => {
  // GREEN: Qualifying + Verified
  if (record?.qualifiesForSelectedPath && record?.verificationStatus === VERIFICATION_STATUS?.VERIFIED) {
    return 'green';
  }
  
  // YELLOW: Logged + Pending verification
  if (record?.qualifiesForSelectedPath && 
      (record?.verificationStatus === VERIFICATION_STATUS?.SUBMITTED || 
       record?.verificationStatus === VERIFICATION_STATUS?.NOT_SUBMITTED)) {
    return 'yellow';
  }
  
  // WHITE: Manual entry
  if (record?.source === SEA_SERVICE_SOURCE?.MANUAL) {
    return 'white';
  }
  
  // BLUE STRIPED: Onboard but not qualifying
  if (record?.source === SEA_SERVICE_SOURCE?.VESSEL_AUTO && !record?.qualifiesForSelectedPath) {
    return 'blue-striped';
  }
  
  return 'default';
};

// ============================================
// ACTIVITY LOGGING
// ============================================

/**
 * Activity logging helper
 */
const logActivity = (activityData) => {
  try {
    // Log activity to console for now
    // In production, this would send to activity feed storage
    console.log('Activity logged:', activityData);
  } catch (error) {
    console.error('Error logging activity:', error);
  }
};

/**
 * Sea Time Actions enum
 */
const SeaTimeActions = {
  SEA_TIME_ADDED: 'SEA_TIME_ADDED',
  SEA_TIME_UPDATED: 'SEA_TIME_UPDATED',
  SEA_TIME_DELETED: 'SEA_TIME_DELETED',
  SEA_TIME_VERIFIED: 'SEA_TIME_VERIFIED',
  SEA_TIME_SUBMITTED: 'SEA_TIME_SUBMITTED'
};

export default {
  // Rules config + path management
  getDefaultRulesConfig,
  getRulesConfig,
  saveRulesConfig,
  getQualificationPaths,
  getPathById,

  // Vessel management
  loadVessels,
  saveVessels,
  getVesselById,
  getCurrentVessel,
  
  // Saved vessels
  loadSavedVessels,
  saveSavedVessel,
  getSavedVesselById,
  deleteSavedVessel,
  
  // Crew onboard status
  loadCrewOnboardStatus,
  saveCrewOnboardStatus,
  getCrewOnboardStatus,
  getActiveCrewForVessel,
  updateCrewOnboardStatus,
  
  // Vessel service log
  loadVesselServiceLog,
  saveVesselServiceLog,
  getVesselServiceLogForVessel,
  addVesselServiceLogEntry,
  updateVesselServiceLogEntry,
  deleteVesselServiceLogEntry,
  
  // Personal sea service
  loadPersonalSeaService,
  savePersonalSeaService,
  getPersonalSeaServiceForUser,
  getPersonalSeaServiceForUserInRange,
  addManualSeaServiceEntry,
  updatePersonalSeaServiceEntry,
  deletePersonalSeaServiceEntry,
  
  // Auto-population
  autoPopulatePersonalSeaService,
  
  // Qualification (config-driven rules engine)
  getEntryVesselFacts,
  classifyServiceType,
  evaluateEntryQualification,
  checkQualificationForPath,
  recomputeQualificationForUser,
  
  // Progress
  summariseProgress,
  getProgressSummary,
  
  // Verification
  submitForVerification,
  verifySeaServiceDays,
  rejectSeaServiceDays,
  
  // Calendar
  getMonthCalendarData
};