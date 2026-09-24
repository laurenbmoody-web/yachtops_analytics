// Bulk QR sheet — many DIFFERENT codes tiled onto printable pages. Default target
// is a standard A4 label sheet of 24 × 40 mm square labels (4 columns × 6 rows),
// so each QR lands on one pre-cut label. Also supports an auto-fill office sheet
// and single-label roll sizes (Brother / Dymo / Zebra).
//
// Each entry is { value, name, sub }, where `value` is the exact string the QR
// encodes (an item's own code, or a box's deep-link URL from locationQr).

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const makeQr = async (text) => {
  const QR = (await import('qrcode')).default;
  return QR.toDataURL(String(text || ''), { margin: 1, width: 360, color: { dark: '#1C1B3A', light: '#FFFFFF' } });
};

// grid: fixed square-label A4 sheets (cols × rows of `cell` mm). w/h: single-label
// roll stock (one label per page). Neither: auto-fill office A4.
const LABEL_SIZES = [
  { id: 'sheet24', name: 'A4 sheet · 24 labels (40 × 40 mm)', grid: { cols: 4, rows: 6, cell: 40 } },
  { id: 'sheetauto', name: 'A4 sheet · auto-fill (any size)' },
  { id: 'dymo', name: 'Dymo 89 × 36 mm (99012)', w: 89, h: 36 },
  { id: 'brother', name: 'Brother QL 62 × 29 mm (DK-11209)', w: 62, h: 29 },
  { id: 'label100', name: 'Label 100 × 62 mm', w: 100, h: 62 },
  { id: 'zebra', name: 'Zebra 51 × 25 mm (2 × 1")', w: 51, h: 25 },
];

const CSS = `
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body { font-family: 'Inter', system-ui, -apple-system, sans-serif; color: #1C1B3A; background: #EEF0F4; }
  .bar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; padding: 14px 18px; background: #FFFFFF; border-bottom: 1px solid #E5E7EB; position: sticky; top: 0; z-index: 2; }
  .bar label { font: 700 9px system-ui; letter-spacing: .12em; text-transform: uppercase; color: #8B8478; }
  .bar select { font: 500 13px 'Inter', system-ui; color: #1C1B3A; background: #FAFAF8; border: 1px solid #E5E7EB; border-radius: 9px; padding: 8px 10px; }
  .bar button { font: 600 13px 'Inter', system-ui; border-radius: 9px; padding: 9px 15px; border: 1px solid transparent; cursor: pointer; }
  .bar .print { background: #C65A1A; color: #fff; }
  .bar .count { font: 600 12.5px 'Inter'; color: #6B7280; }
  .bar .hint { flex-basis: 100%; font-size: 11.5px; color: #6B7280; }
  .stage { padding: 20px; display: flex; flex-direction: column; align-items: center; gap: 14px; }

  /* Auto-fill office grid */
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; width: 100%; }
  .card { background: #fff; border: 1px solid #E5E7EB; border-radius: 10px; padding: 10px; text-align: center; break-inside: avoid; }
  .card .qr { width: 108px; height: 108px; margin: 0 auto; }
  .card .qr img { width: 100%; height: 100%; display: block; }
  .card .eyebrow { font: 700 8px system-ui; letter-spacing: .16em; text-transform: uppercase; color: #C65A1A; margin-top: 6px; }
  .card .name { font: 700 13px 'Inter', system-ui; line-height: 1.15; margin: 2px 0 1px; word-break: break-word; }
  .card .sub { font-size: 10px; color: #6B7280; word-break: break-word; }
  .card .code { font: 700 9.5px 'Inter', system-ui; letter-spacing: .03em; color: #1C1B3A; margin-top: 4px; word-break: break-all; }

  /* Fixed square-label A4 sheet (e.g. 24 × 40 mm) */
  .sheet-page { background: #fff; width: 210mm; box-shadow: 0 2px 14px rgba(28,27,58,.12); display: grid; }
  .cell { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; overflow: hidden; }
  .cell .qr { flex: none; }
  .cell .qr img { width: 100%; height: 100%; display: block; }
  .cell .name { font: 700 7pt 'Inter', system-ui; line-height: 1.05; margin-top: 1mm; word-break: break-word; max-width: 100%; }
  .cell .code { font: 700 6pt 'Inter', system-ui; color: #6B7280; word-break: break-all; }

  /* Roll (one label per page) */
  .tags { display: none; }

  @media screen { .sheet-page { margin: 0 auto; } }
  @media print {
    body { background: #fff; }
    .bar { display: none; }
    .stage { padding: 0; gap: 0; }
    .grid { padding: 8mm; }
    .grid .card { border: 1px solid #E5E7EB; }
    .sheet-page { box-shadow: none; break-after: page; page-break-after: always; }
    .sheet-page:last-child { break-after: auto; page-break-after: auto; }
    body.rollmode .grid, body.rollmode .sheet-page { display: none; }
    body.rollmode .tags { display: block; }
    .tag { break-after: page; page-break-after: always; display: flex; align-items: center; gap: 5mm; padding: 3mm; }
    .tag:last-child { break-after: auto; page-break-after: auto; }
    .tag .qr img { width: 100%; height: 100%; display: block; }
    .tag .name { font: 700 11px system-ui; line-height: 1.15; word-break: break-word; }
    .tag .sub { font-size: 9px; color: #6B7280; }
    .tag .code { font: 700 9px 'Inter'; margin-top: 1mm; word-break: break-all; }
  }
`;

