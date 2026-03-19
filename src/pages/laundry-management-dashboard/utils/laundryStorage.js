// Laundry Storage - Persistent Laundry Management

import { getCurrentUser } from '../../../utils/authStorage';
import { logActivity } from '../../../utils/activityStorage';
import { showToast } from '../../../utils/toast';

const LAUNDRY_STORAGE_KEY = 'cargo_laundry_v1';

// Owner Type Enum
export const OwnerType = {
  GUEST: 'Guest',
  CREW: 'Crew'
};

// Laundry Status Enum
export const LaundryStatus = {
  IN_PROGRESS: 'InProgress',
  READY_TO_DELIVER: 'ReadyToDeliver',
  DELIVERED: 'Delivered'
};

// Priority Enum
export const LaundryPriority = {
  NORMAL: 'Normal',
  URGENT: 'Urgent'
};

/**
 * Load all laundry items from localStorage
 * @returns {Array} Array of laundry item objects
 */
const loadAllLaundryItems = () => {
  try {
    const stored = localStorage.getItem(LAUNDRY_STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
    return [];
  } catch (error) {
    console.error('Error loading laundry items:', error);
    return [];
  }
};

/**
 * Compress image to reduce storage size
 * @param {string} dataUrl - Base64 data URL
 * @param {number} maxWidth - Maximum width in pixels
 * @param {number} quality - JPEG quality (0-1)
 * @returns {Promise<string>} Compressed data URL
 */
const compressImage = (dataUrl, maxWidth = 800, quality = 0.7) => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      // Calculate new dimensions
      if (width > maxWidth) {
        height = (height * maxWidth) / width;
        width = maxWidth;
      }

      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      // Convert to JPEG with quality compression
      const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
      resolve(compressedDataUrl);
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
};

/**
 * Calculate storage size in MB
 * @param {string} data - JSON string
 * @returns {number} Size in MB
 */
const getStorageSize = (data) => {
  return new Blob([data])?.size / (1024 * 1024);
};

/**
 * Save laundry items to localStorage
 * @param {Array} items - Array of laundry item objects
 */
const saveLaundryItems = (items) => {
  try {
    const jsonData = JSON.stringify(items);
    const sizeInMB = getStorageSize(jsonData);
    
    // Warn if approaching quota (assume 5MB limit)
    if (sizeInMB > 4) {
      console.warn(`Laundry storage size: ${sizeInMB?.toFixed(2)}MB - approaching quota limit`);
    }
    
    localStorage.setItem(LAUNDRY_STORAGE_KEY, jsonData);
  } catch (error) {
    console.error('Error saving laundry items:', error);
    
    // Handle quota exceeded error
    if (error?.name === 'QuotaExceededError' || error?.code === 22) {
      showToast(
        'Storage limit reached. Photos are being compressed to save space. Please try again.',
        'error'
      );
      throw new Error('QUOTA_EXCEEDED');
    }
    throw error;
  }
};

/**
 * Get today's date key in YYYY-MM-DD format (local timezone)
 * @returns {string} Date key
 */
export const getTodayKey = () => {
  const now = new Date();
  return now?.toISOString()?.split('T')?.[0];
};

/**
 * Get last laundry day key from localStorage
 * @returns {string|null} Last day key or null
 */
export const getLastLaundryDayKey = () => {
  try {
    return localStorage.getItem('cargo_laundry_last_day_key');
  } catch (error) {
    console.error('Error getting last laundry day key:', error);
    return null;
  }
};

/**
 * Set last laundry day key in localStorage
 * @param {string} dayKey - Day key in YYYY-MM-DD format
 */
export const setLastLaundryDayKey = (dayKey) => {
  try {
    localStorage.setItem('cargo_laundry_last_day_key', dayKey);
  } catch (error) {
    console.error('Error setting last laundry day key:', error);
  }
};

/**
 * Check if a new day has started since last visit
 * @returns {boolean} True if new day detected
 */
export const isNewDay = () => {
  const todayKey = getTodayKey();
  const lastDayKey = getLastLaundryDayKey();
  return lastDayKey !== todayKey;
};

