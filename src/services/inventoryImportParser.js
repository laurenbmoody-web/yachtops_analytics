/**
 * Inventory Import Parser Service
 *
 * Provides helper functions to:
 * 1. Parse uploaded spreadsheet files (XLSX/CSV) into headers + rows using SheetJS
 * 2. Detect real header rows (skips generic "Unnamed: X" headers)
 * 3. Identify category/section rows and build folder breadcrumbs
 * 4. Normalize spaced-out category text like "V O D K A" → "Vodka"
 * 5. Extract text rows from PDF files (basic text extraction)
 * 6. Call the Supabase Edge Function parseInventoryImport to get structured inventory items
 *
 * Does NOT write to the database — returns preview data only.
 */

import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabaseClient';
import {
  detectHeaderRow,
  buildImportSchema,
  detectTitleRow,
  buildSchemaPromptContext,
  normalizeHeaderText,
} from './schemaInference';

// ---------------------------------------------------------------------------
// Core API call
// ---------------------------------------------------------------------------

/**
 * Call the parseInventoryImport Edge Function.
 */
export async function callParseInventoryImport(headers, rows, sourceType = 'spreadsheet', meta = {}, vesselLocations = []) {
  try {
    const supabaseUrl = import.meta.env?.VITE_SUPABASE_URL;
    const supabaseAnonKey = import.meta.env?.VITE_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      return { error: 'Supabase configuration missing' };
    }

    const { data: sessionData } = await supabase?.auth?.getSession();
    const accessToken = sessionData?.session?.access_token || supabaseAnonKey;

    const functionUrl = `${supabaseUrl}/functions/v1/parseInventoryImport`;

    // -----------------------------------------------------------------------
    // Batch large row sets to avoid exceeding the edge function payload limit.
    // -----------------------------------------------------------------------
    const BATCH_SIZE = 30;

    if (rows?.length > BATCH_SIZE) {
      const allItems = [];
      const allWarnings = [];

      for (let offset = 0; offset < rows?.length; offset += BATCH_SIZE) {
        const batchRows = rows?.slice(offset, offset + BATCH_SIZE);
        const batchResult = await callParseInventoryImport(headers, batchRows, sourceType, meta, vesselLocations);

        if (batchResult?.error) {
          return batchResult;
        }

        allItems?.push(...(batchResult?.items ?? []));
        allWarnings?.push(...(batchResult?.warnings ?? []));
      }

      const uniqueWarnings = [...new Set(allWarnings)];
      return { items: allItems, warnings: uniqueWarnings };
    }

    // -----------------------------------------------------------------------
    // Single batch call — with retry logic for transient network failures
    // -----------------------------------------------------------------------
    const MAX_RETRIES = 3;
    const RETRY_DELAYS = [1000, 3000, 6000];

    let lastError = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delay = RETRY_DELAYS?.[attempt - 1] ?? 6000;
        console.warn(`[callParseInventoryImport] Retry attempt ${attempt}/${MAX_RETRIES - 1} after ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller?.abort(), 300000);

      let response;
      try {
        response = await fetch(functionUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
            'apikey': supabaseAnonKey,
          },
          body: JSON.stringify({
            headers,
            rows,
            source_type: sourceType,
            meta,
            vesselLocations,
          }),
          signal: controller?.signal,
        });
        clearTimeout(timeoutId);
      } catch (fetchErr) {
        clearTimeout(timeoutId);
        if (fetchErr?.name === 'AbortError') {
          console.error('[callParseInventoryImport] Request timed out after 5 minutes');
          return { error: 'Processing timed out — the file may be too large. Try importing a smaller batch.' };
        }
        lastError = fetchErr;
        console.warn(`[callParseInventoryImport] Fetch attempt ${attempt + 1} failed:`, fetchErr?.message ?? fetchErr);
        continue;
      }

      if (!response?.ok) {
        const errText = await response?.text()?.catch(() => 'Unknown error');
        console.error('parseInventoryImport HTTP error:', response?.status, errText);
        return { error: `Processing failed (HTTP ${response?.status})` };
      }

      const data = await response?.json();

      if (data?.error) {
        console.error('parseInventoryImport returned error:', data?.error);
        return { error: data?.error };
      }

      if (data?.message || data?.items === undefined) {
        const reason = data?.message || 'Processing returned no items';
        console.error('parseInventoryImport silent failure:', reason, data);
        return { error: reason };
      }

      const items = enforceSpritClassification(
        enforceStrictLocationMatching(data?.items ?? [], vesselLocations)
      );

      const processedItems = filterHeaderLikeItems(
        items?.map(extractYearFromItemName)
      );

      return {
        items: processedItems,
        warnings: data?.warnings ?? [],
        detectedSchema: data?.detectedSchema ?? null,
      };
    }

    console.error('callParseInventoryImport failed after', MAX_RETRIES, 'attempts. Last error:', lastError);
    return {
      error: 'Processing failed after multiple attempts — network connection is unavailable. Please check your connection and try again.',
    };

  } catch (err) {
    if (err?.name === 'AbortError') {
      console.error('callParseInventoryImport timed out after 5 minutes');
      return { error: 'Processing timed out — the file may be too large. Try importing a smaller batch.' };
    }
    console.error('callParseInventoryImport unexpected error:', err);
    return { error: 'Processing failed — network error. Please check your connection and try again.' };
  }
}

/**
 * Enforce strict exact matching for vessel locations.
 * The AI may return location_match values that are not real vessel location paths.
 * Only values that exactly exist in the vesselLocations set are valid exact matches.
 * Fuzzy matching is disabled entirely — fuzzy confidence is always cleared.
 * Everything else is reset to null / 'none'.
 */
function enforceStrictLocationMatching(items, vesselLocations) {
  if (!Array.isArray(items)) return items;
  const locationSet = new Set(Array.isArray(vesselLocations) ? vesselLocations : []);

  return items?.map((item) => {
    const confidence = item?.location_match_confidence;
    let match = item?.location_match;

    if (
      confidence === 'exact' &&
      match &&
      typeof match === 'string' &&
      locationSet?.size > 0 &&
      locationSet?.has(match?.trim())
    ) {
      // Valid exact match — keep as-is but clear any suggestions
      return {
        ...item,
        location_match: match?.trim(),
        location_suggestions: [],
      };
    }

    // Everything else (fuzzy, none, exact with wrong value, exact with no value,
    // or when vesselLocations is empty) is cleared.
    return {
      ...item,
      location_match: null,
      location_match_confidence: 'none',
      location_suggestions: [],
    };
  });
}

// ---------------------------------------------------------------------------
// Brand-based spirit classification enforcer
// ---------------------------------------------------------------------------

/**
 * Brand → [category, subcategory, suggested_folder] lookup table.
 * Keys are lowercase for case-insensitive matching.
 */
const BRAND_CLASSIFICATION_MAP = [
  // Tequila
  { patterns: ['patron', 'patrón', 'don julio', 'casamigos', 'jose cuervo', 'herradura', 'espolon', 'espolòn', 'olmeca', 'clase azul'], category: 'Alcohol', subcategory: 'Tequila', folder: 'Interior > Guest > Alcohol > Spirits > Tequila' },
  // Vodka
  { patterns: ['grey goose', 'belvedere', 'absolut', 'ketel one', 'ciroc', 'stolichnaya', 'smirnoff', "tito\'s", 'haku', 'reyka', 'finlandia', 'chopin'], category: 'Alcohol', subcategory: 'Vodka', folder: 'Interior > Guest > Alcohol > Spirits > Vodka' },
  // Gin
  { patterns: ["hendrick\'s", 'hendricks', 'tanqueray', 'bombay sapphire', 'monkey 47', 'the botanist', 'beefeater', 'sipsmith', 'roku', 'malfy', 'gin mare'], category: 'Alcohol', subcategory: 'Gin', folder: 'Interior > Guest > Alcohol > Spirits > Gin' },
  // Rum
  { patterns: ['bacardi', 'captain morgan', 'diplomatico', 'havana club', 'mount gay', 'appleton', 'zacapa', 'kraken', 'plantation'], category: 'Alcohol', subcategory: 'Rum', folder: 'Interior > Guest > Alcohol > Spirits > Rum' },
  // Whisky
  { patterns: ['johnnie walker', 'glenfiddich', 'macallan', 'chivas regal', "jack daniel\'s", 'jack daniels', 'jameson', 'bulleit', 'woodford reserve', 'lagavulin', 'laphroaig', 'balvenie', 'glenlivet', 'ardbeg'], category: 'Alcohol', subcategory: 'Whisky', folder: 'Interior > Guest > Alcohol > Spirits > Whisky' },
  // Cognac
  { patterns: ['hennessy', 'rémy martin', 'remy martin', 'martell', 'courvoisier', 'hine', 'camus', 'louis xiii'], category: 'Alcohol', subcategory: 'Cognac', folder: 'Interior > Guest > Alcohol > Spirits > Cognac' },
  // Aperitif / Liqueur
  { patterns: ['campari', 'aperol', 'lillet', "pimm\'s", 'cointreau', 'grand marnier', 'baileys', 'kahlúa', 'kahlua', 'amaretto', 'disaronno', 'malibu', 'sambuca', 'limoncello', 'jägermeister', 'jagermeister', 'drambuie', 'southern comfort', 'midori', 'chambord', 'frangelico', 'tia maria', 'passoa', 'cynar', 'fernet-branca', 'suze', 'chartreuse', 'galliano'], category: 'Alcohol', subcategory: 'Aperitif', folder: 'Interior > Guest > Alcohol > Aperitif' },
  // Champagne
  { patterns: ['moët', 'moet', 'veuve clicquot', 'dom pérignon', 'dom perignon', 'bollinger', 'krug', 'laurent-perrier', 'pol roger', 'taittinger', 'ruinart', 'perrier-jouët', 'perrier-jouet', 'cristal', 'armand de brignac'], category: 'Alcohol', subcategory: 'Champagne', folder: 'Interior > Guest > Alcohol > Champagne' },
  // Beer
  { patterns: ['heineken', 'peroni', 'corona', 'stella artois', 'budweiser', 'guinness', 'san miguel', 'asahi', 'modelo'], category: 'Alcohol', subcategory: 'Beer', folder: 'Interior > Guest > Alcohol > Beer' },
  // Cider
  { patterns: ['strongbow', 'magners', 'kopparberg', 'rekorderlig', 'aspall'], category: 'Alcohol', subcategory: 'Cider', folder: 'Interior > Guest > Alcohol > Cider' },
];

/**
 * Given an item, check if item_name or brand contains a known spirit brand.
 * Returns { category, subcategory, folder } if found, or null if not.
 */
function detectBrandClassification(item) {
  const searchText = [
    item?.item_name || '',
    item?.brand || '',
  ]?.join(' ')?.toLowerCase();

  for (const rule of BRAND_CLASSIFICATION_MAP) {
    for (const pattern of rule?.patterns) {
      // Use word-boundary-like matching: check if the pattern appears as a
      // standalone word/phrase (not as part of another word)
      const escaped = pattern?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(?:^|[\\s,.(\\-])${escaped}(?:[\\s,.)\\-]|$)`, 'i');
      if (regex?.test(searchText) || searchText?.includes(pattern)) {
        return { category: rule?.category, subcategory: rule?.subcategory, folder: rule?.folder };
      }
    }
  }
  return null;
}

