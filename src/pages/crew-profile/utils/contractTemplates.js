import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { supabase } from '../../../lib/supabaseClient';
import { crewContractStandard } from '../../../data/flagStates';

const BUCKET = 'vessel-documents';
export const TEMPLATE_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// The placeholders a template can use — written as {{token}} in the .docx.
// Grouped for the picker's "available fields" reference.
export const CONTRACT_TOKEN_GROUPS = [
  { group: 'Crew', tokens: [
    ['crew_name', 'Full name'], ['crew_first_name', 'First name'], ['crew_last_name', 'Surname'],
    ['crew_email', 'Email'], ['crew_role', 'Role / rank'], ['crew_department', 'Department'],
  ] },
  { group: 'Contract', tokens: [
    ['contract_type', 'Contract type'], ['start_date', 'Start date'], ['end_date', 'End date'],
    ['probation_end_date', 'Probation end'], ['rotation_pattern', 'Rotation pattern'],
    ['leave_days', 'Leave entitlement (days)'], ['notice_period', 'Notice period'],
    ['sea_reference', 'SEA reference'], ['contract_standard', 'Contract standard'],
  ] },
  { group: 'Salary', tokens: [
    ['salary', 'Salary (formatted)'], ['salary_amount', 'Salary amount'],
    ['salary_currency', 'Salary currency'], ['salary_period', 'Salary period'],
    ['day_rate', 'Day rate'],
  ] },
  { group: 'Vessel', tokens: [
    ['vessel_name', 'Vessel name'], ['flag_state', 'Flag state'],
    ['port_of_registry', 'Port of registry'], ['imo_number', 'IMO number'],
    ['official_number', 'Official number'],
  ] },
  { group: 'Document', tokens: [['today', 'Date generated']] },
];

export const ALL_TOKENS = CONTRACT_TOKEN_GROUPS.flatMap((g) => g.tokens.map(([k]) => k));

const CUR_SYMBOL = { EUR: '€', USD: '$', GBP: '£', AUD: 'A$', NZD: 'NZ$', CAD: 'C$', CHF: 'Fr', ZAR: 'R' };

