import ExcelJS from 'exceljs';
import FileSaver from 'file-saver';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const lastSegment = (str) => {
  if (!str) return '';
  const parts = str?.split(/[›>\/\\|]/)?.map(s => s?.trim())?.filter(Boolean);
  return parts?.[parts?.length - 1] || str;
};

const getStockLocations = (item) => item?.stockLocations || [];

const getTotalQty = (item) => {
  const locs = getStockLocations(item);
  if (locs?.length > 0) return locs?.reduce((sum, l) => sum + (l?.qty || 0), 0);
  return item?.quantity ?? item?.totalQty ?? 0;
};

const getLocName = (loc) =>
  lastSegment(loc?.locationName || loc?.location_name || loc?.location || loc?.name || '');

const getFolderLabel = (item) => {
  const parts = [item?.location, item?.subLocation]?.filter(Boolean);
  return parts?.map(p => lastSegment(p))?.join(' › ') || '';
};

const isBelowRestock = (item) => {
  const total = getTotalQty(item);
  return item?.restockEnabled && item?.restockLevel != null && total < item?.restockLevel;
};

const isExpiringSoon = (item) => {
  if (!item?.expiry_date) return false;
  try {
    const expiry = new Date(item.expiry_date);
    const now = new Date();
    const diffMs = expiry - now;
    return diffMs >= 0 && diffMs <= 30 * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
};

const detectLocations = (items) => {
  const locSet = new Set();
  items?.forEach(item => {
    const locs = getStockLocations(item);
    if (locs?.length > 0) {
      locs?.forEach(loc => {
        const name = getLocName(loc);
        if (name) locSet?.add(name);
      });
    } else {
      const fallback = lastSegment(item?.vessel_location || item?.location_detail || '');
      if (fallback) locSet?.add(fallback);
    }
  });
  return Array.from(locSet)?.sort();
};

const getQtyForLocation = (item, locName) => {
  const locs = getStockLocations(item);
  if (locs?.length > 0) {
    const match = locs?.find(l => getLocName(l) === locName);
    return match ? (match?.qty || 0) : 0;
  }
  const fallback = lastSegment(item?.vessel_location || item?.location_detail || '');
  if (fallback === locName) return getTotalQty(item);
  return 0;
};

const groupByFolder = (items) => {
  const groups = {};
  items?.forEach(item => {
    const folder = getFolderLabel(item) || 'General';
    if (!groups?.[folder]) groups[folder] = [];
    groups?.[folder]?.push(item);
  });
  return groups;
};

const sanitizeSheetName = (name) => {
  return name?.replace(/[:\\\/\?\*\[\]]/g, '')?.substring(0, 31)?.trim() || 'Sheet';
};

const uniqueSheetName = (name, usedNames) => {
  let candidate = sanitizeSheetName(name);
  let counter = 2;
  while (usedNames?.has(candidate)) {
    const suffix = ` ${counter}`;
    candidate = sanitizeSheetName(name)?.substring(0, 31 - suffix?.length) + suffix;
    counter++;
  }
  usedNames?.add(candidate);
  return candidate;
};

// ─── Style constants ──────────────────────────────────────────────────────────

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
const HEADER_BORDER = {
  top: { style: 'thin', color: { argb: 'FF1E293B' } },
  left: { style: 'thin', color: { argb: 'FF1E293B' } },
  right: { style: 'thin', color: { argb: 'FF1E293B' } },
  bottom: { style: 'medium', color: { argb: 'FF94A3B8' } },
};
const HEADER_ALIGNMENT = { horizontal: 'center', vertical: 'middle', wrapText: false };

const CELL_BORDER = {
  top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
  left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
  bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
  right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
};

const applyHeaderRow = (row, count) => {
  row.height = 22;
  row?.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    if (colNumber > count) return;
    cell.font = HEADER_FONT;
    cell.fill = HEADER_FILL;
    cell.border = HEADER_BORDER;
    cell.alignment = HEADER_ALIGNMENT;
  });
};

