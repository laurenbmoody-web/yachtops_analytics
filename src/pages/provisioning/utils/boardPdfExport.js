import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// Provisioning-board PDF exporter.
//
// Replaces the previous "Print / PDF" button behaviour (which fired
// window.print() and made the user wrestle with the browser's print
// dialog to save as PDF). This builds a real PDF in-browser and
// opens it as a blob URL in a new tab so the chief lands in the
// browser's PDF viewer — full orientation / scale / save controls
// without going through a print preview.
//
// Layout: A4 portrait. Editorial header strip (navy / terracotta
// like the in-app shell), board metadata block, then items grouped
// by category with a small table per group.

const NAVY = [28, 27, 58];
const TERRA = [198, 90, 26];
const FIELD_BG = [250, 250, 248];
const HAIRLINE = [236, 234, 227];
const MUTED = [107, 111, 122];
const INK = [28, 27, 58];

const formatDate = (d) => {
  if (!d) return '';
  try {
    const date = typeof d === 'string' ? new Date(d) : d;
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch { return ''; }
};

const formatMoney = (n) => {
  if (n == null || n === '') return '';
  const num = Number(n);
  if (Number.isNaN(num)) return '';
  return num.toFixed(2);
};

const cleanStatusLabel = (s) => {
  if (!s) return '';
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
};

const groupItemsByCategory = (items) => {
  const groups = new Map();
  (items || []).forEach((it) => {
    const cat = (it.category || 'Uncategorised').trim() || 'Uncategorised';
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(it);
  });
  // Stable alphabetical, with Uncategorised pinned to the end.
  const keys = [...groups.keys()].sort((a, b) => {
    if (a === 'Uncategorised') return 1;
    if (b === 'Uncategorised') return -1;
    return a.localeCompare(b);
  });
  return keys.map((k) => ({ category: k, items: groups.get(k) }));
};

export const generateBoardPdf = ({ list, items, trip }) => {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;

  // ── Header strip ──────────────────────────────────────────────────────────
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, pageWidth, 26, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text((list?.title || 'Provisioning board').toUpperCase(), margin, 14);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(220, 215, 200);
  const headerMeta = [
    list?.status ? cleanStatusLabel(list.status) : null,
    trip?.start_date && trip?.end_date
      ? `${formatDate(trip.start_date)} – ${formatDate(trip.end_date)}`
      : null,
    list?.port_location ? `Port: ${list.port_location}` : null,
    list?.currency ? `Currency: ${list.currency}` : null,
  ].filter(Boolean).join('   ·   ');
  if (headerMeta) doc.text(headerMeta, margin, 21);

  // Right-aligned "exported on" stamp.
  doc.setTextColor(220, 215, 200);
  doc.setFontSize(8);
  const stamp = `Exported ${formatDate(new Date())}`;
  const stampWidth = doc.getTextWidth(stamp);
  doc.text(stamp, pageWidth - margin - stampWidth, 21);

  // ── Items grouped by category ─────────────────────────────────────────────
  const groups = groupItemsByCategory(items);
  let cursorY = 36;

  const head = [['Item', 'Brand', 'Notes', 'Size', 'Unit', 'Qty', 'Unit cost', 'Total', 'Status']];

  groups.forEach((group, gIdx) => {
    // Category strip.
    if (cursorY > pageHeight - 40) {
      doc.addPage();
      cursorY = 16;
    }
    doc.setFillColor(...FIELD_BG);
    doc.rect(margin, cursorY, pageWidth - margin * 2, 7, 'F');
    doc.setDrawColor(...HAIRLINE);
    doc.setLineWidth(0.2);
    doc.line(margin, cursorY + 7, pageWidth - margin, cursorY + 7);
    doc.setTextColor(...TERRA);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text(group.category.toUpperCase(), margin + 2, cursorY + 5);
    doc.setTextColor(...MUTED);
    doc.setFont('helvetica', 'normal');
    const countLabel = `${group.items.length} item${group.items.length === 1 ? '' : 's'}`;
    const countW = doc.getTextWidth(countLabel);
    doc.text(countLabel, pageWidth - margin - 2 - countW, cursorY + 5);
    cursorY += 10;

    // Table rows for this group.
    const body = group.items.map((it) => {
      const qty = it.quantity_ordered;
      const cost = it.estimated_unit_cost;
      const total = (qty != null && cost != null) ? (Number(qty) * Number(cost)) : null;
      return [
        it.name || '',
        it.brand || '',
        it.notes || '',
        it.size || '',
        it.unit || '',
        qty != null ? String(qty) : '',
        formatMoney(cost),
        formatMoney(total),
        cleanStatusLabel(it.status),
      ];
    });

    autoTable(doc, {
      head,
      body,
      startY: cursorY,
      margin: { left: margin, right: margin },
      theme: 'plain',
      styles: {
        font: 'helvetica',
        fontSize: 8.5,
        textColor: INK,
        cellPadding: { top: 1.8, right: 2, bottom: 1.8, left: 2 },
        lineColor: HAIRLINE,
        lineWidth: 0.1,
      },
      headStyles: {
        fillColor: [255, 255, 255],
        textColor: MUTED,
        fontStyle: 'bold',
        fontSize: 7.5,
        lineWidth: 0,
      },
      columnStyles: {
        0: { cellWidth: 38 },               // Item
        1: { cellWidth: 22 },               // Brand
        2: { cellWidth: 'auto' },           // Notes
        3: { cellWidth: 14, halign: 'right' }, // Size
        4: { cellWidth: 14 },               // Unit
        5: { cellWidth: 10, halign: 'right' }, // Qty
        6: { cellWidth: 16, halign: 'right' }, // Unit cost
        7: { cellWidth: 16, halign: 'right' }, // Total
        8: { cellWidth: 18 },               // Status
      },
      didDrawPage: (data) => {
        // Footer with page numbers.
        const str = `Page ${doc.getNumberOfPages()}`;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(...MUTED);
        doc.text(str, pageWidth - margin, pageHeight - 6, { align: 'right' });
        doc.text('cargo', margin, pageHeight - 6);
      },
    });

    cursorY = doc.lastAutoTable.finalY + 6;
  });

  if (groups.length === 0) {
    doc.setTextColor(...MUTED);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(10);
    doc.text('No items on this board yet.', margin, cursorY + 6);
  }

  return doc;
};

// Open the generated PDF in a new tab via blob URL. The browser's
// built-in PDF viewer handles preview / print / save, so the chief
// doesn't have to wrestle with the browser print dialog.
export const openBoardPdf = ({ list, items, trip }) => {
  const doc = generateBoardPdf({ list, items, trip });
  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  // Pop-up blockers (and some restricted webviews) will return null.
  // Fall back to a same-tab navigation so the chief still gets the
  // PDF — slightly worse UX but never silently broken.
  if (!win) window.location.href = url;
  // The blob URL stays alive until the tab closes; no manual revoke
  // (revoking too early kills the viewer's ability to refresh / save).
};
