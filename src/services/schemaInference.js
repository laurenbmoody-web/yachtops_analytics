/**
 * Schema Inference Engine
 *
 * Intelligently infers the structure of uploaded spreadsheets/PDFs without
 * relying on hardcoded column prompts. Handles:
 * - Dynamic header row detection
 * - Column type inference (text, number, date, boolean, code, enum)
 * - Semantic mapping to Cargo core fields
 * - Separation of core fields vs custom/source fields
 * - Title/grouping row detection
 */

// ---------------------------------------------------------------------------
// Core field mapping — semantic synonyms → Cargo core field key
// ---------------------------------------------------------------------------

const CORE_FIELD_MAPPINGS = [
  // item_name
  {
    coreKey: 'item_name',
    label: 'Item Name',
    patterns: [
      /^(item[\s_-]?name|product[\s_-]?name|description|article[\s_-]?name|name|product|article|item|title|goods[\s_-]?name|stock[\s_-]?name)$/i,
    ],
    type: 'text',
  },
  // brand
  {
    coreKey: 'brand',
    label: 'Brand',
    patterns: [/^(brand|make|manufacturer|producer|supplier[\s_-]?brand|label|marque)$/i],
    type: 'text',
  },
  // quantity
  {
    coreKey: 'quantity',
    label: 'Qty',
    patterns: [
      /^(qty|quantity|amount|count|stock|on[\s_-]?hand|total[\s_-]?qty|total[\s_-]?quantity|no\.?[\s_-]?of[\s_-]?units|units[\s_-]?on[\s_-]?hand|current[\s_-]?stock|available)$/i,
    ],
    type: 'number',
  },
  // unit
  {
    coreKey: 'unit',
    label: 'Unit',
    patterns: [/^(unit|uom|unit[\s_-]?of[\s_-]?measure|measure|pack[\s_-]?type|packaging)$/i],
    type: 'text',
  },
  // size
  {
    coreKey: 'size',
    label: 'Size',
    patterns: [/^(size|volume|strength|capacity|weight|format|pack[\s_-]?size|bottle[\s_-]?size|ml|cl|litre|liter)$/i],
    type: 'text',
  },
  // expiry_date
  {
    coreKey: 'expiry_date',
    label: 'Expiry',
    patterns: [
      /^(expir[ey][\s_-]?date|expir[ey]s?|exp[\s_-]?date|exp|best[\s_-]?before|use[\s_-]?by|bb[\s_-]?date|sell[\s_-]?by)$/i,
    ],
    type: 'date',
  },
  // batch_no
  {
    coreKey: 'batch_no',
    label: 'Batch No',
    patterns: [/^(batch[\s_-]?no|batch[\s_-]?number|batch|lot[\s_-]?no|lot[\s_-]?number|lot|batch[\s_-]?id)$/i],
    type: 'code',
  },
  // code
  {
    coreKey: 'code',
    label: 'Code',
    patterns: [
      /^(code|sku|ref|reference|product[\s_-]?code|item[\s_-]?code|article[\s_-]?code|barcode|part[\s_-]?no|part[\s_-]?number|part[\s_-]?#|p\/n|pn)$/i,
    ],
    type: 'code',
  },
  // supplier
  {
    coreKey: 'supplier',
    label: 'Supplier',
    patterns: [/^(supplier|vendor|distributor|source|from|purchased[\s_-]?from)$/i],
    type: 'text',
  },
  // restock_level
  {
    coreKey: 'restock_level',
    label: 'Restock',
    patterns: [/^(restock[\s_-]?level|min[\s_-]?stock|minimum[\s_-]?stock|par[\s_-]?level|par|reorder[\s_-]?point|min[\s_-]?qty)$/i],
    type: 'number',
  },
  // year
  {
    coreKey: 'year',
    label: 'Year',
    patterns: [/^(year|vintage|yr|year[\s_-]?of[\s_-]?production|production[\s_-]?year)$/i],
    type: 'number',
  },
  // notes
  {
    coreKey: 'notes',
    label: 'Notes',
    patterns: [/^(notes?|remarks?|comments?|memo|additional[\s_-]?info|observations?)$/i],
    type: 'longtext',
  },
];

// Source-specific fields that should be preserved as custom metadata
const SOURCE_FIELD_HINTS = [
  { key: 'bag_name', patterns: [/^(bag[\s_-]?name|bag|kit[\s_-]?name|kit|case[\s_-]?name|case)$/i], type: 'text' },
  { key: 'colour', patterns: [/^(colou?r|shade|hue)$/i], type: 'enum' },
  { key: 'module_name', patterns: [/^(module[\s_-]?name|module|section[\s_-]?name|section|group[\s_-]?name|group|category[\s_-]?name|category|type)$/i], type: 'text' },
  { key: 'used', patterns: [/^(used|consumed|issued|dispensed|taken|checked[\s_-]?out)$/i], type: 'boolean' },
  { key: 'serial_no', patterns: [/^(serial[\s_-]?no|serial[\s_-]?number|serial|s\/n|sn)$/i], type: 'code' },
  { key: 'temperature_range', patterns: [/^(temp[\s_-]?range|temperature|storage[\s_-]?temp|temp)$/i], type: 'text' },
  { key: 'owner', patterns: [/^(owner|owned[\s_-]?by|assigned[\s_-]?to|responsible)$/i], type: 'text' },
  { key: 'cabin', patterns: [/^(cabin|room|berth|suite|stateroom)$/i], type: 'text' },
  { key: 'prescription_type', patterns: [/^(prescription[\s_-]?type|rx[\s_-]?type|medication[\s_-]?type|drug[\s_-]?type)$/i], type: 'text' },
  { key: 'location_name', patterns: [/^(location|area|zone|storage[\s_-]?area|stored[\s_-]?at|where|position)$/i], type: 'text' },
  { key: 'service_due', patterns: [/^(service[\s_-]?due|next[\s_-]?service|maintenance[\s_-]?due|service[\s_-]?date)$/i], type: 'date' },
  { key: 'model', patterns: [/^(model|model[\s_-]?no|model[\s_-]?number|part[\s_-]?model)$/i], type: 'text' },
  { key: 'region', patterns: [/^(region|origin|country[\s_-]?of[\s_-]?origin|appellation|terroir|country)$/i], type: 'text' },
  { key: 'vintage', patterns: [/^(vintage|harvest[\s_-]?year)$/i], type: 'number' },
];

// Columns to always ignore (decorative, row numbers, empty labels)
const IGNORE_PATTERNS = [
  /^(#|no\.?|row[\s_-]?no|row[\s_-]?#|s\.?no\.?|sr\.?[\s_-]?no\.?|index|id|seq|sequence|line[\s_-]?no|line[\s_-]?#)$/i,
  /^(unnamed[\s_-]?\d*|column[\s_-]?\d+|col[\s_-]?\d+|field[\s_-]?\d+)$/i,
  /^[\s_\-\.]+$/, // only whitespace/punctuation
];

// ---------------------------------------------------------------------------
// Normalize header text for comparison
// ---------------------------------------------------------------------------

export function normalizeHeaderText(text) {
  return String(text || '')?.toLowerCase()?.trim()?.replace(/[_\-\/\\]/g, ' ')?.replace(/\s+/g, ' ')?.replace(/[^\w\s]/g, '');
}

// ---------------------------------------------------------------------------
// Infer column type from values
// ---------------------------------------------------------------------------

export function inferColumnType(values) {
  const nonEmpty = values?.filter((v) => v !== null && v !== undefined && String(v)?.trim() !== '');
  if (nonEmpty?.length === 0) return 'text';

  const sample = nonEmpty?.slice(0, 20);

  // Date detection
  const datePatterns = [
    /^\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}$/,
    /^\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}$/,
    /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i,
    /^\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i,
  ];
  const dateCount = sample?.filter((v) => datePatterns?.some((p) => p?.test(String(v)?.trim())))?.length;
  if (dateCount / sample?.length > 0.5) return 'date';

  // Boolean detection
  const boolValues = new Set(['yes', 'no', 'true', 'false', 'y', 'n', '1', '0', 'x', '✓', '✗', 'checked', 'unchecked']);
  const boolCount = sample?.filter((v) => boolValues?.has(String(v)?.toLowerCase()?.trim()))?.length;
  if (boolCount / sample?.length > 0.6) return 'boolean';

  // Number detection
  const numCount = sample?.filter((v) => !isNaN(parseFloat(String(v)?.replace(/,/g, ''))))?.length;
  if (numCount / sample?.length > 0.7) return 'number';

  // Code detection (alphanumeric short strings, often with dashes)
  const codePattern = /^[A-Z0-9\-_\/\.]{2,20}$/i;
  const codeCount = sample?.filter((v) => codePattern?.test(String(v)?.trim()) && String(v)?.trim()?.length <= 20)?.length;
  if (codeCount / sample?.length > 0.6 && sample?.every((v) => String(v)?.trim()?.length <= 30)) return 'code';

  // Enum detection (few unique values relative to sample size)
  const uniqueValues = new Set(sample.map((v) => String(v).toLowerCase().trim()));
  if (uniqueValues?.size <= Math.max(3, sample?.length * 0.3) && sample?.length >= 5) return 'enum';

  // Long text detection
  const avgLength = sample?.reduce((sum, v) => sum + String(v)?.length, 0) / sample?.length;
  if (avgLength > 50) return 'longtext';

  return 'text';
}