/**
 * Open a print window that tiles every entry's QR onto label pages.
 * @param {{ title?: string, entries: Array<{value:string,name?:string,sub?:string}> }} opts
 */
export async function printQrSheet({ title = 'QR labels', entries = [], win = null }) {
  const list = (entries || []).filter((e) => e && String(e.value || '').trim());
  if (!list.length) return;

  // Prefer a window the caller opened synchronously inside the click (popup-safe
  // across the async QR generation below); otherwise open one now.
  let w = win || null;
  try {
    if (!w) w = window.open('', '_blank');
    if (w) { w.document.open(); w.document.write(`<!doctype html><meta charset="utf-8"><title>${esc(title)}</title><body style="font-family:system-ui;padding:40px;color:#6B7280">Preparing ${list.length} QR labels…</body>`); w.document.close(); }
  } catch { /* popup blocked */ }

  // `code` is an OPTIONAL short caption printed under the QR (e.g. an item's
  // own code). It is NOT the encoded value — box labels encode a long URL that
  // we never want printed, so they simply omit `code`.
  const withQr = await Promise.all(list.map(async (e) => ({
    name: esc(e.name || ''), sub: esc(e.sub || ''), code: e.code ? esc(e.code) : '', qr: await makeQr(e.value).catch(() => ''),
  })));

  const data = JSON.stringify({ sizes: LABEL_SIZES, title: esc(title), items: withQr }).replace(/</g, '\\u003c');
  const options = LABEL_SIZES.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
    <style id="page">@page{size:A4;margin:0}</style>
    <style>${CSS}</style></head><body>
    <div class="bar">
      <label for="sz">Label stock</label>
      <select id="sz">${options}</select>
      <button class="print" onclick="window.print()">Print</button>
      <span class="count">${withQr.length} labels · ${esc(title)}</span>
      <span class="hint">Default is a standard <b>A4 sheet of 24 × 40 mm square labels</b> (4 × 6) — each QR lands on one pre-cut label; more than 24 flows onto extra sheets. Print at <b>100% / actual size</b> (no "fit to page") so it lines up. Or pick an auto-fill sheet, or a roll size for a Brother / Dymo / Zebra label printer.</span>
    </div>
    <div class="stage">
      <div class="grid" id="grid" style="display:none"></div>
      <div id="sheets"></div>
      <div class="tags" id="tags"></div>
    </div>
    <script>
      var D = ${data};
      var byId = function (i) { return document.getElementById(i); };

      function cardHtml(it) {
        return '<div class="card">'
          + (it.qr ? '<div class="qr"><img src="' + it.qr + '"/></div>' : '<div class="qr"></div>')
          + '<div class="eyebrow">Cargo</div>'
          + (it.name ? '<div class="name">' + it.name + '</div>' : '')
          + (it.sub ? '<div class="sub">' + it.sub + '</div>' : '')
          + (it.code ? '<div class="code">' + it.code + '</div>' : '') + '</div>';
      }

      // Fixed square-label sheets: pages of cols x rows cells at cell mm.
      function buildSheets(g) {
        var perPage = g.cols * g.rows;
        var pages = Math.max(1, Math.ceil(D.items.length / perPage));
        var qmm = Math.round(g.cell * 0.62); // QR ~62% of the label; rest for caption
        var padH = (210 - g.cols * g.cell) / 2;      // centre the label block on A4
        var padV = (297 - g.rows * g.cell) / 2;
        var html = '';
        for (var pg = 0; pg < pages; pg++) {
          html += '<div class="sheet-page" style="height:297mm;padding:' + padV + 'mm ' + padH + 'mm;'
            + 'grid-template-columns:repeat(' + g.cols + ',' + g.cell + 'mm);'
            + 'grid-template-rows:repeat(' + g.rows + ',' + g.cell + 'mm)">';
          for (var i = 0; i < perPage; i++) {
            var it = D.items[pg * perPage + i];
            if (!it) { html += '<div class="cell"></div>'; continue; }
            html += '<div class="cell" style="padding:1mm">'
              + (it.qr ? '<div class="qr" style="width:' + qmm + 'mm;height:' + qmm + 'mm"><img src="' + it.qr + '"/></div>' : '')
              + (it.name ? '<div class="name">' + it.name + '</div>' : '')
              + (it.code ? '<div class="code">' + it.code + '</div>' : '') + '</div>';
          }
          html += '</div>';
        }
        return html;
      }

      function buildTags(p) {
        var qpx = Math.round(Math.min(p.w, p.h) * 3.2);
        return D.items.map(function (it) {
          return '<div class="tag" style="width:' + p.w + 'mm;height:' + p.h + 'mm">'
            + (it.qr ? '<div class="qr" style="width:' + qpx + 'px;height:' + qpx + 'px"><img src="' + it.qr + '"/></div>' : '')
            + '<div class="meta"><div class="name">' + (it.name || '') + '</div>'
            + (it.sub ? '<div class="sub">' + it.sub + '</div>' : '')
            + (it.code ? '<div class="code">' + it.code + '</div>' : '') + '</div></div>';
        }).join('');
      }

      function apply() {
        var id = byId('sz').value;
        var p = D.sizes.filter(function (s) { return s.id === id; })[0] || {};
        document.body.classList.remove('rollmode');
        byId('grid').style.display = 'none';
        byId('grid').innerHTML = '';
        byId('sheets').innerHTML = '';
        byId('tags').innerHTML = '';
        if (p.grid) {
          byId('page').textContent = '@page{size:A4;margin:0}';
          byId('sheets').innerHTML = buildSheets(p.grid);
        } else if (p.w) {
          document.body.classList.add('rollmode');
          byId('page').textContent = '@page{size:' + p.w + 'mm ' + p.h + 'mm;margin:0}';
          byId('tags').innerHTML = buildTags(p);
        } else {
          byId('page').textContent = '@page{size:A4;margin:8mm}';
          byId('grid').style.display = 'grid';
          byId('grid').innerHTML = D.items.map(cardHtml).join('');
        }
      }
      byId('sz').addEventListener('change', apply);
      apply();
    </script>
  </body></html>`;

  try {
    if (!w) w = window.open('', '_blank');
    if (!w) return;
    w.document.open(); w.document.write(html); w.document.close(); w.focus();
  } catch { /* user can retry */ }
}
