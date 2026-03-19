// Card/Task data model and localStorage persistence

const STORAGE_KEY = 'cargo.cards.v1';

/**
 * Card Type Definition:
 * {
 *   id: string (unique),
 *   boardId: string,
 *   type: "task" | "dutyset",
 *   title: string,
 *   description: string,
 *   department: string (Department enum value),
 *   status: "active" | "pending_acceptance" | "declined" | "completed",
 *   createdByUserId: string (user ID),
 *   createdByName: string,
 *   createdByRoleTier: string (Command/Chief/HOD/Crew),
 *   pendingForDepartment: string | null (department whose chiefs must review),
 *   pendingReasonNotes: string | null (notes from sender at submission),
 *   decisionNotes: string | null (notes from receiving chief on accept/decline),
 *   decidedByUserId: string | null,
 *   decidedAt: ISO string | null,
 *   assignees: string[] (user IDs) - can be empty for pending_acceptance jobs,
 *   dueDate: ISO string,
 *   priority: "low" | "medium" | "high" | "urgent",
 *   labels: string[],
 *   checklist: Array<{id, text, completed, checklistName}>,
 *   attachments: Array<{id, name, url, type, size}>,
 *   notes: Array<{id, text, author, authorId, timestamp}>,
 *   recurrence: "none" | "daily" | "weekly" | "monthly",
 *   recurrenceConfig: {type, weekDays, monthDay},
 *   dutySetName: string,
 *   internalNotes: string,
 *   visibility: "crew-visible" | "internal",
 *   autoCompleteOnChecklist: boolean,
 *   completedBy: string (user ID),
 *   completedAt: ISO string,
 *   createdAt: ISO string,
 *   activity: Array<{id, type, user, timestamp, details}>,
 *   auditTrail: Array<{id, eventType, entityId, actorId, actorName, timestamp, changes, prevHash, hash}>
 * }
 */

import { getCurrentUser } from '../../../utils/authStorage';


import { logActivity, JobActions } from '../../../utils/activityStorage';
import { resolveActorName } from '../../../utils/activityStorage';

/**
 * Load cards from localStorage
 * @returns {Array} Array of card objects
 */
export const loadCards = () => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    
    const parsed = JSON.parse(stored);
    const allCards = Array.isArray(parsed) ? parsed : [];
    const currentUser = getCurrentUser();
    
    // Filter private jobs: only show to creator
    return allCards?.filter(card => {
      if (card?.isPrivate && card?.private_owner_user_id !== currentUser?.id) {
        return false;
      }
      return true;
    });
  } catch (error) {
    console.error('Error loading cards:', error);
    return [];
  }
};

/**
 * Save cards to localStorage
 * @param {Array} cards - Array of card objects
 */
export const saveCards = (cards) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cards));
  } catch (error) {
    console.error('Error saving cards:', error);
  }
};

/**
 * Generate simple hash for integrity chain
 * @param {string} data - Data to hash
 * @returns {string} Hash string
 */
const simpleHash = (data) => {
  let hash = 0;
  const str = JSON.stringify(data);
  for (let i = 0; i < str?.length; i++) {
    const char = str?.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash)?.toString(36);
};

/**
 * Create audit trail entry with integrity hash
 * @param {Object} params - Audit entry parameters
 * @returns {Object} Audit trail entry
 */
const createAuditEntry = ({ eventType, entityId, actorId, actorName, changes, prevHash }) => {
  const entry = {
    id: crypto.randomUUID(),
    eventType,
    entityId,
    actorId,
    actorName,
    timestamp: new Date()?.toISOString(),
    changes,
    prevHash: prevHash || null
  };
  entry.hash = simpleHash(entry);
  return entry;
};

/**
 * Create high-level activity entry (crew-visible)
 * @param {string} type - Activity type
 * @param {string} userId - User ID
 * @param {string} userName - User name
 * @param {string} details - Activity details
 * @returns {Object} Activity entry
 */
const createActivityEntry = (type, userId, userName, details) => {
  return {
    id: crypto.randomUUID(),
    type,
    user: userId,
    userName,
    timestamp: new Date()?.toISOString(),
    details
  };
};

/**
 * Get field-level differences between old and new card data
 * @param {Object} oldCard - Original card
 * @param {Object} updates - Updated fields
 * @returns {Array} Array of change objects
 */
