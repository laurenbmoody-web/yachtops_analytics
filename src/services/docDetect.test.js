// Cargo Accounts — document-corner detection tests. Run: `node --test`.
// Synthetic images stand in for photos: a bright, desaturated "sheet" on a coloured
// background is exactly the situation the detector has to solve.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  papernessMap, otsuThreshold, largestBlob, quadFromBlob, detectQuad, scaleQuad, expandQuad,
} from './docDetect.js';

// Build an RGBA image with a filled polygon of `paper` over a `bg` field.
const makeImage = (w, h, bg, shapes) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      let [r, g, b] = bg;
      shapes.forEach((s) => { if (s.hit(x, y)) { [r, g, b] = s.color; } });
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }
  return { data, width: w, height: h };
};

const rect = (x0, y0, x1, y1, color) => ({ color, hit: (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1 });

test('paperness rewards bright desaturated pixels over bright colourful ones', () => {
  // White paper vs a bright orange wooden table of similar luminance.
  const img = makeImage(2, 1, [0, 0, 0], [
    { color: [250, 250, 250], hit: (x) => x === 0 },      // paper
    { color: [210, 140, 60], hit: (x) => x === 1 },       // wood
  ]);
  const scores = papernessMap(img);
  assert.ok(scores[0] > scores[1], 'paper should score above wood');
});

test('otsuThreshold lands between two clear populations', () => {
  const scores = new Uint8Array([10, 12, 11, 9, 240, 245, 250, 238]);
  const t = otsuThreshold(scores);
  assert.ok(t > 12 && t < 238, `threshold ${t} should separate the groups`);
});

test('largestBlob picks the big region, not a small bright speck', () => {
  const w = 40; const h = 40;
  const scores = new Uint8Array(w * h);
  // big block
  for (let y = 5; y < 30; y += 1) for (let x = 5; x < 30; x += 1) scores[y * w + x] = 255;
  // tiny speck elsewhere
  scores[38 * w + 38] = 255;
  const { pixels, mark } = largestBlob(scores, w, h, 128);
  assert.equal(pixels, 25 * 25);
  assert.equal(mark[38 * w + 38], 0, 'the speck must not be part of the winning blob');
});

test('quadFromBlob returns the corners of an axis-aligned block', () => {
  const w = 20; const h = 20;
  const mark = new Uint8Array(w * h);
  for (let y = 4; y <= 15; y += 1) for (let x = 3; x <= 16; x += 1) mark[y * w + x] = 1;
  const [tl, tr, br, bl] = quadFromBlob(mark, w, h);
  assert.deepEqual(tl, { x: 3, y: 4 });
  assert.deepEqual(br, { x: 16, y: 15 });
  assert.equal(tr.x, 16); assert.equal(tr.y, 4);
  assert.equal(bl.x, 3); assert.equal(bl.y, 15);
});

test('detectQuad finds a receipt-shaped sheet on a wooden background', () => {
  // Portrait "receipt" on a bright orange "table" — the real situation.
  const img = makeImage(100, 140, [190, 130, 55], [rect(30, 20, 69, 119, [248, 248, 246])]);
  const quad = detectQuad(img);
  assert.ok(quad, 'should find the sheet');
  const [tl, tr, br, bl] = quad;
  assert.ok(Math.abs(tl.x - 30) <= 2 && Math.abs(tl.y - 20) <= 2, `tl ${JSON.stringify(tl)}`);
  assert.ok(Math.abs(br.x - 69) <= 2 && Math.abs(br.y - 119) <= 2, `br ${JSON.stringify(br)}`);
  assert.ok(Math.abs(tr.x - 69) <= 2 && Math.abs(bl.x - 30) <= 2);
});

test('detectQuad gives up rather than guessing when there is no sheet', () => {
  const flat = makeImage(60, 60, [120, 90, 40], []);
  assert.equal(detectQuad(flat), null);
  // A tiny bright dot is below the area floor.
  const speck = makeImage(60, 60, [30, 30, 30], [rect(28, 28, 31, 31, [255, 255, 255])]);
  assert.equal(detectQuad(speck), null);
  assert.equal(detectQuad(null), null);
});

test('detectQuad rejects a sliver that would crop the receipt to nothing', () => {
  // A 2px-wide bright strip: a real blob, but not a document.
  const sliver = makeImage(100, 100, [20, 20, 20], [rect(49, 5, 50, 94, [250, 250, 250])]);
  assert.equal(detectQuad(sliver), null);
});

test('scaleQuad maps detection coordinates onto the full-resolution capture', () => {
  const quad = [{ x: 10, y: 20 }, { x: 90, y: 20 }, { x: 90, y: 120 }, { x: 10, y: 120 }];
  const scaled = scaleQuad(quad, 100, 140, 1000, 1400);
  assert.deepEqual(scaled[0], { x: 100, y: 200 });
  assert.deepEqual(scaled[2], { x: 900, y: 1200 });
});

test('expandQuad pushes corners outward but stays inside the image', () => {
  const quad = [{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 90 }, { x: 10, y: 90 }];
  const out = expandQuad(quad, 100, 100, 5);
  assert.ok(out[0].x < 10 && out[0].y < 10, 'top-left moves up and left');
  assert.ok(out[2].x > 90 && out[2].y > 90, 'bottom-right moves down and right');

  const edge = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  const clamped = expandQuad(edge, 100, 100, 20);
  clamped.forEach((p) => {
    assert.ok(p.x >= 0 && p.x <= 100 && p.y >= 0 && p.y <= 100, 'stays in bounds');
  });
});
