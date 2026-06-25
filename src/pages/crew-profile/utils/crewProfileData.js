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
  const dr = p.doctor_contact || {};
  const phones = Array.isArray(p.phones) ? p.phones : [];
  const primaryPhone = phones.find((x) => x?.value)?.value || '';
  return {
    dateOfBirth: p.date_of_birth || '',
    nationality: p.nationality || '',
    placeOfBirth: p.place_of_birth || '',
    secondNationality: p.second_nationality || '',
    dualPassport: p.dual_passport ?? false,
    dischargeBookNumber: p.discharge_book_number || '',
    prefix: p.prefix || '',
    preferredName: p.preferred_name || '',
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
    // Retained from earlier versions so nothing is lost on save, even though the
    // redesigned Preferences tab no longer surfaces a dedicated drinks section.
    alcoholicPreference: pref.alcoholicPreference || 'None',
    nonAlcoholicPreferences: pref.nonAlcoholicPreferences || '',
  };
};

export const saveCrewProfileData = async (userId, f, actor = null) => {
  if (!userId) return;
  const now = new Date().toISOString();
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
    discharge_book_number: f.dischargeBookNumber || null,
    prefix: f.prefix || null,
    preferred_name: f.preferredName || null,
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