/**
 * Post-process AI items to enforce brand-based spirit classification.
 * If the AI failed to classify a known brand, override category/subcategory/suggested_folder.
 */
function enforceSpritClassification(items) {
  if (!Array.isArray(items)) return items;

  return items?.map((item) => {
    const detected = detectBrandClassification(item);
    if (!detected) return item;

    // Only override if the AI got it wrong or left it blank
    const alreadyCorrect =
      item?.category === detected?.category &&
      item?.subcategory === detected?.subcategory;

    if (alreadyCorrect) return item;

    return {
      ...item,
      category: detected?.category,
      subcategory: detected?.subcategory,
      suggested_folder: detected?.folder,
    };
  });
}

/**
 * Extract a year (1900–2099) from item_name into the year field.
 * Removes the year and surrounding brackets/parentheses/commas from item_name.
 * Only applies if the item does not already have a year value.
 */
function extractYearFromItemName(item) {
  if (!item) return item;
  // If year is already set, just clean item_name of any year pattern
  const name = item?.item_name || '';
  if (!name) return item;

  // Match a 4-digit year between 1900 and 2099, optionally wrapped in () or []
  const yearPattern = /[\s,\-]*[\(\[]?((?:19|20)\d{2})[\)\]]?[\s,\-]*/g;
  let extractedYear = item?.year ?? null;
  let cleanedName = name;

  if (!extractedYear) {
    let match = yearPattern?.exec(name);
    if (match) {
      extractedYear = parseInt(match?.[1], 10);
    }
  }

  if (extractedYear) {
    // Remove the year (and surrounding brackets/parens/commas/spaces) from item_name
    cleanedName = name?.replace(/[\s,\-]*[\(\[]((?:19|20)\d{2})[\)\]][\s,\-]*/g, ' ')?.replace(/[\s,\-]+((?:19|20)\d{2})(?=\s*$|[\s,\-])/g, ' ')?.replace(/^[\s,\-]+|[\s,\-]+$/g, '')?.trim();
    // Remove trailing commas or dashes
    cleanedName = cleanedName?.replace(/[,\-\s]+$/, '')?.trim();
  }

  return {
    ...item,
    item_name: cleanedName || name,
    year: extractedYear,
  };
}

