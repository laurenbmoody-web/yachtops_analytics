// Room to scroll above the on-screen keyboard, on every page and in every
// modal. The web view keeps its full height (Keyboard.resize = none) and the
// keyboard sits over the bottom of it, so while it is open:
//   • the page gets bottom padding the height of the keyboard, and
//   • so does the scroll box the field sits in (a modal, drawer or panel),
// which means anything behind the keyboard can be scrolled up into view. The
// field being typed into is scrolled into the space that is left.

import { Keyboard } from '@capacitor/keyboard';

const padded = new Map(); // element → its own padding-bottom before we touched it
let height = 0;

function scrollBoxOf(el) {
  for (let n = el?.parentElement; n && n !== document.body; n = n.parentElement) {
    const cs = getComputedStyle(n);
    if (/(auto|scroll)/.test(cs.overflowY) || cs.position === 'fixed') return n;
  }
  return null;
}

function pad(el) {
  if (!el || padded.has(el)) return;
  padded.set(el, el.style.paddingBottom);
  const base = parseFloat(getComputedStyle(el).paddingBottom) || 0;
  el.style.paddingBottom = `${base + height}px`;
}

function unpadAll() {
  padded.forEach((orig, el) => { el.style.paddingBottom = orig; });
  padded.clear();
}

function isField(el) {
  return !!el?.matches?.('input, textarea, select, [contenteditable="true"]');
}

function makeRoomFor(el) {
  if (!height || !isField(el)) return;
  pad(document.body);
  pad(scrollBoxOf(el));
  setTimeout(() => { try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { /* ignore */ } }, 60);
}

export function installKeyboardRoom() {
  const root = document.documentElement;
  try {
    Keyboard.setResizeMode?.({ mode: 'none' }).catch(() => {});
    Keyboard.addListener('keyboardWillShow', (info) => {
      height = Math.round(info?.keyboardHeight || 0);
      root.style.setProperty('--kb-h', `${height}px`);
      root.classList.add('kb-open');
      makeRoomFor(document.activeElement);
    });
    Keyboard.addListener('keyboardWillHide', () => {
      height = 0;
      root.style.setProperty('--kb-h', '0px');
      root.classList.remove('kb-open');
      unpadAll();
    });
  } catch (e) {
    console.warn('[native] keyboard listeners unavailable', e);
  }
  // Moving between fields with the keyboard already up.
  document.addEventListener('focusin', (e) => makeRoomFor(e.target));
}
