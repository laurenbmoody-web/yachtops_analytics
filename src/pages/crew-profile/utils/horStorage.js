// HOR (Hours of Rest) Storage and Calculation Utility
// Implements MLC/STCW compliance with REST EVENT-ANCHORED rolling window calculations
// CORE PRINCIPLES:
// - Compliance evaluated using rolling windows anchored to REST EVENTS, not fixed timestamps
// - Work is explicitly logged; rest is inferred as gaps between work blocks
// - All compliance calculations performed in SHIP TIME (timezone-aware per day)
// - ONE breach per rule per window (no duplicate breaches)

const HOR_STORAGE_KEY = 'cargo_hor_entries';
const HOR_PRESETS_KEY = 'cargo_hor_presets';
const HOR_VESSEL_TIMEZONE_KEY = 'cargo_hor_vessel_timezone';

// Breach type constants
export const BREACH_TYPES = {
  REST_LT_10_IN_24H: 'REST_LT_10_IN_24H',
  NO_6H_CONTINUOUS_REST_IN_24H: 'NO_6H_CONTINUOUS_REST_IN_24H',
  REST_LT_77_IN_7D: 'REST_LT_77_IN_7D'
};

// Human-readable breach names and helper text
export const BREACH_DISPLAY_INFO = {
  [BREACH_TYPES?.REST_LT_10_IN_24H]: {
    displayName: 'Less than 10 hours rest in a 24-hour period',
    helperText: 'Total rest within a rolling 24-hour period was below the MLC minimum of 10 hours.',
    code: 'REST_LT_10_IN_24H'
  },
  [BREACH_TYPES?.NO_6H_CONTINUOUS_REST_IN_24H]: {
    displayName: 'No continuous 6-hour rest period',
    helperText: 'The longest uninterrupted rest period was less than the required 6 hours.',
    code: 'NO_6H_CONTINUOUS_REST_IN_24H'
  },
  [BREACH_TYPES?.REST_LT_77_IN_7D]: {
    displayName: 'Less than 77 hours rest in 7 days',
    helperText: 'Total rest across a rolling 7-day period was below the MLC minimum of 77 hours.',
    code: 'REST_LT_77_IN_7D'
  }
};

const BREACH_LABELS = {
  [BREACH_TYPES?.REST_LT_10_IN_24H]: 'Less than 10 hours rest in 24h rolling window',
  [BREACH_TYPES?.NO_6H_CONTINUOUS_REST_IN_24H]: 'No 6-hour continuous rest in 24h window after previous rest',
  [BREACH_TYPES?.REST_LT_77_IN_7D]: 'Less than 77 hours rest in 7-day rolling window'
};

// ============================================
// TIMEZONE MANAGEMENT
// ============================================

/**
 * Get vessel timezone offset in minutes
 * Default to UTC (0) if not set
 */
export const getVesselTimezoneOffset = () => {
  try {
    const offset = localStorage.getItem(HOR_VESSEL_TIMEZONE_KEY);
    return offset ? parseInt(offset, 10) : 0;
  } catch (error) {
    console.error('Error getting vessel timezone offset:', error);
    return 0;
  }
};

/**
 * Set vessel timezone offset in minutes
 * Example: +60 for UTC+1, +120 for UTC+2, -300 for UTC-5
 */
export const setVesselTimezoneOffset = (offsetMinutes) => {
  try {
    localStorage.setItem(HOR_VESSEL_TIMEZONE_KEY, offsetMinutes?.toString());
    return true;
  } catch (error) {
    console.error('Error setting vessel timezone offset:', error);
    return false;
  }
};

/**
 * Convert ship-local date/time to UTC
 */
const shipTimeToUTC = (shipLocalDate, offsetMinutes) => {
  const utcTime = new Date(shipLocalDate.getTime() - (offsetMinutes * 60 * 1000));
  return utcTime;
};

/**
 * Convert UTC to ship-local date/time
 */
const utcToShipTime = (utcDate, offsetMinutes) => {
  const shipTime = new Date(utcDate.getTime() + (offsetMinutes * 60 * 1000));
  return shipTime;
};