/**
 * Filter out items that look like section header / title rows.
 * A header-like item has:
 * - A single short word item_name (no spaces, ≤20 chars)
 * - No quantity (null, 0, or empty)
 * - No brand
 * - No size
 * - No supplier
 * - No unit (or only inferred unit)
 * These are rows like "Vodka", "Liqueurs", "Spirits", "Beer" that slipped through.
 */
function filterHeaderLikeItems(items) {
  if (!Array.isArray(items)) return items;

  // Known section header words to always exclude
  const HEADER_WORDS = new Set([
    'vodka', 'gin', 'rum', 'tequila', 'whisky', 'whiskey', 'cognac', 'brandy',
    'champagne', 'wine', 'beer', 'cider', 'spirits', 'liqueurs', 'liqueur',
    'aperitif', 'aperitifs', 'water', 'juice', 'juices', 'coffee', 'tea',
    'beverages', 'drinks', 'alcohol', 'non-alcoholic', 'soft drinks', 'sodas',
    'mixers', 'energy drinks', 'sparkling wine', 'rosé', 'rose', 'red wine',
    'white wine', 'prosecco', 'cava', 'sekt', 'port', 'sherry', 'vermouth',
    'bitters', 'cordials', 'schnapps', 'absinthe', 'mezcal', 'sake', 'soju',
  ]);

  return items?.filter((item) => {
    const name = (item?.item_name || '')?.trim()?.toLowerCase();
    if (!name) return false;

    // Always exclude known header words (exact match)
    if (HEADER_WORDS?.has(name)) return false;

    // Exclude if: single word (no spaces), short (≤25 chars), no quantity, no brand, no size
    const isSingleWord = !name?.includes(' ');
    const isShort = name?.length <= 25;
    const hasNoQuantity = !item?.quantity || item?.quantity === 0 || item?.quantity === null;
    const hasNoBrand = !item?.brand || item?.brand === '' || item?.brand === null;
    const hasNoSize = !item?.size || item?.size === '' || item?.size === null;
    const hasNoSupplier = !item?.supplier || item?.supplier === '' || item?.supplier === null;

    if (isSingleWord && isShort && hasNoQuantity && hasNoBrand && hasNoSize && hasNoSupplier) {
      return false;
    }

    return true;
  });
}

// ---------------------------------------------------------------------------
// Header detection helpers (legacy — kept for fallback)
// ---------------------------------------------------------------------------

function isRealHeaderRow(row) {
  if (!row || row?.length === 0) return false;
  const nonEmpty = row?.filter((c) => c && String(c)?.trim() !== '');
  if (nonEmpty?.length === 0) return false;
  const unnamedCount = nonEmpty?.filter((c) => /^unnamed[:\s_]?\d*/i?.test(String(c)?.trim()))?.length;
  if (unnamedCount > nonEmpty?.length / 2) return false;
  const numericCount = nonEmpty?.filter((c) => !isNaN(Number(String(c)?.trim())))?.length;
  if (numericCount > nonEmpty?.length / 2) return false;
  return true;
}

