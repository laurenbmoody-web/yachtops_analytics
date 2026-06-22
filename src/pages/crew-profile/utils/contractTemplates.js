import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { PDFDocument } from 'pdf-lib';
import { supabase } from '../../../lib/supabaseClient';
import { crewContractStandard } from '../../../data/flagStates';

const BUCKET = 'vessel-documents';
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const PDF_MIME = 'application/pdf';
export const TEMPLATE_MIME = DOCX_MIME;   // back-compat alias

export const isPdfTemplate = (t) =>
  (t?.mime_type || '').includes('pdf') || /\.pdf$/i.test(t?.file_name || t?.name || '');

// The placeholders a template can use — written as {{token}} in the .docx.
// Grouped for the picker's "available fields" reference.
export const CONTRACT_TOKEN_GROUPS = [
  { group: 'Crew', tokens: [
    ['crew_name', 'Full name'], ['crew_first_name', 'First name'], ['crew_last_name', 'Surname'],
    ['crew_email', 'Email'], ['crew_role', 'Role / rank'], ['crew_department', 'Department'],
    ['date_of_birth', 'Date of birth'], ['place_of_birth', 'Place of birth'],
    ['nationality', 'Nationality'], ['passport_number', 'Passport / ID number'],
    ['home_address', 'Home address'], ['phone_number', 'Phone number'],
  ] },
  { group: 'Contract', tokens: [
    ['contract_type', 'Contract type'], ['start_date', 'Start date'], ['end_date', 'End date'],
    ['probation_end_date', 'Probation end'], ['rotation_pattern', 'Rotation pattern'],
    ['leave_days', 'Leave entitlement (days)'], ['notice_period', 'Notice period'],
    ['sea_reference', 'SEA reference'], ['contract_standard', 'Contract standard'],
    ['port_of_embarkation', 'Port of embarkation'], ['repatriation_destination', 'Repatriation destination'],
  ] },
  { group: 'Salary', tokens: [
    ['salary', 'Salary (formatted)'], ['salary_amount', 'Salary amount'],
    ['salary_currency', 'Salary currency'], ['salary_period', 'Salary period'],
    ['day_rate', 'Day rate'],
  ] },
  { group: 'Vessel & Company', tokens: [
    ['vessel_name', 'Vessel name'], ['flag_state', 'Flag state'],
    ['port_of_registry', 'Port of registry'], ['imo_number', 'IMO number'],
    ['official_number', 'Official number'], ['captain_name', 'Captain name'],
    ['company_name', 'Company / owner'], ['company_address', 'Company address'],
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
    date_of_birth: fmtDate(crewMember?.dateOfBirth) || '',
    place_of_birth: crewMember?.placeOfBirth || '',
    nationality: crewMember?.nationality || '',
    passport_number: crewMember?.passportNumber || '',
    home_address: crewMember?.homeAddress || '',
    phone_number: crewMember?.phoneNumber || '',

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
    captain_name: v.captain_name || '',
    company_name: v.company_name || '',
    company_address: v.company_address || '',

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

// The fillable form-field names in a PDF become its "tokens". A flat PDF (a
// scan or an exported doc with no AcroForm) returns [] — it can't be filled.
async function detectFieldsFromPdf(buf) {
  try {
    const pdf = await PDFDocument.load(buf, { ignoreEncryption: true });
    return pdf.getForm().getFields().map((f) => f.getName());
  } catch {
    return [];
  }
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
  const lower = (file?.name || '').toLowerCase();
  const isPdf = lower.endsWith('.pdf');
  const isDocx = lower.endsWith('.docx');
  if (!isPdf && !isDocx) {
    throw new Error('Templates must be a Word .docx or a fillable .pdf file.');
  }
  const buf = await file.arrayBuffer();
  let tokens = [];
  if (isPdf) {
    tokens = await detectFieldsFromPdf(buf);
  } else {
    try { tokens = detectTokensFromZip(new PizZip(buf)); } catch { /* not a valid zip — leave empty */ }
  }
  const mime = isPdf ? PDF_MIME : DOCX_MIME;

  const path = `${tenantId}/templates/${Date.now()}-${file.name}`;
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: '3600', upsert: false, contentType: mime,
  });
  if (upErr) throw upErr;

  const { data, error } = await supabase.from('contract_templates').insert({
    tenant_id: tenantId,
    name: name?.trim() || file.name.replace(/\.(docx|pdf)$/i, ''),
    roles: Array.isArray(roles) ? roles : [],
    storage_path: path,
    file_name: file.name,
    mime_type: mime,
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

// Fill the template's PDF form fields from the token data and flatten it into a
// finished, non-editable PDF. Fields whose names don't match a token are left
// as-is; a PDF with no form fields comes back essentially unchanged.
async function fillPdf(buf, tokenData) {
  const pdf = await PDFDocument.load(buf, { ignoreEncryption: true });
  const form = pdf.getForm();
  form.getFields().forEach((field) => {
    const val = tokenData[field.getName()];
    if (val == null || val === '') return;
    try {
      if (typeof field.setText === 'function') field.setText(String(val));        // text field
      else if (typeof field.select === 'function') field.select(String(val));     // dropdown / radio
      else if (typeof field.check === 'function' && /^(true|yes|x|1)$/i.test(String(val))) field.check();
    } catch { /* incompatible value for this field type — skip it */ }
  });
  try { form.flatten(); } catch { /* leave fields live if flatten chokes */ }
  const bytes = await pdf.save();
  return new Blob([bytes], { type: PDF_MIME });
}

// Merge token data into the template and return the filled-in Blob, branching
// on format: .docx tokens via docxtemplater, .pdf form fields via pdf-lib.
export async function generateContractBlob(template, tokenData) {
  const { data, error } = await supabase.storage.from(BUCKET).download(template.storage_path);
  if (error) throw error;
  const buf = await data.arrayBuffer();

  if (isPdfTemplate(template)) return fillPdf(buf, tokenData);

  const zip = new PizZip(buf);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: '{{', end: '}}' },
    nullGetter: () => '',   // unknown / empty tokens render as blank, never crash
  });
  doc.render(tokenData);
  return doc.getZip().generate({ type: 'blob', mimeType: DOCX_MIME });
}

// A template "fits" a crew member if it has no role restriction, or lists their role.
export function templateFitsRole(template, roleTitle) {
  const roles = template?.roles || [];
  if (!roles.length) return true;
  if (!roleTitle) return false;
  return roles.some((r) => r.toLowerCase() === String(roleTitle).toLowerCase());
}

// ----- Templatize: turn a completed contract into a reusable {{token}} template -----

const xmlEscape = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

// Readable text of a .docx, paragraph by paragraph, for the AI to analyse.
function docxToText(zip) {
  return Object.keys(zip.files)
    .filter((p) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(p))
    .map((p) => zip.files[p].asText()
      .replace(/<\/w:p>/g, '\n')      // paragraph breaks
      .replace(/<[^>]+>/g, '')        // drop tags
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'"))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Replace each mapped value with {{token}} directly in the document XML, keeping
// all original formatting. Values are matched against the escaped XML, so most
// contiguous runs are caught; anything Word split mid-value is reported back.
function applyMappingsToZip(zip, mappings) {
  const targets = Object.keys(zip.files)
    .filter((p) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(p));
  const notFound = [];
  mappings.forEach(({ value, token }) => {
    if (!value || !token) return;
    const needle = xmlEscape(value);
    const repl = `{{${token}}}`;
    let hit = false;
    targets.forEach((p) => {
      const xml = zip.files[p].asText();
      if (xml.includes(needle)) {
        zip.file(p, xml.split(needle).join(repl));
        hit = true;
      }
    });
    if (!hit) notFound.push(value);
  });
  return notFound;
}

// Fetch a logo (public URL) and return the bytes + an aspect-correct size in
// EMUs (914400 per inch), capped to a sensible letterhead box. Returns null on
// any failure so template creation never breaks on a bad/missing logo.
async function fetchLogo(url) {
  if (!url) return null;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const ct = (resp.headers.get('content-type') || '').toLowerCase();
    const bytes = new Uint8Array(await resp.arrayBuffer());
    const ext = ct.includes('png') ? 'png' : (ct.includes('jpeg') || ct.includes('jpg')) ? 'jpeg' : null;
    if (!ext) return null;   // only embed png/jpeg
    const dims = await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve(null);
      img.src = url;
    });
    if (!dims || !dims.w || !dims.h) return null;
    const PX_TO_EMU = 9525, MAX_W = 1.7 * 914400, MAX_H = 0.95 * 914400;
    let cx = dims.w * PX_TO_EMU, cy = dims.h * PX_TO_EMU;
    const scale = Math.min(MAX_W / cx, MAX_H / cy, 1);
    return { bytes, ext, cx: Math.round(cx * scale), cy: Math.round(cy * scale) };
  } catch {
    return null;
  }
}

