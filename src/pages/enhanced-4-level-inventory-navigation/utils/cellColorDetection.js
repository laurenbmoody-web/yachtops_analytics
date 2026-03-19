/**
 * cellColorDetection.js
 *
 * Renders a PDF or image file to an off-screen canvas and samples the dominant
 * background fill color at each cell's bounding region returned by Azure
 * Document Intelligence.
 *
 * Azure returns polygon coordinates in the document's unit space (inches or
 * pixels). This utility converts those to canvas pixel coordinates, samples a
 * representative interior region of the cell (avoiding borders/text), and maps
 * the dominant color to a normalized text label.
 *
 * Supported file types: PDF (via pdf.js CDN), PNG/JPG/TIFF/BMP (via <img>).
 *
 * Usage:
 *   import { extractCellColors } from './cellColorDetection';
 *   const colorMap = await extractCellColors(file, azureResult);
 *   // colorMap[tableId][rowIndex][colIndex] = "Red" | "Yellow" | ... | ""
 */

// ---------------------------------------------------------------------------
// Color label mapping
// ---------------------------------------------------------------------------

/**
 * Fixed controlled palette — the ONLY allowed color labels.
 * Each entry has a representative RGB value used for nearest-match distance.
 * Multiple representative anchors can be listed per label to improve matching
 * across shade variations.
 */
const FIXED_PALETTE = [
  { name: 'Yellow',                  anchors: [[255, 230, 0], [255, 245, 80], [240, 220, 30]] },
  { name: 'Light Blue',              anchors: [[135, 206, 235], [173, 216, 230], [100, 180, 220], [176, 224, 230]] },
  { name: 'Red',                     anchors: [[220, 30, 30], [200, 0, 0], [255, 60, 60]] },
  { name: 'Dark Purple',             anchors: [[80, 0, 100], [100, 0, 130], [60, 0, 80], [128, 0, 128]] },
  { name: 'Mustard / Gold',          anchors: [[200, 160, 0], [218, 165, 32], [180, 140, 0], [210, 180, 40]] },
  { name: 'Green',                   anchors: [[0, 160, 0], [34, 139, 34], [0, 128, 0], [50, 180, 50]] },
  { name: 'Cream / Beige',           anchors: [[245, 235, 210], [255, 248, 220], [240, 230, 200], [250, 240, 215]] },
  { name: 'Light Purple / Lavender', anchors: [[200, 162, 200], [216, 191, 216], [180, 150, 210], [210, 180, 230]] },
  { name: 'Teal / Turquoise',        anchors: [[0, 180, 180], [64, 224, 208], [0, 160, 160], [32, 200, 190]] },
  { name: 'Black',                   anchors: [[0, 0, 0], [30, 30, 30], [50, 50, 50]] },
];

/**
 * Euclidean distance between two RGB triplets.
 */
function colorDistance(r1, g1, b1, r2, g2, b2) {
  return Math.sqrt(
    (r1 - r2) ** 2 +
    (g1 - g2) ** 2 +
    (b1 - b2) ** 2
  );
}

/**
 * Convert an [r, g, b] triplet to the nearest label in FIXED_PALETTE.
 * Returns "" if the color is white/near-white (no meaningful fill).
 *
 * Tolerant shade matching: finds the palette entry whose closest anchor
 * has the minimum Euclidean distance to the sampled color.
 */
function rgbToLabel(r, g, b) {
  // Near-white → treat as no fill (threshold: all channels > 230)
  if (r > 230 && g > 230 && b > 230) return '';

  // Very dark near-black → Black
  if (r < 50 && g < 50 && b < 50) return 'Black';

  let bestLabel = '';
  let bestDist = Infinity;

  for (const entry of FIXED_PALETTE) {
    for (const [ar, ag, ab] of entry?.anchors) {
      const dist = colorDistance(r, g, b, ar, ag, ab);
      if (dist < bestDist) {
        bestDist = dist;
        bestLabel = entry?.name;
      }
    }
  }

  // If the nearest match is very far away (likely a near-white/grey we missed),
  // apply a secondary check: if saturation is very low and brightness is high,
  // treat as no fill.
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const saturation = max === 0 ? 0 : ((max - min) / max) * 100;
  const brightness = (r + g + b) / 3;

  if (saturation < 12 && brightness > 180) return '';

  return bestLabel;
}

// ---------------------------------------------------------------------------
// Canvas sampling
// ---------------------------------------------------------------------------

/**
 * Sample the dominant background color from a rectangular region of a canvas.
 * Samples a grid of pixels from the interior 60% of the cell to avoid borders.
 * Returns [r, g, b] as the median of sampled pixels.
 */