const getFieldDiffs = (oldCard, updates) => {
  const changes = [];
  const fieldsToTrack = ['title', 'description', 'assignees', 'dueDate', 'priority', 'status', 'labels', 'checklist', 'notes', 'attachments'];
  
  fieldsToTrack?.forEach(field => {
    if (updates?.hasOwnProperty(field)) {
      const oldValue = oldCard?.[field];
      const newValue = updates?.[field];
      
      if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
        changes?.push({
          field,
          oldValue: oldValue,
          newValue: newValue
        });
      }
    }
  });
  
  return changes;
};

/**
 * Create a new card
 * @param {Object} cardData - Card data
 * @param {string} createdByUserId - Creator user ID
 * @param {string} createdByName - Creator user name
 * @param {string} createdByTier - Creator permission tier
 * @returns {Object} New card object
 */
export const createCard = (cardData, createdByUserId, createdByName, createdByTier) => {
  const newCard = {
    id: crypto.randomUUID(),
    boardId: cardData?.boardId,
    title: cardData?.title,
    description: cardData?.description || '',
    department: cardData?.department,
    assignees: cardData?.assignees || [],
    dueDate: cardData?.dueDate,
    priority: cardData?.priority || 'medium',
    status: cardData?.status || 'active',
    isPrivate: cardData?.isPrivate || false,
    private_owner_user_id: cardData?.private_owner_user_id || null,
    createdAt: new Date()?.toISOString(),
    createdBy: createdByUserId,
    createdByUserId: createdByUserId,
    createdByName: createdByName,
    createdByTier: createdByTier,
    createdByDepartment: cardData?.department,
    activity: []
  };
  return newCard;
};

/**
 * Update a card
 * @param {Array} cards - Current cards array
 * @param {string} cardId - Card ID to update
 * @param {Object} updates - Fields to update
 * @param {string} userId - User making the update
 * @param {string} userName - User name making the update
 * @returns {Array} Updated cards array
 */
