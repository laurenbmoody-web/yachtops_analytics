// Defect permission utilities for role-based access control

import { hasCommandAccess, hasChiefAccess, hasHODAccess } from '../../../utils/authStorage';
import { isDevMode } from '../../../utils/devMode';

/**
 * Check if user can view defect
 * @param {Object} user - Current user object
 * @param {Object} defect - Defect object
 * @returns {boolean}
 */
export const canViewDefect = (user, defect) => {
  if (isDevMode()) return true;
  if (!user || !defect) return false;
  
  // Normalize department comparison
  const userDept = user?.department?.trim()?.toUpperCase();
  const defectDept = defect?.departmentOwner?.trim()?.toUpperCase();
  
  // COMMAND: Can view all defects
  if (hasCommandAccess(user)) return true;
  
  // CHIEF: Can view defects in their department OR reported by them
  if (hasChiefAccess(user)) {
    if (userDept === defectDept) return true;
    if (defect?.reportedByUserId === user?.id) return true;
  }
  
  // HOD: Can view defects in their department OR reported by them
  if (hasHODAccess(user)) {
    if (userDept === defectDept) return true;
    if (defect?.reportedByUserId === user?.id) return true;
  }
  
  // CREW: Can view defects they reported OR in their department
  if (defect?.reportedByUserId === user?.id) return true;
  if (userDept === defectDept) return true;
  
  return false;
};

/**
 * Check if user can edit defect (structural changes)
 * @param {Object} user - Current user object
 * @param {Object} defect - Defect object
 * @returns {boolean}
 */
export const canEditDefect = (user, defect) => {
  if (isDevMode()) return true;
  if (!user || !defect) return false;
  
  // Normalize department comparison
  const userDept = user?.department?.trim()?.toUpperCase();
  const defectDept = defect?.departmentOwner?.trim()?.toUpperCase();
  
  // COMMAND: Can edit all defects
  if (hasCommandAccess(user)) return true;
  
  // CHIEF: Can edit defects in their department
  if (hasChiefAccess(user) && userDept === defectDept) return true;
  
  // HOD: Can edit defects in their department
  if (hasHODAccess(user) && userDept === defectDept) return true;
  
  // CREW: Cannot edit defects
  return false;
};

/**
 * Check if user can assign defect
 * @param {Object} user - Current user object
 * @param {Object} defect - Defect object
 * @returns {boolean}
 */
export const canAssignDefect = (user, defect) => {
  if (isDevMode()) return true;
  if (!user || !defect) return false;
  
  // Normalize department comparison
  const userDept = user?.department?.trim()?.toUpperCase();
  const defectDept = defect?.departmentOwner?.trim()?.toUpperCase();
  
  // COMMAND: Can assign all defects
  if (hasCommandAccess(user)) return true;
  
  // CHIEF: Can assign defects in their department
  if (hasChiefAccess(user) && userDept === defectDept) return true;
  
  // HOD: Can assign defects in their department
  if (hasHODAccess(user) && userDept === defectDept) return true;
  
  // CREW: Cannot assign defects
  return false;
};

/**
 * Check if user can change defect status
 * @param {Object} user - Current user object
 * @param {Object} defect - Defect object
 * @returns {boolean}
 */
export const canChangeDefectStatus = (user, defect) => {
  if (isDevMode()) return true;
  if (!user || !defect) return false;
  
  // Normalize department comparison
  const userDept = user?.department?.trim()?.toUpperCase();
  const defectDept = defect?.departmentOwner?.trim()?.toUpperCase();
  
  // COMMAND: Can change status on all defects
  if (hasCommandAccess(user)) return true;
  
  // CHIEF: Can change status on defects in their department
  if (hasChiefAccess(user) && userDept === defectDept) return true;
  
  // HOD: Can change status on defects in their department
  if (hasHODAccess(user) && userDept === defectDept) return true;
  
  // CREW: Cannot change status
  return false;
};

/**
 * Check if user can close defect
 * @param {Object} user - Current user object
 * @param {Object} defect - Defect object
 * @returns {boolean}
 */
export const canCloseDefect = (user, defect) => {
  if (isDevMode()) return true;
  if (!user || !defect) return false;
  
  // Normalize department comparison
  const userDept = user?.department?.trim()?.toUpperCase();
  const defectDept = defect?.departmentOwner?.trim()?.toUpperCase();
  
  // COMMAND: Can close all defects
  if (hasCommandAccess(user)) return true;
  
  // CHIEF: Can close defects in their department
  if (hasChiefAccess(user) && userDept === defectDept) return true;
  
  // HOD: Can close defects in their department
  if (hasHODAccess(user) && userDept === defectDept) return true;
  
  // CREW: Cannot close defects
  return false;
};

/**
 * Check if user can add comments to defect
 * @param {Object} user - Current user object
 * @param {Object} defect - Defect object
 * @returns {boolean}
 */
export const canAddComment = (user, defect) => {
  if (isDevMode()) return true;
  if (!user || !defect) return false;
  
  // All users who can view the defect can add comments
  return canViewDefect(user, defect);
};

/**
 * Check if user can add photos to defect
 * @param {Object} user - Current user object
 * @param {Object} defect - Defect object
 * @returns {boolean}
 */
export const canAddPhoto = (user, defect) => {
  if (isDevMode()) return true;
  if (!user || !defect) return false;
  
  // All users who can view the defect can add photos
  return canViewDefect(user, defect);
};

/**
 * Check if user can create defects
 * @param {Object} user - Current user object
 * @returns {boolean}
 */
export const canCreateDefect = (user) => {
  if (isDevMode()) return true;
  if (!user) return false;
  
  // All authenticated users can report defects
  return true;
};

/**
 * Check if user can export defects
 * @param {Object} user - Current user object
 * @returns {boolean}
 */
export const canExportDefects = (user) => {
  if (isDevMode()) return true;
  if (!user) return false;
  
  // COMMAND: Can export
  if (hasCommandAccess(user)) return true;
  
  // CHIEF: Can export
  if (hasChiefAccess(user)) return true;
  
  // HOD/CREW: Cannot export
  return false;
};