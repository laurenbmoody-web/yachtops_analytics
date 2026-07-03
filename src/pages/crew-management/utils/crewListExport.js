// Crew List export — IMO FAL Form 5 (port authority / immigration) as an A4
// landscape PDF, in two visual templates:
//   • 'fal'       — faithful, official port-authority layout (ruled grid)
//   • 'editorial' — the same data in the Cargo editorial design language
// Built with jsPDF + jspdf-autotable, mirroring kitReceiptExport.js.

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { loadLogoForPdf } from './guestBookExport';

const NAVY = [28, 27, 58];
const TERRA = [198, 90, 26];
const MUTED = [139, 132, 120];
const FAINT = [174, 180, 194];
const HAIR = [220, 220, 224];
const INK = [33, 33, 40];

const dd = (d) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (d || '');
};

const commercialLabel = (v) => {
  if (v?.certified_commercial) return 'Commercial';
  const s = String(v?.commercial_status || '').trim();
  return s || 'Private';
};

// Column layout shared by both templates. Widths (mm) tuned for A4 landscape
// with 12mm margins (usable ≈ 273mm).
// Widths (mm). Rank is wide so a role like "Chief Stewardess" stays on one
// line; Place of issue is a tight box; Issuing state takes the remainder.
const COLUMNS = [
  { header: '#', key: 'idx', w: 8, halign: 'center' },
  { header: 'Rank', key: 'rank', w: 34 },
  { header: 'Surname', key: 'surname', w: 26 },
  { header: 'Fore name', key: 'foreName', w: 26 },
  { header: 'Sex', key: 'sex', w: 9, halign: 'center' },
  { header: 'Date of birth', key: 'dob', w: 21, halign: 'center' },
  { header: 'Place of birth', key: 'placeOfBirth', w: 26 },
  { header: 'Nationality', key: 'nationality', w: 21 },
  { header: 'Document', key: 'docType', w: 18 },
  { header: 'Doc. number', key: 'passportNo', w: 25 },
  { header: 'Expiry', key: 'passportExpiry', w: 18, halign: 'center' },
  { header: 'Issuing state', key: 'issuingState', w: 0 }, // remainder
  { header: 'Place of issue', key: 'placeOfIssue', w: 13 },
];

const rowToCells = (row, i) => ({
  idx: String(i + 1),
  rank: row.rank || '—',
  surname: row.surname || '—',
  foreName: row.foreName || '—',
  sex: row.sex ? row.sex[0].toUpperCase() : '',
  dob: dd(row.dob),
  placeOfBirth: row.placeOfBirth || '',
  nationality: row.nationality || '',
  docType: row.docType || '',
  passportNo: row.passportNo || '',
  passportIssue: dd(row.passportIssue),
  passportExpiry: dd(row.passportExpiry),
  issuingState: row.passportState || '',
  placeOfIssue: row.placeOfIssue || '',
});

// A row of label/value pairs for the vessel + voyage header blocks.
const drawKeyGrid = (doc, pairs, x, y, colW, perRow, accent) => {
  const rowH = 8.5;
  pairs.forEach((p, i) => {
    const cx = x + (i % perRow) * colW;
    const cy = y + Math.floor(i / perRow) * rowH;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.8); doc.setTextColor(...accent);
    doc.text(String(p[0]).toUpperCase(), cx, cy, { charSpace: 0.6 });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...INK);
    doc.text(String(p[1] || '—'), cx, cy + 4.6);
  });
  return y + Math.ceil(pairs.length / perRow) * rowH;
};

/**
 * Build (and download) the crew list PDF.
 * @param {object} o
 *   template 'fal' | 'editorial'
 *   vessel   row from vessels
 *   callSign, classNotation  strings (not stored on vessels — entered in modal)
 *   voyage   { portOfArrival, lastPort, nextPort, arrivalDate, arrivalTime, departureDate, departureTime }
 *   master   master's name
 *   rows     ordered crew rows (from buildCrewRow)
 *   generatedAt  display string
 */
