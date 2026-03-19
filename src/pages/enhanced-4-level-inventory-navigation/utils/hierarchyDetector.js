/**
 * hierarchyDetector.js
 *
 * Detects hierarchical folder structure from Azure Document Intelligence output.
 *
 * Signals used:
 *  - Page titles / document title (from azureResult.pages[].lines)
 *  - Table "group" rows (rows with a single merged/spanning cell, or rows where
 *    only the first cell has content and the rest are blank)
 *  - Repeated label patterns across rows (e.g. "Cat B Standard" repeated)
 *  - Sheet/tab names (if present in azureResult metadata)
 *  - Section headers detected by font-size or bold hints in Azure spans
 *
 * Returns:
 *   {
 *     nodes: HierarchyNode[],   // all detected candidate labels
 *     suggestedTree: TreeNode[] // nested tree built from best-guess levels
 *   }
 *
 * HierarchyNode:
 *   { id, label, level, source, confidence, tableId?, rowIndex? }
 *
 * level: 1 = top-level folder, 2 = sub-folder, 3 = sub-sub-folder, 0 = unknown
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strip common noise from a candidate label.
 */
function cleanLabel(raw) {
  if (!raw) return '';
  return (
    // trailing bullets/dashes
    // leading bullets/dashes
    raw?.replace(/^\s*[-–—•*#]+\s*/, '')?.replace(/\s*[-–—•*#]+\s*$/, '')?.replace(/\s+/g, ' ')?.trim()
  );
}

/**
 * Is this string likely a section/group header rather than a data value?
 * Heuristics:
 *  - Short (≤ 60 chars)
 *  - No numeric-heavy content (not a quantity row)
 *  - Starts with a capital letter or is ALL CAPS
 *  - Does not look like a column header keyword
 */
const DATA_COLUMN_KEYWORDS = [
  'qty', 'quantity', 'item', 'name', 'description', 'code', 'sku', 'unit',
  'size', 'brand', 'supplier', 'notes', 'colour', 'color', 'batch', 'expiry',
  'price', 'cost', 'ref', 'no.', 'number', 'type', 'category',
];

function looksLikeGroupLabel(text) {
  if (!text || text?.length > 80) return false;
  const t = text?.trim();
  if (!t) return false;
  // Reject if it looks like a column header
  const lower = t?.toLowerCase();
  if (DATA_COLUMN_KEYWORDS?.some((kw) => lower === kw || lower?.startsWith(kw + ' '))) return false;
  // Reject if mostly numeric
  const numericRatio = (t?.match(/\d/g) || [])?.length / t?.length;
  if (numericRatio > 0.5) return false;
  // Accept if starts with capital or is all-caps (and has letters)
  const hasLetters = /[a-zA-Z]/?.test(t);
  if (!hasLetters) return false;
  const startsCapital = /^[A-Z]/?.test(t);
  const isAllCaps = t === t?.toUpperCase() && hasLetters;
  return startsCapital || isAllCaps;
}

/**
 * Check if a table row is a "group row":
 *  - Only the first cell (or first few cells) has content
 *  - The rest of the cells in the row are blank
 *  - The non-blank content looks like a group label
 */
function isGroupRow(row, totalColumns) {
  if (!row || row?.length === 0) return false;
  const nonBlank = row?.filter((c) => c?.trim());
  if (nonBlank?.length === 0) return false;
  // If more than 40% of cells have content it's probably a data row
  if (nonBlank?.length / Math.max(totalColumns, row?.length) > 0.4) return false;
  // The first non-blank cell should look like a group label
  const firstNonBlank = row?.find((c) => c?.trim()) || '';
  return looksLikeGroupLabel(firstNonBlank);
}

/**
 * Detect if a row is a "merged title row" — a single cell spanning the full
 * width (Azure returns it as a row with one non-blank cell and the rest blank).
 */
function isMergedTitleRow(row, totalColumns) {
  if (!row) return false;
  const nonBlank = row?.filter((c) => c?.trim());
  if (nonBlank?.length !== 1) return false;
  // Must span most of the table width
  if (totalColumns > 2 && nonBlank?.length / totalColumns > 0.3) return false;
  return looksLikeGroupLabel(nonBlank?.[0]);
}

/**
 * Assign a suggested hierarchy level based on position in the document and
 * the nesting depth of group rows found so far.
 *
 * Simple heuristic:
 *  - Page/document titles → level 1
 *  - First group row encountered in a table → level 1 (if no page title) or level 2
 *  - Subsequent group rows at a deeper indent → level 2 / 3
 *  - Merged title rows → level 1
 */
function assignLevel(source, depthHint) {
  if (source === 'page_title' || source === 'document_title' || source === 'merged_title') return 1;
  if (source === 'tab_name') return 1;
  if (depthHint <= 1) return 1;
  if (depthHint === 2) return 2;
  return 3;
}

// ---------------------------------------------------------------------------
// Main detector
// ---------------------------------------------------------------------------

/**
 * Detect hierarchy nodes from an Azure Document Intelligence result.
 *
 * @param {object} azureResult  - Full result from parseDocumentWithAzure()
 * @param {object} tableStates  - Current table states (for rowTypes hints)
 * @returns {{ nodes: HierarchyNode[], suggestedTree: TreeNode[] }}
 */
export function detectHierarchy(azureResult, tableStates = {}) {
  const nodes = [];
  let nodeId = 0;

  const makeNode = (label, level, source, confidence, extra = {}) => ({
    id: `h-${nodeId++}`,
    label: cleanLabel(label),
    level,
    source,
    confidence,
    ...extra,
  });

  // -------------------------------------------------------------------------
  // 1. Page titles from azureResult.pages[].lines (first line of each page)
  // -------------------------------------------------------------------------
  const pages = azureResult?.pages || [];
  pages?.forEach((page, pIdx) => {
    const lines = page?.lines || [];
    if (lines?.length === 0) return;
    // First line of the page is often a title
    const firstLine = lines?.[0]?.content?.trim() || '';
    if (firstLine && looksLikeGroupLabel(firstLine) && firstLine?.length <= 60) {
      nodes?.push(makeNode(firstLine, 1, pIdx === 0 ? 'document_title' : 'page_title', 0.8, { pageNumber: page?.pageNumber }));
    }
    // Look for short bold-ish lines that appear before tables
    lines?.slice(1, 6)?.forEach((line) => {
      const content = line?.content?.trim() || '';
      if (content && looksLikeGroupLabel(content) && content?.length <= 50) {
        nodes?.push(makeNode(content, 1, 'page_title', 0.6, { pageNumber: page?.pageNumber }));
      }
    });
  });

  // -------------------------------------------------------------------------
  // 2. Scan each table for group rows / merged title rows
  // -------------------------------------------------------------------------
  const tables = azureResult?.tables || [];
  tables?.forEach((table) => {
    const state = tableStates?.[table?.id] || {};
    const rows = table?.rows || [];
    const totalColumns = table?.columnCount || Math.max(...rows?.map((r) => r?.length || 0), 1);
    const headerRowIndex = state?.headerRowIndex ?? null;

    // Track depth within this table
    let groupDepth = 0;
    // Track last seen group labels at each depth to detect siblings
    const depthStack = [];

    rows?.forEach((row, rIdx) => {
      // Skip header row
      if (rIdx === headerRowIndex) return;

      // Check if user already marked this as a group row
      const userMarkedGroup = state?.rowTypes?.[rIdx] === 'group';

      const merged = isMergedTitleRow(row, totalColumns);
      const group = isGroupRow(row, totalColumns);

      if (!userMarkedGroup && !merged && !group) return;

      const label = (row?.find((c) => c?.trim()) || '')?.trim();
      if (!label) return;

      // Determine depth: merged title rows are always top-level within the table
      let depth;
      if (merged) {
        depth = 1;
        depthStack.length = 0;
        depthStack?.push(label);
        groupDepth = 1;
      } else {
        // Heuristic: if this label is indented (first cell blank, second has content)
        const firstCellBlank = !row?.[0]?.trim();
        const secondCellBlank = !row?.[1]?.trim();
        if (firstCellBlank && !secondCellBlank) {
          depth = Math.min(groupDepth + 1, 3);
        } else if (!firstCellBlank) {
          // Same or shallower level
          depth = groupDepth > 0 ? groupDepth : 1;
        } else {
          depth = Math.min(groupDepth + 1, 3);
        }
        groupDepth = depth;
        depthStack[depth - 1] = label;
        depthStack.length = depth;
      }

      const source = merged ? 'merged_title' : userMarkedGroup ? 'user_marked_group' : 'group_row';
      const confidence = merged ? 0.9 : userMarkedGroup ? 0.95 : 0.75;

      nodes?.push(makeNode(label, depth, source, confidence, {
        tableId: table?.id,
        rowIndex: rIdx,
        parentLabel: depth > 1 ? (depthStack?.[depth - 2] || null) : null,
      }));
    });
  });

  // -------------------------------------------------------------------------
  // 3. Deduplicate nodes (same label + same level → keep highest confidence)
  // -------------------------------------------------------------------------
  const seen = new Map();
  const deduped = [];
  nodes?.forEach((n) => {
    const key = `${n?.label?.toLowerCase()}::${n?.level}`;
    if (!seen?.has(key) || seen?.get(key)?.confidence < n?.confidence) {
      seen?.set(key, n);
    }
  });
  seen?.forEach((n) => deduped?.push(n));
  // Sort by tableId then rowIndex for stable ordering
  deduped?.sort((a, b) => {
    if (a?.tableId && b?.tableId && a?.tableId !== b?.tableId) return 0;
    if (a?.rowIndex !== undefined && b?.rowIndex !== undefined) return a?.rowIndex - b?.rowIndex;
    return 0;
  });

  // -------------------------------------------------------------------------
  // 4. Build suggested tree
  // -------------------------------------------------------------------------
  const suggestedTree = buildTree(deduped);

  return { nodes: deduped, suggestedTree };
}

/**
 * Build a nested tree from flat nodes.
 * Each node at level N is a child of the most recent node at level N-1.
 */
function buildTree(nodes) {
  const roots = [];
  const stack = []; // stack[i] = node at level i+1

  nodes?.forEach((node) => {
    const treeNode = { ...node, children: [] };
    const level = node?.level || 1;

    if (level === 1) {
      roots?.push(treeNode);
      stack.length = 0;
      stack[0] = treeNode;
    } else {
      const parentLevel = level - 1;
      const parent = stack?.[parentLevel - 1];
      if (parent) {
        parent?.children?.push(treeNode);
      } else {
        // No parent found — attach to roots
        roots?.push(treeNode);
      }
      stack[level - 1] = treeNode;
      stack.length = level;
    }
  });

  return roots;
}

/**
 * Flatten a confirmed hierarchy (from HierarchyReviewStep) into a list of
 * folder paths for each item row.
 *
 * confirmedNodes: HierarchyNode[] (user-confirmed, with level and isFolder flags)
 * Returns a map: { [tableId]: { [rowIndex]: string[] } }
 *   where the value is the folder path segments for that item row.
 */
export function buildFolderPathsFromHierarchy(confirmedNodes, tables, tableStates) {
  // Build an ordered list of (rowIndex, tableId, folderPath) entries
  const result = {};

  tables?.forEach((table) => {
    const state = tableStates?.[table?.id] || {};
    const rows = table?.rows || [];
    const headerRowIndex = state?.headerRowIndex ?? null;
    result[table?.id] = {};

    // Build a sorted list of group nodes for this table
    const tableGroupNodes = confirmedNodes?.filter((n) => n?.tableId === table?.id && n?.isFolder !== false)?.sort((a, b) => (a?.rowIndex ?? 0) - (b?.rowIndex ?? 0));

    // For each data row, find the applicable folder path
    rows?.forEach((row, rIdx) => {
      if (rIdx === headerRowIndex) return;
      const rowType = state?.rowTypes?.[rIdx] || 'data';
      if (rowType !== 'data') return;

      // Find all group nodes that appear before this row
      const applicableGroups = tableGroupNodes?.filter((n) => (n?.rowIndex ?? 0) < rIdx);

      if (applicableGroups?.length === 0) {
        result[table?.id][rIdx] = [];
        return;
      }

      // Build path: take the last group at each level
      const pathByLevel = {};
      applicableGroups?.forEach((n) => {
        pathByLevel[n.level] = n?.label;
      });

      // Build ordered path from level 1 → max level
      const maxLevel = Math.max(...Object.keys(pathByLevel)?.map(Number));
      const path = [];
      for (let l = 1; l <= maxLevel; l++) {
        if (pathByLevel?.[l]) path?.push(pathByLevel?.[l]);
      }

      result[table?.id][rIdx] = path;
    });
  });

  return result;
}

/**
 * Get a human-readable source label for display in the review UI.
 */
export function getSourceLabel(source) {
  const map = {
    document_title: 'Document title',
    page_title: 'Page title',
    merged_title: 'Merged title row',
    group_row: 'Group row',
    user_marked_group: 'Marked as group',
    tab_name: 'Tab / sheet name',
  };
  return map?.[source] || source;
}
