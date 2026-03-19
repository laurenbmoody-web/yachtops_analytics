import { jsPDF } from 'jspdf';
import { getTaxonomyL1ById, getTaxonomyL2ById, getTaxonomyL3ById, getTaxonomyL4ById } from './taxonomyStorage';
import { DEPARTMENT_OPTIONS } from '../../../utils/departmentScopeStorage';
import { canViewCost, getCurrencySymbol, calculateTotalInventoryValue, calculateReplenishmentValue } from '../../../utils/costPermissions';

/**
 * Generate PDF for inventory export
 * @param {Array} items - Items to export
 * @param {Object} options - Export options
 * @param {string} options.scope - 'current' | 'entire' | 'section'
 * @param {Object} options.taxonomyPath - Current taxonomy path {l1Id, l2Id, l3Id, l4Id}
 * @param {string} options.departmentFilter - Department filter value
 * @param {boolean} options.includeImages - Whether to include images
 * @param {boolean} options.includeCost - Whether to include cost & value
 * @param {string} options.searchQuery - Active search query if any
 * @param {boolean} options.returnBlob - If true, return blob instead of auto-downloading
 */
export const generateInventoryPDF = async (items, options = {}) => {
  const {
    scope = 'current',
    taxonomyPath = {},
    departmentFilter = 'ALL',
    includeImages = false,
    includeCost = false,
    searchQuery = '',
    returnBlob = false
  } = options;

  try {
    // Create PDF document (A4 portrait)
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    const pageWidth = doc?.internal?.pageSize?.getWidth();
    const pageHeight = doc?.internal?.pageSize?.getHeight();
    const margin = 15;
    const contentWidth = pageWidth - (margin * 2);

    // Add header to first page
    addPDFHeader(doc, scope, taxonomyPath, departmentFilter, searchQuery, margin);

    // Group items by taxonomy based on export scope
    const groupedItems = groupItemsByTaxonomyHierarchical(items, scope, taxonomyPath);

    let yPosition = 70; // Start after header

    // Iterate through groups
    for (const group of groupedItems) {
      // Check if we need a new page for section header
      if (yPosition > pageHeight - 40) {
        addFooter(doc, pageWidth, pageHeight, margin);
        doc?.addPage();
        yPosition = margin + 10;
      }

      // Render breadcrumb header (ONCE per section)
      if (group?.breadcrumb) {
        doc?.setFontSize(11);
        doc?.setFont('helvetica', 'bold');
        doc?.setTextColor(40, 40, 40);
        doc?.text(group?.breadcrumb, margin, yPosition);
        yPosition += 8;
      }

      // Render TYPE subheaders if present (L3 exports)
      if (group?.typeGroups && group?.typeGroups?.length > 0) {
        for (const typeGroup of group?.typeGroups) {
          // Check page space
          if (yPosition > pageHeight - 40) {
            addFooter(doc, pageWidth, pageHeight, margin);
            doc?.addPage();
            yPosition = margin + 10;
          }

          // Render TYPE subheader
          doc?.setFontSize(9);
          doc?.setFont('helvetica', 'bold');
          doc?.setTextColor(80, 80, 80);
          doc?.text(typeGroup?.typeHeader, margin + 3, yPosition);
          yPosition += 6;

          // Render items in this TYPE
          for (const item of typeGroup?.items) {
            const itemHeight = await renderItemRow(doc, item, yPosition, margin, contentWidth, includeImages, includeCost, pageWidth, pageHeight);
            yPosition += itemHeight;

            // Check if we need a new page
            if (yPosition > pageHeight - 40) {
              addFooter(doc, pageWidth, pageHeight, margin);
              doc?.addPage();
              yPosition = margin + 10;
            }
          }

          yPosition += 3; // Space between TYPE groups
        }
      } else {
        // Render items directly (L4 exports or single group)
        for (const item of group?.items) {
          const itemHeight = await renderItemRow(doc, item, yPosition, margin, contentWidth, includeImages, includeCost, pageWidth, pageHeight);
          yPosition += itemHeight;

          // Check if we need a new page
          if (yPosition > pageHeight - 40) {
            addFooter(doc, pageWidth, pageHeight, margin);
            doc?.addPage();
            yPosition = margin + 10;
          }
        }
      }

      yPosition += 5; // Space between major sections
    }

    // Add footer to last page
    addFooter(doc, pageWidth, pageHeight, margin);

    // Add cost totals footer if includeCost is enabled
    if (includeCost && canViewCost()) {
      addCostTotalsFooter(doc, items, pageWidth, pageHeight, margin);
    }

    // Generate meaningful filename
    const fileName = generateFileName(scope, taxonomyPath, departmentFilter);

    // Return blob or download
    if (returnBlob) {
      const blob = doc?.output('blob');
      return { blob, fileName };
    } else {
      // Download PDF
      doc?.save(fileName);
    }
  } catch (error) {
    console.error('PDF generation failed:', error);
    
    // If images were enabled and generation failed, retry without images
    if (includeImages) {
      console.log('Retrying PDF generation without images...');
      try {
        const result = await generateInventoryPDF(items, { ...options, includeImages: false });
        
        // Notify user about fallback
        if (window.showToast) {
          window.showToast('Generated without images due to a rendering issue.', 'warning');
        } else {
          alert('PDF generated without images due to a rendering issue.');
        }
        
        return result;
      } catch (retryError) {
        console.error('PDF generation failed even without images:', retryError);
        
        // Show error to user
        if (window.showToast) {
          window.showToast('PDF export failed. Please try again.', 'error');
        } else {
          alert('PDF export failed. Please try again.');
        }
        
        throw retryError;
      }
    } else {
      // Show error to user
      if (window.showToast) {
        window.showToast('PDF export failed. Please try again.', 'error');
      } else {
        alert('PDF export failed. Please try again.');
      }
      
      throw error;
    }
  }
};