// Load all HOR entries from localStorage
export const loadHOREntries = () => {
  try {
    const data = localStorage.getItem(HOR_STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error('Error loading HOR entries:', error);
    return [];
  }
};

// Save HOR entries to localStorage
export const saveHOREntries = (entries) => {
  try {
    localStorage.setItem(HOR_STORAGE_KEY, JSON.stringify(entries));
    return true;
  } catch (error) {
    console.error('Error saving HOR entries:', error);
    return false;
  }
};

// Add new work entries for a crew member
export const addWorkEntries = (crewId, newEntries) => {
  const allEntries = loadHOREntries();
  const offsetMinutes = getVesselTimezoneOffset();
  
  // Get dates from new entries
  const newDates = newEntries?.map(entry => entry?.date);
  
  // Filter out existing entries for the same dates (to replace them)
  const filteredEntries = allEntries?.filter(entry => 
    !(entry?.crewId === crewId && newDates?.includes(entry?.date))
  );
  
  const entriesWithCrewId = newEntries?.map(entry => ({
    ...entry,
    crewId,
    id: `${crewId}_${entry?.date}_${Date.now()}`,
    vesselTimezoneOffsetMinutes: offsetMinutes,
    storedInUTC: true
  }));
  
  const updatedEntries = [...filteredEntries, ...entriesWithCrewId];
  saveHOREntries(updatedEntries);

  // Log to activity feed
  if (newEntries?.length > 0) {
    const dates = newDates?.join(', ');
    logActivity({
      module: 'hor',
      action: 'HOR_UPDATED',
      entityType: 'hor_entry',
      entityId: crewId,
      summary: `HOR entries updated for ${newDates?.length} day(s)`,
      meta: { crewId, dates, entryCount: newEntries?.length }
    });
  }
  
  return updatedEntries;
};

// Delete all work entries for a specific date and crew member
export const deleteWorkEntriesForDate = (crewId, dateStr) => {
  const allEntries = loadHOREntries();
  
  // Filter out all entries for this crew member and date
  const filteredEntries = allEntries?.filter(entry => 
    !(entry?.crewId === crewId && entry?.date === dateStr)
  );
  
  saveHOREntries(filteredEntries);
  
  return filteredEntries;
};

// Get work entries for a specific crew member
export const getCrewWorkEntries = (crewId) => {
  const allEntries = loadHOREntries();
  return allEntries?.filter(entry => entry?.crewId === crewId) || [];
};

// ============================================
// CANONICAL DATA MODEL FUNCTIONS
// ============================================

/**
 * Convert work entries to canonical 30-minute block representation
 * Returns a Map: dateStr -> boolean[48] (true = worked, false = rest)
 */
const buildBlockMap = (entries) => {
  const blockMap = new Map();
  
  entries?.forEach(entry => {
    const dateStr = entry?.date;
    if (!blockMap?.has(dateStr)) {
      // Initialize all blocks as rest (false)
      blockMap?.set(dateStr, new Array(48)?.fill(false));
    }
    
    const blocks = blockMap?.get(dateStr);
    // Mark worked blocks as true
    entry?.workSegments?.forEach(segmentIndex => {
      if (segmentIndex >= 0 && segmentIndex < 48) {
        blocks[segmentIndex] = true;
      }
    });
  });
  
  return blockMap;
};

/**
 * Get work/rest blocks for a specific timestamp range (UTC-based)
 * Returns array of boolean values (true = worked, false = rest)
 */
const getBlocksInRange = (blockMap, startTime, endTime) => {
  const blocks = [];
  const current = new Date(startTime);
  const offsetMinutes = getVesselTimezoneOffset();
  
  while (current < endTime) {
    // Convert UTC time to ship-local time to find the correct date
    const shipTime = utcToShipTime(current, offsetMinutes);
    const dateStr = shipTime?.toISOString()?.split('T')?.[0];
    const hours = shipTime?.getHours();
    const minutes = shipTime?.getMinutes();
    const blockIndex = hours * 2 + (minutes >= 30 ? 1 : 0);
    
    const dayBlocks = blockMap?.get(dateStr);
    if (dayBlocks && blockIndex < 48) {
      blocks?.push(dayBlocks?.[blockIndex]);
    } else {
      // No data = rest
      blocks?.push(false);
    }
    
    // Move to next 30-minute block
    current?.setMinutes(current?.getMinutes() + 30);
  }
  
  return blocks;
};

/**
 * Calculate total rest minutes from blocks
 */
const calculateRestMinutes = (blocks) => {
  return blocks?.filter(worked => !worked)?.length * 30;
};

/**
 * Identify all continuous REST blocks from the work/rest timeline
 * Returns array of rest blocks with start time, end time, and duration
 * Rest blocks may cross midnight and are treated as continuous
 */
const identifyContinuousRestBlocks = (blockMap, startDate, endDate) => {
  const restBlocks = [];
  let currentRestStart = null;
  let currentRestDuration = 0;
  const offsetMinutes = getVesselTimezoneOffset();
  
  // Iterate through all 30-minute blocks in the date range
  const current = new Date(startDate);
  current?.setHours(0, 0, 0, 0);
  
  while (current <= endDate) {
    const shipTime = utcToShipTime(current, offsetMinutes);
    const dateStr = shipTime?.toISOString()?.split('T')?.[0];
    const hours = shipTime?.getHours();
    const minutes = shipTime?.getMinutes();
    const blockIndex = hours * 2 + (minutes >= 30 ? 1 : 0);
    
    const dayBlocks = blockMap?.get(dateStr);
    const isWorked = dayBlocks && blockIndex < 48 ? dayBlocks?.[blockIndex] : false;
    
    if (!isWorked) {
      // Rest block
      if (currentRestStart === null) {
        // Start new rest block
        currentRestStart = new Date(current);
      }
      currentRestDuration += 30;
    } else {
      // Work block - end current rest period if any
      if (currentRestStart !== null && currentRestDuration > 0) {
        const restEnd = new Date(current);
        restBlocks?.push({
          startTime: new Date(currentRestStart),
          endTime: restEnd,
          durationMinutes: currentRestDuration,
          durationHours: currentRestDuration / 60
        });
        currentRestStart = null;
        currentRestDuration = 0;
      }
    }
    
    // Move to next 30-minute block
    current?.setMinutes(current?.getMinutes() + 30);
  }
  
  // Add final rest block if exists
  if (currentRestStart !== null && currentRestDuration > 0) {
    const restEnd = new Date(current);
    restBlocks?.push({
      startTime: new Date(currentRestStart),
      endTime: restEnd,
      durationMinutes: currentRestDuration,
      durationHours: currentRestDuration / 60
    });
  }
  
  return restBlocks;
};

// ============================================
// REST EVENT-ANCHORED COMPLIANCE CHECKS
// ============================================

/**
 * Check compliance for a 24-hour window anchored to a rest block end
 * Evaluates:
 * 1. Minimum 10 hours total rest in the 24-hour window
 * 2. Minimum one continuous 6-hour rest period in the 24-hour window
 * Returns array of breach objects (one per rule violated)
 * CRITICAL: Only flags breaches if the rolling window has fully elapsed
 */
const checkRestEventWindow = (blockMap, restBlockEnd, restBlocks) => {
  const breaches = [];
  const offsetMinutes = getVesselTimezoneOffset();

  // Define 24h evaluation window: (restBlockEnd - 24h) → restBlockEnd
  // This evaluates the 24 hours BEFORE the rest block ended
  const windowEnd = new Date(restBlockEnd);
  const windowStart = new Date(restBlockEnd.getTime() - 24 * 60 * 60 * 1000);

  // CRITICAL: Do not mark as breach if window extends beyond current time
  const now = new Date();
  if (windowEnd > now) {
    // Window has not fully elapsed - cannot determine compliance yet
    return [];
  }

  // Get all blocks in this window
  const blocks = getBlocksInRange(blockMap, windowStart, windowEnd);
  const restMinutes = calculateRestMinutes(blocks);
  const restHours = restMinutes / 60;

  // Rule 1: Minimum 10 hours total rest in 24h
  if (restHours < 10) {
    const windowEndShipTime = utcToShipTime(windowEnd, offsetMinutes);
    const breachDate = windowEndShipTime?.toISOString()?.split('T')?.[0];

    breaches?.push({
      type: BREACH_TYPES?.REST_LT_10_IN_24H,
      date: breachDate,
      windowStart: windowStart?.toISOString(),
      windowEnd: windowEnd?.toISOString(),
      restHours: restHours,
      required: 10,
      anchoredToRestEnd: restBlockEnd?.toISOString()
    });
  }

  // Rule 2: Minimum one continuous 6-hour rest period in 24h window
  // Find all rest blocks that overlap with this window
  const restBlocksInWindow = restBlocks?.filter(block => {
    return block?.startTime < windowEnd && block?.endTime > windowStart;
  });

  // Check if any rest block in the window is >= 6h continuous
  const longestRestInWindow = restBlocksInWindow?.reduce((max, block) => 
    Math.max(max, block?.durationHours), 0);

  if (longestRestInWindow < 6) {
    const windowEndShipTime = utcToShipTime(windowEnd, offsetMinutes);
    const breachDate = windowEndShipTime?.toISOString()?.split('T')?.[0];

    breaches?.push({
      type: BREACH_TYPES?.NO_6H_CONTINUOUS_REST_IN_24H,
      date: breachDate,
      windowStart: windowStart?.toISOString(),
      windowEnd: windowEnd?.toISOString(),
      longestRestHours: longestRestInWindow,
      required: 6,
      anchoredToRestEnd: restBlockEnd?.toISOString()
    });
  }

  return breaches;
};

/**
 * Check 7-day rolling window for minimum 77 hours rest
 * Evaluated at rest block ends
 * CRITICAL: Only flags breaches if the rolling window has fully elapsed
 */
const check7DayRestEventWindow = (blockMap, restBlockEnd) => {
  const offsetMinutes = getVesselTimezoneOffset();
  const windowStart = new Date(restBlockEnd.getTime() - 7 * 24 * 60 * 60 * 1000);
  const windowEnd = new Date(restBlockEnd);

  // CRITICAL: Do not mark as breach if window extends beyond current time
  const now = new Date();
  if (windowEnd > now) {
    // Window has not fully elapsed - cannot determine compliance yet
    return null;
  }

  const blocks = getBlocksInRange(blockMap, windowStart, windowEnd);
  const restMinutes = calculateRestMinutes(blocks);
  const restHours = restMinutes / 60;

  if (restHours < 77) {
    const windowEndShipTime = utcToShipTime(windowEnd, offsetMinutes);
    const breachDate = windowEndShipTime?.toISOString()?.split('T')?.[0];

    return {
      type: BREACH_TYPES?.REST_LT_77_IN_7D,
      date: breachDate,
      windowStart: windowStart?.toISOString(),
      windowEnd: windowEnd?.toISOString(),
      restHours: restHours,
      required: 77,
      anchoredToRestEnd: restBlockEnd?.toISOString()
    };
  }

  return null;
};

// ============================================
// BREACH DEDUPLICATION
// ============================================

/**
 * Collapse overlapping breaches into single breach per rule per window
 * Groups breaches of the same type with overlapping time windows
 * Returns deduplicated array of breach episodes
 */
const deduplicateBreaches = (breachRecords) => {
  const offsetMinutes = getVesselTimezoneOffset();
  const deduplicatedBreaches = [];

  // Group breaches by type
  const breachesByType = {};
  breachRecords?.forEach(breach => {
    const type = breach?.type;
    if (!breachesByType?.[type]) {
      breachesByType[type] = [];
    }
    breachesByType?.[type]?.push(breach);
  });

  // For each breach type, deduplicate by date
  Object.keys(breachesByType)?.forEach(breachType => {
    const breaches = breachesByType?.[breachType];
    const breachesByDate = new Map();

    breaches?.forEach(breach => {
      const date = breach?.date;
      if (!breachesByDate?.has(date)) {
        breachesByDate?.set(date, breach);
      } else {
        // Keep the breach with the worst value
        const existing = breachesByDate?.get(date);
        const existingValue = existing?.restHours || existing?.longestRestHours || 0;
        const newValue = breach?.restHours || breach?.longestRestHours || 0;

        if (newValue < existingValue) {
          breachesByDate?.set(date, breach);
        }
      }
    });

    // Add deduplicated breaches
    breachesByDate?.forEach(breach => {
      deduplicatedBreaches?.push(breach);
    });
  });

  return deduplicatedBreaches;
};

// ============================================
// BREACH DETECTION (REST EVENT-ANCHORED)
// ============================================

/**
 * Detect all breaches for a crew member using REST EVENT-ANCHORED evaluation
 * For each REST BLOCK END TIME, evaluate ONE rolling 24-hour window
 * Returns breach episodes with human-readable display text
 */
export const detectBreaches = (crewId) => {
  const entries = getCrewWorkEntries(crewId);
  if (entries?.length === 0) return [];

  const blockMap = buildBlockMap(entries);
  const breachRecords = [];
  const offsetMinutes = getVesselTimezoneOffset();

  // Find date range of entries
  const dates = entries?.map(e => new Date(e.date))?.sort((a, b) => a - b);
  const earliestDate = dates?.[0];
  const latestDate = dates?.[dates?.length - 1];

  // Extend range to cover rolling windows
  const evaluationStart = new Date(earliestDate);
  evaluationStart?.setDate(evaluationStart?.getDate() - 7);
  const evaluationEnd = new Date(latestDate);
  evaluationEnd?.setDate(evaluationEnd?.getDate() + 1);

  // Convert to UTC for evaluation
  const evaluationStartUTC = shipTimeToUTC(evaluationStart, offsetMinutes);
  const evaluationEndUTC = shipTimeToUTC(evaluationEnd, offsetMinutes);

  // === STEP 1: Identify all continuous REST blocks ===
  const restBlocks = identifyContinuousRestBlocks(blockMap, evaluationStartUTC, evaluationEndUTC);

  // === STEP 2: For each REST BLOCK END, evaluate ONE 24-hour window ===
  restBlocks?.forEach(restBlock => {
    const restEnd = restBlock?.endTime;

    // Check 24-hour window (10h total rest + 6h continuous rest)
    const breaches24h = checkRestEventWindow(blockMap, restEnd, restBlocks);
    breaches24h?.forEach(breach => {
      breachRecords?.push({
        id: `breach_${Date.now()}_${Math.random()}`,
        ...breach
      });
    });

    // Check 7-day window (less frequently - only if rest block is significant)
    if (restBlock?.durationHours >= 6) {
      const breach7d = check7DayRestEventWindow(blockMap, restEnd);
      if (breach7d) {
        breachRecords?.push({
          id: `breach_${Date.now()}_${Math.random()}`,
          ...breach7d
        });
      }
    }
  });

  // === STEP 3: Deduplicate breaches (one per rule per date) ===
  const deduplicatedBreaches = deduplicateBreaches(breachRecords);

  // === STEP 4: Format for UI display with human-readable text ===
  return deduplicatedBreaches?.map(breach => {
    const windowStart = new Date(breach?.windowStart);
    const windowEnd = new Date(breach?.windowEnd);
    const windowStartShipTime = utcToShipTime(windowStart, offsetMinutes);
    const windowEndShipTime = utcToShipTime(windowEnd, offsetMinutes);
    const displayInfo = BREACH_DISPLAY_INFO?.[breach?.type];

    // Format supporting detail based on breach type
    let supportingDetail = '';
    if (breach?.type === BREACH_TYPES?.REST_LT_10_IN_24H) {
      supportingDetail = `Only ${breach?.restHours?.toFixed(1)} hours rest recorded (minimum required: 10 hours)`;
    } else if (breach?.type === BREACH_TYPES?.NO_6H_CONTINUOUS_REST_IN_24H) {
      supportingDetail = `Longest rest period was ${breach?.longestRestHours?.toFixed(1)} hours (minimum required: 6 hours)`;
    } else if (breach?.type === BREACH_TYPES?.REST_LT_77_IN_7D) {
      supportingDetail = `Only ${breach?.restHours?.toFixed(1)} hours rest recorded (minimum required: 77 hours)`;
    }

    return {
      id: breach?.id,
      type: displayInfo?.displayName || breach?.type,
      displayName: displayInfo?.displayName,
      helperText: displayInfo?.helperText,
      code: displayInfo?.code,
      dateStr: breach?.date,
      date: new Date(breach?.date)?.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
      windowStart: windowStartShipTime?.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
      windowEnd: windowEndShipTime?.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
      episodeStartDisplay: windowStartShipTime?.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
      episodeEndDisplay: windowEndShipTime?.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
      note: supportingDetail,
      affectedShipDates: [breach?.date],
      breachType: breach?.type,
      restHours: breach?.restHours,
      longestRestHours: breach?.longestRestHours,
      worstValue: breach?.restHours || breach?.longestRestHours || 0
    };
  })?.sort((a, b) => new Date(b.dateStr) - new Date(a.dateStr));
};

const formatBreachNote = (episode) => {
  switch (episode?.breachType) {
    case BREACH_TYPES?.REST_LT_10_IN_24H:
      return `Only ${episode?.worstValue?.toFixed(1)} hours rest (required: 10h)`;
    case BREACH_TYPES?.NO_6H_CONTINUOUS_REST_IN_24H:
      return `Longest rest period: ${episode?.worstValue?.toFixed(1)}h (required: 6h continuous)`;
    case BREACH_TYPES?.REST_LT_77_IN_7D:
      return `Only ${episode?.worstValue?.toFixed(1)} hours rest in 7 days (required: 77h)`;
    default:
      return 'Compliance breach detected';
  }
};

// ============================================
// COMPLIANCE STATUS CALCULATIONS
// ============================================

/**
 * Calculate rest hours for the most recent rolling 24-hour window
 */
export const calculateLast24HoursRest = (crewId) => {
  const entries = getCrewWorkEntries(crewId);
  if (entries?.length === 0) return 24;

  const blockMap = buildBlockMap(entries);
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const blocks = getBlocksInRange(blockMap, yesterday, now);
  const restMinutes = calculateRestMinutes(blocks);

  return restMinutes / 60;
};

/**
 * Calculate rest hours for the most recent rolling 7-day window
 */
export const calculateLast7DaysRest = (crewId) => {
  const entries = getCrewWorkEntries(crewId);
  if (entries?.length === 0) return 168;

  const blockMap = buildBlockMap(entries);
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const blocks = getBlocksInRange(blockMap, sevenDaysAgo, now);
  const restMinutes = calculateRestMinutes(blocks);

  return restMinutes / 60;
};

/**
 * Get rest hours for a specific date (daily view)
 * This is informational only - compliance uses rolling windows
 */
export const getRestHoursForDate = (crewId, dateStr) => {
  const entries = getCrewWorkEntries(crewId);
  const dateEntries = entries?.filter(entry => entry?.date === dateStr);

  if (dateEntries?.length === 0) return 24;

  // Count worked blocks
  const workedBlocks = new Set();
  dateEntries?.forEach(entry => {
    entry?.workSegments?.forEach(seg => workedBlocks?.add(seg));
  });

  const workMinutes = workedBlocks?.size * 30;
  const restMinutes = 1440 - workMinutes;

  return restMinutes / 60;
};

/**
 * Calculate overall compliance status
 * Checks if there are any active breaches in rolling windows
 */
export const getComplianceStatus = (crewId) => {
  const entries = getCrewWorkEntries(crewId);
  if (entries?.length === 0) {
    return {
      isCompliant: true,
      last24HoursRest: 24,
      last7DaysRest: 168
    };
  }

  const last24h = calculateLast24HoursRest(crewId);
  const last7d = calculateLast7DaysRest(crewId);

  // Check for any breaches
  const breaches = detectBreaches(crewId);
  const hasActiveBreaches = breaches?.length > 0;

  return {
    isCompliant: !hasActiveBreaches && last24h >= 10 && last7d >= 77,
    last24HoursRest: last24h,
    last7DaysRest: last7d
  };
};

/**
 * Get calendar data for a month
 * Daily rest hours are informational - compliance determined by rolling windows
 */
export const getMonthCalendarData = (crewId, year, month) => {
  const entries = getCrewWorkEntries(crewId);
  const blockMap = buildBlockMap(entries);
  const daysInMonth = new Date(year, month + 1, 0)?.getDate();
  const calendarData = [];

  // Get all breaches to mark affected dates
  const breaches = detectBreaches(crewId);
  const breachDates = new Set();
  breaches?.forEach(breach => {
    breach?.affectedShipDates?.forEach(dateStr => {
      const dateObj = new Date(dateStr);
      if (dateObj?.getFullYear() === year && dateObj?.getMonth() === month) {
        breachDates?.add(dateStr);
      }
    });
  });

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    const dateStr = date?.toISOString()?.split('T')?.[0];
    const restHours = getRestHoursForDate(crewId, dateStr);

    // Check if this date has any breaches
    let status = 'compliant';
    if (breachDates?.has(dateStr)) {
      status = 'breach';
    } else if (restHours < 11) {
      status = 'warning';
    }

    calendarData?.push({
      date: dateStr,
      day,
      restHours,
      status
    });
  }

  return calendarData;
};

