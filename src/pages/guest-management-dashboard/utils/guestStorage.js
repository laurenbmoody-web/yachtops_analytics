// Guest Management Storage Utility - Supabase Backend
import { supabase } from '../../../lib/supabaseClient';
import { logActivity } from '../../../utils/activityStorage';



// Marital Status enum
export const MaritalStatus = {
  SINGLE: 'Single',
  MARRIED: 'Married',
  PARTNERED: 'Partnered',
  DIVORCED: 'Divorced',
  WIDOWED: 'Widowed',
  UNKNOWN: 'Unknown'
};

// Guest Type enum
export const GuestType = {
  OWNER: 'Owner',
  CHARTER: 'Charter',
  UNKNOWN: 'Unknown'
};

// Guest Actions for activity feed
export const GuestActions = {
  GUEST_CREATED: 'GUEST_CREATED',
  GUEST_UPDATED: 'GUEST_UPDATED',
  GUEST_DELETED: 'GUEST_DELETED'
};

// Get active tenant ID from localStorage (same pattern used across app)
const getActiveTenantId = () => {
  return localStorage.getItem('cargo_active_tenant_id') ||
    localStorage.getItem('cargo.currentTenantId') ||
    null;
};

// Get current user ID from Supabase session
const getCurrentUserId = async () => {
  try {
    const { data: { session } } = await supabase?.auth?.getSession();
    return session?.user?.id || null;
  } catch {
    return null;
  }
};

// Map DB row (snake_case) → app object (camelCase)
const mapRowToGuest = (row) => {
  if (!row) return null;
  // Travel documents, commercial terms and legal status live in
  // public.guest_confidential, which only Command and Chief can read. The embed
  // comes back as an object, or as an array depending on how PostgREST resolves
  // the relationship, and as NOTHING AT ALL for crew — RLS simply returns no
  // row. That last case is the normal one, not an error: the guest still
  // renders, minus the parts crew are not entitled to.
  const confRaw = row?.guest_confidential;
  const conf = (Array.isArray(confRaw) ? confRaw[0] : confRaw) || {};
  return {
    id: row?.id,
    tenantId: row?.tenant_id,
    firstName: row?.first_name || '',
    lastName: row?.last_name || '',
    contactEmail: row?.contact_email || '',
    contactPhone: row?.contact_phone || '',
    guestType: row?.guest_type || GuestType?.UNKNOWN,
    maritalStatus: row?.marital_status || MaritalStatus?.UNKNOWN,
    spouseGuestId: row?.spouse_guest_id || null,
    dateOfBirth: row?.date_of_birth || null,
    cakePreference: row?.cake_preference || '',
    healthConditions: row?.health_conditions || '',
    allergies: row?.allergies || '',
    cabinAllocated: row?.cabin_allocated || '',
    cabinLocationPath: row?.cabin_location_path || '',
    cabinLocationLabel: row?.cabin_location_label || '',
    cabinLocationIds: row?.cabin_location_ids || null,
    cabinLocationId: row?.cabin_location_id || null,
    preferencesSummary: row?.preferences_summary || '',
    preferencesLinkEnabled: row?.preferences_link_enabled !== false,
    photo: row?.photo || null,
    isDeleted: row?.is_deleted || false,
    deletedAt: row?.deleted_at || null,
    deletedByUserId: row?.deleted_by_user_id || null,
    historyLog: row?.history_log || [],
    createdAt: row?.created_at,
    updatedAt: row?.updated_at,
    createdBy: row?.created_by,
    updatedBy: row?.updated_by,
    // Travel & Documents — confidential
    passportNumber: conf?.passport_number || '',
    passportNationality: conf?.passport_nationality || '',
    passportNationalityOther: conf?.passport_nationality_other || '',
    passportExpiryDate: conf?.passport_expiry_date || '',
    passportDocumentUrl: conf?.passport_document_url || null,
    visaNotes: conf?.visa_notes || '',
    // Emergency contacts stay on `guests`: whoever is standing there needs them
    // in a hurry, which is not a Command-only moment.
    emergencyContactName: row?.emergency_contact_name || '',
    emergencyContactPhone: row?.emergency_contact_phone || '',
    emergencyContactRelationship: row?.emergency_contact_relationship || '',
    // Payment & APA — confidential
    clientType: conf?.client_type || '',
    billingContactName: conf?.billing_contact_name || '',
    billingContactEmail: conf?.billing_contact_email || '',
    preferredCurrency: conf?.preferred_currency || '',
    apaRequired: conf?.apa_required || false,
    apaAmount: conf?.apa_amount || null,
    apaNotes: conf?.apa_notes || '',
    paymentNotes: conf?.payment_notes || '',
    // NDA — confidential
    ndaSigned: conf?.nda_signed || false,
    ndaExpiryDate: conf?.nda_expiry_date || '',
    ndaDocumentUrl: conf?.nda_document_url || null,
    privacyNotes: conf?.privacy_notes || '',
    // The guest's own stated privacy preference stays readable, so the page can
    // show crew what the guest asked for even where it is not yet enforced.
    privacyLevel: row?.privacy_level || 'Standard',
    photoPermission: row?.photo_permission || 'Ask Each Time',
    shareGuestInfoWithCrew: row?.share_guest_info_with_crew || 'Limited',
    isActiveOnTrip: row?.is_active_on_trip ?? false,
    // True when this reader was allowed the confidential record at all, so the
    // UI can say "you cannot see this" rather than showing convincing blanks.
    confidentialVisible: !!(confRaw && (Array.isArray(confRaw) ? confRaw.length : true)),
    // This guest's trips, each carrying the kind of trip it is. The roster
    // reads the role from here and only falls back to guestType when a guest
    // has no trips at all.
    trips: (row?.trip_guests || []).map((link) => ({
      tripId: link?.trip_id,
      isActiveOnTrip: link?.is_active_on_trip ?? false,
      tripType: link?.trips?.trip_type || '',
      startDate: link?.trips?.start_date || null,
      endDate: link?.trips?.end_date || null,
    })),
  };
};

