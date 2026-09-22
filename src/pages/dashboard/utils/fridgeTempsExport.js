// Fridge temperature log — PDF export (food-safety record). Leads with the
// vessel's registration details, then a table of every logged reading.
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { supabase } from '../../../lib/supabaseClient';
import { fetchHistory } from '../../../services/fridgeTemps';

const NAVY = [28, 27, 58];
const TERRA = [198, 90, 26];
const COOL = [248, 250, 252];
const HAIR = [229, 231, 235];

const ddmmyyyy = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};
const hhmm = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const rangeText = (min, max) => {
  if (min == null && max == null) return '—';
  return `${min ?? '−∞'} to ${max ?? '∞'} °C`;
};

export async function exportFridgeTempsPdf(tenantId) {
  const [{ data: vessel }, logs] = await Promise.all([
    supabase?.from('vessels')
      ?.select('name, flag, port_of_registry, imo_number, official_number, call_sign, mmsi, company_name')
      ?.eq('tenant_id', tenantId)?.maybeSingle(),
    fetchHistory(tenantId, { limit: 2000 }),
  ]);

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;

  // ── Header band ────────────────────────────────────────────────────────────
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, pageWidth, 26, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text('FRIDGE TEMPERATURE LOG', margin, 12);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(200, 205, 220);
  doc.text(vessel?.name ? `MY ${vessel.name}` : 'Vessel', margin, 19);

  const now = new Date();
  doc.text(`Exported: ${ddmmyyyy(now.toISOString())} ${hhmm(now.toISOString())}`, pageWidth - margin, 12, { align: 'right' });
  doc.text(`${logs.length} reading${logs.length !== 1 ? 's' : ''}`, pageWidth - margin, 19, { align: 'right' });

  // ── Vessel details strip ────────────────────────────────────────────────────
  let y = 34;
  const details = [
    ['Vessel', vessel?.name || '—'],
    ['IMO', vessel?.imo_number || '—'],
    ['Flag', vessel?.flag || '—'],
    ['Port of Registry', vessel?.port_of_registry || '—'],
    ['Official No.', vessel?.official_number || '—'],
    ['Call sign', vessel?.call_sign || '—'],
  ];
  doc.setFontSize(8);
  const colW = (pageWidth - margin * 2) / 3;
  details.forEach(([label, value], i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = margin + col * colW;
    const yy = y + row * 7;
    doc.setTextColor(139, 132, 120);
    doc.setFont('helvetica', 'bold');
    doc.text(String(label).toUpperCase(), x, yy);
    doc.setTextColor(...NAVY);
    doc.setFont('helvetica', 'normal');
    doc.text(String(value), x + 34, yy);
  });
  y += 7 * Math.ceil(details.length / 3) + 3;

  doc.setDrawColor(...TERRA);
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageWidth - margin, y);
  y += 4;

  // ── Table ────────────────────────────────────────────────────────────────
  const body = logs.map((l) => [
    ddmmyyyy(l.logged_at),
    hhmm(l.logged_at),
    l.fridgeName,
    l.fridgeKind === 'freezer' ? 'Freezer' : 'Fridge',
    l.temp_c == null ? (l.photo_url ? 'photo' : '—') : `${l.temp_c} °C`,
    rangeText(l.safeMin, l.safeMax),
    l.in_range == null ? '—' : (l.in_range ? 'In range' : 'OUT OF RANGE'),
    l.loggedByName || '—',
    l.note || '',
  ]);

  autoTable(doc, {
    startY: y,
    head: [['Date', 'Time', 'Appliance', 'Type', 'Temp', 'Safe range', 'Status', 'Logged by', 'Note']],
    body,
    margin: { left: margin, right: margin },
    styles: { fontSize: 8, cellPadding: { top: 1.6, right: 2, bottom: 1.6, left: 2 }, overflow: 'linebreak', valign: 'middle', lineColor: HAIR, lineWidth: 0.1 },
    headStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
    alternateRowStyles: { fillColor: COOL },
    columnStyles: {
      0: { cellWidth: 22 }, 1: { cellWidth: 14 }, 2: { cellWidth: 40 }, 3: { cellWidth: 20 },
      4: { cellWidth: 20 }, 5: { cellWidth: 34 }, 6: { cellWidth: 30 }, 7: { cellWidth: 40 },
    },
    didParseCell: (data) => {
      // Flag out-of-range rows in red for at-a-glance scanning.
      if (data.section === 'body' && data.column.index === 6 && data.cell.raw === 'OUT OF RANGE') {
        data.cell.styles.textColor = [180, 35, 24];
        data.cell.styles.fontStyle = 'bold';
      }
    },
    didDrawPage: () => {
      doc.setFontSize(7);
      doc.setTextColor(160, 160, 160);
      doc.text(`Page ${doc.internal.getCurrentPageInfo().pageNumber}`, pageWidth / 2, pageHeight - 6, { align: 'center' });
      doc.text('Cargo — Food Safety Record', margin, pageHeight - 6);
    },
  });

  const fname = `fridge-temperature-log-${now.toISOString().slice(0, 10)}.pdf`;
  doc.save(fname);
}
