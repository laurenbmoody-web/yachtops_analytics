// Cargo → PYA Autofill — content script (runs on member.pya.org).
//
// Reads the JSON payload that Cargo's "Copy for PYA" button puts on the
// clipboard (built by src/seatime/pya/pyaPayload.js) and types it into the live
// "Verify Sea Service Testimonial" form. Unlike the bookmarklet, this runs in the
// page as an extension, so it can wait for and retry PYA's custom React controls
// instead of firing once — and it auto-updates when the extension is reloaded,
// with no bookmark to re-drag.
//
// Flow: in Cargo click "Copy for PYA" → switch to the PYA create page → click the
// floating "Fill from Cargo" button this injects. Nothing is submitted.

(() => {
  'use strict';
  if (window.__cargoPyaLoaded) return;
  window.__cargoPyaLoaded = true;

  const VERSION = 'ext-5';
  let ok = [], miss = [];

  const norm = (s) => (s || '').replace(/[ⓘ\*•]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const record = (name, hit) => { (hit ? ok : miss).push(name); return hit; };

  async function waitFor(fn, timeout = 2500, interval = 100) {
    const end = Date.now() + timeout;
    while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(interval); }
    return null;
  }

  // React-aware value set: use the native setter so the controlled input's
  // onChange fires and React updates its state.
  function setNativeValue(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  const leaves = () => Array.from(document.querySelectorAll('label,span,div,p,strong,legend,h3,h4'))
    .filter((el) => el.children.length === 0 && el.textContent && el.textContent.trim());
  const labelEls = (text) => { const t = norm(text); return leaves().filter((el) => norm(el.textContent) === t); };

  function containerInput(labelEl) {
    let el = labelEl;
    for (let up = 0; up < 5 && el; up++) {
      const inp = el.querySelector && el.querySelector('input:not([type=radio]):not([type=checkbox]):not([type=hidden]),textarea');
      if (inp) return inp;
      el = el.parentElement;
    }
    return null;
  }

  function fillText(label, val) {
    if (val == null || val === '') return;
    for (const l of labelEls(label)) { const inp = containerInput(l); if (inp) { setNativeValue(inp, String(val)); return record(label, true); } }
    return record(label, false);
  }

  // Radio selection — several strategies, because PYA's options may be a real
  // <input>, a wrapping <label>, an ARIA radio, or a fully custom clickable row.
  function selectRadio(optionText, name) {
    const t = norm(optionText), label = name || optionText;
    // A) a real radio input matched by value / aria-label / wrapping or adjacent text
    for (const inp of document.querySelectorAll('input[type=radio]')) {
      const cands = [inp.value, inp.getAttribute('aria-label'),
        (inp.closest('label') || {}).textContent, (inp.parentElement || {}).textContent,
        (inp.nextElementSibling || {}).textContent, (inp.previousElementSibling || {}).textContent];
      if (cands.some((c) => norm(c) === t)) { inp.click(); return record(label, true); }
    }
    // B) a <label> whose text matches → its input (wrapped or via `for`), else the label
    for (const lb of document.querySelectorAll('label')) {
      if (norm(lb.textContent) === t) {
        let inp = lb.querySelector('input[type=radio],input[type=checkbox]');
        if (!inp && lb.htmlFor) inp = document.getElementById(lb.htmlFor);
        (inp || lb).click(); return record(label, true);
      }
    }
    // C) ARIA radio/option
    for (const r of document.querySelectorAll('[role=radio],[role=option],[role=menuitemradio]')) {
      if (norm(r.textContent) === t) { r.click(); return record(label, true); }
    }
    // D) any element whose exact text matches → click it and its ancestors (the
    //    handler may sit on the row container)
    const hit = Array.from(document.querySelectorAll('button,div,span,li,p,a')).find((e) => norm(e.textContent) === t && e.children.length < 3);
    if (hit) { let el = hit; for (let i = 0; i < 3 && el; i++) { el.click(); el = el.parentElement; } return record(label, true); }
    return record(label, false);
  }

  // Find the checkbox <input> tied to an option label, whether the label wraps
  // it, references it via `for`, or just sits next to it in the same row.
  function checkboxForLabel(text) {
    const t = norm(text);
    const nodes = Array.from(document.querySelectorAll('label,span,div,li,p'))
      .filter((e) => norm(e.textContent) === t)
      .sort((a, b) => a.textContent.length - b.textContent.length); // tightest match first
    for (const node of nodes) {
      let inp = node.querySelector && node.querySelector('input[type=checkbox]');
      if (!inp && node.htmlFor) inp = document.getElementById(node.htmlFor);
      let el = node;
      for (let up = 0; up < 4 && el && !inp; up++) { inp = el.querySelector && el.querySelector('input[type=checkbox]'); if (!inp) el = el.parentElement; }
      if (inp) return { inp, node };
    }
    return null;
  }

  function checkArea(text) {
    const found = checkboxForLabel(text);
    if (found) {
      if (!found.inp.checked) { found.inp.click(); if (!found.inp.checked) found.node.click(); }
      return record('Area: ' + text, found.inp.checked);
    }
    return record('Area: ' + text, false);
  }

  const findFlagSearch = () => Array.from(document.querySelectorAll('input')).find((i) => /nationality|country|search/i.test(i.placeholder || ''));

  // Type into a search box AND fire key events, because list filters often react
  // to keyup rather than the React onChange alone.
  function typeSearch(el, text) {
    el.focus();
    setNativeValue(el, text);
    const last = text.slice(-1) || 'a';
    ['keydown', 'keypress', 'input', 'keyup'].forEach((type) => {
      const ev = /key/.test(type) ? new KeyboardEvent(type, { key: last, bubbles: true }) : new Event(type, { bubbles: true });
      el.dispatchEvent(ev);
    });
  }

  async function fillFlag(country) {
    if (!country) return;
    // Entries sometimes store an abbreviated flag ("Cayman Is.") — expand the
    // common "… Is." → "… Islands" so it matches PYA's country list.
    country = String(country).replace(/\bis\.?$/i, 'Islands').trim();

    // The flag field sits right after the "Flag" label (per PYA's markup); use
    // that first, then fall back to placeholder / literal text.
    let trigger = null;
    const flagLabel = Array.from(document.querySelectorAll('label')).find((l) => norm(l.textContent) === 'flag');
    if (flagLabel && flagLabel.nextElementSibling) trigger = flagLabel.nextElementSibling;
    if (!trigger) trigger = Array.from(document.querySelectorAll('div,button,span,p,a,input')).find((e) => norm(e.textContent) === 'click to choose a country flag');
    if (!trigger) trigger = Array.from(document.querySelectorAll('input')).find((i) => /choose a country|country flag|select.*flag/i.test(i.placeholder || ''));
    if (!trigger) return record('Flag: ' + country, false);

    // Open the picker (retry via the parent if a bare click didn't).
    trigger.click();
    let search = await waitFor(findFlagSearch, 1200);
    if (!search && trigger.parentElement) { trigger.parentElement.click(); search = await waitFor(findFlagSearch, 1200); }
    if (search) { typeSearch(search, country); await sleep(400); }

    const nc = norm(country);
    const row = await waitFor(() => {
      const cand = Array.from(document.querySelectorAll('li,div,button,span,p,a'))
        .filter((e) => e.children.length < 6 && (norm(e.textContent) === nc || norm(e.textContent).indexOf(nc) === 0) && norm(e.textContent).length < nc.length + 8);
      // prefer the tightest match (the row itself, not an outer container)
      return cand.sort((a, b) => a.textContent.length - b.textContent.length)[0] || null;
    }, 2500);
    if (row) { row.click(); return record('Flag: ' + country, true); }
    return record('Flag: ' + country, false);
  }

  function dates(d) {
    if (!d || !d.from) return;
    const dmy = (iso) => { const p = (iso || '').split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : ''; };
    const ls = labelEls('Dates on board');
    if (ls.length) {
      let cont = ls[0];
      for (let up = 0; up < 6 && cont; up++) { if (cont.querySelectorAll && cont.querySelectorAll('input').length >= 2) break; cont = cont.parentElement; }
      const ins = cont ? cont.querySelectorAll('input') : [];
      if (ins.length >= 2) { setNativeValue(ins[0], dmy(d.from)); setNativeValue(ins[1], dmy(d.to)); return record('Dates on board', true); }
    }
    return record('Dates on board', false);
  }

  const box = (el, n) => (el ? el.outerHTML.slice(0, n || 800) : '(none)');
  const findText = (txt) => Array.from(document.querySelectorAll('*')).find((e) => norm(e.textContent) === norm(txt) && e.children.length < 3);

  // When a control can't be filled, dump its markup so it can be wired exactly.
  function diagnose(data) {
    if (miss.some((m) => m.startsWith('Capacity')) || miss.some((m) => m.startsWith('Vessel type'))) {
      const opt = findText('Master') || findText('Chief Mate') || findText('Motor Yacht');
      if (opt) {
        console.log('%c[Cargo→PYA] RADIO not found — send me this:', 'color:#C65A1A;font-weight:bold');
        console.log('OPTION:', box(opt), '\nPARENT:', box(opt.parentElement), '\nGRANDPARENT:', box(opt.parentElement && opt.parentElement.parentElement, 1200));
      }
    }
    if (miss.some((m) => m.startsWith('Flag'))) {
      const fl = findText('Flag') || Array.from(document.querySelectorAll('input')).find((i) => /flag|country/i.test(i.placeholder || ''));
      console.log('%c[Cargo→PYA] FLAG not filled (payload flag = ' + JSON.stringify(data.flag) + ') — send me this:', 'color:#C65A1A;font-weight:bold');
      console.log('FLAG LABEL/FIELD:', box(fl), '\nCONTAINER:', box(fl && fl.parentElement && fl.parentElement.parentElement, 1400));
    }
    if (miss.some((m) => m.startsWith('Area'))) {
      const a = findText('Caribbean') || findText('Mediterranean (West)') || findText('Atlantic Ocean');
      console.log('%c[Cargo→PYA] AREAS not ticked (payload areas = ' + JSON.stringify(data.areas) + ') — send me this:', 'color:#C65A1A;font-weight:bold');
      console.log('AREA OPTION:', box(a), '\nPARENT:', box(a && a.parentElement), '\nGRANDPARENT:', box(a && a.parentElement && a.parentElement.parentElement, 1200));
    }
  }

  function toast(msg) {
    const t = document.createElement('div');
    t.textContent = msg;
    Object.assign(t.style, { position: 'fixed', right: '20px', bottom: '72px', zIndex: 1000000, background: '#1C1B3A', color: '#fff', padding: '10px 14px', borderRadius: '8px', fontSize: '13px', fontFamily: 'system-ui,sans-serif', maxWidth: '360px', boxShadow: '0 8px 24px rgba(0,0,0,.3)' });
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 6000);
  }

  async function run(data) {
    ok = []; miss = [];
    (data.radios || []).forEach((r) => selectRadio(r.label, r.label));
    if (data.capacity) selectRadio(data.capacity, 'Capacity: ' + data.capacity);
    if (data.vesselType) selectRadio(data.vesselType, 'Vessel type: ' + data.vesselType);
    (data.areas || []).forEach((a) => checkArea(a));
    Object.keys(data.text || {}).forEach((k) => fillText(k, data.text[k]));
    Object.keys(data.service || {}).forEach((k) => fillText(k, data.service[k]));
    if (data.signatoryEmail) fillText('Signatory Email', data.signatoryEmail);
    dates(data.dates);
    await fillFlag(data.flag);
    (data.manual || []).forEach((m) => { if (miss.indexOf(m) === -1) miss.push(m); });
    console.log('%c[Cargo→PYA] payload areas:', 'color:#5E8E6F', data.areas, '| flag:', data.flag);
    diagnose(data);
    toast('Cargo → PYA (' + VERSION + '): filled ' + ok.length + ', check ' + miss.length + ' by hand. See console for details.');
    console.log('%c[Cargo→PYA ' + VERSION + '] filled:', 'color:#5E8E6F;font-weight:bold', ok);
    console.log('%c[Cargo→PYA ' + VERSION + '] do by hand:', 'color:#C65A1A;font-weight:bold', miss);
  }

  async function onFill() {
    let raw;
    try { raw = await navigator.clipboard.readText(); } catch (e) { raw = prompt('Paste the Cargo data (click "Copy for PYA" in Cargo first):'); }
    if (!raw) { toast('Nothing on the clipboard — click "Copy for PYA" in Cargo first.'); return; }
    let data;
    try { data = JSON.parse(raw); } catch (e) { toast('That clipboard content isn’t Cargo data — click "Copy for PYA" in Cargo first.'); return; }
    await run(data);
  }

  function injectButton() {
    if (document.getElementById('cargo-pya-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'cargo-pya-btn';
    btn.textContent = '⚓ Fill from Cargo';
    Object.assign(btn.style, { position: 'fixed', right: '20px', bottom: '20px', zIndex: 1000000, background: '#14132C', color: '#fff', border: '0', borderRadius: '10px', padding: '12px 16px', fontSize: '14px', fontWeight: '600', cursor: 'pointer', boxShadow: '0 8px 24px rgba(0,0,0,.25)', fontFamily: 'system-ui,sans-serif' });
    btn.addEventListener('click', onFill);
    document.body.appendChild(btn);
  }

  // Toolbar-icon click (relayed by background.js) fills too — same as the button.
  try {
    chrome.runtime.onMessage.addListener((msg) => { if (msg && msg.type === 'CARGO_PYA_FILL') onFill(); });
  } catch (e) { /* chrome.runtime not present outside the extension */ }

  // The form is a client-rendered SPA — inject once the body exists, and keep the
  // button alive across in-app navigations.
  injectButton();
  const mo = new MutationObserver(() => injectButton());
  mo.observe(document.documentElement, { childList: true, subtree: true });
  console.log('%c[Cargo→PYA] extension active (' + VERSION + '). Click the ⚓ Fill from Cargo button (bottom-right) or the toolbar icon, after "Copy for PYA" in Cargo.', 'color:#5E8E6F;font-weight:bold');
})();
