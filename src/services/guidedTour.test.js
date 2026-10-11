import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TOUR_STEPS, TOUR_VERSION, visibleSteps,
  tourDoneKey, isTourDone, markTourDone, clearTourDone,
  tipPlacement, tipArrowLeft, stepCounter, stepPercent,
  TIP_MARGIN,
} from './guidedTour.js';

// A stand-in for localStorage that can also be made to throw, which is what a
// private window or blocked site data actually does.
const fakeStore = (opts = {}) => {
  const map = new Map();
  return {
    map,
    getItem: (k) => { if (opts.throwOnGet) throw new Error('denied'); return map.has(k) ? map.get(k) : null; },
    setItem: (k, v) => { if (opts.throwOnSet) throw new Error('denied'); map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
  };
};

// ── The step catalogue ───────────────────────────────────────────────────────

test('every step has what the overlay needs to render it', () => {
  TOUR_STEPS.forEach((s) => {
    assert.ok(s.key, 'step without a key');
    assert.ok(s.target, `${s.key} has no target`);
    assert.ok(s.title, `${s.key} has no title`);
    assert.ok(s.body, `${s.key} has no body`);
    assert.ok(['all', 'admin', 'crew'].includes(s.audience), `${s.key}: ${s.audience}`);
  });
});

test('step keys and targets are unique', () => {
  const keys = TOUR_STEPS.map((s) => s.key);
  const targets = TOUR_STEPS.map((s) => s.target);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(new Set(targets).size, targets.length);
});

test('the tour is short enough that someone will finish it', () => {
  // A new member clicking Next twelve times is a tour nobody completes.
  assert.ok(TOUR_STEPS.length <= 10, `${TOUR_STEPS.length} steps is too many`);
});

// ── visibleSteps ─────────────────────────────────────────────────────────────

test('a step whose target is not on the page is dropped, not shown pointing at nothing', () => {
  // The dashboard is user-arranged: a crew member who removed the Hours of Rest
  // card must not get a tip pulsing over empty canvas.
  const present = new Set(['vessel', 'widget-signInOut', 'search']);
  const steps = visibleSteps(TOUR_STEPS, { exists: (t) => present.has(t) });
  assert.deepEqual(steps.map((s) => s.key), ['vessel', 'signInOut', 'search']);
});

test('the admin setup step is only for admins', () => {
  const all = () => true;
  const asCrew = visibleSteps(TOUR_STEPS, { isAdmin: false, exists: all }).map((s) => s.key);
  const asAdmin = visibleSteps(TOUR_STEPS, { isAdmin: true, exists: all }).map((s) => s.key);
  assert.ok(!asCrew.includes('setup'));
  assert.ok(asAdmin.includes('setup'));
  assert.equal(asAdmin.length, asCrew.length + 1);
});

test('steps keep their catalogue order after filtering', () => {
  const order = TOUR_STEPS.map((s) => s.key);
  const got = visibleSteps(TOUR_STEPS, { isAdmin: true, exists: () => true }).map((s) => s.key);
  assert.deepEqual(got, order);
});

test('no probe means assume everything is there', () => {
  assert.equal(visibleSteps(TOUR_STEPS).length, TOUR_STEPS.filter((s) => s.audience !== 'admin').length);
});

test('nothing on the page means no tour at all, not a broken one', () => {
  assert.deepEqual(visibleSteps(TOUR_STEPS, { exists: () => false }), []);
  assert.deepEqual(visibleSteps([], { exists: () => true }), []);
  assert.deepEqual(visibleSteps(null, { exists: () => true }), []);
});

test('a malformed step is skipped rather than crashing the tour', () => {
  const steps = [{ key: 'ok', target: 'a', audience: 'all' }, null, { key: 'bad' }];
  assert.deepEqual(visibleSteps(steps, { exists: () => true }).map((s) => s.key), ['ok']);
});

// ── the done flag ────────────────────────────────────────────────────────────

test('the flag is per user, so a shared tablet gives each person their own run', () => {
  const s = fakeStore();
  markTourDone('ana', s);
  assert.equal(isTourDone('ana', s), true);
  assert.equal(isTourDone('tom', s), false);
});

test('the key carries the version, so changed steps can be shown again', () => {
  assert.match(tourDoneKey('ana'), new RegExp(`v${TOUR_VERSION}`));
  assert.notEqual(tourDoneKey('ana'), tourDoneKey('tom'));
});

test('clearing the flag re-runs the tour', () => {
  const s = fakeStore();
  markTourDone('ana', s);
  clearTourDone('ana', s);
  assert.equal(isTourDone('ana', s), false);
});

test('unreadable storage counts as seen, so nobody gets the tour on every load', () => {
  // A private window throws on read. Showing the tour forever would be worse than
  // never showing it.
  assert.equal(isTourDone('ana', fakeStore({ throwOnGet: true })), true);
});

test('unwritable storage does not throw into the render', () => {
  assert.doesNotThrow(() => markTourDone('ana', fakeStore({ throwOnSet: true })));
  assert.doesNotThrow(() => markTourDone('ana', null));
  assert.doesNotThrow(() => clearTourDone('ana', null));
});

// ── tip placement ────────────────────────────────────────────────────────────

const vp = { width: 1200, height: 800 };
const tip = { width: 320, height: 150 };

test('the tip sits below the target when there is room', () => {
  const p = tipPlacement({ top: 100, left: 500, width: 200, height: 60 }, vp, tip);
  assert.equal(p.side, 'below');
  assert.ok(p.top > 160, 'should clear the target');
});

test('the tip flips above a target near the bottom of the screen', () => {
  // The Customise Layout button lives at the very bottom of the dashboard.
  const p = tipPlacement({ top: 720, left: 500, width: 200, height: 40 }, vp, tip);
  assert.equal(p.side, 'above');
  assert.ok(p.top + tip.height <= 720, 'should sit clear above the target');
});

test('a target with no room either side still leaves the tip on screen', () => {
  const tall = { width: 320, height: 700 };
  const p = tipPlacement({ top: 380, left: 500, width: 200, height: 40 }, vp, tall);
  assert.ok(p.top >= TIP_MARGIN);
  assert.ok(p.top + tall.height <= vp.height, 'tip must not run off the bottom');
});

test('the tip is centred on the target but never hangs off an edge', () => {
  const centred = tipPlacement({ top: 100, left: 500, width: 200, height: 60 }, vp, tip);
  assert.equal(centred.left, 500 + 100 - 160);

  // Hard left — the vessel switcher.
  const left = tipPlacement({ top: 70, left: 8, width: 120, height: 32 }, vp, tip);
  assert.equal(left.left, TIP_MARGIN);

  // Hard right — the avatar menu.
  const right = tipPlacement({ top: 70, left: 1150, width: 40, height: 32 }, vp, tip);
  assert.equal(right.left, vp.width - tip.width - TIP_MARGIN);
});

test('a viewport narrower than the tip does not produce a negative offset', () => {
  const p = tipPlacement({ top: 40, left: 10, width: 40, height: 30 }, { width: 300, height: 600 }, tip);
  assert.ok(p.left >= 0, `left was ${p.left}`);
  assert.ok(p.top >= 0, `top was ${p.top}`);
});

test('the arrow points at the target and stays on the card', () => {
  const rect = { top: 100, left: 500, width: 200, height: 60 };
  const { left } = tipPlacement(rect, vp, tip);
  assert.equal(tipArrowLeft(rect, left, tip), 160); // dead centre

  // Clamped when the card was pushed away from the target by the edge rules.
  const edge = { top: 70, left: 1150, width: 40, height: 32 };
  const arrow = tipArrowLeft(edge, tipPlacement(edge, vp, tip).left, tip);
  assert.ok(arrow >= 18 && arrow <= tip.width - 18, `arrow at ${arrow}`);
});

// ── counters ─────────────────────────────────────────────────────────────────

test('the counter is one-based and never overruns the total', () => {
  assert.equal(stepCounter(0, 8), '1 of 8');
  assert.equal(stepCounter(7, 8), '8 of 8');
  assert.equal(stepCounter(99, 8), '8 of 8');
});

test('progress fills to exactly 100 on the last step', () => {
  assert.equal(stepPercent(0, 4), 25);
  assert.equal(stepPercent(3, 4), 100);
  assert.equal(stepPercent(0, 0), 0);
});
