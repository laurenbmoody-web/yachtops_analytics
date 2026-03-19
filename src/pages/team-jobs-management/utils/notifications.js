/**
 * Notification utility for Jobs module
 * Handles notifications for job creation, acceptance, and decline
 */

import { loadUsers } from '../../../utils/authStorage';
import { startOfDay } from 'date-fns';

const NOTIFICATIONS_KEY = 'cargo.notifications.v1';

// Notification types enum
export const NOTIFICATION_TYPES = {
  JOB_PENDING_ACCEPTANCE: 'JOB_PENDING_ACCEPTANCE',
  JOB_HANDOFF_ACCEPTED: 'JOB_HANDOFF_ACCEPTED',
  JOB_HANDOFF_DECLINED: 'JOB_HANDOFF_DECLINED',
  JOB_ASSIGNED_TO_YOU: 'JOB_ASSIGNED_TO_YOU',
  JOB_DUE_TODAY: 'JOB_DUE_TODAY',
  JOB_OVERDUE: 'JOB_OVERDUE',
  INVENTORY_RESTOCK_ALERT: 'INVENTORY_RESTOCK_ALERT',
  HOR_REMINDER: 'HOR_REMINDER'
};

// Severity levels
export const SEVERITY = {
  INFO: 'info',
  WARN: 'warn',
  URGENT: 'urgent'
};

/**
 * Load notifications from localStorage
 * @returns {Array} Array of notification objects
 */
export const loadNotifications = () => {
  try {
    const stored = localStorage.getItem(NOTIFICATIONS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.error('Error loading notifications:', error);
    return [];
  }
};

/**
 * Save notifications to localStorage
 * @param {Array} notifications - Array of notification objects
 */
export const saveNotifications = (notifications) => {
  try {
    localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(notifications));
  } catch (error) {
    console.error('Error saving notifications:', error);
  }
};

/**
 * Create a notification
 * @param {Object} params - Notification parameters
 * @returns {Object} Notification object
 */
const createNotificationObject = ({ 
  userId, 
  type, 
  title, 
  message, 
  actionUrl = null, 
  actionPayload = null, 
  metadata = null,
  severity = SEVERITY?.INFO 
}) => {
  return {
    id: crypto.randomUUID(),
    userId,
    type,
    title,
    message,
    actionUrl,
    actionPayload,
    metadata,
    severity,
    isRead: false,
    createdAt: new Date()?.toISOString()
  };
};

/**
 * Create and save a notification (exported for external use)
 * @param {Object} params - Notification parameters
 */
export const createNotification = (params) => {
  const notifications = loadNotifications();
  notifications?.push(createNotificationObject(params));
  saveNotifications(notifications);
};

/**
 * Check if a similar notification already exists (to prevent duplicates)
 * @param {string} userId - User ID
 * @param {string} type - Notification type
 * @param {Object} actionPayload - Action payload to compare
 * @param {number} withinHours - Check within last N hours (default 24)
 * @returns {boolean} True if duplicate exists
 */
const isDuplicateNotification = (userId, type, actionPayload, withinHours = 24) => {
  const notifications = loadNotifications();
  const cutoffTime = new Date(Date.now() - withinHours * 60 * 60 * 1000);
  
  return notifications?.some(n => 
    n?.userId === userId &&
    n?.type === type &&
    JSON.stringify(n?.actionPayload) === JSON.stringify(actionPayload) &&
    new Date(n?.createdAt) > cutoffTime
  );
};

/**
 * Send notification to specific user(s)
 * @param {Array|string} userIds - User ID(s) to notify
 * @param {Object} params - Notification parameters
 */
export const sendNotification = (userIds, { type, title, message, actionUrl, actionPayload, severity }) => {
  const notifications = loadNotifications();
  const ids = Array.isArray(userIds) ? userIds : [userIds];
  
  ids?.forEach(userId => {
    // Check for duplicates for certain types
    if ([NOTIFICATION_TYPES?.JOB_DUE_TODAY, NOTIFICATION_TYPES?.JOB_OVERDUE, NOTIFICATION_TYPES?.INVENTORY_RESTOCK_ALERT]?.includes(type)) {
      if (isDuplicateNotification(userId, type, actionPayload)) {
        return; // Skip duplicate
      }
    }
    
    notifications?.push(createNotificationObject({ 
      userId, 
      type, 
      title, 
      message, 
      actionUrl, 
      actionPayload, 
      severity 
    }));
  });
  
  saveNotifications(notifications);
};