/**
 * Generate meaningful filename based on scope
 */
const generateFileName = (scope, taxonomyPath, departmentFilter) => {
  const date = new Date()?.toISOString()?.split('T')?.[0]; // YYYY-MM-DD format
  let scopeName = 'Entire Inventory';

  if (scope === 'current') {
    scopeName = 'Current View';
  } else if (scope === 'section' && taxonomyPath?.l1Id) {
    const l1 = getTaxonomyL1ById(taxonomyPath?.l1Id);
    if (taxonomyPath?.l4Id) {
      const l4 = getTaxonomyL4ById(taxonomyPath?.l4Id);
      scopeName = l4?.name || 'Section';
    } else if (taxonomyPath?.l3Id) {
      const l3 = getTaxonomyL3ById(taxonomyPath?.l3Id);
      scopeName = l3?.name || 'Section';
    } else if (taxonomyPath?.l2Id) {
      const l2 = getTaxonomyL2ById(taxonomyPath?.l2Id);
      scopeName = l2?.name || 'Section';
    } else {
      scopeName = l1?.name || 'Section';
    }
  }

  // Clean filename (remove special characters)
  const cleanScopeName = scopeName?.replace(/[^a-zA-Z0-9\s-]/g, '')?.replace(/\s+/g, ' ')?.trim();
  
  return `Cargo Inventory - ${cleanScopeName} - ${date}.pdf`;
};

/**
 * Add header to PDF first page
 */
const addPDFHeader = (doc, scope, taxonomyPath, departmentFilter, searchQuery, margin) => {
  // Title
  doc?.setFontSize(18);
  doc?.setFont('helvetica', 'bold');
  doc?.setTextColor(0, 0, 0);
  doc?.text('Inventory Report', margin, margin + 10);

  // Generated date/time
  doc?.setFontSize(10);
  doc?.setFont('helvetica', 'normal');
  doc?.setTextColor(80, 80, 80);
  const now = new Date();
  const dateStr = now?.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const timeStr = now?.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  doc?.text(`Generated: ${dateStr} at ${timeStr}`, margin, margin + 18);

  // Scope breadcrumb
  const scopeText = buildScopeBreadcrumb(scope, taxonomyPath, searchQuery);
  doc?.text(`Scope: ${scopeText}`, margin, margin + 25);

  // Department filter
  const deptLabel = DEPARTMENT_OPTIONS?.find(opt => opt?.value === departmentFilter)?.label || 'All';
  doc?.text(`Department Filter: ${deptLabel}`, margin, margin + 32);

  // Separator line
  doc?.setDrawColor(200, 200, 200);
  doc?.setLineWidth(0.5);
  doc?.line(margin, margin + 38, doc?.internal?.pageSize?.getWidth() - margin, margin + 38);
};