// Map app object (camelCase) → DB row (snake_case)
const mapGuestToRow = (guestData) => {
  const row = {};
  if (guestData?.tenantId !== undefined) row.tenant_id = guestData?.tenantId;
  if (guestData?.firstName !== undefined) row.first_name = guestData?.firstName;
  if (guestData?.lastName !== undefined) row.last_name = guestData?.lastName;
  if (guestData?.contactEmail !== undefined) row.contact_email = guestData?.contactEmail;
  if (guestData?.contactPhone !== undefined) row.contact_phone = guestData?.contactPhone;
  if (guestData?.guestType !== undefined) row.guest_type = guestData?.guestType;
  if (guestData?.maritalStatus !== undefined) row.marital_status = guestData?.maritalStatus;
  if (guestData?.spouseGuestId !== undefined) row.spouse_guest_id = guestData?.spouseGuestId || null;
  if (guestData?.dateOfBirth !== undefined) row.date_of_birth = guestData?.dateOfBirth;
  if (guestData?.cakePreference !== undefined) row.cake_preference = guestData?.cakePreference;
  if (guestData?.healthConditions !== undefined) row.health_conditions = guestData?.healthConditions;
  if (guestData?.allergies !== undefined) row.allergies = guestData?.allergies;
  if (guestData?.cabinAllocated !== undefined) row.cabin_allocated = guestData?.cabinAllocated;
  if (guestData?.cabinLocationPath !== undefined) row.cabin_location_path = guestData?.cabinLocationPath;
  if (guestData?.cabinLocationLabel !== undefined) row.cabin_location_label = guestData?.cabinLocationLabel;
  if (guestData?.cabinLocationIds !== undefined) row.cabin_location_ids = guestData?.cabinLocationIds;
  if (guestData?.cabinLocationId !== undefined) row.cabin_location_id = guestData?.cabinLocationId;
  if (guestData?.preferencesSummary !== undefined) row.preferences_summary = guestData?.preferencesSummary;
  if (guestData?.preferencesLinkEnabled !== undefined) row.preferences_link_enabled = guestData?.preferencesLinkEnabled;
  if (guestData?.photo !== undefined) row.photo = guestData?.photo;
  if (guestData?.isDeleted !== undefined) row.is_deleted = guestData?.isDeleted;
  if (guestData?.deletedAt !== undefined) row.deleted_at = guestData?.deletedAt;
  if (guestData?.deletedByUserId !== undefined) row.deleted_by_user_id = guestData?.deletedByUserId;
  if (guestData?.historyLog !== undefined) row.history_log = guestData?.historyLog;
  if (guestData?.emergencyContactName !== undefined) row.emergency_contact_name = guestData?.emergencyContactName;
  if (guestData?.emergencyContactPhone !== undefined) row.emergency_contact_phone = guestData?.emergencyContactPhone;
  if (guestData?.emergencyContactRelationship !== undefined) row.emergency_contact_relationship = guestData?.emergencyContactRelationship;
  if (guestData?.privacyLevel !== undefined) row.privacy_level = guestData?.privacyLevel;
  if (guestData?.photoPermission !== undefined) row.photo_permission = guestData?.photoPermission;
  if (guestData?.shareGuestInfoWithCrew !== undefined) row.share_guest_info_with_crew = guestData?.shareGuestInfoWithCrew;
  if (guestData?.isActiveOnTrip !== undefined) row.is_active_on_trip = guestData?.isActiveOnTrip;
  return row;
};