export const updateCard = (cards, cardId, updates, userId, userName = 'Unknown User') => {
  return cards?.map(card => {
    if (card?.id === cardId) {
      const updatedCard = { ...card, ...updates };
      
      // Get field-level diffs for audit trail
      const changes = getFieldDiffs(card, updates);
      
      // Determine high-level activity type
      let activityType = 'updated';
      let activityDetails = 'Card updated';
      
      if (updates?.hasOwnProperty('dueDate')) {
        activityType = 'due_date_changed';
        activityDetails = 'Due date changed';
      } else if (updates?.hasOwnProperty('assignees')) {
        activityType = 'assignment_changed';
        activityDetails = 'Assignment changed';
      } else if (updates?.hasOwnProperty('notes')) {
        activityType = 'comment_added';
        activityDetails = 'Comment added';
      } else if (updates?.hasOwnProperty('attachments')) {
        activityType = 'attachment_added';
        activityDetails = 'Attachment added';
      } else if (updates?.hasOwnProperty('checklist')) {
        activityType = 'checklist_updated';
        activityDetails = 'Checklist updated';
      }
      
      // Add activity log entry (crew-visible, high-level)
      const activityEntry = createActivityEntry(activityType, userId, userName, activityDetails);
      updatedCard.activity = [...(card?.activity || []), activityEntry];
      
      // Add audit trail entry (HOD/CHIEF_STEW only, detailed)
      const prevHash = card?.auditTrail?.length > 0 ? card?.auditTrail?.[card?.auditTrail?.length - 1]?.hash : null;
      const auditEntry = createAuditEntry({
        eventType: activityType,
        entityId: cardId,
        actorId: userId,
        actorName: userName,
        changes,
        prevHash
      });
      updatedCard.auditTrail = [...(card?.auditTrail || []), auditEntry];
      
      // Log activity events for specific actions
      try {
        const currentUser = getCurrentUser();
        const actorDisplayName = resolveActorName(currentUser);
        const departmentScope = updatedCard?.department || currentUser?.department || 'UNKNOWN';
        
        // Job acceptance (pending_acceptance -> active)
        if (card?.status === 'pending_acceptance' && updates?.status === 'active') {
          logActivity({
            actorUserId: userId,
            actorName: actorDisplayName,
            actorDepartment: currentUser?.department || 'UNKNOWN',
            actorRoleTier: currentUser?.tier || 'CREW',
            departmentScope: departmentScope,
            module: 'jobs',
            action: JobActions?.JOB_ACCEPTED,
            entityType: 'job',
            entityId: cardId,
            summary: `${actorDisplayName} accepted job: ${card?.title}`,
            meta: {
              jobTitle: card?.title,
              department: card?.department,
              decisionNotes: updates?.decisionNotes || null
            }
          });
          
          // Trigger dashboard activity refresh
          window.dispatchEvent(new CustomEvent('activityUpdated'));
        }
        
        // Job decline (pending_acceptance -> declined)
        if (card?.status === 'pending_acceptance' && updates?.status === 'declined') {
          logActivity({
            actorUserId: userId,
            actorName: actorDisplayName,
            actorDepartment: currentUser?.department || 'UNKNOWN',
            actorRoleTier: currentUser?.tier || 'CREW',
            departmentScope: card?.sourceDepartment || card?.createdByDepartment || 'UNKNOWN',
            module: 'jobs',
            action: JobActions?.JOB_DECLINED,
            entityType: 'job',
            entityId: cardId,
            summary: `${actorDisplayName} declined job: ${card?.title}`,
            meta: {
              jobTitle: card?.title,
              decisionNotes: updates?.decisionNotes || null
            }
          });
          
          // Trigger dashboard activity refresh
          window.dispatchEvent(new CustomEvent('activityUpdated'));
        }
        
        // Job assignment changes
        if (updates?.hasOwnProperty('assignees')) {
          const wasUnassigned = !card?.assignees || card?.assignees?.length === 0;
          const isNowUnassigned = !updates?.assignees || updates?.assignees?.length === 0;
          
          if (wasUnassigned && !isNowUnassigned) {
            // Job was assigned
            logActivity({
              actorUserId: userId,
              actorName: actorDisplayName,
              actorDepartment: currentUser?.department || 'UNKNOWN',
              actorRoleTier: currentUser?.tier || 'CREW',
              departmentScope: departmentScope,
              module: 'jobs',
              action: JobActions?.JOB_ASSIGNED,
              entityType: 'job',
              entityId: cardId,
              summary: `${actorDisplayName} assigned job: ${card?.title}`,
              meta: {
                jobTitle: card?.title,
                department: card?.department,
                assignees: updates?.assignees
              }
            });
          } else if (!wasUnassigned && isNowUnassigned) {
            // Job was unassigned
            logActivity({
              actorUserId: userId,
              actorName: actorDisplayName,
              actorDepartment: currentUser?.department || 'UNKNOWN',
              actorRoleTier: currentUser?.tier || 'CREW',
              departmentScope: departmentScope,
              module: 'jobs',
              action: JobActions?.JOB_UNASSIGNED,
              entityType: 'job',
              entityId: cardId,
              summary: `${actorDisplayName} unassigned job: ${card?.title}`,
              meta: {
                jobTitle: card?.title,
                department: card?.department
              }
            });
          } else {
            // Assignment changed (reassigned)
            logActivity({
              actorUserId: userId,
              actorName: actorDisplayName,
              actorDepartment: currentUser?.department || 'UNKNOWN',
              actorRoleTier: currentUser?.tier || 'CREW',
              departmentScope: departmentScope,
              module: 'jobs',
              action: JobActions?.JOB_ASSIGNED,
              entityType: 'job',
              entityId: cardId,
              summary: `${actorDisplayName} reassigned job: ${card?.title}`,
              meta: {
                jobTitle: card?.title,
                department: card?.department,
                assignees: updates?.assignees
              }
            });
          }
          
          // Trigger dashboard activity refresh
          window.dispatchEvent(new CustomEvent('activityUpdated'));
        }
        
        // Detect edit actions (title, description, dueDate, priority changes)
        const isEditAction = updates?.hasOwnProperty('title') ||
                            updates?.hasOwnProperty('description') ||
                            updates?.hasOwnProperty('dueDate') ||
                            updates?.hasOwnProperty('priority');
        
        if (isEditAction && card?.status !== 'pending_acceptance') {
          // Log specific action types
          if (updates?.hasOwnProperty('dueDate') && card?.dueDate !== updates?.dueDate) {
            logActivity({
              actorUserId: userId,
              actorName: actorDisplayName,
              actorDepartment: currentUser?.department || 'UNKNOWN',
              actorRoleTier: currentUser?.tier || 'CREW',
              departmentScope: departmentScope,
              module: 'jobs',
              action: JobActions?.JOB_DUE_DATE_CHANGED,
              entityType: 'job',
              entityId: cardId,
              summary: `${actorDisplayName} changed due date for job: ${card?.title}`,
              meta: {
                jobTitle: card?.title,
                department: card?.department,
                oldDueDate: card?.dueDate,
                newDueDate: updates?.dueDate
              }
            });
          }
          
          if (updates?.hasOwnProperty('priority') && card?.priority !== updates?.priority) {
            logActivity({
              actorUserId: userId,
              actorName: actorDisplayName,
              actorDepartment: currentUser?.department || 'UNKNOWN',
              actorRoleTier: currentUser?.tier || 'CREW',
              departmentScope: departmentScope,
              module: 'jobs',
              action: JobActions?.JOB_PRIORITY_CHANGED,
              entityType: 'job',
              entityId: cardId,
              summary: `${actorDisplayName} changed priority for job: ${card?.title}`,
              meta: {
                jobTitle: card?.title,
                department: card?.department,
                oldPriority: card?.priority,
                newPriority: updates?.priority
              }
            });
          }
          
          // General edit action (title or description changed)
          if ((updates?.hasOwnProperty('title') && card?.title !== updates?.title) ||
              (updates?.hasOwnProperty('description') && card?.description !== updates?.description)) {
            logActivity({
              actorUserId: userId,
              actorName: actorDisplayName,
              actorDepartment: currentUser?.department || 'UNKNOWN',
              actorRoleTier: currentUser?.tier || 'CREW',
              departmentScope: departmentScope,
              module: 'jobs',
              action: JobActions?.JOB_EDITED,
              entityType: 'job',
              entityId: cardId,
              summary: `${actorDisplayName} edited job: ${card?.title}`,
              meta: {
                jobTitle: card?.title,
                department: card?.department,
                fieldsChanged: [
                  updates?.hasOwnProperty('title') ? 'title' : null,
                  updates?.hasOwnProperty('description') ? 'description' : null
                ]?.filter(Boolean)
              }
            });
          }
          
          // Trigger dashboard activity refresh
          window.dispatchEvent(new CustomEvent('activityUpdated'));
        }
        
        // Job sent for acceptance (active/pending -> pending_acceptance)
        if (card?.status !== 'pending_acceptance' && updates?.status === 'pending_acceptance') {
          logActivity({
            actorUserId: userId,
            actorName: actorDisplayName,
            actorDepartment: currentUser?.department || 'UNKNOWN',
            actorRoleTier: currentUser?.tier || 'CREW',
            departmentScope: updates?.pendingForDepartment || departmentScope,
            module: 'jobs',
            action: JobActions?.JOB_SENT_FOR_ACCEPTANCE,
            entityType: 'job',
            entityId: cardId,
            summary: `${actorDisplayName} sent job for acceptance: ${card?.title}`,
            meta: {
              jobTitle: card?.title,
              department: card?.department,
              pendingForDepartment: updates?.pendingForDepartment
            }
          });
          
          // Trigger dashboard activity refresh
          window.dispatchEvent(new CustomEvent('activityUpdated'));
        }
      } catch (error) {
        console.error('Error logging activity event:', error);
      }
      
      return updatedCard;
    }
    return card;
  });
};

