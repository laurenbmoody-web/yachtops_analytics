// Blank inventory import template — a ready-to-fill .xlsx that mirrors how Cargo
// stores inventory, so a crew member can build a list offline and import it
// cleanly (Inventory → Import inventory). Pulls the vessel's real folder tree
// and physical storage locations so the reference tabs + drop-downs match Cargo.

import ExcelJS from 'exceljs';
import FileSaver from 'file-saver';
import { getFolderTree } from '../../inventory/utils/inventoryStorage';
import { supabase } from '../../../lib/supabaseClient';

const NAVY = 'FF1C1B3A';
const TERRA = 'FFC65A1A';
const SOFT = 'FFF8FAFC';
const HAIR = 'FFE5E7EB';
const WHITE = 'FFFFFFFF';

const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const border = {
  top: { style: 'thin', color: { argb: HAIR } },
  left: { style: 'thin', color: { argb: HAIR } },
  bottom: { style: 'thin', color: { argb: HAIR } },
  right: { style: 'thin', color: { argb: HAIR } },
};

// Flatten the Cargo folder tree (keyed by '|||'-joined segments) into
// { dept, sub } rows. Top-level folders are the departments.
const flattenFolders = (tree) => {
  const out = [];
  const walk = (segments) => {
    const key = segments.join('|||');
    const subs = tree?.[key]?.subFolders || [];
    for (const name of subs) {
      const path = [...segments, name];
      if (path.length > 1) out.push({ dept: path[0], sub: path.slice(1).join(' > ') });
      walk(path);
    }
  };
  walk([]);
  return out;
};

const LEVEL_LABEL = { deck: 'Deck', zone: 'Area', space: 'Room / space', container: 'Box / container' };

const COLS = [
  ['Item Name', 30, true, 'REQUIRED. The product name, e.g. "Bombay Sapphire Gin" or "Bath Towel White".'],
  ['Brand', 18, false, 'Optional brand / maker.'],
  ['Department', 16, true, 'REQUIRED. Top-level area — pick from the drop-down.'],
  ['Folder', 40, false, 'Path inside the department, e.g. Guest > Alcohol > Spirits > Gin. Copy from the Folders tab.'],
  ['Storage Location / Box', 24, false, 'Physical place on board. Pick from the drop-down or the Storage locations tab.'],
  ['Quantity', 10, false, 'How many you have.'],
  ['Unit', 12, false, 'each, bottle, case, pair, set, pack, box, kg, g, L, ml, m, roll.'],
  ['Supplier', 18, false, 'Where you buy it.'],
  ['Unit Cost', 11, false, 'Price per unit (number only).'],
  ['Currency', 10, false, 'EUR, USD or GBP.'],
  ['Barcode', 16, false, 'Barcode / QR code, if it has one.'],
  ['Expiry Date', 13, false, 'dd/mm/yyyy — for food, medical, etc.'],
  ['Restock Level', 13, false, 'Re-order when stock drops to this number.'],
  ['Notes', 28, false, 'Anything else.'],
  ['ABV %', 9, false, 'Alcohol strength — bonded stores only.'],
  ['Type', 16, false, 'Spirit, Wine, Champagne, Beer, Liqueur, Fortified, Tobacco, Cigar — bonded only.'],
];

const EXAMPLES = [
  ['Bombay Sapphire Gin', 'Bombay', 'Interior', 'Guest > Alcohol > Spirits > Gin', 'Wine Fridge', 2, 'bottle', 'Local supplier', 25, 'EUR', '', '', 1, 'Example row — overwrite me', 40, 'Spirit'],
  ['Bath Towel White', '', 'Interior', 'Guest > Linen > Linen closet', 'Linen Closet', 24, 'each', '', 8, 'EUR', '', '', 10, 'Example row — overwrite me', '', ''],
  ['Engine Oil 15W-40', 'Shell', 'Engineering', 'Oils & Fluids', 'ECR', 4, 'each', 'Shell', '', '', '', '', 2, 'Example row — overwrite me', '', ''],
];

const LAST_ROW = 400;