// The other half of the same form: the fields that live in
// public.guest_confidential. Sparse like the one above, so an update only
// touches what the caller actually supplied. Returns an empty object when the
// caller sent none of them, which is the signal not to write that table at all
// — a crew member saving a guest's cabin must not be refused by RLS for a
// confidential write they never asked to make.
const mapGuestToConfidentialRow = (guestData) => {
  const row = {};
  if (guestData?.passportNumber !== undefined) row.passport_number = guestData?.passportNumber;
  if (guestData?.passportNationality !== undefined) row.passport_nationality = guestData?.passportNationality;
  if (guestData?.passportNationalityOther !== undefined) row.passport_nationality_other = guestData?.passportNationalityOther;
  if (guestData?.passportExpiryDate !== undefined) row.passport_expiry_date = guestData?.passportExpiryDate;
  if (guestData?.passportDocumentUrl !== undefined) row.passport_document_url = guestData?.passportDocumentUrl;
  if (guestData?.visaNotes !== undefined) row.visa_notes = guestData?.visaNotes;
  if (guestData?.clientType !== undefined) row.client_type = guestData?.clientType;
  if (guestData?.billingContactName !== undefined) row.billing_contact_name = guestData?.billingContactName;
  if (guestData?.billingContactEmail !== undefined) row.billing_contact_email = guestData?.billingContactEmail;
  if (guestData?.preferredCurrency !== undefined) row.preferred_currency = guestData?.preferredCurrency;
  if (guestData?.apaRequired !== undefined) row.apa_required = guestData?.apaRequired;
  if (guestData?.apaAmount !== undefined) row.apa_amount = guestData?.apaAmount;
  if (guestData?.apaNotes !== undefined) row.apa_notes = guestData?.apaNotes;
  if (guestData?.paymentNotes !== undefined) row.payment_notes = guestData?.paymentNotes;
  if (guestData?.ndaSigned !== undefined) row.nda_signed = guestData?.ndaSigned;
  if (guestData?.ndaExpiryDate !== undefined) row.nda_expiry_date = guestData?.ndaExpiryDate;
  if (guestData?.ndaDocumentUrl !== undefined) row.nda_document_url = guestData?.ndaDocumentUrl;
  if (guestData?.privacyNotes !== undefined) row.privacy_notes = guestData?.privacyNotes;
  return row;
};

