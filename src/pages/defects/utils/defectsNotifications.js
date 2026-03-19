/**
 * Notification utility for Defects module
 * Handles notifications for defect creation, acceptance, and decline
 */

import { loadUsers } from '../../../utils/authStorage';

const NOTIFICATIONS_KEY = 'cargo.notifications.v1';

// Notification types enum for defects
export const DEFECT_NOTIFICATION_TYPES = {
  DEFECT_PENDING_ACCEPTANCE: 'DEFECT_PENDING_ACCEPTANCE',
  DEFECT_NEW_LOGGED: 'DEFECT_NEW_LOGGED',
  DEFECT_ACCEPTED: 'DEFECT_ACCEPTED',
  DEFECT_DECLINED: 'DEFECT_DECLINED'
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
const createNotification = ({ 
  userId, 
  type, 
  title, 
  message, 
  actionUrl = null, 
  actionPayload = null, 
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
    severity,
    isRead: false,
    createdAt: new Date()?.toISOString()
  };
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
    // Check for duplicates
    if (isDuplicateNotification(userId, type, actionPayload)) {
      return; // Skip duplicate
    }
    
    notifications?.push(createNotification({ 
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
 * Normalize department name for consistent comparison
 * @param {string} dept - Department name
 * @returns {string} Normalized uppercase trimmed department name
 */
const normalizeDept = (dept) => {
  return (dept || '')?.trim()?.toUpperCase();
};

/**
 * Notify Chiefs about a pending acceptance defect (Crew submission)
 * @param {string} department - Target department
 * @param {string} defectTitle - Defect title
 * @param {string} defectId - Defect ID
 */
export const notifyChiefsPendingDefect = (department, defectTitle, defectId) => {
  const allUsers = loadUsers();
  const chiefs = allUsers?.filter(user => {
    const userTierRaw = user?.effectiveTier || user?.roleTier || user?.permissionTier || user?.tier || '';
    const userTier = userTierRaw?.trim()?.toUpperCase();
    return (
      (userTier === 'CHIEF' || userTier === 'COMMAND') &&
      normalizeDept(user?.department) === normalizeDept(department) &&
      user?.status === 'ACTIVE'
    );
  });
  
  const chiefIds = chiefs?.map(c => c?.id);
  if (chiefIds?.length === 0) return;
  
  sendNotification(chiefIds, {
    type: DEFECT_NOTIFICATION_TYPES?.DEFECT_PENDING_ACCEPTANCE,
    title: 'Defect pending acceptance',
    message: defectTitle,
    actionUrl: '/defects',
    actionPayload: { defectId },
    severity: SEVERITY?.WARN
  });
};

/**
 * Notify Chiefs about a new defect logged (Command/Chief/HOD submission)
 * @param {string} department - Target department
 * @param {string} defectTitle - Defect title
 * @param {string} defectId - Defect ID
 */
export const notifyChiefsNewDefect = (department, defectTitle, defectId) => {
  const allUsers = loadUsers();
  const chiefs = allUsers?.filter(user => {
    const userTierRaw = user?.effectiveTier || user?.roleTier || user?.permissionTier || user?.tier || '';
    const userTier = userTierRaw?.trim()?.toUpperCase();
    return (
      (userTier === 'CHIEF' || userTier === 'COMMAND') &&
      normalizeDept(user?.department) === normalizeDept(department) &&
      user?.status === 'ACTIVE'
    );
  });
  
  const chiefIds = chiefs?.map(c => c?.id);
  if (chiefIds?.length === 0) return;
  
  sendNotification(chiefIds, {
    type: DEFECT_NOTIFICATION_TYPES?.DEFECT_NEW_LOGGED,
    title: 'New defect logged',
    message: defectTitle,
    actionUrl: '/defects',
    actionPayload: { defectId },
    severity: SEVERITY?.INFO
  });
};

/**
 * Notify sender about defect acceptance
 * @param {string} senderId - User ID of defect creator
 * @param {string} defectTitle - Defect title
 * @param {string} defectId - Defect ID
 * @param {string} acceptedByDept - Department that accepted
 */
export const notifySenderAccepted = (senderId, defectTitle, defectId, acceptedByDept) => {
  sendNotification(senderId, {
    type: DEFECT_NOTIFICATION_TYPES?.DEFECT_ACCEPTED,
    title: 'Defect accepted',
    message: `${defectTitle} accepted by ${acceptedByDept}`,
    actionUrl: '/defects',
    actionPayload: { defectId },
    severity: SEVERITY?.INFO
  });
};

/**
 * Notify sender about defect decline
 * @param {string} senderId - User ID of defect creator
 * @param {string} defectTitle - Defect title
 * @param {string} defectId - Defect ID
 * @param {string} declinedByDept - Department that declined
 * @param {string} reason - Decline reason
 */
export const notifySenderDeclined = (senderId, defectTitle, defectId, declinedByDept, reason) => {
  const reasonStr = reason ? ` • Reason: ${reason}` : '';
  
  sendNotification(senderId, {
    type: DEFECT_NOTIFICATION_TYPES?.DEFECT_DECLINED,
    title: 'Defect declined',
    message: `${defectTitle} declined by ${declinedByDept}${reasonStr}`,
    actionUrl: '/defects',
    actionPayload: { defectId },
    severity: SEVERITY?.WARN
  });
};
