// useStewNotes — read + CRUD for stew_notes.
//
// Primary authoring surface is now the standby StewNotesWidget, so the
// hook supports inline complete / uncomplete / edit alongside the older
// add / convert / delete methods. Two filter shortcuts are exported as
// thin wrappers:
//
//   useStewNotesActive() — completed_at IS NULL              (widget)
//   useStewNotesToday()  — active OR completed today (vessel-local 6am→)
//
// The base useStewNotes accepts { filter, limit, from, to, guestId } so
// a useStewNotesHistory({ from, to, guest_id }) wrapper can be added
// later without restructuring the hook body.
//
// Optimistic state is applied for fast in-widget actions (complete,
// uncomplete, edit) — the UI flips on tap and rolls back on the rare
// error path. addNote stays non-optimistic; the row only appears once
// it's persisted, so we don't need to invent a temp id.

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { useAuth } from '../../../contexts/AuthContext';
import { appendGuestHistory } from '../../../utils/guestHistoryLog';
import { vesselLocalDate } from '../../../utils/vesselLocalTime';

// ISO instant for today's 06:00 in vessel-local time. The browser TZ is
// the vessel-TZ proxy on Cargo (per vesselLocalTime.js), so a Date built
// from the local date string + local 6am-naive resolves to the right
// instant for the .gte filter.
//
// Exported so the /pantry/notes page can split a single notes fetch into
// today / previous client-side using the same threshold the modal hook
// uses for its server-side .gte filter.
export function vesselToday6amISO() {
  const ymd = vesselLocalDate();              // "2026-04-26"
  const d   = new Date(`${ymd}T06:00:00`);    // interpreted in browser TZ
  return d.toISOString();
}

