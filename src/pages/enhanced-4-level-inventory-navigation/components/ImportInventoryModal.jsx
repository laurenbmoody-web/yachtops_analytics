import React, { useState, useRef, useEffect } from 'react';
import Icon from '../../../components/AppIcon';
import { parseSpreadsheetFile, parsePDFText } from '../../../services/inventoryImportParser';
import { saveItem, createFolder } from '../../inventory/utils/inventoryStorage';
import { supabase } from '../../../lib/supabaseClient';
import { useTenant } from '../../../contexts/TenantContext';

const ACCEPTED_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/pdf',
];

const ACCEPTED_EXTENSIONS = ['.xlsx', '.xls', '.csv', '.pdf'];

// Core columns always shown in preview
const CORE_PREVIEW_COLUMNS = [
  { key: 'item_name', label: 'Item Name' },
  { key: 'brand', label: 'Brand' },
  { key: 'year', label: 'Year' },
  { key: 'unit', label: 'Unit' },
  { key: 'size', label: 'Size' },
  { key: 'quantity', label: 'Qty' },
  { key: 'restock_level', label: 'Restock' },
  { key: 'supplier', label: 'Supplier' },
];

// Build a flat list of all folder paths from the folderTree
const buildFolderList = (folderTree) => {
  if (!folderTree) return [];
  const results = [];

  const traverse = (segments) => {
    const key = segments?.join('|||');
    const children = folderTree?.[key]?.subFolders || [];
    children?.forEach((childName) => {
      const childSegments = [...segments, childName];
      results?.push(childSegments);
      traverse(childSegments);
    });
  };

  traverse([]);
  return results;
};

