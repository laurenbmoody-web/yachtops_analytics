// Activity Logger for Inventory Actions

import { getCurrentUser } from '../../../utils/authStorage';

const ACTIVITY_LOG_KEY = 'cargo_inventory_activity_log';

// Log an activity entry
export const logActivity = (action, details) => {
  try {
    const currentUser = getCurrentUser();
    const logsRaw = localStorage.getItem(ACTIVITY_LOG_KEY);
    const logs = logsRaw ? JSON.parse(logsRaw) : [];
    
    const newLog = {
      id: `activity-${Date.now()}-${Math.random()?.toString(36)?.substr(2, 9)}`,
      action,
      timestamp: new Date()?.toISOString(),
      user: currentUser?.name || 'Unknown User',
      userId: currentUser?.id,
      details
    };
    
    logs?.push(newLog);
    localStorage.setItem(ACTIVITY_LOG_KEY, JSON.stringify(logs));
    return true;
  } catch (error) {
    console.error('Error logging activity:', error);
    return false;
  }
};

// Get all activity logs
export const getActivityLogs = () => {
  try {
    const logsRaw = localStorage.getItem(ACTIVITY_LOG_KEY);
    return logsRaw ? JSON.parse(logsRaw) : [];
  } catch (error) {
    console.error('Error loading activity logs:', error);
    return [];
  }
};

// Log bulk delete action
export const logBulkDelete = (scope, itemCount) => {
  const details = {
    scope: {
      l1: scope?.l1Name || scope?.categoryL1Name,
      l2: scope?.l2Name || scope?.categoryL2Name || null,
      l3: scope?.l3Name || scope?.categoryL3Name || null,
      l4: scope?.l4Name || scope?.categoryL4Name || null
    },
    itemCount
  };
  
  return logActivity('Bulk delete', details);
};