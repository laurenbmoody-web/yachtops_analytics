// Cargo Accounts — find the sheet of paper in a photo, so the receipt scanner can
// place its corners itself instead of asking the crew to drag them.
//
// A till receipt is the brightest, least colourful thing in the frame (white paper on
// a table, a worktop, a deck). That's enough to segment it without a CV library:
//
//   1. Downscale — detection doesn't need megapixels, and small is fast.
//   2. Score each pixel for "paperness": bright AND desaturated. A wooden table is
//      bright but strongly coloured, so saturation is what separates them.
//   3. Threshold with Otsu's method (picks the split point from the histogram, so it
//      adapts to the lighting instead of using a fixed number).
//   4. Take the largest connected blob — the paper, not specular highlights.
//   5. Corners from the blob's extremes: a rotated rectangle's corners are the pixels
//      that minimise/maximise (x + y) and (x − y).
//
// Pure functions over plain {data,width,height} so they can be tested without a canvas.

const OTSU_BINS = 64;

// Bright and desaturated → likely paper. 0..255.
export const papernessMap = ({ data, width, height }) => {
  const out = new Uint8Array(width * height);
  for (let i = 0, p = 0; p < out.length; p += 1, i += 4) {
    const r = data[i]; const g = data[i + 1]; const b = data[i + 2];
    const max = Math.max(r, g, b); const min = Math.min(r, g, b);
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const sat = max === 0 ? 0 : (max - min) / max;      // 0 = grey, 1 = vivid
    out[p] = Math.max(0, Math.min(255, lum * (1 - sat * 0.85)));
  }
  return out;
};

// Otsu: the threshold that best separates the histogram into two groups. Returns the
// MIDPOINT between the two class means rather than the winning bin's edge — the edge
// sits inside the darker group, which let a bright wooden table creep in as "paper".
// Infinity when there is only one population (nothing to separate).
export const otsuThreshold = (scores) => {
  const hist = new Array(OTSU_BINS).fill(0);
  for (let i = 0; i < scores.length; i += 1) hist[Math.min(OTSU_BINS - 1, (scores[i] * OTSU_BINS) >> 8)] += 1;
  const total = scores.length;
  if (!total) return Infinity;
  let sum = 0;
  for (let b = 0; b < OTSU_BINS; b += 1) sum += b * hist[b];
  let wB = 0; let sumB = 0; let bestVar = -1; let bestMeans = null;
  for (let b = 0; b < OTSU_BINS; b += 1) {
    wB += hist[b];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;                       // ran out of the second group
    sumB += b * hist[b];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > bestVar) { bestVar = between; bestMeans = [mB, mF]; }
  }
  if (!bestMeans) return Infinity;         // single population — no document to find
  const binWidth = 256 / OTSU_BINS;
  return ((bestMeans[0] + bestMeans[1]) / 2) * binWidth;
};

// Largest 4-connected blob of pixels at or above `threshold`.
// Returns { pixels: count, mark: Uint8Array } where mark flags the winning blob.
export const largestBlob = (scores, width, height, threshold) => {
  const seen = new Uint8Array(scores.length);
  const mark = new Uint8Array(scores.length);
  const stack = new Int32Array(scores.length);
  let bestCount = 0;
  let bestSeed = -1;
  const runs = [];

  for (let start = 0; start < scores.length; start += 1) {
    if (seen[start] || scores[start] < threshold) continue;
    let sp = 0; stack[sp++] = start; seen[start] = 1;
    let count = 0;
    const members = [];
    while (sp > 0) {
      const p = stack[--sp];
      count += 1; members.push(p);
      const x = p % width; const y = (p - x) / width;
      if (x > 0) { const n = p - 1; if (!seen[n] && scores[n] >= threshold) { seen[n] = 1; stack[sp++] = n; } }
      if (x < width - 1) { const n = p + 1; if (!seen[n] && scores[n] >= threshold) { seen[n] = 1; stack[sp++] = n; } }
      if (y > 0) { const n = p - width; if (!seen[n] && scores[n] >= threshold) { seen[n] = 1; stack[sp++] = n; } }
      if (y < height - 1) { const n = p + width; if (!seen[n] && scores[n] >= threshold) { seen[n] = 1; stack[sp++] = n; } }
    }
    runs.push({ count, members });
    if (count > bestCount) { bestCount = count; bestSeed = runs.length - 1; }
  }
  if (bestSeed < 0) return { pixels: 0, mark };
  runs[bestSeed].members.forEach((p) => { mark[p] = 1; });
  return { pixels: bestCount, mark };
};

// Corners of a (possibly rotated) rectangle from the blob's extreme points.
export const quadFromBlob = (mark, width, height) => {
  let tl = null; let tr = null; let br = null; let bl = null;
  let minSum = Infinity; let maxSum = -Infinity;
  let minDif = Infinity; let maxDif = -Infinity;
  for (let p = 0; p < mark.length; p += 1) {
    if (!mark[p]) continue;
    const x = p % width; const y = (p - x) / width;
    const sum = x + y; const dif = x - y;
    if (sum < minSum) { minSum = sum; tl = { x, y }; }
    if (sum > maxSum) { maxSum = sum; br = { x, y }; }
    if (dif > maxDif) { maxDif = dif; tr = { x, y }; }
    if (dif < minDif) { minDif = dif; bl = { x, y }; }
  }
  if (!tl || !tr || !br || !bl) return null;
  return [tl, tr, br, bl];
};

// The full pass. `minAreaFraction` guards against latching onto a small highlight.
// Returns corners in the coordinate space of the image you passed in, or null.
export const detectQuad = (image, { minAreaFraction = 0.04 } = {}) => {
  if (!image?.data || !image.width || !image.height) return null;
  const scores = papernessMap(image);
  const threshold = otsuThreshold(scores);
  if (!Number.isFinite(threshold)) return null;
  const area = image.width * image.height;
  const { pixels, mark } = largestBlob(scores, image.width, image.height, threshold);
  if (!pixels || pixels < area * minAreaFraction) return null;
  // Covering nearly the whole frame means nothing distinct was found — better to ask
  // the crew to place the corners than to "detect" the entire photo.
  if (pixels > area * 0.92) return null;
  const quad = quadFromBlob(mark, image.width, image.height);
  if (!quad) return null;
  // A degenerate quad (a thin sliver, or nearly a point) is worse than no guess.
  const w = Math.hypot(quad[1].x - quad[0].x, quad[1].y - quad[0].y);
  const h = Math.hypot(quad[3].x - quad[0].x, quad[3].y - quad[0].y);
  if (w < image.width * 0.08 || h < image.height * 0.08) return null;
  return quad;
};

// Scale a detected quad from the detection image up to the full-resolution capture.
export const scaleQuad = (quad, fromW, fromH, toW, toH) => {
  const sx = toW / fromW; const sy = toH / fromH;
  return (quad || []).map((p) => ({ x: p.x * sx, y: p.y * sy }));
};

// Nudge the corners outward a little: the threshold tends to bite inside the paper
// edge, and clipping a receipt's edge can cut a digit off the total.
export const expandQuad = (quad, w, h, px = 6) => {
  if (!quad) return quad;
  const cx = quad.reduce((a, p) => a + p.x, 0) / quad.length;
  const cy = quad.reduce((a, p) => a + p.y, 0) / quad.length;
  return quad.map((p) => {
    const dx = p.x - cx; const dy = p.y - cy;
    const len = Math.hypot(dx, dy) || 1;
    return {
      x: Math.max(0, Math.min(w, p.x + (dx / len) * px)),
      y: Math.max(0, Math.min(h, p.y + (dy / len) * px)),
    };
  });
};