// An inline, centred logo image paragraph for a header part (references the
// header's image relationship rIdLogo).
function logoParagraph(logo) {
  const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
  const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
  return `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="60"/></w:pPr><w:r><w:drawing>`
    + `<wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="${WP}">`
    + `<wp:extent cx="${logo.cx}" cy="${logo.cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>`
    + `<wp:docPr id="1" name="Logo"/>`
    + `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="${A}" noChangeAspect="1"/></wp:cNvGraphicFramePr>`
    + `<a:graphic xmlns:a="${A}"><a:graphicData uri="${PIC}">`
    + `<pic:pic xmlns:pic="${PIC}"><pic:nvPicPr><pic:cNvPr id="1" name="Logo"/><pic:cNvPicPr/></pic:nvPicPr>`
    + `<pic:blipFill><a:blip r:embed="rIdLogo"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
    + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${logo.cx}" cy="${logo.cy}"/></a:xfrm>`
    + `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>`
    + `</wp:inline></w:drawing></w:r></w:p>`;
}

// Short text → muted, optionally centred paragraphs for a header/footer part.
function furnitureParas(text) {
  const lines = String(text || '').split('\n');
  const out = lines.map((line) => {
    if (line.trim() === '') return '<w:p/>';
    return `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>`
      + `<w:r><w:rPr><w:sz w:val="16"/><w:color w:val="808080"/></w:rPr>`
      + `<w:t xml:space="preserve">${xmlEscape(line)}</w:t></w:r></w:p>`;
  }).join('');
  return out || '<w:p/>';
}

