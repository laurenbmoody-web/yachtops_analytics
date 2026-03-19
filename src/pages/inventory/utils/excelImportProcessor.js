// CSV Import Processor for Inventory - 4-Level Taxonomy with Smart Keyword Assignment
// Template-based import with taxonomy resolution and safe duplication

import { getAllTaxonomyL1, getTaxonomyL2ByL1, getTaxonomyL3ByL2, getTaxonomyL4ByL3 } from './taxonomyStorage';
import { getAllItems, saveItem } from './inventoryStorage';


// Required and optional template headers (case-insensitive)
const REQUIRED_HEADERS = ['item name'];
const OPTIONAL_HEADERS = [
  'category',
  'subcategory l2',
  'subcategory l3',
  'subcategory l4',
  'notes',
  'unit',
  'photo',
  'usage department',
  'maintenance department'
];

// ============================================
// SMART KEYWORD-BASED AUTO-CLASSIFICATION
// ============================================

const AUTO_CLASSIFICATION_RULES = [
  // Food & Beverage → Drinks Store (Alcohol, Soft Drinks, Water)
  {
    keywords: [
      'rum', 'vodka', 'gin', 'tequila', 'mezcal', 'whisky', 'whiskey', 'bourbon', 'scotch',
      'cognac', 'brandy', 'champagne', 'prosecco', 'cava', 'beer', 'lager', 'ale', 'stout',
      'cider', 'vermouth', 'aperol', 'campari', 'liqueur', 'schnapps', 'baileys', 'kahlua',
      'amaretto', 'bitters', 'sauvignon', 'chardonnay', 'pinot', 'merlot', 'cabernet',
      'malbec', 'shiraz', 'rosé', 'rose'
    ],
    l1: 'Food & Beverage',
    l2: 'Drinks Store',
    l3: 'General'
  },
  {
    keywords: [
      'coke', 'cola', 'pepsi', 'sprite', 'fanta', 'tonic', 'soda', 'soda water',
      'ginger ale', 'ginger beer', 'lemonade', 'kombucha', 'iced tea'
    ],
    l1: 'Food & Beverage',
    l2: 'Drinks Store',
    l3: 'General'
  },
  {
    keywords: [
      'water', 'still water', 'sparkling water', 'perrier', 'evian', 'fiji',
      'san pellegrino', 'acque panna'
    ],
    l1: 'Food & Beverage',
    l2: 'Drinks Store',
    l3: 'General'
  },
  // Food & Beverage → Freezer
  {
    keywords: ['frozen', 'ice cream', 'sorbet', 'gelato', 'popsicle'],
    l1: 'Food & Beverage',
    l2: 'Freezer',
    l3: 'General'
  },
  // Food & Beverage → Fridge
  {
    keywords: ['yogurt', 'yoghurt', 'milk', 'cream', 'cheese', 'butter', 'margarine'],
    l1: 'Food & Beverage',
    l2: 'Fridge',
    l3: 'General'
  },
  // Food & Beverage → Pantry/Dry Store
  {
    keywords: [
      'pasta', 'rice', 'flour', 'sugar', 'salt', 'pepper', 'cereal', 'tea', 'coffee',
      'spices', 'vinegar', 'olive oil', 'oil', 'honey', 'jam', 'peanut butter'
    ],
    l1: 'Food & Beverage',
    l2: 'Dry Store',
    l3: 'General'
  },
  // Guest → Tableware
  {
    keywords: [
      'plate', 'bowl', 'cup', 'saucer', 'cutlery', 'fork', 'knife', 'spoon',
      'napkin', 'tablecloth', 'runner', 'placemat', 'tray', 'platter', 'pitcher'
    ],
    l1: 'Guest',
    l2: 'Tableware',
    l3: 'General'
  },
  // Guest → Toiletries
  {
    keywords: [
      'shampoo', 'conditioner', 'soap', 'body wash', 'lotion', 'moisturizer',
      'toothpaste', 'toothbrush', 'shaving kit', 'razor', 'deodorant'
    ],
    l1: 'Guest',
    l2: 'Toiletries',
    l3: 'General'
  },
  // Crew → Uniforms
  {
    keywords: [
      'polo', 'shirt', 'trousers', 'pants', 'shorts', 'jacket', 'blazer',
      'apron', 'boots', 'shoes', 'crew uniform'
    ],
    l1: 'Crew',
    l2: 'Uniforms',
    l3: 'General'
  },
  // Safety & Compliance → Medical
  {
    keywords: [
      'bandage', 'gauze', 'antiseptic', 'saline', 'thermometer', 'plaster',
      'first aid', 'medication', 'painkiller'
    ],
    l1: 'Safety & Compliance',
    l2: 'Medical',
    l3: 'General'
  },
  // Safety & Compliance → LSA (Life-Saving Appliances)
  {
    keywords: ['lifejacket', 'life jacket', 'lifebuoy', 'life buoy', 'flare', 'life raft'],
    l1: 'Safety & Compliance',
    l2: 'LSA',
    l3: 'General'
  },
  // Safety & Compliance → FFA (Fire Fighting Appliances)
  {
    keywords: [
      'extinguisher', 'fire extinguisher', 'fire blanket', 'scba', 'fire hose',
      'fire fighting'
    ],
    l1: 'Safety & Compliance',
    l2: 'FFA',
    l3: 'General'
  },
  // Safety & Compliance → PPE
  {
    keywords: [
      'gloves', 'goggles', 'hard hat', 'helmet', 'ear protection', 'earplugs',
      'safety glasses', 'hi-vis', 'high visibility', 'safety boots'
    ],
    l1: 'Safety & Compliance',
    l2: 'PPE',
    l3: 'General'
  },
  // Vessel → Spare Parts
  {
    keywords: [
      'filter', 'gasket', 'belt', 'fuse', 'relay', 'connector', 'valve',
      'hose', 'seal', 'bearing', 'impeller'
    ],
    l1: 'Vessel',
    l2: 'Spare Parts',
    l3: 'General'
  },
  // Vessel → Tools & Equipment
  {
    keywords: [
      'screwdriver', 'wrench', 'spanner', 'pliers', 'drill', 'grinder',
      'hammer', 'saw', 'toolbox'
    ],
    l1: 'Vessel',
    l2: 'Tools & Equipment',
    l3: 'General'
  }
];