/**
 * Detect breached calendar dates after saving work entries
 * Returns array of breached dates with breach types and rest hours
 * Scoped to the month being edited
 */
export const detectBreachedDatesAfterSave = (crewId, savedDates, year, month) => {
  // Run full breach detection
  const allBreaches = detectBreaches(crewId);

  // Get calendar data for the month
  const calendarData = getMonthCalendarData(crewId, year, month);

  // Map breaches to calendar dates
  const breachedDatesMap = new Map();

  allBreaches?.forEach(breach => {
    breach?.affectedShipDates?.forEach(dateStr => {
      const breachDateObj = new Date(dateStr);

      // Only include breaches within the edited month
      if (breachDateObj?.getFullYear() === year && breachDateObj?.getMonth() === month) {
        if (!breachedDatesMap?.has(dateStr)) {
          // Find calendar data for this date
          const dayData = calendarData?.find(d => {
            const calDate = new Date(year, month, d?.day);
            return calDate?.toISOString()?.split('T')?.[0] === dateStr;
          });

          breachedDatesMap?.set(dateStr, {
            date: dateStr,
            breachTypes: [],
            restHours: dayData?.restHours || 0,
            explanation: ''
          });
        }

        const breachedDate = breachedDatesMap?.get(dateStr);

        // Add breach type if not already included
        if (!breachedDate?.breachTypes?.includes(breach?.breachType)) {
          breachedDate?.breachTypes?.push(breach?.breachType);
        }

        // Build explanation using display info
        const displayInfo = BREACH_DISPLAY_INFO?.[breach?.breachType];
        if (displayInfo) {
          breachedDate.explanation = `${displayInfo?.displayName}: ${displayInfo?.helperText}`;
        }
      }
    });
  });

  // Convert map to array and filter to only dates with status 'breach'
  const breachedDates = Array.from(breachedDatesMap?.values())?.filter(dateInfo => {
    const dayData = calendarData?.find(d => {
      const calDate = new Date(year, month, d?.day);
      return calDate?.toISOString()?.split('T')?.[0] === dateInfo?.date;
    });
    return dayData?.status === 'breach';
  });

  return breachedDates;
};

