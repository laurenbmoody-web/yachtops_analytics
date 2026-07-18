// Deck-plan room segmentation — the accurate auto-trace.
//
// Instead of tracing each room from a (loose) AI seed, we segment the WHOLE deck
// into its enclosed wall-regions once, then hang each AI-read name onto whichever
// region contains its seed. The outline is then the region's true wall boundary,
// so it's accurate by construction and tolerant of an imprecise seed.
//
// Pipeline (all pure JS on the deck-crop ImageData):
//   1. wall mask   — dark line-work (luminance < wallLum)
//   2. dilate      — thicken walls a few px to seal doorway gaps so adjoining
//                    rooms separate into distinct regions
//   3. label       — connected components of the floor (non-wall)
//   4. keep        — regions between minArea and maxArea (drops the giant
//                    outside-hull region and tiny furniture nooks)
//   5. per room    — regionAt(seed) → fill holes → boundary → simplify
import { lum, mooreBoundary, rdpClosed } from './deckTrace';

// 4-neighbour binary dilation, `iters` passes, in place-ish (returns new mask).
function dilate(mask, W, H, iters) {
  let cur = mask;
  for (let k = 0; k < iters; k += 1) {
    const next = cur.slice();
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const i = y * W + x;
        if (cur[i]) continue;
        if ((x > 0 && cur[i - 1]) || (x < W - 1 && cur[i + 1]) || (y > 0 && cur[i - W]) || (y < H - 1 && cur[i + W])) next[i] = 1;
      }
    }
    cur = next;
  }
  return cur;
}

// Segment the deck image into usable room-regions. Returns the label map + the
// region records that are plausibly rooms (by area), keyed by id.
export function segmentDeck(imageData, opts = {}) {
  const W = imageData.width;
  const H = imageData.height;
  const d = imageData.data;
  const N = W * H;
  const wallLum = opts.wallLum ?? 150;
  const iters = opts.dilate ?? 2;
  const minArea = (opts.minAreaFrac ?? 0.0006) * N;
  const maxArea = (opts.maxAreaFrac ?? 0.15) * N;

  const wall0 = new Uint8Array(N);
  for (let i = 0; i < N; i += 1) if (lum(d, i * 4) < wallLum) wall0[i] = 1;
  const wall = dilate(wall0, W, H, iters);

  const label = new Int32Array(N); // 0 = wall / unlabelled
  const stack = [];
  const regionById = new Map();
  let id = 0;
  for (let s = 0; s < N; s += 1) {
    if (wall[s] || label[s]) continue;
    id += 1;
    label[s] = id;
    stack.length = 0;
    stack.push(s);
    let area = 0;
    let minx = W;
    let miny = H;
    let maxx = 0;
    let maxy = 0;
    while (stack.length) {
      const p = stack.pop();
      area += 1;
      const x = p % W;
      const y = (p / W) | 0;
      if (x < minx) minx = x;
      if (x > maxx) maxx = x;
      if (y < miny) miny = y;
      if (y > maxy) maxy = y;
      if (x > 0 && !wall[p - 1] && !label[p - 1]) { label[p - 1] = id; stack.push(p - 1); }
      if (x < W - 1 && !wall[p + 1] && !label[p + 1]) { label[p + 1] = id; stack.push(p + 1); }
      if (y > 0 && !wall[p - W] && !label[p - W]) { label[p - W] = id; stack.push(p - W); }
      if (y < H - 1 && !wall[p + W] && !label[p + W]) { label[p + W] = id; stack.push(p + W); }
    }
    if (area >= minArea && area <= maxArea) regionById.set(id, { id, area, minx, miny, maxx, maxy });
  }
  return { W, H, label, regionById };
}

// The usable region a normalized point falls in, or (if it's on a wall / in the
// outside region) the nearest usable region within a small spiral, else null.
export function regionAtPoint(seg, nx, ny, opts = {}) {
  const { W, H, label, regionById } = seg;
  let x = Math.max(0, Math.min(W - 1, Math.round(nx * W)));
  let y = Math.max(0, Math.min(H - 1, Math.round(ny * H)));
  const hit = regionById.get(label[y * W + x]);
  if (hit) return hit;
  const maxR = opts.maxR ?? Math.round(Math.min(W, H) * 0.05);
  for (let r = 1; r <= maxR; r += 1) {
    for (let dy = -r; dy <= r; dy += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue; // ring only
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const reg = regionById.get(label[yy * W + xx]);
        if (reg) return reg;
      }
    }
  }
  return null;
}

