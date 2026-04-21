// Shared builder + appender for guests.history_log entries.
// Keep the jsonb shape aligned with guestStorage.js: camelCase inside the blob,
// even though the column name is snake_case. Downstream readers (guest detail
// panel, pantry history page) all consume `actorUserId`.

export function buildHistoryEntry(action, actorUserId, changes) {
  return {
    id: `history-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    at: new Date().toISOString(),
    action,
    actorUserId,
    changes,
  };
}

export function appendToLog(existing, entry) {
  const log = Array.isArray(existing) ? existing : [];
  return [...log, entry];
}

// Read current row, append entry, write back. Caller supplies columnUpdates
// so the history_log + the target columns land in a single update.
export async function appendGuestHistory(supabase, { guestId, action, actorUserId, changes, columnUpdates = {} }) {
  const { data: currentRow, error: readErr } = await supabase
    .from('guests')
    .select('history_log')
    .eq('id', guestId)
    .single();
  if (readErr) throw readErr;

  const entry = buildHistoryEntry(action, actorUserId, changes);
  const history_log = appendToLog(currentRow?.history_log, entry);

  const { error: writeErr } = await supabase
    .from('guests')
    .update({ ...columnUpdates, history_log })
    .eq('id', guestId);
  if (writeErr) throw writeErr;
}
