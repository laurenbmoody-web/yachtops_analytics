import { supabase } from '../../../lib/supabaseClient';

// Load + persist the crew profile fields that live in crew_personal_details
// and crew_banking (everything beyond name/email, which stay on profiles).

export const fetchCrewProfileData = async (userId) => {
  if (!userId) return { personal: null, banking: null };
  const [pdRes, bankRes] = await Promise.all([
    supabase?.from('crew_personal_details')?.select('*')?.eq('user_id', userId)?.maybeSingle(),
    supabase?.from('crew_banking')?.select('*')?.eq('user_id', userId)?.maybeSingle(),
  ]);
  return { personal: pdRes?.data || null, banking: bankRes?.data || null };
};

// DB rows → the flat formData shape the profile form uses.
export const profileDataToFormData = ({ personal, banking }) => {
  const p = personal || {};
  const ec = p.emergency_contact || {};
  const ec2 = ec.secondary || {};
  const nk = p.next_of_kin || {};
  const pref = p.preferences || {};
  const b = banking || {};
  const sa = b.secondary_account || {};
  const dr = p.doctor_contact || {};
  const phones = Array.isArray(p.phones) ? p.phones : [];
  const primaryPhone = phones.find((x) => x?.value)?.value || '';
  return {
    dateOfBirth: p.date_of_birth || '',
    nationality: p.nationality || '',
    placeOfBirth: p.place_of_birth || '',
    secondNationality: p.second_nationality || '',
    dualPassport: p.dual_passport ?? false,
    passportNumber: p.passport_number || '',
    dischargeBookNumber: p.discharge_book_number || '',
    verifierMembershipNumber: p.verifier_membership_number || '',
    prefix: p.prefix || '',
    preferredName: p.preferred_name || '',
    sex: p.sex || '',
    pronouns: p.pronouns || '',
    phones,
    phoneNumber: primaryPhone,
    secondaryEmail: p.secondary_email || '',
    homeAddress: p.home_address || '',
    bloodType: p.blood_type || '',
    allergiesStatus: p.allergies_status || '',
    allergies: p.allergies_text || '',
    allergiesConfirmedAt: p.allergies_confirmed_at || '',
    medicalConditions: p.medical_conditions || '',
    emergencyMedications: p.emergency_medications || '',
    doctorContactName: dr.name || '',
    doctorContactPhone: dr.phone || '',
    emergencyContactName: ec.name || '',
    emergencyContactRelationship: ec.relationship || '',
    emergencyContactPhone: ec.phone || '',
    emergencyContactEmail: ec.email || '',
    emergencyContactAddress: ec.address || '',
    emergencyContactCountry: ec.country || '',
    emergencyContactPreferredMethod: ec.preferredMethod || '',
    emergencyContactNotifyMedical: ec.notifyMedical ?? false,
    emergencyContactHandlesAffairs: ec.handlesAffairs ?? false,
    emergencyContactLastVerified: ec.lastVerified || '',
    emergencyContact2Name: ec2.name || '',
    emergencyContact2Relationship: ec2.relationship || '',
    emergencyContact2Phone: ec2.phone || '',
    emergencyContact2Email: ec2.email || '',
    emergencyContact2Address: ec2.address || '',
    emergencyContact2Country: ec2.country || '',
    emergencyContact2PreferredMethod: ec2.preferredMethod || '',
    emergencyContact2NotifyMedical: ec2.notifyMedical ?? false,
    emergencyContact2HandlesAffairs: ec2.handlesAffairs ?? false,
    emergencyContact2LastVerified: ec2.lastVerified || '',
    nextOfKinName: nk.name || '',
    nextOfKinRelationship: nk.relationship || '',
    nextOfKinPhone: nk.phone || '',
    nextOfKinEmail: nk.email || '',
    nextOfKinAddress: nk.address || '',
    nextOfKinCountry: nk.country || '',
    nextOfKinPreferredMethod: nk.preferredMethod || '',
    nextOfKinNotifyMedical: nk.notifyMedical ?? false,
    nextOfKinHandlesAffairs: nk.handlesAffairs ?? false,
    nextOfKinLastVerified: nk.lastVerified || '',
    bankAccountHolder: b.account_holder || '',
    bankName: b.bank_name || '',
    bankAccountNumber: b.account_number || '',
    bankSwiftBic: b.swift_bic || '',
    bankCurrency: b.currency || 'USD',
    bankCountry: b.country || '',
    bankAccountType: b.account_type || '',
    bankSortCode: b.sort_code || '',
    bankRoutingNumber: b.routing_number || '',
    bankAddressLine1: b.address_line1 || '',
    bankAddressLine2: b.address_line2 || '',
    bankAddressCity: b.city || '',
    bankAddressCountry: b.address_country || '',
    // Optional second account (split payments) — lives in a jsonb blob.
    bank2AccountHolder: sa.accountHolder || '',
    bank2Name: sa.bankName || '',
    bank2AccountNumber: sa.accountNumber || '',
    bank2SwiftBic: sa.swiftBic || '',
    bank2Currency: sa.currency || '',
    bank2Country: sa.country || '',
    bank2AccountType: sa.accountType || '',
    bank2SortCode: sa.sortCode || '',
    bank2RoutingNumber: sa.routingNumber || '',
    bankSplitType: sa.splitType || '',
    bankSplitValue: sa.splitValue || '',
    // Banking audit (read-only display).
    bankingLastEditedByName: b.last_edited_by_name || '',
    bankingUpdatedAt: b.updated_at || '',
    bankingLastViewedByName: b.last_viewed_by_name || '',
    bankingLastViewedAt: b.last_viewed_at || '',
    dietaryCategory: pref.dietaryCategory || 'None / No restrictions',
    dietaryNotes: pref.dietaryNotes || '',
    cakePreference: pref.cakePreference || '',
    // Tastes — favouriteMeals is reused as the "Loves" tag list (comma-joined),
    // so any existing free-text favourites carry straight over as chips.
    favouriteMeals: pref.favouriteMeals || '',
    favouriteSnacks: pref.favouriteSnacks || '',
    avoid: pref.avoid || '',
    tasteNotes: pref.tasteNotes || '',
    // How you like to eat
    appetite: pref.appetite || '',
    spiceLevel: pref.spiceLevel || '',
    breakfast: pref.breakfast || '',
    // Coffee & tea
    coffeeOrder: pref.coffeeOrder || '',
    tea: pref.tea || '',
    // A little about you
    comfortFood: pref.comfortFood || '',
    // Uniform & kit sizes (onboarding) — stored under preferences.uniformSizes.
    uniformTop: pref.uniformSizes?.top || '',
    uniformBottom: pref.uniformSizes?.bottom || '',
    uniformJacket: pref.uniformSizes?.jacket || '',
    uniformShoe: pref.uniformSizes?.shoe || '',
    // Retained from earlier versions so nothing is lost on save, even though the
    // redesigned Preferences tab no longer surfaces a dedicated drinks section.
    alcoholicPreference: pref.alcoholicPreference || 'None',
    nonAlcoholicPreferences: pref.nonAlcoholicPreferences || '',
  };
};

