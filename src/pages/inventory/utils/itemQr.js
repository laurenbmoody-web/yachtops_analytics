// Printable QR code for an inventory item. The QR encodes the item's own
// barcode/QR string (the code physically stuck on the item or shelf), so the
// in-app scanner reads it straight back into the barcode field and the two
// halves form a closed loop — mint a code here, print it, scan it later.
//
// Follows the synchronous print-window pattern used by laundryLabels.js: open
// the window immediately (so the popup blocker doesn't eat it), show a
// placeholder, then rewrite once the QR PNG is ready.

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Mint a short, human-readable code for an item that has no barcode yet.
export function mintItemCode() {
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  const stamp = Date.now().toString(36).slice(-4).toUpperCase();
  return `CGO-${stamp}${rand}`;
}

const makeQr = async (text) => {
  const QR = (await import('qrcode')).default;
  return QR.toDataURL(text, { margin: 1, width: 360, color: { dark: '#1C1B3A', light: '#FFFFFF' } });
};

// Common label-printer stock. `w`/`h` are the physical label size in mm; the
// print window sets @page to match so the browser's print dialog sends the
// right dimensions straight to a Brother / Dymo / Zebra device. `sheet` is the
// office-printer fallback (a card on A4).
const LABEL_SIZES = [
  { id: 'sheet', name: 'Office printer (A4 sheet)', w: 0, h: 0 },
  { id: 'dymo', name: 'Dymo 89 × 36 mm (99012)', w: 89, h: 36 },
  { id: 'brother', name: 'Brother QL 62 × 29 mm (DK-11209)', w: 62, h: 29 },
  { id: 'zebra', name: 'Zebra 51 × 25 mm (2 × 1")', w: 51, h: 25 },
];

const LABEL_CSS = `
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body { font-family: 'Inter', system-ui, -apple-system, sans-serif; color: #1C1B3A; background: #EEF0F4; }
  .bar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; padding: 14px 18px; background: #FFFFFF; border-bottom: 1px solid #E5E2DA; position: sticky; top: 0; }
  .bar label { font: 700 9px system-ui; letter-spacing: .12em; text-transform: uppercase; color: #8B8478; }
  .bar select { font: 500 13px 'Inter', system-ui; color: #1C1B3A; background: #FAFAF8; border: 1px solid #E5E2DA; border-radius: 9px; padding: 8px 10px; }
  .bar button { font: 600 13px 'Inter', system-ui; border-radius: 9px; padding: 9px 15px; border: 1px solid transparent; cursor: pointer; }
  .bar .print { background: #C65A1A; color: #fff; }
  .bar .png { background: #fff; color: #C65A1A; border-color: #E5E2DA; }
  .bar .hint { flex-basis: 100%; font-size: 11.5px; color: #6B7280; }
  .stage { display: flex; justify-content: center; padding: 26px; }
  .label { background: #fff; display: flex; align-items: center; gap: 12px; }
  .label.card { width: 320px; flex-direction: column; text-align: center; border: 1px solid #E5E2DA; border-radius: 14px; padding: 22px; }
  .label.tag { border: 1px dashed #C9CDD6; padding: 3mm 4mm; }
  .label .qr { flex: none; }
  .label.card .qr { width: 200px; height: 200px; }
  .label.tag .qr { width: 20mm; height: 20mm; }
  .label .qr img { width: 100%; height: 100%; display: block; }
  .label .meta { min-width: 0; }
  .label.card .meta { width: 100%; }
  .label.tag .meta { text-align: left; }
  .eyebrow { font: 700 9px system-ui; letter-spacing: .16em; text-transform: uppercase; color: #C65A1A; }
  .label.card .name { font-family: 'DM Serif Display', Georgia, serif; font-size: 22px; line-height: 1.1; margin: 6px 0 2px; word-break: break-word; }
  .label.tag .name { font: 700 11px system-ui; line-height: 1.15; margin: 0 0 1mm; word-break: break-word; }
  .sub { font-size: 11px; color: #6B7280; }
  .label.card .code { margin-top: 14px; }
  .code { font: 700 12px 'Inter', system-ui; letter-spacing: .04em; color: #1C1B3A; word-break: break-all; }
  @media print {
    body { background: #fff; }
    .bar { display: none; }
    .stage { padding: 0; }
    .label.card { margin: 14mm auto; border: 0; }
    .label.tag { border: 0; }
  }
`;

