import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// Provisioning-board PDF exporter.
//
// Earlier passes shipped two things in turn — first a window.print()
// fallback (the user got dropped into the browser print dialog), then
// a heavy autoTable layout with a navy header strip + a full grid per
// category. The grid layout read like a spreadsheet dump and didn't
// feel like Cargo at all: boxed cells, repeated table headers under
// every section, empty Brand / Unit cost / Total columns wasting
// space.
//
// This rewrite leans on the editorial design system: a serif-feel
// title in italic, terracotta accent line, tracked-caps section
// labels, hairline-only row separators (no cell boxes), and only
// the columns that the current board actually populates.
//
// jsPDF ships Helvetica only — we can't embed DM Serif Display
// without TTF asset wiring. Italic Helvetica at scale stands in for
// the magazine-cover title; tracked caps + terracotta give the
// section labels the same rhythm as the in-app surfaces.

const NAVY = [28, 27, 58];
const TERRA = [198, 90, 26];
const HAIRLINE = [236, 234, 227];
const MUTED = [139, 132, 120];      // soft muted-strong from the palette
const FAINT = [174, 180, 194];      // faint hairline ink
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

// Letter-spaced caps — fakes the tracking jsPDF doesn't expose.
// Joins each glyph with a thin space so the section labels read as
// editorial small-caps even though we're using Helvetica.
const trackedCaps = (s) => (s || '').toUpperCase().split('').join(' ');

// Decide which optional columns to render based on whether any item
// on the board carries a value. A confirmed board with no brand,
// notes, or estimated cost would otherwise render four empty
// columns just to host the qty.
const pickColumns = (items) => {
  const any = (pred) => (items || []).some(pred);
  const hasBrand  = any((i) => i.brand && String(i.brand).trim());
  const hasNotes  = any((i) => i.notes && String(i.notes).trim());
  const hasSize   = any((i) => i.size && String(i.size).trim());
  const hasCost   = any((i) => i.estimated_unit_cost != null && i.estimated_unit_cost !== '');
  return { hasBrand, hasNotes, hasSize, hasCost };
};

// Draw the editorial header — italic serif-feel title, tracked-caps
// meta strip, terracotta hairline rule.
const drawHeader = (doc, list, trip, pageWidth, margin) => {
  // Big italic title — Helvetica italic stands in for DM Serif.
  doc.setFont('helvetica', 'bolditalic');
  doc.setFontSize(26);
  doc.setTextColor(...INK);
  const title = list?.title || 'Provisioning board';
  doc.text(title, margin, 24);

  // Trailing terracotta full stop — picks up the in-app "CHARTER
  // 10.07.26, Bridge." mannerism so the doc head reads as Cargo.
  doc.setTextColor(...TERRA);
  const titleW = doc.getTextWidth(title);
  doc.text('.', margin + titleW, 24);

  // Tracked-caps meta strip.
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED);
  const meta = [
    list?.status ? cleanStatusLabel(list.status) : null,
    trip?.start_date && trip?.end_date
      ? `${formatDate(trip.start_date)} – ${formatDate(trip.end_date)}`
      : null,
    list?.port_location ? `Port ${list.port_location}` : null,
    list?.currency || null,
  ].filter(Boolean).map((s) => trackedCaps(s)).join('   ·   ');
  if (meta) doc.text(meta, margin, 31);

  // Right-aligned exported-on stamp, also tracked-caps.
  const stamp = trackedCaps(`Exported ${formatDate(new Date())}`);
  const stampW = doc.getTextWidth(stamp);
  doc.text(stamp, pageWidth - margin - stampW, 31);

  // Terracotta hairline rule.
  doc.setDrawColor(...TERRA);
  doc.setLineWidth(0.3);
  doc.line(margin, 36, pageWidth - margin, 36);
};

// Draw a category label — tracked-caps in terracotta with the item
// count on the right, no fill, hairline below.
const drawCategoryLabel = (doc, cat, count, cursorY, pageWidth, margin) => {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...TERRA);
  doc.text(trackedCaps(cat), margin, cursorY);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED);
  const countLabel = trackedCaps(`${count} item${count === 1 ? '' : 's'}`);
  const countW = doc.getTextWidth(countLabel);
  doc.text(countLabel, pageWidth - margin - countW, cursorY);

  doc.setDrawColor(...HAIRLINE);
  doc.setLineWidth(0.2);
  doc.line(margin, cursorY + 2.4, pageWidth - margin, cursorY + 2.4);
};

