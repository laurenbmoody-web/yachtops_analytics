import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

/** Extract last path segment from a location string */
const lastSegment = (str) => {
  if (!str) return '';
  const parts = str?.split(/[›>\/\\|]/)?.map(s => s?.trim())?.filter(Boolean);
  return parts?.[parts?.length - 1] || str;
};

/** Format stock locations as "Location: qty | Location: qty" */
const formatLocations = (item) => {
  const locs = item?.stockLocations || [];
  if (!locs?.length) return '';
  return locs?.map(loc => {
    const name = lastSegment(loc?.locationName || loc?.location_name || loc?.location || loc?.name || '');
    return `${name}: ${loc?.qty ?? 0}`;
  })?.join(' | ');
};

/** Get total quantity */
const getTotalQty = (item) => {
  const locs = item?.stockLocations || [];
  if (locs?.length > 0) return locs?.reduce((sum, l) => sum + (l?.qty || 0), 0);
  return item?.quantity ?? item?.totalQty ?? 0;
};

/** Get folder label for item */
const getFolderLabel = (item) => {
  const parts = [item?.location, item?.subLocation]?.filter(Boolean);
  return parts?.map(p => lastSegment(p))?.join(' › ') || '';
};

/**
 * Fetch an image URL and return a base64 data URL via an off-screen canvas.
 */
const fetchImageAsBase64 = (url) => {
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url.includes('?') ? url : `${url}?_cb=${Date.now()}`;
  });
};

/**
 * Collect all unique custom field keys across a list of items.
 * Returns an array of raw keys (e.g. ['colour', 'bag_name', 'batch_no', 'category']).
 */
const collectCustomFieldKeys = (items) => {
  const keySet = new Set();
  (items || [])?.forEach(item => {
    const cf = item?.customFields || item?.custom_fields || {};
    Object.keys(cf)?.forEach(k => {
      if (cf?.[k] != null && String(cf?.[k])?.trim()) keySet?.add(k);
    });
  });
  return Array.from(keySet);
};

/**
 * Format a raw custom field key into a human-readable column header.
 * e.g. 'bag_name' → 'Bag Name'
 */
const formatCfKey = (key) =>
  key?.replace(/_/g, ' ')?.replace(/\b\w/g, c => c?.toUpperCase());

/**
 * Base column definitions — fixed columns that always appear first.
 * Locations (qty), Qty, and Used are NOT included here; they are appended
 * as the absolute last columns after any custom fields.
 */
const BASE_COLUMNS = [
  'Cargo ID', 'Name', 'Brand', 'Supplier', 'Folder',
  'Unit', 'Restock', 'Expiry', 'Barcode',
  'Cost', 'Tags', 'Notes', 'Year', 'Tasting Notes',
];

// Tail columns — always last, in this order
const TAIL_COLUMNS = ['Locations (qty)', 'Qty'];

/**
 * Strip OCR/checkbox artefacts like ":selected:" and ":unselected:" from a cell value.
 * Also trims surrounding whitespace left behind.
 */
const sanitizeCell = (value) => {
  if (value == null) return '';
  return String(value)?.replace(/:selected:/gi, '')?.replace(/:unselected:/gi, '')?.replace(/\s{2,}/g, ' ')?.trim();
};

/** Build row data for an item. Image placeholder is prepended when includeImages=true.
 *  customFieldKeys is the ordered list of CF keys to include as dedicated columns.
 *  usedKeys is the list of "used" custom field keys that go in the tail. */