/**
 * Delete a card
 * @param {Array} cards - Current cards array
 * @param {string} cardId - Card ID to delete
 * @returns {Array} Updated cards array
 */
export const deleteCard = (cards, cardId) => {
  return cards?.filter(card => card?.id !== cardId);
};

/**
 * Delete a pending job (soft delete)
 * @param {Array} cards - Current cards array
 * @param {string} cardId - Card ID to delete
 * @param {string} userId - User ID deleting
 * @param {string} userName - User name deleting
 * @returns {Array} Updated cards array
 */
export const deletePendingJob = (cards, cardId, userId, userName = 'Unknown User') => {
  return cards?.map(card => {
    if (card?.id === cardId) {
      const timestamp = new Date()?.toISOString();
      const updatedCard = {
        ...card,
        status: 'deleted',
        deletedAt: timestamp,
        deletedByUserId: userId,
        pendingForDepartment: null
      };
      
      // Add activity entry
      updatedCard.activity = [
        ...(card?.activity || []),
        createActivityEntry('deleted', userId, userName, 'Job deleted by sender')
      ];
      
      // Add audit trail entry
      const prevHash = card?.auditTrail?.length > 0 ? card?.auditTrail?.[card?.auditTrail?.length - 1]?.hash : null;
      const auditEntry = createAuditEntry({
        eventType: 'deleted',
        entityId: cardId,
        actorId: userId,
        actorName: userName,
        changes: [
          { field: 'status', oldValue: card?.status, newValue: 'deleted' },
          { field: 'deletedAt', oldValue: null, newValue: timestamp },
          { field: 'deletedByUserId', oldValue: null, newValue: userId },
          { field: 'pendingForDepartment', oldValue: card?.pendingForDepartment, newValue: null }
        ],
        prevHash
      });
      updatedCard.auditTrail = [...(card?.auditTrail || []), auditEntry];
      
      // Log JOB_DELETED activity event
      try {
        const currentUser = getCurrentUser();
        const actorDisplayName = resolveActorName(currentUser);
        logActivity({
          actorUserId: userId,
          actorName: actorDisplayName,
          actorDepartment: currentUser?.department || 'UNKNOWN',
          actorRoleTier: currentUser?.tier || 'CREW',
          departmentScope: updatedCard?.department || updatedCard?.sourceDepartment || currentUser?.department || 'UNKNOWN',
          module: 'jobs',
          action: JobActions?.JOB_DELETED,
          entityType: 'job',
          entityId: cardId,
          summary: `${actorDisplayName} deleted pending job: ${card?.title}`,
          meta: {
            jobTitle: card?.title,
            department: updatedCard?.department
          }
        });
        
        // Trigger dashboard activity refresh
        window.dispatchEvent(new CustomEvent('activityUpdated'));
      } catch (error) {
        console.error('Error logging JOB_DELETED activity:', error);
      }
      
      return updatedCard;
    }
    return card;
  });
};

