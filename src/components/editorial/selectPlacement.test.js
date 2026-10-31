// EditorialSelect menu placement tests. Run: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeMenu, DEFAULT_MAX, MIN_HEIGHT, GUTTER } from './selectPlacement.js';

// A field near the top of a normal window, with a list that fits under it.
const roomy = {
  triggerTop: 200,
  triggerBottom: 236,
  viewportHeight: 900,
  contentHeight: 180,
};

test('stays down when the list fits below', () => {
  const { up, maxHeight } = placeMenu(roomy);
  assert.equal(up, false);
  assert.equal(maxHeight, 180);
});

test('never asks for more than the cap, however long the list', () => {
  const { maxHeight } = placeMenu({ ...roomy, contentHeight: 4000 });
  assert.equal(maxHeight, DEFAULT_MAX);
});

test('flips up when the field is near the bottom and there is room above', () => {
  // 80px below the field, 700 above it.
  const { up } = placeMenu({
    triggerTop: 700, triggerBottom: 736, viewportHeight: 820, contentHeight: 240,
  });
  assert.equal(up, true);
});

test('flipped up, it is capped by the room above', () => {
  const { up, maxHeight } = placeMenu({
    triggerTop: 180, triggerBottom: 216, viewportHeight: 300, contentHeight: 240,
  });
  assert.equal(up, true);
  assert.equal(maxHeight, 180 - GUTTER); // 168
});

test('does not flip when above is no better than below', () => {
  // Dead centre: 400 each way. Flipping would move the problem and cost the
  // reader their place.
  const { up } = placeMenu({
    triggerTop: 412, triggerBottom: 448, viewportHeight: 860, contentHeight: 600,
  });
  assert.equal(up, false);
});

test('a short list near the bottom still opens downward', () => {
  // 120px below is plenty for a 90px list.
  const { up, maxHeight } = placeMenu({
    triggerTop: 600, triggerBottom: 648, viewportHeight: 780, contentHeight: 90,
  });
  assert.equal(up, false);
  assert.equal(maxHeight, 90);
});

test('never squashes below the usable minimum', () => {
  // A cramped window: 40px below, 60 above. Both are unusable, so it keeps
  // the minimum and overhangs rather than becoming a peephole.
  const { maxHeight } = placeMenu({
    triggerTop: 72, triggerBottom: 120, viewportHeight: 172, contentHeight: 240,
  });
  assert.equal(maxHeight, MIN_HEIGHT);
});

test('treats a field scrolled above the viewport as having no room above', () => {
  const { up, maxHeight } = placeMenu({
    triggerTop: -40, triggerBottom: -4, viewportHeight: 800, contentHeight: 300,
  });
  assert.equal(up, false);
  assert.ok(maxHeight > 0);
});

test('an unmeasured list falls back to the cap rather than collapsing', () => {
  // contentHeight 0 means "not measured yet"; an empty list still draws its
  // no-options line, so 0 must never produce a zero-height panel.
  const { maxHeight } = placeMenu({ ...roomy, contentHeight: 0 });
  assert.equal(maxHeight, DEFAULT_MAX);
});

test('a short list is allowed to be short — the floor guards the room', () => {
  const { maxHeight } = placeMenu({ ...roomy, contentHeight: 44 });
  assert.equal(maxHeight, 44);
  assert.ok(maxHeight < MIN_HEIGHT);
});

test('respects a caller-supplied cap', () => {
  const { maxHeight } = placeMenu({ ...roomy, contentHeight: 900, maxHeight: 200 });
  assert.equal(maxHeight, 200);
});
