import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STANDARD_CHART_OF_ACCOUNTS, STANDARD_BUCKET_ORDER,
} from '../pages/accounts/budgets/data/mybaChartOfAccounts.js';
import { missingTemplateLines, TOP_UP_SORT_BASE } from './chartTemplate.js';

// ── The template's own invariants ────────────────────────────────────────────

// The chart as it was first shipped, and as it sits in chart_of_accounts today.
// Every one of these lines is a line real money may already be filed against —
// ledger_transactions.category_code and budget_lines both point at them, and
// computeVsActual matches actuals to budget lines on the category TEXT. Renaming,
// re-bucketing or dropping one orphans that money, so this list is frozen: the
// template may only grow around it.
const SHIPPED = [
  ['Revenue', 'NCR', 'Net Charter Revenue'],
  ['Revenue', 'CRI', 'Charter Reimbursements'],
  ['Revenue', 'OIN', 'Other Income'],
  ['Crew Cost', 'OCW', 'Officer & Crew Wages'],
  ['Crew Cost', 'CCW', 'Casual Crew Wages'],
  ['Crew Cost', 'CTE', 'Crew Travelling'],
  ['Crew Cost', 'CFC', 'Crew Food & Consumables'],
  ['Crew Cost', 'CUF', 'Crew Uniforms'],
  ['Crew Cost', 'MCC', 'Miscellaneous Crew Cost'],
  ['Deck', 'DCN', 'Deck Consumables'],
  ['Deck', 'DSR', 'Deck Spares & Renewals'],
  ['Deck', 'DRM', 'Deck Repair & Maintenance'],
  ['Engineer', 'ECN', 'Engineer Consumables'],
  ['Engineer', 'ESR', 'Engineer Spares & Renewals'],
  ['Engineer', 'ERM', 'Engineer Repair & Maintenance'],
  ['Interior', 'ICN', 'Interior Consumables'],
  ['Interior', 'ISR', 'Interior Spares & Renewals'],
  ['Interior', 'IRM', 'Interior Repair & Maintenance'],
  ['Fuel', 'FLE', 'Fuel & Lube Oil'],
  ['Fuel', 'FLT', 'Tender Fuel'],
  ['Financial', 'MGE', 'Management Expenses'],
  ['Financial', 'PJT', 'Project Manager Fees'],
  ['Financial', 'INS', 'Insurance Premiums'],
  ['Financial', 'ADM', 'Administration'],
  ['Guest Costs', 'GFE', 'Guest Food Stock'],
  ['Guest Costs', 'GWS', 'Guest Wine Stock'],
  ['Guest Costs', 'GCT', 'Guest Travel / Car Hire'],
  ['Guest Costs', 'FLO', 'Guest Flowers'],
  ['Guest Costs', 'GME', 'Guest Miscellaneous'],
  ['Shipyard', 'SHY', 'Shipyard Annual Maintenance'],
  ['Shipyard', 'RFT', 'Refit (major shipyard / improvements)'],
  ['Shipyard', 'MCA', 'Marine Coastguard Agency'],
  ['General', 'LSF', 'Life Saving & Fire Fighting'],
  ['General', 'NAV', 'Navigation & Communication'],
  ['General', 'AUD', 'Audiovisual & Entertainment'],
  ['General', 'CAR', 'Transport'],
  ['General', 'HAR', 'Harbour Dues & Taxes'],
  ['General', 'SPW', 'Shore Power & Water'],
  ['General', 'COM', 'Communication Expenses'],
  ['General', 'CRT', 'Class & Certificates'],
  ['General', 'AGT', 'Agent Fees'],
  ['General', 'MSC', 'Miscellaneous Ship Cost'],
  ['General', 'CAP', 'Capital Purchases'],
  ['General', 'SET', 'Set Up Costs'],
  ['General', 'MKT', 'Marketing'],
  ['General', 'DOC', 'Dock Express'],
  ['General', 'FRG', 'Freight'],
  ['General', 'TAX', 'Charter VAT'],
];

test('no line that money may already be filed against has moved or been renamed', () => {
  const byCode = new Map(STANDARD_CHART_OF_ACCOUNTS.map((l) => [l.code, l]));
  SHIPPED.forEach(([bucket, code, category]) => {
    const line = byCode.get(code);
    assert.ok(line, `${code} has been removed from the chart`);
    assert.equal(line.bucket, bucket, `${code} changed bucket`);
    assert.equal(line.category, category, `${code} changed label`);
  });
});

test('the shipped lines still lead their bucket, in their original order', () => {
  // A topped-up chart appends new lines after the ones a vessel already has. If a
  // new line were slipped in ABOVE a shipped one here, a freshly seeded chart and a
  // topped-up chart would read in different orders for the same vessel.
  const shippedOrder = SHIPPED.map(([, code]) => code);
  const inTemplate = STANDARD_CHART_OF_ACCOUNTS
    .map((l) => l.code).filter((c) => shippedOrder.includes(c));
  assert.deepEqual(inTemplate, shippedOrder);

  const firstNewIn = new Map();
  STANDARD_CHART_OF_ACCOUNTS.forEach((l, i) => {
    if (shippedOrder.includes(l.code) || firstNewIn.has(l.bucket)) return;
    firstNewIn.set(l.bucket, i);
  });
  STANDARD_CHART_OF_ACCOUNTS.forEach((l, i) => {
    if (!shippedOrder.includes(l.code)) return;
    const firstNew = firstNewIn.get(l.bucket);
    assert.ok(firstNew === undefined || i < firstNew,
      `${l.code} sits below a new line in ${l.bucket}`);
  });
});

test('the chart actually got more extensive', () => {
  assert.ok(STANDARD_CHART_OF_ACCOUNTS.length > SHIPPED.length * 2,
    `only ${STANDARD_CHART_OF_ACCOUNTS.length} lines`);
});

