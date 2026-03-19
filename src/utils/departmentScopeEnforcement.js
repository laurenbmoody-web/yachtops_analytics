/**
 * DEPARTMENT SCOPE ENFORCEMENT (DATA-LEVEL SECURITY)
 * 
 * This module provides data-level protection to ensure users can only access
 * data from departments they are authorized to view, regardless of UI state,
 * URL parameters, or internal query values.
 * 
 * SECURITY RULES:
 * - Command role: Can access ALL departments (respects selected scope)
 * - Chief/HOD/Crew: FORCED to own department only (ignores any other scope)
 * 
 * This is a safety and consistency layer that operates silently.
 */

import { getCurrentUser } from './authStorage';
import { getDepartmentScope } from './departmentScopeStorage';
import { hasCommandAccess } from './authStorage';

/**
 * Check if user has Command role
 * @param {Object} user - User object
 * @returns {boolean}
 */
const isCommandRole = (user) => {
  return hasCommandAccess(user);
};

/**
 * Get the enforced department scope for current user
 * This is the AUTHORITATIVE scope that must be applied to all data queries
 * 
 * @param {Object} user - User object (optional, will get current user if not provided)
 * @param {string} requestedScope - Requested department scope (from UI, URL, etc.)
 * @returns {string} Enforced department scope
 */
export const getEnforcedDepartmentScope = (user = null, requestedScope = null) => {
  const currentUser = user || getCurrentUser();
  
  // Command users: respect their selected scope
  if (isCommandRole(currentUser)) {
    const scope = requestedScope || getDepartmentScope();
    return scope === 'ALL' ? null : scope; // null means no filtering
  }
  
  // Non-Command users: FORCE to their own department
  // Ignore any requested scope - this is the security enforcement
  return currentUser?.department?.toUpperCase();
};

/**
 * Apply department scope enforcement to a list of items
 * This is the core security function that filters data based on user authorization
 * 
 * @param {Array} items - Array of items to filter
 * @param {Object} user - User object (optional)
 * @param {string} requestedScope - Requested scope (optional, will be overridden for non-Command)
 * @returns {Array} Filtered items
 */
export const enforceDepartmentScope = (items, user = null, requestedScope = null) => {
  if (!items || !Array.isArray(items)) return [];
  
  const currentUser = user || getCurrentUser();
  const enforcedScope = getEnforcedDepartmentScope(currentUser, requestedScope);
  
  // Command with 'ALL' scope: no filtering
  if (isCommandRole(currentUser) && !enforcedScope) {
    return items;
  }
  
  // Apply department filtering
  return items?.filter(item => {
    // Handle calendar events with visibility array
    if (item?.visibility && Array.isArray(item?.visibility)) {
      return item?.visibility?.some(vis => {
        const visUpper = vis?.toUpperCase();
        return (
          visUpper === enforcedScope ||
          visUpper?.includes(enforcedScope) ||
          vis === 'All Hands'
        );
      });
    }
    
    // Handle items with department field (jobs, inventory)
    const itemDept = item?.department?.toUpperCase();
    return itemDept === enforcedScope;
  });
};

/**
 * Enforce department scope for inventory categories
 * Categories are mapped to departments, so we need special handling
 * 
 * @param {Array} categories - Array of category objects
 * @param {Function} getCategoryDepartment - Function to map category name to department
 * @param {Object} user - User object (optional)
 * @param {string} requestedScope - Requested scope (optional)
 * @returns {Array} Filtered categories
 */
export const enforceDepartmentScopeForCategories = (
  categories,
  getCategoryDepartment,
  user = null,
  requestedScope = null
) => {
  if (!categories || !Array.isArray(categories)) return [];
  
  const currentUser = user || getCurrentUser();
  const enforcedScope = getEnforcedDepartmentScope(currentUser, requestedScope);
  
  // Command with 'ALL' scope: no filtering
  if (isCommandRole(currentUser) && !enforcedScope) {
    return categories;
  }
  
  // Apply department filtering
  return categories?.filter(cat => {
    const catDept = getCategoryDepartment(cat?.name);
    return catDept === enforcedScope;
  });
};

/**
 * Enforce department scope for inventory items
 * Items belong to categories which map to departments
 * 
 * @param {Array} items - Array of inventory items
 * @param {Function} getItemDepartment - Function to determine item's department
 * @param {Object} user - User object (optional)
 * @param {string} requestedScope - Requested scope (optional)
 * @returns {Array} Filtered items
 */
export const enforceDepartmentScopeForInventory = (
  items,
  getItemDepartment,
  user = null,
  requestedScope = null
) => {
  if (!items || !Array.isArray(items)) return [];
  
  const currentUser = user || getCurrentUser();
  const enforcedScope = getEnforcedDepartmentScope(currentUser, requestedScope);
  
  // Command with 'ALL' scope: no filtering
  if (isCommandRole(currentUser) && !enforcedScope) {
    return items;
  }
  
  // Apply department filtering
  return items?.filter(item => {
    const itemDept = getItemDepartment(item);
    return itemDept === enforcedScope;
  });
};
