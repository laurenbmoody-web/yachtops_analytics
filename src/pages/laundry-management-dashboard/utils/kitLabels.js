// QR tags for uniform / kit inventory items.
//
// Each tag carries a QR that encodes a deep link into wardrobe management
// (`?issueItem=<id>`). Interior scan the tag stitched to a garment — with the
// in-app scanner where the browser supports BarcodeDetector, or the phone's own
// camera as a deep link — and the item drops straight into the Issue flow with
// its sizes ready to allocate. The same value is read back by parseIssueScan.
//
// Follows the self-contained print-window pattern used by laundryLabels.js.

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const wardrobeOrigin = () => (typeof window !== 'undefined' && window.location) ? window.location.origin : '';

// Deep link a kit tag resolves to. Encoded in the QR and parsed below.
export function issueScanUrlFor(id) {
  return `${wardrobeOrigin()}/wardrobe-management?issueItem=${encodeURIComponent(id)}`;
}

// Read an inventory item id out of a scanned value — accepts the full deep-link
// URL, a bare `issueItem=<id>` fragment, or a bare id, so a hand-typed code
// works too.
export function parseIssueScan(value) {
  if (!value) return null;
  const raw = String(value).trim();
  try {
    const u = new URL(raw);
    const q = u.searchParams.get('issueItem') || u.searchParams.get('scan');
    if (q) return q;
  } catch { /* not a URL — fall through */ }
  const m = raw.match(/issueItem=([^&\s]+)/);
  if (m) return decodeURIComponent(m[1]);
  return raw; // bare id
}

async function qrDataUrl(text) {
  const QR = (await import('qrcode')).default;
  return QR.toDataURL(text, { margin: 0, width: 300, color: { dark: '#1C1B3A', light: '#FFFFFF' } });
}

const TAG_CSS = `
  * { box-sizing: border-box; }
  body { margin: 0; padding: 22px; font-family: 'Inter', system-ui, sans-serif; color: #1C1B3A; }
  .sheet-head { display: flex; align-items: baseline; justify-content: space-between; border-bottom: 2px solid #1C1B3A; padding-bottom: 8px; margin-bottom: 14px; }
  .sheet-head h1 { font: 700 15px 'Inter', system-ui; margin: 0; letter-spacing: 0.02em; }
  .sheet-head span { font: 700 9px system-ui; letter-spacing: 0.12em; text-transform: uppercase; color: #8B8478; }
  .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
  .tag { display: flex; gap: 12px; align-items: stretch; border: 1px solid #D9D6CE; border-radius: 10px; padding: 12px 14px; break-inside: avoid; page-break-inside: avoid; min-height: 108px; }
  .tag-qr { flex: none; width: 88px; display: flex; align-items: center; justify-content: center; }
  .tag-qr img { width: 88px; height: 88px; display: block; }
  .tag-main { display: flex; flex-direction: column; min-width: 0; }
  .tag-eyebrow { font: 700 8px system-ui; letter-spacing: 0.12em; text-transform: uppercase; color: #C65A1A; }
  .tag-nm { font: 700 13px 'Inter', system-ui; line-height: 1.2; margin: 3px 0 5px; }
  .tag-meta { font-size: 10.5px; color: #6B7280; display: flex; flex-wrap: wrap; gap: 4px 10px; }
  .tag-foot { margin-top: auto; font: 700 7.5px system-ui; letter-spacing: 0.1em; text-transform: uppercase; color: #AEB4C2; padding-top: 6px; }
  @media print { body { padding: 0; } .sheet-head { margin: 12px; } .grid { margin: 12px; } }
`;

// Open a print window with a scannable QR tag for each uniform item.
export async function printKitTags(items) {
  const list = (items || []).filter((it) => it && it.id);
  if (typeof window === 'undefined') return;
  const w = window.open('', '_blank');
  if (!w) { window.showToast?.('Allow pop-ups to print QR tags', 'error'); return; }
  w.document.write('<!doctype html><html><head><title>Kit QR tags</title></head><body><p style="font:600 13px system-ui;padding:24px;color:#8B8478">Preparing tags…</p></body></html>');
  w.document.close();

  const cells = await Promise.all(list.map(async (it) => {
    const qr = await qrDataUrl(issueScanUrlFor(it.id));
    const sizes = (it.variants || []).map((v) => v.size || v.label).filter(Boolean).join(' · ');
    const meta = [it.brand, it.customFields?.styleCode || it.custom_fields?.styleCode, sizes].filter(Boolean);
    return `
      <div class="tag">
        <div class="tag-qr"><img src="${esc(qr)}" alt="scan" /></div>
        <div class="tag-main">
          <span class="tag-eyebrow">Uniform</span>
          <span class="tag-nm">${esc(it.name || 'Uniform item')}</span>
          <div class="tag-meta">${meta.map((m) => `<span>${esc(m)}</span>`).join('')}</div>
          <span class="tag-foot">Scan to issue</span>
        </div>
      </div>`;
  }));

  const html = `<!doctype html><html><head><meta charset="utf-8" /><title>Kit QR tags</title><style>${TAG_CSS}</style></head><body>
    <div class="sheet-head"><h1>Kit QR tags</h1><span>${list.length} tag${list.length === 1 ? '' : 's'}</span></div>
    <div class="grid">${cells.join('')}</div>
    <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 120); };<\/script>
  </body></html>`;
  w.document.open();
  w.document.write(html);
  w.document.close();
}
