// Small offline-capable row helpers on top of the outbox, for modules that
// used the supabase insert/update(...).select().single() → { data, error }
// shape. Online they behave as before; offline `data` is the local row (or
// the saved row with the edit applied) and the write syncs later.

import { supabase } from '../supabaseClient';
import { outbox } from './queue';
import { newId } from './ids';

const key = (table, id) => `${table}|${id}`;

/** insert(row) — row gets a device id + timestamps if it lacks them.
 *  opts.timestamps: false for tables without created_at / updated_at columns
 *  (the database default then stamps it on sync). */
export async function insertRow(table, row, label, { timestamps = true } = {}) {
  const nowIso = new Date().toISOString();
  const full = { id: newId(), ...(timestamps ? { created_at: nowIso, updated_at: nowIso } : {}), ...row };
  try {
    const res = await outbox.submit({ key: key(table, full.id), table, type: 'insert', row: full, match: { id: full.id }, returning: true, label });
    return { data: res.data || full, error: null };
  } catch (error) {
    return { data: null, error };
  }
}

/** update(patch).eq('id', id) → { data: the row, error }. */
export async function updateRow(table, id, patch, label) {
  try {
    const res = await outbox.submit({ key: key(table, id), table, type: 'update', patch, match: { id }, returning: true, label });
    if (!res.queued) return res.data ? { data: res.data, error: null } : { data: null, error: { message: 'Not found' } };
    const { data } = await supabase.from(table).select('*').eq('id', id).maybeSingle();
    return { data: data || { id, ...patch }, error: null };
  } catch (error) {
    return { data: null, error };
  }
}

/** update(patch) on every row matching `match` (e.g. { case_id }) → { error }. */
export async function updateWhere(table, match, patch, label) {
  const k = `${table}|where:${Object.entries(match).map(([c, v]) => `${c}=${v}`).join('&')}`;
  try {
    await outbox.submit({ key: k, table, type: 'update', patch, match, label });
    return { error: null };
  } catch (error) {
    return { error };
  }
}
