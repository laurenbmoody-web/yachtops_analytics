/**
 * Tier-based permission capabilities for team-jobs-management
 * Based on tenant_members.permission_tier and department_id
 * Uses permission_tier DIRECTLY — no effectiveTier dependency
 */

/**
 * Normalize permission tier to uppercase
 */
export const normalizeTier = (tier) => {
  if (!tier) return null;
  return tier?.toUpperCase()?.trim();
};

/**
 * Tier rank map — higher number = higher authority
 */
export const TIER_RANK = {
  COMMAND: 5,
  CHIEF: 4,
  HOD: 3,
  CREW: 2,
  VIEW_ONLY: 1
};

// ─── Primary tier check helpers ───────────────────────────────────────────────

export const isCommand = (tier) => normalizeTier(tier) === 'COMMAND';
export const isChief = (tier) => normalizeTier(tier) === 'CHIEF';
export const isHod = (tier) => normalizeTier(tier) === 'HOD';
export const isCrew = (tier) => normalizeTier(tier) === 'CREW';
export const isViewOnly = (tier) => normalizeTier(tier) === 'VIEW_ONLY';

/**
 * Is the user currently viewing their own department?
 * @param {string|null} selectedDepartmentId - The currently selected department UUID
 * @param {string|null} memberDepartmentId - The tenant_member.department_id UUID
 */
export const isOwnDepartmentView = (selectedDepartmentId, memberDepartmentId) => {
  if (!selectedDepartmentId || !memberDepartmentId) return false;
  if (selectedDepartmentId === 'ALL') return false;
  return selectedDepartmentId === memberDepartmentId;
};

/**
 * Can the user edit/manage department boards and jobs?
 */
export const canEditDepartment = (tier, selectedDeptId, memberDeptId) => {
  const t = normalizeTier(tier);
  if (isCommand(t)) return true;
  if (isChief(t)) return isOwnDepartmentView(selectedDeptId, memberDeptId);
  if (isHod(t)) return isOwnDepartmentView(selectedDeptId, memberDeptId);
  return false;
};

/**
 * Can the user add a job?
 * @param {boolean} creatingOnPrivateBoard - true when CREW is creating on their own private board
 */
export const canAddJob = (tier, selectedDeptId, memberDeptId, creatingOnPrivateBoard = false) => {
  const t = normalizeTier(tier);
  if (isCommand(t)) return true;
  if (isChief(t)) return isOwnDepartmentView(selectedDeptId, memberDeptId);
  if (isHod(t)) return isOwnDepartmentView(selectedDeptId, memberDeptId);
  if (isCrew(t)) return creatingOnPrivateBoard;
  return false;
};

/**
 * Can the user complete/uncomplete a job?
 * @param {boolean} isPrivateAndOwner - true when CREW owns the private job
 */
export const canCompleteJob = (tier, selectedDeptId, memberDeptId, isPrivateAndOwner = false) => {
  const t = normalizeTier(tier);
  if (isCommand(t)) return true;
  if (isChief(t)) return isOwnDepartmentView(selectedDeptId, memberDeptId);
  if (isHod(t)) return isOwnDepartmentView(selectedDeptId, memberDeptId);
  if (isCrew(t)) return isOwnDepartmentView(selectedDeptId, memberDeptId) || isPrivateAndOwner;
  return false;
};

/**
 * Can the user add comments/notes?
 */
export const canComment = (tier, selectedDeptId, memberDeptId) => {
  const t = normalizeTier(tier);
  if (isCommand(t)) return true;
  if (isChief(t)) return isOwnDepartmentView(selectedDeptId, memberDeptId);
  if (isHod(t)) return isOwnDepartmentView(selectedDeptId, memberDeptId);
  if (isCrew(t)) return isOwnDepartmentView(selectedDeptId, memberDeptId);
  return false;
};

/**
 * Determine job modal mode: 'FULL' or 'VIEW_ONLY'
 * @param {string} tier
 * @param {string|null} selectedDeptId
 * @param {string|null} memberDeptId
 * @param {object|null} job - the job being opened
 * @param {string|null} currentUserId
 */
