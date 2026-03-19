// Import Storage Utility for Staging-First CSV Import

const BATCH_STORAGE_KEY = 'cargo_import_batches';
const ROW_STORAGE_KEY = 'cargo_import_rows';

// ========== ImportBatch Operations ==========

// Get all batches
export const getAllBatches = () => {
  try {
    const data = localStorage.getItem(BATCH_STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error('Error loading import batches:', error);
    return [];
  }
};

// Get single batch by ID
export const getBatchById = (batchId) => {
  const batches = getAllBatches();
  return batches?.find(batch => batch?.id === batchId);
};

// Save batch (add or update)
export const saveBatch = (batchData) => {
  try {
    const batches = getAllBatches();
    const timestamp = new Date()?.toISOString();
    
    if (batchData?.id) {
      // Update existing batch
      const index = batches?.findIndex(batch => batch?.id === batchData?.id);
      if (index !== -1) {
        batches[index] = {
          ...batchData,
          updated_at: timestamp
        };
      }
    } else {
      // Add new batch
      const newBatch = {
        ...batchData,
        id: `batch-${Date.now()}-${Math.random()?.toString(36)?.substr(2, 9)}`,
        created_at: timestamp,
        updated_at: timestamp
      };
      batches?.push(newBatch);
      localStorage.setItem(BATCH_STORAGE_KEY, JSON.stringify(batches));
      return newBatch;
    }
    
    localStorage.setItem(BATCH_STORAGE_KEY, JSON.stringify(batches));
    return batchData;
  } catch (error) {
    console.error('Error saving import batch:', error);
    return null;
  }
};

// Delete batch
export const deleteBatch = (batchId) => {
  try {
    const batches = getAllBatches();
    const filtered = batches?.filter(batch => batch?.id !== batchId);
    localStorage.setItem(BATCH_STORAGE_KEY, JSON.stringify(filtered));
    
    // Also delete all rows for this batch
    deleteRowsByBatchId(batchId);
    return true;
  } catch (error) {
    console.error('Error deleting import batch:', error);
    return false;
  }
};

// ========== ImportRow Operations ==========

// Get all rows
export const getAllRows = () => {
  try {
    const data = localStorage.getItem(ROW_STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error('Error loading import rows:', error);
    return [];
  }
};

// Get rows by batch ID
export const getRowsByBatchId = (batchId) => {
  const rows = getAllRows();
  return rows?.filter(row => row?.batch_id === batchId);
};

// Save multiple rows (bulk insert)
export const saveRows = (rowsData) => {
  try {
    const existingRows = getAllRows();
    const newRows = rowsData?.map((rowData, index) => ({
      id: `row-${Date.now()}-${index}-${Math.random()?.toString(36)?.substr(2, 9)}`,
      ...rowData
    }));
    
    const allRows = [...existingRows, ...newRows];
    localStorage.setItem(ROW_STORAGE_KEY, JSON.stringify(allRows));
    return newRows;
  } catch (error) {
    console.error('Error saving import rows:', error);
    return [];
  }
};

// Delete rows by batch ID
export const deleteRowsByBatchId = (batchId) => {
  try {
    const rows = getAllRows();
    const filtered = rows?.filter(row => row?.batch_id !== batchId);
    localStorage.setItem(ROW_STORAGE_KEY, JSON.stringify(filtered));
    return true;
  } catch (error) {
    console.error('Error deleting import rows:', error);
    return false;
  }
};

// ========== Transformation & Validation ==========

// Normalize text for comparison
export const normalizeText = (text) => {
  return text?.toLowerCase()?.trim()?.replace(/\s+/g, ' ') || '';
};

// Category ID mapping
const categoryIdMap = {
  'alcohol & bar': 'alcohol-bar',
  'pantry': 'pantry',
  'cold stores': 'cold-stores',
  'guest amenities': 'guest-amenities',
  'cleaning & laundry': 'cleaning-laundry',
  'uniforms': 'uniforms',
  'spare parts': 'spare-parts',
  'safety & compliance': 'safety-compliance'
};

// Valid categories
const validCategories = [
  'Uncategorised',
  'Alcohol & Bar',
  'Pantry',
  'Cold Stores',
  'Guest Amenities',
  'Cleaning & Laundry',
  'Uniforms',
  'Spare Parts',
  'Safety & Compliance'
];

// Valid units
const validUnits = ['each', 'bottle', 'case', 'pack', 'litre', 'kg', 'g', 'ml', 'set', 'roll', 'box', 'other'];

// Valid locations
const validLocations = [
  'Bar Storage',
  'Wine Cellar',
  'Pantry',
  'Cold Room',
  'Galley',
  'Crew Mess',
  'Guest Cabins',
  'Laundry Room',
  'Engine Room',
  'Deck Storage',
  'Other'
];

// Find closest match for category
export const findClosestCategory = (input) => {
  const normalized = normalizeText(input);
  const match = validCategories?.find(cat => normalizeText(cat) === normalized);
  return match || 'Uncategorised'; // Default to Uncategorised
};

// Find closest match for unit
export const findClosestUnit = (input) => {
  const normalized = normalizeText(input);
  const match = validUnits?.find(unit => normalizeText(unit) === normalized);
  return match || 'each'; // Default to each
};

// Find closest match for location
export const findClosestLocation = (input) => {
  const normalized = normalizeText(input);
  const match = validLocations?.find(loc => normalizeText(loc) === normalized);
  return match || 'Other'; // Default to Other
};

// Get category ID from category name
export const getCategoryId = (categoryName) => {
  const normalized = normalizeText(categoryName);
  return categoryIdMap?.[normalized] || 'pantry';
};

// Auto-detection mapping
const commonMappings = {
  'item name': 'name',
  'name': 'name',
  'product': 'name',
  'item': 'name',
  'category': 'category',
  'subcategory': 'subcategory',
  'sub category': 'subcategory',
  'unit': 'unit',
  'unit of measure': 'unit',
  'uom': 'unit',
  'location': 'primaryLocation',
  'primary location': 'primaryLocation',
  'storage location': 'primaryLocation',
  'quantity': 'quantity',
  'qty': 'quantity',
  'amount': 'quantity',
  'par level': 'parLevel'
};
