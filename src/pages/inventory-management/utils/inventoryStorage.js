// Inventory Storage Utility

const STORAGE_KEY = 'cargo_inventory_items';
const RESTOCK_NOTIFICATION_KEY = 'cargo.inventory.restock_notifications.v1';

import { normalizeCategoryName as normalizeCategoryNameUtil } from './folderMapping';
import { getCurrentUser } from '../../../utils/authStorage';
import { enforceDepartmentScopeForInventory } from '../../../utils/departmentScopeEnforcement';
import { getDepartmentScope } from '../../../utils/departmentScopeStorage';
import { notifyInventoryRestock } from '../../team-jobs-management/utils/notifications';

// Helper function to determine item's department based on category
const getItemDepartment = (item) => {
  const categoryName = item?.category?.toLowerCase();
  
  // Map categories to departments (same logic as in inventory-management/index.jsx)
  if (categoryName?.includes('galley') || categoryName?.includes('food') || 
      categoryName?.includes('beverage') || categoryName?.includes('kitchen')) {
    return 'GALLEY';
  }
  if (categoryName?.includes('interior') || categoryName?.includes('linen') || 
      categoryName?.includes('cabin') || categoryName?.includes('guest')) {
    return 'INTERIOR';
  }
  if (categoryName?.includes('deck') || categoryName?.includes('exterior') || 
      categoryName?.includes('mooring') || categoryName?.includes('tender')) {
    return 'DECK';
  }
  if (categoryName?.includes('engine') || categoryName?.includes('technical') || 
      categoryName?.includes('mechanical') || categoryName?.includes('electrical')) {
    return 'ENGINEERING';
  }
  
  // Default to INTERIOR for uncategorized items
  return 'INTERIOR';
};

// Get all items with department scope enforcement
export const getAllItems = () => {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    const allItems = data ? JSON.parse(data) : [];
    
    // Apply department scope enforcement at data level
    const currentUser = getCurrentUser();
    const requestedScope = getDepartmentScope();
    
    return enforceDepartmentScopeForInventory(
      allItems,
      getItemDepartment,
      currentUser,
      requestedScope
    );
  } catch (error) {
    console.error('Error loading inventory items:', error);
    return [];
  }
};

// Get items by category (with optional asset filtering)
export const getItemsByCategory = (categoryName, assetId = null) => {
  const items = getAllItems();
  
  const normalizedSearchCategory = normalizeCategoryNameUtil(categoryName);
  
  return items?.filter(item => {
    // Normalize item's category for comparison
    const itemCategoryNormalized = normalizeCategoryNameUtil(item?.category || 'imported');
    const categoryMatch = itemCategoryNormalized === normalizedSearchCategory;
    const assetMatch = !assetId || !item?.assetId || item?.assetId === assetId;
    return categoryMatch && assetMatch;
  });
};

// Get items by asset
export const getItemsByAsset = (assetId) => {
  const items = getAllItems();
  return items?.filter(item => !item?.assetId || item?.assetId === assetId);
};

// Get single item by ID
export const getItemById = (itemId) => {
  const items = getAllItems();
  return items?.find(item => item?.id === itemId);
};

/**
 * Check if restock notification was already sent for this item recently
 * @param {string} itemId - Item ID
 * @returns {boolean} True if notification was sent in last 24 hours
 */
const wasRestockNotificationSent = (itemId) => {
  try {
    const stored = localStorage.getItem(RESTOCK_NOTIFICATION_KEY);
    const notifications = stored ? JSON.parse(stored) : {};
    const lastSent = notifications?.[itemId];
    
    if (!lastSent) return false;
    
    const cutoff = Date.now() - (24 * 60 * 60 * 1000); // 24 hours ago
    return new Date(lastSent)?.getTime() > cutoff;
  } catch {
    return false;
  }
};

/**
 * Mark restock notification as sent for this item
 * @param {string} itemId - Item ID
 */