export const jobModalMode = (tier, selectedDeptId, memberDeptId, job = null, currentUserId = null) => {
  const t = normalizeTier(tier);
  if (isCommand(t)) return 'FULL';
  if (isChief(t)) {
    return isOwnDepartmentView(selectedDeptId, memberDeptId) ? 'FULL' : 'VIEW_ONLY';
  }
  if (isHod(t)) {
    return isOwnDepartmentView(selectedDeptId, memberDeptId) ? 'FULL' : 'VIEW_ONLY';
  }
  if (isCrew(t)) {
    // CREW: FULL only on private jobs they own
    const isPrivateOwner = job?.is_private && job?.created_by === currentUserId;
    return isPrivateOwner ? 'FULL' : 'VIEW_ONLY';
  }
  return 'VIEW_ONLY';
};

/**
 * Can the user see the Pending Acceptance queue?
 */
export const canSeePendingAcceptance = (tier) => {
  const t = normalizeTier(tier);
  return isCommand(t) || isChief(t);
};

/**
 * Can the user send a job to another department chief?
 */
export const canSendToDept = (tier, selectedDeptId, memberDeptId) => {
  const t = normalizeTier(tier);
  if (isCommand(t)) return true;
  if (isChief(t)) return isOwnDepartmentView(selectedDeptId, memberDeptId);
  if (isHod(t)) return isOwnDepartmentView(selectedDeptId, memberDeptId);
  return false;
};

/**
 * Can the user create a board?
 * CREW can create boards but they will be marked private.
 */
export const canCreateBoard = (tier, selectedDeptId, memberDeptId) => {
  const t = normalizeTier(tier);
  if (isCommand(t)) return true;
  if (isChief(t)) return isOwnDepartmentView(selectedDeptId, memberDeptId);
  if (isHod(t)) return isOwnDepartmentView(selectedDeptId, memberDeptId);
  if (isCrew(t)) return isOwnDepartmentView(selectedDeptId, memberDeptId); // private board
  return false;
};

/**
 * Can the user delete a board?
 */
export const canDeleteBoard = (tier, selectedDeptId, memberDeptId) => {
  const t = normalizeTier(tier);
  if (isCommand(t)) return true;
  if (isChief(t)) return isOwnDepartmentView(selectedDeptId, memberDeptId);
  if (isHod(t)) return isOwnDepartmentView(selectedDeptId, memberDeptId);
  return false;
};

/**
 * Can the user rename a board?
 */
export const canRenameBoard = (tier, selectedDeptId, memberDeptId) => {
  const t = normalizeTier(tier);
  if (isCommand(t)) return true;
  if (isChief(t)) return isOwnDepartmentView(selectedDeptId, memberDeptId);
  if (isHod(t)) return isOwnDepartmentView(selectedDeptId, memberDeptId);
  return false;
};

/**
 * Is a job private and owned by the current user?
 */
export const isPrivateJobOwner = (job, currentUserId) => {
  if (!job || !currentUserId) return false;
  return job?.is_private === true && job?.created_by === currentUserId;
};

/**
 * Is a board private and owned by the current user?
 */
export const isPrivateBoardOwner = (board, currentUserId) => {
  if (!board || !currentUserId) return false;
  return (board?.is_private === true || board?.is_personal === true) && board?.created_by === currentUserId;
};

/**
 * Returns true if the current user's tier can assign to someone of targetTier
 */
export const canAssignTo = (targetTier, currentUserTier) => {
  const normalizedTarget = normalizeTier(targetTier);
  const normalizedCurrent = normalizeTier(currentUserTier);
  const targetRank = TIER_RANK?.[normalizedTarget] ?? 1;
  const currentRank = TIER_RANK?.[normalizedCurrent] ?? 1;
  return targetRank <= currentRank;
};

/**
 * Get capability flags for a user based on their permission tier
 * Legacy helper kept for backward compatibility
 */