export const saveCrewProfileData = async (userId, f, actor = null) => {
  if (!userId) return;
  const now = new Date().toISOString();

  // Uniform sizes are now owned by the Issued Kit tab (which read-merge-writes
  // preferences.uniformSizes). This save replaces the whole preferences blob, so
  // preserve the current DB sizes rather than clobbering them with stale form
  // state from a tab that no longer edits them.
  // Snapshot the current rows before we overwrite them, both to preserve the
  // Issued-Kit-owned uniform sizes and to diff every changed field for the audit.
  const [{ data: existingPd }, { data: existingBank }] = await Promise.all([
    supabase?.from('crew_personal_details')?.select('*')?.eq('user_id', userId)?.maybeSingle() || Promise.resolve({}),
    supabase?.from('crew_banking')?.select('*')?.eq('user_id', userId)?.maybeSingle() || Promise.resolve({}),
  ]);
  const keepUniformSizes = existingPd?.preferences?.uniformSizes || {
    top: f.uniformTop || '', bottom: f.uniformBottom || '',
    jacket: f.uniformJacket || '', shoe: f.uniformShoe || '',
  };
  const phones = Array.isArray(f.phones) && f.phones.length
    ? f.phones.filter((x) => x && (x.value || x.label))
    : (f.phoneNumber ? [{ label: 'Mobile', value: f.phoneNumber }] : []);

  const personal = {
    user_id: userId,
    date_of_birth: f.dateOfBirth || null,
    nationality: f.nationality || null,
    place_of_birth: f.placeOfBirth || null,
    second_nationality: f.secondNationality || null,
    dual_passport: !!f.dualPassport,
    passport_number: f.passportNumber || null,
    discharge_book_number: f.dischargeBookNumber || null,
    verifier_membership_number: f.verifierMembershipNumber || null,
    prefix: f.prefix || null,
    preferred_name: f.preferredName || null,
    sex: f.sex || null,
    pronouns: f.pronouns || null,
    phones,
    secondary_email: f.secondaryEmail || null,
    home_address: f.homeAddress || null,
    blood_type: f.bloodType || null,
    allergies_status: f.allergiesStatus || null,
    allergies_text: f.allergies || null,
    allergies_confirmed_at: f.allergiesConfirmedAt || null,
    medical_conditions: f.medicalConditions || null,
    emergency_medications: f.emergencyMedications || null,
    doctor_contact: {
      name: f.doctorContactName || '', phone: f.doctorContactPhone || '',
    },
    emergency_contact: {
      name: f.emergencyContactName || '', relationship: f.emergencyContactRelationship || '',
      phone: f.emergencyContactPhone || '', email: f.emergencyContactEmail || '',
      address: f.emergencyContactAddress || '',
      country: f.emergencyContactCountry || '',
      preferredMethod: f.emergencyContactPreferredMethod || '',
      notifyMedical: !!f.emergencyContactNotifyMedical,
      handlesAffairs: !!f.emergencyContactHandlesAffairs,
      lastVerified: f.emergencyContactLastVerified || '',
      secondary: {
        name: f.emergencyContact2Name || '', relationship: f.emergencyContact2Relationship || '',
        phone: f.emergencyContact2Phone || '', email: f.emergencyContact2Email || '',
        address: f.emergencyContact2Address || '',
        country: f.emergencyContact2Country || '',
        preferredMethod: f.emergencyContact2PreferredMethod || '',
        notifyMedical: !!f.emergencyContact2NotifyMedical,
        handlesAffairs: !!f.emergencyContact2HandlesAffairs,
        lastVerified: f.emergencyContact2LastVerified || '',
      },
    },
    next_of_kin: {
      name: f.nextOfKinName || '', relationship: f.nextOfKinRelationship || '',
      phone: f.nextOfKinPhone || '', email: f.nextOfKinEmail || '',
      address: f.nextOfKinAddress || '',
      country: f.nextOfKinCountry || '',
      preferredMethod: f.nextOfKinPreferredMethod || '',
      notifyMedical: !!f.nextOfKinNotifyMedical,
      handlesAffairs: !!f.nextOfKinHandlesAffairs,
      lastVerified: f.nextOfKinLastVerified || '',
    },
    preferences: {
      dietaryCategory: f.dietaryCategory || '', dietaryNotes: f.dietaryNotes || '',
      cakePreference: f.cakePreference || '', favouriteMeals: f.favouriteMeals || '',
      favouriteSnacks: f.favouriteSnacks || '', avoid: f.avoid || '',
      tasteNotes: f.tasteNotes || '', appetite: f.appetite || '',
      spiceLevel: f.spiceLevel || '', breakfast: f.breakfast || '',
      coffeeOrder: f.coffeeOrder || '', tea: f.tea || '',
      comfortFood: f.comfortFood || '',
      uniformSizes: keepUniformSizes,
      alcoholicPreference: f.alcoholicPreference || '',
      nonAlcoholicPreferences: f.nonAlcoholicPreferences || '',
    },
    updated_at: now,
  };

  const banking = {
    user_id: userId,
    account_holder: f.bankAccountHolder || null,
    bank_name: f.bankName || null,
    account_number: f.bankAccountNumber || null,
    swift_bic: f.bankSwiftBic || null,
    currency: f.bankCurrency || null,
    country: f.bankCountry || null,
    account_type: f.bankAccountType || null,
    sort_code: f.bankSortCode || null,
    routing_number: f.bankRoutingNumber || null,
    address_line1: f.bankAddressLine1 || null,
    address_line2: f.bankAddressLine2 || null,
    city: f.bankAddressCity || null,
    address_country: f.bankAddressCountry || null,
    secondary_account: {
      accountHolder: f.bank2AccountHolder || '', bankName: f.bank2Name || '',
      accountNumber: f.bank2AccountNumber || '', swiftBic: f.bank2SwiftBic || '',
      currency: f.bank2Currency || '', country: f.bank2Country || '',
      accountType: f.bank2AccountType || '', sortCode: f.bank2SortCode || '',
      routingNumber: f.bank2RoutingNumber || '',
      splitType: f.bankSplitType || '', splitValue: f.bankSplitValue || '',
    },
    last_edited_by: actor?.id || null,
    last_edited_by_name: actor?.name || null,
    updated_at: now,
  };

  const [pdRes, bankRes] = await Promise.all([
    supabase?.from('crew_personal_details')?.upsert(personal, { onConflict: 'user_id' }),
    supabase?.from('crew_banking')?.upsert(banking, { onConflict: 'user_id' }),
  ]);
  if (pdRes?.error) throw pdRes.error;
  if (bankRes?.error) throw bankRes.error;

  // Field-level audit (non-blocking) — only after a successful save.
  try {
    await logProfileFieldChanges(userId, f.tenantId || null, actor, {
      personalOld: existingPd, personalNew: personal,
      bankOld: existingBank, bankNew: banking,
    });
  } catch (e) { console.error('[profile] audit log failed', e); }
};