const markRestockNotificationSent = (itemId) => {
  try {
    const stored = localStorage.getItem(RESTOCK_NOTIFICATION_KEY);
    const notifications = stored ? JSON.parse(stored) : {};
    notifications[itemId] = new Date()?.toISOString();
    localStorage.setItem(RESTOCK_NOTIFICATION_KEY, JSON.stringify(notifications));
  } catch (error) {
    console.error('Error marking restock notification:', error);
  }
};

/**
 * Check if item crossed restock threshold and send notification if needed
 * @param {Object} item - Item object
 * @param {number} previousTotal - Previous total quantity (before update)
 */
const checkRestockAlert = (item, previousTotal) => {
  if (!item?.restockEnabled || item?.restockLevel === null) return;
  
  const currentTotal = item?.totalQty || 0;
  const threshold = item?.restockLevel;
  
  // Check if we crossed the threshold (was above, now at or below)
  const crossedThreshold = previousTotal > threshold && currentTotal <= threshold;
  
  // Or if we're already below and haven't notified in 24h
  const alreadyBelowAndNotNotified = currentTotal <= threshold && !wasRestockNotificationSent(item?.id);
  
  if (crossedThreshold || alreadyBelowAndNotNotified) {
    // Determine usage department from category
    const usageDepartment = getItemDepartment(item);
    
    // Send notification
    notifyInventoryRestock(
      item?.name,
      item?.id,
      currentTotal,
      threshold,
      usageDepartment
    );
    
    // Mark as sent
    markRestockNotificationSent(item?.id);
  }
};