/**
 * Auto-classify item based on item name using keyword matching
 * Returns { l1, l2, l3 } or null if no match
 */
const autoClassifyItem = (itemName, brand = '') => {
  if (!itemName) return null;
  
  const searchText = `${itemName} ${brand}`?.toLowerCase()?.trim();
  
  for (const rule of AUTO_CLASSIFICATION_RULES) {
    for (const keyword of rule?.keywords) {
      if (searchText?.includes(keyword?.toLowerCase())) {
        return {
          l1: rule?.l1,
          l2: rule?.l2,
          l3: rule?.l3
        };
      }
    }
  }
  
  return null;
};

/**
 * Parse CSV file
 */
export const parseCSVFile = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const text = e?.target?.result;
        const lines = text?.split('\n')?.filter(line => line?.trim());
        
        if (lines?.length < 2) {
          reject(new Error('CSV file is empty or contains no data rows'));
          return;
        }

        // Parse CSV manually
        const jsonData = lines?.map(line => {
          const values = [];
          let current = '';
          let inQuotes = false;
          
          for (let i = 0; i < line?.length; i++) {
            const char = line?.[i];
            if (char === '"') {
              inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
              values?.push(current?.trim());
              current = '';
            } else {
              current += char;
            }
          }
          values?.push(current?.trim());
          return values;
        });

        resolve(jsonData);
      } catch (error) {
        reject(new Error('Failed to parse CSV file: ' + error?.message));
      }
    };

    reader.onerror = () => {
      reject(new Error('Failed to read CSV file'));
    };

    reader?.readAsText(file);
  });
};

/**
 * Normalize string for comparison
 */
const normalizeString = (str) => {
  return String(str || '')?.toLowerCase()?.trim()?.replace(/\s+/g, ' ');
};

/**
 * Attempt to resolve taxonomy from file data OR auto-classification
 * 
 * ID-SAFE IMPORT MATCHING:
 * 1. If category names in import file match existing categories, resolve to IDs
 * 2. Uses case-insensitive name matching to find category IDs
 * 3. Returns resolved IDs (l1Id, l2Id, l3Id, l4Id)
 * 4. Auto-classification also resolves to IDs, not names
 * 
 * Returns { isResolved: boolean, l1Id, l2Id, l3Id, l4Id, needsReview: boolean, autoAssigned: boolean }
 */