/**
 * Build human-readable scope breadcrumb
 */
const buildScopeBreadcrumb = (scope, taxonomyPath, searchQuery) => {
  if (scope === 'entire') {
    return 'Entire Inventory';
  }

  if (scope === 'current') {
    const parts = [];
    
    if (taxonomyPath?.l1Id) {
      const l1 = getTaxonomyL1ById(taxonomyPath?.l1Id);
      parts?.push(l1?.name || 'Unknown');
    }
    
    if (taxonomyPath?.l2Id) {
      const l2 = getTaxonomyL2ById(taxonomyPath?.l2Id);
      parts?.push(l2?.name || 'Unknown');
    }
    
    if (taxonomyPath?.l3Id) {
      const l3 = getTaxonomyL3ById(taxonomyPath?.l3Id);
      parts?.push(l3?.name || 'Unknown');
    }
    
    if (taxonomyPath?.l4Id) {
      const l4 = getTaxonomyL4ById(taxonomyPath?.l4Id);
      parts?.push(l4?.name || 'Unknown');
    }

    let breadcrumb = parts?.length > 0 ? parts?.join(' > ') : 'Current View';
    
    if (searchQuery) {
      breadcrumb += ` (Search: "${searchQuery}")`;
    }
    
    return breadcrumb;
  }

  if (scope === 'section') {
    const parts = [];
    
    if (taxonomyPath?.l1Id) {
      const l1 = getTaxonomyL1ById(taxonomyPath?.l1Id);
      parts?.push(l1?.name || 'Unknown');
    }
    
    if (taxonomyPath?.l2Id) {
      const l2 = getTaxonomyL2ById(taxonomyPath?.l2Id);
      parts?.push(l2?.name || 'Unknown');
    }
    
    if (taxonomyPath?.l3Id) {
      const l3 = getTaxonomyL3ById(taxonomyPath?.l3Id);
      parts?.push(l3?.name || 'Unknown');
    }
    
    if (taxonomyPath?.l4Id) {
      const l4 = getTaxonomyL4ById(taxonomyPath?.l4Id);
      parts?.push(l4?.name || 'Unknown');
    }

    return parts?.length > 0 ? parts?.join(' > ') : 'Selected Section';
  }

  return 'Current View';
};

/**
 * Group items hierarchically based on export scope
 * L4 (Type): Single breadcrumb header + items
 * L3 (Sub-Category): Single breadcrumb header + TYPE subheaders + items
 * L1/L2/Entire: Logical section boundaries with breadcrumb headers
 */
