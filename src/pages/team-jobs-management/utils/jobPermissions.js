// Job permission utilities for role-based access control

import { hasCommandAccess, hasChiefAccess, hasHODAccess } from '../../../utils/authStorage';
import { isDevMode } from '../../../utils/devMode';

/**
 * Permission Types:
 * - FULL_EDIT: Structural changes (title, description, department, priority, due date, assignment)
 * - JOB_INTERACTION: Non-structural actions (notes, comments, images, timings, mark complete)
 */

/**
 * Check if user can perform FULL EDIT on a job
 * @param {Object} user - Current user object
 * @param {Object} job - Job/card object
 * @returns {boolean}
 */
export const canFullEditJob = (user, job) => {
  if (isDevMode()) return true;
  if (!user || !job) return false;
  
  // Normalize department comparison
  const userDept = user?.department?.trim()?.toUpperCase();
  const jobDept = (job?.assignedDepartment || job?.department)?.trim()?.toUpperCase();
  
  // COMMAND: Can FULL EDIT any job
  if (hasCommandAccess(user)) return true;
  
  // CHIEF: Can FULL EDIT any job in their department
  if (hasChiefAccess(user) && userDept === jobDept) return true;
  
  // HOD: Can FULL EDIT only jobs THEY CREATED
  if (hasHODAccess(user) && job?.createdBy === user?.id) return true;
  
  // CREW: Cannot FULL EDIT
  return false;
};

/**
 * Check if user can perform JOB INTERACTION on a job
 * @param {Object} user - Current user object
 * @param {Object} job - Job/card object
 * @returns {boolean}
 */
export const canInteractWithJob = (user, job) => {
  if (isDevMode()) return true;
  if (!user || !job) return false;
  
  // Normalize department comparison
  const userDept = user?.department?.trim()?.toUpperCase();
  const jobDept = (job?.assignedDepartment || job?.department)?.trim()?.toUpperCase();
  
  // COMMAND: Can interact with all jobs
  if (hasCommandAccess(user)) return true;
  
  // CHIEF: Can interact with all department jobs
  if (hasChiefAccess(user) && userDept === jobDept) return true;
  
  // HOD: Can interact with jobs they created OR jobs assigned to them
  if (hasHODAccess(user)) {
    if (job?.createdBy === user?.id) return true;
    if (job?.assignees?.includes(user?.id)) return true;
  }
  
  // CREW: Can interact with jobs assigned to them
  if (job?.assignees?.includes(user?.id)) return true;
  
  // CREW: Can interact with unassigned HOD-created jobs in their department
  if (user?.tier === 'CREW' && 
      userDept === jobDept && 
      (!job?.assignees || job?.assignees?.length === 0) &&
      job?.createdByTier === 'HOD') {
    return true;
  }
  
  return false;
};

/**
 * Check if user can complete a job
 * @param {Object} user - Current user object
 * @param {Object} job - Job/card object
 * @returns {boolean}
 */
export const canCompleteJob = (user, job) => {
  if (isDevMode()) return true;
  if (!user || !job) return false;
  
  // Normalize department comparison
  const userDept = user?.department?.trim()?.toUpperCase();
  const jobDept = (job?.assignedDepartment || job?.department)?.trim()?.toUpperCase();
  
  // Use effectiveTier as authoritative role
  const tier = user?.effectiveTier?.toUpperCase();
  
  console.log('JOB COMPLETION DEBUG', {
    userId: user?.id,
    userName: user?.name,
    userRole: user?.role,
    userTier: user?.tier,
    userEffectiveTier: user?.effectiveTier,
    userDepartment: user?.department,

    jobId: job?.id,
    jobStatus: job?.status,
    jobDepartment: job?.department,
    jobAssignedDepartment: job?.assignedDepartment,
    jobCreatedBy: job?.createdBy,
    jobCreatedByDepartment: job?.createdByDepartment,
    jobCreatedByTier: job?.createdByTier,
    jobAssignees: job?.assignees
  });
  
  // Cannot complete already completed jobs
  if (job?.status === 'completed') return false;
  
  // COMMAND: Can complete any job
  if (hasCommandAccess(user)) return true;
  
  // CHIEF: Can complete any active job in their own department
  if (tier === 'CHIEF' && job?.status === 'active' && userDept === jobDept) return true;
  
  // HOD: Can complete jobs assigned to them OR unassigned jobs they created
  if (hasHODAccess(user)) {
    if (job?.assignees?.includes(user?.id)) return true;
    if (job?.createdBy === user?.id && (!job?.assignees || job?.assignees?.length === 0)) return true;
  }
  
  // CREW: Can complete jobs assigned to them
  if (job?.assignees?.includes(user?.id)) return true;
  
  // CREW: Can complete unassigned HOD-created jobs in their department
  if (user?.tier === 'CREW' && 
      job?.department === user?.department && 
      (!job?.assignees || job?.assignees?.length === 0) &&
      job?.createdByTier === 'HOD') {
    return true;
  }
  
  return false;
};