// Personal Details scalar fields we audit with old → new values.
const PD_AUDIT_FIELDS = [
  ['date_of_birth', 'Date of birth'], ['nationality', 'Nationality'], ['place_of_birth', 'Place of birth'],
  ['second_nationality', 'Second nationality'], ['dual_passport', 'Dual passport'],
  ['discharge_book_number', 'Discharge book no.'], ['verifier_membership_number', 'Verifier membership no.'],
  ['prefix', 'Prefix'], ['preferred_name', 'Preferred name'], ['sex', 'Sex'], ['pronouns', 'Pronouns'],
  ['secondary_email', 'Secondary email'], ['home_address', 'Home address'], ['blood_type', 'Blood type'],
  ['allergies_status', 'Allergies status'], ['allergies_text', 'Allergies'],
  ['medical_conditions', 'Medical conditions'], ['emergency_medications', 'Emergency medications'],
];
// Nested JSON columns audited coarsely (changed yes/no, no values).
const PD_AUDIT_JSON = [
  ['emergency_contact', 'Emergency contact'], ['next_of_kin', 'Next of kin'],
  ['doctor_contact', 'Doctor contact'], ['preferences', 'Preferences'], ['phones', 'Phone numbers'],
];
// Banking fields are audited as "changed" only — values are sensitive, so we
// don't copy account numbers into a second table.
const BANK_AUDIT_FIELDS = [
  ['account_holder', 'Account holder'], ['bank_name', 'Bank name'], ['account_number', 'Account number'],
  ['swift_bic', 'SWIFT / BIC'], ['currency', 'Currency'], ['country', 'Country'], ['account_type', 'Account type'],
  ['sort_code', 'Sort code'], ['routing_number', 'Routing number'],
  ['address_line1', 'Bank address'], ['address_line2', 'Bank address line 2'], ['city', 'Bank city'], ['address_country', 'Bank country'],
  ['secondary_account', 'Secondary account'],
];

