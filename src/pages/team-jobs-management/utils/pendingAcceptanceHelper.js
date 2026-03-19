/**
 * Helper functions for Pending Acceptance logic
 * Single source of truth for determining if a job is pending acceptance
 * RESET: Uses normalized fields only (no legacy handoff fields)
 */

/**
 * Normalize department name for comparison
 * @param {string} dept - Department name
 * @returns {string} Normalized department name
 */
export const normalizeDept = (dept) => {
  return (dept || '')?.trim()?.toLowerCase();
};

/**
 * Check if a job is pending acceptance for the current user
 * Uses ONLY normalized fields: status and pendingForDepartment
 * @param {object} job - Job object
 * @param {object} currentUser - Current user object with department and effectiveTier
 * @returns {boolean} True if job is pending acceptance for this user
 */
export const isPendingAcceptance = (job, currentUser) => {
  // 1. Check status is exactly "pending_acceptance"
  if (job?.status !== 'pending_acceptance') {
    return false;
  }

  // 2. Check pendingForDepartment matches user's department
  if (!job?.pendingForDepartment) {
    return false;
  }

  const normalizedPending = normalizeDept(job?.pendingForDepartment);
  const normalizedUserDept = normalizeDept(currentUser?.department);

  if (normalizedPending !== normalizedUserDept) {
    return false;
  }

  // 3. Check user is Chief (only Chiefs can accept)
  // FIXED: Use effectiveTier with uppercase 'CHIEF' to match PermissionTier.CHIEF constant
  const isChief = currentUser?.effectiveTier === 'CHIEF';
  if (!isChief) {
    return false;
  }

  return true;
};

/**
 * Get diagnostic information about pending acceptance jobs
 * @param {array} allJobs - All jobs to analyze
 * @param {object} currentUser - Current user object
 * @returns {object} Diagnostic information
 */
export const getPendingAcceptanceDiagnostics = (allJobs, currentUser) => {
  const diagnostics = {
    totalJobs: allJobs?.length || 0,
    jobsWithPendingStatus: 0,
    jobsWithMatchingDept: 0,
    failureReasons: {
      missingPendingForDept: 0,
      wrongStatus: 0,
      wrongDepartment: 0,
      notChief: 0
    },
    statusVariations: {},
    excludedSamples: []
  };

  const normalizedUserDept = normalizeDept(currentUser?.department);
  const isChief = currentUser?.effectiveTier === 'CHIEF';

  allJobs?.forEach(job => {
    const normalizedPending = normalizeDept(job?.pendingForDepartment);

    // Count jobs with pending_acceptance status
    if (job?.status === 'pending_acceptance') {
      diagnostics.jobsWithPendingStatus++;
    }

    // Count jobs with matching department
    if (normalizedPending === normalizedUserDept) {
      diagnostics.jobsWithMatchingDept++;
    }

    // Track status variations
    if (job?.status) {
      diagnostics.statusVariations[job.status] = 
        (diagnostics?.statusVariations?.[job?.status] || 0) + 1;
    }

    // Identify failure reasons for jobs that should be pending but aren't
    if (job?.status === 'pending_acceptance' || job?.pendingForDepartment) {
      const isPending = isPendingAcceptance(job, currentUser);
      
      if (!isPending) {
        // Determine why it failed
        if (job?.status !== 'pending_acceptance') {
          diagnostics.failureReasons.wrongStatus++;
        }
        if (!job?.pendingForDepartment) {
          diagnostics.failureReasons.missingPendingForDept++;
        }
        if (job?.pendingForDepartment && normalizedPending !== normalizedUserDept) {
          diagnostics.failureReasons.wrongDepartment++;
        }
        if (!isChief) {
          diagnostics.failureReasons.notChief++;
        }

        // Add to sample list (max 5)
        if (diagnostics?.excludedSamples?.length < 5) {
          diagnostics?.excludedSamples?.push({
            id: job?.id,
            title: job?.title,
            status: job?.status,
            rawStatus: job?.status,
            normalizedStatus: job?.status,
            pendingForDepartment: job?.pendingForDepartment,
            targetDepartment: job?.pendingForDepartment,
            sourceDepartment: job?.createdByDepartment,
            department: job?.department,
            createdByRoleTier: job?.createdByRoleTier,
            flags: {
              isHandoff: !!job?.pendingForDepartment,
              handoffRequired: job?.status === 'pending_acceptance',
              crossDepartment: job?.createdByDepartment !== job?.department
            }
          });
        }
      }
    }
  });

  return diagnostics;
};