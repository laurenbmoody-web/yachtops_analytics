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
  const hardMax = (opts.maxAreaFrac ?? 0.4) * N; // safety only — the outside is dropped by rank

  const wall0 = new Uint8Array(N);
  for (let i = 0; i < N; i += 1) if (lum(d, i * 4) < wallLum) wall0[i] = 1;
  const wall = dilate(wall0, W, H, iters);

  const label = new Int32Array(N); // 0 = wall / unlabelled
  const stack = [];
  const cands = []; // regions >= minArea
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
    if (area >= minArea) cands.push({ id, area, minx, miny, maxx, maxy });
  }
  // The single biggest region is the outside-the-hull space — drop just that (and
  // any second giant past the safety cap). Everything else, however large, is a
  // real room (a big engine room must survive).
  let outsideId = -1;
  let outsideArea = -1;
  for (const c of cands) if (c.area > outsideArea) { outsideArea = c.area; outsideId = c.id; }
  const regionById = new Map();
  for (const c of cands) {
    if (c.id === outsideId) continue;
    if (c.area > hardMax) continue;
    regionById.set(c.id, c);
  }

  // Mean floor colour per kept region, in one O(N) pass, so each region can be
  // classified as exterior teak vs interior. On a yacht the higher decks are
  // mostly open deck: warm teak planking around the perimeter is exterior space,
  // not a room. We flag those so the caller can skip auto-outlining them.
  const sumR = new Float64Array(id + 1);
  const sumG = new Float64Array(id + 1);
  const sumB = new Float64Array(id + 1);
  const cnt = new Float64Array(id + 1);
  for (let i = 0; i < N; i += 1) {
    const l = label[i];
    if (!l || !regionById.has(l)) continue;
    const o = i * 4;
    sumR[l] += d[o]; sumG[l] += d[o + 1]; sumB[l] += d[o + 2]; cnt[l] += 1;
  }
  regionById.forEach((c) => {
    const n = cnt[c.id] || 1;
    c.r = sumR[c.id] / n; c.g = sumG[c.id] / n; c.b = sumB[c.id] / n;
    c.exterior = isTeak(c.r, c.g, c.b);
  });
  // Furniture-on-deck pass: a sun-lounger, table or hot tub drawn on the open
  // deck encloses a small light region that isn't teak itself but is RINGED by
  // teak. Those aren't rooms — flag any small region whose immediate surround is
  // mostly teak as exterior too, so it's skipped like the deck around it.
  const smallFrac = opts.furnitureFrac ?? 0.02;
  regionById.forEach((c) => {
    if (c.exterior || c.area > smallFrac * N) return;
    const pad = 4;
    const minx = Math.max(0, c.minx - pad);
    const miny = Math.max(0, c.miny - pad);
    const maxx = Math.min(W - 1, c.maxx + pad);
    const maxy = Math.min(H - 1, c.maxy + pad);
    let teak = 0;
    let tot = 0;
    for (let y = miny; y <= maxy; y += 1) {
      for (let x = minx; x <= maxx; x += 1) {
        const i = y * W + x;
        if (label[i] === c.id) continue;      // inside the region itself
        const o = i * 4;
        if (lum(d, o) < wallLum) continue;     // skip the dark line-work
        tot += 1;
        if (isTeak(d[o], d[o + 1], d[o + 2])) teak += 1;
      }
    }
    if (tot > 0 && teak / tot > 0.5) c.exterior = true;
  });
  return { W, H, label, regionById };
}