// Open a print window with one QR label for an item. `code` is the string the
// QR encodes (and that the scanner reads back). The window lets the user pick a
// label-printer size (Dymo / Brother / Zebra) or download the QR as a PNG for
// their label software. Pass `win` when the caller already opened the window
// synchronously (popup-safe across an async mint).
export async function printItemQr({ code, name, brand, location, win }) {
  const value = String(code || '').trim();
  if (!value) return;

  let w = win || null;
  try {
    if (!w) { w = window.open('', '_blank'); if (w) { w.document.open(); w.document.write('<!doctype html><meta charset="utf-8"><title>QR label</title><body style="font-family:system-ui;padding:40px;color:#6B7280">Preparing label…</body>'); w.document.close(); } }
  } catch { /* popup blocked */ }

  const qr = await makeQr(value).catch(() => '');
  const sub = [brand, location].filter(Boolean).map(esc).join(' · ');
  const options = LABEL_SIZES.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  const data = JSON.stringify({ sizes: LABEL_SIZES, qr, code: value, filename: (value || 'qr').replace(/[^\w.\-]+/g, '_') }).replace(/</g, '\\u003c');

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>QR — ${esc(name || value)}</title>
    <style id="page">@page{size:A4;margin:0}</style>
    <style>${LABEL_CSS}</style></head><body>
    <div class="bar">
      <label for="sz">Label size</label>
      <select id="sz">${options}<option value="custom">Custom size…</option></select>
      <span id="customwrap" style="display:none;align-items:center;gap:6px;font-size:12.5px;color:#6B7280">
        <input id="cw" type="number" min="10" max="300" step="1" value="50" style="width:64px;font:500 13px 'Inter',system-ui;border:1px solid #E5E2DA;border-radius:8px;padding:7px 8px" /> ×
        <input id="ch" type="number" min="10" max="300" step="1" value="25" style="width:64px;font:500 13px 'Inter',system-ui;border:1px solid #E5E2DA;border-radius:8px;padding:7px 8px" /> mm
      </span>
      <button class="print" onclick="window.print()">Print</button>
      <button class="png" id="dl">Download PNG</button>
      <span class="hint">Pick your label stock (or set a <b>Custom size</b>), then <b>Print</b> and choose your Brother / Dymo / Zebra printer — or <b>Download PNG</b> to drop into P-touch Editor, Dymo Connect or Zebra software.</span>
    </div>
    <div class="stage">
      <div class="label card" id="label">
        <div class="qr">${qr ? `<img src="${esc(qr)}" alt="QR code" />` : ''}</div>
        <div class="meta">
          <div class="eyebrow">Cargo · Inventory</div>
          <div class="name">${esc(name || 'Inventory item')}</div>
          ${sub ? `<div class="sub">${sub}</div>` : ''}
          <div class="code">${esc(value)}</div>
        </div>
      </div>
    </div>
    <script>
      var D = ${data};
      var byId = function (i) { return document.getElementById(i); };
      function tag(w, h) {
        var label = byId('label');
        byId('page').textContent = '@page{size:' + w + 'mm ' + h + 'mm;margin:0}';
        label.className = 'label tag';
        label.style.width = w + 'mm'; label.style.height = h + 'mm';
      }
      function applySize(id) {
        byId('customwrap').style.display = id === 'custom' ? 'inline-flex' : 'none';
        if (id === 'custom') {
          var w = Math.max(10, Number(byId('cw').value) || 50);
          var h = Math.max(10, Number(byId('ch').value) || 25);
          tag(w, h);
          return;
        }
        var p = D.sizes.filter(function (s) { return s.id === id; })[0] || D.sizes[0];
        if (p.w) { tag(p.w, p.h); }
        else {
          var label = byId('label');
          byId('page').textContent = '@page{size:A4;margin:0}';
          label.className = 'label card';
          label.style.width = ''; label.style.height = '';
        }
      }
      byId('sz').addEventListener('change', function (e) { applySize(e.target.value); });
      byId('cw').addEventListener('input', function () { if (byId('sz').value === 'custom') applySize('custom'); });
      byId('ch').addEventListener('input', function () { if (byId('sz').value === 'custom') applySize('custom'); });
      byId('dl').addEventListener('click', function () {
        if (!D.qr) return;
        var a = document.createElement('a'); a.href = D.qr; a.download = D.filename + '.png'; a.click();
      });
    </script>
  </body></html>`;

  try {
    if (!w) w = window.open('', '_blank');
    if (!w) return;
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
  } catch (e) { /* user can print manually */ }
}