const auditNorm = (v) => (v === null || v === undefined ? '' : String(v));

const logProfileFieldChanges = async (userId, tenantId, actor, { personalOld, personalNew, bankOld, bankNew }) => {
  if (!actor?.id) return; // RLS requires actor_id = auth.uid()
  const rows = [];
  const base = { user_id: userId, tenant_id: tenantId, actor_id: actor.id, actor_name: actor.name || null };

  for (const [col, label] of PD_AUDIT_FIELDS) {
    if (auditNorm(personalOld?.[col]) !== auditNorm(personalNew?.[col])) {
      rows.push({ ...base, area: 'personal', field: col, label, old_value: auditNorm(personalOld?.[col]) || null, new_value: auditNorm(personalNew?.[col]) || null });
    }
  }
  for (const [col, label] of PD_AUDIT_JSON) {
    if (JSON.stringify(personalOld?.[col] ?? null) !== JSON.stringify(personalNew?.[col] ?? null)) {
      rows.push({ ...base, area: 'personal', field: col, label, old_value: null, new_value: null });
    }
  }
  for (const [col, label] of BANK_AUDIT_FIELDS) {
    const changed = col === 'secondary_account'
      ? JSON.stringify(bankOld?.[col] ?? null) !== JSON.stringify(bankNew?.[col] ?? null)
      : auditNorm(bankOld?.[col]) !== auditNorm(bankNew?.[col]);
    if (changed) rows.push({ ...base, area: 'banking', field: col, label, old_value: null, new_value: null });
  }

  if (rows.length) await supabase?.from('crew_profile_events')?.insert(rows);
};