// Wrap plain text (with {{tokens}} and newlines) into a minimal, valid .docx.
// The first non-empty line becomes a centred title; lines that look like a
// top-level clause heading ("1 Job Title", "5 Salary…") are bolded so the
// rebuilt contract reads like a contract, not a wall of text. Optional
// headerText / footerText become a real running page header / footer, and an
// optional logo (from fetchLogo) is embedded at the top of the header.
function textToDocxBlob(text, { headerText = '', footerText = '', logo = null } = {}) {
  const lines = String(text).split('\n');
  const titleIdx = lines.findIndex((l) => l.trim() !== '');
  const paras = lines.map((line, idx) => {
    const t = line.trim();
    if (t === '') return '<w:p/>';
    const esc = xmlEscape(line);
    if (idx === titleIdx) {
      return `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="240"/></w:pPr>`
        + `<w:r><w:rPr><w:b/><w:sz w:val="32"/></w:rPr><w:t xml:space="preserve">${esc}</w:t></w:r></w:p>`;
    }
    const isHeading = /^\d+\s+[A-Z]/.test(t) && t.length < 70;
    if (isHeading) {
      return `<w:p><w:pPr><w:spacing w:before="220" w:after="60"/></w:pPr>`
        + `<w:r><w:rPr><w:b/><w:sz w:val="26"/></w:rPr><w:t xml:space="preserve">${esc}</w:t></w:r></w:p>`;
    }
    return `<w:p><w:r><w:t xml:space="preserve">${esc}</w:t></w:r></w:p>`;
  }).join('');

  const hasHeaderText = String(headerText || '').trim() !== '';
  const hasHeader = hasHeaderText || !!logo;
  const hasFooter = String(footerText || '').trim() !== '';
  const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const logoExt = logo ? (logo.ext === 'png' ? 'png' : 'jpg') : '';
  const logoMime = logo ? (logo.ext === 'png' ? 'png' : 'jpeg') : '';

  // sectPr references the header/footer parts that exist.
  const sectPr = `<w:sectPr>`
    + (hasHeader ? '<w:headerReference w:type="default" r:id="rIdHdr"/>' : '')
    + (hasFooter ? '<w:footerReference w:type="default" r:id="rIdFtr"/>' : '')
    + `</w:sectPr>`;

  const zip = new PizZip();
  const typeOverrides = [
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
    hasHeader ? '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' : '',
    hasFooter ? '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' : '',
  ].join('');
  const imageDefault = logo ? `<Default Extension="${logoExt}" ContentType="image/${logoMime}"/>` : '';
  zip.file('[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
${imageDefault}${typeOverrides}
</Types>`);
  zip.folder('_rels').file('.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);

  const word = zip.folder('word');
  word.file('document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}"><w:body>${paras}${sectPr}</w:body></w:document>`);

  if (hasHeader || hasFooter) {
    const docRels = [
      hasHeader ? '<Relationship Id="rIdHdr" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>' : '',
      hasFooter ? '<Relationship Id="rIdFtr" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>' : '',
    ].join('');
    word.folder('_rels').file('document.xml.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${docRels}</Relationships>`);
    if (hasHeader) {
      const headerBody = (logo ? logoParagraph(logo) : '') + (hasHeaderText ? furnitureParas(headerText) : '');
      word.file('header1.xml',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="${W_NS}" xmlns:r="${R_NS}">${headerBody}</w:hdr>`);
      if (logo) {
        word.folder('_rels').file('header1.xml.rels',
          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdLogo" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo.${logoExt}"/>
</Relationships>`);
        word.folder('media').file(`logo.${logoExt}`, logo.bytes);
      }
    }
    if (hasFooter) {
      word.file('footer1.xml',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="${W_NS}">${furnitureParas(footerText)}</w:ftr>`);
    }
  }
  return zip.generate({ type: 'blob', mimeType: DOCX_MIME });
}

// .docx in → ask the AI to map particulars to tokens. Returns the extracted text
// + suggested mappings for the user to review before we build the template.
export async function analyzeDocxForTemplate(file) {
  const buf = await file.arrayBuffer();
  const zip = new PizZip(buf);
  const text = docxToText(zip);
  const { data, error } = await supabase.functions.invoke('templatize-contract', {
    body: { mode: 'map', text },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return { kind: 'map', mappings: data?.mappings || [], buf };
}

// .pdf in → ask the AI to re-emit the contract with {{tokens}}. Returns the
// rebuilt text for the user to review before we wrap it into a .docx.
export async function analyzePdfForTemplate(file) {
  const base64 = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = reject;
    r.readAsDataURL(file);
  });
  const { data, error } = await supabase.functions.invoke('templatize-contract', {
    body: { mode: 'rebuild', base64, mediaType: file.type || 'application/pdf' },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return {
    kind: 'rebuild',
    templateText: data?.template_text || '',
    headerText: data?.header_text || '',
    footerText: data?.footer_text || '',
  };
}

// Build the final .docx template File from a reviewed draft. For a rebuilt
// (PDF-sourced) template, an optional logoUrl is embedded in the page header.
export async function buildTemplateDocxFile(draft, fileName, { logoUrl } = {}) {
  let blob, notFound = [];
  if (draft.kind === 'map') {
    const zip = new PizZip(draft.buf);
    notFound = applyMappingsToZip(zip, draft.mappings);
    blob = zip.generate({ type: 'blob', mimeType: DOCX_MIME });
  } else {
    const logo = await fetchLogo(logoUrl);
    blob = textToDocxBlob(draft.templateText, {
      headerText: draft.headerText, footerText: draft.footerText, logo,
    });
  }
  const name = fileName.endsWith('.docx') ? fileName : `${fileName}.docx`;
  return { file: new File([blob], name, { type: DOCX_MIME }), notFound };
}