// Warm brown planking test. Teak reads as a saturated tan (R ≥ G ≥ B, mid
// brightness, distinctly warm), unlike interior floors which render light,
// cool, or near-grey. Only the warmth-relative-to-brightness ratio separates
// teak from a pale beige carpet, so we gate on that rather than raw R−B.
export function isTeak(r, g, b) {
  const bright = (r + g + b) / 3;
  const warm = r - b;
  return bright < 200 && warm > 30 && warm / Math.max(1, bright) > 0.2 && r >= g && g >= b - 6;
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

// Simplified outline of a LOCAL bw×bh mask → nodes normalized to the full image
// (offX/offY is the mask's top-left in image pixels). Rooms are simple shapes,
// so simplify hard, escalating if a contour is still busy.
function contourLocalMask(m, bw, bh, offX, offY, W, H, eps) {
  if (bw < 3 || bh < 3) return null;
  fillHoles(m, bw, bh);
  const contour = mooreBoundary(m, bw, bh);
  if (!contour || contour.length < 4) return null;
  const diag = Math.hypot(bw, bh);
  const base = eps ?? 0.022;
  let simp = rdpClosed(contour, Math.max(2, diag * base));
  if (simp.length > 24) simp = rdpClosed(contour, Math.max(3, diag * base * 2));
  if (simp.length > 40) simp = rdpClosed(contour, Math.max(4, diag * base * 3.5));
  if (simp.length < 3) return null;
  return simp.map((p) => ({ x: (offX + p.x) / W, y: (offY + p.y) / H }));
}

// Simplified outline of a full-image mask over a bbox window. Normalized 0..1.
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
  return contourLocalMask(m, bw, bh, minx, miny, W, H, eps);
}

// Split ONE region among several room seeds — for rooms with a thin/undrawn wall
// or wide doorway that flooded together into one region. A multi-source BFS from
// the seeds assigns every pixel to its nearest seed (through the floor), so the
// dividing line falls at the narrow chokepoint between them (where the missing
// wall would be), while real walls still hold. Returns per-seed outline (or null).
export function splitRegionBySeeds(seg, region, seeds, opts = {}) {
  const { W, H, label } = seg;
  const { id, minx, miny, maxx, maxy } = region;
  const bw = maxx - minx + 1;
  const bh = maxy - miny + 1;
  const inRegion = (lx, ly) => label[(miny + ly) * W + (minx + lx)] === id;
  const basin = new Int32Array(bw * bh).fill(-1);
  const q = [];
  let head = 0;
  seeds.forEach((s, si) => {
    let lx = Math.max(0, Math.min(bw - 1, Math.round(s.x * W) - minx));
    let ly = Math.max(0, Math.min(bh - 1, Math.round(s.y * H) - miny));
    if (!inRegion(lx, ly)) {
      let found = false;
      for (let r = 1; r < Math.max(bw, bh) && !found; r += 1) {
        for (let dy = -r; dy <= r && !found; dy += 1) {
          for (let dx = -r; dx <= r && !found; dx += 1) {
            const nx = lx + dx;
            const ny = ly + dy;
            if (nx >= 0 && ny >= 0 && nx < bw && ny < bh && inRegion(nx, ny)) { lx = nx; ly = ny; found = true; }
          }
        }
      }
      if (!found) return;
    }
    const idx = ly * bw + lx;
    if (basin[idx] === -1) { basin[idx] = si; q.push(idx); }
  });
  while (head < q.length) {
    const p = q[head];
    head += 1;
    const si = basin[p];
    const lx = p % bw;
    const ly = (p / bw) | 0;
    if (lx > 0 && basin[p - 1] === -1 && inRegion(lx - 1, ly)) { basin[p - 1] = si; q.push(p - 1); }
    if (lx < bw - 1 && basin[p + 1] === -1 && inRegion(lx + 1, ly)) { basin[p + 1] = si; q.push(p + 1); }
    if (ly > 0 && basin[p - bw] === -1 && inRegion(lx, ly - 1)) { basin[p - bw] = si; q.push(p - bw); }
    if (ly < bh - 1 && basin[p + bw] === -1 && inRegion(lx, ly + 1)) { basin[p + bw] = si; q.push(p + bw); }
  }
  return seeds.map((s, si) => {
    let sminx = bw;
    let sminy = bh;
    let smaxx = -1;
    let smaxy = -1;
    for (let ly = 0; ly < bh; ly += 1) {
      for (let lx = 0; lx < bw; lx += 1) {
        if (basin[ly * bw + lx] === si) {
          if (lx < sminx) sminx = lx;
          if (lx > smaxx) smaxx = lx;
          if (ly < sminy) sminy = ly;
          if (ly > smaxy) smaxy = ly;
        }
      }
    }
    if (smaxx < 0) return null;
    const sbw = smaxx - sminx + 1;
    const sbh = smaxy - sminy + 1;
    const sm = new Uint8Array(sbw * sbh);
    for (let ly = 0; ly < sbh; ly += 1) {
      for (let lx = 0; lx < sbw; lx += 1) {
        if (basin[(sminy + ly) * bw + (sminx + lx)] === si) sm[ly * sbw + lx] = 1;
      }
    }
    return contourLocalMask(sm, sbw, sbh, minx + sminx, miny + sminy, W, H, opts.eps);
  });
}