const buildRow = (item, includeImages, customFieldKeys, usedKeys) => {
  const cf = item?.customFields || item?.custom_fields || {};

  const dataRow = [
    sanitizeCell(item?.cargoItemId || item?.cargo_item_id || ''),
    sanitizeCell(item?.name || ''),
    sanitizeCell(item?.brand || ''),
    sanitizeCell(item?.supplier || ''),
    sanitizeCell(getFolderLabel(item)),
    sanitizeCell(item?.unit || ''),
    sanitizeCell(item?.restockLevel != null ? String(item?.restockLevel) : ''),
    sanitizeCell(item?.expiryDate || ''),
    sanitizeCell(item?.barcode || ''),
    sanitizeCell(item?.unitCost != null ? `$${item?.unitCost}` : ''),
    sanitizeCell((item?.tags || [])?.join(', ')),
    sanitizeCell(item?.notes || ''),
    sanitizeCell(item?.vintageYear || item?.vintage_year || item?.year || ''),
    sanitizeCell(item?.tastingNotes || ''),
    // Custom field values (non-used) — before tail
    ...(customFieldKeys || [])?.map(k => sanitizeCell(cf?.[k] != null ? String(cf?.[k]) : '')),
    // Tail: Locations (qty), Qty
    sanitizeCell(formatLocations(item) || String(getTotalQty(item))),
    sanitizeCell(String(getTotalQty(item))),
    // Used custom field values — absolute last
    ...(usedKeys || [])?.map(k => sanitizeCell(cf?.[k] != null ? String(cf?.[k]) : '')),
  ];

  if (includeImages) return ['', ...dataRow]; // empty placeholder; image drawn via didDrawCell
  return dataRow;
};

/**
 * exportInventoryToPDF
 */