// ============================================
// PRESET MANAGEMENT FUNCTIONS
// ============================================

export const loadPresets = () => {
  try {
    const data = localStorage.getItem(HOR_PRESETS_KEY);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error('Error loading HOR presets:', error);
    return [];
  }
};

export const savePresets = (presets) => {
  try {
    localStorage.setItem(HOR_PRESETS_KEY, JSON.stringify(presets));
    return true;
  } catch (error) {
    console.error('Error saving HOR presets:', error);
    return false;
  }
};

export const addPreset = (name, segments) => {
  const presets = loadPresets();
  const newPreset = {
    id: Date.now()?.toString(),
    name,
    segments: [...segments],
    createdAt: new Date()?.toISOString()
  };
  const updatedPresets = [...presets, newPreset];
  savePresets(updatedPresets);
  return newPreset;
};

export const updatePreset = (presetId, updates) => {
  const presets = loadPresets();
  const updatedPresets = presets?.map(preset => 
    preset?.id === presetId ? { ...preset, ...updates } : preset
  );
  savePresets(updatedPresets);
  return updatedPresets?.find(p => p?.id === presetId);
};

export const deletePreset = (presetId) => {
  const presets = loadPresets();
  const updatedPresets = presets?.filter(preset => preset?.id !== presetId);
  savePresets(updatedPresets);
  return true;
};