const groupItemsByTaxonomyHierarchical = (items, scope, taxonomyPath) => {
  const groups = [];

  // CASE A: L4 export (Type level) - Single breadcrumb, then items
  if (scope === 'current' && taxonomyPath?.l4Id) {
    let breadcrumb = buildBreadcrumbPath(taxonomyPath?.l1Id, taxonomyPath?.l2Id, taxonomyPath?.l3Id, taxonomyPath?.l4Id);
    groups?.push({
      breadcrumb,
      items,
      typeGroups: null
    });
    return groups;
  }

  // CASE B: L3 export (Sub-Category level) - Single breadcrumb, then group by TYPE
  if (scope === 'current' && taxonomyPath?.l3Id && !taxonomyPath?.l4Id) {
    let breadcrumb = buildBreadcrumbPath(taxonomyPath?.l1Id, taxonomyPath?.l2Id, taxonomyPath?.l3Id, null);
    const typeGroups = groupItemsByType(items);
    groups?.push({
      breadcrumb,
      items: [],
      typeGroups
    });
    return groups;
  }

  // CASE C: L2 export (Category level) - Group by L3, then by TYPE
  if (scope === 'current' && taxonomyPath?.l2Id && !taxonomyPath?.l3Id) {
    const l3Groups = {};

    items?.forEach(item => {
      const l3Id = item?.l3Id || 'no-l3';
      if (!l3Groups?.[l3Id]) {
        l3Groups[l3Id] = [];
      }
      l3Groups?.[l3Id]?.push(item);
    });

    Object?.keys(l3Groups)?.forEach(l3Id => {
      const l3Items = l3Groups?.[l3Id];
      let breadcrumb = buildBreadcrumbPath(taxonomyPath?.l1Id, taxonomyPath?.l2Id, l3Id !== 'no-l3' ? l3Id : null, null);
      const typeGroups = groupItemsByType(l3Items);
      groups?.push({
        breadcrumb,
        items: [],
        typeGroups
      });
    });

    return groups;
  }

  // CASE D: L1 export or Entire inventory - Group by L2 → L3 → TYPE
  if (scope === 'entire' || (scope === 'current' && taxonomyPath?.l1Id && !taxonomyPath?.l2Id)) {
    const l2Groups = {};

    items?.forEach(item => {
      const l2Id = item?.l2Id || 'no-l2';
      if (!l2Groups?.[l2Id]) {
        l2Groups[l2Id] = [];
      }
      l2Groups?.[l2Id]?.push(item);
    });

    Object?.keys(l2Groups)?.forEach(l2Id => {
      const l2Items = l2Groups?.[l2Id];
      
      // Further group by L3
      const l3Groups = {};
      l2Items?.forEach(item => {
        const l3Id = item?.l3Id || 'no-l3';
        if (!l3Groups?.[l3Id]) {
          l3Groups[l3Id] = [];
        }
        l3Groups?.[l3Id]?.push(item);
      });

      Object?.keys(l3Groups)?.forEach(l3Id => {
        const l3Items = l3Groups?.[l3Id];
        const l1Id = l3Items?.[0]?.l1Id || taxonomyPath?.l1Id;
        let breadcrumb = buildBreadcrumbPath(l1Id, l2Id !== 'no-l2' ? l2Id : null, l3Id !== 'no-l3' ? l3Id : null, null);
        const typeGroups = groupItemsByType(l3Items);
        groups?.push({
          breadcrumb,
          items: [],
          typeGroups
        });
      });
    });

    return groups;
  }

  // CASE E: Section export with specific path
  if (scope === 'section') {
    // Similar logic to current view
    if (taxonomyPath?.l4Id) {
      let breadcrumb = buildBreadcrumbPath(taxonomyPath?.l1Id, taxonomyPath?.l2Id, taxonomyPath?.l3Id, taxonomyPath?.l4Id);
      groups?.push({
        breadcrumb,
        items,
        typeGroups: null
      });
    } else if (taxonomyPath?.l3Id) {
      let breadcrumb = buildBreadcrumbPath(taxonomyPath?.l1Id, taxonomyPath?.l2Id, taxonomyPath?.l3Id, null);
      const typeGroups = groupItemsByType(items);
      groups?.push({
        breadcrumb,
        items: [],
        typeGroups
      });
    } else {
      // L2 or L1 section export
      return groupItemsByTaxonomyHierarchical(items, 'current', taxonomyPath);
    }
    return groups;
  }

  // Fallback: single group
  groups?.push({
    breadcrumb: null,
    items,
    typeGroups: null
  });
  return groups;
};

/**
 * Build breadcrumb path string
 */
const buildBreadcrumbPath = (l1Id, l2Id, l3Id, l4Id) => {
  const parts = [];

  if (l1Id) {
    const l1 = getTaxonomyL1ById(l1Id);
    parts?.push(l1?.name || 'Unknown');
  }

  if (l2Id) {
    const l2 = getTaxonomyL2ById(l2Id);
    parts?.push(l2?.name || 'Unknown');
  }

  if (l3Id) {
    const l3 = getTaxonomyL3ById(l3Id);
    parts?.push(l3?.name || 'Unknown');
  }

  if (l4Id) {
    const l4 = getTaxonomyL4ById(l4Id);
    parts?.push(l4?.name || 'Unknown');
  }

  return parts?.join(' > ');
};

