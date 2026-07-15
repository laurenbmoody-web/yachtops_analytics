// Snag report export — the work-list crews hand to a yard / warranty / class
// surveyor. PDF (jsPDF + autotable, editorial letterhead) and Excel (SheetJS),
// matching the app's existing export conventions.
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

const NAVY = [28, 27, 58];
const TERRA = [198, 90, 26];
const HAIR = [236, 234, 227];
const MUTED = [107, 114, 128];

const STATUS_LABEL = {
  pending_acceptance: 'Pending acceptance', New: 'New', Reopened: 'Reopened', Assigned: 'Assigned',
  InProgress: 'In progress', WaitingParts: 'Waiting parts', Fixed: 'Fixed', Closed: 'Closed', declined: 'Declined',
};
const statusLabel = (s) => STATUS_LABEL[s] || s || '';
const dd = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};
const ownerOf = (d) => {
  if (d.assigneeKind === 'team') return `${d.assignedTeamName || d.departmentOwner || ''} team${d.claimedByName ? ` (→ ${d.claimedByName})` : ''}`.trim();
  return d.assignedToName || 'Unassigned';
};
const locationOf = (d) => d.locationPathLabel || d.locationFreeText || '';
const stamp = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const ROWS = (defects) => defects.map((d) => ([
  d.ref || (d.seq != null ? `DEF-${String(d.seq).padStart(4, '0')}` : ''),
  d.title || '',
  locationOf(d),
  d.priority || '',
  statusLabel(d.status),
  ownerOf(d),
  dd(d.dueDate),
]));

const HEADERS = ['Ref', 'Defect', 'Location', 'Priority', 'Status', 'Owner', 'Due'];

export function exportSnagPdf(defects, { vesselName = 'Vessel', filterLabel = 'All open' } = {}) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  const pageW = doc.internal.pageSize.getWidth();
  const M = 12;

  doc.setTextColor(...TERRA); doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
  doc.text('SNAG REPORT', M, 12, { charSpace: 0.8 });
  doc.setTextColor(...NAVY); doc.setFont('times', 'normal'); doc.setFontSize(22);
  doc.text(vesselName, M, 21);
  doc.setTextColor(...MUTED); doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(`${defects.length} defect${defects.length === 1 ? '' : 's'} · ${filterLabel} · generated ${dd(new Date().toISOString())}`, M, 27);

  doc.setDrawColor(...HAIR); doc.setLineWidth(0.3); doc.line(M, 30, pageW - M, 30);

  autoTable(doc, {
    startY: 34,
    head: [HEADERS],
    body: ROWS(defects),
    margin: { left: M, right: M },
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 2.4, textColor: NAVY, lineColor: HAIR, lineWidth: 0.1, overflow: 'linebreak' },
    headStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
    alternateRowStyles: { fillColor: [250, 250, 248] },
    columnStyles: {
      0: { cellWidth: 22 }, 1: { cellWidth: 70 }, 2: { cellWidth: 60 },
      3: { cellWidth: 22 }, 4: { cellWidth: 32 }, 5: { cellWidth: 45 }, 6: { cellWidth: 22 },
    },
  });

  doc.save(`Snag-report-${stamp()}.pdf`);
}

export function exportSnagExcel(defects, { vesselName = 'Vessel', filterLabel = 'All open' } = {}) {
  const aoa = [
    [`${vesselName} — Snag report`],
    [`${defects.length} defect(s) · ${filterLabel} · generated ${dd(new Date().toISOString())}`],
    [],
    HEADERS,
    ...ROWS(defects),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 12 }, { wch: 40 }, { wch: 34 }, { wch: 10 }, { wch: 18 }, { wch: 26 }, { wch: 12 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Snags');
  XLSX.writeFile(wb, `Snag-report-${stamp()}.xlsx`);
}
