// Department Scope state management for Command users
// Persists selected department scope across Jobs, Inventory, and Calendar pages

const STORAGE_KEY = 'cargo.departmentScope.session';

export const DEPARTMENT_OPTIONS = [
  { value: 'ALL', label: 'All' },
  { value: 'INTERIOR', label: 'Interior' },
  { value: 'GALLEY', label: 'Galley' },
  { value: 'DECK', label: 'Deck' },
  { value: 'ENGINEERING', label: 'Engineering' },
  { value: 'MANAGEMENT', label: 'Management' }
];

import { hasCommandAccess } from './authStorage';

/**
 * Get current department scope from session storage
 * @returns {string} Department scope value (default: 'ALL')
 */
export const getDepartmentScope = () => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && DEPARTMENT_OPTIONS.some(opt => opt.value === stored)) {
      return stored;
    }
    return 'ALL';
  } catch (error) {
    console.error('Error reading department scope:', error);
    return 'ALL';
  }
};

/**
 * Set department scope in localStorage
 * @param {string} scope - Department scope value
 */
export const setDepartmentScope = (scope) => {
  try {
    localStorage.setItem(STORAGE_KEY, scope);
  } catch (error) {
    console.error('Error saving department scope:', error);
  }
};

/**
 * Check if user is Command role (can see department scope toggle)
 * @param {Object} user - Current user object
 * @returns {boolean}
 */
export const isCommandRole = (user) => {
  return hasCommandAccess(user);
};

/**
 * Filter items by department scope
 * @param {Array} items - Array of items with department property or visibility array
 * @param {string} scope - Selected department scope
 * @param {Object} currentUser - Current user object
 * @returns {Array} Filtered items
 */
export const filterByDepartmentScope = (items, scope, currentUser) => {
  if (!items) return [];
  
  // Command with 'ALL' scope sees everything
  if (isCommandRole(currentUser) && scope === 'ALL') {
    return items;
  }
  
  // Command with specific department selected
  if (isCommandRole(currentUser) && scope !== 'ALL') {
    return items?.filter(item => {
      // For calendar events with visibility array
      if (item?.visibility && Array.isArray(item?.visibility)) {
        // Check if visibility includes the selected department
        const scopeLabel = DEPARTMENT_OPTIONS?.find(opt => opt?.value === scope)?.label;
        return item?.visibility?.some(vis => {
          const visUpper = vis?.toUpperCase();
          return visUpper === scope || vis === scopeLabel || visUpper?.includes(scope);
        });
      }
      
      // For inventory items with usageDepartment field
      if (item?.usageDepartment) {
        const itemDept = item?.usageDepartment?.toUpperCase();
        return itemDept === scope;
      }
      
      // For jobs/other items with department field
      const itemDept = item?.department?.toUpperCase();
      return itemDept === scope;
    });
  }
  
  // Non-Command users: filter to their own department
  const userDept = currentUser?.department?.toUpperCase();
  return items?.filter(item => {
    // For calendar events with visibility array
    if (item?.visibility && Array.isArray(item?.visibility)) {
      // Check if visibility includes user's department
      return item?.visibility?.some(vis => {
        const visUpper = vis?.toUpperCase();
        return visUpper === userDept || visUpper?.includes(userDept) || vis === 'All Hands';
      });
    }
    
    // For inventory items with usageDepartment field
    if (item?.usageDepartment) {
      const itemDept = item?.usageDepartment?.toUpperCase();
      return itemDept === userDept;
    }
    
    // For jobs/other items with department field
    const itemDept = item?.department?.toUpperCase();
    return itemDept === userDept;
  });
};

/**
 * Get display label for current scope
 * @param {string} scope - Department scope value
 * @returns {string} Display label
 */
export const getScopeLabel = (scope) => {
  const option = DEPARTMENT_OPTIONS?.find(opt => opt?.value === scope);
  return option ? option?.label : 'All';
};