// Write the confidential half, if the caller supplied any of it. Upsert rather
// than update: a guest created before this table existed has no row yet.
const saveConfidential = async (guestId, tenantId, guestData) => {
  const row = mapGuestToConfidentialRow(guestData);
  if (!Object.keys(row).length) return { error: null };
  const { error } = await supabase
    ?.from('guest_confidential')
    ?.upsert(
      { ...row, guest_id: guestId, tenant_id: tenantId, updated_at: new Date()?.toISOString() },
      { onConflict: 'guest_id' },
    );
  if (error) console.error('[guestStorage] saveConfidential failed:', error);
  return { error };
};

// Every read of a guest needs the confidential half embedded. RLS decides
// whether it comes back.
//
// The trip links come too, because owner-vs-charter is a property of the TRIP,
// not the person: trips.trip_type carries it and trip_guests joins the two.
// guests.guest_type is only a fallback for a guest with no trips — storing the
// distinction on the person is what led to Rafael Edry existing twice.
const GUEST_SELECT =
  '*, guest_confidential(*), trip_guests(trip_id, is_active_on_trip, trips(trip_type, start_date, end_date))';

// The same read without the trip links. An embed is resolved by PostgREST from
// the foreign keys at request time, so a relationship it cannot name fails the
// WHOLE query — and the guest list is not worth losing over a decoration. If
// the richer select fails for a schema reason (PGRST200 is "could not find a
// relationship"), fall back to this one and carry on with guest_type.
const GUEST_SELECT_FALLBACK = '*, guest_confidential(*)';

const isEmbedProblem = (error) =>
  error?.code === 'PGRST200' || /relationship|embed/i.test(error?.message || '');

// Load all guests for the active tenant
export const loadGuests = async (tenantId) => {
  try {
    const tid = tenantId || getActiveTenantId();
    if (!tid) {
      console.warn('[guestStorage] No tenant ID available');
      return [];
    }

    let { data, error } = await supabase?.from('guests')?.select(GUEST_SELECT)?.eq('tenant_id', tid)?.order('created_at', { ascending: false });

    if (error && isEmbedProblem(error)) {
      console.warn('[guestStorage] trip links unavailable, falling back:', error?.message);
      ({ data, error } = await supabase?.from('guests')?.select(GUEST_SELECT_FALLBACK)?.eq('tenant_id', tid)?.order('created_at', { ascending: false }));
    }

    if (error) {
      console.error('[guestStorage] loadGuests error:', error);
      throw error;
    }

    return (data || [])?.map(mapRowToGuest);
  } catch (error) {
    console.error('[guestStorage] loadGuests failed:', error);
    throw error;
  }
};

// Create new guest
export const createGuest = async (guestData, tenantId) => {
  try {
    const tid = tenantId || getActiveTenantId();
    if (!tid) throw new Error('No tenant ID available');

    const userId = await getCurrentUserId();
    const now = new Date()?.toISOString();

    const historyEntry = {
      id: `history-${Date.now()}-${Math.random()?.toString(36)?.substr(2, 9)}`,
      at: now,
      action: 'created',
      actorUserId: userId,
      message: 'Created'
    };

    const row = {
      tenant_id: tid,
      ...mapGuestToRow(guestData),
      is_deleted: false,
      deleted_at: null,
      deleted_by_user_id: null,
      history_log: [historyEntry],
      created_at: now,
      updated_at: now,
      created_by: userId,
      updated_by: userId,
    };

    const { data, error } = await supabase?.from('guests')?.insert(row)?.select()?.single();

    if (error) {
      console.error('[guestStorage] createGuest error:', error);
      throw error;
    }

    // The confidential half, if this form carried any. A failure here is NOT
    // swallowed into a half-saved guest: the guest row exists either way, and
    // the caller is told so the passport is not silently lost.
    const { error: confError } = await saveConfidential(data?.id, tid, guestData);
    if (confError) throw confError;

    const newGuest = mapRowToGuest({ ...data, guest_confidential: mapGuestToConfidentialRow(guestData) });

    // Handle bidirectional spouse linking
    if (newGuest?.spouseGuestId && guestData?.maritalStatus === MaritalStatus?.MARRIED) {
      await _linkSpouse(newGuest?.spouseGuestId, newGuest?.id, userId, tid);
    }

    // Log to activity feed
    const guestName = `${guestData?.firstName || ''} ${guestData?.lastName || ''}`?.trim();
    logActivity({
      module: 'guests',
      action: GuestActions?.GUEST_CREATED,
      entityType: 'guest',
      entityId: newGuest?.id,
      summary: `Guest created: ${guestName}`,
      meta: { guestName, guestType: guestData?.guestType }
    });

    return newGuest;
  } catch (error) {
    console.error('[guestStorage] createGuest failed:', error);
    return null;
  }
};

