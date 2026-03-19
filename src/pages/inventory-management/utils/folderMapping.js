// Folder Mapping and Category Normalization Utility

// FOLDER DEFINITIONS
export const FOLDERS = [
  { id: 'vessel', name: 'Vessel', icon: 'Ship' },
  { id: 'guest', name: 'Guest', icon: 'Users' },
  { id: 'crew', name: 'Crew', icon: 'UserCheck' },
  { id: 'bonded', name: 'Bonded', icon: 'Lock' }
];

// CATEGORY TO FOLDER MAPPING
export const FOLDER_MAPPING = {
  // Bonded
  'alcohol & bar': 'bonded',
  'alcohol': 'bonded',
  'cigarettes': 'bonded',
  'tobacco': 'bonded',
  
  // Guest
  'pantry': 'guest',
  'cold stores': 'guest',
  'toiletries': 'guest',
  'guest giveaways': 'guest',
  'guest amenities': 'guest',
  
  // Crew
  'crew bedding & linen': 'crew',
  'uniforms': 'crew',
  
  // Vessel (default for most categories)
  'medical': 'vessel',
  'table linen': 'vessel',
  'glassware': 'vessel',
  'holloware': 'vessel',
  'halloware': 'vessel', // Will normalize to holloware
  'flatware': 'vessel',
  'tableware': 'vessel',
  'boat accessories': 'vessel',
  'accessories': 'vessel',
  'spare parts': 'vessel',
  'parts': 'vessel',
  'storage unit': 'vessel',
  'decorations': 'vessel',
  'appliance list': 'vessel',
  'cleaning & laundry': 'vessel',
  'safety & compliance': 'vessel',
  'galley': 'vessel',
  'housekeeping': 'vessel'
};

// CATEGORY NORMALIZATION RULES
const NORMALIZATION_MAP = {
  // Spelling corrections
  'halloware': 'holloware',
  'hollowware': 'holloware',
  
  // Synonyms
  'boat accessories': 'accessories',
  'spare parts': 'parts',
  'alcohol': 'alcohol & bar',
  'bar': 'alcohol & bar',
  
  // Tobacco products
  'tobacco': 'cigarettes',
  'cigars': 'cigarettes',
  
  // Guest items
  'guest giveaway': 'guest giveaways',
  'guest amenity': 'guest amenities',
  'amenities': 'guest amenities',
  
  // Storage
  'cold store': 'cold stores',
  'cold storage': 'cold stores',
  'freezer': 'cold stores',
  
  // Safety
  'safety': 'safety & compliance',
  'compliance': 'safety & compliance'
};

/**
 * Normalize category name (case-insensitive + synonyms)
 * @param {string} categoryName - Raw category name
 * @returns {string} - Normalized category name (lowercase)
 */
export const normalizeCategoryName = (categoryName) => {
  if (!categoryName) return 'imported';
  
  const lower = categoryName?.toLowerCase()?.trim();
  
  // Check if there's a normalization rule
  if (NORMALIZATION_MAP?.[lower]) {
    return NORMALIZATION_MAP?.[lower]?.toLowerCase();
  }
  
  return lower;
};

/**
 * Get folder ID for a category
 * @param {string} categoryName - Category name (will be normalized)
 * @returns {string} - Folder ID ('vessel', 'guest', 'crew', 'bonded')
 */
export const getFolderForCategory = (categoryName) => {
  const normalized = normalizeCategoryName(categoryName);
  return FOLDER_MAPPING?.[normalized] || 'vessel'; // Default to vessel
};

/**
 * Get display name for a category (proper casing)
 * @param {string} categoryName - Category name
 * @returns {string} - Display name with proper casing
 */
