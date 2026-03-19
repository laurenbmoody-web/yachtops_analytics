/**
 * SaveAndOrganiseStep.jsx
 *
 * Step: Save & Organise
 *
 * Top-level choice per table:
 *   A) Quick import (recommended) — import directly, no subfolder splitting
 *   B) Organise into folders — show three sub-options:
 *        1. Use document sections (recommended)
 *        2. Choose how to split them  → shows dynamic column dropdown
 *        3. Don't split
 *
 * No hardcoded field names (Bag Name, Category, Module, etc.) anywhere in the UI.
 * The "Split by" dropdown is populated dynamically from the detected column headers.
 */

import React, { useMemo } from 'react';
import Icon from '../../../components/AppIcon';
import Button from '../../../components/ui/Button';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract all non-empty column header names from a table for the dynamic dropdown.
 * Uses the user-confirmed column mappings from the Review step (displayHeader /
 * customFieldName) rather than the raw detected header row, so any renames the
 * user made in the Review step are reflected here.
 */
function getColumnHeaders(table, tableState) {
  if (!table || !tableState) return [];
  const { headerRowIndex, columnMappings } = tableState;
  if (headerRowIndex === null || headerRowIndex === undefined) return [];

  // If column mappings exist (set during Review step), use them
  if (columnMappings && Object.keys(columnMappings)?.length > 0) {
    const headers = [];
    const headerRow = table?.rows?.[headerRowIndex] || [];
    const colCount = Math.max(headerRow?.length, Object.keys(columnMappings)?.length);
    for (let cIdx = 0; cIdx < colCount; cIdx++) {
      const mapping = columnMappings?.[cIdx];
      if (!mapping) continue;
      // Skip columns the user chose not to import
      if (mapping?.saveAs === 'dont_import') continue;
      // Determine the display name: custom field name takes priority, then displayHeader, then sourceHeader
      let name = '';
      if (mapping?.saveAs === 'new_field') {
        name = (mapping?.customFieldName || '')?.trim() || (mapping?.displayHeader || '')?.trim() || (mapping?.sourceHeader || '')?.trim();
      } else {
        // For mapped cargo fields, use the displayHeader (original column name) so the
        // user can still recognise the column in the dropdown
        name = (mapping?.displayHeader || '')?.trim() || (mapping?.sourceHeader || '')?.trim();
      }
      if (name) headers?.push(name);
    }
    if (headers?.length > 0) return headers;
  }

  // Fallback: read raw header row
  const headerRow = table?.rows?.[headerRowIndex] || [];
  return headerRow?.map((h) => (h || '')?.trim())?.filter(Boolean);
}

/**
 * Collect unique values for a specific column name from data rows.
 * Resolves the column index using the mapped display name first (so it works
 * correctly after the user renames columns in the Review step).
 */
function collectValuesForColumn(table, tableState, columnName) {
  if (!table || !tableState || !columnName) return [];
  const { headerRowIndex, rowTypes, columnMappings } = tableState;
  if (headerRowIndex === null || headerRowIndex === undefined) return [];

  let colIdx = -1;

  // Try to resolve via column mappings first (handles renamed columns)
  if (columnMappings && Object.keys(columnMappings)?.length > 0) {
    const headerRow = table?.rows?.[headerRowIndex] || [];
    const colCount = Math.max(headerRow?.length, Object.keys(columnMappings)?.length);
    for (let i = 0; i < colCount; i++) {
      const mapping = columnMappings?.[i];
      if (!mapping || mapping?.saveAs === 'dont_import') continue;
      let name = '';
      if (mapping?.saveAs === 'new_field') {
        name = (mapping?.customFieldName || '')?.trim() || (mapping?.displayHeader || '')?.trim() || (mapping?.sourceHeader || '')?.trim();
      } else {
        name = (mapping?.displayHeader || '')?.trim() || (mapping?.sourceHeader || '')?.trim();
      }
      if (name?.toLowerCase() === columnName?.toLowerCase()) {
        colIdx = i;
        break;
      }
    }
  }

  // Fallback: match against raw header row
  if (colIdx === -1) {
    const headerRow = table?.rows?.[headerRowIndex] || [];
    colIdx = headerRow?.findIndex(
      (h) => (h || '')?.trim()?.toLowerCase() === columnName?.toLowerCase()
    );
  }

  if (colIdx === -1) return [];

  const values = new Set();
  table?.rows?.forEach((row, rIdx) => {
    const type = rowTypes?.[rIdx] || 'data';
    if (type !== 'data' || rIdx === headerRowIndex) return;
    const val = (row?.[colIdx] || '')?.trim();
    if (val) values?.add(val);
  });
  return [...values]?.slice(0, 12);
}