// A single region's outline (no satellites) → simplified nodes 0..1, or null.
// The floor region sits INSIDE the thickened (doorway-sealed) walls, so its raw
// boundary is inset ~`grow` px from the true wall. We grow the mask back by that
// much before tracing, so the outline lands ON the wall — matching a hand trace.
export function regionContour(seg, region, opts = {}) {
  const { W, H, label } = seg;
  const grow = opts.grow ?? 2;
  const pad = grow + 1;
  const minx = Math.max(0, region.minx - pad);
  const miny = Math.max(0, region.miny - pad);
  const maxx = Math.min(W - 1, region.maxx + pad);
  const maxy = Math.min(H - 1, region.maxy + pad);
  const bw = maxx - minx + 1;
  const bh = maxy - miny + 1;
  let m = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y += 1) {
    for (let x = 0; x < bw; x += 1) {
      if (label[(miny + y) * W + (minx + x)] === region.id) m[y * bw + x] = 1;
    }
  }
  if (grow > 0) m = dilate(m, bw, bh, grow);
  return contourLocalMask(m, bw, bh, minx, miny, W, H, opts.eps);
}

// Trace the boundary of a SAM (or any binary) mask → simplified nodes 0..1.
// SAM returns a white-on-black mask of the room at the prompt point; we keep its
// largest blob (dropping stray specks), fill interior holes, and contour it with
// the same simplify pipeline as a segmented region, so a SAM outline is a drop-in
// for a flood-fill one.
export function maskToNodes(imageData, opts = {}) {
  const W = imageData.width;
  const H = imageData.height;
  const d = imageData.data;
  const N = W * H;
  const thr = opts.threshold ?? 128;
  const fg = new Uint8Array(N);
  for (let i = 0; i < N; i += 1) {
    const o = i * 4;
    if ((d[o] + d[o + 1] + d[o + 2]) / 3 > thr) fg[i] = 1;
  }
  // Largest connected foreground blob + its bbox.
  const seen = new Uint8Array(N);
  const stack = [];
  let best = null;
  for (let s = 0; s < N; s += 1) {
    if (!fg[s] || seen[s]) continue;
    seen[s] = 1;
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
      if (x > 0 && fg[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack.push(p - 1); }
      if (x < W - 1 && fg[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack.push(p + 1); }
      if (y > 0 && fg[p - W] && !seen[p - W]) { seen[p - W] = 1; stack.push(p - W); }
      if (y < H - 1 && fg[p + W] && !seen[p + W]) { seen[p + W] = 1; stack.push(p + W); }
    }
    if (!best || area > best.area) best = { area, minx, miny, maxx, maxy, label: s };
  }
  if (!best) return null;
  const bw = best.maxx - best.minx + 1;
  const bh = best.maxy - best.miny + 1;
  const m = new Uint8Array(bw * bh);
  // Re-flood the chosen blob into a local mask (seen was reused, so redo from fg
  // over the bbox — the blob is the fg pixels connected to best.label).
  for (let y = 0; y < bh; y += 1) {
    for (let x = 0; x < bw; x += 1) {
      if (fg[(best.miny + y) * W + (best.minx + x)]) m[y * bw + x] = 1;
    }
  }
  return contourLocalMask(m, bw, bh, best.minx, best.miny, W, H, opts.eps);
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
  return maskContour(bridged, W, H, bbox, opts.eps);
}
