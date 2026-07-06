// The PYA autofill bookmarklet.
//
// A self-contained function the user saves to their bookmarks bar ONCE. When
// clicked on the PYA "Verify Sea Service Testimonial" create page, it reads the
// payload the Cargo app copied to the clipboard (JSON built by ./pyaPayload.js)
// and types it into the live form, matching each field by its VISIBLE LABEL and
// using the React-aware native value setter so the SPA registers the input.
//
// It's deliberately conservative: text/number boxes, the format/SST/capacity/
// vessel-type radios and the dates range are filled; the flag picker and
// areas-cruised checkboxes are left for the user. It always finishes with an
// alert summarising what filled and what to do by hand — nothing is submitted.
//
// The function references NO outer scope, so `.toString()` gives a portable
// bookmarklet. It runs on member.pya.org, not in the Cargo app.

/* eslint-disable */
function pyaFiller() {
  function run(raw) {
    var data;
    try { data = JSON.parse(raw); }
    catch (e) { alert('Cargo → PYA\n\nCouldn’t read the copied data. In Cargo, click “Copy details for PYA” first, then run this bookmark again.'); return; }

    var ok = [], miss = [];
    function norm(s) { return (s || '').replace(/[ⓘ\*•]/g, '').replace(/\s+/g, ' ').trim().toLowerCase(); }
    function setNative(el, val) {
      var proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      var desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) desc.set.call(el, val); else el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
    }
    function leaves() {
      return Array.prototype.slice.call(document.querySelectorAll('label,span,div,p,strong,legend,h3,h4'))
        .filter(function (el) { return el.children.length === 0 && el.textContent && el.textContent.trim(); });
    }
    function labelEls(text) { var t = norm(text); return leaves().filter(function (el) { return norm(el.textContent) === t; }); }
    function containerInput(labelEl) {
      var el = labelEl;
      for (var up = 0; up < 5 && el; up++) {
        if (el.querySelector) {
          var inp = el.querySelector('input:not([type=radio]):not([type=checkbox]):not([type=hidden]),textarea');
          if (inp) return inp;
        }
        el = el.parentElement;
      }
      return null;
    }
    function fillText(label, val) {
      if (val == null || val === '') return;
      var ls = labelEls(label);
      for (var i = 0; i < ls.length; i++) { var inp = containerInput(ls[i]); if (inp) { setNative(inp, String(val)); ok.push(label); return; } }
      miss.push(label);
    }
    // Select a radio/checkbox by its visible option text. The option label often
    // wraps the control (e.g. <label><span class=circle/>Chief Mate</label>), so
    // matching only childless leaves misses it — match a whole <label>/role node
    // and click the real input inside (or the node itself).
    function clickOption(text, name) {
      var t = norm(text);
      // 1) a <label> whose text matches → its wrapped input, or the input it's `for`
      var labels = document.querySelectorAll('label');
      for (var i = 0; i < labels.length; i++) {
        if (norm(labels[i].textContent) === t) {
          var inp = labels[i].querySelector('input[type=radio],input[type=checkbox]');
          if (!inp && labels[i].htmlFor) inp = document.getElementById(labels[i].htmlFor);
          (inp || labels[i]).click();
          ok.push(name || text); return true;
        }
      }
      // 2) an ARIA radio/checkbox/option with matching text
      var roles = document.querySelectorAll('[role=radio],[role=checkbox],[role=option],[role=menuitemradio]');
      for (var i = 0; i < roles.length; i++) {
        if (norm(roles[i].textContent) === t) { roles[i].click(); ok.push(name || text); return true; }
      }
      // 3) any element whose text matches → walk up to a radio/checkbox input, else click it
      var all = document.querySelectorAll('button,div,span,li,p,a');
      for (var i = 0; i < all.length; i++) {
        if (norm(all[i].textContent) !== t) continue;
        var scope = all[i];
        for (var up = 0; up < 4 && scope; up++) {
          var input = scope.querySelector && scope.querySelector('input[type=radio],input[type=checkbox]');
          if (input) { input.click(); ok.push(name || text); return true; }
          scope = scope.parentElement;
        }
        all[i].click(); ok.push(name || text); return true;
      }
      miss.push(name || text); return false;
    }

    // Tick an "areas cruised" checkbox by label — idempotent (skip if already on).
    function checkArea(text) {
      var t = norm(text);
      var labels = document.querySelectorAll('label');
      for (var i = 0; i < labels.length; i++) {
        if (norm(labels[i].textContent) === t) {
          var inp = labels[i].querySelector('input[type=checkbox]');
          if (!inp && labels[i].htmlFor) inp = document.getElementById(labels[i].htmlFor);
          if (inp) { if (!inp.checked) inp.click(); ok.push('Area: ' + text); return; }
          labels[i].click(); ok.push('Area: ' + text); return;
        }
      }
      var all = document.querySelectorAll('label,div,span,li,button');
      for (var i = 0; i < all.length; i++) {
        if (norm(all[i].textContent) !== t) continue;
        var scope = all[i];
        for (var up = 0; up < 4 && scope; up++) {
          var cb = scope.querySelector && scope.querySelector('input[type=checkbox]');
          if (cb) { if (!cb.checked) cb.click(); ok.push('Area: ' + text); return; }
          scope = scope.parentElement;
        }
      }
      miss.push('Area: ' + text);
    }

    (data.radios || []).forEach(function (r) { clickOption(r.label, r.label); });
    if (data.capacity) clickOption(data.capacity, 'Capacity: ' + data.capacity);
    if (data.vesselType) clickOption(data.vesselType, 'Vessel type: ' + data.vesselType);
    (data.areas || []).forEach(function (a) { checkArea(a); });
    Object.keys(data.text || {}).forEach(function (k) { fillText(k, data.text[k]); });
    Object.keys(data.service || {}).forEach(function (k) { fillText(k, data.service[k]); });
    if (data.signatoryEmail) fillText('Signatory Email', data.signatoryEmail);

    if (data.dates && data.dates.from) {
      var dmy = function (iso) { var p = (iso || '').split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : ''; };
      var ls = labelEls('Dates on board'), done = false;
      if (ls.length) {
        var cont = ls[0];
        for (var up = 0; up < 6 && cont; up++) { if (cont.querySelectorAll && cont.querySelectorAll('input').length >= 2) break; cont = cont.parentElement; }
        var ins = cont ? cont.querySelectorAll('input') : [];
        if (ins.length >= 2) { setNative(ins[0], dmy(data.dates.from)); setNative(ins[1], dmy(data.dates.to)); ok.push('Dates on board'); done = true; }
      }
      if (!done) miss.push('Dates on board');
    }

    (data.manual || []).forEach(function (m) { if (miss.indexOf(m) === -1) miss.push(m); });

    alert('Cargo → PYA autofill\n\n✓ Filled (' + ok.length + '):\n' + (ok.join(', ') || '—') +
      '\n\n→ Do these by hand (' + miss.length + '):\n' + (miss.join(', ') || '—') +
      '\n\nAlways check every field against your own records before you submit.');
  }

  if (navigator.clipboard && navigator.clipboard.readText) {
    navigator.clipboard.readText().then(run, function () { var p = prompt('Paste the copied Cargo data:'); if (p) run(p); });
  } else {
    var p = prompt('Paste the copied Cargo data:'); if (p) run(p);
  }
}
/* eslint-enable */

// The draggable bookmarklet URL. Percent-encoded so the browser decodes it back
// to valid JS on execution (standard bookmarklet packaging).
export const PYA_BOOKMARKLET_HREF = 'javascript:' + encodeURIComponent('(' + pyaFiller.toString() + ')();');

/** The clipboard string Cargo writes for the bookmarklet to read. */
export const buildPyaClipboard = (payload) => JSON.stringify(payload);