function sampleRegion(ctx, x, y, w, h) {
  if (w <= 0 || h <= 0) return null;

  // Shrink inward by 20% on each side to avoid borders and text edges
  const insetX = Math.max(2, Math.floor(w * 0.2));
  const insetY = Math.max(2, Math.floor(h * 0.2));
  const sx = Math.floor(x + insetX);
  const sy = Math.floor(y + insetY);
  const sw = Math.max(1, Math.floor(w - insetX * 2));
  const sh = Math.max(1, Math.floor(h - insetY * 2));

  let imageData;
  try {
    imageData = ctx?.getImageData(sx, sy, sw, sh);
  } catch (_) {
    return null;
  }

  const data = imageData?.data;
  if (!data?.length) return null;

  // Collect all pixel colors
  const reds = [];
  const greens = [];
  const blues = [];

  for (let i = 0; i < data?.length; i += 4) {
    const a = data?.[i + 3];
    if (a < 128) continue; // skip transparent
    reds?.push(data?.[i]);
    greens?.push(data?.[i + 1]);
    blues?.push(data?.[i + 2]);
  }

  if (reds?.length === 0) return null;

  // Use median to be robust against text pixels
  reds?.sort((a, b) => a - b);
  greens?.sort((a, b) => a - b);
  blues?.sort((a, b) => a - b);
  const mid = Math.floor(reds?.length / 2);

  return [reds?.[mid], greens?.[mid], blues?.[mid]];
}

// ---------------------------------------------------------------------------
// PDF rendering via pdf.js (loaded from CDN if not already present)
// ---------------------------------------------------------------------------

let pdfJsLoadPromise = null;

async function ensurePdfJs() {
  if (window.pdfjsLib) return window.pdfjsLib;
  if (pdfJsLoadPromise) return pdfJsLoadPromise;

  pdfJsLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.onload = () => {
      if (window.pdfjsLib) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        resolve(window.pdfjsLib);
      } else {
        reject(new Error('pdf.js failed to load'));
      }
    };
    script.onerror = () => reject(new Error('Failed to load pdf.js'));
    document.head.appendChild(script);
  });

  return pdfJsLoadPromise;
}

/**
 * Render a specific page of a PDF file to an off-screen canvas.
 * Returns { canvas, viewport } or null on failure.
 */
async function renderPdfPage(file, pageNumber, scale = 2.0) {
  try {
    const pdfjsLib = await ensurePdfJs();
    const arrayBuffer = await file?.arrayBuffer();
    const pdf = await pdfjsLib?.getDocument({ data: new Uint8Array(arrayBuffer) })?.promise;
    if (pageNumber > pdf?.numPages) return null;
    const page = await pdf?.getPage(pageNumber);
    const viewport = page?.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport?.width);
    canvas.height = Math.floor(viewport?.height);
    const ctx = canvas?.getContext('2d');
    // Fill white background first
    ctx.fillStyle = '#ffffff';
    ctx?.fillRect(0, 0, canvas?.width, canvas?.height);
    await page?.render({ canvasContext: ctx, viewport })?.promise;
    return { canvas, viewport, page };
  } catch (err) {
    console.warn('[cellColorDetection] PDF render failed:', err?.message);
    return null;
  }
}

/**
 * Render an image file to an off-screen canvas.
 * Returns { canvas } or null on failure.
 */