const applyDataCell = (cell, opts = {}) => {
  const { bold = false, fill = 'FFFFFFFF', fontColor = 'FF000000', align = 'center', wrap = true } = opts;
  cell.font = { bold, color: { argb: fontColor }, size: 9 };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
  cell.border = CELL_BORDER;
  cell.alignment = { horizontal: align, vertical: 'middle', wrapText: wrap };
};

// ─── Build folder sheet ───────────────────────────────────────────────────────

const colLetter = (idx) => {
  // Convert 1-based column index to Excel column letter (A, B, ..., Z, AA, ...)
  let letter = '';
  let n = idx;
  while (n > 0) {
    const rem = (n - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
};

const buildFolderSheet = (worksheet, items, includeImages, allLocationCols) => {
  const useDynamicCols = allLocationCols?.length > 0 && allLocationCols?.length <= 8;

  // Collect all unique custom field keys across all items
  const customFieldKeys = [];
  items?.forEach(item => {
    const cf = item?.customFields || item?.custom_fields || {};
    Object.keys(cf)?.forEach(k => {
      if (!customFieldKeys?.includes(k)) customFieldKeys?.push(k);
    });
  });

  // Separate custom fields into two groups:
  // Group A: folder-adjacent fields (category, bag_name, colour, color)
  // Group B: sku-adjacent fields (batch_no, batch_number, batch)
  // Group C: used field — goes LAST alongside location/quantity
  // Group D: everything else
  const FOLDER_ADJACENT_KEYS = ['category', 'bag_name', 'bagname', 'bag name', 'colour', 'color'];
  const SKU_ADJACENT_KEYS = ['batch_no', 'batch_number', 'batch', 'batchno'];
  const USED_KEYS = ['used', 'used_quantity', 'usedqty', 'used qty', 'used_qty'];

  const folderAdjacentKeys = customFieldKeys?.filter(k => FOLDER_ADJACENT_KEYS?.includes(k?.toLowerCase()?.replace(/\s/g, '_')));
  const skuAdjacentKeys = customFieldKeys?.filter(k => SKU_ADJACENT_KEYS?.includes(k?.toLowerCase()?.replace(/\s/g, '_')));
  const usedKeys = customFieldKeys?.filter(k => USED_KEYS?.includes(k?.toLowerCase()?.replace(/\s/g, '_')));
  const otherCustomKeys = customFieldKeys?.filter(k =>
    !FOLDER_ADJACENT_KEYS?.includes(k?.toLowerCase()?.replace(/\s/g, '_')) &&
    !SKU_ADJACENT_KEYS?.includes(k?.toLowerCase()?.replace(/\s/g, '_')) &&
    !USED_KEYS?.includes(k?.toLowerCase()?.replace(/\s/g, '_'))
  );

  const toLabel = (k) => k?.replace(/_/g, ' ')?.replace(/\b\w/g, c => c?.toUpperCase());

  const headers = [];
  if (includeImages) headers?.push('Image URL');
  headers?.push('Cargo Item ID');
  headers?.push('Item Name');
  headers?.push('Brand');
  headers?.push('Description');
  headers?.push('Unit');
  headers?.push('Supplier');
  headers?.push('Restock Level');
  headers?.push('Expiry Date');
  headers?.push('Notes');

  // Folder-adjacent custom fields (Category, Bag Name, Colour) go here
  folderAdjacentKeys?.forEach(k => headers?.push(toLabel(k)));

  // SKU-adjacent custom fields (Batch No) go here
  skuAdjacentKeys?.forEach(k => headers?.push(toLabel(k)));

  // Any remaining custom fields
  otherCustomKeys?.forEach(k => headers?.push(toLabel(k)));

  // Location columns, Total Quantity, and Used go LAST
  if (useDynamicCols) {
    allLocationCols?.forEach(loc => headers?.push(loc));
  } else if (allLocationCols?.length > 0) {
    headers?.push('Locations');
  }
  headers?.push('Total Quantity');
  usedKeys?.forEach(k => headers?.push(toLabel(k)));

  const totalQtyColIdx = headers?.indexOf('Total Quantity');
  const restockColIdx = headers?.indexOf('Restock Level');
  const expiryColIdx = headers?.indexOf('Expiry Date');

  const totalQtyColNum = totalQtyColIdx + 1;
  const restockColNum = restockColIdx + 1;
  const totalQtyColLetter = colLetter(totalQtyColNum);
  const restockColLetter = colLetter(restockColNum);

  // Set column definitions
  worksheet.columns = headers?.map(h => {
    let width = 14;
    if (h === 'Image URL') width = 40;
    else if (h === 'Cargo Item ID') width = 16;
    else if (h === 'Item Name') width = 28;
    else if (h === 'Brand') width = 16;
    else if (h === 'Description') width = 30;
    else if (h === 'Unit') width = 10;
    else if (h === 'Supplier') width = 18;
    else if (h === 'Restock Level') width = 13;
    else if (h === 'Expiry Date') width = 13;
    else if (h === 'Notes') width = 28;
    else if (h === 'Locations') width = 35;
    else if (h === 'Total Quantity') width = 14;
    else width = Math.max(h?.length + 2, 12);
    return { header: h, key: h, width };
  });

  // Apply header styles
  const headerRow = worksheet?.getRow(1);
  applyHeaderRow(headerRow, headers?.length);

  // Freeze header row
  worksheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 1, topLeftCell: 'A2', activeCell: 'A2' }];

  // Add data rows
  items?.forEach((item, rowIdx) => {
    const totalQty = getTotalQty(item);
    const belowRestock = isBelowRestock(item);
    const expiringSoon = isExpiringSoon(item);
    const isAltRow = rowIdx % 2 === 1;

    // Build row as an ordered array matching the headers array exactly
    const cf = item?.customFields || item?.custom_fields || {};
    const rowValues = headers?.map(h => {
      if (h === 'Image URL') return item?.image_url || item?.imageUrl || '';
      if (h === 'Cargo Item ID') return item?.cargoItemId || item?.cargo_item_id || '';
      if (h === 'Item Name') return item?.name || '';
      if (h === 'Brand') return item?.brand || '';
      if (h === 'Description') return item?.description || '';
      if (h === 'Unit') return item?.unit || '';
      if (h === 'Supplier') return item?.supplier || '';
      if (h === 'Restock Level') return item?.restockLevel != null ? Number(item?.restockLevel) : '';
      if (h === 'Expiry Date') return item?.expiry_date || '';
      if (h === 'Notes') return item?.notes || '';
      if (h === 'Total Quantity') return Number(totalQty);
      if (h === 'Locations') {
        const locs = getStockLocations(item);
        if (locs?.length > 0) {
          return locs?.map(loc => `${getLocName(loc)} — ${loc?.qty || 0}`)?.join('\n');
        } else {
          const fallback = lastSegment(item?.vessel_location || item?.location_detail || '');
          return fallback ? `${fallback} — ${totalQty}` : '';
        }
      }
      // Dynamic location columns
      if (useDynamicCols && allLocationCols?.includes(h)) {
        const qty = getQtyForLocation(item, h);
        return qty === 0 ? '' : qty;
      }
      // Custom field columns — find matching key
      const matchingKey = customFieldKeys?.find(k => toLabel(k) === h);
      if (matchingKey !== undefined) {
        return cf?.[matchingKey] != null ? String(cf?.[matchingKey]) : '';
      }
      return '';
    });

    const excelRow = worksheet?.addRow(rowValues);
    excelRow.height = includeImages ? 38 : 16;

    // Style each cell
    headers?.forEach((h, colIdx) => {
      const cell = excelRow?.getCell(colIdx + 1);
      const isLocationCol = useDynamicCols && allLocationCols?.includes(h);
      const isTotalQtyCol = colIdx === totalQtyColIdx;
      const isExpiryCol = colIdx === expiryColIdx;

      let fill = isAltRow ? 'FFF8FAFC' : 'FFFFFFFF';
      let fontColor = 'FF000000';
      let bold = false;
      let align = 'center';
      let wrap = true;

      if (isTotalQtyCol) {
        bold = true;
        fill = belowRestock ? 'FFFECACA' : 'FFF1F5F9';
        fontColor = belowRestock ? 'FF991B1B' : 'FF000000';
        align = 'center';
      } else if (belowRestock) {
        fill = 'FFFEF2F2';
      }

      if (isLocationCol) {
        align = 'center';
      }

      if (['Cargo Item ID', 'Item Name', 'Brand', 'Description', 'Notes', 'Locations', 'Supplier', 'Image URL']?.includes(h)) {
        align = 'left';
      }

      if (isExpiryCol && expiringSoon) {
        fill = 'FFFEF08A';
        fontColor = 'FF713F12';
      }

      applyDataCell(cell, { bold, fill, fontColor, align, wrap });
    });
  });

  // ─── Conditional Formatting ───────────────────────────────────────────────
  if (restockColIdx >= 0 && totalQtyColIdx >= 0 && items?.length > 0) {
    const lastDataRow = items?.length + 1;
    const lastColLetter = colLetter(headers?.length);
    const cfRange = `A2:${lastColLetter}${lastDataRow}`;

    worksheet?.addConditionalFormatting({
      ref: cfRange,
      rules: [
        {
          type: 'expression',
          formulae: [`$${totalQtyColLetter}2<$${restockColLetter}2`],
          style: {
            fill: {
              type: 'pattern',
              pattern: 'solid',
              bgColor: { argb: 'FFFEE2E2' },
              fgColor: { argb: 'FFFEE2E2' },
            },
            font: {
              color: { argb: 'FF991B1B' },
            },
          },
          priority: 1,
        },
      ],
    });
  }
};