// DrillDownFolderPicker
function DrillDownFolderPicker({ folderTree, selectedSegments, onSelect }) {
  const [expandedPaths, setExpandedPaths] = useState({});

  const toggleExpand = (key) => {
    setExpandedPaths((prev) => ({ ...prev, [key]: !prev?.[key] }));
  };

  const renderLevel = (segments, depth = 0) => {
    const key = segments?.join('|||');
    const children = folderTree?.[key]?.subFolders || [];
    if (!children?.length) return null;

    return (
      <ul className={depth === 0 ? 'space-y-0.5' : 'ml-4 mt-0.5 space-y-0.5 border-l border-border pl-2'}>
        {children?.map((childName) => {
          const childSegments = [...segments, childName];
          const childKey = childSegments?.join('|||');
          const isExpanded = expandedPaths?.[childKey];
          const isSelected = selectedSegments?.join('|||') === childKey;
          const hasChildren = (folderTree?.[childKey]?.subFolders || [])?.length > 0;

          return (
            <li key={childKey}>
              <div
                className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer transition-colors text-sm ${
                  isSelected
                    ? 'bg-primary/15 text-primary font-medium' :'hover:bg-muted/60 text-foreground'
                }`}
                onClick={() => {
                  onSelect(childSegments);
                  if (hasChildren) toggleExpand(childKey);
                }}
              >
                <Icon
                  name={hasChildren ? (isExpanded ? 'ChevronDown' : 'ChevronRight') : 'Dot'}
                  size={14}
                  className="text-muted-foreground flex-shrink-0"
                />
                <Icon name="Folder" size={14} className={isSelected ? 'text-primary' : 'text-muted-foreground'} />
                <span className="truncate">{childName}</span>
              </div>
              {hasChildren && isExpanded && renderLevel(childSegments, depth + 1)}
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <div className="border border-border rounded-xl p-3 max-h-56 overflow-y-auto bg-muted/20">
      {renderLevel([])}
      {buildFolderList(folderTree)?.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-4">No folders available</p>
      )}
    </div>
  );
}

// Location match confidence badge
function LocationBadge({ confidence }) {
  if (confidence === 'exact') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-green-600 font-medium">
        <Icon name="CheckCircle2" size={11} />
        Exact
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-destructive font-medium">
      <Icon name="XCircle" size={11} />
      Unmatched
    </span>
  );
}

// ---------------------------------------------------------------------------
// Field Mapping Panel Component
// ---------------------------------------------------------------------------

const FIELD_TYPE_COLORS = {
  core: 'bg-primary/10 text-primary border-primary/20',
  source: 'bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/20',
  custom: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20',
  ignore: 'bg-muted text-muted-foreground border-border',
};

const FIELD_TYPE_LABELS = {
  core: 'Core Field',
  source: 'Custom Field',
  custom: 'Custom Field',
  ignore: 'Ignored',
};

// All available core field targets the user can map a column to
const CORE_FIELD_OPTIONS = [
  { value: 'item_name', label: 'Item Name' },
  { value: 'brand', label: 'Brand' },
  { value: 'quantity', label: 'Quantity' },
  { value: 'unit', label: 'Unit' },
  { value: 'size', label: 'Size' },
  { value: 'expiry_date', label: 'Expiry Date' },
  { value: 'supplier', label: 'Supplier' },
  { value: 'restock_level', label: 'Restock Level' },
  { value: 'year', label: 'Year' },
  { value: 'notes', label: 'Notes' },
  { value: 'batch_no', label: 'Batch No' },
  { value: 'code', label: 'Code / SKU' },
];

function FieldMappingPanel({ detectedSchema, fieldOverrides, onFieldOverrideChange }) {
  if (!detectedSchema?.fieldMappings?.length) return null;

  const visibleMappings = detectedSchema?.fieldMappings?.filter(
    (f) => f?.sourceHeader && String(f?.sourceHeader)?.trim() !== ''
  );

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 bg-muted/40 border-b border-border">
        <Icon name="Columns" size={14} className="text-primary" />
        <p className="text-sm font-semibold text-foreground">Detected Column Mapping</p>
        <span className="ml-auto text-xs text-muted-foreground">{visibleMappings?.length} columns detected</span>
      </div>
      <div className="divide-y divide-border max-h-64 overflow-y-auto">
        {visibleMappings?.map((mapping, idx) => {
          const override = fieldOverrides?.[mapping?.sourceHeader];
          const effectiveType = override?.type ?? mapping?.type;
          const effectiveCoreKey = override?.coreKey ?? (effectiveType === 'core' ? mapping?.coreKey : null);
          const colorClass = FIELD_TYPE_COLORS?.[effectiveType] || FIELD_TYPE_COLORS?.custom;

          return (
            <div key={idx} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/20 transition-colors">
              {/* Source header */}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground truncate">
                  {mapping?.sourceHeader}
                </p>
                <p className="text-xs text-muted-foreground">
                  {mapping?.inferredType && (
                    <span className="mr-2 capitalize">{mapping?.inferredType}</span>
                  )}
                  {effectiveType === 'core' && effectiveCoreKey && (
                    <span className="text-primary">→ {effectiveCoreKey}</span>
                  )}
                  {(effectiveType === 'source' || effectiveType === 'custom') && (
                    <span className="text-violet-600">→ source_fields.{mapping?.sourceKey || mapping?.sourceHeader}</span>
                  )}
                </p>
              </div>
              {/* Type badge + override selector */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${colorClass}`}>
                  {effectiveType === 'core' && effectiveCoreKey
                    ? (CORE_FIELD_OPTIONS?.find(o => o?.value === effectiveCoreKey)?.label || 'Core Field')
                    : (FIELD_TYPE_LABELS?.[effectiveType] || 'Custom Field')}
                </span>
                {/* Primary type selector */}
                <select
                  value={effectiveType === 'core' ? `core:${effectiveCoreKey || mapping?.coreKey || ''}` : effectiveType}
                  onChange={(e) => {
                    const val = e?.target?.value;
                    if (val?.startsWith('core:')) {
                      const coreKey = val?.replace('core:', '');
                      onFieldOverrideChange(mapping?.sourceHeader, { type: 'core', coreKey });
                    } else {
                      onFieldOverrideChange(mapping?.sourceHeader, { type: val, coreKey: null });
                    }
                  }}
                  className="text-xs border border-border rounded-lg px-2 py-1 bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <optgroup label="Core Fields">
                    {CORE_FIELD_OPTIONS?.map(opt => (
                      <option key={opt?.value} value={`core:${opt?.value}`}>{opt?.label}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Other">
                    <option value="source">Custom Field</option>
                    <option value="ignore">Ignore</option>
                  </optgroup>
                </select>
              </div>
            </div>
          );
        })}
      </div>
      <div className="px-4 py-2.5 bg-muted/20 border-t border-border">
        <p className="text-xs text-muted-foreground">
          <Icon name="Info" size={11} className="inline mr-1" />
          Core fields map to Cargo's standard inventory model. Custom fields are preserved as metadata on each item.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Duplicate detection helpers
// ---------------------------------------------------------------------------

function normaliseItemName(name) {
  if (!name) return '';
  return name?.toLowerCase()?.replace(/[^a-z0-9\s]/g, '')?.replace(/\s+/g, ' ')?.trim();
}

function detectInBatchDuplicates(items) {
  const seen = {};
  items?.forEach((item) => {
    const key = normaliseItemName(item?.item_name || item?.name || '');
    if (!key) return;
    seen[key] = (seen?.[key] || 0) + 1;
  });
  return new Set(Object.keys(seen).filter((k) => seen[k] > 1));
}

function annotateDuplicates(items, inBatchSet, existingNamesSet) {
  return items?.map((item) => {
    const key = normaliseItemName(item?.item_name || item?.name || '');
    const inBatch = inBatchSet?.has(key);
    const inDb = existingNamesSet?.has(key);
    let duplicateType = null;
    if (inBatch && inDb) duplicateType = 'both';
    else if (inBatch) duplicateType = 'batch';
    else if (inDb) duplicateType = 'existing';
    return { ...item, duplicate_in_batch: inBatch, duplicate_in_db: inDb, duplicate_type: duplicateType };
  });
}

// ---------------------------------------------------------------------------
// Build dynamic preview columns from detected schema
// ---------------------------------------------------------------------------

function buildDynamicPreviewColumns(detectedSchema, fieldOverrides) {
  if (!detectedSchema?.dynamicColumns?.length) return CORE_PREVIEW_COLUMNS;

  const columns = [];
  const addedCoreKeys = new Set();

  for (const mapping of detectedSchema?.dynamicColumns) {
    const override = fieldOverrides?.[mapping?.sourceHeader];
    const effectiveType = override?.type ?? mapping?.type;

    // Skip ignored columns
    if (effectiveType === 'ignore') continue;

    if (effectiveType === 'core' && mapping?.coreKey) {
      if (!addedCoreKeys?.has(mapping?.coreKey)) {
        addedCoreKeys?.add(mapping?.coreKey);
        columns?.push({ key: mapping?.coreKey, label: mapping?.label || mapping?.sourceHeader, isCore: true });
      }
    } else {
      // Source or custom field — show from source_fields
      const key = mapping?.sourceKey || mapping?.coreKey || mapping?.sourceHeader?.toLowerCase()?.replace(/\s+/g, '_');
      columns?.push({
        key: `source_fields.${key}`,
        label: mapping?.sourceHeader,
        isSource: true,
        sourceKey: key,
      });
    }
  }

  // Ensure core columns that weren't in the source are still shown if they have data
  const coreDefaults = ['item_name', 'brand', 'year', 'unit', 'size', 'quantity'];
  for (const coreKey of coreDefaults) {
    if (!addedCoreKeys?.has(coreKey)) {
      const defaultCol = CORE_PREVIEW_COLUMNS?.find((c) => c?.key === coreKey);
      if (defaultCol) columns?.unshift({ ...defaultCol, isCore: true });
      addedCoreKeys?.add(coreKey);
    }
  }

  return columns?.length > 0 ? columns : CORE_PREVIEW_COLUMNS;
}

// ---------------------------------------------------------------------------
// Get cell value from item (handles nested source_fields)
// ---------------------------------------------------------------------------

function getCellValue(item, columnDef) {
  if (!columnDef?.key) return null;
  if (columnDef?.key?.startsWith('source_fields.')) {
    const sourceKey = columnDef?.sourceKey || columnDef?.key?.replace('source_fields.', '');
    return item?.source_fields?.[sourceKey] ?? null;
  }
  return item?.[columnDef?.key] ?? null;
}

export default function ImportInventoryModal({
  onClose,
  onImportComplete,
  currentPathSegments,
  currentLocation,
  currentSubLocation,
  folderTree,
  vesselLocations: vesselLocationsProp,
}) {
  // steps: 'upload' | 'parsing' | 'mapping' | 'folder' | 'preview' | 'importing' | 'done'
  const [step, setStep] = useState('upload');
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [parseError, setParseError] = useState(null);
  const [parsedItems, setParsedItems] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [importError, setImportError] = useState(null);
  const [importedCount, setImportedCount] = useState(0);
  const [parseDiagnostics, setParseDiagnostics] = useState(null);

  // Detected schema from parser
  const [detectedSchema, setDetectedSchema] = useState(null);
  // User overrides for field mappings: { [sourceHeader]: { type: 'core'|'source'|'ignore' } }
  const [fieldOverrides, setFieldOverrides] = useState({});

  // Vessel locations
  const [supabaseVesselLocations, setSupabaseVesselLocations] = useState([]);
  const [vesselLocationsFetched, setVesselLocationsFetched] = useState(false);
  const vesselLocationsFetchedRef = useRef(false);
  const supabaseVesselLocationsRef = useRef([]);

  // Folder assignment state
  const [folderChoice, setFolderChoice] = useState('current');
  const [chosenSegments, setChosenSegments] = useState(null);

  // Per-row location overrides
  const [locationOverrides, setLocationOverrides] = useState({});

  // Per-row duplicate skip decisions
  const [duplicateSkips, setDuplicateSkips] = useState({});

  // Existing inventory item names for duplicate checking
  const [existingItemNames, setExistingItemNames] = useState(new Set());

  const fileInputRef = useRef(null);
  const { activeTenantId } = useTenant();

  // Fetch vessel locations
  useEffect(() => {
    const fetchVesselLocations = async () => {
      if (!activeTenantId) return;
      try {
        const { data, error } = await supabase?.from('vessel_locations')?.select('id, name, parent_id, level, sort_order')?.eq('tenant_id', activeTenantId)?.eq('is_archived', false)?.order('sort_order', { ascending: true });

        if (error || !data) { setVesselLocationsFetched(true); return; }

        const locationMap = {};
        data?.forEach(loc => { locationMap[loc.id] = loc; });

        const buildPath = (loc) => {
          const parts = [];
          let current = loc;
          while (current) {
            parts?.unshift(current?.name);
            current = current?.parent_id ? locationMap?.[current?.parent_id] : null;
          }
          return parts?.join(' > ');
        };

        const paths = data?.map(loc => buildPath(loc))?.filter(Boolean);
        const uniquePaths = [...new Set(paths)];
        supabaseVesselLocationsRef.current = uniquePaths;
        setSupabaseVesselLocations(uniquePaths);
      } catch (err) {
        console.warn('[ImportInventoryModal] Failed to fetch vessel_locations:', err);
      } finally {
        vesselLocationsFetchedRef.current = true;
        setVesselLocationsFetched(true);
      }
    };
    fetchVesselLocations();
  }, [activeTenantId]);

  // Fetch existing inventory item names for duplicate detection
  useEffect(() => {
    const fetchExistingNames = async () => {
      if (!activeTenantId) return;
      try {
        const { data, error } = await supabase?.from('inventory_items')?.select('name')?.eq('tenant_id', activeTenantId);
        if (error || !data) return;
        const nameSet = new Set(data?.map(row => normaliseItemName(row?.name || ''))?.filter(Boolean));
        setExistingItemNames(nameSet);
      } catch (err) {
        console.warn('[ImportInventoryModal] Failed to fetch existing item names:', err);
      }
    };
    fetchExistingNames();
  }, [activeTenantId]);

  const vesselLocations = supabaseVesselLocations;

  const effectiveSegments = folderChoice === 'current' ? currentPathSegments || [] : chosenSegments || currentPathSegments || [];
  const effectiveLocation = effectiveSegments?.[0] || null;
  const effectiveSubLocation = effectiveSegments?.length > 1 ? effectiveSegments?.slice(1)?.join(' > ') : null;
  const folderDisplayPath = effectiveSegments?.length > 0 ? effectiveSegments?.join(' › ') : 'Root';

  const hasUnresolvedLocations = parsedItems?.some((item, idx) => {
    const confidence = item?.location_match_confidence;
    if (confidence === 'none' && !locationOverrides?.[idx]) return true;
    return false;
  });

  const duplicateItems = parsedItems?.filter(item => item?.duplicate_type != null);
  const duplicateCount = duplicateItems?.length;
  const skippedDuplicateCount = Object.values(duplicateSkips)?.filter(Boolean)?.length;
  const importableItems = parsedItems?.filter((_, idx) => !duplicateSkips?.[idx]);

  // Dynamic preview columns based on detected schema
  const dynamicPreviewColumns = buildDynamicPreviewColumns(detectedSchema, fieldOverrides);

  const isValidFile = (file) => {
    if (!file) return false;
    const ext = '.' + file?.name?.split('.')?.pop()?.toLowerCase();
    return ACCEPTED_EXTENSIONS?.includes(ext) || ACCEPTED_TYPES?.includes(file?.type);
  };

  const handleFileSelect = (file) => {
    if (!isValidFile(file)) {
      setParseError('Please upload a valid file: XLSX, XLS, CSV, or PDF.');
      return;
    }
    setParseError(null);
    setSelectedFile(file);
  };

  const handleDrop = (e) => {
    e?.preventDefault();
    setDragOver(false);
    const file = e?.dataTransfer?.files?.[0];
    if (file) handleFileSelect(file);
  };

  const handleFileInputChange = (e) => {
    const file = e?.target?.files?.[0];
    if (file) handleFileSelect(file);
    e.target.value = '';
  };

  const handleFieldOverrideChange = (sourceHeader, override) => {
    setFieldOverrides(prev => ({ ...prev, [sourceHeader]: { ...(prev?.[sourceHeader] || {}), ...override } }));
  };

  const handleParse = async () => {
    if (!selectedFile) return;
    setStep('parsing');
    setParseError(null);
    setParseDiagnostics(null);
    setDetectedSchema(null);
    setFieldOverrides({});

    try {
      if (!vesselLocationsFetchedRef?.current) {
        await new Promise((resolve) => {
          const interval = setInterval(() => {
            if (vesselLocationsFetchedRef.current) { clearInterval(interval); resolve(); }
          }, 100);
          setTimeout(() => { clearInterval(interval); resolve(); }, 8000);
        });
      }

      const confirmedVesselLocations = supabaseVesselLocationsRef?.current;

      const ext = selectedFile?.name?.split('.')?.pop()?.toLowerCase();
      let result;
      if (ext === 'pdf') {
        result = await parsePDFText(selectedFile, confirmedVesselLocations);
      } else {
        result = await parseSpreadsheetFile(selectedFile, confirmedVesselLocations);
      }

      if (result?.diagnostics) setParseDiagnostics(result?.diagnostics);
      if (result?.detectedSchema) setDetectedSchema(result?.detectedSchema);

      if (result?.error) {
        setParseError(result?.error);
        setStep('upload');
        return;
      }

      // Enforce strict location matching
      const confirmedLocationSet = new Set((confirmedVesselLocations ?? [])?.map(p => p?.trim()));
      const itemsWithEnforcedLocations = (result?.items ?? [])?.map(item => {
        const aiMatch = item?.location_match;
        const aiConfidence = item?.location_match_confidence;
        if (
          aiConfidence === 'exact' && aiMatch && typeof aiMatch === 'string' &&
          confirmedLocationSet?.size > 0 && confirmedLocationSet?.has(aiMatch?.trim())
        ) {
          return { ...item, location_match: aiMatch?.trim(), location_match_confidence: 'exact', location_suggestions: [] };
        }
        return { ...item, location_match: null, location_match_confidence: 'none', location_suggestions: [] };
      });

      const normalised = itemsWithEnforcedLocations?.map(item => ({
        ...item,
        warnings: Array.isArray(item?.warnings)
          ? item?.warnings?.map(w => (typeof w === 'object' && w !== null ? w?.warning ?? JSON.stringify(w) : String(w ?? '')))
          : [],
      }));

      const inBatchSet = detectInBatchDuplicates(normalised);
      const annotated = annotateDuplicates(normalised, inBatchSet, existingItemNames);

      setParsedItems(annotated);
      setWarnings((result?.warnings ?? [])?.map(w =>
        typeof w === 'object' && w !== null ? w?.warning ?? JSON.stringify(w) : String(w ?? '')
      ));
      setLocationOverrides({});
      setDuplicateSkips({});

      // If schema was detected, go to mapping step first; otherwise go to folder step
      if (result?.detectedSchema?.fieldMappings?.length > 0) {
        setStep('mapping');
      } else {
        setStep('folder');
      }
    } catch (err) {
      setParseError('An unexpected error occurred while parsing the file.');
      setStep('upload');
    }
  };

  const resolveItemLocation = (item, idx) => {
    if (locationOverrides?.[idx]) return locationOverrides?.[idx];
    if (item?.location_match && item?.location_match_confidence === 'exact') return item?.location_match;
    return null;
  };

  const ensureFolderPathExists = async (segments) => {
    if (!segments || segments?.length === 0) return segments;
    if (segments?.length < 2) {
      throw new Error(`Subfolder required — items cannot be saved directly in department folders. "${segments?.[0]}" is a top-level department folder.`);
    }
    for (let i = 0; i < segments?.length; i++) {
      const parentSegments = segments?.slice(0, i);
      const name = segments?.[i];
      try { await createFolder(parentSegments, name); } catch (_) {}
    }
    return segments;
  };

  const handleConfirmImport = async () => {
    if (!importableItems?.length) return;
    setStep('importing');
    setImportError(null);

    let count = 0;
    const skippedItems = [];

    for (let idx = 0; idx < parsedItems?.length; idx++) {
      if (duplicateSkips?.[idx]) continue;

      const item = parsedItems?.[idx];
      try {
        const resolvedVesselPath = resolveItemLocation(item, idx);
        const vesselStockLocations = resolvedVesselPath
          ? [{ locationName: resolvedVesselPath, qty: parseFloat(item?.quantity) || 0 }]
          : [];

        let folderPath = item?.suggested_folder || '';

        if (!folderPath && item?.category && item?.subcategory) {
          const cat = item?.category;
          const sub = item?.subcategory;
          const spiritsTypes = ['Vodka', 'Gin', 'Tequila', 'Rum', 'Whisky', 'Cognac'];
          if (cat === 'Alcohol') {
            if (spiritsTypes?.includes(sub)) folderPath = `Interior > Guest > Alcohol > Spirits > ${sub}`;
            else if (sub === 'Aperitif') folderPath = 'Interior > Guest > Alcohol > Aperitif';
            else if (sub === 'Champagne') folderPath = 'Interior > Guest > Alcohol > Champagne';
            else if (sub === 'Sparkling Wine') folderPath = 'Interior > Guest > Alcohol > Sparkling Wine';
            else if (sub === 'Wine') folderPath = 'Interior > Guest > Alcohol > Wine';
            else if (sub === 'Beer') folderPath = 'Interior > Guest > Alcohol > Beer';
            else if (sub === 'Cider') folderPath = 'Interior > Guest > Alcohol > Cider';
            else if (sub) folderPath = `Interior > Guest > Alcohol > ${sub}`;
          } else if (cat === 'Non-Alcoholic') {
            if (sub === 'Hot Beverages') folderPath = 'Interior > Guest > Hot Beverages';
            else if (sub) folderPath = `Interior > Guest > Non-Alcoholic > ${sub}`;
          }
        }

        if (!folderPath) {
          const fallbackSegments = effectiveSegments || [];
          if (fallbackSegments?.length >= 2) folderPath = fallbackSegments?.join(' > ');
        }

        const folderSegments = folderPath
          ? folderPath?.split(' > ')?.map(s => s?.trim())?.filter(Boolean)
          : [];

        // ── Department-depth guard ────────────────────────────────────────
        // Items must always be at least 2 levels deep (department > subfolder).
        // If we only resolved to a single segment (department level), skip this item.
        if (folderSegments?.length < 2) {
          const deptName = folderSegments?.[0] || effectiveSegments?.[0] || 'Unknown';
          skippedItems?.push({
            name: item?.item_name || item?.name || '(unnamed)',
            reason: `Subfolder required — items cannot be saved directly in department folders. "${deptName}" is a top-level department folder.`,
          });
          continue;
        }

        // ── Auto-create folder path if it doesn't exist ───────────────────
        let resolvedSegments;
        try {
          resolvedSegments = await ensureFolderPathExists(folderSegments);
        } catch (folderErr) {
          skippedItems?.push({ name: item?.item_name || item?.name || '(unnamed)', reason: folderErr?.message || 'Subfolder required.' });
          continue;
        }

        // Build metadata from source_fields
        const sourceFieldsData = item?.source_fields || {};

        // ── Apply fieldOverrides to extract core field values from source_fields ──
        // When the user manually maps a column to a core field (e.g. "Expiry Date" → expiry_date),
        // the value may be in source_fields under the original header name. Extract it here.
        const getOverriddenCoreValue = (coreKey) => {
          // 1. Check explicit user overrides (from FieldMappingPanel dropdown)
          for (const [sourceHeader, override] of Object.entries(fieldOverrides || {})) {
            if (override?.type === 'core' && override?.coreKey === coreKey) {
              // Look up the value in source_fields using the original header
              const normalizedKey = sourceHeader?.toLowerCase()?.replace(/[\s\-]+/g, '_');
              const val = sourceFieldsData?.[sourceHeader] || sourceFieldsData?.[normalizedKey] || null;
              if (val) return val;
            }
          }
          // 2. Check schema auto-detections — if the schema mapped this header to this coreKey,
          //    the AI may have placed the value in source_fields instead of the top-level field
          if (detectedSchema?.fieldMappings) {
            for (const mapping of detectedSchema?.fieldMappings) {
              if (mapping?.type === 'core' && mapping?.coreKey === coreKey) {
                const sourceHeader = mapping?.sourceHeader;
                const normalizedKey = sourceHeader?.toLowerCase()?.replace(/[\s\-]+/g, '_');
                const val = sourceFieldsData?.[sourceHeader] || sourceFieldsData?.[normalizedKey] || null;
                if (val) return val;
              }
            }
          }
          return null;
        };

        // Resolve expiry date: top-level from AI → fieldOverride/schema extraction → source_fields key variants
        const resolveExpiryDate = () => {
          // 1. AI already placed it at top level
          if (item?.expiry_date) {
            console.log('[ImportInventoryModal] resolveExpiryDate: found at item.expiry_date =', item?.expiry_date);
            return item?.expiry_date;
          }
          // 2. User override or schema auto-detection mapped a column to expiry_date
          const overrideVal = getOverriddenCoreValue('expiry_date');
          if (overrideVal) {
            console.log('[ImportInventoryModal] resolveExpiryDate: found via override/schema =', overrideVal);
            return overrideVal;
          }
          // 3. Fallback: search source_fields for common expiry date key variations
          const expiryKeys = [
            'expiry_date', 'expiry date', 'Expiry Date', 'ExpiryDate', 'expiry', 'Expiry',
            'exp_date', 'exp date', 'Exp Date', 'exp', 'Exp',
            'best_before', 'best before', 'Best Before', 'BBE', 'bbe',
            'use_by', 'use by', 'Use By',
            'sell_by', 'sell by', 'Sell By',
            'bb_date', 'BB Date',
          ];
          for (const key of expiryKeys) {
            if (sourceFieldsData?.[key]) {
              console.log('[ImportInventoryModal] resolveExpiryDate: found in source_fields[' + key + '] =', sourceFieldsData?.[key]);
              return sourceFieldsData?.[key];
            }
          }
          console.log('[ImportInventoryModal] resolveExpiryDate: no expiry date found. source_fields keys:', Object.keys(sourceFieldsData));
          return null;
        };

        const resolvedExpiry = resolveExpiryDate();
        console.log('[ImportInventoryModal] Item:', item?.item_name || item?.name, '| resolvedExpiry:', resolvedExpiry);

        // Extract colour from source_fields so folder cards can display colour accents
        const resolvedColour =
          item?.colour || item?.color ||
          sourceFieldsData?.colour || sourceFieldsData?.color ||
          sourceFieldsData?.Colour || sourceFieldsData?.Color ||
          null;

        const itemData = {
          name: item?.item_name || item?.name || '',
          brand: item?.brand || '',
          description: item?.description || '',
          quantity: parseFloat(item?.quantity) || 0,
          unit: item?.unit || '',
          size: item?.size || '',
          // Inventory folder path — derived from resolvedSegments (AI-classified or user-chosen)
          location: resolvedSegments?.[0] || '',
          subLocation: resolvedSegments?.length > 1 ? resolvedSegments?.slice(1)?.join(' > ') : '',
          // Inventory folder / category path (taxonomy)
          l1Name: resolvedSegments?.[0] || '',
          l2Name: resolvedSegments?.[1] || '',
          l3Name: resolvedSegments?.[2] || '',
          l4Name: resolvedSegments?.[3] || '',
          // Physical vessel location stored separately, does not affect folder tree
          stockLocations: vesselStockLocations,
          restockLevel: parseFloat(item?.restock_level) || null,
          restockEnabled: item?.restock_level != null && item?.restock_level !== '',
          supplier: item?.supplier || '',
          expiryDate: resolvedExpiry,
          barcode: item?.barcode || item?.code || sourceFieldsData?.code || '',
          year: item?.year != null && item?.year !== '' ? item?.year : null,
          tastingNotes: item?.tasting_notes || '',
          notes: item?.notes || sourceFieldsData?.notes || sourceFieldsData?.comments || '',
          category: item?.category || '',
          subcategory: item?.subcategory || '',
          // Colour stored in customFields so folder cards can read it
          customFields: resolvedColour ? { colour: resolvedColour } : undefined,
          // Store source-specific fields as metadata
          metadata: Object.keys(sourceFieldsData)?.length > 0 ? sourceFieldsData : undefined,
        };
        if (!itemData?.name) continue;
        await saveItem(itemData);
        count++;
      } catch (err) {
        if (err?.message?.includes('department folder')) {
          skippedItems?.push({ name: item?.item_name || item?.name || '(unnamed)', reason: err?.message });
        }
      }
    }

    setImportedCount(count);

    if (skippedItems?.length > 0) {
      const skippedNames = skippedItems?.slice(0, 5)?.map(s => `"${s?.name}"`)?.join(', ');
      const moreCount = skippedItems?.length > 5 ? ` and ${skippedItems?.length - 5} more` : '';
      setImportError(
        `${skippedItems?.length} item${skippedItems?.length !== 1 ? 's' : ''} skipped — subfolder required: ${skippedNames}${moreCount}.`
      );
    }

    setStep('done');
    if (onImportComplete) onImportComplete(count);
  };

  const currentPathDisplay = currentPathSegments?.length > 0 ? currentPathSegments?.join(' › ') : 'Root';

  const exactMatches = parsedItems?.filter(i => i?.location_match_confidence === 'exact')?.length;
  const noMatches = parsedItems?.filter(i => i?.location_match_confidence === 'none')?.length;
  const resolvedOverrides = Object.keys(locationOverrides)?.length;

  const toggleDuplicateSkip = (idx) => {
    setDuplicateSkips(prev => ({ ...prev, [idx]: !prev?.[idx] }));
  };
  const skipAllDuplicates = () => {
    const newSkips = {};
    parsedItems?.forEach((item, idx) => { if (item?.duplicate_type != null) newSkips[idx] = true; });
    setDuplicateSkips(newSkips);
  };
  const includeAllDuplicates = () => setDuplicateSkips({});

  // Step indicator config
  const stepConfig = [
    { key: 'upload', label: '1. Upload' },
    { key: 'mapping', label: '2. Columns' },
    { key: 'folder', label: '3. Folder' },
    { key: 'preview', label: '4. Preview' },
  ];
  const stepOrder = ['upload', 'mapping', 'folder', 'preview'];
  const currentStepIdx = stepOrder?.indexOf(step);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Icon name="Upload" size={16} className="text-primary" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">Import Inventory</h2>
              <p className="text-xs text-muted-foreground">Upload a spreadsheet or PDF to import items</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
            <Icon name="X" size={16} />
          </button>
        </div>

        {/* Step indicator */}
        {stepOrder?.includes(step) && (
          <div className="flex items-center gap-2 px-6 py-3 border-b border-border bg-muted/20 flex-shrink-0">
            {stepConfig?.map((s, i, arr) => (
              <React.Fragment key={s?.key}>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                  step === s?.key ? 'bg-primary text-primary-foreground'
                    : currentStepIdx > i ? 'bg-green-500/15 text-green-600' :'text-muted-foreground'
                }`}>
                  {s?.label}
                </span>
                {i < arr?.length - 1 && <Icon name="ChevronRight" size={12} className="text-muted-foreground" />}
              </React.Fragment>
            ))}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">

          {/* Upload step */}
          {step === 'upload' && (
            <div className="space-y-4">
              <div
                onDragOver={(e) => { e?.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef?.current?.click()}
                className={`border-2 border-dashed rounded-xl p-10 flex flex-col items-center justify-center cursor-pointer transition-all ${
                  dragOver ? 'border-primary bg-primary/5' : selectedFile ?'border-green-500/50 bg-green-500/5' :'border-border hover:border-primary/50 hover:bg-muted/40'
                }`}
              >
                <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv,.pdf" className="hidden" onChange={handleFileInputChange} />
                {selectedFile ? (
                  <>
                    <div className="w-12 h-12 rounded-xl bg-green-500/10 flex items-center justify-center mb-3">
                      <Icon name="FileCheck" size={22} className="text-green-600" />
                    </div>
                    <p className="text-sm font-medium text-foreground">{selectedFile?.name}</p>
                    <p className="text-xs text-muted-foreground mt-1">{(selectedFile?.size / 1024)?.toFixed(1)} KB — click to change</p>
                  </>
                ) : (
                  <>
                    <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center mb-3">
                      <Icon name="FileUp" size={22} className="text-muted-foreground" />
                    </div>
                    <p className="text-sm font-medium text-foreground">Drop your file here or click to browse</p>
                    <p className="text-xs text-muted-foreground mt-1">Supports XLSX, XLS, CSV, PDF</p>
                    <p className="text-xs text-muted-foreground mt-2 max-w-sm text-center">
                      Cargo will automatically detect your column headers and preserve all fields from the source document
                    </p>
                  </>
                )}
              </div>
              {parseError && (
                <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                  <Icon name="AlertCircle" size={15} className="text-destructive mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-destructive">{parseError}</p>
                </div>
              )}
            </div>
          )}

          {/* Parsing step */}
          {step === 'parsing' && (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
                <Icon name="Sparkles" size={24} className="text-primary animate-pulse" />
              </div>
              <div className="text-center">
                <p className="text-base font-semibold text-foreground">Processing your inventory file…</p>
                <p className="text-sm text-muted-foreground mt-1">Detecting columns, identifying items, and matching vessel locations</p>
              </div>
              <div className="flex gap-1.5 mt-2">
                <span className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          )}

          {/* Field Mapping step */}
          {step === 'mapping' && (
            <div className="space-y-5">
              <div>
                <p className="text-sm font-semibold text-foreground mb-1">Column Detection Results</p>
                <p className="text-xs text-muted-foreground">
                  Cargo detected {detectedSchema?.fieldMappings?.filter(f => f?.type !== 'ignore')?.length || 0} columns from your document.
                  Review how each column will be handled, and adjust if needed.
                </p>
              </div>

              {/* Schema summary chips */}
              {detectedSchema && (
                <div className="flex flex-wrap gap-2">
                  {detectedSchema?.coreFields?.length > 0 && (
                    <span className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-primary/10 text-primary border border-primary/20 font-medium">
                      <Icon name="Database" size={11} />
                      {detectedSchema?.coreFields?.length} core field{detectedSchema?.coreFields?.length !== 1 ? 's' : ''} mapped
                    </span>
                  )}
                  {detectedSchema?.sourceFields?.length > 0 && (
                    <span className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-violet-500/10 text-violet-700 dark:text-violet-400 border border-violet-500/20 font-medium">
                      <Icon name="Tag" size={11} />
                      {detectedSchema?.sourceFields?.length} custom field{detectedSchema?.sourceFields?.length !== 1 ? 's' : ''} preserved
                    </span>
                  )}
                  {detectedSchema?.ignoredFields?.length > 0 && (
                    <span className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-muted text-muted-foreground border border-border font-medium">
                      <Icon name="EyeOff" size={11} />
                      {detectedSchema?.ignoredFields?.length} column{detectedSchema?.ignoredFields?.length !== 1 ? 's' : ''} ignored
                    </span>
                  )}
                  <span className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-green-500/10 text-green-700 dark:text-green-400 border border-green-500/20 font-medium">
                    <Icon name="FileText" size={11} />
                    {parsedItems?.length} item{parsedItems?.length !== 1 ? 's' : ''} found
                  </span>
                </div>
              )}

              {/* Header row info */}
              {parseDiagnostics?.headerRowIndex != null && (
                <div className="flex items-center gap-2 p-3 bg-muted/30 border border-border rounded-lg">
                  <Icon name="AlignLeft" size={14} className="text-muted-foreground flex-shrink-0" />
                  <p className="text-xs text-muted-foreground">
                    Header row detected at <span className="font-semibold text-foreground">row {parseDiagnostics?.headerRowIndex + 1}</span>
                    {parseDiagnostics?.detectedHeaderRow?.length > 0 && (
                      <span className="ml-1">— {parseDiagnostics?.detectedHeaderRow?.filter(h => h)?.length} columns: {parseDiagnostics?.detectedHeaderRow?.filter(h => h)?.slice(0, 5)?.map(h => `"${h}"`)?.join(', ')}{parseDiagnostics?.detectedHeaderRow?.filter(h => h)?.length > 5 ? ` +${parseDiagnostics?.detectedHeaderRow?.filter(h => h)?.length - 5} more` : ''}</span>
                    )}
                  </p>
                </div>
              )}

              {/* Field mapping panel */}
              <FieldMappingPanel
                detectedSchema={detectedSchema}
                fieldOverrides={fieldOverrides}
                onFieldOverrideChange={handleFieldOverrideChange}
              />

              {/* Excluded rows info */}
              {parseDiagnostics?.categoryRows?.length > 0 && (
                <div className="p-3 bg-violet-500/8 border border-violet-500/20 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <Icon name="Filter" size={13} className="text-violet-600" />
                    <p className="text-xs font-semibold text-violet-700 dark:text-violet-400">
                      {parseDiagnostics?.categoryRows?.length} section/title row{parseDiagnostics?.categoryRows?.length !== 1 ? 's' : ''} excluded
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {parseDiagnostics?.categoryRows?.slice(0, 8)?.map((r, i) => (
                      <span key={i} className="text-xs px-1.5 py-0.5 bg-violet-500/10 text-violet-700 dark:text-violet-400 rounded font-medium">
                        "{r?.label}"
                      </span>
                    ))}
                    {parseDiagnostics?.categoryRows?.length > 8 && (
                      <span className="text-xs text-muted-foreground">+{parseDiagnostics?.categoryRows?.length - 8} more</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1.5">These rows were identified as section headers, not inventory items.</p>
                </div>
              )}
            </div>
          )}

          {/* Folder assignment step */}
          {step === 'folder' && (
            <div className="space-y-5">
              <div>
                <p className="text-sm font-semibold text-foreground mb-1">
                  Where should the {parsedItems?.length} imported item{parsedItems?.length !== 1 ? 's' : ''} be saved?
                </p>
                <p className="text-xs text-muted-foreground">Choose a default folder. Items with AI-classified folders will use those instead.</p>
              </div>

              <button
                onClick={() => setFolderChoice('current')}
                className={`w-full flex items-start gap-3 p-4 rounded-xl border-2 transition-all text-left ${
                  folderChoice === 'current' ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30 hover:bg-muted/30'
                }`}
              >
                <div className={`w-5 h-5 rounded-full border-2 flex-shrink-0 mt-0.5 flex items-center justify-center ${folderChoice === 'current' ? 'border-primary' : 'border-muted-foreground'}`}>
                  {folderChoice === 'current' && <div className="w-2.5 h-2.5 rounded-full bg-primary" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">Save to current folder</p>
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    {currentPathSegments?.length > 0 ? (
                      currentPathSegments?.map((seg, i) => (
                        <React.Fragment key={i}>
                          {i > 0 && <Icon name="ChevronRight" size={11} className="text-muted-foreground" />}
                          <span className="text-xs font-medium px-1.5 py-0.5 bg-muted rounded text-foreground">{seg}</span>
                        </React.Fragment>
                      ))
                    ) : (
                      <span className="text-xs text-muted-foreground italic">Root (no folder selected)</span>
                    )}
                  </div>
                </div>
              </button>

              <div>
                <button
                  onClick={() => setFolderChoice('choose')}
                  className={`w-full flex items-start gap-3 p-4 rounded-xl border-2 transition-all text-left ${
                    folderChoice === 'choose' ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30 hover:bg-muted/30'
                  }`}
                >
                  <div className={`w-5 h-5 rounded-full border-2 flex-shrink-0 mt-0.5 flex items-center justify-center ${folderChoice === 'choose' ? 'border-primary' : 'border-muted-foreground'}`}>
                    {folderChoice === 'choose' && <div className="w-2.5 h-2.5 rounded-full bg-primary" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">Choose a different folder</p>
                    {folderChoice === 'choose' && chosenSegments ? (
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        {chosenSegments?.map((seg, i) => (
                          <React.Fragment key={i}>
                            {i > 0 && <Icon name="ChevronRight" size={11} className="text-muted-foreground" />}
                            <span className="text-xs font-medium px-1.5 py-0.5 bg-primary/10 text-primary rounded">{seg}</span>
                          </React.Fragment>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground mt-0.5">Select from the folder tree below</p>
                    )}
                  </div>
                </button>

                {folderChoice === 'choose' && (
                  <div className="mt-2">
                    <DrillDownFolderPicker folderTree={folderTree} selectedSegments={chosenSegments} onSelect={setChosenSegments} />
                    {!chosenSegments && (
                      <p className="text-xs text-amber-600 mt-1.5 flex items-center gap-1">
                        <Icon name="AlertTriangle" size={12} />
                        Please select a folder to continue
                      </p>
                    )}
                  </div>
                )}
              </div>

              {(folderChoice === 'current' || (folderChoice === 'choose' && chosenSegments)) && (
                <div className="flex items-center gap-2 p-3 bg-green-500/8 border border-green-500/20 rounded-lg">
                  <Icon name="FolderCheck" size={15} className="text-green-600 flex-shrink-0" />
                  <p className="text-xs text-green-700 dark:text-green-400">
                    Default save location: <span className="font-semibold">{folderDisplayPath}</span>
                    {vesselLocations?.length > 0 && (
                      <span className="ml-1 text-muted-foreground">(items with matched vessel locations will use those instead)</span>
                    )}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Preview step */}
          {step === 'preview' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {parsedItems?.length} item{parsedItems?.length !== 1 ? 's' : ''} found
                    {skippedDuplicateCount > 0 && (
                      <span className="ml-2 text-xs text-muted-foreground">({importableItems?.length} will be imported)</span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">Review the parsed data before importing</p>
                </div>
                <button
                  onClick={() => { setStep('upload'); setSelectedFile(null); setParsedItems([]); setWarnings([]); setLocationOverrides({}); setDuplicateSkips({}); setParseDiagnostics(null); setDetectedSchema(null); setFieldOverrides({}); }}
                  className="text-xs text-muted-foreground hover:text-foreground underline"
                >
                  Upload different file
                </button>
              </div>

              {/* Schema summary banner */}
              {detectedSchema && (
                <div className="flex items-center gap-3 p-3 bg-muted/30 border border-border rounded-lg flex-wrap">
                  <Icon name="Columns" size={13} className="text-primary flex-shrink-0" />
                  <span className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{dynamicPreviewColumns?.length} columns</span> from source document
                    {detectedSchema?.sourceFields?.length > 0 && (
                      <span className="ml-1">· <span className="text-violet-600 font-medium">{detectedSchema?.sourceFields?.length} custom field{detectedSchema?.sourceFields?.length !== 1 ? 's' : ''}</span> preserved as metadata</span>
                    )}
                  </span>
                  <button onClick={() => setStep('mapping')} className="ml-auto text-xs text-primary hover:underline flex-shrink-0">
                    Edit column mapping
                  </button>
                </div>
              )}

              {/* Duplicate detection banner */}
              {duplicateCount > 0 && (
                <div className="border border-amber-500/30 bg-amber-500/8 rounded-xl overflow-hidden">
                  <div className="flex items-start gap-3 px-4 py-3">
                    <div className="w-7 h-7 rounded-lg bg-amber-500/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Icon name="Copy" size={14} className="text-amber-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
                        {duplicateCount} duplicate{duplicateCount !== 1 ? 's' : ''} detected
                      </p>
                      <p className="text-xs text-amber-600/80 mt-0.5">
                        {parsedItems?.filter(i => i?.duplicate_type === 'existing' || i?.duplicate_type === 'both')?.length > 0 && (
                          <span>{parsedItems?.filter(i => i?.duplicate_type === 'existing' || i?.duplicate_type === 'both')?.length} already exist in your inventory. </span>
                        )}
                        {parsedItems?.filter(i => i?.duplicate_type === 'batch')?.length > 0 && (
                          <span>{parsedItems?.filter(i => i?.duplicate_type === 'batch')?.length} appear more than once in this file. </span>
                        )}
                        Use the toggles below to choose which to include or skip.
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button onClick={includeAllDuplicates} className="text-xs px-2.5 py-1 rounded-lg border border-amber-500/30 text-amber-700 dark:text-amber-400 hover:bg-amber-500/15 transition-colors font-medium">Include all</button>
                      <button onClick={skipAllDuplicates} className="text-xs px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-700 dark:text-amber-400 hover:bg-amber-500/25 transition-colors font-medium">Skip all</button>
                    </div>
                  </div>
                  {skippedDuplicateCount > 0 && (
                    <div className="px-4 py-2 border-t border-amber-500/20 bg-amber-500/5">
                      <p className="text-xs text-amber-600">
                        <Icon name="MinusCircle" size={11} className="inline mr-1" />
                        {skippedDuplicateCount} duplicate{skippedDuplicateCount !== 1 ? 's' : ''} will be skipped — {importableItems?.length} item{importableItems?.length !== 1 ? 's' : ''} will be imported
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Diagnostics panel */}
              {parseDiagnostics && (
                <details open={parsedItems?.length === 0} className="border border-border rounded-xl overflow-hidden">
                  <summary className={`flex items-center gap-2 px-4 py-3 cursor-pointer select-none text-sm font-medium ${
                    parsedItems?.length === 0
                      ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400' :'bg-muted/40 text-muted-foreground hover:text-foreground'
                  }`}>
                    <Icon name={parsedItems?.length === 0 ? 'AlertTriangle' : 'Bug'} size={14} className="flex-shrink-0" />
                    {parsedItems?.length === 0
                      ? 'Parser diagnostics — 0 items found'
                      : `Parser diagnostics (${parsedItems?.length} items found)`}
                    <Icon name="ChevronDown" size={12} className="ml-auto" />
                  </summary>
                  <div className="px-4 py-3 space-y-3 bg-muted/10 text-xs">
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {[
                        { label: 'Raw rows read', value: parseDiagnostics?.rawRowCount ?? 0, color: 'text-foreground' },
                        { label: 'Category rows', value: parseDiagnostics?.categoryRows?.length ?? 0, color: 'text-violet-600' },
                        { label: 'Item rows', value: parseDiagnostics?.itemRows?.length ?? 0, color: 'text-green-600' },
                        { label: 'Excluded rows', value: parseDiagnostics?.excludedRows?.length ?? 0, color: 'text-amber-600' },
                      ]?.map((stat) => (
                        <div key={stat?.label} className="p-2 bg-muted/30 rounded-lg text-center">
                          <p className={`text-lg font-bold ${stat?.color}`}>{stat?.value}</p>
                          <p className="text-muted-foreground text-xs">{stat?.label}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </details>
              )}

              {/* Folder assignment banner */}
              <div className="flex items-center gap-2 p-3 bg-primary/8 border border-primary/20 rounded-lg">
                <Icon name="FolderOpen" size={15} className="text-primary flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground">Default folder:</p>
                  <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                    {effectiveSegments?.length > 0 ? (
                      effectiveSegments?.map((seg, i) => (
                        <React.Fragment key={i}>
                          {i > 0 && <Icon name="ChevronRight" size={11} className="text-muted-foreground" />}
                          <span className="text-xs font-semibold text-primary">{seg}</span>
                        </React.Fragment>
                      ))
                    ) : (
                      <span className="text-xs text-muted-foreground italic">Root</span>
                    )}
                  </div>
                </div>
                <button onClick={() => setStep('folder')} className="text-xs text-primary hover:underline flex-shrink-0">Change</button>
              </div>

              {/* Location match summary */}
              {vesselLocations?.length > 0 && (exactMatches > 0 || noMatches > 0) && (
                <div className="flex items-center gap-3 p-3 bg-muted/30 border border-border rounded-lg flex-wrap">
                  <span className="text-xs text-muted-foreground font-medium">Location matching:</span>
                  {exactMatches > 0 && (
                    <span className="flex items-center gap-1 text-xs text-green-600">
                      <Icon name="CheckCircle2" size={11} />{exactMatches} exact
                    </span>
                  )}
                  {noMatches > 0 && (
                    <span className="flex items-center gap-1 text-xs text-destructive">
                      <Icon name="XCircle" size={11} />{noMatches} unmatched {resolvedOverrides > 0 ? `(${resolvedOverrides} resolved)` : '— selection required'}
                    </span>
                  )}
                </div>
              )}

              {warnings?.length > 0 && (
                <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg space-y-1">
                  {warnings?.map((w, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <Icon name="AlertTriangle" size={13} className="text-amber-600 mt-0.5 flex-shrink-0" />
                      <p className="text-xs text-amber-700 dark:text-amber-400">{w}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Dynamic preview table — mirrors source document columns */}
              <div className="border border-border rounded-xl overflow-hidden">
                <div className="overflow-x-auto max-h-80">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/60 sticky top-0 z-10">
                      <tr>
                        {duplicateCount > 0 && (
                          <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap border-b border-border">
                            Include
                          </th>
                        )}
                        {dynamicPreviewColumns?.map((col) => (
                          <th key={col?.key} className={`px-3 py-2.5 text-left font-semibold uppercase tracking-wide whitespace-nowrap border-b border-border ${
                            col?.isSource ? 'text-violet-600' : 'text-muted-foreground'
                          }`}>
                            <span className="flex items-center gap-1">
                              {col?.isSource && <Icon name="Tag" size={10} className="text-violet-500" />}
                              {col?.label}
                            </span>
                          </th>
                        ))}
                        <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap border-b border-border">Category / Folder</th>
                        <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap border-b border-border">Vessel Location</th>
                        <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap border-b border-border">Warnings</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {parsedItems?.map((item, idx) => {
                        const confidence = item?.location_match_confidence;
                        const resolvedPath = resolveItemLocation(item, idx);
                        const itemWarnings = Array.isArray(item?.warnings) ? item?.warnings : [];
                        const hasMismatch = item?.total_mismatch === true;
                        const isDuplicate = item?.duplicate_type != null;
                        const isSkipped = duplicateSkips?.[idx] === true;

                        // Inventory folder display
                        let inventoryFolder = item?.suggested_folder || '';
                        if (!inventoryFolder && item?.category && item?.subcategory) {
                          const cat = item?.category;
                          const sub = item?.subcategory;
                          const spiritsTypes = ['Vodka', 'Gin', 'Tequila', 'Rum', 'Whisky', 'Cognac'];
                          if (cat === 'Alcohol') {
                            if (spiritsTypes?.includes(sub)) inventoryFolder = `Interior > Guest > Alcohol > Spirits > ${sub}`;
                            else if (sub === 'Aperitif') inventoryFolder = 'Interior > Guest > Alcohol > Aperitif';
                            else if (sub === 'Champagne') inventoryFolder = 'Interior > Guest > Alcohol > Champagne';
                            else if (sub === 'Sparkling Wine') inventoryFolder = 'Interior > Guest > Alcohol > Sparkling Wine';
                            else if (sub === 'Wine') inventoryFolder = 'Interior > Guest > Alcohol > Wine';
                            else if (sub === 'Beer') inventoryFolder = 'Interior > Guest > Alcohol > Beer';
                            else if (sub === 'Cider') inventoryFolder = 'Interior > Guest > Alcohol > Cider';
                            else if (sub) inventoryFolder = `Interior > Guest > Alcohol > ${sub}`;
                          } else if (cat === 'Non-Alcoholic') {
                            if (sub === 'Hot Beverages') inventoryFolder = 'Interior > Guest > Hot Beverages';
                            else if (sub) inventoryFolder = `Interior > Guest > Non-Alcoholic > ${sub}`;
                          }
                        }
                        if (!inventoryFolder) inventoryFolder = effectiveSegments?.join(' > ') || null;

                        return (
                          <tr key={idx} className={`transition-colors ${
                            isSkipped ? 'opacity-40 bg-muted/20' : isDuplicate ?'bg-amber-500/5 hover:bg-amber-500/10' : hasMismatch ?'bg-amber-500/5 hover:bg-amber-500/10' :'hover:bg-muted/30'
                          }`}>
                            {duplicateCount > 0 && (
                              <td className="px-3 py-2 whitespace-nowrap">
                                {isDuplicate ? (
                                  <button
                                    onClick={() => toggleDuplicateSkip(idx)}
                                    className={`flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-lg border transition-colors ${
                                      isSkipped
                                        ? 'border-muted-foreground/30 text-muted-foreground hover:border-primary/40 hover:text-primary bg-muted/30'
                                        : 'border-amber-500/40 text-amber-700 dark:text-amber-400 hover:bg-amber-500/15 bg-amber-500/8'
                                    }`}
                                  >
                                    <Icon name={isSkipped ? 'PlusCircle' : 'MinusCircle'} size={11} />
                                    {isSkipped ? 'Skipped' : (
                                      <span className="flex items-center gap-1">
                                        <Icon name="Copy" size={10} />
                                        {item?.duplicate_type === 'existing' ? 'Exists' : item?.duplicate_type === 'batch' ? 'In file' : 'Both'}
                                      </span>
                                    )}
                                  </button>
                                ) : (
                                  <span className="flex items-center gap-1 text-xs text-green-600 px-2 py-1">
                                    <Icon name="CheckCircle2" size={11} />New
                                  </span>
                                )}
                              </td>
                            )}
                            {/* Dynamic columns */}
                            {dynamicPreviewColumns?.map((col) => {
                              const value = getCellValue(item, col);
                              return (
                                <td key={col?.key} className="px-3 py-2 whitespace-nowrap max-w-[160px] truncate">
                                  {col?.key === 'size' && value ? (
                                    <span className="text-xs bg-blue-500/10 text-blue-600 px-1.5 py-0.5 rounded font-mono">{value}</span>
                                  ) : col?.key === 'unit' && value ? (
                                    <span className="text-xs bg-muted px-1.5 py-0.5 rounded">{value}</span>
                                  ) : col?.isSource && value ? (
                                    <span className="text-xs text-violet-700 dark:text-violet-400">{String(value)}</span>
                                  ) : value != null && value !== '' ? (
                                    <span className="text-foreground">{String(value)}</span>
                                  ) : (
                                    <span className="text-muted-foreground/40">—</span>
                                  )}
                                </td>
                              );
                            })}
                            {/* Category / Folder */}
                            <td className="px-3 py-2 min-w-[140px]">
                              {item?.category ? (
                                <div className="space-y-0.5">
                                  <span className="inline-flex items-center text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded font-medium">{item?.category}</span>
                                  {item?.subcategory && (
                                    <div><span className="inline-flex items-center text-xs bg-muted text-foreground px-1.5 py-0.5 rounded">{item?.subcategory}</span></div>
                                  )}
                                  {inventoryFolder && (
                                    <div className="flex items-center gap-1 mt-0.5">
                                      <Icon name="Folder" size={10} className="text-violet-500 flex-shrink-0" />
                                      <span className="text-xs text-violet-700 dark:text-violet-400 truncate max-w-[160px]">{inventoryFolder}</span>
                                    </div>
                                  )}
                                </div>
                              ) : inventoryFolder ? (
                                <div className="flex items-center gap-1">
                                  <Icon name="Folder" size={10} className="text-violet-500 flex-shrink-0" />
                                  <span className="text-xs text-violet-700 dark:text-violet-400 truncate max-w-[160px]">{inventoryFolder}</span>
                                </div>
                              ) : (
                                <span className="text-muted-foreground/40">—</span>
                              )}
                            </td>
                            {/* Physical Vessel Location */}
                            <td className="px-3 py-2 min-w-[200px]">
                              {confidence === 'exact' && resolvedPath ? (
                                <div className="space-y-0.5">
                                  <div className="text-xs text-foreground font-medium truncate max-w-[200px]">{resolvedPath}</div>
                                  <LocationBadge confidence="exact" />
                                </div>
                              ) : confidence === 'none' ? (
                                <div className="space-y-1">
                                  <select
                                    value={locationOverrides?.[idx] || ''}
                                    onChange={(e) => setLocationOverrides(prev => ({ ...prev, [idx]: e?.target?.value }))}
                                    className={`w-full text-xs border rounded-lg px-2 py-1 bg-card text-foreground focus:outline-none focus:ring-1 max-w-[220px] ${
                                      !locationOverrides?.[idx]
                                        ? 'border-muted-foreground/30 focus:ring-primary'
                                        : 'border-green-500/50 focus:ring-green-500'
                                    }`}
                                  >
                                    <option value="">— Select a location —</option>
                                    {vesselLocations?.map((l, li) => (
                                      <option key={`vl-${li}`} value={l}>{l}</option>
                                    ))}
                                  </select>
                                  <LocationBadge confidence={locationOverrides?.[idx] ? 'exact' : 'none'} />
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground/50 italic">— not matched</span>
                              )}
                            </td>
                            {/* Warnings */}
                            <td className="px-3 py-2 min-w-[140px]">
                              <div className="flex flex-col gap-0.5">
                                {isDuplicate && (
                                  <span className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded font-medium ${
                                    item?.duplicate_type === 'existing' || item?.duplicate_type === 'both' ? 'bg-orange-500/10 text-orange-600' : 'bg-amber-500/10 text-amber-600'
                                  }`}>
                                    <Icon name="Copy" size={10} />
                                    {item?.duplicate_type === 'existing' ? 'Already in inventory' : item?.duplicate_type === 'batch' ? 'Duplicate in file' : 'Duplicate (file + inventory)'}
                                  </span>
                                )}
                                {itemWarnings?.map((w, wi) => (
                                  <span key={wi} className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded font-medium ${
                                    w?.includes('Size') ? 'bg-blue-500/10 text-blue-600' :
                                    w?.includes('Unit') ? 'bg-violet-500/10 text-violet-600' :
                                    w?.includes('fuzzy') ? 'bg-amber-500/10 text-amber-600' :
                                    'bg-muted text-muted-foreground'
                                  }`}>
                                    <Icon name="Info" size={10} />
                                    {w?.length > 22 ? w?.slice(0, 22) + '…' : w}
                                  </span>
                                ))}
                                {hasMismatch && (
                                  <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded font-medium bg-amber-500/10 text-amber-600">
                                    <Icon name="AlertTriangle" size={10} />
                                    Total mismatch
                                  </span>
                                )}
                                {!isDuplicate && itemWarnings?.length === 0 && !hasMismatch && (
                                  <span className="text-muted-foreground/40">—</span>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {hasUnresolvedLocations && (
                <div className="flex items-start gap-2 p-3 bg-muted/30 border border-border rounded-lg">
                  <Icon name="Info" size={14} className="text-muted-foreground mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-muted-foreground">
                    Some items have unmatched physical vessel locations. You can select locations above, or import now and assign locations later.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Importing step */}
          {step === 'importing' && (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
                <Icon name="Loader2" size={24} className="text-primary animate-spin" />
              </div>
              <div className="text-center">
                <p className="text-base font-semibold text-foreground">Importing items…</p>
                <p className="text-sm text-muted-foreground mt-1">Saving {importableItems?.length} items to your inventory</p>
              </div>
            </div>
          )}

          {/* Done step */}
          {step === 'done' && (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <div className="w-14 h-14 rounded-2xl bg-green-500/10 flex items-center justify-center">
                <Icon name="CheckCircle2" size={24} className="text-green-600" />
              </div>
              <div className="text-center">
                <p className="text-base font-semibold text-foreground">Import complete!</p>
                <p className="text-sm text-muted-foreground mt-1">{importedCount} item{importedCount !== 1 ? 's' : ''} successfully imported</p>
              </div>
              {importError && (
                <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg w-full max-w-sm">
                  <Icon name="AlertCircle" size={15} className="text-destructive mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-destructive">{importError}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border flex-shrink-0">
          {step === 'upload' && (
            <>
              <button onClick={onClose} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
              <button
                onClick={handleParse}
                disabled={!selectedFile}
                className="px-5 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                <Icon name="Sparkles" size={14} />
                Process File
              </button>
            </>
          )}

          {step === 'mapping' && (
            <>
              <button onClick={() => setStep('upload')} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">Back</button>
              <button
                onClick={() => setStep('folder')}
                className="px-5 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors flex items-center gap-2"
              >
                Continue
                <Icon name="ChevronRight" size={14} />
              </button>
            </>
          )}

          {step === 'folder' && (
            <>
              <button onClick={() => setStep('upload')} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">Back</button>
              <button
                onClick={() => setStep('preview')}
                disabled={folderChoice === 'choose' && !chosenSegments}
                className="px-5 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                Review Items
                <Icon name="ChevronRight" size={14} />
              </button>
            </>
          )}

          {step === 'preview' && (
            <>
              <button onClick={() => setStep('folder')} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">Back</button>
              <button
                onClick={handleConfirmImport}
                disabled={!importableItems?.length}
                className="px-5 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                <Icon name="CheckCircle2" size={14} />
                Confirm Import ({importableItems?.length})
              </button>
            </>
          )}

          {step === 'done' && (
            <button onClick={onClose} className="ml-auto px-5 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors">
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
