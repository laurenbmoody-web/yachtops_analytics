// Audit Logger - Immutable Audit Logs for Guest/Location/Category Management

import { getCurrentUser } from './authStorage';

const AUDIT_LOG_KEY = 'cargo.auditLogs.v1';
const MAX_LOGS = 10000;

/**
 * Entity Types
 */
export const EntityType = {
  GUEST: 'GUEST',
  LOCATION: 'LOCATION',
  CATEGORY: 'CATEGORY'
};

/**
 * Action Types
 */
export const AuditAction = {
  CREATED: 'CREATED',
  UPDATED: 'UPDATED',
  DELETED: 'DELETED',
  LINKED: 'LINKED',
  UNLINKED: 'UNLINKED',
  ARCHIVED: 'ARCHIVED',
  UNARCHIVED: 'UNARCHIVED'
};

/**
 * AuditLog Type Definition:
 * {
 *   id: string (uuid),
 *   timestamp: ISO timestamp,
 *   entityType: "GUEST" | "LOCATION" | "CATEGORY",
 *   entityId: string,
 *   entityName: string (for display),
 *   action: string (CREATED/UPDATED/DELETED/LINKED/UNLINKED/ARCHIVED/UNARCHIVED),
 *   changes: Array<{field: string, before: any, after: any}>,
 *   userId: string,
 *   userName: string,
 *   userRole: string,
 *   userDepartment: string
 * }
 */

/**
 * Load all audit logs from storage
 * @returns {Array} Array of audit logs (newest first)
 */
const loadAllLogs = () => {
  try {
    const stored = localStorage.getItem(AUDIT_LOG_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
    return [];
  } catch (error) {
    console.error('Error loading audit logs:', error);
    return [];
  }
};

/**
 * Save audit logs to storage (cap at MAX_LOGS)
 * @param {Array} logs - Array of audit logs
 */
const saveLogs = (logs) => {
  try {
    // Keep only newest MAX_LOGS
    const capped = logs?.slice(0, MAX_LOGS);
    localStorage.setItem(AUDIT_LOG_KEY, JSON.stringify(capped));
  } catch (error) {
    console.error('Error saving audit logs:', error);
  }
};

/**
 * Create a new audit log entry
 * @param {Object} logData - Log data
 * @returns {Object} New audit log entry
 */
export const createAuditLog = (logData) => {
  const currentUser = getCurrentUser();
  
  const log = {
    id: crypto.randomUUID(),
    timestamp: new Date()?.toISOString(),
    entityType: logData?.entityType, // REQUIRED
    entityId: logData?.entityId, // REQUIRED
    entityName: logData?.entityName || 'Unknown', // REQUIRED for display
    action: logData?.action, // REQUIRED
    changes: logData?.changes || [], // Array of {field, before, after}
    userId: currentUser?.id || 'system',
    userName: currentUser?.fullName || currentUser?.name || 'System',
    userRole: currentUser?.roleTitle || 'Unknown',
    userDepartment: currentUser?.department || 'Unknown'
  };
  
  return log;
};

/**
 * Log an audit event (best-effort, non-blocking)
 * @param {Object} logData - Log data
 */
export const logAudit = (logData) => {
  try {
    const log = createAuditLog(logData);
    let logs = loadAllLogs();
    
    // Add to beginning (newest first)
    logs?.unshift(log);
    
    saveLogs(logs);
  } catch (error) {
    console.error('Error logging audit event (non-blocking):', error);
    // Don't throw - logging is best-effort
  }
};

/**
 * Get audit logs with filtering
 * @param {Object} filters - Optional filters { entityType, entityId, action, startDate, endDate }
 * @returns {Array} Filtered audit logs
 */
export const getAuditLogs = (filters = {}) => {
  const currentUser = getCurrentUser();
  if (!currentUser) return [];
  
  let logs = loadAllLogs();
  
  // Apply entity type filter
  if (filters?.entityType) {
    logs = logs?.filter(log => log?.entityType === filters?.entityType);
  }
  
  // Apply entity ID filter
  if (filters?.entityId) {
    logs = logs?.filter(log => log?.entityId === filters?.entityId);
  }
  
  // Apply action filter
  if (filters?.action) {
    logs = logs?.filter(log => log?.action === filters?.action);
  }
  
  // Apply date range filter
  if (filters?.startDate) {
    const startDate = new Date(filters?.startDate);
    logs = logs?.filter(log => new Date(log?.timestamp) >= startDate);
  }
  
  if (filters?.endDate) {
    const endDate = new Date(filters?.endDate);
    logs = logs?.filter(log => new Date(log?.timestamp) <= endDate);
  }
  
  return logs;
};

/**
 * Get audit logs for a specific entity
 * @param {string} entityType - Entity type (GUEST, LOCATION, CATEGORY)
 * @param {string} entityId - Entity ID
 * @returns {Array} Array of audit logs for the entity (newest first)
 */
export const getAuditLogsByEntity = (entityType, entityId) => {
  const allLogs = loadAllLogs();
  return allLogs?.filter(log => log?.entityType === entityType && log?.entityId === entityId);
};

/**
 * Get audit logs for a specific entity
 * @param {string} entityType - Entity type (GUEST/LOCATION/CATEGORY)
 * @param {string} entityId - Entity ID
 * @returns {Array} Audit logs for the entity
 */
export const getEntityAuditLogs = (entityType, entityId) => {
  return getAuditLogs({ entityType, entityId });
};

/**
 * Get recent audit logs (for dashboard/admin view)
 * @param {number} limit - Number of logs to return
 * @returns {Array} Recent audit logs
 */
export const getRecentAuditLogs = (limit = 50) => {
  let logs = getAuditLogs();
  return logs?.slice(0, limit);
};

/**
 * Helper to calculate field changes between old and new objects
 * @param {Object} oldData - Old data object
 * @param {Object} newData - New data object
 * @param {Array} fieldsToTrack - Array of field names to track
 * @returns {Array} Array of changes {field, before, after}
 */
export const calculateChanges = (oldData, newData, fieldsToTrack) => {
  const changes = [];
  
  fieldsToTrack?.forEach(field => {
    const oldValue = oldData?.[field];
    const newValue = newData?.[field];
    
    // Compare values (handle null/undefined)
    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      changes?.push({
        field,
        before: oldValue,
        after: newValue
      });
    }
  });
  
  return changes;
};