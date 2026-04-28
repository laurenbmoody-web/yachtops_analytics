// Guest Preferences Storage Utility - Supabase Backend
import { supabase } from '../lib/supabaseClient';
import { logActivity } from './activityStorage';
import { syncPreferencesForGuest } from './preferencesSync';

// Get active tenant ID from localStorage
const getActiveTenantId = () => {
  return localStorage.getItem('cargo_active_tenant_id') ||
    localStorage.getItem('cargo.currentTenantId') ||
    null;
};

// Get current user from Supabase session
const getCurrentUser = async () => {
  try {
    const { data: { session } } = await supabase?.auth?.getSession();
    return session?.user || null;
  } catch {
    return null;
  }
};

// Map DB row (snake_case) → app object (camelCase)
const mapRowToPreference = (row) => {
  if (!row) return null;
  return {
    id: row?.id,
    tenantId: row?.tenant_id,
    guestId: row?.guest_id,
    tripId: row?.trip_id || null,
    category: row?.category,
    key: row?.key,
    value: row?.value,
    priority: row?.priority || 'normal',
    tags: row?.tags || [],
    confidence: row?.confidence || null,
    timeOfDay: row?.time_of_day || null,
    prefType: row?.pref_type || 'preference',
    source: row?.source || 'master',
    preferenceImageUrl: row?.preference_image_url || null,
    updatedByUserId: row?.updated_by_user_id || null,
    updatedByUserName: row?.updated_by_user_name || '',
    createdAt: row?.created_at,
    updatedAt: row?.updated_at,
    createdBy: row?.created_by,
    updatedBy: row?.updated_by,
  };
};

// Load all preferences for a guest
export const getPreferencesByGuest = async (guestId, tenantId) => {
  try {
    const tid = tenantId || getActiveTenantId();
    if (!tid || !guestId) return [];

    const { data, error } = await supabase
      ?.from('guest_preferences')
      ?.select('*')
      ?.eq('tenant_id', tid)
      ?.eq('guest_id', guestId)
      ?.order('updated_at', { ascending: false });

    if (error) {
      console.error('[preferencesStorage] getPreferencesByGuest error:', error);
      return [];
    }

    return (data || [])?.map(mapRowToPreference);
  } catch (err) {
    console.error('[preferencesStorage] getPreferencesByGuest failed:', err);
    return [];
  }
};

// Load preferences by guest and trip
export const getPreferencesByGuestAndTrip = async (guestId, tripId, tenantId) => {
  try {
    const tid = tenantId || getActiveTenantId();
    if (!tid || !guestId) return [];

    let query = supabase
      ?.from('guest_preferences')
      ?.select('*')
      ?.eq('tenant_id', tid)
      ?.eq('guest_id', guestId);

    if (tripId === null) {
      query = query?.is('trip_id', null);
    } else {
      query = query?.eq('trip_id', tripId);
    }

    const { data, error } = await query?.order('updated_at', { ascending: false });

    if (error) {
      console.error('[preferencesStorage] getPreferencesByGuestAndTrip error:', error);
      return [];
    }

    return (data || [])?.map(mapRowToPreference);
  } catch (err) {
    console.error('[preferencesStorage] getPreferencesByGuestAndTrip failed:', err);
    return [];
  }
};

// Create a new preference
export const createPreference = async (preferenceData, tenantId) => {
  try {
    const tid = tenantId || getActiveTenantId();
    if (!tid) throw new Error('No tenant ID available');

    const user = await getCurrentUser();
    const userId = user?.id || null;
    const userName = user?.user_metadata?.full_name || user?.email || 'Unknown';
    const now = new Date()?.toISOString();

    const row = {
      tenant_id: tid,
      guest_id: preferenceData?.guestId,
      trip_id: preferenceData?.tripId || null,
      category: preferenceData?.category,
      key: preferenceData?.key || '',
      value: preferenceData?.value || '',
      priority: preferenceData?.priority || 'normal',
      tags: preferenceData?.tags || [],
      confidence: preferenceData?.confidence || null,
      time_of_day: preferenceData?.timeOfDay || null,
      pref_type: preferenceData?.prefType || 'preference',
      source: preferenceData?.source || 'master',
      updated_by_user_id: userId,
      updated_by_user_name: userName,
      created_at: now,
      updated_at: now,
      created_by: userId,
      updated_by: userId,
    };

    const { data, error } = await supabase
      ?.from('guest_preferences')
      ?.insert(row)
      ?.select()
      ?.single();

    if (error) {
      console.error('[preferencesStorage] createPreference error:', error);
      return null;
    }

    const result = mapRowToPreference(data);

    // Log activity
    logActivity({
      actorName: userName,
      module: 'preferences',
      action: 'PREFERENCE_CREATED',
      entityType: 'preference',
      entityId: result?.id,
      summary: `${userName} added preference "${preferenceData?.value || preferenceData?.key || 'item'}" for guest`,
      meta: {
        guestId: preferenceData?.guestId,
        category: preferenceData?.category,
        value: preferenceData?.value,
      }
    });

    // Back-sync structured guests.* column(s) and append history_log entry.
    // One hook covers every category so every UI surface propagates automatically.
    await syncPreferencesForGuest(supabase, {
      guestId:     preferenceData?.guestId,
      tenantId:    tid,
      actorUserId: userId,
      category:    preferenceData?.category,
    });

    return result;
  } catch (err) {
    console.error('[preferencesStorage] createPreference failed:', err);
    return null;
  }
};