// ---------------------------------------------------------------------------
// Auto-detection helpers (restored from hierarchyDetector logic)
// ---------------------------------------------------------------------------

const DATA_COLUMN_KEYWORDS = [
  'qty', 'quantity', 'item', 'name', 'description', 'code', 'sku', 'unit',
  'size', 'brand', 'supplier', 'notes', 'colour', 'color', 'batch', 'expiry',
  'price', 'cost', 'ref', 'no.', 'number', 'type', 'category',
];

function looksLikeGroupLabel(text) {
  if (!text || text?.length > 80) return false;
  const t = text?.trim();
  if (!t) return false;
  const lower = t?.toLowerCase();
  if (DATA_COLUMN_KEYWORDS?.some((kw) => lower === kw || lower?.startsWith(kw + ' '))) return false;
  const numericRatio = (t?.match(/\d/g) || [])?.length / t?.length;
  if (numericRatio > 0.5) return false;
  const hasLetters = /[a-zA-Z]/?.test(t);
  if (!hasLetters) return false;
  const startsCapital = /^[A-Z]/?.test(t);
  const isAllCaps = t === t?.toUpperCase() && hasLetters;
  return startsCapital || isAllCaps;
}

function isGroupRow(row, totalColumns) {
  if (!row || row?.length === 0) return false;
  const nonBlank = row?.filter((c) => c?.trim());
  if (nonBlank?.length === 0) return false;
  if (nonBlank?.length / Math.max(totalColumns, row?.length) > 0.4) return false;
  const firstNonBlank = row?.find((c) => c?.trim()) || '';
  return looksLikeGroupLabel(firstNonBlank);
}

function isMergedTitleRow(row, totalColumns) {
  if (!row) return false;
  const nonBlank = row?.filter((c) => c?.trim());
  if (nonBlank?.length !== 1) return false;
  if (totalColumns > 2 && nonBlank?.length / totalColumns > 0.3) return false;
  return looksLikeGroupLabel(nonBlank?.[0]);
}

/**
 * Collect group rows from a table — uses manually marked rows first,
 * then falls back to auto-detection if none are manually marked.
 */
function collectGroupRows(table, tableState) {
  if (!table || !tableState) return { groupRows: [], autoDetected: false };
  const { headerRowIndex, rowTypes } = tableState;
  const rows = table?.rows || [];
  const totalColumns = table?.columnCount || Math.max(...rows?.map((r) => r?.length || 0), 1);

  // First pass: check if any rows are manually marked as 'group'
  const manualGroupRows = [];
  rows?.forEach((row, rIdx) => {
    if (rIdx === headerRowIndex) return;
    const type = rowTypes?.[rIdx] || 'data';
    if (type === 'group') {
      const label = row?.find((c) => (c || '')?.trim())?.trim() || '';
      if (label) manualGroupRows?.push({ rIdx, label });
    }
  });

  if (manualGroupRows?.length > 0) {
    return { groupRows: manualGroupRows, autoDetected: false };
  }

  // Second pass: auto-detect group rows from document structure
  const autoGroupRows = [];
  rows?.forEach((row, rIdx) => {
    if (rIdx === headerRowIndex) return;
    const type = rowTypes?.[rIdx] || 'data';
    if (type === 'ignore') return;
    // Only auto-detect from rows not already classified as data
    const merged = isMergedTitleRow(row, totalColumns);
    const group = isGroupRow(row, totalColumns);
    if (merged || group) {
      const label = row?.find((c) => (c || '')?.trim())?.trim() || '';
      if (label) autoGroupRows?.push({ rIdx, label });
    }
  });

  return { groupRows: autoGroupRows, autoDetected: autoGroupRows?.length > 0 };
}