/**
 * Archive a declined job (by sender)
 * @param {Array} cards - Current cards array
 * @param {string} cardId - Card ID to archive
 * @param {string} userId - User ID archiving
 * @returns {Array} Updated cards array
 */
export const archiveDeclinedJob = (cards, cardId, userId) => {
  return cards?.map(card => {
    if (card?.id === cardId) {
      const timestamp = new Date()?.toISOString();
      const updatedCard = {
        ...card,
        isArchivedBySender: true,
        archivedBySenderAt: timestamp
      };
      
      // Log JOB_ARCHIVED_BY_SENDER activity event
      try {
        const currentUser = getCurrentUser();
        const actorDisplayName = resolveActorName(currentUser);
        logActivity({
          actorUserId: userId,
          actorName: actorDisplayName,
          actorDepartment: currentUser?.department || 'UNKNOWN',
          actorRoleTier: currentUser?.tier || 'CREW',
          departmentScope: updatedCard?.department || updatedCard?.sourceDepartment || currentUser?.department || 'UNKNOWN',
          module: 'jobs',
          action: JobActions?.JOB_ARCHIVED_BY_SENDER,
          entityType: 'job',
          entityId: cardId,
          summary: `${actorDisplayName} archived declined job: ${updatedCard?.title}`,
          meta: {
            jobTitle: updatedCard?.title,
            department: updatedCard?.department
          }
        });
        
        // Trigger dashboard activity refresh
        window.dispatchEvent(new CustomEvent('activityUpdated'));
      } catch (error) {
        console.error('Error logging JOB_ARCHIVED_BY_SENDER activity:', error);
      }
      
      return updatedCard;
    }
    return card;
  });
};

/**
 * Archive a job (Chief/Command only)
 * @param {Array} cards - Current cards array
 * @param {string} cardId - Card ID to archive
 * @param {string} userId - User ID archiving
 * @param {string} userName - User name archiving
 * @returns {Array} Updated cards array
 */
export const archiveJob = (cards, cardId, userId, userName) => {
  return cards?.map(card => {
    if (card?.id === cardId) {
      const timestamp = new Date()?.toISOString();
      const prevHash = card?.auditTrail?.[card?.auditTrail?.length - 1]?.hash || null;
      
      const auditEntry = createAuditEntry({
        eventType: 'job_archived',
        entityId: cardId,
        actorId: userId,
        actorName: userName,
        changes: [{
          field: 'isArchived',
          oldValue: false,
          newValue: true
        }],
        prevHash
      });
      
      const activityEntry = createActivityEntry(
        'archived',
        userId,
        userName,
        'Job archived'
      );
      
      return {
        ...card,
        isArchived: true,
        archivedAt: timestamp,
        archivedBy: userId,
        auditTrail: [...(card?.auditTrail || []), auditEntry],
        activity: [...(card?.activity || []), activityEntry]
      };
    }
    return card;
  });
};

