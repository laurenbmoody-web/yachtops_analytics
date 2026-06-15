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
  const nk = p.next_of_kin || {};
  const pref = p.preferences || {};
  const b = banking || {};
  const phones = Array.isArray(p.phones) ? p.phones : [];
  const primaryPhone = phones.find((x) => x?.value)?.value || '';
  return {
    dateOfBirth: p.date_of_birth || '',
    nationality: p.nationality || '',
    phones,
    phoneNumber: primaryPhone,
    secondaryEmail: p.secondary_email || '',
    homeAddress: p.home_address || '',
    bloodType: p.blood_type || '',
    allergiesStatus: p.allergies_status || '',
    allergies: p.allergies_text || '',
    allergiesConfirmedAt: p.allergies_confirmed_at || '',
    medicalConditions: p.medical_conditions || '',
    emergencyContactName: ec.name || '',
    emergencyContactRelationship: ec.relationship || '',
    emergencyContactPhone: ec.phone || '',
    emergencyContactAddress: ec.address || '',
    nextOfKinName: nk.name || '',
    nextOfKinRelationship: nk.relationship || '',
    nextOfKinPhone: nk.phone || '',
    nextOfKinAddress: nk.address || '',
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
    dietaryCategory: pref.dietaryCategory || 'None / No restrictions',
    dietaryNotes: pref.dietaryNotes || '',
    cakePreference: pref.cakePreference || '',
    favouriteMeals: pref.favouriteMeals || '',
    favouriteSnacks: pref.favouriteSnacks || '',
    alcoholicPreference: pref.alcoholicPreference || 'None',
    nonAlcoholicPreferences: pref.nonAlcoholicPreferences || '',
  };
};

export const saveCrewProfileData = async (userId, f) => {
  if (!userId) return;
  const now = new Date().toISOString();
  const phones = Array.isArray(f.phones) && f.phones.length
    ? f.phones.filter((x) => x && (x.value || x.label))
    : (f.phoneNumber ? [{ label: 'Mobile', value: f.phoneNumber }] : []);

  const personal = {
    user_id: userId,
    date_of_birth: f.dateOfBirth || null,
    nationality: f.nationality || null,
    phones,
    secondary_email: f.secondaryEmail || null,
    home_address: f.homeAddress || null,
    blood_type: f.bloodType || null,
    allergies_status: f.allergiesStatus || null,
    allergies_text: f.allergies || null,
    allergies_confirmed_at: f.allergiesConfirmedAt || null,
    medical_conditions: f.medicalConditions || null,
    emergency_contact: {
      name: f.emergencyContactName || '', relationship: f.emergencyContactRelationship || '',
      phone: f.emergencyContactPhone || '', address: f.emergencyContactAddress || '',
    },
    next_of_kin: {
      name: f.nextOfKinName || '', relationship: f.nextOfKinRelationship || '',
      phone: f.nextOfKinPhone || '', address: f.nextOfKinAddress || '',
    },
    preferences: {
      dietaryCategory: f.dietaryCategory || '', dietaryNotes: f.dietaryNotes || '',
      cakePreference: f.cakePreference || '', favouriteMeals: f.favouriteMeals || '',
      favouriteSnacks: f.favouriteSnacks || '', alcoholicPreference: f.alcoholicPreference || '',
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
    updated_at: now,
  };

  const [pdRes, bankRes] = await Promise.all([
    supabase?.from('crew_personal_details')?.upsert(personal, { onConflict: 'user_id' }),
    supabase?.from('crew_banking')?.upsert(banking, { onConflict: 'user_id' }),
  ]);
  if (pdRes?.error) throw pdRes.error;
  if (bankRes?.error) throw bankRes.error;
};