/**
 * Group items by TYPE (L4)
 * Returns array of {typeHeader, items}
 */
const groupItemsByType = (items) => {
  const typeGroups = {};

  items?.forEach(item => {
    const l4Id = item?.l4Id || 'no-type';
    if (!typeGroups?.[l4Id]) {
      typeGroups[l4Id] = [];
    }
    typeGroups?.[l4Id]?.push(item);
  });

  return Object?.keys(typeGroups)?.map(l4Id => {
    const typeItems = typeGroups?.[l4Id];
    let typeHeader = 'TYPE: General';

    if (l4Id !== 'no-type') {
      const l4 = getTaxonomyL4ById(l4Id);
      typeHeader = `TYPE: ${l4?.name || 'Unknown'}`;
    }

    return {
      typeHeader,
      items: typeItems
    };
  });
};

/**
 * Render a single item row using 3-line format
 * LINE 1: Item Name | Brand | Size | Locations: Bar (6), Pantry (4)    Total Qty: 12
 * LINE 2: Unit Cost x Total Onboard = Total Value (if cost enabled and set)
 * LINE 3: Notes: <text> (if notes exist)
 * Returns the height used
 */
const renderItemRow = async (doc, item, yPosition, margin, contentWidth, includeImages, includeCost, pageWidth, pageHeight) => {
  const rowStartY = yPosition;
  
  // Calculate total quantity
  const totalQty = item?.stockLocations?.reduce((sum, loc) => sum + (loc?.qty || 0), 0) || item?.totalQty || 0;

  // ENGINE-SAFE LAYOUT: Manual positioning
  const thumbnailWidth = 18; // 18mm container for image
  const imageSize = 16; // 16mm image
  const gapAfterImage = 5; // 5mm gap
  const totalColWidth = 25; // Fixed width for "Total Qty: XX" right-aligned
  
  let textStartX = margin;
  let currentY = yPosition;
  
  // Draw image if enabled (left side, top-aligned)
  let imageData = null;
  if (includeImages) {
    const photoSrc = item?.photo?.dataUrl || (typeof item?.photo === 'string' ? item?.photo : null) || item?.imageUrl || null;
    
    if (photoSrc) {
      try {
        imageData = photoSrc;
      } catch (error) {
        imageData = null;
      }
    }
    
    // Draw image or placeholder at exact Y position (top-aligned)
    const imageX = margin + 1; // 1mm padding from left
    const imageY = currentY; // Top-aligned with text
    
    if (imageData) {
      try {
        doc?.addImage(imageData, 'JPEG', imageX, imageY, imageSize, imageSize, undefined, 'MEDIUM');
      } catch (error) {
        // Draw placeholder if image fails
        doc?.setDrawColor(200, 200, 200);
        doc?.setFillColor(245, 245, 245);
        doc?.rect(imageX, imageY, imageSize, imageSize, 'FD');
      }
    } else {
      // Draw placeholder box
      doc?.setDrawColor(200, 200, 200);
      doc?.setFillColor(245, 245, 245);
      doc?.rect(imageX, imageY, imageSize, imageSize, 'FD');
    }
    
    textStartX = margin + thumbnailWidth + gapAfterImage;
  }
  
  // Calculate text area width (leave space for right-aligned total)
  const textAreaWidth = (pageWidth - margin) - textStartX - totalColWidth - 5;
  
  // === LINE 1: Item details ===
  // Build line 1: Item Name | Brand | Size | Locations: Bar (6), Pantry (4)
  let line1Parts = [];
  
  if (item?.name) {
    line1Parts?.push(item?.name);
  }
  
  if (item?.brand) {
    line1Parts?.push(item?.brand);
  }
  
  if (item?.size) {
    line1Parts?.push(item?.size);
  }

  // Build locations string with names AND quantities
  const locationsStr = buildLocationsString(item?.stockLocations || []);
  if (locationsStr) {
    line1Parts?.push(locationsStr);
  }

  const line1Text = line1Parts?.join(' | ');
  
  // Draw Line 1 (bold, top-aligned with image)
  doc?.setFontSize(9);
  doc?.setFont('helvetica', 'bold');
  doc?.setTextColor(0, 0, 0);
  
  // Split text if too long
  const line1Lines = doc?.splitTextToSize(line1Text, textAreaWidth);
  const line1Y = currentY + 3.5; // Baseline offset for text
  
  line1Lines?.forEach((line, index) => {
    doc?.text(line, textStartX, line1Y + (index * 4));
  });
  
  // Draw right-aligned "Total Qty: XX" on same line as first line of text
  doc?.setFontSize(9);
  doc?.setFont('helvetica', 'bold');
  doc?.setTextColor(0, 0, 0);
  
  const totalText = `Total Qty: ${totalQty}`;
  const totalWidth = doc?.getTextWidth(totalText);
  const totalX = pageWidth - margin - totalWidth;
  
  doc?.text(totalText, totalX, line1Y);
  
  // Update Y position after line 1
  currentY += (line1Lines?.length * 4) + 1;
  
  // === LINE 2: Cost equation (if includeCost is enabled) ===
  if (includeCost && canViewCost()) {
    doc?.setFontSize(8);
    doc?.setFont('helvetica', 'normal');
    doc?.setTextColor(60, 60, 60);
    
    let costLine = '';
    
    if (item?.unitCost && item?.unitCost > 0) {
      const currency = item?.currency || 'USD';
      const symbol = getCurrencySymbol(currency);
      const unitCostFormatted = `${symbol}${parseFloat(item?.unitCost)?.toFixed(2)}`;
      const totalValue = item?.unitCost * totalQty;
      const totalValueFormatted = `${symbol}${totalValue?.toFixed(2)}`;
      
      costLine = `${unitCostFormatted} x ${totalQty} = ${totalValueFormatted}`;
    } else {
      costLine = 'Unit Cost not set';
    }
    
    const costY = currentY + 3;
    doc?.text(costLine, textStartX, costY);
    
    currentY += 4;
  }
  
  // === LINE 3: Notes (if exists) ===
  if (item?.notes) {
    doc?.setFontSize(8);
    doc?.setFont('helvetica', 'normal');
    doc?.setTextColor(100, 100, 100);
    
    const notesText = `Notes: ${item?.notes}`;
    const notesLines = doc?.splitTextToSize(notesText, textAreaWidth);
    const notesY = currentY + 3;
    
    notesLines?.forEach((line, index) => {
      doc?.text(line, textStartX, notesY + (index * 3.5));
    });
    
    currentY += (notesLines?.length * 3.5) + 1;
  }

  // === LINE 4: Custom fields (colour, batch_no, etc.) ===
  const customFields = item?.customFields || item?.custom_fields || {};
  const customFieldEntries = Object.entries(customFields)?.filter(([, v]) => v != null && String(v)?.trim());
  if (customFieldEntries?.length > 0) {
    doc?.setFontSize(8);
    doc?.setFont('helvetica', 'normal');
    doc?.setTextColor(100, 100, 100);

    const cfText = customFieldEntries
      ?.map(([k, v]) => `${k?.replace(/_/g, ' ')?.replace(/\b\w/g, c => c?.toUpperCase())}: ${v}`)
      ?.join('  |  ');
    const cfLines = doc?.splitTextToSize(cfText, textAreaWidth);
    const cfY = currentY + 3;

    cfLines?.forEach((line, index) => {
      doc?.text(line, textStartX, cfY + (index * 3.5));
    });

    currentY += (cfLines?.length * 3.5) + 1;
  }

  // Ensure minimum row height matches image height when images are included
  if (includeImages) {
    const minRowHeight = imageSize + 2; // Image height + 2mm padding
    const currentRowHeight = currentY - rowStartY;
    if (currentRowHeight < minRowHeight) {
      currentY = rowStartY + minRowHeight;
    }
  }
  
  // Add separator line
  currentY += 2;
  doc?.setDrawColor(230, 230, 230);
  doc?.setLineWidth(0.2);
  doc?.line(margin, currentY, pageWidth - margin, currentY);
  
  currentY += 2;
  
  const totalHeight = currentY - rowStartY;
  return totalHeight;
};

