// Selection Processor - Transform user selections into inventory data

export const processSelections = ({ headers, data, columnMappings, rowMappings }) => {
  const items = [];
  const locationsSet = new Set();
  const categoriesSet = new Set();
  const skippedRows = [];

  // Find column indices for each mapping type
  const itemNameIndex = Object.keys(columnMappings)?.find(
    key => columnMappings?.[key] === 'itemName'
  );
  const categoryIndex = Object.keys(columnMappings)?.find(
    key => columnMappings?.[key] === 'category'
  );
  const quantityIndex = Object.keys(columnMappings)?.find(
    key => columnMappings?.[key] === 'quantity'
  );
  const unitIndex = Object.keys(columnMappings)?.find(
    key => columnMappings?.[key] === 'unit'
  );
  const notesIndex = Object.keys(columnMappings)?.find(
    key => columnMappings?.[key] === 'notes'
  );

  // Find all location columns
  const locationIndices = Object.keys(columnMappings)
    ?.filter(key => columnMappings?.[key] === 'location')
    ?.map(key => parseInt(key));

  // Build category divider map from row mappings
  const categoryDividers = {};
  Object.keys(rowMappings)?.forEach(rowIndex => {
    if (rowMappings?.[rowIndex] === 'category') {
      categoryDividers[rowIndex] = data?.[rowIndex]?.[0] || 'Uncategorised';
    }
  });

  // Determine current category based on dividers
  const getCurrentCategory = (rowIndex) => {
    let currentCategory = 'Uncategorised';
    
    // Find the most recent category divider before this row
    Object.keys(categoryDividers)
      ?.map(idx => parseInt(idx))
      ?.sort((a, b) => a - b)
      ?.forEach(dividerIndex => {
        if (dividerIndex < rowIndex) {
          currentCategory = categoryDividers?.[dividerIndex];
        }
      });
    
    return currentCategory;
  };

  // Process each data row
  data?.forEach((row, rowIndex) => {
    // Skip if this row is a category divider
    if (rowMappings?.[rowIndex] === 'category') {
      return;
    }

    // Get item name
    const itemName = row?.[itemNameIndex]?.toString()?.trim();
    if (!itemName) {
      skippedRows?.push({
        rowIndex,
        reason: 'No item name found'
      });
      return;
    }

    // Get category
    let category = 'Uncategorised';
    if (categoryIndex !== undefined && row?.[categoryIndex]) {
      category = row?.[categoryIndex]?.toString()?.trim();
    } else {
      // Use category from dividers
      category = getCurrentCategory(rowIndex);
    }
    categoriesSet?.add(category);

    // Get unit
    const unit = unitIndex !== undefined && row?.[unitIndex] 
      ? row?.[unitIndex]?.toString()?.trim() 
      : 'each';

    // Get notes
    const notes = notesIndex !== undefined && row?.[notesIndex]
      ? row?.[notesIndex]?.toString()?.trim()
      : '';

    // Process locations and quantities
    const locations = [];
    let totalQuantity = 0;

    if (locationIndices?.length > 0) {
      // Location quantity columns mode
      locationIndices?.forEach(locIndex => {
        const locationName = headers?.[locIndex]?.toString()?.trim();
        const quantity = parseFloat(row?.[locIndex]) || 0;

        if (quantity > 0) {
          locations?.push({
            location: locationName,
            quantity
          });
          locationsSet?.add(locationName);
          totalQuantity += quantity;
        }
      });
    } else if (quantityIndex !== undefined) {
      // Single quantity column mode
      const quantity = parseFloat(row?.[quantityIndex]) || 0;
      if (quantity > 0) {
        totalQuantity = quantity;
        locations?.push({
          location: 'Default',
          quantity
        });
        locationsSet?.add('Default');
      }
    }

    // Skip if no quantities found
    if (totalQuantity === 0) {
      skippedRows?.push({
        rowIndex,
        reason: 'No quantity found'
      });
      return;
    }

    // Create item
    items?.push({
      name: itemName,
      category,
      unit,
      notes,
      locations,
      totalQuantity
    });
  });

  return {
    items,
    locations: Array.from(locationsSet),
    categories: Array.from(categoriesSet),
    skippedRows
  };
};

// Get category ID from category name
export const getCategoryId = (categoryName) => {
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
  
  const normalized = categoryName?.toLowerCase()?.trim();
  return categoryIdMap?.[normalized] || 'pantry';
};