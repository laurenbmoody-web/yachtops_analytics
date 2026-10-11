// GuidedTour — teaches the dashboard in place, on the real dashboard.
//
// This replaced a welcome slab that sat above the page. The problem with a slab is
// that it describes the app somewhere the app isn't: you read four feature tiles,
// dismiss it, and the dashboard underneath is still unfamiliar. So instead the
// thing being explained PULSES where it actually lives, a tip sits beside it, and
// the controls stay out of the way in a small dock bottom-left.
//
// Mechanics worth knowing:
//
//   * The dim is one element with a 9999px spread box-shadow, so the "hole" is just
//     the absence of shadow. One node, no four-panel arithmetic, and the hole can
//     have a border radius.
//   * A transparent blocker underneath swallows clicks. The highlighted control is
//     deliberately NOT clickable: every target is a link or a nav button, so a
//     click would navigate away and abandon the tour three steps in.
//   * Positions are viewport coordinates from getBoundingClientRect on a `fixed`
//     overlay, which is what lets the same code point at the fixed header and at a
//     widget halfway down the scroll.
//   * Targets are found by [data-tour="…"], never by class or DOM shape, so
//     restyling a widget can't quietly break the tour.
//
// All the arithmetic and filtering lives in services/guidedTour.js and is tested
// there; this file is the DOM and the chrome.
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { tipPlacement, tipArrowLeft, stepCounter, stepPercent } from '../../services/guidedTour';
import './tour.css';

export const tourSelector = (target) => `[data-tour="${target}"]`;
export const tourTargetExists = (target) => {
  if (typeof document === 'undefined') return false;
  const el = document.querySelector(tourSelector(target));
  if (!el) return false;
  // A node that is display:none or in a collapsed container has no box — pointing
  // at it would be pointing at nothing.
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};

// How far outside the target the spotlight and ring sit.
const HALO = 8;

const GuidedTour = ({ steps = [], onFinish, onSkip }) => {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState(null);
  const [tipSize, setTipSize] = useState({ width: 320, height: 150 });
  const tipRef = useRef(null);

  const total = steps.length;
  const step = steps[index];
  const isLast = index >= total - 1;

  const finish = useCallback(() => { onFinish?.(); }, [onFinish]);
  const skip = useCallback(() => { onSkip?.(); }, [onSkip]);
  const next = useCallback(() => {
    if (isLast) finish();
    else setIndex((i) => i + 1);
  }, [isLast, finish]);
  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  // Measure the current target. Re-run on every step, and keep re-running while
  // the page moves: a smooth scrollIntoView fires scroll events all the way, and
  // widgets load their data after mount and change height under us.
  const measure = useCallback(() => {
    if (!step) return;
    const el = document.querySelector(tourSelector(step.target));
    if (!el) { setRect(null); return; }
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [step]);

  useEffect(() => {
    if (!step) return undefined;
    const el = document.querySelector(tourSelector(step.target));
    if (el) {
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
      el.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
    }
    measure();

    window.addEventListener('scroll', measure, { passive: true, capture: true });
    window.addEventListener('resize', measure);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (ro && el) ro.observe(el);

    return () => {
      window.removeEventListener('scroll', measure, { capture: true });
      window.removeEventListener('resize', measure);
      ro?.disconnect();
    };
  }, [step, measure]);

  // The tip's own height decides whether it fits below the target, so it has to be
  // measured after it renders. Until then it is held invisible (see .gt-tip
  // [data-ready]) rather than painted in the wrong place and snapped.
  useLayoutEffect(() => {
    const el = tipRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (Math.abs(r.height - tipSize.height) > 1 || Math.abs(r.width - tipSize.width) > 1) {
      setTipSize({ width: r.width, height: r.height });
    }
  }, [step, tipSize.height, tipSize.width]);

  // The beta feedback bubble is pinned at a z-index far above the app's scale, so
  // it would otherwise float over the dim and stay clickable mid-tour. Same
  // body-class mechanism the dashboard's customise bar already uses.
  useEffect(() => {
    document.body.classList.add('tour-active');
    return () => document.body.classList.remove('tour-active');
  }, []);

  // Keyboard: this is a modal layer, so it owns the arrows and Escape while open.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); skip(); }
      else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); back(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, back, skip]);

  // A step whose target vanished mid-tour (a widget finished loading into an empty
  // state, say) skips itself rather than stranding the crew on a blank spotlight.
  useEffect(() => {
    if (step && rect === null) {
      const t = setTimeout(() => { if (isLast) finish(); else setIndex((i) => i + 1); }, 400);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [step, rect, isLast, finish]);

  if (!step || total === 0) return null;

  const halo = rect && {
    top: rect.top - HALO,
    left: rect.left - HALO,
    width: rect.width + HALO * 2,
    height: rect.height + HALO * 2,
  };

  const vp = { width: window.innerWidth, height: window.innerHeight };
  const place = rect ? tipPlacement(halo, vp, tipSize) : null;
  const arrow = rect && place ? tipArrowLeft(rect, place.left, tipSize) : 0;

  return createPortal(
    <div className="gt-root" role="dialog" aria-modal="true" aria-label={`Tour: ${step.title}`}>
      {/* Swallows every click so the tour can't be navigated out from under. */}
      <div className="gt-block" />

      {rect && (
        <>
          <div className="gt-hole" style={halo} />
          <div className="gt-ring" style={halo} />
        </>
      )}

      <div
        ref={tipRef}
        className="gt-tip"
        data-side={place?.side || 'below'}
        data-ready={rect ? 'y' : 'n'}
        style={place ? { top: place.top, left: place.left } : undefined}
      >
        <span className="gt-arrow" style={{ left: arrow }} />
        <p className="gt-eyebrow">{stepCounter(index, total)}</p>
        <h4 className="gt-title">{step.title}</h4>
        <p className="gt-body">{step.body}</p>
      </div>

      {/* The dock — small, bottom-left, out of the way of the content. */}
      <div className="gt-dock">
        <div className="gt-progress" aria-hidden="true">
          <span style={{ width: `${stepPercent(index, total)}%` }} />
        </div>
        <div className="gt-dock-row">
          <span className="gt-dock-count">{stepCounter(index, total)}</span>
          <div className="gt-dock-btns">
            {index > 0 && (
              <button type="button" className="gt-btn gt-ghost" onClick={back}>
                <ArrowLeft size={13} /> Back
              </button>
            )}
            <button type="button" className="gt-btn gt-primary" onClick={next} autoFocus>
              {isLast ? (<><Check size={13} /> Done</>) : (<>Next <ArrowRight size={13} /></>)}
            </button>
          </div>
          <button type="button" className="gt-dock-skip" onClick={skip} title="Skip the tour (Esc)">
            <X size={12} /> Skip
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default GuidedTour;
