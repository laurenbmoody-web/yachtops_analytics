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
const PATHS_CONFIG_KEY = 'cargo_seatime_paths_v1';
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
// PATH CONFIGURATION
// ============================================

/**
 * Get all available qualification paths
 * V1: MCA OOW (Yachts) only
 * Architecture allows adding more paths later
 */
export const getQualificationPaths = () => {
  try {
    const stored = localStorage.getItem(PATHS_CONFIG_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
    
    // Default V1 configuration
    const defaultPaths = [
      {
        id: 'mca-oow-yachts',
        name: 'MCA OOW (Yachts)',
        targetDays: 1095, // 3 years
        color: '#3b82f6', // Blue
        qualificationRules: {
          minGT: 80, // Minimum 80 GT
          commercialStatus: ['COMMERCIAL', 'PRIVATE'], // Both commercial and private yachts
          excludeYardTime: true, // Yard time doesn't count
          requiresWatchEligible: false // V1: not enforced
        }
      }
    ];
    
    localStorage.setItem(PATHS_CONFIG_KEY, JSON.stringify(defaultPaths));
    return defaultPaths;
  } catch (error) {
    console.error('Error loading qualification paths:', error);
    return [];
  }
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
    id: `sea-service-${Date.now()}`,
    userId,
    vesselId: entry?.vesselId || null,
    vesselName: entry?.vesselName || '',
    savedVesselId: entry?.savedVesselId || null,
    date: entry?.date,
    source: SEA_SERVICE_SOURCE?.MANUAL,
    vesselStatus: entry?.vesselStatus || null,
    capacityServed: entry?.capacityServed || '',
    watchkeepingRole: entry?.watchkeepingRole || false,
    locationTradingArea: entry?.locationTradingArea || '',
    seaServiceType: entry?.seaServiceType || 'Underway',
    qualifiesForSelectedPath: false, // Will be computed
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
            qualifiesForSelectedPath: false, // Will be computed by qualification check
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
// QUALIFICATION LOGIC
// ============================================

/**
 * Check if a sea service day qualifies for a specific path
 */
export const checkQualificationForPath = (seaServiceDay, pathId) => {
  const path = getPathById(pathId);
  if (!path) return { qualifies: false, reasons: ['Path not found'] };
  
  const vessel = getVesselById(seaServiceDay?.vesselId);
  if (!vessel) return { qualifies: false, reasons: ['Vessel data not available'] };
  
  const rules = path?.qualificationRules;
  const reasons = [];
  
  // Check minimum GT
  if (rules?.minGT && vessel?.grossTonnage < rules?.minGT) {
    reasons?.push(`Vessel GT (${vessel?.grossTonnage}) below minimum (${rules?.minGT})`);
  }
  
  // Check commercial status
  if (rules?.commercialStatus && !rules?.commercialStatus?.includes(vessel?.commercialStatus)) {
    reasons?.push(`Vessel commercial status (${vessel?.commercialStatus}) not eligible`);
  }
  
  // Check yard time exclusion
  if (rules?.excludeYardTime && seaServiceDay?.vesselStatus === VESSEL_STATUS?.IN_YARD) {
    reasons?.push('Yard time does not count towards qualification');
  }
  
  // Check watch eligibility (if required)
  if (rules?.requiresWatchEligible) {
    const crewStatus = getCrewOnboardStatus(seaServiceDay?.userId, seaServiceDay?.vesselId);
    if (crewStatus && !crewStatus?.watchEligible) {
      reasons?.push('Crew member not watch-eligible');
    }
  }
  
  return {
    qualifies: reasons?.length === 0,
    reasons
  };
};

/**
 * Recompute qualification status for all user's sea service days
 */
export const recomputeQualificationForUser = (userId, pathId) => {
  const records = getPersonalSeaServiceForUser(userId);
  
  records?.forEach(record => {
    const { qualifies, reasons } = checkQualificationForPath(record, pathId);
    
    // Update qualification status
    record.qualifiesForSelectedPath = qualifies;
    
    // Update state based on qualification and verification
    if (record?.source === SEA_SERVICE_SOURCE?.MANUAL) {
      record.state = SEA_SERVICE_STATE?.MANUAL;
    } else if (qualifies && record?.verificationStatus === VERIFICATION_STATUS?.VERIFIED) {
      record.state = SEA_SERVICE_STATE?.VERIFIED;
    } else if (qualifies) {
      record.state = SEA_SERVICE_STATE?.PENDING;
    } else {
      record.state = SEA_SERVICE_STATE?.NON_QUALIFYING;
    }
    
    // Store non-qualification reasons
    if (!qualifies && reasons?.length > 0) {
      record.nonQualifyingReasons = reasons;
    } else {
      delete record?.nonQualifyingReasons;
    }
  });
  
  savePersonalSeaService(loadPersonalSeaService());
};

// ============================================
// PROGRESS CALCULATION
// ============================================

/**
 * Get progress summary for user on selected path
 */
export const getProgressSummary = (userId, pathId) => {
  const path = getPathById(pathId);
  if (!path) return null;
  
  const records = getPersonalSeaServiceForUser(userId);
  
  // Recompute qualification for current path
  recomputeQualificationForUser(userId, pathId);
  
  const verifiedQualifying = records?.filter(r => 
    r?.qualifiesForSelectedPath && r?.verificationStatus === VERIFICATION_STATUS?.VERIFIED
  )?.length;
  
  const pendingQualifying = records?.filter(r => 
    r?.qualifiesForSelectedPath && 
    (r?.verificationStatus === VERIFICATION_STATUS?.NOT_SUBMITTED || 
     r?.verificationStatus === VERIFICATION_STATUS?.SUBMITTED)
  )?.length;
  
  const manualDays = records?.filter(r => r?.source === SEA_SERVICE_SOURCE?.MANUAL)?.length;
  
  const nonQualifyingOnboard = records?.filter(r => 
    r?.source === SEA_SERVICE_SOURCE?.VESSEL_AUTO && !r?.qualifiesForSelectedPath
  )?.length;
  
  const remaining = Math.max(0, path?.targetDays - verifiedQualifying);
  
  return {
    pathName: path?.name,
    targetDays: path?.targetDays,
    verifiedQualifying,
    pendingQualifying,
    manualDays,
    nonQualifyingOnboard,
    remaining,
    percentComplete: Math.min(100, Math.round((verifiedQualifying / path?.targetDays) * 100))
  };
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
  // Path management
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
  
  // Qualification
  checkQualificationForPath,
  recomputeQualificationForUser,
  
  // Progress
  getProgressSummary,
  
  // Verification
  submitForVerification,
  verifySeaServiceDays,
  rejectSeaServiceDays,
  
  // Calendar
  getMonthCalendarData
};