/**
 * Unarchive a job (Chief/Command only)
 * @param {Array} cards - Current cards array
 * @param {string} cardId - Card ID to unarchive
 * @param {string} userId - User ID unarchiving
 * @param {string} userName - User name unarchiving
 * @returns {Array} Updated cards array
 */
export const unarchiveJob = (cards, cardId, userId, userName) => {
  return cards?.map(card => {
    if (card?.id === cardId) {
      const timestamp = new Date()?.toISOString();
      const prevHash = card?.auditTrail?.[card?.auditTrail?.length - 1]?.hash || null;
      
      const auditEntry = createAuditEntry({
        eventType: 'job_unarchived',
        entityId: cardId,
        actorId: userId,
        actorName: userName,
        changes: [{
          field: 'isArchived',
          oldValue: true,
          newValue: false
        }],
        prevHash
      });
      
      const activityEntry = createActivityEntry(
        'unarchived',
        userId,
        userName,
        'Job unarchived'
      );
      
      return {
        ...card,
        isArchived: false,
        archivedAt: null,
        archivedBy: null,
        auditTrail: [...(card?.auditTrail || []), auditEntry],
        activity: [...(card?.activity || []), activityEntry]
      };
    }
    return card;
  });
};

/**
 * Complete a card
 * @param {Array} cards - Current cards array
 * @param {string} cardId - Card ID to complete
 * @param {string} completedBy - User ID who completed it
 * @param {string} completedByName - User name who completed it
 * @returns {Array} Updated cards array
 */
export const completeCard = (cards, cardId, completedBy, completedByName = 'Unknown User') => {
  return cards?.map(card => {
    if (card?.id === cardId) {
      const timestamp = new Date()?.toISOString();
      const updatedCard = {
        ...card,
        status: 'completed',
        completedBy,
        completedAt: timestamp
      };
      
      // Add activity entry (crew-visible)
      updatedCard.activity = [
        ...(card?.activity || []),
        createActivityEntry('completed', completedBy, completedByName, 'Card completed')
      ];
      
      // Add audit trail entry (detailed)
      const prevHash = card?.auditTrail?.length > 0 ? card?.auditTrail?.[card?.auditTrail?.length - 1]?.hash : null;
      const auditEntry = createAuditEntry({
        eventType: 'completed',
        entityId: cardId,
        actorId: completedBy,
        actorName: completedByName,
        changes: [
          { field: 'status', oldValue: card?.status, newValue: 'completed' },
          { field: 'completedBy', oldValue: null, newValue: completedBy },
          { field: 'completedAt', oldValue: null, newValue: timestamp }
        ],
        prevHash
      });
      updatedCard.auditTrail = [...(card?.auditTrail || []), auditEntry];
      
      // Log JOB_COMPLETED activity event
      try {
        const currentUser = getCurrentUser();
        const actorDisplayName = resolveActorName(currentUser);
        logActivity({
          actorUserId: completedBy,
          actorName: actorDisplayName,
          actorDepartment: currentUser?.department || 'UNKNOWN',
          actorRoleTier: currentUser?.tier || 'CREW',
          departmentScope: updatedCard?.department || currentUser?.department || 'UNKNOWN',
          module: 'jobs',
          action: JobActions?.JOB_COMPLETED,
          entityType: 'job',
          entityId: cardId,
          summary: `${actorDisplayName} completed job: ${updatedCard?.title}`,
          meta: {
            jobTitle: updatedCard?.title,
            department: updatedCard?.department,
            completedAt: timestamp
          }
        });
        
        // Trigger dashboard activity refresh
        window.dispatchEvent(new CustomEvent('activityUpdated'));
      } catch (error) {
        console.error('Error logging JOB_COMPLETED activity:', error);
      }
      
      return updatedCard;
    }
    return card;
  });
};

/**
 * Reopen a completed card
 * @param {Array} cards - Current cards array
 * @param {string} cardId - Card ID to reopen
 * @param {string} userId - User ID who reopened it
 * @param {string} userName - User name who reopened it
 * @returns {Array} Updated cards array
 */
