// Header Intelligence Utility for Auto-Import

// Normalize text for comparison
const normalizeText = (text) => {
  return String(text || '')?.toLowerCase()?.trim()?.replace(/[_-]/g, ' ')?.replace(/\s+/g, ' ');
};

// Item name detection patterns
const itemNamePatterns = [
  { pattern: /^(item|product|description|name|article)$/i, confidence: 1.0 },
  { pattern: /item\s*name/i, confidence: 1.0 },
  { pattern: /product\s*name/i, confidence: 1.0 },
  { pattern: /description/i, confidence: 0.8 },
  { pattern: /^name$/i, confidence: 0.7 }
];

// Category detection patterns
const categoryPatterns = [
  { pattern: /^category$/i, confidence: 1.0 },
  { pattern: /^type$/i, confidence: 0.7 },
  { pattern: /^group$/i, confidence: 0.6 },
  { pattern: /product\s*category/i, confidence: 0.9 }
];

// Location detection patterns (for location quantity columns)
const locationPatterns = [
  { pattern: /^(bdp|bds|pantry|galley|bar|cellar|cabin|deck|storage|warehouse|room)$/i, confidence: 0.9 },
  { pattern: /(master|guest|crew|engine|laundry)\s*(cabin|room|area)/i, confidence: 0.8 },
  { pattern: /^(location|area|zone|storage)\s*\d+$/i, confidence: 0.7 },
  { pattern: /^[A-Z]{2,4}$/i, confidence: 0.6 } // Short codes like BDP, BDS
];

// Quantity detection patterns
const quantityPatterns = [
  { pattern: /^(qty|quantity|amount|count|stock)$/i, confidence: 1.0 },
  { pattern: /^(qty|quantity)\s*on\s*hand/i, confidence: 0.9 },
  { pattern: /^total$/i, confidence: 0.5 }
];

// Unit of measure detection patterns
const unitPatterns = [
  { pattern: /^(unit|uom|measure|units?)$/i, confidence: 1.0 },
  { pattern: /unit\s*of\s*measure/i, confidence: 1.0 },
  { pattern: /^(kg|litre|ml|g|bottle|case|pack|box|each)$/i, confidence: 0.8 }
];

// Notes/metadata patterns
const notesPatterns = [
  { pattern: /^(notes?|remarks?|comments?)$/i, confidence: 1.0 },
  { pattern: /description/i, confidence: 0.6 }
];

// Match header against patterns
const matchPattern = (header, patterns) => {
  const normalized = normalizeText(header);
  
  for (const { pattern, confidence } of patterns) {
    if (pattern?.test(normalized)) {
      return { match: true, confidence };
    }
  }
  
  return { match: false, confidence: 0 };
};

// Detect if header is likely a location quantity column
const isLikelyLocationColumn = (header, allHeaders) => {
  const normalized = normalizeText(header);
  
  // Check against location patterns
  const locationMatch = matchPattern(header, locationPatterns);
  if (locationMatch?.match) {
    return { isLocation: true, confidence: locationMatch?.confidence };
  }
  
  // Check if it's a short code (2-4 uppercase letters)
  if (/^[A-Z]{2,4}$/?.test(header?.trim())) {
    return { isLocation: true, confidence: 0.7 };
  }
  
  // Check if header contains location-related words
  const locationKeywords = ['storage', 'room', 'cabin', 'deck', 'area', 'zone', 'pantry', 'galley', 'bar', 'cellar'];
  if (locationKeywords?.some(keyword => normalized?.includes(keyword))) {
    return { isLocation: true, confidence: 0.6 };
  }
  
  return { isLocation: false, confidence: 0 };
};

// Main header interpretation function
export const interpretHeaders = (headers, sheetNames = null) => {
  const interpretation = {
    itemNameColumn: null,
    itemNameConfidence: 0,
    categoryColumn: null,
    categoryConfidence: 0,
    locationColumns: [],
    quantityColumn: null,
    quantityConfidence: 0,
    unitColumn: null,
    unitConfidence: 0,
    notesColumns: [],
    fieldMappings: {},
    ignoredColumns: []
  };

  // If sheet names provided, use them as category hints
  if (sheetNames?.length > 0) {
    interpretation.categorySource = 'sheet_names';
    interpretation.detectedCategories = sheetNames;
  }

  headers?.forEach(header => {
    if (!header || typeof header !== 'string') return;

    // Item Name detection
    const itemMatch = matchPattern(header, itemNamePatterns);
    if (itemMatch?.match && itemMatch?.confidence > interpretation?.itemNameConfidence) {
      interpretation.itemNameColumn = header;
      interpretation.itemNameConfidence = itemMatch?.confidence;
      interpretation.fieldMappings[header] = 'itemName';
      return;
    }

    // Category detection
    const categoryMatch = matchPattern(header, categoryPatterns);
    if (categoryMatch?.match && categoryMatch?.confidence > interpretation?.categoryConfidence) {
      interpretation.categoryColumn = header;
      interpretation.categoryConfidence = categoryMatch?.confidence;
      interpretation.fieldMappings[header] = 'category';
      return;
    }

    // Unit detection
    const unitMatch = matchPattern(header, unitPatterns);
    if (unitMatch?.match && unitMatch?.confidence > interpretation?.unitConfidence) {
      interpretation.unitColumn = header;
      interpretation.unitConfidence = unitMatch?.confidence;
      interpretation.fieldMappings[header] = 'unit';
      return;
    }

    // Quantity detection (single quantity column)
    const quantityMatch = matchPattern(header, quantityPatterns);
    if (quantityMatch?.match && quantityMatch?.confidence > interpretation?.quantityConfidence) {
      interpretation.quantityColumn = header;
      interpretation.quantityConfidence = quantityMatch?.confidence;
      interpretation.fieldMappings[header] = 'quantity';
      return;
    }

    // Notes detection
    const notesMatch = matchPattern(header, notesPatterns);
    if (notesMatch?.match) {
      interpretation?.notesColumns?.push(header);
      interpretation.fieldMappings[header] = 'notes';
      return;
    }

    // Location quantity column detection
    const locationCheck = isLikelyLocationColumn(header, headers);
    if (locationCheck?.isLocation && locationCheck?.confidence >= 0.6) {
      interpretation?.locationColumns?.push(header);
      interpretation.fieldMappings[header] = 'locationQuantity';
      return;
    }

    // If no match, mark as ignored (will be stored as metadata)
    interpretation?.ignoredColumns?.push(header);
  });

  return interpretation;
};

