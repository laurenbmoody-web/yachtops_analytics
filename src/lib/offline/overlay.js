// Pending offline writes, laid over reads. When a table has edits waiting in
// the outbox, every read of that table — from the network or from the saved
// copy — shows them, so a change made at sea doesn't vanish on the next screen
// load or get "reverted" by an older saved copy.
//
// Matching uses the query's PostgREST filters (eq / neq / in / gt / gte / lt /
// lte / is). Filters it can't read (or=, not., nested) are treated as passing:
// showing an edit in one list too many beats hiding it.
//
// Pure — unit-tested in overlay.test.mjs.

const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);

function parseFilters(url) {
  const u = new URL(url);
  const filters = [];
  u.searchParams.forEach((value, key) => {
    if (RESERVED.has(key) || key === 'or' || key === 'and') return;
    const m = value.match(/^(eq|neq|gt|gte|lt|lte|in|is)\.(.*)$/s);
    if (!m) return;
    let arg = m[2];
    if (m[1] === 'in') arg = arg.replace(/^\(|\)$/g, '').split(',').map((v) => v.replace(/^"|"$/g, ''));
    filters.push({ col: key, op: m[1], arg });
  });
  return filters;
}

const cmp = (a, b) => {
  const na = Number(a); const nb = Number(b);
  if (a !== '' && b !== '' && !Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
};

function passes(row, filters) {
  return filters.every(({ col, op, arg }) => {
    if (!(col in row)) return true; // can't judge → don't exclude
    const v = row[col];
    switch (op) {
      case 'eq': return String(v) === arg;
      case 'neq': return String(v) !== arg;
      case 'in': return arg.includes(String(v));
      case 'gt': return cmp(v, arg) > 0;
      case 'gte': return cmp(v, arg) >= 0;
      case 'lt': return cmp(v, arg) < 0;
      case 'lte': return cmp(v, arg) <= 0;
      case 'is': return arg === 'null' ? v == null : String(v) === arg;
      default: return true;
    }
  });
}

// Is this result row the record the op targets? Key columns the query didn't
// select are vouched for by the query's own filter on them (a list fetched
// with tenant_id=eq.X only holds tenant X's rows).
function sameKey(row, match, filters) {
  return Object.keys(match).every((k) => {
    if (row && k in row) return String(row[k]) === String(match[k]);
    const f = filters.find((x) => x.col === k);
    if (!f) return true;
    if (f.op === 'eq') return f.arg === String(match[k]);
    if (f.op === 'in') return f.arg.includes(String(match[k]));
    return true;
  });
}

// Keep only the selected columns when the select list is a plain one.
function projector(url) {
  const sel = new URL(url).searchParams.get('select');
  if (!sel || sel === '*' || /[():!]/.test(sel)) return (row) => row;
  const cols = sel.split(',').map((c) => c.trim()).filter(Boolean);
  return (row) => Object.fromEntries(cols.filter((c) => c in row).map((c) => [c, row[c]]));
}

function sorter(url) {
  const order = new URL(url).searchParams.get('order');
  if (!order || order.includes(',')) return null;
  const [col, dir] = order.split('.');
  return (a, b) => (dir === 'desc' ? -1 : 1) * cmp(a?.[col], b?.[col]);
}

// ops (oldest first):
//   { type: 'insert' | 'upsert', row, match }  → replace / add the row
//   { type: 'update', patch, match }            → patch matching rows (a patch
//                                                 can move a row out of the list)
//   { type: 'delete', match }                   → remove it
export function applyOverlay(url, rows, ops) {
  if (!Array.isArray(rows) || !ops?.length) return rows;
  const filters = parseFilters(url);
  const project = projector(url);
  let out = rows.slice();
  for (const op of ops) {
    if (op.type === 'update') {
      out = out.flatMap((r) => {
        if (!sameKey(r, op.match, filters)) return [r];
        const next = { ...r };
        Object.keys(op.patch || {}).forEach((k) => { if (k in r || k in (op.match || {})) next[k] = op.patch[k]; });
        return passes({ ...r, ...op.patch }, filters) ? [next] : [];
      });
      continue;
    }
    out = out.filter((r) => !sameKey(r, op.match, filters));
    if ((op.type === 'upsert' || op.type === 'insert') && passes(op.row, filters)) out.push(project(op.row));
  }
  const sort = sorter(url);
  return sort ? out.sort(sort) : out;
}