// ---------------------------------------------------------------------------
// Map a single header to a Cargo core field or source field
// ---------------------------------------------------------------------------

export function mapHeaderToField(header, columnValues = []) {
  const normalized = normalizeHeaderText(header);

  // Check ignore patterns first
  for (const pattern of IGNORE_PATTERNS) {
    if (pattern?.test(normalized) || pattern?.test(header?.trim())) {
      return { type: 'ignore', reason: 'Row number or decorative column' };
    }
  }

  // Check core field mappings
  for (const mapping of CORE_FIELD_MAPPINGS) {
    for (const pattern of mapping?.patterns) {
      if (pattern?.test(normalized) || pattern?.test(header?.trim())) {
        return {
          type: 'core',
          coreKey: mapping?.coreKey,
          label: mapping?.label,
          inferredType: mapping?.type,
          sourceHeader: header,
        };
      }
    }
  }

  // Check source field hints
  for (const hint of SOURCE_FIELD_HINTS) {
    for (const pattern of hint?.patterns) {
      if (pattern?.test(normalized) || pattern?.test(header?.trim())) {
        return {
          type: 'source',
          sourceKey: hint?.key,
          label: header,
          inferredType: hint?.type,
          sourceHeader: header,
        };
      }
    }
  }

  // Unknown column — infer type from values and preserve as custom field
  const inferredType = columnValues?.length > 0 ? inferColumnType(columnValues) : 'text';
  const sourceKey = normalized?.replace(/\s+/g, '_')?.replace(/[^\w]/g, '')?.toLowerCase() || 'custom_field';

  return {
    type: 'custom',
    sourceKey,
    label: header,
    inferredType,
    sourceHeader: header,
  };
}