function normalizeSpacedText(text) {
  if (!text) return text;
  const trimmed = String(text)?.trim();
  if (/^([A-Za-z]\s){2,}[A-Za-z]$/?.test(trimmed)) {
    const joined = trimmed?.replace(/\s+/g, '');
    return joined?.charAt(0)?.toUpperCase() + joined?.slice(1)?.toLowerCase();
  }
  return trimmed;
}

/**
 * Returns true if a row is a category/section label row.
 *
 * RELAXED RULES (v2):
 * - Only classify as category if the row has NO numeric values at all
 *   (a row with any numbers in it is likely a real item row with quantities)
 * - Must have ≤2 non-empty cells
 * - Must have mostly empty cells (>60% empty) when there are many columns
 * - The non-empty value must be a short text label, not a product with size info
 */
function isCategoryRow(row, headerCount) {
  if (!row || row?.length === 0) return false;
  const nonEmptyCells = row?.filter((c) => c && String(c)?.trim() !== '');
  if (nonEmptyCells?.length === 0) return false;

  // KEY FIX: If ANY cell in the row contains a numeric value, it's NOT a category row.
  // Real item rows always have at least one quantity number.
  const hasAnyNumeric = row?.some((c) => {
    const s = String(c ?? '')?.trim();
    return s !== '' && !isNaN(Number(s));
  });
  if (hasAnyNumeric) return false;

  // Must have few non-empty cells
  if (nonEmptyCells?.length > 2) return false;

  // Must have mostly empty cells if there are many columns
  if (headerCount > 3 && nonEmptyCells?.length / headerCount > 0.4) return false;

  // The non-empty value must be a text label, not a number
  const val = String(nonEmptyCells?.[0])?.trim();
  if (!isNaN(Number(val))) return false;

  // Reject if it looks like a product name with brand/quantity info
  if (/\d+\s*(ml|cl|l|kg|g|pcs|btl|bottle)/i?.test(val)) return false;

  return true;
}

function detectLocationColumns(headers) {
  const locationPatterns = [
    /^bdp$/i, /^bds$/i, /^mds$/i, /^mdp$/i,
    /^aft$/i, /^fwd$/i, /^bow$/i, /^stern$/i,
    /^master$/i, /^guest$/i, /^crew$/i,
    /^pantry$/i, /^galley$/i, /^bar$/i, /^cellar$/i,
    /^stbd$/i, /^port$/i, /^bridge$/i,
    /^salon$/i, /^saloon$/i, /^deck$/i,
    /^cabin\s*\d*/i, /^room\s*\d*/i, /^locker\s*\d*/i,
    /^fridge\s*\d*/i, /^freezer\s*\d*/i, /^storage\s*\d*/i,
  ];
  return headers?.filter((h) => {
    const trimmed = String(h || '')?.trim();
    if (!trimmed) return false;
    return locationPatterns?.some((p) => p?.test(trimmed));
  });
}

function detectTotalColumn(headers) {
  return headers?.find((h) => /^total$/i?.test(String(h || '')?.trim())) || null;
}

// ---------------------------------------------------------------------------
// Spreadsheet parser (SheetJS) — smart header + schema detection
// ---------------------------------------------------------------------------

/**
 * Parse an uploaded spreadsheet file (XLSX, XLS, CSV, ODS) into structured
 * inventory items via the AI edge function.
 *
 * Returns diagnostics alongside items so the UI can show exactly what happened.
 *
 * @param {File} file
 * @param {string[]} vesselLocations
 * @returns {Promise<{ items: object[], warnings: string[], diagnostics: object }|{ error: string, diagnostics?: object }>}
 */
