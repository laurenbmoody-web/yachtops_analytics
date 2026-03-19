// Defects Storage - Persistent Defect Management

import { getCurrentUser, hasCommandAccess, hasChiefAccess, hasHODAccess } from '../../../utils/authStorage';
import { logActivity, DefectActions } from '../../../utils/activityStorage';
import { getAllDecks, getZonesByDeck, getSpacesByZone } from '../../locations-management-settings/utils/locationsHierarchyStorage';
import { notifyChiefsPendingDefect, notifyChiefsNewDefect, notifySenderAccepted, notifySenderDeclined } from './defectsNotifications';
import { showToast } from '../../../utils/toast';

const DEFECTS_STORAGE_KEY = 'cargo_defects_v1';

/**
 * Normalize department name for consistent comparison
 * @param {string} dept - Department name
 * @returns {string} Normalized uppercase trimmed department name
 */
export const normalizeDept = (dept) => {
  return (dept || '')?.trim()?.toUpperCase();
};

// Defect Status Enum
export const DefectStatus = {
  PENDING_ACCEPTANCE: 'pending_acceptance',
  NEW: 'New',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'InProgress',
  WAITING_PARTS: 'WaitingParts',
  FIXED: 'Fixed',
  CLOSED: 'Closed',
  DECLINED: 'declined',
  REOPENED: 'Reopened'
};

// Defect Priority Enum
export const DefectPriority = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  CRITICAL: 'Critical'
};

// Department Owner Enum
export const DefectDepartment = {
  INTERIOR: 'Interior',
  DECK: 'Deck',
  ENGINEERING: 'Engineering',
  GALLEY: 'Galley',
  MANAGEMENT: 'Management'
};

/**
 * Load all defects from localStorage
 * @returns {Array} Array of defect objects
 */