// Fill interior holes (furniture/text) of a region mask so its boundary is the
// room's outer wall, not a hug around every sofa.
function fillHoles(m, bw, bh) {
  const bg = new Uint8Array(bw * bh);
  const st = [];
  const seed = (i) => { if (!m[i] && !bg[i]) { bg[i] = 1; st.push(i); } };
  for (let x = 0; x < bw; x += 1) { seed(x); seed((bh - 1) * bw + x); }
  for (let y = 0; y < bh; y += 1) { seed(y * bw); seed(y * bw + bw - 1); }
  while (st.length) {
    const p = st.pop();
    const x = p % bw;
    const y = (p / bw) | 0;
    if (x > 0) seed(p - 1);
    if (x < bw - 1) seed(p + 1);
    if (y > 0) seed(p - bw);
    if (y < bh - 1) seed(p + bw);
  }
  for (let i = 0; i < bw * bh; i += 1) if (!m[i] && !bg[i]) m[i] = 1;
}

// Simplified outline of an arbitrary mask, over a bbox window. Normalized 0..1.
function maskContour(mask, W, H, bbox, eps) {
  const { minx, miny, maxx, maxy } = bbox;
  const bw = maxx - minx + 1;
  const bh = maxy - miny + 1;
  if (bw < 3 || bh < 3) return null;
  const m = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y += 1) {
    for (let x = 0; x < bw; x += 1) {
      if (mask[(miny + y) * W + (minx + x)]) m[y * bw + x] = 1;
    }
  }
  fillHoles(m, bw, bh);
  const contour = mooreBoundary(m, bw, bh);
  if (!contour || contour.length < 4) return null;
  const diag = Math.hypot(bw, bh);
  const simp = rdpClosed(contour, Math.max(2, diag * (eps ?? 0.012)));
  if (simp.length < 3) return null;
  return simp.map((p) => ({ x: (minx + p.x) / W, y: (miny + p.y) / H }));
}

// A single region's outline (no satellites) → simplified nodes 0..1, or null.
export function regionContour(seg, region, opts = {}) {
  const bbox = { minx: region.minx, miny: region.miny, maxx: region.maxx, maxy: region.maxy };
  const { W, H, label } = seg;
  const mask = new Uint8Array(W * H);
  for (let y = region.miny; y <= region.maxy; y += 1) {
    for (let x = region.minx; x <= region.maxx; x += 1) {
      const i = y * W + x;
      if (label[i] === region.id) mask[i] = 1;
    }
  }
  return maskContour(mask, W, H, bbox, opts.eps ?? 0.012);
}

// A room's outline: the seed's region PLUS its small satellite sub-regions
// (ensuite / wardrobe / WC, each cut off by one thin internal wall), so a cabin
// comes out whole rather than as just its bed area. A satellite is absorbed only
// if it's small relative to the main region and mostly within reach of it — big
// neighbours (other cabins) and the corridor are never absorbed. `claimed` is the
// set of every room's own region id, so one room never eats another's.
export function roomOutline(seg, region, claimed, opts = {}) {
  const { W, H, label, regionById } = seg;
  const N = W * H;
  const segDil = opts.segDilate ?? 2;
  const main = new Uint8Array(N);
  for (let i = 0; i < N; i += 1) if (label[i] === region.id) main[i] = 1;
  const grown = dilate(main, W, H, 2 * segDil + 1);
  const union = main.slice();
  let minx = region.minx;
  let miny = region.miny;
  let maxx = region.maxx;
  let maxy = region.maxy;
  regionById.forEach((jr, jid) => {
    if (jid === region.id || (claimed && claimed.has(jid))) return;
    if (jr.area >= 0.35 * region.area) return; // only small sub-parts
    let inside = 0;
    for (let y = jr.miny; y <= jr.maxy; y += 1) {
      for (let x = jr.minx; x <= jr.maxx; x += 1) {
        const i = y * W + x;
        if (label[i] === jid && grown[i]) inside += 1;
      }
    }
    if (inside > 0.7 * jr.area) {
      for (let y = jr.miny; y <= jr.maxy; y += 1) {
        for (let x = jr.minx; x <= jr.maxx; x += 1) {
          const i = y * W + x;
          if (label[i] === jid) union[i] = 1;
        }
      }
      if (jr.minx < minx) minx = jr.minx;
      if (jr.maxx > maxx) maxx = jr.maxx;
      if (jr.miny < miny) miny = jr.miny;
      if (jr.maxy > maxy) maxy = jr.maxy;
    }
  });
  const bridged = dilate(union, W, H, segDil); // close the thin internal walls
  const bbox = {
    minx: Math.max(0, minx - segDil - 1),
    miny: Math.max(0, miny - segDil - 1),
    maxx: Math.min(W - 1, maxx + segDil + 1),
    maxy: Math.min(H - 1, maxy + segDil + 1),
  };
  return maskContour(bridged, W, H, bbox, opts.eps ?? 0.012);
}