/**
 * Check if user can delete a job
 * @param {Object} user - Current user object
 * @param {Object} job - Job/card object
 * @returns {boolean}
 */
export const canDeleteJob = (user, job) => {
  if (isDevMode()) return true;
  if (!user || !job) return false;
  
  // Normalize department comparison
  const userDept = user?.department?.trim()?.toUpperCase();
  const jobDept = (job?.assignedDepartment || job?.department)?.trim()?.toUpperCase();
  
  // CRITICAL: Completed jobs can NEVER be deleted by anyone
  if (job?.status === 'completed') return false;
  
  // COMMAND: Can delete jobs (if not completed)
  if (hasCommandAccess(user)) return true;
  
  // CHIEF: Can delete jobs in their department (if not completed)
  if (hasChiefAccess(user) && userDept === jobDept) return true;
  
  // HOD and CREW: Cannot delete jobs
  return false;
};

/**
 * Check if user can create jobs
 * @param {Object} user - Current user object
 * @param {string} department - Target department
 * @returns {boolean}
 */
export const canCreateJob = (user, department) => {
  if (isDevMode()) return true;
  if (!user) return false;
  
  // COMMAND: Can create jobs in any department
  if (hasCommandAccess(user)) return true;
  
  // CHIEF: Can create jobs in their department
  if (hasChiefAccess(user) && user?.department === department) return true;
  
  // HOD: Can create jobs in their department
  if (hasHODAccess(user) && user?.department === department) return true;
  
  // CREW: Cannot create standard jobs (but can create self-reported jobs)
  return false;
};

/**
 * Check if user can assign/reassign jobs
 * @param {Object} user - Current user object
 * @param {Object} job - Job/card object
 * @returns {boolean}
 */
export const canAssignJob = (user, job) => {
  if (isDevMode()) return true;
  if (!user || !job) return false;
  
  // Normalize department comparison
  const userDept = user?.department?.trim()?.toUpperCase();
  const jobDept = (job?.assignedDepartment || job?.department)?.trim()?.toUpperCase();
  
  // COMMAND: Can assign any job
  if (hasCommandAccess(user)) return true;
  
  // CHIEF: Can assign jobs in their department
  if (hasChiefAccess(user) && userDept === jobDept) return true;
  
  // HOD: Cannot assign jobs
  // CREW: Cannot assign jobs
  return false;
};

/**
 * Check if user can review self-reported jobs
 * @param {Object} user - Current user object
 * @param {Object} job - Job/card object
 * @returns {boolean}
 */
export const canReviewSelfReportedJob = (user, job) => {
  if (isDevMode()) return true;
  if (!user || !job) return false;
  
  // Normalize department comparison
  const userDept = user?.department?.trim()?.toUpperCase();
  const jobDept = (job?.assignedDepartment || job?.department)?.trim()?.toUpperCase();
  
  // Only self-reported jobs need review
  if (job?.jobType !== 'self-reported') return false;
  
  // COMMAND does NOT review by default
  // CHIEF: Can review self-reported jobs in their department
  if (hasChiefAccess(user) && userDept === jobDept) return true;
  
  // HOD: Can review self-reported jobs in their department
  if (hasHODAccess(user) && userDept === jobDept) return true;
  
  return false;
};

/**
 * Check if user can accept/reject handoff jobs
 * @param {Object} user - Current user object
 * @param {Object} job - Job/card object
 * @returns {boolean}
 */