// ─── Build summary sheet ──────────────────────────────────────────────────────

const buildSummarySheet = (worksheet, folderGroups, allItems) => {
  const headers = [
    'Folder',
    'Item Count',
    'Total Quantity',
    'Items Below Restock Level',
    'Items Expiring Soon',
  ];

  worksheet.columns = [
    { header: 'Folder', key: 'Folder', width: 30 },
    { header: 'Item Count', key: 'Item Count', width: 12 },
    { header: 'Total Quantity', key: 'Total Quantity', width: 15 },
    { header: 'Items Below Restock Level', key: 'Items Below Restock Level', width: 26 },
    { header: 'Items Expiring Soon', key: 'Items Expiring Soon', width: 20 },
  ];

  const headerRow = worksheet?.getRow(1);
  applyHeaderRow(headerRow, headers?.length);

  worksheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 1, topLeftCell: 'A2', activeCell: 'A2' }];

  const folderEntries = Object.entries(folderGroups);
  folderEntries?.forEach(([folder, items], rowIdx) => {
    const isAltRow = rowIdx % 2 === 1;
    const excelRow = worksheet?.addRow({
      'Folder': folder,
      'Item Count': items?.length,
      'Total Quantity': items?.reduce((sum, i) => sum + getTotalQty(i), 0),
      'Items Below Restock Level': items?.filter(isBelowRestock)?.length,
      'Items Expiring Soon': items?.filter(isExpiringSoon)?.length,
    });
    excelRow.height = 16;
    headers?.forEach((h, colIdx) => {
      const cell = excelRow?.getCell(colIdx + 1);
      const isTotalQtyCol = h === 'Total Quantity';
      applyDataCell(cell, {
        bold: isTotalQtyCol,
        fill: isTotalQtyCol ? (isAltRow ? 'FFE8EEF4' : 'FFF1F5F9') : (isAltRow ? 'FFF8FAFC' : 'FFFFFFFF'),
        align: colIdx === 0 ? 'left' : 'center',
        wrap: true,
      });
    });
  });

  // Totals row
  const totalsRow = worksheet?.addRow({
    'Folder': 'TOTAL',
    'Item Count': allItems?.length,
    'Total Quantity': allItems?.reduce((sum, i) => sum + getTotalQty(i), 0),
    'Items Below Restock Level': allItems?.filter(isBelowRestock)?.length,
    'Items Expiring Soon': allItems?.filter(isExpiringSoon)?.length,
  });
  totalsRow.height = 16;
  headers?.forEach((h, colIdx) => {
    const cell = totalsRow?.getCell(colIdx + 1);
    applyDataCell(cell, {
      bold: true,
      fill: 'FFE2E8F0',
      align: colIdx === 0 ? 'left' : 'center',
      wrap: true,
    });
  });
};

