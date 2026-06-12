// rotaHorExport — audit exports for the Hours-of-Rest log, generated fresh
// from live rota data (NOT the legacy localStorage HOR store, which the
// crew-profile generateHORAuditPDF is hard-wired to).
//
// Two formats share one input shape — the `rows` the RestLogView already
// computes (dept-grouped crew, one rest cell per day) plus `meta` (vessel,
// period, generated-at, MLC minimums). CSV is the lightweight audit/import
// artefact; PDF is the formatted compliance document.
//
// Per-cell breach markers (CSV) / fills (PDF):
//   daily  — rest in that 24h < MLC_DAILY_REST_MIN  (marker '*')
//   weekly — rolling-7d rest at that day < MLC_WEEKLY_REST_MIN (marker '#')

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { MLC_DAILY_REST_MIN, MLC_WEEKLY_REST_MIN } from './restHours';

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parseLocal(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Short column label for a day, e.g. "Mon 3". The month abbreviation is
// only added at month boundaries (1st) so a 31-column export stays readable.
function dayColLabel(dateStr, index) {
  const d = parseLocal(dateStr);
  const base = `${WEEKDAY_SHORT[d.getDay()]} ${d.getDate()}`;
  return (d.getDate() === 1 || index === 0) ? `${base} ${MONTH_SHORT[d.getMonth()]}` : base;
}

// A cell's rest figure as a compact number ("13", "9.5", "off").
function restLabel(cell) {
  if (!cell || cell.isOff) return 'off';
  const n = Number(cell.rest24h.toFixed(1));
  return String(n);
}

// Flatten the dept-grouped rows the view holds into one ordered member list,
// each tagged with its department name (so both formats iterate the same way).
function flatten(rows) {
  const out = [];
  for (const grp of rows || []) {
    for (const m of grp.members || []) {
      out.push({ dept: grp.dept, ...m });
    }
  }
  return out;
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the click has fired.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function safeSlug(s) {
  return String(s || 'rota').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// One CSV field — quote and escape when it contains a comma, quote or newline.
function csvField(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportRestLogCSV({ rows, days, meta }) {
  const members = flatten(rows);
  const lines = [];
  lines.push('Hours of Rest log');
  lines.push(`Vessel,${csvField(meta.vesselName || '—')}`);
  if (meta.departmentName) lines.push(`Department,${csvField(meta.departmentName)}`);
  lines.push(`Period,${csvField(meta.periodLabel)}`);
  lines.push(`Generated,${csvField(meta.generatedAt)}`);
  lines.push(`MLC minimums,${csvField(`Daily ${MLC_DAILY_REST_MIN}h rest · Weekly ${MLC_WEEKLY_REST_MIN}h rest`)}`);
  lines.push('Markers,* daily rest below minimum · # weekly rest below minimum');
  lines.push('');

  const header = [
    'Department', 'Crew', 'Role',
    ...days.map((d, i) => dayColLabel(d, i)),
    'Daily breach days', 'Weekly breach days',
  ];
  lines.push(header.map(csvField).join(','));

  for (const m of members) {
    const cells = m.cells.map((c) => {
      let v = restLabel(c);
      if (c && !c.isOff && c.dailyLow) v += '*';
      if (c && c.weeklyLow) v += '#';
      return v;
    });
    const row = [m.dept, m.name, m.role || '—', ...cells, m.dailyBreachDays, m.weeklyBreachDays];
    lines.push(row.map(csvField).join(','));
  }

  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(blob, `hours-of-rest_${safeSlug(meta.vesselName)}_${safeSlug(meta.periodLabel)}.csv`);
}

export function exportRestLogPDF({ rows, days, meta }) {
  const members = flatten(rows);
  const wide = days.length > 10;
  const doc = new jsPDF({ orientation: wide ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('Hours of Rest log', 40, 40);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(90);
  const subParts = [meta.vesselName || '—'];
  if (meta.departmentName) subParts.push(meta.departmentName);
  subParts.push(meta.periodLabel);
  doc.text(subParts.join('  ·  '), 40, 56);
  doc.text(
    `MLC minimums: daily ${MLC_DAILY_REST_MIN}h rest · weekly ${MLC_WEEKLY_REST_MIN}h rest`,
    40, 69,
  );
  doc.text(`Generated ${meta.generatedAt}`, pageW - 40, 40, { align: 'right' });
  doc.setTextColor(0);

  const head = [[
    'Crew', 'Role', 'Dept',
    ...days.map((d, i) => dayColLabel(d, i)),
    'Breach\ndays',
  ]];

  const warnFill = [232, 168, 145];   // soft terracotta tint
  const offText = [150, 150, 150];

  const body = members.map((m) => {
    const dayCells = m.cells.map((c) => {
      const breach = c && (c.dailyLow || c.weeklyLow);
      const styles = {};
      if (breach) { styles.fillColor = warnFill; styles.textColor = [90, 26, 16]; styles.fontStyle = 'bold'; }
      else if (!c || c.isOff) { styles.textColor = offText; }
      return { content: restLabel(c), styles };
    });
    const totalBreaches = m.dailyBreachDays + m.weeklyBreachDays;
    return [
      m.name,
      m.role || '—',
      m.dept,
      ...dayCells,
      { content: String(totalBreaches), styles: totalBreaches > 0 ? { textColor: [90, 26, 16], fontStyle: 'bold' } : {} },
    ];
  });

  autoTable(doc, {
    head,
    body,
    startY: 84,
    margin: { left: 40, right: 40 },
    styles: { fontSize: wide ? 5.5 : 8, cellPadding: wide ? 2 : 3, halign: 'center', valign: 'middle', lineColor: [223, 216, 204], lineWidth: 0.5 },
    headStyles: { fillColor: [28, 27, 58], textColor: [245, 241, 234], fontSize: wide ? 5.5 : 7.5, halign: 'center' },
    columnStyles: { 0: { halign: 'left', cellWidth: wide ? 60 : 90 }, 1: { halign: 'left' }, 2: { halign: 'left' } },
    theme: 'grid',
  });

  doc.save(`hours-of-rest_${safeSlug(meta.vesselName)}_${safeSlug(meta.periodLabel)}.pdf`);
}