/**
 * Migrate existing laundry items to add serviceDay and deliveredAt fields
 * @returns {number} Number of items migrated
 */
export const migrateLaundryItems = () => {
  const items = loadAllLaundryItems();
  let migratedCount = 0;
  
  items?.forEach(item => {
    let needsSave = false;
    
    // Add serviceDay if missing (use createdAt date)
    if (!item?.serviceDay && item?.createdAt) {
      const createdDate = new Date(item.createdAt);
      item.serviceDay = createdDate?.toISOString()?.split('T')?.[0];
      needsSave = true;
      migratedCount++;
    }
    
    // Add deliveredAt if missing but status is delivered
    if (!item?.deliveredAt && item?.status === LaundryStatus?.DELIVERED) {
      // Use updatedAt as fallback for deliveredAt
      item.deliveredAt = item?.updatedAt || item?.createdAt;
      needsSave = true;
    }
  });
  
  if (migratedCount > 0) {
    saveLaundryItems(items);
    console.log(`Migrated ${migratedCount} laundry items with serviceDay field`);
  }
  
  return migratedCount;
};

/**
 * Create a new laundry item
 * @param {Object} itemData - Laundry item data
 * @returns {Object} New laundry item object
 */
export const createLaundryItem = (itemData) => {
  const currentUser = getCurrentUser();
  const now = new Date()?.toISOString();
  const todayKey = getTodayKey();
  
  // Normalize ownerType to lowercase: guest, crew, or unknown
  let ownerType = 'unknown';
  if (itemData?.ownerType) {
    const normalizedType = itemData?.ownerType?.toLowerCase();
    if (normalizedType === 'guest' || normalizedType === 'crew') {
      ownerType = normalizedType;
    }
  }
  
  // Determine ownerName with fallback to 'Unknown'
  let ownerName = itemData?.ownerName || 'Unknown';
  if (!itemData?.ownerName || itemData?.ownerName?.trim() === '') {
    ownerName = 'Unknown';
  }
  
  const newItem = {
    id: `laundry-${Date.now()}-${Math.random()?.toString(36)?.substr(2, 9)}`,
    createdAt: now,
    updatedAt: now,
    serviceDay: todayKey, // NEW: Set service day to today
    deliveredAt: null, // NEW: Initialize as null
    createdByUserId: currentUser?.id || '',
    createdByName: currentUser?.fullName || currentUser?.name || 'Unknown User',
    createdByTier: currentUser?.effectiveTier || currentUser?.tier || 'CREW',
    createdByDepartment: currentUser?.department || '',
    ownerType: ownerType,
    ownerId: itemData?.ownerGuestId || itemData?.ownerCrewUserId || null,
    ownerName: ownerName,
    ownerGuestId: itemData?.ownerGuestId || null,
    ownerCrewUserId: itemData?.ownerCrewUserId || null,
    ownerDisplayName: itemData?.ownerDisplayName || ownerName,
    area: itemData?.area || '',
    areaLocationId: itemData?.areaLocationId || null,
    photo: itemData?.photo || '',
    description: itemData?.description || '',
    priority: itemData?.priority || LaundryPriority?.NORMAL,
    status: LaundryStatus?.IN_PROGRESS,
    tags: itemData?.tags || [],
    notes: itemData?.notes || '',
    tripId: itemData?.tripId || null // Support tripId if provided
  };
  
  const items = loadAllLaundryItems();
  items?.push(newItem);
  saveLaundryItems(items);
  
  // Log activity
  try {
    logActivity({
      module: 'laundry',
      action: 'LAUNDRY_ITEM_CREATED',
      entityType: 'laundryItem',
      entityId: newItem?.id,
      summary: `Added laundry item: ${newItem?.description}`,
      meta: {
        ownerType: newItem?.ownerType,
        ownerDisplayName: newItem?.ownerDisplayName,
        priority: newItem?.priority
      }
    });
  } catch (error) {
    console.error('Error logging activity:', error);
  }
  
  showToast('Laundry item added successfully', 'success');
  return newItem;
};

/**
 * Update laundry item status
 * @param {string} itemId - Item ID
 * @param {string} newStatus - New status
 * @returns {Object|null} Updated item or null
 */
