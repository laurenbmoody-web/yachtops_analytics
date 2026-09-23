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
 * A compact, readable column set. Rather than one narrow column per attribute
 * (which crushed a dozen custom fields into unreadable vertical single letters),
 * every secondary attribute is consolidated into a single wide "Details" column,
 * and per-size stock gets its own "Sizes" column. This keeps ~8 wide columns on
 * landscape A4 instead of 25+ slivers.
 */
const COLUMNS = ['Cargo ID', 'Name', 'Brand', 'Folder', 'Sizes', 'Details', 'Locations (qty)', 'Qty'];
// mm widths for the columns above, summing to the 269mm usable width (no image).
const COLUMN_WIDTHS = [20, 44, 26, 30, 34, 63, 34, 18];

/** Human label for a custom-field / attribute key. */
const formatAttrKey = (key) =>
  String(key || '')?.replace(/_/g, ' ')?.replace(/\b\w/g, (c) => c?.toUpperCase());

/** Per-size stock breakdown, e.g. "S ×2 · M ×4 · L ×2". Empty for non-variant items. */
const buildSizes = (item) => {
  const vars = Array.isArray(item?.variants) ? item?.variants : [];
  if (!vars?.length) return '';
  return vars
    ?.map((v) => {
      const label = String(v?.size || v?.label || '')?.trim();
      if (!label) return null;
      const qty = Number(v?.qty ?? v?.quantity ?? 0) || 0;
      return `${label} ×${qty}`;
    })
    ?.filter(Boolean)
    ?.join('  ·  ');
};

// Custom-field keys already surfaced elsewhere (Sizes column / size machinery),
// so they should not be repeated in Details.
const SIZE_LIKE_KEY = /(^|_)(format|formats|size|sizes|variant|variants)(_|$)/i;

/**
 * Everything worth knowing about an item, condensed into one "Key: value"
 * string wrapped across a wide column — colour, fit, supplier, cost, barcode,
 * expiry, notes, plus any custom fields (minus size-related ones).
 */
const buildDetails = (item) => {
  const cf = item?.customFields || item?.custom_fields || {};
  const parts = [];
  const push = (label, value) => {
    const v = sanitizeCell(value);
    if (v) parts?.push(`${label}: ${v}`);
  };

  // Colour first (comes from a dedicated column or a custom field).
  push('Colour', item?.color || cf?.colour || cf?.color);
  // Remaining custom fields (skip colour + size-related + "used", handled elsewhere).
  Object.keys(cf || {})?.forEach((k) => {
    const kl = k?.toLowerCase();
    if (kl === 'colour' || kl === 'color') return;
    if (SIZE_LIKE_KEY?.test(k)) return;
    if (['used', 'used_quantity', 'usedqty', 'used_qty']?.includes(kl?.replace(/\s/g, '_'))) return;
    push(formatAttrKey(k), cf?.[k]);
  });
  // Standard optional attributes.
  push('Supplier', item?.supplier);
  push('Unit', item?.unit);
  push('Cost', item?.unitCost != null && item?.unitCost !== '' ? `$${item?.unitCost}` : '');
  push('Barcode', item?.barcode);
  push('Expiry', item?.expiryDate);
  push('Restock', item?.restockLevel != null ? String(item?.restockLevel) : '');
  push('Vintage', item?.vintageYear || item?.vintage_year || item?.year);
  push('Tasting', item?.tastingNotes);
  push('Tags', (item?.tags || [])?.join(', '));
  push('Notes', item?.notes);
  return parts?.join('   ·   ');
};

/**
 * Strip OCR/checkbox artefacts like ":selected:" and ":unselected:" from a cell value.
 * Also trims surrounding whitespace left behind.
 */
const sanitizeCell = (value) => {
  if (value == null) return '';
  return String(value)?.replace(/:selected:/gi, '')?.replace(/:unselected:/gi, '')?.replace(/\s{2,}/g, ' ')?.trim();
};

/** Build row data for an item, matching COLUMNS. Image placeholder is prepended
 *  when includeImages=true. */