// Analyze sample data to extract additional insights
export const analyzeDataSample = (headers, sampleRows, interpretation) => {
  const analysis = {
    categoriesDetected: [],
    unitsDetected: [],
    locationsDetected: [],
    itemsPreview: [],
    estimatedNewLocations: 0,
    estimatedNewCategories: 0
  };

  if (!sampleRows || sampleRows?.length === 0) return analysis;

  const categoryIndex = headers?.indexOf(interpretation?.categoryColumn);
  const unitIndex = headers?.indexOf(interpretation?.unitColumn);
  const itemNameIndex = headers?.indexOf(interpretation?.itemNameColumn);

  const categoriesSet = new Set();
  const unitsSet = new Set();
  const locationsSet = new Set();

  sampleRows?.forEach(row => {
    // Extract categories
    if (categoryIndex >= 0 && row?.[categoryIndex]) {
      categoriesSet?.add(String(row?.[categoryIndex])?.trim());
    }

    // Extract units
    if (unitIndex >= 0 && row?.[unitIndex]) {
      unitsSet?.add(String(row?.[unitIndex])?.toLowerCase()?.trim());
    }

    // Extract locations from location columns
    interpretation?.locationColumns?.forEach(locCol => {
      const locIndex = headers?.indexOf(locCol);
      if (locIndex >= 0 && row?.[locIndex]) {
        locationsSet?.add(locCol); // Location name is the header
      }
    });

    // Build item preview
    if (itemNameIndex >= 0 && row?.[itemNameIndex]) {
      const itemPreview = {
        name: row?.[itemNameIndex],
        category: categoryIndex >= 0 ? row?.[categoryIndex] : 'Uncategorised',
        locations: []
      };

      interpretation?.locationColumns?.forEach(locCol => {
        const locIndex = headers?.indexOf(locCol);
        if (locIndex >= 0 && row?.[locIndex]) {
          const qty = parseFloat(row?.[locIndex]);
          if (!isNaN(qty) && qty > 0) {
            itemPreview?.locations?.push({ location: locCol, quantity: qty });
          }
        }
      });

      if (itemPreview?.locations?.length > 0) {
        analysis?.itemsPreview?.push(itemPreview);
      }
    }
  });

  analysis.categoriesDetected = Array.from(categoriesSet);
  analysis.unitsDetected = Array.from(unitsSet);
  analysis.locationsDetected = Array.from(locationsSet);
  analysis.estimatedNewLocations = locationsSet?.size;
  analysis.estimatedNewCategories = categoriesSet?.size;

  return analysis;
};

// Transform data rows into inventory items
export const transformToInventoryItems = (headers, dataRows, interpretation) => {
  const items = [];
  const skippedRows = [];

  const itemNameIndex = headers?.indexOf(interpretation?.itemNameColumn);
  const categoryIndex = headers?.indexOf(interpretation?.categoryColumn);
  const unitIndex = headers?.indexOf(interpretation?.unitColumn);

  dataRows?.forEach((row, rowIndex) => {
    // Skip if no item name
    if (itemNameIndex < 0 || !row?.[itemNameIndex]) {
      skippedRows?.push({ rowIndex: rowIndex + 2, reason: 'No item name found' });
      return;
    }

    const itemName = String(row?.[itemNameIndex])?.trim();
    const category = categoryIndex >= 0 && row?.[categoryIndex] ? String(row?.[categoryIndex])?.trim() : 'Uncategorised';
    const unit = unitIndex >= 0 && row?.[unitIndex] ? String(row?.[unitIndex])?.toLowerCase()?.trim() : 'each';

    // Extract location quantities
    const locationQuantities = [];
    let hasQuantity = false;

    interpretation?.locationColumns?.forEach(locCol => {
      const locIndex = headers?.indexOf(locCol);
      if (locIndex >= 0 && row?.[locIndex]) {
        const qty = parseFloat(row?.[locIndex]);
        if (!isNaN(qty) && qty > 0) {
          locationQuantities?.push({
            locationName: locCol,
            quantity: qty
          });
          hasQuantity = true;
        }
      }
    });

    // Skip if no quantities found
    if (!hasQuantity) {
      skippedRows?.push({ rowIndex: rowIndex + 2, reason: 'No quantity data found' });
      return;
    }

    // Calculate total quantity
    const totalQuantity = locationQuantities?.reduce((sum, loc) => sum + loc?.quantity, 0);

    // Extract notes
    let notes = '';
    interpretation?.notesColumns?.forEach(noteCol => {
      const noteIndex = headers?.indexOf(noteCol);
      if (noteIndex >= 0 && row?.[noteIndex]) {
        notes += String(row?.[noteIndex]) + ' ';
      }
    });

    items?.push({
      name: itemName,
      category,
      unit,
      totalQuantity,
      locationQuantities,
      primaryLocation: locationQuantities?.[0]?.locationName || null,
      notes: notes?.trim(),
      sourceRow: rowIndex + 2
    });
  });

  return { items, skippedRows };
};