export const updateLaundryStatus = (itemId, newStatus) => {
  const items = loadAllLaundryItems();
  const itemIndex = items?.findIndex(item => item?.id === itemId);
  
  if (itemIndex === -1) {
    showToast('Laundry item not found', 'error');
    return null;
  }
  
  const now = new Date()?.toISOString();
  
  items[itemIndex].status = newStatus;
  items[itemIndex].updatedAt = now;
  
  if (newStatus === LaundryStatus?.DELIVERED) {
    items[itemIndex].deliveredAt = now; // FIXED: Store full ISO timestamp instead of date key
    
    // Log delivery activity
    try {
      logActivity({
        module: 'laundry',
        action: 'LAUNDRY_ITEM_DELIVERED',
        entityType: 'laundryItem',
        entityId: itemId,
        summary: `Delivered laundry: ${items?.[itemIndex]?.description}`,
        meta: {
          ownerType: items?.[itemIndex]?.ownerType,
          ownerName: items?.[itemIndex]?.ownerName
        }
      });
    } catch (error) {
      console.error('Error logging activity:', error);
    }
  }
  
  saveLaundryItems(items);
  showToast('Status updated', 'success');
  return items?.[itemIndex];
};

/**
 * Update laundry item
 * @param {string} itemId - Item ID
 * @param {Object} updates - Fields to update
 * @returns {Object|null} Updated item or null
 */
export const updateLaundryItem = (itemId, updates) => {
  const items = loadAllLaundryItems();
  const itemIndex = items?.findIndex(item => item?.id === itemId);
  
  if (itemIndex === -1) {
    showToast('Laundry item not found', 'error');
    return null;
  }
  
  items[itemIndex] = {
    ...items?.[itemIndex],
    ...updates,
    updatedAt: new Date()?.toISOString()
  };
  
  saveLaundryItems(items);
  showToast('Laundry item updated', 'success');
  return items?.[itemIndex];
};

/**
 * Get all laundry items
 * @returns {Array} Array of laundry items
 */
export const getAllLaundryItems = () => {
  return loadAllLaundryItems();
};

/**
 * Get laundry items for today
 * @returns {Array} Array of today's laundry items
 */
export const getTodayLaundryItems = () => {
  const items = loadAllLaundryItems();
  const today = new Date();
  today?.setHours(0, 0, 0, 0);
  
  return items?.filter(item => {
    const itemDate = new Date(item.createdAt);
    itemDate?.setHours(0, 0, 0, 0);
    return itemDate?.getTime() === today?.getTime();
  });
};

/**
 * Get today's laundry counts for dashboard widget
 * @returns {Object} { itemsIn, itemsOut }
 */
export const getTodayLaundryCounts = () => {
  const items = loadAllLaundryItems();
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  // Items IN: status is InProgress or ReadyToDeliver (created today or earlier, not delivered)
  const itemsIn = items?.filter(item => {
    return (item?.status === LaundryStatus?.IN_PROGRESS || item?.status === LaundryStatus?.READY_TO_DELIVER);
  })?.length;

  // Items OUT: status is Delivered AND deliveredAt is today
  const itemsOut = items?.filter(item => {
    if (item?.status !== LaundryStatus?.DELIVERED || !item?.deliveredAt) {
      return false;
    }
    const deliveredDate = new Date(item.deliveredAt);
    return deliveredDate >= todayStart && deliveredDate <= todayEnd;
  })?.length;

  return { itemsIn, itemsOut };
};

/**
 * Get today's laundry items by status for widget breakdown
 * @returns {Object} { inProgress, readyToDeliver, delivered }
 */
export const getTodayLaundryBreakdown = () => {
  const items = loadAllLaundryItems();
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  const inProgress = items?.filter(item => item?.status === LaundryStatus?.IN_PROGRESS)?.length;
  const readyToDeliver = items?.filter(item => item?.status === LaundryStatus?.READY_TO_DELIVER)?.length;
  const delivered = items?.filter(item => {
    if (item?.status !== LaundryStatus?.DELIVERED || !item?.deliveredAt) {
      return false;
    }
    const deliveredDate = new Date(item.deliveredAt);
    return deliveredDate >= todayStart && deliveredDate <= todayEnd;
  })?.length;

  return { inProgress, readyToDeliver, delivered };
};

