// Cargo Accounts — statement parsing (pure, no imports; caller turns the file into
// an array-of-arrays with SheetJS/papaparse first). Mirrors budgetImport's heuristic
// column detection but for a statement's shape: a date, a description, and either one
// signed amount column or separate debit/credit columns. Messy files that don't detect
// fall through to a manual column-map step in the UI (same UX as the budget upload).

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const numOf = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let c = String(v ?? '').replace(/[^0-9.,()-]/g, '');
  if (!c) return null;
  const neg = /^\(.*\)$/.test(c);                 // (123.45) = negative
  c = c.replace(/[()]/g, '');
  // If both separators present, the last one is the decimal point.
  if (c.includes(',') && c.includes('.')) c = c.lastIndexOf(',') > c.lastIndexOf('.') ? c.replace(/\./g, '').replace(',', '.') : c.replace(/,/g, '');
  else if (c.includes(',')) c = c.replace(',', '.');
  const n = Number(c);
  if (!Number.isFinite(n)) return null;
  return neg ? -Math.abs(n) : n;
};

const DATE_HINTS = ['date', 'posted', 'value date', 'transaction date', 'txn date', 'booking date'];
const DESC_HINTS = ['description', 'details', 'narrative', 'payee', 'reference', 'merchant', 'memo', 'particulars', 'transaction', 'name'];
const AMT_HINTS = ['amount', 'value', 'transaction amount'];
const DEBIT_HINTS = ['debit', 'paid out', 'money out', 'withdrawal', 'out', 'dr'];
const CREDIT_HINTS = ['credit', 'paid in', 'money in', 'deposit', 'cr'];
const hit = (h, hints) => hints.some((x) => h === x || h.includes(x));

// dd/mm/yyyy (EU default), yyyy-mm-dd, dd-mmm-yyyy → ISO. null if unparseable.
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
export const parseDate = (v) => {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);                       // ISO
  if (m) return `${m[1]}-${String(+m[2]).padStart(2, '0')}-${String(+m[3]).padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[\/.\- ](\d{1,2})[\/.\- ](\d{2,4})/);           // dd/mm/yyyy (EU)
  if (m) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return `${y}-${String(+m[2]).padStart(2, '0')}-${String(+m[1]).padStart(2, '0')}`; }
  m = s.match(/^(\d{1,2})[\/.\- ]([A-Za-z]{3})[A-Za-z]*[\/.\- ](\d{2,4})/); // dd Mon yyyy
  if (m) { const mo = MON[m[2].toLowerCase()]; if (mo) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return `${y}-${String(mo).padStart(2, '0')}-${String(+m[1]).padStart(2, '0')}`; } }
  return null;
};

export const detectStatementColumns = (aoa) => {
  const scan = Math.min((aoa || []).length, 12);
  for (let r = 0; r < scan; r += 1) {
    const row = aoa[r] || [];
    let dateCol = -1; let descCol = -1; let amountCol = -1; let debitCol = -1; let creditCol = -1;
    row.forEach((cell, i) => {
      const h = norm(cell);
      if (!h) return;
      if (dateCol < 0 && hit(h, DATE_HINTS)) dateCol = i;
      if (debitCol < 0 && hit(h, DEBIT_HINTS)) debitCol = i;
      if (creditCol < 0 && hit(h, CREDIT_HINTS)) creditCol = i;
      if (hit(h, AMT_HINTS)) amountCol = i;
      if (descCol < 0 && hit(h, DESC_HINTS)) descCol = i;
    });
    if (dateCol >= 0 && descCol >= 0 && (amountCol >= 0 || debitCol >= 0 || creditCol >= 0)) {
      return { headerRow: r, dateCol, descCol, amountCol, debitCol, creditCol };
    }
  }
  return null;
};

// aoa → { rows: [{ line_date, description, amount, raw }], detected }.
// amount is SIGNED (money out negative), matching the ledger convention.
export const parseStatementRows = (aoa) => {
  const det = detectStatementColumns(aoa);
  if (!det) return { rows: [], detected: null };
  const rows = [];
  for (let r = det.headerRow + 1; r < (aoa || []).length; r += 1) {
    const row = aoa[r] || [];
    const line_date = parseDate(row[det.dateCol]);
    const description = String(row[det.descCol] ?? '').trim() || null;
    let amount = null;
    if (det.amountCol >= 0) {
      amount = numOf(row[det.amountCol]);
    } else {
      const debit = det.debitCol >= 0 ? numOf(row[det.debitCol]) : null;
      const credit = det.creditCol >= 0 ? numOf(row[det.creditCol]) : null;
      if (debit != null && debit !== 0) amount = -Math.abs(debit);
      else if (credit != null && credit !== 0) amount = Math.abs(credit);
    }
    if (amount == null || amount === 0) continue;
    if (!line_date && !description) continue;
    if (/^(opening|closing)\s+balance/i.test(description || '')) continue;
    rows.push({ line_date, description, amount: Math.round(amount * 100) / 100, raw: row });
  }
  return { rows, detected: det };
};
