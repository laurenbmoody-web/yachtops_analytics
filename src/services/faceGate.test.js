import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decide, feed, emptyTracker, step, isCoolingDown, noteActed, shouldGiveUp, confirmPrompt,
  MATCH_DISTANCE, RUNNER_UP_MARGIN, STABLE_FRAMES, COOLDOWN_MS, LOOK_TIMEOUT_MS,
} from './faceGate.js';

const row = (over = {}) => ({
  user_id: 'u1', display_name: 'Ana Reyes', distance: 0.3, runner_up: 0.9, enrolled_count: 3, ...over,
});

// ── confidence ───────────────────────────────────────────────────────────────

test('a close, unambiguous face is a match', () => {
  const d = decide(row());
  assert.equal(d.verdict, 'match');
  assert.equal(d.userId, 'u1');
  assert.equal(d.name, 'Ana Reyes');
});

test('a face that is not close enough is nobody, not a best guess', () => {
  assert.equal(decide(row({ distance: MATCH_DISTANCE + 0.01 })).verdict, 'none');
  assert.equal(decide(null).verdict, 'none');
  assert.equal(decide({}).verdict, 'none');
  // The matcher returning no row at all is the common case: nobody enrolled yet.
  assert.equal(decide(undefined).verdict, 'none');
});

test('two crew who look alike are refused rather than guessed between', () => {
  // This is the failure that puts the wrong person ashore on a muster list.
  const tooClose = row({ distance: 0.30, runner_up: 0.30 + RUNNER_UP_MARGIN - 0.001 });
  const d = decide(tooClose);
  assert.equal(d.verdict, 'ambiguous');
  assert.equal(d.name, 'Ana Reyes', 'still names who it thought, for the message');
});

test('a clear runner-up gap is accepted', () => {
  const clear = row({ distance: 0.30, runner_up: 0.30 + RUNNER_UP_MARGIN + 0.001 });
  assert.equal(decide(clear).verdict, 'match');
});

test('the only enrolled crew member has no runner-up and still matches', () => {
  assert.equal(decide(row({ runner_up: null })).verdict, 'match');
});

test('the threshold is tighter than the model default', () => {
  // face-api documents 0.6 for "same person"; a false flip costs more than a
  // re-tap, so this must stay below it.
  assert.ok(MATCH_DISTANCE < 0.6, `${MATCH_DISTANCE} is not tighter than 0.6`);
});

// ── stability ────────────────────────────────────────────────────────────────

test('one good frame is not enough — it takes a few in a row', () => {
  let t = emptyTracker();
  const fires = [];
  for (let i = 0; i < STABLE_FRAMES; i += 1) {
    const r = feed(t, decide(row()));
    t = r.tracker;
    fires.push(r.fire);
  }
  assert.deepEqual(fires, [...Array(STABLE_FRAMES - 1).fill(false), true]);
});

test('it fires once, not on every frame after', () => {
  // Otherwise standing in front of a wall-mounted iPad would flip you aboard,
  // ashore, aboard… for as long as you stood there.
  let t = emptyTracker();
  let fired = 0;
  for (let i = 0; i < STABLE_FRAMES + 6; i += 1) {
    const r = feed(t, decide(row()));
    t = r.tracker;
    if (r.fire) fired += 1;
  }
  assert.equal(fired, 1);
});

test('a different face resets the count instead of adding to it', () => {
  // Two people drifting through frame must never add up to a confirmation.
  let t = emptyTracker();
  t = feed(t, decide(row({ user_id: 'u1' }))).tracker;
  t = feed(t, decide(row({ user_id: 'u2' }))).tracker;
  assert.equal(t.userId, 'u2');
  assert.equal(t.hits, 1);
});

test('a bad frame mid-run resets, so a blur cannot help a near-miss over the line', () => {
  let t = emptyTracker();
  t = feed(t, decide(row())).tracker;
  t = feed(t, decide(row({ distance: 0.95 }))).tracker; // nothing recognised
  assert.deepEqual(t, emptyTracker());
});

// ── cooldown ─────────────────────────────────────────────────────────────────