// dd/mm/yyyy (zero-padded), per the Cargo date convention.
const fmtDate = (d) => {
  if (!d) return '';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(dt.getDate())}/${p(dt.getMonth() + 1)}/${dt.getFullYear()}`;
};
const num = (n) => (n != null && n !== '' ? Number(n).toLocaleString('en-GB') : '');

// Build the {{token}} → value map from the profile data the contract tab holds.
export function buildContractTokens({ crewMember, empForm, compForm, vessel }) {
  const e = empForm || {};
  const c = compForm || {};
  const v = vessel || {};
  const sym = CUR_SYMBOL[c.salary_currency] || c.salary_currency || '';
  const period = c.salary_period === 'year' ? 'year' : 'month';
  const amt = (c.salary_amount != null && c.salary_amount !== '') ? Number(c.salary_amount) : null;
  const dayRate = amt != null ? Math.round((amt * (period === 'year' ? 1 : 12) / 365) * 100) / 100 : null;

  return {
    crew_name: crewMember?.fullName || '',
    crew_first_name: crewMember?.firstName || '',
    crew_last_name: crewMember?.lastName || '',
    crew_email: crewMember?.email || '',
    crew_role: crewMember?.roleTitle || '',
    crew_department: crewMember?.department || '',

    contract_type: e.contract_type || '',
    start_date: fmtDate(e.start_date),
    end_date: fmtDate(e.end_date),
    probation_end_date: fmtDate(e.probation_end_date),
    rotation_pattern: e.rotation_pattern || '',
    leave_days: (e.leave_entitlement_days != null && e.leave_entitlement_days !== '') ? String(e.leave_entitlement_days) : '',
    notice_period: e.notice_period || '',
    sea_reference: e.sea_reference || '',
    contract_standard: crewContractStandard({
      flag: v.flag, commercialStatus: v.commercial_status, certifiedCommercial: v.certified_commercial,
    }) || '',

    salary: amt != null ? `${sym}${num(amt)} per ${period}` : '',
    salary_amount: amt != null ? num(amt) : '',
    salary_currency: c.salary_currency || '',
    salary_period: amt != null ? period : '',
    day_rate: dayRate != null ? `${sym}${num(dayRate)}` : '',

    vessel_name: v.name || '',
    flag_state: v.flag || '',
    port_of_registry: v.port_of_registry || '',
    imo_number: v.imo_number || '',
    official_number: v.official_number || '',

    today: fmtDate(new Date()),
  };
}

// Pull the readable text out of a .docx (document body + headers + footers) and
// find the {{tokens}} it uses. Tags are stripped first so tokens split across
// Word runs are still recovered.
function detectTokensFromZip(zip) {
  const found = new Set();
  Object.keys(zip.files)
    .filter((p) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(p))
    .forEach((p) => {
      const text = zip.files[p].asText().replace(/<[^>]+>/g, '');
      const re = /\{\{\s*([\w]+)\s*\}\}/g;
      let m;
      while ((m = re.exec(text)) !== null) found.add(m[1]);
    });
  return [...found];
}

export async function fetchTemplates(tenantId) {
  if (!tenantId) return [];
  const { data, error } = await supabase
    .from('contract_templates')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function uploadTemplate({ tenantId, file, name, roles, createdBy }) {
  if (!file?.name?.toLowerCase().endsWith('.docx')) {
    throw new Error('Templates must be a Word .docx file.');
  }
  const buf = await file.arrayBuffer();
  let tokens = [];
  try { tokens = detectTokensFromZip(new PizZip(buf)); } catch { /* not a valid zip — leave empty */ }

  const path = `${tenantId}/templates/${Date.now()}-${file.name}`;
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: '3600', upsert: false, contentType: TEMPLATE_MIME,
  });
  if (upErr) throw upErr;

  const { data, error } = await supabase.from('contract_templates').insert({
    tenant_id: tenantId,
    name: name?.trim() || file.name.replace(/\.docx$/i, ''),
    roles: Array.isArray(roles) ? roles : [],
    storage_path: path,
    file_name: file.name,
    mime_type: TEMPLATE_MIME,
    size_bytes: file.size || null,
    tokens,
    created_by: createdBy || null,
  }).select().single();
  if (error) {
    // Best-effort cleanup so we don't orphan the uploaded file.
    await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
    throw error;
  }
  return data;
}

export async function updateTemplateRoles(id, roles) {
  const { error } = await supabase
    .from('contract_templates')
    .update({ roles: Array.isArray(roles) ? roles : [], updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteTemplate(template) {
  if (template?.storage_path) {
    await supabase.storage.from(BUCKET).remove([template.storage_path]).catch(() => {});
  }
  const { error } = await supabase.from('contract_templates').delete().eq('id', template.id);
  if (error) throw error;
}

// Merge token data into the template .docx and return the filled-in Blob.
export async function generateContractBlob(template, tokenData) {
  const { data, error } = await supabase.storage.from(BUCKET).download(template.storage_path);
  if (error) throw error;
  const buf = await data.arrayBuffer();
  const zip = new PizZip(buf);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: '{{', end: '}}' },
    nullGetter: () => '',   // unknown / empty tokens render as blank, never crash
  });
  doc.render(tokenData);
  return doc.getZip().generate({ type: 'blob', mimeType: TEMPLATE_MIME });
}

// A template "fits" a crew member if it has no role restriction, or lists their role.
export function templateFitsRole(template, roleTitle) {
  const roles = template?.roles || [];
  if (!roles.length) return true;
  if (!roleTitle) return false;
  return roles.some((r) => r.toLowerCase() === String(roleTitle).toLowerCase());
}