// Save item (add or update)
export const saveItem = (itemData) => {
  try {
    const items = getAllItems();
    const timestamp = new Date()?.toISOString();
    
    // Get previous total for restock check
    let previousTotal = 0;
    if (itemData?.id) {
      const existingItem = items?.find(item => item?.id === itemData?.id);
      if (existingItem) {
        previousTotal = existingItem?.totalQty || 0;
      }
    }
    
    if (itemData?.id) {
      // Check if item exists
      const index = items?.findIndex(item => item?.id === itemData?.id);
      if (index !== -1) {
        // Update existing item
        items[index] = {
          ...itemData,
          // Ensure taxonomy IDs are preserved
          categoryId: itemData?.categoryId || items?.[index]?.categoryId,
          subcategoryL2Id: itemData?.subcategoryL2Id || items?.[index]?.subcategoryL2Id,
          subcategoryL3Id: itemData?.subcategoryL3Id || items?.[index]?.subcategoryL3Id || null,
          updatedAt: timestamp
        };
      } else {
        // Add new item with provided ID (import case)
        const newItem = {
          ...itemData,
          createdAt: timestamp,
          updatedAt: timestamp
        };
        items?.push(newItem);
      }
    } else {
      // Add new item
      const newItem = {
        ...itemData,
        id: `item-${Date.now()}-${Math.random()?.toString(36)?.substr(2, 9)}`,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      items?.push(newItem);
    }
    
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    
    // Check for restock alert after save
    if (itemData?.id) {
      const savedItem = items?.find(item => item?.id === itemData?.id);
      if (savedItem) {
        checkRestockAlert(savedItem, previousTotal);
      }
    }
    
    return true;
  } catch (error) {
    console.error('Error saving inventory item:', error);
    return false;
  }
};

// Delete item
export const deleteItem = (itemId) => {
  try {
    const items = getAllItems();
    const filtered = items?.filter(item => item?.id !== itemId);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
    return true;
  } catch (error) {
    console.error('Error deleting inventory item:', error);
    return false;
  }
};

/**
 * Delete category (with option to delete items or move to "Imported")
 * @param {string} categoryName - Category name to delete
 * @param {boolean} deleteItems - If true, delete all items; if false, move to "Imported"
 * @param {string} assetId - Optional asset ID for filtering
 * @returns {boolean} - Success status
 */
export const deleteCategory = (categoryName, deleteItems = false, assetId = null) => {
  try {
    const items = getAllItems();
    const normalizedCategory = normalizeCategoryNameUtil(categoryName);
    
    if (deleteItems) {
      // Delete all items in this category
      const filtered = items?.filter(item => {
        const itemCategory = normalizeCategoryNameUtil(item?.category || 'imported');
        const categoryMatch = itemCategory === normalizedCategory;
        const assetMatch = !assetId || !item?.assetId || item?.assetId === assetId;
        return !(categoryMatch && assetMatch);
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
    } else {
      // Move items to "Imported" category
      const updated = items?.map(item => {
        const itemCategory = normalizeCategoryNameUtil(item?.category || 'imported');
        const categoryMatch = itemCategory === normalizedCategory;
        const assetMatch = !assetId || !item?.assetId || item?.assetId === assetId;
        
        if (categoryMatch && assetMatch) {
          return {
            ...item,
            category: 'Imported'
          };
        }
        return item;
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    }
    
    return true;
  } catch (error) {
    console.error('Error deleting category:', error);
    return false;
  }
};

// Duplicate item (copy with reset quantities)
export const duplicateItem = (itemId) => {
  try {
    const item = getItemById(itemId);
    if (!item) return null;
    
    const duplicated = {
      ...item,
      id: undefined, // Will be generated in saveItem
      name: `${item?.name} (Copy)`,
      quantity: 0,
      additionalLocations: item?.additionalLocations?.map(loc => ({
        ...loc,
        quantity: 0
      })),
      variants: item?.variants?.map(variant => ({
        ...variant,
        quantity: 0
      }))
    };
    
    saveItem(duplicated);
    return duplicated;
  } catch (error) {
    console.error('Error duplicating item:', error);
    return null;
  }
};

// Calculate total quantity across all locations and variants
export const calculateTotalQuantity = (item) => {
  let total = parseFloat(item?.quantity || 0);
  
  // Add quantities from additional locations
  if (item?.additionalLocations?.length > 0) {
    item?.additionalLocations?.forEach(loc => {
      total += parseFloat(loc?.quantity || 0);
    });
  }
  
  // Add quantities from variants
  if (item?.hasVariants && item?.variants?.length > 0) {
    item?.variants?.forEach(variant => {
      total += parseFloat(variant?.quantity || 0);
    });
  }
  
  return total;
};

// Check if item is low stock
export const isLowStock = (item) => {
  let total = calculateTotalQuantity(item);
  const reorderPoint = parseFloat(item?.reorderPoint || 0);
  return total <= reorderPoint;
};

// Get stock status
export const getStockStatus = (item) => {
  let total = calculateTotalQuantity(item);
  const parLevel = parseFloat(item?.parLevel || 0);
  const reorderPoint = parseFloat(item?.reorderPoint || 0);
  
  if (total === 0) return 'out';
  if (total <= reorderPoint) return 'low';
  if (total >= parLevel) return 'healthy';
  return 'moderate';
};

// Get category statistics
export const getCategoryStats = (categoryId) => {
  const items = getItemsByCategory(categoryId);
  const lowStockItems = items?.filter(item => isLowStock(item));
  
  return {
    totalItems: items?.length,
    lowStockCount: lowStockItems?.length,
    outOfStockCount: items?.filter(item => calculateTotalQuantity(item) === 0)?.length
  };
};

// Search items
export const searchItems = (query) => {
  const items = getAllItems();
  const lowerQuery = query?.toLowerCase();
  
  return items?.filter(item => {
    return (
      item?.name?.toLowerCase()?.includes(lowerQuery) ||
      item?.category?.toLowerCase()?.includes(lowerQuery) ||
      item?.subcategory?.toLowerCase()?.includes(lowerQuery) ||
      item?.supplier?.toLowerCase()?.includes(lowerQuery)
    );
  });
};