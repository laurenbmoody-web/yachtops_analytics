// Cargo Accounts — spreadsheet import tests. Run: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectColumns, parseSheetRows, matchToChart } from './budgetImport.js';

const chart = [
  { bucket: 'Fuel', code: 'FLE', category: 'Fuel & Lube Oil', kind: 'expense' },
  { bucket: 'Crew Cost', code: 'OCW', category: 'Officer & Crew Wages', kind: 'expense' },
  { bucket: 'Guest Costs', code: 'GFE', category: 'Guest Food Stock', kind: 'expense' },
  { bucket: 'Revenue', code: 'NCR', category: 'Net Charter Revenue', kind: 'revenue' },
];

test('detects header row and the description + amount columns by hint', () => {
  const aoa = [
    ['Yacht budget 2026', null],
    ['Account', 'Annual Budget'],
    ['Fuel & Lube Oil', 320000],
  ];
  const det = detectColumns(aoa);
  assert.equal(det.headerRow, 1);
  assert.equal(det.descCol, 0);
  assert.equal(det.amtCol, 1);
});

test('parses data rows and skips total roll-ups', () => {
  const aoa = [
    ['Description', 'Amount'],
    ['Fuel & Lube Oil', 320000],
    ['Officer & Crew Wages', '1,850,000'],
    ['Total', 2170000],
  ];
  const { rows } = parseSheetRows(aoa);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { name: 'Fuel & Lube Oil', amount: 320000 });
  assert.equal(rows[1].amount, 1850000);        // comma-formatted parsed
});

test('falls back to shape inference when there are no header hints', () => {
  const aoa = [
    ['Fuel & Lube Oil', 320000],
    ['Officer & Crew Wages', 1850000],
  ];
  const det = detectColumns(aoa);
  assert.equal(det.descCol, 0);
  assert.equal(det.amtCol, 1);
  assert.equal(det.headerRow, -1);
});

test('matches rows to chart lines by exact name and by code', () => {
  const rows = [
    { name: 'Fuel & Lube Oil', amount: 320000 },
    { name: 'OCW', amount: 1850000 },
  ];
  const { lines, matched, unmatched } = matchToChart(rows, chart);
  assert.equal(matched, 2);
  assert.equal(unmatched.length, 0);
  assert.equal(lines.find((l) => l.code === 'FLE').amount, 320000);
  assert.equal(lines.find((l) => l.code === 'OCW').amount, 1850000);
});

test('fuzzy-matches a loosely-worded description', () => {
  const { lines, matched } = matchToChart([{ name: 'Crew wages (officers)', amount: 900000 }], chart);
  assert.equal(matched, 1);
  assert.equal(lines.find((l) => l.code === 'OCW').amount, 900000);
});

test('sums multiple rows that map to the same line', () => {
  const { lines } = matchToChart([
    { name: 'Fuel & Lube Oil', amount: 100000 },
    { name: 'Fuel and lube', amount: 50000 },
  ], chart);
  assert.equal(lines.find((l) => l.code === 'FLE').amount, 150000);
});

test('unrecognised descriptions are returned as unmatched, not force-fitted', () => {
  const { matched, unmatched } = matchToChart([{ name: 'Helicopter charter', amount: 40000 }], chart);
  assert.equal(matched, 0);
  assert.equal(unmatched[0].name, 'Helicopter charter');
});

test('revenue rows are not matched onto expense lines', () => {
  const { lines, unmatched } = matchToChart([{ name: 'Net Charter Revenue', amount: 3000000 }], chart);
  assert.equal(lines.find((l) => l.code === 'NCR').amount, 0); // revenue not seeded
  assert.equal(unmatched.length, 1);
});