/**
 * Get laundry items by date
 * @param {Date} date - Target date
 * @returns {Array} Array of laundry items for that date
 */
export const getLaundryItemsByDate = (date) => {
  const items = loadAllLaundryItems();
  const targetDate = new Date(date);
  targetDate?.setHours(0, 0, 0, 0);
  
  return items?.filter(item => {
    const itemDate = new Date(item.createdAt);
    itemDate?.setHours(0, 0, 0, 0);
    return itemDate?.getTime() === targetDate?.getTime();
  });
};

/**
 * Get laundry items for Today view (open items + delivered today)
 * @returns {Object} { openItems, deliveredToday }
 */
export const getTodayViewItems = () => {
  const items = loadAllLaundryItems();
  const todayKey = getTodayKey();

  // Open items: In Progress or Ready, regardless of serviceDay
  const openItems = items?.filter(item =>
    item?.status === LaundryStatus?.IN_PROGRESS ||
    item?.status === LaundryStatus?.READY_TO_DELIVER
  );

  // Delivered today: Delivered status AND deliveredAt matches today (extract date from ISO timestamp)
  const deliveredToday = items?.filter(item => {
    if (item?.status !== LaundryStatus?.DELIVERED || !item?.deliveredAt) {
      return false;
    }
    const deliveredDateKey = item?.deliveredAt?.split('T')?.[0];
    return deliveredDateKey === todayKey;
  });

  return { openItems, deliveredToday };
};

/**
 * Get laundry items by delivered date for History view
 * @param {string} dateKey - Date key in YYYY-MM-DD format
 * @returns {Array} Array of delivered items for that date
 */
export const getLaundryItemsByDeliveredDate = (dateKey) => {
  const items = loadAllLaundryItems();
  
  return items?.filter(item => {
    if (item?.status !== LaundryStatus?.DELIVERED || !item?.deliveredAt) {
      return false;
    }
    // Extract date portion from ISO timestamp
    const deliveredDateKey = item?.deliveredAt?.split('T')?.[0];
    return deliveredDateKey === dateKey;
  });
};

/**
 * Get unique delivered dates for History view
 * @returns {Array} Array of date strings (YYYY-MM-DD) sorted descending
 */
export const getDeliveredDates = () => {
  const items = loadAllLaundryItems();
  const dates = new Set();
  
  items?.forEach(item => {
    if (item?.status === LaundryStatus?.DELIVERED && item?.deliveredAt) {
      // Extract date portion from ISO timestamp
      const dateKey = item?.deliveredAt?.split('T')?.[0];
      dates?.add(dateKey);
    }
  });
  
  return Array.from(dates)?.sort()?.reverse();
};

/**
 * Reset day (manual) - updates last day key and refreshes view
 * @returns {boolean} Success status
 */
export const manualResetDay = () => {
  const currentUser = getCurrentUser();
  const userTier = (currentUser?.effectiveTier || currentUser?.tier || '')?.trim()?.toUpperCase();
  
  // Only COMMAND can manually reset
  if (userTier !== 'COMMAND' && userTier !== 'CHIEF') {
    showToast('Only Command/Chief can manually reset the day', 'error');
    return false;
  }
  
  const todayKey = getTodayKey();
  setLastLaundryDayKey(todayKey);
  
  // Log activity
  try {
    logActivity({
      module: 'laundry',
      action: 'LAUNDRY_MANUAL_RESET',
      entityType: 'laundryItem',
      entityId: 'manual-reset',
      summary: 'Manually reset laundry day view',
      meta: {
        resetDate: todayKey
      }
    });
  } catch (error) {
    console.error('Error logging activity:', error);
  }
  
  showToast('Day reset successfully. Delivered items cleared from Today view.', 'success');
  return true;
};

/**
 * Reset delivered items for the day (Chief only)
 * Marks delivered items as archived so they don't show in today's view
 * @returns {boolean} Success status
 */
