import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { isInternalCfKey, cfDisplayValue, buildBondedSummary, bondedArticle } from './bondedStores';

/** Extract last path segment from a location string */
const lastSegment = (str) => {
  if (!str) return '';
  const parts = str?.split(/[›>\/\\|]/)?.map(s => s?.trim())?.filter(Boolean);
  return parts?.[parts?.length - 1] || str;
};

/** Stock locations. A single location shows just its name (the total is already
 *  in the Qty column, so repeating it is redundant); a split shows the per-
 *  location breakdown, where the counts actually add information. */
const formatLocations = (item) => {
  const locs = item?.stockLocations || [];
  if (!locs?.length) return '';
  const named = locs.map(loc => ({
    name: lastSegment(loc?.locationName || loc?.location_name || loc?.location || loc?.name || ''),
    qty: loc?.qty ?? 0,
  }));
  if (named.length === 1) return named[0].name;
  return named.map(l => `${l.name}: ${l.qty}`).join(' | ');
};

/** The item's primary physical location (box/room) — used to group a
 *  location export. Falls back to "Unassigned" when nothing is set. */
const primaryLocation = (item) => {
  const locs = item?.stockLocations || [];
  if (!locs.length) return 'Unassigned';
  const l = locs[0];
  return lastSegment(l?.locationName || l?.location_name || l?.location || l?.name || '') || 'Unassigned';
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
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        // Flatten onto white so transparent PNGs don't render on black in the PDF.
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0);
        // Keep the natural size so the draw step can preserve aspect ratio.
        resolve({ data: canvas.toDataURL('image/jpeg', 0.85), w, h });
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
const COLUMNS = ['Cargo ID', 'Name', 'Brand', 'Folder', 'Sizes', 'Details', 'Location', 'Qty'];
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
  // Remaining custom fields (skip colour + size-related + "used" + internal
  // plumbing like profile/bonded/variantKind, and any object value that would
  // otherwise render as "[object Object]").
  Object.keys(cf || {})?.forEach((k) => {
    const kl = k?.toLowerCase();
    if (kl === 'colour' || kl === 'color') return;
    if (SIZE_LIKE_KEY?.test(k)) return;
    if (isInternalCfKey(k)) return;
    if (['used', 'used_quantity', 'usedqty', 'used_qty']?.includes(kl?.replace(/\s/g, '_'))) return;
    const dv = cfDisplayValue(cf?.[k]);
    if (dv) push(formatAttrKey(k), dv);
  });
  // Bonded / duty-free specifics, surfaced cleanly rather than as an object.
  const bonded = cf?.bonded;
  if (bonded && typeof bonded === 'object') {
    if (bonded.abv !== '' && bonded.abv != null) push('ABV', `${bonded.abv}%`);
    // Type from the name-based classifier, not the unreliable stored kind.
    push('Type', bondedArticle(item));
    // Tobacco: show the per-carton multiple and the true stick/cigar total, so a
    // "qty 2" box of cigars reads as the number of cigars it holds.
    if (bonded.kind === 'cig' || bonded.kind === 'cigar') {
      const per = (Number(bonded.perPack) || 0) * (Number(bonded.perCarton) || 0);
      const word = bonded.kind === 'cigar' ? 'cigars' : 'cigarettes';
      if (per) push('Pack', `${per} ${word}/carton`); // the total count goes in the Qty column
    }
  }
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
// The Qty cell: tobacco shows the real stick count (e.g. "24 cigars"); otherwise
// the plain on-hand number.
const qtyCell = (item) => {
  const qty = getTotalQty(item);
  const b = item?.customFields?.bonded || item?.custom_fields?.bonded;
  if (b && (b.kind === 'cig' || b.kind === 'cigar')) {
    const per = (Number(b.perPack) || 0) * (Number(b.perCarton) || 0);
    if (per) return `${qty * per} ${b.kind === 'cigar' ? 'cigars' : 'cigarettes'}`;
  }
  return String(qty);
};