// Passport detail keys → crew_personal_details columns the passport is the
// source of truth for.
const PASSPORT_IDENTITY_MAP = [
  { detail: 'date_of_birth', column: 'date_of_birth', label: 'Date of birth' },
  { detail: 'nationality', column: 'nationality', label: 'Nationality' },
  { detail: 'place_of_birth', column: 'place_of_birth', label: 'Place of birth' },
];

/**
 * The passport is authoritative for the holder's identity, so a saved passport
 * feeds the profile's Personal Details. Blank profile fields are filled from the
 * passport; fields that already hold a *different* value are left untouched and
 * reported back as conflicts for the user to reconcile.
 *
 * `details` is the passport document's details jsonb
 * ({ date_of_birth, nationality, place_of_birth, ... }).
 * Returns { updated: [labels], conflicts: [{ label, profile, passport }] }.
 */
export const syncPassportToPersonalDetails = async (userId, details) => {
  if (!userId || !details) return { updated: [], conflicts: [] };
  const norm = (v) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

  const { data: existing, error: readErr } = await supabase
    ?.from('crew_personal_details')?.select('*')?.eq('user_id', userId)?.maybeSingle();
  if (readErr) throw readErr;
  const cur = existing || {};

  const patch = {};
  const updated = [];
  const conflicts = [];
  for (const m of PASSPORT_IDENTITY_MAP) {
    const pv = details[m.detail];
    if (pv == null || String(pv).trim() === '') continue;
    const ev = cur[m.column];
    if (ev == null || String(ev).trim() === '') {
      patch[m.column] = pv;
      updated.push(m.label);
    } else if (norm(ev) !== norm(pv)) {
      conflicts.push({ label: m.label, profile: ev, passport: pv });
    }
  }

  if (Object.keys(patch).length) {
    const { error: upErr } = await supabase
      ?.from('crew_personal_details')
      ?.upsert({ user_id: userId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (upErr) throw upErr;
  }
  return { updated, conflicts };
};

/**
 * Record that a non-owner (e.g. command) viewed a crew member's banking.
 * Update-only: if no banking row exists yet there is nothing to view, so
 * this is a no-op rather than creating an empty row.
 */
export const logBankingView = async (userId, actor) => {
  if (!userId || !actor?.id) return;
  await supabase
    ?.from('crew_banking')
    ?.update({
      last_viewed_by: actor.id,
      last_viewed_by_name: actor.name || null,
      last_viewed_at: new Date().toISOString(),
    })
    ?.eq('user_id', userId);
};