// ---------------------------------------------------------------------------
// Column-based grouping detection
// ---------------------------------------------------------------------------

/**
 * Keywords that indicate a column is a grouping/container column (bag name, category, etc.)
 * rather than an item-level data column.
 */
const GROUPING_COLUMN_KEYWORDS = [
  'bag', 'kit', 'pack', 'case', 'box', 'container', 'section', 'category',
  'module', 'group', 'type', 'class', 'department', 'area', 'zone', 'location',
];

/**
 * Returns true if a column header looks like a grouping/container column.
 */
function isGroupingColumnHeader(header) {
  if (!header) return false;
  const lower = header?.toLowerCase()?.trim();
  return GROUPING_COLUMN_KEYWORDS?.some((kw) => lower?.includes(kw));
}

/**
 * Detect columns in a table that look like grouping columns (bag name, category).
 * Returns an array of { colIdx, header, uniqueValues, cardinality } sorted by
 * cardinality ascending (fewest unique values first = most likely bag/container name).
 *
 * A grouping column has:
 *   - Low cardinality: fewer unique values than 40% of data rows
 *   - At least 2 unique values (otherwise it's not splitting anything)
 *   - Values that look like labels (not purely numeric)
 *   - At least 50% of data rows have a non-blank value in this column
 */
function detectColumnGrouping(table, tableState) {
  if (!table || !tableState) return [];
  const { headerRowIndex, rowTypes } = tableState;
  if (headerRowIndex === null || headerRowIndex === undefined) return [];

  const rows = table?.rows || [];
  const headerRow = rows?.[headerRowIndex] || [];

  // Collect data rows
  const dataRows = rows?.filter((_, rIdx) => {
    const type = rowTypes?.[rIdx] || 'data';
    return type === 'data' && rIdx !== headerRowIndex;
  });

  if (dataRows?.length === 0) return [];

  const candidates = [];

  headerRow?.forEach((header, colIdx) => {
    if (!header?.trim()) return;

    // Collect non-blank values for this column across data rows
    const values = dataRows?.map((row) => (row?.[colIdx] || '')?.trim())?.filter(Boolean);

    if (values?.length === 0) return;

    // Coverage: at least 50% of data rows have a value
    const coverage = values?.length / dataRows?.length;
    if (coverage < 0.5) return;

    const uniqueValues = [...new Set(values)];
    const cardinality = uniqueValues?.length;

    // Must have at least 2 unique values to be a grouping column
    if (cardinality < 2) return;

    // Low cardinality: fewer unique values than 40% of data rows
    if (cardinality > dataRows?.length * 0.4) return;

    // Values should look like labels (not purely numeric)
    const labelLike = uniqueValues?.filter((v) => /[a-zA-Z]/?.test(v));
    if (labelLike?.length / uniqueValues?.length < 0.7) return;

    // Prefer columns with grouping keywords in the header
    const hasKeyword = isGroupingColumnHeader(header);

    candidates?.push({ colIdx, header, uniqueValues, cardinality, coverage, hasKeyword });
  });

  // Sort: keyword columns first, then by cardinality ascending (fewest unique = broadest grouping = L3)
  candidates?.sort((a, b) => {
    if (a?.hasKeyword !== b?.hasKeyword) return a?.hasKeyword ? -1 : 1;
    return a?.cardinality - b?.cardinality;
  });

  return candidates;
}