/**
 * Build locations string with names AND quantities
 * Format: "Locations: Bar (6), Pantry (4), Bonded (2)"
 */
const buildLocationsString = (stockLocations) => {
  if (!stockLocations || stockLocations?.length === 0) {
    return '';
  }

  const locationParts = stockLocations?.map(loc => {
    const name = loc?.locationName || 'Unknown';
    const qty = loc?.qty || 0;
    return `${name} (${qty})`;
  });

  return `Locations: ${locationParts?.join(', ')}`;
};

/**
 * Add footer to page
 */
const addFooter = (doc, pageWidth, pageHeight, margin) => {
  const footerY = pageHeight - 10;

  doc?.setFontSize(8);
  doc?.setFont('helvetica', 'normal');
  doc?.setTextColor(120, 120, 120);

  // Left: "Generated by Cargo"
  doc?.text('Generated by Cargo', margin, footerY);

  // Center: Date
  const dateStr = new Date()?.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const centerX = pageWidth / 2;
  const dateWidth = doc?.getTextWidth(dateStr);
  doc?.text(dateStr, centerX - (dateWidth / 2), footerY);

  // Right: Page number
  const pageNum = doc?.internal?.getCurrentPageInfo()?.pageNumber;
  const totalPages = doc?.internal?.getNumberOfPages();
  const pageText = `Page ${pageNum} of ${totalPages}`;
  const pageTextWidth = doc?.getTextWidth(pageText);
  doc?.text(pageText, pageWidth - margin - pageTextWidth, footerY);
};

