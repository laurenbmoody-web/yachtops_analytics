// Cargo Accounts — statement parser tests. Run: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDate, detectStatementColumns, parseStatementRows } from './statementParse.js';

test('parseDate handles EU, ISO and dd-Mon-yyyy', () => {
  assert.equal(parseDate('11/06/2026'), '2026-06-11');   // dd/mm/yyyy
  assert.equal(parseDate('2026-06-11'), '2026-06-11');
  assert.equal(parseDate('11 Jun 2026'), '2026-06-11');
  assert.equal(parseDate('11-06-26'), '2026-06-11');
  assert.equal(parseDate('not a date'), null);
});

test('detects a single signed-amount statement', () => {
  const aoa = [
    ['Date', 'Description', 'Amount'],
    ['11/06/2026', 'Fuel dock', '-320.00'],
  ];
  const det = detectStatementColumns(aoa);
  assert.equal(det.dateCol, 0); assert.equal(det.descCol, 1); assert.equal(det.amountCol, 2);
});

test('parses signed amounts and skips balance rows', () => {
  const aoa = [
    ['Date', 'Details', 'Amount'],
    ['11/06/2026', 'Fuel dock Palma', '-320.00'],
    ['12/06/2026', 'Opening balance', '5000.00'],
    ['12/06/2026', 'Owner transfer', '1,000.00'],
  ];
  const { rows } = parseStatementRows(aoa);
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0].line_date, rows[0].amount], ['2026-06-11', -320]);
  assert.equal(rows[1].amount, 1000);
});

test('combines separate debit/credit columns into a signed amount', () => {
  const aoa = [
    ['Date', 'Narrative', 'Paid out', 'Paid in'],
    ['11/06/2026', 'Chandlery', '75.00', ''],
    ['13/06/2026', 'Charter deposit', '', '2000.00'],
  ];
  const { rows } = parseStatementRows(aoa);
  assert.equal(rows[0].amount, -75);   // debit → negative
  assert.equal(rows[1].amount, 2000);  // credit → positive
});

test('parenthesised amount reads as negative', () => {
  const aoa = [['Date', 'Description', 'Amount'], ['11/06/2026', 'Refund fee', '(12.50)']];
  const { rows } = parseStatementRows(aoa);
  assert.equal(rows[0].amount, -12.5);
});

test('a sheet with no recognisable columns returns nothing to map manually', () => {
  const aoa = [['foo', 'bar'], ['1', '2']];
  assert.equal(detectStatementColumns(aoa), null);
  assert.deepEqual(parseStatementRows(aoa).rows, []);
});
