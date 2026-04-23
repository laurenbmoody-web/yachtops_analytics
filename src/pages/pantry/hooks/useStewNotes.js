import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { useAuth } from '../../../contexts/AuthContext';
import { appendGuestHistory } from '../../../utils/guestHistoryLog';
import { vesselLocalDate } from '../../../utils/vesselLocalTime';

export function useStewNotes({ limit = 3 } = {}) {
  const { user } = useAuth();
  const [notes, setNotes]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [tenantId, setTenantId] = useState(null);

  const fetch = useCallback(async () => {
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

      if (limit != null) query = query.limit(limit);

      const { data, error: err } = await query;
      if (err) throw err;
      setNotes(data ?? []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [user, limit]);

  useEffect(() => { fetch(); }, [fetch]);

  const addNote = useCallback(async (content, opts = {}) => {
    const { data: member } = await supabase
      .from('tenant_members')
      .select('tenant_id')
      .eq('user_id', user.id)
      .eq('active', true)
      .single();

    const { error: err } = await supabase
      .from('stew_notes')
      .insert({
        tenant_id:        member.tenant_id,
        content,
        author_id:        user.id,
        source:           opts.source ?? 'typed',
        status:           opts.status ?? 'pending',
        related_guest_id: opts.relatedGuestId ?? null,
      });

    if (err) throw err;
    fetch();
  }, [user, fetch]);

  const updateContent = useCallback(async (id, content) => {
    setNotes(prev => prev.map(n => n.id === id ? { ...n, content } : n));
    const { error: err } = await supabase
      .from('stew_notes')
      .update({ content })
      .eq('id', id);
    if (err) { setError(err.message); fetch(); }
  }, [fetch]);

  const updateStatus = useCallback(async (id, status) => {
    setNotes(prev => prev.map(n => n.id === id ? { ...n, status } : n));
    const { error: err } = await supabase
      .from('stew_notes')
      .update({ status })
      .eq('id', id);
    if (err) { setError(err.message); fetch(); }
  }, [fetch]);

  const deleteNote = useCallback(async (id) => {
    setNotes(prev => prev.filter(n => n.id !== id));
    const { error: err } = await supabase
      .from('stew_notes')
      .update({ is_deleted: true, deleted_at: new Date().toISOString(), deleted_by_user_id: user?.id ?? null })
      .eq('id', id);
    if (err) { setError(err.message); fetch(); }
  }, [user, fetch]);

  // Appends note content to guest's preferences_summary + marks the note saved.
  // Sets related_guest_id too, so the note can be cross-linked from the guest
  // drawer. Also appends a preferences_changed entry to guests.history_log.
  const convertToPreference = useCallback(async (id, guestId) => {
    const note = notes.find(n => n.id === id);
    if (!note || !guestId) return;

    const { data: guest, error: guestErr } = await supabase
      .from('guests')
      .select('preferences_summary')
      .eq('id', guestId)
      .single();
    if (guestErr) { setError(guestErr.message); return; }

    const existing = (guest?.preferences_summary ?? '').trim();
    const separator = existing.length > 0 ? (existing.endsWith('.') ? ' ' : '. ') : '';
    const nextSummary = `${existing}${separator}${note.content}`.trim();

    try {
      await appendGuestHistory(supabase, {
        guestId,
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
      .update({ saved_to_preferences: true, related_guest_id: guestId })
      .eq('id', id);
    if (updNoteErr) { setError(updNoteErr.message); return; }

    fetch();
  }, [notes, user, fetch]);

  // Converts a stew note into a guest_day_notes entry for today. Marks the
  // stew note as done so it stops appearing in the Pending bucket, and sets
  // related_guest_id for cross-linking.
  const convertToDayNote = useCallback(async (id, guestId) => {
    const note = notes.find(n => n.id === id);
    if (!note || !guestId || !user) return;

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
        guest_id:  guestId,
        content:   note.content,
        author_id: user.id,
        note_date: today,
      });
    if (insertErr) { setError(insertErr.message); return; }

    const { error: updNoteErr } = await supabase
      .from('stew_notes')
      .update({ status: 'done', related_guest_id: guestId })
      .eq('id', id);
    if (updNoteErr) { setError(updNoteErr.message); return; }

    fetch();
  }, [notes, user, fetch]);

  return {
    notes,
    loading,
    error,
    tenantId,
    refetch: fetch,
    addNote,
    updateContent,
    updateStatus,
    deleteNote,
    convertToPreference,
    convertToDayNote,
  };
}
