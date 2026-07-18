// Excel export of a budget-vs-actual view, laid out like the owner's-office
// expenditure-analysis report: title block, coded lines grouped into sections with
// section subtotals, then TOTAL REVENUE / TOTAL EXPENDITURE / NET rows. Money is
// written as numbers so the spreadsheet can sum. Mirrors the SheetJS pattern used
// in src/pages/defects/utils/snagReportExport.js.
import * as XLSX from 'xlsx';

const pad2 = (n) => String(n).padStart(2, '0');
const dmy = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
};
const n2 = (v) => Math.round(Number(v || 0) * 100) / 100;

export const exportBudgetXlsx = (view) => {
  const { budget, buckets = [], unbudgeted, totals, revenueTotals, net } = view;
  const aoa = [];
  aoa.push(['BUDGET REPORT', '', '', '', '', '', '']);
  aoa.push([budget.name]);
  aoa.push([`Period: ${dmy(budget.period_start)} – ${dmy(budget.period_end)}`, '', `Base currency: ${budget.currency}`]);
  aoa.push([]);
  aoa.push(['Code', 'Description', 'Budgeted', 'Actual', 'On order', 'Remaining', 'Comment']);

  const section = (title, rows, subtotal) => {
    aoa.push([title]);
    rows.forEach((r) => aoa.push([
      r.code || '', r.category, n2(r.budgeted), n2(r.actual), n2(r.committed), n2(r.remaining), r.note || '',
    ]));
    aoa.push(['', `TOTAL ${title}`, n2(subtotal.budgeted), n2(subtotal.actual), n2(subtotal.committed), n2(subtotal.remaining), '']);
    aoa.push([]);
  };

  buckets.filter((b) => b.kind === 'revenue').forEach((b) => section(b.bucket.toUpperCase(), b.lines, b.subtotal));
  buckets.filter((b) => b.kind !== 'revenue').forEach((b) => section(b.bucket.toUpperCase(), b.lines, b.subtotal));
  if (unbudgeted) section('UNBUDGETED', unbudgeted.lines, unbudgeted.subtotal);

  aoa.push(['', 'TOTAL REVENUE', n2(revenueTotals.budgeted), n2(revenueTotals.actual), 0, n2(revenueTotals.remaining), '']);
  aoa.push(['', 'TOTAL EXPENDITURE', n2(totals.budgeted), n2(totals.actual), n2(totals.committed), n2(totals.remaining), '']);
  aoa.push(['', 'NET REVENUE (EXPENDITURE)', n2(net.budgeted), n2(net.actual), '', '', '']);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 8 }, { wch: 34 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 40 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Budget');
  const safe = (budget.name || 'budget').replace(/[^\w\- ]+/g, '').trim().slice(0, 40) || 'budget';
  XLSX.writeFile(wb, `${safe}.xlsx`);
};
