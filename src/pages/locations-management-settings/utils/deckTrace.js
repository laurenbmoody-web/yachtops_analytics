// Deck-plan room tracing from pixels — the "real" auto-trace.
//
// A vision model reads the room names and gives, per room, a seed point and a
// rough bounding box. This module turns that into a TRUE outline that follows
// the walls: flood-fill the floor from the seed (bounded by the padded bbox,
// stopping at the drawing's dark wall lines), follow the filled region's
// boundary into an ordered pixel ring (Moore-neighbour tracing), then simplify
// it to clean corners (Douglas–Peucker). Coordinates come in and go out
// normalized 0..1 to the deck-crop image — the same space plan_shape uses.

export const lum = (d, i) => d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;

// 8-neighbours, clockwise from North. Used for boundary following.
const CW = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
const dirIndex = (dx, dy) => CW.findIndex((o) => o[0] === dx && o[1] === dy);

// Moore-neighbour boundary trace of a binary blob → ordered pixel ring.
export function mooreBoundary(mask, W, H) {
  const fg = (x, y) => x >= 0 && y >= 0 && x < W && y < H && mask[y * W + x] === 1;
  let s = null;
  for (let y = 0; y < H && !s; y += 1) {
    for (let x = 0; x < W; x += 1) { if (mask[y * W + x]) { s = { x, y }; break; } }
  }
  if (!s) return null;
  const contour = [{ x: s.x, y: s.y }];
  let p = { x: s.x, y: s.y };
  let b = { x: s.x - 1, y: s.y }; // came from the west (background, first-in-raster guarantees it)
  const maxSteps = W * H * 4;
  for (let steps = 0; steps < maxSteps; steps += 1) {
    let bi = dirIndex(b.x - p.x, b.y - p.y);
    if (bi < 0) bi = 6; // west fallback
    let next = null;
    for (let k = 1; k <= 8; k += 1) {
      const dir = (bi + k) % 8;
      const nx = p.x + CW[dir][0];
      const ny = p.y + CW[dir][1];
      if (fg(nx, ny)) {
        const pdir = (bi + k - 1) % 8; // last background examined = new backtrack
        b = { x: p.x + CW[pdir][0], y: p.y + CW[pdir][1] };
        next = { x: nx, y: ny };
        break;
      }
    }
    if (!next) break; // isolated pixel
    if (next.x === s.x && next.y === s.y) break; // closed the ring
    contour.push(next);
    p = next;
  }
  return contour;
}

// Perpendicular distance from p to segment a→b.
function segDist(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (!l2) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// Douglas–Peucker on an open polyline.
function rdp(pts, eps) {
  if (pts.length < 3) return pts.slice();
  let dmax = 0;
  let idx = 0;
  for (let i = 1; i < pts.length - 1; i += 1) {
    const d = segDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > dmax) { dmax = d; idx = i; }
  }
  if (dmax > eps) {
    const left = rdp(pts.slice(0, idx + 1), eps);
    const right = rdp(pts.slice(idx), eps);
    return left.slice(0, -1).concat(right);
  }
  return [pts[0], pts[pts.length - 1]];
}

// Douglas–Peucker on a CLOSED ring — split at the point farthest from the first,
// simplify each half, rejoin (drops the shared endpoints so the ring stays clean).
export function rdpClosed(ring, eps) {
  if (ring.length < 4) return ring.slice();
  let far = 0;
  let fd = -1;
  for (let i = 1; i < ring.length; i += 1) {
    const d = Math.hypot(ring[i].x - ring[0].x, ring[i].y - ring[0].y);
    if (d > fd) { fd = d; far = i; }
  }
  const a = rdp(ring.slice(0, far + 1), eps);
  const b = rdp(ring.slice(far).concat([ring[0]]), eps);
  return a.slice(0, -1).concat(b.slice(0, -1));
}

