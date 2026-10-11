// Cargo — the dashboard's guided tour: pure logic, no React and no DOM, so it is
// unit-testable with `node --test`.
//
// This replaced the onboarding slab that used to sit above the dashboard. A new
// crew member now lands on the REAL dashboard and gets taught in place: the thing
// being explained pulses, a tip sits beside it, and the controls live in a small
// dock bottom-left. Nothing is hidden behind a welcome screen, so what they learn
// is where it actually is.
//
// Two rules shape everything here:
//
//   1. A STEP WHOSE TARGET ISN'T ON THE PAGE IS DROPPED, never shown pointing at
//      nothing. The dashboard is user-arranged — widgets can be removed, and some
//      are permission-gated — so "is this on screen" is a question only the DOM can
//      answer. `visibleSteps` takes an `exists` probe rather than reaching for the
//      document itself, which is what keeps this module testable.
//   2. The step numbering the crew sees comes from the FILTERED list. Telling
//      someone "step 3 of 9" and then stopping at 6 because three targets were
//      missing is worse than not counting at all.

// Bump when the steps change enough that returning crew should see them again.
export const TOUR_VERSION = 1;

// `target` is matched as [data-tour="<target>"]. `audience`: 'all' | 'admin' | 'crew'.
// Bodies are deliberately one sentence — this is a nudge, not documentation.
export const TOUR_STEPS = [
  {
    key: 'vessel',
    target: 'vessel',
    audience: 'all',
    title: 'The boat you’re on',
    body: 'Everything you see — jobs, stock, hours — belongs to this vessel. If you crew on more than one, switch here.',
  },
  {
    key: 'setup',
    target: 'widget-setupTasks',
    audience: 'admin',
    title: 'Finish setting up',
    body: 'Locations, inventory and crew. Work down this list and the rest of Cargo fills itself in.',
  },
  {
    key: 'signInOut',
    target: 'widget-signInOut',
    audience: 'all',
    title: 'Sign on and off',
    body: 'Tap this when you step aboard and when you leave — it’s what the bridge reads to know who is on board.',
  },
  {
    key: 'teamJobs',
    target: 'widget-teamJobs',
    audience: 'all',
    title: 'Your jobs',
    body: 'Anything assigned to you lands here. Tick it off from this card without opening the full board.',
  },
  {
    key: 'hoursOfRest',
    target: 'widget-hoursOfRest',
    audience: 'all',
    title: 'Hours of rest',
    body: 'Fill this in daily — it’s the record that gets checked, and catching up a fortnight later never goes well.',
  },
  {
    key: 'inbox',
    target: 'inbox',
    audience: 'all',
    title: 'Where you get told things',
    body: 'Handovers, approvals and anything waiting on you. The number is how many things want an answer.',
  },
  {
    key: 'search',
    target: 'search',
    audience: 'all',
    title: 'Find anything',
    body: 'Pages, crew, jobs, a guest’s name, a box of spares — start typing, or hit the mic and say it.',
  },
  {
    key: 'profile',
    target: 'profile',
    audience: 'all',
    title: 'You, and your papers',
    body: 'Your certificates and documents live behind here. Keep the expiry dates straight and nobody has to chase you.',
  },
  {
    key: 'customise',
    target: 'customise',
    audience: 'all',
    title: 'Make it yours',
    body: 'Drag the cards into the order you want, or drop the ones you don’t need. Your layout, not the captain’s.',
  },
];

// Steps this person should actually be walked through, in order.
//
// `exists(target)` is injected (the component passes a DOM probe) so the filtering
// is testable and so a missing widget silently drops its step.
export const visibleSteps = (steps = TOUR_STEPS, { isAdmin = false, exists } = {}) => {
  const probe = typeof exists === 'function' ? exists : () => true;
  return (steps || []).filter((s) => {
    if (!s || !s.target) return false;
    if (s.audience === 'admin' && !isAdmin) return false;
    if (s.audience === 'crew' && isAdmin) return false;
    return probe(s.target);
  });
};

// ── "Already seen it" flag ───────────────────────────────────────────────────
// Per user, so two people sharing a tablet each get their own run. localStorage
// rather than a column: the existing dashboard tutorial flags worked this way, it
// needs no migration, and the cost of being wrong is one extra tour.

export const tourDoneKey = (userId) => `cg_tour_v${TOUR_VERSION}_done_${userId || 'anon'}`;

// Every accessor is wrapped: localStorage throws in private windows and with site
// data blocked, and a dashboard that won't render because of a tour flag would be
// a self-inflicted outage.
const store = () => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
};

export const isTourDone = (userId, s = store()) => {
  try {
    return s?.getItem(tourDoneKey(userId)) === '1';
  } catch {
    // Unreadable storage means "don't know". Treat it as DONE, so a crew member
    // who cannot persist the flag isn't shown the tour on every single load.
    return true;
  }
};

export const markTourDone = (userId, s = store()) => {
  try {
    s?.setItem(tourDoneKey(userId), '1');
  } catch { /* nothing we can do, and nothing worth breaking the page over */ }
};

export const clearTourDone = (userId, s = store()) => {
  try {
    s?.removeItem(tourDoneKey(userId));
  } catch { /* as above */ }
};

// ── Tip placement ────────────────────────────────────────────────────────────
// Where the tip card goes relative to the thing it is describing. Below by
// preference, above when the target is near the bottom, and always clamped inside
// the viewport — a tip half off-screen is worse than one slightly misaligned.

export const TIP_GAP = 14;     // breathing room between the pulse ring and the tip
export const TIP_MARGIN = 16;  // smallest allowed distance to a viewport edge

export const tipPlacement = (rect, viewport, tip, opts = {}) => {
  const gap = opts.gap ?? TIP_GAP;
  const margin = opts.margin ?? TIP_MARGIN;
  const vw = viewport?.width ?? 0;
  const vh = viewport?.height ?? 0;
  const tw = tip?.width ?? 0;
  const th = tip?.height ?? 0;

  const below = rect.top + rect.height + gap;
  const above = rect.top - gap - th;

  let side = 'below';
  let top = below;
  // Only flip when below genuinely doesn't fit AND above does — flipping into a
  // position that also overflows just moves the problem.
  if (below + th > vh - margin && above >= margin) {
    side = 'above';
    top = above;
  }
  // Whichever side won, keep the card on screen.
  top = Math.max(margin, Math.min(top, Math.max(margin, vh - th - margin)));

  const centred = rect.left + rect.width / 2 - tw / 2;
  const left = Math.max(margin, Math.min(centred, Math.max(margin, vw - tw - margin)));

  return { top, left, side };
};

// The arrow on the tip points back at the target's centre, clamped so it stays on
// the card's edge rather than sliding off a rounded corner.
export const tipArrowLeft = (rect, left, tip, inset = 18) => {
  const tw = tip?.width ?? 0;
  const centre = rect.left + rect.width / 2 - left;
  return Math.max(inset, Math.min(centre, Math.max(inset, tw - inset)));
};

export const stepCounter = (index, total) => `${Math.min(index + 1, total)} of ${total}`;
export const stepPercent = (index, total) =>
  total > 0 ? Math.round(((index + 1) / total) * 100) : 0;
