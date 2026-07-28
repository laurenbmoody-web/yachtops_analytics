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

const CARD_CSS = `
  * { box-sizing: border-box; }
  body { font-family: 'Inter', system-ui, -apple-system, sans-serif; color: #1C1B3A; margin: 0; padding: 32px; background: #FFFFFF; display: flex; justify-content: center; }
  .card { width: 320px; border: 1px solid #E5E2DA; border-radius: 14px; padding: 22px; text-align: center; }
  .eyebrow { font: 700 9px system-ui; letter-spacing: 0.16em; text-transform: uppercase; color: #C65A1A; }
  .name { font-family: 'DM Serif Display', Georgia, serif; font-size: 22px; line-height: 1.1; margin: 6px 0 2px; word-break: break-word; }
  .sub { font-size: 12px; color: #6B7280; margin-bottom: 16px; }
  .qr { width: 200px; height: 200px; margin: 0 auto; }
  .qr img { width: 100%; height: 100%; }
  .code { margin-top: 14px; font: 700 13px 'Inter', system-ui; letter-spacing: 0.06em; color: #1C1B3A; word-break: break-all; }
  .foot { margin-top: 14px; padding-top: 12px; border-top: 1px solid #F0F1F5; font: 700 8px system-ui; letter-spacing: 0.1em; text-transform: uppercase; color: #AEB4C2; }
  @media print { body { padding: 12mm; } }
`;

// Open a print window with one QR label for an item. `code` is the string the
// QR encodes (and that the scanner will read back). Pass `win` when the caller
// already opened the window synchronously (popup-safe across an async mint).
export async function printItemQr({ code, name, brand, location, win }) {
  const value = String(code || '').trim();
  if (!value) return;

  let w = win || null;
  try {
    if (!w) { w = window.open('', '_blank'); if (w) { w.document.open(); w.document.write('<!doctype html><meta charset="utf-8"><title>QR label</title><body style="font-family:system-ui;padding:40px;color:#6B7280">Preparing label…</body>'); w.document.close(); } }
  } catch { /* popup blocked */ }

  const qr = await makeQr(value).catch(() => '');
  const sub = [brand, location].filter(Boolean).map(esc).join(' · ');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>QR — ${esc(name || value)}</title><style>${CARD_CSS}</style></head><body>
    <div class="card">
      <div class="eyebrow">Cargo · Inventory</div>
      <div class="name">${esc(name || 'Inventory item')}</div>
      ${sub ? `<div class="sub">${sub}</div>` : '<div class="sub"></div>'}
      <div class="qr">${qr ? `<img src="${esc(qr)}" alt="QR code" />` : ''}</div>
      <div class="code">${esc(value)}</div>
      <div class="foot">Scan to match this item</div>
    </div>
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
