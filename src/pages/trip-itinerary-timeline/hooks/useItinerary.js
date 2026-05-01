// useItinerary — read + CRUD for trip_itinerary_days + trip_itinerary_activities.
//
// Mirrors the useStewNotes shape: tenant-scoped fetch, optimistic CRUD
// with rollback on Supabase error. Two tables, one hook — activities are
// nested inside their parent day on the read shape.
//
// Caller passes the Supabase trip UUID (not the legacy trip-{ts}-{rand}
// id). The trip detail page + timeline page both resolve `trip.supabaseId`
// from the merged trip object before invoking the hook.
//
// Optimistic state pattern: mutations apply locally first, persist
// async, roll back on error. addDay / addActivity await the insert
// before patching state so the new row gets its real UUID.

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { useAuth } from '../../../contexts/AuthContext';

const getActiveTenantIdFromLS = () => {
  return localStorage.getItem('cargo_active_tenant_id') ||
    localStorage.getItem('cargo.currentTenantId') ||
    null;
};

// Sort activities by start_time NULLS LAST, then sort_order. Used both
// at fetch time (Supabase doesn't support NULLS LAST through the JS
// client cleanly for nested ordering) and after every optimistic patch
// so the UI keeps a stable order.
const sortActivities = (activities) => {
  return [...(activities || [])].sort((a, b) => {
    const at = a?.start_time ?? null;
    const bt = b?.start_time ?? null;
    if (at == null && bt != null) return 1;
    if (at != null && bt == null) return -1;
    if (at !== bt) return (at ?? '').localeCompare(bt ?? '');
    return (a?.sort_order ?? 0) - (b?.sort_order ?? 0);
  });
};

const sortDays = (days) => {
  return [...(days || [])].sort((a, b) => {
    const ad = a?.event_date ?? '';
    const bd = b?.event_date ?? '';
    return ad.localeCompare(bd);
  });
};