// ============================================
// MONTH CONFIRMATION & LOCKING
// ============================================

/**
 * Generate a hash of work blocks for tamper-evident audit
 */
const generateDatasetVersionHash = (crewId, year, month) => {
  const entries = getCrewWorkEntries(crewId);
  const monthEntries = entries?.filter(entry => {
    const entryDate = new Date(entry?.date);
    return entryDate?.getFullYear() === year && entryDate?.getMonth() === month;
  });

  // Sort by date for consistent hashing
  const sortedEntries = monthEntries?.sort((a, b) => a?.date?.localeCompare(b?.date));

  // Create a simple hash from the data
  const dataString = JSON.stringify(sortedEntries?.map(e => ({
    date: e?.date,
    workSegments: e?.workSegments
  })));

  // Simple hash function
  let hash = 0;
  for (let i = 0; i < dataString?.length; i++) {
    const char = dataString?.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }

  return Math.abs(hash)?.toString(16);
};

export const confirmMonth = (crewId, year, month, note = '') => {
  try {
    const confirmations = JSON.parse(localStorage.getItem('cargo_hor_month_confirmations') || '[]');
    
    // Check if already confirmed or locked
    const existingIndex = confirmations?.findIndex(c => c?.crewId === crewId && c?.year === year && c?.month === month);
    
    if (existingIndex !== -1) {
      const existing = confirmations?.[existingIndex];
      if (existing?.locked) {
        return false; // Cannot confirm a locked month
      }
      // Update existing confirmation
      confirmations[existingIndex] = {
        ...existing,
        confirmed: true,
        confirmedAt: new Date()?.toISOString(),
        confirmedTimezoneBasis: 'Ship Time',
        note: note || existing?.note,
        datasetVersionHash: generateDatasetVersionHash(crewId, year, month)
      };
    } else {
      // Create new confirmation
      confirmations?.push({
        crewId,
        year,
        month,
        confirmed: true,
        confirmedAt: new Date()?.toISOString(),
        confirmedTimezoneBasis: 'Ship Time',
        note,
        datasetVersionHash: generateDatasetVersionHash(crewId, year, month),
        locked: false
      });
    }
    
    localStorage.setItem('cargo_hor_month_confirmations', JSON.stringify(confirmations));
    return true;
  } catch (error) {
    console.error('Error confirming month:', error);
    return false;
  }
};