/**
 * Notify Chiefs about a pending acceptance job
 * @param {string} department - Target department
 * @param {string} jobTitle - Job title
 * @param {string} jobId - Job ID
 * @param {string} dueDate - Job due date
 */
export const notifyChiefsPendingAcceptance = (department, jobTitle, jobId, dueDate) => {
  const allUsers = loadUsers();
  const chiefs = allUsers?.filter(user => 
    user?.effectiveTier === 'CHIEF' && 
    user?.department?.toUpperCase() === department?.toUpperCase() &&
    user?.status === 'ACTIVE'
  );
  
  const chiefIds = chiefs?.map(c => c?.id);
  if (chiefIds?.length === 0) return;
  
  const dueDateStr = dueDate ? ` • Due ${new Date(dueDate)?.toLocaleDateString()}` : '';
  
  sendNotification(chiefIds, {
    type: NOTIFICATION_TYPES?.JOB_PENDING_ACCEPTANCE,
    title: 'Job awaiting approval',
    message: `${jobTitle}${dueDateStr}`,
    actionUrl: '/team-jobs-management',
    actionPayload: { jobId },
    severity: SEVERITY?.WARN
  });
};

/**
 * Notify sender about job acceptance
 * @param {string} senderId - User ID of job creator
 * @param {string} jobTitle - Job title
 * @param {string} jobId - Job ID
 * @param {string} acceptedByDept - Department that accepted
 */
export const notifySenderAccepted = (senderId, jobTitle, jobId, acceptedByDept) => {
  sendNotification(senderId, {
    type: NOTIFICATION_TYPES?.JOB_HANDOFF_ACCEPTED,
    title: 'Job accepted',
    message: `${jobTitle} accepted by ${acceptedByDept}`,
    actionUrl: '/team-jobs-management',
    actionPayload: { jobId },
    severity: SEVERITY?.INFO
  });
};

/**
 * Notify sender about job decline
 * @param {string} senderId - User ID of job creator
 * @param {string} jobTitle - Job title
 * @param {string} jobId - Job ID
 * @param {string} declinedByDept - Department that declined
 * @param {string} reason - Decline reason
 */
export const notifySenderDeclined = (senderId, jobTitle, jobId, declinedByDept, reason) => {
  const reasonStr = reason ? ` • Reason: ${reason}` : '';
  
  sendNotification(senderId, {
    type: NOTIFICATION_TYPES?.JOB_HANDOFF_DECLINED,
    title: 'Job declined',
    message: `${jobTitle} declined by ${declinedByDept}${reasonStr}`,
    actionUrl: '/team-jobs-management',
    actionPayload: { jobId },
    severity: SEVERITY?.WARN
  });
};

/**
 * Notify user(s) about job assignment
 * @param {Array|string} assigneeIds - User ID(s) assigned to job
 * @param {string} jobTitle - Job title
 * @param {string} jobId - Job ID
 * @param {string} dueDate - Job due date
 */
export const notifyJobAssigned = (assigneeIds, jobTitle, jobId, dueDate) => {
  const dueDateStr = dueDate ? ` • Due ${new Date(dueDate)?.toLocaleDateString()}` : '';
  
  sendNotification(assigneeIds, {
    type: NOTIFICATION_TYPES?.JOB_ASSIGNED_TO_YOU,
    title: 'New job assigned',
    message: `${jobTitle}${dueDateStr}`,
    actionUrl: '/team-jobs-management',
    actionPayload: { jobId },
    severity: SEVERITY?.INFO
  });
};

/**
 * Notify user about job due today
 * @param {string} userId - User ID
 * @param {string} jobTitle - Job title
 * @param {string} jobId - Job ID
 */
export const notifyJobDueToday = (userId, jobTitle, jobId) => {
  sendNotification(userId, {
    type: NOTIFICATION_TYPES?.JOB_DUE_TODAY,
    title: 'Job due today',
    message: jobTitle,
    actionUrl: '/team-jobs-management',
    actionPayload: { jobId },
    severity: SEVERITY?.WARN
  });
};

/**
 * Notify user about overdue job
 * @param {string} userId - User ID
 * @param {string} jobTitle - Job title
 * @param {string} jobId - Job ID
 */
export const notifyJobOverdue = (userId, jobTitle, jobId) => {
  sendNotification(userId, {
    type: NOTIFICATION_TYPES?.JOB_OVERDUE,
    title: 'Job overdue',
    message: jobTitle,
    actionUrl: '/team-jobs-management',
    actionPayload: { jobId },
    severity: SEVERITY?.URGENT
  });
};