// Update existing guest
export const updateGuest = async (guestId, updates, tenantId) => {
  try {
    const tid = tenantId || getActiveTenantId();
    if (!tid) throw new Error('No tenant ID available');

    const userId = await getCurrentUserId();
    const now = new Date()?.toISOString();

    // Fetch current guest for history
    const { data: currentData, error: fetchError } = await supabase?.from('guests')?.select(GUEST_SELECT)?.eq('id', guestId)?.eq('tenant_id', tid)?.single();

    if (fetchError || !currentData) {
      console.error('[guestStorage] updateGuest: guest not found', fetchError);
      return null;
    }

    const currentGuest = mapRowToGuest(currentData);
    const oldSpouseId = currentGuest?.spouseGuestId;
    const newSpouseId = updates?.spouseGuestId !== undefined ? updates?.spouseGuestId : oldSpouseId;

    const historyEntry = {
      id: `history-${Date.now()}-${Math.random()?.toString(36)?.substr(2, 9)}`,
      at: now,
      action: 'updated',
      actorUserId: userId,
      message: 'Updated'
    };

    const existingLog = currentGuest?.historyLog || [];
    const updatedLog = [...existingLog, historyEntry];

    const row = {
      ...mapGuestToRow(updates),
      updated_at: now,
      updated_by: userId,
      history_log: updatedLog,
    };

    const { data, error } = await supabase?.from('guests')?.update(row)?.eq('id', guestId)?.eq('tenant_id', tid)?.select()?.single();

    if (error) {
      console.error('[guestStorage] updateGuest error:', error);
      throw error;
    }

    // Travel documents, commercial terms and legal status are a separate table
    // with its own RLS. Nothing is written there unless this form supplied some
    // of it, so a crew member saving a cabin is not refused for a confidential
    // write they never made.
    const { error: confError } = await saveConfidential(guestId, tid, updates);
    if (confError) throw confError;

    // Handle spouse link changes
    if (oldSpouseId && oldSpouseId !== newSpouseId) {
      await _unlinkSpouse(oldSpouseId, guestId, userId, tid);
    }
    if (newSpouseId && newSpouseId !== oldSpouseId && updates?.maritalStatus === MaritalStatus?.MARRIED) {
      await _linkSpouse(newSpouseId, guestId, userId, tid);
    }

    // Log to activity feed
    const guestName = `${currentGuest?.firstName || ''} ${currentGuest?.lastName || ''}`?.trim();
    logActivity({
      module: 'guests',
      action: GuestActions?.GUEST_UPDATED,
      entityType: 'guest',
      entityId: guestId,
      summary: `Guest updated: ${guestName}`,
      meta: { guestName }
    });

    // The update's own RETURNING cannot carry the embed, so fold the
    // confidential fields this call just wrote back in. Without this the caller
    // gets a guest whose passport looks newly empty.
    return mapRowToGuest({ ...data, guest_confidential: mapGuestToConfidentialRow(updates) });
  } catch (error) {
    console.error('[guestStorage] updateGuest failed:', error);
    return null;
  }
};

