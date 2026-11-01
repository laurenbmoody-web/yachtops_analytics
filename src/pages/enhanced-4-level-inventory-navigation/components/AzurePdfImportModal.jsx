/**
 * AzurePdfImportModal — Multi-Table Import Session
 *
 * 5-step flow:
 *   Step 1: Upload
 *   Step 2: Table Session Overview (all tables, include/exclude)
 *   Step 3: Per-Table Review (row types + field mapping, navigate table by table)
 *   Step 4: Bulk Preview (combined rows across all approved tables)
 *   Step 5: Bulk Import
 */

import React, { useState, useRef, useCallback, useMemo } from 'react';
import Icon from '../../../components/AppIcon';
import LogoSpinner from '../../../components/LogoSpinner';
import Button from '../../../components/ui/Button';
import { parseDocumentWithAzure, isAzureParseError } from '../../../services/azureDocumentParser';
import { saveItem, createFolder } from '../../inventory/utils/inventoryStorage';
import { useTenant } from '../../../contexts/TenantContext';
import { extractCellColors, getDominantColumnColor, isColourColumn } from '../utils/cellColorDetection';
import SaveAndOrganiseStep from './SaveAndOrganiseStep';

import ModalShell from '../../../components/ui/ModalShell';
import './azure-import.css';
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const CARGO_CORE_FIELDS = [
  { key: 'item_name', label: 'Item Name' },
  { key: 'brand', label: 'Brand' },
  { key: 'quantity', label: 'Quantity' },
  { key: 'unit', label: 'Unit' },
  { key: 'size', label: 'Size' },
  { key: 'year', label: 'Year' },
  { key: 'expiry_date', label: 'Expiry Date' },
  { key: 'batch_no', label: 'Batch No.' },
  { key: 'code', label: 'Code / SKU' },
  { key: 'supplier', label: 'Supplier' },
  { key: 'colour', label: 'Colour' },
  { key: 'notes', label: 'Notes' },
];

// ---------------------------------------------------------------------------
// Field normalization: map common variants to canonical keys
// ---------------------------------------------------------------------------
const FIELD_NORMALIZATIONS = {
  colour: ['colour', 'color', 'fill color', 'fill colour', 'cell color', 'cell colour'],
  batch_no: ['batch', 'batch no', 'batch no.', 'batch number', 'lot', 'lot no', 'lot no.', 'lot number'],
  expiry_date: ['expiry', 'expiry date', 'expiration', 'expiration date', 'best before', 'use by', 'exp', 'exp date'],
};

/**
 * Normalize a raw field label to a canonical snake_case key.
 * Returns the canonical key if a normalization rule matches, otherwise
 * converts the label to snake_case.
 */
function normalizeFieldKey(label) {
  if (!label) return '';
  const lower = label?.toLowerCase()?.trim();
  for (const [canonical, variants] of Object.entries(FIELD_NORMALIZATIONS)) {
    if (variants?.includes(lower)) return canonical;
  }
  // Convert to snake_case
  return lower?.replace(/[^a-z0-9]+/g, '_')?.replace(/^_|_$/g, '');
}

/**
 * Fuzzy similarity between two strings (0–1).
 * Uses simple character overlap to detect near-duplicates.
 */
function fieldSimilarity(a, b) {
  if (!a || !b) return 0;
  const sa = a?.toLowerCase()?.replace(/[^a-z0-9]/g, '');
  const sb = b?.toLowerCase()?.replace(/[^a-z0-9]/g, '');
  if (sa === sb) return 1;
  const longer = sa?.length > sb?.length ? sa : sb;
  const shorter = sa?.length > sb?.length ? sb : sa;
  if (longer?.includes(shorter)) return shorter?.length / longer?.length;
  let matches = 0;
  for (let i = 0; i < shorter?.length; i++) {
    if (longer?.includes(shorter?.[i])) matches++;
  }
  return matches / longer?.length;
}

/**
 * Given a proposed field key, check if a sufficiently similar key already
 * exists in the known set. Returns the existing key if found, else null.
 */
function findSimilarExistingField(proposedKey, existingKeys, threshold = 0.85) {
  for (const existing of existingKeys) {
    if (fieldSimilarity(proposedKey, existing) >= threshold) return existing;
  }
  return null;
}

const ROW_TYPES = [
  { value: 'data', label: 'Data Row', color: 'bg-green-500/10 text-green-700 border-green-500/20' },
  { value: 'header', label: 'Header Row', color: 'bg-primary/10 text-primary border-primary/20' },
  { value: 'group', label: 'Group / Title', color: 'bg-amber-500/10 text-amber-700 border-amber-500/20' },
  { value: 'ignore', label: 'Ignore', color: 'bg-muted text-muted-foreground border-border' },
];

const REVIEW_STATUS_CONFIG = {
  pending: { label: 'Not Reviewed', color: 'bg-muted text-muted-foreground', icon: 'Circle' },
  reviewing: { label: 'In Review', color: 'bg-amber-500/10 text-amber-700', icon: 'Clock' },
  mapped: { label: 'Mapped', color: 'bg-green-500/10 text-green-700', icon: 'CheckCircle2' },
  skipped: { label: 'Skipped', color: 'bg-muted text-muted-foreground line-through', icon: 'MinusCircle' },
};

const STEPS = [
  { id: 1, label: 'Upload' },
  { id: 2, label: 'Tables' },
  { id: 3, label: 'Review' },
  { id: 4, label: 'Save & Organise' },
  { id: 5, label: 'Import' },
];

