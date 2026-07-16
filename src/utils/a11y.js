// Accessibility preferences — applied to the document root and persisted so
// they survive reloads. Kept out of React so they can be applied before first
// paint (see initA11y() called in index.jsx).
//
//   a11y_reduce_motion  'true' → data-reduce-motion="true" (global CSS kills
//                        transitions/animations — see styles/index.css)
//   a11y_text_size      'large' → root font-size 112.5%, so rem/Tailwind text
//                        (the bulk of the UI) scales up. 'default' clears it.

export const applyReduceMotion = (on) => {
  const root = document.documentElement;
  if (!root) return;
  // On → force reduced motion. Off → remove the flag so the OS's own
  // prefers-reduced-motion setting is still honoured (never force motion ON
  // against a user's system accessibility preference).
  if (on) root.setAttribute('data-reduce-motion', 'true');
  else root.removeAttribute('data-reduce-motion');
};

export const applyTextSize = (size) => {
  const root = document.documentElement;
  if (!root) return;
  const large = size === 'large';
  // Zoom scales EVERYTHING — including the app's many inline-pixel font sizes,
  // which a root font-size change would miss. So "Large" genuinely enlarges the
  // whole UI, not just the rem/Tailwind text.
  root.style.zoom = large ? '1.12' : '';
  root.setAttribute('data-text-size', large ? 'large' : 'default');
};

export const initA11y = () => {
  try {
    applyReduceMotion(localStorage.getItem('a11y_reduce_motion') === 'true');
    applyTextSize(localStorage.getItem('a11y_text_size') || 'default');
  } catch { /* localStorage unavailable — defaults are fine */ }
};
