// Printable QR label for a BOX / location. Unlike itemQr (which encodes an
// item's own code for the in-app scanner), this encodes a deep-link URL to the
// inventory app filtered to the box's tag — so scanning with any phone camera
// opens the app and shows exactly what's inside that box.
//
// Same synchronous print-window pattern as itemQr.js: open the window first (so
// the popup blocker doesn't eat it), show a placeholder, then rewrite once the
// QR PNG is ready.

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Build the scannable URL for a box / physical location: the inventory root with
// the location pre-applied, which renders the flat cross-folder "what's in this
// box" view. `id` is the vessel_locations node id; `name` is carried so the
// landing view can label the chip without a lookup.
export function boxQrUrl(id, name) {
  const origin = (typeof window !== 'undefined' && window.location?.origin) || '';
  const base = `${origin}/inventory?loc=${encodeURIComponent(String(id || '').trim())}`;
  return name ? `${base}&ln=${encodeURIComponent(String(name).trim())}` : base;
}

const makeQr = async (text) => {
  const QR = (await import('qrcode')).default;
  return QR.toDataURL(text, { margin: 1, width: 420, color: { dark: '#1C1B3A', light: '#FFFFFF' } });
};

const LABEL_SIZES = [
  { id: 'sheet', name: 'Office printer (A4 sheet)', w: 0, h: 0 },
  { id: 'label100', name: 'Label 100 × 62 mm', w: 100, h: 62 },
  { id: 'dymo', name: 'Dymo 89 × 36 mm (99012)', w: 89, h: 36 },
  { id: 'brother', name: 'Brother QL 62 × 62 mm (DK-11218)', w: 62, h: 62 },
];

const LABEL_CSS = `
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body { font-family: 'Inter', system-ui, -apple-system, sans-serif; color: #1C1B3A; background: #EEF0F4; }
  .bar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; padding: 14px 18px; background: #FFFFFF; border-bottom: 1px solid #E5E7EB; position: sticky; top: 0; }
  .bar label { font: 700 9px system-ui; letter-spacing: .12em; text-transform: uppercase; color: #8B8478; }
  .bar select, .bar input { font: 500 13px 'Inter', system-ui; color: #1C1B3A; background: #FAFAF8; border: 1px solid #E5E7EB; border-radius: 9px; padding: 8px 10px; }
  .bar button { font: 600 13px 'Inter', system-ui; border-radius: 9px; padding: 9px 15px; border: 1px solid transparent; cursor: pointer; }
  .bar .print { background: #C65A1A; color: #fff; }
  .bar .png { background: #fff; color: #C65A1A; border-color: #E5E7EB; }
  .bar .hint { flex-basis: 100%; font-size: 11.5px; color: #6B7280; }
  .stage { padding: 26px; display: flex; justify-content: center; }
  .label { background: #fff; border: 1px solid #E5E7EB; border-radius: 14px; padding: 22px 24px; display: flex; align-items: center; gap: 20px; }
  .label .qr { flex: none; width: 200px; height: 200px; }
  .label .qr img { width: 100%; height: 100%; display: block; }
  .label .meta { min-width: 0; }
  .eyebrow { font: 700 9px system-ui; letter-spacing: .16em; text-transform: uppercase; color: #C65A1A; margin-bottom: 4px; }
  .name { font-family: 'DM Serif Display', Georgia, serif; font-size: 30px; line-height: 1.05; margin: 2px 0; word-break: break-word; }
  .sub { font-size: 13px; color: #6B7280; margin-top: 4px; }
  .scan { margin-top: 12px; font: 600 12px 'Inter', system-ui; color: #1C1B3A; display: inline-flex; align-items: center; gap: 6px; }
  .scan .dot { width: 7px; height: 7px; border-radius: 999px; background: #C65A1A; }
  @media print {
    body { background: #fff; }
    .bar { display: none; }
    .stage { padding: 0; }
    .label { border: 0; margin: 0 auto; }
  }
`;