export const getUserCapabilities = (user, targetDepartment = null) => {
  const tier = normalizeTier(user?.permission_tier || user?.effectiveTier);
  const userDept = user?.department_id || user?.department;
  const ownView = !targetDepartment || userDept === targetDepartment;

  const base = {
    canView: false, canCreate: false, canEdit: false, canDelete: false,
    canComplete: false, canAddNotes: false, canAssign: false,
    canSendCrossDept: false, canAcceptCrossDept: false,
    canViewAllDepartments: false, canEditCoreFields: false,
    departmentAccess: 'none', tier
  };

  switch (tier) {
    case 'COMMAND':
      return { ...base, canView: true, canCreate: true, canEdit: true, canDelete: true,
        canComplete: true, canAddNotes: true, canAssign: true, canSendCrossDept: true,
        canAcceptCrossDept: true, canViewAllDepartments: true, canEditCoreFields: true,
        departmentAccess: 'all' };
    case 'CHIEF':
      return { ...base, canView: true, canCreate: ownView, canEdit: ownView, canDelete: ownView,
        canComplete: ownView, canAddNotes: true, canAssign: ownView, canSendCrossDept: true,
        canAcceptCrossDept: ownView, canViewAllDepartments: true, canEditCoreFields: ownView,
        departmentAccess: ownView ? 'own' : 'view-only' };
    case 'HOD':
      return { ...base, canView: ownView, canCreate: ownView, canEdit: ownView, canDelete: false,
        canComplete: ownView, canAddNotes: ownView, canAssign: false, canSendCrossDept: ownView,
        canAcceptCrossDept: false, canViewAllDepartments: false, canEditCoreFields: ownView,
        departmentAccess: ownView ? 'own' : 'none' };
    case 'CREW':
      return { ...base, canView: ownView, canCreate: false, canEdit: false, canDelete: false,
        canComplete: ownView, canAddNotes: ownView, canAssign: false, canSendCrossDept: false,
        canAcceptCrossDept: false, canViewAllDepartments: false, canEditCoreFields: false,
        departmentAccess: ownView ? 'own' : 'none' };
    case 'VIEW_ONLY':
    default:
      return { ...base, canView: ownView, departmentAccess: ownView ? 'own' : 'none' };
  }
};

/**
 * Check if user can perform action on a specific job
 */
export const canPerformAction = (user, job, action) => {
  if (!user || !job) return false;
  const tier = normalizeTier(user?.permission_tier || user?.effectiveTier);
  const userDept = user?.department_id || user?.department;
  const jobDept = job?.department_id || job?.department || job?.assignedDepartment;
  const ownView = userDept === jobDept;
  const capabilities = getUserCapabilities(user, jobDept);

  // Rotation jobs assigned to the current user are always completable
  if (action === 'complete' && job?.source === 'rotation') {
    const userId = user?.id || user?.supabase_id;
    const assignedTo = job?.assigned_to || job?.assignedTo ||
      (Array.isArray(job?.assignees) ? job?.assignees?.[0] : null);
    if (userId && assignedTo && String(assignedTo) === String(userId)) return true;
  }

  switch (action) {
    case 'view': return capabilities?.canView;
    case 'create': return capabilities?.canCreate;
    case 'edit': return capabilities?.canEdit;
    case 'delete': return capabilities?.canDelete;
    case 'complete': return capabilities?.canComplete;
    case 'addNotes': return capabilities?.canAddNotes;
    case 'editCoreFields': return capabilities?.canEditCoreFields;
    default: return false;
  }
};

/**
 * Get tooltip message for disabled action
 */
export const getDisabledTooltip = (user, action) => {
  const tier = normalizeTier(user?.permission_tier || user?.effectiveTier);
  const messages = {
    COMMAND: { default: 'You have full access' },
    CHIEF: {
      create: 'You can only create jobs in your department',
      edit: 'You can only edit jobs in your department',
      delete: 'You can only delete jobs in your department',
      complete: 'You can only complete jobs in your department'
    },
    HOD: {
      create: 'You can only create jobs in your department',
      edit: 'You can only edit jobs in your department',
      delete: 'You do not have permission to delete jobs',
      assign: 'You do not have permission to assign jobs'
    },
    CREW: {
      create: 'You do not have permission to create jobs',
      edit: 'You can only add notes and complete assigned jobs',
      delete: 'You do not have permission to delete jobs',
      editCoreFields: 'You cannot edit job title, description, department, or assignees'
    },
    VIEW_ONLY: { default: 'You have view-only access. No create, edit, or complete permissions.' }
  };
  return messages?.[tier]?.[action] || messages?.[tier]?.default || 'You do not have permission for this action';
};