test('every code is unique — the tenant chart has a unique index on it', () => {
  const seen = new Map();
  STANDARD_CHART_OF_ACCOUNTS.forEach((l) => {
    assert.ok(!seen.has(l.code), `${l.code} used twice: ${seen.get(l.code)} and ${l.category}`);
    seen.set(l.code, l.category);
  });
});

test('every code is three capital letters', () => {
  STANDARD_CHART_OF_ACCOUNTS.forEach((l) => {
    assert.match(l.code, /^[A-Z]{3}$/, `${l.category} has code ${l.code}`);
  });
});

test('every category label is unique across the whole chart, not just its bucket', () => {
  // computeVsActual matches actuals to budget lines by category label, and the first
  // line to claim a label owns its actual — a duplicate label would silently steal
  // another bucket's spend.
  const seen = new Map();
  STANDARD_CHART_OF_ACCOUNTS.forEach((l) => {
    const key = l.category.toLowerCase();
    assert.ok(!seen.has(key), `"${l.category}" appears in both ${seen.get(key)} and ${l.bucket}`);
    seen.set(key, l.bucket);
  });
});

test('only Revenue holds revenue lines, and it holds nothing else', () => {
  STANDARD_CHART_OF_ACCOUNTS.forEach((l) => {
    assert.equal(l.kind, l.bucket === 'Revenue' ? 'revenue' : 'expense', l.category);
  });
});

test('the bucket order names every bucket, and every bucket is in it', () => {
  const used = [...new Set(STANDARD_CHART_OF_ACCOUNTS.map((l) => l.bucket))];
  assert.deepEqual([...used].sort(), [...STANDARD_BUCKET_ORDER].sort());
  // …and the template itself is written in that order, so sort_order = array index
  // (applyStandardTemplate) puts the buckets on screen in the report's order.
  assert.deepEqual(used, STANDARD_BUCKET_ORDER);
});

test('a bucket is contiguous — its lines are not split by another bucket', () => {
  const seen = new Set();
  let prev = null;
  STANDARD_CHART_OF_ACCOUNTS.forEach((l) => {
    if (l.bucket !== prev) {
      assert.ok(!seen.has(l.bucket), `${l.bucket} is interrupted then resumed`);
      seen.add(l.bucket); prev = l.bucket;
    }
  });
});

// ── Topping up a chart that was seeded before the additions existed ──────────

test('a vessel on the old chart is offered exactly what it is missing', () => {
  const old = SHIPPED.map(([bucket, code, category]) => ({ bucket, code, category, kind: 'expense' }));
  const missing = missingTemplateLines(old);

  assert.equal(missing.length, STANDARD_CHART_OF_ACCOUNTS.length - SHIPPED.length);
  const codes = missing.map((l) => l.code);
  assert.ok(!codes.some((c) => SHIPPED.some(([, s]) => s === c)), 'would re-insert a line it has');
  assert.ok(codes.includes('EGE') && codes.includes('CBC'), 'missed the new lines');
});

test('topping up twice adds nothing the second time', () => {
  const old = SHIPPED.map(([bucket, code, category]) => ({ bucket, code, category }));
  const after = [...old, ...missingTemplateLines(old)];
  assert.deepEqual(missingTemplateLines(after), []);
});

test('a vessel that kept the code but renamed the line is not given it twice', () => {
  const mine = [{ bucket: 'Fuel', code: 'FLE', category: 'Diesel & Oils' }];
  assert.ok(!missingTemplateLines(mine).some((l) => l.code === 'FLE'));
});

test('a vessel that kept the label but dropped the code is not given it twice', () => {
  // Would otherwise violate uq_chart_of_accounts_line (tenant, bucket, lower(category)).
  const mine = [{ bucket: 'Fuel', code: null, category: 'fuel & lube oil' }];
  assert.ok(!missingTemplateLines(mine).some((l) => l.category === 'Fuel & Lube Oil'));
});

test('a line the vessel switched off is not quietly reinstated', () => {
  // The caller reads with includeInactive; a deactivated row still holds both keys.
  const mine = [{ bucket: 'Guest Costs', code: 'FLO', category: 'Guest Flowers', is_active: false }];
  assert.ok(!missingTemplateLines(mine).some((l) => l.code === 'FLO'));
});

test('a vessel with no chart at all is offered the whole template', () => {
  assert.equal(missingTemplateLines([]).length, STANDARD_CHART_OF_ACCOUNTS.length);
  assert.equal(missingTemplateLines(null).length, STANDARD_CHART_OF_ACCOUNTS.length);
});

test('added lines sort after whatever the vessel already had', () => {
  const added = missingTemplateLines([{ bucket: 'Fuel', code: 'FLE', category: 'Fuel & Lube Oil' }]);
  added.forEach((l) => assert.ok(l.sort_order >= TOP_UP_SORT_BASE, l.code));
  // …and among themselves, in template order.
  const orders = added.map((l) => l.sort_order);
  assert.deepEqual(orders, [...orders].sort((a, b) => a - b));
});

test('added lines carry a kind the column will accept', () => {
  missingTemplateLines([]).forEach((l) => {
    assert.ok(l.kind === 'revenue' || l.kind === 'expense', `${l.code}: ${l.kind}`);
  });
});

test('the vessel’s own lines are left alone', () => {
  const mine = [{ bucket: 'Owner', code: 'ZZZ', category: 'Owner Personal' }];
  const missing = missingTemplateLines(mine);
  assert.ok(!missing.some((l) => l.bucket === 'Owner'));
  assert.equal(missing.length, STANDARD_CHART_OF_ACCOUNTS.length);
});
