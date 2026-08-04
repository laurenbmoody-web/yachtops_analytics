// Cargo Accounts — the month-end pack a vessel sends its management company.
//
// The office balances the owner's funds against the vessel's spending, so what
// they need is the closed reconciliation AND the lines under it: the summary
// proves the month, the lines let them post it. Pure and testable — the file that
// leaves the boat is the one thing nobody can correct after the fact.
//
// One CSV, because it gets opened in Excel. The summary sits at the top as
// key/value rows, a blank line, then the table. Humans read it top to bottom;
// anything importing it skips to the header row.

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const dmy = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');

// A cell can contain a comma, a quote, a newline — or a formula. Merchant names
// arrive from a bank feed and notes are typed by crew, so a description of
// "=HYPERLINK(...)" or "+2+3" would be EXECUTED when the office opens the file in
// Excel or Sheets. Prefixing with an apostrophe makes the cell literal text; the
// leading character stays visible in the value, which is the honest trade.
const RISKY_START = /^[=+\-@\t\r]/;
// A plain number is never a formula, and quoting one into text would break every
// sum in the office's spreadsheet — which is most of what they open it for.
const isPlainNumber = (v) => typeof v === 'number'
  || (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)));

export const csvCell = (value) => {
  if (value == null) return '';
  let s = String(value);
  if (!isPlainNumber(value) && RISKY_START.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
};

export const toCsvRow = (cells) => cells.map(csvCell).join(',');

// ── the summary: what was closed, and what it came to ────────────────────────
export const packSummary = ({
  account, monthLabel, reconciliation, figures, statement, outcome, closedByName,
} = {}) => {
  const st = statement || {};
  const rows = [
    ['Vessel account', account?.name || ''],
    ['Card', account?.card_last4 && account.card_last4 !== '0000' ? `••${account.card_last4}` : ''],
    ['Currency', account?.currency || ''],
    ['Period', monthLabel || ''],
    ['Status', reconciliation?.status === 'approved' ? 'Signed off' : 'Submitted for sign-off'],
    ['Closed on', dmy(reconciliation?.submitted_at)],
    ['Closed by', closedByName || ''],
    ['Signed off on', dmy(reconciliation?.approved_at)],
    [],
    ['Opening balance', round2(figures?.opening)],
    ['Money in', round2(figures?.moneyIn)],
    ['Money out', round2(Math.abs(figures?.moneyOut))],
    ['Closing balance', round2(figures?.closing)],
    [],
    ['Statement — total in', st.moneyIn === '' || st.moneyIn == null ? 'not stated' : round2(st.moneyIn)],
    ['Statement — total out', st.moneyOut === '' || st.moneyOut == null ? 'not stated' : round2(Math.abs(st.moneyOut))],
    ['Statement — closing balance', st.closing === '' || st.closing == null ? 'not stated' : round2(st.closing)],
  ];
  if (outcome) rows.push([], [outcome.label, round2(outcome.amount)]);
  return rows;
};

// ── the lines: everything the office needs to post them ──────────────────────
export const PACK_COLUMNS = [
  'Date spent', 'Date posted', 'Merchant', 'Description', 'Category code', 'Category',
  'Department', 'Who spent it', 'Who pays', 'Charter', 'Amount', 'Currency', 'VAT',
  'Receipt', 'Source', 'Posted late from',
];

export const packLines = (txns = [], ctx = {}) => {
  const {
    crewById = {}, hasReceipt = () => false, currency = '', naturalMonthOf = () => null,
    period = null, monthLabelOf = (m) => m,
  } = ctx;

  return txns
    .filter((t) => t && t.status !== 'void')
    .map((t) => {
      const natural = naturalMonthOf(t);
      // Only worth stating when the line is being reconciled somewhere other than
      // the month it was spent in — otherwise the office reads a column of noise.
      const late = period && natural && natural !== period ? monthLabelOf(natural) : '';
      return [
        dmy(t.txn_date),
        dmy(t.statement_date),
        t.description || '',
        t.note || '',
        t.category_code || '',
        t.category || '',
        t.department || '',
        crewById[t.crew_id]?.name || '',
        t.allocation === 'charter' ? 'Charter (APA)' : (t.allocation === 'owner' ? 'Owner' : ''),
        t.charter_ref || '',
        round2(t.amount),
        t.currency || currency,
        t.vat_amount == null || t.vat_amount === '' ? '' : round2(t.vat_amount),
        hasReceipt(t) ? 'Yes' : 'No',
        t.source || '',
        late,
      ];
    });
};

export const buildPackCsv = (opts = {}) => {
  const summary = packSummary(opts);
  const lines = packLines(opts.txns, opts);
  const out = [
    ...summary.map(toCsvRow),
    '',
    toCsvRow(PACK_COLUMNS),
    ...lines.map(toCsvRow),
  ];
  return out.join('\r\n');            // CRLF: Excel on Windows is the destination
};

// Named so a folder of them sorts by vessel then period, and so nobody has to
// open one to know what it is.
export const packFilename = (account, monthKey) => {
  const safe = String(account?.name || 'account').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${safe}-${monthKey || 'period'}-month-end.csv`;
};