export const generateBoardPdf = ({ list, items, trip }) => {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 18;

  drawHeader(doc, list, trip, pageWidth, margin);

  const groups = groupItemsByCategory(items);
  const cols = pickColumns(items);

  // Build the column schema dynamically — only include columns that
  // any item on the board populates. Item is always present; qty +
  // unit come along as the always-on numerics.
  const headRow = ['Item'];
  const widths = [];
  const colStyles = {};
  const colKeys = ['name'];

  if (cols.hasBrand)  { headRow.push('Brand');  widths.push(28); colKeys.push('brand'); }
  if (cols.hasNotes)  { headRow.push('Notes');  widths.push(null); colKeys.push('notes'); }
  if (cols.hasSize)   { headRow.push('Size');   widths.push(14); colKeys.push('size'); }
  headRow.push('Unit'); widths.push(16); colKeys.push('unit');
  headRow.push('Qty');  widths.push(10); colKeys.push('qty');
  if (cols.hasCost) {
    headRow.push('Unit cost'); widths.push(18); colKeys.push('cost');
    headRow.push('Total');     widths.push(18); colKeys.push('total');
  }

  // Build columnStyles from the picked columns. Index 0 is Item —
  // give it the remaining width via cellWidth: 'auto'.
  colKeys.forEach((key, idx) => {
    const w = widths[idx - 1];
    if (idx === 0) {
      colStyles[0] = { cellWidth: 'auto', fontStyle: 'bold', textColor: INK };
    } else if (key === 'notes') {
      colStyles[idx] = { cellWidth: 'auto', fontStyle: 'italic', textColor: MUTED };
    } else {
      colStyles[idx] = {
        cellWidth: w,
        halign: ['qty', 'cost', 'total', 'size'].includes(key) ? 'right' : 'left',
        textColor: ['cost', 'total', 'qty'].includes(key) ? INK : MUTED,
      };
    }
  });

  let cursorY = 46;

  groups.forEach((group) => {
    // Page-break before category if there's no room for at least the
    // label + two rows.
    if (cursorY > pageHeight - 32) {
      doc.addPage();
      cursorY = 22;
    }

    drawCategoryLabel(doc, group.category, group.items.length, cursorY, pageWidth, margin);
    cursorY += 5;

    // Map each item into the dynamic column row.
    const body = group.items.map((it) => {
      const qty = it.quantity_ordered;
      const cost = it.estimated_unit_cost;
      const total = (qty != null && cost != null) ? (Number(qty) * Number(cost)) : null;
      return colKeys.map((key) => {
        switch (key) {
          case 'name':  return it.name || '';
          case 'brand': return it.brand || '';
          case 'notes': return it.notes || '';
          case 'size':  return it.size || '';
          case 'unit':  return it.unit || '';
          case 'qty':   return qty != null ? String(qty) : '';
          case 'cost':  return formatMoney(cost);
          case 'total': return formatMoney(total);
          default:      return '';
        }
      });
    });

    autoTable(doc, {
      head: [headRow],
      body,
      startY: cursorY,
      margin: { left: margin, right: margin },
      theme: 'plain',
      styles: {
        font: 'helvetica',
        fontSize: 9,
        textColor: INK,
        cellPadding: { top: 2.4, right: 2, bottom: 2.4, left: 0 },
        lineColor: HAIRLINE,
        lineWidth: 0,                // no cell borders
        valign: 'middle',
      },
      headStyles: {
        fillColor: false,            // no header fill
        textColor: FAINT,
        fontStyle: 'normal',
        fontSize: 7,
        cellPadding: { top: 0, right: 2, bottom: 2.4, left: 0 },
        lineWidth: 0,
      },
      bodyStyles: {
        // Hairline under each row instead of full cell borders.
        lineColor: HAIRLINE,
        lineWidth: { bottom: 0.1 },
      },
      columnStyles: colStyles,
      didDrawPage: () => {
        // Footer — small cargo mark + page n.
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(7.5);
        doc.setTextColor(...MUTED);
        doc.text(trackedCaps('cargo'), margin, pageHeight - 9);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(...FAINT);
        const pageStr = trackedCaps(`Page ${doc.getNumberOfPages()}`);
        const w = doc.getTextWidth(pageStr);
        doc.text(pageStr, pageWidth - margin - w, pageHeight - 9);
      },
    });

    cursorY = doc.lastAutoTable.finalY + 8;
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