/**
 * Build a nested folder tree from column values in data rows.
 * Uses up to 2 grouping columns: L3 (bag) and L4 (category).
 *
 * Returns: [{ label, colIdx, colValue, children: [...] }]
 */
function buildColumnBasedSectionTree(table, tableState) {
  if (!table || !tableState) return [];
  const { headerRowIndex, rowTypes } = tableState;
  if (headerRowIndex === null || headerRowIndex === undefined) return [];

  const groupingCols = detectColumnGrouping(table, tableState);
  if (groupingCols?.length === 0) return [];

  const rows = table?.rows || [];

  // Use at most 2 grouping columns: first = L3 (bag), second = L4 (category)
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

  // Build tree nodes
  const tree = [];
  l3Map?.forEach((l4Set, l3Val) => {
    const children = [];
    l4Set?.forEach((l4Val) => {
      children?.push({ label: l4Val, children: [] });
    });
    tree?.push({ label: l3Val, children });
  });

  return tree;
}

/**
 * Build a nested folder tree from document group rows OR column values.
 * Tries column-based detection first (more reliable for tables with bag name columns),
 * then falls back to structural group row detection.
 *
 * Returns a nested structure: [{ label, children: [...] }]
 */
function buildDocumentSectionTree(table, tableState) {
  if (!table || !tableState) return [];
  const { headerRowIndex } = tableState;
  if (headerRowIndex === null || headerRowIndex === undefined) return [];

  // ── Primary: try column-based grouping detection ──
  const columnTree = buildColumnBasedSectionTree(table, tableState);
  if (columnTree?.length > 0) return columnTree;

  // ── Fallback: structural group row detection ──
  const { groupRows: detectedGroupRows, autoDetected } = collectGroupRows(table, tableState);
  if (detectedGroupRows?.length === 0) return [];

  const rows = table?.rows || [];
  const totalRows = rows?.length || 0;

  const groupRowsWithMeta = detectedGroupRows?.map((g) => {
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
    const node = { label: g?.label, children: [] };

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
 * Flatten the nested tree into preview paths for display.
 * Returns an array of { path: string[], depth: number } entries.
 */
function flattenTreeForPreview(nodes, currentPath = [], result = []) {
  nodes?.forEach((node) => {
    const path = [...currentPath, node?.label];
    result?.push({ path, depth: path?.length - 1, hasChildren: node?.children?.length > 0 });
    if (node?.children?.length > 0) {
      flattenTreeForPreview(node?.children, path, result);
    }
  });
  return result;
}

// ---------------------------------------------------------------------------
// Folder tree preview
// ---------------------------------------------------------------------------
function FolderTreePreview({ saveTo, groupValues, mode, sectionTree }) {
  const baseSegs = (saveTo || '')?.split('>')?.map((s) => s?.trim())?.filter(Boolean);

  if (baseSegs?.length === 0) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-xs py-2">
        <Icon name="FolderOpen" size={14} className="opacity-40" />
        <span>Set a destination to see preview</span>
      </div>
    );
  }

  const hasGroups = mode !== 'none';

  // For document sections mode, render the nested tree
  if (mode === 'sections' && sectionTree && sectionTree?.length > 0) {
    const flatEntries = flattenTreeForPreview(sectionTree);
    const baseIndent = baseSegs?.length;

    return (
      <div className="space-y-0.5 text-xs font-mono">
        {/* Base path segments */}
        {baseSegs?.map((seg, i) => (
          <div key={i} style={{ paddingLeft: `${i * 14}px` }} className="flex items-center gap-1.5 py-0.5">
            <Icon
              name="Folder"
              size={12}
              className="text-primary flex-shrink-0"
            />
            <span className="text-foreground font-medium">{seg}</span>
          </div>
        ))}
        {/* Nested section tree */}
        {flatEntries?.map((entry, i) => (
          <div
            key={i}
            style={{ paddingLeft: `${(baseIndent + entry?.depth) * 14}px` }}
            className="flex items-center gap-1.5 py-0.5"
          >
            <span className="text-muted-foreground mr-0.5">
              {i === flatEntries?.length - 1 ? '└──' : '├──'}
            </span>
            <Icon
              name={entry?.hasChildren ? 'Folder' : 'FolderOpen'}
              size={11}
              className={entry?.hasChildren ? 'text-primary/70 flex-shrink-0' : 'text-primary/50 flex-shrink-0'}
            />
            <span className="text-foreground">{entry?.path?.[entry?.path?.length - 1]}</span>
            {!entry?.hasChildren && (
              <span className="text-muted-foreground/50 ml-1">← items here</span>
            )}
          </div>
        ))}
      </div>
    );
  }

  // For custom split mode — flat subfolders
  const hasCustomGroups = mode !== 'none' && groupValues?.length > 0;

  return (
    <div className="space-y-0.5 text-xs font-mono">
      {baseSegs?.map((seg, i) => (
        <div key={i} style={{ paddingLeft: `${i * 14}px` }} className="flex items-center gap-1.5 py-0.5">
          <Icon
            name={i === baseSegs?.length - 1 && !hasCustomGroups ? 'FolderOpen' : 'Folder'}
            size={12}
            className="text-primary flex-shrink-0"
          />
          <span className="text-foreground font-medium">{seg}</span>
        </div>
      ))}
      {hasCustomGroups && groupValues?.map((val, i) => (
        <div key={i} style={{ paddingLeft: `${baseSegs?.length * 14}px` }} className="flex items-center gap-1.5 py-0.5">
          <span className="text-muted-foreground mr-0.5">
            {i === groupValues?.length - 1 ? '└──' : '├──'}
          </span>
          <Icon name="Folder" size={11} className="text-primary/70 flex-shrink-0" />
          <span className="text-foreground">{val}</span>
        </div>
      ))}
      {mode !== 'none' && groupValues?.length === 0 && (
        <div style={{ paddingLeft: `${baseSegs?.length * 14}px` }} className="text-muted-foreground py-0.5">
          └── (items placed here)
        </div>
      )}
      {mode === 'none' && (
        <div style={{ paddingLeft: `${baseSegs?.length * 14}px` }} className="text-muted-foreground py-0.5 flex items-center gap-1.5">
          <span>└──</span>
          <Icon name="Package" size={11} className="text-muted-foreground/60 flex-shrink-0" />
          <span>All items</span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-table card
// ---------------------------------------------------------------------------
function TableOrganiseCard({ table, tableIndex, tableState, onSaveToChange, onGroupingChange }) {
  const saveTo = tableState?.saveTo || '';

  // Top-level mode: 'quick' | 'organise'
  const topMode = tableState?.topMode ?? 'quick';

  // Sub-option when organise is selected: 'sections' | 'custom' | 'none'
  const subMode = tableState?.subMode ?? 'sections';

  // Column selected for custom split
  const splitByColumn = tableState?.splitByColumn ?? '';

  // All column headers from this table (for dynamic dropdown)
  const columnHeaders = useMemo(() => getColumnHeaders(table, tableState), [table, tableState]);

  // Build nested section tree for "Use document sections"
  const sectionTree = useMemo(() => {
    if (topMode !== 'organise' || subMode !== 'sections') return [];
    return buildDocumentSectionTree(table, tableState);
  }, [table, tableState, topMode, subMode]);

  // Detect whether groups exist (manually marked OR auto-detected)
  const { groupRows: detectedGroupRows, autoDetected } = useMemo(() => {
    if (topMode !== 'organise' || subMode !== 'sections') return { groupRows: [], autoDetected: false };
    return collectGroupRows(table, tableState);
  }, [table, tableState, topMode, subMode]);

  const hasGroupRows = detectedGroupRows?.length > 0;

  // Count total leaf nodes (deepest folders) in the tree
  function countLeafNodes(nodes) {
    let count = 0;
    nodes?.forEach((n) => {
      if (n?.children?.length === 0) count++;
      else count += countLeafNodes(n?.children);
    });
    return count;
  }
  const leafCount = useMemo(() => countLeafNodes(sectionTree), [sectionTree]);

  // Preview values for custom split mode
  const customPreviewValues = useMemo(() => {
    if (topMode !== 'organise' || subMode !== 'custom' || !splitByColumn) return [];
    return collectValuesForColumn(table, tableState, splitByColumn);
  }, [table, tableState, topMode, subMode, splitByColumn]);

  const previewMode = topMode === 'quick' ? 'none' : subMode === 'none' ? 'none' : subMode;

  // Handlers that delegate to parent via onGroupingChange
  function handleTopMode(mode) {
    onGroupingChange(table?.id, { topMode: mode, subMode: tableState?.subMode ?? 'sections', splitByColumn: tableState?.splitByColumn ?? '' });
  }
  function handleSubMode(mode) {
    onGroupingChange(table?.id, { topMode: 'organise', subMode: mode, splitByColumn: tableState?.splitByColumn ?? '' });
  }
  function handleSplitByColumn(col) {
    onGroupingChange(table?.id, { topMode: 'organise', subMode: 'custom', splitByColumn: col });
  }

  return (
    <div className="border border-border rounded-2xl p-4 bg-card space-y-4">
      {/* Table header */}
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
          <Icon name="Table" size={13} className="text-primary" />
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">Table {tableIndex + 1}</p>
          <p className="text-xs text-muted-foreground">{table?.rowCount} rows</p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Left: controls */}
        <div className="space-y-4">
          {/* Save to */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <Icon name="FolderOpen" size={12} className="text-primary" />
              Save to
            </label>
            <input
              type="text"
              value={saveTo}
              onChange={(e) => onSaveToChange(table?.id, e?.target?.value)}
              placeholder="e.g. Medical"
              className="w-full text-sm border border-border rounded-xl px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-muted-foreground/50"
            />
            <p className="text-xs text-muted-foreground">
              Use <code className="bg-muted px-1 rounded text-xs">&gt;</code> for nested folders, e.g.{' '}
              <span className="text-foreground">Medical &gt; MSOS</span>
            </p>
          </div>

          {/* Top-level: Quick import vs Organise into folders */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-foreground">Import method</label>
            <div className="space-y-2">
              {/* Quick import */}
              <label
                className={`flex items-start gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-all ${
                  topMode === 'quick' ?'border-primary bg-primary/5' :'border-border hover:border-primary/30 hover:bg-muted/20'
                }`}
              >
                <div className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all ${topMode === 'quick' ? 'border-primary' : 'border-border'}`}>
                  {topMode === 'quick' && <div className="w-2 h-2 rounded-full bg-primary" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-foreground font-medium">Quick import</span>
                    <span className="text-xs px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium flex-shrink-0">recommended</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">Import all items directly into the destination folder</p>
                </div>
                <input type="radio" name={`topmode-${table?.id}`} value="quick" checked={topMode === 'quick'} onChange={() => handleTopMode('quick')} className="sr-only" />
              </label>

              {/* Organise into folders */}
              <label
                className={`flex items-start gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-all ${
                  topMode === 'organise' ?'border-primary bg-primary/5' :'border-border hover:border-primary/30 hover:bg-muted/20'
                }`}
              >
                <div className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all ${topMode === 'organise' ? 'border-primary' : 'border-border'}`}>
                  {topMode === 'organise' && <div className="w-2 h-2 rounded-full bg-primary" />}
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-sm text-foreground font-medium">Organise into folders</span>
                  <p className="text-xs text-muted-foreground mt-0.5">Split items into subfolders based on the document</p>
                </div>
                <input type="radio" name={`topmode-${table?.id}`} value="organise" checked={topMode === 'organise'} onChange={() => handleTopMode('organise')} className="sr-only" />
              </label>
            </div>
          </div>

          {/* Sub-options — only when "Organise into folders" is selected */}
          {topMode === 'organise' && (
            <div className="space-y-2 pl-3 border-l-2 border-primary/20">
              <label className="text-xs font-semibold text-foreground">How should we split these items?</label>
              <div className="space-y-2">
                {/* Use document sections */}
                <label
                  className={`flex items-start gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-all ${
                    subMode === 'sections' ?'border-primary bg-primary/5' :'border-border hover:border-primary/30 hover:bg-muted/20'
                  }`}
                >
                  <div className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all ${subMode === 'sections' ? 'border-primary' : 'border-border'}`}>
                    {subMode === 'sections' && <div className="w-2 h-2 rounded-full bg-primary" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm text-foreground font-medium">Use document sections</span>
                      <span className="text-xs px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium flex-shrink-0">recommended</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">Groups items based on document structure</p>
                  </div>
                  <input type="radio" name={`submode-${table?.id}`} value="sections" checked={subMode === 'sections'} onChange={() => handleSubMode('sections')} className="sr-only" />
                </label>

                {/* Choose how to split them */}
                <label
                  className={`flex items-start gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-all ${
                    subMode === 'custom' ?'border-primary bg-primary/5' :'border-border hover:border-primary/30 hover:bg-muted/20'
                  }`}
                >
                  <div className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all ${subMode === 'custom' ? 'border-primary' : 'border-border'}`}>
                    {subMode === 'custom' && <div className="w-2 h-2 rounded-full bg-primary" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-foreground font-medium">Choose how to split them</span>
                    <p className="text-xs text-muted-foreground mt-0.5">Allows you to select how folders are created</p>
                  </div>
                  <input type="radio" name={`submode-${table?.id}`} value="custom" checked={subMode === 'custom'} onChange={() => handleSubMode('custom')} className="sr-only" />
                </label>

                {/* Don't split */}
                <label
                  className={`flex items-start gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-all ${
                    subMode === 'none' ?'border-primary bg-primary/5' :'border-border hover:border-primary/30 hover:bg-muted/20'
                  }`}
                >
                  <div className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all ${subMode === 'none' ? 'border-primary' : 'border-border'}`}>
                    {subMode === 'none' && <div className="w-2 h-2 rounded-full bg-primary" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-foreground font-medium">Don't split</span>
                    <p className="text-xs text-muted-foreground mt-0.5">All items placed directly in the destination folder</p>
                  </div>
                  <input type="radio" name={`submode-${table?.id}`} value="none" checked={subMode === 'none'} onChange={() => handleSubMode('none')} className="sr-only" />
                </label>
              </div>

              {/* Dynamic "Split by" dropdown — only when "Choose how to split them" is selected */}
              {subMode === 'custom' && (
                <div className="space-y-1.5 pt-1">
                  <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <Icon name="SplitSquareHorizontal" size={12} className="text-primary" />
                    Split by
                  </label>
                  {columnHeaders?.length > 0 ? (
                    <select
                      value={splitByColumn}
                      onChange={(e) => handleSplitByColumn(e?.target?.value)}
                      className="w-full text-sm border border-border rounded-xl px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                    >
                      <option value="">— Select a column —</option>
                      {columnHeaders?.map((col) => (
                        <option key={col} value={col}>{col}</option>
                      ))}
                    </select>
                  ) : (
                    <p className="text-xs text-amber-600 flex items-center gap-1">
                      <Icon name="AlertTriangle" size={11} />
                      No columns detected — confirm the header row in the Tables step
                    </p>
                  )}
                </div>
              )}

              {/* Document sections status */}
              {subMode === 'sections' && (
                <div className="pt-1">
                  {sectionTree?.length > 0 ? (
                    <p className="text-xs text-green-700 flex items-center gap-1">
                      <Icon name="CheckCircle2" size={11} />
                      {leafCount} folder{leafCount !== 1 ? 's' : ''} detected from document structure
                      {autoDetected && <span className="text-green-600/70 ml-1">(auto-detected)</span>}
                    </p>
                  ) : hasGroupRows ? (
                    <p className="text-xs text-amber-600 flex items-center gap-1">
                      <Icon name="AlertTriangle" size={11} />
                      Group rows found but nesting could not be determined
                    </p>
                  ) : (
                    <p className="text-xs text-amber-600 flex items-center gap-1">
                      <Icon name="AlertTriangle" size={11} />
                      No section structure detected — items will be placed in the base folder
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: live folder preview */}
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
            <Icon name="Eye" size={12} className="text-primary" />
            Folder preview
          </p>
          <div className="border border-border rounded-xl p-3 bg-muted/20 min-h-[120px] overflow-y-auto max-h-64">
            <FolderTreePreview
              saveTo={saveTo}
              groupValues={customPreviewValues}
              mode={topMode === 'quick' ? 'none' : subMode}
              sectionTree={sectionTree}
            />
          </div>
          {topMode === 'organise' && subMode === 'sections' && sectionTree?.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Nested folder structure detected from document
            </p>
          )}
          {topMode === 'organise' && subMode === 'custom' && customPreviewValues?.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {customPreviewValues?.length} subfolder{customPreviewValues?.length !== 1 ? 's' : ''} will be created
            </p>
          )}
          {topMode === 'organise' && subMode === 'custom' && customPreviewValues?.length === 0 && (
            <p className="text-xs text-amber-600 flex items-center gap-1">
              <Icon name="AlertTriangle" size={11} />
              No grouping values found — items will be placed in the base folder
            </p>
          )}
          {(topMode === 'quick' || subMode === 'none') && (
            <p className="text-xs text-muted-foreground">
              All items will be saved directly into the destination folder
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function SaveAndOrganiseStep({ tables, tableStates, onTableSaveToChange, onTableGroupingChange, onNext, onBack }) {
  const includedTables = tables?.filter(
    (t) => tableStates?.[t?.id]?.included && tableStates?.[t?.id]?.reviewStatus !== 'skipped'
  );

  const allHaveDestination = includedTables?.every((t) => {
    const saveTo = tableStates?.[t?.id]?.saveTo?.trim();
    return saveTo && saveTo?.length > 0;
  });

  return (
    <div className="space-y-4">
      {/* Info banner */}
      <div className="flex items-start gap-3 p-4 bg-primary/5 border border-primary/20 rounded-xl">
        <Icon name="FolderOpen" size={18} className="text-primary flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-foreground">Save &amp; Organise</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Choose where each table's items will be saved. Use Quick import to get started fast, or organise items into folders if needed.
          </p>
        </div>
      </div>

      {/* Per-table cards */}
      <div className="space-y-3 max-h-[440px] overflow-y-auto pr-1">
        {includedTables?.map((table) => {
          const globalIdx = tables?.findIndex((t) => t?.id === table?.id);
          return (
            <TableOrganiseCard
              key={table?.id}
              table={table}
              tableIndex={globalIdx}
              tableState={tableStates?.[table?.id]}
              onSaveToChange={onTableSaveToChange}
              onGroupingChange={onTableGroupingChange}
            />
          );
        })}
      </div>

      {/* Bottom nav */}
      <div className="flex items-center justify-between pt-2 border-t border-border">
        <Button variant="outline" onClick={onBack} className="gap-2">
          <Icon name="ArrowLeft" size={16} />Back
        </Button>
        <div className="flex items-center gap-3">
          {!allHaveDestination && (
            <span className="text-xs text-amber-600 flex items-center gap-1">
              <Icon name="AlertTriangle" size={12} />
              Set a destination for each table
            </span>
          )}
          <Button onClick={onNext} className="gap-2">
            <Icon name="Upload" size={16} />
            Import Items
            <Icon name="ArrowRight" size={16} />
          </Button>
        </div>
      </div>
    </div>
  );
}