// ─── Build export info sheet ──────────────────────────────────────────────────

const buildExportInfoSheet = (worksheet, scope, folderPath, items, includeImages, exportedBy) => {
  const now = new Date();
  const rows = [
    ['Export Scope', scope],
    ['Exported By', exportedBy || 'Unknown'],
    ['Export Date', now?.toLocaleString('en-GB')],
    ['Folder Path', folderPath || '—'],
    ['Total Items Exported', items?.length],
    ['Images Included', includeImages ? 'Yes' : 'No'],
    ['Format', 'Excel (.xlsx)'],
    ['Generated By', 'Cargo — Yacht Operations Platform'],
  ];

  worksheet.columns = [
    { header: 'Field', key: 'Field', width: 24 },
    { header: 'Value', key: 'Value', width: 50 },
  ];

  const headerRow = worksheet?.getRow(1);
  applyHeaderRow(headerRow, 2);

  worksheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 1, topLeftCell: 'A2', activeCell: 'A2' }];

  rows?.forEach((row, rowIdx) => {
    const isAltRow = rowIdx % 2 === 1;
    const excelRow = worksheet?.addRow({ 'Field': row?.[0], 'Value': row?.[1] });
    excelRow.height = 16;
    applyDataCell(excelRow?.getCell(1), { bold: true, fill: isAltRow ? 'FFF7F9FC' : 'FFFFFFFF', align: 'left', wrap: true });
    applyDataCell(excelRow?.getCell(2), { fill: isAltRow ? 'FFF7F9FC' : 'FFFFFFFF', align: 'left', wrap: true });
  });
};