// Soft delete guest
export const deleteGuest = async (guestId, tenantId) => {
  try {
    const tid = tenantId || getActiveTenantId();
    if (!tid) throw new Error('No tenant ID available');

    const userId = await getCurrentUserId();
    const now = new Date()?.toISOString();

    // Fetch current for history
    const { data: currentData } = await supabase?.from('guests')?.select(GUEST_SELECT)?.eq('id', guestId)?.eq('tenant_id', tid)?.single();

    if (!currentData) return false;

    const currentGuest = mapRowToGuest(currentData);
    const historyEntry = {
      id: `history-${Date.now()}-${Math.random()?.toString(36)?.substr(2, 9)}`,
      at: now,
      action: 'deleted',
      actorUserId: userId,
      message: 'Deleted'
    };

    const { error } = await supabase?.from('guests')?.update({
        is_deleted: true,
        deleted_at: now,
        deleted_by_user_id: userId,
        updated_at: now,
        updated_by: userId,
        history_log: [...(currentGuest?.historyLog || []), historyEntry],
      })?.eq('id', guestId)?.eq('tenant_id', tid);

    if (error) {
      console.error('[guestStorage] deleteGuest error:', error);
      throw error;
    }

    // Clear spouse link if any
    if (currentGuest?.spouseGuestId) {
      await _unlinkSpouse(currentGuest?.spouseGuestId, guestId, userId, tid);
    }

    // Log to activity feed
    const guestName = `${currentGuest?.firstName || ''} ${currentGuest?.lastName || ''}`?.trim();
    logActivity({
      module: 'guests',
      action: GuestActions?.GUEST_DELETED,
      entityType: 'guest',
      entityId: guestId,
      summary: `Guest deleted: ${guestName}`,
      meta: { guestName }
    });

    return true;
  } catch (error) {
    console.error('[guestStorage] deleteGuest failed:', error);
    return false;
  }
};

// Reinstate (un-delete) guest
export const reinstateGuest = async (guestId, tenantId) => {
  try {
    const tid = tenantId || getActiveTenantId();
    if (!tid) throw new Error('No tenant ID available');

    const userId = await getCurrentUserId();
    const now = new Date()?.toISOString();

    const { data: currentData } = await supabase?.from('guests')?.select(GUEST_SELECT)?.eq('id', guestId)?.eq('tenant_id', tid)?.single();

    if (!currentData) return false;

    const currentGuest = mapRowToGuest(currentData);
    if (!currentGuest?.isDeleted) return false;

    const historyEntry = {
      id: `history-${Date.now()}-${Math.random()?.toString(36)?.substr(2, 9)}`,
      at: now,
      action: 'reinstated',
      actorUserId: userId,
      message: 'Reinstated'
    };

    const { error } = await supabase?.from('guests')?.update({
        is_deleted: false,
        deleted_at: null,
        deleted_by_user_id: null,
        updated_at: now,
        updated_by: userId,
        history_log: [...(currentGuest?.historyLog || []), historyEntry],
      })?.eq('id', guestId)?.eq('tenant_id', tid);

    if (error) {
      console.error('[guestStorage] reinstateGuest error:', error);
      throw error;
    }

    return true;
  } catch (error) {
    console.error('[guestStorage] reinstateGuest failed:', error);
    return false;
  }
};

// Get guest by ID
export const getGuestById = async (guestId, tenantId) => {
  try {
    const tid = tenantId || getActiveTenantId();
    if (!tid) return null;

    const { data, error } = await supabase?.from('guests')?.select(GUEST_SELECT)?.eq('id', guestId)?.eq('tenant_id', tid)?.single();

    if (error) return null;
    return mapRowToGuest(data);
  } catch {
    return null;
  }
};

// Get active guests (for dropdowns etc)
export const getActiveGuests = async (tenantId) => {
  try {
    const tid = tenantId || getActiveTenantId();
    if (!tid) return [];

    const { data, error } = await supabase?.from('guests')?.select('*')?.eq('tenant_id', tid)?.eq('is_deleted', false)?.order('last_name', { ascending: true })?.order('first_name', { ascending: true });

    if (error) return [];
    return (data || [])?.map(mapRowToGuest);
  } catch {
    return [];
  }
};