async function renderImageFile(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      resolve({ canvas });
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

// ---------------------------------------------------------------------------
// Coordinate conversion
// ---------------------------------------------------------------------------

/**
 * Azure polygon coordinates are in the document's unit space (inches by default).
 * Convert to canvas pixels given the canvas dimensions and page dimensions.
 *
 * polygon: [x0,y0, x1,y1, x2,y2, x3,y3] (8 values, clockwise from top-left)
 * pageWidth/pageHeight: Azure page dimensions in the same unit
 * canvasWidth/canvasHeight: rendered canvas pixel dimensions
 */
function polygonToCanvasRect(polygon, pageWidth, pageHeight, canvasWidth, canvasHeight) {
  if (!polygon || polygon?.length < 8 || !pageWidth || !pageHeight) return null;

  const xs = [polygon?.[0], polygon?.[2], polygon?.[4], polygon?.[6]];
  const ys = [polygon?.[1], polygon?.[3], polygon?.[5], polygon?.[7]];

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const scaleX = canvasWidth / pageWidth;
  const scaleY = canvasHeight / pageHeight;

  return {
    x: minX * scaleX,
    y: minY * scaleY,
    w: (maxX - minX) * scaleX,
    h: (maxY - minY) * scaleY,
  };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Extract cell fill colors for all tables in an Azure parse result.
 *
 * @param {File} file - The original uploaded file (PDF or image)
 * @param {Object} azureResult - Normalized result from parseDocumentWithAzure
 *   Expected shape: { tables: [{ id, rows, cellRegions, rowCount, columnCount }], pages: [{ pageNumber, width, height }] }
 *
 * @returns {Promise<Object>} colorMap:
 *   { [tableId]: { [rowIndex]: { [colIndex]: "Red"|"Yellow"|...|"" } } }
 */
export async function extractCellColors(file, azureResult) {
  const colorMap = {};

  if (!file || !azureResult?.tables?.length) return colorMap;

  const ext = file?.name?.split('.')?.pop()?.toLowerCase();
  const isPdf = ext === 'pdf' || file?.type === 'application/pdf';

  // Cache rendered canvases by page number
  const pageCanvases = {};

  const getCanvas = async (pageNumber) => {
    if (pageCanvases?.[pageNumber]) return pageCanvases?.[pageNumber];

    let result = null;
    if (isPdf) {
      result = await renderPdfPage(file, pageNumber, 2.0);
    } else {
      // For images, all "pages" map to the same canvas
      result = await renderImageFile(file);
    }
    if (result) pageCanvases[pageNumber] = result;
    return result;
  };

  // Build a lookup for page dimensions from Azure
  const pageDimensions = {};
  for (const p of azureResult?.pages || []) {
    pageDimensions[p.pageNumber] = { width: p?.width, height: p?.height, unit: p?.unit };
  }

  for (const table of azureResult?.tables || []) {
    const tableColors = {};
    const cellRegions = table?.cellRegions;

    if (!cellRegions) {
      colorMap[table.id] = tableColors;
      continue;
    }

    for (let rIdx = 0; rIdx < table?.rowCount; rIdx++) {
      tableColors[rIdx] = {};
      for (let cIdx = 0; cIdx < table?.columnCount; cIdx++) {
        const region = cellRegions?.[rIdx]?.[cIdx];
        if (!region?.polygon?.length) {
          tableColors[rIdx][cIdx] = '';
          continue;
        }

        const pageNum = region?.pageNumber || 1;
        const rendered = await getCanvas(pageNum);
        if (!rendered) {
          tableColors[rIdx][cIdx] = '';
          continue;
        }

        const { canvas } = rendered;
        const ctx = canvas?.getContext('2d');

        // Get page dimensions for coordinate conversion
        const pageDim = pageDimensions?.[pageNum];
        let pageW = pageDim?.width || 0;
        let pageH = pageDim?.height || 0;

        // If Azure returns dimensions in inches, convert to points (72 dpi)
        // pdf.js renders at 72 dpi × scale, so we need to match
        // Actually we just need the ratio: canvasPixels / azureUnits
        // For PDF at scale=2.0: canvas pixels = azureInches * 72 * 2
        // So pageWidth in "canvas pixels" = pageW * 72 * 2
        // But we can just use the canvas dimensions directly if we know the page size
        // The simplest approach: use canvas.width/canvas.height as the full page render,
        // and pageW/pageH as the Azure coordinate space.

        if (!pageW || !pageH) {
          // Fallback: assume standard A4 in inches
          pageW = 8.27;
          pageH = 11.69;
        }

        const rect = polygonToCanvasRect(
          region?.polygon,
          pageW,
          pageH,
          canvas?.width,
          canvas?.height
        );

        if (!rect) {
          tableColors[rIdx][cIdx] = '';
          continue;
        }

        const rgb = sampleRegion(ctx, rect?.x, rect?.y, rect?.w, rect?.h);
        if (!rgb) {
          tableColors[rIdx][cIdx] = '';
          continue;
        }

        const label = rgbToLabel(rgb?.[0], rgb?.[1], rgb?.[2]);
        tableColors[rIdx][cIdx] = label;
      }
    }

    colorMap[table.id] = tableColors;
  }

  return colorMap;
}

/**
 * Given a colorMap and a table's state, find the dominant color label for a
 * specific column across all data rows. Used to auto-suggest a colour value.
 *
 * @param {Object} colorMap - Output of extractCellColors
 * @param {string} tableId
 * @param {number} colIndex
 * @param {Object} rowTypes - { [rowIndex]: 'data'|'header'|'group'|'ignore' }
 * @returns {string} Most common non-empty color label, or ""
 */
export function getDominantColumnColor(colorMap, tableId, colIndex, rowTypes) {
  const tableColors = colorMap?.[tableId];
  if (!tableColors) return '';

  const counts = {};
  for (const [rIdx, rowColors] of Object.entries(tableColors)) {
    const rowType = rowTypes?.[rIdx] || 'data';
    if (rowType !== 'data') continue;
    const label = rowColors?.[colIndex];
    if (label) counts[label] = (counts?.[label] || 0) + 1;
  }

  let best = '';
  let bestCount = 0;
  for (const [label, count] of Object.entries(counts)) {
    if (count > bestCount) { best = label; bestCount = count; }
  }
  return best;
}

/**
 * Check if a column header suggests it is a "Colour" column.
 */
export function isColourColumn(header) {
  if (!header) return false;
  const lower = header?.toLowerCase()?.trim();
  return ['colour', 'color', 'fill', 'highlight', 'status color', 'status colour']?.some((kw) => lower?.includes(kw));
}