export const canReviewHandoffJob = (user, job) => {
  if (isDevMode()) return true;
  if (!user || !job) return false;
  
  // Normalize department comparison
  const userDept = user?.department?.trim()?.toUpperCase();
  
  // Only handoff jobs need review
  if (job?.jobType !== 'handoff') return false;
  if (job?.reviewStatus !== 'pending-acceptance') return false;
  
  // COMMAND does NOT review handoffs by default
  // CHIEF: Can review handoff jobs in their department (target department)
  if (hasChiefAccess(user)) {
    const targetDept = (job?.handoffMetadata?.targetDepartment || job?.department)?.trim()?.toUpperCase();
    return userDept === targetDept;
  }
  
  // HOD: Can review handoff jobs in their department (optional, if you want HODs to also review)
  if (hasHODAccess(user)) {
    const targetDept = (job?.handoffMetadata?.targetDepartment || job?.department)?.trim()?.toUpperCase();
    return userDept === targetDept;
  }
  
  return false;
};

/**
 * Check if user can view a job
 * @param {Object} user - Current user object
 * @param {Object} job - Job/card object
 * @returns {boolean}
 */
export const canViewJob = (user, job) => {
  if (!user || !job) return false;
  
  // Normalize department comparison
  const userDept = user?.department?.trim()?.toUpperCase();
  const jobDept = (job?.assignedDepartment || job?.department)?.trim()?.toUpperCase();
  
  // COMMAND: Can view all jobs
  if (hasCommandAccess(user)) return true;
  
  // CHIEF: Can view all jobs in their department
  if (hasChiefAccess(user) && userDept === jobDept) return true;
  
  // HOD: Can view all jobs in their department (read-only) + jobs assigned to them
  if (hasHODAccess(user) && userDept === jobDept) return true;
  
  // CREW: Can view jobs assigned to them
  if (job?.assignees?.includes(user?.id)) return true;
  
  // CREW: Can view unassigned HOD-created jobs in their department
  if (user?.tier === 'CREW' && 
      userDept === jobDept && 
      (!job?.assignees || job?.assignees?.length === 0) &&
      job?.createdByTier === 'HOD') {
    return true;
  }
  
  return false;
};

/**
 * Check if user can reopen a completed job
 * @param {Object} user - Current user object
 * @param {Object} job - Job/card object
 * @returns {boolean}
 */
export const canReopenJob = (user, job) => {
  if (!user || !job) return false;
  
  // Normalize department comparison
  const userDept = user?.department?.trim()?.toUpperCase();
  const jobDept = (job?.assignedDepartment || job?.department)?.trim()?.toUpperCase();
  
  // Can only reopen completed jobs
  if (job?.status !== 'completed') return false;
  
  // COMMAND: Can reopen any job
  if (hasCommandAccess(user)) return true;
  
  // CHIEF: Can reopen jobs in their department
  if (hasChiefAccess(user) && userDept === jobDept) return true;
  
  // HOD: Cannot reopen
  // CREW: Cannot reopen
  return false;
};

/**
 * Check if user can archive a job
 * @param {Object} user - Current user object
 * @param {Object} job - Job/card object
 * @returns {boolean}
 */
export const canArchiveJob = (user, job) => {
  if (!user || !job) return false;
  
  // Normalize department comparison
  const userDept = user?.department?.trim()?.toUpperCase();
  const jobDept = (job?.assignedDepartment || job?.department)?.trim()?.toUpperCase();
  
  // Cannot archive already archived jobs
  if (job?.isArchived) return false;
  
  // COMMAND: Can archive any job
  if (hasCommandAccess(user)) return true;
  
  // CHIEF: Can archive jobs in their department
  if (hasChiefAccess(user) && userDept === jobDept) return true;
  
  // HOD and CREW: Cannot archive
  return false;
};

/**
 * Check if user can unarchive a job
 * @param {Object} user - Current user object
 * @param {Object} job - Job/card object
 * @returns {boolean}
 */
export const canUnarchiveJob = (user, job) => {
  if (!user || !job) return false;
  
  // Normalize department comparison
  const userDept = user?.department?.trim()?.toUpperCase();
  const jobDept = (job?.assignedDepartment || job?.department)?.trim()?.toUpperCase();
  
  // Can only unarchive archived jobs
  if (!job?.isArchived) return false;
  
  // COMMAND: Can unarchive any job
  if (hasCommandAccess(user)) return true;
  
  // CHIEF: Can unarchive jobs in their department
  if (hasChiefAccess(user) && userDept === jobDept) return true;
  
  // HOD and CREW: Cannot unarchive
  return false;
};