export async function parseSpreadsheetFile(file, vesselLocations = []) {
  if (!file) return { error: 'No file provided' };

  try {
    const arrayBuffer = await file?.arrayBuffer();
    const workbook = XLSX?.read(arrayBuffer, { type: 'array', cellDates: true });

    const sheetName = workbook?.SheetNames?.[0];
    if (!sheetName) return { error: 'Spreadsheet contains no sheets' };

    const worksheet = workbook?.Sheets?.[sheetName];

    const rawData = XLSX?.utils?.sheet_to_json(worksheet, {
      header: 1,
      defval: '',
      raw: false,
    });

    if (!rawData || rawData?.length < 2) {
      return { error: 'Spreadsheet appears to be empty or has no data rows' };
    }

    // -----------------------------------------------------------------------
    // Step 1: Detect the true header row using schema inference engine
    // -----------------------------------------------------------------------
    const headerRowIndex = detectHeaderRow(rawData);
    const rawHeaders = (rawData?.[headerRowIndex] ?? [])?.map((h) => String(h ?? '')?.trim());
    const dataStartIndex = headerRowIndex + 1;

    // -----------------------------------------------------------------------
    // Step 2: Detect location columns and total column
    // -----------------------------------------------------------------------
    const locationColumns = detectLocationColumns(rawHeaders);
    const totalColumn = detectTotalColumn(rawHeaders);

    // -----------------------------------------------------------------------
    // Step 3: Build the import schema from headers + sample data
    // -----------------------------------------------------------------------
    const sampleDataRows = rawData?.slice(dataStartIndex, dataStartIndex + 20);
    const importSchema = buildImportSchema(rawHeaders, sampleDataRows);

    // -----------------------------------------------------------------------
    // Step 4: Process data rows — classify each row using schema inference
    // -----------------------------------------------------------------------
    const allDataRows = rawData?.slice(dataStartIndex);
    const categoryStack = [];
    const enrichedRows = [];

    // Diagnostics tracking
    const diagnostics = {
      headerRowIndex,
      detectedHeaderRow: rawHeaders,
      locationColumns,
      totalColumn,
      rawRowCount: allDataRows?.length,
      categoryRows: [],      // { rowIndex, label, reason }
      itemRows: [],          // { rowIndex, firstCell }
      excludedRows: [],      // { rowIndex, rawValues, reason }
    };

    for (let ri = 0; ri < allDataRows?.length; ri++) {
      const rawRow = allDataRows?.[ri];
      const row = (rawRow ?? [])?.map((c) => {
        // SheetJS with cellDates:true may return actual JS Date objects for date cells.
        // Convert them to YYYY-MM-DD strings so downstream parsing is consistent.
        if (c instanceof Date) {
          if (isNaN(c?.getTime())) return '';
          const y = c?.getFullYear();
          const m = String(c?.getMonth() + 1)?.padStart(2, '0');
          const d = String(c?.getDate())?.padStart(2, '0');
          return `${y}-${m}-${d}`;
        }
        return String(c ?? '')?.trim();
      });

      // Skip completely blank rows
      if (!row?.some((c) => c !== '')) {
        diagnostics?.excludedRows?.push({
          rowIndex: dataStartIndex + ri,
          rawValues: row,
          reason: 'Blank row — all cells empty',
        });
        continue;
      }

      // Use schema-aware title row detection
      const titleCheck = detectTitleRow(row, rawHeaders?.length);
      if (titleCheck?.isTitle) {
        const rawLabel = row?.find((c) => c !== '') || '';
        const normalizedLabel = normalizeSpacedText(rawLabel);

        const firstNonEmptyIndex = row?.findIndex((c) => c !== '');
        if (firstNonEmptyIndex === 0) {
          categoryStack.length = 0;
          categoryStack?.push(normalizedLabel);
        } else {
          categoryStack?.splice(firstNonEmptyIndex);
          categoryStack?.push(normalizedLabel);
        }

        diagnostics?.categoryRows?.push({
          rowIndex: dataStartIndex + ri,
          label: normalizedLabel,
          rawLabel,
          reason: titleCheck?.reason,
        });
        continue;
      }

      // It's a real data row
      const breadcrumb = categoryStack?.length > 0 ? categoryStack?.join(' > ') : '';
      enrichedRows?.push([breadcrumb, ...row]);

      diagnostics?.itemRows?.push({
        rowIndex: dataStartIndex + ri,
        firstCell: row?.[0] || '',
        breadcrumb,
      });
    }

    // -----------------------------------------------------------------------
    // Step 5: If zero item rows found, return diagnostics
    // -----------------------------------------------------------------------
    if (enrichedRows?.length === 0) {
      const reason = diagnostics?.categoryRows?.length > 0
        ? `All ${allDataRows?.length} data rows were classified as category/section labels. ` +
          `Category rows found: ${diagnostics?.categoryRows?.map(r => `"${r?.label}"`)?.join(', ')}`
        : `No data rows found after filtering. Raw rows read: ${allDataRows?.length}.`;

      console.warn('[parseSpreadsheetFile] Zero item rows found. Diagnostics:', diagnostics);

      return {
        error: reason,
        diagnostics,
      };
    }

    // -----------------------------------------------------------------------
    // Step 6: Build enriched headers
    // -----------------------------------------------------------------------
    const enrichedHeaders = ['Suggested Folder', ...rawHeaders];

    // -----------------------------------------------------------------------
    // Step 7: Pad/trim rows to header length (removed 30-row slice limit)
    // -----------------------------------------------------------------------
    const processedRows = enrichedRows?.map((row) => {
      const padded = [...row];
      while (padded?.length < enrichedHeaders?.length) padded?.push('');
      return padded?.slice(0, enrichedHeaders?.length);
    });

    // -----------------------------------------------------------------------
    // Step 8: Build metadata for the AI
    // -----------------------------------------------------------------------
    const meta = {
      locationColumns,
      totalColumn,
      hasSuggestedFolderColumn: true,
      originalHeaderRowIndex: headerRowIndex,
      schemaContext: buildSchemaPromptContext(importSchema, rawHeaders),
      // Pass dynamic column info so AI knows which fields are source-specific
      dynamicColumns: importSchema?.dynamicColumns?.map(f => ({
        header: f?.sourceHeader,
        type: f?.type,
        key: f?.coreKey || f?.sourceKey || normalizeHeaderText(f?.sourceHeader),
        inferredType: f?.inferredType,
      })),
      sourceFields: importSchema?.sourceFields?.map(f => ({
        header: f?.sourceHeader,
        key: f?.sourceKey || normalizeHeaderText(f?.sourceHeader),
        inferredType: f?.inferredType,
      })),
    };

    // -----------------------------------------------------------------------
    // Step 9: Call AI and attach diagnostics to result
    // -----------------------------------------------------------------------
    const aiResult = await callParseInventoryImport(enrichedHeaders, processedRows, 'spreadsheet', meta, vesselLocations);

    if (aiResult?.error) {
      return { ...aiResult, diagnostics };
    }

    // If AI returned zero items, attach diagnostics so the UI can explain why
    const items = aiResult?.items ?? [];
    if (items?.length === 0) {
      console.warn('[parseSpreadsheetFile] AI returned 0 items. Parser sent', enrichedRows?.length, 'rows. Diagnostics:', diagnostics);
    }

    // Ensure items with unresolved/missing location_match_confidence are kept
    // and marked as needing location selection rather than being dropped
    const safeItems = items?.map((item) => {
      if (!item?.location_match_confidence) {
        return {
          ...item,
          location_match_confidence: 'none',
          location_match: null,
          location_suggestions: item?.location_suggestions || [],
        };
      }
      return item;
    });

    return {
      items: safeItems,
      warnings: aiResult?.warnings ?? [],
      diagnostics,
      // Pass the detected schema back to the UI for the field mapping panel
      detectedSchema: {
        sourceHeaders: rawHeaders,
        headerRowIndex,
        fieldMappings: importSchema?.fieldMappings,
        coreFields: importSchema?.coreFields,
        sourceFields: importSchema?.sourceFields,
        ignoredFields: importSchema?.ignoredFields,
        dynamicColumns: importSchema?.dynamicColumns,
      },
    };
  } catch (err) {
    console.error('parseSpreadsheetFile error:', err);
    return { error: `Failed to read spreadsheet: ${err?.message ?? 'Unknown error'}` };
  }
}