// ─── Main export function ─────────────────────────────────────────────────────

export const exportInventoryToXLSX = async ({ items, scope, folderPath, includeImages, exportedBy }) => {
  if (!items || items?.length === 0) {
    console.warn('[XLSX Export] No items to export');
    return;
  }

  const now = new Date();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Cargo — Yacht Operations Platform';
  workbook.created = now;

  const usedSheetNames = new Set();
  const folderGroups = groupByFolder(items);
  const folderNames = Object.keys(folderGroups);
  const allLocationCols = detectLocations(items);

  // 1. Inventory Summary sheet (first)
  const summarySheetName = uniqueSheetName('Inventory Summary', usedSheetNames);
  const summaryWs = workbook?.addWorksheet(summarySheetName);
  buildSummarySheet(summaryWs, folderGroups, items);

  // 2. Per-folder sheets
  if (folderNames?.length === 1) {
    const sheetName = uniqueSheetName(folderNames?.[0] || 'Inventory', usedSheetNames);
    const ws = workbook?.addWorksheet(sheetName);
    buildFolderSheet(ws, items, includeImages, allLocationCols);
  } else {
    folderNames?.forEach(folder => {
      const folderItems = folderGroups?.[folder];
      const folderLocationCols = detectLocations(folderItems);
      const sheetName = uniqueSheetName(folder, usedSheetNames);
      const ws = workbook?.addWorksheet(sheetName);
      buildFolderSheet(ws, folderItems, includeImages, folderLocationCols);
    });

    const allSheetName = uniqueSheetName('All Items', usedSheetNames);
    const allWs = workbook?.addWorksheet(allSheetName);
    buildFolderSheet(allWs, items, includeImages, allLocationCols);
  }

  // 3. Export Info sheet (last)
  const infoSheetName = uniqueSheetName('Export Info', usedSheetNames);
  const infoWs = workbook?.addWorksheet(infoSheetName);
  buildExportInfoSheet(infoWs, scope, folderPath, items, includeImages, exportedBy);

  // Save
  const buffer = await workbook?.xlsx?.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const filename = `inventory-export-${now?.toISOString()?.slice(0, 10)}.xlsx`;
  FileSaver?.saveAs(blob, filename);
};