export async function exportInventoryTemplate() {
  // ── Pull live folders + storage locations ──────────────────────────────
  const tree = (await getFolderTree().catch(() => ({}))) || {};
  const folders = flattenFolders(tree)
    .sort((a, b) => a.dept.localeCompare(b.dept) || a.sub.localeCompare(b.sub));
  const departments = [...new Set(folders.map((f) => f.dept))].sort();

  let boxes = [];
  try {
    const { data: ctx } = await supabase.rpc('get_my_context');
    const tid = ctx?.[0]?.tenant_id;
    if (tid) {
      const { data } = await supabase.from('vessel_locations')
        .select('name, level').eq('tenant_id', tid).eq('is_archived', false)
        .order('name', { ascending: true });
      const seen = new Set();
      (data || []).forEach((l) => { if (l?.name && !seen.has(l.name)) { seen.add(l.name); boxes.push({ name: l.name, level: l.level }); } });
    }
  } catch { /* boxes optional */ }

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Cargo — Yacht Operations Platform';
  wb.created = new Date();

  // ── Sheet: Read me ─────────────────────────────────────────────────────
  const rm = wb.addWorksheet('Read me', { views: [{ showGridLines: false }] });
  rm.getColumn(1).width = 3; rm.getColumn(2).width = 108;
  const say = (row, text, opts = {}) => {
    const c = rm.getCell(row, 2);
    c.value = text;
    c.font = { name: 'Calibri', size: opts.size || 11, bold: !!opts.bold, italic: !!opts.italic, color: { argb: opts.color || 'FF1C1B3A' } };
    c.alignment = { wrapText: true, vertical: 'top' };
  };
  say(2, 'Cargo — Inventory import template', { bold: true, size: 16 });
  say(3, 'A blank, ready-to-fill list that imports cleanly back into Cargo.', { color: 'FF6B7280' });
  say(5, 'HOW TO USE', { bold: true, color: TERRA });
  [
    '1.  Go to the "Inventory" tab and add one row per item. Only "Item Name" is required — fill in what you know.',
    '2.  Department: pick from the drop-down (the top-level areas in Cargo).',
    '3.  Folder: the path inside that department, e.g.  Guest > Alcohol > Spirits > Gin.  Copy the exact text from the',
    '      "Folders (categories)" tab so it matches Cargo. You can also invent a new folder — Cargo creates it on import.',
    '4.  Storage location (box): the physical place on board (e.g. Wine Fridge, Stbd Aft). Pick from the drop-down, or',
    '      from the "Storage locations" tab. Leave blank if it isn’t stowed anywhere specific yet.',
    '5.  Quantity / Unit / Supplier / Cost etc. are optional — add what you have.',
    '6.  For alcohol & tobacco (bonded stores) you can add ABV % and Type — handy for the Ship’s Stores Declaration.',
    '7.  Save the file, then in Cargo:  Inventory  →  Import inventory  →  upload this spreadsheet.',
  ].forEach((t, i) => say(6 + i, t));
  say(16, 'TABS IN THIS FILE', { bold: true, color: TERRA });
  ['•  Inventory  — fill this in (the only tab you type into).',
    '•  Folders (categories)  — every department + folder currently in your Cargo, to copy from.',
    '•  Storage locations  — every physical location / box on board, to copy from.',
  ].forEach((t, i) => say(17 + i, t));
  say(21, 'Tip: you don’t have to use every column. Name + Department + Folder + Quantity already makes a great import.', { color: 'FF6B7280', italic: true });

  // ── Sheet: Inventory (fill-in) ─────────────────────────────────────────
  const inv = wb.addWorksheet('Inventory', { views: [{ showGridLines: false, state: 'frozen', ySplit: 3 }] });
  inv.mergeCells(1, 1, 1, COLS.length);
  const band = inv.getCell(1, 1);
  band.value = 'CARGO INVENTORY  —  add one item per row   •   only "Item Name" is required';
  band.fill = fill(TERRA); band.font = { bold: true, color: { argb: WHITE }, size: 11 };
  band.alignment = { vertical: 'middle', indent: 1 };
  inv.getRow(1).height = 22;

  COLS.forEach(([name, w, req, note], i) => {
    const col = i + 1;
    inv.getColumn(col).width = w;
    const h = inv.getCell(2, col);
    h.value = name; h.fill = fill(NAVY); h.font = { bold: true, color: { argb: WHITE }, size: 11 };
    h.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; h.border = border;
    h.note = note;
    const hint = inv.getCell(3, col);
    hint.value = req ? 'required' : 'optional';
    hint.font = { size: 8, italic: true, bold: req, color: { argb: req ? 'FFC65A1A' : 'FFAEB4C2' } };
    hint.alignment = { horizontal: 'center' };
  });
  inv.getRow(2).height = 30;

  EXAMPLES.forEach((row, r) => {
    row.forEach((val, i) => {
      const c = inv.getCell(4 + r, i + 1);
      if (val !== '') c.value = val;
      c.font = { italic: true, color: { argb: 'FF9CA3AF' }, size: 10 };
      c.border = border; c.alignment = { vertical: 'middle', wrapText: i === 3 || i === 13 };
    });
  });
  for (let r = 4 + EXAMPLES.length; r <= LAST_ROW; r += 1) {
    for (let i = 1; i <= COLS.length; i += 1) {
      const c = inv.getCell(r, i);
      c.border = border;
      if (r % 2 === 1) c.fill = fill(SOFT);
    }
  }

  const listDv = (formulae, prompt) => ({ type: 'list', allowBlank: true, showErrorMessage: false, formulae, prompt, promptTitle: 'Pick from list' });
  inv.dataValidations.add(`C4:C${LAST_ROW}`, listDv([`"${departments.join(',')}"`], 'Pick the department'));
  inv.dataValidations.add(`G4:G${LAST_ROW}`, listDv(['"each,bottle,case,pair,set,pack,box,kg,g,L,ml,m,roll"'], 'Unit of measure'));
  inv.dataValidations.add(`J4:J${LAST_ROW}`, listDv(['"EUR,USD,GBP"'], 'Currency'));
  inv.dataValidations.add(`P4:P${LAST_ROW}`, listDv(['"Spirit,Wine,Champagne,Sparkling,Beer,Cider,Liqueur,Fortified,Tobacco,Cigar"'], 'Bonded type'));

  // ── Sheet: Folders (categories) ────────────────────────────────────────
  const fs = wb.addWorksheet('Folders (categories)', { views: [{ showGridLines: false, state: 'frozen', ySplit: 2 }] });
  fs.getColumn(1).width = 16; fs.getColumn(2).width = 72;
  fs.mergeCells('A1:B1');
  const ft = fs.getCell(1, 1);
  ft.value = 'Your Cargo folders — copy the Department + Folder into the Inventory tab';
  ft.font = { bold: true, color: { argb: TERRA }, size: 11 };
  ['Department', 'Folder (path inside the department)'].forEach((h, i) => {
    const c = fs.getCell(2, i + 1);
    c.value = h; c.fill = fill(NAVY); c.font = { bold: true, color: { argb: WHITE }, size: 11 };
    c.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 }; c.border = border;
  });
  folders.forEach(({ dept, sub }, idx) => {
    const r = 3 + idx;
    const a = fs.getCell(r, 1); const b = fs.getCell(r, 2);
    a.value = dept; b.value = sub;
    [a, b].forEach((c) => { c.border = border; c.alignment = { vertical: 'middle', indent: 1 }; if (r % 2 === 0) c.fill = fill(SOFT); });
    a.font = { bold: true, color: { argb: NAVY }, size: 10 };
  });
  if (!folders.length) fs.getCell(3, 2).value = 'No folders yet — create them in Cargo, or just type a folder name in the Inventory tab.';

  // ── Sheet: Storage locations ───────────────────────────────────────────
  const ls = wb.addWorksheet('Storage locations', { views: [{ showGridLines: false, state: 'frozen', ySplit: 1 }] });
  ls.getColumn(1).width = 32; ls.getColumn(2).width = 16;
  ['Storage location / box', 'Type'].forEach((h, i) => {
    const c = ls.getCell(1, i + 1);
    c.value = h; c.fill = fill(NAVY); c.font = { bold: true, color: { argb: WHITE }, size: 11 };
    c.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 }; c.border = border;
  });
  boxes.forEach(({ name, level }, idx) => {
    const r = 2 + idx;
    const a = ls.getCell(r, 1); const b = ls.getCell(r, 2);
    a.value = name; b.value = LEVEL_LABEL[level] || level || '';
    [a, b].forEach((c) => { c.border = border; c.alignment = { vertical: 'middle', indent: 1 }; if (r % 2 === 1) c.fill = fill(SOFT); });
  });
  if (boxes.length) {
    inv.dataValidations.add(`E4:E${LAST_ROW}`, {
      type: 'list', allowBlank: true, showErrorMessage: false,
      formulae: [`'Storage locations'!$A$2:$A$${boxes.length + 1}`], prompt: 'Pick a physical location', promptTitle: 'Pick from list',
    });
  } else {
    ls.getCell(2, 1).value = 'No storage locations yet — set them up in Cargo, or type a place name in the Inventory tab.';
  }

  // ── Save ───────────────────────────────────────────────────────────────
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const stamp = new Date().toISOString().slice(0, 10);
  FileSaver.saveAs(blob, `cargo-inventory-template-${stamp}.xlsx`);
}
