// Profile completion — the mandatory set a crew member needs for onboarding.
// Returns { percent, done, total, missing: [{ key, label, tab, weight }] } so the
// UI can show "% complete" and exactly what's outstanding.
//
// The headline `percent` is WEIGHTED: compliance-critical items (passport, ENG1,
// STCW, CoC, emergency contact) move the needle far more than soft personal
// fields. `done`/`total` stay as plain counts for any "N of M" readout.

import { CORE_DOCUMENT_TYPE_IDS, getDocType } from '../documentTypes';

const WEIGHTS = {
  // Compliance-critical documents — the things that stop a crew member sailing.
  doc_passport: 5,
  doc_eng1: 5,
  doc_stcw_basic: 5,
  doc_coc: 5,
  doc_pdsd: 3,
  doc_seamans_book: 2,
  doc_tax_residency: 2,
  // Safety-critical personal info.
  emergency: 4,
  // Core identity.
  lastName: 2,
  dob: 2,
  nationality: 2,
  // Softer / administrative.
  phone: 1,
  homeAddress: 1,
  allergies: 1,
};
const weightOf = (key) => WEIGHTS[key] ?? 1;

export const computeProfileCompletion = ({ formData = {}, crewMember = {}, docs = [] }) => {
  const f = formData;
  const hasPhone = (Array.isArray(f.phones) && f.phones.some((p) => p?.value)) || !!f.phoneNumber;
  const docTypes = new Set((docs || []).map((d) => d.doc_type));
  const isCommand = crewMember?.effectiveTier === 'COMMAND';

  const items = [
    { key: 'lastName', label: 'Last name', tab: 'personal', done: !!f.lastName },
    { key: 'dob', label: 'Date of birth', tab: 'personal', done: !!f.dateOfBirth },
    { key: 'nationality', label: 'Nationality', tab: 'personal', done: !!f.nationality },
    { key: 'phone', label: 'Phone number', tab: 'personal', done: hasPhone },
    { key: 'homeAddress', label: 'Home address', tab: 'personal', done: !!f.homeAddress },
    { key: 'allergies', label: 'Allergies status', tab: 'personal', done: !!f.allergiesStatus },
    { key: 'emergency', label: 'Emergency contact', tab: 'emergency', done: !!f.emergencyContactName && !!f.emergencyContactPhone },
  ];

  // Core documents everyone needs (incl. the universal additions: discharge
  // book, tax/residency), + CoC for command roles.
  const docReqs = [...CORE_DOCUMENT_TYPE_IDS];
  if (isCommand) docReqs.push('coc');
  docReqs.forEach((id) => {
    items.push({ key: `doc_${id}`, label: getDocType(id)?.label || id, tab: 'documents', done: docTypes.has(id) });
  });

  const weighted = items.map((i) => ({ ...i, weight: weightOf(i.key) }));
  const totalWeight = weighted.reduce((s, i) => s + i.weight, 0);
  const doneWeight = weighted.reduce((s, i) => s + (i.done ? i.weight : 0), 0);
  const percent = totalWeight ? Math.round((doneWeight / totalWeight) * 100) : 0;

  const total = items.length;
  const done = items.filter((i) => i.done).length;
  // Most important outstanding items first, so the "what's left" list leads with
  // the compliance-critical gaps.
  const missing = weighted.filter((i) => !i.done).sort((a, b) => b.weight - a.weight);
  return { percent, done, total, missing };
};