const buildRow = (item, includeImages) => {
  const dataRow = [
    sanitizeCell(item?.cargoItemId || item?.cargo_item_id || ''),
    sanitizeCell(item?.name || ''),
    sanitizeCell(item?.brand || ''),
    sanitizeCell(getFolderLabel(item)),
    buildSizes(item),
    buildDetails(item),
    sanitizeCell(formatLocations(item) || String(getTotalQty(item))),
    sanitizeCell(String(getTotalQty(item))),
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

  // Editorial palette — navy ink + terracotta accent (no warm gold/cream).
  const primaryColor = [28, 27, 58];    // #1C1B3A navy
  const accentColor = [198, 90, 26];    // #C65A1A terracotta
  const lightGray = [248, 250, 252];    // #F8FAFC cool alt row
  const borderGray = [229, 231, 235];   // #E5E7EB hairline
  const folderHeaderBg = [244, 245, 250]; // cool tint

  const pageWidth = doc?.internal?.pageSize?.getWidth();
  const pageHeight = doc?.internal?.pageSize?.getHeight();
  const margin = 14;

  // Items in scope (used for image pre-fetch).
  const allExportItems = (() => {
    if (scope === 'entire' && allFoldersMeta?.length > 0) {
      return allFoldersMeta?.flatMap(f => f?.items || []);
    } else if (scope === 'selected' && selectedFoldersMeta?.length > 0) {
      return selectedFoldersMeta?.flatMap(f => f?.items || []);
    }
    return items || [];
  })();

  // ── Pre-fetch images if needed ───────────────────────────────────────────
  const imageCache = {};
  if (includeImages) {
    const uniqueUrls = [...new Set(allExportItems?.map(i => i?.imageUrl)?.filter(Boolean))];
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
    : scope === 'view' ? (folderPath || 'Filtered items')
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
  } else if (scope === 'view' && folderPath) {
    doc?.text(`Location / filter: ${folderPath}`, margin, yPos);
    yPos += 5;
  }
  doc?.text(`Total items: ${(items || [])?.length}`, margin, yPos);
  yPos += 6;

  doc?.setDrawColor(...accentColor);
  doc?.setLineWidth(0.5);
  doc?.line(margin, yPos, pageWidth - margin, yPos);
  yPos += 4;

  // ── Column headers ───────────────────────────────────────────────────────
  // Image column is FIRST when includeImages is true.
  const columns = includeImages ? ['Image', ...COLUMNS] : [...COLUMNS];

  // ── Render a table for a group of items ─────────────────────────────────
  const renderTable = (tableItems, startY) => {
    if (tableItems?.length === 0) return startY;
    const body = tableItems?.map(item => buildRow(item, includeImages));
    const rowImageUrls = tableItems?.map(item => item?.imageUrl || null);

    // Fixed, readable column widths summing to the usable width. With images,
    // an 18mm thumbnail column is prepended and the rest scaled to fit.
    const usableWidth = pageWidth - margin * 2; // 269mm
    const colStyles = {};

    const qtyIdx = COLUMNS.indexOf('Qty');
    const nameIdx = COLUMNS.indexOf('Name');

    if (includeImages) {
      const imageColWidth = 18;
      const scale = (usableWidth - imageColWidth) / usableWidth;
      colStyles[0] = { cellWidth: imageColWidth, halign: 'center' };
      COLUMN_WIDTHS?.forEach((w, i) => {
        colStyles[i + 1] = { cellWidth: Math.round(w * scale * 10) / 10 };
      });
      colStyles[nameIdx + 1] = { ...colStyles?.[nameIdx + 1], fontStyle: 'bold' };
      colStyles[qtyIdx + 1] = { ...colStyles?.[qtyIdx + 1], halign: 'right', fontStyle: 'bold' };
    } else {
      COLUMN_WIDTHS?.forEach((w, i) => { colStyles[i] = { cellWidth: w }; });
      colStyles[nameIdx] = { ...colStyles?.[nameIdx], fontStyle: 'bold' };
      colStyles[qtyIdx] = { ...colStyles?.[qtyIdx], halign: 'right', fontStyle: 'bold' };
    }

    autoTable(doc, {
      startY,
      head: [columns],
      body,
      margin: { left: margin, right: margin },
      tableWidth: usableWidth,
      styles: {
        fontSize: 7.5,
        cellPadding: { top: 1.6, right: 2, bottom: 1.6, left: 2 },
        overflow: 'linebreak',
        valign: 'middle',
        textColor: [40, 40, 40],
        lineColor: borderGray,
        lineWidth: 0.1,
        minCellHeight: includeImages ? 20 : 7,
      },
      headStyles: {
        fillColor: primaryColor,
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 7.5,
        overflow: 'linebreak',
        minCellHeight: 9,
        cellPadding: { top: 2, right: 2, bottom: 2, left: 2 },
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