// Get available spouse options
export const getAvailableSpouseOptions = async (currentGuestId, tenantId) => {
  try {
    const tid = tenantId || getActiveTenantId();
    if (!tid) return [];

    const { data, error } = await supabase?.from('guests')?.select('*')?.eq('tenant_id', tid)?.eq('is_deleted', false)?.neq('id', currentGuestId);

    if (error) return [];

    return (data || [])?.map(mapRowToGuest)?.filter(g => !g?.spouseGuestId || g?.spouseGuestId === currentGuestId);
  } catch {
    return [];
  }
};

// Get available kids options (all active guests except self and already-linked kids)
export const getAvailableKidsOptions = async (currentGuestId, tenantId) => {
  try {
    const tid = tenantId || getActiveTenantId();
    if (!tid) return [];

    const { data, error } = await supabase?.from('guests')?.select('*')?.eq('tenant_id', tid)?.eq('is_deleted', false)?.neq('id', currentGuestId);

    if (error) return [];
    return (data || [])?.map(mapRowToGuest);
  } catch {
    return [];
  }
};

// Get linked kids for a guest
export const getLinkedKids = async (guestId, tenantId) => {
  try {
    const tid = tenantId || getActiveTenantId();
    if (!tid) return [];

    const { data, error } = await supabase
      ?.from('guest_relationships')
      ?.select('related_guest_id')
      ?.eq('tenant_id', tid)
      ?.eq('guest_id', guestId)
      ?.eq('relationship_type', 'child');

    if (error) return [];
    return (data || [])?.map(r => r?.related_guest_id);
  } catch {
    return [];
  }
};

// Link a kid to a guest
export const linkKid = async (guestId, kidGuestId, tenantId) => {
  try {
    const tid = tenantId || getActiveTenantId();
    if (!tid) throw new Error('No tenant ID available');

    const userId = await getCurrentUserId();

    const { error } = await supabase?.from('guest_relationships')?.insert({
      tenant_id: tid,
      guest_id: guestId,
      related_guest_id: kidGuestId,
      relationship_type: 'child',
      created_by: userId,
    });

    if (error && error?.code !== '23505') {
      console.error('[guestStorage] linkKid error:', error);
      return false;
    }
    return true;
  } catch (error) {
    console.error('[guestStorage] linkKid failed:', error);
    return false;
  }
};

// Unlink a kid from a guest
export const unlinkKid = async (guestId, kidGuestId, tenantId) => {
  try {
    const tid = tenantId || getActiveTenantId();
    if (!tid) throw new Error('No tenant ID available');

    const { error } = await supabase
      ?.from('guest_relationships')
      ?.delete()
      ?.eq('tenant_id', tid)
      ?.eq('guest_id', guestId)
      ?.eq('related_guest_id', kidGuestId)
      ?.eq('relationship_type', 'child');

    if (error) {
      console.error('[guestStorage] unlinkKid error:', error);
      return false;
    }
    return true;
  } catch (error) {
    console.error('[guestStorage] unlinkKid failed:', error);
    return false;
  }
};

// Get marital status display name
export const getMaritalStatusDisplay = (status) => {
  const displayMap = {
    [MaritalStatus?.SINGLE]: 'Single',
    [MaritalStatus?.MARRIED]: 'Married',
    [MaritalStatus?.PARTNERED]: 'Partnered',
    [MaritalStatus?.DIVORCED]: 'Divorced',
    [MaritalStatus?.WIDOWED]: 'Widowed',
    [MaritalStatus?.UNKNOWN]: 'Prefer not to say',
    'single': 'Single',
    'married': 'Married',
    'partnered': 'Partnered',
    'divorced': 'Divorced',
    'widowed': 'Widowed',
    'unknown': 'Prefer not to say'
  };
  return displayMap?.[status] || 'Prefer not to say';
};

