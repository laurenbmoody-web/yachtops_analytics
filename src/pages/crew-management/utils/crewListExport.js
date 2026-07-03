// Crew List export — IMO FAL Form 5 (port authority / immigration) as an A4
// landscape PDF, in two visual templates:
//   • 'fal'       — faithful, official port-authority layout (ruled grid)
//   • 'editorial' — the same data in the Cargo editorial design language
// Built with jsPDF + jspdf-autotable, mirroring kitReceiptExport.js.

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { loadLogoForPdf } from './guestBookExport';

const CARGO_LOGO = '/assets/images/cargo_merged_originalmark_syne800_true.png';

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
const COLUMNS = [
  { header: '#', key: 'idx', w: 8, halign: 'center' },
  { header: 'Rank', key: 'rank', w: 30 },
  { header: 'Surname', key: 'surname', w: 26 },
  { header: 'Fore name', key: 'foreName', w: 26 },
  { header: 'Sex', key: 'sex', w: 12, halign: 'center' },
  { header: 'Date of birth', key: 'dob', w: 22, halign: 'center' },
  { header: 'Place of birth', key: 'placeOfBirth', w: 28 },
  { header: 'Nationality', key: 'nationality', w: 24 },
  { header: 'Passport no.', key: 'passportNo', w: 26 },
  { header: 'Passport exp.', key: 'passportExpiry', w: 22, halign: 'center' },
  { header: 'Issuing state', key: 'issuingState', w: 22 },
  { header: 'Address', key: 'address', w: 0 }, // 0 = take the remainder
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
  passportNo: row.passportNo || '',
  passportExpiry: dd(row.passportExpiry),
  issuingState: row.passportState || '',
  address: row.address || '',
});

// A row of label/value pairs for the vessel + voyage header blocks.
const drawKeyGrid = (doc, pairs, x, y, colW, perRow, accent) => {
  const rowH = 8.5;
  pairs.forEach((p, i) => {
    const cx = x + (i % perRow) * colW;
    const cy = y + Math.floor(i / perRow) * rowH;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6); doc.setTextColor(...accent);
    doc.text(String(p[0]).toUpperCase(), cx, cy, { charSpace: 0.3 });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...INK);
    doc.text(String(p[1] || '—'), cx, cy + 4.4);
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
  } = o;
  const editorial = template === 'editorial';
  const accent = editorial ? TERRA : NAVY;
  const titleFont = editorial ? 'times' : 'helvetica';

  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const M = 12;

  // ── Title ────────────────────────────────────────────────────────────────
  doc.setTextColor(...TERRA); doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
  doc.text('CREW LIST', M, 14, { charSpace: editorial ? 0.6 : 1.2 });
  doc.setTextColor(...NAVY); doc.setFont(titleFont, editorial ? 'normal' : 'bold');
  doc.setFontSize(editorial ? 24 : 18);
  doc.text(vessel.name || 'Vessel', M, editorial ? 24 : 23);

  // Cargo mark / generated date, top-right
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...MUTED);
  if (generatedAt) doc.text(`Generated ${generatedAt}`, pageW - M, 12, { align: 'right' });

  let y = editorial ? 32 : 30;
  doc.setDrawColor(...HAIR); doc.setLineWidth(0.3); doc.line(M, y, pageW - M, y);
  y += 7;

  // ── Vessel identity grid ─────────────────────────────────────────────────
  const vPairs = [
    ['Flag', vessel.flag],
    ['Port of Registry', vessel.port_of_registry],
    ['Official No.', vessel.official_number],
    ['IMO No.', vessel.imo_number],
    ['Call Sign', callSign],
    ['MMSI', vessel.mmsi],
    ['GT', vessel.gt],
    ['LOA (m)', vessel.loa_m],
    ['Class', classNotation],
    ['Year built', vessel.year_built],
    ['Registry type', commercialLabel(vessel)],
  ];
  const gridColW = (pageW - 2 * M) / 6;
  y = drawKeyGrid(doc, vPairs, M, y, gridColW, 6, accent) + 3;

  doc.setDrawColor(...HAIR); doc.setLineWidth(0.2); doc.line(M, y, pageW - M, y);
  y += 6;

  // ── Voyage box ───────────────────────────────────────────────────────────
  const voyPairs = [
    ['Port of Arrival', voyage.portOfArrival],
    ['Last Port', voyage.lastPort],
    ['Next Port', voyage.nextPort],
    ['Arrival', [dd(voyage.arrivalDate), voyage.arrivalTime].filter(Boolean).join(' ')],
    ['Departure', [dd(voyage.departureDate), voyage.departureTime].filter(Boolean).join(' ')],
  ];
  y = drawKeyGrid(doc, voyPairs, M, y, (pageW - 2 * M) / 5, 5, accent) + 4;

  // ── Crew table ───────────────────────────────────────────────────────────
  const columnStyles = {};
  COLUMNS.forEach((c, i) => { if (c.w) columnStyles[i] = { cellWidth: c.w, halign: c.halign || 'left' }; else columnStyles[i] = { halign: c.halign || 'left' }; });

  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    head: [COLUMNS.map((c) => c.header)],
    body: rows.map((r, i) => {
      const cells = rowToCells(r, i);
      return COLUMNS.map((c) => cells[c.key]);
    }),
    styles: {
      font: 'helvetica', fontSize: 7.6, cellPadding: editorial ? 2 : 1.8,
      textColor: INK, lineColor: HAIR, lineWidth: editorial ? 0.1 : 0.15, overflow: 'linebreak',
    },
    headStyles: editorial
      ? { fillColor: [250, 250, 248], textColor: MUTED, fontStyle: 'bold', fontSize: 6.6, lineColor: HAIR, lineWidth: 0.1 }
      : { fillColor: NAVY, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 6.8, lineColor: NAVY, lineWidth: 0.15 },
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

  let fy = (doc.lastAutoTable?.finalY || y) + 8;
  if (fy > pageH - 26) { doc.addPage(); fy = 20; }

  // ── Footer: total + master signature ─────────────────────────────────────
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...accent);
  doc.text('TOTAL CREW MEMBERS', M, fy, { charSpace: 0.4 });
  doc.setFont(titleFont, editorial ? 'normal' : 'bold'); doc.setFontSize(editorial ? 15 : 13); doc.setTextColor(...NAVY);
  doc.text(String(rows.length), M, fy + 6.5);

  const sigX = pageW - M - 90;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.setTextColor(...MUTED);
  doc.text('MASTER — NAME & SIGNATURE', sigX, fy, { charSpace: 0.3 });
  doc.setDrawColor(...HAIR); doc.setLineWidth(0.3); doc.line(sigX, fy + 12, sigX + 90, fy + 12);
  if (master) { doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...INK); doc.text(master, sigX, fy + 10); }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...MUTED);
  doc.text(generatedAt || '', sigX, fy + 16);

  // Cargo mark bottom-left (editorial only; FAL stays plain/official).
  if (editorial) {
    const logo = await loadLogoForPdf(CARGO_LOGO);
    if (logo?.dataUrl) {
      const h = 4.2; const w = h * (logo.aspect || 6.7);
      try { doc.addImage(logo.dataUrl, 'PNG', M, pageH - 10, w, h); } catch { /* skip */ }
    }
  }

  const safe = String(vessel.name || 'vessel').replace(/[^\w]+/g, '-');
  doc.save(`Crew-list-${safe}-${(generatedAt || '').replace(/[^\w]+/g, '-')}.pdf`);
};
