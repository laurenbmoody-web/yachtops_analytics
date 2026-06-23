// rotaHorExport — audit exports for the Hours-of-Rest log, generated fresh
// from live rota data (NOT the legacy localStorage HOR store, which the
// crew-profile generateHORAuditPDF is hard-wired to).
//
// Two formats:
//   • CSV — the lightweight data/import artefact: the crew × day matrix of
//     REST hours with breach markers.
//   • PDF — an MLC 2006 / IMO-ILO conforming "Record of Hours of Rest": a
//     fleet summary page followed by ONE per-seafarer monthly record, each
//     with the 24h-per-day work/rest grid, daily + rolling-7-day rest totals,
//     a non-conformities list, and master/seafarer signature blocks. This is
//     the artefact a PSC / flag inspector expects (IMO/ILO joint Guidelines
//     for the format of records of seafarers' hours of rest; MLC Std A2.3;
//     STCW Code A-VIII/1).
//
// Compliance numbers are computed by the shared restHours engine (assessMlc),
// so every figure here matches the on-screen matrix and the rest panel.

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  ON_DUTY_TYPES,
  assessMlc,
  MLC_DAILY_REST_MIN,
  MLC_WEEKLY_REST_MIN,
  MLC_MAX_REST_PERIODS,
  MLC_LONGEST_REST_PERIOD_MIN,
  MLC_MAX_WORK_STRETCH,
  MLC_STANDARD_REF,
  reframeToOperationalDay,
} from './restHours';

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const STANDARD_REF = MLC_STANDARD_REF;   // shared single source (restHours.js)

// Cargo wordmark for the PDF letterhead. Resolves to an <img> (jsPDF accepts it
// directly) or null if it can't load — the export proceeds either way.
const CARGO_LOGO_URL = '/assets/images/cargo_merged_originalmark_syne800_true.png';
function loadCargoLogo() {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = CARGO_LOGO_URL;
    } catch { resolve(null); }
  });
}
// Draw the logo very small at the top-right, just above the "Generated" line.
function drawCargoLogo(doc, logo, pageW, M = 40) {
  if (!logo || !logo.naturalWidth) return;
  const h = 14;
  let w = h * (logo.naturalWidth / logo.naturalHeight);
  if (w > 96) w = 96;
  doc.addImage(logo, 'PNG', pageW - M - w, 20, w, h);
}