/**
 * Add cost totals footer to last page
 * Shows aggregate totals for exported scope only
 */
const addCostTotalsFooter = (doc, items, pageWidth, pageHeight, margin) => {
  // Calculate totals for exported items only
  const totalInventoryData = calculateTotalInventoryValue(items);
  const replenishmentData = calculateReplenishmentValue(items);
  
  // Only show if we have cost data
  if (!totalInventoryData || totalInventoryData?.itemCount === 0) {
    return;
  }
  
  const footerStartY = pageHeight - 35; // Position above standard footer
  
  // Draw separator line
  doc?.setDrawColor(200, 200, 200);
  doc?.setLineWidth(0.5);
  doc?.line(margin, footerStartY, pageWidth - margin, footerStartY);
  
  // Title
  doc?.setFontSize(9);
  doc?.setFont('helvetica', 'bold');
  doc?.setTextColor(40, 40, 40);
  doc?.text('Cost Summary (Exported Items)', margin, footerStartY + 6);
  
  // Total Inventory Value
  doc?.setFontSize(8);
  doc?.setFont('helvetica', 'normal');
  doc?.setTextColor(60, 60, 60);
  doc?.text('Total Inventory Value:', margin, footerStartY + 12);
  
  doc?.setFont('helvetica', 'bold');
  doc?.setTextColor(0, 0, 0);
  const totalValueText = `${getCurrencySymbol(totalInventoryData?.currency)}${totalInventoryData?.totalValue?.toFixed(2)}`;
  const totalValueWidth = doc?.getTextWidth(totalValueText);
  doc?.text(totalValueText, pageWidth - margin - totalValueWidth, footerStartY + 12);
  
  // Cost to Replenish (if applicable)
  if (replenishmentData && replenishmentData?.itemCount > 0) {
    doc?.setFont('helvetica', 'normal');
    doc?.setTextColor(60, 60, 60);
    doc?.text('Cost to Replenish:', margin, footerStartY + 18);
    
    doc?.setFont('helvetica', 'bold');
    doc?.setTextColor(0, 0, 0);
    const replenishText = `${getCurrencySymbol(replenishmentData?.currency)}${replenishmentData?.totalValue?.toFixed(2)}`;
    const replenishWidth = doc?.getTextWidth(replenishText);
    doc?.text(replenishText, pageWidth - margin - replenishWidth, footerStartY + 18);
  }
};