export const exportInventoryToPDF = async ({
  items,
  scope,
  folderPath,
  includeImages,
  allFoldersMeta,
  selectedFoldersMeta,
}) => {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  const primaryColor = [30, 58, 95];
  const accentColor = [180, 150, 100];
  const lightGray = [245, 245, 245];
  const borderGray = [220, 220, 220];
  const folderHeaderBg = [235, 240, 248];

  const pageWidth = doc?.internal?.pageSize?.getWidth();
  const pageHeight = doc?.internal?.pageSize?.getHeight();
  const margin = 14;

  // ── Collect all custom field keys across every item being exported ───────
  const allExportItemsForCf = (() => {
    if (scope === 'entire' && allFoldersMeta?.length > 0) {
      return allFoldersMeta?.flatMap(f => f?.items || []);
    } else if (scope === 'selected' && selectedFoldersMeta?.length > 0) {
      return selectedFoldersMeta?.flatMap(f => f?.items || []);
    }
    return items || [];
  })();
  const allCustomFieldKeys = collectCustomFieldKeys(allExportItemsForCf);

  // Separate "used" keys from other custom field keys
  const USED_KEYS_LOWER = ['used', 'used_quantity', 'usedqty', 'used qty', 'used_qty'];
  const usedKeys = allCustomFieldKeys?.filter(k =>
    USED_KEYS_LOWER?.includes(k?.toLowerCase()?.replace(/\s/g, '_'))
  );
  const customFieldKeys = allCustomFieldKeys?.filter(k =>
    !USED_KEYS_LOWER?.includes(k?.toLowerCase()?.replace(/\s/g, '_'))
  );

  // ── Pre-fetch images if needed ───────────────────────────────────────────
  const imageCache = {};
  if (includeImages) {
    const uniqueUrls = [...new Set(allExportItemsForCf?.map(i => i?.imageUrl)?.filter(Boolean))];
    await Promise.all(
      uniqueUrls?.map(async (url) => {
        const b64 = await fetchImageAsBase64(url);
        if (b64) imageCache[url] = b64;
      })
    );
  }

  // Scope label
  const scopeLabel = scope === 'entire' ? 'Entire Inventory'
    : scope === 'folder' ? `Current Folder: ${folderPath || 'Root'}`
    : 'Selected Items';

  // ── Header ──────────────────────────────────────────────────────────────
  doc?.setFillColor(...primaryColor);
  doc?.rect(0, 0, pageWidth, 22, 'F');

  doc?.setTextColor(255, 255, 255);
  doc?.setFontSize(16);
  doc?.setFont('helvetica', 'bold');
  doc?.text('INVENTORY EXPORT', margin, 14);

  doc?.setFontSize(9);
  doc?.setFont('helvetica', 'normal');
  doc?.setTextColor(200, 210, 230);
  doc?.text(scopeLabel, pageWidth - margin, 10, { align: 'right' });

  const now = new Date();
  const dateStr = now?.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const timeStr = now?.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  doc?.text(`Exported: ${dateStr} at ${timeStr}`, pageWidth - margin, 16, { align: 'right' });

  // ── Sub-header ───────────────────────────────────────────────────────────
  let yPos = 28;
  doc?.setTextColor(...primaryColor);
  doc?.setFontSize(9);
  doc?.setFont('helvetica', 'normal');

  if (scope === 'folder' && folderPath) {
    doc?.text(`Folder: ${folderPath}`, margin, yPos);
    yPos += 5;
  }
  doc?.text(`Total items: ${(items || [])?.length}`, margin, yPos);
  yPos += 6;

  doc?.setDrawColor(...accentColor);
  doc?.setLineWidth(0.5);
  doc?.line(margin, yPos, pageWidth - margin, yPos);
  yPos += 4;

  // ── Build column headers ─────────────────────────────────────────────────
  // Order: BASE_COLUMNS → custom fields (non-used) → TAIL_COLUMNS → used fields
  const cfColumnHeaders = customFieldKeys?.map(formatCfKey);
  const usedColumnHeaders = usedKeys?.map(formatCfKey);
  const allDataColumns = [...BASE_COLUMNS, ...cfColumnHeaders, ...TAIL_COLUMNS, ...usedColumnHeaders];

  // Image column is FIRST when includeImages is true
  const columns = includeImages ? ['Image', ...allDataColumns] : [...allDataColumns];

  // ── Render a table for a group of items ─────────────────────────────────
  const renderTable = (tableItems, startY) => {
    if (tableItems?.length === 0) return startY;
    const body = tableItems?.map(item => buildRow(item, includeImages, customFieldKeys, usedKeys));
    const rowImageUrls = tableItems?.map(item => item?.imageUrl || null);

    /**
     * Column width strategy (landscape A4 = 297mm, margins 14mm each side → 269mm usable):
     * Base columns are scaled proportionally; custom field columns each get a fixed 14mm.
     */
    const usableWidth = pageWidth - margin * 2; // 269mm
    const cfColWidth = 14; // fixed width per custom field column
    const totalCfWidth = (customFieldKeys?.length + usedKeys?.length) * cfColWidth;

    const colStyles = {};

    if (includeImages) {
      const imageColWidth = 14;
      const dataWidth = usableWidth - imageColWidth - totalCfWidth;

      colStyles[0] = { cellWidth: imageColWidth, halign: 'center' };

      const baseDataWidths = [14, 24, 16, 14, 14, 7, 12, 16, 14, 8, 12, 16, 7, 16, 16, 7];
      const baseDataTotal = baseDataWidths?.reduce((a, b) => a + b, 0);
      const scale = dataWidth / baseDataTotal;

      baseDataWidths?.forEach((w, i) => {
        colStyles[i + 1] = { cellWidth: Math.round(w * scale * 10) / 10 };
      });

      // Bold the Name column (index 2 when image present: 0=image, 1=cargoId, 2=name)
      colStyles[2] = { ...colStyles?.[2], fontStyle: 'bold' };

      // Custom field columns (non-used) — after base data columns
      customFieldKeys?.forEach((_, i) => {
        colStyles[1 + baseDataWidths.length + i] = { cellWidth: cfColWidth };
      });

      // Used custom field columns — after tail columns
      const tailOffset = 1 + baseDataWidths?.length + customFieldKeys?.length + TAIL_COLUMNS?.length;
      usedKeys?.forEach((_, i) => {
        colStyles[tailOffset + i] = { cellWidth: cfColWidth };
      });
    } else {
      const dataWidth = usableWidth - totalCfWidth;
      const baseDataWidths = [14, 24, 16, 14, 14, 7, 12, 16, 14, 8, 12, 16, 7, 16, 16, 7];
      const baseDataTotal = baseDataWidths?.reduce((a, b) => a + b, 0);
      const scale = dataWidth / baseDataTotal;

      baseDataWidths?.forEach((w, i) => {
        colStyles[i] = { cellWidth: Math.round(w * scale * 10) / 10 };
      });

      // Bold the Name column (index 1 when no image: 0=cargoId, 1=name)
      colStyles[1] = { ...colStyles?.[1], fontStyle: 'bold' };

      // Custom field columns (non-used) — after base data columns
      customFieldKeys?.forEach((_, i) => {
        colStyles[baseDataWidths.length + i] = { cellWidth: cfColWidth };
      });

      // Used custom field columns — after tail columns
      const tailOffset = baseDataWidths?.length + customFieldKeys?.length + TAIL_COLUMNS?.length;
      usedKeys?.forEach((_, i) => {
        colStyles[tailOffset + i] = { cellWidth: cfColWidth };
      });
    }

    autoTable(doc, {
      startY,
      head: [columns],
      body,
      margin: { left: margin, right: margin },
      tableWidth: usableWidth,
      styles: {
        fontSize: 6,
        cellPadding: { top: 1, right: 1, bottom: 1, left: 1 },
        overflow: 'linebreak',
        valign: 'middle',
        textColor: [40, 40, 40],
        minCellHeight: includeImages ? 16 : 6,
      },
      headStyles: {
        fillColor: primaryColor,
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 6,
        overflow: 'linebreak',
        minCellHeight: 10,
        cellPadding: { top: 1.5, right: 1, bottom: 1.5, left: 1 },
      },
      alternateRowStyles: {
        fillColor: lightGray,
      },
      columnStyles: colStyles,
      didDrawCell: (data) => {
        if (!includeImages) return;
        if (data?.section !== 'body') return;
        if (data?.column?.index !== 0) return; // image is always col 0

        const rowIndex = data?.row?.index;
        const imageUrl = rowImageUrls?.[rowIndex];
        if (!imageUrl) return;

        const b64 = imageCache?.[imageUrl];
        if (!b64) return;

        try {
          const cellX = data?.cell?.x;
          const cellY = data?.cell?.y;
          const cellW = data?.cell?.width;
          const cellH = data?.cell?.height;

          // 12x12mm thumbnail centred in cell
          const thumbSize = 12;
          const imgX = cellX + (cellW - thumbSize) / 2;
          const imgY = cellY + (cellH - thumbSize) / 2;

          doc?.addImage(b64, 'JPEG', imgX, imgY, thumbSize, thumbSize);
        } catch {
          // silently skip
        }
      },
      didDrawPage: () => {
        doc?.setFontSize(7);
        doc?.setTextColor(160, 160, 160);
        doc?.text(
          `Page ${doc?.internal?.getCurrentPageInfo()?.pageNumber}`,
          pageWidth / 2,
          pageHeight - 6,
          { align: 'center' }
        );
        doc?.text('Cargo — Inventory Export', margin, pageHeight - 6);
      },
    });

    return doc?.lastAutoTable?.finalY ?? startY;
  };

  // ── Draw a folder section header ─────────────────────────────────────────
  const drawFolderHeader = (folderName, itemCount, currentY) => {
    if (currentY > pageHeight - 30) {
      doc?.addPage();
      currentY = 14;
    }

    doc?.setFillColor(...folderHeaderBg);
    doc?.rect(margin, currentY, pageWidth - margin * 2, 8, 'F');
    doc?.setDrawColor(...borderGray);
    doc?.rect(margin, currentY, pageWidth - margin * 2, 8, 'S');

    doc?.setFillColor(...accentColor);
    doc?.rect(margin, currentY, 3, 8, 'F');

    doc?.setTextColor(...primaryColor);
    doc?.setFontSize(9);
    doc?.setFont('helvetica', 'bold');
    doc?.text(folderName, margin + 6, currentY + 5.5);

    const countLabel = `${itemCount} item${itemCount !== 1 ? 's' : ''}`;
    doc?.setFontSize(8);
    doc?.setFont('helvetica', 'normal');
    doc?.setTextColor(100, 100, 120);
    doc?.text(countLabel, pageWidth - margin - 2, currentY + 5.5, { align: 'right' });

    return currentY + 10;
  };

  // ── Draw totals / summary bar ────────────────────────────────────────────
  const drawTotalsLine = (allItems, currentY, label = 'TOTALS', isSummary = false) => {
    if (currentY > pageHeight - 20) {
      doc?.addPage();
      currentY = 14;
    }

    const totalQty = (allItems || [])?.reduce((sum, item) => sum + getTotalQty(item), 0);
    const totalItems = (allItems || [])?.length;

    currentY += 4;
    doc?.setDrawColor(...accentColor);
    doc?.setLineWidth(0.5);
    doc?.line(margin, currentY, pageWidth - margin, currentY);
    currentY += 2;

    const bgColor = isSummary ? primaryColor : [50, 80, 120];
    doc?.setFillColor(...bgColor);
    doc?.rect(margin, currentY, pageWidth - margin * 2, 9, 'F');

    doc?.setFillColor(...accentColor);
    doc?.rect(margin, currentY, 3, 9, 'F');

    doc?.setTextColor(255, 255, 255);
    doc?.setFontSize(9);
    doc?.setFont('helvetica', 'bold');
    doc?.text(label, margin + 6, currentY + 6);

    doc?.setFontSize(8);
    doc?.setFont('helvetica', 'normal');
    doc?.text(`${totalItems} item${totalItems !== 1 ? 's' : ''}`, pageWidth - margin - 60, currentY + 6);
    doc?.text(`Total Qty: ${totalQty}`, pageWidth - margin - 2, currentY + 6, { align: 'right' });

    return currentY + 11;
  };

  // ── Render grouped sections ──────────────────────────────────────────────
  const renderGroupedSections = (foldersMeta, currentY) => {
    for (let i = 0; i < foldersMeta?.length; i++) {
      const folder = foldersMeta?.[i];
      const folderItems = folder?.items || [];

      currentY = drawFolderHeader(folder?.label || folder?.fullPath, folderItems?.length, currentY);

      if (folderItems?.length === 0) {
        doc?.setFontSize(7);
        doc?.setFont('helvetica', 'italic');
        doc?.setTextColor(160, 160, 160);
        doc?.text('No items in this folder', margin + 6, currentY + 4);
        currentY += 8;
      } else {
        currentY = renderTable(folderItems, currentY) + 2;
        currentY += 4;
      }

      if (i < foldersMeta?.length - 1 && currentY > pageHeight - 40) {
        doc?.addPage();
        currentY = 14;
      }
    }
    return currentY;
  };

  const drawOverallSummary = (foldersMeta, currentY) => {
    const allItems = foldersMeta?.flatMap(f => f?.items || []);
    return drawTotalsLine(allItems, currentY, 'OVERALL SUMMARY', true);
  };

  // ── Dispatch by scope ────────────────────────────────────────────────────
  if (scope === 'entire' && allFoldersMeta && allFoldersMeta?.length > 0) {
    let finalY = renderGroupedSections(allFoldersMeta, yPos);
    drawOverallSummary(allFoldersMeta, finalY);
  } else if (scope === 'selected' && selectedFoldersMeta && selectedFoldersMeta?.length > 0) {
    let finalY = renderGroupedSections(selectedFoldersMeta, yPos);
    drawOverallSummary(selectedFoldersMeta, finalY);
  } else if (scope === 'entire' && (!allFoldersMeta || allFoldersMeta?.length === 0)) {
    const groups = {};
    (items || [])?.forEach(item => {
      const folder = item?.location || 'Uncategorised';
      if (!groups?.[folder]) groups[folder] = [];
      groups?.[folder]?.push(item);
    });

    let currentY = yPos;
    const folderNames = Object.keys(groups)?.sort();

    for (let i = 0; i < folderNames?.length; i++) {
      const folderName = folderNames?.[i];
      const groupItems = groups?.[folderName];
      currentY = drawFolderHeader(folderName, groupItems?.length, currentY);
      currentY = renderTable(groupItems, currentY) + 2;
      currentY += 4;

      if (i < folderNames?.length - 1 && currentY > pageHeight - 40) {
        doc?.addPage();
        currentY = 14;
      }
    }
    drawTotalsLine(items || [], currentY, 'OVERALL SUMMARY', true);
  } else {
    let finalY = renderTable(items || [], yPos);
    drawTotalsLine(items || [], finalY, 'TOTALS', true);
  }

  // ── Save ─────────────────────────────────────────────────────────────────
  const filename = `inventory-export-${now?.toISOString()?.slice(0, 10)}.pdf`;
  doc?.save(filename);
};