// Update an existing preference
export const updatePreference = async (preferenceId, updates, tenantId) => {
  try {
    const tid = tenantId || getActiveTenantId();
    if (!tid) throw new Error('No tenant ID available');

    const user = await getCurrentUser();
    const userId = user?.id || null;
    const userName = user?.user_metadata?.full_name || user?.email || 'Unknown';
    const now = new Date()?.toISOString();

    const row = {};
    if (updates?.key !== undefined) row.key = updates?.key;
    if (updates?.value !== undefined) row.value = updates?.value;
    if (updates?.priority !== undefined) row.priority = updates?.priority;
    if (updates?.tags !== undefined) row.tags = updates?.tags;
    if (updates?.confidence !== undefined) row.confidence = updates?.confidence;
    if (updates?.timeOfDay !== undefined) row.time_of_day = updates?.timeOfDay;
    if (updates?.prefType !== undefined) row.pref_type = updates?.prefType;
    row.updated_at = now;
    row.updated_by = userId;
    row.updated_by_user_id = userId;
    row.updated_by_user_name = userName;

    const { data, error } = await supabase
      ?.from('guest_preferences')
      ?.update(row)
      ?.eq('id', preferenceId)
      ?.eq('tenant_id', tid)
      ?.select();

    if (error) {
      console.error('[preferencesStorage] updatePreference error:', error);
      return null;
    }

    // Log activity
    logActivity({
      actorName: userName,
      module: 'preferences',
      action: 'PREFERENCE_UPDATED',
      entityType: 'preference',
      entityId: preferenceId,
      summary: `${userName} updated preference "${updates?.value || updates?.key || 'item'}"`,
      meta: {
        preferenceId,
        updates,
      }
    });

    // Resolve the full row (returned or refetched) so we know which guest +
    // category the update affected, then back-sync structured columns.
    let rowAfter = data && data?.length > 0 ? data?.[0] : null;
    if (!rowAfter) {
      const { data: refetched, error: refetchError } = await supabase
        ?.from('guest_preferences')
        ?.select('*')
        ?.eq('id', preferenceId)
        ?.eq('tenant_id', tid)
        ?.single();
      if (refetchError) {
        console.error('[preferencesStorage] updatePreference refetch error:', refetchError);
        return null;
      }
      rowAfter = refetched;
    }

    await syncPreferencesForGuest(supabase, {
      guestId:     rowAfter?.guest_id,
      tenantId:    tid,
      actorUserId: userId,
      category:    rowAfter?.category,
    });

    return mapRowToPreference(rowAfter);
  } catch (err) {
    console.error('[preferencesStorage] updatePreference failed:', err);
    return null;
  }
};

// Delete a preference
export const deletePreference = async (preferenceId, tenantId) => {
  try {
    const tid = tenantId || getActiveTenantId();
    if (!tid) throw new Error('No tenant ID available');

    const user = await getCurrentUser();
    const userId = user?.id || null;
    const userName = user?.user_metadata?.full_name || user?.email || 'Unknown';

    // Read guest_id + category before delete so we can sync afterwards.
    const { data: rowBefore, error: readErr } = await supabase
      ?.from('guest_preferences')
      ?.select('guest_id, category')
      ?.eq('id', preferenceId)
      ?.eq('tenant_id', tid)
      ?.single();
    if (readErr) {
      console.error('[preferencesStorage] deletePreference read-before error:', readErr);
      // Proceed with delete even if we can't read — no-op for sync if row is gone.
    }

    const { error } = await supabase
      ?.from('guest_preferences')
      ?.delete()
      ?.eq('id', preferenceId)
      ?.eq('tenant_id', tid);

    if (error) {
      console.error('[preferencesStorage] deletePreference error:', error);
      return false;
    }

    // Log activity
    logActivity({
      actorName: userName,
      module: 'preferences',
      action: 'PREFERENCE_DELETED',
      entityType: 'preference',
      entityId: preferenceId,
      summary: `${userName} deleted a preference`,
      meta: { preferenceId }
    });

    if (rowBefore?.guest_id && rowBefore?.category) {
      await syncPreferencesForGuest(supabase, {
        guestId:     rowBefore.guest_id,
        tenantId:    tid,
        actorUserId: userId,
        category:    rowBefore.category,
      });
    }

    return true;
  } catch (err) {
    console.error('[preferencesStorage] deletePreference failed:', err);
    return false;
  }
};

// Re-export PreferenceCategory and PreferencePriority for convenience
export const PreferenceCategory = {
  FOOD_BEVERAGE: 'Food & Beverage',
  DIETARY: 'Dietary',
  WINE_SPIRITS: 'Wine/Spirits',
  ALLERGIES: 'Allergies',
  ACTIVITIES: 'Activities',
  CABIN: 'Cabin',
  SERVICE: 'Service',
  ROUTINE: 'Routine',
  OTHER: 'Other'
};

export const PreferencePriority = {
  LOW: 'low',
  NORMAL: 'normal',
  HIGH: 'high'
};
