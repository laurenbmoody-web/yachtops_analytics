import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { money } from './laundryBilling';
import { loadLogoForPdf } from '../../crew-management/utils/guestBookExport';

const CARGO_LOGO = '/assets/images/cargo_merged_originalmark_syne800_true.png';
const NAVY = [28, 27, 58];
const TERRA = [198, 90, 26];
const MUTED = [139, 132, 120];
const HAIR = [236, 234, 227];

const qtyOf = (i) => Math.max(1, Number(i?.details?.quantity) || 1);

// Fetch a (signed) image URL → data URL for embedding. Best-effort; returns null.
const imgToDataUrl = (url) => new Promise((res) => {
  if (!url || typeof url !== 'string') return res(null);
  try {
    fetch(url).then((r) => (r.ok ? r.blob() : null)).then((b) => {
      if (!b) return res(null);
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = () => res(null);
      fr.readAsDataURL(b);
    }).catch(() => res(null));
  } catch { res(null); }
});

// A4 wardrobe manifest / valuation — one line per garment with a photo, key
// attributes and value (unit × qty). For an owner's office / insurer.
export const exportWardrobeManifest = async ({ subject, vesselName, generatedAt, items = [], showValue = true }) => {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const M = 15;

  const logo = await loadLogoForPdf(CARGO_LOGO);
  // Pre-load a cover photo per garment (best-effort, in parallel).
  const covers = await Promise.all(items.map((it) => imgToDataUrl((Array.isArray(it.photos) && it.photos[0]) || it.photo || '')));

  const cur = items.find((i) => i.garmentValue != null)?.garmentValueCurrency || 'EUR';
  const pieces = items.reduce((a, i) => a + qtyOf(i), 0);
  const totalValue = items.reduce((a, i) => a + (Number(i.garmentValue) || 0) * qtyOf(i), 0);

  const drawFooter = (page, count) => {
    if (logo?.dataUrl) {
      const h = 4.4; const w = h * (logo.aspect || 6.7);
      try { doc.addImage(logo.dataUrl, 'PNG', M, pageH - 12, w, h); } catch { /* skip */ }
    }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...MUTED);
    const right = [generatedAt ? `Generated ${generatedAt}` : null, count > 1 ? `Page ${page} / ${count}` : null].filter(Boolean).join('    ·    ');
    if (right) doc.text(right, pageW - M, pageH - 9, { align: 'right' });
  };

  // Header
  doc.setTextColor(...TERRA); doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  doc.text('WARDROBE — MANIFEST & VALUATION', M, 20);
  doc.setTextColor(...NAVY); doc.setFont('times', 'normal'); doc.setFontSize(22);
  doc.text(subject || vesselName || 'Wardrobe', M, 30);
  let hy = 36;
  if (vesselName && subject && vesselName !== subject) { doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...MUTED); doc.text(vesselName, M, hy); hy += 5; }
  doc.setDrawColor(...HAIR); doc.line(M, hy, pageW - M, hy);
  const summary = [`${pieces} garment${pieces === 1 ? '' : 's'}`, showValue && totalValue > 0 ? `Total ${money(totalValue, cur)}` : null].filter(Boolean).join('     ·     ');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...MUTED);
  doc.text(summary.toUpperCase(), M, hy + 6);

  const head = [['', 'Item', 'Brand', 'Type', 'Size', 'Qty', ...(showValue ? ['Value', 'Total'] : [])]];
  const body = items.map((it) => {
    const d = it.details || {};
    const q = qtyOf(it);
    const unit = Number(it.garmentValue);
    const row = [
      '', // photo cell
      it.description || 'Garment',
      d.brand || '—',
      it.garmentType || '—',
      d.size || '—',
      `×${q}`,
    ];
    if (showValue) {
      row.push(it.garmentValue != null ? money(unit, it.garmentValueCurrency || cur) : '—');
      row.push(it.garmentValue != null ? money(unit * q, it.garmentValueCurrency || cur) : '—');
    }
    return row;
  });

  let pageCount = 0;
  autoTable(doc, {
    head, body,
    startY: hy + 11,
    theme: 'grid',
    margin: { left: M, right: M, bottom: 16 },
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: { top: 2, right: 2.5, bottom: 2, left: 2.5 }, lineColor: HAIR, lineWidth: 0.1, textColor: NAVY, valign: 'middle', minCellHeight: 14 },
    headStyles: { fillColor: [248, 250, 252], textColor: MUTED, fontStyle: 'bold', fontSize: 7, halign: 'left' },
    columnStyles: {
      0: { cellWidth: 15 },
      1: { cellWidth: 'auto', fontStyle: 'bold' },
      5: { halign: 'center', cellWidth: 12 },
      ...(showValue ? { 6: { halign: 'right', cellWidth: 20 }, 7: { halign: 'right', cellWidth: 22, fontStyle: 'bold' } } : {}),
    },
    didParseCell: (data) => { if (data.section === 'body' && data.column.index === 0) data.cell.text = ['']; },
    didDrawCell: (data) => {
      if (data.section === 'body' && data.column.index === 0) {
        const url = covers[data.row.index];
        if (url) {
          const s = 12; const x = data.cell.x + (data.cell.width - s) / 2; const y = data.cell.y + (data.cell.height - s) / 2;
          try { doc.addImage(url, 'JPEG', x, y, s, s); } catch { /* skip */ }
        }
      }
    },
    didDrawPage: () => { pageCount += 1; drawFooter(pageCount, 0); },
  });

  // Grand total line
  if (showValue && totalValue > 0) {
    const y = (doc.lastAutoTable?.finalY || hy) + 8;
    doc.setDrawColor(...HAIR); doc.line(pageW - M - 60, y - 4, pageW - M, y - 4);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...NAVY);
    doc.text('Total valuation', pageW - M - 60, y, { align: 'left' });
    doc.setTextColor(...TERRA);
    doc.text(money(totalValue, cur), pageW - M, y, { align: 'right' });
  }

  const safe = (subject || vesselName || 'wardrobe').replace(/[^a-z0-9]+/gi, '-');
  doc.save(`Wardrobe-manifest-${safe}.pdf`);
};