const loadAllDefects = () => {
  try {
    const stored = localStorage.getItem(DEFECTS_STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
    return [];
  } catch (error) {
    console.error('Error loading defects:', error);
    return [];
  }
};

/**
 * Save defects to localStorage
 * @param {Array} defects - Array of defect objects
 */
const saveDefects = (defects) => {
  try {
    localStorage.setItem(DEFECTS_STORAGE_KEY, JSON.stringify(defects));
  } catch (error) {
    console.error('Error saving defects:', error);
  }
};

/**
 * Build location path label from IDs
 * @param {string} deckId
 * @param {string} zoneId
 * @param {string} spaceId
 * @returns {string} "Deck > Zone > Space" or "Deck > Zone"
 */
export const buildLocationPathLabel = (deckId, zoneId, spaceId) => {
  const decks = getAllDecks(false);
  const deck = decks?.find(d => d?.id === deckId);
  
  if (!deck) return '';
  
  const zones = getZonesByDeck(deckId, false);
  const zone = zones?.find(z => z?.id === zoneId);
  
  if (!zone) return deck?.name;
  
  if (!spaceId) return `${deck?.name} > ${zone?.name}`;
  
  const spaces = getSpacesByZone(zoneId, false);
  const space = spaces?.find(s => s?.id === spaceId);
  
  if (!space) return `${deck?.name} > ${zone?.name}`;
  
  return `${deck?.name} > ${zone?.name} > ${space?.name}`;
};

/**
 * Create a new defect
 * @param {Object} defectData - Defect data
 * @returns {Object} New defect object
 */
export const createDefect = (defectData) => {
  const currentUser = getCurrentUser();
  const now = new Date()?.toISOString();
  
  let locationPathLabel = buildLocationPathLabel(
    defectData?.locationDeckId,
    defectData?.locationZoneId,
    defectData?.locationSpaceId
  );
  
  // CRITICAL: Use effectiveTier with normalization for role detection
  const userTierRaw = currentUser?.effectiveTier || currentUser?.roleTier || currentUser?.permissionTier || currentUser?.tier || '';
  const userTier = userTierRaw?.trim()?.toUpperCase();
  
  // Determine if pending acceptance is required based on role AND department
  const isCommand = (userTier === 'COMMAND');
  const isChief = (userTier === 'CHIEF');
  const isHOD = (userTier === 'HOD');
  const isCrew = (!isCommand && !isChief && !isHOD);
  
  // Normalize departments for consistent comparison
  const targetDepartment = defectData?.departmentOwner || currentUser?.department;
  const createdByDepartment = currentUser?.department;
  
  // Determine pending acceptance logic:
  // COMMAND: Always creates open defects (no pending)
  // CHIEF: Creates open for same dept, pending_acceptance for different dept
  // HOD: Always creates open defects for own dept only
  // CREW: Always creates pending_acceptance for own dept
  let requiresPendingAcceptance = false;
  let status = DefectStatus?.NEW;
  let pendingForDept = null;
  
  if (isCommand) {
    // Command: always open, no pending
    requiresPendingAcceptance = false;
    status = DefectStatus?.NEW;
  } else if (isChief) {
    // Chief: check if cross-department
    const isCrossDept = normalizeDept(targetDepartment) !== normalizeDept(createdByDepartment);
    if (isCrossDept) {
      requiresPendingAcceptance = true;
      status = DefectStatus?.PENDING_ACCEPTANCE;
      pendingForDept = normalizeDept(targetDepartment);
    } else {
      requiresPendingAcceptance = false;
      status = DefectStatus?.NEW;
    }
  } else if (isHOD) {
    // HOD: always open for own dept
    requiresPendingAcceptance = false;
    status = DefectStatus?.NEW;
  } else if (isCrew) {
    // Crew: always pending for own dept
    requiresPendingAcceptance = true;
    status = DefectStatus?.PENDING_ACCEPTANCE;
    pendingForDept = normalizeDept(createdByDepartment);
  }
  
  const newDefect = {
    id: crypto.randomUUID(),
    title: defectData?.title?.trim(),
    description: defectData?.description?.trim() || '',
    departmentOwner: targetDepartment,
    targetDepartment: targetDepartment,
    priority: defectData?.priority || DefectPriority?.MEDIUM,
    status: status,
    dueDate: defectData?.dueDate || null,
    assignedToUserId: defectData?.assignedToUserId || null,
    reportedByUserId: currentUser?.id,
    reportedByName: currentUser?.fullName || currentUser?.name,
    createdByUserId: currentUser?.id,
    createdByName: currentUser?.fullName || currentUser?.name,
    createdByDepartment: createdByDepartment,
    createdByTier: userTier,
    submittedByUserId: requiresPendingAcceptance ? currentUser?.id : null,
    submittedByName: requiresPendingAcceptance ? (currentUser?.fullName || currentUser?.name) : null,
    pendingForDepartment: pendingForDept,
    sentForAcceptance: requiresPendingAcceptance,
    decidedByUserId: null,
    decidedAt: null,
    decisionNotes: null,
    createdAt: now,
    updatedAt: now,
    closedAt: null,
    photos: defectData?.photos || [],
    locationDeckId: defectData?.locationDeckId,
    locationZoneId: defectData?.locationZoneId,
    locationSpaceId: defectData?.locationSpaceId || null,
    locationPathLabel: locationPathLabel,
    locationFreeText: defectData?.locationFreeText || '',
    defectType: defectData?.defectType || null,
    defectSubType: defectData?.defectSubType || null,
    defectTypeCustom: defectData?.defectTypeCustom || false,
    defectSubTypeCustom: defectData?.defectSubTypeCustom || false,
    affectsGuestAreas: defectData?.affectsGuestAreas || false,
    safetyRelated: defectData?.safetyRelated || false,
    comments: [],
    activityLog: [],
    isArchivedBySender: false,
    archivedAt: null,
    deletedAt: null,
    deletedByUserId: null
  };
  
  const defects = loadAllDefects();
  defects?.push(newDefect);
  saveDefects(defects);
  
  // Log activity
  logActivity({
    module: 'defects',
    action: requiresPendingAcceptance ? 'DEFECT_PENDING_ACCEPTANCE' : DefectActions?.DEFECT_CREATED,
    entityType: 'defect',
    entityId: newDefect?.id,
    departmentScope: normalizeDept(newDefect?.departmentOwner),
    summary: requiresPendingAcceptance 
      ? `Defect awaiting acceptance: ${newDefect?.title}`
      : `Created defect: ${newDefect?.title}`,
    meta: {
      priority: newDefect?.priority,
      location: locationPathLabel
    }
  });
  
  // Send notifications based on creation rules
  if (requiresPendingAcceptance) {
    // Crew or Chief cross-dept: notify chiefs of target department for pending acceptance
    notifyChiefsPendingDefect(pendingForDept, newDefect?.title, newDefect?.id);
    
    // Show post-submit popover for pending acceptance
    const targetDeptName = targetDepartment;
    showToast(`Sent to ${targetDeptName} Chief for acceptance`, 'info');
  } else {
    // Command/Chief/HOD: notify chiefs of target department about new defect
    notifyChiefsNewDefect(normalizeDept(targetDepartment), newDefect?.title, newDefect?.id);
    
    // Show standard submit confirmation
    showToast('Defect submitted', 'success');
  }
  
  return newDefect;
};

/**
 * Get all defects with permission filtering
 * @param {Object} user - Current user
 * @returns {Array} Filtered defects
 */
export const getAllDefects = (user = null) => {
  const currentUser = user || getCurrentUser();
  const allDefects = loadAllDefects();
  
  if (!currentUser) return [];
  
  // Command: see all
  if (hasCommandAccess(currentUser)) {
    return allDefects;
  }
  
  const userDept = normalizeDept(currentUser?.department);
  
  // Chief/HOD: see defects where departmentOwner matches OR reportedBy matches
  if (hasChiefAccess(currentUser) || hasHODAccess(currentUser)) {
    return allDefects?.filter(defect => {
      const defectDept = normalizeDept(defect?.departmentOwner);
      return defectDept === userDept || defect?.reportedByUserId === currentUser?.id;
    });
  }
  
  // Crew: see defects they reported OR their department's defects (read-only)
  return allDefects?.filter(defect => {
    const defectDept = normalizeDept(defect?.departmentOwner);
    return defect?.reportedByUserId === currentUser?.id || defectDept === userDept;
  });
};

/**
 * Get defect by ID
 * @param {string} defectId
 * @returns {Object|null}
 */
export const getDefectById = (defectId) => {
  const defects = loadAllDefects();
  return defects?.find(d => d?.id === defectId) || null;
};

/**
 * Update defect
 * @param {string} defectId
 * @param {Object} updates
 * @returns {Object|null} Updated defect
 */
export const updateDefect = (defectId, updates) => {
  const defects = loadAllDefects();
  const index = defects?.findIndex(d => d?.id === defectId);
  
  if (index === -1) return null;
  
  const oldDefect = defects?.[index];
  const now = new Date()?.toISOString();
  
  // Rebuild location path if location changed
  let locationPathLabel = oldDefect?.locationPathLabel;
  if (updates?.locationDeckId || updates?.locationZoneId || updates?.locationSpaceId) {
    locationPathLabel = buildLocationPathLabel(
      updates?.locationDeckId || oldDefect?.locationDeckId,
      updates?.locationZoneId || oldDefect?.locationZoneId,
      updates?.locationSpaceId || oldDefect?.locationSpaceId
    );
  }
  
  const updatedDefect = {
    ...oldDefect,
    ...updates,
    locationPathLabel,
    updatedAt: now,
    closedAt: updates?.status === DefectStatus?.CLOSED ? now : oldDefect?.closedAt
  };
  
  defects[index] = updatedDefect;
  saveDefects(defects);
  
  // Log activity for status changes
  if (updates?.status && updates?.status !== oldDefect?.status) {
    logActivity({
      module: 'defects',
      action: DefectActions?.DEFECT_STATUS_CHANGED,
      entityType: 'defect',
      entityId: defectId,
      departmentScope: updatedDefect?.departmentOwner?.toUpperCase(),
      summary: `Changed defect status from ${oldDefect?.status} to ${updates?.status}`,
      meta: {
        statusFrom: oldDefect?.status,
        statusTo: updates?.status
      }
    });
    
    if (updates?.status === DefectStatus?.CLOSED) {
      logActivity({
        module: 'defects',
        action: DefectActions?.DEFECT_CLOSED,
        entityType: 'defect',
        entityId: defectId,
        departmentScope: updatedDefect?.departmentOwner?.toUpperCase(),
        summary: `Closed defect: ${updatedDefect?.title}`,
        meta: {}
      });
    }
  }
  
  // Log activity for assignment
  if (updates?.assignedToUserId && updates?.assignedToUserId !== oldDefect?.assignedToUserId) {
    logActivity({
      module: 'defects',
      action: DefectActions?.DEFECT_ASSIGNED,
      entityType: 'defect',
      entityId: defectId,
      departmentScope: updatedDefect?.departmentOwner?.toUpperCase(),
      summary: `Assigned defect: ${updatedDefect?.title}`,
      meta: {
        assignedTo: updates?.assignedToUserId
      }
    });
  }
  
  return updatedDefect;
};

/**
 * Add comment to defect
 * @param {string} defectId
 * @param {string} text
 * @returns {Object|null} Updated defect
 */
export const addDefectComment = (defectId, text) => {
  const currentUser = getCurrentUser();
  const defects = loadAllDefects();
  const index = defects?.findIndex(d => d?.id === defectId);
  
  if (index === -1) return null;
  
  const comment = {
    id: crypto.randomUUID(),
    userId: currentUser?.id,
    userName: currentUser?.fullName || currentUser?.name,
    text: text?.trim(),
    createdAt: new Date()?.toISOString()
  };
  
  defects[index].comments = [...(defects?.[index]?.comments || []), comment];
  defects[index].updatedAt = new Date()?.toISOString();
  
  saveDefects(defects);
  
  // Log activity
  logActivity({
    module: 'defects',
    action: DefectActions?.DEFECT_COMMENT_ADDED,
    entityType: 'defect',
    entityId: defectId,
    departmentScope: defects?.[index]?.departmentOwner?.toUpperCase(),
    summary: `Added comment to defect: ${defects?.[index]?.title}`,
    meta: {}
  });
  
  return defects?.[index];
};

/**
 * Add photo to defect
 * @param {string} defectId
 * @param {string} photoDataUrl
 * @returns {Object|null} Updated defect
 */
export const addDefectPhoto = (defectId, photoDataUrl) => {
  const defects = loadAllDefects();
  const index = defects?.findIndex(d => d?.id === defectId);
  
  if (index === -1) return null;
  
  const photo = {
    id: crypto.randomUUID(),
    dataUrl: photoDataUrl,
    uploadedAt: new Date()?.toISOString()
  };
  
  defects[index].photos = [...(defects?.[index]?.photos || []), photo];
  defects[index].updatedAt = new Date()?.toISOString();
  
  saveDefects(defects);
  
  // Log activity
  logActivity({
    module: 'defects',
    action: DefectActions?.DEFECT_PHOTO_ADDED,
    entityType: 'defect',
    entityId: defectId,
    departmentScope: defects?.[index]?.departmentOwner?.toUpperCase(),
    summary: `Added photo to defect: ${defects?.[index]?.title}`,
    meta: {}
  });
  
  return defects?.[index];
};

/**
 * Get open defects count (for dashboard widget)
 * @param {Object} user - Current user for scoping
 * @returns {number}
 */
export const getOpenDefectsCount = (user = null) => {
  const currentUser = user || getCurrentUser();
  const defects = getAllDefects(currentUser);
  
  // Apply department scoping
  let scopedDefects = defects;
  if (!hasCommandAccess(currentUser)) {
    const userDept = normalizeDept(currentUser?.department);
    scopedDefects = defects?.filter(d => {
      const defectDept = normalizeDept(d?.departmentOwner);
      return defectDept === userDept;
    });
  }
  
  return scopedDefects?.filter(d => 
    d?.status !== DefectStatus?.CLOSED
  )?.length || 0;
};

/**
 * Get overdue defects count (for dashboard widget)
 * @param {Object} user - Current user for scoping
 * @returns {number}
 */
export const getOverdueDefectsCount = (user = null) => {
  const currentUser = user || getCurrentUser();
  const defects = getAllDefects(currentUser);
  const today = new Date();
  today?.setHours(0, 0, 0, 0);
  
  // Apply department scoping
  let scopedDefects = defects;
  if (!hasCommandAccess(currentUser)) {
    const userDept = normalizeDept(currentUser?.department);
    scopedDefects = defects?.filter(d => {
      const defectDept = normalizeDept(d?.departmentOwner);
      return defectDept === userDept;
    });
  }
  
  return scopedDefects?.filter(d => {
    if (d?.status === DefectStatus?.CLOSED || !d?.dueDate) return false;
    const dueDate = new Date(d?.dueDate);
    return dueDate < today;
  })?.length || 0;
};

/**
 * Get critical defects count (for dashboard widget)
 * @param {Object} user - Current user for scoping
 * @returns {number}
 */
export const getCriticalDefectsCount = (user = null) => {
  const currentUser = user || getCurrentUser();
  const defects = getAllDefects(currentUser);
  
  // Apply department scoping
  let scopedDefects = defects;
  if (!hasCommandAccess(currentUser)) {
    const userDept = normalizeDept(currentUser?.department);
    scopedDefects = defects?.filter(d => {
      const defectDept = normalizeDept(d?.departmentOwner);
      return defectDept === userDept;
    });
  }
  
  return scopedDefects?.filter(d => 
    d?.priority === DefectPriority?.CRITICAL && d?.status !== DefectStatus?.CLOSED
  )?.length || 0;
};

/**
 * Check if user can edit defect
 * @param {Object} user
 * @param {Object} defect
 * @returns {boolean}
 */
export const canEditDefect = (user, defect) => {
  if (!user || !defect) return false;
  
  // Command: can edit all
  if (hasCommandAccess(user)) return true;
  
  const userDept = normalizeDept(user?.department);
  const defectDept = normalizeDept(defect?.departmentOwner);
  
  // Chief/HOD: can edit defects in their department
  if ((hasChiefAccess(user) || hasHODAccess(user)) && userDept === defectDept) {
    return true;
  }
  
  // Crew: cannot edit
  return false;
};

/**
 * Check if user can assign defect
 * @param {Object} user
 * @param {Object} defect
 * @returns {boolean}
 */
export const canAssignDefect = (user, defect) => {
  if (!user || !defect) return false;
  
  // Command: can assign all
  if (hasCommandAccess(user)) return true;
  
  const userDept = normalizeDept(user?.department);
  const defectDept = normalizeDept(defect?.departmentOwner);
  
  // Chief/HOD: can assign defects in their department
  if ((hasChiefAccess(user) || hasHODAccess(user)) && userDept === defectDept) {
    return true;
  }
  
  return false;
};

/**
 * Check if user can change defect status
 * @param {Object} user
 * @param {Object} defect
 * @returns {boolean}
 */
export const canChangeDefectStatus = (user, defect) => {
  if (!user || !defect) return false;
  
  // Command: can change all
  if (hasCommandAccess(user)) return true;
  
  const userDept = normalizeDept(user?.department);
  const defectDept = normalizeDept(defect?.departmentOwner);
  
  // Chief/HOD: can change status in their department
  if ((hasChiefAccess(user) || hasHODAccess(user)) && userDept === defectDept) {
    return true;
  }
  
  return false;
};

/**
 * Check if user can close defect
 * @param {Object} user
 * @param {Object} defect
 * @returns {boolean}
 */
export const canCloseDefect = (user, defect) => {
  return canChangeDefectStatus(user, defect);
};

/**
 * Check if user can add comments/photos
 * @param {Object} user
 * @param {Object} defect
 * @returns {boolean}
 */
export const canAddCommentOrPhoto = (user, defect) => {
  // All users can add comments/photos to defects they can see
  return true;
};
function addComment(...args) {
  return null;
}

export { addComment };
function addPhoto(...args) {
  return null;
}

export { addPhoto };

/**
 * Get pending defects for Chief acceptance
 * @param {Object} user - Current user
 * @returns {Array} Pending defects for user's department
 */
export const getPendingDefectsForChief = (user = null) => {
  const currentUser = user || getCurrentUser();
  if (!currentUser) return [];
  
  // Use effectiveTier for proper role detection
  const userTierRaw = currentUser?.effectiveTier || currentUser?.roleTier || currentUser?.permissionTier || currentUser?.tier || '';
  const userTier = userTierRaw?.trim()?.toUpperCase();
  
  // Only Chiefs and Command can see pending acceptance queue
  if (userTier !== 'CHIEF' && userTier !== 'COMMAND') {
    return [];
  }
  
  const allDefects = loadAllDefects();
  const userDept = normalizeDept(currentUser?.department);
  
  return allDefects?.filter(defect => {
    if (defect?.status !== DefectStatus?.PENDING_ACCEPTANCE) return false;
    const pendingDept = normalizeDept(defect?.pendingForDepartment);
    
    // Command can see all pending
    if (userTier === 'COMMAND') return true;
    
    // Chief can see pending for their department
    return pendingDept === userDept;
  });
};

/**
 * Accept defect (Chief only)
 * @param {string} defectId
 * @param {string} notes - Optional acceptance notes
 * @returns {Object|null} Updated defect
 */
export const acceptDefect = (defectId, notes = '') => {
  const currentUser = getCurrentUser();
  const defects = loadAllDefects();
  const defectIndex = defects?.findIndex(d => d?.id === defectId);
  
  if (defectIndex === -1) return null;
  
  const defect = defects?.[defectIndex];
  const now = new Date()?.toISOString();
  
  // Update defect status
  defects[defectIndex] = {
    ...defect,
    status: DefectStatus?.NEW,
    decidedByUserId: currentUser?.id,
    decidedAt: now,
    decisionNotes: notes || null,
    pendingForDepartment: null,
    updatedAt: now
  };
  
  saveDefects(defects);
  
  // Log activity
  logActivity({
    module: 'defects',
    action: 'DEFECT_ACCEPTED',
    entityType: 'defect',
    entityId: defectId,
    departmentScope: normalizeDept(defect?.departmentOwner),
    summary: `Accepted defect: ${defect?.title}`,
    meta: {
      acceptedBy: currentUser?.fullName || currentUser?.name,
      notes: notes
    }
  });
  
  // Notify sender
  if (defect?.createdByUserId) {
    notifySenderAccepted(
      defect?.createdByUserId,
      defect?.title,
      defect?.id,
      currentUser?.department
    );
  }
  
  return defects?.[defectIndex];
};

/**
 * Decline defect (Chief only)
 * @param {string} defectId
 * @param {string} reason - Decline reason (required)
 * @returns {Object|null} Updated defect
 */
export const declineDefect = (defectId, reason) => {
  const currentUser = getCurrentUser();
  const defects = loadAllDefects();
  const defectIndex = defects?.findIndex(d => d?.id === defectId);
  
  if (defectIndex === -1) return null;
  
  const defect = defects?.[defectIndex];
  const now = new Date()?.toISOString();
  
  // Update defect status
  defects[defectIndex] = {
    ...defect,
    status: DefectStatus?.DECLINED,
    decidedByUserId: currentUser?.id,
    decidedAt: now,
    decisionNotes: reason,
    pendingForDepartment: null,
    updatedAt: now
  };
  
  saveDefects(defects);
  
  // Log activity
  logActivity({
    module: 'defects',
    action: 'DEFECT_DECLINED',
    entityType: 'defect',
    entityId: defectId,
    departmentScope: normalizeDept(defect?.departmentOwner),
    summary: `Declined defect: ${defect?.title}`,
    meta: {
      declinedBy: currentUser?.fullName || currentUser?.name,
      reason: reason
    }
  });
  
  // Notify sender
  if (defect?.createdByUserId) {
    notifySenderDeclined(
      defect?.createdByUserId,
      defect?.title,
      defect?.id,
      currentUser?.department,
      reason
    );
  }
  
  return defects?.[defectIndex];
};

/**
 * Delete pending defect request (sender only)
 * @param {string} defectId
 * @returns {Object|null} Updated defect
 */
export const deletePendingDefect = (defectId) => {
  const currentUser = getCurrentUser();
  const defects = loadAllDefects();
  const defectIndex = defects?.findIndex(d => d?.id === defectId);
  
  if (defectIndex === -1) return null;
  
  const defect = defects?.[defectIndex];
  
  // Only allow deletion if user is creator and status is pending_acceptance
  if (defect?.createdByUserId !== currentUser?.id || defect?.status !== DefectStatus?.PENDING_ACCEPTANCE) {
    return null;
  }
  
  const now = new Date()?.toISOString();
  
  // Mark as deleted
  defects[defectIndex] = {
    ...defect,
    status: 'deleted',
    deletedAt: now,
    deletedByUserId: currentUser?.id,
    updatedAt: now
  };
  
  saveDefects(defects);
  
  // Log activity
  logActivity({
    module: 'defects',
    action: 'DEFECT_DELETED',
    entityType: 'defect',
    entityId: defectId,
    departmentScope: normalizeDept(defect?.departmentOwner),
    summary: `Deleted pending defect: ${defect?.title}`
  });
  
  return defects?.[defectIndex];
};

/**
 * Archive declined defect (sender only)
 * @param {string} defectId
 * @returns {Object|null} Updated defect
 */
export const archiveDeclinedDefect = (defectId) => {
  const currentUser = getCurrentUser();
  const defects = loadAllDefects();
  const defectIndex = defects?.findIndex(d => d?.id === defectId);
  
  if (defectIndex === -1) return null;
  
  const defect = defects?.[defectIndex];
  
  // Only allow archiving if user is creator and status is declined
  if (defect?.createdByUserId !== currentUser?.id || defect?.status !== DefectStatus?.DECLINED) {
    return null;
  }
  
  const now = new Date()?.toISOString();
  
  // Mark as archived
  defects[defectIndex] = {
    ...defect,
    isArchivedBySender: true,
    archivedAt: now,
    updatedAt: now
  };
  
  saveDefects(defects);
  
  return defects?.[defectIndex];
};

/**
 * Get "Sent by you" defects (for tracking cross-dept submissions)
 * @param {Object} user - Current user
 * @returns {Array} Filtered defects
 */
export const getSentByYouDefects = (user = null) => {
  const currentUser = user || getCurrentUser();
  const allDefects = loadAllDefects();
  
  if (!currentUser) return [];
  
  // Only visible to Command, Chief, HOD
  if (!hasCommandAccess(currentUser) && !hasChiefAccess(currentUser) && !hasHODAccess(currentUser)) {
    return [];
  }
  
  return allDefects?.filter(defect => {
    // Must be created by current user
    if (defect?.createdByUserId !== currentUser?.id) return false;
    
    // Exclude deleted defects
    if (defect?.status === 'deleted') return false;
    
    // Include defects with these statuses
    if (
      defect?.status === DefectStatus?.PENDING_ACCEPTANCE ||
      defect?.status === DefectStatus?.DECLINED
    ) {
      return true;
    }
    
    return false;
  });
};

/**
 * Append history entry to defect
 * @param {string} defectId
 * @param {Object} historyEntry - { type, message, userId, userName, at, meta }
 * @returns {Object|null} Updated defect
 */
export const appendHistoryEntry = (defectId, historyEntry) => {
  const defects = loadAllDefects();
  const index = defects?.findIndex(d => d?.id === defectId);
  
  if (index === -1) return null;
  
  const entry = {
    id: crypto.randomUUID(),
    type: historyEntry?.type,
    message: historyEntry?.message,
    userId: historyEntry?.userId,
    userName: historyEntry?.userName,
    at: historyEntry?.at || new Date()?.toISOString(),
    meta: historyEntry?.meta || {}
  };
  
  defects[index].history = [...(defects?.[index]?.history || []), entry];
  saveDefects(defects);
  
  return defects?.[index];
};

/**
 * Close defect with required notes and optional photo
 * @param {string} defectId
 * @param {string} closeNotes - Required close-out notes
 * @param {string|null} closePhoto - Optional close-out photo data URL
 * @returns {Object|null} Updated defect
 */
export const closeDefectWithNotes = (defectId, closeNotes, closePhoto = null) => {
  const currentUser = getCurrentUser();
  const defects = loadAllDefects();
  const index = defects?.findIndex(d => d?.id === defectId);
  
  if (index === -1) return null;
  
  const oldDefect = defects?.[index];
  const now = new Date()?.toISOString();
  
  const updatedDefect = {
    ...oldDefect,
    status: DefectStatus?.CLOSED,
    closedAt: now,
    closedByUserId: currentUser?.id,
    closedByName: currentUser?.fullName || currentUser?.name,
    closedNotes: closeNotes,
    closedPhoto: closePhoto,
    updatedAt: now
  };
  
  defects[index] = updatedDefect;
  saveDefects(defects);
  
  // Append history entry
  appendHistoryEntry(defectId, {
    type: 'closed',
    message: 'Closed',
    userId: currentUser?.id,
    userName: currentUser?.fullName || currentUser?.name,
    at: now,
    meta: {
      notes: closeNotes,
      hasPhoto: !!closePhoto
    }
  });
  
  // Log activity
  logActivity({
    module: 'defects',
    action: DefectActions?.DEFECT_CLOSED,
    entityType: 'defect',
    entityId: defectId,
    departmentScope: updatedDefect?.departmentOwner?.toUpperCase(),
    summary: `Closed defect: ${updatedDefect?.title}`,
    meta: {
      closedBy: currentUser?.fullName || currentUser?.name
    }
  });
  
  return updatedDefect;
};

/**
 * Re-open a closed defect with required notes
 * @param {string} defectId
 * @param {string} reopenNotes - Required re-open notes
 * @returns {Object|null} Updated defect
 */
export const reopenDefect = (defectId, reopenNotes) => {
  const currentUser = getCurrentUser();
  const defects = loadAllDefects();
  const index = defects?.findIndex(d => d?.id === defectId);
  
  if (index === -1) return null;
  
  const oldDefect = defects?.[index];
  const now = new Date()?.toISOString();
  
  const updatedDefect = {
    ...oldDefect,
    status: DefectStatus?.REOPENED,
    reopenedAt: now,
    reopenedByUserId: currentUser?.id,
    reopenedByName: currentUser?.fullName || currentUser?.name,
    reopenedNotes: reopenNotes,
    updatedAt: now
  };
  
  defects[index] = updatedDefect;
  saveDefects(defects);
  
  // Append history entry
  appendHistoryEntry(defectId, {
    type: 'reopened',
    message: 'Re-opened defect',
    userId: currentUser?.id,
    userName: currentUser?.fullName || currentUser?.name,
    at: now,
    meta: {
      notes: reopenNotes
    }
  });
  
  // Log activity
  logActivity({
    module: 'defects',
    action: 'DEFECT_REOPENED',
    entityType: 'defect',
    entityId: defectId,
    departmentScope: updatedDefect?.departmentOwner?.toUpperCase(),
    summary: `Re-opened defect: ${updatedDefect?.title}`,
    meta: {
      reopenedBy: currentUser?.fullName || currentUser?.name
    }
  });
  
  return updatedDefect;
};