export function useStewNotes(opts = {}) {
  const {
    limit  = null,
    filter = 'all',     // 'all' | 'active' | 'today'
    guestId,            // string | null  — restricts to one guest's notes
    from,               // ISO — created_at >= from
    to,                 // ISO — created_at < to
  } = opts;

  const { user } = useAuth();
  const [notes, setNotes]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [tenantId, setTenantId]   = useState(null);

  const fetchNotes = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const { data: member } = await supabase
        .from('tenant_members')
        .select('tenant_id')
        .eq('user_id', user.id)
        .eq('active', true)
        .single();
      if (!member) throw new Error('No active tenant membership');
      setTenantId(member.tenant_id);

      let query = supabase
        .from('stew_notes')
        .select('*')
        .eq('tenant_id', member.tenant_id)
        .eq('is_deleted', false)
        .order('created_at', { ascending: false });

      if (filter === 'active') {
        query = query.is('completed_at', null);
      } else if (filter === 'today') {
        const since = vesselToday6amISO();
        query = query.or(`completed_at.is.null,completed_at.gte.${since}`);
      }
      if (guestId) query = query.eq('related_guest_id', guestId);
      if (from)    query = query.gte('created_at', from);
      if (to)      query = query.lt('created_at', to);
      if (limit != null) query = query.limit(limit);

      const { data, error: err } = await query;
      if (err) throw err;
      setNotes(data ?? []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [user, limit, filter, guestId, from, to]);

  useEffect(() => { fetchNotes(); }, [fetchNotes]);

  // ── Mutations ──────────────────────────────────────────────────────

  // Three signatures — object form for new widget callers, two-arg form
  // kept so NotesHistoryPage and DictateBar don't need updating.
  //   addNote({ body, guest_ids?, source?, status? })   ← new (forward-compat)
  //   addNote({ body, guest_id?,  source?, status? })   ← Phase 2 widget
  //   addNote(content, { relatedGuestId?, source?, status? })  ← legacy
  //
  // guest_ids is the v2 surface; Phase D adds related_guest_ids UUID[] to
  // the table. Until then we collapse to related_guest_id = guest_ids[0]
  // so single-select keeps working and the wire format is forward-stable
  // — Phase D becomes a writer change with zero caller churn.
  const addNote = useCallback(async (input, opts2 = {}) => {
    const isObject = typeof input === 'object' && input !== null && !Array.isArray(input);
    const content  = isObject ? (input.body ?? input.content ?? '') : input;
    const source   = isObject ? (input.source ?? 'typed')           : (opts2.source ?? 'typed');
    const status   = isObject ? (input.status ?? 'pending')         : (opts2.status ?? 'pending');

    let guestIds = [];
    if (isObject) {
      if (Array.isArray(input.guest_ids)) guestIds = input.guest_ids.filter(Boolean);
      else if (input.guest_id)             guestIds = [input.guest_id];
    } else if (Array.isArray(opts2.relatedGuestIds)) {
      guestIds = opts2.relatedGuestIds.filter(Boolean);
    } else if (opts2.relatedGuestId) {
      guestIds = [opts2.relatedGuestId];
    }
    const relatedGuestId = guestIds[0] ?? null;

    if (!content || !content.trim()) return null;

    const { data: member } = await supabase
      .from('tenant_members')
      .select('tenant_id')
      .eq('user_id', user.id)
      .eq('active', true)
      .single();

    const { data, error: err } = await supabase
      .from('stew_notes')
      .insert({
        tenant_id:        member.tenant_id,
        content:          content.trim(),
        author_id:        user.id,
        source,
        status,
        related_guest_id: relatedGuestId,
      })
      .select('*')
      .single();

    if (err) throw err;
    fetchNotes();
    return data;
  }, [user, fetchNotes]);

  // Mark complete. Optimistic — flip the row instantly, roll back on error.
  // The widget filters on completed_at IS NULL, so the row vanishes from
  // its list as soon as state updates.
  const completeNote = useCallback(async (id) => {
    if (!user) return;
    const nowIso = new Date().toISOString();
    const prev = notes;
    setNotes(curr => curr.map(n => n.id === id
      ? { ...n, completed_at: nowIso, completed_by: user.id }
      : n));
    const { error: err } = await supabase
      .from('stew_notes')
      .update({ completed_at: nowIso, completed_by: user.id })
      .eq('id', id);
    if (err) {
      setNotes(prev);
      setError(err.message);
    }
  }, [notes, user]);

  // Mistake-fix path. Clears completion, reappears in active.
  const uncompleteNote = useCallback(async (id) => {
    const prev = notes;
    setNotes(curr => curr.map(n => n.id === id
      ? { ...n, completed_at: null, completed_by: null }
      : n));
    const { error: err } = await supabase
      .from('stew_notes')
      .update({ completed_at: null, completed_by: null })
      .eq('id', id);
    if (err) {
      setNotes(prev);
      setError(err.message);
    }
  }, [notes]);

  // Inline body edit — same shape as the existing updateContent (kept for
  // back-compat with NotesHistoryPage), but exposed under the new name
  // the widget spec uses.
  const editNote = useCallback(async (id, body) => {
    const trimmed = (body ?? '').trim();
    if (!trimmed) return;
    const prev = notes;
    setNotes(curr => curr.map(n => n.id === id ? { ...n, content: trimmed } : n));
    const { error: err } = await supabase
      .from('stew_notes')
      .update({ content: trimmed })
      .eq('id', id);
    if (err) {
      setNotes(prev);
      setError(err.message);
    }
  }, [notes]);

  // ── Legacy shims kept for NotesHistoryPage / DictateBar ────────────

  const updateContent = useCallback(async (id, content) => {
    return editNote(id, content);
  }, [editNote]);

  const updateStatus = useCallback(async (id, status) => {
    setNotes(curr => curr.map(n => n.id === id ? { ...n, status } : n));
    const { error: err } = await supabase
      .from('stew_notes')
      .update({ status })
      .eq('id', id);
    if (err) { setError(err.message); fetchNotes(); }
  }, [fetchNotes]);

  const deleteNote = useCallback(async (id) => {
    setNotes(curr => curr.filter(n => n.id !== id));
    const { error: err } = await supabase
      .from('stew_notes')
      .update({ is_deleted: true, deleted_at: new Date().toISOString(), deleted_by_user_id: user?.id ?? null })
      .eq('id', id);
    if (err) { setError(err.message); fetchNotes(); }
  }, [user, fetchNotes]);

  const convertToPreference = useCallback(async (id, guestIdArg) => {
    const note = notes.find(n => n.id === id);
    if (!note || !guestIdArg) return;

    const { data: guest, error: guestErr } = await supabase
      .from('guests')
      .select('preferences_summary')
      .eq('id', guestIdArg)
      .single();
    if (guestErr) { setError(guestErr.message); return; }

    const existing = (guest?.preferences_summary ?? '').trim();
    const separator = existing.length > 0 ? (existing.endsWith('.') ? ' ' : '. ') : '';
    const nextSummary = `${existing}${separator}${note.content}`.trim();

    try {
      await appendGuestHistory(supabase, {
        guestId: guestIdArg,
        action: 'preferences_changed',
        actorUserId: user?.id ?? null,
        changes: {
          preferences_summary: { from: guest?.preferences_summary ?? null, to: nextSummary },
          preferences: { from: null, to: { source: 'stew_note_conversion', note_id: id } },
        },
        columnUpdates: { preferences_summary: nextSummary },
      });
    } catch (e) { setError(e.message); return; }

    const { error: updNoteErr } = await supabase
      .from('stew_notes')
      .update({ saved_to_preferences: true, related_guest_id: guestIdArg })
      .eq('id', id);
    if (updNoteErr) { setError(updNoteErr.message); return; }

    fetchNotes();
  }, [notes, user, fetchNotes]);

  const convertToDayNote = useCallback(async (id, guestIdArg) => {
    const note = notes.find(n => n.id === id);
    if (!note || !guestIdArg || !user) return;

    const { data: member } = await supabase
      .from('tenant_members')
      .select('tenant_id')
      .eq('user_id', user.id)
      .eq('active', true)
      .single();
    if (!member) { setError('No active tenant membership'); return; }

    const today = vesselLocalDate();

    const { error: insertErr } = await supabase
      .from('guest_day_notes')
      .insert({
        tenant_id: member.tenant_id,
        guest_id:  guestIdArg,
        content:   note.content,
        author_id: user.id,
        note_date: today,
      });
    if (insertErr) { setError(insertErr.message); return; }

    const { error: updNoteErr } = await supabase
      .from('stew_notes')
      .update({ status: 'done', related_guest_id: guestIdArg })
      .eq('id', id);
    if (updNoteErr) { setError(updNoteErr.message); return; }

    fetchNotes();
  }, [notes, user, fetchNotes]);

  return {
    notes,
    loading,
    error,
    tenantId,
    refetch: fetchNotes,
    addNote,
    completeNote,
    uncompleteNote,
    editNote,
    // Legacy / extended shims:
    updateContent,
    updateStatus,
    deleteNote,
    convertToPreference,
    convertToDayNote,
  };
}

// Active-only — completed_at IS NULL. Widget consumes this.
export function useStewNotesActive(opts = {}) {
  return useStewNotes({ ...opts, filter: 'active' });
}

// Active + still-completed-today — modal consumes this. Vessel-local 6am
// is the rollover; a note completed at 23:55 yesterday won't appear.
export function useStewNotesToday(opts = {}) {
  return useStewNotes({ ...opts, filter: 'today' });
}