export const reopenCard = (cards, cardId, userId, userName = 'Unknown User') => {
  return cards?.map(card => {
    if (card?.id === cardId && card?.status === 'completed') {
      const updatedCard = {
        ...card,
        status: 'today',
        completedBy: null,
        completedAt: null
      };
      
      // Add activity entry (crew-visible)
      updatedCard.activity = [
        ...(card?.activity || []),
        createActivityEntry('reopened', userId, userName, 'Card reopened')
      ];
      
      // Add audit trail entry (detailed)
      const prevHash = card?.auditTrail?.length > 0 ? card?.auditTrail?.[card?.auditTrail?.length - 1]?.hash : null;
      const auditEntry = createAuditEntry({
        eventType: 'reopened',
        entityId: cardId,
        actorId: userId,
        actorName: userName,
        changes: [
          { field: 'status', oldValue: 'completed', newValue: 'today' },
          { field: 'completedBy', oldValue: card?.completedBy, newValue: null },
          { field: 'completedAt', oldValue: card?.completedAt, newValue: null }
        ],
        prevHash
      });
      updatedCard.auditTrail = [...(card?.auditTrail || []), auditEntry];
      
      return updatedCard;
    }
    return card;
  });
};

/**
 * Accept a handoff job (Chief action)
 * @param {Array} cards - Current cards array
 * @param {string} cardId - Card ID to accept
 * @param {string} userId - User accepting
 * @param {string} userName - User name accepting
 * @returns {Array} Updated cards array
 */
export const acceptHandoffJob = (cards, cardId, userId, userName = 'Unknown User') => {
  return cards?.map(card => {
    if (card?.id === cardId && card?.jobType === 'handoff' && card?.reviewStatus === 'pending-acceptance') {
      const updatedCard = {
        ...card,
        reviewStatus: 'accepted',
        reviewedBy: userId,
        reviewedAt: new Date()?.toISOString(),
        status: 'upcoming',
        department: card?.handoffMetadata?.targetDepartment || card?.department,
        assignees: card?.handoffMetadata?.targetPerson ? [card?.handoffMetadata?.targetPerson] : card?.assignees
      };
      
      // Add activity entry
      updatedCard.activity = [
        ...updatedCard?.activity,
        createActivityEntry('handoff_accepted', userId, userName, `Handoff accepted from ${card?.handoffMetadata?.sourceDepartment}`)
      ];
      
      // Add audit entry
      const prevHash = updatedCard?.auditTrail?.[updatedCard?.auditTrail?.length - 1]?.hash || null;
      updatedCard.auditTrail = [
        ...updatedCard?.auditTrail,
        createAuditEntry({
          eventType: 'handoff_accepted',
          entityId: cardId,
          actorId: userId,
          actorName: userName,
          changes: [{ field: 'reviewStatus', oldValue: 'pending-acceptance', newValue: 'accepted' }],
          prevHash
        })
      ];
      
      return updatedCard;
    }
    return card;
  });
};

/**
 * Reject a handoff job (Chief action)
 * @param {Array} cards - Current cards array
 * @param {string} cardId - Card ID to reject
 * @param {string} userId - User rejecting
 * @param {string} userName - User name rejecting
 * @param {string} reason - Rejection reason
 * @returns {Array} Updated cards array
 */
export const rejectHandoffJob = (cards, cardId, userId, userName = 'Unknown User', reason = '') => {
  return cards?.map(card => {
    if (card?.id === cardId && card?.jobType === 'handoff' && card?.reviewStatus === 'pending-acceptance') {
      const updatedCard = {
        ...card,
        reviewStatus: 'rejected',
        reviewedBy: userId,
        reviewedAt: new Date()?.toISOString(),
        status: 'completed',
        handoffMetadata: {
          ...card?.handoffMetadata,
          rejectionReason: reason,
          rejectedBy: userId,
          rejectedByName: userName,
          rejectedAt: new Date()?.toISOString()
        }
      };
      
      // Add activity entry
      updatedCard.activity = [
        ...updatedCard?.activity,
        createActivityEntry('handoff_rejected', userId, userName, `Handoff rejected: ${reason || 'No reason provided'}`)
      ];
      
      // Add audit entry
      const prevHash = updatedCard?.auditTrail?.[updatedCard?.auditTrail?.length - 1]?.hash || null;
      updatedCard.auditTrail = [
        ...updatedCard?.auditTrail,
        createAuditEntry({
          eventType: 'handoff_rejected',
          entityId: cardId,
          actorId: userId,
          actorName: userName,
          changes: [{ field: 'reviewStatus', oldValue: 'pending-acceptance', newValue: 'rejected' }],
          prevHash
        })
      ];
      
      return updatedCard;
    }
    return card;
  });
};

