// Profile completion — the mandatory set a crew member needs for onboarding.
// Returns { percent, done, total, missing: [{ key, label, tab }] } so the UI
// can show "% complete" and exactly what's outstanding.

import { CORE_DOCUMENT_TYPE_IDS, getDocType } from '../documentTypes';

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

  // Core documents everyone needs, + CoC for command roles.
  const docReqs = [...CORE_DOCUMENT_TYPE_IDS];
  if (isCommand) docReqs.push('coc');
  docReqs.forEach((id) => {
    items.push({ key: `doc_${id}`, label: getDocType(id)?.label || id, tab: 'documents', done: docTypes.has(id) });
  });

  const total = items.length;
  const done = items.filter((i) => i.done).length;
  const percent = total ? Math.round((done / total) * 100) : 0;
  const missing = items.filter((i) => !i.done);
  return { percent, done, total, missing };
};