// ---------------------------------------------------------------------------
// PDF text extractor
// ---------------------------------------------------------------------------

export async function parsePDFText(file, vesselLocations = []) {
  if (!file) return { error: 'No file provided' };

  try {
    const { headers, rows, meta } = await extractStructuredTableFromPDF(file);

    if (!headers || headers?.length === 0 || !rows || rows?.length === 0) {
      return {
        error:
          'Could not extract readable text from this PDF. It may be a scanned image — try using the document scanner instead.',
      };
    }

    // Build schema for PDF headers too
    const importSchema = buildImportSchema(headers, rows?.slice(0, 20));
    const schemaContext = buildSchemaPromptContext(importSchema, headers);

    const enrichedMeta = {
      ...meta,
      schemaContext,
      dynamicColumns: importSchema?.dynamicColumns?.map(f => ({
        header: f?.sourceHeader,
        type: f?.type,
        key: f?.coreKey || f?.sourceKey || normalizeHeaderText(f?.sourceHeader),
        inferredType: f?.inferredType,
      })),
      sourceFields: importSchema?.sourceFields?.map(f => ({
        header: f?.sourceHeader,
        key: f?.sourceKey || normalizeHeaderText(f?.sourceHeader),
        inferredType: f?.inferredType,
      })),
    };

    const result = await callParseInventoryImport(headers, rows, 'pdf', enrichedMeta, vesselLocations);

    return {
      ...result,
      detectedSchema: {
        sourceHeaders: headers,
        fieldMappings: importSchema?.fieldMappings,
        coreFields: importSchema?.coreFields,
        sourceFields: importSchema?.sourceFields,
        ignoredFields: importSchema?.ignoredFields,
        dynamicColumns: importSchema?.dynamicColumns,
      },
    };
  } catch (err) {
    console.error('parsePDFText error:', err);
    return { error: `Failed to read PDF: ${err?.message ?? 'Unknown error'}` };
  }
}

// ---------------------------------------------------------------------------
// PDF structured table extractor using pdfjs-dist
// ---------------------------------------------------------------------------

/**
 * Extract structured { headers, rows, meta } from a PDF file using pdfjs-dist.
 *
 * Strategy:
 * 1. Use pdfjs-dist to get all text items with their x/y positions from every page.
 * 2. Group items with similar y-coordinates into logical rows (position-based).
 * 3. Sort each row by x-position to reconstruct column order.
 * 4. Detect the header row from the first meaningful row.
 * 5. Attempt column alignment across rows to produce string[][] output.
 * 6. Fall back to delimiter/spacing heuristics if column alignment fails.
 * 7. Final fallback: single-cell rows.
 *
 * @param {File} file
 * @returns {Promise<{ headers: string[], rows: string[][], meta: object }>}
 */
