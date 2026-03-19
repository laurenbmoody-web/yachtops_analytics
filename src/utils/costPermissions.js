import { getCurrentUser, hasCommandAccess, hasChiefAccess, hasHODAccess } from './authStorage';
import { isDevMode } from './devMode';

/**
 * Cost Permissions Utility
 * Manages cost visibility and edit permissions for inventory items
 * 
 * Rules:
 * - VIEW: Command, Chief, HOD can view cost
 * - EDIT: Only Command and Chief can edit cost
 * - CREW: Cannot view or edit cost
 */

/**
 * Check if current user can view cost information
 * @returns {boolean}
 */
export const canViewCost = () => {
  if (isDevMode()) return true;
  const user = getCurrentUser();
  if (!user) return false;
  return hasCommandAccess(user) || hasChiefAccess(user) || hasHODAccess(user);
};

/**
 * Check if current user can edit cost information
 * @returns {boolean}
 */
export const canEditCost = () => {
  if (isDevMode()) return true;
  const user = getCurrentUser();
  if (!user) return false;
  return hasCommandAccess(user) || hasChiefAccess(user);
};

/**
 * Get currency symbol from currency code
 * @param {string} currency - Currency code (USD, EUR, GBP, etc.)
 * @returns {string} Currency symbol
 */
export const getCurrencySymbol = (currency) => {
  const symbols = {
    'USD': '$',
    'EUR': '€',
    'GBP': '£',
    'AUD': 'A$',
    'CAD': 'C$'
  };
  return symbols?.[currency] || '$';
};

/**
 * Format currency value
 * @param {number} value - Numeric value
 * @param {string} currency - Currency code
 * @returns {string} Formatted currency string
 */
export const formatCurrency = (value, currency = 'USD') => {
  if (value === null || value === undefined) return 'Not set';
  const symbol = getCurrencySymbol(currency);
  return `${symbol}${parseFloat(value)?.toFixed(2)}`;
};

/**
 * Calculate total value for an item
 * @param {number} unitCost - Unit cost
 * @param {number} totalQty - Total quantity
 * @returns {number} Total value
 */
export const calculateTotalValue = (unitCost, totalQty) => {
  if (!unitCost || !totalQty) return 0;
  return unitCost * totalQty;
};

/**
 * Calculate replenishment value for items below restock level
 * @param {Array} items - Array of inventory items
 * @returns {Object} { totalValue, itemCount, currency }
 */
export const calculateReplenishmentValue = (items) => {
  let totalValue = 0;
  let itemCount = 0;
  let currency = 'USD'; // Default currency
  
  items?.forEach(item => {
    // Only calculate for items with restock enabled and below restock level
    if (!item?.restockEnabled || !item?.restockLevel || !item?.unitCost) return;
    
    const totalQty = item?.totalQty || item?.stockLocations?.reduce((sum, loc) => sum + (loc?.qty || 0), 0) || 0;
    
    // Check if below restock level
    if (totalQty < item?.restockLevel) {
      const shortfall = item?.restockLevel - totalQty;
      const replenishmentCost = shortfall * item?.unitCost;
      totalValue += replenishmentCost;
      itemCount++;
      
      // Use the first currency we encounter
      if (itemCount === 1 && item?.currency) {
        currency = item?.currency;
      }
    }
  });

  return { totalValue, itemCount, currency };
};

/**
 * Calculate total inventory value
 * @param {Array} items - Array of inventory items
 * @returns {Object} { totalValue, itemCount, currency }
 */
export const calculateTotalInventoryValue = (items) => {
  let totalValue = 0;
  let itemCount = 0;
  let currency = 'USD'; // Default currency
  
  items?.forEach(item => {
    // Only calculate for items with unit cost set
    if (!item?.unitCost) return;
    
    const totalQty = item?.totalQty || item?.locations?.reduce((sum, loc) => sum + (loc?.quantity || 0), 0) || 0;
    
    const itemValue = item?.unitCost * totalQty;
    totalValue += itemValue;
    itemCount++;
    
    // Use the first currency we encounter
    if (itemCount === 1 && item?.currency) {
      currency = item?.currency;
    }
  });

  return { totalValue, itemCount, currency };
};

/**
 * Calculate percentage of inventory value below restock
 * @param {number} replenishmentValue - Cost to replenish
 * @param {number} totalInventoryValue - Total inventory value
 * @returns {number|null} Percentage or null if cannot calculate
 */
export const calculatePercentageBelowRestock = (replenishmentValue, totalInventoryValue) => {
  if (!replenishmentValue || !totalInventoryValue || totalInventoryValue === 0) return null;
  return ((replenishmentValue / totalInventoryValue) * 100)?.toFixed(1);
};

/**
 * Get inventory value change indicator
 * @returns {Object|null} { direction: 'up'|'down'|'stable', previousValue, currentValue, timestamp }
 */
export const getInventoryValueChange = () => {
  try {
    const stored = localStorage.getItem('inventory_value_snapshot');
    if (!stored) return null;
    return JSON.parse(stored);
  } catch (error) {
    console.error('Error reading inventory value snapshot:', error);
    return null;
  }
};

/**
 * Save inventory value snapshot for change tracking
 * @param {number} currentValue - Current total inventory value
 * @param {string} currency - Currency code
 */
export const saveInventoryValueSnapshot = (currentValue, currency) => {
  try {
    const existing = getInventoryValueChange();
    const now = new Date()?.toISOString();
    
    let direction = 'stable';
    if (existing && existing?.currentValue !== undefined) {
      if (currentValue > existing?.currentValue) {
        direction = 'up';
      } else if (currentValue < existing?.currentValue) {
        direction = 'down';
      }
    }
    
    const snapshot = {
      previousValue: existing?.currentValue || currentValue,
      currentValue,
      currency,
      direction,
      timestamp: now
    };
    
    localStorage.setItem('inventory_value_snapshot', JSON.stringify(snapshot));
  } catch (error) {
    console.error('Error saving inventory value snapshot:', error);
  }
};