export const lockMonth = (year, month, lockedBy) => {
  try {
    const confirmations = JSON.parse(localStorage.getItem('cargo_hor_month_confirmations') || '[]');
    const users = loadUsers();
    
    // Lock for all users
    users?.forEach(user => {
      const existingIndex = confirmations?.findIndex(c => c?.crewId === user?.id && c?.year === year && c?.month === month);
      
      if (existingIndex !== -1) {
        // Update existing
        confirmations[existingIndex] = {
          ...confirmations?.[existingIndex],
          locked: true,
          lockedAt: new Date()?.toISOString(),
          lockedBy
        };
      } else {
        // Create new locked entry
        confirmations?.push({
          crewId: user?.id,
          year,
          month,
          confirmed: false,
          locked: true,
          lockedAt: new Date()?.toISOString(),
          lockedBy
        });
      }
    });
    
    localStorage.setItem('cargo_hor_month_confirmations', JSON.stringify(confirmations));
    
    // Log audit event
    logAuditEvent({
      type: 'MONTH_LOCKED',
      year,
      month,
      lockedBy,
      timestamp: new Date()?.toISOString(),
      affectedCrew: users?.map(u => u?.id)
    });
    
    return true;
  } catch (error) {
    console.error('Error locking month:', error);
    return false;
  }
};