async function extractStructuredTableFromPDF(file) {
  // -------------------------------------------------------------------------
  // Load pdfjs-dist dynamically (browser-compatible, avoids SSR issues)
  // -------------------------------------------------------------------------
  let pdfjsLib;
  try {
    pdfjsLib = await import('pdfjs-dist');
    // Point the worker at the bundled worker file shipped with pdfjs-dist
    if (pdfjsLib?.GlobalWorkerOptions) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs',
        import.meta.url
      )?.toString();
    }
  } catch (importErr) {
    console.warn('[extractStructuredTableFromPDF] pdfjs-dist not available, falling back to regex extraction:', importErr);
    return extractStructuredTableFallback(file);
  }

  // -------------------------------------------------------------------------
  // Read the file as ArrayBuffer and load the PDF document
  // -------------------------------------------------------------------------
  const arrayBuffer = await file?.arrayBuffer();
  let pdfDoc;
  try {
    const loadingTask = pdfjsLib?.getDocument({ data: arrayBuffer });
    pdfDoc = await loadingTask?.promise;
  } catch (loadErr) {
    console.warn('[extractStructuredTableFromPDF] Failed to load PDF document:', loadErr);
    return extractStructuredTableFallback(file);
  }

  // -------------------------------------------------------------------------
  // Extract all text items with positions from every page
  // -------------------------------------------------------------------------
  const allItems = []; // { text, x, y, pageNum, width, height }

  for (let pageNum = 1; pageNum <= pdfDoc?.numPages; pageNum++) {
    try {
      const page = await pdfDoc?.getPage(pageNum);
      const viewport = page?.getViewport({ scale: 1.0 });
      const textContent = await page?.getTextContent();

      // Normalise y so that y=0 is the top of the page (PDF y grows upward)
      const pageHeight = viewport?.height;

      for (const item of textContent?.items ?? []) {
        const text = item?.str?.trim();
        if (!text) continue;

        const transform = item?.transform ?? [1, 0, 0, 1, 0, 0];
        const x = transform?.[4];
        const rawY = transform?.[5];
        // Flip y so rows read top-to-bottom; add page offset so pages stack
        const y = (pageHeight - rawY) + (pageNum - 1) * (pageHeight + 50);

        allItems?.push({
          text,
          x: Math.round(x),
          y: Math.round(y),
          pageNum,
          width: item?.width ?? 0,
          height: item?.height ?? 0,
        });
      }
    } catch (pageErr) {
      console.warn(`[extractStructuredTableFromPDF] Error reading page ${pageNum}:`, pageErr);
    }
  }

  if (allItems?.length === 0) {
    return extractStructuredTableFallback(file);
  }

  // -------------------------------------------------------------------------
  // Group items into rows by y-coordinate proximity
  // -------------------------------------------------------------------------
  // Sort by y first, then x
  allItems?.sort((a, b) => a?.y - b?.y || a?.x - b?.x);

  // Determine a sensible y-tolerance (use median item height, min 4px, max 12px)
  const heights = allItems?.map((i) => i?.height)?.filter((h) => h > 0)?.sort((a, b) => a - b);
  const medianHeight = heights?.length > 0 ? heights?.[Math.floor(heights?.length / 2)] : 8;
  const Y_TOLERANCE = Math.max(4, Math.min(12, medianHeight * 0.6));

  const rawRows = []; // string[][]  — each inner array is one visual row
  const rawRowItems = []; // { text, x }[][] — for column detection

  let currentRowItems = [allItems?.[0]];
  let currentY = allItems?.[0]?.y;

  for (let i = 1; i < allItems?.length; i++) {
    const item = allItems?.[i];
    if (Math.abs(item?.y - currentY) <= Y_TOLERANCE) {
      currentRowItems?.push(item);
    } else {
      // Flush current row
      currentRowItems?.sort((a, b) => a?.x - b?.x);
      rawRows?.push(currentRowItems?.map((it) => it?.text));
      rawRowItems?.push(currentRowItems?.map((it) => ({ text: it?.text, x: it?.x })));
      currentRowItems = [item];
      currentY = item?.y;
    }
  }
  // Flush last row
  if (currentRowItems?.length > 0) {
    currentRowItems?.sort((a, b) => a?.x - b?.x);
    rawRows?.push(currentRowItems?.map((it) => it?.text));
    rawRowItems?.push(currentRowItems?.map((it) => ({ text: it?.text, x: it?.x })));
  }

  // Remove completely blank rows (shouldn't happen but guard anyway)
  const meaningfulRows = rawRows?.filter((r) => r?.some((c) => c?.trim() !== ''));
  const meaningfulRowItems = rawRowItems?.filter((r) => r?.length > 0);

  if (meaningfulRows?.length === 0) {
    return extractStructuredTableFallback(file);
  }

  // -------------------------------------------------------------------------
  // Attempt column alignment using x-position clustering
  // -------------------------------------------------------------------------
  // Collect all unique x positions across all rows
  const allXPositions = meaningfulRowItems?.flatMap((r) => r?.map((it) => it?.x));
  const columnBoundaries = clusterXPositions(allXPositions);

  let headers;
  let rows;

  if (columnBoundaries?.length >= 2) {
    // We have detected multiple columns — align every row to the column grid
    const alignedRows = meaningfulRowItems?.map((rowItems) =>
      alignRowToColumns(rowItems, columnBoundaries)
    );

    // Find the first row that looks like a header
    let headerRowIndex = findHeaderRowIndex(alignedRows);
    headers = alignedRows?.[headerRowIndex];
    rows = alignedRows?.slice(headerRowIndex + 1)?.filter((r) => r?.some((c) => c?.trim() !== ''));
  } else {
    // Single-column or undetectable layout — try delimiter/spacing heuristics
    const splitResult = splitRowsByHeuristics(meaningfulRows);
    headers = splitResult?.headers;
    rows = splitResult?.rows;
  }

  // -------------------------------------------------------------------------
  // Build meta
  // -------------------------------------------------------------------------
  const locationColumns = detectLocationColumns(headers);
  const totalColumn = detectTotalColumn(headers);
  const hasSuggestedFolderColumn = headers?.some((h) =>
    /folder|category|section|department/i?.test(String(h ?? ''))
  );

  const meta = {
    locationColumns: locationColumns?.length > 0 ? locationColumns : undefined,
    totalColumn: totalColumn || undefined,
    hasSuggestedFolderColumn,
    pdfPageCount: pdfDoc?.numPages,
    pdfItemCount: allItems?.length,
  };

  return { headers, rows, meta };
}

// ---------------------------------------------------------------------------
// Column x-position clustering
// ---------------------------------------------------------------------------

/**
 * Cluster a flat list of x-positions into column boundary groups.
 * Returns sorted array of representative x values (one per column).
 */
function clusterXPositions(xPositions) {
  if (xPositions?.length === 0) return [];

  const sorted = [...new Set(xPositions)]?.sort((a, b) => a - b);
  const CLUSTER_GAP = 20; // px — positions within this distance belong to same column

  const clusters = [];
  let currentCluster = [sorted?.[0]];

  for (let i = 1; i < sorted?.length; i++) {
    if (sorted?.[i] - sorted?.[i - 1] <= CLUSTER_GAP) {
      currentCluster?.push(sorted?.[i]);
    } else {
      clusters?.push(currentCluster);
      currentCluster = [sorted?.[i]];
    }
  }
  clusters?.push(currentCluster);

  // Representative x for each cluster = median
  return clusters?.map((cluster) => {
    const mid = Math.floor(cluster?.length / 2);
    return cluster?.[mid];
  });
}