const attemptTaxonomyResolution = (categoryName, subcategoryL2Name, subcategoryL3Name, subcategoryL4Name, itemName, brand = '') => {
  const taxonomyL1 = getAllTaxonomyL1();
  
  // STEP 1: Try to match from file data (exact match)
  let l1 = null;
  if (categoryName?.trim()) {
    l1 = taxonomyL1?.find(
      cat => normalizeString(cat?.name) === normalizeString(categoryName)
    );
  }
  
  // If we have L1 from file, try to match L2, L3, L4
  if (l1) {
    let l2 = null;
    if (subcategoryL2Name?.trim()) {
      const taxonomyL2 = getTaxonomyL2ByL1(l1?.id);
      l2 = taxonomyL2?.find(
        cat => normalizeString(cat?.name) === normalizeString(subcategoryL2Name)
      );
    }
    
    if (l2) {
      // L1 and L2 matched from file
      let l3 = null;
      if (subcategoryL3Name?.trim()) {
        const taxonomyL3 = getTaxonomyL3ByL2(l2?.id);
        l3 = taxonomyL3?.find(
          cat => normalizeString(cat?.name) === normalizeString(subcategoryL3Name)
        );
        
        if (!l3) {
          // L3 was provided but not found - needs review
          return {
            isResolved: false,
            l1Id: l1?.id,
            l2Id: l2?.id,
            l3Id: null,
            l4Id: null,
            needsReview: true,
            autoAssigned: false,
            reason: `L3 "${subcategoryL3Name}" not found under ${l2?.name}`
          };
        }
        
        // Try to match L4 if provided
        let l4 = null;
        if (subcategoryL4Name?.trim()) {
          const taxonomyL4 = getTaxonomyL4ByL3(l3?.id);
          l4 = taxonomyL4?.find(
            cat => normalizeString(cat?.name) === normalizeString(subcategoryL4Name)
          );
          
          if (!l4) {
            // L4 was provided but not found - needs review
            return {
              isResolved: false,
              l1Id: l1?.id,
              l2Id: l2?.id,
              l3Id: l3?.id,
              l4Id: null,
              needsReview: true,
              autoAssigned: false,
              reason: `L4 "${subcategoryL4Name}" not found under ${l3?.name}`
            };
          }
        }
        
        // Fully resolved from file
        return {
          isResolved: true,
          l1Id: l1?.id,
          l2Id: l2?.id,
          l3Id: l3?.id,
          l4Id: l4?.id || null,
          needsReview: false,
          autoAssigned: false
        };
      } else {
        // L1+L2 matched, no L3 provided - assign to "General" L3
        const taxonomyL3 = getTaxonomyL3ByL2(l2?.id);
        const generalL3 = taxonomyL3?.find(cat => cat?.name === 'General');
        
        if (generalL3) {
          return {
            isResolved: true,
            l1Id: l1?.id,
            l2Id: l2?.id,
            l3Id: generalL3?.id,
            l4Id: null,
            needsReview: false,
            autoAssigned: false
          };
        }
      }
    } else if (subcategoryL2Name?.trim()) {
      // L1 matched but L2 not found - needs review
      return {
        isResolved: false,
        l1Id: l1?.id,
        l2Id: null,
        l3Id: null,
        l4Id: null,
        needsReview: true,
        autoAssigned: false,
        reason: `L2 "${subcategoryL2Name}" not found under ${l1?.name}`
      };
    }
  }
  
  // STEP 2: Try auto-classification using keywords
  const autoClassified = autoClassifyItem(itemName, brand);
  if (autoClassified) {
    // Resolve auto-classified names to IDs
    const l1Match = taxonomyL1?.find(cat => normalizeString(cat?.name) === normalizeString(autoClassified?.l1));
    if (l1Match) {
      const taxonomyL2 = getTaxonomyL2ByL1(l1Match?.id);
      const l2Match = taxonomyL2?.find(cat => normalizeString(cat?.name) === normalizeString(autoClassified?.l2));
      
      if (l2Match) {
        const taxonomyL3 = getTaxonomyL3ByL2(l2Match?.id);
        const l3Match = taxonomyL3?.find(cat => normalizeString(cat?.name) === normalizeString(autoClassified?.l3));
        
        if (l3Match) {
          return {
            isResolved: true,
            l1Id: l1Match?.id,
            l2Id: l2Match?.id,
            l3Id: l3Match?.id,
            l4Id: null,
            needsReview: false,
            autoAssigned: true
          };
        }
      }
    }
  }
  
  // STEP 3: No match - needs review
  return {
    isResolved: false,
    l1Id: null,
    l2Id: null,
    l3Id: null,
    l4Id: null,
    needsReview: true,
    autoAssigned: false,
    reason: 'No matching category found'
  };
};

/**
 * Process parsed data and prepare import preview
 */