// Upload passport document to guest-documents bucket
export const uploadPassportDocument = async (guestId, file, tenantId) => {
  try {
    const tid = tenantId || getActiveTenantId();
    if (!tid) throw new Error('No tenant ID available');

    const ext = file?.name?.split('.')?.pop();
    const path = `${tid}/guests/${guestId}/passport.${ext}`;

    const { error: uploadError } = await supabase?.storage
      ?.from('guest-documents')
      ?.upload(path, file, { upsert: true });

    if (uploadError) throw uploadError;

    // The path lives with the rest of the travel documents, not on the open
    // guest row. Upsert, because a guest created before that table existed has
    // no confidential row yet.
    const { error: updateError } = await saveConfidential(guestId, tid, { passportDocumentUrl: path });
    if (updateError) throw updateError;

    return path;
  } catch (error) {
    console.error('[guestStorage] uploadPassportDocument failed:', error);
    return null;
  }
};

// Delete passport document
export const deletePassportDocument = async (guestId, filePath, tenantId) => {
  try {
    const tid = tenantId || getActiveTenantId();
    if (!tid) throw new Error('No tenant ID available');

    const { error: removeError } = await supabase?.storage
      ?.from('guest-documents')
      ?.remove([filePath]);

    if (removeError) throw removeError;

    const { error: updateError } = await saveConfidential(guestId, tid, { passportDocumentUrl: null });
    if (updateError) throw updateError;

    return true;
  } catch (error) {
    console.error('[guestStorage] deletePassportDocument failed:', error);
    return false;
  }
};

// Get signed URL for passport document
export const getPassportDocumentSignedUrl = async (filePath) => {
  try {
    if (!filePath) return null;
    const { data, error } = await supabase?.storage
      ?.from('guest-documents')
      ?.createSignedUrl(filePath, 3600);
    if (error) throw error;
    return data?.signedUrl || null;
  } catch (error) {
    console.error('[guestStorage] getPassportDocumentSignedUrl failed:', error);
    return null;
  }
};

// --- Internal helpers ---

const _linkSpouse = async (spouseId, guestId, userId, tenantId) => {
  try {
    const { data: spouseData } = await supabase?.from('guests')?.select('history_log')?.eq('id', spouseId)?.eq('tenant_id', tenantId)?.single();

    if (!spouseData) return;

    const historyEntry = {
      id: `history-${Date.now()}-${Math.random()?.toString(36)?.substr(2, 9)}`,
      at: new Date()?.toISOString(),
      action: 'updated',
      actorUserId: userId,
      message: 'Spouse link added'
    };

    await supabase?.from('guests')?.update({
        spouse_guest_id: guestId,
        marital_status: MaritalStatus?.MARRIED,
        updated_at: new Date()?.toISOString(),
        updated_by: userId,
        history_log: [...(spouseData?.history_log || []), historyEntry],
      })?.eq('id', spouseId)?.eq('tenant_id', tenantId);
  } catch (err) {
    console.warn('[guestStorage] _linkSpouse failed:', err);
  }
};

const _unlinkSpouse = async (spouseId, guestId, userId, tenantId) => {
  try {
    const { data: spouseData } = await supabase?.from('guests')?.select('history_log, spouse_guest_id')?.eq('id', spouseId)?.eq('tenant_id', tenantId)?.single();

    if (!spouseData || spouseData?.spouse_guest_id !== guestId) return;

    const historyEntry = {
      id: `history-${Date.now()}-${Math.random()?.toString(36)?.substr(2, 9)}`,
      at: new Date()?.toISOString(),
      action: 'updated',
      actorUserId: userId,
      message: 'Spouse link removed'
    };

    await supabase?.from('guests')?.update({
        spouse_guest_id: null,
        updated_at: new Date()?.toISOString(),
        updated_by: userId,
        history_log: [...(spouseData?.history_log || []), historyEntry],
      })?.eq('id', spouseId)?.eq('tenant_id', tenantId);
  } catch (err) {
    console.warn('[guestStorage] _unlinkSpouse failed:', err);
  }
};