/**
 * Assign each text item in a row to the nearest column boundary.
 * Returns a string[] with one cell per column boundary.
 */
function alignRowToColumns(rowItems, columnBoundaries) {
  const cells = new Array(columnBoundaries.length)?.fill('');

  for (const item of rowItems) {
    // Find nearest column boundary
    let nearestIdx = 0;
    let nearestDist = Math.abs(item?.x - columnBoundaries?.[0]);
    for (let i = 1; i < columnBoundaries?.length; i++) {
      const dist = Math.abs(item?.x - columnBoundaries?.[i]);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestIdx = i;
      }
    }
    // Append to cell (multiple items can land in same column)
    cells[nearestIdx] = cells?.[nearestIdx]
      ? cells?.[nearestIdx] + ' ' + item?.text
      : item?.text;
  }

  return cells;
}

// ---------------------------------------------------------------------------
// Header row detection
// ---------------------------------------------------------------------------

function findHeaderRowIndex(alignedRows) {
  for (let i = 0; i < Math.min(5, alignedRows?.length); i++) {
    if (isRealHeaderRow(alignedRows?.[i])) return i;
  }
  return 0;
}

function buildFallbackHeaders(columnCount) {
  const names = ['Item', 'Quantity', 'Location', 'Size', 'Notes', 'Category'];
  let headers = [];
  for (let i = 0; i < columnCount; i++) {
    headers?.push(names?.[i] ?? `Column ${i + 1}`);
  }
  return headers;
}

// ---------------------------------------------------------------------------
// Heuristic line splitter (single-column fallback)
// ---------------------------------------------------------------------------

/**
 * When column detection fails, attempt to split each text row into multiple
 * cells using common delimiters or large whitespace gaps.
 */
function splitRowsByHeuristics(rawRows) {
  // Detect dominant delimiter
  const DELIMITERS = ['\t', '|', ';', ','];
  const delimiterCounts = {};
  for (const delim of DELIMITERS) {
    delimiterCounts[delim] = rawRows?.reduce((acc, row) => {
      return acc + row?.reduce((a, cell) => a + (cell?.split(delim)?.length - 1), 0);
    }, 0);
  }

  const bestDelim = DELIMITERS?.reduce((best, d) =>
    delimiterCounts?.[d] > delimiterCounts?.[best] ? d : best
  );

  let splitRows;
  if (delimiterCounts?.[bestDelim] > rawRows?.length * 0.3) {
    // Enough rows use this delimiter — split by it
    splitRows = rawRows?.map((row) => row?.join(' ')?.split(bestDelim)?.map((c) => c?.trim()));
  } else {
    // Try splitting by 2+ consecutive spaces within joined row text
    splitRows = rawRows?.map((row) => {
      const joined = row?.join('  ');
      const parts = joined?.split(/\s{2,}/)?.map((c) => c?.trim())?.filter((c) => c?.length > 0);
      return parts?.length > 1 ? parts : [joined];
    });
  }

  // Remove completely empty rows
  const nonEmpty = splitRows?.filter((r) => r?.some((c) => c?.trim() !== ''));

  if (nonEmpty?.length === 0) {
    return { headers: ['Text Content'], rows: rawRows?.map((r) => [r?.join(' ')]) };
  }

  // Detect header row
  const headerIdx = findHeaderRowIndex(nonEmpty);
  let headers = isRealHeaderRow(nonEmpty?.[headerIdx])
    ? nonEmpty?.[headerIdx]
    : buildFallbackHeaders(Math.max(...nonEmpty?.map((r) => r?.length)));

  let rows = nonEmpty?.slice(isRealHeaderRow(nonEmpty?.[headerIdx]) ? headerIdx + 1 : 0);

  // Normalise row widths
  const colCount = headers?.length;
  const normalisedRows = rows?.map((r) => {
    const padded = [...r];
    while (padded?.length < colCount) padded?.push('');
    return padded?.slice(0, colCount);
  });

  return { headers, rows: normalisedRows };
}

// ---------------------------------------------------------------------------
// Legacy regex fallback (used when pdfjs-dist cannot be loaded)
// ---------------------------------------------------------------------------

async function extractStructuredTableFallback(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.readAsBinaryString(file);
    reader.onload = (e) => {
      try {
        const content = e?.target?.result ?? '';
        const textMatches = [];
        const btEtRegex = /BT[\s\S]*?ET/g;
        let match;
        while ((match = btEtRegex.exec(content)) !== null) {
          const strRegex = /\(([^)]*)\)/g;
          let strMatch;
          while ((strMatch = strRegex.exec(match[0])) !== null) {
            const decoded = strMatch[1]
              .replace(/\\n/g, '\n')
              .replace(/\\r/g, '\r')
              .replace(/\\t/g, '\t')
              .replace(/\\\\/g, '\\')
              .replace(/\\([0-7]{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
            if (decoded.trim()) textMatches.push(decoded.trim());
          }
        }

        const lines = textMatches
          .join('\n')
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l.length > 0);

        if (lines.length === 0) {
          resolve({ headers: ['Text Content'], rows: [], meta: {} });
          return;
        }

        const splitResult = splitRowsByHeuristics(lines.map((l) => [l]));
        resolve({ ...splitResult, meta: {} });
      } catch (err) {
        resolve({ headers: ['Text Content'], rows: [], meta: {} });
      }
    };
    reader.onerror = () => resolve({ headers: ['Text Content'], rows: [], meta: {} });
  });
}