export const processImportData = (jsonData) => {
  if (!jsonData || jsonData?.length < 2) {
    throw new Error('No data to process');
  }

  // Extract headers (first row)
  const headers = jsonData?.[0]?.map(h => String(h || '')?.toLowerCase()?.trim());
  
  // Validate required headers
  const missingHeaders = REQUIRED_HEADERS?.filter(
    req => !headers?.some(h => h === req?.toLowerCase())
  );
  
  if (missingHeaders?.length > 0) {
    throw new Error(`Missing required headers: ${missingHeaders?.join(', ')}`);
  }

  // Map header indices
  const headerMap = {};
  headers?.forEach((header, index) => {
    headerMap[header] = index;
  });

  // Process data rows
  const processedRows = [];
  const existingItems = getAllItems();

  for (let i = 1; i < jsonData?.length; i++) {
    const row = jsonData?.[i];
    const itemName = String(row?.[headerMap?.['item name']] || '')?.trim();
    
    // Skip empty rows
    if (!itemName) continue;

    const categoryName = String(row?.[headerMap?.['category']] || '')?.trim();
    const subcategoryL2Name = String(row?.[headerMap?.['subcategory l2']] || '')?.trim();
    const subcategoryL3Name = String(row?.[headerMap?.['subcategory l3']] || '')?.trim();
    const subcategoryL4Name = String(row?.[headerMap?.['subcategory l4']] || '')?.trim();
    const notes = String(row?.[headerMap?.['notes']] || '')?.trim();
    const unit = String(row?.[headerMap?.['unit']] || '')?.trim();
    const photo = String(row?.[headerMap?.['photo']] || '')?.trim();
    const usageDepartment = String(row?.[headerMap?.['usage department']] || 'INTERIOR')?.trim()?.toUpperCase();
    const maintenanceDepartment = String(row?.[headerMap?.['maintenance department']] || '')?.trim()?.toUpperCase();

    // Attempt taxonomy resolution
    const taxonomyResolution = attemptTaxonomyResolution(
      categoryName,
      subcategoryL2Name,
      subcategoryL3Name,
      subcategoryL4Name,
      itemName,
      ''
    );

    // Check for duplicates (by name + taxonomy)
    const isDuplicate = existingItems?.some(existing => {
      const nameMatch = normalizeString(existing?.name) === normalizeString(itemName);
      const taxonomyMatch = existing?.l1Id === taxonomyResolution?.l1Id &&
                           existing?.l2Id === taxonomyResolution?.l2Id &&
                           existing?.l3Id === taxonomyResolution?.l3Id;
      return nameMatch && taxonomyMatch;
    });

    processedRows?.push({
      rowIndex: i,
      itemName,
      categoryName,
      subcategoryL2Name,
      subcategoryL3Name,
      subcategoryL4Name,
      notes,
      unit,
      photo,
      usageDepartment,
      maintenanceDepartment,
      taxonomyResolution,
      isDuplicate,
      status: isDuplicate ? 'duplicate' : (taxonomyResolution?.needsReview ? 'needs_review' : 'ready')
    });
  }

  return {
    totalRows: processedRows?.length,
    readyRows: processedRows?.filter(r => r?.status === 'ready')?.length,
    needsReviewRows: processedRows?.filter(r => r?.status === 'needs_review')?.length,
    duplicateRows: processedRows?.filter(r => r?.status === 'duplicate')?.length,
    autoAssignedRows: processedRows?.filter(r => r?.taxonomyResolution?.autoAssigned)?.length,
    rows: processedRows
  };
};

/**
 * Execute import after review
 */
export const executeImport = (processedRows, userResolvedTaxonomy = {}) => {
  let successCount = 0;
  let errorCount = 0;
  const errors = [];

  processedRows?.forEach(row => {
    // Skip duplicates
    if (row?.status === 'duplicate') return;

    // Use user-resolved taxonomy if provided, otherwise use auto-resolved
    const taxonomy = userResolvedTaxonomy?.[row?.rowIndex] || row?.taxonomyResolution;

    if (!taxonomy?.isResolved && !taxonomy?.l1Id) {
      errorCount++;
      errors?.push(`Row ${row?.rowIndex}: No taxonomy assigned`);
      return;
    }

    const itemData = {
      name: row?.itemName,
      notes: row?.notes,
      photo: row?.photo,
      usageDepartment: row?.usageDepartment,
      maintenanceDepartment: row?.maintenanceDepartment,
      l1Id: taxonomy?.l1Id,
      l2Id: taxonomy?.l2Id,
      l3Id: taxonomy?.l3Id,
      l4Id: taxonomy?.l4Id || null
    };

    const success = saveItem(itemData);
    if (success) {
      successCount++;
    } else {
      errorCount++;
      errors?.push(`Row ${row?.rowIndex}: Failed to save item`);
    }
  });

  return {
    success: errorCount === 0,
    successCount,
    errorCount,
    errors
  };
};

function validateTemplate(...args) {
  // eslint-disable-next-line no-console
  console.warn('Placeholder: validateTemplate is not implemented yet.', args);
  return null;
}

export { validateTemplate };
function processImportWithResolutions(...args) {
  // eslint-disable-next-line no-console
  console.warn('Placeholder: processImportWithResolutions is not implemented yet.', args);
  return null;
}

export { processImportWithResolutions };