export const unlockMonth = (year, month, unlockedBy, reason) => {
  try {
    const confirmations = JSON.parse(localStorage.getItem('cargo_hor_month_confirmations') || '[]');
    const users = loadUsers();
    
    // Unlock for all users
    users?.forEach(user => {
      const existingIndex = confirmations?.findIndex(c => c?.crewId === user?.id && c?.year === year && c?.month === month);
      
      if (existingIndex !== -1) {
        confirmations[existingIndex] = {
          ...confirmations?.[existingIndex],
          locked: false,
          unlockedAt: new Date()?.toISOString(),
          unlockedBy,
          unlockReason: reason
        };
      }
    });
    
    localStorage.setItem('cargo_hor_month_confirmations', JSON.stringify(confirmations));
    
    // Log audit event
    logAuditEvent({
      type: 'MONTH_UNLOCKED',
      year,
      month,
      unlockedBy,
      reason,
      timestamp: new Date()?.toISOString(),
      affectedCrew: users?.map(u => u?.id)
    });
    
    return true;
  } catch (error) {
    console.error('Error unlocking month:', error);
    return false;
  }
};

function loadUsers() {
  try {
    const users = JSON.parse(localStorage.getItem('cargo_users') || '[]');
    return users;
  } catch {
    return [];
  }
}

// ============================================
// AUDIT TRAIL LOGGING
// ============================================

const logAuditEvent = (event) => {
  try {
    const auditLog = JSON.parse(localStorage.getItem('cargo_hor_audit_log') || '[]');
    auditLog?.push({
      id: `audit_${Date.now()}`,
      ...event
    });
    localStorage.setItem('cargo_hor_audit_log', JSON.stringify(auditLog));
  } catch (error) {
    console.error('Error logging audit event:', error);
  }
};

export const getAuditLog = (crewId = null, year = null, month = null) => {
  try {
    const auditLog = JSON.parse(localStorage.getItem('cargo_hor_audit_log') || '[]');
    
    let filtered = auditLog;
    
    if (crewId) {
      filtered = filtered?.filter(event => 
        event?.crewId === crewId || 
        event?.affectedCrew?.includes(crewId)
      );
    }
    
    if (year !== null && month !== null) {
      filtered = filtered?.filter(event => 
        event?.year === year && event?.month === month
      );
    }
    
    return filtered?.sort((a, b) => new Date(b?.timestamp) - new Date(a?.timestamp));
  } catch (error) {
    console.error('Error getting audit log:', error);
    return [];
  }
};

export const getMonthStatus = (crewId, year, month) => {
  try {
    const confirmations = JSON.parse(localStorage.getItem('cargo_hor_month_confirmations') || '[]');
    const confirmation = confirmations?.find(c => c?.crewId === crewId && c?.year === year && c?.month === month);
    
    if (!confirmation) {
      return { status: 'Draft', confirmed: false, locked: false };
    }
    
    if (confirmation?.locked) {
      return { status: 'Locked', confirmed: confirmation?.confirmed, locked: true };
    }
    
    if (confirmation?.confirmed) {
      return { status: 'Confirmed by Crew', confirmed: true, locked: false };
    }
    
    return { status: 'Draft', confirmed: false, locked: false };
  } catch (error) {
    console.error('Error getting month status:', error);
    return { status: 'Draft', confirmed: false, locked: false };
  }
};

// ============================================
// CORRECTION REQUESTS (COMMAND)
// ============================================

export const createCorrectionRequest = ({ crewId, crewName, month, message, dates }) => {
  try {
    const requests = JSON.parse(localStorage.getItem('cargo_hor_correction_requests') || '[]');
    
    const newRequest = {
      id: `correction_${Date.now()}`,
      crewId,
      crewName,
      month: month?.toISOString(),
      message,
      dates: dates || [],
      timestamp: new Date()?.toISOString(),
      status: 'pending'
    };
    
    requests?.push(newRequest);
    localStorage.setItem('cargo_hor_correction_requests', JSON.stringify(requests));
    
    return newRequest;
  } catch (error) {
    console.error('Error creating correction request:', error);
    return null;
  }
};

export const getCorrectionRequests = (crewId) => {
  try {
    const requests = JSON.parse(localStorage.getItem('cargo_hor_correction_requests') || '[]');
    return requests?.filter(r => r?.crewId === crewId);
  } catch (error) {
    console.error('Error getting correction requests:', error);
    return [];
  }
};

import { createNotification, SEVERITY } from '../../team-jobs-management/utils/notifications';

const REMINDER_LOG_KEY = 'cargo_hor_reminder_log';

/**
 * Check missing days for a crew member in current month
 */
const getMissingDays = (crewId, year, month) => {
  const entries = getCrewWorkEntries(crewId);
  const today = new Date();
  const currentDay = today?.getMonth() === month && today?.getFullYear() === year ? today?.getDate() : new Date(year, month + 1, 0)?.getDate();
  
  const entriesThisMonth = entries?.filter(entry => {
    const entryDate = new Date(entry?.date);
    return entryDate?.getFullYear() === year && entryDate?.getMonth() === month;
  });
  
  const loggedDates = new Set(entriesThisMonth?.map(e => e?.date));
  const missingDates = [];
  
  for (let day = 1; day <= currentDay; day++) {
    const dateStr = `${year}-${String(month + 1)?.padStart(2, '0')}-${String(day)?.padStart(2, '0')}`;
    if (!loggedDates?.has(dateStr)) {
      missingDates?.push(day);
    }
  }
  
  return missingDates;
};