// ── shared date helpers ─────────────────────────────────────────────────────
function pad2(n) { return String(n).padStart(2, '0'); }
function parseLocal(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, m - 1, d);
}
function toYmd(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function addDays(dateStr, n) {
  const d = parseLocal(dateStr);
  d.setDate(d.getDate() + n);
  return toYmd(d);
}
function hhmmToDecimal(t) {
  if (!t) return null;
  const [h, m] = String(t).split(':').map(Number);
  return h + (m || 0) / 60;
}

// Short column label for a day, e.g. "Mon 3". The month abbreviation is only
// added at month boundaries (1st) so a 31-column export stays readable.
function dayColLabel(dateStr, index) {
  const d = parseLocal(dateStr);
  const base = `${WEEKDAY_SHORT[d.getDay()]} ${d.getDate()}`;
  return (d.getDate() === 1 || index === 0) ? `${base} ${MONTH_SHORT[d.getMonth()]}` : base;
}
function dayRowLabel(dateStr) {
  const d = parseLocal(dateStr);
  const mon = (d.getDate() === 1) ? ` ${MONTH_SHORT[d.getMonth()]}` : '';
  return `${WEEKDAY_SHORT[d.getDay()]} ${pad2(d.getDate())}${mon}`;
}

// On-duty intervals for one member on one calendar day, in decimal hours
// clipped to [0, 24] for the grid. Overnight spill past 24:00 is clipped here
// (it is attributed to the day it commenced, matching restForDay) — see the
// footnote drawn under each record.
function onDutyIntervalsForDay(windowShifts, memberId, dateStr) {
  return windowShifts
    .filter((s) => s.memberId === memberId && s.date === dateStr && ON_DUTY_TYPES.has(s.shiftType))
    .map((s) => {
      const start = hhmmToDecimal(s.startTime);
      let end = hhmmToDecimal(s.endTime);
      if (start == null || end == null || start === end) return null;
      if (end <= start) end += 24;
      return { start: Math.max(0, start), end: Math.min(24, end) };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);
}

// Full per-(member, day) assessment via the shared engine — every figure and
// breach the formal record reports comes from here.
function computeCellFull(windowShifts, memberId, dateStr) {
  const dayShifts = windowShifts.filter((s) => s.memberId === memberId && s.date === dateStr);
  const weekStart = addDays(dateStr, -6);
  const weekShifts = windowShifts.filter(
    (s) => s.memberId === memberId && s.date >= weekStart && s.date <= dateStr,
  );
  const onDuty = dayShifts.filter((s) => ON_DUTY_TYPES.has(s.shiftType));
  const isOff = onDuty.length === 0;
  const mlc = assessMlc({ dayShifts, weekShifts });
  return {
    date: dateStr,
    isOff,
    rest24h: mlc.rest24h,
    pastWeekHours: mlc.pastWeekHours,
    dailyLow: !isOff && mlc.rest24h < MLC_DAILY_REST_MIN,
    weeklyLow: mlc.pastWeekHours < MLC_WEEKLY_REST_MIN,
    breaches: mlc.breaches,
    intervals: onDutyIntervalsForDay(windowShifts, memberId, dateStr),
  };
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

function restLogFileBase(meta) {
  return `hours-of-rest_${safeSlug(meta.vesselName)}_${safeSlug(meta.periodLabel)}`;
}

// ── CSV (data/import artefact) ──────────────────────────────────────────────
// A tidy, one-row-per-(crew, day) data table — sorts/filters/pivots cleanly for
// payroll and audit. A short metadata preamble names the vessel/period, then the
// data table proper. Built without touching the DOM so callers can download it
// (exportRestLogCSV) or attach/email it. `breachReasons` (keyed `userId|date`)
// adds the recorded reason on breach days.
export function buildRestLogCSV({ rows, days, meta, breachReasons = {} }) {
  const members = flatten(rows);
  const lines = [];
  lines.push('Record of Hours of Rest (data export)');
  lines.push(`Vessel,${csvField(meta.vesselName || '—')}`);
  if (meta.imoNumber) lines.push(`IMO number,${csvField(meta.imoNumber)}`);
  if (meta.flagState) lines.push(`Flag,${csvField(meta.flagState)}`);
  if (meta.departmentName) lines.push(`Department,${csvField(meta.departmentName)}`);
  lines.push(`Period,${csvField(meta.periodLabel)}`);
  lines.push(`Generated,${csvField(meta.generatedAt)}`);
  lines.push(`Standard,${csvField(STANDARD_REF)}`);
  if (meta.basisLabel) lines.push(`Basis,${csvField(meta.basisLabel)}`);
  lines.push('Figures,Hours are REST (not hours worked). Rest is per 24h; 7-day rest is the rolling total.');
  lines.push('');

  const header = [
    'Date', 'Weekday', 'Department', 'Crew', 'Role', 'Status',
    'Rest (h)', 'On duty (h)', '7-day rest (h)',
    'Daily breach', 'Weekly breach', 'Breach reason',
  ];
  lines.push(header.map(csvField).join(','));

  const dec1 = (n) => Number((Number(n) || 0).toFixed(1));
  for (const m of members) {
    (m.cells || []).forEach((c) => {
      const d = parseLocal(c.date);
      const rest = c.isOff ? 24 : dec1(c.rest24h);
      const onDuty = c.isOff ? 0 : dec1(24 - c.rest24h);
      const note = (breachReasons[`${m.userId}|${c.date}`] || {}).note_text || '';
      const row = [
        `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`,
        WEEKDAY_SHORT[d.getDay()],
        m.dept,
        m.name,
        m.role || '—',
        c.isOff ? 'Off' : 'On duty',
        rest,
        onDuty,
        dec1(c.pastWeekHours),
        c.dailyLow ? 'Yes' : 'No',
        c.weeklyLow ? 'Yes' : 'No',
        note,
      ];
      lines.push(row.map(csvField).join(','));
    });
  }

  // Lead with a UTF-8 BOM so Excel reads accented characters correctly.
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  return { blob, filename: `${restLogFileBase(meta)}.csv` };
}

export function exportRestLogCSV({ rows, days, meta, breachReasons = {} }) {
  const { blob, filename } = buildRestLogCSV({ rows, days, meta, breachReasons });
  triggerDownload(blob, filename);
}

// ── PDF: shared chrome ──────────────────────────────────────────────────────
const NAVY = [28, 27, 58];
const CREAM = [245, 241, 234];
const WARN_FILL = [232, 168, 145];
const WARN_TEXT = [90, 26, 16];
const OFF_TEXT = [150, 150, 150];
const GRID_LINE = [205, 199, 187];
const HOUR_LINE = [120, 120, 120];

function fieldPair(doc, label, value, x, y, valueX) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(90);
  doc.text(label, x, y);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(0);
  doc.text(value || '—', valueX, y);
}

// Fleet summary page — the crew × day matrix of rest hours (overview).
function drawSummaryPage(doc, members, days, meta, logo) {
  const pageW = doc.internal.pageSize.getWidth();
  drawCargoLogo(doc, logo, pageW);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(0);
  doc.text('Record of Hours of Rest — Summary', 40, 40);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(90);
  const subParts = [meta.vesselName || '—'];
  if (meta.imoNumber) subParts.push(`IMO ${meta.imoNumber}`);
  if (meta.flagState) subParts.push(meta.flagState);
  if (meta.departmentName) subParts.push(meta.departmentName);
  subParts.push(meta.periodLabel);
  doc.text(subParts.join('  ·  '), 40, 55);
  doc.text(`${STANDARD_REF}${meta.basisLabel ? `  ·  ${meta.basisLabel}.` : ''}`, 40, 67, { maxWidth: pageW - 80 });
  doc.text('Figures are HOURS OF REST per 24h (not hours worked). Shaded = below MLC minimum · * daily · # weekly.', 40, 84);
  doc.text(`Generated ${meta.generatedAt}`, pageW - 40, 40, { align: 'right' });
  doc.setTextColor(0);

  const head = [[
    'Crew', 'Role', 'Dept',
    ...days.map((d, i) => dayColLabel(d, i)),
    'Daily\nbreach', 'Weekly\nbreach',
  ]];
  const wide = days.length > 10;
  const body = members.map((m) => {
    const dayCells = m.cells.map((c) => {
      const breach = c && (c.dailyLow || c.weeklyLow);
      const styles = {};
      if (breach) { styles.fillColor = WARN_FILL; styles.textColor = WARN_TEXT; styles.fontStyle = 'bold'; }
      else if (!c || c.isOff) { styles.textColor = OFF_TEXT; }
      // Markers mirror the CSV so daily vs weekly breaches are distinguishable
      // (the shading alone can't tell them apart).
      let content = restLabel(c);
      if (c && !c.isOff && c.dailyLow) content += '*';
      if (c && c.weeklyLow) content += '#';
      return { content, styles };
    });
    return [
      m.name, m.role || '—', m.dept, ...dayCells,
      { content: String(m.dailyBreachDays), styles: m.dailyBreachDays > 0 ? { textColor: WARN_TEXT, fontStyle: 'bold' } : {} },
      { content: String(m.weeklyBreachDays), styles: m.weeklyBreachDays > 0 ? { textColor: WARN_TEXT, fontStyle: 'bold' } : {} },
    ];
  });

  autoTable(doc, {
    head,
    body,
    startY: 96,
    margin: { left: 40, right: 40 },
    styles: { fontSize: wide ? 5.5 : 8, cellPadding: wide ? 2 : 3, halign: 'center', valign: 'middle', lineColor: GRID_LINE, lineWidth: 0.5 },
    headStyles: { fillColor: NAVY, textColor: CREAM, fontSize: wide ? 5.5 : 7.5, halign: 'center' },
    columnStyles: { 0: { halign: 'left', cellWidth: wide ? 60 : 90 }, 1: { halign: 'left' }, 2: { halign: 'left' } },
    theme: 'grid',
  });
}

// Concatenated rota shift notes for a member on a day — the "reason given at
// rota time" that feeds the Notes column.
function dayShiftNote(windowShifts, memberId, ds) {
  const notes = (windowShifts || [])
    .filter((s) => s.member_id === memberId && s.shift_date === ds && s.notes)
    .map((s) => String(s.notes).trim())
    .filter(Boolean);
  return notes.length ? Array.from(new Set(notes)).join('; ') : '';
}

// Notes-column value for a breach day: the HOR-logged reason wins, else the
// rota-time shift note, else a dash. (No unicode marks — jsPDF's built-in
// Helvetica can't encode glyphs like ✓ and renders them as garbage.)
function breachNoteFor(breachReasons, windowShifts, member, ds) {
  const r = breachReasons && breachReasons[`${member.userId}|${ds}`];
  if (r && r.note_text) return r.note_text;
  return dayShiftNote(windowShifts, member.id, ds) || '—';
}

// "Recorded by" cell: "Name · Role" then the date (two lines). Name + role
// resolve via the crew maps threaded through meta.
function breachAttributionFor(breachReasons, meta, member, ds) {
  const r = breachReasons && breachReasons[`${member.userId}|${ds}`];
  if (!r || !r.note_text) return '';
  const uid = r.signed_off_by || r.updated_by;
  const who = (meta && meta.crewNames && meta.crewNames[uid]) || '';
  const role = (meta && meta.crewRoles && meta.crewRoles[uid]) || '';
  const whenIso = r.signed_off_at || r.updated_at;
  let when = '';
  if (whenIso) {
    const d = new Date(whenIso);
    if (!Number.isNaN(d.getTime())) {
      when = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    }
  }
  const nameRole = [who, role].filter(Boolean).join(' · ');
  return [nameRole, when].filter(Boolean).join('\n');
}

// Declaration + signature lines, drawn at atY (defaults to near the foot). When
// `sigs` is supplied ({ master, seafarer }, each { img:{dataUrl,w,h}, name, date })
// the captured e-signatures are drawn above the lines with the signed name +
// date — the signed record sent to management. Otherwise the lines are blank.
function drawSignatureBlock(doc, pageW, pageH, M, atY, caption, sigs) {
  const sy = atY != null ? atY : pageH - M - 46;
  doc.setDrawColor(...GRID_LINE); doc.setLineWidth(0.5);
  doc.line(M, sy - 10, pageW - M, sy - 10);
  doc.setFont('helvetica', 'italic'); doc.setFontSize(7); doc.setTextColor(70);
  doc.text(caption || 'I confirm that the above is a true record of the seafarer’s hours of rest for the period stated.', M, sy);
  doc.setFont('helvetica', 'normal'); doc.setTextColor(0); doc.setFontSize(8);
  const sigW = (pageW - 2 * M - 40) / 2;
  const line1 = sy + 30;

  // Draw a captured signature image + signed name/date for one side.
  const placeSig = (sig, x) => {
    if (!sig) return;
    if (sig.img && sig.img.dataUrl) {
      const hImg = 22;
      let w = (sig.img.w && sig.img.h) ? hImg * (sig.img.w / sig.img.h) : 90;
      if (w > sigW) w = sigW;
      try { doc.addImage(sig.img.dataUrl, 'PNG', x, line1 - hImg - 1, w, hImg); } catch { /* skip a bad image */ }
    }
    const stamp = [sig.name, sig.date].filter(Boolean).join('   ·   ');
    if (stamp) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(40);
      doc.text(stamp, x, line1 + 18);
    }
  };
  placeSig(sigs?.master, M);
  placeSig(sigs?.seafarer, pageW - M - sigW);

  doc.line(M, line1, M + sigW, line1);
  doc.line(pageW - M - sigW, line1, pageW - M, line1);
  doc.setFontSize(7); doc.setTextColor(90);
  doc.text('Master / Authorised officer — signature & date', M, line1 + 10);
  doc.text('Seafarer — signature & date', pageW - M - sigW, line1 + 10);
}

// One per-seafarer monthly record: header block + 24h work/rest grid with
// daily + rolling-7-day rest totals, non-conformities, and signatures.
function drawSeafarerRecord(doc, member, days, windowShifts, meta, logo, breachReasons, sigs) {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const M = 36;

  // ── Title + standard reference ──
  drawCargoLogo(doc, logo, pageW, M);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(0);
  doc.text('RECORD OF HOURS OF REST', M, 38);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(90);
  doc.text(`${STANDARD_REF}${meta.basisLabel ? `  ·  ${meta.basisLabel}.` : ''}`, M, 50, { maxWidth: pageW - 2 * M });
  doc.text(`Generated ${meta.generatedAt}`, pageW - M, 46, { align: 'right' });

  // ── Identity block (two columns) ──
  const colL = M;
  const colLval = M + 96;
  const colR = pageW / 2 + 20;
  const colRval = colR + 96;
  let y = 72;
  fieldPair(doc, "Ship's name", meta.vesselName, colL, y, colLval);
  fieldPair(doc, 'Seafarer', member.name, colR, y, colRval);
  y += 13;
  fieldPair(doc, 'IMO number', meta.imoNumber, colL, y, colLval);
  fieldPair(doc, 'Position / rank', member.role || '—', colR, y, colRval);
  y += 13;
  fieldPair(doc, 'Flag State', meta.flagState, colL, y, colLval);
  fieldPair(doc, 'Department', member.dept || '—', colR, y, colRval);
  y += 13;
  fieldPair(doc, 'Port of registry', meta.portOfRegistry, colL, y, colLval);
  fieldPair(doc, 'Period', meta.periodLabel, colR, y, colRval);

  // ── Grid geometry ──
  const dateColW = 66;
  const totalColW = 42;
  const totalsW = totalColW * 2;
  const gridLeft = M + dateColW;
  const gridRight = pageW - M - totalsW;
  const gridW = gridRight - gridLeft;
  const slotW = gridW / 48; // 48 half-hour slots

  const hourLabelY = y + 20;
  const gridTop = hourLabelY + 6;
  // Reserve room below for non-conformities + signatures.
  const gridBottomMax = pageH - M - 132;
  const nDays = days.length;
  const rowH = Math.max(8, Math.min(15, (gridBottomMax - gridTop) / nDays));
  const gridBottom = gridTop + rowH * nDays;

  // Column headers
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(0);
  doc.text('Date', M + 2, gridTop - 4);
  doc.text('Rest', gridRight + totalColW / 2, gridTop - 12, { align: 'center' });
  doc.text('24h', gridRight + totalColW / 2, gridTop - 4, { align: 'center' });
  doc.text('Rest', gridRight + totalColW + totalColW / 2, gridTop - 12, { align: 'center' });
  doc.text('7d', gridRight + totalColW + totalColW / 2, gridTop - 4, { align: 'center' });

  // Hour ticks (every 2h) + vertical hour gridlines (0..24)
  doc.setFontSize(5.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(110);
  for (let h = 0; h <= 24; h += 1) {
    const x = gridLeft + h * 2 * slotW;
    if (h % 2 === 0) doc.text(String(h), x, hourLabelY, { align: 'center' });
  }

  // ── Rows ──
  doc.setDrawColor(...GRID_LINE);
  doc.setLineWidth(0.4);
  for (let i = 0; i < nDays; i += 1) {
    const cell = computeCellFull(windowShifts, member.id, days[i]);
    const rowY = gridTop + i * rowH;

    // weekend tint on the date label cell
    const wd = parseLocal(days[i]).getDay();
    if (wd === 0 || wd === 6) {
      doc.setFillColor(247, 244, 238);
      doc.rect(M, rowY, dateColW, rowH, 'F');
    }

    // date label
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(60);
    doc.text(dayRowLabel(days[i]), M + 3, rowY + rowH / 2 + 2);

    // work blocks (navy fill)
    doc.setFillColor(...NAVY);
    for (const iv of cell.intervals) {
      const x0 = gridLeft + iv.start * slotW;
      const w = (iv.end - iv.start) * slotW;
      if (w > 0) doc.rect(x0, rowY + 0.6, w, rowH - 1.2, 'F');
    }

    // totals — rest in 24h
    const r24 = gridRight;
    const r7 = gridRight + totalColW;
    if (cell.dailyLow) { doc.setFillColor(...WARN_FILL); doc.rect(r24, rowY, totalColW, rowH, 'F'); }
    if (cell.weeklyLow) { doc.setFillColor(...WARN_FILL); doc.rect(r7, rowY, totalColW, rowH, 'F'); }
    doc.setFontSize(6.5);
    doc.setTextColor(...(cell.dailyLow ? WARN_TEXT : (cell.isOff ? OFF_TEXT : [0, 0, 0])));
    doc.text(cell.isOff ? 'off' : String(Number(cell.rest24h.toFixed(1))), r24 + totalColW / 2, rowY + rowH / 2 + 2, { align: 'center' });
    doc.setTextColor(...(cell.weeklyLow ? WARN_TEXT : [0, 0, 0]));
    doc.text(String(Math.round(cell.pastWeekHours)), r7 + totalColW / 2, rowY + rowH / 2 + 2, { align: 'center' });

    // row separator
    doc.setDrawColor(...GRID_LINE);
    doc.line(M, rowY + rowH, gridRight + totalsW, rowY + rowH);
  }

  // Vertical hour gridlines over the grid body
  for (let h = 0; h <= 24; h += 1) {
    const x = gridLeft + h * 2 * slotW;
    if (h % 6 === 0) { doc.setDrawColor(...HOUR_LINE); doc.setLineWidth(0.6); }
    else { doc.setDrawColor(...GRID_LINE); doc.setLineWidth(0.3); }
    doc.line(x, gridTop, x, gridBottom);
  }
  // Outer frame + column separators
  doc.setDrawColor(...HOUR_LINE);
  doc.setLineWidth(0.6);
  doc.rect(M, gridTop, dateColW + gridW + totalsW, rowH * nDays);
  doc.line(gridLeft, gridTop, gridLeft, gridBottom);
  doc.line(gridRight, gridTop, gridRight, gridBottom);
  doc.line(gridRight + totalColW, gridTop, gridRight + totalColW, gridBottom);

  // Legend
  let ly = gridBottom + 14;
  doc.setFillColor(...NAVY); doc.rect(M, ly - 6, 9, 7, 'F');
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(60);
  doc.text('on duty (work)', M + 13, ly);
  doc.setDrawColor(...GRID_LINE); doc.setLineWidth(0.5);
  doc.rect(M + 78, ly - 6, 9, 7);
  doc.text('rest', M + 91, ly);
  doc.setFillColor(...WARN_FILL); doc.rect(M + 120, ly - 6, 9, 7, 'F');
  doc.text('below MLC minimum', M + 133, ly);
  doc.text('Overnight work is attributed to the day it commenced.', pageW - M, ly, { align: 'right' });

  // ── Non-conformities (per-day table, with recorded reason) ──
  ly += 16;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(0);
  doc.text('Recorded non-conformities', M, ly);

  const ncRows = [];
  for (const ds of days) {
    const c = computeCellFull(windowShifts, member.id, ds);
    if (!c.breaches || c.breaches.length === 0) continue;
    ncRows.push([
      dayRowLabel(ds),
      c.breaches.map((b) => b.label).join(' · '),
      breachNoteFor(breachReasons, windowShifts, member, ds),
      breachAttributionFor(breachReasons, meta, member, ds),
    ]);
  }

  if (ncRows.length === 0) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(40, 110, 60);
    doc.text('None recorded for this period.', M, ly + 12);
    drawSignatureBlock(doc, pageW, pageH, M, undefined, undefined, sigs);
    return;
  }

  // A2 — keep the grid page clean: note the count here, then put the full list
  // on its own continuation page(s).
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(90);
  doc.text(
    `${ncRows.length} non-conformity day${ncRows.length === 1 ? '' : 's'} recorded — listed and signed on the following page.`,
    M, ly + 12,
  );

  // The grid is the primary record: sign it on this page regardless of breaches.
  drawSignatureBlock(doc, pageW, pageH, M, undefined, undefined, sigs);

  // Dedicated, full-landscape-width table that auto-paginates. Notes carries the
  // reason (rota-time shift note or HOR log); "Recorded by" the author + date.
  doc.addPage();
  const drawNcHeader = () => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(0);
    doc.text(`Recorded non-conformities — ${member.name || ''}`, M, 40);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(90);
    doc.text(`${meta.vesselName || ''}${meta.periodLabel ? ` · ${meta.periodLabel}` : ''}`, M, 52);
  };
  autoTable(doc, {
    startY: 64,
    margin: { left: M, right: M, top: 64 },
    head: [['Date', 'Non-conformity', 'Notes / reason (rota or HOR log)', 'Recorded by']],
    body: ncRows,
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 3.5, lineColor: GRID_LINE, lineWidth: 0.5, valign: 'middle', textColor: [40, 40, 40] },
    headStyles: { font: 'helvetica', fillColor: NAVY, textColor: CREAM, fontSize: 8.5, halign: 'left' },
    columnStyles: {
      0: { cellWidth: 70, textColor: WARN_TEXT, fontStyle: 'bold' },
      1: { cellWidth: 215 },
      2: { cellWidth: 'auto' },
      3: { cellWidth: 118, fontSize: 7.5, textColor: [110, 110, 110] },
    },
    theme: 'grid',
    didDrawPage: () => drawNcHeader(),
  });
  let endY = (doc.lastAutoTable ? doc.lastAutoTable.finalY : 64) + 24;
  if (endY > pageH - M - 64) { doc.addPage(); endY = M + 48; }
  drawSignatureBlock(doc, pageW, pageH, M, endY,
    'I confirm the non-conformities listed above and the reasons recorded are a true and accurate account.', sigs);
}