test('having just flipped someone, their face is ignored for a bit', () => {
  const now = 1_000_000;
  const seen = noteActed({}, 'u1', now);
  assert.equal(isCoolingDown(seen.u1, now + 1000), true);
  assert.equal(isCoolingDown(seen.u1, now + COOLDOWN_MS + 1), false);
  assert.equal(isCoolingDown(undefined, now), false, 'never seen = not cooling');
});

test('the cooldown is long enough to walk away from the iPad', () => {
  assert.ok(COOLDOWN_MS >= 10000, `${COOLDOWN_MS}ms is too short to walk away`);
});

test('noteActed does not mutate what it was given', () => {
  const before = { u1: 1 };
  const after = noteActed(before, 'u2', 2);
  assert.deepEqual(before, { u1: 1 });
  assert.deepEqual(after, { u1: 1, u2: 2 });
});

// ── step: the whole gate in order ────────────────────────────────────────────

const run = (rows, { seen = {}, now = 0 } = {}) => {
  let tracker = emptyTracker();
  const actions = [];
  rows.forEach((r, i) => {
    const s = step({ row: r, tracker, seen, now: now + i });
    tracker = s.tracker;
    actions.push(s.action);
  });
  return actions;
};

test('a person standing still is flipped once, on the frame it becomes certain', () => {
  const actions = run(Array(STABLE_FRAMES + 2).fill(row()));
  assert.equal(actions.filter((a) => a === 'flip').length, 1);
  assert.equal(actions[STABLE_FRAMES - 1], 'flip');
});

test('ambiguity short-circuits the whole gate', () => {
  // No amount of repetition turns two look-alikes into a confident match.
  const amb = row({ distance: 0.3, runner_up: 0.31 });
  assert.deepEqual(run(Array(6).fill(amb)), Array(6).fill('ambiguous'));
});

test('someone already flipped is told so, by name, rather than silently ignored', () => {
  // The crew member is standing at the iPad. "Nothing happened" has to be said
  // out loud, or they walk off believing their status changed.
  const now = 500_000;
  const seen = noteActed({}, 'u1', now);
  const actions = run(Array(STABLE_FRAMES + 3).fill(row()), { seen, now });
  assert.ok(!actions.includes('flip'), 'should not re-flip during the cooldown');
  assert.ok(actions.includes('recent'), 'should surface a recent-sign-in state');

  const s = step({ row: row(), tracker: { userId: 'u1', hits: STABLE_FRAMES - 1 }, seen, now });
  assert.equal(s.action, 'recent');
  assert.equal(s.userId, 'u1');
  assert.equal(s.name, 'Ana Reyes', 'must be able to name them on screen');
  assert.equal(s.at, now, 'and say when');
});

test('an empty camera just waits', () => {
  assert.deepEqual(run([null, null, null]), ['wait', 'wait', 'wait']);
});

// ── the session ──────────────────────────────────────────────────────────────

test('the camera gives up and hands over to the tile list', () => {
  const t0 = 10_000;
  assert.equal(shouldGiveUp(t0, t0 + LOOK_TIMEOUT_MS - 1), false);
  assert.equal(shouldGiveUp(t0, t0 + LOOK_TIMEOUT_MS), true);
  assert.equal(shouldGiveUp(null, t0 + 99_999), false, 'not started = not given up');
});

test('the give-up window leaves time for the model to load', () => {
  assert.ok(LOOK_TIMEOUT_MS >= 5000, `${LOOK_TIMEOUT_MS}ms is not enough`);
});

// ── the prompt ───────────────────────────────────────────────────────────────

test('the question shown is the inverse of the status on record', () => {
  // The board's only move is to flip, so the crew must see which way before it
  // commits — not read "welcome aboard" after being marked ashore.
  assert.deepEqual(confirmPrompt('aboard'), { question: 'Going ashore?', next: 'ashore' });
  assert.deepEqual(confirmPrompt('ashore'), { question: 'Coming aboard?', next: 'aboard' });
  // Unknown/missing status is treated as ashore, so the offer is to come aboard.
  assert.equal(confirmPrompt(undefined).next, 'aboard');
});
