// window.open() and target="_blank" in the app. A web view has no tabs, so
// each kind of "new window" Cargo opens is routed to its native equivalent:
//
//   window.open('')  / about:blank   → the in-app viewer sheet: a real
//        same-origin iframe handed back as the "window", so the existing
//        print-window code (labels, QR sheets, reports) keeps working
//        untouched — w.document.write(), w.print(), w.close() and all.
//        w.print() goes to the native print dialog (CargoPrint plugin).
//   blob: / data: URL                  → share sheet (lib/native/files.js)
//   same-app path ('/terms', '/faq')   → in-app navigation
//   external https / mailto / tel      → in-app browser / the OS

import { registerPlugin } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { shareUrl, handleDownloadAnchor } from './files';
import { publicOrigin } from './platform';
import './native-viewer.css';

// Local plugin: ios/App/App/CargoPrintPlugin.swift,
// android/app/src/main/java/uk/co/cargotechnology/app/CargoPrintPlugin.java
const CargoPrint = registerPlugin('CargoPrint');

let navigateFn = null;
// Set by <NativeBridge /> (inside the router) so non-React code can navigate.
export const setNativeNavigate = (fn) => { navigateFn = fn; };

export function navigateInApp(path) {
  if (navigateFn) navigateFn(path);
  else window.location.assign(path);
}

const report = (e) => console.error('[native] open failed', e);

export function openExternal(url) {
  if (/^(mailto|tel|sms):/i.test(url)) { window.location.href = url; return; }
  Browser.open({ url, presentationStyle: 'popover' }).catch(report);
}

// Route a URL to the right native surface. Returns true when handled.
export function routeUrl(raw) {
  const url = String(raw || '');
  if (url.startsWith('blob:') || url.startsWith('data:')) { shareUrl(url, '').catch(report); return true; }
  let u;
  try { u = new URL(url, window.location.href); } catch { return false; }
  // The app's own origin, or a link to Cargo's public site: stay in the app.
  if (u.origin === window.location.origin || u.origin === new URL(publicOrigin()).origin) {
    navigateInApp(`${u.pathname}${u.search}${u.hash}`);
    return true;
  }
  if (/^(https?|mailto|tel|sms):$/.test(u.protocol)) { openExternal(u.href); return true; }
  return false;
}

// ── The viewer sheet ────────────────────────────────────────────────────────

// A self-contained copy of a document for the native print renderer: scripts
// dropped, and the app's own stylesheets inlined (the renderer can't load
// them from the app bundle, and the deployed site may be a different build).
function documentHtml(doc) {
  if (!doc?.documentElement) return '';
  const clone = doc.documentElement.cloneNode(true);
  clone.querySelectorAll('script').forEach((n) => n.remove());
  const sheets = Array.from(doc.styleSheets || []);
  clone.querySelectorAll('link[rel="stylesheet"]').forEach((link) => {
    const sheet = sheets.find((sh) => sh.href && sh.href === link.href);
    let css = '';
    try { css = Array.from(sheet?.cssRules || []).map((r) => r.cssText).join('\n'); } catch { return; } // cross-origin (fonts): keep the link
    if (!css) return;
    const style = doc.createElement('style');
    style.textContent = css;
    link.replaceWith(style);
  });
  return `<!doctype html>\n${clone.outerHTML}`;
}

function printDocument(doc) {
  const name = (doc.title || 'Cargo').slice(0, 80);
  // Relative URLs inside the written HTML (logos, fonts) resolve against the
  // app's own origin, which the native print renderer can't reach — so hand
  // it the public site as the base.
  return CargoPrint.printHtml({ html: documentHtml(doc), name, baseUrl: publicOrigin() }).catch(report);
}

function openViewer() {
  const root = document.createElement('div');
  root.className = 'nv-sheet';
  root.innerHTML = `
    <div class="nv-bar">
      <button type="button" class="nv-btn nv-ghost" data-act="close">Close</button>
      <div class="nv-title">Preparing…</div>
      <button type="button" class="nv-btn nv-primary" data-act="print">Print / Save PDF</button>
    </div>
    <iframe class="nv-frame" title="Document"></iframe>`;
  document.body.appendChild(root);
  const frame = root.querySelector('iframe');
  const titleEl = root.querySelector('.nv-title');
  const win = frame.contentWindow;

  const close = () => { root.remove(); };
  const print = () => { printDocument(frame.contentDocument); };

  // Keep window.print / window.close pointing at the sheet even after the
  // caller rewrites the document (document.open() can reset them).
  const patch = () => {
    try { win.print = print; win.close = close; } catch { /* noop */ }
    try { titleEl.textContent = frame.contentDocument.title || 'Document'; } catch { /* noop */ }
  };
  const doc = frame.contentDocument;
  for (const m of ['open', 'write', 'writeln', 'close']) {
    const orig = doc[m].bind(doc);
    doc[m] = (...args) => { const r = orig(...args); patch(); return r; };
  }
  frame.addEventListener('load', patch);
  patch();

  root.addEventListener('click', (e) => {
    const act = e.target?.closest?.('[data-act]')?.dataset.act;
    if (act === 'close') close();
    if (act === 'print') print();
  });
  return win;
}

// ── Install ─────────────────────────────────────────────────────────────────

export function installWindowShims() {
  // Pages that print themselves (QR sheet overlay, owner accounts, return slip).
  window.print = () => { printDocument(document); };

  window.open = (url) => {
    if (!url || url === 'about:blank') return openViewer();
    routeUrl(url);
    // Callers only null-check the return value (popup-blocker fallbacks);
    // a minimal stand-in keeps them from also navigating the main view.
    return { closed: false, close() {}, focus() {}, document: null, location: { href: url } };
  };

  // <a target="_blank"> / download links the user taps.
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button > 0) return;
    const a = e.target?.closest?.('a[href]');
    if (!a) return;
    if (a.hasAttribute('download')) {
      if (handleDownloadAnchor(a)) e.preventDefault();
      return;
    }
    const href = a.getAttribute('href') || '';
    if (href.startsWith('#')) return;
    let u;
    try { u = new URL(a.href, window.location.href); } catch { return; }
    const external = u.origin !== window.location.origin && /^https?:$/.test(u.protocol);
    if (a.target === '_blank' || external) {
      if (routeUrl(u.href)) e.preventDefault();
    }
  }, true);
}