/**
 * Log a reminder event
 */
const logReminder = (userId, month, reminderType, source = 'AUTO', senderId = null) => {
  try {
    const log = JSON.parse(localStorage.getItem(REMINDER_LOG_KEY) || '[]');
    log?.push({
      id: `reminder_${Date.now()}_${Math.random()}`,
      userId,
      month: month?.toISOString(),
      reminderType,
      source,
      senderId,
      sentAt: new Date()?.toISOString()
    });
    localStorage.setItem(REMINDER_LOG_KEY, JSON.stringify(log));
  } catch (error) {
    console.error('Error logging reminder:', error);
  }
};

/**
 * Get reminder log for a user
 */
export const getReminderLog = (userId, year = null, month = null) => {
  try {
    const log = JSON.parse(localStorage.getItem(REMINDER_LOG_KEY) || '[]');
    let filtered = log?.filter(r => r?.userId === userId);
    
    if (year !== null && month !== null) {
      filtered = filtered?.filter(r => {
        const reminderDate = new Date(r?.month);
        return reminderDate?.getFullYear() === year && reminderDate?.getMonth() === month;
      });
    }
    
    return filtered?.sort((a, b) => new Date(b?.sentAt) - new Date(a?.sentAt));
  } catch (error) {
    console.error('Error getting reminder log:', error);
    return [];
  }
};

/**
 * Send HOR reminder notification
 */
const sendHORReminder = (userId, userName, reminderType, missingDays = []) => {
  const currentMonth = new Date()?.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  
  let title = '';
  let message = '';
  
  if (reminderType === 'MISSING_DAYS') {
    title = 'HOR Reminder: Missing Entries';
    const daysText = missingDays?.length <= 5 
      ? missingDays?.join(', ')
      : `${missingDays?.slice(0, 5)?.join(', ')} and ${missingDays?.length - 5} more`;
    message = `Please complete your hours for ${currentMonth}. Missing days: ${daysText}.`;
  } else if (reminderType === 'CONFIRM_MONTH') {
    title = 'HOR Reminder: Confirm Month';
    message = `Your ${currentMonth} entries are complete. Please Confirm Month.`;
  }
  
  createNotification({
    userId,
    type: 'HOR_REMINDER',
    severity: SEVERITY?.INFO,
    title,
    message,
    actionUrl: '/profile',
    metadata: {
      reminderType,
      missingDays
    }
  });
};

/**
 * Manual nudge - sends reminder immediately
 */
export const sendManualNudge = (userId, userName, senderId) => {
  const today = new Date();
  const year = today?.getFullYear();
  const month = today?.getMonth();
  
  // Check month status
  const monthStatus = getMonthStatus(userId, year, month);
  
  if (monthStatus?.locked) {
    return { success: false, message: 'Month is locked' };
  }
  
  // Check for missing days
  const missingDays = getMissingDays(userId, year, month);
  
  if (missingDays?.length > 0) {
    sendHORReminder(userId, userName, 'MISSING_DAYS', missingDays);
    logReminder(userId, today, 'MISSING_DAYS', 'MANUAL', senderId);
    return { success: true, message: `Nudge sent. Missing ${missingDays?.length} day(s).` };
  } else if (!monthStatus?.confirmed) {
    sendHORReminder(userId, userName, 'CONFIRM_MONTH');
    logReminder(userId, today, 'CONFIRM_MONTH', 'MANUAL', senderId);
    return { success: true, message: 'Nudge sent to confirm month.' };
  }
  
  return { success: false, message: 'No action needed - entries complete and confirmed.' };
};

export default {
  loadHOREntries,
  saveHOREntries,
  addWorkEntries,
  deleteWorkEntriesForDate,
  getCrewWorkEntries,
  calculateLast24HoursRest,
  calculateLast7DaysRest,
  getRestHoursForDate,
  getMonthCalendarData,
  detectBreaches,
  getComplianceStatus,
  loadPresets,
  savePresets,
  addPreset,
  updatePreset,
  deletePreset,
  BREACH_TYPES,
  BREACH_DISPLAY_INFO,
  getVesselTimezoneOffset,
  setVesselTimezoneOffset
};
function runAllHORTests(...args) {
  // eslint-disable-next-line no-console
  console.warn('Placeholder: runAllHORTests is not implemented yet.', args);
  return null;
}

export { runAllHORTests };
function getMonthConfirmation(...args) {
  // eslint-disable-next-line no-console
  console.warn('Placeholder: getMonthConfirmation is not implemented yet.', args);
  return null;
}

export { getMonthConfirmation };
function isMonthEditable(...args) {
  // eslint-disable-next-line no-console
  console.warn('Placeholder: isMonthEditable is not implemented yet.', args);
  return null;
}

export { isMonthEditable };
function hasBreachNoteForDate(...args) {
  // eslint-disable-next-line no-console
  console.warn('Placeholder: hasBreachNoteForDate is not implemented yet.', args);
  return null;
}

export { hasBreachNoteForDate };
import { logActivity } from '../../../utils/activityStorage';

// HOR Actions for activity feed
export const HORActions = {
  HOR_UPDATED: 'HOR_UPDATED'
};