/**
 * Return a handoff job for more info (Chief action)
 * @param {Array} cards - Current cards array
 * @param {string} cardId - Card ID to return
 * @param {string} userId - User returning
 * @param {string} userName - User name returning
 * @param {string} comment - Return comment
 * @returns {Array} Updated cards array
 */
export const returnHandoffJob = (cards, cardId, userId, userName = 'Unknown User', comment = '') => {
  return cards?.map(card => {
    if (card?.id === cardId && card?.jobType === 'handoff' && card?.reviewStatus === 'pending-acceptance') {
      const updatedCard = {
        ...card,
        reviewStatus: 'returned',
        reviewedBy: userId,
        reviewedAt: new Date()?.toISOString(),
        handoffMetadata: {
          ...card?.handoffMetadata,
          returnComment: comment,
          returnedBy: userId,
          returnedByName: userName,
          returnedAt: new Date()?.toISOString()
        }
      };
      
      // Add note with return comment
      if (comment?.trim()) {
        updatedCard.notes = [
          ...updatedCard?.notes,
          {
            id: crypto.randomUUID(),
            text: `[RETURNED] ${comment}`,
            author: userName,
            authorId: userId,
            timestamp: new Date()?.toISOString()
          }
        ];
      }
      
      // Add activity entry
      updatedCard.activity = [
        ...updatedCard?.activity,
        createActivityEntry('handoff_returned', userId, userName, `Handoff returned: ${comment || 'Needs more info'}`)
      ];
      
      // Add audit entry
      const prevHash = updatedCard?.auditTrail?.[updatedCard?.auditTrail?.length - 1]?.hash || null;
      updatedCard.auditTrail = [
        ...updatedCard?.auditTrail,
        createAuditEntry({
          eventType: 'handoff_returned',
          entityId: cardId,
          actorId: userId,
          actorName: userName,
          changes: [{ field: 'reviewStatus', oldValue: 'pending-acceptance', newValue: 'returned' }],
          prevHash
        })
      ];
      
      return updatedCard;
    }
    return card;
  });
};

/**
 * Export audit trail to CSV format
 * @param {Object} card - Card object
 * @returns {string} CSV formatted audit trail
 */
export const exportAuditTrailCSV = (card) => {
  if (!card?.auditTrail || card?.auditTrail?.length === 0) {
    return 'No audit trail data available';
  }
  
  const headers = ['Timestamp', 'Event Type', 'Actor', 'Field', 'Old Value', 'New Value', 'Hash', 'Prev Hash'];
  const rows = [headers?.join(',')];
  
  card?.auditTrail?.forEach(entry => {
    if (entry?.changes && entry?.changes?.length > 0) {
      entry?.changes?.forEach(change => {
        const row = [
          new Date(entry.timestamp)?.toLocaleString(),
          entry?.eventType,
          entry?.actorName,
          change?.field,
          JSON.stringify(change?.oldValue)?.replace(/"/g, '""'),
          JSON.stringify(change?.newValue)?.replace(/"/g, '""'),
          entry?.hash,
          entry?.prevHash || 'N/A'
        ];
        rows?.push(row?.map(cell => `"${cell}"`)?.join(','));
      });
    } else {
      const row = [
        new Date(entry.timestamp)?.toLocaleString(),
        entry?.eventType,
        entry?.actorName,
        'N/A',
        'N/A',
        'N/A',
        entry?.hash,
        entry?.prevHash || 'N/A'
      ];
      rows?.push(row?.map(cell => `"${cell}"`)?.join(','));
    }
  });
  
  return rows?.join('\n');
};

/**
 * Get cards for a specific board
 * @param {string} boardId - Board ID
 * @returns {Array} Array of cards for the board
 */
export const getCardsForBoard = (boardId) => {
  const cards = loadCards();
  return cards?.filter(card => card?.boardId === boardId) || [];
};