// The simple default path: upload, check what we found, done.
const SMART_STEPS = [
  { id: 1, label: 'Upload' },
  { id: 2, label: 'Check' },
  { id: 3, label: 'Done' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function autoDetectHeaderRow(table) {
  if (!table?.rows?.length) return null;
  for (let i = 0; i < Math.min(5, table?.rows?.length); i++) {
    const row = table?.rows?.[i];
    const nonEmpty = row?.filter((c) => c?.trim());
    const numeric = nonEmpty?.filter((c) => !isNaN(parseFloat(c)));
    if (nonEmpty?.length > 0 && numeric?.length / nonEmpty?.length < 0.5) return i;
  }
  return 0;
}

const KEYWORD_MAP = {
  item_name: ['name', 'item', 'product', 'description', 'desc', 'wine', 'spirit', 'beverage',
    'désignation', 'designation', 'libellé', 'libelle', 'produit', 'descrizione', 'descripción',
    'descripcion', 'bezeichnung', 'artikel'],
  brand: ['brand', 'producer', 'maker', 'winery', 'distillery', 'manufacturer', 'marque', 'marca'],
  quantity: ['qty', 'quantity', 'stock', 'count', 'amount', 'bottles', 'units',
    'qte', 'qté', 'quantité', 'quantite', 'nbre', 'nombre', 'menge', 'anzahl', 'aantal',
    'cantidad', 'cant', 'pcs', 'pce'],
  unit: ['unit', 'uom', 'measure', 'unité', 'unite'],
  size: ['size', 'volume', 'ml', 'cl', 'litre', 'liter', 'format', 'taille', 'contenance'],
  year: ['year', 'vintage', 'yr', 'année', 'annee', 'millésime', 'millesime'],
  expiry_date: ['expiry', 'expiration', 'best before', 'use by', 'exp', 'péremption', 'peremption', 'dlc', 'ddm'],
  batch_no: ['batch', 'lot', 'batch no', 'lot no'],
  code: ['code', 'sku', 'barcode', 'reference', 'référence', 'code-barres', 'ean'],
  supplier: ['supplier', 'vendor', 'source', 'distributor', 'fournisseur', 'proveedor', 'lieferant'],
  colour: ['colour', 'color', 'fill', 'highlight', 'couleur'],
  notes: ['notes', 'note', 'comment', 'remarks', 'remark', 'remarque', 'commentaire'],
};

function autoDetectColumnMappings(headerRow) {
  const mappings = {};
  const colCount = headerRow?.length || 0;
  for (let cIdx = 0; cIdx < colCount; cIdx++) {
    const colName = headerRow?.[cIdx] || '';
    if (!colName?.trim()) {
      mappings[cIdx] = { saveAs: 'dont_import', customFieldName: '', sourceHeader: '', displayHeader: `Column ${cIdx + 1}`, autoSuggested: false };
      continue;
    }
    const lower = colName?.toLowerCase()?.trim();
    let matched = false;
    for (const [cargoKey, keywords] of Object.entries(KEYWORD_MAP)) {
      if (keywords?.some((kw) => lower?.includes(kw))) {
        mappings[cIdx] = { saveAs: cargoKey, customFieldName: '', sourceHeader: colName, displayHeader: colName, autoSuggested: true };
        matched = true;
        break;
      }
    }
    if (!matched) {
      mappings[cIdx] = { saveAs: 'new_field', customFieldName: colName, sourceHeader: colName, displayHeader: colName, autoSuggested: false };
    }
  }
  return mappings;
}

// When the headers don't give us a name/quantity (foreign or abbreviated
// headers like "DÉSIGNATION" / "QTE"), infer them from the data itself: the
// most text-heavy column is the name, a column of small whole numbers is the
// quantity. Without a name column, every row is dropped and nothing imports —
// so this fallback is what makes the smart import actually recognise items.
function inferColumnRolesFromData(table, headerRowIndex, columnMappings) {
  const rows = table?.rows || [];
  const colCount = rows.reduce((m, r) => Math.max(m, r?.length || 0), 0);
  const isInt = (v) => /^\d{1,5}$/.test((v || '').trim());
  const hasLetters = (v) => /[A-Za-zÀ-ÿ]/.test(v || '');

  const stats = [];
  for (let c = 0; c < colCount; c++) {
    let cells = 0, textCells = 0, intCells = 0, textLen = 0;
    rows.forEach((row, rIdx) => {
      if (rIdx === headerRowIndex) return;
      const v = (row?.[c] || '').trim();
      if (!v) return;
      cells++;
      if (hasLetters(v)) { textCells++; textLen += v.length; }
      if (isInt(v)) intCells++;
    });
    stats.push({ c, cells, textCells, intCells, avgLen: textCells ? textLen / textCells : 0 });
  }

  const has = (key) => Object.values(columnMappings).some((m) => m?.saveAs === key);
  const ensure = (c, saveAs) => {
    const base = columnMappings[c] || { customFieldName: '', sourceHeader: '', displayHeader: `Column ${c + 1}` };
    columnMappings[c] = { ...base, saveAs, autoSuggested: true };
  };

  // 1) Name — the most text-heavy column.
  if (!has('item_name')) {
    let best = null;
    stats.forEach((s) => {
      if (!s.cells) return;
      const textRatio = s.textCells / s.cells;
      const score = textRatio * s.avgLen;
      if (textRatio >= 0.5 && (!best || score > best.score)) best = { c: s.c, score };
    });
    if (best) ensure(best.c, 'item_name');
  }

  // 2) Quantity — a column of mostly small whole numbers (not the name col).
  if (!has('quantity')) {
    const nameCol = Object.entries(columnMappings).find(([, m]) => m?.saveAs === 'item_name')?.[0];
    let best = null;
    stats.forEach((s) => {
      if (!s.cells || String(s.c) === String(nameCol)) return;
      const intRatio = s.intCells / s.cells;
      const textRatio = s.textCells / s.cells;
      if (intRatio >= 0.6 && textRatio < 0.3 && (!best || intRatio > best.ratio)) best = { c: s.c, ratio: intRatio };
    });
    if (best) ensure(best.c, 'quantity');
  }

  return columnMappings;
}

function buildInitialTableState(table, index) {
  const headerRowIndex = autoDetectHeaderRow(table);
  const rowTypes = {};
  table?.rows?.forEach((_, rIdx) => {
    rowTypes[rIdx] = rIdx === headerRowIndex ? 'header' : 'data';
  });
  const headerRow = headerRowIndex !== null ? table?.rows?.[headerRowIndex] || [] : [];
  const columnMappings = autoDetectColumnMappings(headerRow);
  inferColumnRolesFromData(table, headerRowIndex, columnMappings);
  return {
    tableId: table?.id,
    pageNumber: table?.pageNumbers?.[0] || index + 1,
    included: true,
    reviewStatus: 'pending',
    headerRowIndex,
    rowTypes,
    columnMappings,
    applyMappingTemplateId: null,
    saveTo: '',
  };
}

/**
 * Build normalized rows for a table, injecting detected fill colors into the
 * colour core field (or custom field) when the cell text is blank.
 * Per-cell colour overrides (from user edits) take highest priority.
 */
function buildNormalizedRowsForTable(table, tableState, colorMap) {
  const { headerRowIndex, rowTypes, columnMappings, tableId, pageNumber, cellColourOverrides } = tableState;
  if (!table || headerRowIndex === null) return [];
  const headerRow = table?.rows?.[headerRowIndex] || [];
  const dataRows = table?.rows
    ?.map((row, rIdx) => ({ row, rIdx }))
    ?.filter(({ rIdx }) => {
      const type = rowTypes?.[rIdx] || 'data';
      return type === 'data' && rIdx !== headerRowIndex;
    });

  return dataRows?.map(({ row, rIdx }) => {
    const item = {};
    const sourceFields = {};
    row?.forEach((cell, cIdx) => {
      const mapping = columnMappings?.[cIdx] || { saveAs: 'new_field', customFieldName: '', sourceHeader: '', displayHeader: `Column ${cIdx + 1}`, autoSuggested: false };
      if (mapping?.saveAs === 'dont_import') return;

      const isColourMapped = mapping?.saveAs === 'colour';
      const isCoreField = CARGO_CORE_FIELDS?.some((f) => f?.key === mapping?.saveAs);

      let effectiveCell = cell;

      if (isColourMapped) {
        const override = cellColourOverrides?.[rIdx]?.[cIdx];
        if (override !== undefined && override !== null) {
          effectiveCell = override;
        } else {
          const detectedColor = colorMap?.[tableId]?.[rIdx]?.[cIdx];
          effectiveCell = detectedColor || cell || '';
        }
      }

      if (isCoreField) {
        item[mapping.saveAs] = effectiveCell;
      } else {
        const colLabel = mapping?.customFieldName?.trim() || mapping?.displayHeader || headerRow?.[cIdx] || `col_${cIdx + 1}`;
        sourceFields[colLabel] = effectiveCell;
      }
    });
    if (Object.keys(sourceFields)?.length > 0) item.source_fields = sourceFields;
    item._source_table_id = tableId;
    item._source_page = pageNumber;
    item._source_row_index = rIdx;
    return item;
  })?.filter((item) => {
    const coreVals = Object.entries(item)?.filter(([k, v]) => !k?.startsWith('_') && v && typeof v === 'string' && v?.trim());
    return coreVals?.length > 0;
  });
}

function detectSimilarTables(tables, tableStates) {
  const groups = [];
  const assigned = new Set();
  tables?.forEach((t, i) => {
    if (assigned?.has(t?.id)) return;
    const state = tableStates?.[t?.id];
    if (!state?.included) return;
    const group = [t?.id];
    assigned?.add(t?.id);
    tables?.forEach((t2, j) => {
      if (i === j || assigned?.has(t2?.id)) return;
      const state2 = tableStates?.[t2?.id];
      if (!state2?.included) return;
      if (t?.columnCount === t2?.columnCount) {
        const h1 = state?.headerRowIndex !== null ? t?.rows?.[state?.headerRowIndex] || [] : [];
        const h2 = state2?.headerRowIndex !== null ? t2?.rows?.[state2?.headerRowIndex] || [] : [];
        let matches = h1?.filter((cell, idx) => cell?.toLowerCase()?.trim() === h2?.[idx]?.toLowerCase()?.trim())?.length;
        const similarity = h1?.length > 0 ? matches / h1?.length : 0;
        if (similarity >= 0.6) {
          group?.push(t2?.id);
          assigned?.add(t2?.id);
        }
      }
    });
    if (group?.length > 1) groups?.push(group);
  });
  return groups;
}

// ---------------------------------------------------------------------------
// Step Indicator
// ---------------------------------------------------------------------------
function StepIndicator({ currentStep, steps = STEPS }) {
  return (
    <div className="azi-steps">
      {steps?.map((step, idx) => (
        <React.Fragment key={step?.id}>
          <div className={`azi-step${currentStep === step?.id ? ' is-active' : currentStep > step?.id ? ' is-done' : ''}`}>
            <div className="azi-step-dot">
              {currentStep > step?.id ? <Icon name="Check" size={12} /> : step?.id}
            </div>
            <span className="azi-step-label">{step?.label}</span>
          </div>
          {idx < steps?.length - 1 && (
            <div className={`azi-step-conn${currentStep > step?.id ? ' is-done' : ''}`} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 1: Upload
// ---------------------------------------------------------------------------
function UploadStep({ onFileUploaded, parseError, isLoading }) {
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileError, setFileError] = useState(null);
  const fileInputRef = useRef(null);

  // Azure Document Intelligence (prebuilt-layout, v4.0) reads PDFs, Excel
  // workbooks (.xlsx) and image scans — but not .csv. Reject anything else
  // with a visible message instead of silently doing nothing (which read as
  // "the upload is broken").
  const SUPPORTED_EXTS = ['pdf', 'xlsx', 'png', 'jpg', 'jpeg', 'tiff', 'bmp'];

  const handleFile = (file) => {
    if (!file) return;
    const ext = file?.name?.split('.')?.pop()?.toLowerCase();
    if (!SUPPORTED_EXTS.includes(ext)) {
      setSelectedFile(null);
      setFileError(
        `Sorry, we can’t read .${ext || 'that'} files here. Upload a PDF, an Excel spreadsheet (.xlsx), or a photo/scan (PNG, JPG, TIFF or BMP).`,
      );
      return;
    }
    setFileError(null);
    setSelectedFile(file);
  };

  return (
    <div className="space-y-4">
      <div
        className={`azi-drop${dragOver ? ' is-drag' : ''}`}
        onDragOver={(e) => { e?.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e?.preventDefault(); setDragOver(false); handleFile(e?.dataTransfer?.files?.[0]); }}
        onClick={() => fileInputRef?.current?.click()}
      >
        <input ref={fileInputRef} type="file" accept=".pdf,.xlsx,.png,.jpg,.jpeg,.tiff,.bmp" className="hidden"
          onChange={(e) => handleFile(e?.target?.files?.[0])} />
        <div className="azi-drop-icn">
          <Icon name="FileText" size={24} />
        </div>
        <p className="azi-drop-title">{selectedFile ? selectedFile?.name : 'Drop your document here'}</p>
        <p className="azi-drop-sub">
          {selectedFile
            ? `${(selectedFile?.size / 1024)?.toFixed(1)} KB — click to choose a different file`
            : 'Upload a PDF, Excel (.xlsx), or a photo / scan to import inventory'}
        </p>
        {!selectedFile && (
          <span className="azi-drop-browse"><Icon name="FolderOpen" size={14} />Browse files</span>
        )}
      </div>
      {(fileError || parseError) && (
        <div className="azi-err">
          <Icon name="AlertCircle" size={16} className="flex-shrink-0 mt-0.5" />
          <span>{fileError || parseError}</span>
        </div>
      )}
      <div className="flex justify-end">
        <button className="azi-primary" disabled={!selectedFile || isLoading} onClick={() => selectedFile && onFileUploaded(selectedFile)}>
          {isLoading ? (
            <><LogoSpinner size={16} />Reading your document…</>
          ) : (
            <><Icon name="ArrowRight" size={16} />Continue</>
          )}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2: Multi-Table Session Overview
// ---------------------------------------------------------------------------
function TableSessionStep({ tables, tableStates, onToggleInclude, onNext, onBack, similarGroups }) {
  const includedCount = Object.values(tableStates)?.filter((s) => s?.included)?.length;

  return (
    <div>
      {/* Intro note — hairline, not a boxed banner */}
      <div className="azi-note">
        <Icon name="Layers" size={18} className="azi-note-icn" />
        <div>
          <p className="azi-note-t">
            We found {tables?.length} table{tables?.length !== 1 ? 's' : ''} in this document
          </p>
          <p className="azi-note-s">
            Everything is included by default. Switch off anything you don’t want to bring in.
          </p>
        </div>
      </div>
      {/* Similarity hint */}
      {similarGroups?.length > 0 && (
        <div className="azi-tip">
          <Icon name="Lightbulb" size={14} className="ic" />
          <span>
            {similarGroups?.map((g) => `Tables ${g?.map((id) => {
              const idx = tables?.findIndex((t) => t?.id === id);
              return idx + 1;
            })?.join(', ')}`)?.join(' and ')} look the same — we’ll set them up together in the next step.
          </span>
        </div>
      )}
      {/* Table list */}
      <div className="azi-rows">
        {tables?.map((table, idx) => {
          const state = tableStates?.[table?.id];
          const pages = table?.pageNumbers?.length
            ? `Page${table?.pageNumbers?.length > 1 ? 's' : ''} ${table?.pageNumbers?.join(', ')}`
            : `Table ${idx + 1}`;
          const isIncluded = state?.included;

          return (
            <div key={table?.id} className={`azi-row${isIncluded ? '' : ' off'}`}>
              <button
                onClick={() => onToggleInclude(table?.id)}
                className={`azi-toggle ${isIncluded ? 'on' : 'off'}`}
                aria-label={isIncluded ? 'Exclude this table' : 'Include this table'}
              >
                <span className="knob" />
              </button>
              <div className="azi-row-main">
                <div className="azi-row-t">
                  <Icon name="Table" size={13} className="azi-row-icn" />
                  <span className="nm">Table {idx + 1}</span>
                  <span className="pg">— {pages}</span>
                </div>
                <p className="azi-row-s">{table?.rowCount} rows × {table?.columnCount} columns</p>
              </div>
              <span className={`azi-chip ${isIncluded ? 'inc' : 'exc'}`}>
                {isIncluded ? 'Included' : 'Excluded'}
              </span>
            </div>
          );
        })}
      </div>
      <div className="azi-foot">
        <button className="azi-ghost" onClick={onBack}>
          <Icon name="ArrowLeft" size={16} />Back
        </button>
        <div className="azi-foot-r">
          <span className="azi-foot-count">{includedCount} of {tables?.length} selected</span>
          <button className="azi-primary" onClick={onNext} disabled={includedCount === 0}>
            Continue<Icon name="ArrowRight" size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Color swatch helper
// ---------------------------------------------------------------------------
const COLOR_SWATCH_MAP = {
  'Yellow':                  'bg-yellow-400',
  'Light Blue':              'bg-sky-300',
  'Red':                     'bg-red-500',
  'Dark Purple':             'bg-purple-900',
  'Mustard / Gold':          'bg-yellow-600',
  'Green':                   'bg-green-600',
  'Cream / Beige':           'bg-amber-100 border border-amber-300',
  'Light Purple / Lavender': 'bg-purple-300',
  'Teal / Turquoise':        'bg-teal-400',
  'Black':                   'bg-gray-900',
};

function ColorSwatch({ label }) {
  if (!label) return null;
  const cls = COLOR_SWATCH_MAP?.[label] || 'bg-muted';
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <span className={`w-3 h-3 rounded-full flex-shrink-0 ${cls}`} />
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Step 3: Per-Table Review (sidebar + main panel)
// ---------------------------------------------------------------------------
function PerTableReviewStep({ tables, tableStates, onTableStateChange, onNext, onBack, similarGroups, colorMap, isColorDetecting }) {
  const includedTables = tables?.filter((t) => tableStates?.[t?.id]?.included);
  const [activeTableId, setActiveTableId] = useState(includedTables?.[0]?.id || null);
  const [validationErrors, setValidationErrors] = useState({});

  const activeTable = tables?.find((t) => t?.id === activeTableId);
  const activeState = tableStates?.[activeTableId];
  const activeIdx = includedTables?.findIndex((t) => t?.id === activeTableId);

  const handleRowTypeChange = (rIdx, type) => {
    const prev = activeState?.rowTypes || {};
    const next = { ...prev, [rIdx]: type };
    if (type === 'header') {
      Object.keys(next)?.forEach((k) => { if (next?.[k] === 'header' && parseInt(k) !== rIdx) next[k] = 'data'; });
      const headerRow = activeTable?.rows?.[rIdx] || [];
      onTableStateChange(activeTableId, {
        ...activeState,
        rowTypes: next,
        headerRowIndex: rIdx,
        columnMappings: autoDetectColumnMappings(headerRow),
        reviewStatus: 'reviewing',
      });
    } else {
      const newHeaderIdx = activeState?.headerRowIndex === rIdx ? null : activeState?.headerRowIndex;
      onTableStateChange(activeTableId, { ...activeState, rowTypes: next, headerRowIndex: newHeaderIdx, reviewStatus: 'reviewing' });
    }
  };

  const handleHeaderRowSelect = (rIdx) => {
    const prev = activeState?.rowTypes || {};
    const next = { ...prev };
    Object.keys(next)?.forEach((k) => { if (next?.[k] === 'header') next[k] = 'data'; });
    next[rIdx] = 'header';
    const headerRow = activeTable?.rows?.[rIdx] || [];
    onTableStateChange(activeTableId, {
      ...activeState,
      rowTypes: next,
      headerRowIndex: rIdx,
      columnMappings: autoDetectColumnMappings(headerRow),
      reviewStatus: 'reviewing',
    });
  };

  const handleColumnMappingChange = (cIdx, mapping) => {
    onTableStateChange(activeTableId, {
      ...activeState,
      columnMappings: { ...activeState?.columnMappings, [cIdx]: mapping },
      reviewStatus: 'reviewing',
    });
    setValidationErrors((prev) => { const n = { ...prev }; delete n?.[cIdx]; return n; });
  };

  // Handle per-cell colour override
  const handleCellColourOverride = (rIdx, cIdx, value) => {
    const prev = activeState?.cellColourOverrides || {};
    const prevRow = prev?.[rIdx] || {};
    onTableStateChange(activeTableId, {
      ...activeState,
      cellColourOverrides: {
        ...prev,
        [rIdx]: { ...prevRow, [cIdx]: value },
      },
      reviewStatus: 'reviewing',
    });
  };

  const handleMarkMapped = () => {
    const { headerRowIndex, columnMappings } = activeState || {};
    if (headerRowIndex === null || headerRowIndex === undefined) return;
    const colCount = Math.max(...(activeTable?.rows?.map((r) => r?.length || 0)));
    const errors = {};
    for (let cIdx = 0; cIdx < colCount; cIdx++) {
      const mapping = columnMappings?.[cIdx] || { saveAs: 'new_field' };
      if (mapping?.saveAs === 'new_field' && !mapping?.customFieldName?.trim()) errors[cIdx] = 'Enter a field name';
    }
    if (Object.keys(errors)?.length > 0) { setValidationErrors(errors); return; }
    setValidationErrors({});
    onTableStateChange(activeTableId, { ...activeState, reviewStatus: 'mapped' });
    const nextPending = includedTables?.find((t, i) => i > activeIdx && tableStates?.[t?.id]?.reviewStatus !== 'mapped' && tableStates?.[t?.id]?.reviewStatus !== 'skipped');
    if (nextPending) setActiveTableId(nextPending?.id);
  };

  const handleSkipTable = () => {
    onTableStateChange(activeTableId, { ...activeState, reviewStatus: 'skipped', included: false });
    const next = includedTables?.find((t, i) => i > activeIdx);
    if (next) setActiveTableId(next?.id);
  };

  const handleApplyToSimilar = () => {
    const group = similarGroups?.find((g) => g?.includes(activeTableId));
    if (!group) return;
    group?.forEach((tid) => {
      if (tid === activeTableId) return;
      const targetState = tableStates?.[tid];
      if (!targetState) return;
      onTableStateChange(tid, {
        ...targetState,
        columnMappings: { ...activeState?.columnMappings },
        headerRowIndex: activeState?.headerRowIndex,
        reviewStatus: 'mapped',
        applyMappingTemplateId: activeTableId,
      });
    });
  };

  // Find the last mapped table before the current one (or any mapped table)
  const lastMappedTable = useMemo(() => {
    // First try tables before current in order
    const beforeCurrent = includedTables?.slice(0, activeIdx)?.reverse()?.find(
      (t) => tableStates?.[t?.id]?.reviewStatus === 'mapped'
    );
    if (beforeCurrent) return beforeCurrent;
    // Fall back to any other mapped table
    return includedTables?.find(
      (t) => t?.id !== activeTableId && tableStates?.[t?.id]?.reviewStatus === 'mapped'
    ) || null;
  }, [includedTables, activeIdx, activeTableId, tableStates]);

  const handleCopyLastMapping = () => {
    if (!lastMappedTable) return;
    const sourceState = tableStates?.[lastMappedTable?.id];
    if (!sourceState) return;
    onTableStateChange(activeTableId, {
      ...activeState,
      columnMappings: { ...sourceState?.columnMappings },
      headerRowIndex: sourceState?.headerRowIndex,
      reviewStatus: 'reviewing',
      applyMappingTemplateId: lastMappedTable?.id,
    });
  };

  const allMappedOrSkipped = includedTables?.every((t) => {
    const s = tableStates?.[t?.id];
    return s?.reviewStatus === 'mapped' || s?.reviewStatus === 'skipped';
  });

  const colCount = useMemo(() => {
    if (!activeTable?.rows?.length) return 0;
    return Math.max(...(activeTable?.rows?.map((r) => r?.length || 0)));
  }, [activeTable]);

  const headerRow = activeState?.headerRowIndex !== null && activeState?.headerRowIndex !== undefined
    ? activeTable?.rows?.[activeState?.headerRowIndex] : null;

  const similarGroup = similarGroups?.find((g) => g?.includes(activeTableId));
  const hasSimilar = similarGroup && similarGroup?.length > 1;

  // Determine which columns are mapped to 'colour'
  const colourColumnIndices = useMemo(() => {
    if (!activeState?.columnMappings) return new Set();
    const s = new Set();
    Object.entries(activeState?.columnMappings)?.forEach(([cIdx, mapping]) => {
      if (mapping?.saveAs === 'colour') s?.add(parseInt(cIdx));
    });
    return s;
  }, [activeState?.columnMappings]);

  return (
    <div className="flex gap-4 min-h-0">
      {/* Sidebar: table list */}
      <div className="w-44 flex-shrink-0 space-y-1.5 overflow-y-auto max-h-[520px]">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1 mb-2">Tables</p>
        {includedTables?.map((t, idx) => {
          const s = tableStates?.[t?.id];
          const cfg = REVIEW_STATUS_CONFIG?.[s?.reviewStatus] || REVIEW_STATUS_CONFIG?.pending;
          const isActive = t?.id === activeTableId;
          return (
            <button
              key={t?.id}
              onClick={() => setActiveTableId(t?.id)}
              className={`w-full text-left px-3 py-2.5 rounded-xl border transition-all ${
                isActive ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30 hover:bg-muted/20'
              }`}
            >
              <p className={`text-xs font-medium ${isActive ? 'text-primary' : 'text-foreground'}`}>Table {tables?.findIndex((tt) => tt?.id === t?.id) + 1}</p>
              <p className="text-xs text-muted-foreground">{t?.rowCount}r × {t?.columnCount}c</p>
              <span className={`inline-flex items-center gap-1 text-xs mt-1 px-1.5 py-0.5 rounded-full ${cfg?.color}`}>
                <Icon name={cfg?.icon} size={10} />
                {cfg?.label}
              </span>
            </button>
          );
        })}
      </div>
      {/* Main panel */}
      <div className="flex-1 min-w-0 space-y-4 overflow-y-auto max-h-[520px]">
        {activeTable && activeState ? (
          <>
            {/* Table header */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-foreground">
                  Table {tables?.findIndex((t) => t?.id === activeTableId) + 1}
                  <span className="text-muted-foreground font-normal ml-2 text-xs">
                    — Page {activeState?.pageNumber} · {activeTable?.rowCount} rows × {activeTable?.columnCount} cols
                  </span>
                </p>
              </div>
              <div className="flex items-center gap-2">
                {isColorDetecting && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <LogoSpinner size={12} />
                    Detecting fill colours…
                  </span>
                )}
                {lastMappedTable && (
                  <Button variant="outline" size="sm" onClick={handleCopyLastMapping} className="gap-1.5 text-xs">
                    <Icon name="ClipboardCopy" size={12} />
                    Copy Table {tables?.findIndex((t) => t?.id === lastMappedTable?.id) + 1} mapping
                  </Button>
                )}
                {hasSimilar && (
                  <Button variant="outline" size="sm" onClick={handleApplyToSimilar} className="gap-1.5 text-xs">
                    <Icon name="Copy" size={12} />
                    Apply mapping to {similarGroup?.length - 1} similar table{similarGroup?.length - 1 !== 1 ? 's' : ''}
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={handleSkipTable} className="gap-1.5 text-xs text-muted-foreground">
                  <Icon name="SkipForward" size={12} />
                  Skip
                </Button>
              </div>
            </div>

            {/* Applied template notice */}
            {activeState?.applyMappingTemplateId && (
              <div className="flex items-center gap-2 p-2.5 bg-primary/5 border border-primary/20 rounded-xl text-xs text-primary">
                <Icon name="Link" size={12} />
                Mapping applied from Table {tables?.findIndex((t) => t?.id === activeState?.applyMappingTemplateId) + 1}
                <button className="ml-auto underline" onClick={() => onTableStateChange(activeTableId, { ...activeState, applyMappingTemplateId: null })}>
                  Override
                </button>
              </div>
            )}

            {/* Row type assignment */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Icon name="Rows" size={13} className="text-primary" />
                <p className="text-xs font-semibold text-foreground">Mark Row Types</p>
              </div>
              <div className="border border-border rounded-xl overflow-auto max-h-52">
                <table className="text-xs w-full border-collapse">
                  <tbody>
                    {activeTable?.rows?.map((row, rIdx) => {
                      const rowType = activeState?.rowTypes?.[rIdx] || 'data';
                      const isHeader = rIdx === activeState?.headerRowIndex;
                      return (
                        <tr key={rIdx} className={`transition-colors ${isHeader ? 'bg-primary/5' : rowType === 'ignore' ? 'opacity-40' : 'hover:bg-muted/20'}`}>
                          <td className="px-2 py-1 border-r border-border w-7 text-center text-muted-foreground font-mono select-none text-xs">{rIdx + 1}</td>
                          <td className="px-2 py-1 border-r border-border w-28">
                            <select value={rowType} onChange={(e) => handleRowTypeChange(rIdx, e?.target?.value)}
                              className="text-xs border border-border/60 rounded px-1.5 py-0.5 bg-card text-foreground focus:outline-none w-full">
                              {ROW_TYPES?.map((t) => <option key={t?.value} value={t?.value}>{t?.label}</option>)}
                            </select>
                          </td>
                          {row?.map((cell, cIdx) => {
                            const isColourCol = colourColumnIndices?.has(cIdx);
                            const detectedColor = colorMap?.[activeTableId]?.[rIdx]?.[cIdx];
                            const override = activeState?.cellColourOverrides?.[rIdx]?.[cIdx];
                            // Effective colour value: override > detected > cell text
                            const effectiveColour = isColourCol
                              ? (override !== undefined && override !== null ? override : (detectedColor || cell || ''))
                              : null;

                            if (isColourCol && rowType !== 'header') {
                              // Render editable colour cell with dot+text
                              return (
                                <td key={cIdx} className="px-2 py-1 border-r border-b border-border/50 min-w-[120px]">
                                  <div className="flex items-center gap-1.5">
                                    {effectiveColour && (
                                      <span className={`w-3 h-3 rounded-full flex-shrink-0 ${COLOR_SWATCH_MAP?.[effectiveColour] || 'bg-muted'}`} />
                                    )}
                                    <input
                                      type="text"
                                      value={override !== undefined && override !== null ? override : (detectedColor || cell || '')}
                                      onChange={(e) => handleCellColourOverride(rIdx, cIdx, e?.target?.value)}
                                      placeholder="None"
                                      className="text-xs border border-border/60 rounded px-1.5 py-0.5 bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30 w-24"
                                    />
                                  </div>
                                </td>
                              );
                            }

                            return (
                              <td key={cIdx} className="px-2 py-1 border-r border-b border-border/50 text-foreground whitespace-nowrap max-w-[140px] truncate" title={cell}>
                                <div className="flex items-center gap-1">
                                  {cell || <span className="text-muted-foreground/30">—</span>}
                                  {!cell?.trim() && detectedColor && !isColourCol && (
                                    <ColorSwatch label={detectedColor} />
                                  )}
                                </div>
                              </td>
                            );
                          })}
                          <td className="px-2 py-1 w-20">
                            {rowType !== 'header' ? (
                              <button onClick={() => handleHeaderRowSelect(rIdx)} className="text-xs text-primary hover:underline whitespace-nowrap">Set header</button>
                            ) : (
                              <span className="text-xs font-medium text-primary">✓ Header</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Column mapping */}
            {headerRow ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Icon name="Columns" size={13} className="text-primary" />
                  <p className="text-xs font-semibold text-foreground">Map Columns</p>
                  <span className="text-xs text-muted-foreground ml-auto">{colCount} columns</span>
                </div>
                <div className="border border-border rounded-xl overflow-hidden">
                  <div className="divide-y divide-border max-h-56 overflow-y-auto">
                    {Array.from({ length: colCount }, (_, cIdx) => {
                      const sourceHeader = headerRow?.[cIdx] || '';
                      const displayHeader = sourceHeader?.trim() ? sourceHeader : `Column ${cIdx + 1}`;
                      const isBlank = !sourceHeader?.trim();
                      const mapping = activeState?.columnMappings?.[cIdx] || { saveAs: 'new_field', customFieldName: '', sourceHeader, displayHeader };
                      const hasError = validationErrors?.[cIdx];

                      // Check if this column has any detected fill colors (for hint only)
                      const hasDetectedFills = !isColorDetecting && (() => {
                        const tableColors = colorMap?.[activeTableId];
                        if (!tableColors) return false;
                        return Object.entries(tableColors)?.some(([rIdx, rowColors]) => {
                          const rowType = activeState?.rowTypes?.[rIdx] || 'data';
                          return rowType === 'data' && rowColors?.[cIdx];
                        });
                      })();

                      const isCreateNew = mapping?.saveAs === 'new_field';
                      const isDontImport = mapping?.saveAs === 'dont_import';

                      return (
                        <div key={cIdx} className={`px-3 py-2.5 hover:bg-muted/20 transition-colors ${hasError ? 'bg-destructive/5' : ''} ${isDontImport ? 'opacity-50' : ''}`}>
                          <div className="flex items-start gap-3">
                            {/* Column name */}
                            <div className="flex-1 min-w-0 pt-0.5">
                              <div className="flex items-center gap-1.5">
                                <p className="text-xs font-medium text-foreground truncate">{displayHeader}</p>
                                {mapping?.autoSuggested && !isDontImport && (
                                  <span className="text-xs px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium flex-shrink-0">Suggested</span>
                                )}
                              </div>
                              {isBlank ? (
                                <p className="text-xs text-amber-600 mt-0.5">No header detected in source document</p>
                              ) : (
                                <p className="text-xs text-muted-foreground">Col {cIdx + 1}</p>
                              )}
                              {/* Colour detection hint — column-level only, no single dominant color */}
                              {hasDetectedFills && !isDontImport && (
                                <div className="flex items-center gap-1 mt-1">
                                  <Icon name="Palette" size={10} className="text-muted-foreground" />
                                  <span className="text-xs text-muted-foreground">Contains fill-color values</span>
                                </div>
                              )}
                            </div>

                            {/* Save as control */}
                            <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                              <div className="flex flex-col items-end gap-1">
                                <label className="text-xs text-muted-foreground font-medium">Save as</label>
                                <select
                                  value={mapping?.saveAs || 'new_field'}
                                  onChange={(e) => {
                                    const newSaveAs = e?.target?.value;
                                    handleColumnMappingChange(cIdx, {
                                      ...mapping,
                                      saveAs: newSaveAs,
                                      customFieldName: newSaveAs === 'new_field' ? (mapping?.customFieldName || (isBlank ?'' : sourceHeader))
                                        : mapping?.customFieldName,
                                      autoSuggested: false,
                                      sourceHeader,
                                      displayHeader,
                                    });
                                  }}
                                  className="text-xs border border-border/60 rounded-lg px-2 py-1 bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30 min-w-[160px]"
                                >
                                  {CARGO_CORE_FIELDS?.map((f) => (
                                    <option key={f?.key} value={f?.key}>{f?.label}</option>
                                  ))}
                                  <option disabled>──────────</option>
                                  <option value="new_field">+ Create new field</option>
                                  <option value="dont_import">Don't import</option>
                                </select>
                              </div>

                              {/* Inline input for "Create new field" */}
                              {isCreateNew && (
                                <div>
                                  <input
                                    type="text"
                                    value={mapping?.customFieldName || ''}
                                    onChange={(e) => handleColumnMappingChange(cIdx, { ...mapping, customFieldName: e?.target?.value, sourceHeader, displayHeader })}
                                    placeholder={isBlank ? 'e.g. Expiry Date' : `e.g. ${sourceHeader}`}
                                    className={`text-xs border rounded-lg px-2 py-1 bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30 w-40 ${hasError ? 'border-destructive' : 'border-border'}`}
                                  />
                                  {hasError && <p className="text-xs text-destructive mt-0.5 text-right">{hasError}</p>}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs text-amber-700">
                <Icon name="AlertTriangle" size={14} className="flex-shrink-0 mt-0.5" />
                <span>Mark a row as the header row to enable column mapping.</span>
              </div>
            )}

            {/* Mark mapped button */}
            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center gap-2">
                {activeIdx > 0 && (
                  <Button variant="outline" size="sm" onClick={() => setActiveTableId(includedTables?.[activeIdx - 1]?.id)} className="gap-1.5 text-xs">
                    <Icon name="ChevronLeft" size={12} />Prev
                  </Button>
                )}
                {activeIdx < includedTables?.length - 1 && (
                  <Button variant="outline" size="sm" onClick={() => setActiveTableId(includedTables?.[activeIdx + 1]?.id)} className="gap-1.5 text-xs">
                    Next<Icon name="ChevronRight" size={12} />
                  </Button>
                )}
              </div>
              <Button size="sm" onClick={handleMarkMapped} disabled={activeState?.headerRowIndex === null || activeState?.headerRowIndex === undefined} className="gap-1.5">
                <Icon name="CheckCircle2" size={14} />
                {activeState?.reviewStatus === 'mapped' ? 'Re-confirm Mapping' : 'Confirm Mapping'}
              </Button>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
            Select a table from the sidebar
          </div>
        )}
      </div>
      {/* Bottom nav — outside the scrollable area */}
      <div className="absolute bottom-0 left-0 right-0 px-6 py-4 border-t border-border bg-card flex items-center justify-between">
        <Button variant="outline" onClick={onBack} className="gap-2">
          <Icon name="ArrowLeft" size={16} />Back
        </Button>
        <div className="flex items-center gap-3">
          {!allMappedOrSkipped && (
            <span className="text-xs text-amber-600 flex items-center gap-1">
              <Icon name="AlertTriangle" size={12} />
              {includedTables?.filter((t) => tableStates?.[t?.id]?.reviewStatus === 'pending' || tableStates?.[t?.id]?.reviewStatus === 'reviewing')?.length} table{includedTables?.filter((t) => tableStates?.[t?.id]?.reviewStatus === 'pending' || tableStates?.[t?.id]?.reviewStatus === 'reviewing')?.length !== 1 ? 's' : ''} not yet confirmed
            </span>
          )}
          <Button onClick={onNext} className="gap-2">
            Preview Import
            <Icon name="ArrowRight" size={16} />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Grouping helpers (used by import logic)
// ---------------------------------------------------------------------------

// Auto-detection helpers for section rows
const SECTION_DATA_COLUMN_KEYWORDS = [
  'qty', 'quantity', 'item', 'name', 'description', 'code', 'sku', 'unit',
  'size', 'brand', 'supplier', 'notes', 'colour', 'color', 'batch', 'expiry',
  'price', 'cost', 'ref', 'no.', 'number', 'type', 'category',
];

function sectionLooksLikeGroupLabel(text) {
  if (!text || text?.length > 80) return false;
  const t = text?.trim();
  if (!t) return false;
  const lower = t?.toLowerCase();
  if (SECTION_DATA_COLUMN_KEYWORDS?.some((kw) => lower === kw || lower?.startsWith(kw + ' '))) return false;
  const numericRatio = (t?.match(/\d/g) || [])?.length / t?.length;
  if (numericRatio > 0.5) return false;
  const hasLetters = /[a-zA-Z]/?.test(t);
  if (!hasLetters) return false;
  const startsCapital = /^[A-Z]/?.test(t);
  const isAllCaps = t === t?.toUpperCase() && hasLetters;
  return startsCapital || isAllCaps;
}

function sectionIsGroupRow(row, totalColumns) {
  if (!row || row?.length === 0) return false;
  const nonBlank = row?.filter((c) => c?.trim());
  if (nonBlank?.length === 0) return false;
  if (nonBlank?.length / Math.max(totalColumns, row?.length) > 0.4) return false;
  const firstNonBlank = row?.find((c) => c?.trim()) || '';
  return sectionLooksLikeGroupLabel(firstNonBlank);
}

function sectionIsMergedTitleRow(row, totalColumns) {
  if (!row) return false;
  const nonBlank = row?.filter((c) => c?.trim());
  if (nonBlank?.length !== 1) return false;
  if (totalColumns > 2 && nonBlank?.length / totalColumns > 0.3) return false;
  return sectionLooksLikeGroupLabel(nonBlank?.[0]);
}

/**
 * Collect group rows from a table for import — uses manually marked rows first,
 * then falls back to auto-detection if none are manually marked.
 */
function collectGroupRowsForImport(table, tableState) {
  if (!table || !tableState) return [];
  const { headerRowIndex, rowTypes } = tableState;
  const rows = table?.rows || [];
  const totalColumns = table?.columnCount || Math.max(...rows?.map((r) => r?.length || 0), 1);

  const manualGroupRows = [];
  rows?.forEach((row, rIdx) => {
    if (rIdx === headerRowIndex) return;
    const type = rowTypes?.[rIdx] || 'data';
    if (type === 'group') {
      const label = row?.find((c) => (c || '')?.trim())?.trim() || '';
      if (label) manualGroupRows?.push({ rIdx, label });
    }
  });

  if (manualGroupRows?.length > 0) return manualGroupRows;

  const autoGroupRows = [];
  rows?.forEach((row, rIdx) => {
    if (rIdx === headerRowIndex) return;
    const type = rowTypes?.[rIdx] || 'data';
    if (type === 'ignore') return;
    const merged = sectionIsMergedTitleRow(row, totalColumns);
    const group = sectionIsGroupRow(row, totalColumns);
    if (merged || group) {
      const label = row?.find((c) => (c || '')?.trim())?.trim() || '';
      if (label) autoGroupRows?.push({ rIdx, label });
    }
  });

  return autoGroupRows;
}

// ---------------------------------------------------------------------------
// Column-based grouping detection for import
// ---------------------------------------------------------------------------

const IMPORT_GROUPING_COLUMN_KEYWORDS = [
  'bag', 'kit', 'pack', 'case', 'box', 'container', 'section', 'category',
  'module', 'group', 'type', 'class', 'department', 'area', 'zone', 'location',
];

function isImportGroupingColumnHeader(header) {
  if (!header) return false;
  const lower = header?.toLowerCase()?.trim();
  return IMPORT_GROUPING_COLUMN_KEYWORDS?.some((kw) => lower?.includes(kw));
}

/**
 * Detect columns in a table that look like grouping columns (bag name, category).
 * Returns an array of { colIdx, header, uniqueValues, cardinality } sorted by
 * cardinality ascending (fewest unique values first = broadest grouping = L3).
 */
function detectColumnGroupingForImport(table, tableState) {
  if (!table || !tableState) return [];
  const { headerRowIndex, rowTypes } = tableState;
  if (headerRowIndex === null || headerRowIndex === undefined) return [];

  const rows = table?.rows || [];
  const headerRow = rows?.[headerRowIndex] || [];

  const dataRows = rows?.filter((_, rIdx) => {
    const type = rowTypes?.[rIdx] || 'data';
    return type === 'data' && rIdx !== headerRowIndex;
  });

  if (dataRows?.length === 0) return [];

  const candidates = [];

  headerRow?.forEach((header, colIdx) => {
    if (!header?.trim()) return;

    const values = dataRows?.map((row) => (row?.[colIdx] || '')?.trim())?.filter(Boolean);

    if (values?.length === 0) return;

    const coverage = values?.length / dataRows?.length;
    const hasKeyword = isImportGroupingColumnHeader(header);

    // For keyword columns (e.g. "Bag Name", "Category"), be more lenient with coverage
    const minCoverage = hasKeyword ? 0.3 : 0.5;
    if (coverage < minCoverage) return;

    const uniqueValues = [...new Set(values)];
    const cardinality = uniqueValues?.length;

    if (cardinality < 2) return;
    // For keyword columns allow higher cardinality (up to 60% of rows); otherwise 40%
    const maxCardinalityRatio = hasKeyword ? 0.6 : 0.4;
    if (cardinality > dataRows?.length * maxCardinalityRatio) return;

    const labelLike = uniqueValues?.filter((v) => /[a-zA-Z]/?.test(v));
    if (labelLike?.length / uniqueValues?.length < 0.7) return;

    candidates?.push({ colIdx, header, uniqueValues, cardinality, coverage, hasKeyword });
  });

  candidates?.sort((a, b) => {
    if (a?.hasKeyword !== b?.hasKeyword) return a?.hasKeyword ? -1 : 1;
    return a?.cardinality - b?.cardinality;
  });

  return candidates;
}

/**
 * Build a nested section tree from column values in data rows.
 * Uses up to 2 grouping columns: L3 (bag/container) and L4 (category).
 * Each node includes colIdx and colValue for row routing.
 *
 * Returns: [{ label, colIdx, children: [...] }]
 */
function buildColumnBasedSectionTreeForImport(table, tableState) {
  if (!table || !tableState) return [];
  const { headerRowIndex, rowTypes } = tableState;
  if (headerRowIndex === null || headerRowIndex === undefined) return [];

  const groupingCols = detectColumnGroupingForImport(table, tableState);
  if (groupingCols?.length === 0) return [];

  const rows = table?.rows || [];
  const l3Col = groupingCols?.[0];
  const l4Col = groupingCols?.length > 1 ? groupingCols?.[1] : null;

  // Build tree: collect unique L3 values, then unique L4 values per L3
  const l3Map = new Map(); // l3Value → Set of l4Values

  rows?.forEach((row, rIdx) => {
    const type = rowTypes?.[rIdx] || 'data';
    if (type !== 'data' || rIdx === headerRowIndex) return;

    const l3Val = (row?.[l3Col?.colIdx] || '')?.trim();
    if (!l3Val) return;

    if (!l3Map?.has(l3Val)) l3Map?.set(l3Val, new Set());

    if (l4Col) {
      const l4Val = (row?.[l4Col?.colIdx] || '')?.trim();
      if (l4Val) l3Map?.get(l3Val)?.add(l4Val);
    }
  });

  const tree = [];
  l3Map?.forEach((l4Set, l3Val) => {
    const children = [];
    l4Set?.forEach((l4Val) => {
      children?.push({ label: l4Val, colIdx: l4Col?.colIdx, children: [] });
    });
    tree?.push({ label: l3Val, colIdx: l3Col?.colIdx, children });
  });

  return tree;
}

/**
 * Build a nested section tree from group-typed rows in a table.
 * Tries column-based detection first (more reliable for tables with bag name columns),
 * then falls back to structural group row detection.
 *
 * Returns: [{ label, rIdx?, colIdx?, children: [...] }]
 */
function buildSectionTreeForImport(table, tableState) {
  if (!table || !tableState) return [];
  const { headerRowIndex } = tableState;
  if (headerRowIndex === null || headerRowIndex === undefined) return [];

  // ── Primary: try column-based grouping detection ──
  const columnTree = buildColumnBasedSectionTreeForImport(table, tableState);
  if (columnTree?.length > 0) return columnTree;

  // ── Fallback: structural group row detection ──
  const groupRows = collectGroupRowsForImport(table, tableState);
  if (groupRows?.length === 0) return [];

  const rows = table?.rows || [];
  const totalRows = rows?.length || 0;

  const groupRowsWithMeta = groupRows?.map((g) => {
    const row = rows?.[g?.rIdx] || [];
    const firstNonBlankCol = row?.findIndex((c) => (c || '')?.trim() !== '');
    return { ...g, col: firstNonBlankCol === -1 ? 0 : firstNonBlankCol };
  });

  const uniqueCols = [...new Set(groupRowsWithMeta?.map((g) => g?.col))]?.sort((a, b) => a - b);
  const colToDepth = {};
  uniqueCols?.forEach((col, idx) => { colToDepth[col] = idx; });

  let depths;

  if (uniqueCols?.length === 1) {
    const rawSpans = groupRowsWithMeta?.map((g, i) => {
      const nextGroupRIdx = groupRowsWithMeta?.[i + 1]?.rIdx ?? totalRows;
      let count = 0;
      for (let r = g?.rIdx + 1; r < nextGroupRIdx; r++) {
        const type = tableState?.rowTypes?.[r] || 'data';
        if (type === 'data' && r !== headerRowIndex) count++;
      }
      return count;
    });

    const maxSpan = Math.max(...rawSpans, 0);
    const dominantNodes = rawSpans?.filter((s) => s >= maxSpan * 0.5 && maxSpan > 0);
    const hasSingleDominant = dominantNodes?.length === 1;
    const nonDominantSpans = hasSingleDominant
      ? rawSpans?.filter((s) => s < maxSpan * 0.5)
      : rawSpans;

    let useThreeLevels = false;
    let useTwoLevels = false;

    if (hasSingleDominant && nonDominantSpans?.length > 0) {
      const subMax = Math.max(...nonDominantSpans, 0);
      const subMin = Math.min(...nonDominantSpans?.filter((s) => s > 0), subMax);
      const subRatio = subMin > 0 ? subMax / subMin : 1;
      if (subRatio >= 2.5) useThreeLevels = true;
      else useTwoLevels = true;
    } else if (!hasSingleDominant) {
      const nonZeroSpans = rawSpans?.filter((s) => s > 0);
      if (nonZeroSpans?.length > 0) {
        const spanMax = Math.max(...nonZeroSpans);
        const spanMin = Math.min(...nonZeroSpans?.filter((s) => s > 0), spanMax);
        const ratio = spanMin > 0 ? spanMax / spanMin : 1;
        if (ratio >= 2.5) useTwoLevels = true;
      }
    }

    depths = rawSpans?.map((span) => {
      if (useThreeLevels) {
        if (span >= maxSpan * 0.5) return 0;
        const nonDomMax = Math.max(...rawSpans?.filter((s) => s < maxSpan * 0.5), 0);
        if (span >= nonDomMax * 0.4 && nonDomMax > 0) return 1;
        return 2;
      }
      if (useTwoLevels) {
        if (hasSingleDominant) return span >= maxSpan * 0.5 ? 0 : 1;
        const spanMax = Math.max(...rawSpans?.filter((s) => s > 0), 0);
        return span >= spanMax * 0.4 ? 0 : 1;
      }
      return 0;
    });
  } else {
    depths = groupRowsWithMeta?.map((g) => colToDepth?.[g?.col] ?? 0);
  }

  const roots = [];
  const parentStack = {};

  groupRowsWithMeta?.forEach((g, i) => {
    const depth = depths?.[i];
    const node = { label: g?.label, rIdx: g?.rIdx, children: [] };

    if (depth === 0 || Object.keys(parentStack)?.length === 0) {
      roots?.push(node);
      Object.keys(parentStack)?.forEach((d) => {
        if (Number(d) >= depth) delete parentStack?.[d];
      });
      parentStack[depth] = node;
    } else {
      let parentDepth = depth - 1;
      while (parentDepth >= 0 && !parentStack?.[parentDepth]) parentDepth--;
      if (parentDepth >= 0 && parentStack?.[parentDepth]) {
        parentStack?.[parentDepth]?.children?.push(node);
      } else {
        roots?.push(node);
      }
      Object.keys(parentStack)?.forEach((d) => {
        if (Number(d) >= depth) delete parentStack?.[d];
      });
      parentStack[depth] = node;
    }
  });

  return roots;
}

/**
 * Given a row index and the section tree, find the full path of group labels
 * that contain this row.
 *
 * For column-based trees (nodes have colIdx): route by the row's own column values.
 * For structural trees (nodes have rIdx): route by row index range.
 */
function findSectionPathForRow(rowIndex, nodes, table, tableState) {
  // Detect if this is a column-based tree (nodes have colIdx, not rIdx)
  const isColumnBased = nodes?.length > 0 && nodes?.[0]?.colIdx !== undefined && nodes?.[0]?.rIdx === undefined;

  if (isColumnBased) {
    // Column-based routing: match by the row's own column values
    const row = table?.rows?.[rowIndex];
    if (!row) return null;

    const l3ColIdx = nodes?.[0]?.colIdx;

    // Try direct match first
    for (const l3Node of nodes) {
      const rowL3Val = (row?.[l3Node?.colIdx] || '')?.trim();
      if (rowL3Val !== l3Node?.label) continue;

      // L3 matched — check L4 children
      if (l3Node?.children?.length > 0) {
        for (const l4Node of l3Node?.children) {
          const rowL4Val = (row?.[l4Node?.colIdx] || '')?.trim();
          if (rowL4Val === l4Node?.label) {
            return [l3Node?.label, l4Node?.label];
          }
        }
        // L3 matched but no L4 match — check if this row has an L4 value at all
        // If L4 col exists, try to find the L4 value even if not in tree (new category)
        if (l3Node?.children?.length > 0) {
          const l4ColIdx = l3Node?.children?.[0]?.colIdx;
          if (l4ColIdx !== undefined) {
            const rowL4Val = (row?.[l4ColIdx] || '')?.trim();
            if (rowL4Val) return [l3Node?.label, rowL4Val];
          }
        }
        return [l3Node?.label];
      }

      return [l3Node?.label];
    }

    // No direct L3 match — scan backwards to find the last row with a non-blank L3 value
    // This handles documents where the bag name is only shown in the first row of each group
    if (l3ColIdx !== undefined) {
      const tableRows = table?.rows || [];
      for (let r = rowIndex - 1; r >= 0; r--) {
        const prevRow = tableRows?.[r];
        if (!prevRow) continue;
        const prevL3Val = (prevRow?.[l3ColIdx] || '')?.trim();
        if (!prevL3Val) continue;
        // Found a previous row with an L3 value — find the matching node
        for (const l3Node of nodes) {
          if (l3Node?.label !== prevL3Val) continue;
          // Check L4 for current row
          if (l3Node?.children?.length > 0) {
            const l4ColIdx = l3Node?.children?.[0]?.colIdx;
            if (l4ColIdx !== undefined) {
              const rowL4Val = (row?.[l4ColIdx] || '')?.trim();
              if (rowL4Val) {
                // Check if this L4 value is in the tree
                for (const l4Node of l3Node?.children) {
                  if (l4Node?.label === rowL4Val) return [l3Node?.label, l4Node?.label];
                }
                // L4 value not in tree — still use it as a folder
                return [l3Node?.label, rowL4Val];
              }
            }
            return [l3Node?.label];
          }
          return [l3Node?.label];
        }
        break; // Found a previous L3 value but it doesn't match any node — stop scanning
      }
    }

    return null;
  }

  // Structural (rIdx-based) routing: match by row index range
  for (let i = 0; i < nodes?.length; i++) {
    const node = nodes?.[i];
    const nextSiblingRIdx = nodes?.[i + 1]?.rIdx ?? table?.rows?.length;

    if (rowIndex > node?.rIdx && rowIndex < nextSiblingRIdx) {
      // This node contains the row — check children for deeper nesting
      if (node?.children?.length > 0) {
        const childPath = findSectionPathForRow(rowIndex, node?.children, table, tableState);
        if (childPath !== null) {
          return [node?.label, ...childPath];
        }
      }
      return [node?.label];
    }
  }
  return null;
}

/**
 * Get the full nested folder path segments for a given row using document sections.
 * Returns an array of folder name segments (not including the base saveTo path).
 * Example: ['Grab Bag', 'First Aid'] for a row inside Grab Bag > First Aid
 */
function getDocumentSectionPathForRow(table, tableState, rowIndex) {
  const tree = buildSectionTreeForImport(table, tableState);
  if (tree?.length === 0) return [];
  const path = findSectionPathForRow(rowIndex, tree, table, tableState);
  return path || [];
}

/**
 * Collect all unique folder paths from the section tree (for pre-creating folders).
 * Returns array of path arrays: [['Grab Bag'], ['Grab Bag', 'First Aid'], ...]
 */
function collectAllSectionPaths(table, tableState) {
  const tree = buildSectionTreeForImport(table, tableState);
  const paths = [];

  function traverse(nodes, currentPath) {
    nodes?.forEach((node) => {
      const path = [...currentPath, node?.label];
      paths?.push(path);
      if (node?.children?.length > 0) {
        traverse(node?.children, path);
      }
    });
  }

  traverse(tree, []);
  return paths;
}

/**
 * Resolve the effective grouping column indices from the new state shape.
 * topMode: 'quick' | 'organise' * subMode:'sections' | 'custom' | 'none'
 * splitByColumn: string (column name, only used when subMode === 'custom')
 */
function getEffectiveGroupingColIndices(table, tableState) {
  if (!table || !tableState) return [];
  const { topMode, subMode, splitByColumn, headerRowIndex } = tableState;

  // Quick import or don't split → no subfolders
  if (topMode === 'quick' || !topMode) return [];
  if (subMode === 'none' || subMode === 'sections') return []; // sections uses tree, not columns

  if (headerRowIndex === null || headerRowIndex === undefined) return [];
  const headerRow = table?.rows?.[headerRowIndex] || [];

  if (subMode === 'custom' && splitByColumn) {
    const idx = headerRow?.findIndex(
      (h) => (h || '')?.trim()?.toLowerCase() === splitByColumn?.toLowerCase()
    );
    return idx !== -1 ? [idx] : [];
  }

  return [];
}

function collectGroupValuesForImport(table, tableState) {
  const cols = getEffectiveGroupingColIndices(table, tableState);
  if (cols?.length === 0) return [];
  const { headerRowIndex, rowTypes } = tableState;
  const values = new Set();
  table?.rows?.forEach((row, rIdx) => {
    const type = rowTypes?.[rIdx] || 'data';
    if (type !== 'data' || rIdx === headerRowIndex) return;
    cols?.forEach((cIdx) => {
      const val = (row?.[cIdx] || '')?.trim();
      if (val) values?.add(val);
    });
  });
  return [...values];
}

function getRowGroupValue(table, tableState, rowIndex) {
  const cols = getEffectiveGroupingColIndices(table, tableState);
  if (cols?.length === 0) return null;
  const row = table?.rows?.[rowIndex];
  if (!row) return null;
  for (let cIdx of cols) {
    const val = (row?.[cIdx] || '')?.trim();
    if (val) return val;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Step 4 (old): Bulk Import Progress — now renumbered to Step 5
// ---------------------------------------------------------------------------
function ImportingStep({ progress, total, done, importedCount, importError, onClose }) {
  const pct = total > 0 ? Math.round((progress / total) * 100) : 0;
  return (
    <div className="space-y-6 py-4">
      {!done ? (
        <>
          <div className="flex flex-col items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
              <LogoSpinner size={28} />
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold text-foreground">Importing items…</p>
              <p className="text-xs text-muted-foreground mt-1">{progress} of {total}</p>
            </div>
          </div>
          <div className="w-full bg-muted rounded-full h-2">
            <div className="bg-primary h-2 rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
          </div>
        </>
      ) : importError ? (
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="w-14 h-14 rounded-2xl bg-destructive/10 flex items-center justify-center">
            <Icon name="XCircle" size={28} className="text-destructive" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Import failed</p>
            <p className="text-xs text-muted-foreground mt-1">{importError}</p>
          </div>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="w-14 h-14 rounded-2xl bg-green-500/10 flex items-center justify-center">
            <Icon name="CheckCircle2" size={28} className="text-green-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Import complete!</p>
            <p className="text-xs text-muted-foreground mt-1">{importedCount} items imported successfully</p>
          </div>
          <Button onClick={onClose} className="gap-2">
            <Icon name="Check" size={16} />Done
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Modal
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Smart Confirm — the simple default: "here's what we found, import it".
// Shows the items grouped into the folders we picked, lets you move any item
// to a different folder, and imports. The old table/column mapping lives
// behind "Adjust details" for the rare wrong guess.
// ---------------------------------------------------------------------------
function SmartConfirmStep({ fileName, groups, folderOptions, totalItems, baseSegments, onMoveItem, onImport, onAdjust, onBack }) {
  const [expanded, setExpanded] = useState(() => new Set());
  const [newFolderFor, setNewFolderFor] = useState(null); // rowKey awaiting a new folder name
  const [newFolderName, setNewFolderName] = useState('');

  const toggle = (key) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const handleSelect = (rowKey, value) => {
    if (value === '__new__') { setNewFolderFor(rowKey); setNewFolderName(''); return; }
    const opt = folderOptions?.find((o) => o?.key === value);
    if (opt) onMoveItem(rowKey, opt.segments);
  };

  const confirmNewFolder = (rowKey) => {
    const name = newFolderName?.trim();
    if (!name) { setNewFolderFor(null); return; }
    onMoveItem(rowKey, [...(baseSegments || []), name]);
    setNewFolderFor(null);
    setNewFolderName('');
  };

  return (
    <div>
      <div className="azi-note">
        <Icon name="Sparkles" size={18} className="azi-note-icn" />
        <div>
          <p className="azi-note-t">We read {fileName || 'your document'} and sorted it for you</p>
          <p className="azi-note-s">
            {totalItems > 0
              ? <>{totalItems} item{totalItems !== 1 ? 's' : ''} across {groups?.length} folder{groups?.length !== 1 ? 's' : ''}. Open a folder to move anything we filed in the wrong place, then import.</>
              : <>We couldn’t pick out any items automatically from this document.</>}
          </p>
        </div>
      </div>

      {totalItems === 0 && (
        <div className="azi-empty">
          <div className="azi-empty-icn"><Icon name="FileSearch" size={26} /></div>
          <p className="azi-empty-t">Nothing recognised yet</p>
          <p className="azi-empty-s">
            This can happen with an unusual layout or a scan we couldn’t read. Open
            <b> Adjust details</b> to line up the columns yourself, or go back and try a clearer file.
          </p>
          <button className="azi-primary" onClick={onAdjust}><Icon name="SlidersHorizontal" size={16} />Adjust details</button>
        </div>
      )}

      <div className="azi-rows">
        {groups?.map((g) => {
          const isOpen = expanded.has(g.key);
          return (
            <div key={g.key} className="azi-fgroup">
              <button className="azi-frow" onClick={() => toggle(g.key)} aria-expanded={isOpen}>
                <span className="azi-fi"><Icon name="Folder" size={16} /></span>
                <span className="azi-fmain">
                  <span className="azi-fname">{g.label}</span>
                  <span className="azi-fsub">{g.items?.length} item{g.items?.length !== 1 ? 's' : ''}</span>
                </span>
                <Icon name={isOpen ? 'ChevronDown' : 'ChevronRight'} size={16} className="azi-fchev" />
              </button>
              {isOpen && (
                <div className="azi-items">
                  {g.items?.map((it) => (
                    <div key={it.rowKey} className="azi-item">
                      <span className="azi-item-nm">{it.name}</span>
                      {it.qty !== '' && it.qty != null && <span className="azi-item-qty">×{it.qty}</span>}
                      {newFolderFor === it.rowKey ? (
                        <span className="azi-newf">
                          <input
                            autoFocus value={newFolderName}
                            onChange={(e) => setNewFolderName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') confirmNewFolder(it.rowKey); if (e.key === 'Escape') setNewFolderFor(null); }}
                            placeholder="New folder name"
                          />
                          <button className="azi-newf-ok" onClick={() => confirmNewFolder(it.rowKey)}>Add</button>
                          <button className="azi-newf-x" onClick={() => setNewFolderFor(null)}>Cancel</button>
                        </span>
                      ) : (
                        <select
                          className="azi-move"
                          value={g.key}
                          onChange={(e) => handleSelect(it.rowKey, e.target.value)}
                          title="Move to a different folder"
                        >
                          <option value={g.key} disabled>Move to…</option>
                          {folderOptions?.filter((o) => o?.key !== g.key)?.map((o) => (
                            <option key={o.key} value={o.key}>{o.label}</option>
                          ))}
                          <option value="__new__">＋ New folder…</option>
                        </select>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="azi-foot">
        <button className="azi-ghost" onClick={onBack}>
          <Icon name="ArrowLeft" size={16} />Back
        </button>
        <div className="azi-foot-r">
          <button className="azi-link" onClick={onAdjust}>Adjust details</button>
          <button className="azi-primary" onClick={onImport} disabled={totalItems === 0}>
            <Icon name="Check" size={16} />Import {totalItems} item{totalItems !== 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AzurePdfImportModal({ onClose, onImportComplete, currentPathSegments }) {
  const [step, setStep] = useState(1);
  const [parseError, setParseError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [azureResult, setAzureResult] = useState(null);
  const [uploadedFile, setUploadedFile] = useState(null);

  // colorMap: { [tableId]: { [rowIndex]: { [colIndex]: "Red"|"" } } }
  const [colorMap, setColorMap] = useState({});
  const [isColorDetecting, setIsColorDetecting] = useState(false);

  // tableStates: { [tableId]: { tableId, pageNumber, included, reviewStatus, headerRowIndex, rowTypes, columnMappings, applyMappingTemplateId, saveTo, topMode, subMode, splitByColumn } }
  const [tableStates, setTableStates] = useState({});

  // 'smart' = the simple one-screen confirm (default); 'advanced' = the full
  // table/column mapping flow, reached via "Adjust details".
  const [mode, setMode] = useState('smart');
  // Per-row folder override from the Smart Confirm screen: rowKey -> segments[].
  const [rowOverrides, setRowOverrides] = useState({});

  // Combined normalized rows for bulk import
  const [allNormalizedRows, setAllNormalizedRows] = useState([]);

  const [folderPath, setFolderPath] = useState(
    currentPathSegments?.length > 0 ? currentPathSegments?.join(' > ') : ''
  );

  const [importProgress, setImportProgress] = useState(0);
  const [importDone, setImportDone] = useState(false);
  const [importedCount, setImportedCount] = useState(0);
  const [importError, setImportError] = useState(null);

  const { activeTenantId } = useTenant();

  const similarGroups = useMemo(() => {
    if (!azureResult?.tables) return [];
    return detectSimilarTables(azureResult?.tables, tableStates);
  }, [azureResult, tableStates]);

  // ── Shared resolver: every data row → the folder path we'd file it in ──────
  // Mirrors the import loop's logic (section tree + carry-forward / custom
  // split), so the Smart Confirm preview and the actual import agree exactly.
  const resolvedRows = useMemo(() => {
    const out = [];
    if (!azureResult?.tables) return out;
    azureResult.tables.forEach((table) => {
      const state = tableStates?.[table?.id];
      if (!state?.included || state?.reviewStatus === 'skipped') return;
      const baseSegs = (state?.saveTo?.trim() || folderPath?.trim() || '')
        ?.split('>')?.map((s) => s?.trim())?.filter(Boolean);
      const normRows = buildNormalizedRowsForTable(table, state, colorMap) || [];
      let carry = null;
      normRows.forEach((nr) => {
        const sourceRowIndex = nr?._source_row_index;
        let seg = baseSegs;
        if (state?.topMode === 'organise' && state?.subMode !== 'none') {
          if (state?.subMode === 'sections') {
            const sp = getDocumentSectionPathForRow(table, state, sourceRowIndex);
            if (sp?.length > 0) { carry = sp; seg = [...baseSegs, ...sp]; }
            else if (carry?.length > 0) { seg = [...baseSegs, ...carry]; }
          } else {
            const gv = getRowGroupValue(table, state, sourceRowIndex);
            if (gv) seg = [...baseSegs, gv];
          }
        }
        out.push({
          rowKey: `${table?.id}:${sourceRowIndex}`,
          normRow: nr,
          autoSegments: seg || [],
          name: nr?.item_name || nr?.name || '(unnamed item)',
          qty: nr?.quantity ?? '',
        });
      });
    });
    return out;
  }, [azureResult, tableStates, colorMap, folderPath]);

  const segmentsFor = useCallback(
    (row) => (rowOverrides?.[row?.rowKey] ? rowOverrides[row.rowKey] : row?.autoSegments) || [],
    [rowOverrides],
  );

  // Group the resolved rows by their effective folder, for the receipt view.
  const smartGroups = useMemo(() => {
    const map = new Map();
    resolvedRows.forEach((row) => {
      const segs = segmentsFor(row);
      const key = segs.length ? segs.join(' > ') : '__root__';
      const label = segs.length ? segs.join(' › ') : 'Current folder';
      if (!map.has(key)) map.set(key, { key, label, segments: segs, items: [] });
      map.get(key).items.push({ rowKey: row.rowKey, name: row.name, qty: row.qty });
    });
    return [...map.values()].sort((a, b) => b.items.length - a.items.length);
  }, [resolvedRows, segmentsFor]);

  const folderOptions = useMemo(
    () => smartGroups.map((g) => ({ key: g.key, label: g.label, segments: g.segments })),
    [smartGroups],
  );

  const smartTotalItems = resolvedRows.length;

  const handleMoveItem = useCallback((rowKey, segments) => {
    setRowOverrides((prev) => ({ ...prev, [rowKey]: segments }));
  }, []);

  // Step 1 → 2: Parse with Azure, then run color detection in background
  const handleFileSelected = async (file) => {
    setIsLoading(true);
    setParseError(null);
    setUploadedFile(file);
    try {
      const result = await parseDocumentWithAzure(file);
      if (isAzureParseError(result)) {
        setParseError(result?.error);
        setIsLoading(false);
        return;
      }
      setAzureResult(result);
      // Build initial state for all tables
      const states = {};
      const defaultSaveTo = currentPathSegments?.length > 0 ? currentPathSegments?.join(' > ') : '';
      result?.tables?.forEach((table, idx) => {
        states[table?.id] = {
          ...buildInitialTableState(table, idx),
          saveTo: defaultSaveTo,
          // Smart default: fold rows into folders by the document's own
          // sections. If the doc has none, every row falls back to the base
          // folder (one group) — handled by the resolver.
          topMode: 'organise',
          subMode: 'sections',
          splitByColumn: '',
        };
      });
      setTableStates(states);
      setRowOverrides({});
      setMode('smart');
      setStep(2);

      // Run color detection in background (non-blocking)
      setIsColorDetecting(true);
      extractCellColors(file, result)?.then((map) => {
          setColorMap(map);
          // Auto-suggest colour mapping for columns that look like colour columns
          setTableStates((prevStates) => {
            const updated = { ...prevStates };
            result?.tables?.forEach((table) => {
              const state = updated?.[table?.id];
              if (!state) return;
              const headerRowIndex = state?.headerRowIndex;
              if (headerRowIndex === null || headerRowIndex === undefined) return;
              const headerRow = table?.rows?.[headerRowIndex] || [];
              const newMappings = { ...state?.columnMappings };
              let changed = false;
              headerRow?.forEach((header, cIdx) => {
                const existing = newMappings?.[cIdx];
                if (!existing || existing?.type === 'ignore') return;
                // If header suggests colour column and not already mapped to colour
                if (isColourColumn(header) && existing?.type === 'core' && existing?.cargoKey !== 'colour') {
                  newMappings[cIdx] = { ...existing, type: 'core', cargoKey: 'colour' };
                  changed = true;
                }
                // If column has detected fills and no text content, suggest colour mapping
                const dominantColor = getDominantColumnColor(colorMap, table?.id, cIdx, state?.rowTypes);
                if (dominantColor && existing?.type === 'custom' && !existing?.customFieldName?.trim()) {
                  // Check if most data cells in this column are blank text
                  const dataRows = table?.rows?.filter((_, rIdx) => state?.rowTypes?.[rIdx] === 'data' && rIdx !== headerRowIndex);
                  const blankCells = dataRows?.filter((row) => !row?.[cIdx]?.trim())?.length;
                  if (dataRows?.length > 0 && blankCells / dataRows?.length > 0.5) {
                    newMappings[cIdx] = { ...existing, type: 'core', cargoKey: 'colour' };
                    changed = true;
                  }
                }
              });
              if (changed) {
                updated[table?.id] = { ...state, columnMappings: newMappings };
              }
            });
            return updated;
          });
        })?.catch((err) => console.warn('[AzurePdfImportModal] Color detection failed:', err?.message))?.finally(() => setIsColorDetecting(false));
    } catch (err) {
      setParseError(err?.message || 'Failed to parse document');
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleInclude = (tableId) => {
    setTableStates((prev) => ({
      ...prev,
      [tableId]: { ...prev?.[tableId], included: !prev?.[tableId]?.included },
    }));
  };

  const handleTableStateChange = (tableId, newState) => {
    setTableStates((prev) => ({ ...prev, [tableId]: newState }));
  };

  // Update per-table "Save to" destination
  const handleTableSaveToChange = (tableId, saveTo) => {
    setTableStates((prev) => ({
      ...prev,
      [tableId]: { ...prev?.[tableId], saveTo },
    }));
  };

  // Update per-table grouping selection — receives { topMode, subMode, splitByColumn }
  const handleTableGroupingChange = (tableId, groupingState) => {
    setTableStates((prev) => ({
      ...prev,
      [tableId]: { ...prev?.[tableId], ...groupingState },
    }));
  };

  // Step 3 → 4: Go to Save & Organise
  const handleGoToSaveAndOrganise = () => {
    setStep(4);
  };

  // Step 4 → 5: Build combined normalized rows then run import
  const handleRunImport = async () => {
    // Resolve each row to its final folder, honouring any moves made on the
    // Smart Confirm screen. One resolver feeds both the preview and this import.
    const rows = resolvedRows.map((r) => ({ ...r.normRow, _segments: segmentsFor(r) }));
    setAllNormalizedRows(rows);

    setStep(5);
    setImportProgress(0);
    setImportDone(false);
    setImportError(null);

    try {
      // ── Pre-create every distinct destination folder path ────────────────
      const seen = new Set();
      for (const row of rows) {
        const segs = row?._segments || [];
        const key = segs.join(' > ');
        if (seen.has(key)) continue;
        seen.add(key);
        for (let i = 0; i < segs.length; i++) {
          try { await createFolder(segs.slice(0, i), segs[i]); } catch (_) {}
        }
      }

      let count = 0;

      for (let i = 0; i < rows?.length; i++) {
        const row = rows?.[i];
        const itemName = row?.item_name || row?.name || '';
        if (!itemName?.trim()) { setImportProgress(i + 1); continue; }

        const finalSegments = row?._segments || [];

        // Build custom_fields
        const customFields = {};

        const colourVal = row?.colour?.trim?.() || '';
        if (colourVal) customFields['colour'] = colourVal;

        const batchVal = row?.batch_no?.trim?.() || '';
        if (batchVal) customFields['batch_no'] = batchVal;

        if (row?.source_fields && typeof row?.source_fields === 'object') {
          const existingCustomKeys = Object.keys(customFields);
          for (const [rawLabel, rawValue] of Object.entries(row?.source_fields)) {
            if (!rawValue?.toString?.()?.trim()) continue;
            const normalizedKey = normalizeFieldKey(rawLabel);
            if (!normalizedKey) continue;
            const isCoreKey = CARGO_CORE_FIELDS?.some((f) => f?.key === normalizedKey);
            if (isCoreKey) continue;
            const similar = findSimilarExistingField(normalizedKey, existingCustomKeys);
            const finalKey = similar || normalizedKey;
            if (!customFields?.[finalKey]) {
              customFields[finalKey] = rawValue?.toString()?.trim();
              if (!similar) existingCustomKeys?.push(finalKey);
            }
          }
        }

        const itemToSave = {
          name: itemName,
          brand: row?.brand || '',
          quantity: parseFloat(row?.quantity) || 0,
          unit: row?.unit || '',
          size: row?.size || '',
          year: row?.year || '',
          expiryDate: row?.expiry_date || null,
          barcode: row?.code || '',
          supplier: row?.supplier || '',
          notes: row?.notes?.trim?.() || '',
          customFields: Object.keys(customFields)?.length > 0 ? customFields : undefined,
          location: finalSegments?.[0] || null,
          subLocation: finalSegments?.length > 1 ? finalSegments?.slice(1)?.join(' > ') : null,
          tenant_id: activeTenantId,
        };

        const result = await saveItem(itemToSave);
        if (result) count++;
        setImportProgress(i + 1);
      }

      setImportedCount(count);
      setImportDone(true);
    } catch (err) {
      setImportError(err?.message || 'Import failed');
      setImportDone(true);
    }
  };

  const handleImportDone = () => {
    onImportComplete?.();
    onClose?.();
  };

  // For step 3 we need relative positioning for the sticky bottom nav
  const isStep3 = step === 3;

  return (
    <ModalShell onClose={onClose} panelClassName={`azi-modal bg-card w-full flex flex-col ${isStep3 ? 'max-w-4xl max-h-[92vh]' : 'max-w-3xl max-h-[90vh]'}`}>
      {/* Header */}
      <div className="azi-head flex items-center justify-between px-6 py-5 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="azi-badge w-9 h-9 rounded-xl flex items-center justify-center">
            <Icon name="FileText" size={16} />
          </div>
          <div>
            <h2 className="azi-title">Import from document</h2>
            <p className="azi-sub">Upload a document to extract and organise your inventory automatically</p>
          </div>
        </div>
        <button onClick={onClose} className="azi-x w-8 h-8 flex items-center justify-center">
          <Icon name="X" size={16} />
        </button>
      </div>

      {/* Body */}
      <div className={`flex-1 overflow-y-auto px-6 py-5 ${isStep3 ? 'relative pb-20' : ''}`}>
        {step < 5 && (
          mode === 'smart'
            ? <StepIndicator currentStep={step === 1 ? 1 : 2} steps={SMART_STEPS} />
            : <StepIndicator currentStep={step} />
        )}

        {step === 1 && (
          <UploadStep onFileUploaded={handleFileSelected} parseError={parseError} isLoading={isLoading} />
        )}

        {step === 2 && azureResult && mode === 'smart' && (
          <SmartConfirmStep
            fileName={uploadedFile?.name}
            groups={smartGroups}
            folderOptions={folderOptions}
            totalItems={smartTotalItems}
            baseSegments={currentPathSegments || []}
            onMoveItem={handleMoveItem}
            onImport={handleRunImport}
            onAdjust={() => setMode('advanced')}
            onBack={() => setStep(1)}
          />
        )}

        {step === 2 && azureResult && mode === 'advanced' && (
          <TableSessionStep
            tables={azureResult?.tables}
            tableStates={tableStates}
            onToggleInclude={handleToggleInclude}
            onNext={() => setStep(3)}
            onBack={() => setStep(1)}
            similarGroups={similarGroups}
          />
        )}

        {step === 3 && azureResult && (
          <PerTableReviewStep
            tables={azureResult?.tables}
            tableStates={tableStates}
            onTableStateChange={handleTableStateChange}
            onNext={handleGoToSaveAndOrganise}
            onBack={() => setStep(2)}
            similarGroups={similarGroups}
            colorMap={colorMap}
            isColorDetecting={isColorDetecting}
          />
        )}

        {step === 4 && azureResult && (
          <SaveAndOrganiseStep
            tables={azureResult?.tables}
            tableStates={tableStates}
            onTableSaveToChange={handleTableSaveToChange}
            onTableGroupingChange={handleTableGroupingChange}
            onNext={handleRunImport}
            onBack={() => setStep(3)}
          />
        )}

        {step === 5 && (
          <ImportingStep
            progress={importProgress}
            total={allNormalizedRows?.length}
            done={importDone}
            importedCount={importedCount}
            importError={importError}
            onClose={handleImportDone}
          />
        )}
      </div>
    </ModalShell>
  );
}