export const resetDailyDelivered = () => {
  const currentUser = getCurrentUser();
  const userTier = (currentUser?.effectiveTier || currentUser?.tier || '')?.trim()?.toUpperCase();
  
  // Only COMMAND can reset
  if (userTier !== 'COMMAND') {
    showToast('Only Command can reset daily delivered items', 'error');
    return false;
  }
  
  const items = loadAllLaundryItems();
  const today = new Date();
  today?.setHours(0, 0, 0, 0);
  
  let resetCount = 0;
  
  items?.forEach(item => {
    if (item?.status === LaundryStatus?.DELIVERED) {
      const itemDate = new Date(item.createdAt);
      itemDate?.setHours(0, 0, 0, 0);
      
      // Mark as archived if delivered today
      if (itemDate?.getTime() === today?.getTime()) {
        item.isArchivedFromToday = true;
        resetCount++;
      }
    }
  });
  
  saveLaundryItems(items);
  
  // Log activity
  try {
    logActivity({
      module: 'laundry',
      action: 'LAUNDRY_RESET',
      entityType: 'laundryItem',
      entityId: 'daily-reset',
      summary: `Reset daily delivered items (${resetCount} items archived)`,
      meta: {
        resetCount
      }
    });
  } catch (error) {
    console.error('Error logging activity:', error);
  }
  
  showToast(`Daily reset complete. ${resetCount} delivered items archived.`, 'success');
  return true;
};

/**
 * Get laundry items for today (excluding archived delivered items)
 * @returns {Array} Array of active today's laundry items
 */
export const getActiveTodayLaundryItems = () => {
  const items = loadAllLaundryItems();
  const today = new Date();
  today?.setHours(0, 0, 0, 0);
  
  return items?.filter(item => {
    const itemDate = new Date(item.createdAt);
    itemDate?.setHours(0, 0, 0, 0);
    
    // Include today's items that are not archived
    if (itemDate?.getTime() === today?.getTime()) {
      return !item?.isArchivedFromToday;
    }
    
    // Include older items that are still in progress or ready to deliver
    if (itemDate?.getTime() < today?.getTime()) {
      return item?.status === LaundryStatus?.IN_PROGRESS || item?.status === LaundryStatus?.READY_TO_DELIVER;
    }
    
    return false;
  });
};

/**
 * Get unique dates with laundry items
 * @returns {Array} Array of date strings (YYYY-MM-DD)
 */
export const getLaundryDates = () => {
  const items = loadAllLaundryItems();
  const dates = new Set();
  
  items?.forEach(item => {
    const date = new Date(item.createdAt);
    date?.setHours(0, 0, 0, 0);
    dates?.add(date?.toISOString()?.split('T')?.[0]);
  });
  
  return Array.from(dates)?.sort()?.reverse();
};

/**
 * Add note to laundry item
 * @param {string} itemId - Item ID
 * @param {string} note - Note text
 * @returns {Object|null} Updated item or null
 */
export const addNoteToLaundryItem = (itemId, note) => {
  const items = loadAllLaundryItems();
  const itemIndex = items?.findIndex(item => item?.id === itemId);
  
  if (itemIndex === -1) {
    showToast('Laundry item not found', 'error');
    return null;
  }
  
  const currentNotes = items?.[itemIndex]?.notes || '';
  const timestamp = new Date()?.toLocaleString('en-GB');
  const currentUser = getCurrentUser();
  const userName = currentUser?.fullName || currentUser?.name || 'Unknown User';
  
  const newNote = `[${timestamp}] ${userName}: ${note}`;
  items[itemIndex].notes = currentNotes ? `${currentNotes}\n${newNote}` : newNote;
  items[itemIndex].updatedAt = new Date()?.toISOString();
  
  saveLaundryItems(items);
  showToast('Note added', 'success');
  return items?.[itemIndex];
};
export { loadAllLaundryItems };
function deleteLaundryItem(...args) {
  // eslint-disable-next-line no-console
  console.warn('Placeholder: deleteLaundryItem is not implemented yet.', args);
  return null;
}

export { deleteLaundryItem };