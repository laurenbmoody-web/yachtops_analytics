// Gangway face sign-in — the gate between "the camera thinks it saw someone" and
// "flip that person's aboard/ashore status". Pure, no DOM, no Supabase, so the
// rules are testable with `node --test`.
//
// The board's action is a FLIP of the last known status (crewPresence.flip): it
// doesn't work out which way you're walking, it just inverts what you were. That
// makes the whole design hinge on identity being right, because the two ways to
// get it wrong are both bad:
//
//   * wrong person matched  → someone else is marked ashore while they're aboard
//   * same person matched twice → you arrive, get flipped aboard, linger in front
//     of the camera, and get flipped straight back ashore
//
// So this module answers three questions, and nothing else:
//
//   1. Is this match good enough to act on?  (decide)
//   2. Has it been the same person for long enough to be real?  (track/feed)
//   3. Have we only just done this person?  (cooldown)
//
// The confirm tap on the board is the backstop for all of it. These rules exist
// so the crew are rarely shown the wrong name in the first place.

// ── confidence ───────────────────────────────────────────────────────────────

// Euclidean distance between 128-float face descriptors. The model's own
// documented "same person" line is 0.6; we hold a tighter 0.5 because a false
// flip on a muster list costs more than asking someone to tap their name.
export const MATCH_DISTANCE = 0.5;

// How much clearer the best match must be than the runner-up. Two crew who
// genuinely look alike (siblings, or just similar build and colouring at a
// distance) produce two close distances; guessing between them is exactly the
// failure that puts the wrong person ashore. Below this margin we refuse.
export const RUNNER_UP_MARGIN = 0.08;

// Verdicts: 'match' (act on it), 'ambiguous' (two people too close — ask them to
// tap), 'none' (nobody near enough / nobody enrolled).
export const decide = (row, { maxDistance = MATCH_DISTANCE, margin = RUNNER_UP_MARGIN } = {}) => {
  if (!row || !row.user_id || typeof row.distance !== 'number') {
    return { verdict: 'none' };
  }
  if (row.distance > maxDistance) return { verdict: 'none' };

  const runnerUp = typeof row.runner_up === 'number' ? row.runner_up : null;
  if (runnerUp !== null && runnerUp - row.distance < margin) {
    return { verdict: 'ambiguous', userId: row.user_id, name: row.display_name || null };
  }
  return {
    verdict: 'match',
    userId: row.user_id,
    name: row.display_name || null,
    distance: row.distance,
  };
};

// ── stability ────────────────────────────────────────────────────────────────

// How many consecutive agreeing frames before we believe it. A single frame can
// catch a blur, a half-turned head, or someone walking past behind the person
// actually standing there.
export const STABLE_FRAMES = 3;

export const emptyTracker = () => ({ userId: null, hits: 0 });

// Feed one decision in; get the next tracker state and whether to act now.
// A different person resets the count rather than accumulating, so two people
// alternating in frame never add up to a confirmation.
export const feed = (tracker, decision, { stableFrames = STABLE_FRAMES } = {}) => {
  const t = tracker || emptyTracker();
  if (!decision || decision.verdict !== 'match') return { tracker: emptyTracker(), fire: false };

  const hits = t.userId === decision.userId ? t.hits + 1 : 1;
  const next = { userId: decision.userId, hits };
  // Fire exactly once, on the frame that reaches the threshold — not on every
  // frame after it, which would re-flip for as long as someone stood there.
  return { tracker: next, fire: hits === stableFrames };
};

// ── cooldown ─────────────────────────────────────────────────────────────────

// After flipping someone, ignore that face for this long. Long enough to walk
// away from a wall-mounted iPad; short enough that stepping back out five
// minutes later works.
export const COOLDOWN_MS = 20000;

export const isCoolingDown = (lastActedAt, now, { cooldownMs = COOLDOWN_MS } = {}) => {
  if (!lastActedAt) return false;
  return now - lastActedAt < cooldownMs;
};

// Per-person record of when we last acted, kept small and immutable so a React
// state setter can swallow it without a deep clone.
export const noteActed = (seen, userId, now) => ({ ...(seen || {}), [userId]: now });

// ── the session ──────────────────────────────────────────────────────────────

// How long the camera stays up after a tap before giving up and handing over to
// the tile list. Long enough for the model to load and settle, short enough that
// nobody stands there jabbing at it.
export const LOOK_TIMEOUT_MS = 8000;

// Whether the camera view should give up now. Separate from the gate so the UI
// can show "didn't catch that" and fall through to the tiles.
export const shouldGiveUp = (startedAt, now, { timeoutMs = LOOK_TIMEOUT_MS } = {}) =>
  !!startedAt && now - startedAt >= timeoutMs;

// One call the board can make per frame: given the matcher's row and the current
// session state, say what to do. Keeps the ordering of the rules in one place
// rather than spread across a component.
//
// Returns { action, tracker, ... }:
//   'flip'      — act on userId/name (the caller then shows the confirm)
//   'ambiguous' — two enrolled faces too alike; ask them to tap instead
//   'recent'    — recognised, but we flipped them moments ago. Its own action
//                 rather than a flavour of 'wait', because the crew member is
//                 standing there and needs TELLING that nothing changed; a hint
//                 that the next frame overwrites is worse than no hint.
//   'wait'      — keep looking
export const step = ({ row, tracker, seen, now, opts = {} }) => {
  const decision = decide(row, opts);

  if (decision.verdict === 'ambiguous') {
    return { action: 'ambiguous', tracker: emptyTracker(), name: decision.name };
  }

  const fed = feed(tracker, decision, opts);
  if (!fed.fire) return { action: 'wait', tracker: fed.tracker };

  // Confident and stable — but did we just do them? Carry who it was and when,
  // so the screen can say "you signed ashore a moment ago" by name instead of
  // silently declining to act.
  if (isCoolingDown(seen?.[decision.userId], now, opts)) {
    return {
      action: 'recent',
      tracker: fed.tracker,
      userId: decision.userId,
      name: decision.name,
      at: seen?.[decision.userId] ?? null,
    };
  }

  return {
    action: 'flip',
    tracker: fed.tracker,
    userId: decision.userId,
    name: decision.name,
    distance: decision.distance,
  };
};

// What the confirm panel asks. The question is derived from the status on record,
// since the board's only move is to invert it — so the crew see the direction
// before it commits, not after.
export const confirmPrompt = (currentStatus) =>
  currentStatus === 'aboard'
    ? { question: 'Going ashore?', next: 'ashore' }
    : { question: 'Coming aboard?', next: 'aboard' };
