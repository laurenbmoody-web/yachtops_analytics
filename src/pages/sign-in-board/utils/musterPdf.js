import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

const hhmm = (d) => { try { return new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };

// Export a muster to a landscape A4 PDF: people down the left, a column per roll
// call (with the time it was taken), ✓ where accounted, and a footer tally.
export function exportMusterPdf({ vesselName, rolls = [], rollMarks = {}, roster = [], expectedCount = 0, takenBy = '' }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  const now = new Date();

  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(28, 27, 58);
  doc.text(`${vesselName || 'Vessel'} — Muster`, 14, 15);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(110, 110, 110);
  doc.text(now.toLocaleString('en-GB', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + (takenBy ? ` · ${takenBy}` : ''), 14, 21);
  doc.setTextColor(0, 0, 0);

  const head = [['Name', 'Dept / detail', ...rolls.map((r) => `${r.name}${r.startedAt ? `\n${hhmm(r.startedAt)}` : ''}`)]];
  const body = roster.map((p) => [
    p.name,
    p.aboard ? (p.sub || '') : 'Ashore',
    ...rolls.map((r) => (rollMarks[r.id]?.[p.key] ? 'Yes' : '—')),
  ]);
  const tally = ['Accounted for', '', ...rolls.map((r) => `${roster.filter((p) => p.aboard && rollMarks[r.id]?.[p.key]).length} / ${expectedCount}`)];

  autoTable(doc, {
    startY: 26,
    head,
    body: [...body, tally],
    styles: { fontSize: 9, cellPadding: 1.8, valign: 'middle' },
    headStyles: { fillColor: [28, 27, 58], textColor: 255, halign: 'center' },
    columnStyles: { 0: { fontStyle: 'bold' } },
    didParseCell: (data) => {
      // Centre and colour the roll-call columns.
      if (data.column.index >= 2) {
        data.cell.styles.halign = 'center';
        if (data.section === 'body' && data.cell.raw === 'Yes') {
          data.cell.styles.textColor = [30, 127, 67];
          data.cell.styles.fontStyle = 'bold';
        }
      }
      // Emphasise the tally row.
      if (data.section === 'body' && data.row.index === body.length) {
        data.cell.styles.fillColor = [247, 248, 250];
        data.cell.styles.fontStyle = 'bold';
      }
    },
  });

  doc.save(`muster-${now.toISOString().slice(0, 16).replace(/[:T]/g, '-')}.pdf`);
}