// Morphological close (dilate ×r then erode ×r, 4-neighbour) — fills the small
// notches furniture and text punch into the room fill, so the traced outline is
// a clean room shape instead of hugging every sofa.
function morphClose(mask, bw, bh, r) {
  const dilate = (m) => {
    const o = m.slice();
    for (let y = 0; y < bh; y += 1) {
      for (let x = 0; x < bw; x += 1) {
        const i = y * bw + x;
        if (m[i]) continue;
        if ((x > 0 && m[i - 1]) || (x < bw - 1 && m[i + 1]) || (y > 0 && m[i - bw]) || (y < bh - 1 && m[i + bw])) o[i] = 1;
      }
    }
    return o;
  };
  const erode = (m) => {
    const o = m.slice();
    for (let y = 0; y < bh; y += 1) {
      for (let x = 0; x < bw; x += 1) {
        const i = y * bw + x;
        if (!m[i]) continue;
        if (x === 0 || !m[i - 1] || x === bw - 1 || !m[i + 1] || y === 0 || !m[i - bw] || y === bh - 1 || !m[i + bw]) o[i] = 0;
      }
    }
    return o;
  };
  let m = mask;
  for (let k = 0; k < r; k += 1) m = dilate(m);
  for (let k = 0; k < r; k += 1) m = erode(m);
  return m;
}

// Trace one room. Returns nodes [{x,y}] normalized 0..1 to the image, or null if
// the fill failed (caller should fall back to the bbox rectangle).
//   imageData : ImageData of the deck-crop canvas
//   seed      : {x,y} 0..1 — an interior point of the room
//   bbox      : {x,y,w,h} 0..1 — the room's rough box (bounds the fill), optional
export function traceRoom(imageData, seed, bbox, opts = {}) {
  const W = imageData.width;
  const H = imageData.height;
  const data = imageData.data;
  const pad = opts.pad ?? 0.12;

  let bx0;
  let by0;
  let bx1;
  let by1;
  if (bbox && bbox.w > 0 && bbox.h > 0) {
    const px = bbox.w * W * pad;
    const py = bbox.h * H * pad;
    bx0 = Math.max(0, Math.floor(bbox.x * W - px));
    by0 = Math.max(0, Math.floor(bbox.y * H - py));
    bx1 = Math.min(W, Math.ceil((bbox.x + bbox.w) * W + px));
    by1 = Math.min(H, Math.ceil((bbox.y + bbox.h) * H + py));
  } else {
    const s = 0.22;
    bx0 = Math.max(0, Math.floor((seed.x - s) * W));
    by0 = Math.max(0, Math.floor((seed.y - s) * H));
    bx1 = Math.min(W, Math.ceil((seed.x + s) * W));
    by1 = Math.min(H, Math.ceil((seed.y + s) * H));
  }
  const bw = bx1 - bx0;
  const bh = by1 - by0;
  if (bw < 4 || bh < 4) return null;

  // The GA's walls are thin, light-grey lines (~110–150) over a bright floor and
  // heavy mid-tone furniture/shading — no single threshold suits every room. So
  // sweep a few: keep the fill that covers the MOST of the window while still
  // being contained by walls (frac < 0.9 — above that it leaked and filled all).
  const localSeed = { x: (seed.x * W - bx0) / bw, y: (seed.y * H - by0) / bh };
  let best = null;
  for (const wallLum of [125, 140, 150, 160, 175]) {
    const { fill, frac, count } = floodLocal(data, W, bx0, by0, bw, bh, localSeed, wallLum);
    if (!fill || frac >= 0.9 || count < 30) continue;
    if (!best || frac > best.frac) best = { fill, frac };
  }
  if (!best) return null;

  const closed = morphClose(best.fill, bw, bh, opts.close ?? 2);
  const contour = mooreBoundary(closed, bw, bh);
  if (!contour || contour.length < 4) return null;

  const diag = Math.hypot(bw, bh);
  const simp = rdpClosed(contour, Math.max(2, diag * (opts.eps ?? 0.02)));
  if (simp.length < 3) return null;

  return simp.map((p) => ({ x: (bx0 + p.x) / W, y: (by0 + p.y) / H }));
}