// ---------------------------------------------------------------------------
// Detect the true header row in raw spreadsheet data
// ---------------------------------------------------------------------------

/**
 * Analyze up to the first 15 rows to find the most likely header row.
 * Uses multiple signals:
 * - Text consistency (all cells are text-like, not numbers)
 * - Row density (many non-empty cells)
 * - Semantic field labels (matches known field patterns)
 * - Alignment with data rows beneath
 */
export function detectHeaderRow(rawData) {
  if (!rawData || rawData?.length === 0) return 0;

  const maxScanRows = Math.min(15, rawData?.length);
  let bestScore = -1;
  let bestIndex = 0;

  for (let i = 0; i < maxScanRows; i++) {
    const row = (rawData?.[i] || [])?.map((c) => String(c ?? '')?.trim());
    const nonEmpty = row?.filter((c) => c !== '');
    if (nonEmpty?.length === 0) continue;

    let score = 0;

    // Signal 1: Density — more non-empty cells = more likely header
    const density = nonEmpty?.length / Math.max(row?.length, 1);
    score += density * 3;

    // Signal 2: Text-like cells (not numbers)
    const textCells = nonEmpty?.filter((c) => isNaN(Number(c)));
    const textRatio = textCells?.length / nonEmpty?.length;
    score += textRatio * 4;

    // Signal 3: Semantic matches — how many cells match known field patterns
    let semanticMatches = 0;
    for (const cell of nonEmpty) {
      const mapped = mapHeaderToField(cell);
      if (mapped?.type === 'core' || mapped?.type === 'source') semanticMatches++;
    }
    score += (semanticMatches / nonEmpty?.length) * 6;

    // Signal 4: No "Unnamed" columns
    const unnamedCount = nonEmpty?.filter((c) => /^unnamed[:\s_]?\d*/i?.test(c))?.length;
    score -= (unnamedCount / nonEmpty?.length) * 3;

    // Signal 5: Short cell values (headers are usually short labels)
    const avgLength = nonEmpty?.reduce((s, c) => s + c?.length, 0) / nonEmpty?.length;
    if (avgLength < 30) score += 2;
    if (avgLength > 60) score -= 2;

    // Signal 6: Penalize rows that look like title rows (single cell, very long text)
    if (nonEmpty?.length === 1 && nonEmpty?.[0]?.length > 20) score -= 3;

    // Signal 7: Prefer rows that have data rows beneath them with numbers
    if (i + 1 < rawData?.length) {
      const nextRow = (rawData?.[i + 1] || [])?.map((c) => String(c ?? '')?.trim());
      const nextHasNumbers = nextRow?.some((c) => c !== '' && !isNaN(Number(c)));
      if (nextHasNumbers) score += 2;
    }

    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  return bestIndex;
}

// ---------------------------------------------------------------------------
// Detect title/grouping rows (non-item rows to exclude)
// ---------------------------------------------------------------------------

/**
 * Determine if a data row is a title/grouping row that should be excluded.
 * Returns { isTitle: boolean, reason: string }
 */
export function detectTitleRow(row, headerCount) {
  const cells = (row || [])?.map((c) => String(c ?? '')?.trim());
  const nonEmpty = cells?.filter((c) => c !== '');

  if (nonEmpty?.length === 0) return { isTitle: false, reason: 'blank' };

  // If ANY cell contains a numeric value, it's likely a real data row
  const hasNumeric = cells?.some((c) => c !== '' && !isNaN(parseFloat(c?.replace(/,/g, ''))));
  if (hasNumeric) return { isTitle: false, reason: 'has numeric values' };

  // Single non-empty cell with short text = likely a section header
  if (nonEmpty?.length === 1) {
    const val = nonEmpty?.[0];
    if (val?.length <= 40 && !val?.includes(':')) {
      return { isTitle: true, reason: `Single label "${val}" with no data values` };
    }
  }

  // Very few non-empty cells relative to total columns
  if (headerCount > 3 && nonEmpty?.length <= 2 && nonEmpty?.length / headerCount < 0.35) {
    const val = nonEmpty?.[0];
    // Only exclude if it looks like a label, not a product name
    if (!/\d+\s*(ml|cl|l|kg|g|oz|pcs|btl|bottle)/i?.test(val)) {
      return { isTitle: true, reason: `Only ${nonEmpty?.length} of ${headerCount} cells filled — likely section label` };
    }
  }

  return { isTitle: false, reason: 'data row' };
}

// ---------------------------------------------------------------------------
// Build the full schema from detected headers + sample data
// ---------------------------------------------------------------------------

/**
 * Given detected headers and sample data rows, produce a complete schema:
 * - fieldMappings: array of { sourceHeader, type, coreKey/sourceKey, label, inferredType }
 * - coreFields: subset that map to Cargo core fields
 * - sourceFields: subset that are source-specific custom fields
 * - ignoredFields: subset to ignore
 * - dynamicColumns: all non-ignored columns in source order
 */
export function buildImportSchema(headers, dataRows = []) {
  const fieldMappings = [];

  for (let i = 0; i < headers?.length; i++) {
    const header = headers?.[i];
    if (!header || String(header)?.trim() === '') {
      fieldMappings?.push({ type: 'ignore', sourceHeader: header || '', reason: 'Empty header' });
      continue;
    }

    // Extract column values for type inference
    const columnValues = dataRows?.map((row) => row?.[i])?.filter((v) => v !== null && v !== undefined && String(v)?.trim() !== '');

    const mapping = mapHeaderToField(header, columnValues);
    fieldMappings?.push({ ...mapping, columnIndex: i });
  }

  const coreFields = fieldMappings?.filter((f) => f?.type === 'core');
  const sourceFields = fieldMappings?.filter((f) => f?.type === 'source' || f?.type === 'custom');
  const ignoredFields = fieldMappings?.filter((f) => f?.type === 'ignore');
  const dynamicColumns = fieldMappings?.filter((f) => f?.type !== 'ignore');

  return {
    fieldMappings,
    coreFields,
    sourceFields,
    ignoredFields,
    dynamicColumns,
    // Quick lookup: sourceHeader → mapping
    byHeader: Object.fromEntries(fieldMappings?.map((f) => [f?.sourceHeader, f])),
  };
}

// ---------------------------------------------------------------------------
// Extract a structured item from a data row using the schema
// ---------------------------------------------------------------------------

/**
 * Given a data row and the schema, extract:
 * - core: { item_name, quantity, unit, size, brand, expiry_date, batch_no, code, ... }
 * - source_fields: { bag_name, colour, module_name, used, comments, ... }
 */
export function extractItemFromRow(row, headers, schema) {
  const core = {};
  const source_fields = {};

  for (let i = 0; i < headers?.length; i++) {
    const header = headers?.[i];
    const mapping = schema?.byHeader?.[header];
    if (!mapping || mapping?.type === 'ignore') continue;

    const rawValue = row?.[i];
    const value = rawValue !== null && rawValue !== undefined ? String(rawValue)?.trim() : '';
    if (!value) continue;

    if (mapping?.type === 'core') {
      core[mapping.coreKey] = value;
    } else {
      // source or custom field
      const key = mapping?.sourceKey || mapping?.coreKey;
      source_fields[key] = value;
    }
  }

  return { core, source_fields };
}

// ---------------------------------------------------------------------------
// Build a human-readable schema summary for the AI prompt
// ---------------------------------------------------------------------------

/**
 * Produce a compact description of the schema for inclusion in the AI prompt.
 * This replaces the giant hardcoded synonym list.
 */
export function buildSchemaPromptContext(schema, sourceHeaders) {
  const lines = [];

  lines?.push('DETECTED SOURCE SCHEMA:');
  lines?.push(`Source columns (in order): ${sourceHeaders?.join(' | ')}`);
  lines?.push('');

  if (schema?.coreFields?.length > 0) {
    lines?.push('CORE FIELD MAPPINGS (source header → Cargo field):');
    for (const f of schema?.coreFields) {
      lines?.push(`  "${f?.sourceHeader}" → ${f?.coreKey} (${f?.inferredType})`);
    }
    lines?.push('');
  }

  if (schema?.sourceFields?.length > 0) {
    lines?.push('CUSTOM/SOURCE FIELDS (preserve as source_fields):');
    for (const f of schema?.sourceFields) {
      lines?.push(`  "${f?.sourceHeader}" → source_fields.${f?.sourceKey || f?.label} (${f?.inferredType})`);
    }
    lines?.push('');
  }

  if (schema?.ignoredFields?.length > 0) {
    lines?.push('IGNORED COLUMNS (row numbers, decorative):');
    for (const f of schema?.ignoredFields) {
      lines?.push(`  "${f?.sourceHeader}" — ${f?.reason}`);
    }
    lines?.push('');
  }

  return lines?.join('\n');
}
