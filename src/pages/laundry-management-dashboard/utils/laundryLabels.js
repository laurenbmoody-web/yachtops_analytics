// Printable QR garment labels for laundry items.
//
// Each label carries a QR that encodes a deep link back into the laundry
// dashboard (`?scan=<id>`). A crew member scans it with their phone's own
// camera — no app-side scanner needed — and the item opens pre-filled with
// owner, cabin and care. The same code is read by the in-app scanner where
// the browser supports BarcodeDetector.
//
// Follows the self-contained print-window pattern used by laundryReport.js:
// open the window synchronously (so it isn't caught by the popup blocker),
// show a "Preparing…" placeholder, then rewrite once the QR PNGs are ready.

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Deep link a scan resolves to. Encoded in the QR and parsed by parseScan().
export function scanUrlFor(id) {
  const origin = (typeof window !== 'undefined' && window.location) ? window.location.origin : '';
  return `${origin}/laundry-management-dashboard?scan=${encodeURIComponent(id)}`;
}

// Read a laundry item id out of a scanned value — accepts either the full
// deep-link URL or a bare id, so a hand-typed code also works.
export function parseScan(value) {
  if (!value) return null;
  const raw = String(value).trim();
  try {
    const u = new URL(raw);
    const s = u.searchParams.get('scan');
    if (s) return s;
  } catch { /* not a URL — fall through */ }
  const m = raw.match(/scan=([^&\s]+)/);
  if (m) return decodeURIComponent(m[1]);
  return raw; // treat as a bare id
}

const makeQr = async (text) => {
  const QR = (await import('qrcode')).default;
  return QR.toDataURL(text, { margin: 0, width: 300, color: { dark: '#1C1B3A', light: '#FFFFFF' } });
};

const ownerLabel = (it) => {
  const k = (it?.ownerType || '').toLowerCase();
  if (k === 'guest') return it?.ownerName || 'Guest';
  if (k === 'crew') return it?.ownerName || 'Crew';
  if (k === 'other') return 'Other';
  return it?.ownerName || 'Unassigned';
};

const careTags = (it) => (Array.isArray(it?.tags) ? it.tags : [])
  .map((t) => String(t).replace(/[-_]/g, ' '))
  .slice(0, 3);

const labelCard = (it, qr) => {
  const tags = careTags(it);
  return `<div class="lbl">
    <div class="lbl-qr"><img src="${esc(qr)}" alt="scan" /></div>
    <div class="lbl-body">
      <div class="lbl-top">
        ${it.laundryNumber ? `<span class="lbl-no">No. ${esc(it.laundryNumber)}</span>` : ''}
        <span class="lbl-owner">${esc(ownerLabel(it))}</span>
      </div>
      <div class="lbl-desc">${esc(it.description || 'Laundry item')}</div>
      <div class="lbl-meta">
        ${it.area ? `<span class="lbl-cabin">${esc(it.area)}</span>` : ''}
        ${it.colour ? `<span class="lbl-dot">·</span><span>${esc(it.colour)}</span>` : ''}
      </div>
      ${tags.length ? `<div class="lbl-tags">${tags.map((t) => `<span class="lbl-tag">${esc(t)}</span>`).join('')}</div>` : ''}
      <div class="lbl-foot">CARGO · Scan to open</div>
    </div>
  </div>`;
};

const SHEET_CSS = `
  * { box-sizing: border-box; }
  body { font-family: 'Inter', system-ui, -apple-system, sans-serif; color: #1C1B3A; margin: 0; padding: 16px; background: #FFFFFF; }
  .sheet-head { display: flex; align-items: baseline; justify-content: space-between; border-bottom: 2px solid #1C1B3A; padding-bottom: 8px; margin-bottom: 14px; }
  .sheet-head h1 { font-family: 'DM Serif Display', Georgia, serif; font-weight: 400; font-size: 18px; margin: 0; }
  .sheet-head span { font: 700 9px system-ui; letter-spacing: 0.12em; text-transform: uppercase; color: #8B8478; }
  .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
  .lbl { display: flex; gap: 12px; align-items: stretch; border: 1px solid #D9D6CE; border-radius: 10px; padding: 12px 14px; break-inside: avoid; page-break-inside: avoid; min-height: 104px; }
  .lbl-qr { flex: none; width: 84px; display: flex; align-items: center; justify-content: center; }
  .lbl-qr img { width: 84px; height: 84px; }
  .lbl-body { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .lbl-top { display: flex; align-items: baseline; gap: 8px; }
  .lbl-no { font: 800 10px system-ui; letter-spacing: 0.04em; color: #C65A1A; }
  .lbl-owner { font: 700 10px system-ui; letter-spacing: 0.02em; color: #6B7280; margin-left: auto; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .lbl-desc { font-family: 'DM Serif Display', Georgia, serif; font-size: 16px; line-height: 1.1; margin: 3px 0 2px; word-break: break-word; }
  .lbl-meta { font-size: 11px; color: #6B7280; display: flex; align-items: center; gap: 5px; }
  .lbl-cabin { font-weight: 700; color: #1C1B3A; }
  .lbl-dot { color: #AEB4C2; }
  .lbl-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 5px; }
  .lbl-tag { font: 700 7.5px system-ui; letter-spacing: 0.05em; text-transform: uppercase; color: #B7791F; background: #FBF1DF; border-radius: 999px; padding: 2px 7px; }
  .lbl-foot { margin-top: auto; font: 700 7.5px system-ui; letter-spacing: 0.1em; text-transform: uppercase; color: #AEB4C2; padding-top: 6px; }
  @media print { body { padding: 10mm; } .grid { gap: 8px; } }
`;

// Open a print window with a QR label for each item.
export async function printLaundryLabels(items) {
  const list = (items || []).filter((it) => it && it.id);
  if (!list.length) return;
  let w = null;
  try {
    w = window.open('', '_blank');
    if (w) { w.document.open(); w.document.write('<!doctype html><meta charset="utf-8"><title>Laundry labels</title><body style="font-family:system-ui;padding:40px;color:#6B7280">Preparing labels…</body>'); w.document.close(); }
  } catch { /* popup blocked */ }

  const qrs = await Promise.all(list.map((it) => makeQr(scanUrlFor(it.id)).catch(() => '')));
  const cards = list.map((it, i) => labelCard(it, qrs[i])).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Laundry labels</title><style>${SHEET_CSS}</style></head><body>
    <div class="sheet-head"><h1>Laundry labels</h1><span>${list.length} item${list.length === 1 ? '' : 's'}</span></div>
    <div class="grid">${cards}</div>
  </body></html>`;

  try {
    if (!w) w = window.open('', '_blank');
    if (!w) return;
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => { try { w.print(); } catch (e) { /* user can print manually */ } }, 350);
  } catch (e) { /* window closed */ }
}