// Flood fill using a window-local seed {x,y} in 0..1 of the window.
function floodLocal(data, W, bx0, by0, bw, bh, localSeed, wallLum) {
  const walk = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y += 1) {
    for (let x = 0; x < bw; x += 1) {
      const gi = ((by0 + y) * W + (bx0 + x)) * 4;
      walk[y * bw + x] = lum(data, gi) >= wallLum ? 1 : 0;
    }
  }
  let sx = Math.max(0, Math.min(bw - 1, Math.round(localSeed.x * bw)));
  let sy = Math.max(0, Math.min(bh - 1, Math.round(localSeed.y * bh)));
  if (!walk[sy * bw + sx]) {
    let found = false;
    for (let r = 1; r < 40 && !found; r += 1) {
      for (let dy = -r; dy <= r && !found; dy += 1) {
        for (let dx = -r; dx <= r && !found; dx += 1) {
          const nx = sx + dx;
          const ny = sy + dy;
          if (nx >= 0 && ny >= 0 && nx < bw && ny < bh && walk[ny * bw + nx]) { sx = nx; sy = ny; found = true; }
        }
      }
    }
    if (!found) return { fill: null, frac: 0, count: 0 };
  }
  const fill = new Uint8Array(bw * bh);
  const stack = [sy * bw + sx];
  fill[sy * bw + sx] = 1;
  let count = 0;
  while (stack.length) {
    const idx = stack.pop();
    count += 1;
    const x = idx % bw;
    const y = (idx / bw) | 0;
    if (x > 0 && walk[idx - 1] && !fill[idx - 1]) { fill[idx - 1] = 1; stack.push(idx - 1); }
    if (x < bw - 1 && walk[idx + 1] && !fill[idx + 1]) { fill[idx + 1] = 1; stack.push(idx + 1); }
    if (y > 0 && walk[idx - bw] && !fill[idx - bw]) { fill[idx - bw] = 1; stack.push(idx - bw); }
    if (y < bh - 1 && walk[idx + bw] && !fill[idx + bw]) { fill[idx + bw] = 1; stack.push(idx + bw); }
  }
  return { fill, frac: count / (bw * bh), count };
}

// Reduce a closed ring of {x,y} nodes to fewer corners (Douglas–Peucker). Coords
// are normalized 0..1, so eps is a fraction of the plan. Used by the "Simplify"
// button when an auto-trace came out with too many corners to nudge one by one.
export function simplifyClosed(nodes, eps = 0.012) {
  const pts = (nodes || []).map((n) => ({ x: n.x, y: n.y }));
  if (pts.length < 4) return pts;
  const out = rdpClosed(pts, eps);
  return out.length >= 3 ? out : pts;
}

// Fraction of "ink" pixels (darker than inkLum) inside a normalized bbox of the
// image. Blank paper off the hull is almost pure white → ~0; a real room is full
// of walls/furniture line-work → well above. Used to reject outlines the model
// placed over empty background (floating above/beside the deck).
export function regionInk(imageData, bbox, inkLum = 140) {
  const W = imageData.width;
  const H = imageData.height;
  const d = imageData.data;
  const x0 = Math.max(0, Math.floor(bbox.x * W));
  const y0 = Math.max(0, Math.floor(bbox.y * H));
  const x1 = Math.min(W, Math.ceil((bbox.x + bbox.w) * W));
  const y1 = Math.min(H, Math.ceil((bbox.y + bbox.h) * H));
  if (x1 - x0 < 2 || y1 - y0 < 2) return 0;
  const step = Math.max(1, Math.floor(Math.min(x1 - x0, y1 - y0) / 60));
  let ink = 0;
  let tot = 0;
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      tot += 1;
      if (lum(d, (y * W + x) * 4) < inkLum) ink += 1;
    }
  }
  return tot ? ink / tot : 0;
}

// Fallback outline: the bbox as a rectangle (4 nodes), normalized 0..1.
export function bboxRect(bbox) {
  if (!bbox) return null;
  const { x, y, w, h } = bbox;
  return [
    { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
  ];
}