// Open a print window with one QR label for a box / physical location.
// `locationId` is the vessel_locations node id the QR resolves to; `title` is the
// box/location name shown big on the label; `path` is the optional full location
// breadcrumb shown small; `count` is the item count. Pass `win` when the caller
// opened the window synchronously (popup-safe across the async QR build).
export async function printBoxQr({ locationId, title, path, count, win }) {
  const heading = String(title || 'Location').trim();
  const value = boxQrUrl(locationId, heading);
  const sub = [String(path || '').trim(), Number.isFinite(count) ? `${count} item${count === 1 ? '' : 's'}` : '']
    .filter(Boolean).join(' · ');

  let w = win || null;
  try {
    if (!w) { w = window.open('', '_blank'); if (w) { w.document.open(); w.document.write('<!doctype html><meta charset="utf-8"><title>Box QR</title><body style="font-family:system-ui;padding:40px;color:#6B7280">Preparing label…</body>'); w.document.close(); } }
  } catch { /* popup blocked */ }

  const qr = await makeQr(value).catch(() => '');
  const options = LABEL_SIZES.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  const data = JSON.stringify({
    sizes: LABEL_SIZES, qr, heading: esc(heading), sub: esc(sub),
    filename: (String(tag || 'box')).replace(/[^\w.\-]+/g, '_'),
  }).replace(/</g, '\\u003c');

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Box QR — ${esc(heading)}</title>
    <style id="page">@page{size:A4;margin:0}</style>
    <style>${LABEL_CSS}</style></head><body>
    <div class="bar">
      <label for="sz">Label size</label>
      <select id="sz">${options}<option value="custom">Custom size…</option></select>
      <span id="customwrap" style="display:none;align-items:center;gap:6px;font-size:12.5px;color:#6B7280">
        <input id="cw" type="number" min="20" max="300" step="1" value="100" style="width:64px" /> ×
        <input id="ch" type="number" min="20" max="300" step="1" value="62" style="width:64px" /> mm
      </span>
      <button class="print" onclick="window.print()">Print</button>
      <button class="png" id="dl">Download PNG</button>
      <span class="hint">Stick this on the box. Scanning it with any phone camera opens Cargo and shows everything filed in this box. Pick your label stock or <b>Custom size</b>, then <b>Print</b> or <b>Download PNG</b>.</span>
    </div>
    <div class="stage"><div class="label" id="label"></div></div>
    <script>
      var D = ${data};
      var byId = function (i) { return document.getElementById(i); };
      function labelInner() {
        var qr = D.qr ? '<div class="qr"><img src="' + D.qr + '" alt="QR code" /></div>' : '<div class="qr"></div>';
        return qr + '<div class="meta">'
          + '<div class="eyebrow">Cargo · Box</div>'
          + '<div class="name">' + D.heading + '</div>'
          + (D.sub ? '<div class="sub">' + D.sub + '</div>' : '')
          + '<div class="scan"><span class="dot"></span> Scan to view contents</div>'
          + '</div>';
      }
      function dimsFor(id) {
        if (id === 'custom') return { w: Math.max(20, Number(byId('cw').value) || 100), h: Math.max(20, Number(byId('ch').value) || 62) };
        var p = D.sizes.filter(function (s) { return s.id === id; })[0];
        return p && p.w ? { w: p.w, h: p.h } : null;
      }
      function render() {
        var id = byId('sz').value;
        byId('customwrap').style.display = id === 'custom' ? 'inline-flex' : 'none';
        var dims = dimsFor(id);
        var host = byId('label');
        host.innerHTML = labelInner();
        if (!dims) { byId('page').textContent = '@page{size:A4;margin:0}'; host.style.width = ''; host.style.height = ''; }
        else {
          byId('page').textContent = '@page{size:' + dims.w + 'mm ' + dims.h + 'mm;margin:0}';
          host.style.width = dims.w + 'mm'; host.style.height = dims.h + 'mm';
        }
      }
      byId('sz').addEventListener('change', render);
      byId('cw').addEventListener('input', function () { if (byId('sz').value === 'custom') render(); });
      byId('ch').addEventListener('input', function () { if (byId('sz').value === 'custom') render(); });
      byId('dl').addEventListener('click', function () {
        if (!D.qr) return;
        var a = document.createElement('a'); a.href = D.qr; a.download = D.filename + '.png'; a.click();
      });
      render();
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
