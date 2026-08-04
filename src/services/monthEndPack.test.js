import test from 'node:test';
import assert from 'node:assert/strict';
import {
  csvCell, toCsvRow, packSummary, packLines, buildPackCsv, packFilename, PACK_COLUMNS,
} from './monthEndPack.js';

// ── escaping ────────────────────────────────────────────────────────────────
test('commas, quotes and newlines survive the trip', () => {
  assert.equal(csvCell('Alfies, Fish & Chips'), '"Alfies, Fish & Chips"');
  assert.equal(csvCell('He said "hi"'), '"He said ""hi"""');
  assert.equal(csvCell('two\nlines'), '"two\nlines"');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(0), '0');
});

test('a merchant name that looks like a formula is made literal', () => {
  // Descriptions come off a bank feed and notes are typed by crew. Excel and
  // Sheets EXECUTE a cell starting = + - or @, so this is the difference between
  // a spreadsheet and a payload.
  assert.equal(csvCell('=1+1'), "'=1+1");
  assert.equal(csvCell('+44 supplier'), "'+44 supplier");
  assert.equal(csvCell('-500 refund'), "'-500 refund");
  assert.equal(csvCell('@merchant'), "'@merchant");
  assert.equal(csvCell('=HYPERLINK("http://x","click")'), '"\'=HYPERLINK(""http://x"",""click"")"');
});

test('an ordinary negative number is still a number', () => {
  // A real amount must not be quoted into text, or the office can't sum a column.
  assert.equal(csvCell(-500), '-500');
});

// ── the summary ─────────────────────────────────────────────────────────────
const ACCOUNT = { name: 'Plaid Current Account', card_last4: '3333', currency: 'GBP' };
const RECON = { status: 'submitted', submitted_at: '2026-07-28T10:00:00Z' };
const FIGURES = { opening: 22090.90, moneyIn: 0, moneyOut: -12923.90, closing: 9167 };

test('the summary carries what was closed and when', () => {
  const rows = packSummary({
    account: ACCOUNT, monthLabel: 'July 2026', reconciliation: RECON, figures: FIGURES,
    statement: { moneyOut: 12923.90, moneyIn: '', closing: 9167 },
    closedByName: 'Lauren Moody',
  });
  const find = (k) => rows.find((r) => r[0] === k)?.[1];
  assert.equal(find('Period'), 'July 2026');
  assert.equal(find('Closed on'), '28/07/2026');
  assert.equal(find('Closed by'), 'Lauren Moody');
  assert.equal(find('Money out'), 12923.90);        // stated positive, as a statement reads
  assert.equal(find('Closing balance'), 9167);
  assert.equal(find('Statement — total in'), 'not stated');
  assert.equal(find('Card'), '••3333');
});

test('a placeholder last 4 is not printed as a card number', () => {
  const rows = packSummary({ account: { name: 'x', card_last4: '0000' }, figures: FIGURES });
  assert.equal(rows.find((r) => r[0] === 'Card')[1], '');
});

// ── the lines ───────────────────────────────────────────────────────────────
const TXNS = [
  {
    id: 'a', status: 'posted', txn_date: '2026-07-10', statement_date: '2026-07-11',
    description: 'Ryanair', note: 'crew flights', category_code: 'CTE', category: 'Crew Travelling',
    department: 'Bridge', crew_id: 'c1', allocation: 'owner', amount: -500, currency: 'GBP',
    vat_amount: 0, source: 'bank_feed',
  },
  { id: 'v', status: 'void', amount: -999, description: 'cancelled' },
];

test('void lines never reach the office', () => {
  const rows = packLines(TXNS, {});
  assert.equal(rows.length, 1);
});

test('a line carries everything needed to post it', () => {
  const [row] = packLines(TXNS, {
    crewById: { c1: { name: 'Anders Lindqvist' } },
    hasReceipt: () => true,
  });
  const cell = (name) => row[PACK_COLUMNS.indexOf(name)];
  assert.equal(cell('Date spent'), '10/07/2026');
  assert.equal(cell('Date posted'), '11/07/2026');
  assert.equal(cell('Merchant'), 'Ryanair');
  assert.equal(cell('Description'), 'crew flights');
  assert.equal(cell('Category code'), 'CTE');
  assert.equal(cell('Who spent it'), 'Anders Lindqvist');
  assert.equal(cell('Who pays'), 'Owner');
  assert.equal(cell('Amount'), -500);
  assert.equal(cell('Receipt'), 'Yes');
});

test('a line posted late names the month it was spent in', () => {
  // July's pack closed; this one is being reconciled in August, and the office
  // needs to know why an August pack holds July spending.
  const [row] = packLines(TXNS, {
    period: '2026-08',
    naturalMonthOf: () => '2026-07',
    monthLabelOf: () => 'July 2026',
  });
  assert.equal(row[PACK_COLUMNS.indexOf('Posted late from')], 'July 2026');
});

test('a line in its own period says nothing in that column', () => {
  const [row] = packLines(TXNS, {
    period: '2026-07', naturalMonthOf: () => '2026-07', monthLabelOf: (m) => m,
  });
  assert.equal(row[PACK_COLUMNS.indexOf('Posted late from')], '');
});

// ── the file ────────────────────────────────────────────────────────────────
test('the file is summary, a blank line, then the table', () => {
  const csv = buildPackCsv({
    account: ACCOUNT, monthLabel: 'July 2026', reconciliation: RECON,
    figures: FIGURES, statement: {}, txns: TXNS,
  });
  const lines = csv.split('\r\n');
  assert.match(lines[0], /^Vessel account,Plaid Current Account$/);
  const headerAt = lines.indexOf(PACK_COLUMNS.join(','));
  assert.ok(headerAt > 0, 'the column header is in there');
  assert.equal(lines[headerAt - 1], '', 'a blank line separates summary from table');
  assert.equal(lines.length, headerAt + 2, 'one live line follows it');
});

test('the filename says which vessel account and which period', () => {
  assert.equal(packFilename(ACCOUNT, '2026-07'), 'Plaid-Current-Account-2026-07-month-end.csv');
  assert.equal(packFilename(null, null), 'account-period-month-end.csv');
});