export function useItinerary(tripSupabaseId) {
  const { user } = useAuth();
  const [days, setDays]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const fetchDays = useCallback(async () => {
    if (!user || !tripSupabaseId) {
      setDays([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const tid = getActiveTenantIdFromLS();
      if (!tid) {
        // No tenant context yet — bail without throwing. The auth
        // bootstrap will retrigger via user effect.
        setDays([]);
        setLoading(false);
        return;
      }

      // Embedded select for activities. PostgREST honours the FK between
      // trip_itinerary_activities.day_id and trip_itinerary_days.id.
      // We filter on parent's is_deleted only — soft-deleted activities
      // hide via the .filter on the embed.
      const { data, error: err } = await supabase
        .from('trip_itinerary_days')
        .select(`
          id, tenant_id, trip_id, event_date, location, stop_type,
          stop_detail, notes, aboard_guest_ids, created_at, updated_at,
          created_by, is_deleted,
          trip_itinerary_activities (
            id, tenant_id, day_id, start_time, title, description,
            location, linked_guest_ids, sort_order,
            created_at, updated_at, created_by, is_deleted
          )
        `)
        .eq('tenant_id', tid)
        .eq('trip_id', tripSupabaseId)
        .eq('is_deleted', false)
        .order('event_date', { ascending: true });
      if (err) throw err;

      const shaped = (data ?? []).map(d => ({
        ...d,
        activities: sortActivities(
          (d?.trip_itinerary_activities ?? []).filter(a => !a?.is_deleted)
        ),
      }));
      setDays(sortDays(shaped));
    } catch (e) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [user, tripSupabaseId]);

  useEffect(() => { fetchDays(); }, [fetchDays]);

  // ── Day mutations ──────────────────────────────────────────────────

  // addDay returns the new day row (with empty activities array). Caller
  // can use the returned id for follow-up writes (e.g. legacy
  // keyEvents/guestMovements LS sidecar from the overview modal).
  const addDay = useCallback(async (input) => {
    if (!user) {
      console.error('[itinerary] addDay aborted: no authenticated user');
      return null;
    }
    if (!tripSupabaseId) {
      console.error('[itinerary] addDay aborted: tripSupabaseId is missing — likely a pending-sync LS-only trip not yet stamped with a Supabase uuid. Trip may need to be re-saved or the migration runner needs to sync.');
      return null;
    }
    const tid = getActiveTenantIdFromLS();
    if (!tid) {
      console.error('[itinerary] addDay aborted: no active tenant id in localStorage (cargo_active_tenant_id / cargo.currentTenantId)');
      setError('No active tenant');
      return null;
    }

    const payload = {
      tenant_id:        tid,
      trip_id:          tripSupabaseId,
      event_date:       input?.event_date,
      location:         (input?.location ?? '').trim(),
      stop_type:        input?.stop_type ?? null,
      stop_detail:      input?.stop_detail ?? null,
      notes:            input?.notes ?? null,
      aboard_guest_ids: Array.isArray(input?.aboard_guest_ids) ? input.aboard_guest_ids : [],
      created_by:       user.id,
    };

    try {
      const { data, error: err } = await supabase
        .from('trip_itinerary_days')
        .insert(payload)
        .select('*')
        .single();
      if (err) {
        console.error('[itinerary] addDay supabase error:', err, 'payload:', payload);
        setError(err.message);
        return null;
      }

      const newDay = { ...data, activities: [] };
      setDays(curr => sortDays([...curr, newDay]));
      return newDay;
    } catch (e) {
      console.error('[itinerary] addDay unexpected error:', e, 'payload:', payload);
      setError(e?.message ?? String(e));
      return null;
    }
  }, [user, tripSupabaseId]);

  // Branch updates by field — caller passes any subset of editable
  // columns. Optimistic patch on local state, rollback if Supabase
  // rejects (RLS, CHECK on stop_type, etc.).
  const updateDay = useCallback(async (dayId, updates) => {
    if (!user) {
      console.error('[itinerary] updateDay aborted: no authenticated user');
      return null;
    }
    const prev = days;

    setDays(curr => sortDays(curr.map(d =>
      d.id === dayId ? { ...d, ...updates } : d
    )));

    const allowed = {};
    if (updates?.event_date       !== undefined) allowed.event_date       = updates.event_date;
    if (updates?.location         !== undefined) allowed.location         = updates.location;
    if (updates?.stop_type        !== undefined) allowed.stop_type        = updates.stop_type;
    if (updates?.stop_detail      !== undefined) allowed.stop_detail      = updates.stop_detail;
    if (updates?.notes            !== undefined) allowed.notes            = updates.notes;
    if (updates?.aboard_guest_ids !== undefined) allowed.aboard_guest_ids = updates.aboard_guest_ids;
    if (Object.keys(allowed).length === 0) {
      console.error('[itinerary] updateDay aborted: no whitelisted fields in updates payload', updates);
      return null;
    }

    try {
      const { data, error: err } = await supabase
        .from('trip_itinerary_days')
        .update(allowed)
        .eq('id', dayId)
        .select('*')
        .single();
      if (err) {
        console.error('[itinerary] updateDay supabase error:', err, 'dayId:', dayId, 'payload:', allowed);
        setDays(prev);
        setError(err.message);
        return null;
      }
      return data;
    } catch (e) {
      console.error('[itinerary] updateDay unexpected error:', e, 'dayId:', dayId, 'payload:', allowed);
      setDays(prev);
      setError(e?.message ?? String(e));
      return null;
    }
  }, [days, user]);

  // Soft delete. Optimistic remove from local state.
  const deleteDay = useCallback(async (dayId) => {
    if (!user) {
      console.error('[itinerary] deleteDay aborted: no authenticated user');
      return false;
    }
    const prev = days;
    setDays(curr => curr.filter(d => d.id !== dayId));

    try {
      const { error: err } = await supabase
        .from('trip_itinerary_days')
        .update({
          is_deleted:         true,
          deleted_at:         new Date().toISOString(),
          deleted_by_user_id: user.id,
        })
        .eq('id', dayId);
      if (err) {
        console.error('[itinerary] deleteDay supabase error:', err, 'dayId:', dayId);
        setDays(prev);
        setError(err.message);
        return false;
      }
      return true;
    } catch (e) {
      console.error('[itinerary] deleteDay unexpected error:', e, 'dayId:', dayId);
      setDays(prev);
      setError(e?.message ?? String(e));
      return false;
    }
  }, [days, user]);

  // ── Activity mutations ─────────────────────────────────────────────

  const addActivity = useCallback(async (input) => {
    if (!user) {
      console.error('[itinerary] addActivity aborted: no authenticated user');
      return null;
    }
    const tid = getActiveTenantIdFromLS();
    if (!tid) {
      console.error('[itinerary] addActivity aborted: no active tenant id in localStorage');
      setError('No active tenant');
      return null;
    }
    if (!input?.day_id) {
      console.error('[itinerary] addActivity aborted: input.day_id is missing', input);
      return null;
    }

    // Compute next sort_order for this day so manual time-less entries
    // append at the end. Falls back to 0 when the day has no activities.
    const dayRow = days.find(d => d.id === input?.day_id);
    const maxSort = (dayRow?.activities ?? []).reduce(
      (acc, a) => Math.max(acc, a?.sort_order ?? 0), 0
    );

    const payload = {
      tenant_id:        tid,
      day_id:           input?.day_id,
      start_time:       input?.start_time || null,
      title:            (input?.title ?? '').trim(),
      description:      input?.description ?? null,
      location:         input?.location ?? null,
      linked_guest_ids: Array.isArray(input?.linked_guest_ids) ? input.linked_guest_ids : [],
      sort_order:       maxSort + 1,
      created_by:       user.id,
    };

    try {
      const { data, error: err } = await supabase
        .from('trip_itinerary_activities')
        .insert(payload)
        .select('*')
        .single();
      if (err) {
        console.error('[itinerary] addActivity supabase error:', err, 'payload:', payload);
        setError(err.message);
        return null;
      }
      setDays(curr => curr.map(d => d.id === input?.day_id
        ? { ...d, activities: sortActivities([...(d.activities ?? []), data]) }
        : d));
      return data;
    } catch (e) {
      console.error('[itinerary] addActivity unexpected error:', e, 'payload:', payload);
      setError(e?.message ?? String(e));
      return null;
    }
  }, [days, user]);

  const updateActivity = useCallback(async (activityId, updates) => {
    if (!user) {
      console.error('[itinerary] updateActivity aborted: no authenticated user');
      return null;
    }
    const prev = days;

    setDays(curr => curr.map(d => ({
      ...d,
      activities: sortActivities((d.activities ?? []).map(a =>
        a.id === activityId ? { ...a, ...updates } : a
      )),
    })));

    const allowed = {};
    if (updates?.start_time       !== undefined) allowed.start_time       = updates.start_time || null;
    if (updates?.title            !== undefined) allowed.title            = updates.title;
    if (updates?.description      !== undefined) allowed.description      = updates.description;
    if (updates?.location         !== undefined) allowed.location         = updates.location;
    if (updates?.linked_guest_ids !== undefined) allowed.linked_guest_ids = updates.linked_guest_ids;
    if (updates?.sort_order       !== undefined) allowed.sort_order       = updates.sort_order;
    if (Object.keys(allowed).length === 0) {
      console.error('[itinerary] updateActivity aborted: no whitelisted fields in updates payload', updates);
      return null;
    }

    try {
      const { data, error: err } = await supabase
        .from('trip_itinerary_activities')
        .update(allowed)
        .eq('id', activityId)
        .select('*')
        .single();
      if (err) {
        console.error('[itinerary] updateActivity supabase error:', err, 'activityId:', activityId, 'payload:', allowed);
        setDays(prev);
        setError(err.message);
        return null;
      }
      return data;
    } catch (e) {
      console.error('[itinerary] updateActivity unexpected error:', e, 'activityId:', activityId, 'payload:', allowed);
      setDays(prev);
      setError(e?.message ?? String(e));
      return null;
    }
  }, [days, user]);

  const deleteActivity = useCallback(async (activityId) => {
    if (!user) {
      console.error('[itinerary] deleteActivity aborted: no authenticated user');
      return false;
    }
    const prev = days;
    setDays(curr => curr.map(d => ({
      ...d,
      activities: (d.activities ?? []).filter(a => a.id !== activityId),
    })));

    try {
      const { error: err } = await supabase
        .from('trip_itinerary_activities')
        .update({
          is_deleted:         true,
          deleted_at:         new Date().toISOString(),
          deleted_by_user_id: user.id,
        })
        .eq('id', activityId);
      if (err) {
        console.error('[itinerary] deleteActivity supabase error:', err, 'activityId:', activityId);
        setDays(prev);
        setError(err.message);
        return false;
      }
      return true;
    } catch (e) {
      console.error('[itinerary] deleteActivity unexpected error:', e, 'activityId:', activityId);
      setDays(prev);
      setError(e?.message ?? String(e));
      return false;
    }
  }, [days, user]);

  // Bulk reorder — used by drag-rearrange. Renumbers sort_order for
  // every activity in the supplied order array; persists in one round
  // trip per row (Supabase doesn't expose a bulk-update RPC for this).
  const reorderActivities = useCallback(async (dayId, activityIdsInOrder) => {
    if (!user || !Array.isArray(activityIdsInOrder)) return false;
    const prev = days;

    // Optimistic local reorder + sort_order rewrite.
    setDays(curr => curr.map(d => {
      if (d.id !== dayId) return d;
      const byId = new Map((d.activities ?? []).map(a => [a.id, a]));
      const reordered = activityIdsInOrder
        .map((id, idx) => byId.has(id) ? { ...byId.get(id), sort_order: idx + 1 } : null)
        .filter(Boolean);
      return { ...d, activities: sortActivities(reordered) };
    }));

    try {
      await Promise.all(activityIdsInOrder.map((id, idx) => supabase
        .from('trip_itinerary_activities')
        .update({ sort_order: idx + 1 })
        .eq('id', id)
      ));
      return true;
    } catch (e) {
      console.error('[itinerary] reorderActivities error:', e, 'dayId:', dayId, 'order:', activityIdsInOrder);
      setDays(prev);
      setError(e?.message ?? String(e));
      return false;
    }
  }, [days, user]);

  return {
    days,
    loading,
    error,
    refetch: fetchDays,
    addDay,
    updateDay,
    deleteDay,
    addActivity,
    updateActivity,
    deleteActivity,
    reorderActivities,
  };
}