// Render the full Record of Hours of Rest document and return the jsPDF doc.
// Shared by exportRestLogPDF (downloads) and buildRestLogPDF (returns a blob to
// attach/email) so every delivery path produces the identical document.
async function renderRestLogDoc({ rows, days, meta, windowShifts = [], breachReasons = {}, signatures = {} }) {
  const members = flatten(rows);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const logo = await loadCargoLogo();

  // Page 1 — fleet summary matrix.
  drawSummaryPage(doc, members, days, meta, logo);

  // Operational-day basis re-anchors the daily-rest assessment (no-op for the
  // default calendar basis). The summary's per-cell rest comes from pre-framed
  // member.cells; the per-seafarer grids recompute, so reframe their input here.
  const framedShifts = reframeToOperationalDay(windowShifts, meta.horDayStartHour || 0);

  // Pages 2…N — one formal record per seafarer.
  for (const m of members) {
    doc.addPage();
    drawSeafarerRecord(doc, m, days, framedShifts, meta, logo, breachReasons, signatures[m.userId]);
  }

  // Footer page numbers.
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i += 1) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(140);
    doc.text(
      `${meta.vesselName || 'Vessel'} · ${meta.periodLabel} · Page ${i} of ${total}`,
      pageW / 2, pageH - 16, { align: 'center' },
    );
  }

  return doc;
}

export async function buildRestLogPDF(args) {
  const doc = await renderRestLogDoc(args);
  return { blob: doc.output('blob'), filename: `${restLogFileBase(args.meta)}.pdf` };
}

export async function exportRestLogPDF(args) {
  const doc = await renderRestLogDoc(args);
  doc.save(`${restLogFileBase(args.meta)}.pdf`);
}
