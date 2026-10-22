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

// Full weekday + date, e.g. "Thursday 23 October 2026" — for the per-day bands.
const dayHeading = (iso) => {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
};

export async function exportFridgeTempsPdf(tenantId) {
  const [{ data: vessel }, logs] = await Promise.all([
    supabase?.from('vessels')
      ?.select('name, flag, port_of_registry, imo_number, official_number, call_sign, mmsi, company_name, vessel_type_label, gt, loa_m')
      ?.eq('tenant_id', tenantId)?.maybeSingle(),
    fetchHistory(tenantId, { limit: 5000 }),
  ]);

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;

  const vesselName = vessel?.name || vessel?.company_name || '—';

  // ── Header band ────────────────────────────────────────────────────────────
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, pageWidth, 28, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.text('FRIDGE TEMPERATURE LOG', margin, 13);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(205, 210, 225);
  const subtitle = vessel?.name
    ? `MY ${vessel.name}${vessel?.vessel_type_label ? ` · ${vessel.vessel_type_label}` : ''}`
    : (vessel?.company_name || 'Vessel');
  doc.text(subtitle, margin, 21);

  const now = new Date();
  doc.setFontSize(9);
  doc.text(`Exported ${ddmmyyyy(now.toISOString())} ${hhmm(now.toISOString())}`, pageWidth - margin, 13, { align: 'right' });
  doc.text(`${logs.length} reading${logs.length !== 1 ? 's' : ''}`, pageWidth - margin, 21, { align: 'right' });

  // ── Vessel identity strip (only the fields that are filled in) ──────────────
  let y = 37;
  const details = [
    ['Vessel', vessel?.name],
    ['Type', vessel?.vessel_type_label],
    ['Flag', vessel?.flag],
    ['IMO', vessel?.imo_number],
    ['Port of Registry', vessel?.port_of_registry],
    ['Official No.', vessel?.official_number],
    ['Call sign', vessel?.call_sign],
    ['MMSI', vessel?.mmsi],
    ['Company', vessel?.company_name],
  ].filter(([, v]) => v != null && String(v).trim() !== '');
  // Always lead with the vessel/company name even when registration isn't filled.
  if (!details.length) details.push(['Vessel', vesselName]);

  doc.setFontSize(9);
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
    doc.text(String(value), x + 36, yy);
  });
  y += 7 * Math.ceil(details.length / 3) + 3;

  doc.setDrawColor(...TERRA);
  doc.setLineWidth(0.6);
  doc.line(margin, y, pageWidth - margin, y);
  y += 4;

  // ── Table — grouped into a band per day so it reads like a daily log ────────
  // Drop the per-row Date column; a full-width day band introduces each date.
  const NCOLS = 8;
  const body = [];
  let lastDay = null;
  logs.forEach((l) => {
    const day = (l.logged_at || '').slice(0, 10);
    if (day !== lastDay) {
      lastDay = day;
      body.push([{ content: dayHeading(l.logged_at), colSpan: NCOLS, styles: { fillColor: [238, 240, 244], textColor: NAVY, fontStyle: 'bold', fontSize: 9.5, halign: 'left', cellPadding: { top: 2.4, bottom: 2.4, left: 3, right: 3 } } }]);
    }
    body.push([
      hhmm(l.logged_at),
      l.fridgeName,
      l.fridgeKind === 'freezer' ? 'Freezer' : 'Fridge',
      l.temp_c == null ? (l.photo_url ? 'photo' : '—') : `${l.temp_c} °C`,
      rangeText(l.safeMin, l.safeMax),
      l.in_range == null ? '—' : (l.in_range ? 'In range' : 'OUT OF RANGE'),
      l.loggedByName || '—',
      l.note || '',
    ]);
  });

  autoTable(doc, {
    startY: y,
    head: [['Time', 'Appliance', 'Type', 'Temp', 'Safe range', 'Status', 'Logged by', 'Note']],
    body,
    margin: { left: margin, right: margin },
    styles: { fontSize: 9, cellPadding: { top: 2.2, right: 2.5, bottom: 2.2, left: 2.5 }, overflow: 'linebreak', valign: 'middle', lineColor: HAIR, lineWidth: 0.1 },
    headStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9 },
    columnStyles: {
      0: { cellWidth: 18 }, 1: { cellWidth: 46, fontStyle: 'bold' }, 2: { cellWidth: 22 },
      3: { cellWidth: 24 }, 4: { cellWidth: 34 }, 5: { cellWidth: 32 }, 6: { cellWidth: 46 }, 7: { cellWidth: 'auto' },
    },
    didParseCell: (data) => {
      // Flag out-of-range rows in red for at-a-glance scanning.
      if (data.section === 'body' && data.column.index === 5 && data.cell.raw === 'OUT OF RANGE') {
        data.cell.styles.textColor = [180, 35, 24];
        data.cell.styles.fontStyle = 'bold';
      }
    },
    didDrawPage: () => {
      doc.setFontSize(7.5);
      doc.setTextColor(160, 160, 160);
      doc.text(`Page ${doc.internal.getCurrentPageInfo().pageNumber}`, pageWidth / 2, pageHeight - 6, { align: 'center' });
      doc.text(`${vesselName} — Food Safety Record`, margin, pageHeight - 6);
    },
  });

  const fname = `fridge-temperature-log-${now.toISOString().slice(0, 10)}.pdf`;
  doc.save(fname);
}