/**
 * Notify about inventory restock alert
 * @param {string} itemName - Item name
 * @param {string} itemId - Item ID
 * @param {number} totalOnboard - Current quantity
 * @param {number} restockLevel - Restock threshold
 * @param {string} usageDepartment - Item's usage department
 */
export const notifyInventoryRestock = (itemName, itemId, totalOnboard, restockLevel, usageDepartment) => {
  const allUsers = loadUsers();
  
  // Recipients: Command always + Chief/HOD for the item's usage department
  const recipients = allUsers?.filter(user => {
    if (user?.status !== 'ACTIVE') return false;
    
    const isCommand = user?.effectiveTier === 'COMMAND';
    const isChiefOrHOD = ['CHIEF', 'HOD']?.includes(user?.effectiveTier);
    const matchesDept = user?.department?.toUpperCase() === usageDepartment?.toUpperCase();
    
    return isCommand || (isChiefOrHOD && matchesDept);
  });
  
  const recipientIds = recipients?.map(u => u?.id);
  if (recipientIds?.length === 0) return;
  
  sendNotification(recipientIds, {
    type: NOTIFICATION_TYPES?.INVENTORY_RESTOCK_ALERT,
    title: 'Restock needed',
    message: `${itemName} • On hand: ${totalOnboard} • Alert at: ${restockLevel}`,
    actionUrl: '/folder-based-inventory-dashboard',
    actionPayload: { itemId },
    severity: SEVERITY?.WARN
  });
};

/**
 * Check for due today and overdue jobs and create notifications
 * Should be called on app load or once per day
 * @param {string} currentUserId - Current user ID
 */
export const checkDueAndOverdueJobs = (currentUserId) => {
  try {
    const cardsKey = 'cargo.cards.v1';
    const stored = localStorage.getItem(cardsKey);
    if (!stored) return;
    
    const allJobs = JSON.parse(stored);
    const today = startOfDay(new Date());
    
    allJobs?.forEach(job => {
      // Only check active jobs assigned to current user
      if (job?.status !== 'active') return;
      if (!job?.assignees?.includes(currentUserId)) return;
      if (!job?.dueDate) return;
      
      const dueDate = startOfDay(new Date(job?.dueDate));
      
      // Due today
      if (dueDate?.getTime() === today?.getTime()) {
        notifyJobDueToday(currentUserId, job?.title, job?.id);
      }
      
      // Overdue
      if (dueDate < today) {
        notifyJobOverdue(currentUserId, job?.title, job?.id);
      }
    });
  } catch (error) {
    console.error('Error checking due/overdue jobs:', error);
  }
};

/**
 * Get notifications for a specific user
 * @param {string} userId - User ID
 * @param {boolean} unreadOnly - Only return unread notifications
 * @returns {Array} Array of notifications
 */
export const getUserNotifications = (userId, unreadOnly = false) => {
  const notifications = loadNotifications();
  let userNotifications = notifications?.filter(n => n?.userId === userId);
  
  if (unreadOnly) {
    userNotifications = userNotifications?.filter(n => !n?.isRead);
  }
  
  return userNotifications?.sort((a, b) => 
    new Date(b?.createdAt) - new Date(a?.createdAt)
  );
};

/**
 * Mark notification as read
 * @param {string} notificationId - Notification ID
 */
export const markNotificationRead = (notificationId) => {
  const notifications = loadNotifications();
  const updated = notifications?.map(n => 
    n?.id === notificationId ? { ...n, isRead: true } : n
  );
  saveNotifications(updated);
};

/**
 * Mark all notifications as read for a user
 * @param {string} userId - User ID
 */
export const markAllNotificationsRead = (userId) => {
  const notifications = loadNotifications();
  const updated = notifications?.map(n => 
    n?.userId === userId ? { ...n, isRead: true } : n
  );
  saveNotifications(updated);
};

/**
 * Clear all read notifications for a user
 * @param {string} userId - User ID
 */
export const clearReadNotifications = (userId) => {
  const notifications = loadNotifications();
  const filtered = notifications?.filter(n => 
    n?.userId !== userId || !n?.isRead
  );
  saveNotifications(filtered);
};

/**
 * Get unread count for a user
 * @param {string} userId - User ID
 * @returns {number} Unread count
 */
export const getUnreadCount = (userId) => {
  return getUserNotifications(userId, true)?.length || 0;
};