const buildRow = (item, includeImages) => {
  const dataRow = [
    sanitizeCell(item?.cargoItemId || item?.cargo_item_id || ''),
    sanitizeCell(item?.name || ''),
    sanitizeCell(item?.brand || ''),
    sanitizeCell(getFolderLabel(item)),
    buildSizes(item),
    buildDetails(item),
    sanitizeCell(formatLocations(item)),
    sanitizeCell(qtyCell(item)),
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

        const cached = imageCache?.[imageUrl];
        if (!cached?.data) return;

        try {
          const cellX = data?.cell?.x;
          const cellY = data?.cell?.y;
          const cellW = data?.cell?.width;
          const cellH = data?.cell?.height;

          // Fit within a 12mm box, preserving aspect ratio (no stretch), centred.
          const box = 12;
          const ratio = (cached.w && cached.h) ? cached.w / cached.h : 1;
          const dw = ratio >= 1 ? box : box * ratio;
          const dh = ratio >= 1 ? box / ratio : box;
          const imgX = cellX + (cellW - dw) / 2;
          const imgY = cellY + (cellH - dh) / 2;

          doc?.addImage(cached.data, 'JPEG', imgX, imgY, dw, dh);
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

  // ── Bonded stores summary (FAL 3) ────────────────────────────────────────
  // Alcohol & tobacco grouped by article type, ordered highest→lowest quantity,
  // on its own page — the shape a Ship's Stores Declaration needs.
  const drawBondedSummary = (summary) => {
    doc?.addPage();
    doc?.setFillColor(...primaryColor);
    doc?.rect(0, 0, pageWidth, 22, 'F');
    doc?.setTextColor(255, 255, 255);
    doc?.setFontSize(15);
    doc?.setFont('helvetica', 'bold');
    doc?.text('BONDED STORES SUMMARY', margin, 14);
    doc?.setFontSize(8);
    doc?.setFont('helvetica', 'normal');
    doc?.setTextColor(200, 210, 230);
    doc?.text('Duty-free alcohol & tobacco — for Ship’s Stores Declaration (FAL 3)', pageWidth - margin, 14, { align: 'right' });

    let y = 30;
    doc?.setTextColor(...primaryColor);
    doc?.setFontSize(9);
    doc?.setFont('helvetica', 'normal');
    doc?.text('Articles grouped by type, ordered by quantity, highest first.', margin, y);
    y += 5;

    // Alcohol and tobacco are different units (bottles / litres vs cigars &
    // cigarettes), so they get separate tables — no "bottles" total hanging
    // under a cigar row.
    const alcoholRows = summary.rows.filter((r) => !r.isTobacco);
    const tobaccoRows = summary.rows.filter((r) => r.isTobacco);

    const baseStyles = {
      fontSize: 9,
      cellPadding: { top: 2.4, right: 3, bottom: 2.4, left: 3 },
      overflow: 'linebreak',
      valign: 'middle',
      textColor: [40, 40, 40],
      lineColor: borderGray,
      lineWidth: 0.1,
    };
    const pageFooter = () => {
      doc?.setFontSize(7);
      doc?.setTextColor(160, 160, 160);
      doc?.text('Cargo — Bonded Stores Summary', margin, pageHeight - 6);
    };

    // ── Alcohol table — descriptive bottle quantity + litres, bottle/litre totals.
    if (alcoholRows.length) {
      const locCol = pageWidth - margin * 2 - 62 - 44 - 24;
      autoTable(doc, {
        startY: y,
        head: [['Article type', 'Quantity', 'Litres', 'Location(s) on board']],
        body: alcoholRows.map((r) => [
          r.article,
          `${r.count} ${r.unit}`,
          `${(r.litres || 0).toFixed(1)} L`,
          r.locations.join(', ') || '—',
        ]),
        foot: [['TOTAL', `${summary.totalBottles} bottles`, `${(summary.totalLitres || 0).toFixed(1)} L`, '']],
        margin: { left: margin, right: margin },
        styles: baseStyles,
        headStyles: { fillColor: primaryColor, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9 },
        footStyles: { fillColor: primaryColor, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9 },
        columnStyles: {
          0: { cellWidth: 62, fontStyle: 'bold' },
          1: { cellWidth: 44, halign: 'right', fontStyle: 'bold' },
          2: { cellWidth: 24, halign: 'right' },
          3: { cellWidth: locCol },
        },
        didDrawPage: pageFooter,
      });
      y = (doc?.lastAutoTable?.finalY || y) + 12;
    }

    // ── Tobacco table — its own section, counted in cigars / cigarettes (no
    // litres, no bottle total), with a per-unit total line.
    if (tobaccoRows.length) {
      doc?.setTextColor(...primaryColor);
      doc?.setFontSize(11);
      doc?.setFont('helvetica', 'bold');
      doc?.text('Tobacco', margin, y);
      y += 4;

      // Separate totals per unit word so cigars and cigarettes aren't summed together.
      const tobTotals = {};
      tobaccoRows.forEach((r) => { tobTotals[r.unit] = (tobTotals[r.unit] || 0) + r.count; });
      const tobTotalLabel = Object.entries(tobTotals).map(([unit, n]) => `${n} ${unit}`).join(' · ');

      const tobLocCol = pageWidth - margin * 2 - 62 - 44;
      autoTable(doc, {
        startY: y,
        head: [['Article type', 'Quantity', 'Location(s) on board']],
        body: tobaccoRows.map((r) => [
          r.article,
          `${r.count} ${r.unit}`,
          r.locations.join(', ') || '—',
        ]),
        foot: [['TOTAL', tobTotalLabel, '']],
        margin: { left: margin, right: margin },
        styles: baseStyles,
        headStyles: { fillColor: primaryColor, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9 },
        footStyles: { fillColor: primaryColor, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9 },
        columnStyles: {
          0: { cellWidth: 62, fontStyle: 'bold' },
          1: { cellWidth: 44, halign: 'right', fontStyle: 'bold' },
          2: { cellWidth: tobLocCol },
        },
        didDrawPage: pageFooter,
      });
    }
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
  } else if (scope === 'view') {
    // Location / filter export — group items by their physical box/location so
    // everything in Box 1 sits together, Box 2 together, etc.
    const groups = {};
    (items || []).forEach((item) => {
      const loc = primaryLocation(item);
      (groups[loc] = groups[loc] || []).push(item);
    });
    // Natural sort so Box 2 comes before Box 10; "Unassigned" last.
    const names = Object.keys(groups).sort((a, b) => {
      if (a === 'Unassigned') return 1;
      if (b === 'Unassigned') return -1;
      return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    });
    let currentY = yPos;
    for (let i = 0; i < names.length; i++) {
      const groupItems = groups[names[i]];
      currentY = drawFolderHeader(names[i], groupItems.length, currentY);
      currentY = renderTable(groupItems, currentY) + 2;
      currentY += 4;
      if (i < names.length - 1 && currentY > pageHeight - 40) { doc?.addPage(); currentY = 14; }
    }
    drawTotalsLine(items || [], currentY, 'OVERALL SUMMARY', true);
  } else {
    let finalY = renderTable(items || [], yPos);
    drawTotalsLine(items || [], finalY, 'TOTALS', true);
  }

  // ── Bonded stores summary (appended when alcohol/tobacco is in scope) ─────
  const bondedSummary = buildBondedSummary(allExportItems);
  if (bondedSummary.rows.length) drawBondedSummary(bondedSummary);

  // ── Save ─────────────────────────────────────────────────────────────────
  const filename = `inventory-export-${now?.toISOString()?.slice(0, 10)}.pdf`;
  doc?.save(filename);
};