export const exportCrewListPDF = async (o) => {
  const {
    template = 'fal', vessel = {}, callSign = '', classNotation = '',
    voyage = {}, master = '', rows = [], generatedAt = '',
    declaration = '', signature = null, stamp = null,
  } = o;
  const editorial = template === 'editorial';
  // Headers/labels stay dark (navy) so they survive a black-&-white print at the
  // port office — terracotta washes out to a pale grey. The only colour accent
  // is the small "CREW LIST" eyebrow.
  const labelColor = NAVY;
  const eyebrowColor = editorial ? NAVY : TERRA;
  const titleFont = editorial ? 'times' : 'helvetica';

  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const M = 12;

  // Vessel logo as a letterhead mark (top-right). Loaded from the vessel record.
  const logo = vessel?.logo_url ? await loadLogoForPdf(vessel.logo_url) : null;

  // ── Title (tightened up top to give the table more room) ──────────────────
  doc.setTextColor(...eyebrowColor); doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
  doc.text('OFFICIAL CREW LIST', M, 11, { charSpace: editorial ? 0.8 : 1.2 });
  doc.setTextColor(...NAVY); doc.setFont(titleFont, editorial ? 'normal' : 'bold');
  doc.setFontSize(editorial ? 23 : 18);
  doc.text(vessel.name || 'Vessel', M, editorial ? 21 : 20);

  // Vessel logo as a letterhead mark, top-right. The generated date now lives
  // in the bottom-left footer, so nothing else sits up here.
  if (logo?.dataUrl) {
    const logoH = 12;
    const logoW = Math.min(58, logoH * (logo.aspect || 3));
    try { doc.addImage(logo.dataUrl, 'PNG', pageW - M - logoW, 5, logoW, logoH); } catch { /* skip */ }
  }

  let y = editorial ? 26 : 25;
  doc.setDrawColor(...HAIR); doc.setLineWidth(0.3); doc.line(M, y, pageW - M, y);
  y += 6;

  // ── Vessel identity grid ─────────────────────────────────────────────────
  // Identity first (the IDs an officer keys on), then particulars. 6 per row.
  const vPairs = [
    ['Flag', vessel.flag],
    ['IMO No.', vessel.imo_number],
    ['Call Sign', callSign],
    ['Master', master],
    ['Official No.', vessel.official_number],
    ['MMSI', vessel.mmsi],
    ['Port of Registry', vessel.port_of_registry],
    ['GT', vessel.gt],
    ['LOA (m)', vessel.loa_m],
    ['Class', classNotation],
    ['Year built', vessel.year_built],
    ['Registry type', commercialLabel(vessel)],
  ];
  const gridColW = (pageW - 2 * M) / 6;
  y = drawKeyGrid(doc, vPairs, M, y, gridColW, 6, labelColor) + 3;

  doc.setDrawColor(...HAIR); doc.setLineWidth(0.2); doc.line(M, y, pageW - M, y);
  y += 6;

  // ── Voyage box ───────────────────────────────────────────────────────────
  // Left-to-right voyage timeline: where from → where now → in → out → where to.
  const voyPairs = [
    ['Last Port', voyage.lastPort],
    ['Port of Arrival', voyage.portOfArrival],
    ['Arrival', [dd(voyage.arrivalDate), voyage.arrivalTime].filter(Boolean).join(' ')],
    ['Departure', [dd(voyage.departureDate), voyage.departureTime].filter(Boolean).join(' ')],
    ['Next Port', voyage.nextPort],
  ];
  y = drawKeyGrid(doc, voyPairs, M, y, (pageW - 2 * M) / 5, 5, labelColor) + 4;

  // ── Crew table ───────────────────────────────────────────────────────────
  const columnStyles = {};
  COLUMNS.forEach((c, i) => { if (c.w) columnStyles[i] = { cellWidth: c.w, halign: c.halign || 'left' }; else columnStyles[i] = { halign: c.halign || 'left' }; });

  // Fit everything on ONE page: shrink the row font/padding until the table
  // plus the footer (declaration + signature block) fit under the table start.
  // Reserve ~44mm at the bottom for that footer, then solve for the largest
  // font that keeps (header + N rows) within the available height.
  const FOOTER_RESERVE = 42;
  const availH = pageH - y - FOOTER_RESERVE;
  const nRows = rows.length + 1; // + header row
  const rowHeight = (fs, pad) => fs * 0.3528 * 1.16 + 2 * pad + 0.3; // mm, ~1 line
  let bodyFs = 7.6;
  let pad = editorial ? 2 : 1.8;
  while (bodyFs > 5 && nRows * rowHeight(bodyFs, pad) > availH) {
    bodyFs -= 0.2;
    if (pad > 0.9) pad -= 0.06;
  }
  const headFs = Math.max(6, bodyFs);

  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    rowPageBreak: 'avoid',
    head: [COLUMNS.map((c) => c.header)],
    body: rows.map((r, i) => {
      const cells = rowToCells(r, i);
      return COLUMNS.map((c) => cells[c.key]);
    }),
    styles: {
      font: 'helvetica', fontSize: bodyFs, cellPadding: pad,
      textColor: INK, lineColor: HAIR, lineWidth: editorial ? 0.1 : 0.15, overflow: 'linebreak',
    },
    headStyles: editorial
      ? { fillColor: [237, 235, 229], textColor: NAVY, fontStyle: 'bold', fontSize: headFs, lineColor: HAIR, lineWidth: 0.1 }
      : { fillColor: NAVY, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: headFs, lineColor: NAVY, lineWidth: 0.15 },
    alternateRowStyles: editorial ? { fillColor: [252, 251, 248] } : { fillColor: [245, 246, 249] },
    columnStyles,
    didParseCell: (data) => {
      // Grey out em-dash placeholders for missing values.
      if (data.section === 'body' && (data.cell.raw === '' || data.cell.raw === '—')) {
        data.cell.styles.textColor = FAINT;
        if (data.cell.raw === '') data.cell.text = ['—'];
      }
    },
  });

  // Footer sits right under the table on the same page (never force a page 2
  // unless the crew genuinely can't fit even at the minimum font).
  let fy = (doc.lastAutoTable?.finalY || y) + 7;
  if (fy > pageH - 34) { doc.addPage(); fy = 20; }

  // ── Master's declaration (statement above the signature) ─────────────────
  doc.setFont(editorial ? 'times' : 'helvetica', editorial ? 'italic' : 'normal');
  doc.setFontSize(8.5); doc.setTextColor(...INK);
  const declText = declaration
    || 'I certify that the particulars given above are a true and complete list of the persons comprising the crew of the above-named vessel.';
  const declLines = doc.splitTextToSize(declText, pageW - 2 * M);
  doc.text(declLines, M, fy);
  fy += declLines.length * 4 + 6;

  // ── Total (left) + master name / signature / stamp (right) ────────────────
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...labelColor);
  doc.text('TOTAL CREW MEMBERS', M, fy, { charSpace: 0.4 });
  doc.setFont(titleFont, editorial ? 'normal' : 'bold'); doc.setFontSize(editorial ? 15 : 13); doc.setTextColor(...NAVY);
  doc.text(String(rows.length), M, fy + 6.5);

  const sigW = 90;
  const sigX = pageW - M - sigW;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.setTextColor(...MUTED);
  doc.text('MASTER — NAME, SIGNATURE & STAMP', sigX, fy, { charSpace: 0.3 });
  // Signature image sits just above the rule; stamp overlaps to its right.
  if (signature) { try { doc.addImage(signature, 'PNG', sigX, fy + 1.5, 46, 15); } catch { /* bad image */ } }
  if (stamp) { try { doc.addImage(stamp, 'PNG', sigX + sigW - 26, fy - 2, 24, 24); } catch { /* bad image */ } }
  doc.setDrawColor(...HAIR); doc.setLineWidth(0.3); doc.line(sigX, fy + 18, sigX + sigW, fy + 18);
  if (master) { doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...INK); doc.text(master, sigX, fy + 23); }

  // Footer: generated date bottom-left, standard-format reference bottom-right.
  // No app branding — an official vessel document carries only the vessel's own
  // logo (letterhead); the app's "Cargo" mark is deliberately omitted.
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6.8); doc.setTextColor(...FAINT);
  if (generatedAt) doc.text(`Generated ${generatedAt}`, M, pageH - 9);
  doc.text('Format: IMO FAL Form 5 — Crew List', pageW - M, pageH - 9, { align: 'right' });

  const safe = String(vessel.name || 'vessel').replace(/[^\w]+/g, '-');
  doc.save(`Official-crew-list-${safe}-${(generatedAt || '').replace(/[^\w]+/g, '-')}.pdf`);
};