export const getCategoryDisplayName = (categoryName) => {
  const normalized = normalizeCategoryName(categoryName);
  
  // Map to proper display names
  const displayMap = {
    'alcohol & bar': 'Alcohol & Bar',
    'cigarettes': 'Cigarettes',
    'pantry': 'Pantry',
    'cold stores': 'Cold Stores',
    'toiletries': 'Toiletries',
    'guest giveaways': 'Guest Giveaways',
    'guest amenities': 'Guest Amenities',
    'crew bedding & linen': 'Crew Bedding & Linen',
    'uniforms': 'Uniforms',
    'medical': 'Medical',
    'table linen': 'Table Linen',
    'glassware': 'Glassware',
    'holloware': 'Holloware',
    'flatware': 'Flatware',
    'tableware': 'Tableware',
    'accessories': 'Accessories',
    'parts': 'Parts',
    'storage unit': 'Storage Unit',
    'decorations': 'Decorations',
    'appliance list': 'Appliance List',
    'safety & compliance': 'Safety & Compliance',
    'galley': 'Galley',
    'housekeeping': 'Housekeeping',
    'imported': 'Imported'
  };
  
  return displayMap?.[normalized] || categoryName;
};

/**
 * Get icon for a category
 * @param {string} categoryName - Category name
 * @returns {string} - Lucide icon name
 */
export const getIconForCategory = (categoryName) => {
  const normalized = normalizeCategoryName(categoryName);
  
  const iconMap = {
    'alcohol & bar': 'Wine',
    'cigarettes': 'Cigarette',
    'pantry': 'Package',
    'cold stores': 'Snowflake',
    'toiletries': 'Sparkles',
    'guest giveaways': 'Gift',
    'guest amenities': 'Sparkles',
    'crew bedding & linen': 'Bed',
    'uniforms': 'Shirt',
    'medical': 'Cross',
    'table linen': 'Layers',
    'glassware': 'Wine',
    'holloware': 'UtensilsCrossed',
    'flatware': 'Utensils',
    'tableware': 'UtensilsCrossed',
    'accessories': 'Anchor',
    'parts': 'Wrench',
    'storage unit': 'Archive',
    'decorations': 'Sparkles',
    'appliance list': 'Plug',
    'safety & compliance': 'Shield',
    'galley': 'ChefHat',
    'housekeeping': 'Home',
    'imported': 'Upload'
  };
  
  return iconMap?.[normalized] || 'Package';
};

/**
 * Get all categories grouped by folder
 * @param {Array} items - All inventory items
 * @param {string} assetId - Current asset ID for filtering
 * @returns {Object} - Folders with their categories and statistics
 */
export const getCategoriesGroupedByFolder = (items, assetId) => {
  // Filter items by asset
  const itemsForAsset = items?.filter(item => !item?.assetId || item?.assetId === assetId);
  
  // Group items by normalized category
  const categoryMap = {};
  
  itemsForAsset?.forEach(item => {
    const rawCategory = item?.category || 'Imported';
    const normalized = normalizeCategoryName(rawCategory);
    const displayName = getCategoryDisplayName(rawCategory);
    const folderId = getFolderForCategory(rawCategory);
    
    if (!categoryMap?.[normalized]) {
      categoryMap[normalized] = {
        normalizedName: normalized,
        displayName: displayName,
        folderId: folderId,
        icon: getIconForCategory(rawCategory),
        items: [],
        uniqueItemIds: new Set()
      };
    }
    
    // Add item if not already added (avoid duplicates)
    if (!categoryMap?.[normalized]?.uniqueItemIds?.has(item?.id)) {
      categoryMap?.[normalized]?.items?.push(item);
      categoryMap?.[normalized]?.uniqueItemIds?.add(item?.id);
    }
  });
  
  // Group categories by folder
  const folderData = {};
  
  FOLDERS?.forEach(folder => {
    folderData[folder.id] = {
      ...folder,
      categories: [],
      totalItems: 0,
      categoryCount: 0
    };
  });
  
  // Assign categories to folders
  Object.values(categoryMap)?.forEach(category => {
    const folderId = category?.folderId;
    
    if (folderData?.[folderId]) {
      folderData?.[folderId]?.categories?.push({
        id: category?.normalizedName?.replace(/[^a-z0-9]+/g, '-'),
        name: category?.displayName,
        normalizedName: category?.normalizedName,
        itemCount: category?.items?.length,
        icon: category?.icon
      });
      
      folderData[folderId].totalItems += category?.items?.length;
      folderData[folderId].categoryCount += 1;
    }
  });
  
  return folderData;
};