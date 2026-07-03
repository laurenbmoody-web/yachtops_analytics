// Crew-list data layer — assembles the fields an IMO FAL Form 5 (crew list for
// port authority / immigration) needs, from the tables that hold them:
//   • roster name + rank            → already on the `users` array (crew mgmt page)
//   • DOB / place of birth /        → crew_personal_details (user_id PK)
//     nationality / sex / address
//   • passport number + expiry +    → personal_documents (doc_type = 'passport')
//     issuing state
//   • vessel header                 → vessels (one row per tenant)
// All readable by a COMMAND user for every crew member in the tenant (RLS).

import { supabase } from '../../../lib/supabaseClient';

// Split a stored "First Middle Last" full name into fore name + surname for the
// two crew-list columns: last token is the surname, the rest the fore name(s).
export const splitName = (fullName) => {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { foreName: '', surname: '' };
  if (parts.length === 1) return { foreName: parts[0], surname: '' };
  return { foreName: parts.slice(0, -1).join(' '), surname: parts[parts.length - 1] };
};

// Pick the most relevant passport when a member uploaded more than one: prefer
// the latest expiry, then the most recently updated.
const pickPassport = (docs) => {
  if (!docs || !docs.length) return null;
  return [...docs].sort((a, b) => {
    const ea = a.expiry_date || '', eb = b.expiry_date || '';
    if (ea !== eb) return eb.localeCompare(ea);
    return String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
  })[0];
};

/** Vessel header fields for the crew list (call sign / class aren't stored). */
export const fetchVesselForCrewList = async (tenantId) => {
  if (!tenantId) return null;
  const { data } = await supabase
    .from('vessels')
    .select('name, flag, port_of_registry, official_number, imo_number, mmsi, gt, loa_m, year_built, commercial_status, certified_commercial, logo_url')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  return data || null;
};

/**
 * Fetch and merge the per-crew personal + passport details for the given
 * user_ids. Returns a map keyed by user_id of the crew-list fields.
 */
export const fetchCrewListDetails = async (tenantId, userIds = []) => {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return {};

  const [{ data: details }, { data: docs }] = await Promise.all([
    supabase
      .from('crew_personal_details')
      .select('user_id, date_of_birth, place_of_birth, nationality, sex, home_address')
      .in('user_id', ids),
    supabase
      .from('personal_documents')
      .select('user_id, document_number, expiry_date, issue_date, flag_state, issuing_authority, details, updated_at')
      .eq('tenant_id', tenantId)
      .eq('doc_type', 'passport')
      .in('user_id', ids),
  ]);

  const detailsByUser = {};
  (details || []).forEach((d) => { detailsByUser[d.user_id] = d; });
  const docsByUser = {};
  (docs || []).forEach((d) => { (docsByUser[d.user_id] = docsByUser[d.user_id] || []).push(d); });

  const out = {};
  ids.forEach((uid) => {
    const d = detailsByUser[uid] || {};
    const p = pickPassport(docsByUser[uid]) || {};
    const pDetails = p.details || {};
    out[uid] = {
      dob: d.date_of_birth || pDetails.date_of_birth || '',
      placeOfBirth: d.place_of_birth || pDetails.place_of_birth || '',
      nationality: d.nationality || pDetails.nationality || '',
      sex: d.sex || '',
      address: d.home_address || '',
      passportNo: p.document_number || '',
      passportIssue: p.issue_date || '',
      passportExpiry: p.expiry_date || '',
      // Issuing state of the passport (FAL asks for it) — prefer the doc's
      // flag_state / country_of_issue, else fall back to nationality.
      passportState: p.flag_state || pDetails.country_of_issue || d.nationality || '',
      // Place of issue (the office/city on the passport), if captured.
      placeOfIssue: p.issuing_authority || pDetails.place_of_issue || pDetails.country_of_issue || '',
    };
  });
  return out;
};

// Fields the port authority treats as mandatory — used to warn before export.
export const MANDATORY_FIELDS = [
  { key: 'surname', label: 'Surname' },
  { key: 'foreName', label: 'Fore name' },
  { key: 'rank', label: 'Rank' },
  { key: 'nationality', label: 'Nationality' },
  { key: 'dob', label: 'Date of birth' },
  { key: 'passportNo', label: 'Passport no.' },
  { key: 'passportExpiry', label: 'Passport expiry' },
];

/** Build one crew-list row from a roster member + its fetched details. */
export const buildCrewRow = (member, det = {}) => {
  const { foreName, surname } = splitName(member.fullName || member.full_name);
  return {
    userId: member.user_id || member.id,
    foreName,
    surname,
    rank: member.roleTitle && member.roleTitle !== 'No role' ? member.roleTitle : '',
    department: member.department || '',
    status: member.status || '',
    sex: det.sex || '',
    dob: det.dob || '',
    placeOfBirth: det.placeOfBirth || '',
    nationality: det.nationality || '',
    passportNo: det.passportNo || '',
    passportIssue: det.passportIssue || '',
    passportExpiry: det.passportExpiry || '',
    passportState: det.passportState || '',
    placeOfIssue: det.placeOfIssue || '',
    address: det.address || '',
  };
};

/** Which mandatory fields are blank on a row (for the pre-export warning). */
export const missingMandatory = (row) =>
  MANDATORY_FIELDS.filter((f) => !String(row[f.key] || '').trim()).map((f) => f.label);
