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

const laundryOrigin = () => (typeof window !== 'undefined' && window.location) ? window.location.origin : '';

// Deep link an item label resolves to. Encoded in the QR and parsed below.
export function scanUrlFor(id) {
  return `${laundryOrigin()}/laundry-management-dashboard?scan=${encodeURIComponent(id)}`;
}

// Deep link a case label resolves to.
export function caseScanUrlFor(id) {
  return `${laundryOrigin()}/laundry-management-dashboard?case=${encodeURIComponent(id)}`;
}

// Read a laundry item id out of a scanned value — accepts either the full
// deep-link URL or a bare id, so a hand-typed code also works.
export function parseScan(value) {
  return parseScanTarget(value)?.id || null;
}

// Resolve a scanned value to its kind + id. A `case=` deep link is a case; a
// `scan=` deep link (or a bare value) is an item.
export function parseScanTarget(value) {
  if (!value) return null;
  const raw = String(value).trim();
  try {
    const u = new URL(raw);
    const c = u.searchParams.get('case');
    if (c) return { kind: 'case', id: c };
    const s = u.searchParams.get('scan');
    if (s) return { kind: 'item', id: s };
  } catch { /* not a URL — fall through */ }
  const cm = raw.match(/case=([^&\s]+)/);
  if (cm) return { kind: 'case', id: decodeURIComponent(cm[1]) };
  const m = raw.match(/scan=([^&\s]+)/);
  if (m) return { kind: 'item', id: decodeURIComponent(m[1]) };
  return { kind: 'item', id: raw }; // bare id → item
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
  } catch (e) { /* user can print manually */ }
}

const CASE_CSS = `
  * { box-sizing: border-box; }
  body { font-family: 'Inter', system-ui, -apple-system, sans-serif; color: #1C1B3A; margin: 0; padding: 28px 32px; background: #FFFFFF; }
  .ch { display: flex; gap: 22px; align-items: flex-start; border-bottom: 2px solid #1C1B3A; padding-bottom: 18px; margin-bottom: 18px; }
  .ch-qr { flex: none; width: 132px; height: 132px; border: 1px solid #ECEAE3; border-radius: 10px; padding: 7px; }
  .ch-qr img { width: 100%; height: 100%; }
  .ch-id { flex: 1; min-width: 0; }
  .ch-eyebrow { font: 700 10px system-ui; letter-spacing: 0.14em; text-transform: uppercase; color: #C65A1A; }
  .ch-name { font-family: 'DM Serif Display', Georgia, serif; font-size: 32px; line-height: 1.02; margin: 4px 0 8px; word-break: break-word; }
  .ch-meta { display: flex; flex-wrap: wrap; gap: 8px 18px; font-size: 12.5px; color: #6B7280; }
  .ch-meta b { color: #1C1B3A; font-weight: 700; }
  .ch-status { font: 700 9px system-ui; letter-spacing: 0.08em; text-transform: uppercase; color: #C65A1A; background: #FBEFE9; border-radius: 999px; padding: 3px 10px; }
  h2 { font: 700 9px system-ui; letter-spacing: 0.13em; text-transform: uppercase; color: #8B8478; margin: 0 0 8px; }
  table { width: 100%; border-collapse: collapse; }
  th { font: 700 8px system-ui; letter-spacing: 0.08em; text-transform: uppercase; color: #AEB4C2; text-align: left; padding: 4px 10px 6px 0; border-bottom: 1px solid #ECECEE; }
  td { padding: 8px 10px 8px 0; font-size: 12.5px; border-bottom: 1px solid #F0F1F5; vertical-align: top; }
  td.no { color: #C65A1A; font-weight: 700; width: 54px; }
  td.own { color: #6B7280; width: 26%; }
  td.cab { color: #6B7280; width: 20%; }
  .dn { font-weight: 600; }
  .empty { color: #AEB4C2; font-size: 13px; padding: 16px 0; }
  .foot { margin-top: 22px; padding-top: 10px; border-top: 1px solid #ECECEE; font: 700 8px system-ui; letter-spacing: 0.1em; text-transform: uppercase; color: #AEB4C2; }
  @media print { body { padding: 14mm; } }
`;

// Print a case: a big scannable case QR + a manifest of everything packed in it.
export async function printCaseManifest(caseObj, items) {
  if (!caseObj?.id) return;
  const list = (items || []).filter(Boolean);
  let w = null;
  try {
    w = window.open('', '_blank');
    if (w) { w.document.open(); w.document.write('<!doctype html><meta charset="utf-8"><title>Case</title><body style="font-family:system-ui;padding:40px;color:#6B7280">Preparing case…</body>'); w.document.close(); }
  } catch { /* popup blocked */ }

  const qr = await makeQr(caseScanUrlFor(caseObj.id)).catch(() => '');
  const rows = list.length
    ? list.map((it, i) => `<tr>
        <td class="no">${it.laundryNumber ? esc(it.laundryNumber) : String(i + 1)}</td>
        <td><span class="dn">${esc(it.description || 'Laundry item')}</span>${it.colour ? ` · ${esc(it.colour)}` : ''}</td>
        <td class="own">${esc(ownerLabel(it))}</td>
        <td class="cab">${esc(it.area || '—')}</td>
      </tr>`).join('')
    : `<tr><td colspan="4" class="empty">No items packed yet.</td></tr>`;

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Case — ${esc(caseObj.name)}</title><style>${CASE_CSS}</style></head><body>
    <div class="ch">
      <div class="ch-qr"><img src="${esc(qr)}" alt="scan case" /></div>
      <div class="ch-id">
        <div class="ch-eyebrow">Laundry case</div>
        <div class="ch-name">${esc(caseObj.name)}</div>
        <div class="ch-meta">
          <span class="ch-status">${esc(caseObj.status || 'open')}</span>
          ${caseObj.destination ? `<span>Bound for <b>${esc(caseObj.destination)}</b></span>` : ''}
          <span><b>${list.length}</b> item${list.length === 1 ? '' : 's'}</span>
        </div>
      </div>
    </div>
    <h2>Manifest</h2>
    <table>
      <thead><tr><th>No.</th><th>Item</th><th>Owner</th><th>Cabin</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="foot">Cargo · Laundry case · Scan the code to open this case</div>
  </body></html>`;

  try {
    if (!w) w = window.open('', '_blank');
    if (!w) return;
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => { try { w.print(); } catch (e) { /* user can print manually */ } }, 350);
  } catch (e) { /* user can print manually */ }
}
